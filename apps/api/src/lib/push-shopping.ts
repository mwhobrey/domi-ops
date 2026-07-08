import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { householdMembers, users } from "@domi-ops/db";
import { and, eq, inArray } from "drizzle-orm";
import { deliverUserNotification } from "@domi-ops/calendar-sync";

export async function notifyShoppingRecurringMaterialized(
  db: Database,
  env: Env,
  input: {
    householdId: string;
    itemNames: string[];
  },
): Promise<void> {
  if (input.itemNames.length === 0) return;

  const members = await db
    .select({ userId: householdMembers.userId })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, input.householdId));
  const memberUserIds = members.map((m) => m.userId);
  if (memberUserIds.length === 0) return;

  const enabled = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        inArray(users.id, memberUserIds),
        eq(users.pushShoppingRemindersEnabled, true),
      ),
    );
  const enabledIds = enabled.map((u) => u.id);
  if (enabledIds.length === 0) return;

  const count = input.itemNames.length;
  const preview =
    count === 1
      ? input.itemNames[0]!
      : `${input.itemNames.slice(0, 3).join(", ")}${count > 3 ? ` +${count - 3} more` : ""}`;

  await deliverUserNotification(db, env, {
    userIds: enabledIds,
    householdId: input.householdId,
    title: count === 1 ? "Recurring item added" : `${count} recurring items added`,
    body: preview,
    url: "/shopping",
    tag: `shopping-recurring-${input.householdId}-${Date.now()}`,
  });
}
