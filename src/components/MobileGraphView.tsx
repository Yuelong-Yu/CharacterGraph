"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ImgHTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import type { SessionUser } from "@/lib/auth";
import { buildMobileDeck, filterMobileDeck, moveInMobileDeck } from "@/lib/mobileDeck";
import {
  lockMobileSwipeAxis,
  resolveMobileCardSwipe,
  type MobileSwipeAxis,
} from "@/lib/mobileSwipe";
import type { UserCharacterRecord } from "@/lib/userCharacters";
import type { UserEventsByCharacter } from "@/lib/userEvents";
import type { WhatIfLaunchConfig } from "@/lib/whatif/workspaceState";
import type { ClientProjectConfig } from "@/schemas/projectConfig";
import type { Character, CharacterEvent, Dataset, Relation } from "@/schemas/character";
import { SearchBox } from "./SearchBox";
import "./mobileGraph.css";

type MobileNode =
  | { id: string; kind: "character"; entity: Character }
  | { id: string; kind: "artifact"; entity: Dataset["artifacts"][number] };

export interface MobileCharacterEventItem {
  key: string;
  event: CharacterEvent;
  shouldContinue: boolean;
  otherName?: string | null;
}

interface MobileImageJob {
  status: "generating" | "success" | "error";
  message?: string;
}

interface Props {
  dataset: Dataset;
  config: ClientProjectConfig;
  selectedId: string | null;
  onSelectNode: (id: string) => void;
  draftQuery: string;
  matchedIds: Set<string> | null;
  onSearchChange: (query: string) => void;
  onSearchPick: (id: string) => void;
  onSearchSubmit: (query: string) => void;
  onSearchClear: () => void;
  accountUser: SessionUser | null | undefined;
  userCharacterRecords: UserCharacterRecord[];
  userEvents: UserEventsByCharacter;
  characterEventItems: MobileCharacterEventItem[];
  onLaunchWhatIf: (config: WhatIfLaunchConfig) => void;
  onAddUserEvent: (characterId: string, title: string, desc: string) => Promise<string | null>;
  onRemoveUserEvent: (characterId: string, eventId: string) => Promise<void>;
  onCreateCharacter: () => void;
  onEditCharacter: (record: UserCharacterRecord) => void;
  onDeleteCharacter: (record: UserCharacterRecord) => Promise<void>;
  onGenerateCharacterImage: (character: Character) => Promise<void>;
  imageEligible: boolean;
  imageJob?: MobileImageJob;
  branchLabel?: string | null;
  onOpenBranches?: () => void;
  onExitBranch?: () => void;
  whatIfActive?: boolean;
  onOpenWhatIf?: () => void;
  onExitWhatIf?: () => void;
}

const SWIPE_TRANSITION_MS = 220;
const IDENTITY_TRANSITION_MS = 150;
const SHEET_THRESHOLD = 52;

type MobileGesture =
  | {
      axis: MobileSwipeAxis;
      kind: "card";
      startedAt: number;
      x: number;
      y: number;
    }
  | {
      kind: "identity";
      x: number;
      y: number;
    };

function nodeImage(node: MobileNode): string {
  return node.entity.portrait || node.entity.thumb;
}

