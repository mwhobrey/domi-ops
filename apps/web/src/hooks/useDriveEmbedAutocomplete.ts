"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import {
  applyDriveEmbedSelection,
  findDriveEmbedTrigger,
  type DriveEmbedTrigger,
} from "../lib/drive-embed-autocomplete";
import type { DriveObject } from "../lib/drive-types";

function sortObjects(list: DriveObject[]): DriveObject[] {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

export function useDriveEmbedAutocomplete({
  enabled,
  value,
  onChange,
  getCursor,
  setCursor,
  onAnchorChange,
}: {
  enabled: boolean;
  value: string;
  onChange: (value: string) => void;
  getCursor: () => number;
  setCursor: (pos: number) => void;
  onAnchorChange?: (anchor: { top: number; left: number; height: number } | null) => void;
}) {
  const [trigger, setTrigger] = useState<DriveEmbedTrigger | null>(null);
  const [objects, setObjects] = useState<DriveObject[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const fetchGen = useRef(0);

  const syncTrigger = useCallback(() => {
    if (!enabled) {
      setTrigger(null);
      return null;
    }
    const cursor = getCursor();
    const found = findDriveEmbedTrigger(value, cursor);
    setTrigger(found);
    if (!found) {
      setActiveIndex(0);
      onAnchorChange?.(null);
    }
    return found;
  }, [enabled, value, getCursor, onAnchorChange]);

  useEffect(() => {
    if (!trigger) {
      setObjects([]);
      setLoading(false);
      return;
    }

    const generation = ++fetchGen.current;
    const timer = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams();
      if (trigger.searchQuery.trim()) params.set("q", trigger.searchQuery.trim());
      const qs = params.toString();
      void apiClient
        .get<{ objects: DriveObject[] }>(`/api/core/drive/objects${qs ? `?${qs}` : ""}`)
        .then((data) => {
          if (generation !== fetchGen.current) return;
          setObjects(sortObjects(data.objects).slice(0, 12));
          setActiveIndex(0);
        })
        .catch((err) => {
          if (generation !== fetchGen.current) return;
          setObjects([]);
          if (err instanceof ApiError) {
            /* silent — editor keeps working */
          }
        })
        .finally(() => {
          if (generation === fetchGen.current) setLoading(false);
        });
    }, 250);

    return () => clearTimeout(timer);
  }, [trigger?.start, trigger?.end, trigger?.searchQuery]);

  const selectObject = useCallback(
    (object: DriveObject) => {
      if (!trigger) return;
      const { text, cursor } = applyDriveEmbedSelection(
        value,
        trigger,
        object.id,
        object.filename ?? object.title,
      );
      onChange(text);
      setTrigger(null);
      setObjects([]);
      onAnchorChange?.(null);
      requestAnimationFrame(() => setCursor(cursor));
    },
    [trigger, value, onChange, setCursor, onAnchorChange],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent): boolean => {
      if (!trigger) return false;
      const hasOptions = objects.length > 0;

      if (event.key === "Escape") {
        setTrigger(null);
        onAnchorChange?.(null);
        event.preventDefault();
        return true;
      }

      if (!hasOptions && event.key !== "ArrowDown") return false;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (!hasOptions) return true;
        setActiveIndex((i) => Math.min(i + 1, objects.length - 1));
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        if (!hasOptions) return false;
        event.preventDefault();
        const picked = objects[activeIndex];
        if (picked) selectObject(picked);
        return true;
      }
      return false;
    },
    [trigger, objects, activeIndex, selectObject, onAnchorChange],
  );

  return {
    open: !!trigger,
    trigger,
    objects,
    loading,
    activeIndex,
    setActiveIndex,
    syncTrigger,
    selectObject,
    handleKeyDown,
  };
}
