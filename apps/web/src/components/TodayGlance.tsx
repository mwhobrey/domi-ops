"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiClient } from "../lib/client-api";
import { Card, CardBody, CardHeader, Skeleton } from "./ui";

export function TodayGlance() {
  const [loading, setLoading] = useState(true);
  const [shoppingOpen, setShoppingOpen] = useState(0);
  const [choresSummary, setChoresSummary] = useState("");
  const [eventsToday, setEventsToday] = useState<{ title: string; startTime: string | null }[]>([]);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    (async () => {
      try {
        const [shop, chores, cal] = await Promise.all([
          apiClient.get<{ items: { checked: boolean }[] }>("/api/core/shopping"),
          apiClient.get<{ chores: { done: boolean; dueDate: string | null }[] }>("/api/core/chores"),
          apiClient.get<{ events: { title: string; startTime: string | null }[] }>(
            `/api/calendar/events?from=${today}&to=${today}`,
          ),
        ]);
        setShoppingOpen(shop.items.filter((i) => !i.checked).length);
        const open = chores.chores.filter((c) => !c.done);
        const dueToday = open.filter((c) => c.dueDate === today).length;
        const overdue = open.filter((c) => c.dueDate && c.dueDate < today).length;
        if (open.length === 0) setChoresSummary("all done");
        else if (overdue > 0 && dueToday > 0)
          setChoresSummary(`${overdue} overdue, ${dueToday} due today`);
        else if (overdue > 0) setChoresSummary(`${overdue} overdue`);
        else if (dueToday > 0) setChoresSummary(`${dueToday} due today`);
        else setChoresSummary(`${open.length} open`);
        setEventsToday(cal.events.slice(0, 3));
      } catch {
        /* ignore widget errors */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const links = [
    { href: "/calendar", label: "Calendar" },
    { href: "/school", label: "School" },
    { href: "/shopping", label: "Shopping" },
  ];

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
          Today at a glance
        </h2>
      </CardHeader>
      <CardBody className="space-y-4">
        {loading ? (
          <>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </>
        ) : (
          <ul className="space-y-2 text-sm">
            <li>
              <Link href="/shopping" className="text-[var(--color-accent)] hover:underline">
                Shopping
              </Link>
              : {shoppingOpen} item{shoppingOpen === 1 ? "" : "s"} to buy
            </li>
            <li>
              <Link href="/chores" className="text-[var(--color-accent)] hover:underline">
                Chores
              </Link>
              : {choresSummary}
            </li>
            <li>
              <span className="text-[var(--color-text-muted)]">Calendar today:</span>
              {eventsToday.length === 0 ? (
                <span className="ml-1">nothing scheduled</span>
              ) : (
                <ul className="mt-1 list-inside list-disc">
                  {eventsToday.map((e, i) => (
                    <li key={i}>
                      {e.title}
                      {e.startTime ? ` · ${e.startTime}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          </ul>
        )}
        <div className="flex flex-wrap gap-2 border-t border-[var(--color-border)]/60 pt-4">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-[var(--color-border)]/30"
            >
              {l.label}
            </Link>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
