# HANDOFF - WhatIf 假设叙事功能

> 载入本文档可快速了解「如果」假设叙事功能的设计决策、开发现状、已知欠账，以便继续开发。

---

## 1. 功能概述

在人物图谱（水浒/希腊等）上，点某人物 event 旁的「⚡ 假设这件事没发生」按钮，LLM 基于图谱推演「如果这件事没发生」的后续，输出：
- **图谱 diff**：哪些节点/边消失或新增、哪些 event 被改写
- **带标注的叙事**：每段 inline 标【原典】/【推演】/【杜撰】
- **后续选项**：2-3 个方向，用户选一个或自由输入，LLM 续写下一 turn

支持 **Interactive 续写**（多轮）+ **多分支保存**（任意 turn 可 fork，形成分支树，可切换查看不同时间线）+ **图谱动态变化**（diff 应用到 3D 图谱）。

---

## 2. 关键设计决策（grilling 结论）

| 维度 | 决策 | 理由 |
|------|------|------|
| 输入形态 | 混合（点 event 否定 + 自由文本覆盖） | 易用 + 灵活 |
| 输出形态 | 图谱 diff + 叙事 | 图谱特色 |
| 幻觉控制 | 标注模式 + 事后扫描 | 兼顾创意和诚实 |
| 后端 | Next.js Route Handler | 破坏纯静态，但 key 安全 |
| LLM | deepseek-v4-flash（火山方舟，Anthropic SDK 兼容） | 复用现有 CODING_API_KEY |
| 交互 | Interactive（选项 + 自由输入） | 同人小说形态 |
| 图谱动态修改 | MVP 就做 | 核心卖点 |
| 多分支保存 | MVP 全做 | 核心卖点 |
| 持久化 | PostgreSQL + Prisma v6.19.3 | 真实后端 |
| 工作量 | 8 周 | 用户已接受 |

---

## 3. 架构

```
用户点 event -> POST /api/whatif (SSE)
  -> contextBuilder 2度邻居压缩 (150人->30人子集)
  -> promptBuilder 组装 system prompt (标注规则+图谱变化原则+合法取值)
  -> callLLMStream 流式调 deepseek-v4-flash (120s 超时+1次重试)
  -> parseLLMOutput (=== 分隔符解析 + 启发式兜底 + sanitizer)
  -> validateNarrative (人名+引用+推演段校验)
  -> Prisma 落库 (session+branch+turn)
  -> SSE 推 delta/done/error
客户端 -> WhatIfPanel 流式显示 -> applyDiff 重算 effectiveDataset -> Graph3D 重新渲染
```

**关键接缝**：WhatIf 与现有图谱通过 `effectiveDataset` 单一 prop 集成。GraphShell 维护 `whatIfTurns`，`effectiveDataset = replayBranch(dataset, whatIfTurns)` 传给 Graph3D。

---

## 4. 数据模型

### Prisma（prisma/schema.prisma）

- `WhatIfSession`：id / projectSlug / **characterId** / title / status / timestamps
- `WhatIfBranch`：id / sessionId / **parentTurnId**（null=root）/ title / isActive / timestamps
- `WhatIfTurn`：id / branchId / order / premise / premiseType / sourceEventTitle / diff(Json) / narrative(Json) / choices(Json) / status / **validation**(Json) / timestamps

**迁移**：`prisma/migrations/` 下两个迁移（init + add_character_id_to_session）。

### Zod（src/schemas/whatif.ts）

- `GraphDiff`：removedNodes / addedNodes / removedEdges / addedEdges / modifiedEvents / **replacedEvents**（Week 5 加的，替换某人物全部 events）
- `NarrativeSegment`：text / label(原典|推演|杜撰) / citation / characterIds
- `ValidationResult`：level(error|warning) / message / segmentIndex
- `WhatIfSessionDetail` / `WhatIfBranchDetail` / `WhatIfTurnDetail` / `WhatIfSessionSummary`
- `CreateWhatIfSessionInput` / `ContinueTurnInput`

---

## 5. API 路由（5 个，全 Node Runtime）

