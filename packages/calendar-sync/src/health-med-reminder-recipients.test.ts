import { describe, expect, it } from "vitest";
import { mergeHealthMedReminderRecipients } from "./health-med-reminder-recipients.js";

const subject = {
  memberId: "subj-1",
  userId: "user-subj",
  name: "Alex",
};

describe("mergeHealthMedReminderRecipients", () => {
  it("includes subject when push enabled", () => {
    const { recipients, subjectLabel } = mergeHealthMedReminderRecipients({
      subject,
      doseWriters: [],
      pushEnabledUserIds: new Set(["user-subj"]),
    });
    expect(subjectLabel).toBe("Alex");
    expect(recipients).toEqual([
      { userId: "user-subj", memberId: "subj-1", isSubject: true },
    ]);
  });

  it("includes doses:write grantee when push enabled", () => {
    const { recipients } = mergeHealthMedReminderRecipients({
      subject,
      doseWriters: [{ memberId: "admin-1", userId: "user-admin" }],
      pushEnabledUserIds: new Set(["user-subj", "user-admin"]),
    });
    expect(recipients).toHaveLength(2);
    expect(recipients).toContainEqual({
      userId: "user-admin",
      memberId: "admin-1",
      isSubject: false,
    });
  });

  it("excludes push-disabled users", () => {
    const { recipients } = mergeHealthMedReminderRecipients({
      subject,
      doseWriters: [{ memberId: "admin-1", userId: "user-admin" }],
      pushEnabledUserIds: new Set(["user-admin"]),
    });
    expect(recipients).toEqual([
      { userId: "user-admin", memberId: "admin-1", isSubject: false },
    ]);
  });

  it("returns empty when nobody has push enabled", () => {
    const { recipients } = mergeHealthMedReminderRecipients({
      subject,
      doseWriters: [{ memberId: "admin-1", userId: "user-admin" }],
      pushEnabledUserIds: new Set(),
    });
    expect(recipients).toEqual([]);
  });

  it("dedupes subject if also listed as dose writer", () => {
    const { recipients } = mergeHealthMedReminderRecipients({
      subject,
      doseWriters: [{ memberId: "subj-1", userId: "user-subj" }],
      pushEnabledUserIds: new Set(["user-subj"]),
    });
    expect(recipients).toEqual([
      { userId: "user-subj", memberId: "subj-1", isSubject: true },
    ]);
  });

  it("drops writers without userId", () => {
    const { recipients } = mergeHealthMedReminderRecipients({
      subject: { ...subject, userId: null },
      doseWriters: [{ memberId: "admin-1", userId: null }],
      pushEnabledUserIds: new Set(["user-admin"]),
    });
    expect(recipients).toEqual([]);
  });
});
