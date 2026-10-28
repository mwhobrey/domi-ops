import { createHash, createHmac, randomUUID } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { chores, shoppingItems, mcpWriteIntents, mcpWriteEvents, type Database } from "@domi-ops/db";
import { decryptSensitive, encryptSensitive } from "@domi-ops/crypto";
import type { Env } from "@domi-ops/config";
import type { McpAuthorization, McpWriteIdentity } from "@domi-ops/auth";
import { checkOperation } from "./access.js";

const target = z.object({ kind: z.enum(["shopping", "chore"]), id: z.string().uuid(), revision: z.number().int().positive().safe() }).strict();
const preview = z.object({ title: z.string().min(1).max(160), targets: z.array(target).max(10),
  changes: z.array(z.object({ field: z.string().min(1).max(80), before: z.string().max(2000).nullable(), after: z.string().max(2000).nullable() }).strict()).min(1).max(20) }).strict();
export type WriteTarget = z.infer<typeof target>;
export type WritePreview = z.infer<typeof preview>;
export type ReviewedOperation = {
  name: string; version: string; scope: "shopping:write" | "chores:write"; roles: readonly string[];
  input: z.ZodType<Record<string, unknown>>;
  snapshot: (tx: Database, identity: McpWriteIdentity, input: Record<string, unknown>) => Promise<WritePreview>;
  authorize: (tx: Database, identity: McpWriteIdentity, targets: readonly WriteTarget[]) => Promise<void>;
  apply: (tx: Database, identity: McpWriteIdentity, input: Record<string, unknown>) => Promise<void>;
};
export const prepareWriteInput = z.object({ operation: z.string().min(1).max(80), payload: z.record(z.string(), z.unknown()), idempotencyKey: z.string().min(16).max(128) }).strict();
export const writeReference = z.object({ intentId: z.string().uuid() }).strict();
export const writeConfirmation = writeReference.extend({ digest: z.string().regex(/^[a-f0-9]{64}$/), nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
type Intent = typeof mcpWriteIntents.$inferSelect;
export class ReviewedWriteError extends Error {
  constructor(public readonly code: string, public readonly status: 400 | 403 | 404 | 409 | 429 = 409) { super(code); }
}
function fail(code = "change_unavailable", status: 400 | 403 | 404 | 409 | 429 = 404): never { throw new ReviewedWriteError(code, status); }
function hash(text: string) { return createHash("sha256").update(text).digest("hex"); }
export function canonicalWriteJson(value: unknown): string {
  let nodes = 0;
  function normalize(value: unknown, depth = 0): unknown {
    if (++nodes > 2000 || depth > 20) fail("change_too_large", 400);
    if (value === null || typeof value === "boolean" || typeof value === "string") return value;
    if (typeof value === "number" && Number.isFinite(value)) return Object.is(value, -0) ? 0 : value;
    if (Array.isArray(value)) return value.map(child => normalize(child, depth + 1));
    if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize((value as Record<string, unknown>)[key], depth + 1)]));
    }
    fail("invalid_change", 400);
  }
  const text = JSON.stringify(normalize(value));
  if (Buffer.byteLength(text) > 24000) fail("change_too_large", 400);
  return text;
}

