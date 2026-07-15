import { spawn } from "node:child_process";
import path from "node:path";
import type { Character } from "@/schemas/character";
import { callLLMStream } from "@/lib/whatif/llmClient";

const IMAGE_SCRIPT_DIR = path.join(process.cwd(), "scripts", "images");

export async function synthesizeCharacterImagePrompt(input: {
  projectTitle: string;
  categoryLabel: string;
  character: Character;
  background?: string;
}): Promise<string> {
  const { character } = input;
  const system = [
    "你是人物立绘视觉设定编辑。",
    "只输出一段中文绘图提示词，不输出 Markdown、解释、标题或 JSON。",
    "根据资料补足合理的年龄、面容、体态、服饰、神态、姿态和代表性环境。",
    "不得改变人物身份、时代、武器和经历，不得在画面中加入文字、题款、边框或水印。",
    "画风由后续项目配置统一注入，因此不要自行指定其他画风。",
  ].join("\n");
  const user = JSON.stringify({
    work: input.projectTitle,
    category: input.categoryLabel,
    background: input.background?.trim() || null,
    character: {
      name: character.name_zh,
      englishName: character.name_en,
      aliases: character.aliases,
      epithet: character.epithet,
      eraLayer: character.era_layer,
      bio: character.bio,
      events: character.events.slice(0, 5).map(({ title, desc }) => ({ title, desc })),
      weapons: character.weapons,
      skills: character.skills,
      domains: character.domains,
      mounts: character.mounts,
    },
    composition: "单人主体清晰的2:3竖向人物立绘",
  }, null, 2);

  let output = "";
  await callLLMStream(system, user, 4096, (delta) => {
    output += delta;
  }, () => {
    output = "";
  });
  const normalized = output
    .trim()
    .replace(/^```(?:text|plaintext)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (normalized.length < 20) throw new Error("文本 LLM 返回的绘图提示词过短");
  return normalized;
}

export async function runBranchPortraitGeneration(payload: {
  project: string;
  branch: string;
  characterId: string;
  prompt: string;
  fingerprint: string;
  promptSource: "llm" | "template";
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.env.UV_BIN || "uv",
      ["run", "generate_branch_portrait.py"],
      { cwd: IMAGE_SCRIPT_DIR, stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(
        `SeedDream 图像管线失败（exit=${code ?? "unknown"}）：${stderr.trim() || stdout.trim() || "无错误输出"}`,
      ));
    });
    child.stdin.end(JSON.stringify(payload));
  });
}
