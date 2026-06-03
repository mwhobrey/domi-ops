export type MemberPublicLabel = "name" | "nickname";

export function memberShownLabel(member: {
  name: string | null;
  nickname: string | null;
  publicLabel: MemberPublicLabel;
}): string {
  if (member.publicLabel === "nickname") {
    const nick = member.nickname?.trim();
    if (nick) return nick.slice(0, 64);
  }
  const name = member.name?.trim();
  if (name) return name.slice(0, 128);
  const nick = member.nickname?.trim();
  if (nick) return nick.slice(0, 64);
  return "Member";
}