| Method | Route | 用途 |
|--------|-------|------|
| POST | `/api/whatif` | 创建 session + 第一 turn（SSE） |
| GET | `/api/whatif?projectSlug=xxx` | 列出 session |
| GET/DELETE | `/api/whatif/[sessionId]` | 拉取/删除 session |
| POST | `/api/whatif/[sessionId]/turns` | 续写 turn（SSE，支持 fork 上下文） |
| POST | `/api/whatif/[sessionId]/branches` | fork 新分支 |
| PATCH | `/api/whatif/[sessionId]/branches/[branchId]` | 切换 active |

### SSE 协议

```
event: delta   data: {text: "..."}                  // LLM 流式 token
event: done    data: {turnId, sessionId, branchId, order?, diff, narrative, choices, validation}
event: error   data: {code, message, raw?}
```

**简化**：plan 原设计 5 种事件（narrative_chunk/diff/choice/done/error），实际 3 种（delta/done/error）。diff 和 choices 在 done 里一次性发。

---

## 6. 文件清单

### 新建文件

```
prisma/
├── schema.prisma
└── migrations/20260713140203_init/
└── migrations/20260713144118_add_character_id_to_session/

vitest.config.ts

src/
├── schemas/whatif.ts                    # Zod schema
├── lib/whatif/
│   ├── db.ts                            # Prisma singleton
│   ├── client.ts                        # 浏览器 SSE 客户端
│   ├── llmClient.ts                     # Anthropic SDK 封装（callLLMStream）
│   ├── diffApplier.ts                   # applyDiff + replayBranch
│   ├── contextBuilder.ts                # 2 度邻居压缩
│   ├── promptBuilder.ts                 # system prompt + parseLLMOutput + sanitizer
│   ├── validation.ts                    # validateNarrative
│   ├── diffApplier.test.ts             # 13 测试
│   ├── contextBuilder.test.ts          # 7 测试
│   ├── validation.test.ts              # 8 测试
│   └── promptBuilder.test.ts           # 11 测试
├── components/whatif/
│   ├── WhatIfPanel.tsx                  # 主面板（状态管理 + UI）
│   ├── NarrativeView.tsx                # 流式叙事 + 标签着色
│   ├── DiffPreview.tsx                  # diff 红绿黄高亮
│   ├── ValidationResults.tsx            # 校验结果折叠
│   └── SessionList.tsx                  # 历史 session 列表
└── app/api/whatif/
    ├── route.ts                         # POST 创建 / GET 列表
    └── [sessionId]/
        ├── route.ts                     # GET / DELETE
        ├── turns/route.ts               # POST 续写（SSE）
        └── branches/
            ├── route.ts                 # POST fork
            └── [branchId]/route.ts      # PATCH 切换
```

### 修改文件

| 文件 | 修改要点 |
|------|----------|
| `src/components/GraphShell.tsx` | 加 whatIfConfig/whatIfTurns 状态；effectiveDataset=replayBranch(dataset, whatIfTurns) 传给 Graph3D；每个 event 旁加「⚡ 假设这件事没发生」按钮；渲染 WhatIfPanel |
| `package.json` | 加 @anthropic-ai/sdk / @prisma/client / prisma / eventsource-parser / vitest 依赖；加 test/db:migrate/db:studio/postinstall 脚本；pnpm.onlyBuiltDependencies |
| `.env` | 加 DATABASE_URL（本地 homebrew postgres） |
| `.env.example` | 加 DATABASE_URL 模板 |

---

## 7. 如何运行

### 首次设置

```bash
# 1. Postgres（homebrew，不需要 Docker）
brew install postgresql@16
brew services start postgresql@16
createdb charactergraph
psql -d charactergraph -c "CREATE ROLE charactergraph WITH LOGIN PASSWORD 'devpass' CREATEDB;"
psql -d charactergraph -c "GRANT ALL ON DATABASE charactergraph TO charactergraph;"
psql -d charactergraph -c "ALTER DATABASE charactergraph OWNER TO charactergraph;"

# 2. .env 配置（已配好，确认即可）
# DATABASE_URL="postgresql://charactergraph:devpass@localhost:5432/charactergraph?schema=public"
# CODING_API_KEY=... (现有)
# CODING_BASE_URL=https://ark.cn-beijing.volces.com/api/coding
# CODING_MODEL=deepseek-v4-flash

# 3. 安装依赖 + 迁移
pnpm install
pnpm db:migrate
```

