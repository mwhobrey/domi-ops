import type { ChoreReportsData } from "../chores-karma.js";
import type { ExpenseReport } from "../expenses.js";
import type { WeeklyReportData } from "../weekly-reports/types.js";
import type { SchoolReportsData } from "../school-reports.js";
import type { CanonicalReport, CanonicalReportSection, ReportKind, ReportModule } from "./types.js";
import { REPORT_KIND_LABELS, REPORT_MODULE_LABELS } from "./types.js";

function formatMoney(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function weeklyToCanonical(report: WeeklyReportData): CanonicalReport {
  return {
    title: report.title,
    module: report.module,
    kind: "weekly",
    generatedAt: new Date().toISOString(),
    timezone: report.timezone,
    sections: [
      {
        key: "schedule",
        label: report.weekLabel,
        groups: report.groups,
        emptyMessage:
          report.totalItems === 0 ? "Nothing scheduled this week (Mon–Fri)." : undefined,
      },
    ],
  };
}

export function weeklyRangeToCanonical(
  reports: WeeklyReportData[],
  combinedTitle: string,
  module: ReportModule,
): CanonicalReport {
  if (reports.length <= 1 && reports[0]) {
    return weeklyToCanonical(reports[0]);
  }
  return {
    title: combinedTitle,
    module,
    kind: "weekly",
    generatedAt: new Date().toISOString(),
    timezone: reports[0]?.timezone,
    multiPart: true,
    parts: reports.map((r) => weeklyToCanonical(r)),
    sections: reports.map((r) => ({
      key: r.weekStart,
      label: `Week of ${r.weekLabel}`,
      groups: r.groups,
      emptyMessage: r.totalItems === 0 ? "Nothing scheduled this week." : undefined,
    })),
  };
}

type HealthReportData = Awaited<ReturnType<typeof import("../health-reports.js").buildHealthReports>>;

export function healthOverviewToCanonical(data: HealthReportData): CanonicalReport {
  const sections: CanonicalReportSection[] = [
    {
      key: "summary",
      label: "Clinical summary",
      stats: [
        { label: "Health events", value: String(data.summary.totalEvents) },
        { label: "Ongoing now", value: String(data.summary.ongoingCount) },
      ],
    },
  ];

  if (data.eventsByType.length > 0) {
    sections.push({
      key: "events-by-type",
      label: "Events by type",
      tables: [
        {
          key: "events-by-type",
          label: "Events by type",
          columns: ["Type", "Count"],
          rows: data.eventsByType.map((r) => [r.label, r.count]),
        },
      ],
    });
  }

  if (data.eventsByMember.length > 0) {
    sections.push({
      key: "events-by-member",
      label: "Events by member",
      tables: [
        {
          key: "events-by-member",
          label: "Events by member",
          columns: ["Member", "Count"],
          rows: data.eventsByMember.map((r) => [r.label, r.count]),
        },
      ],
    });
  }

  appendEventHistorySections(data, sections);

  return {
    title: `Health events — ${data.from} to ${data.to}`,
    module: "health",
    kind: "overview",
    generatedAt: new Date().toISOString(),
    timezone: data.timezone,
    sections,
  };
}

function formatIsoDateTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace("T", " ");
  if (!timeZone) return d.toISOString().slice(0, 16).replace("T", " ");
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ");
  }
}

function appendEventHistorySections(data: HealthReportData, sections: CanonicalReportSection[]) {
  const eventHistory = data.eventHistory ?? data.recentEvents ?? [];
  const eventGroups =
    data.eventGroups && data.eventGroups.length > 0
      ? data.eventGroups
      : eventHistory.length > 0
        ? [{ key: "all", label: "All events", events: eventHistory }]
        : [];

  if (eventGroups.length === 0) return;

  const groupLabel =
    data.groupBy === "eventType"
      ? "Event history by type"
      : data.groupBy === "none"
        ? "Event history"
        : "Event history by date";
  sections.push({
    key: "event-history",
    label: groupLabel,
    tables: eventGroups.map((group) => ({
      key: `event-history-${group.key}`,
      label: group.label,
      columns: ["When", "Event", "Type", "Member", "Ongoing"],
      rows: group.events.map((r) => [
        r.startedAtLabel || formatIsoDateTime(r.startedAt, data.timezone),
        r.title,
        r.typeLabel,
        r.memberLabel,
        r.ongoing ? "Yes" : "No",
      ]),
    })),
  });
}

