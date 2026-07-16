"use client";

/**
 * 私人推演分支列表
 *
 * 列出账号在当前项目下保存的推演，点击载入，支持删除。
 */
import { useEffect, useState } from "react";
import { listSessions, fetchSession, switchBranch } from "@/lib/whatif/client";
import type { WhatIfSessionDetail, WhatIfSessionSummary } from "@/schemas/whatif";
import { withBasePath } from "@/lib/basePath";

interface Props {
  projectSlug: string;
  onLoad: (session: WhatIfSessionDetail) => void;
  onClose: () => void;
}

export function SessionList({ projectSlug, onLoad, onClose }: Props) {
  const [sessions, setSessions] = useState<WhatIfSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listSessions(projectSlug)
      .then((s) => {
        setSessions(s);
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
  }, [projectSlug]);

  async function handleLoad(sessionId: string) {
    try {
      const session = await fetchSession(sessionId);
      // 找 active branch，确保有 active
      const hasActive = session.branches.some((b) => b.isActive);
      if (!hasActive && session.branches.length > 0) {
        const switched = await switchBranch(sessionId, session.branches[0].id);
        onLoad(switched);
      } else {
        onLoad(session);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDelete(sessionId: string) {
    if (!confirm("确定删除这个私人分支？其中的所有时间线和推演内容都会丢失。")) return;
    try {
      const resp = await fetch(withBasePath(`/api/whatif/${sessionId}`), { method: "DELETE" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "#1a1a1a",
        padding: 20,
        overflowY: "auto",
        zIndex: 200,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18 }}>私人分支</h2>
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            color: "#888",
            border: "1px solid #444",
            borderRadius: 4,
            padding: "4px 10px",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          ✕ 关闭
        </button>
      </div>

      {loading && <div style={{ color: "#888" }}>加载中...</div>}

      {error && (
        <div
          style={{
            padding: 12,
            background: "#3a1a1a",
            color: "#ff8080",
            borderRadius: 4,
            fontSize: 13,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      {!loading && sessions.length === 0 && (
        <div style={{ color: "#888", textAlign: "center", padding: 40 }}>
          还没有保存的私人分支
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {sessions.map((s) => (
          <div
            key={s.id}
            style={{
              padding: 12,
              background: "#222",
              border: "1px solid #333",
              borderRadius: 4,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div style={{ flex: 1, cursor: "pointer" }} onClick={() => handleLoad(s.id)}>
              <div style={{ fontSize: 14, color: "#eee", marginBottom: 4 }}>
                {s.title}
              </div>
              <div style={{ fontSize: 11, color: "#888" }}>
                {s.branchCount} 条时间线 · {s.turnCount} 次推演 ·{" "}
                {new Date(s.createdAt).toLocaleString("zh-CN")}
              </div>
            </div>
            <button
              onClick={() => handleDelete(s.id)}
              style={{
                padding: "4px 8px",
                fontSize: 11,
                background: "transparent",
                color: "#e55",
                border: "1px solid #533",
                borderRadius: 3,
                cursor: "pointer",
              }}
            >
              删除
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