### 日常开发

```bash
pnpm dev          # 启动 dev server (localhost:3000)
pnpm test         # 跑 39 个单元测试
pnpm typecheck    # tsc --noEmit
pnpm build        # 生产构建
pnpm db:studio    # Prisma Studio 查看 DB
```

### 测试路径

1. 打开 http://localhost:3000/shuihu
2. 点宋江节点
3. 右侧「主要事件」里点「⚡ 假设这件事没发生」
4. WhatIfPanel 滑入 -> 「开始推演」
5. 流式叙事 -> 完成后选 choice 或自由输入
6. 任意 turn 上点「⎇ fork」分叉
7. 分支列表切换

---

## 8. 实现状态

### ✅ 已完成

- Prisma + PostgreSQL 持久化（Session/Branch/Turn 三 model）
- LLM 流式调用（deepseek-v4-flash + Anthropic SDK，120s 超时 + 1 次重试）
- 上下文压缩（2 度邻居，≤30 节点）
- Prompt 工程（标注规则 + 图谱变化原则 + 合法取值约束）
- SSE 流式推送（delta/done/error）
- 5 个 API 路由（create/list/get/delete/turns/fork/switch）
- applyDiff + replayBranch 纯函数（含 replacedEvents 支持）
- Fork 分支 + 切换 active（含 parentTurnId 继承上下文）
- 幻觉校验（人名 + 引用 + 推演段）+ UI 展示
- GraphShell 集成（event 按钮 + effectiveDataset 传 Graph3D）
- 39 个单元测试（4 个纯函数模块）
- Prompt 调优（removedNodes 从 46 降到 0）
- SessionList 历史载入/删除

### ❌ 未完成（plan 明确要求但没做）

| 项目 | plan 位置 | 影响 | 优先级 |
|------|----------|------|--------|
| **Graph3D 过渡动画** | §4 + §10 | 节点/边直接跳变，无淡入淡出 | 中（体验差但不影响功能） |
| **BranchTree 树状可视化** | §4 + §12 | 用分支列表按钮代替 | 低（功能等价） |
| **WhatIfToggle 独立组件** | §4 + §12 | 内联在 GraphShell | 低（功能等价） |
| **WhatIfProvider Context** | §4 + §12 | 状态直接在 WhatIfPanel | 低（功能等价） |
| **时间线一致性校验**（era_layer） | §6 | 第三层校验没做 | 中 |
| **validateAgainstConfig diff 校验** | §5 | sanitizer 做了部分，没调现有函数 | 高（防非法 category） |
| **error 级强制确认才应用** | §6 | 现在只显示红框不阻塞 | 中 |
| **集成测试（mock LLM）** | §11 | 没做 | 高（防回归） |
| **Playwright E2E** | §11 | 没做 | 中 |
| **docker-compose.yml** | §7 + §12 | 用 homebrew 代替 | 低（本地能用） |
| **纹理缓存 session 清理** | §10 | 长时间用可能内存增长 | 低 |
| **LLM 断开客户端标记 error** | §10 | 停在 streaming 状态 | 中 |

### ⚠️ 简化但功能等价

- SSE 事件：3 种（delta/done/error）vs plan 的 5 种
- BranchTree：列表按钮 vs 树状
- WhatIfToggle/Provider：内联 vs 独立组件

---

## 9. 已修复的 bug（按时间顺序，供参考）

