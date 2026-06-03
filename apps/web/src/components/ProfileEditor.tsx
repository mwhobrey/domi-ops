"use client";

import { useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import { Alert, Button, Card, CardBody, Input, Select } from "./ui";

type PublicLabel = "name" | "nickname";

export function ProfileEditor({
  initial,
}: {
  initial: {
    email: string;
    name: string | null;
    nickname: string | null;
    publicLabel: PublicLabel;
    shownLabel: string;
    homeStatus: string;
    homeStatusId: string | null;
  };
}) {
  const [name, setName] = useState(initial.name ?? "");
  const [nickname, setNickname] = useState(initial.nickname ?? "");
  const [publicLabel, setPublicLabel] = useState<PublicLabel>(initial.publicLabel);
  const [homeStatus, setHomeStatus] = useState(initial.homeStatus);
  const [shownLabel, setShownLabel] = useState(initial.shownLabel);
  const [msg, setMsg] = useState<string | null>(null);
  const [variant, setVariant] = useState<"success" | "error" | null>(null);
  const [loading, setLoading] = useState(false);

  function previewShown(): string {
    if (publicLabel === "nickname" && nickname.trim()) return nickname.trim();
    if (name.trim()) return name.trim();
    if (nickname.trim()) return nickname.trim();
    return "Member";
  }

  return (
    <Card className="max-w-lg">
      <CardBody className="space-y-6">
        <p className="text-sm text-[var(--color-text-muted)]">
          Signed in as <span className="text-[var(--color-text)]">{initial.email}</span>
        </p>
        <p className="text-sm">
          Shown to household as <span className="font-medium">{shownLabel}</span>
        </p>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={128} />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Nickname</span>
          <Input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={64}
            placeholder="Optional"
          />
        </label>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Show on household board &amp; school</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={publicLabel === "name"}
              onChange={() => setPublicLabel("name")}
            />
            Name{name.trim() ? ` (${name.trim()})` : ""}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={publicLabel === "nickname"}
              onChange={() => setPublicLabel("nickname")}
              disabled={!nickname.trim()}
            />
            Nickname{nickname.trim() ? ` (${nickname.trim()})` : ""}
          </label>
        </fieldset>
        {initial.homeStatusId && (
          <label className="block space-y-1">
            <span className="text-sm font-medium">Home / away</span>
            <Select
              value={homeStatus}
              onChange={async (e) => {
                const status = e.target.value;
                setHomeStatus(status);
                await apiClient.patch(`/api/core/dashboard/home-status/${initial.homeStatusId}`, {
                  status,
                });
              }}
            >
              <option value="Home">Home</option>
              <option value="Away">Away</option>
            </Select>
          </label>
        )}
        <Button
          loading={loading}
          onClick={async () => {
            setLoading(true);
            setMsg(null);
            setVariant(null);
            try {
              await apiClient.patch("/api/core/profile", {
                name: name || null,
                nickname: nickname || null,
                publicLabel,
              });
              setShownLabel(previewShown());
              setMsg("Saved");
              setVariant("success");
            } catch (err) {
              setMsg(err instanceof ApiError ? err.message : "Failed");
              setVariant("error");
            } finally {
              setLoading(false);
            }
          }}
        >
          Save profile
        </Button>
        {msg && variant && <Alert variant={variant}>{msg}</Alert>}
      </CardBody>
    </Card>
  );
}
