import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import { householdModuleCeiling, isModuleEnabled, normalizeHouseholdModulesSelection } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { calendarConnections, households, householdSubscriptions } from "@domi-ops/db";
import { eq } from "drizzle-orm";
import {
  canProvisionMembers,
  isHouseholdMemberRole,
  isUsernameAvailable,
  listHouseholdMembersWithAuth,
  memberShownLabel,
  ProvisionMemberError,
  provisionUsernameMember,
  UpdateMemberRoleError,
  updateHouseholdMemberRole,
} from "@domi-ops/auth";
import {
  DEFAULT_DRIVE_ROLE_PERMISSIONS,
  normalizeDrivePermissionsPatch,
  parseDrivePermissionsJson,
  serializeDrivePermissionsJson,
  type DriveRolePermissions,
} from "../lib/drive-permissions.js";
import { getHouseholdModuleContext } from "../lib/household-entitlements.js";
import { isWebPushConfigured } from "../lib/push-notices.js";
import { createS3Client } from "../lib/s3.js";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";

function parseModulesEnabled(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((m): m is string => typeof m === "string" && m.length > 0);
    }
  } catch {
    /* */
  }
  return [];
}

function normalizeHouseholdSlug(value: string | null | undefined): string | null {
  if (value == null || !value.trim()) return null;
  const slug = value.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug)) {
    return null;
  }
  return slug;
}

