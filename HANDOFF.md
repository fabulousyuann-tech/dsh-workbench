# dsh-workbench 开发交接文档

> 面向新接手的 agent：读完本文档 + `README.md` + `docs/development.md`，即可无缝继续开发。
> 本文档与代码保持同步，重大变更后请更新。

## 0. 如何快速开始

```bash
cd /Users/fabulousyuan/AGENT/TRAE/code-mode/dsh-workbench
pnpm install
pnpm check    # typecheck + test + build 全量，开发前后各跑一次
```

- **首次给新 agent 的提示**：先读 `HANDOFF.md` → `README.md` → `docs/development.md`，再浏览 `src/` 目录。
- **git 状态提醒（截至本交接文档）**：仓库尚未有首个 commit（全部文件处于 untracked）。接手后建议先 `git add` 并创建初始提交，避免进度丢失。
- 本地联调：见 `docs/development.md`「本地联调（WebUI）」一节（link 安装到 `~/.dsh/profiles/web`，启动 Harness web 服务器后打开 `http://127.0.0.1:3456/`）。

## 1. 项目定位

AI 辅助的**本地项目管理工作台**（DeepSeek Harness 插件，即插即用）。以「客户 → 项目」两级目录组织工作区，每个项目是一个带 `project.md`（frontmatter 元数据）的文件夹。插件自动扫描工作区并同步到侧边栏，同时为 AI 提供 14 个查询/维护工具。

## 2. 架构概览

三个构建单元（由 [tsdown.config.ts](tsdown.config.ts) 驱动，产物输出到 `lib/`）：

| 单元 | 入口 | 产物 | 职责 |
| --- | --- | --- | --- |
| host | `src/index.ts` | `lib/index.js` | Cordis 插件入口：注册 WorkbenchService、设置命名空间、14 个 AI 工具 |
| typert | `src/typert.host.ts` | `lib/typert.host.js` | Typert RPC host 契约（17 个调用点） |
| client | `src/client/index.tsx` | `lib/client.js` | React 侧边栏面板、项目详情、仪表盘、设置卡片（CJS + `__ModuleLoader__` 注入） |

### 目录结构

```
src/
├── index.ts            # 插件入口（apply），注入 settings / tools
├── service.ts          # 核心业务：扫描、客户/项目 CRUD、overlay、统计/提醒/批量
├── catalog.ts          # 工作区目录扫描 + 过滤/搜索（matchesFilter/matchesQuery）
├── frontmatter.ts      # project.md frontmatter 解析（轻量 YAML 子集，兼容 snake/camelCase）
├── files.ts            # 项目文件递归扫描 + 按扩展名归集（8 类）
├── overlay.ts          # overlay.json 读写（进程内串行锁 + 原子写）
├── config.ts           # 配置（workspaceRoot / dataDir）
├── schemas.ts          # RPC 请求/响应 Zod 校验（含过滤值边界兼容）
├── remote-contract.ts  # Typert RPC 接口定义（codec: strict + Zod schema）
├── remote.ts           # Typert 契约声明（TYPERT_REMOTE）
├── typert.host.ts      # Typert host 声明（invocations）
├── tools.ts            # 14 个 AI 工具（defineTool）
├── settingsContract.ts / settingsHost.ts  # 设置命名空间
└── client/
    ├── index.tsx       # 客户端注入、remote 封装（face）
    ├── sidebar/        # 工作台侧边栏（双 Tab、过滤栏、客户/项目列表）
    ├── WorkbenchDashboard.tsx      # 统计 + 到期提醒仪表盘
    ├── WorkbenchProjectDetail.tsx  # 项目详情弹窗 + 文件归集区
    ├── WorkbenchSettingsCard.tsx   # 工作空间设置卡片
    ├── catalogSync.ts  # 前端 1s 轮询 revision，变化时 bumpLibrary
    ├── projectTriggers.ts  # 输入框 @ / 引用项目到对话
    ├── selection.ts / persistence.ts  # 选中态与 UI 状态（localStorage）
    └── pluginCss.ts     # CSS 注入注册表（build 时内联）
```