function appendMedicationSections(data: HealthReportData, sections: CanonicalReportSection[]) {
  if (data.medicationAdherence.length > 0) {
    sections.push({
      key: "medication-adherence",
      label: "Medication adherence",
      tables: [
        {
          key: "medication-adherence",
          label: "Medication adherence",
          columns: [
            "Medication",
            "Member",
            "Kind",
            "Expected",
            "Taken",
            "Skipped",
            "Missed",
            "Pending",
            "PRN",
            "Adherence %",
          ],
          rows: data.medicationAdherence.map((r) => [
            r.name,
            r.memberLabel,
            r.scheduleKind,
            r.expected ?? r.scheduledTotal,
            r.taken,
            r.skipped,
            r.missed,
            r.pending ?? 0,
            r.prn,
            r.adherencePct != null ? `${r.adherencePct}%` : "—",
          ]),
        },
      ],
    });
  }

  if (data.prnFrequency && data.prnFrequency.length > 0) {
    sections.push({
      key: "prn-frequency",
      label: "PRN frequency by day",
      tables: [
        {
          key: "prn-frequency",
          label: "PRN frequency by day",
          columns: ["Date", "Member", "Doses"],
          rows: data.prnFrequency.map((r) => [r.date, r.memberLabel, r.count]),
        },
      ],
    });
  }

  if (data.medicationLogHistory && data.medicationLogHistory.length > 0) {
    sections.push({
      key: "medication-log-history",
      label: "Medication log history",
      tables: [
        {
          key: "medication-log-history",
          label: "Medication log history",
          columns: ["When logged", "Scheduled", "Medication", "Member", "Status"],
          rows: data.medicationLogHistory.map((r) => [
            r.loggedAtLabel || formatIsoDateTime(r.loggedAt, data.timezone),
            r.scheduledAtLabel || (r.scheduledAt ? formatIsoDateTime(r.scheduledAt, data.timezone) : "—"),
            r.medicationName,
            r.memberLabel,
            r.prn ? `${r.status} (PRN)` : r.status,
          ]),
        },
      ],
    });
  }
}

export function healthMedicationsToCanonical(data: HealthReportData): CanonicalReport {
  const sections: CanonicalReportSection[] = [
    {
      key: "summary",
      label: "Medication summary",
      stats: [
        { label: "Active medications", value: String(data.summary.activeMedications) },
        { label: "Scheduled", value: String(data.summary.scheduledMedications) },
        { label: "Interval", value: String(data.summary.intervalMedications ?? 0) },
        { label: "PRN", value: String(data.summary.prnMedications) },
        { label: "Doses logged", value: String(data.summary.dosesLogged) },
      ],
    },
  ];
  appendMedicationSections(data, sections);
  return {
    title: `Dose history — ${data.from} to ${data.to}`,
    module: "health",
    kind: "medications",
    generatedAt: new Date().toISOString(),
    timezone: data.timezone,
    sections,
  };
}

export function healthTodayToCanonical(data: HealthReportData): CanonicalReport {
  const date = data.todayDoseDate ?? data.to;
  const rows = data.todayDoses ?? [];
  const taken = rows.filter((r) => r.status === "taken" || r.status === "prn").length;
  const skipped = rows.filter((r) => r.status === "skipped").length;
  const missed = rows.filter((r) => r.status === "missed").length;
  const pending = rows.filter((r) => r.status === "pending").length;
  return {
    title: `Today's doses — ${date}`,
    module: "health",
    kind: "medications-today",
    generatedAt: new Date().toISOString(),
    timezone: data.timezone,
    sections: [
      {
        key: "summary",
        label: "Today",
        stats: [
          { label: "Taken", value: String(taken) },
          { label: "Skipped", value: String(skipped) },
          { label: "Missed", value: String(missed) },
          { label: "Pending", value: String(pending) },
        ],
      },
      {
        key: "today-doses",
        label: "Doses",
        tables: [
          {
            key: "today-doses",
            label: "Doses",
            columns: ["When", "Logged", "Member", "Medication", "Dosage", "Status"],
            rows: rows.map((r) => [
              r.scheduledAtLabel,
              r.loggedAtLabel ?? "—",
              r.memberLabel,
              r.medicationName,
              r.dosage ?? "—",
              r.statusLabel,
            ]),
          },
        ],
        emptyMessage: rows.length === 0 ? "No doses scheduled or logged today." : undefined,
      },
    ],
  };
}

export function healthMedicationListToCanonical(data: HealthReportData): CanonicalReport {
  const meds = (data.medications ?? []).filter((m) => m.enabled);
  return {
    title: "Current medications",
    module: "health",
    kind: "medication-list",
    generatedAt: new Date().toISOString(),
    timezone: data.timezone,
    sections: [
      {
        key: "medication-list",
        label: "Medication list",
        tables: [
          {
            key: "medication-list",
            label: "Current medications",
            columns: ["Member", "Medication", "Dosage", "Schedule", "Instructions"],
            rows: meds.map((m) => [
              m.memberLabel,
              m.name,
              m.dosage ?? "—",
              m.scheduleSummary ?? m.scheduleKind,
              m.instructions ?? "—",
            ]),
          },
        ],
        emptyMessage: meds.length === 0 ? "No active medications." : undefined,
      },
    ],
  };
}