| Bug | 修复 | 文件 |
|-----|------|------|
| Prisma 自引用关系错误 | 删除 WhatIfBranch.childBranches | prisma/schema.prisma |
| `source.work = null` Zod 失败 | sanitizer: work=null -> source=null | promptBuilder.ts |
| `eventIndex = -1` Zod 失败 | sanitizer: 过滤负索引 | promptBuilder.ts |
| `newEvent` 是数组 Zod 失败 | 加 replacedEvents 字段 + sanitizer 转换 | whatif.ts + promptBuilder.ts + diffApplier.ts |
| Forked branch 第一 turn order=2 | 改为基于 ownTurns 而非 priorTurns | turns/route.ts |
| `canon: "推演"` Zod 失败 | sanitizer: 非法 canon 转 null | promptBuilder.ts |
| addedNodes 缺必填字段 | sanitizer: 补默认值（schema_version/portrait/thumb/era_layer/name_en）+ 过滤缺 id/name_zh/category 的 | promptBuilder.ts |
| `era_layer` 字符串 | sanitizer: 转 number | promptBuilder.ts |
| `aliases` 字符串 | sanitizer: 转 array | promptBuilder.ts |
| `source` 字符串 | sanitizer: 转对象 | promptBuilder.ts |
| LLM 删 46 节点过度激进 | prompt 加「图谱变化原则」章节 | promptBuilder.ts |

---

## 10. 继续开发的建议优先级

### 高优先级（防回归 + 防数据错误）

1. **集成测试（mock LLM）**：用 vitest mock `@anthropic-ai/sdk`，测 POST /api/whatif 和 turns API 端到端。防 sanitizer/prompt 改动引入回归。
2. **validateAgainstConfig diff 校验**：在 applyDiff 前调 `src/lib/data.ts` 现有的 `validateAgainstConfig`，检查 addedNodes 的 category 和 addedEdges 的 primary_type 是否在 project.config.json 声明。失败标 warning（不阻塞，但 UI 显示）。

### 中优先级（体验提升）

3. **Graph3D 过渡动画**：节点淡入（opacity 0->1, 300ms）、删除淡出（300ms 后移除）、diff 应用时暂停 force alpha 2 秒、isAnimating flag 与 900ms 布局动画互斥。**注意**：Graph3D.tsx ~1400 行很复杂，改前先读 L336-368（useMemo graphData）+ L402-440（focus mode）+ L807-811（相机动画）+ L1395-1397（d3ReheatSimulation）。
4. **时间线一致性校验**：在 validation.ts 加第三层--检测叙事中提到的 event 时序与 era_layer 是否冲突。
5. **error 级强制确认**：ValidationResults 里 error 级结果加「确认应用」按钮，不点则不 applyDiff。
6. **LLM 断开客户端标记 error**：streamWhatIf 的 fetch catch 里，除了 AbortError，其他错误要 setError + setStreaming(null)。

### 低优先级（polish）

7. **BranchTree 树状可视化**：用 d3-tree 或纯 React 渲染分支树。
8. **Playwright E2E**：mock LLM 后跑完整流程。
9. **docker-compose.yml**：方便没 homebrew postgres 的环境。
10. **纹理缓存清理**：WhatIfPanel 关闭时清理本 session 产生的临时纹理。

---

## 11. 关键陷阱（改代码时注意）

1. **Graph3D 是整体重建**：react-force-graph-3d 不支持增量更新，diff 应用 = 传新 graphData 触发重建。节点引用必须全新（不能复用旧引用）。
2. **Prisma Json 字段**：diff/narrative/choices/validation 存 Json，读出来是 `unknown`，要手动断言类型。
3. **replayBranch 不复制 base**：turns 为空时直接返回 base 引用（性能优化，但不要 mutate 返回值）。
4. **sanitizer 顺序**：parseLLMOutput 里先 sanitizeDiffJson 再 Zod parse。sanitizer 直接 mutate parsed 对象。
5. **fork 上下文**：turns API 里 priorTurns = parent branch 的 inherited turns + own turns。但 nextOrder 只基于 ownTurns（fork 后第一 turn order=1）。
6. **SSE 在 Vercel**：Node Runtime + maxDuration=300。Vercel Pro plan 单函数最长 300s 够用。Edge Runtime 不要用（Anthropic SDK 兼容性未验证）。
7. **CODING_API_KEY 是服务端变量**：无 `NEXT_PUBLIC_` 前缀，客户端不能直接访问。所有 LLM 调用必须走 Route Handler。

---

## 12. 原始 plan 文档

完整设计文档见：`/Users/marvin/.claude/plans/q1-q2-d-streamed-cerf.md`

包含：架构总览、数据模型、Prompt 工程、API 设计、前端组件、Diff 应用、幻觉校验、依赖配置、部署考量、8 周切分、风险规避、验证计划、文件清单。
