export type AiQuotaErrorCode =
  | "LOGIN_REQUIRED"
  | "UPGRADE_REQUIRED"
  | "DAILY_LIMIT_EXCEEDED"
  | "DAILY_LIMIT_REACHED"
  | "QUOTA_SERVICE_UNAVAILABLE";

export class AiQuotaRequestError extends Error {
  constructor(
    message: string,
    readonly code: AiQuotaErrorCode | string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AiQuotaRequestError";
  }
}

export async function throwAiQuotaResponse(response: Response): Promise<never> {
  const payload = await response.json().catch(() => ({})) as {
    error?: unknown;
    message?: unknown;
    code?: unknown;
  };
  const message = typeof payload.error === "string"
    ? payload.error
    : typeof payload.message === "string"
      ? payload.message
      : `AI 请求失败：HTTP ${response.status}`;
  const code = typeof payload.code === "string" ? payload.code : "AI_REQUEST_FAILED";
  throw new AiQuotaRequestError(message, code, response.status);
}