export function householdRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", requireAuth(env));

  function normalizeModulesEnabledSelection(
    requested: string[] | undefined,
    modulesEntitled: string[] | null,
  ): string[] | null {
    return normalizeHouseholdModulesSelection(
      requested,
      householdModuleCeiling(env, modulesEntitled),
    );
  }

  function serializeHouseholdSettings(
    row: {
      name: string;
      slug: string | null;
      timezone: string;
      modulesEnabled: string;
      drivePermissionsJson?: string | null;
      storageQuotaBytes?: number | null;
      storageUsedBytes?: number;
      subscriptionStatus?: "trialing" | "active" | "past_due" | "canceled" | null;
      trialEndsAt?: Date | null;
      telemetryOptIn?: boolean;
    },
    modulesEntitled: string[] | null,
  ) {
    const modulesEnabled = parseModulesEnabled(row.modulesEnabled);
    const driveEnabled = modulesEnabled.includes("drive");
    return {
      name: row.name,
      slug: row.slug,
      timezone: row.timezone,
      modulesEnabled,
      modulesEntitled,
      telemetryOptIn: row.telemetryOptIn ?? false,
      availableModules: householdModuleCeiling(env, modulesEntitled),
      drivePermissions: parseDrivePermissionsJson(row.drivePermissionsJson),
      drivePermissionDefaults: DEFAULT_DRIVE_ROLE_PERMISSIONS,
      driveStorage:
        driveEnabled && row.storageUsedBytes != null
          ? {
              usedBytes: row.storageUsedBytes,
              quotaBytes: row.storageQuotaBytes ?? null,
            }
          : null,
      drivePublicSharesEnabled: env.DRIVE_PUBLIC_SHARES_ENABLED,
      subscriptionStatus: row.subscriptionStatus ?? null,
      trialEndsAt: row.trialEndsAt?.toISOString() ?? null,
    };
  }

  app.get("/household/settings", async (c) => {
    const auth = c.get("auth")!;
    if (!canProvisionMembers(auth.role)) {
      return c.json({ error: "forbidden" }, 403);
    }
    const [row] = await db
      .select({
        name: households.name,
        slug: households.slug,
        timezone: households.timezone,
        modulesEnabled: households.modulesEnabled,
        drivePermissionsJson: households.drivePermissionsJson,
        storageQuotaBytes: households.storageQuotaBytes,
        storageUsedBytes: households.storageUsedBytes,
        telemetryOptIn: households.telemetryOptIn,
        modulesEntitled: householdSubscriptions.modulesEntitled,
        subscriptionStatus: householdSubscriptions.status,
        trialEndsAt: householdSubscriptions.trialEndsAt,
      })
      .from(households)
      .leftJoin(householdSubscriptions, eq(householdSubscriptions.householdId, households.id))
      .where(eq(households.id, auth.householdId))
      .limit(1);
    if (!row) return c.json({ error: "not_found" }, 404);
    const modulesEntitled = row.modulesEntitled
      ? (JSON.parse(row.modulesEntitled) as string[])
      : null;
    return c.json(serializeHouseholdSettings(row, modulesEntitled));
  });

  app.patch("/household/settings", async (c) => {
    const auth = c.get("auth")!;
    if (!canProvisionMembers(auth.role)) {
      return c.json({ error: "forbidden" }, 403);
    }
    const body = await c.req.json<{
      name?: string;
      slug?: string | null;
      timezone?: string;
      modulesEnabled?: string[];
      drivePermissions?: DriveRolePermissions;
      telemetryOptIn?: boolean;
    }>();

    const patch: {
      name?: string;
      slug?: string | null;
      timezone?: string;
      modulesEnabled?: string;
      drivePermissionsJson?: string;
      telemetryOptIn?: boolean;
      updatedAt?: Date;
    } = {};

    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) return c.json({ error: "name_required" }, 400);
      patch.name = name.slice(0, 128);
    }
    if (body.slug !== undefined) {
      const slug = normalizeHouseholdSlug(body.slug);
      if (body.slug && body.slug.trim() && !slug) {
        return c.json({ error: "invalid_slug" }, 400);
      }
      patch.slug = slug;
    }
    if (body.timezone !== undefined) {
      const timezone = body.timezone.trim();
      if (!timezone || timezone.length > 64) {
        return c.json({ error: "invalid_timezone" }, 400);
      }
      patch.timezone = timezone;
    }
    if (body.modulesEnabled !== undefined) {
      const { modulesEntitled } = await getHouseholdModuleContext(db, auth.householdId);
      const modulesEnabled = normalizeModulesEnabledSelection(body.modulesEnabled, modulesEntitled);
      if (!modulesEnabled) {
        return c.json({ error: "invalid_modules" }, 400);
      }
      patch.modulesEnabled = JSON.stringify(modulesEnabled);
    }
    if (body.drivePermissions !== undefined) {
      const current = parseDrivePermissionsJson(
        (
          await db
            .select({ drivePermissionsJson: households.drivePermissionsJson })
            .from(households)
            .where(eq(households.id, auth.householdId))
            .limit(1)
        )[0]?.drivePermissionsJson,
      );
      const delta = normalizeDrivePermissionsPatch(body.drivePermissions);
      if (!delta) return c.json({ error: "invalid_drive_permissions" }, 400);
      patch.drivePermissionsJson = serializeDrivePermissionsJson({ ...current, ...delta });
    }
    if (body.telemetryOptIn !== undefined) {
      patch.telemetryOptIn = Boolean(body.telemetryOptIn);
    }

    if (Object.keys(patch).length === 0) {
      return c.json({ error: "no_changes" }, 400);
    }

    patch.updatedAt = new Date();
    const [row] = await db
      .update(households)
      .set(patch)
      .where(eq(households.id, auth.householdId))
      .returning({
        name: households.name,
        slug: households.slug,
        timezone: households.timezone,
        modulesEnabled: households.modulesEnabled,
        drivePermissionsJson: households.drivePermissionsJson,
        storageQuotaBytes: households.storageQuotaBytes,
        storageUsedBytes: households.storageUsedBytes,
        telemetryOptIn: households.telemetryOptIn,
      });
    if (!row) return c.json({ error: "not_found" }, 404);
    const { modulesEntitled } = await getHouseholdModuleContext(db, auth.householdId);
    return c.json({ ok: true, household: serializeHouseholdSettings(row, modulesEntitled) });
  });

  app.get("/household/integrations", async (c) => {
    const auth = c.get("auth")!;
    if (!canProvisionMembers(auth.role)) {
      return c.json({ error: "forbidden" }, 403);
    }

    const googleOAuthConfigured = Boolean(
      env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET,
    );
    const calendarModuleEnabled = isModuleEnabled(env, "calendar_sync");

    let householdConnections = 0;
    let activeSyncRuns = 0;
    let lastSyncAt: string | null = null;

    if (calendarModuleEnabled) {
      const rows = await db
        .select({
          lastSyncAt: calendarConnections.lastSyncAt,
          syncRunStatus: calendarConnections.syncRunStatus,
        })
        .from(calendarConnections)
        .where(eq(calendarConnections.householdId, auth.householdId));
      householdConnections = rows.length;
      for (const row of rows) {
        if (
          row.lastSyncAt &&
          (!lastSyncAt || row.lastSyncAt.getTime() > new Date(lastSyncAt).getTime())
        ) {
          lastSyncAt = row.lastSyncAt.toISOString();
        }
        if (row.syncRunStatus === "queued" || row.syncRunStatus === "syncing") {
          activeSyncRuns += 1;
        }
      }
    }

    return c.json({
      googleLogin: { configured: googleOAuthConfigured },
      calendarSync: {
        moduleEnabled: calendarModuleEnabled,
        oauthConfigured: googleOAuthConfigured,
        defaultSyncMode: env.GOOGLE_CALENDAR_DEFAULT_SYNC_MODE,
        householdConnections,
        activeSyncRuns,
        lastSyncAt,
      },
      webPush: { configured: isWebPushConfigured(env) },
      storage: {
        configured: Boolean(createS3Client(env) && env.S3_BUCKET),
        bucket: env.S3_BUCKET ?? null,
      },
    });
  });

  app.get("/household/roster", async (c) => {
    const auth = c.get("auth")!;
    const rows = await listHouseholdMembersWithAuth(db, auth.householdId);
    return c.json({
      members: rows.map((m) => ({
        memberId: m.memberId,
        label: memberShownLabel({ name: m.name }) || m.username || m.email || "Member",
      })),
    });
  });

  app.get("/household/members", async (c) => {
    const auth = c.get("auth")!;
    if (!canProvisionMembers(auth.role)) {
      return c.json({ error: "forbidden" }, 403);
    }
    const members = await listHouseholdMembersWithAuth(db, auth.householdId);
    return c.json({ members });
  });

  app.get("/household/usernames/available", async (c) => {
    const auth = c.get("auth")!;
    if (!canProvisionMembers(auth.role)) {
      return c.json({ error: "forbidden" }, 403);
    }
    const username = c.req.query("username") ?? "";
    const available = await isUsernameAvailable(db, username);
    return c.json({ available });
  });

  app.post("/household/members/provision", async (c) => {
    const auth = c.get("auth")!;
    if (!canProvisionMembers(auth.role)) {
      return c.json({ error: "forbidden" }, 403);
    }
    const body = await c.req.json<{
      username?: string;
      displayName?: string;
      password?: string;
      role?: "child" | "member" | "guest";
    }>();
    if (!body.username?.trim() || !body.password || !body.displayName?.trim()) {
      return c.json({ error: "username_display_name_and_password_required" }, 400);
    }
    const role =
      body.role === "child" || body.role === "guest" || body.role === "member"
        ? body.role
        : "child";
    try {
      const created = await provisionUsernameMember(db, {
        householdId: auth.householdId,
        username: body.username,
        displayName: body.displayName,
        password: body.password,
        role,
      });
      return c.json(created, 201);
    } catch (e) {
      if (e instanceof ProvisionMemberError) {
        return c.json({ error: e.code, message: e.message }, 400);
      }
      throw e;
    }
  });

  app.patch("/household/members/:memberId/role", async (c) => {
    const auth = c.get("auth")!;
    if (!canProvisionMembers(auth.role)) {
      return c.json({ error: "forbidden" }, 403);
    }
    const memberId = c.req.param("memberId");
    const body = await c.req.json<{ role?: string }>();
    if (!body.role || !isHouseholdMemberRole(body.role)) {
      return c.json({ error: "invalid_role" }, 400);
    }
    try {
      const updated = await updateHouseholdMemberRole(db, {
        householdId: auth.householdId,
        actorRole: auth.role,
        targetMemberId: memberId,
        role: body.role,
      });
      return c.json({ ok: true, member: updated });
    } catch (e) {
      if (e instanceof UpdateMemberRoleError) {
        const status =
          e.code === "not_found" ? 404 : e.code === "forbidden" ? 403 : 400;
        return c.json({ error: e.code, message: e.message }, status);
      }
      throw e;
    }
  });

  return app;
}
