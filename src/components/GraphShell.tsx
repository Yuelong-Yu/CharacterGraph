"use client";

/**
 * 主页面客户端壳：3D 图谱 + 互斥选择 + 模式切换 + 类别过滤 + 搜索过滤
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Artifact, Dataset, Character } from "@/schemas/character";
import type { ClientProjectConfig } from "@/schemas/projectConfig";
import { Graph3D, type LayoutMode } from "./Graph3D";
import { SearchBox } from "./SearchBox";
import { Legend } from "./Legend";
import { WhatIfPanel } from "./whatif/WhatIfPanel";
import { UserCharacterEditor } from "./UserCharacterEditor";
import { buildWhatIfGraphView } from "@/lib/whatif/graphView";
import {
  initialWhatIfWorkspaceState,
  whatIfWorkspaceReducer,
} from "@/lib/whatif/workspaceState";
import { ProjectConfigProvider } from "@/lib/projectConfig";
import { COLOR, FONT } from "@/lib/tokens";
import { entityMatchesSearch } from "@/lib/searchMatch";
import { applyCharacterImageOverrides } from "@/lib/characterImages";
import {
  fetchCharacterImageAssets,
  generateCharacterImage,
} from "@/lib/characterImageClient";
import type { CharacterImageAsset } from "@/schemas/characterImage";
import {
  buildUserEventCitation,
  mergeUserEvents,
  parseStoredUserEvents,
  type UserEventsByCharacter,
} from "@/lib/userEvents";
import {
  BASE_USER_CHARACTER_SCOPE,
  mergeUserCharacters,
  relationAdaptationsForCharacter,
  customDatasetOverlay,
  type UserCharacterRecord,
} from "@/lib/userCharacters";
import {
  createUserCharacterScope,
  deleteUserCharacterRecord,
  listUserCharacterScopes,
  loadOrInitializeUserCharacterScope,
  loadUserCharacterRecords,
  loadUserEvents,
  migrateBaseUserCharactersToScope,
  saveUserCharacterRecord,
  saveUserEvents,
  type UserCharacterScope,
} from "@/lib/userContentDb";
import {
  deleteUserCharacterHistory,
  fetchUserCharacterHistoryImpact,
  regenerateUserCharacterHistory,
  restoreUserCharacterHistory,
} from "@/lib/userCharacterClient";

type Selection =
  | { kind: "none" }
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string };

const SEARCH_TRIGGER_LEN = 2;

type SearchEntity = Character | Artifact;

interface CharacterImageJob {
  status: "generating" | "success" | "error";
  message?: string;
}

/**
 * 严格子串匹配:与 SearchBox.computeHits 同语义,仅返回 id 集。
 *
 * - <2 字符:返回 null 表示无过滤
 * - 范围:name_zh / name_en / aliases / epithet / bio / events.{title,desc} /
 *   quotes.text / skills / domains
 * - 中文按原样 includes,英文 lowercase 折叠；拼音仅匹配中文 name/alias
 */
function computeMatchedIds(items: SearchEntity[], rawQuery: string): Set<string> | null {
  const q = rawQuery.trim();
  if (q.length < SEARCH_TRIGGER_LEN) return null;
  const matched = new Set<string>();
  for (const item of items) {
    if (entityMatchesSearch(item, q)) {
      matched.add(item.id);
    }
  }
  return matched;
}

