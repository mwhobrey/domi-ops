import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { expenses, shoppingItems, shoppingRecurring, shoppingTripItems, shoppingTrips } from "@domi-ops/db";
import { and, eq } from "drizzle-orm";
import {
  buildShoppingReports,
  collectAisleSuggestions,
  materializeDueRecurring,
  normalizeRecurringInterval,
  parseShoppingTagsJson,
  serializeShoppingItem,
  serializeShoppingRecurring,
  serializeShoppingTagsJson,
  serializeShoppingTrip,
  shoppingReceiptObjectKey,
  isReceiptKeyForHousehold,
  todayIsoDate,
} from "../lib/shopping.js";
import { buildShoppingGlance } from "../lib/shopping-glance.js";
import { notifyShoppingRecurringMaterialized } from "../lib/push-shopping.js";
import { posterLabel } from "../lib/poster-label.js";
import {
  createS3Client,
  ensureS3ReadyOnce,
  getObjectBuffer,
  contentTypeFromKey,
} from "../lib/s3.js";
import { browserUploadPutUrl } from "../lib/upload-token.js";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";

export function shoppingRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", requireAuth(env));

  app.get("/shopping", async (c) => {
    const auth = c.get("auth")!;
    const { created, itemNames } = await materializeDueRecurring(db, auth.householdId);
    if (created > 0) {
      void notifyShoppingRecurringMaterialized(db, env, {
        householdId: auth.householdId,
        itemNames,
      }).catch(() => {
        /* best-effort */
      });
    }
    const rows = await db
      .select()
      .from(shoppingItems)
      .where(eq(shoppingItems.householdId, auth.householdId));
    return c.json({ items: rows.map(serializeShoppingItem) });
  });

  app.get("/shopping/glance", async (c) => {
    const auth = c.get("auth")!;
    const rows = await db
      .select({
        id: shoppingItems.id,
        item: shoppingItems.item,
        checked: shoppingItems.checked,
        quantity: shoppingItems.quantity,
        unit: shoppingItems.unit,
        tagsJson: shoppingItems.tagsJson,
      })
      .from(shoppingItems)
      .where(eq(shoppingItems.householdId, auth.householdId))
      .orderBy(shoppingItems.createdAt);
    const mapped = rows.map((row) => {
      const { aisle } = parseShoppingTagsJson(row.tagsJson);
      return {
        id: row.id,
        item: row.item,
        checked: row.checked,
        aisle,
        quantity: row.quantity ?? null,
        unit: row.unit ?? null,
      };
    });
    return c.json(buildShoppingGlance(mapped));
  });

  app.get("/shopping/suggestions", async (c) => {
    const auth = c.get("auth")!;
    const q = c.req.query("q")?.trim().toLowerCase() ?? "";
    const rows = await db
      .select({ item: shoppingItems.item })
      .from(shoppingItems)
      .where(eq(shoppingItems.householdId, auth.householdId));
    const seen = new Set<string>();
    const suggestions: string[] = [];
    for (const row of rows) {
      const name = row.item.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      if (q && !key.includes(q)) continue;
      seen.add(key);
      suggestions.push(name);
    }
    suggestions.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    return c.json({ suggestions: suggestions.slice(0, 25) });
  });

  app.get("/shopping/aisle-suggestions", async (c) => {
    const auth = c.get("auth")!;
    const q = c.req.query("q")?.trim() ?? "";
    const suggestions = await collectAisleSuggestions(db, auth.householdId, q);
    return c.json({ suggestions });
  });

  app.get("/shopping/recurring", async (c) => {
    const auth = c.get("auth")!;
    const rows = await db
      .select()
      .from(shoppingRecurring)
      .where(eq(shoppingRecurring.householdId, auth.householdId))
      .orderBy(shoppingRecurring.item);
    return c.json({ recurring: rows.map(serializeShoppingRecurring) });
  });

  app.post("/shopping/recurring", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{
      item: string;
      aisle?: string | null;
      tags?: string[];
      quantity?: number | null;
      unit?: string | null;
      notes?: string | null;
      interval?: string;
      nextAt?: string;
    }>();
    const item = body.item?.trim();
    if (!item) return c.json({ error: "item_required" }, 400);
    const interval = normalizeRecurringInterval(body.interval) ?? "weekly";
    const nextAt = body.nextAt?.trim() || todayIsoDate();
    const [row] = await db
      .insert(shoppingRecurring)
      .values({
        householdId: auth.householdId,
        item,
        tagsJson: serializeShoppingTagsJson(body.aisle, body.tags ?? []),
        quantity: body.quantity ?? null,
        unit: body.unit?.trim() || null,
        notes: body.notes?.trim() || null,
        interval,
        nextAt,
      })
      .returning();
    return c.json({ recurring: serializeShoppingRecurring(row) }, 201);
  });

  app.patch("/shopping/recurring/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const body = await c.req.json<{
      item?: string;
      aisle?: string | null;
      tags?: string[];
      quantity?: number | null;
      unit?: string | null;
      notes?: string | null;
      interval?: string;
      nextAt?: string;
      enabled?: boolean;
    }>();

    const [existing] = await db
      .select()
      .from(shoppingRecurring)
      .where(and(eq(shoppingRecurring.id, id), eq(shoppingRecurring.householdId, auth.householdId)))
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);

    const patch: Partial<typeof shoppingRecurring.$inferInsert> = {};
    if (body.item !== undefined) patch.item = body.item.trim();
    if (body.quantity !== undefined) patch.quantity = body.quantity;
    if (body.unit !== undefined) patch.unit = body.unit?.trim() || null;
    if (body.notes !== undefined) patch.notes = body.notes?.trim() || null;
    if (body.enabled !== undefined) patch.enabled = body.enabled;
    if (body.nextAt !== undefined) patch.nextAt = body.nextAt.trim();
    if (body.interval !== undefined) {
      const interval = normalizeRecurringInterval(body.interval);
      if (!interval) return c.json({ error: "invalid_interval" }, 400);
      patch.interval = interval;
    }
    if (body.aisle !== undefined || body.tags !== undefined) {
      const current = parseShoppingTagsJson(existing.tagsJson);
      patch.tagsJson = serializeShoppingTagsJson(
        body.aisle !== undefined ? body.aisle : current.aisle,
        body.tags ?? current.tags,
      );
    }

    const [row] = await db
      .update(shoppingRecurring)
      .set(patch)
      .where(and(eq(shoppingRecurring.id, id), eq(shoppingRecurring.householdId, auth.householdId)))
      .returning();
    return c.json({ ok: true, recurring: row ? serializeShoppingRecurring(row) : undefined });
  });

  app.delete("/shopping/recurring/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    await db
      .delete(shoppingRecurring)
      .where(and(eq(shoppingRecurring.id, id), eq(shoppingRecurring.householdId, auth.householdId)));
    return c.json({ ok: true });
  });

  app.get("/shopping/reports", async (c) => {
    const auth = c.get("auth")!;
    const to = c.req.query("to")?.trim() || todayIsoDate();
    const fromDefault = new Date(`${to}T12:00:00.000Z`);
    fromDefault.setUTCDate(fromDefault.getUTCDate() - 30);
    const from = c.req.query("from")?.trim() || fromDefault.toISOString().slice(0, 10);
    const report = await buildShoppingReports(db, auth.householdId, from, to);
    return c.json(report);
  });

  app.post("/shopping/receipt/presign", async (c) => {
    const auth = c.get("auth")!;
    if (!createS3Client(env) || !env.S3_BUCKET) {
      return c.json({ error: "s3_not_configured" }, 503);
    }
    const body = await c.req.json<{ filename: string; contentType?: string }>();
    if (!body.filename?.trim()) return c.json({ error: "filename_required" }, 400);
    try {
      await ensureS3ReadyOnce(env);
    } catch {
      return c.json({ error: "s3_not_configured" }, 503);
    }
    const key = shoppingReceiptObjectKey(auth.householdId, body.filename.trim());
    const contentType = body.contentType?.trim() || "application/octet-stream";
    const uploadId = randomUUID();
    const uploadUrl = browserUploadPutUrl(env, {
      uploadId,
      key,
      householdId: auth.householdId,
      memberId: auth.memberId,
      contentType,
      maxBytes: null,
    });
    return c.json({ uploadUrl, key });
  });

  app.get("/shopping/trips/:id/receipt", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const [trip] = await db
      .select()
      .from(shoppingTrips)
      .where(and(eq(shoppingTrips.id, id), eq(shoppingTrips.householdId, auth.householdId)))
      .limit(1);
    if (!trip?.receiptS3Key) return c.json({ error: "not_found" }, 404);
    const buf = await getObjectBuffer(env, trip.receiptS3Key);
    if (!buf) return c.json({ error: "not_found" }, 404);
    return new Response(buf, {
      headers: {
        "Content-Type": contentTypeFromKey(trip.receiptS3Key),
        "Cache-Control": "private, max-age=3600",
      },
    });
  });

  app.post("/shopping/clear", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{
      tripTotal?: number | null;
      receiptKey?: string | null;
      createExpense?: boolean;
      itemCosts?: Record<string, number>;
    }>();

    if (body.receiptKey && !isReceiptKeyForHousehold(auth.householdId, body.receiptKey)) {
      return c.json({ error: "invalid_receipt_key" }, 400);
    }

    const checkedRows = await db
      .select()
      .from(shoppingItems)
      .where(
        and(eq(shoppingItems.householdId, auth.householdId), eq(shoppingItems.checked, true)),
      );

    if (checkedRows.length === 0) {
      return c.json({ ok: true, deleted: 0, trip: null });
    }

    const itemCosts = body.itemCosts ?? {};
    let expenseId: string | null = null;

    const resolvedCosts = checkedRows.map((row) => {
      const fromBody = itemCosts[row.id];
      const cost =
        typeof fromBody === "number" && Number.isFinite(fromBody)
          ? fromBody
          : row.cost ?? null;
      return { row, cost };
    });

    const itemCostSum = resolvedCosts.reduce((sum, { cost }) => sum + (cost ?? 0), 0);
    const tripTotal =
      typeof body.tripTotal === "number" && Number.isFinite(body.tripTotal)
        ? body.tripTotal
        : itemCostSum > 0
          ? itemCostSum
          : null;

    if (body.createExpense && tripTotal != null && tripTotal > 0) {
      const [expense] = await db
        .insert(expenses)
        .values({
          householdId: auth.householdId,
          title: `Groceries (${checkedRows.length} items)`,
          amount: tripTotal,
          category: "Groceries",
          expenseDate: todayIsoDate(),
          createdByDisplayName: posterLabel(auth),
        })
        .returning({ id: expenses.id });
      expenseId = expense?.id ?? null;
    }

    const [trip] = await db
      .insert(shoppingTrips)
      .values({
        householdId: auth.householdId,
        tripTotal,
        receiptS3Key: body.receiptKey?.trim() || null,
        expenseId,
        itemCount: checkedRows.length,
        createdByDisplayName: posterLabel(auth),
      })
      .returning();

    if (trip) {
      await db.insert(shoppingTripItems).values(
        resolvedCosts.map(({ row, cost }) => ({
          tripId: trip.id,
          item: row.item,
          tagsJson: row.tagsJson,
          quantity: row.quantity,
          unit: row.unit,
          notes: row.notes,
          cost,
        })),
      );
    }

    const deleted = await db
      .delete(shoppingItems)
      .where(
        and(eq(shoppingItems.householdId, auth.householdId), eq(shoppingItems.checked, true)),
      )
      .returning({ id: shoppingItems.id });

    return c.json({
      ok: true,
      deleted: deleted.length,
      trip: trip ? serializeShoppingTrip(trip) : null,
      expenseId,
    });
  });

  app.delete("/shopping/checked", async (c) => {
    const auth = c.get("auth")!;
    const deleted = await db
      .delete(shoppingItems)
      .where(
        and(eq(shoppingItems.householdId, auth.householdId), eq(shoppingItems.checked, true)),
      )
      .returning({ id: shoppingItems.id });
    return c.json({ ok: true, deleted: deleted.length });
  });

  app.post("/shopping", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{
      item: string;
      aisle?: string | null;
      tags?: string[];
      quantity?: number | null;
      unit?: string | null;
      notes?: string | null;
    }>();
    const [row] = await db
      .insert(shoppingItems)
      .values({
        householdId: auth.householdId,
        item: body.item.trim(),
        tagsJson: serializeShoppingTagsJson(body.aisle, body.tags ?? []),
        quantity: body.quantity ?? null,
        unit: body.unit?.trim() || null,
        notes: body.notes?.trim() || null,
      })
      .returning();
    return c.json({ item: serializeShoppingItem(row) }, 201);
  });

  app.patch("/shopping/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const body = await c.req.json<{
      checked?: boolean;
      item?: string;
      aisle?: string | null;
      tags?: string[];
      quantity?: number | null;
      unit?: string | null;
      notes?: string | null;
      cost?: number | null;
    }>();

    const [existing] = await db
      .select()
      .from(shoppingItems)
      .where(and(eq(shoppingItems.id, id), eq(shoppingItems.householdId, auth.householdId)))
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);

    const patch: Partial<typeof shoppingItems.$inferInsert> = {};
    if (body.checked !== undefined) patch.checked = body.checked;
    if (body.item !== undefined) patch.item = body.item.trim();
    if (body.quantity !== undefined) patch.quantity = body.quantity;
    if (body.unit !== undefined) patch.unit = body.unit?.trim() || null;
    if (body.notes !== undefined) patch.notes = body.notes?.trim() || null;
    if (body.cost !== undefined) patch.cost = body.cost;
    if (body.aisle !== undefined || body.tags !== undefined) {
      const current = parseShoppingTagsJson(existing.tagsJson);
      patch.tagsJson = serializeShoppingTagsJson(
        body.aisle !== undefined ? body.aisle : current.aisle,
        body.tags ?? current.tags,
      );
    }

    const [row] = await db
      .update(shoppingItems)
      .set(patch)
      .where(and(eq(shoppingItems.id, id), eq(shoppingItems.householdId, auth.householdId)))
      .returning();
    return c.json({ ok: true, item: row ? serializeShoppingItem(row) : undefined });
  });

  app.delete("/shopping/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    await db
      .delete(shoppingItems)
      .where(and(eq(shoppingItems.id, id), eq(shoppingItems.householdId, auth.householdId)));
    return c.json({ ok: true });
  });

  return app;
}
