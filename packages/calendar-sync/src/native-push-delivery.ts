import { createPrivateKey, createSign } from "node:crypto";
import { connect as http2Connect } from "node:http2";
import { readFileSync } from "node:fs";
import type { Env } from "@domi-ops/config";

/** Minimal payload shape shared with web-push delivery (avoid circular import). */
export type NativePushPayload = {
  title: string;
  body: string;
  tag: string;
  data: { url: string; [key: string]: string | undefined };
};

type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

let cachedFcmToken: { accessToken: string; expiresAtMs: number } | null = null;

function loadApnsKey(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes("BEGIN PRIVATE KEY")) return trimmed;
  try {
    return readFileSync(trimmed, "utf8");
  } catch {
    return trimmed;
  }
}

function loadServiceAccountJson(raw: string): ServiceAccount | null {
  const trimmed = raw.trim();
  let text = trimmed;
  if (!trimmed.startsWith("{")) {
    try {
      text = readFileSync(trimmed, "utf8");
    } catch {
      return null;
    }
  }
  try {
    const parsed = JSON.parse(text) as ServiceAccount;
    if (!parsed.client_email || !parsed.private_key) return null;
    return parsed;
  } catch {
    return null;
  }
}

function base64Url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64url");
}

function createApnsJwt(env: Env): string | null {
  if (!env.APNS_KEY_ID || !env.APNS_TEAM_ID || !env.APNS_P8_KEY) return null;
  const header = base64Url(JSON.stringify({ alg: "ES256", kid: env.APNS_KEY_ID }));
  const claims = base64Url(
    JSON.stringify({ iss: env.APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) }),
  );
  const unsigned = `${header}.${claims}`;
  const key = createPrivateKey(loadApnsKey(env.APNS_P8_KEY));
  const signer = createSign("SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign({ key, dsaEncoding: "ieee-p1363" });
  return `${unsigned}.${base64Url(signature)}`;
}

async function getFcmAccessToken(sa: ServiceAccount): Promise<string | null> {
  const now = Date.now();
  if (cachedFcmToken && cachedFcmToken.expiresAtMs > now + 60_000) {
    return cachedFcmToken.accessToken;
  }

  const iat = Math.floor(now / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: sa.token_uri ?? "https://oauth2.googleapis.com/token",
      iat,
      exp: iat + 3600,
    }),
  );
  const unsigned = `${header}.${claims}`;
  const key = createPrivateKey(sa.private_key);
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const jwt = `${unsigned}.${base64Url(signer.sign(key))}`;

  const res = await fetch(sa.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[domi-ops push] FCM token exchange failed", {
      status: res.status,
      body: body.slice(0, 200),
    });
    return null;
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) return null;
  cachedFcmToken = {
    accessToken: json.access_token,
    expiresAtMs: now + (json.expires_in ?? 3600) * 1000,
  };
  return json.access_token;
}

async function sendFcmV1(
  env: Env,
  token: string,
  payload: NativePushPayload,
): Promise<"sent" | "gone" | "error" | "skipped"> {
  if (!env.FCM_PROJECT_ID || !env.FCM_SERVICE_ACCOUNT_JSON) return "skipped";
  const sa = loadServiceAccountJson(env.FCM_SERVICE_ACCOUNT_JSON);
  if (!sa) {
    console.error("[domi-ops push] FCM_SERVICE_ACCOUNT_JSON invalid");
    return "error";
  }
  const accessToken = await getFcmAccessToken(sa);
  if (!accessToken) return "error";

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(env.FCM_PROJECT_ID)}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token,
          notification: {
            title: payload.title,
            body: payload.body,
          },
          data: Object.fromEntries(
            Object.entries({
              ...payload.data,
              tag: payload.tag,
              title: payload.title,
              body: payload.body,
            }).filter(([, v]) => typeof v === "string") as [string, string][],
          ),
          android: {
            priority: "HIGH",
            notification: {
              tag: payload.tag,
              click_action: payload.data.url,
            },
          },
        },
      }),
    },
  );

  if (res.status === 404) return "gone";
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (/UNREGISTERED|NOT_FOUND|INVALID_ARGUMENT/i.test(body)) return "gone";
    console.error("[domi-ops push] FCM v1 failed", { status: res.status, body: body.slice(0, 200) });
    return "error";
  }
  return "sent";
}

