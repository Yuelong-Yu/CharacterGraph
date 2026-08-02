import type { UserCharacterScope } from "@/lib/userContentDb";
import {
  BASE_USER_CHARACTER_SCOPE,
  type UserCharacterRecord,
} from "@/lib/userCharacters";
import type { UserEventsByCharacter } from "@/lib/userEvents";
import type { UserProjectContentSnapshot } from "@/schemas/userContent";

export type UserCharacterEditorState = {
  editingRecord: UserCharacterRecord | null;
} | null;

export interface UserContentSyncResult {
  cloudContent: UserProjectContentSnapshot;
  localUserBranchId: string | null;
  userCharacterScopes: UserCharacterScope[];
  userEvents: UserEventsByCharacter;
  userCharacterRecords: UserCharacterRecord[] | null;
  loadedUserScopeId: string | null;
  userCharacterEditor: UserCharacterEditorState;
}

/**
 * Converts a cloud-content response into graph state without discarding an
 * open editor. The editor owns an unsaved user draft, so only explicit user
 * actions (save or cancel) may close it.
 */
export function synchronizeUserProjectContent(
  content: UserProjectContentSnapshot,
  activeBranchId: string | null,
  userCharacterEditor: UserCharacterEditorState,
): UserContentSyncResult {
  const scopeId = activeBranchId ?? content.activeScopeId ?? BASE_USER_CHARACTER_SCOPE;
  const initialized = content.initializedScopeIds.includes(scopeId);
  return {
    cloudContent: content,
    localUserBranchId: content.activeScopeId,
    userCharacterScopes: content.scopes,
    userEvents: content.userEvents,
    userCharacterRecords: initialized
      ? content.characterRecords.filter((record) => record.scopeId === scopeId)
      : null,
    loadedUserScopeId: initialized ? scopeId : null,
    userCharacterEditor,
  };
}
