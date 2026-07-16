import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/whatif/db";
import {
  UserContentImportSchema,
  type UserContentImport,
  type UserContentMutation,
  type UserProjectContentSnapshot,
} from "@/schemas/userContent";

const EMPTY_CONTENT: UserContentImport = {
  activeScopeId: null,
  scopes: [],
  characterRecords: [],
  userEvents: {},
  initializedScopeIds: [],
};

export async function readUserProjectContent(ownerId: string, projectSlug: string): Promise<UserProjectContentSnapshot> {
  const row = await prisma.userProjectContent.findUnique({ where: { ownerId_projectSlug: { ownerId, projectSlug } } });
  if (!row) return { projectSlug, revision: 0, ...EMPTY_CONTENT };
  return { projectSlug, revision: row.revision, ...parseRow(row) };
}

export async function mutateUserProjectContent(
  ownerId: string,
  projectSlug: string,
  mutation: UserContentMutation,
): Promise<UserProjectContentSnapshot> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const row = await prisma.userProjectContent.findUnique({ where: { ownerId_projectSlug: { ownerId, projectSlug } } });
    const current = row ? parseRow(row) : { ...EMPTY_CONTENT };
    const next = applyMutation(current, mutation, projectSlug);
    if (!row) {
      try {
        const created = await prisma.userProjectContent.create({
          data: jsonData(ownerId, projectSlug, next),
        });
        return { projectSlug, revision: created.revision, ...parseRow(created) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
        throw error;
      }
    }
    const updated = await prisma.userProjectContent.updateMany({
      where: { id: row.id, revision: row.revision },
      data: { ...jsonData(ownerId, projectSlug, next), revision: { increment: 1 } },
    });
    if (updated.count === 1) return readUserProjectContent(ownerId, projectSlug);
  }
  throw new Error("用户内容同时被其他页面修改，请重试");
}

export async function ownsUserContentScope(ownerId: string, projectSlug: string, scopeId: string): Promise<boolean> {
  const content = await readUserProjectContent(ownerId, projectSlug);
  return content.initializedScopeIds.includes(scopeId)
    || content.scopes.some((scope) => scope.id === scopeId)
    || content.characterRecords.some((record) => record.scopeId === scopeId);
}

function parseRow(row: { activeScopeId: string | null; scopes: Prisma.JsonValue; characterRecords: Prisma.JsonValue; userEvents: Prisma.JsonValue; initializedScopeIds: Prisma.JsonValue }): UserContentImport {
  return UserContentImportSchema.parse({
    activeScopeId: row.activeScopeId,
    scopes: row.scopes,
    characterRecords: row.characterRecords,
    userEvents: row.userEvents,
    initializedScopeIds: row.initializedScopeIds,
  });
}

function jsonData(ownerId: string, projectSlug: string, content: UserContentImport) {
  return {
    ownerId,
    projectSlug,
    activeScopeId: content.activeScopeId,
    scopes: content.scopes as Prisma.InputJsonValue,
    characterRecords: content.characterRecords as Prisma.InputJsonValue,
    userEvents: content.userEvents as Prisma.InputJsonValue,
    initializedScopeIds: content.initializedScopeIds as Prisma.InputJsonValue,
  };
}

function applyMutation(current: UserContentImport, mutation: UserContentMutation, projectSlug: string): UserContentImport {
  if (mutation.action === "import-local") return mergeImported(current, mutation.content, projectSlug);
  if (mutation.action === "set-active-scope") return { ...current, activeScopeId: mutation.scopeId };
  if (mutation.action === "initialize-scope") {
    if (current.initializedScopeIds.includes(mutation.scopeId)) return current;
    const existing = new Set(current.characterRecords.map(recordKey));
    const seeds = mutation.seedRecords
      .map((record) => ({ ...record, projectSlug, scopeId: mutation.scopeId }))
      .filter((record) => !existing.has(recordKey(record)));
    return { ...current, characterRecords: [...current.characterRecords, ...seeds], initializedScopeIds: [...current.initializedScopeIds, mutation.scopeId] };
  }
  if (mutation.action === "upsert-character") {
    const record = { ...mutation.record, projectSlug };
    const records = current.characterRecords.filter((item) => recordKey(item) !== recordKey(record));
    const scopes = mutation.scope
      ? [...current.scopes.filter((scope) => scope.id !== mutation.scope!.id), { ...mutation.scope, projectSlug }]
      : current.scopes;
    return {
      ...current,
      activeScopeId: mutation.activateScope ? record.scopeId : current.activeScopeId,
      scopes,
      characterRecords: [...records, record],
      initializedScopeIds: Array.from(new Set([...current.initializedScopeIds, record.scopeId])),
    };
  }
  if (mutation.action === "delete-character") {
    return { ...current, characterRecords: current.characterRecords.filter((record) => !(record.scopeId === mutation.scopeId && record.id === mutation.characterId)) };
  }
  if (mutation.action === "upsert-event") {
    const entries = (current.userEvents[mutation.characterId] ?? []).filter((entry) => entry.id !== mutation.entry.id);
    return { ...current, userEvents: { ...current.userEvents, [mutation.characterId]: [...entries, mutation.entry] } };
  }
  const entries = (current.userEvents[mutation.characterId] ?? []).filter((entry) => entry.id !== mutation.eventId);
  const userEvents = { ...current.userEvents };
  if (entries.length) userEvents[mutation.characterId] = entries;
  else delete userEvents[mutation.characterId];
  return { ...current, userEvents };
}

function mergeImported(current: UserContentImport, imported: UserContentImport, projectSlug: string): UserContentImport {
  const scopes = new Map(current.scopes.map((scope) => [scope.id, scope]));
  for (const scope of imported.scopes) {
    const existing = scopes.get(scope.id);
    if (!existing || scope.updatedAt > existing.updatedAt) scopes.set(scope.id, { ...scope, projectSlug });
  }
  const records = new Map(current.characterRecords.map((record) => [recordKey(record), record]));
  for (const record of imported.characterRecords) {
    const existing = records.get(recordKey(record));
    if (!existing || record.updatedAt > existing.updatedAt) records.set(recordKey(record), { ...record, projectSlug });
  }
  const userEvents = { ...current.userEvents };
  for (const [characterId, importedEntries] of Object.entries(imported.userEvents)) {
    const entries = new Map((userEvents[characterId] ?? []).map((entry) => [entry.id, entry]));
    for (const entry of importedEntries) if (!entries.has(entry.id)) entries.set(entry.id, entry);
    userEvents[characterId] = Array.from(entries.values());
  }
  return {
    activeScopeId: current.activeScopeId ?? imported.activeScopeId,
    scopes: Array.from(scopes.values()),
    characterRecords: Array.from(records.values()),
    userEvents,
    initializedScopeIds: Array.from(new Set([...current.initializedScopeIds, ...imported.initializedScopeIds])),
  };
}

function recordKey(record: { scopeId: string; id: string }): string {
  return `${record.scopeId}\u0000${record.id}`;
}
