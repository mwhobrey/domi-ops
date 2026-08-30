import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";

/**
 * Per-checklist-item guided walkthroughs (OnboardingChecklist.tsx) — spotlight cards pointing at
 * the actual settings/UI a step is about, instead of just linking there and leaving the person
 * to find it themselves. Each tour's steps target elements marked with a matching
 * data-tour="..." attribute on the page it lives on.
 *
 * Not every checklist step has a tour: "install" (Add to Home Screen) is an OS/browser action,
 * not something in our own UI to spotlight, and the member-role steps ("profile", "explore")
 * are left as plain navigation for now — this pass covers the owner setup flow, the one every
 * household actually goes through once.
 */
export type TourKey = "household-basics" | "modules" | "invite" | "calendar" | "notifications";

type TourDef = { path: string; steps: DriveStep[] };

const TOURS: Record<TourKey, TourDef> = {
  "household-basics": {
    path: "/settings",
    steps: [
      {
        element: '[data-tour="household-name"]',
        popover: {
          title: "Household name",
          description: "Shows up across the dashboard, calendar, and reports.",
        },
      },
      {
        element: '[data-tour="household-timezone"]',
        popover: {
          title: "Timezone",
          description:
            "Get this wrong and every reminder silently fires at the wrong time. Set it once, forget it.",
        },
      },
    ],
  },
  modules: {
    path: "/settings",
    steps: [
      {
        element: '[data-tour="modules-section"]',
        popover: {
          title: "Pick your modules",
          description: "Turn off what you won't use — fewer tabs in the nav for everyone.",
        },
      },
    ],
  },
  invite: {
    path: "/settings",
    steps: [
      {
        element: '[data-tour="invite-section"]',
        popover: {
          title: "Bring in your household",
          description:
            "Adults sign in with email or Google on their own. Kids or anyone without email get a username-only login you set up right here.",
        },
      },
    ],
  },
  calendar: {
    path: "/calendar",
    steps: [
      {
        element: '[data-tour="new-event-button"]',
        popover: {
          title: "Add an event",
          description:
            "Start here — no Google account needed. Connect Google later from your profile for two-way sync.",
        },
      },
    ],
  },
  notifications: {
    path: "/profile",
    steps: [
      {
        element: '[data-tour="notifications-section"]',
        popover: {
          title: "Notifications",
          description: "Nobody gets push alerts by default. Turn on just what's relevant to you.",
        },
      },
    ],
  },
};

const PENDING_KEY = "domi-ops-pending-tour";

function runTour(key: TourKey) {
  const def = TOURS[key];
  const missing = def.steps.some((s) => !document.querySelector(s.element as string));
  if (missing) return; // module off, or the page hasn't finished rendering — fail quiet, no crash
  driver({ showProgress: def.steps.length > 1, steps: def.steps }).drive();
}

/** Called from a checklist item's click handler. Runs immediately if already on the right page,
 *  otherwise navigates there and lets runPendingTourIfAny pick it up once that page mounts. */
export function launchTour(key: TourKey, router: { push: (href: string) => void }) {
  const def = TOURS[key];
  if (!def) return;
  if (window.location.pathname === def.path) {
    runTour(key);
  } else {
    sessionStorage.setItem(PENDING_KEY, key);
    router.push(def.path);
  }
}

/** Call on mount from any page a tour can land on (Settings, Calendar, Profile). No-ops
 *  immediately for every other page and every normal page load that isn't mid-tour-navigation. */
export function runPendingTourIfAny(currentPath: string) {
  const pending = sessionStorage.getItem(PENDING_KEY) as TourKey | null;
  if (!pending || !(pending in TOURS)) return;
  if (TOURS[pending].path !== currentPath) return;
  sessionStorage.removeItem(PENDING_KEY);
  // One tick past mount isn't always enough for client data (e.g. household settings fetch) to
  // have rendered the target element yet — a short delay is cheaper and simpler than wiring a
  // MutationObserver for what's a one-off, low-stakes UI nicety.
  setTimeout(() => runTour(pending), 400);
}
