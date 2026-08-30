"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { apiClient } from "../lib/client-api";
import { Card, CardBody, CardHeader, Checkbox, IconButton, SectionHeader } from "./ui";

export type GlanceTileOption = { key: string; label: string };

function persist(tiles: string[] | null) {
  apiClient.patch("/api/core/glance-config", { tiles }).catch(() => {
    /* best-effort — worst case the next load falls back to the previous saved order */
  });
}

/**
 * Lets a member choose which "Today at a glance" dashboard tiles they see and in what order.
 * `available` is already filtered to modules actually enabled for this household — nothing
 * here can turn on a tile for a disabled module. No drag-and-drop library; a plain up/down
 * button list is one less dependency and works identically on touch and desktop.
 */
export function GlanceConfigCard({
  available,
  initialConfig,
}: {
  available: GlanceTileOption[];
  initialConfig: string[] | null;
}) {
  // Internal state is always a concrete ordered list — "no preference set" (null from the API)
  // just starts as every available tile in its default order, same set a null config renders
  // as on the dashboard today.
  const [order, setOrder] = useState<string[]>(() =>
    initialConfig && initialConfig.length > 0
      ? [...initialConfig.filter((k) => available.some((t) => t.key === k))]
      : available.map((t) => t.key),
  );
  const [hidden, setHidden] = useState<Set<string>>(() => {
    if (!initialConfig) return new Set();
    return new Set(available.map((t) => t.key).filter((k) => !initialConfig.includes(k)));
  });
  const [customized, setCustomized] = useState(initialConfig !== null);

  function save(nextOrder: string[], nextHidden: Set<string>) {
    setCustomized(true);
    persist(nextOrder.filter((k) => !nextHidden.has(k)));
  }

  function toggle(key: string) {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setHidden(next);
    save(order, next);
  }

  function move(key: string, dir: -1 | 1) {
    const i = order.indexOf(key);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
    save(next, hidden);
  }

  function reset() {
    const defaultOrder = available.map((t) => t.key);
    setOrder(defaultOrder);
    setHidden(new Set());
    setCustomized(false);
    persist(null);
  }

  const labelFor = (key: string) => available.find((t) => t.key === key)?.label ?? key;

  return (
    <Card>
      <CardHeader>
        <SectionHeader
          title="Dashboard tiles"
          action={
            customized ? (
              <button
                type="button"
                onClick={reset}
                className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:underline"
              >
                Reset to default
              </button>
            ) : undefined
          }
        />
      </CardHeader>
      <CardBody className="space-y-2">
        <p className="text-xs text-[var(--color-text-muted)]">
          Choose which "Today at a glance" tiles show on your dashboard, and in what order.
        </p>
        <ul className="space-y-1.5">
          {order.map((key, i) => (
            <li
              key={key}
              className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] px-3 py-2"
            >
              <Checkbox checked={!hidden.has(key)} onChange={() => toggle(key)} />
              <span className="min-w-0 flex-1 text-sm font-medium">{labelFor(key)}</span>
              <div className="flex items-center gap-1">
                <IconButton
                  label={`Move ${labelFor(key)} up`}
                  onClick={() => move(key, -1)}
                  disabled={i === 0}
                >
                  <ChevronUp className="h-4 w-4" />
                </IconButton>
                <IconButton
                  label={`Move ${labelFor(key)} down`}
                  onClick={() => move(key, 1)}
                  disabled={i === order.length - 1}
                >
                  <ChevronDown className="h-4 w-4" />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
