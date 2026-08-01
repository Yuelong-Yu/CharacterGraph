/** 可安全暴露给浏览器与结构化日志的推演恢复原因。 */
export type WhatIfRecoveryReason =
  | "transport_retry"
  | "provider_5xx_retry"
  | "timeout_retry"
  | "empty_response_retry"
  | "parse_invalid_json_retry"
  | "parse_non_object_json_retry"
  | "parse_schema_validation_retry"
  | "refusal_retry";

/** 一次丢弃流式草稿并重新生成的原因，不含模型正文或原始错误文本。 */
export interface WhatIfRecoveryEvent {
  reason: WhatIfRecoveryReason;
  /** 同一上游调用内的第几次请求（从 1 开始）。 */
  providerAttempt?: number;
  /** 同一份推演输出的第几次完整 JSON 解析（从 1 开始）。 */
  parseAttempt?: number;
  /** 仅提供错误类别，避免将上游错误详情暴露给浏览器。 */
  errorName?: string;
}
