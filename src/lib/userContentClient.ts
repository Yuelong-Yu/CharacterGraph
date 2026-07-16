import { withBasePath } from "@/lib/basePath";
import { UserProjectContentSnapshotSchema, type UserContentImport, type UserContentMutation, type UserProjectContentSnapshot } from "@/schemas/userContent";

async function request(projectSlug: string, init?: RequestInit): Promise<UserProjectContentSnapshot> {
  const response = await fetch(withBasePath(`/api/user-content/${encodeURIComponent(projectSlug)}`), init);
  const payload = await response.json().catch(() => ({})) as { content?: unknown; error?: unknown };
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `用户内容同步失败：HTTP ${response.status}`);
  return UserProjectContentSnapshotSchema.parse(payload.content);
}

export function fetchUserProjectContent(projectSlug: string): Promise<UserProjectContentSnapshot> {
  return request(projectSlug, { cache: "no-store" });
}

export function mutateUserContent(projectSlug: string, mutation: UserContentMutation): Promise<UserProjectContentSnapshot> {
  return request(projectSlug, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mutation) });
}

export function importLocalUserContent(projectSlug: string, content: UserContentImport): Promise<UserProjectContentSnapshot> {
  return mutateUserContent(projectSlug, { action: "import-local", content });
}
