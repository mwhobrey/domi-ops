export type MarketingScreenshot = {
  priority: "p0" | "p1" | "p2";
  id: string;
  suffix: "desktop" | "mobile";
  width: number;
  height: number;
};

export const MARKETING_SCREENSHOTS = {
  heroCalendarWeek: {
    priority: "p0",
    id: "calendar-week",
    suffix: "desktop",
    width: 1280,
    height: 800,
  },
  heroCalendarWeekMobile: {
    priority: "p0",
    id: "calendar-week",
    suffix: "mobile",
    width: 390,
    height: 844,
  },
  dashboard: {
    priority: "p1",
    id: "dashboard",
    suffix: "desktop",
    width: 1280,
    height: 800,
  },
  school: {
    priority: "p1",
    id: "school",
    suffix: "desktop",
    width: 1280,
    height: 800,
  },
  schoolGradebook: {
    priority: "p1",
    id: "school-gradebook",
    suffix: "desktop",
    width: 1280,
    height: 800,
  },
  chores: {
    priority: "p2",
    id: "chores",
    suffix: "desktop",
    width: 1280,
    height: 800,
  },
  drive: {
    priority: "p2",
    id: "drive",
    suffix: "desktop",
    width: 1280,
    height: 800,
  },
} as const satisfies Record<string, MarketingScreenshot>;

export function marketingScreenshotPath(
  shot: MarketingScreenshot,
  theme: "light" | "dark",
): string {
  return `/marketing/screenshots/${shot.priority}-${shot.id}-${shot.suffix}-${shot.width}x${shot.height}-${theme}.png`;
}

export type MarketingUrls = {
  appLogin: string;
  demo?: string;
  github: string;
  setupDocs: string;
};

export const DEFAULT_MARKETING_URLS: MarketingUrls = {
  appLogin: "https://app.domi-ops.com/login",
  demo: "https://demo.domi-ops.com",
  github: "https://github.com/mwhobrey/domi-ops",
  setupDocs: "https://github.com/mwhobrey/domi-ops/blob/master/docs/SETUP.md",
};

export function resolveMarketingUrls(): MarketingUrls {
  const appBase =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "https://app.domi-ops.com";
  const demoBase = process.env.NEXT_PUBLIC_DEMO_URL?.replace(/\/$/, "") ?? "https://demo.domi-ops.com";
  return {
    appLogin: `${appBase}/login`,
    demo: demoBase,
    github: process.env.NEXT_PUBLIC_GITHUB_URL ?? DEFAULT_MARKETING_URLS.github,
    setupDocs: process.env.NEXT_PUBLIC_SETUP_DOCS_URL ?? DEFAULT_MARKETING_URLS.setupDocs,
  };
}
