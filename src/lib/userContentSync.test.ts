import { describe, expect, it } from "vitest";
import { synchronizeUserProjectContent } from "@/lib/userContentSync";
import { BASE_USER_CHARACTER_SCOPE, type UserCharacterRecord } from "@/lib/userCharacters";
import type { UserProjectContentSnapshot } from "@/schemas/userContent";

const content: UserProjectContentSnapshot = {
  projectSlug: "greek",
  revision: 1,
  activeScopeId: BASE_USER_CHARACTER_SCOPE,
  scopes: [],
  characterRecords: [],
  userEvents: {},
  initializedScopeIds: [BASE_USER_CHARACTER_SCOPE],
};

describe("synchronizeUserProjectContent", () => {
  it("keeps an open add-character editor through a cloud-content refresh", () => {
    const editor = { editingRecord: null as UserCharacterRecord | null };

    const result = synchronizeUserProjectContent(content, null, editor);

    expect(result.userCharacterEditor).toBe(editor);
    expect(result.loadedUserScopeId).toBe(BASE_USER_CHARACTER_SCOPE);
  });
});
