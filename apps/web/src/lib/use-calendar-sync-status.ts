"use client";

import { useCallback, useEffect, useState } from "react";
import { apiClient } from "./client-api";

export type CalendarSyncStatus = {
  connected: boolean;
  syncMode?: string;
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
      setStatus({ connected: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!pollWhenActive || !status?.run?.active) return;
    const t = setInterval(() => void refresh(), 2000);
    return () => clearInterval(t);
  }, [pollWhenActive, status?.run?.active, refresh]);

  return { status, loading, refresh, isActive: Boolean(status?.run?.active) };
}