### 数据流

```
[磁盘工作区] --scan--> catalog --RPC--> 客户端 sidebar UI
                    --overlay--> 状态持久化（~/.dsh-workbench/overlay.json）
    AI 会话 --tools--> service <--RPC-- UI 操作
```

## 3. 核心数据模型与约定

- **项目生命周期 6 阶段**（`types.ts` 的 `PROJECT_STAGES`，新增阶段需同步：
  `types.ts`、`schemas.ts`、`tools.ts` 枚举、`client/locales.ts` 文案）：
  `opportunity` / `requirement` / `planning` / `execution` / `acceptance` / `retrospective`
- **目录结构**：`<workspaceRoot>/<客户>/<YYYY-MM-DD_标题>/project.md`
- **frontmatter 字段**：`title` / `product_line` / `stage` / `owner` / `started_at` / `due_at` / `tags`。
  解析兼容 snake_case 与 camelCase；写入用 snake_case。
- **Overlay**：非文件状态（阶段覆盖、负责人、产品线、`archived` 标记、MRU 工作空间、rules）存 overlay.json。
  并发写必须走 `withOverlayLock(dataDir, ...)`；`saveOverlay` 用临时文件 + rename 原子写。
- **归档**：`archived` 存 overlay，不删文件；归档项目在「全部」列表可见并带「已归档」徽标。
- **回收站**：删除 = 移动到 `<workspaceRoot>/.trash/...`，同名自动加 `-2` 后缀；清理对应 overlay 记录。
- **过滤**：`ProjectFilter = "all" | ProjectStage`。**边界兼容**：旧客户端 legacy 值
  `active/done/archived` 在 `schemas.ts` 的 `projectFilterSchema` 枚举中显式放行（不要用 Zod `.catch()`，
  网关边界校验不识别），再由 `service.ts` 的 `normalizeFilter` 归一为 `"all"`。
- **RPC 校验**：所有请求/响应经 `schemas.ts` Zod 校验；新增接口要同时更新 `remote-contract.ts` 的
  `WORKBENCH_INVOCATIONS`、`client/index.tsx` 的 `WorkbenchRemote`/face 类型、`tools.ts`（如需模型可见）。
- **i18n**：所有 UI 文案走 `locales.ts`（zh/en 双语），TSX 里用 `t("key")`，不要硬编码中文。

## 4. 已完成功能（截至交接）

### 数据与后端（service / catalog / overlay）
- 客户-项目两级目录扫描，frontmatter 元数据提取，overlay 状态合并
- 客户：新建 / 重命名 / **删除（含项下全部项目，移入 .trash + 清理 overlay）**
- 项目：新建（写 project.md 模板）/ 更新元数据 / 归档恢复 / 移动所属客户 / 删除
- `batchUpdate`：多项目批量改阶段/负责人/产品线/归档/移动客户
- `statistics`：总数/未归档/已归档/已交付 + 按阶段/客户/产品线/负责人分布 + 到期概览
- `dueReminders`：逾期 + 7 天内到期提醒（支持 days/customer 过滤）
- 文件归集：项目内文件按扩展名归为 8 类（word/excel/ppt/pdf/text/image/archive/other）
- 工作空间：listWorkspaces（MRU）/ setWorkspaceRoot / refreshCatalog / getRevision
- 实时同步：fs.watch + 指纹兜底轮询（`libraryWatch.ts`），目录变更自动失效缓存

### UI（client）
- 侧边栏双 Tab（会话 / 工作台），可折叠 rail
- 工作台列表：搜索框、**阶段过滤栏**（全部 + 6 阶段胶囊，滚动容器）、客户分组折叠、
  项目相对时间、已归档徽标
- 工具栏：新建客户 / 新建项目 / 刷新；客户重命名 / 删除（RiskConfirmation 确认）
- 项目详情弹窗：查看/编辑元数据、project.md 正文、归档/恢复、移动客户、删除、
  打开文件夹、**文件归集区**（类别分组 + 关键词/类别过滤 + 点击打开）
