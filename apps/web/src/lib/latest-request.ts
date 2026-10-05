/**
 * "Only the newest request counts." Start a request with `next()`, and when it finishes apply its
 * result only if `isCurrent(id)` is still true. Overlapping loads (a filter changed while the last
 * one was in flight) can finish in any order, and an older answer must not replace a newer one.
 */
export function createLatestGate() {
  let latest = 0;
  return {
    next(): number {
      latest += 1;
      return latest;
    },
    isCurrent(id: number): boolean {
      return id === latest;
    },
    /** Make every request started so far obsolete (the owner is going away). */
    cancel(): void {
      latest += 1;
    },
  };
}
