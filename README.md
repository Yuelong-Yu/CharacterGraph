# CharacterGraph

通用人物图谱制造工程，用同一份前端、数据 schema 和图像管线承载多个人物关系图谱的静态站点。
效果见：https://chronchaos.com/character-graph/greek

当前仓库内已有项目：

- `greek`：希腊神话人物谱
- `sanguo`：三国人物谱
- `xiyou`：西游记人物谱
- `shuihu`：水浒人物谱

首页会自动扫描 `projects/*/project.config.json` 并生成项目入口；单个图谱路由为 `/[project]`。

## 功能

- 多项目人物图谱：每个项目独立声明分类、关系类型、层标签、搜索提示、视觉画风。
- 3D 关系网络：基于 `react-force-graph-3d` 和 `three.js`，支持头像节点、中文标签、关系边、箭头、发光与阴影。
- 人物与器物节点：同一图谱可同时包含人物、武器、坐骑、宝物等 Artifact。
- 节点详情与关系详情：点击节点查看人物/器物资料，点击边查看关系事件时间线。
- 过滤与搜索：支持分类过滤、度数过滤、拼音/中文/英文/事件搜索。
- 聚焦模式：选中节点后只显示该节点及直接邻居。
- 自动巡游：按高度数节点优先的 DFS 序列巡游，适合展示复杂图谱。
- 静态部署：数据在构建期从 `projects/<slug>` 读取，客户端不需要后端 API。

## 技术栈

- Next.js App Router
- React
- TypeScript
- Zod
- three.js
- react-force-graph-3d
- Python 数据管线
- Python 图像生成管线

## 快速开始

```bash
pnpm install
pnpm dev
```

开发服务器启动后访问：

```text
http://localhost:3000
http://localhost:3000/greek
http://localhost:3000/sanguo
http://localhost:3000/xiyou
http://localhost:3000/shuihu
```

生产构建：

```bash
pnpm build
pnpm start
```

常用检查：

```bash
pnpm typecheck
```

`pnpm dev` 和 `pnpm build` 会先运行 `scripts/link-assets.mjs`，自动重建图片软链。

通过本地 ChronChaos 的 `/character-graph` 子路径联调时，在 `.env` 中设置
`NEXT_PUBLIC_BASE_PATH=/character-graph`，并让 CharacterGraph 以开发模式监听
3005：

```bash
pnpm exec next dev -p 3005
```

本地不要用 `next start` 测试运行时新增的分支图片；生产构建只会发现构建时
已存在的 `public` 文件，而开发模式会即时伺服新生成的图片。

## 项目结构

```text
projects/<slug>/
  project.config.json
  sources.json
  prompts.json
  data/
    characters/*.json
    artifacts/*.json
    relations.json
  images/
    portraits/*.webp
    thumbs/*.webp
    raw/*                # gitignored
```

关键目录：

```text
src/app/                 # Next.js 页面与路由
src/components/          # GraphShell、Graph3D、Legend、SearchBox 等
src/lib/data.ts          # 服务端加载 projects/<slug> 数据
src/schemas/             # TypeScript/Zod schema
scripts/data/            # 抓取、结构化提取、关系生成、校验
scripts/images/          # 图像生成、裁切 portraits/thumbs
public/p/                # 指向 projects/<slug>/images 的本地软链，gitignored
```

## 单个图谱的配置

`project.config.json` 是每个图谱的配置入口，负责定义：

- `slug`：路由名和项目目录名
- `title` / `subtitle`：首页和图谱标题
- `order`：首页排序
- `searchPlaceholder`：搜索框提示
- `zhSource`：中文源优先级，`wikipedia` 或 `baike`
- `characterCategories`：人物分类及颜色
- `artifactCategories`：器物分类及颜色
- `relationTypes`：关系类型及颜色
- `eraLayers`：层级标签
- `nodeVisualTheme`：头像视觉主题
- `artStyle`：图像管线使用的人物/器物画风

分类和关系类型没有全局枚举。每个项目自己声明合法 slug，加载时由 `src/lib/data.ts` 校验数据里的 `category`、`primary_type`、`composite_types` 是否存在于当前项目配置。

## 数据格式

TypeScript schema 在 `src/schemas/character.ts`，Python schema 在 `scripts/data/schemas.py`。两边描述同一份数据契约：

- `Character`：人物节点
- `Artifact`：器物节点
- `Relation`：人物-人物或人物-器物关系边
- `Dataset`：构建期传给前端的完整数据集

字段变更时必须同时更新 TypeScript 和 Python schema，并提升 `SCHEMA_VERSION`。

## 数据管线

数据脚本位于 `scripts/data`，所有命令都必须显式指定项目：

```bash
cd scripts/data
uv sync
uv run validate_project.py --project greek
uv run fetch_wiki.py --project greek
uv run extract_structured.py --project greek
uv run extract_relations.py --project greek
uv run translate_quotes.py --project greek
```

输入：

- `projects/<slug>/project.config.json`
- `projects/<slug>/sources.json`

输出：

- `projects/<slug>/data/raw/*`：抓取原文，不进仓库
- `projects/<slug>/data/characters/*.json`
- `projects/<slug>/data/relations.json`

