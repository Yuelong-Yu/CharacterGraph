import type { UserEventsByCharacter } from "@/lib/userEvents";
import { parseStoredUserEvents } from "@/lib/userEvents";
import type { UserCharacterRecord } from "@/lib/userCharacters";
import type { UserContentImport } from "@/schemas/userContent";

const DATABASE_NAME = "character-graph-user-content";
const DATABASE_VERSION = 2;
const CHARACTER_STORE = "characters";
const EVENT_STORE = "events";
const SCOPE_STORE = "scopes";

interface StoredCharacter extends UserCharacterRecord {
  key: string;
}

interface StoredEvents {
  projectSlug: string;
  events: UserEventsByCharacter;
}

export interface UserCharacterScope {
  id: string;
  projectSlug: string;
  kind: "user-branch";
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface StoredScope extends UserCharacterScope {
  key: string;
}

function recordKey(projectSlug: string, scopeId: string, id: string): string {
  return `${projectSlug}\u0000${scopeId}\u0000${id}`;
}

function scopeKey(projectSlug: string, scopeId: string): string {
  return `${projectSlug}\u0000${scopeId}`;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("当前浏览器不支持 IndexedDB"));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(CHARACTER_STORE)) {
        const store = database.createObjectStore(CHARACTER_STORE, { keyPath: "key" });
        store.createIndex("projectScope", ["projectSlug", "scopeId"], { unique: false });
      }
      if (!database.objectStoreNames.contains(EVENT_STORE)) {
        database.createObjectStore(EVENT_STORE, { keyPath: "projectSlug" });
      }
      if (!database.objectStoreNames.contains(SCOPE_STORE)) {
        database.createObjectStore(SCOPE_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开 IndexedDB"));
  });
}

export async function loadOrInitializeUserCharacterScope(
  projectSlug: string,
  scopeId: string,
  seedRecords: readonly UserCharacterRecord[],
): Promise<UserCharacterRecord[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([CHARACTER_STORE, SCOPE_STORE], "readwrite");
    const storedScopeKey = scopeKey(projectSlug, scopeId);
    const scope = await requestResult(
      transaction.objectStore(SCOPE_STORE).get(storedScopeKey) as IDBRequest<{ key: string } | undefined>,
    );
    if (!scope) {
      const characterStore = transaction.objectStore(CHARACTER_STORE);
      for (const record of seedRecords) {
        const cloned = { ...record, projectSlug, scopeId };
        characterStore.put({
          ...cloned,
          key: recordKey(projectSlug, scopeId, cloned.id),
        } satisfies StoredCharacter);
      }
      transaction.objectStore(SCOPE_STORE).put({ key: storedScopeKey });
      await transactionDone(transaction);
      return seedRecords.map((record) => ({ ...record, projectSlug, scopeId }));
    }
    const index = transaction.objectStore(CHARACTER_STORE).index("projectScope");
    const rows = await requestResult(index.getAll(IDBKeyRange.only([projectSlug, scopeId])) as IDBRequest<StoredCharacter[]>);
    await transactionDone(transaction);
    return rows.map(({ key: _key, ...record }) => record);
  } finally {
    database.close();
  }
}

export async function listUserCharacterScopes(projectSlug: string): Promise<UserCharacterScope[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SCOPE_STORE, "readonly");
    const rows = await requestResult(
      transaction.objectStore(SCOPE_STORE).getAll() as IDBRequest<Array<Partial<StoredScope> & { key: string }>>,
    );
    return rows
      .filter((row): row is StoredScope => row.projectSlug === projectSlug && row.kind === "user-branch"
        && typeof row.id === "string" && typeof row.title === "string"
        && typeof row.createdAt === "string" && typeof row.updatedAt === "string")
      .map(({ key: _key, ...scope }) => scope)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  } finally {
    database.close();
  }
}

export async function createUserCharacterScope(
  scope: UserCharacterScope,
  seedRecords: readonly UserCharacterRecord[] = [],
): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([CHARACTER_STORE, SCOPE_STORE], "readwrite");
    const characterStore = transaction.objectStore(CHARACTER_STORE);
    for (const record of seedRecords) {
      const scopedRecord = { ...record, projectSlug: scope.projectSlug, scopeId: scope.id };
      characterStore.put({
        ...scopedRecord,
        key: recordKey(scope.projectSlug, scope.id, scopedRecord.id),
      } satisfies StoredCharacter);
    }
    transaction.objectStore(SCOPE_STORE).put({
      ...scope,
      key: scopeKey(scope.projectSlug, scope.id),
    } satisfies StoredScope);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function migrateBaseUserCharactersToScope(
  projectSlug: string,
  scope: UserCharacterScope,
): Promise<UserCharacterRecord[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([CHARACTER_STORE, SCOPE_STORE], "readwrite");
    const characterStore = transaction.objectStore(CHARACTER_STORE);
    const index = characterStore.index("projectScope");
    const rows = await requestResult(
      index.getAll(IDBKeyRange.only([projectSlug, "base"])) as IDBRequest<StoredCharacter[]>,
    );
    if (rows.length === 0) {
      await transactionDone(transaction);
      return [];
    }

    const migrated = rows.map(({ key: _key, ...record }) => ({
      ...record,
      projectSlug,
      scopeId: scope.id,
    }));
    for (const row of rows) characterStore.delete(row.key);
    for (const record of migrated) {
      characterStore.put({
        ...record,
        key: recordKey(projectSlug, scope.id, record.id),
      } satisfies StoredCharacter);
    }
    transaction.objectStore(SCOPE_STORE).put({
      ...scope,
      key: scopeKey(projectSlug, scope.id),
    } satisfies StoredScope);
    await transactionDone(transaction);
    return migrated;
  } finally {
    database.close();
  }
}

