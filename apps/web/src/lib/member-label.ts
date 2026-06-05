/** Label shown on who's home, school roster, and other household UI. */
export function memberShownLabel(member: { name: string | null }): string {
  const name = member.name?.trim();
  if (name) return name.slice(0, 128);
  return "Member";
}