- 仪表盘：统计卡片 + 逾期/即将到期提醒，点击直达项目
- 设置卡片：切换工作空间根目录（目录选择器）
- 输入触发：`@项目名` / `/current project` 把项目上下文注入对话

### AI 工具（14 个，见 README「AI 工具」）
查询 5 个（list_customers/list_projects/get_project/statistics/due_reminders）+
增删改 8 个（create_project/create_customer/rename_customer/update_project/
archive_project/move_project/delete_project/batch_update）+ 文件 1 个（list_project_files）。

## 5. 构建 / 测试 / 校验命令

```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run（tests/workbench.test.ts）
pnpm build       # tsdown 输出 lib/
pnpm check       # typecheck + test + build 全量
```

## 6. 踩坑记录（重要）

1. **typert 边界校验不识别 Zod `.catch()`**：给 schema 字段加 `.catch("all")` 并不能让旧客户端的
   legacy 过滤值通过网关校验（报 `wire field "request" failed boundary validation`）。
   正确做法是把 legacy 值**显式写进枚举**（见 `schemas.ts`），再在 service 层归一化。
2. **依赖必须 peerDependencies**：`@deepseek-ai/dsh-*` 核心包不得被插件重复安装出多副本，
   否则运行时 Symbol 不匹配（工具调用报 `Cannot read properties of undefined (reading 'prepare')`）。
   改依赖后：`pnpm install --no-frozen-lockfile` + `pnpm check`。
3. **CSS 注入**：客户端样式经 `tsdown.config.ts` 的 `inlineCssPlugin` 在构建时内联进 `pluginCss.ts`，
   通过 `registerPluginCss` 注入。改 CSS 后必须 `pnpm build` 生效；样式要挂在
   `[data-plugin="dsh-workbench"][data-surface="..."]` 作用域下避免污染。
4. **新增阶段/类别的同步点**：`types.ts` 枚举、`schemas.ts`、`tools.ts` 的 enum、`locales.ts` 文案、
   文件归集类别（`files.ts` + `types.ts`）要一起改，缺一处会导致校验或显示不一致。
5. **overlay 并发**：所有 overlay 写操作必须用 `withOverlayLock`，否则并发请求可能写坏文件。

## 7. 待办 / 可选后续方向（候选任务）

以下为可继续开发的候选方向（按优先级主观排序，接手时可自行取舍/增补）：

- [ ] 仓库初始化：创建首个 git commit（当前全部文件未跟踪）
- [ ] **批量操作的 UI 入口**：目前 `batchUpdate` 仅模型可调用，UI 侧无批量选中/批量归档/批量移动入口
- [ ] 统计可视化：仪表盘加按阶段/客户/负责人的图表（当前只有数字卡片）
- [ ] 阶段流转的快捷操作：详情页一键「推进到下一阶段」按钮
- [ ] 客户 `_customer.md` 的支持深化：目前仅扫描 `hasCustomerDoc` 标记，无编辑入口
- [ ] `dueAt` 到期提醒的 UI 通知/角标（当前仅在仪表盘展开时可见）
- [ ] frontmatter 解析器升级：支持嵌套结构 / 多行值（当前为轻量子集）
- [ ] 工作区文件的“移动/复制”支持（目前仅客户目录整体重命名）
- [ ] 更多文件类别 / 自定义扩展名映射的配置项

## 8. 给新 agent 的启动提示

- 先跑 `pnpm check` 确认基线是绿的，再动代码。
- 每次改动后跑 `pnpm typecheck && pnpm test && pnpm build`，确保 `lib/` 已更新。
- 涉及 RPC 的改动，检查 `remote-contract.ts`、`client/index.tsx` face 类型、`schemas.ts` 三处同步。
- UI 文案一律走 locales，新增 key 同时补 zh/en。
- 不确定当前进度时，grep `HANDOFF.md` / `docs/development.md` / 最近的 git log。
