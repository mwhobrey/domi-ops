export type HomePresence = "Home" | "Away";

export function normalizePresence(value: string | undefined | null): HomePresence {
  return value === "Home" ? "Home" : "Away";
}

export function normalizeStatusMessage(value: string | undefined | null): string | null {
  const msg = (value ?? "").trim().slice(0, 64);
  return msg || null;
}

export type HomeStatusRow = {
  presence: HomePresence;
  statusMessage: string | null;
};

export function serializeHomeStatus(row: HomeStatusRow): {
  presence: HomePresence;
  statusMessage: string | null;
} {
  return {
    presence: normalizePresence(row.presence),
    statusMessage: normalizeStatusMessage(row.statusMessage),
  };
}
