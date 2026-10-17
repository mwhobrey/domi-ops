import { expect, it } from "vitest";
import { aggregateActivation } from "./hosted-activation.js";
it("suppresses small cohorts and exports only coarse counts", () => {
  const observation = { createdAt: new Date("2026-09-01Z"), schoolInSevenDays: true, healthInSevenDays: false, hasSecondMember: true, activeAfterThirtyDays: false, canceled: false };
  expect(aggregateActivation([observation])).toEqual([{ month: "2026-09", suppressed: true, households: null }]);
  expect(aggregateActivation(Array.from({ length: 5 }, () => observation))).toEqual([{ month: "2026-09", suppressed: false, households: 5, schoolWithin7Days: 5, healthWithin7Days: 0, secondActiveMember: 5, activeAfter30DaysSnapshot: 0, canceledSnapshot: 0 }]);
});
