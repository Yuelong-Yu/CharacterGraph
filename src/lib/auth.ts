import crypto from "node:crypto";

/**
 * chronchaos_gpt owns authentication. CharacterGraph only verifies the shared,
 * signed session cookie and stores the external user id on its own records.
 * Keep this payload contract aligned with chronchaos_gpt/lib/auth.ts.
 */
export type SessionUser = {
  id: string;
  username: string;
  displayName: string;
  role: string;
  readerId: string;
};

const COOKIE_NAME = "chron_user";

export function getSessionUserFromHeaders(headers: Headers): SessionUser | null {
  const token = parseCookie(headers.get("cookie") || "")[COOKIE_NAME];
  if (!token) return null;

  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(sign(payload), signature)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<SessionUser> & {
      expiresAt?: number;
    };
    if (!parsed.expiresAt || parsed.expiresAt < Date.now()) return null;
    if (
      !isNonEmptyString(parsed.id)
      || !isNonEmptyString(parsed.username)
      || !isNonEmptyString(parsed.displayName)
      || !isNonEmptyString(parsed.role)
      || !isNonEmptyString(parsed.readerId)
    ) {
      return null;
    }
    return {
      id: parsed.id,
      username: parsed.username,
      displayName: parsed.displayName,
      role: parsed.role,
      readerId: parsed.readerId,
    };
  } catch {
    return null;
  }
}

function getSecret(): string {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET is required in production and must match chronchaos_gpt");
  }
  return "chronchaos-local-dev-secret";
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

function parseCookie(cookieHeader: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");
    if (key) result[key] = valueParts.join("=");
  }
  return result;
}

function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && crypto.timingSafeEqual(aBuffer, bBuffer);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
