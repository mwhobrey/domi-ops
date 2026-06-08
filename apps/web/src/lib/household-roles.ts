export type HouseholdRole = "owner" | "admin" | "member" | "child" | "guest";

export function canManageHousehold(role: HouseholdRole | string): boolean {
  return role === "owner" || role === "admin";
}
