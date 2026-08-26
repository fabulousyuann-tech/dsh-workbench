# dsh-workbench

面向 DeepSeek Harness（DSH）的本地多工作台插件。它以“工作台 → 客户 → 项目 → 会话”组织目录，同时保留独立的普通会话与普通项目；同一条会话只显示在一个归属层级。

当前公开版本：`0.3.1`。已验证 DSH `0.1.1-rc.2`、Node.js `>=22.19.0`、pnpm `11.7.0`。

## 主要能力

- Codex 式单列侧边栏：普通会话、普通项目和多个工作台共享一套紧凑导航。
- 顶部“进行中”虚拟分区跨层级汇总等待处理、正在运行和刚完成的会话，显示所属工作台或项目并支持一键进入。
- 工作台、客户、项目、会话严格互斥归属，点击对应会话即可进入主聊天区。
- 客户与项目名称行直接展开或收起下级，右侧统一保留“＋”与“…”；可新建第二条及后续会话，管理操作统一收进菜单。
- 没有 Workspace 归属的历史会话仅在确有内容时显示为“未归类会话”，并可直接移入现有普通项目。
- 工作台根目录可在设置中重新关联；历史会话继续按旧路径映射，不改写 DSH 日志。
- 每个项目可打开会话图谱：查看 DSH 原生会话分支、按需展开轮次、从完成轮次精确分支并归档旧会话。
- 客户与项目的创建、重命名、移动、归档和安全删除；删除内容进入工作台内的 `.trash`。
- 项目文件按 Word、Excel、PPT、PDF、图片等类型归集和搜索。
- 模型可使用 `workbench_*` 工具查询和维护工作台；删除工具要求显式确认。
- 提供 `sidebar.settings.trailing` 公共列表插槽，独立插件可在“设置”右侧添加紧凑快捷按钮；折叠侧边栏时自动移到设置上方。
- 深浅主题、侧边栏收起/展开和 DSH 原生拖拽调宽。

## 重要兼容说明

Workbench 会禁用官方 `ui-sidebar` 行，并提供完整的替代侧边栏；官方 `ui-workspace`、会话、模型、日志和主对话区仍由 DSH 管理。它不会修改 DSH 官方源码，也不会复制或合并其他插件。

同一 profile 中不要同时启用另一个会接管 `ui-sidebar` 的插件。DSH 升级后应先在测试 profile 验证；目前只承诺上面列出的已验证版本，不承诺未知未来版本自动兼容。

## 安装

> npm 上的同名 `dsh-workbench` 属于其他项目。不要执行 `dsh plugin ... add dsh-workbench`，以免安装错误的软件包。

从 GitHub Releases 下载本仓库发布的 `dsh-workbench-0.3.1.tgz` 和对应 `.sha256`，校验后安装本地文件：

```bash
shasum -a 256 -c dsh-workbench-0.3.1.tgz.sha256
dsh plugin --profile web add /absolute/path/dsh-workbench-0.3.1.tgz
dsh --profile web --dump-config
dsh --profile web
```

插件 bundle 发生变化后必须完整重启 DSH，仅刷新浏览器不够。`--dump-config` 中应保留官方 `ui-workspace`，`ui-sidebar` 被禁用，并出现 `dsh-workbench` 行。

也可以从可信、固定的 Git commit 安装源码；目标环境会执行 `prepare` 构建：

```bash
dsh plugin --profile web add github:<owner>/<repo>#<full-commit-sha>
```

## 目录结构

每个工作台对应一个独立根目录：

```text
工作台根目录/
├── 客户 A/
│   ├── 项目 1/
│   │   ├── project.md
│   │   └── 项目文件...
│   └── 项目 2/
└── 客户 B/
    └── 项目 3/
```

`project.md` 可使用以下 frontmatter：

```yaml
---
title: 数据中台建设
productLine: 数据平台
stage: planning
owner: 李四
tags: [中台, 数据]
startedAt: 2026-08-01
dueAt: 2026-12-31
---
```

`stage` 支持 `opportunity`、`requirement`、`planning`、`execution`、`acceptance`、`retrospective`。插件自己的显示状态保存在 `dataDir/overlay.json`；DSH 会话与日志不存入该文件。

## 使用要点

- 顶部“新建会话”创建普通会话；普通 DSH Workspace 显示在“项目”分区。
- 没有项目归属的遗留会话会进入默认折叠的“未归类会话”；鼠标移到会话行，点击文件夹图标即可选择目标项目。该操作只更新 DSH 会话归属，不移动日志或磁盘文件。
- 工作台默认收起。展开后按客户、项目和其下会话显示，历史会话不会重复出现在普通会话。
- 点击客户或项目名称行直接展开或收起下级；点击具体会话行进入对应历史。当前会话所在的客户与项目会自动展开。
- 客户或项目行“＋”会在对应目录新建会话，不复用已有历史；客户重命名/删除及项目概览/会话图谱/删除位于各自行的“…”菜单。
- 会话图谱支持拖动会话卡片、平移、缩放和自动适配；布局只保存在当前浏览器，不包含会话正文或工具数据。
- 图谱中的“从这里分支”只在已完成轮次可用，调用 DSH 原生 fork 并直接进入新会话；归档后会话从项目图谱和侧边栏同时隐藏，日志仍由 DSH 保留。
- 工作台设置可更改名称、颜色、图标、顺序、默认项、模型策略和根目录路径。
- 更改根目录只重新关联路径，不移动、复制或删除文件。请先自行移动完整目录，再在设置里选择新位置。
- 删除客户或项目会移动到工作台根目录的 `.trash`；同名回收内容会自动增加序号，避免覆盖。
- 外部删除目录后，插件会清理失效的 DSH Workspace 注册，但不会删除会话日志。

## 配置

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `workspaceRoot` | `~/Documents/工作空间` | 首次创建默认工作台时使用的兼容入口 |
| `dataDir` | `~/.dsh-workbench` | overlay、迁移备份等插件状态 |
| `sidebarTitle` | `DSH` | 侧边栏左上角名称 |

## 数据与升级安全

- overlay v1 首次读取时会先生成 `overlay.v1.<timestamp>.backup.json`，再原子迁移到 v2。
- `0.1.0` 将项目状态按“工作台 + 客户 + 项目”隔离，避免不同客户的同名项目互相覆盖；旧的本地开发数据键在项目下次编辑时无损迁移。
- 移除工作台只移除 Workbench 注册，不删除目录、项目或 DSH 会话。
- 回滚插件前请停止 DSH，并备份 `dataDir` 与工作台目录。

## 开发与发布

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm pack --pack-destination artifacts
```

本仓库设置为 `private: true`，用于阻止误发布到 npm 上的同名包；GitHub Release 的 `.tgz` 仍可正常生成和安装。开发说明见 [docs/development.md](./docs/development.md)，架构边界见 [ADR 0001](./docs/adr/0001-dsh-integration-boundaries.md)，变更记录见 [CHANGELOG.md](./CHANGELOG.md)。

## 已知限制

- 当前只提供 Web client bundle。
- Host 与浏览器必须能访问同一套本地文件路径。
- 未来 DSH 版本可能改变 sidebar slot 或 bundle patch 行为，升级后需要重新验证。

## License

MIT，见 [LICENSE](./LICENSE)。