export function choresOverviewToCanonical(data: ChoreReportsData): CanonicalReport {
  const sections: CanonicalReportSection[] = [
    {
      key: "summary",
      label: "Summary",
      stats: [
        { label: "Completions", value: String(data.summary.totalCompletions) },
        {
          label: "On time",
          value: String(data.summary.onTimeCount + data.summary.earlyCount),
        },
        { label: "Redemption quests", value: String(data.summary.redemptionCount) },
        {
          label: "Avg days late",
          value: data.summary.avgDaysLate != null ? String(data.summary.avgDaysLate) : "—",
        },
      ],
    },
  ];

  if (data.byMember.length > 0) {
    sections.push({
      key: "by-member",
      label: "By person",
      tables: [
        {
          key: "by-member",
          label: "Completions by person",
          columns: ["Person", "Done", "On time", "Early", "Redemption", "Avg late (days)", "Karma"],
          rows: data.byMember.map((m) => [
            m.label,
            m.totalCompletions,
            m.onTimeCount,
            m.earlyCount,
            m.redemptionCount,
            m.avgDaysLate ?? "—",
            m.karmaEarned,
          ]),
        },
      ],
    });
  }

  return {
    title: `Chore completion report — ${data.from} to ${data.to}`,
    module: "chores",
    kind: "overview",
    generatedAt: new Date().toISOString(),
    sections,
  };
}

type ShoppingReportData = Awaited<ReturnType<typeof import("../shopping.js").buildShoppingReports>>;

export function shoppingOverviewToCanonical(data: ShoppingReportData): CanonicalReport {
  const sections: CanonicalReportSection[] = [
    {
      key: "summary",
      label: "Summary",
      stats: [
        { label: "Total spend", value: formatMoney(data.totalSpend) },
        { label: "Trips", value: String(data.tripCount) },
      ],
    },
  ];

  if (data.topItems.length > 0) {
    sections.push({
      key: "top-items",
      label: "Top items",
      tables: [
        {
          key: "top-items",
          label: "Top items",
          columns: ["Item", "Count"],
          rows: data.topItems.map((r) => [r.item, r.count]),
        },
      ],
    });
  }

  if (data.trips.length > 0) {
    sections.push({
      key: "trips",
      label: "Trip history",
      tables: [
        {
          key: "trips",
          label: "Trips",
          columns: ["Date", "Items", "Total", "Receipt"],
          rows: data.trips.map((t) => {
            const cleared =
              typeof t.clearedAt === "string"
                ? t.clearedAt
                : t.clearedAt.toISOString();
            return [
              cleared.slice(0, 10),
              t.itemCount,
              t.tripTotal != null ? formatMoney(t.tripTotal) : "—",
              t.hasReceipt ? "Yes" : "No",
            ];
          }),
        },
      ],
    });
  }

  return {
    title: `Shopping report — ${data.from} to ${data.to}`,
    module: "shopping",
    kind: "overview",
    generatedAt: new Date().toISOString(),
    sections,
  };
}

export function expensesOverviewToCanonical(data: ExpenseReport): CanonicalReport {
  const sections: CanonicalReportSection[] = [
    {
      key: "summary",
      label: "Summary",
      stats: [
        { label: "Spent this month", value: formatMoney(data.monthSpend) },
        {
          label: "Targets set",
          value: data.monthBudgeted > 0 ? formatMoney(data.monthBudgeted) : "—",
        },
        {
          label: "Of targets used",
          value: data.percentUsed != null ? `${data.percentUsed}%` : "—",
        },
        { label: "Expenses logged", value: String(data.expenseCount) },
      ],
    },
  ];

  if (data.byCategory.length > 0) {
    sections.push({
      key: "by-category",
      label: "By category",
      tables: [
        {
          key: "by-category",
          label: "By category",
          columns: ["Category", "Spent", "Target", "% used", "Status"],
          rows: data.byCategory.map((r) => [
            r.category,
            formatMoney(r.spend),
            r.monthlyTarget != null ? formatMoney(r.monthlyTarget) : "—",
            r.percentUsed != null ? `${r.percentUsed}%` : "—",
            r.status,
          ]),
        },
      ],
    });
  }

  if (data.recentBigSpends.length > 0) {
    sections.push({
      key: "big-spends",
      label: "Biggest purchases",
      tables: [
        {
          key: "big-spends",
          label: "Biggest purchases",
          columns: ["What", "Date", "Amount", "Category"],
          rows: data.recentBigSpends.map((r) => [
            r.title,
            r.expenseDate,
            formatMoney(r.amount),
            r.category ?? "—",
          ]),
        },
      ],
    });
  }

  return {
    title: `Spending report — ${formatMonthLabel(data.month)}`,
    module: "expenses",
    kind: "overview",
    generatedAt: new Date().toISOString(),
    sections,
  };
}

