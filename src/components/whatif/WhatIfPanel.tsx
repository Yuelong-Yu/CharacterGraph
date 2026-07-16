"use client";

/**
 * WhatIf 主面板（Week 5：支持多分支）
 *
 * 功能：
 *   - 首次生成：调 streamWhatIf 创建 session + 第一 turn
 *   - 续写：调 streamContinueTurn，用户选 choice 或自由输入
 *   - 分支管理：fork from any turn / switch active branch
 *   - 展示：流式叙事 + 标签着色 + diff 预览 + choices 按钮 + 分支列表
 *   - 通知父组件：active branch 的 prior turns 变化时调 onTurnsChange
 *     （prior turns = parent branch 的 inherited turns + active branch 自己的 turns）
 */
import { useState, useRef, useEffect, useCallback } from "react";
import {
  streamWhatIf,
  streamContinueTurn,
  fetchSession,
  forkBranch,
  listTurnVersions,
  restoreTurnVersion,
  switchBranch,
  type WhatIfTurnVersionSummary,
} from "@/lib/whatif/client";
import { NarrativeView } from "./NarrativeView";
import { DiffPreview } from "./DiffPreview";
import { ValidationResults } from "./ValidationResults";
import type {
  GraphDiff,
  NarrativeSegment,
  PremiseType,
  ValidationResult,
  WhatIfSessionDetail,
  WhatIfTurnDetail,
} from "@/schemas/whatif";
import type { Character, Relation } from "@/schemas/character";
import type { SessionUser } from "@/lib/auth";
import { withBasePath } from "@/lib/basePath";

interface Props {
  isOpen: boolean;
  projectSlug: string;
  characterId: string;
  characterName: string;
  eventTitle: string | null;
  premise: string;
  premiseType: PremiseType;
  onClose: () => void;
  onTurnsChange: (turns: WhatIfTurnDetail[]) => void;
  onActiveBranchChange?: (branchId: string | null) => void;
  datasetOverlay?: { characters: Character[]; relations: Relation[] };
  historyRefreshVersion?: number;
  initialSession?: WhatIfSessionDetail | null;
  autoStart?: boolean;
}

interface StreamingState {
  text: string;
  /** 在 displayTurns 中的索引位置（committed turns 之后追加） */
  isContinue: boolean; // false = 首轮, true = 续写
}

