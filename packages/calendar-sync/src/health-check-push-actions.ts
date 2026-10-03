import type { Env } from "@domi-ops/config";
import { healthMedPushActionSecret, mintHealthCheckPushActionToken } from "@domi-ops/crypto";

/**
 * Buttons on a health check reminder (WHO-388). A check needs values, so "Log now" cannot be one
 * tap: it opens the app at the slot, the same as tapping the notification, and exists so the
 * primary action is visible on platforms that show buttons. "Skip" is the one thing a button can
 * do on its own; the service worker posts the signed token to `/api/health/checks/push-action`.
 * iOS web apps get no buttons and use the deep link, where the log sheet has its own Skip.
 */
export const CHECK_PUSH_ACTIONS = [
  { action: "log", title: "Log now" },
  { action: "skip", title: "Skip" },
] as const;

/**
 * The `actions` and `data` to attach to a check reminder's push, or nothing when no token can be
 * signed (no secret configured): a lone "Log now" button would only duplicate tapping the body.
 *
 * The token is bound to the recipient and the slot, and only ever allows a skip. It travels in the
 * push payload and never in a URL, so it does not end up in history or logs. `timeZone` is the
 * device's, which decided what instant the slot is, and is echoed back so the server reads the
 * schedule the same way.
 */
export function checkReminderPushExtras(
  env: Pick<Env, "ENCRYPTION_KEY" | "SESSION_SECRET">,
  input: { householdId: string; userId: string; checkId: string; scheduledAt: Date; timeZone: string },
):
  | { actions: (typeof CHECK_PUSH_ACTIONS)[number][]; data: { checkId: string; scheduledAt: string; timeZone: string; token: string } }
  | Record<string, never> {
  const secret = healthMedPushActionSecret(env);
  if (!secret) return {};
  try {
    const token = mintHealthCheckPushActionToken(
      {
        householdId: input.householdId,
        userId: input.userId,
        checkId: input.checkId,
        scheduledAt: input.scheduledAt.toISOString(),
      },
      secret,
    );
    return {
      actions: [...CHECK_PUSH_ACTIONS],
      data: {
        checkId: input.checkId,
        scheduledAt: input.scheduledAt.toISOString(),
        timeZone: input.timeZone,
        token,
      },
    };
  } catch {
    return {};
  }
}
