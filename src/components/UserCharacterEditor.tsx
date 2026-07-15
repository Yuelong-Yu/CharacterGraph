"use client";

import { useMemo, useRef, useState } from "react";
import type { Dataset } from "@/schemas/character";
import type { ClientProjectConfig } from "@/schemas/projectConfig";
import type {
  GeneratedProfile,
  GeneratedRelationship,
  UserCharacterGenerationResult,
} from "@/schemas/userCharacter";
import {
  createUserCharacterId,
  defaultRelationshipCount,
  type UserCharacterRecord,
} from "@/lib/userCharacters";
import {
  streamUserCharacterGeneration,
  type UserCharacterGenerationProgress,
} from "@/lib/userCharacterClient";
import { COLOR, FONT } from "@/lib/tokens";
import { buildUserEventCitation } from "@/lib/userEvents";

interface Props {
  dataset: Dataset;
  config: ClientProjectConfig;
  scopeId: string;
  editingRecord?: UserCharacterRecord | null;
  onCancel: () => void;
  onSave: (record: UserCharacterRecord) => Promise<void> | void;
}

interface PreviewState extends UserCharacterGenerationResult {
  sourceWork: string;
}

function splitAliases(value: string): string[] {
  return value.split(/[、,，\n]/).map((part) => part.trim()).filter(Boolean);
}

function sourceWorkForRecord(record: UserCharacterRecord): string {
  return record.character.events.find((event) => event.source?.work)?.source?.work
    ?? record.relations.flatMap((relation) => relation.events).find((event) => event.source?.work)?.source?.work
    ?? "用户创作-改编";
}

function previewFromRecord(record: UserCharacterRecord): PreviewState {
  return {
    sourceWork: sourceWorkForRecord(record),
    profile: {
      nameEn: record.character.name_en,
      aliases: record.character.aliases,
      epithet: record.character.epithet,
      bio: record.character.bio ?? "",
      events: record.character.events.map((event) => ({ title: event.title, desc: event.desc })),
      weapons: record.character.weapons,
      skills: record.character.skills,
      domains: record.character.domains,
      mounts: record.character.mounts,
    },
    relationships: record.relations.map((relation) => ({
      targetId: relation.source === record.id ? relation.target : relation.source,
      primaryType: relation.primary_type,
      compositeTypes: relation.composite_types,
      title: relation.events[0]?.title ?? "新关系",
      desc: relation.events[0]?.desc ?? "",
    })),
  };
}

function progressText(progress: UserCharacterGenerationProgress | null): string {
  if (!progress) return "正在连接豆包模型…";
  if (progress.stage === "targets") return `正在选择关系人物 ${progress.completed}/${progress.total}`;
  if (progress.stage === "profile") return "正在生成人物资料";
  return `正在生成关系故事 ${progress.completed}/${progress.total} 批`;
}