/** @deprecated Legacy FCM HTTP API — shut down by Google; kept as last-resort fallback. */
async function sendFcmLegacy(
  serverKey: string,
  token: string,
  payload: NativePushPayload,
): Promise<"sent" | "gone" | "error"> {
  console.warn("[domi-ops push] using deprecated FCM_SERVER_KEY legacy API — migrate to FCM v1");
  const res = await fetch("https://fcm.googleapis.com/fcm/send", {
    method: "POST",
    headers: {
      Authorization: `key=${serverKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: token,
      priority: "high",
      notification: {
        title: payload.title,
        body: payload.body,
        tag: payload.tag,
        click_action: payload.data.url,
      },
      data: {
        ...payload.data,
        tag: payload.tag,
        title: payload.title,
        body: payload.body,
      },
    }),
  });

  if (res.status === 404 || res.status === 410) return "gone";
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[domi-ops push] FCM legacy failed", { status: res.status, body: body.slice(0, 200) });
    return "error";
  }
  const json = (await res.json().catch(() => null)) as {
    failure?: number;
    results?: Array<{ error?: string }>;
  } | null;
  const err = json?.results?.[0]?.error;
  if (err === "NotRegistered" || err === "InvalidRegistration") return "gone";
  if (json?.failure && err) {
    console.error("[domi-ops push] FCM legacy result error", err);
    return "error";
  }
  return "sent";
}

async function sendApns(
  env: Env,
  token: string,
  payload: NativePushPayload,
): Promise<"sent" | "gone" | "error" | "skipped"> {
  const jwt = createApnsJwt(env);
  const bundleId = env.APNS_BUNDLE_ID ?? "app.domiops";
  if (!jwt) return "skipped";

  const host = process.env.APNS_HOST ?? "api.push.apple.com";
  const path = `/3/device/${token}`;

  return await new Promise((resolve) => {
    const client = http2Connect(`https://${host}`);
    client.on("error", (err) => {
      console.error("[domi-ops push] APNs connect failed", err);
      resolve("error");
    });

    const req = client.request({
      ":method": "POST",
      ":path": path,
      authorization: `bearer ${jwt}`,
      "apns-topic": bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    });

    let status = 0;
    let body = "";
    req.on("response", (headers) => {
      status = Number(headers[":status"] ?? 0);
    });
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      client.close();
      if (status === 410 || status === 404) {
        resolve("gone");
        return;
      }
      if (status >= 200 && status < 300) {
        resolve("sent");
        return;
      }
      console.error("[domi-ops push] APNs failed", { status, body: body.slice(0, 200) });
      resolve("error");
    });
    req.on("error", (err) => {
      console.error("[domi-ops push] APNs request failed", err);
      client.close();
      resolve("error");
    });

    req.end(
      JSON.stringify({
        aps: {
          alert: { title: payload.title, body: payload.body },
          sound: "default",
          "thread-id": payload.tag,
        },
        data: payload.data,
      }),
    );
  });
}

/** Deliver to an APNs/FCM device token registered by the Capacitor shell (WHO-289). */
export async function deliverNativeDevicePush(
  env: Env,
  platform: "ios" | "android",
  token: string,
  payload: NativePushPayload,
): Promise<"sent" | "skipped" | "gone" | "error"> {
  if (platform === "android") {
    if (env.FCM_PROJECT_ID && env.FCM_SERVICE_ACCOUNT_JSON) {
      return sendFcmV1(env, token, payload);
    }
    if (env.FCM_SERVER_KEY) {
      return sendFcmLegacy(env.FCM_SERVER_KEY, token, payload);
    }
    console.warn("[domi-ops push] native Android skipped — FCM v1 / FCM_SERVER_KEY unset");
    return "skipped";
  }

  if (!env.APNS_KEY_ID || !env.APNS_TEAM_ID || !env.APNS_P8_KEY) {
    console.warn("[domi-ops push] native iOS skipped — APNS_* unset");
    return "skipped";
  }
  return sendApns(env, token, payload);
}
