import { createHash } from "node:crypto";
import fs from "node:fs";

const versionCache = new Map<string, { signature: string; version: string }>();

function contentVersion(filePath: string): string {
  const stat = fs.statSync(filePath);
  const signature = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  const cached = versionCache.get(filePath);
  if (cached?.signature === signature) return cached.version;

  const version = createHash("sha256").update(fs.readFileSync(filePath)).digest("hex").slice(0, 16);
  versionCache.set(filePath, { signature, version });
  return version;
}

export function versionFileUrl(assetUrl: string, filePath: string): string {
  if (!assetUrl.startsWith("/")) {
    throw new Error(`静态资源 URL 必须是根路径: ${assetUrl}`);
  }

  const parsed = new URL(assetUrl, "https://charactergraph.local");
  parsed.searchParams.set("v", contentVersion(filePath));
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
