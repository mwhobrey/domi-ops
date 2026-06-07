import { describe, expect, it } from "vitest";
import { parseHomeHubConfig } from "./homehub-config.js";
import { buildMemberDirectory } from "./member-directory.js";

const FIXTURE = `
instance_name: "Test Hub"
auth:
  allowed_emails:
    - parent@gmail.com
    - kid@gmail.com
  admin_emails:
    - parent@gmail.com
  display_names:
    parent@gmail.com: "Mike"
    kid@gmail.com: "Riley"
family_members:
  - Mike
  - Riley
school:
  teachers:
    - Mike
  students:
    - Riley
`;

describe("parseHomeHubConfig", () => {
  it("parses auth and school blocks", () => {
    const config = parseHomeHubConfig(FIXTURE);
    expect(config.instanceName).toBe("Test Hub");
    expect(config.displayNames.get("parent@gmail.com")).toBe("Mike");
    expect(config.schoolStudents).toEqual(["Riley"]);
  });

  it("parses inline bracket lists and object display_names", () => {
    const config = parseHomeHubConfig(`
auth:
  allowed_emails: [a@gmail.com, b@gmail.com]
  admin_emails: [a@gmail.com]
  display_names: { "a@gmail.com": "Mike", "b@gmail.com": "Riley" }
family_members: [Mike, Riley]
school:
  teachers: [Mike]
  students: [Riley]
`);
    expect(config.allowedEmails).toHaveLength(2);
    expect(config.displayNames.get("b@gmail.com")).toBe("Riley");
  });

  it("tolerates duplicate top-level keys like HomeHub Python loader", () => {
    const config = parseHomeHubConfig(`
auth:
  display_names:
    a@gmail.com: Mike
feature_toggles:
  calendar: false
feature_toggles:
  calendar: true
school:
  students: [Riley]
`);
    expect(config.displayNames.get("a@gmail.com")).toBe("Mike");
    expect(config.schoolStudents).toEqual(["Riley"]);
  });
});

describe("buildMemberDirectory", () => {
  it("assigns claim emails and child role for students", () => {
    const config = parseHomeHubConfig(FIXTURE);
    const directory = buildMemberDirectory(config);
    const riley = directory.get("riley");
    expect(riley?.role).toBe("child");
    expect(riley?.claimEmails.has("kid@gmail.com")).toBe(true);
    const mike = directory.get("mike");
    expect(mike?.role).toBe("owner");
    expect(mike?.claimEmails.has("parent@gmail.com")).toBe(true);
  });

  it("maps additional admin_emails to admin role", () => {
    const config = parseHomeHubConfig(`
auth:
  allowed_emails: [owner@gmail.com, admin@gmail.com, kid@gmail.com]
  admin_emails: [owner@gmail.com, admin@gmail.com]
  display_names:
    owner@gmail.com: Mike
    admin@gmail.com: Ally
    kid@gmail.com: Riley
school:
  students: [Riley]
`);
    const directory = buildMemberDirectory(config);
    expect(directory.get("mike")?.role).toBe("owner");
    expect(directory.get("ally")?.role).toBe("admin");
    expect(directory.get("riley")?.role).toBe("child");
  });
});