export async function loadUserCharacterRecords(
  projectSlug: string,
  scopeId: string,
): Promise<UserCharacterRecord[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(CHARACTER_STORE, "readonly");
    const index = transaction.objectStore(CHARACTER_STORE).index("projectScope");
    const rows = await requestResult(index.getAll(IDBKeyRange.only([projectSlug, scopeId])) as IDBRequest<StoredCharacter[]>);
    return rows.map(({ key: _key, ...record }) => record);
  } finally {
    database.close();
  }
}

export async function saveUserCharacterRecord(record: UserCharacterRecord): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(CHARACTER_STORE, "readwrite");
    transaction.objectStore(CHARACTER_STORE).put({
      ...record,
      key: recordKey(record.projectSlug, record.scopeId, record.id),
    } satisfies StoredCharacter);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function deleteUserCharacterRecord(
  projectSlug: string,
  scopeId: string,
  id: string,
): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(CHARACTER_STORE, "readwrite");
    transaction.objectStore(CHARACTER_STORE).delete(recordKey(projectSlug, scopeId, id));
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function replaceUserCharacterScope(
  projectSlug: string,
  scopeId: string,
  records: readonly UserCharacterRecord[],
): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(CHARACTER_STORE, "readwrite");
    const store = transaction.objectStore(CHARACTER_STORE);
    const index = store.index("projectScope");
    const keys = await requestResult(index.getAllKeys(IDBKeyRange.only([projectSlug, scopeId])));
    for (const key of keys) store.delete(key);
    for (const record of records) {
      store.put({
        ...record,
        projectSlug,
        scopeId,
        key: recordKey(projectSlug, scopeId, record.id),
      } satisfies StoredCharacter);
    }
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function loadUserEvents(
  projectSlug: string,
  legacyValue?: unknown,
): Promise<UserEventsByCharacter> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(EVENT_STORE, "readonly");
    const stored = await requestResult(
      transaction.objectStore(EVENT_STORE).get(projectSlug) as IDBRequest<StoredEvents | undefined>,
    );
    if (stored) return parseStoredUserEvents(stored.events);
  } finally {
    database.close();
  }

  const migrated = parseStoredUserEvents(legacyValue);
  if (Object.keys(migrated).length > 0) await saveUserEvents(projectSlug, migrated);
  return migrated;
}

export async function saveUserEvents(
  projectSlug: string,
  events: UserEventsByCharacter,
): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(EVENT_STORE, "readwrite");
    transaction.objectStore(EVENT_STORE).put({ projectSlug, events } satisfies StoredEvents);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

/** Collects the pre-account browser data for a one-time, authenticated import. */
export async function exportLegacyUserContent(
  projectSlug: string,
  activeScopeId: string | null,
  legacyEvents?: unknown,
): Promise<UserContentImport> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([CHARACTER_STORE, EVENT_STORE, SCOPE_STORE], "readonly");
    const [characterRows, scopeRows, storedEvents] = await Promise.all([
      requestResult(transaction.objectStore(CHARACTER_STORE).getAll() as IDBRequest<StoredCharacter[]>),
      requestResult(transaction.objectStore(SCOPE_STORE).getAll() as IDBRequest<Array<Partial<StoredScope> & { key: string }>>),
      requestResult(transaction.objectStore(EVENT_STORE).get(projectSlug) as IDBRequest<StoredEvents | undefined>),
    ]);
    await transactionDone(transaction);
    const projectPrefix = `${projectSlug}\u0000`;
    const scopes = scopeRows
      .filter((row): row is StoredScope => row.projectSlug === projectSlug && row.kind === "user-branch"
        && typeof row.id === "string" && typeof row.title === "string"
        && typeof row.createdAt === "string" && typeof row.updatedAt === "string")
      .map(({ key: _key, ...scope }) => scope);
    return {
      activeScopeId,
      scopes,
      characterRecords: characterRows
        .filter((row) => row.projectSlug === projectSlug)
        .map(({ key: _key, ...record }) => record),
      userEvents: storedEvents ? parseStoredUserEvents(storedEvents.events) : parseStoredUserEvents(legacyEvents),
      initializedScopeIds: scopeRows
        .filter((row) => row.key.startsWith(projectPrefix))
        .map((row) => row.key.slice(projectPrefix.length))
        .filter(Boolean),
    };
  } finally {
    database.close();
  }
}

export function hasLegacyUserContent(content: UserContentImport): boolean {
  return Boolean(
    content.activeScopeId
    || content.scopes.length
    || content.characterRecords.length
    || Object.keys(content.userEvents).length
    || content.initializedScopeIds.length,
  );
}

/** Removes unowned browser data only after the server import succeeds. */
export async function clearLegacyUserContent(projectSlug: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([CHARACTER_STORE, EVENT_STORE, SCOPE_STORE], "readwrite");
    const characterStore = transaction.objectStore(CHARACTER_STORE);
    const scopeStore = transaction.objectStore(SCOPE_STORE);
    const [characterRows, scopeRows] = await Promise.all([
      requestResult(characterStore.getAll() as IDBRequest<StoredCharacter[]>),
      requestResult(scopeStore.getAll() as IDBRequest<Array<{ key: string }>>),
    ]);
    for (const row of characterRows) if (row.projectSlug === projectSlug) characterStore.delete(row.key);
    const projectPrefix = `${projectSlug}\u0000`;
    for (const row of scopeRows) if (row.key.startsWith(projectPrefix)) scopeStore.delete(row.key);
    transaction.objectStore(EVENT_STORE).delete(projectSlug);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}
