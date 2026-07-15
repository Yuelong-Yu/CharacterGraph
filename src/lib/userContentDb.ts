import type { UserEventsByCharacter } from "@/lib/userEvents";
import { parseStoredUserEvents } from "@/lib/userEvents";
import type { UserCharacterRecord } from "@/lib/userCharacters";

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

function recordKey(projectSlug: string, scopeId: string, id: string): string {
  return `${projectSlug}\u0000${scopeId}\u0000${id}`;
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
    const scopeKey = `${projectSlug}\u0000${scopeId}`;
    const scope = await requestResult(
      transaction.objectStore(SCOPE_STORE).get(scopeKey) as IDBRequest<{ key: string } | undefined>,
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
      transaction.objectStore(SCOPE_STORE).put({ key: scopeKey });
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