`extract_relations.py` 会重写关系文件，增量维护时先确认当前项目是否适合整文件重建。

## 图像管线

图像脚本位于 `scripts/images`：

```bash
cd scripts/images
uv sync
uv run health_check.py
uv run generate_portraits.py --project greek
uv run generate_portraits.py --project greek zeus hera --parallel 1
```

输入：

- `projects/<slug>/project.config.json` 中的 `artStyle`
- `projects/<slug>/prompts.json`
- `projects/<slug>/sources.json`

输出：

- `projects/<slug>/images/portraits/{id}.webp`
- `projects/<slug>/images/thumbs/{id}.webp`
- `projects/<slug>/images/raw/{id}.png`，不进仓库

图像生成会调用外部模型并产生费用。批量生成前先运行 `health_check.py`，不要无确认重生成已有图片。

## 环境变量

复制 `.env.example` 为 `.env` 并按需填写：

```text
IMAGE_API_KEY
IMAGE_BASE_URL
IMAGE_MODEL
CODING_API_KEY
CODING_BASE_URL
CODING_MODEL
NEXT_PUBLIC_BASE_PATH
UV_BIN
AUTH_SECRET
```

说明：

- `IMAGE_*` 用于图像生成管线。
- `CODING_*` 用于 LLM 结构化提取。
- `NEXT_PUBLIC_BASE_PATH` 用于子路径部署，例如 `/character-graph`。
- `UV_BIN` 可显式指定图像生成子进程使用的 `uv`；进程管理器无法继承 shell
  `PATH` 时应填写绝对路径。
- `AUTH_SECRET` 用于验签 chronchaos_gpt 签发的 `chron_user` Cookie；生产环境必须与 chronchaos_gpt 使用同一随机值。

## 与 ChronChaos 共用账号

“如果”推演不复制账号或密码。chronchaos_gpt 负责登录、注册和签发
`chron_user` HttpOnly Cookie，CharacterGraph 使用相同的 `AUTH_SECRET` 验签，
并把 Cookie 中的 `User.id` 保存为 `WhatIfSession.ownerId`。两个应用可以使用
不同的 PostgreSQL 数据库。

自创人物分支、人物/关系记录、用户新增事件、当前活跃自创分支以及“如果”
分支继承的人物快照保存在 `UserProjectContent`，同样以外部 `User.id` 隔离。
旧版 IndexedDB 数据会在用户登录后合并进该账号；服务器确认保存成功后才会
删除浏览器中的未归属副本，避免同一台设备切换账号时重复认领。搜索、筛选、
布局和引导页已读状态仍属于设备偏好，不上传服务器。

部署或升级后先运行迁移：

```bash
pnpm exec prisma migrate deploy
```

新增 `ownerId` 前已经存在的推演会保留为未归属状态，并且不会显示给任何
普通用户。如需将确认无误的旧数据交给某个账号，由管理员在 CharacterGraph
数据库显式执行：

```sql
UPDATE "WhatIfSession"
SET "ownerId" = '<chronchaos User.id>'
WHERE "ownerId" IS NULL;
```

不要自动把旧数据分给首个登录用户，否则可能造成跨用户数据泄露。

## 图片服务

数据文件中的 `portrait` / `thumb` 通常写成：

```json
"/p/greek/portraits/zeus.webp"
"/p/greek/thumbs/zeus.webp"
```

构建时 `scripts/link-assets.mjs` 会创建：

```text
public/p/<slug> -> projects/<slug>/images
```

`public/p/` 是生成产物，不进仓库。部署前确保已经执行过 `pnpm build` 或 `pnpm run link-assets`。

## 添加新图谱

1. 新建 `projects/<slug>/project.config.json`。
2. 准备 `sources.json`，列出人物/器物来源和标题覆盖。
3. 准备或生成 `data/characters/*.json`、`data/artifacts/*.json`、`data/relations.json`。
4. 准备 `prompts.json`。
5. 运行数据校验：

```bash
cd scripts/data
uv run validate_project.py --project <slug>
```

6. 生成或放入图片：

```bash
cd scripts/images
uv run generate_portraits.py --project <slug>
```

7. 回到仓库根目录运行：

```bash
pnpm build
```

只要 `project.config.json` 存在且未设置 `draft: true`，新图谱会自动出现在首页。

## 部署

本项目是静态友好的 Next.js 站点。生产部署的关键点：

- 运行 `pnpm build`，让项目数据在构建期被读取并预渲染。
- 确保 `public/p/<slug>` 图片软链存在，或在服务器上保留等价的图片可访问路径。
- 如果部署在子路径，设置 `NEXT_PUBLIC_BASE_PATH`。
- 示例 PM2 配置见 `ecosystem.config.cjs`。

## 开发约定

- UI 文案和注释默认使用中文。
- `projects/*/data/raw/`、`projects/*/images/raw/`、`public/p/`、`.next/`、`node_modules/` 不提交。
- 引用类字段要保留出处；没有可靠来源时宁缺毋滥。
- 修改 schema 时同步更新 TypeScript 与 Python 两侧。