function MobileCardImage({
  node,
  alt,
}: {
  node: MobileNode;
  alt: string;
}) {
  const portrait = node.entity.portrait;
  const fallback = node.entity.thumb || portrait;
  const hasProgressivePortrait = Boolean(portrait && fallback && portrait !== fallback);
  const [portraitReady, setPortraitReady] = useState(!hasProgressivePortrait);
  const portraitRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setPortraitReady(!hasProgressivePortrait);
    const image = portraitRef.current;
    if (hasProgressivePortrait && image?.complete && image.naturalWidth > 0) {
      setPortraitReady(true);
    }
  }, [hasProgressivePortrait, portrait]);

  if (!fallback) {
    return <span className="mobile-card-placeholder">{node.entity.name_zh.slice(0, 1)}</span>;
  }

  const eagerImageProps: Pick<
    ImgHTMLAttributes<HTMLImageElement>,
    "decoding" | "draggable" | "loading"
  > = {
    decoding: "async",
    draggable: false,
    loading: "eager",
  };

  return (
    <>
      {/* The tiny node-specific thumb replaces the previous card immediately. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        {...eagerImageProps}
        className="mobile-card-image mobile-card-image-fallback"
        src={fallback}
        alt={hasProgressivePortrait ? "" : alt}
        aria-hidden={hasProgressivePortrait || undefined}
      />
      {hasProgressivePortrait && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          {...eagerImageProps}
          ref={portraitRef}
          className={`mobile-card-image mobile-card-image-portrait${portraitReady ? " is-ready" : ""}`}
          src={portrait}
          alt={alt}
          onLoad={() => setPortraitReady(true)}
        />
      )}
    </>
  );
}

export function MobileGraphView({
  dataset,
  config,
  selectedId,
  onSelectNode,
  draftQuery,
  matchedIds,
  onSearchChange,
  onSearchPick,
  onSearchSubmit,
  onSearchClear,
  accountUser,
  userCharacterRecords,
  userEvents,
  characterEventItems,
  onLaunchWhatIf,
  onAddUserEvent,
  onRemoveUserEvent,
  onCreateCharacter,
  onEditCharacter,
  onDeleteCharacter,
  onGenerateCharacterImage,
  imageEligible,
  imageJob,
  branchLabel,
  onOpenBranches,
  onExitBranch,
  whatIfActive = false,
  onOpenWhatIf,
  onExitWhatIf,
}: Props) {
  const nodes = useMemo<MobileNode[]>(
    () => [
      ...dataset.characters.map((entity) => ({ id: entity.id, kind: "character" as const, entity })),
      ...dataset.artifacts.map((entity) => ({ id: entity.id, kind: "artifact" as const, entity })),
    ],
    [dataset.artifacts, dataset.characters],
  );
  const fullDeck = useMemo(
    () => buildMobileDeck({ nodes, relations: dataset.relations }),
    [dataset.relations, nodes],
  );
  const deck = useMemo(
    () => filterMobileDeck(fullDeck, matchedIds),
    [fullDeck, matchedIds],
  );
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const activeNode = selectedId ? nodeById.get(selectedId) ?? null : null;
  const [expanded, setExpanded] = useState(false);
  const [relationId, setRelationId] = useState<string | null>(null);
  const [dragY, setDragY] = useState(0);
  const [sheetDragY, setSheetDragY] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const [transitionDirection, setTransitionDirection] = useState<-1 | 1 | null>(null);
  const [dragging, setDragging] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [identityOutgoingNode, setIdentityOutgoingNode] = useState<MobileNode | null>(null);
  const gestureRef = useRef<MobileGesture | null>(null);
  const cardFrameRef = useRef<HTMLDivElement>(null);
  const cardStageRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const transitionTimerRef = useRef<number | null>(null);
  const identityTimerRef = useRef<number | null>(null);
  const preloadCacheRef = useRef(new Map<string, HTMLImageElement>());
  const initializedRef = useRef(false);
  const previousSelectedRef = useRef<string | null>(selectedId);
  const previousDeckIndexRef = useRef(0);
  const tutorialKey = `character-graph:${config.slug}:mobile-gesture-tutorial:v2`;
  const lastNodeKey = `character-graph:${config.slug}:mobile-last-node:v1`;

  useEffect(() => {
    if (initializedRef.current || fullDeck.length === 0) return;
    initializedRef.current = true;
    let restored: string | null = null;
    try {
      restored = window.localStorage.getItem(lastNodeKey);
    } catch {
      // Storage may be unavailable in privacy mode.
    }
    const initial = selectedId && fullDeck.some((node) => node.id === selectedId)
      ? selectedId
      : restored && fullDeck.some((node) => node.id === restored)
        ? restored
        : fullDeck[0]?.id;
    if (initial) onSelectNode(initial);
  }, [fullDeck, lastNodeKey, onSelectNode, selectedId]);

  useEffect(() => {
    if (!initializedRef.current || deck.length === 0) return;
    const currentIndex = selectedId ? deck.findIndex((node) => node.id === selectedId) : -1;
    if (currentIndex >= 0) {
      previousDeckIndexRef.current = currentIndex;
      return;
    }
    if (!selectedId || fullDeck.some((node) => node.id === selectedId)) {
      onSelectNode(deck[0].id);
      return;
    }
    onSelectNode(deck[previousDeckIndexRef.current % deck.length]?.id ?? deck[0].id);
  }, [deck, fullDeck, onSelectNode, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    try {
      window.localStorage.setItem(lastNodeKey, selectedId);
    } catch {
      // Storage may be unavailable in privacy mode.
    }
    if (previousSelectedRef.current && previousSelectedRef.current !== selectedId) {
      setExpanded(false);
      setRelationId(null);
      if (sheetRef.current) sheetRef.current.scrollTop = 0;
    }
    previousSelectedRef.current = selectedId;
  }, [lastNodeKey, selectedId]);

  useEffect(() => {
    if (!selectedId || deck.length === 0) return;
    const index = Math.max(0, deck.findIndex((node) => node.id === selectedId));
    const desiredUrls = new Set<string>();
    const queue = (url: string) => {
      if (!url || desiredUrls.has(url)) return;
      desiredUrls.add(url);
      if (preloadCacheRef.current.has(url)) return;
      const image = new Image();
      image.decoding = "async";
      image.src = url;
      preloadCacheRef.current.set(url, image);
      void image.decode?.().catch(() => {
        // Rendering still falls back to the regular load event.
      });
    };

    for (const offset of [-3, -2, -1, 0, 1, 2, 3]) {
      const node = deck[(index + offset + deck.length) % deck.length];
      if (node?.entity.thumb) queue(node.entity.thumb);
    }
    for (const offset of [-1, 0, 1]) {
      const node = deck[(index + offset + deck.length) % deck.length];
      if (node) queue(nodeImage(node));
    }

    for (const url of preloadCacheRef.current.keys()) {
      if (!desiredUrls.has(url)) preloadCacheRef.current.delete(url);
    }
  }, [deck, selectedId]);

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(tutorialKey)) setTutorialOpen(true);
    } catch {
      setTutorialOpen(true);
    }
  }, [tutorialKey]);

  useEffect(() => {
    const onPopState = () => {
      if (relationId) {
        setRelationId(null);
        return;
      }
      if (expanded) setExpanded(false);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [expanded, relationId]);

  useEffect(() => () => {
    if (transitionTimerRef.current !== null) window.clearTimeout(transitionTimerRef.current);
    if (identityTimerRef.current !== null) window.clearTimeout(identityTimerRef.current);
  }, []);

  const openDetails = () => {
    if (expanded) return;
    window.history.pushState({ characterGraphMobileLayer: "details" }, "");
    setExpanded(true);
  };
  const closeDetails = () => {
    if (!expanded) return;
    if (window.history.state?.characterGraphMobileLayer === "details") window.history.back();
    else setExpanded(false);
  };
  const openRelation = (id: string) => {
    window.history.pushState({ characterGraphMobileLayer: "relation" }, "");
    setRelationId(id);
  };
  const closeRelation = () => {
    if (window.history.state?.characterGraphMobileLayer === "relation") window.history.back();
    else setRelationId(null);
  };

  const dismissTutorial = () => {
    try {
      window.localStorage.setItem(tutorialKey, "seen");
    } catch {
      // Best-effort preference.
    }
    setTutorialOpen(false);
  };

  const move = (direction: -1 | 1) => {
    if (expanded || transitioning) return;
    const next = moveInMobileDeck(deck, selectedId, direction);
    if (!next || next.id === selectedId) {
      setDragY(0);
      return;
    }
    const cardHeight = Math.max(
      1,
      cardFrameRef.current?.clientHeight
        ?? cardStageRef.current?.clientHeight
        ?? window.innerHeight,
    );
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const transitionMs = reducedMotion ? 0 : SWIPE_TRANSITION_MS;
    setTransitioning(true);
    setTransitionDirection(direction);
    setDragY(direction > 0 ? -cardHeight : cardHeight);
    transitionTimerRef.current = window.setTimeout(() => {
      setIdentityOutgoingNode(reducedMotion ? null : activeNode);
      onSelectNode(next.id);
      setTransitioning(false);
      setTransitionDirection(null);
      setDragY(0);
      transitionTimerRef.current = null;
      if (identityTimerRef.current !== null) window.clearTimeout(identityTimerRef.current);
      identityTimerRef.current = window.setTimeout(() => {
        setIdentityOutgoingNode(null);
        identityTimerRef.current = null;
      }, reducedMotion ? 0 : IDENTITY_TRANSITION_MS);
    }, transitionMs);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (transitioning) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button,input,textarea,select,a,[role='button']")) {
      gestureRef.current = null;
      setDragging(false);
      return;
    }
    const startedInCard = Boolean(target.closest("[data-mobile-card]"));
    const startedInIdentity = Boolean(target.closest("[data-mobile-identity]"));
    if ((!startedInCard && !startedInIdentity) || (expanded && !startedInIdentity)) {
      gestureRef.current = null;
      setDragging(false);
      return;
    }
    setDragging(true);
    gestureRef.current = startedInCard
      ? {
          axis: "pending",
          kind: "card",
          startedAt: event.timeStamp,
          x: event.clientX,
          y: event.clientY,
        }
      : {
          kind: "identity",
          x: event.clientX,
          y: event.clientY,
        };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const start = gestureRef.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (start.kind === "identity" && Math.abs(dy) > Math.abs(dx) + 8) {
      if (!expanded && dy < 0) setSheetDragY(Math.max(dy, -220));
      if (expanded && dy > 0 && (sheetRef.current?.scrollTop ?? 0) <= 0) {
        setSheetDragY(Math.min(dy, 260));
      }
      return;
    }
    if (start.kind !== "card" || expanded) return;
    if (start.axis === "pending") start.axis = lockMobileSwipeAxis({ dx, dy });
    if (start.axis !== "vertical") return;
    if (event.cancelable) event.preventDefault();
    const cardHeight = Math.max(
      1,
      cardFrameRef.current?.clientHeight
        ?? cardStageRef.current?.clientHeight
        ?? window.innerHeight,
    );
    setDragY(Math.max(-cardHeight, Math.min(cardHeight, dy)));
  };
  const handlePointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const start = gestureRef.current;
    gestureRef.current = null;
    setDragging(false);
    if (!start) {
      setSheetDragY(0);
      return;
    }
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (start.kind === "card" && !expanded) {
      const axis = start.axis === "pending"
        ? lockMobileSwipeAxis({ dx, dy })
        : start.axis;
      const direction = resolveMobileCardSwipe({
        axis,
        dx,
        dy,
        elapsedMs: event.timeStamp - start.startedAt,
        stageHeight: Math.max(
          1,
          cardFrameRef.current?.clientHeight
            ?? cardStageRef.current?.clientHeight
            ?? window.innerHeight,
        ),
      });
      if (direction !== 0) {
        move(direction);
        return;
      }
      setDragY(0);
      setSheetDragY(0);
      return;
    }
    if (!expanded && start.kind === "identity" && dy <= -SHEET_THRESHOLD) {
      setDragY(0);
      setSheetDragY(0);
      openDetails();
      return;
    }
    if (
      expanded
      && start.kind === "identity"
      && dy >= SHEET_THRESHOLD
      && (sheetRef.current?.scrollTop ?? 0) <= 0
    ) {
      closeDetails();
    }
    setDragY(0);
    setSheetDragY(0);
  };

  const degreeById = useMemo(() => {
    const map = new Map(nodes.map((node) => [node.id, 0]));
    for (const relation of dataset.relations) {
      map.set(relation.source, (map.get(relation.source) ?? 0) + 1);
      map.set(relation.target, (map.get(relation.target) ?? 0) + 1);
    }
    return map;
  }, [dataset.relations, nodes]);

  const relationsForActive = useMemo(() => {
    if (!activeNode) return [];
    return dataset.relations
      .filter((relation) => relation.source === activeNode.id || relation.target === activeNode.id)
      .map((relation) => {
        const otherId = relation.source === activeNode.id ? relation.target : relation.source;
        return { relation, other: nodeById.get(otherId) ?? null };
      })
      .filter((item): item is { relation: Relation; other: MobileNode } => Boolean(item.other))
      .sort((a, b) => (
        b.relation.events.length - a.relation.events.length
        || (degreeById.get(b.other.id) ?? 0) - (degreeById.get(a.other.id) ?? 0)
        || a.other.id.localeCompare(b.other.id)
      ));
  }, [activeNode, dataset.relations, degreeById, nodeById]);

  const relation = relationId
    ? dataset.relations.find((candidate) => candidate.id === relationId) ?? null
    : null;

  const searchItems = useMemo(
    () => [
      ...dataset.characters.map((entity) => ({ kind: "character" as const, entity })),
      ...dataset.artifacts.map((entity) => ({ kind: "artifact" as const, entity })),
    ],
    [dataset.artifacts, dataset.characters],
  );
  const cardHeight = Math.max(
    1,
    cardFrameRef.current?.clientHeight
      ?? cardStageRef.current?.clientHeight
      ?? windowHeight(),
  );
  const swipeDirection = transitionDirection ?? (dragY < 0 ? 1 : dragY > 0 ? -1 : null);
  const incomingNode = swipeDirection
    ? moveInMobileDeck(deck, selectedId, swipeDirection)
    : null;
  const incomingY = swipeDirection ? dragY + swipeDirection * cardHeight : 0;

  if (!activeNode) {
    return (
      <div className="mobile-graph" style={mobileVariables}>
        <div className="mobile-fullscreen-body mobile-muted">
          {deck.length === 0 ? "没有可展示的搜索结果" : "正在准备人物卡…"}
        </div>
      </div>
    );
  }

  return (
    <div
      className="mobile-graph"
      style={mobileVariables}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        gestureRef.current = null;
        setDragging(false);
        setDragY(0);
        setSheetDragY(0);
      }}
    >
      <div className="mobile-graph-toolbar" onPointerDown={(event) => event.stopPropagation()}>
        <SearchBox
          items={searchItems}
          query={draftQuery}
          onQueryChange={onSearchChange}
          onPick={onSearchPick}
          onSubmitFilter={onSearchSubmit}
          onClear={onSearchClear}
          filterApplied={matchedIds !== null}
          appliedCount={matchedIds?.size ?? 0}
          totalCount={nodes.length}
          mobile
        />
        {onOpenBranches && (
          <button className="mobile-graph-icon-button" type="button" onClick={onOpenBranches} aria-label="打开私人分支">
            分
          </button>
        )}
        <button className="mobile-graph-icon-button" type="button" onClick={onCreateCharacter} aria-label="添加人物">
          ＋
        </button>
        {expanded && (
          <button className="mobile-graph-icon-button" type="button" onClick={closeDetails} aria-label="收回人物详情">
            {activeNode.entity.thumb || activeNode.entity.portrait ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="mobile-graph-thumb" src={activeNode.entity.thumb || activeNode.entity.portrait} alt="" width={40} height={40} />
            ) : activeNode.entity.name_zh.slice(0, 1)}
          </button>
        )}
      </div>

      {(branchLabel || whatIfActive) && (
        <div className="mobile-branch-chip" onPointerDown={(event) => event.stopPropagation()}>
          <span>{whatIfActive ? "推演分支" : branchLabel}</span>
          {whatIfActive && onOpenWhatIf && <button type="button" onClick={onOpenWhatIf}>打开推演</button>}
          {whatIfActive && onExitWhatIf && <button type="button" onClick={onExitWhatIf}>退出</button>}
          {!whatIfActive && onExitBranch && <button type="button" onClick={onExitBranch}>退出</button>}
        </div>
      )}

      <div ref={cardStageRef} className="mobile-card-stage">
        <div
          key={`active:${activeNode.id}`}
          className={`mobile-card-portrait${transitioning ? " is-transitioning" : ""}`}
          data-swipe-card="active"
          style={{
            transform: `translate3d(0,${dragY}px,0)`,
            transition: dragging && gestureRef.current?.kind === "card" ? "none" : undefined,
          }}
        >
          <div ref={cardFrameRef} className="mobile-card-portrait-frame" data-mobile-card>
            <MobileCardImage
              key={activeNode.id}
              node={activeNode}
              alt={activeNode.entity.name_zh}
            />
          </div>
        </div>
        {incomingNode && incomingNode.id !== activeNode.id && (
          <div
            key={`incoming:${incomingNode.id}`}
            aria-hidden="true"
            className={`mobile-card-portrait mobile-card-incoming${transitioning ? " is-transitioning" : ""}`}
            data-swipe-card="incoming"
            style={{
              transform: `translate3d(0,${incomingY}px,0)`,
              transition: dragging && gestureRef.current?.kind === "card" ? "none" : undefined,
            }}
          >
            <div className="mobile-card-portrait-frame">
              <MobileCardImage
                key={incomingNode.id}
                node={incomingNode}
                alt=""
              />
            </div>
          </div>
        )}
      </div>

      <div
        ref={sheetRef}
        className={`mobile-detail-sheet${expanded ? " expanded" : ""}`}
        style={{
          transform: `translate3d(0,${sheetDragY}px,0)`,
          transition: gestureRef.current && sheetDragY !== 0 ? "none" : undefined,
        }}
      >
        <div
          className="mobile-detail-identity"
          data-mobile-identity
          onClick={() => { if (!expanded) openDetails(); }}
        >
          <div className="mobile-detail-handle" />
          <div className="mobile-detail-identity-copy">
            <div
              key={activeNode.id}
              className="mobile-detail-identity-content mobile-detail-identity-content-in"
            >
              <div className="mobile-detail-name">{activeNode.entity.name_zh}</div>
              {activeNode.entity.epithet && <div className="mobile-detail-epithet">{activeNode.entity.epithet}</div>}
            </div>
            {identityOutgoingNode && identityOutgoingNode.id !== activeNode.id && (
              <div
                aria-hidden="true"
                className="mobile-detail-identity-content mobile-detail-identity-content-out"
              >
                <div className="mobile-detail-name">{identityOutgoingNode.entity.name_zh}</div>
                {identityOutgoingNode.entity.epithet && (
                  <div className="mobile-detail-epithet">{identityOutgoingNode.entity.epithet}</div>
                )}
              </div>
            )}
          </div>
        </div>

        {expanded && (
          <div className="mobile-detail-body">
            {activeNode.kind === "character" ? (
              <CharacterDetails
                accountUser={accountUser}
                character={activeNode.entity}
                eventItems={characterEventItems}
                imageEligible={imageEligible}
                imageJob={imageJob}
                projectSlug={config.slug}
                relations={relationsForActive}
                userEvents={userEvents}
                userRecord={userCharacterRecords.find((record) => record.id === activeNode.id) ?? null}
                onAddUserEvent={onAddUserEvent}
                onDeleteCharacter={onDeleteCharacter}
                onEditCharacter={onEditCharacter}
                onGenerateCharacterImage={onGenerateCharacterImage}
                onLaunchWhatIf={onLaunchWhatIf}
                onOpenRelation={openRelation}
                onRemoveUserEvent={onRemoveUserEvent}
              />
            ) : (
              <ArtifactDetails
                artifact={activeNode.entity}
                relations={relationsForActive}
                onOpenRelation={openRelation}
              />
            )}
          </div>
        )}
      </div>

      {relation && (
        <RelationOverlay
          relation={relation}
          nodeById={nodeById}
          onClose={closeRelation}
          onSelectNode={(id) => {
            setRelationId(null);
            setExpanded(false);
            onSelectNode(id);
            if (window.history.state?.characterGraphMobileLayer === "relation") {
              window.history.go(-2);
            }
          }}
        />
      )}

      {tutorialOpen && (
        <div className="mobile-tutorial" onPointerDown={(event) => event.stopPropagation()}>
          <div className="mobile-tutorial-demo"><span className="mobile-tutorial-hand" /></div>
          <p>画像上滑看下一张，下滑回到上一张<br />人物栏上拉查看详情，下拉收回卡片</p>
          <button type="button" onClick={dismissTutorial}>开始探索</button>
        </div>
      )}
    </div>
  );
}

function CharacterDetails({
  accountUser,
  character,
  eventItems,
  imageEligible,
  imageJob,
  projectSlug,
  relations,
  userEvents,
  userRecord,
  onAddUserEvent,
  onDeleteCharacter,
  onEditCharacter,
  onGenerateCharacterImage,
  onLaunchWhatIf,
  onOpenRelation,
  onRemoveUserEvent,
}: {
  accountUser: SessionUser | null | undefined;
  character: Character;
  eventItems: MobileCharacterEventItem[];
  imageEligible: boolean;
  imageJob?: MobileImageJob;
  projectSlug: string;
  relations: Array<{ relation: Relation; other: MobileNode }>;
  userEvents: UserEventsByCharacter;
  userRecord: UserCharacterRecord | null;
  onAddUserEvent: Props["onAddUserEvent"];
  onDeleteCharacter: Props["onDeleteCharacter"];
  onEditCharacter: Props["onEditCharacter"];
  onGenerateCharacterImage: Props["onGenerateCharacterImage"];
  onLaunchWhatIf: Props["onLaunchWhatIf"];
  onOpenRelation: (id: string) => void;
  onRemoveUserEvent: Props["onRemoveUserEvent"];
}) {
  return (
    <>
      <div className="mobile-meta">{character.name_en} · {character.category}</div>

      {userRecord && (
        <div className="mobile-action-row">
          <button className="mobile-action" type="button" onClick={() => onEditCharacter(userRecord)}>编辑人物</button>
          <button className="mobile-action danger" type="button" onClick={() => void onDeleteCharacter(userRecord)}>删除人物</button>
        </div>
      )}

      {imageEligible && (
        <div className="mobile-action-row">
          <button
            className="mobile-action"
            disabled={imageJob?.status === "generating"}
            type="button"
            onClick={() => void onGenerateCharacterImage(character)}
          >
            {imageJob?.status === "generating" ? "形象生成中…" : character.portrait ? "重新生成人物形象" : "生成人物形象"}
          </button>
          {imageJob?.message && <span className="mobile-muted">{imageJob.message}</span>}
        </div>
      )}

      <MobileSection title="名言">
        {character.quotes.length === 0 ? (
          <em className="mobile-muted">史料无记载</em>
        ) : character.quotes.map((quote, index) => (
          <blockquote key={index} style={{ borderLeft: "2px solid var(--mobile-accent)", margin: "0 0 14px", paddingLeft: 12 }}>
            <div className="mobile-copy">{quote.text}</div>
            <div className="mobile-event-source">——《{quote.source.work}》{quote.source.locus ?? ""}</div>
          </blockquote>
        ))}
      </MobileSection>

      <MobileKv label="武器" values={character.weapons} />
      <MobileKv label="技能" values={character.skills} />
      <MobileKv label="神职/领域" values={character.domains} />
      <MobileKv label="坐骑" values={character.mounts} />

      {character.bio && <MobileSection title="人物简介"><p className="mobile-copy">{character.bio}</p></MobileSection>}

      <MobileSection title="主要事件">
        {eventItems.map(({ key, event, otherName, shouldContinue }) => {
          const userEntry = userEvents[character.id]?.find((entry) => entry.event.title === event.title);
          return (
            <div className="mobile-event" key={key}>
              <div className="mobile-event-heading">
                <div className="mobile-event-title">{event.title}</div>
                <button
                  className="mobile-action mobile-event-whatif"
                  type="button"
                  onClick={() => onLaunchWhatIf({
                    projectSlug,
                    characterId: character.id,
                    characterName: character.name_zh,
                    eventTitle: event.title,
                    premise: shouldContinue
                      ? `假设${character.name_zh}经历了「${event.title}」：${event.desc}`
                      : `如果${character.name_zh}没有「${event.title}」`,
                    premiseType: shouldContinue ? "free_text" : "event_negative",
                  })}
                >
                  {shouldContinue ? "⚡ 基于此事件推演" : "⚡ 假设这件事没发生"}
                </button>
              </div>
              {otherName && <div className="mobile-muted" style={{ fontSize: 13, marginTop: 4 }}>与 {otherName}</div>}
              <p className="mobile-copy" style={{ color: "var(--mobile-muted)", marginTop: 6 }}>{event.desc}</p>
              {event.source && <div className="mobile-event-source">《{event.source.work}》{event.source.locus ?? ""}</div>}
              {userEntry && (
                <div className="mobile-action-row">
                  <button className="mobile-action danger" type="button" onClick={() => void onRemoveUserEvent(character.id, userEntry.id)}>
                    删除事件
                  </button>
                </div>
              )}
            </div>
          );
        })}
        <MobileAddEventForm
          accountUser={accountUser}
          onAdd={(title, desc) => onAddUserEvent(character.id, title, desc)}
        />
      </MobileSection>

      <RelationList relations={relations} onOpenRelation={onOpenRelation} />
    </>
  );
}

function ArtifactDetails({
  artifact,
  relations,
  onOpenRelation,
}: {
  artifact: Dataset["artifacts"][number];
  relations: Array<{ relation: Relation; other: MobileNode }>;
  onOpenRelation: (id: string) => void;
}) {
  return (
    <>
      <div className="mobile-meta">{artifact.name_en} · {artifact.category}</div>
      <MobileKv
        label="拥有/使用者"
        values={relations
          .filter(({ relation, other }) => relation.target === artifact.id && other.kind === "character")
          .map(({ other }) => other.entity.name_zh)}
      />
      <MobileKv label="象征/领域" values={artifact.domains} />
      {artifact.bio && <MobileSection title="宝物简介"><p className="mobile-copy">{artifact.bio}</p></MobileSection>}
      <MobileSection title="关键事件">
        {artifact.events.map((event, index) => (
          <div className="mobile-event" key={`${event.title}:${index}`}>
            <div className="mobile-event-title">{event.title}</div>
            <p className="mobile-copy" style={{ color: "var(--mobile-muted)", marginTop: 6 }}>{event.desc}</p>
            {event.source && <div className="mobile-event-source">《{event.source.work}》{event.source.locus ?? ""}</div>}
          </div>
        ))}
      </MobileSection>
      <RelationList relations={relations} onOpenRelation={onOpenRelation} />
    </>
  );
}

function RelationList({
  relations,
  onOpenRelation,
}: {
  relations: Array<{ relation: Relation; other: MobileNode }>;
  onOpenRelation: (id: string) => void;
}) {
  return (
    <MobileSection title="关系">
      {relations.length === 0 && <span className="mobile-muted">暂无直接关系</span>}
      {relations.map(({ relation, other }) => (
        <button className="mobile-relation-row" key={relation.id} type="button" onClick={() => onOpenRelation(relation.id)}>
          {other.entity.thumb || other.entity.portrait ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={other.entity.thumb || other.entity.portrait} alt="" />
          ) : <span className="mobile-relation-avatar">{other.entity.name_zh.slice(0, 1)}</span>}
          <span>
            <strong>{other.entity.name_zh}</strong>
            <small>{relation.primary_type} · {relation.events.length} 个事件</small>
          </span>
          <span aria-hidden>›</span>
        </button>
      ))}
    </MobileSection>
  );
}

function RelationOverlay({
  relation,
  nodeById,
  onClose,
  onSelectNode,
}: {
  relation: Relation;
  nodeById: Map<string, MobileNode>;
  onClose: () => void;
  onSelectNode: (id: string) => void;
}) {
  const source = nodeById.get(relation.source);
  const target = nodeById.get(relation.target);
  return (
    <div className="mobile-fullscreen" onPointerDown={(event) => event.stopPropagation()}>
      <div className="mobile-fullscreen-header">
        <button className="mobile-action" type="button" onClick={onClose}>← 返回</button>
        <strong>{source?.entity.name_zh ?? relation.source} ↔ {target?.entity.name_zh ?? relation.target}</strong>
      </div>
      <div className="mobile-fullscreen-body">
        <div className="mobile-action-row" style={{ marginTop: 0 }}>
          {source && <button className="mobile-action" type="button" onClick={() => onSelectNode(source.id)}>{source.entity.name_zh}</button>}
          {target && <button className="mobile-action" type="button" onClick={() => onSelectNode(target.id)}>{target.entity.name_zh}</button>}
        </div>
        <div className="mobile-meta">{relation.primary_type}{relation.composite_types.length ? ` + ${relation.composite_types.join(", ")}` : ""}</div>
        <MobileSection title="事件时间线">
          {relation.events.length === 0 && <span className="mobile-muted">暂无事件记录</span>}
          {relation.events.map((event, index) => (
            <div className="mobile-event" key={`${event.title}:${index}`}>
              <div className="mobile-event-title">{event.title}</div>
              <p className="mobile-copy" style={{ color: "var(--mobile-muted)", marginTop: 6 }}>{event.desc}</p>
              {event.source && <div className="mobile-event-source">《{event.source.work}》{event.source.locus ?? ""}</div>}
            </div>
          ))}
        </MobileSection>
      </div>
    </div>
  );
}

function MobileAddEventForm({
  accountUser,
  onAdd,
}: {
  accountUser: SessionUser | null | undefined;
  onAdd: (title: string, desc: string) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!open) {
    return <button className="mobile-action" type="button" onClick={() => setOpen(true)}>＋ 添加事件</button>;
  }

  return (
    <form
      style={{ display: "grid", gap: 9, marginTop: 12 }}
      onSubmit={(event) => {
        event.preventDefault();
        if (!accountUser) {
          setError("请先登录 ChronChaos 账号");
          window.dispatchEvent(new Event("chronchaos-open-auth"));
          return;
        }
        setSaving(true);
        void onAdd(title, desc).then((message) => {
          setSaving(false);
          if (message) {
            setError(message);
            return;
          }
          setTitle("");
          setDesc("");
          setError(null);
          setOpen(false);
        }).catch((reason) => {
          setSaving(false);
          setError(reason instanceof Error ? reason.message : String(reason));
        });
      }}
    >
      <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="事件标题" style={mobileInputStyle} />
      <textarea value={desc} onChange={(event) => setDesc(event.target.value)} placeholder="事件描述" rows={5} style={mobileInputStyle} />
      {error && <div style={{ color: "#b42318", fontSize: 12 }}>{error}</div>}
      <div className="mobile-action-row" style={{ marginTop: 0 }}>
        <button className="mobile-action primary" disabled={saving || !title.trim() || !desc.trim()} type="submit">
          {saving ? "保存中…" : "保存事件"}
        </button>
        <button className="mobile-action" type="button" onClick={() => setOpen(false)}>取消</button>
      </div>
    </form>
  );
}

function MobileSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="mobile-section"><h3>{title}</h3>{children}</section>;
}

function MobileKv({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return <div className="mobile-kv"><strong>{label}</strong>{values.join(" · ")}</div>;
}

function windowHeight() {
  return typeof window === "undefined" ? 844 : window.innerHeight;
}

const mobileVariables = {
  // Keep these in legacy syntax: Baidu Browser does not parse oklch() custom-property values.
  // An unparseable custom property invalidates every color and border that references it.
  "--mobile-bg": "#f8f6f4",
  "--mobile-panel": "#fcfcfc",
  "--mobile-raised": "#f2eee9",
  "--mobile-text": "#16181b",
  "--mobile-muted": "#5b5e65",
  "--mobile-border": "#d5d0ca",
  "--mobile-accent": "#95402b",
} as React.CSSProperties;

const mobileInputStyle: React.CSSProperties = {
  background: "var(--mobile-bg)",
  border: "1px solid var(--mobile-border)",
  borderRadius: 7,
  boxSizing: "border-box",
  color: "var(--mobile-text)",
  font: "14px/1.5 system-ui,sans-serif",
  padding: "10px 11px",
  resize: "vertical",
  width: "100%",
};
