import type { AuthContext } from "@domi-ops/auth";
import { memberShownLabel } from "@domi-ops/auth";

/** Display name to attribute a newly-created record to (notice, chore, note, expense, shopping trip). */
export function posterLabel(auth: AuthContext): string {
  return memberShownLabel({ name: auth.name }) || auth.email || auth.username || "Member";
}
