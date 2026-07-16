import { NextResponse } from "next/server";
import { getSessionUserFromHeaders } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return NextResponse.json({ user: getSessionUserFromHeaders(request.headers) });
}
