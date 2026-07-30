import type { NextRequest } from "next/server";
import { AiQuotaRequestError } from "@/lib/aiQuotaError";

type QuotaAction = "reserve" | "confirm" | "release";

type QuotaResponse = {
  ok?: boolean;
  error?: string;
  message?: string;
  code?: string;
};

export async function reserveWhatIfQuota(
  request: NextRequest,
  requestKeys: string[],
  operation: "whatif_initial" | "whatif_continue" | "user_character_regeneration",
) {
  await callQuotaService(request, "reserve", requestKeys, operation);
}

export async function confirmWhatIfQuota(request: NextRequest, requestKeys: string[]) {
  await settleWithRetry(request, "confirm", requestKeys);
}

export async function releaseWhatIfQuota(request: NextRequest, requestKeys: string[]) {
  if (requestKeys.length === 0) return;
  await callQuotaService(request, "release", requestKeys).catch((error) => {
    console.error("[charactergraph-quota] could not release reservations", error);
  });
}

export function quotaErrorResponse(error: unknown) {
  if (!(error instanceof AiQuotaRequestError)) return null;
  return Response.json(
    { error: error.message, code: error.code },
    { status: error.status },
  );
}

async function settleWithRetry(
  request: NextRequest,
  action: "confirm" | "release",
  requestKeys: string[],
) {
  let lastError: unknown;
  for (const delay of [0, 100, 250]) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      await callQuotaService(request, action, requestKeys);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function callQuotaService(
  request: NextRequest,
  action: QuotaAction,
  requestKeys: string[],
  operation?: string,
) {
  const origin = (process.env.CHRONCHAOS_INTERNAL_ORIGIN || "http://127.0.0.1:3000").replace(/\/+$/, "");
  const secret = getServiceSecret();
  let response: Response;
  try {
    response = await fetch(`${origin}/api/internal/ai-generation-quota`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: request.headers.get("cookie") || "",
        "x-ai-quota-service-secret": secret,
      },
      body: JSON.stringify({ action, requestKeys, operation }),
      cache: "no-store",
    });
  } catch {
    throw new AiQuotaRequestError(
      "AI 额度服务暂时不可用，请稍后重试。",
      "QUOTA_SERVICE_UNAVAILABLE",
      503,
    );
  }

  const payload = await response.json().catch(() => ({})) as QuotaResponse;
  if (!response.ok || payload.ok === false) {
    throw new AiQuotaRequestError(
      payload.error || payload.message || "AI 额度服务暂时不可用，请稍后重试。",
      payload.code || "QUOTA_SERVICE_UNAVAILABLE",
      response.status || 503,
    );
  }
}

function getServiceSecret() {
  const secret = process.env.AI_QUOTA_SERVICE_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new AiQuotaRequestError(
      "AI 额度服务暂时不可用，请稍后重试。",
      "QUOTA_SERVICE_UNAVAILABLE",
      503,
    );
  }
  return "chronchaos-local-ai-quota-secret";
}