export function schoolGradesToCanonical(data: SchoolReportsData): CanonicalReport {
  return {
    title: `Grade summary${data.selectedTerm ? ` — ${data.selectedTerm}` : ""}`,
    module: "school",
    kind: "school-grades",
    generatedAt: new Date().toISOString(),
    sections: [
      {
        key: "summary",
        label: "Household summary",
        stats: [
          { label: "Classes", value: String(data.summary.classCount) },
          { label: "Students", value: String(data.summary.studentCount) },
          {
            label: "Weighted avg",
            value:
              data.summary.householdWeightedAveragePercent != null
                ? `${data.summary.householdWeightedAveragePercent}%`
                : "—",
          },
          {
            label: "Open items",
            value: String(data.summary.missingTotal + data.summary.overdueTotal),
          },
        ],
      },
      {
        key: "classes",
        label: "By class",
        tables: [
          {
            key: "classes",
            label: "Classes",
            columns: [
              "Class",
              "Term",
              "Subject",
              "Students",
              "Assignments",
              "Average",
              "Weighted avg",
              "Missing",
              "Overdue",
            ],
            rows: data.classes.map((r) => [
              r.className,
              r.term ?? "—",
              r.subject ?? "—",
              r.studentCount,
              r.assignmentCount,
              r.classAveragePercent != null ? `${r.classAveragePercent}%` : "—",
              r.weightedClassAveragePercent != null ? `${r.weightedClassAveragePercent}%` : "—",
              r.missingTotal,
              r.overdueTotal,
            ]),
          },
        ],
      },
    ],
  };
}

export function schoolOpenWorkToCanonical(data: SchoolReportsData): CanonicalReport {
  return {
    title: `Open work digest${data.selectedTerm ? ` — ${data.selectedTerm}` : ""}`,
    module: "school",
    kind: "school-open-work",
    generatedAt: new Date().toISOString(),
    sections: [
      {
        key: "open-work",
        label: "Open work",
        tables: [
          {
            key: "open-work",
            label: "Open work",
            columns: ["Student", "Class", "Assignment", "Status", "Due"],
            rows: data.missingDigest.map((r) => [
              r.studentLabel,
              r.className,
              r.assignmentTitle,
              r.status,
              r.dueAt ? new Date(r.dueAt).toLocaleDateString() : "—",
            ]),
          },
        ],
        emptyMessage:
          data.missingDigest.length === 0 ? "No open work — nice work!" : undefined,
      },
    ],
  };
}

export function schoolTranscriptToCanonical(
  data: SchoolReportsData,
  studentMemberId?: string,
): CanonicalReport {
  const student =
    data.transcripts.find((t) => t.memberId === studentMemberId) ?? data.transcripts[0];
  if (!student) {
    return {
      title: "Transcript",
      module: "school",
      kind: "school-transcript",
      generatedAt: new Date().toISOString(),
      sections: [{ key: "empty", label: "Transcript", emptyMessage: "No transcript data." }],
    };
  }

  const rows: (string | number | null)[][] = [];
  for (const cls of student.classes) {
    for (const a of cls.assignments) {
      rows.push([
        cls.className,
        cls.term ?? "—",
        a.title,
        a.categoryName ?? "—",
        a.score ?? "—",
        a.pointsPossible,
        a.percent != null ? `${a.percent}%` : "—",
        a.status,
      ]);
    }
  }

  return {
    title: `Transcript — ${student.label}`,
    module: "school",
    kind: "school-transcript",
    generatedAt: new Date().toISOString(),
    sections: [
      {
        key: "summary",
        label: "Summary",
        stats: [
          { label: "Student", value: student.label },
          {
            label: "Overall average",
            value: student.averagePercent != null ? `${student.averagePercent}%` : "—",
          },
          {
            label: "Weighted average",
            value:
              student.weightedAveragePercent != null
                ? `${student.weightedAveragePercent}%`
                : "—",
          },
        ],
      },
      {
        key: "assignments",
        label: "Assignments",
        tables: [
          {
            key: "assignments",
            label: "Assignments",
            columns: ["Class", "Term", "Assignment", "Category", "Score", "Points", "%", "Status"],
            rows,
          },
        ],
      },
    ],
  };
}

export function canonicalTitle(module: ReportModule, kind: ReportKind): string {
  return `${REPORT_MODULE_LABELS[module]} — ${REPORT_KIND_LABELS[kind]}`;
}