/** Only reviewed, server-installed adapters enter this registry. Production stays empty in WHO-479. */
export function reviewedWrites(auth: McpAuthorization, env: Env, operations: readonly ReviewedOperation[] = []) {
  const registry = new Map<string, ReviewedOperation>();
  for (const operation of operations) {
    if (!/^[a-z][a-z0-9_.]{1,79}$/.test(operation.name) || !/^[a-zA-Z0-9_.-]{1,40}$/.test(operation.version) || registry.has(operation.name)) throw new Error("invalid_reviewed_operation_registry");
    registry.set(operation.name, operation);
  }
  function enabled() { if (!env.MCP_WRITES_ENABLED || !env.MCP_ENABLED || env.DEMO_MODE || !env.ENCRYPTION_KEY) fail("writes_not_enabled", 403); }
  function operation(name: string, identity: McpWriteIdentity) {
    const op = registry.get(name);
    if (!op || !identity.scopes.includes(op.scope) || !op.roles.includes(identity.role)) fail();
    return op;
  }
  function binding(row: Intent) {
    return { id: row.id, householdId: row.householdId, userId: row.userId, memberId: row.memberId, connectionId: row.connectionId,
      clientId: row.clientId, operation: row.operation, operationVersion: row.operationVersion, scope: row.scope,
      policyVersion: row.policyVersion, profileVersion: row.profileVersion, grantedRole: row.grantedRole,
      requestDigest: row.requestDigest, previewDigest: row.previewDigest, expiresAt: row.expiresAt.toISOString() };
  }
  function encrypt(row: Intent, data: Record<string, unknown>) {
    return encryptSensitive(canonicalWriteJson({ binding: binding(row), ...data }), env.ENCRYPTION_KEY!);
  }
  function decrypt(row: Intent): Record<string, unknown> {
    try {
      if (!row.envelope?.startsWith("enc:v1:")) fail();
      const value = JSON.parse(decryptSensitive(row.envelope!, env.ENCRYPTION_KEY!)) as Record<string, unknown>;
      if (canonicalWriteJson(value.binding) !== canonicalWriteJson(binding(row))) fail();
      return value;
    } catch { fail(); }
  }
  async function event(tx: Database, identity: McpWriteIdentity, row: Intent, outcome: string) {
    await tx.insert(mcpWriteEvents).values({ householdId: identity.householdId, userId: identity.userId, connectionId: identity.connectionId,
      intentId: row.id, outcome, sessionHash: identity.sessionId ? hash(identity.sessionId) : null });
  }
  async function lookup(tx: Database, identity: McpWriteIdentity, id: string) {
    const [row] = await tx.select().from(mcpWriteIntents).where(and(eq(mcpWriteIntents.id, id), eq(mcpWriteIntents.connectionId, identity.connectionId), eq(mcpWriteIntents.userId, identity.userId))).for("update");
    if (!row || row.clientId !== identity.clientId || row.memberId !== identity.memberId || row.householdId !== identity.householdId ||
      row.policyVersion !== identity.policyVersion || row.profileVersion !== identity.profileVersion || row.grantedRole !== identity.role) fail();
    const op = operation(row.operation, identity);
    await checkOperation(tx, env, identity, { module: "core", access: "write" }, true);
    return { row, op };
  }
  function receipt(row: Intent) {
    return { intentId: row.id, state: row.state, expiresAt: row.expiresAt.toISOString(), receiptId: row.receiptId, confirmedAt: row.confirmedAt?.toISOString() ?? null };
  }
  async function terminal(tx: Database, identity: McpWriteIdentity, row: Intent, state: "expired" | "stale" | "rejected") {
    const [updated] = await tx.update(mcpWriteIntents).set({ state, envelope: null, reviewNonceHash: null, reviewSessionHash: null }).where(eq(mcpWriteIntents.id, row.id)).returning();
    await event(tx, identity, updated, state); return receipt(updated);
  }
  async function lockTargets(tx: Database, identity: McpWriteIdentity, targets: readonly WriteTarget[], checkRevision: boolean) {
    for (const target of [...targets].sort((a,b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))) {
      const table = target.kind === "shopping" ? shoppingItems : chores;
      const [record] = await tx.select({ revision: table.revision }).from(table).where(and(eq(table.id, target.id), eq(table.householdId, identity.householdId))).for("update");
      if (!record || (checkRevision && record.revision !== target.revision)) return false;
    }
    return true;
  }
  async function result(tx: Database, identity: McpWriteIdentity, row: Intent, op: ReviewedOperation) {
    if (row.state === "pending" && row.expiresAt.getTime() <= Date.now()) return terminal(tx,identity,row,"expired");
    if (row.state === "committed") {
      const targets = z.array(target).max(10).parse(decrypt(row).targets);
      if (!await lockTargets(tx, identity, targets, false)) fail();
      await op.authorize(tx, identity, targets);
    }
    return receipt(row);
  }
  async function savedPreview(tx: Database, identity: McpWriteIdentity, row: Intent, op: ReviewedOperation) {
    if (op.version !== row.operationVersion || op.scope !== row.scope) return null;
    const value = decrypt(row), saved = preview.parse(value.preview), input = op.input.parse(value.input);
    if (!await lockTargets(tx, identity, saved.targets, true)) return null;
    await op.authorize(tx, identity, saved.targets);
    const current = preview.parse(await op.snapshot(tx, identity, input));
    if (canonicalWriteJson(current) !== canonicalWriteJson(saved) || hash(canonicalWriteJson({ operation: op.name, version: op.version, input, preview: saved })) !== row.previewDigest) return null;
    return { preview: saved, input };
  }
  return {
    async prepare(request: Request, args: z.infer<typeof prepareWriteInput>) {
      enabled(); args = prepareWriteInput.parse(args);
      const selected = registry.get(args.operation); if (!selected) fail();
      return auth.withWriteGrantContext(request, [selected.scope], async (tx, identity) => {
        const op = operation(args.operation, identity);
        await checkOperation(tx, env, identity, { module: "core", access: "write" }, true);
        const input = op.input.parse(args.payload), keyHash = hash(args.idempotencyKey);
        const requestDigest = hash(canonicalWriteJson({ operation: op.name, version: op.version, input }));
        // Serialize per-grant creation, including absent keys and storage ceilings.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${identity.connectionId},479))`);
        const [existing] = await tx.select().from(mcpWriteIntents).where(and(eq(mcpWriteIntents.connectionId, identity.connectionId), eq(mcpWriteIntents.keyHash, keyHash))).for("update");
        if (existing) {
          if (existing.requestDigest !== requestDigest) fail("idempotency_conflict", 409);
          return { ...await result(tx, identity, existing, op), reviewUrl: auth.urls.origin + "/ai/changes/" + identity.connectionId + "/" + existing.id };
        }
        const [counts] = await tx.select({ total: sql<number>`count(*)::int`, pending: sql<number>`count(*) filter (where state='pending' and expires_at>clock_timestamp())::int` }).from(mcpWriteIntents).where(eq(mcpWriteIntents.connectionId, identity.connectionId));
        if (counts.total >= 500 || counts.pending >= 20) fail("too_many_changes", 429);
        const view = preview.parse(await op.snapshot(tx, identity, input));
        if (new Set(view.targets.map(t => t.kind+":"+t.id)).size !== view.targets.length || view.targets.some(t => t.kind !== (op.scope === "shopping:write" ? "shopping" : "chore"))) fail("invalid_change", 400);
        await op.authorize(tx, identity, view.targets);
        const now = new Date(), expiresAt = new Date(Math.min(now.getTime()+300000,identity.expiresAt.getTime()));
        const draft = { id: randomUUID(), householdId: identity.householdId, userId: identity.userId, memberId: identity.memberId, connectionId: identity.connectionId, clientId: identity.clientId,
          operation: op.name, operationVersion: op.version, scope: op.scope, keyHash, requestDigest,
          policyVersion: identity.policyVersion, profileVersion: identity.profileVersion, grantedRole: identity.role,
          previewDigest: hash(canonicalWriteJson({ operation: op.name, version: op.version, input, preview: view })), createdAt: now, expiresAt,
          state: "pending" as const, envelope: null, reviewNonceHash: null, reviewSessionHash: null, receiptId: null, confirmedAt: null };
        const [row] = await tx.insert(mcpWriteIntents).values({ ...draft, envelope: encrypt(draft,{ input, preview: view }) }).returning();
        await event(tx, identity, row, "prepared");
        return { ...receipt(row), reviewUrl: auth.urls.origin+"/ai/changes/"+identity.connectionId+"/"+row.id };
      });
    },
    async status(request: Request, intentId: string) {
      enabled(); z.string().uuid().parse(intentId);
      return auth.withWriteGrantContext(request, [], async (tx, identity) => { const {row,op}=await lookup(tx,identity,intentId); return result(tx,identity,row,op); });
    },
    async review(headers: Headers, connectionId: string, intentId: string) {
      enabled(); z.string().uuid().parse(intentId);
      return auth.withWriteReviewContext(headers, connectionId, async (tx, identity) => {
        const {row,op}=await lookup(tx,identity,intentId);
        if (row.state !== "pending") return result(tx,identity,row,op);
        if (row.expiresAt.getTime() <= Date.now()) return terminal(tx,identity,row,"expired");
        const saved = await savedPreview(tx,identity,row,op);
        if (!saved) return terminal(tx,identity,row,"stale");
        // Repeated renders in the same browser must not invalidate each other.
        const nonce=createHmac("sha256",env.ENCRYPTION_KEY!).update("mcp-review/v1:"+row.id+":"+row.previewDigest+":"+hash(identity.sessionId!)).digest("base64url");
        await tx.update(mcpWriteIntents).set({ reviewSessionHash: hash(identity.sessionId!), reviewNonceHash: hash(nonce) }).where(eq(mcpWriteIntents.id,row.id));
        return { ...receipt(row), preview: saved.preview, digest: row.previewDigest, nonce,
          clientName: identity.clientName, householdName: identity.householdName, memberName: identity.memberName };
      });
    },
    async confirm(headers: Headers, connectionId: string, args: z.infer<typeof writeConfirmation>) {
      enabled(); args=writeConfirmation.parse(args);
      return auth.withWriteReviewContext(headers,connectionId,async(tx,identity)=>{
        const {row,op}=await lookup(tx,identity,args.intentId);
        // A repeat needs the same member/session/nonce, even after its first commit.
        if (row.reviewSessionHash !== hash(identity.sessionId!) || row.reviewNonceHash !== hash(args.nonce) || row.previewDigest !== args.digest) fail("confirmation_invalid",409);
        if(row.state!=="pending")return result(tx,identity,row,op);
        if(row.expiresAt.getTime()<=Date.now())return terminal(tx,identity,row,"expired");
        const saved=await savedPreview(tx,identity,row,op);
        if(!saved)return terminal(tx,identity,row,"stale");
        await op.apply(tx,identity,saved.input);
        if(row.expiresAt.getTime()<=Date.now())fail("confirmation_expired",409);
        const [updated]=await tx.update(mcpWriteIntents).set({ state:"committed",confirmedAt:new Date(),receiptId:randomUUID(),envelope:encrypt(row,{targets:saved.preview.targets}) })
          .where(and(eq(mcpWriteIntents.id,row.id),gt(mcpWriteIntents.expiresAt,sql`clock_timestamp()`))).returning();
        if(!updated)fail("confirmation_expired",409);
        await event(tx,identity,updated,"committed");return receipt(updated);
      });
    },
    async reject(headers: Headers,connectionId:string,intentId:string){
      enabled();z.string().uuid().parse(intentId);
      return auth.withWriteReviewContext(headers,connectionId,async(tx,identity)=>{
        const {row,op}=await lookup(tx,identity,intentId);
        return row.state==="pending"?terminal(tx,identity,row,"rejected"):result(tx,identity,row,op);
      });
    },
  };
}
