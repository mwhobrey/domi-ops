import { createHmac, timingSafeEqual } from "node:crypto";
import { McpGatewayError } from "./access.js";

/** Opaque continuation bound to a grant and exact logical query, never identity input. */
export function mcpCursors(secret: string | undefined) {
  let key: Buffer | undefined;
  const signingKey = () => {
    if (!secret) throw new McpGatewayError("temporarily_unavailable", 503);
    return key ??= createHmac("sha256", secret).update("domi-ops/mcp/cursors/v1").digest();
  };
  const mac = (binding: string, value: string) => createHmac("sha256", signingKey()).update(binding).update("\0").update(value).digest();
  return {
    encode(binding: string, value: unknown) {
      const payload = Buffer.from(JSON.stringify({ value, expires: Date.now() + 3600000 })).toString("base64url");
      return payload + "." + mac(binding, payload).toString("base64url");
    },
    decode(binding: string, cursor: string): unknown {
      signingKey();
      try {
        const [payload, signature, extra] = cursor.split(".");
        const expected = mac(binding, payload), actual = Buffer.from(signature, "base64url");
        if (extra !== undefined || actual.length !== expected.length || !timingSafeEqual(expected, actual)) throw new Error();
        const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { value: unknown; expires: number };
        if (!Number.isFinite(decoded.expires) || decoded.expires < Date.now()) throw new Error();
        return decoded.value;
      } catch { throw new McpGatewayError("invalid_cursor", 400); }
    },
  };
}
