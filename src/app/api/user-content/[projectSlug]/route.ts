import { NextRequest, NextResponse } from "next/server";
import { getSessionUserFromHeaders } from "@/lib/auth";
import { mutateUserProjectContent, readUserProjectContent } from "@/lib/server/userProjectContent";
import { UserContentMutationSchema } from "@/schemas/userContent";
import { loadDataset } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validProjectSlug(value: string): boolean {
  return /^[a-z][a-z0-9_]{0,99}$/.test(value);
}

function projectExists(projectSlug: string): boolean {
  if (!validProjectSlug(projectSlug)) return false;
  try {
    loadDataset(projectSlug);
    return true;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ projectSlug: string }> }) {
  const user = getSessionUserFromHeaders(request.headers);
  if (!user) return NextResponse.json({ error: "请先登录", code: "LOGIN_REQUIRED" }, { status: 401 });
  const { projectSlug } = await params;
  if (!projectExists(projectSlug)) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  return NextResponse.json({ content: await readUserProjectContent(user.id, projectSlug) });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ projectSlug: string }> }) {
  const user = getSessionUserFromHeaders(request.headers);
  if (!user) return NextResponse.json({ error: "请先登录", code: "LOGIN_REQUIRED" }, { status: 401 });
  const { projectSlug } = await params;
  if (!projectExists(projectSlug)) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  const parsed = UserContentMutationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  try {
    return NextResponse.json({ content: await mutateUserProjectContent(user.id, projectSlug, parsed.data) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}
