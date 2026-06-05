import type { Database } from "@whome/db";
import { homeStatus } from "@whome/db";
import { and, eq } from "drizzle-orm";

export async function ensureHomeStatusRow(
  db: Database,
  householdId: string,
  memberId: string,
  label: string,
): Promise<void> {
  const [existing] = await db
    .select({ id: homeStatus.id })
    .from(homeStatus)
    .where(and(eq(homeStatus.householdId, householdId), eq(homeStatus.memberId, memberId)))
    .limit(1);
  if (existing) {
    await db
      .update(homeStatus)
      .set({ name: label.slice(0, 64), updatedAt: new Date() })
      .where(eq(homeStatus.id, existing.id));
    return;
  }
  await db.insert(homeStatus).values({
    householdId,
    memberId,
    name: label.slice(0, 64),
    presence: "Away",
  });
}
