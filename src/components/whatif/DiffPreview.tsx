"use client";

/**
 * Diff 预览组件
 *
 * 红 = 删除（removedNodes / removedEdges）
 * 绿 = 新增（addedNodes / addedEdges）
 * 黄 = 修改（modifiedEvents）
 */
import type { GraphDiff } from "@/schemas/whatif";

interface Props {
  diff: GraphDiff | null;
}

export function DiffPreview({ diff }: Props) {
  if (!diff) {
    return <div style={{ color: "#888", fontSize: 13 }}>(等待 diff...)</div>;
  }

  const {
    removedNodes,
    addedNodes,
    removedEdges,
    addedEdges,
    modifiedEvents,
    replacedEvents,
  } = diff;

  const empty =
    removedNodes.length === 0 &&
    addedNodes.length === 0 &&
    removedEdges.length === 0 &&
    addedEdges.length === 0 &&
    modifiedEvents.length === 0 &&
    (replacedEvents?.length ?? 0) === 0;

  if (empty) {
    return <div style={{ color: "#888", fontSize: 13 }}>无图谱变化</div>;
  }

  return (
    <div style={{ fontSize: 13, lineHeight: 1.6 }}>
      {removedNodes.length > 0 && (
        <Block label="删除节点" count={removedNodes.length} color="#e55">
          {removedNodes.map((id) => (
            <li key={id} style={{ fontFamily: "ui-monospace, monospace" }}>
              {id}
            </li>
          ))}
        </Block>
      )}

      {addedNodes.length > 0 && (
        <Block label="新增节点" count={addedNodes.length} color="#5a5">
          {addedNodes.map((n) => (
            <li key={n.id}>
              <strong>{n.name_zh}</strong>{" "}
              <span style={{ fontFamily: "ui-monospace, monospace", color: "#888" }}>
                ({n.id})
              </span>{" "}
              <span style={{ color: "#888" }}>— {n.epithet ?? "无绰号"}</span>
            </li>
          ))}
        </Block>
      )}

      {removedEdges.length > 0 && (
        <Block label="删除关系" count={removedEdges.length} color="#e55">
          {removedEdges.map((id) => (
            <li key={id} style={{ fontFamily: "ui-monospace, monospace" }}>
              {id}
            </li>
          ))}
        </Block>
      )}

      {addedEdges.length > 0 && (
        <Block label="新增关系" count={addedEdges.length} color="#5a5">
          {addedEdges.map((r) => (
            <li key={r.id}>
              <span style={{ fontFamily: "ui-monospace, monospace" }}>
                {r.source} ↔ {r.target}
              </span>{" "}
              <span style={{ color: "#888" }}>({r.primary_type})</span>
            </li>
          ))}
        </Block>
      )}

      {modifiedEvents.length > 0 && (
        <Block label="改写事件" count={modifiedEvents.length} color="#fa0">
          {modifiedEvents.map((m, i) => (
            <li key={`${m.characterId}-${m.eventIndex}-${i}`}>
              <span style={{ fontFamily: "ui-monospace, monospace" }}>
                {m.characterId}[{m.eventIndex}]
              </span>{" "}
              → <strong>{m.newEvent.title}</strong>
              <div style={{ color: "#888", marginTop: 4, fontSize: 12 }}>
                {m.newEvent.desc}
              </div>
            </li>
          ))}
        </Block>
      )}

      {replacedEvents && replacedEvents.length > 0 && (
        <Block label="替换全部事件" count={replacedEvents.length} color="#fa0">
          {replacedEvents.map((r, i) => (
            <li key={`${r.characterId}-${i}`}>
              <span style={{ fontFamily: "ui-monospace, monospace" }}>
                {r.characterId}
              </span>{" "}
              <strong>替换为 {r.newEvents.length} 个新事件：</strong>
              <div style={{ color: "#888", marginTop: 4, fontSize: 12, paddingLeft: 12 }}>
                {r.newEvents.map((e, j) => (
                  <div key={j}>
                    {j + 1}. <strong>{e.title}</strong>
                  </div>
                ))}
              </div>
            </li>
          ))}
        </Block>
      )}
    </div>
  );
}

function Block({
  label,
  count,
  color,
  children,
}: {
  label: string;
  count: number;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ color, fontWeight: 600, marginBottom: 4 }}>
        {label} ({count})
      </div>
      <ul style={{ margin: 0, paddingLeft: 20 }}>{children}</ul>
    </div>
  );
}