export function WhatIfPanel({
  isOpen,
  projectSlug,
  characterId,
  characterName,
  eventTitle,
  premise,
  premiseType,
  onClose,
  onTurnsChange,
  onActiveBranchChange,
  datasetOverlay,
  historyRefreshVersion = 0,
  initialSession = null,
  autoStart = false,
}: Props) {
  const [sessionDetail, setSessionDetail] = useState<WhatIfSessionDetail | null>(initialSession);
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [freeInput, setFreeInput] = useState("");
  const [versionPicker, setVersionPicker] = useState<{
    turnId: string;
    versions: WhatIfTurnVersionSummary[];
  } | null>(null);
  const [accountUser, setAccountUser] = useState<SessionUser | null | undefined>(undefined);
  const lastAccountIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const autoStartAttemptedRef = useRef(false);

  useEffect(() => () => abortRef.current?.abort(), []);

  const refreshAccount = useCallback(async () => {
    setAccountUser(undefined);
    try {
      const response = await fetch(withBasePath("/api/auth/me"), { cache: "no-store" });
      const payload = await response.json() as { user?: SessionUser | null };
      const nextUser = response.ok ? payload.user ?? null : null;
      if (!nextUser || (lastAccountIdRef.current && lastAccountIdRef.current !== nextUser.id)) {
        setSessionDetail(null);
        setStreaming(null);
        setVersionPicker(null);
        setError(null);
        setFreeInput("");
      }
      lastAccountIdRef.current = nextUser?.id ?? null;
      setAccountUser(nextUser);
    } catch {
      setSessionDetail(null);
      setError(null);
      lastAccountIdRef.current = null;
      setAccountUser(null);
    }
  }, []);

  useEffect(() => {
    if (isOpen) void refreshAccount();
  }, [isOpen, refreshAccount]);

  useEffect(() => {
    if (!initialSession) return;
    setSessionDetail(initialSession);
    setStreaming(null);
    setVersionPicker(null);
    setError(null);
    setFreeInput("");
  }, [initialSession]);

  useEffect(() => {
    const refresh = () => { if (isOpen) void refreshAccount(); };
    window.addEventListener("chronchaos-auth-change", refresh);
    return () => window.removeEventListener("chronchaos-auth-change", refresh);
  }, [isOpen, refreshAccount]);

  useEffect(() => {
    if (!sessionDetail?.id || historyRefreshVersion === 0) return;
    let cancelled = false;
    void fetchSession(sessionDetail.id).then((fresh) => {
      if (!cancelled) setSessionDetail(fresh);
    }).catch(() => {});
    return () => { cancelled = true; };
    // Refresh is deliberately keyed only by the external mutation counter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyRefreshVersion]);

  // 找 active branch
  const activeBranch = sessionDetail?.branches.find((b) => b.isActive) ?? sessionDetail?.branches[0] ?? null;

  useEffect(() => {
    onActiveBranchChange?.(activeBranch?.id ?? null);
  }, [activeBranch?.id, onActiveBranchChange]);

  // 计算 prior turns（parent branch 的 inherited + active branch 自己的）
  // 用于 onTurnsChange 通知父组件重算 effectiveDataset
  const computePriorTurns = useCallback((): WhatIfTurnDetail[] => {
    if (!sessionDetail || !activeBranch) return [];
    const ownTurns = activeBranch.turns;
    if (!activeBranch.parentTurnId) return [...ownTurns];

    // 找 parent turn 所属 branch
    let parentBranch = null;
    let parentOrder = 0;
    for (const b of sessionDetail.branches) {
      const pt = b.turns.find((t) => t.id === activeBranch.parentTurnId);
      if (pt) {
        parentBranch = b;
        parentOrder = pt.order;
        break;
      }
    }
    if (!parentBranch) return [...ownTurns];

    const inherited = parentBranch.turns.filter((t) => t.order <= parentOrder);
    return [...inherited, ...ownTurns];
  }, [sessionDetail, activeBranch]);

  // sessionDetail 或 activeBranch 变化时通知父组件
  useEffect(() => {
    onTurnsChange(computePriorTurns());
  }, [computePriorTurns, onTurnsChange]);

  const handleStart = useCallback(async () => {
    setError(null);
    setStreaming({ text: "", isContinue: false });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamWhatIf(
        {
          projectSlug,
          title: `${characterName} - ${eventTitle ?? "自由前提"}`,
          characterId,
          premise,
          premiseType,
          sourceEventTitle: eventTitle ?? undefined,
          datasetOverlay,
        },
        {
          onDelta: (text) => {
            setStreaming((prev) => (prev ? { ...prev, text: prev.text + text } : prev));
          },
          onReset: () => {
            setStreaming((prev) => (prev ? { ...prev, text: "" } : prev));
          },
          onDone: async (data) => {
            setStreaming(null);
            // 拉取完整 session
            const fresh = await fetchSession(data.sessionId);
            setSessionDetail(fresh);
          },
          onError: (err) => {
            setError(`${err.code}: ${err.message}`);
            setStreaming(null);
          },
        },
        controller.signal,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStreaming(null);
    }
  }, [
    projectSlug,
    characterName,
    eventTitle,
    characterId,
    premise,
    premiseType,
    datasetOverlay,
  ]);

  useEffect(() => {
    if (
      !autoStart
      || !isOpen
      || !accountUser
      || sessionDetail
      || streaming
      || autoStartAttemptedRef.current
    ) return;
    autoStartAttemptedRef.current = true;
    void handleStart();
  }, [accountUser, autoStart, handleStart, isOpen, sessionDetail, streaming]);

  async function handleContinue(userInput: string) {
    if (!sessionDetail || !activeBranch) return;
    setError(null);
    setFreeInput("");
    setStreaming({ text: "", isContinue: true });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamContinueTurn(
        sessionDetail.id,
        userInput,
        datasetOverlay,
        {
          onDelta: (text) => {
            setStreaming((prev) => (prev ? { ...prev, text: prev.text + text } : prev));
          },
          onReset: () => {
            setStreaming((prev) => (prev ? { ...prev, text: "" } : prev));
          },
          onDone: async () => {
            setStreaming(null);
            const fresh = await fetchSession(sessionDetail.id);
            setSessionDetail(fresh);
          },
          onError: (err) => {
            setError(`${err.code}: ${err.message}`);
            setStreaming(null);
          },
        },
        controller.signal,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStreaming(null);
    }
  }

  async function handleFork(parentTurnId: string) {
    if (!sessionDetail) return;
    setError(null);
    try {
      const newBranchId = await forkBranch(sessionDetail.id, parentTurnId);
      const fresh = await switchBranch(sessionDetail.id, newBranchId);
      setSessionDetail(fresh);
      setStreaming(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleSwitchBranch(branchId: string) {
    if (!sessionDetail) return;
    setError(null);
    setStreaming(null);
    try {
      const fresh = await switchBranch(sessionDetail.id, branchId);
      setSessionDetail(fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleShowVersions(turnId: string) {
    if (!sessionDetail) return;
    if (versionPicker?.turnId === turnId) {
      setVersionPicker(null);
      return;
    }
    setError(null);
    try {
      setVersionPicker({ turnId, versions: await listTurnVersions(sessionDetail.id, turnId) });
    } catch (versionError) {
      setError(versionError instanceof Error ? versionError.message : String(versionError));
    }
  }

  async function handleRestoreVersion(turnId: string, versionId: string) {
    if (!sessionDetail || !window.confirm("恢复此旧版本？当前版本会先自动归档。")) return;
    setError(null);
    try {
      await restoreTurnVersion(sessionDetail.id, turnId, versionId);
      setSessionDetail(await fetchSession(sessionDetail.id));
      setVersionPicker(null);
    } catch (versionError) {
      setError(versionError instanceof Error ? versionError.message : String(versionError));
    }
  }

  function handleClose() {
    onClose();
  }

  // 组装显示用 turns：committed + streaming（若有）
  const displayTurns: Array<{
    key: string;
    narrative: NarrativeSegment[];
    diff: GraphDiff | null;
    choices: string[];
    premise: string;
    isStreaming: boolean;
    streamingText: string;
    turnId: string | null;
    validation: ValidationResult[] | null;
    status: WhatIfTurnDetail["status"] | "streaming";
  }> = [];

  if (activeBranch) {
    for (const t of activeBranch.turns) {
      displayTurns.push({
        key: t.id,
        narrative: t.narrative,
        diff: t.diff,
        choices: t.choices,
        premise: t.premise,
        isStreaming: false,
        streamingText: "",
        turnId: t.id,
        validation: t.validation,
        status: t.status,
      });
    }
  }
  if (streaming) {
    displayTurns.push({
      key: "streaming",
      narrative: [],
      diff: null,
      choices: [],
      premise: streaming.isContinue ? "(续写中)" : premise,
      isStreaming: true,
      streamingText: streaming.text,
      turnId: null,
      validation: null,
      status: "streaming",
    });
  }

  const isStreaming = streaming !== null;
  const lastCommittedTurn = activeBranch?.turns[activeBranch.turns.length - 1] ?? null;
  const historyAvailable = lastCommittedTurn?.status !== "stale" && lastCommittedTurn?.status !== "updating";
  const showChoices = !isStreaming && historyAvailable && lastCommittedTurn && lastCommittedTurn.choices.length > 0;

  return (
    <div
      style={{
        position: "fixed",
        top: 68,
        right: 0,
        bottom: 0,
        width: 460,
        background: "#1a1a1a",
        borderLeft: "1px solid #333",
        display: isOpen ? "flex" : "none",
        flexDirection: "column",
        zIndex: 100,
        fontFamily: "system-ui, sans-serif",
        color: "#eee",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid #333",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>同人创作</div>
          <div style={{ fontSize: 12, color: "#888" }}>
            {accountUser ? `${accountUser.displayName} · ` : ""}{characterName}
            {eventTitle ? ` · ${eventTitle}` : ""}
          </div>
        </div>
        <button
          onClick={handleClose}
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

      {/* Branch list */}
      {accountUser && sessionDetail && sessionDetail.branches.length > 1 && (
        <div
          style={{
            padding: "8px 16px",
            borderBottom: "1px solid #2a2a2a",
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          {sessionDetail.branches.map((b, i) => (
            <button
              key={b.id}
              onClick={() => handleSwitchBranch(b.id)}
              style={{
                padding: "4px 10px",
                fontSize: 11,
                background: b.isActive ? "#4a9eff" : "#2a2a2a",
                color: b.isActive ? "white" : "#aaa",
                border: `1px solid ${b.isActive ? "#4a9eff" : "#444"}`,
                borderRadius: 3,
                cursor: "pointer",
              }}
            >
              {b.title || `分支 ${i + 1}`} ({b.turns.length})
            </button>
          ))}
        </div>
      )}

      {/* Premise */}
      {accountUser && (
        <div style={{ padding: "8px 16px", fontSize: 13, color: "#aaa", borderBottom: "1px solid #2a2a2a" }}>
          <strong style={{ color: "#4a9eff" }}>前提：</strong>
          {premise}
        </div>
      )}

      {/* Turn list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
        {accountUser === undefined && (
          <div style={{ color: "#888", textAlign: "center", padding: 40 }}>正在检查账号...</div>
        )}

        {accountUser === null && (
          <div style={{ textAlign: "center", padding: "40px 20px" }}>
            <div style={{ fontSize: 16, marginBottom: 10 }}>登录后保存你的同人分支</div>
            <div style={{ color: "#888", fontSize: 13, lineHeight: 1.7 }}>
              请通过页面顶部导航登录或注册 ChronChaos 账号。
            </div>
            <button
              type="button"
              onClick={handleClose}
              style={{
                marginTop: 18,
                padding: "9px 16px",
                fontSize: 13,
                background: "#2a2a2a",
                color: "#eee",
                border: "1px solid #4a4a4a",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              关闭提示，返回图谱
            </button>
          </div>
        )}

        {accountUser && autoStart && !sessionDetail && !streaming && !error && (
          <div style={{ color: "#888", textAlign: "center", padding: 40 }}>
            正在准备推演...
          </div>
        )}

        {accountUser && displayTurns.map((turn, i) => (
          <div key={turn.key} style={{ marginBottom: 24 }}>
            <div
              style={{
                fontSize: 12,
                color: "#666",
                marginBottom: 8,
                fontFamily: "ui-monospace, monospace",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>
                ── Turn {i + 1} {turn.isStreaming ? "(生成中)" : ""}
                {turn.status === "stale" ? "（待重新推演）" : ""}
                {turn.status === "updating" ? "（更新中）" : ""}
              </span>
              {!turn.isStreaming && turn.turnId && (
                <span style={{ display: "flex", gap: 5 }}>
                  <button
                    onClick={() => handleShowVersions(turn.turnId!)}
                    style={turnToolButtonStyle}
                    title="查看重新推演前的旧版本"
                  >
                    版本
                  </button>
                  <button
                    onClick={() => handleFork(turn.turnId!)}
                    style={{ ...turnToolButtonStyle, color: "#fa0", borderColor: "#660" }}
                    title="从此处分叉出新分支"
                  >
                    ⎇ fork
                  </button>
                </span>
              )}
            </div>

            {turn.turnId && versionPicker?.turnId === turn.turnId && (
              <div style={{ padding: 8, marginBottom: 8, background: "#242424", border: "1px solid #3a3a3a", fontSize: 11 }}>
                {versionPicker.versions.length === 0 ? (
                  <span style={{ color: "#777" }}>暂无旧版本</span>
                ) : versionPicker.versions.map((version) => (
                  <button
                    key={version.id}
                    type="button"
                    onClick={() => handleRestoreVersion(turn.turnId!, version.id)}
                    style={{ ...turnToolButtonStyle, display: "block", width: "100%", marginBottom: 5, textAlign: "left" }}
                  >
                    版本 {version.version} · {new Date(version.createdAt).toLocaleString("zh-CN")}
                  </button>
                ))}
              </div>
            )}

            <NarrativeView
              streamText={turn.streamingText}
              segments={turn.isStreaming ? null : turn.narrative}
            />

            {!turn.isStreaming && turn.diff && (
              <details style={{ marginTop: 8 }}>
                <summary
                  style={{
                    cursor: "pointer",
                    fontSize: 12,
                    color: "#888",
                    userSelect: "none",
                  }}
                >
                  图谱变化（点开查看）
                </summary>
                <div style={{ marginTop: 8 }}>
                  <DiffPreview diff={turn.diff} />
                </div>
              </details>
            )}

            {!turn.isStreaming && (
              <ValidationResults results={turn.validation} />
            )}
          </div>
        ))}

        {error && (
          <div
            style={{
              padding: 12,
              background: "#3a1a1a",
              color: "#ff8080",
              borderRadius: 4,
              fontSize: 13,
              whiteSpace: "pre-wrap",
              marginBottom: 16,
            }}
          >
            {error}
            {autoStart && !sessionDetail && !streaming && (
              <div style={{ marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => void handleStart()}
                  style={{
                    padding: "7px 12px",
                    fontSize: 12,
                    background: "#2a2a2a",
                    color: "#eee",
                    border: "1px solid #555",
                    borderRadius: 4,
                    cursor: "pointer",
                  }}
                >
                  重新推演
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input area: choices + free input */}
      {accountUser && showChoices && lastCommittedTurn && (
        <div
          style={{
            padding: "12px 16px",
            borderTop: "1px solid #333",
            background: "#1f1f1f",
          }}
        >
          <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>
            选择后续方向，或自由输入：
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
            {lastCommittedTurn.choices.map((c, i) => (
              <button
                key={i}
                onClick={() => handleContinue(c)}
                style={{
                  padding: "8px 12px",
                  fontSize: 13,
                  background: "#2a2a2a",
                  color: "#eee",
                  border: "1px solid #444",
                  borderRadius: 4,
                  cursor: "pointer",
                  textAlign: "left",
                  lineHeight: 1.5,
                }}
              >
                {i + 1}. {c}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="text"
              value={freeInput}
              onChange={(e) => setFreeInput(e.target.value)}
              placeholder="或自由输入方向..."
              style={{
                flex: 1,
                padding: "8px 12px",
                fontSize: 13,
                background: "#1a1a1a",
                color: "#eee",
                border: "1px solid #444",
                borderRadius: 4,
                outline: "none",
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && freeInput.trim()) {
                  handleContinue(freeInput.trim());
                }
              }}
            />
            <button
              onClick={() => freeInput.trim() && handleContinue(freeInput.trim())}
              disabled={!freeInput.trim()}
              style={{
                padding: "8px 16px",
                fontSize: 13,
                background: freeInput.trim() ? "#4a9eff" : "#333",
                color: "white",
                border: "none",
                borderRadius: 4,
                cursor: freeInput.trim() ? "pointer" : "not-allowed",
              }}
            >
              发送
            </button>
          </div>
        </div>
      )}

      {/* 空分支提示（fork 后还没续写） */}
      {accountUser && sessionDetail && activeBranch && activeBranch.turns.length === 0 && !streaming && (
        <div
          style={{
            padding: "12px 16px",
            borderTop: "1px solid #333",
            background: "#1f1f1f",
          }}
        >
          <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>
            这是 fork 出的新分支，还没有自己的 turn。输入第一个续写方向：
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="text"
              value={freeInput}
              onChange={(e) => setFreeInput(e.target.value)}
              placeholder="输入新分支的起始方向..."
              style={{
                flex: 1,
                padding: "8px 12px",
                fontSize: 13,
                background: "#1a1a1a",
                color: "#eee",
                border: "1px solid #444",
                borderRadius: 4,
                outline: "none",
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && freeInput.trim()) {
                  handleContinue(freeInput.trim());
                }
              }}
            />
            <button
              onClick={() => freeInput.trim() && handleContinue(freeInput.trim())}
              disabled={!freeInput.trim()}
              style={{
                padding: "8px 16px",
                fontSize: 13,
                background: freeInput.trim() ? "#4a9eff" : "#333",
                color: "white",
                border: "none",
                borderRadius: 4,
                cursor: freeInput.trim() ? "pointer" : "not-allowed",
              }}
            >
              发送
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const turnToolButtonStyle: React.CSSProperties = {
  padding: "2px 6px",
  fontSize: 10,
  background: "transparent",
  color: "#999",
  border: "1px solid #444",
  borderRadius: 3,
  cursor: "pointer",
};
