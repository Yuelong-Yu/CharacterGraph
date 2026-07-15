"use client";

/**
 * 校验结果展示
 *
 * error 红、warning 黄。可折叠。
 */
import type { ValidationResult } from "@/schemas/whatif";

interface Props {
  results: ValidationResult[] | null;
}

export function ValidationResults({ results }: Props) {
  if (!results || results.length === 0) {
    return (
      <div style={{ fontSize: 11, color: "#5a5", marginTop: 4 }}>
        ✓ 校验通过
      </div>
    );
  }

  const errors = results.filter((r) => r.level === "error");
  const warnings = results.filter((r) => r.level === "warning");

  return (
    <details style={{ marginTop: 8 }}>
      <summary
        style={{
          cursor: "pointer",
          fontSize: 11,
          color: errors.length > 0 ? "#e55" : "#fa0",
          userSelect: "none",
        }}
      >
        {errors.length > 0
          ? `⚠ ${errors.length} 个错误`
          : `⚡ ${warnings.length} 个警告`}
        （点开查看）
      </summary>
      <div style={{ marginTop: 6 }}>
        {results.map((r, i) => (
          <div
            key={i}
            style={{
              padding: "6px 8px",
              marginBottom: 4,
              background: r.level === "error" ? "#3a1a1a" : "#3a2a0a",
              color: r.level === "error" ? "#ff8080" : "#ffc080",
              borderRadius: 3,
              fontSize: 11,
              lineHeight: 1.5,
              borderLeft: `3px solid ${r.level === "error" ? "#e55" : "#fa0"}`,
            }}
          >
            <strong>{r.level === "error" ? "错误" : "警告"}</strong>
            {r.segmentIndex !== undefined && ` (段 ${r.segmentIndex + 1})`}：
            {r.message}
          </div>
        ))}
      </div>
    </details>
  );
}