export function UserCharacterEditor({
  dataset,
  config,
  scopeId,
  editingRecord = null,
  onCancel,
  onSave,
}: Props) {
  const candidates = useMemo(
    () => dataset.characters.filter((character) => character.id !== editingRecord?.id),
    [dataset.characters, editingRecord?.id],
  );
  const countRange = defaultRelationshipCount(candidates.length);
  const existingTargets = editingRecord?.relations.map((relation) => (
    relation.source === editingRecord.id ? relation.target : relation.source
  )) ?? [];
  const [nameZh, setNameZh] = useState(editingRecord?.character.name_zh ?? "");
  const [background, setBackground] = useState(editingRecord?.background ?? "");
  const [category, setCategory] = useState(
    editingRecord?.character.category ?? Object.keys(config.characterCategories)[0] ?? "",
  );
  const [eraLayer, setEraLayer] = useState(editingRecord?.character.era_layer ?? 0);
  const [aliases, setAliases] = useState(editingRecord?.character.aliases.join("、") ?? "");
  const [epithet, setEpithet] = useState(editingRecord?.character.epithet ?? "");
  const [relationCount, setRelationCount] = useState(
    editingRecord ? existingTargets.length : countRange.defaultValue,
  );
  const [requiredIds, setRequiredIds] = useState<Set<string>>(() => new Set(existingTargets));
  const [candidateQuery, setCandidateQuery] = useState("");
  const [preview, setPreview] = useState<PreviewState | null>(
    editingRecord ? previewFromRecord(editingRecord) : null,
  );
  const [step, setStep] = useState<"form" | "generating" | "preview">(
    editingRecord ? "preview" : "form",
  );
  const [progress, setProgress] = useState<UserCharacterGenerationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const exactDuplicate = dataset.characters.find(
    (character) => character.id !== editingRecord?.id && character.name_zh.trim() === nameZh.trim(),
  );
  const aliasWarnings = splitAliases(aliases).filter((alias) => dataset.characters.some(
    (character) => character.id !== editingRecord?.id && (
      character.name_zh === alias || character.aliases.includes(alias)
    ),
  ));

  const filteredCandidates = candidates.filter((character) => {
    const query = candidateQuery.trim().toLowerCase();
    if (!query) return true;
    return character.name_zh.includes(query)
      || character.name_en.toLowerCase().includes(query)
      || character.aliases.some((alias) => alias.includes(query));
  });

  const validateForm = (): string | null => {
    if (!nameZh.trim()) return "请填写人物姓名";
    if (exactDuplicate) return `已存在同名人物「${exactDuplicate.name_zh}」`;
    if (!background.trim()) return "请填写背景假设";
    if (!category) return "请选择人物分类";
    if (requiredIds.size > relationCount) return "手选人物数不能超过关系总数";
    return null;
  };

  async function generatePreview() {
    const formError = validateForm();
    if (formError) {
      setError(formError);
      setStep("form");
      return;
    }
    setError(null);
    setProgress(null);
    setStep("generating");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamUserCharacterGeneration(
        {
          projectSlug: config.slug,
          nameZh: nameZh.trim(),
          background: background.trim(),
          category,
          eraLayer,
          aliases: splitAliases(aliases),
          epithet: epithet.trim() || null,
          relationCount,
          requiredCharacterIds: Array.from(requiredIds),
          candidates: candidates.map((character) => ({
            id: character.id,
            nameZh: character.name_zh,
            epithet: character.epithet,
            bio: character.bio,
            category: character.category,
            eraLayer: character.era_layer,
          })),
        },
        {
          onProgress: setProgress,
          onDone: (result) => {
            setPreview(result);
            setAliases(Array.from(new Set([...splitAliases(aliases), ...result.profile.aliases])).join("、"));
            if (!epithet && result.profile.epithet) setEpithet(result.profile.epithet);
            setStep("preview");
          },
          onError: (generationError) => {
            setError(`${generationError.code}: ${generationError.message}`);
            setStep("form");
          },
        },
        controller.signal,
      );
    } catch (generationError) {
      if (generationError instanceof Error && generationError.name === "AbortError") return;
      setError(generationError instanceof Error ? generationError.message : String(generationError));
      setStep("form");
    }
  }

  function updateProfile(patch: Partial<GeneratedProfile>) {
    setPreview((current) => current ? { ...current, profile: { ...current.profile, ...patch } } : current);
  }

  function updateRelationship(index: number, patch: Partial<GeneratedRelationship>) {
    setPreview((current) => {
      if (!current) return current;
      const relationships = current.relationships.map((relationship, itemIndex) => (
        itemIndex === index ? { ...relationship, ...patch } : relationship
      ));
      return { ...current, relationships };
    });
  }

  async function confirmSave() {
    if (!preview) return;
    const formError = validateForm();
    if (formError) {
      setError(formError);
      return;
    }
    const duplicateTarget = preview.relationships.find((relationship, index) => (
      preview.relationships.findIndex((item) => item.targetId === relationship.targetId) !== index
    ));
    if (duplicateTarget) {
      setError("同一人物只能建立一条关系，请更换重复的关系对象");
      return;
    }
    const now = new Date().toISOString();
    const id = editingRecord?.id ?? createUserCharacterId(
      nameZh,
      new Set(dataset.characters.map((character) => character.id)),
    );
    const source = { work: preview.sourceWork, locus: null, translator: null };
    const record: UserCharacterRecord = {
      id,
      projectSlug: config.slug,
      scopeId,
      background: background.trim(),
      revision: (editingRecord?.revision ?? 0) + 1,
      createdAt: editingRecord?.createdAt ?? now,
      updatedAt: now,
      character: {
        schema_version: 3,
        id,
        name_zh: nameZh.trim(),
        name_en: preview.profile.nameEn.trim(),
        aliases: splitAliases(aliases),
        epithet: epithet.trim() || preview.profile.epithet,
        category,
        era_layer: eraLayer,
        bio: preview.profile.bio.trim(),
        events: preview.profile.events.map((event, index) => ({
          title: event.title.trim(),
          desc: event.desc.trim(),
          source: { ...source, locus: `第${index + 1}回` },
        })),
        quotes: [],
        weapons: preview.profile.weapons,
        skills: preview.profile.skills,
        domains: preview.profile.domains,
        mounts: preview.profile.mounts,
        portrait: editingRecord?.character.portrait ?? "",
        thumb: editingRecord?.character.thumb ?? "",
      },
      relations: preview.relationships.map((relationship, index) => ({
        schema_version: 3,
        id: `user:${id}:${relationship.targetId}`,
        source: id,
        target: relationship.targetId,
        primary_type: relationship.primaryType,
        composite_types: relationship.compositeTypes.filter((type) => type !== relationship.primaryType),
        events: [{
          title: relationship.title.trim(),
          desc: relationship.desc.trim(),
          source: {
            ...(buildUserEventCitation(dataset, relationship.targetId) ?? source),
            locus: `第${index + 1}回`,
          },
          era_order: eraLayer,
        }],
      })),
    };
    setSaving(true);
    setError(null);
    try {
      await onSave(record);
      setSaving(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
      setSaving(false);
    }
  }

  if (step === "generating") {
    return (
      <div style={editorRootStyle}>
        <EditorHeader title="AI 生成预览" onClose={() => {
          abortRef.current?.abort();
          setStep("form");
        }} />
        <div style={{ padding: "56px 0", textAlign: "center" }}>
          <div style={{ fontSize: 15, color: COLOR.text, marginBottom: 8 }}>{progressText(progress)}</div>
          <div style={{ fontSize: 12, color: COLOR.textMuted }}>完整结果通过校验后才会进入图谱</div>
          <button type="button" onClick={() => abortRef.current?.abort()} style={{ ...secondaryButtonStyle, marginTop: 20 }}>
            取消生成
          </button>
        </div>
      </div>
    );
  }

  if (step === "form") {
    return (
      <div style={editorRootStyle}>
        <EditorHeader title={editingRecord ? "修改人物设定" : "添加人物"} onClose={onCancel} />
        <label style={labelStyle}>人物姓名 *
          <input autoFocus value={nameZh} maxLength={40} onChange={(event) => setNameZh(event.target.value)} style={inputStyle} />
        </label>
        <label style={labelStyle}>背景假设 *
          <textarea value={background} maxLength={2000} rows={6} onChange={(event) => setBackground(event.target.value)} style={textareaStyle} />
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={labelStyle}>人物分类
            <select value={category} onChange={(event) => setCategory(event.target.value)} style={inputStyle}>
              {Object.entries(config.characterCategories).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}
            </select>
          </label>
          <label style={labelStyle}>时代层
            <select value={eraLayer} onChange={(event) => setEraLayer(Number(event.target.value))} style={inputStyle}>
              {Object.entries(config.eraLayers).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
        </div>
        <label style={labelStyle}>别名（用顿号或逗号分隔）
          <input value={aliases} maxLength={300} onChange={(event) => setAliases(event.target.value)} style={inputStyle} />
        </label>
        {aliasWarnings.length > 0 && <div style={warningStyle}>以下别名与已有名称重复：{aliasWarnings.join("、")}</div>}
        <label style={labelStyle}>称号
          <input value={epithet} maxLength={80} onChange={(event) => setEpithet(event.target.value)} style={inputStyle} />
        </label>
        <label style={labelStyle}>关系总数：{relationCount}
          <input
            type="range"
            min={countRange.min}
            max={countRange.max}
            value={relationCount}
            onChange={(event) => {
              const next = Number(event.target.value);
              setRelationCount(Math.max(next, requiredIds.size));
            }}
            disabled={countRange.max === 0}
            style={{ width: "100%", accentColor: COLOR.accent }}
          />
          <span style={{ fontSize: 10, color: COLOR.textMuted }}>
            可设置 {countRange.min}–{countRange.max} 条；未手选的名额由 LLM 补全
          </span>
        </label>
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, color: COLOR.text, marginBottom: 7 }}>手选必要关系人物（{requiredIds.size}/{relationCount}）</div>
          <input value={candidateQuery} placeholder="搜索人物" onChange={(event) => setCandidateQuery(event.target.value)} style={inputStyle} />
          <div style={candidateListStyle}>
            {filteredCandidates.map((character) => {
              const checked = requiredIds.has(character.id);
              return (
                <label key={character.id} style={candidateRowStyle}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && requiredIds.size >= relationCount}
                    onChange={() => setRequiredIds((previous) => {
                      const next = new Set(previous);
                      if (next.has(character.id)) next.delete(character.id);
                      else next.add(character.id);
                      return next;
                    })}
                  />
                  <span>{character.name_zh}</span>
                  <span style={{ color: COLOR.textMuted, fontSize: 10 }}>{character.epithet}</span>
                </label>
              );
            })}
          </div>
        </div>
        {error && <div role="alert" style={errorStyle}>{error}</div>}
        <div style={footerStyle}>
          <button type="button" onClick={onCancel} style={secondaryButtonStyle}>取消</button>
          <button type="button" onClick={generatePreview} style={primaryButtonStyle}>AI 生成预览</button>
        </div>
      </div>
    );
  }

  if (!preview) return null;
  return (
    <div style={editorRootStyle}>
      <EditorHeader title={editingRecord ? "修改预览" : "新增人物预览"} onClose={onCancel} />
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button type="button" onClick={() => setStep("form")} style={secondaryButtonStyle}>返回设定</button>
        <button type="button" onClick={generatePreview} style={secondaryButtonStyle}>重新生成</button>
      </div>
      <div style={{ fontSize: 11, color: COLOR.accent, marginBottom: 12 }}>用户新增 · 《{preview.sourceWork}》</div>
      <label style={labelStyle}>人物姓名
        <input value={nameZh} onChange={(event) => setNameZh(event.target.value)} style={inputStyle} />
      </label>
      <label style={labelStyle}>英文名
        <input value={preview.profile.nameEn} onChange={(event) => updateProfile({ nameEn: event.target.value })} style={inputStyle} />
      </label>
      <label style={labelStyle}>人物简介
        <textarea value={preview.profile.bio} rows={5} onChange={(event) => updateProfile({ bio: event.target.value })} style={textareaStyle} />
      </label>
      <PreviewListTitle title={`主要事件（${preview.profile.events.length}/10）`} />
      {preview.profile.events.map((event, index) => (
        <div key={index} style={previewItemStyle}>
          <button
            type="button"
            aria-label="删除事件"
            title="删除事件"
            onClick={() => updateProfile({ events: preview.profile.events.filter((_, itemIndex) => itemIndex !== index) })}
            style={iconButtonStyle}
          >×</button>
          <input value={event.title} onChange={(change) => updateProfile({
            events: preview.profile.events.map((item, itemIndex) => itemIndex === index ? { ...item, title: change.target.value } : item),
          })} style={inputStyle} />
          <textarea value={event.desc} rows={3} onChange={(change) => updateProfile({
            events: preview.profile.events.map((item, itemIndex) => itemIndex === index ? { ...item, desc: change.target.value } : item),
          })} style={textareaStyle} />
        </div>
      ))}
      {preview.profile.events.length < 10 && (
        <button type="button" onClick={() => updateProfile({
          events: [...preview.profile.events, { title: "新事件", desc: "" }],
        })} style={dashedButtonStyle}>＋ 添加事件</button>
      )}
      <PreviewListTitle title={`人物关系（${preview.relationships.length}）`} />
      {preview.relationships.map((relationship, index) => (
        <div key={`${relationship.targetId}-${index}`} style={previewItemStyle}>
          <button
            type="button"
            aria-label="删除关系"
            title="删除关系"
            onClick={() => setPreview({ ...preview, relationships: preview.relationships.filter((_, itemIndex) => itemIndex !== index) })}
            style={iconButtonStyle}
          >×</button>
          <select value={relationship.targetId} onChange={(event) => updateRelationship(index, { targetId: event.target.value })} style={inputStyle}>
            {candidates.map((character) => (
              <option key={character.id} value={character.id}>{character.name_zh}</option>
            ))}
          </select>
          <select value={relationship.primaryType} onChange={(event) => updateRelationship(index, { primaryType: event.target.value })} style={inputStyle}>
            {Object.entries(config.relationTypes).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}
          </select>
          <input value={relationship.title} onChange={(event) => updateRelationship(index, { title: event.target.value })} style={inputStyle} />
          <textarea value={relationship.desc} rows={4} onChange={(event) => updateRelationship(index, { desc: event.target.value })} style={textareaStyle} />
        </div>
      ))}
      {error && <div role="alert" style={errorStyle}>{error}</div>}
      <div style={footerStyle}>
        <button type="button" onClick={onCancel} style={secondaryButtonStyle}>取消</button>
        <button type="button" disabled={saving} onClick={confirmSave} style={primaryButtonStyle}>
          {saving ? "正在保存…" : editingRecord ? "确认更新图谱" : "确认加入图谱"}
        </button>
      </div>
    </div>
  );
}

function EditorHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
      <h2 style={{ margin: 0, fontFamily: FONT.serif, fontSize: 20 }}>{title}</h2>
      <button type="button" aria-label="关闭" title="关闭" onClick={onClose} style={iconButtonStyle}>×</button>
    </div>
  );
}

function PreviewListTitle({ title }: { title: string }) {
  return <h3 style={{ margin: "22px 0 10px", fontSize: 12, color: COLOR.text, fontFamily: FONT.mono }}>{title}</h3>;
}

const editorRootStyle: React.CSSProperties = { color: COLOR.text, paddingBottom: 24 };
const labelStyle: React.CSSProperties = { display: "grid", gap: 5, marginTop: 12, color: COLOR.textMuted, fontSize: 11 };
const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 9px",
  border: `1px solid ${COLOR.border}`,
  borderRadius: 4,
  background: COLOR.bg,
  color: COLOR.text,
  fontSize: 12,
  fontFamily: FONT.sans,
};
const textareaStyle: React.CSSProperties = { ...inputStyle, resize: "vertical", lineHeight: 1.55 };
const secondaryButtonStyle: React.CSSProperties = {
  padding: "7px 12px",
  border: `1px solid ${COLOR.border}`,
  borderRadius: 4,
  background: "transparent",
  color: COLOR.textMuted,
  cursor: "pointer",
  fontSize: 11,
};
const primaryButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  borderColor: COLOR.accent,
  background: COLOR.accent,
  color: "#fff",
};
const footerStyle: React.CSSProperties = {
  position: "sticky",
  bottom: -20,
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  marginTop: 20,
  padding: "14px 0 20px",
  background: COLOR.bgPanel,
  borderTop: `1px solid ${COLOR.border}`,
};
const errorStyle: React.CSSProperties = { marginTop: 12, padding: 9, color: COLOR.accent, background: COLOR.bgRaised, fontSize: 11, lineHeight: 1.5 };
const warningStyle: React.CSSProperties = { marginTop: 5, color: "#9a6500", fontSize: 10, lineHeight: 1.5 };
const candidateListStyle: React.CSSProperties = { maxHeight: 190, overflowY: "auto", border: `1px solid ${COLOR.border}`, borderTop: 0 };
const candidateRowStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "18px 72px 1fr", alignItems: "center", minHeight: 34, padding: "0 8px", borderBottom: `1px solid ${COLOR.border}`, fontSize: 11 };
const previewItemStyle: React.CSSProperties = { position: "relative", display: "grid", gap: 7, marginBottom: 10, padding: 10, border: `1px solid ${COLOR.border}`, borderRadius: 6, background: COLOR.bgRaised };
const iconButtonStyle: React.CSSProperties = { width: 28, height: 28, padding: 0, border: `1px solid ${COLOR.border}`, borderRadius: "50%", background: COLOR.bgPanel, color: COLOR.textMuted, cursor: "pointer", fontSize: 17, lineHeight: 1 };
const dashedButtonStyle: React.CSSProperties = { ...secondaryButtonStyle, width: "100%", borderStyle: "dashed", color: COLOR.accent };
