"use client";

import { useCallback, useEffect, useState } from "react";
import { apiClient } from "./client-api";

export type CalendarSyncStatus = {
  connected: boolean;
  syncMode?: string;
  pendingExports?: number;
  lastSyncAt?: string | null;
  run?: {
    status: string;
    progress: { done: number; total: number; current?: string } | null;
    error: string | null;
    active: boolean;
  };
  linked?: {
    id: string;
    summary: string | null;
    syncEnabled: boolean;
    lastSyncAt: string | null;
    lastSyncError: string | null;
  }[];
};

export function useCalendarSyncStatus(pollWhenActive = true) {
  const [status, setStatus] = useState<CalendarSyncStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await apiClient.get<CalendarSyncStatus>("/api/calendar/sync/status");
      setStatus(data);
    } catch {
      // Keep the connection and polling alive across a temporary network failure.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!pollWhenActive) return;
    const interval = status?.run?.active || status?.pendingExports ? 2000 : 10_000;
    const t = setInterval(() => void refresh(), interval);
    return () => clearInterval(t);
  }, [pollWhenActive, status?.run?.active, status?.pendingExports, refresh]);

  return { status, loading, refresh, isActive: Boolean(status?.run?.active) };
}
