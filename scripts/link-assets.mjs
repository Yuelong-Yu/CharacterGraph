#!/usr/bin/env node
/**
 * link-assets — 为每个 projects/<slug>/images 建立 public/p/<slug> 软链。
 *
 * 软链本身 gitignore(见 .gitignore 的 public/p/),由 predev/prebuild 在每台机器/CI 重建。
 * URL 形如 /p/<slug>/portraits/<id>.webp → projects/<slug>/images/portraits/<id>.webp。
 */
import { existsSync, mkdirSync, readdirSync, lstatSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECTS_DIR = join(ROOT, "projects");
const PUBLIC_P = join(ROOT, "public", "p");

function listProjects() {
  if (!existsSync(PROJECTS_DIR)) return [];
  return readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(PROJECTS_DIR, d.name, "project.config.json")))
    .map((d) => d.name);
}

function ensureLink(slug) {
  const imagesDir = join(PROJECTS_DIR, slug, "images");
  if (!existsSync(imagesDir)) mkdirSync(imagesDir, { recursive: true });

  const linkPath = join(PUBLIC_P, slug);
  // 相对软链(相对 public/p/)→ 可移植,不含绝对路径
  const target = relative(PUBLIC_P, imagesDir);

  if (existsSync(linkPath) || lstatExists(linkPath)) {
    const isLink = lstatSync(linkPath).isSymbolicLink();
    if (isLink && readlinkSync(linkPath) === target) return "ok";
    rmSync(linkPath, { recursive: true, force: true });
  }
  symlinkSync(target, linkPath);
  return "linked";
}

function lstatExists(p) {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function main() {
  mkdirSync(PUBLIC_P, { recursive: true });
  const projects = listProjects();
  if (projects.length === 0) {
    console.log("[link-assets] 未发现任何项目");
    return;
  }
  for (const slug of projects) {
    const status = ensureLink(slug);
    console.log(`[link-assets] public/p/${slug} → projects/${slug}/images (${status})`);
  }
}

main();
