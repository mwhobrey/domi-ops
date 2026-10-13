/**
 * Copy and state for the Withings panel (WHO-452/453). Pure, so the wording and the "what state is
 * this link in" decisions can be tested without rendering anything.
 */

export type WithingsLinkStatus = "active" | "revoked" | "error";

/** What `GET /api/health/withings` returns for one link. Never carries a token. */
export interface WithingsLink {
  memberId: string;
  status: WithingsLinkStatus;
  linkedAt: string;
  backfillFrom: string;
  backfillDone: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  syncPending: boolean;
}

export interface WithingsStatus {
  enabled: boolean;
  links: WithingsLink[];
}

export const WITHINGS_HISTORY_OPTIONS = [
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
  { days: 365, label: "Last year" },
  { days: 3650, label: "Everything Withings has (up to 10 years)" },
] as const;

export const WITHINGS_DEFAULT_HISTORY_DAYS = 365;

export type WithingsBadgeTone = "success" | "warning" | "accent" | "default";

export interface WithingsLinkState {
  label: string;
  tone: WithingsBadgeTone;
  /** The link is still catching up, so the panel should keep re-reading it. */
  settling: boolean;
}

/** The one-line state of a link: what the badge says and whether to keep polling. */
export function withingsLinkState(link: WithingsLink | null): WithingsLinkState {
  if (!link) return { label: "Not connected", tone: "default", settling: false };
  switch (link.status) {
    case "revoked":
      return { label: "Disconnected", tone: "warning", settling: false };
    case "error":
      return { label: "Needs attention", tone: "warning", settling: false };
    default:
      // History comes first: until it has been pulled once, "connected" would overstate it.
      if (!link.backfillDone) return { label: "Importing history…", tone: "accent", settling: true };
      if (link.syncPending) return { label: "Syncing…", tone: "accent", settling: true };
      return { label: "Connected", tone: "success", settling: false };
  }
}

export type WithingsNoticeVariant = "success" | "info" | "error";

export interface WithingsNotice {
  variant: WithingsNoticeVariant;
  message: string;
}

/**
 * What the Withings round trip reports. The API redirects back to `/health?withings=<result>`; any
 * result this does not know is shown as a generic failure rather than hidden.
 */
export function withingsResultNotice(result: string | undefined): WithingsNotice | null {
  if (!result) return null;
  switch (result) {
    case "connected":
      return {
        variant: "success",
        message: "Withings is connected. Importing the history now; it can take a minute, and new readings follow on their own.",
      };
    case "denied":
      return { variant: "info", message: "Withings access wasn't approved, so nothing was connected." };
    case "expired":
      return { variant: "error", message: "That Withings sign-in took too long and expired. Choose Connect Withings to start again." };
    case "forbidden":
      return { variant: "error", message: "You don't have permission to connect a cuff for that person." };
    case "already_linked":
      return { variant: "info", message: "That person is already connected to a Withings account." };
    case "unavailable":
      return { variant: "error", message: "Withings isn't set up on this server yet. Ask whoever runs it to add the Withings app credentials." };
    default:
      return { variant: "error", message: "Couldn't finish connecting to Withings. Try again, and if it keeps happening let whoever runs the server know." };
  }
}

/** A failed API call from the panel, in words. */
export function withingsActionError(status: number | null): string {
  switch (status) {
    case 403:
      return "You need permission to manage this person's health entries.";
    case 404:
      return "Withings isn't available for this person.";
    case 409:
      return "That person is already connected to a Withings account.";
    case 503:
      return "This server isn't fully set up for Withings (it needs an encryption key and Redis).";
    default:
      return "Something went wrong. Try again.";
  }
}
