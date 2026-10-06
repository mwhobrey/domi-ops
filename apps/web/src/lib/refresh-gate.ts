/**
 * Keeps a polling refresh from piling up requests (WHO-438). A tab switch fires both `focus` and
 * `visibilitychange`, a push fires the page event and the service worker message, and the timer
 * keeps going: the notice board then asked for the same two lists several times in a row.
 *
 * - **passive** triggers (the timer, focus, visibility) run only when nothing is in flight and the
 *   last run started at least `minGapMs` ago; otherwise they are dropped, since a run just happened.
 * - **explicit** triggers (mounting, a push, an event someone dispatched) always get a run: now when
 *   idle, or once more right after the one in flight when that one may predate what changed. Any
 *   number of them while busy collapse into that single follow-up.
 *
 * A failing refresh does not stop later ones.
 */
export function createRefreshGate(
  run: () => void | Promise<void>,
  options: { minGapMs: number; now?: () => number },
): { passive: () => void; explicit: () => void } {
  const now = options.now ?? Date.now;
  let inFlight = false;
  let again = false;
  let lastStart = Number.NEGATIVE_INFINITY;

  async function start(): Promise<void> {
    inFlight = true;
    lastStart = now();
    try {
      await run();
    } catch {
      // Polling is best-effort; the next trigger tries again.
    } finally {
      inFlight = false;
      if (again) {
        again = false;
        void start();
      }
    }
  }

  return {
    passive() {
      if (inFlight || now() - lastStart < options.minGapMs) return;
      void start();
    },
    explicit() {
      if (inFlight) again = true;
      else void start();
    },
  };
}
