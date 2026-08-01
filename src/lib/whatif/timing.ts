export type WhatIfOperation = "initial" | "continue";

export interface WhatIfTimingRecord {
  operation: WhatIfOperation;
  outcome: "success" | "error";
  totalMs: number;
  preparationMs?: number;
  quotaReserveMs?: number;
  firstTextMs?: number;
  modelMs?: number;
  providerRequestReadyMs?: number;
  providerFirstTextMs?: number;
  providerTotalMs?: number;
  providerAttemptCount?: number;
  providerInputTokens?: number;
  providerCacheReadInputTokens?: number;
  providerCacheCreationInputTokens?: number;
  validationMs?: number;
  persistMs?: number;
  quotaConfirmMs?: number;
  recoveryCount?: number;
  promptChars?: number;
  outputChars?: number;
  errorCode?: string;
}

export function createWhatIfTiming(operation: WhatIfOperation, now = () => performance.now()) {
  const startedAt = now();
  const values: Partial<WhatIfTimingRecord> = { operation };

  return {
    elapsed: () => Math.round(now() - startedAt),
    mark: (name: keyof Omit<WhatIfTimingRecord, "operation" | "outcome" | "totalMs">, started: number) => {
      values[name] = Math.round(now() - started) as never;
    },
    report: (outcome: WhatIfTimingRecord["outcome"], extra: Omit<Partial<WhatIfTimingRecord>, "operation" | "outcome" | "totalMs"> = {}) => {
      const record: WhatIfTimingRecord = {
        ...values,
        ...extra,
        operation,
        outcome,
        totalMs: Math.round(now() - startedAt),
      };
      console.info("[whatif-timing]", JSON.stringify(record));
      return record;
    },
  };
}
