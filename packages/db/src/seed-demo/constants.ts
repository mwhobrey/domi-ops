import { KNOWN_HOUSEHOLD_MODULES } from "@domi-ops/config";

export const DEMO_SLUG = "rivera-demo";
export const DEMO_HOUSEHOLD_NAME = "Rivera Family";
export const DEMO_OWNER_EMAIL = (process.env.DEMO_OWNER_EMAIL ?? "demo@domi-ops.com").toLowerCase();

export const DEMO_MODULES = [...KNOWN_HOUSEHOLD_MODULES];

export const DEMO_MEMBER_PASSWORD_DEFAULT = "DemoRivera2026!";

export type DemoMemberSpec = {
  key: "maria" | "james" | "sofia" | "lucas";
  displayName: string;
  role: "owner" | "admin" | "child";
  email?: string;
  username?: string;
  presence: "Home" | "Away";
};

export const DEMO_MEMBERS: DemoMemberSpec[] = [
  {
    key: "maria",
    displayName: "Maria Rivera",
    role: "owner",
    email: DEMO_OWNER_EMAIL,
    presence: "Home",
  },
  {
    key: "james",
    displayName: "James Rivera",
    role: "admin",
    username: "james",
    presence: "Away",
  },
  {
    key: "sofia",
    displayName: "Sofia Rivera",
    role: "child",
    username: "sofia",
    presence: "Home",
  },
  {
    key: "lucas",
    displayName: "Lucas Rivera",
    role: "child",
    username: "lucas",
    presence: "Home",
  },
];
