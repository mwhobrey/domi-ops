/** Operator-assisted portability. Never expose this full-private-data archive as an owner API. */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { decryptSensitive, encryptSensitive } from "@domi-ops/crypto";
import { sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { withHouseholdContext, withSystemContext } from "./tenant-context.js";

type Row = Record<string, unknown>;
type ForeignKey = { child: string; parent: string; columns: string[]; parent_columns: string[] };
type Catalog = { tables: { name: string; tenant: boolean; owner: boolean }[]; columns: { table: string; name: string; type: string; required: boolean; default: string | null }[]; foreignKeys: ForeignKey[]; definitions: { kind: string; name: string; definition: string }[] };
type ArchiveFile = { key: string; name: string; contentType: string; bytes: number; sha256: string; iv: string; tag: string };
type Manifest = { version: 1; householdId: string; createdAt: string; schema: string; rows: Record<string, Row[]>; files: ArchiveFile[]; excluded: string[] };
export type ArchiveObjectStore = {
  read(key: string): Promise<{ body: AsyncIterable<Uint8Array>; contentType?: string }>;
  write(key: string, body: AsyncIterable<Uint8Array>, bytes: number, contentType: string): Promise<void>;
  assertEmpty(prefixes: string[]): Promise<void>;
};
// Operational credentials, public bearer links, queued jobs, receipts and billing stay on the source.
const OMIT = new Set([
  "billing_checkout_intents", "browser_uploads", "household_subscriptions", "household_invitations",
  "calendar_connections", "google_docs_connections", "linked_google_calendars", "calendar_category_import_mappings", "calendar_sync_outbox",
  "health_withings_links", "health_myallyfile_links", "drive_share_tokens", "school_submission_google_copies",
  "user_notifications", "import_records", "expense_budget_alert_sent",
]);
const omitted = (name: string) => OMIT.has(name) || name.endsWith("_reminder_sent");
const identifier = (name: string) => {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error("Invalid database identifier");
  return sql.identifier(name);
};
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const keyBytes = (secret: string) => {
  if (Buffer.byteLength(secret) < 32) throw new Error("Archive and encryption keys must have at least 32 bytes");
  return createHash("sha256").update(secret).digest();
};
const prefixes = (hh: string) => [`drive/${hh}/`, `school/${hh}/`, `avatars/${hh}/`, `households/${hh}/shopping/receipts/`];

async function catalog(db: Database): Promise<Catalog> {
  const tables = await db.execute<{ name: string; tenant: boolean; owner: boolean }>(sql`
    select c.relname as name, c.relrowsecurity as tenant, pg_get_userbyid(c.relowner) = current_user as owner
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' order by c.relname`);
  const columns = await db.execute<Catalog["columns"][number]>(sql`
    select c.relname as "table", a.attname as name, format_type(a.atttypid,a.atttypmod) as type,
      a.attnotnull as required, pg_get_expr(d.adbin,d.adrelid) as "default"
    from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
    where n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped order by c.relname,a.attnum`);
  const foreignKeys = await db.execute<ForeignKey>(sql`
    select c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent,
      array(select a.attname from unnest(c.conkey) with ordinality k(num,ord) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.num order by k.ord) as columns,
      array(select a.attname from unnest(c.confkey) with ordinality k(num,ord) join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.num order by k.ord) as parent_columns
    from pg_constraint c where c.contype='f' and c.connamespace='public'::regnamespace order by c.conrelid::regclass::text,c.conname`);
  const definitions = await db.execute<Catalog["definitions"][number]>(sql`
    select 'constraint' as kind, conrelid::regclass::text || ':' || conname as name, pg_get_constraintdef(oid) as definition
      from pg_constraint where connamespace='public'::regnamespace
    union all select 'index', indexname, indexdef from pg_indexes where schemaname='public'
    union all select 'enum', t.typname, json_agg(e.enumlabel order by e.enumsortorder)::text
      from pg_type t join pg_enum e on e.enumtypid=t.oid where t.typnamespace='public'::regnamespace group by t.typname
    union all select 'policy', tablename || ':' || policyname, json_build_array(cmd,permissive,roles,qual,with_check)::text
      from pg_policies where schemaname='public'
    order by kind,name`);
  return { tables: [...tables], columns: [...columns], foreignKeys: [...foreignKeys], definitions: [...definitions] };
}
function fingerprint(c: Catalog) {
  return digest(JSON.stringify({ tables: c.tables.map(({ name, tenant }) => ({ name, tenant })), columns: c.columns, foreignKeys: c.foreignKeys, definitions: c.definitions }));
}
function allowedTables(c: Catalog) {
  return [...c.tables.filter((t) => t.tenant && !omitted(t.name)).map((t) => t.name), "users", "ba_accounts"].sort();
}
function rekey(value: unknown, from: string, to: string): unknown {
  if (typeof value === "string" && value.startsWith("enc:v1:")) return encryptSensitive(decryptSensitive(value, from), to);
  if (Array.isArray(value)) return value.map((v) => rekey(v, from, to));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rekey(v, from, to)]));
  return value;
}
function references(rows: Record<string, Row[]>, hh: string): string[] {
  const keys = new Set<string>();
  for (const [table, fields] of Object.entries({
    drive_objects: ["s3_key"], school_submission_artifacts: ["s3_key"],
    school_assignment_materials: ["snapshot_s3_key", "snapshot_text_s3_key", "snapshot_json_s3_key"],
    household_members: ["avatar_key"], shopping_trips: ["receipt_s3_key"],
  })) for (const row of rows[table] ?? []) for (const field of fields) {
    const key = row[field];
    if (key == null || key === "") continue;
    if (typeof key !== "string" || !prefixes(hh).some((p) => key.startsWith(p)) || key.includes("..")) throw new Error(`Unsafe or foreign object reference in ${table}.${field}; archive refused`);
    keys.add(key);
  }
  return [...keys].sort();
}
function encodeManifest(manifest: Manifest, secret: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", keyBytes(secret), iv);
  cipher.setAAD(Buffer.from("domi-household-archive-v1"));
  const data = Buffer.concat([cipher.update(JSON.stringify(manifest)), cipher.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") });
}
async function decodeManifest(directory: string, secret: string): Promise<Manifest> {
  const path = join(directory, "manifest.enc.json");
  if ((await stat(path)).size > 128 * 1024 * 1024) throw new Error("Archive manifest exceeds supported size");
  const envelope = JSON.parse(await readFile(path, "utf8"));
  if (envelope.v !== 1) throw new Error("Unsupported archive format");
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(secret), Buffer.from(envelope.iv, "base64"));
  decipher.setAAD(Buffer.from("domi-household-archive-v1"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8"));
}

export async function exportHouseholdArchive(input: { db: Database; householdId: string; encryptionKey: string; archiveKey: string; directory: string; store: ArchiveObjectStore }) {
  keyBytes(input.archiveKey); keyBytes(input.encryptionKey);
  if (!/^[0-9a-f-]{36}$/i.test(input.householdId)) throw new Error("Invalid household id");
  const c = await catalog(input.db);
  const [role] = await input.db.execute<{ unsafe: boolean }>(sql`select rolsuper or rolbypassrls as unsafe from pg_roles where rolname=current_user`);
  if (role?.unsafe || c.tables.some((t) => t.tenant && t.owner)) throw new Error("Export requires a non-owner NOBYPASSRLS application role");
  const rows = await input.db.transaction(async (transaction) => withHouseholdContext(transaction as unknown as Database, input.householdId, async (tx) => {
    await tx.execute(sql`select set_config('app.system_access','false',true), set_config('app.worker_scan','false',true), set_config('app.current_user_id','',true)`);
    const result: Record<string, Row[]> = {};
    for (const name of allowedTables(c).filter((n) => !["users", "ba_accounts"].includes(n))) {
      result[name] = [...await tx.execute<{ row: Row }>(sql`select to_jsonb(t) as row from ${identifier(name)} t`)].map((r) => r.row);
    }
    if (result.households?.length !== 1 || result.households[0].id !== input.householdId) throw new Error("Household not found or isolation failed");
    const ids = (result.household_members ?? []).map((m) => String(m.user_id));
    result.users = ids.length ? [...await tx.execute<{ row: Row }>(sql`select to_jsonb(t) as row from users t where id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`,`)})`)].map((r) => r.row) : [];
    result.ba_accounts = ids.length ? [...await tx.execute<{ row: Row }>(sql`select to_jsonb(t) as row from ba_accounts t where user_id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`,`)}) and provider_id='credential'`)].map((r) => ({ ...r.row, access_token: null, refresh_token: null, id_token: null, scope: null })) : [];
    return result;
  }), { isolationLevel: "repeatable read", accessMode: "read only" });
  validateReferences(rows, c);
  for (const records of Object.values(rows)) if (records.some((r) => "household_id" in r && r.household_id !== input.householdId)) throw new Error("Foreign household data; archive refused");
  await mkdir(input.directory, { recursive: false }); // Existing output is never overwritten.
  const files: ArchiveFile[] = [];
  for (const key of references(rows, input.householdId)) {
    const object = await input.store.read(key);
    const name = `${digest(key)}.bin`, iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", keyBytes(input.archiveKey), iv);
    cipher.setAAD(Buffer.from(key));
    const hash = createHash("sha256"); let bytes = 0;
    const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) { bytes += chunk.length; hash.update(chunk); callback(null, chunk); } });
    await pipeline(Readable.from(object.body), meter, cipher, createWriteStream(join(input.directory, name), { flags: "wx", mode: 0o600 }));
    files.push({ key, name, contentType: object.contentType || "application/octet-stream", bytes, sha256: hash.digest("hex"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") });
  }
  const manifest: Manifest = { version: 1, householdId: input.householdId, createdAt: new Date().toISOString(), schema: fingerprint(c), rows: rekey(rows, input.encryptionKey, input.archiveKey) as Record<string, Row[]>, files, excluded: c.tables.filter((t) => !allowedTables(c).includes(t.name)).map((t) => t.name) };
  // This is the completion marker; failed exports have no manifest and cannot restore.
  await writeFile(join(input.directory, "manifest.enc.json"), encodeManifest(manifest, input.archiveKey), { flag: "wx", mode: 0o600 });
  return { householdId: input.householdId, tables: Object.keys(rows).length, records: Object.values(rows).reduce((n, r) => n + r.length, 0), files: files.length, bytes: files.reduce((n, f) => n + f.bytes, 0) };
}

async function* decryptedFile(directory: string, file: ArchiveFile, secret: string) {
  if (!/^[a-f0-9]{64}\.bin$/.test(file.name) || file.name !== `${digest(file.key)}.bin`) throw new Error("Invalid archive filename");
  const path = join(directory, file.name);
  if (!(await lstat(path)).isFile()) throw new Error("Archive object must be a regular file");
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(secret), Buffer.from(file.iv, "base64"));
  decipher.setAAD(Buffer.from(file.key)); decipher.setAuthTag(Buffer.from(file.tag, "base64"));
  const stream = createReadStream(path).pipe(decipher);
  for await (const chunk of stream) yield chunk as Buffer;
}
function insertionOrder(rows: Record<string, Row[]>, c: Catalog) {
  const pending = new Set(Object.keys(rows).filter((name) => rows[name].length)), order: string[] = [];
  while (pending.size) {
    const next = [...pending].find((name) => !c.foreignKeys.some((f) => f.child === name && f.parent !== name && pending.has(f.parent)));
    if (!next) throw new Error("Archive has unsupported cyclic table dependencies");
    pending.delete(next); order.push(next);
  }
  return order;
}
function validateReferences(rows: Record<string, Row[]>, c: Catalog) {
  for (const f of c.foreignKeys) for (const row of rows[f.child] ?? []) {
    if (f.columns.some((col) => row[col] == null)) continue;
    if (!(rows[f.parent] ?? []).some((parent) => f.columns.every((col, i) => JSON.stringify(row[col]) === JSON.stringify(parent[f.parent_columns[i]])))) throw new Error(`Missing or foreign parent in ${f.child}; archive refused`);
  }
}
function rowBatches(name: string, rows: Row[], c: Catalog) {
  let remaining = [...rows]; const inserted: Row[] = [], batches: Row[][] = [];
  const self = c.foreignKeys.filter((f) => f.child === name && f.parent === name);
  while (remaining.length) {
    const ready = remaining.filter((row) => self.every((f) => f.columns.some((col) => row[col] == null) || inserted.some((parent) => f.columns.every((col, i) => row[col] === parent[f.parent_columns[i]]))));
    if (!ready.length) throw new Error(`Unsupported cyclic rows in ${name}`);
    batches.push(ready); inserted.push(...ready); const done = new Set(ready); remaining = remaining.filter((row) => !done.has(row));
  }
  return batches;
}
export async function restoreHouseholdArchive(input: { db: Database; encryptionKey: string; archiveKey: string; directory: string; store: ArchiveObjectStore; apply?: boolean }) {
  keyBytes(input.encryptionKey);
  const manifest = await decodeManifest(input.directory, input.archiveKey);
  const c = await catalog(input.db), allowed = allowedTables(c);
  if (manifest.version !== 1 || manifest.schema !== fingerprint(c)) throw new Error("Source and destination schemas must match exactly");
  if (Object.keys(manifest.rows).sort().join() !== allowed.join()) throw new Error("Archive table inventory does not match the portable schema");
  for (const [table, rows] of Object.entries(manifest.rows)) {
    const columns = c.columns.filter((col) => col.table === table).map((col) => col.name).sort().join();
    if (!Array.isArray(rows) || rows.some((row) => Object.keys(row).sort().join() !== columns)) throw new Error(`Invalid row schema: ${table}`);
    if (rows.some((row) => "household_id" in row && row.household_id !== manifest.householdId)) throw new Error("Foreign household data in archive");
  }
  if (manifest.rows.households.length !== 1 || manifest.rows.households[0].id !== manifest.householdId) throw new Error("Invalid household inventory");
  const expectedKeys = references(manifest.rows, manifest.householdId);
  if (JSON.stringify(manifest.files.map((f) => f.key).sort()) !== JSON.stringify(expectedKeys)) throw new Error("Archive file inventory is incomplete");
  validateReferences(manifest.rows, c);
  const rows = rekey(manifest.rows, input.archiveKey, input.encryptionKey) as Record<string, Row[]>;
  rows.households[0] = { ...rows.households[0], tier: "self_host", dedicated_db_ref: null, storage_quota_bytes: null, storage_used_bytes: manifest.files.reduce((n, f) => n + f.bytes, 0), drive_quota_warn_sent_at: null, telemetry_opt_in: false };
  for (const row of rows.calendar_events ?? []) Object.assign(row, { source: "local", sync_status: "synced", google_event_id: null, google_recurring_event_id: null, google_etag: null });
  const order = insertionOrder(rows, c);
  const batches = new Map(order.map((name) => [name, rowBatches(name, rows[name], c)]));
  const assertEmpty = async (tx: Database) => {
    // Full destination, including credentials and operational tables, must be empty.
    for (const t of c.tables) {
      const [record] = await tx.execute<{ found: boolean }>(sql`select exists(select 1 from ${identifier(t.name)} limit 1) as found`);
      if (record.found) throw new Error(`Destination database is not empty (${t.name}); restore refused`);
    }
  };
  await withSystemContext(input.db, assertEmpty);
  await input.store.assertEmpty(prefixes(manifest.householdId));
  for (const file of manifest.files) {
    const hash = createHash("sha256"); let bytes = 0;
    for await (const chunk of decryptedFile(input.directory, file, input.archiveKey)) { bytes += chunk.length; hash.update(chunk); }
    if (bytes !== file.bytes || hash.digest("hex") !== file.sha256) throw new Error("Archive file checksum mismatch");
  }
  if (input.apply) {
    await withSystemContext(input.db, (systemTx) => withHouseholdContext(systemTx, manifest.householdId, async (tx) => {
      // Exclusive table locks prevent concurrent setup/writes after the emptiness check.
      await tx.execute(sql`lock table ${sql.join(c.tables.map((t) => identifier(t.name)), sql`, `)} in exclusive mode`);
      await assertEmpty(tx);
      for (const file of manifest.files) await input.store.write(file.key, decryptedFile(input.directory, file, input.archiveKey), file.bytes, file.contentType);
      for (const name of order) {
        for (const ready of batches.get(name)!) {
          await tx.execute(sql`insert into ${identifier(name)} select * from jsonb_populate_recordset(null::${identifier(name)}, ${JSON.stringify(ready)}::jsonb)`);
        }
      }
    }));
  }
  return { applied: Boolean(input.apply), householdId: manifest.householdId, records: Object.values(rows).reduce((n, r) => n + r.length, 0), files: manifest.files.length, bytes: manifest.files.reduce((n, f) => n + f.bytes, 0) };
}