export function GraphShell({ dataset, config }: { dataset: Dataset; config: ClientProjectConfig }) {
  const allCategoryKeys = useMemo(() => Object.keys(config.characterCategories), [config]);
  const allArtifactCategoryKeys = useMemo(() => Object.keys(config.artifactCategories), [config]);

  const [sel, setSel] = useState<Selection>({ kind: "none" });
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("tier");
  const [enabledCategories, setEnabledCategories] = useState<Set<string>>(
    () => new Set(allCategoryKeys),
  );
  const [enabledArtifactCategories, setEnabledArtifactCategories] = useState<Set<string>>(
    () => new Set(allArtifactCategoryKeys),
  );
  const [minDegree, setMinDegree] = useState<number>(0);
  // 加载即进入巡游模式
  const [autoTour, setAutoTour] = useState<boolean>(true);

  // 搜索:draft = 输入中,committed = 已回车应用的 query
  // committed !== "" 时,Graph3D 进入"过滤平铺"态(filterMode)
  const [draftQuery, setDraftQuery] = useState<string>("");
  const [committedQuery, setCommittedQuery] = useState<string>("");

  // WhatIf 模式：假设事件没发生，LLM 推演 + 图谱动态变化
  const [whatIfWorkspace, dispatchWhatIf] = useReducer(
    whatIfWorkspaceReducer,
    initialWhatIfWorkspaceState,
  );
  const {
    config: whatIfConfig,
    turns: whatIfTurns,
    panelOpen: whatIfPanelOpen,
    activeBranchId,
  } = whatIfWorkspace;

  const userBranchStorageKey = `character-graph:${config.slug}:active-user-branch:v1`;
  const [localUserBranchId, setLocalUserBranchId] = useState<string | null>(null);
  const [userCharacterScopes, setUserCharacterScopes] = useState<UserCharacterScope[]>([]);
  const [userScopesReady, setUserScopesReady] = useState(false);
  const activeUserScopeId = activeBranchId ?? localUserBranchId ?? BASE_USER_CHARACTER_SCOPE;
  const userEventStorageKey = `character-graph:${config.slug}:user-events:v1`;
  const [userEvents, setUserEvents] = useState<UserEventsByCharacter>({});
  const [loadedUserEventKey, setLoadedUserEventKey] = useState<string | null>(null);
  const [userCharacterRecords, setUserCharacterRecords] = useState<UserCharacterRecord[]>([]);
  const [loadedUserScopeId, setLoadedUserScopeId] = useState<string | null>(null);
  const recordsRef = useRef<UserCharacterRecord[]>([]);
  const [userCharacterEditor, setUserCharacterEditor] = useState<{
    editingRecord: UserCharacterRecord | null;
  } | null>(null);
  const [deletedUserCharacter, setDeletedUserCharacter] = useState<{
    record: UserCharacterRecord;
    branchId: string | null;
    turnIds: string[];
  } | null>(null);
  const [historyRefreshVersion, setHistoryRefreshVersion] = useState(0);
  const [characterImageAssets, setCharacterImageAssets] = useState<Map<string, CharacterImageAsset>>(new Map());
  const [characterImageJobs, setCharacterImageJobs] = useState<Record<string, CharacterImageJob>>({});

  useEffect(() => {
    recordsRef.current = userCharacterRecords;
  }, [userCharacterRecords]);

  useEffect(() => {
    let cancelled = false;
    setUserScopesReady(false);
    const now = new Date().toISOString();
    const migrationScope: UserCharacterScope = {
      id: `user-branch:${typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
      projectSlug: config.slug,
      kind: "user-branch",
      title: "用户改编分支",
      createdAt: now,
      updatedAt: now,
    };
    migrateBaseUserCharactersToScope(config.slug, migrationScope)
      .then(async (migratedRecords) => {
        if (migratedRecords.length > 0) {
          window.localStorage.setItem(userBranchStorageKey, migrationScope.id);
        }
        const scopes = await listUserCharacterScopes(config.slug);
        if (cancelled) return;
        const storedBranchId = window.localStorage.getItem(userBranchStorageKey);
        const migratedScope = migratedRecords.length > 0
          ? scopes.find((scope) => scope.id === migrationScope.id) ?? migrationScope
          : null;
        const nextBranchId = migratedScope?.id
          ?? (storedBranchId && scopes.some((scope) => scope.id === storedBranchId) ? storedBranchId : null);
        setUserCharacterScopes(scopes);
        setLocalUserBranchId(nextBranchId);
        if (nextBranchId) window.localStorage.setItem(userBranchStorageKey, nextBranchId);
        else window.localStorage.removeItem(userBranchStorageKey);
        setUserScopesReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setLocalUserBranchId(null);
        setUserCharacterScopes([]);
        setUserScopesReady(true);
      });
    return () => { cancelled = true; };
  }, [config.slug, userBranchStorageKey]);

  useEffect(() => {
    let cancelled = false;
    const legacy = (() => {
      try {
        const raw = window.localStorage.getItem(userEventStorageKey);
        return raw ? parseStoredUserEvents(JSON.parse(raw)) : {};
      } catch {
        return {};
      }
    })();
    loadUserEvents(config.slug, legacy)
      .then((stored) => {
        if (cancelled) return;
        setUserEvents(stored);
        setLoadedUserEventKey(userEventStorageKey);
      })
      .catch(() => {
        if (cancelled) return;
        setUserEvents(legacy);
        setLoadedUserEventKey(userEventStorageKey);
      });
    return () => { cancelled = true; };
  }, [config.slug, userEventStorageKey]);

  useEffect(() => {
    if (loadedUserEventKey !== userEventStorageKey) return;
    void saveUserEvents(config.slug, userEvents).catch(() => {
      // IndexedDB 不可用时仍保留当前页面状态。
    });
  }, [config.slug, loadedUserEventKey, userEventStorageKey, userEvents]);

  useEffect(() => {
    if (!userScopesReady) return;
    let cancelled = false;
    const load = activeUserScopeId === BASE_USER_CHARACTER_SCOPE
      ? loadUserCharacterRecords(config.slug, activeUserScopeId)
      : loadOrInitializeUserCharacterScope(config.slug, activeUserScopeId, recordsRef.current);
    load.then((records) => {
      if (cancelled) return;
      setUserCharacterRecords(records);
      setLoadedUserScopeId(activeUserScopeId);
      setUserCharacterEditor(null);
    }).catch(() => {
      if (cancelled) return;
      setUserCharacterRecords([]);
      setLoadedUserScopeId(activeUserScopeId);
    });
    return () => { cancelled = true; };
  }, [activeUserScopeId, config.slug, userScopesReady]);

  const datasetWithUserCharacters = useMemo(
    () => mergeUserCharacters(dataset, userCharacterRecords),
    [dataset, userCharacterRecords],
  );
  const datasetWithUserEvents = useMemo(
    () => mergeUserEvents(datasetWithUserCharacters, userEvents),
    [datasetWithUserCharacters, userEvents],
  );
  const userDatasetOverlay = useMemo(() => {
    const custom = customDatasetOverlay(userCharacterRecords);
    const changedCharacterIds = new Set([
      ...userCharacterRecords.map((record) => record.id),
      ...Object.keys(userEvents),
    ]);
    return {
      characters: datasetWithUserEvents.characters.filter((character) => changedCharacterIds.has(character.id)),
      relations: custom.relations,
    };
  }, [datasetWithUserEvents.characters, userCharacterRecords, userEvents]);

  const whatIfGraphView = useMemo(() => {
    if (!whatIfConfig || whatIfTurns.length === 0) return null;
    return buildWhatIfGraphView(datasetWithUserEvents, whatIfTurns, {
      scope: whatIfPanelOpen ? "changes" : "all",
    });
  }, [datasetWithUserEvents, whatIfConfig, whatIfPanelOpen, whatIfTurns]);
  const effectiveDatasetWithoutImages = whatIfGraphView?.dataset ?? datasetWithUserEvents;
  const effectiveDataset = useMemo(
    () => applyCharacterImageOverrides(effectiveDatasetWithoutImages, characterImageAssets),
    [effectiveDatasetWithoutImages, characterImageAssets],
  );
  const isWhatIfChangeView = Boolean(whatIfGraphView && whatIfPanelOpen);

  const searchItems = useMemo(
    () => [
      ...effectiveDataset.characters.map((entity) => ({ kind: "character" as const, entity })),
      ...effectiveDataset.artifacts.map((entity) => ({ kind: "artifact" as const, entity })),
    ],
    [effectiveDataset.characters, effectiveDataset.artifacts],
  );

  // 已应用的命中集 — 仅由 committedQuery 计算,驱动 3D 过滤平铺
  const matchedIds = useMemo(
    () => computeMatchedIds(
      [...effectiveDataset.characters, ...effectiveDataset.artifacts],
      committedQuery,
    ),
    [effectiveDataset.characters, effectiveDataset.artifacts, committedQuery],
  );

  const handleSearchChange = (q: string) => {
    setDraftQuery(q);
    // 输入与已 commit 不一致 → 撤销 commit(让"修改输入"自动回到全图,避免错位)
    if (q.trim() !== committedQuery.trim()) {
      setCommittedQuery("");
    }
  };
  const handleSearchSubmit = (q: string) => {
    setCommittedQuery(q);
    // 进入过滤平铺态 — 退出 focus mode、关闭已选
    setFocusedId(null);
    setSel({ kind: "none" });
  };
  const handleSearchClear = () => {
    setDraftQuery("");
    setCommittedQuery("");
  };
  // 下拉选某项 = 进入单焦点(focus mode)
  const handleSearchPick = (id: string) => {
    setDraftQuery("");
    setCommittedQuery("");
    setSel({ kind: "node", id });
    setFocusId(id);
    setFocusedId(id);
  };

  // 计算每个节点的度数 + 最大度数（用于滑动条上限）
  const degreeInfo = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of effectiveDataset.characters) m.set(c.id, 0);
    for (const a of effectiveDataset.artifacts) m.set(a.id, 0);
    for (const r of effectiveDataset.relations) {
      m.set(r.source, (m.get(r.source) ?? 0) + 1);
      m.set(r.target, (m.get(r.target) ?? 0) + 1);
    }
    const max = Math.max(0, ...Array.from(m.values()));
    return { map: m, max };
  }, [effectiveDataset]);

  const character = sel.kind === "node"
    ? effectiveDataset.characters.find((c) => c.id === sel.id)
    : null;
  const selectedUserCharacterRecord = character
    ? userCharacterRecords.find((record) => record.id === character.id) ?? null
    : null;
  const userAddedNodeIds = useMemo(
    () => new Set(userCharacterRecords.map((record) => record.id)),
    [userCharacterRecords],
  );
  const activeImageBranchId = activeBranchId ?? localUserBranchId;
  const activeImageBranchRef = useRef(activeImageBranchId);
  activeImageBranchRef.current = activeImageBranchId;
  const imageEligibleIds = useMemo(() => {
    const ids = new Set(userAddedNodeIds);
    for (const [id, change] of whatIfGraphView?.nodeChanges ?? []) {
      if (change === "added") ids.add(id);
    }
    return [...ids].sort();
  }, [userAddedNodeIds, whatIfGraphView?.nodeChanges]);
  const imageEligibleKey = imageEligibleIds.join("\u0001");

  useEffect(() => {
    setCharacterImageAssets(new Map());
  }, [activeImageBranchId]);

  useEffect(() => {
    let cancelled = false;
    const characterIds = imageEligibleKey ? imageEligibleKey.split("\u0001") : [];
    if (!activeImageBranchId || characterIds.length === 0) {
      return () => { cancelled = true; };
    }
    void fetchCharacterImageAssets({
      projectSlug: config.slug,
      branchId: activeImageBranchId,
      characterIds,
    }).then((assets) => {
      if (cancelled) return;
      setCharacterImageAssets(new Map(
        Object.entries(assets).filter((entry): entry is [string, CharacterImageAsset] => Boolean(entry[1])),
      ));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [activeImageBranchId, config.slug, imageEligibleKey]);

  const selectedImageEligible = Boolean(
    character
    && activeImageBranchId
    && (selectedUserCharacterRecord || whatIfGraphView?.nodeChanges.get(character.id) === "added"),
  );
  const selectedImageJobKey = character && activeImageBranchId
    ? `${activeImageBranchId}\u0000${character.id}`
    : null;
  const selectedImageJob = selectedImageJobKey ? characterImageJobs[selectedImageJobKey] : undefined;

  async function handleGenerateCharacterImage(target: Character) {
    if (!activeImageBranchId) return;
    const taskBranchId = activeImageBranchId;
    const jobKey = `${taskBranchId}\u0000${target.id}`;
    if (characterImageJobs[jobKey]?.status === "generating") return;
    const regenerate = Boolean(target.portrait);
    if (regenerate && !window.confirm("重新生成会产生模型费用，并覆盖当前分支中的人物形象。确认继续？")) {
      return;
    }
    setCharacterImageJobs((current) => ({
      ...current,
      [jobKey]: { status: "generating" },
    }));
    try {
      const record = userCharacterRecords.find((candidate) => candidate.id === target.id) ?? null;
      const asset = await generateCharacterImage({
        projectSlug: config.slug,
        branchId: taskBranchId,
        character: target,
        background: record?.background,
        regenerate,
      });
      if (activeImageBranchRef.current === taskBranchId) {
        setCharacterImageAssets((current) => new Map(current).set(target.id, asset));
      }
      if (record) {
        const updated = {
          ...record,
          updatedAt: new Date().toISOString(),
          character: {
            ...record.character,
            portrait: asset.portrait,
            thumb: asset.thumb,
          },
        } satisfies UserCharacterRecord;
        await saveUserCharacterRecord(updated);
        if (activeImageBranchRef.current === taskBranchId) {
          setUserCharacterRecords((current) => current.map((candidate) => (
            candidate.id === updated.id ? updated : candidate
          )));
        }
      }
      setCharacterImageJobs((current) => ({
        ...current,
        [jobKey]: { status: "success", message: "人物形象已生成" },
      }));
    } catch (error) {
      setCharacterImageJobs((current) => ({
        ...current,
        [jobKey]: {
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        },
      }));
    }
  }
  const selectedCharacterAdaptations = useMemo(
    () => character
      ? relationAdaptationsForCharacter(userCharacterRecords, character.id, character.events)
      : [],
    [character, userCharacterRecords],
  );
  const selectedMainEventItems = useMemo(() => {
    if (!character) return [];
    return [
      ...character.events.map((event, index) => ({
        key: `character:${index}:${event.title}`,
        event,
        adaptation: null,
      })),
      ...selectedCharacterAdaptations.map((adaptation) => ({
        key: `adaptation:${adaptation.relationId}:${adaptation.event.title}`,
        event: adaptation.event,
        adaptation,
      })),
    ];
  }, [character, selectedCharacterAdaptations]);
  const artifact = sel.kind === "node"
    ? effectiveDataset.artifacts.find((a) => a.id === sel.id)
    : null;
  const nodeById = useMemo(
    () => new Map([...effectiveDataset.characters, ...effectiveDataset.artifacts].map((n) => [n.id, n])),
    [effectiveDataset.characters, effectiveDataset.artifacts],
  );
  const relation = sel.kind === "edge"
    ? effectiveDataset.relations.find((r) => r.id === sel.id)
    : null;
  const relChars = relation
    ? {
        source: nodeById.get(relation.source),
        target: nodeById.get(relation.target),
      }
    : null;

  // 节点点击：
  //   - 过滤平铺态:仅打开右侧详情面板,不进入 focus mode(保留多分量展示)
  //   - 普通态:首次=进入聚焦+打开详情；再次点同一节点=退出聚焦+关闭详情
  const handleNodeClick = (id: string) => {
    if (matchedIds) {
      // 过滤平铺态
      setSel({ kind: "node", id });
      return;
    }
    if (focusedId === id) {
      setFocusedId(null);
      setSel({ kind: "none" });
    } else {
      setFocusedId(id);
      setSel({ kind: "node", id });
    }
  };

  // 点击空白:
  //   - 过滤态下仅关闭详情(保留过滤)
  //   - 普通态:退出聚焦+关闭一切
  const handleBackground = () => {
    if (!matchedIds) setFocusedId(null);
    setSel({ kind: "none" });
  };

  // 点击边：仅选中，不影响聚焦态
  const handleEdgeClick = (id: string) => setSel({ kind: "edge", id });

  const handleExitWhatIf = () => {
    dispatchWhatIf({ type: "exit" });
    setFocusedId(null);
    setSel({ kind: "none" });
  };

  const activateLocalUserBranch = (branchId: string | null) => {
    setLocalUserBranchId(branchId);
    if (branchId) window.localStorage.setItem(userBranchStorageKey, branchId);
    else window.localStorage.removeItem(userBranchStorageKey);
    setFocusedId(null);
    setFocusId(null);
    setSel({ kind: "none" });
  };

  const handleWhatIfTurnsChange = useCallback((turns: typeof whatIfTurns) => {
    dispatchWhatIf({ type: "set-turns", turns });
  }, []);

  const handleActiveBranchChange = useCallback((branchId: string | null) => {
    dispatchWhatIf({ type: "set-active-branch", branchId });
  }, []);

  const saveUserCharacter = async (record: UserCharacterRecord) => {
    if (loadedUserScopeId !== activeUserScopeId) {
      throw new Error("人物分支仍在载入，请稍后重试");
    }
    const previous = userCharacterRecords.find((item) => item.id === record.id);
    let persistedRecord = record;
    let createdScope: UserCharacterScope | null = null;
    if (!previous && !activeBranchId && activeUserScopeId === BASE_USER_CHARACTER_SCOPE) {
      const now = new Date().toISOString();
      createdScope = {
        id: `user-branch:${typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
        projectSlug: config.slug,
        kind: "user-branch",
        title: `人物改编：${record.character.name_zh}`,
        createdAt: now,
        updatedAt: now,
      };
      persistedRecord = { ...record, scopeId: createdScope.id };
    }
    const nextRecords = previous
      ? userCharacterRecords.map((item) => item.id === record.id ? persistedRecord : item)
      : [...userCharacterRecords, persistedRecord];
    let impactCount = 0;
    if (previous && activeBranchId) {
      const impact = await fetchUserCharacterHistoryImpact(activeBranchId, record.id);
      impactCount = impact.count;
      if (!window.confirm(
        impactCount > 0
          ? `此次修改会影响当前分支的 ${impactCount} 条推演。确认保存并立即用豆包重新推演？`
          : "当前分支没有引用该人物的推演。确认保存修改？",
      )) return;
    }
    if (createdScope) {
      await createUserCharacterScope(createdScope, [persistedRecord]);
      setUserCharacterScopes((scopes) => [createdScope!, ...scopes]);
      setLoadedUserScopeId(createdScope.id);
      activateLocalUserBranch(createdScope.id);
    } else {
      await saveUserCharacterRecord(persistedRecord);
    }
    setUserCharacterRecords(nextRecords);
    setDeletedUserCharacter(null);
    if (previous && activeBranchId && impactCount > 0) {
      try {
        const custom = customDatasetOverlay(nextRecords);
        const nextDataset = mergeUserEvents(mergeUserCharacters(dataset, nextRecords), userEvents);
        const changedIds = new Set([...nextRecords.map((item) => item.id), ...Object.keys(userEvents)]);
        await regenerateUserCharacterHistory({
          projectSlug: config.slug,
          branchId: activeBranchId,
          characterId: persistedRecord.id,
          datasetOverlay: {
            characters: nextDataset.characters.filter((character) => changedIds.has(character.id)),
            relations: custom.relations,
          },
        });
        setHistoryRefreshVersion((version) => version + 1);
      } catch (historyError) {
        setHistoryRefreshVersion((version) => version + 1);
        throw new Error(`人物已保存，但部分推演待重试：${historyError instanceof Error ? historyError.message : String(historyError)}`);
      }
    }
    setUserCharacterEditor(null);
    setSel({ kind: "node", id: persistedRecord.id });
    setFocusId(persistedRecord.id);
    setFocusedId(persistedRecord.id);
  };

  const removeUserCharacter = async (record: UserCharacterRecord) => {
    const impact = activeBranchId
      ? await fetchUserCharacterHistoryImpact(activeBranchId, record.id)
      : { count: 0, turnIds: [] };
    const message = [
      `确定删除「${record.character.name_zh}」？`,
      `将同时移除 ${record.character.events.length} 条人物事件和 ${record.relations.length} 条人物关系。`,
      `当前分支中 ${impact.count} 条受影响推演也会被删除。`,
    ].join("\n");
    if (!window.confirm(message)) return;
    await deleteUserCharacterRecord(record.projectSlug, record.scopeId, record.id);
    const turnIds = activeBranchId
      ? await deleteUserCharacterHistory({
          projectSlug: config.slug,
          branchId: activeBranchId,
          characterId: record.id,
        })
      : [];
    if (turnIds.length > 0) setHistoryRefreshVersion((version) => version + 1);
    setUserCharacterRecords((records) => records.filter((item) => item.id !== record.id));
    setDeletedUserCharacter({ record, branchId: activeBranchId, turnIds });
    setSel({ kind: "none" });
    setFocusedId(null);
  };

  const undoUserCharacterDelete = async () => {
    if (!deletedUserCharacter) return;
    await saveUserCharacterRecord(deletedUserCharacter.record);
    if (deletedUserCharacter.branchId && deletedUserCharacter.turnIds.length > 0) {
      await restoreUserCharacterHistory({
        projectSlug: config.slug,
        branchId: deletedUserCharacter.branchId,
        characterId: deletedUserCharacter.record.id,
        turnIds: deletedUserCharacter.turnIds,
      });
      setHistoryRefreshVersion((version) => version + 1);
    }
    setUserCharacterRecords((records) => [...records, deletedUserCharacter.record]);
    setDeletedUserCharacter(null);
  };

  const addUserEvent = (characterId: string, title: string, desc: string): string | null => {
    const normalizedTitle = title.trim();
    const normalizedDesc = desc.trim();
    const currentCharacter = datasetWithUserEvents.characters.find((item) => item.id === characterId);
    if (currentCharacter?.events.some((event) => event.title.trim() === normalizedTitle)) {
      return "该人物已存在同名事件";
    }

    const id = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `user-event-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const entry = {
      id,
      event: {
        title: normalizedTitle,
        desc: normalizedDesc,
        source: buildUserEventCitation(datasetWithUserCharacters, characterId),
      },
    };
    setUserEvents((previous) => ({
      ...previous,
      [characterId]: [...(previous[characterId] ?? []), entry],
    }));
    return null;
  };

  const removeUserEvent = (characterId: string, eventId: string) => {
    setUserEvents((previous) => {
      const entries = (previous[characterId] ?? []).filter((entry) => entry.id !== eventId);
      const next = { ...previous };
      if (entries.length > 0) next[characterId] = entries;
      else delete next[characterId];
      return next;
    });
  };

  // 类别勾选
  const toggleCategory = (cat: string) => {
    setEnabledCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };
  const allCategories = () => setEnabledCategories(new Set(allCategoryKeys));
  const noCategories = () => setEnabledCategories(new Set());

  const toggleArtifactCategory = (cat: string) => {
    setEnabledArtifactCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };
  const allArtifactCategories = () => setEnabledArtifactCategories(new Set(allArtifactCategoryKeys));
  const noArtifactCategories = () => setEnabledArtifactCategories(new Set());

  // 缓存 set 给 Graph3D 用，避免每次 render 都重建依赖
  const enabledSet = useMemo(() => enabledCategories, [enabledCategories]);
  const enabledArtifactSet = useMemo(() => enabledArtifactCategories, [enabledArtifactCategories]);

  return (
    <ProjectConfigProvider config={config}>
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 380px",
        height: "100vh",
        background: COLOR.bg,
        color: COLOR.text,
        fontFamily: FONT.sans,
      }}
    >
      <div style={{ borderRight: `1px solid ${COLOR.border}`, position: "relative" }}>
        {whatIfConfig && (
          <div
            style={{
              position: "absolute",
              top: 16,
              right: 66,
              zIndex: 30,
              display: "flex",
              gap: 8,
            }}
          >
            <button
              onClick={() => dispatchWhatIf({
                type: whatIfPanelOpen ? "hide-panel" : "show-panel",
              })}
              style={{
                height: 38,
                padding: "0 12px",
                border: `1px solid ${COLOR.accent}`,
                borderRadius: 6,
                background: COLOR.bgPanel,
                color: COLOR.accent,
                cursor: "pointer",
                fontSize: 12,
                fontFamily: FONT.sans,
                whiteSpace: "nowrap",
              }}
            >
              {whatIfPanelOpen ? "隐藏推演面板" : "打开推演面板"}
            </button>
            <button
              onClick={handleExitWhatIf}
              style={{
                height: 38,
                padding: "0 12px",
                border: `1px solid ${COLOR.border}`,
                borderRadius: 6,
                background: COLOR.bgPanel,
                color: COLOR.textMuted,
                cursor: "pointer",
                fontSize: 12,
                fontFamily: FONT.sans,
                whiteSpace: "nowrap",
              }}
            >
              退出分支版本
            </button>
          </div>
        )}
        {!whatIfConfig && localUserBranchId && (
          <div
            style={{
              position: "absolute",
              top: 16,
              right: 66,
              zIndex: 30,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span style={{ color: COLOR.textMuted, fontSize: 11, whiteSpace: "nowrap" }}>
              {userCharacterScopes.find((scope) => scope.id === localUserBranchId)?.title ?? "用户改编分支"}
            </span>
            <button
              type="button"
              onClick={() => activateLocalUserBranch(null)}
              style={{
                height: 38,
                padding: "0 12px",
                border: `1px solid ${COLOR.border}`,
                borderRadius: 6,
                background: COLOR.bgPanel,
                color: COLOR.textMuted,
                cursor: "pointer",
                fontSize: 12,
                fontFamily: FONT.sans,
                whiteSpace: "nowrap",
              }}
            >
              退出分支版本
            </button>
          </div>
        )}
        {!isWhatIfChangeView && (
          <SearchBox
            items={searchItems}
            query={draftQuery}
            onQueryChange={handleSearchChange}
            onPick={handleSearchPick}
            onSubmitFilter={handleSearchSubmit}
            onClear={handleSearchClear}
            filterApplied={matchedIds !== null}
            appliedCount={matchedIds?.size ?? 0}
            totalCount={effectiveDataset.characters.length + effectiveDataset.artifacts.length}
            rightOffset={whatIfConfig ? 283 : localUserBranchId ? 270 : 16}
          />
        )}
        <Legend
          enabledCategories={enabledSet}
          enabledArtifactCategories={enabledArtifactSet}
          onCategoryToggle={toggleCategory}
          onCategoriesAll={allCategories}
          onCategoriesNone={noCategories}
          onArtifactCategoryToggle={toggleArtifactCategory}
          onArtifactCategoriesAll={allArtifactCategories}
          onArtifactCategoriesNone={noArtifactCategories}
        />
        <LayoutToggle value={layoutMode} onChange={setLayoutMode} />
        {!isWhatIfChangeView && (
          <>
            <AutoTourToggle value={autoTour} onChange={setAutoTour} />
            <DegreeSlider
              value={minDegree}
              max={degreeInfo.max}
              onChange={setMinDegree}
              visibleCount={
                Array.from(degreeInfo.map.entries()).filter(([, d]) => d >= minDegree).length
              }
              total={effectiveDataset.characters.length + effectiveDataset.artifacts.length}
            />
          </>
        )}
        <Graph3D
          dataset={effectiveDataset}
          whatIfNodeChanges={whatIfGraphView?.nodeChanges ?? null}
          userAddedNodeIds={userAddedNodeIds}
          bypassFilters={isWhatIfChangeView}
          layoutMode={layoutMode}
          selectedNodeId={sel.kind === "node" ? sel.id : null}
          selectedEdgeId={sel.kind === "edge" ? sel.id : null}
          focusedId={isWhatIfChangeView ? null : focusedId}
          focusNodeId={focusId}
          enabledCategories={enabledSet}
          enabledArtifactCategories={enabledArtifactSet}
          minDegree={minDegree}
          matchedIds={isWhatIfChangeView ? null : matchedIds}
          autoTour={isWhatIfChangeView ? false : autoTour}
          onNodeSelect={handleNodeClick}
          onEdgeSelect={handleEdgeClick}
          onBackgroundClick={handleBackground}
        />
      </div>

      <aside
        style={{
          background: COLOR.bgPanel,
          padding: 20,
          overflowY: "auto",
          borderLeft: `1px solid ${COLOR.border}`,
        }}
      >
        {deletedUserCharacter && !userCharacterEditor && (
          <div
            role="status"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
              padding: "9px 10px",
              marginBottom: 14,
              border: `1px solid ${COLOR.border}`,
              background: COLOR.bgRaised,
              fontSize: 11,
            }}
          >
            已删除「{deletedUserCharacter.record.character.name_zh}」
            <button type="button" onClick={undoUserCharacterDelete} style={userEventSecondaryButtonStyle}>撤销</button>
          </div>
        )}

        {userCharacterEditor && (
          <UserCharacterEditor
            key={`${activeUserScopeId}:${userCharacterEditor.editingRecord?.id ?? "new"}`}
            dataset={effectiveDataset}
            config={config}
            scopeId={activeUserScopeId}
            editingRecord={userCharacterEditor.editingRecord}
            onCancel={() => setUserCharacterEditor(null)}
            onSave={saveUserCharacter}
          />
        )}

        {!userCharacterEditor && sel.kind === "none" && (
          <div style={{ color: COLOR.textMuted, fontSize: 13, lineHeight: 1.7 }}>
            <div style={{ fontFamily: FONT.serif, fontSize: 22, color: COLOR.text, marginBottom: 10 }}>
              {config.title}
            </div>
            {config.subtitle && <>{config.subtitle}<br /></>}
            点击节点查看详情，点击边查看二者之间的事件链。
            <div style={{ marginTop: 16, fontSize: 12 }}>
              · 鼠标拖动：旋转视角<br />
              · 滚轮：缩放<br />
              · 拖动节点：移动节点位置<br />
              · 左下角：切换分层 / 自由布局
            </div>
            <div style={{ marginTop: 24, fontSize: 12 }}>
              数据：{effectiveDataset.characters.length} 人 · {effectiveDataset.artifacts.length} 件神器 · {effectiveDataset.relations.length} 条关系
            </div>
            {!localUserBranchId && userCharacterScopes.length > 0 && (
              <div style={{ marginTop: 22, paddingTop: 16, borderTop: `1px solid ${COLOR.border}` }}>
                <div style={{ color: COLOR.text, fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                  人物改编分支
                </div>
                {userCharacterScopes.map((scope) => (
                  <button
                    key={scope.id}
                    type="button"
                    onClick={() => activateLocalUserBranch(scope.id)}
                    style={{
                      width: "100%",
                      padding: "8px 0",
                      border: "none",
                      borderTop: `1px solid ${COLOR.border}`,
                      background: "transparent",
                      color: COLOR.accent,
                      cursor: "pointer",
                      textAlign: "left",
                      fontSize: 12,
                      fontFamily: FONT.sans,
                    }}
                  >
                    {scope.title}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => setUserCharacterEditor({ editingRecord: null })}
              style={{
                width: "100%",
                marginTop: 18,
                padding: "9px 12px",
                border: `1px solid ${COLOR.accent}`,
                borderRadius: 4,
                background: COLOR.accent,
                color: "#fff",
                cursor: "pointer",
                fontSize: 12,
                fontFamily: FONT.sans,
              }}
            >
              ＋ 添加人物
            </button>
          </div>
        )}

        {!userCharacterEditor && character && (
          <div>
            <div
              style={{
                width: "100%",
                aspectRatio: "2 / 3",
                background: COLOR.bgRaised,
                borderRadius: 8,
                overflow: "hidden",
                marginBottom: 16,
                position: "relative",
                border: `1px solid ${COLOR.border}`,
              }}
            >
              {character.portrait ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={character.portrait}
                  alt={character.name_zh}
                  loading="lazy"
                  decoding="async"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                    animation: "fadeIn 400ms ease-out",
                  }}
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : (
                <div style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 24,
                  fontFamily: FONT.serif,
                  fontSize: 72,
                  color: COLOR.textMuted,
                  background: "#eee9e1",
                }}>
                  <span>{character.name_zh.slice(0, 1)}</span>
                  {selectedImageEligible && selectedImageJob?.status !== "generating" && (
                    <button
                      type="button"
                      onClick={() => void handleGenerateCharacterImage(character)}
                      style={{
                        padding: "9px 14px",
                        border: `1px solid ${COLOR.accent}`,
                        borderRadius: 4,
                        background: COLOR.bgPanel,
                        color: COLOR.accent,
                        cursor: "pointer",
                        fontFamily: FONT.sans,
                        fontSize: 12,
                      }}
                    >
                      生成形象
                    </button>
                  )}
                </div>
              )}
              {selectedImageEligible && character.portrait && selectedImageJob?.status !== "generating" && (
                <button
                  type="button"
                  title="重新生成形象"
                  onClick={() => void handleGenerateCharacterImage(character)}
                  style={{
                    position: "absolute",
                    top: 10,
                    right: 10,
                    width: 34,
                    height: 34,
                    display: "grid",
                    placeItems: "center",
                    padding: 0,
                    border: "1px solid rgba(255,255,255,0.78)",
                    borderRadius: 4,
                    background: "rgba(20,20,20,0.72)",
                    color: "#fff",
                    cursor: "pointer",
                    fontFamily: FONT.sans,
                    fontSize: 18,
                  }}
                  aria-label="重新生成形象"
                >
                  ↻
                </button>
              )}
              {selectedImageJob?.status === "generating" && (
                <div
                  role="status"
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "grid",
                    placeItems: "center",
                    background: "rgba(245,242,237,0.86)",
                    color: COLOR.text,
                    fontFamily: FONT.sans,
                    fontSize: 13,
                  }}
                >
                  形象生成中…
                </div>
              )}
              <style>{`@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }`}</style>
            </div>
            {selectedImageJob?.status === "error" && (
              <div role="alert" style={{ color: COLOR.accent, fontSize: 11, lineHeight: 1.5, marginTop: -8, marginBottom: 14 }}>
                {selectedImageJob.message}
              </div>
            )}
            {selectedImageJob?.status === "success" && (
              <div role="status" style={{ color: "#477a52", fontSize: 11, marginTop: -8, marginBottom: 14 }}>
                {selectedImageJob.message}
              </div>
            )}

            {/* 1. 人名 */}
            <div style={{ fontFamily: FONT.serif, fontSize: 28, fontWeight: 600 }}>
              {character.name_zh}
            </div>
            <div style={{ fontFamily: FONT.mono, fontSize: 11, color: COLOR.textMuted, letterSpacing: "0.1em" }}>
              {character.name_en}
            </div>
            {selectedUserCharacterRecord && (
              <div style={{ marginTop: 10 }}>
                <span style={{ display: "inline-block", padding: "3px 7px", border: "2px solid #d92d20", color: "#b42318", fontSize: 10 }}>
                  用户新增
                </span>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button
                    type="button"
                    onClick={() => setUserCharacterEditor({ editingRecord: selectedUserCharacterRecord })}
                    style={userEventSecondaryButtonStyle}
                  >
                    编辑人物
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeUserCharacter(selectedUserCharacterRecord)}
                    style={{ ...userEventSecondaryButtonStyle, color: COLOR.accent, borderColor: COLOR.accent }}
                  >
                    删除人物
                  </button>
                </div>
              </div>
            )}

            {/* 2. 一句话人物概要（用 epithet） */}
            {character.epithet && (
              <div
                style={{
                  marginTop: 10,
                  paddingTop: 10,
                  borderTop: `1px solid ${COLOR.border}`,
                  fontStyle: "italic",
                  color: COLOR.accent,
                  fontSize: 15,
                  lineHeight: 1.5,
                }}
              >
                {character.epithet}
              </div>
            )}

            {/* 3. 名言 */}
            <Section
              title="名言"
              items={character.quotes.length === 0
                ? <em style={{ color: COLOR.textMuted, fontSize: 12 }}>史料无记载</em>
                : character.quotes.map((q, i) => (
                    <blockquote key={i} style={{ borderLeft: `2px solid ${COLOR.accent}`, paddingLeft: 12, margin: "0 0 12px 0" }}>
                      <div style={{ fontFamily: FONT.serif, fontSize: 14, lineHeight: 1.6 }}>{q.text}</div>
                      <div style={{ fontFamily: FONT.mono, fontSize: 10, color: COLOR.textMuted, marginTop: 4 }}>
                        —— 《{q.source.work}》{q.source.locus ?? ""}
                      </div>
                    </blockquote>
                  ))}
            />

            {/* 4. 武器 */}
            <KVRow label="武器" values={character.weapons} />

            {/* 5. 技能 */}
            <KVRow label="技能" values={character.skills} />

            {/* 6+7. 神职 / 领域（单一字段，合并显示） */}
            <KVRow label="神职/领域" values={character.domains} />

            {/* 坐骑（保留，原先已有） */}
            <KVRow label="坐骑" values={character.mounts} />

            {/* 8. 人物简介 */}
            {character.bio && (
              <Section
                title="人物简介"
                items={<p style={{ lineHeight: 1.75, fontSize: 14, margin: 0 }}>{character.bio}</p>}
              />
            )}

            {/* 9. 主要事件 */}
            <Section
              title="主要事件"
              items={(
                <>
                  {selectedMainEventItems.map(({ key, event, adaptation }) => {
                    const userEntry = !adaptation ? userEvents[character.id]?.find(
                      (entry) => entry.event.title === event.title,
                    ) : undefined;
                    const other = adaptation
                      ? effectiveDataset.characters.find((item) => item.id === adaptation.otherCharacterId)
                      : null;
                    const shouldContinueFromEvent = Boolean(
                      userEntry || adaptation || event.source?.work.endsWith("-改编"),
                    );
                    return (
                      <div key={key} style={{ marginBottom: 18 }}>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                          <strong style={{ color: COLOR.accent, fontSize: 13, flex: 1 }}>
                            {event.title}
                          </strong>
                          {userEntry && (
                            <button
                              type="button"
                              aria-label={`删除事件：${event.title}`}
                              title="删除此自定义事件"
                              onClick={() => removeUserEvent(character.id, userEntry.id)}
                              style={{
                                width: 22,
                                height: 22,
                                padding: 0,
                                border: "none",
                                background: "transparent",
                                color: COLOR.textMuted,
                                cursor: "pointer",
                                fontSize: 16,
                                lineHeight: 1,
                              }}
                            >
                              ×
                            </button>
                          )}
                        </div>
                        {adaptation && (
                          <div style={{ marginTop: 3, fontSize: 11, color: COLOR.textMuted }}>
                            与 {other?.name_zh ?? adaptation.otherCharacterId}
                          </div>
                        )}
                        <div style={{ fontSize: 13, color: COLOR.textMuted, marginTop: 4, lineHeight: 1.6 }}>
                          {event.desc}
                        </div>
                        {event.source && (
                          <div style={{ fontFamily: FONT.mono, fontSize: 10, color: COLOR.textMuted, marginTop: 4 }}>
                            《{event.source.work}》{event.source.locus ?? ""}
                          </div>
                        )}
                        <button
                          onClick={() => {
                            dispatchWhatIf({
                              type: "launch",
                              config: {
                                projectSlug: config.slug,
                                characterId: character.id,
                                characterName: character.name_zh,
                                eventTitle: event.title,
                                premise: shouldContinueFromEvent
                                  ? `假设${character.name_zh}经历了「${event.title}」：${event.desc}`
                                  : `如果${character.name_zh}没有「${event.title}」`,
                                premiseType: shouldContinueFromEvent ? "free_text" : "event_negative",
                              },
                            });
                          }}
                          style={{
                            marginTop: 6,
                            padding: "3px 8px",
                            fontSize: 11,
                            background: "transparent",
                            color: COLOR.accent,
                            border: `1px solid ${COLOR.accent}`,
                            borderRadius: 3,
                            cursor: "pointer",
                            opacity: 0.7,
                          }}
                          onMouseEnter={(ev) => (ev.currentTarget.style.opacity = "1")}
                          onMouseLeave={(ev) => (ev.currentTarget.style.opacity = "0.7")}
                        >
                          {shouldContinueFromEvent ? "⚡ 基于此事件推演" : "⚡ 假设这件事没发生"}
                        </button>
                      </div>
                    );
                  })}
                  <AddUserEventForm
                    key={character.id}
                    onAdd={(title, desc) => addUserEvent(character.id, title, desc)}
                  />
                </>
              )}
            />
          </div>
        )}

        {!userCharacterEditor && artifact && (
          <div>
            <div
              style={{
                width: "100%",
                aspectRatio: "2 / 3",
                background: COLOR.bgRaised,
                borderRadius: 8,
                overflow: "hidden",
                marginBottom: 16,
                position: "relative",
                border: `1px solid ${COLOR.border}`,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={artifact.portrait}
                alt={artifact.name_zh}
                loading="lazy"
                decoding="async"
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  display: "block",
                  animation: "fadeIn 400ms ease-out",
                }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            </div>

            <div style={{ fontFamily: FONT.serif, fontSize: 28, fontWeight: 600 }}>
              {artifact.name_zh}
            </div>
            <div style={{ fontFamily: FONT.mono, fontSize: 11, color: COLOR.textMuted, letterSpacing: "0.1em" }}>
              {artifact.name_en} · {artifact.category.toUpperCase()}
            </div>

            {artifact.epithet && (
              <div
                style={{
                  marginTop: 10,
                  paddingTop: 10,
                  borderTop: `1px solid ${COLOR.border}`,
                  fontStyle: "italic",
                  color: COLOR.accent,
                  fontSize: 15,
                  lineHeight: 1.5,
                }}
              >
                {artifact.epithet}
              </div>
            )}

            <Section
              title="拥有/使用者"
              items={effectiveDataset.relations
                .filter((r) => r.target === artifact.id)
                .map((r) => effectiveDataset.characters.find((c) => c.id === r.source))
                .filter((owner): owner is Character => Boolean(owner))
                .map((owner) => (
                  <button
                    key={owner.id}
                    onClick={() => {
                      setSel({ kind: "node", id: owner.id });
                      setFocusId(owner.id);
                      setFocusedId(owner.id);
                    }}
                    style={{
                      display: "inline-block",
                      margin: "0 8px 8px 0",
                      padding: "6px 10px",
                      borderRadius: 999,
                      border: `1px solid ${COLOR.border}`,
                      background: COLOR.bgRaised,
                      color: COLOR.text,
                      fontFamily: FONT.sans,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    {owner.name_zh}
                  </button>
                ))}
            />

            <KVRow label="象征/领域" values={artifact.domains} />

            {artifact.bio && (
              <Section
                title="宝物简介"
                items={<p style={{ lineHeight: 1.75, fontSize: 14, margin: 0 }}>{artifact.bio}</p>}
              />
            )}

            <Section
              title="关键事件"
              items={artifact.events.map((e) => (
                <div key={e.title} style={{ marginBottom: 12 }}>
                  <strong style={{ color: COLOR.accent, fontSize: 13 }}>{e.title}</strong>
                  <div style={{ fontSize: 13, color: COLOR.textMuted, marginTop: 4, lineHeight: 1.6 }}>
                    {e.desc}
                  </div>
                  {e.source && (
                    <div style={{ fontFamily: FONT.mono, fontSize: 10, color: COLOR.textMuted, marginTop: 4 }}>
                      《{e.source.work}》{e.source.locus ?? ""}
                    </div>
                  )}
                </div>
              ))}
            />
          </div>
        )}

        {!userCharacterEditor && relation && relChars && (
          <div>
            <div style={{ fontFamily: FONT.serif, fontSize: 20, marginBottom: 4 }}>
              {relChars.source?.name_zh} ↔ {relChars.target?.name_zh}
            </div>
            <div style={{ fontFamily: FONT.mono, fontSize: 11, color: COLOR.textMuted }}>
              {relation.primary_type.toUpperCase()}
              {relation.composite_types.length > 0 && (
                <span> + {relation.composite_types.join(", ")}</span>
              )}
            </div>
            <Section title="事件时间线" items={relation.events.map((e, i) => (
              <div key={i} style={{ marginBottom: 14 }}>
                <strong style={{ color: COLOR.accent, fontSize: 13 }}>{e.title}</strong>
                <div style={{ fontSize: 13, color: COLOR.textMuted, marginTop: 4, lineHeight: 1.6 }}>
                  {e.desc}
                </div>
                {e.source && (
                  <div style={{ fontFamily: FONT.mono, fontSize: 10, color: COLOR.textMuted, marginTop: 4 }}>
                    《{e.source.work}》{e.source.locus ?? ""}
                  </div>
                )}
              </div>
            ))} />
          </div>
        )}
      </aside>

      {whatIfConfig && (
        <WhatIfPanel
          isOpen={whatIfPanelOpen}
          projectSlug={whatIfConfig.projectSlug}
          characterId={whatIfConfig.characterId}
          characterName={whatIfConfig.characterName}
          eventTitle={whatIfConfig.eventTitle}
          premise={whatIfConfig.premise}
          premiseType={whatIfConfig.premiseType}
          onClose={() => dispatchWhatIf({ type: "hide-panel" })}
          onTurnsChange={handleWhatIfTurnsChange}
          onActiveBranchChange={handleActiveBranchChange}
          datasetOverlay={userDatasetOverlay}
          historyRefreshVersion={historyRefreshVersion}
        />
      )}
    </div>
    </ProjectConfigProvider>
  );
}

function AddUserEventForm({
  onAdd,
}: {
  onAdd: (title: string, desc: string) => string | null;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setOpen(false);
    setTitle("");
    setDesc("");
    setError(null);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          width: "100%",
          padding: "8px 10px",
          border: `1px dashed ${COLOR.border}`,
          borderRadius: 4,
          background: "transparent",
          color: COLOR.accent,
          cursor: "pointer",
          fontSize: 12,
          fontFamily: FONT.sans,
        }}
      >
        ＋ 添加事件
      </button>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim() || !desc.trim()) {
          setError("请填写事件标题和内容");
          return;
        }
        const addError = onAdd(title, desc);
        if (addError) {
          setError(addError);
          return;
        }
        reset();
      }}
      style={{
        paddingTop: 12,
        borderTop: `1px solid ${COLOR.border}`,
      }}
    >
      <label style={userEventLabelStyle}>
        事件标题
        <input
          autoFocus
          value={title}
          maxLength={60}
          onChange={(event) => {
            setTitle(event.target.value);
            setError(null);
          }}
          style={userEventInputStyle}
        />
      </label>
      <label style={{ ...userEventLabelStyle, marginTop: 10 }}>
        事件内容
        <textarea
          value={desc}
          maxLength={500}
          rows={4}
          onChange={(event) => {
            setDesc(event.target.value);
            setError(null);
          }}
          style={{ ...userEventInputStyle, resize: "vertical", lineHeight: 1.55 }}
        />
      </label>
      {error && (
        <div role="alert" style={{ marginTop: 8, color: COLOR.accent, fontSize: 11 }}>
          {error}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
        <button type="button" onClick={reset} style={userEventSecondaryButtonStyle}>
          取消
        </button>
        <button type="submit" style={userEventPrimaryButtonStyle}>
          添加
        </button>
      </div>
    </form>
  );
}

const userEventLabelStyle: React.CSSProperties = {
  display: "grid",
  gap: 5,
  color: COLOR.textMuted,
  fontSize: 11,
};

const userEventInputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 9px",
  border: `1px solid ${COLOR.border}`,
  borderRadius: 4,
  background: COLOR.bg,
  color: COLOR.text,
  fontSize: 12,
  fontFamily: FONT.sans,
  outline: "none",
};

const userEventSecondaryButtonStyle: React.CSSProperties = {
  padding: "6px 12px",
  border: `1px solid ${COLOR.border}`,
  borderRadius: 4,
  background: "transparent",
  color: COLOR.textMuted,
  cursor: "pointer",
  fontSize: 11,
};

const userEventPrimaryButtonStyle: React.CSSProperties = {
  ...userEventSecondaryButtonStyle,
  border: `1px solid ${COLOR.accent}`,
  background: COLOR.accent,
  color: "#fff",
};

function Section({ title, items }: { title: string; items: React.ReactNode }) {
  return (
    <div style={{ marginTop: 24 }}>
      <h3 style={{
        fontFamily: FONT.mono,
        fontSize: 11,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: COLOR.textMuted,
        margin: "0 0 12px 0",
      }}>{title}</h3>
      <div>{items}</div>
    </div>
  );
}

function KVRow({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <span style={{
        fontFamily: FONT.mono,
        fontSize: 10,
        color: COLOR.textMuted,
        letterSpacing: "0.15em",
        textTransform: "uppercase",
        marginRight: 8,
      }}>{label}</span>
      <span style={{ fontSize: 13 }}>{values.join(" · ")}</span>
    </div>
  );
}

function LayoutToggle({
  value,
  onChange,
}: { value: LayoutMode; onChange: (v: LayoutMode) => void }) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 20,
        left: 20,
        zIndex: 20,
        background: "oklch(99% 0 0 / 0.92)",
        border: `1px solid ${COLOR.border}`,
        borderRadius: 8,
        padding: 4,
        display: "flex",
        gap: 2,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
      }}
    >
      <ToggleBtn active={value === "tier"} onClick={() => onChange("tier")}>
        代际分层
      </ToggleBtn>
      <ToggleBtn active={value === "free"} onClick={() => onChange("free")}>
        自由布局
      </ToggleBtn>
    </div>
  );
}

function ToggleBtn({
  active,
  onClick,
  children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 14px",
        background: active ? COLOR.text : "transparent",
        color: active ? COLOR.bg : COLOR.textMuted,
        border: "none",
        borderRadius: 5,
        fontSize: 12,
        fontFamily: FONT.sans,
        cursor: "pointer",
        transition: "background 150ms, color 150ms",
      }}
    >
      {children}
    </button>
  );
}

function AutoTourToggle({
  value,
  onChange,
}: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 20,
        left: 220,
        zIndex: 20,
        background: "oklch(99% 0 0 / 0.92)",
        border: `1px solid ${COLOR.border}`,
        borderRadius: 8,
        padding: 4,
        display: "flex",
        gap: 2,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
      }}
    >
      <button
        onClick={() => onChange(!value)}
        title={value ? "暂停自动巡游" : "开始自动旋转 + 轮播"}
        style={{
          padding: "6px 14px",
          background: value ? COLOR.accent : "transparent",
          color: value ? "#fff" : COLOR.textMuted,
          border: "none",
          borderRadius: 5,
          fontSize: 12,
          fontFamily: FONT.sans,
          cursor: "pointer",
          transition: "background 150ms, color 150ms",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span style={{ fontSize: 10 }}>{value ? "●" : "○"}</span>
        {value ? "自动巡游中" : "开始自动巡游"}
      </button>
    </div>
  );
}

function DegreeSlider({
  value,
  max,
  onChange,
  visibleCount,
  total,
}: {
  value: number;
  max: number;
  onChange: (v: number) => void;
  visibleCount: number;
  total: number;
}) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 76,
        left: 20,
        zIndex: 20,
        background: "oklch(99% 0 0 / 0.92)",
        border: `1px solid ${COLOR.border}`,
        borderRadius: 8,
        padding: "10px 14px",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
        width: 240,
        fontFamily: FONT.sans,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontFamily: FONT.mono,
            fontSize: 10,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: COLOR.textMuted,
          }}
        >
          最少连接边数
        </span>
        <span
          style={{
            fontFamily: FONT.mono,
            fontSize: 12,
            color: COLOR.text,
            fontWeight: 600,
          }}
        >
          ≥ {value}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: "100%",
          accentColor: COLOR.accent,
          cursor: "pointer",
        }}
      />
      <div
        style={{
          marginTop: 4,
          fontSize: 10,
          color: COLOR.textMuted,
          fontFamily: FONT.mono,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>0</span>
        <span>
          {visibleCount}/{total} 节点可见
        </span>
        <span>{max}</span>
      </div>
    </div>
  );
}
