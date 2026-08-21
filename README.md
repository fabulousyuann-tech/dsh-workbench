# dsh-workbench

AI 辅助的本地项目管理工作台，作为 [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/) 插件即插即用。

以 **客户 → 项目** 的层级组织你的项目工作区，每个项目是一个带 `project.md` 的文件夹。插件自动扫描工作区并同步到 Harness 侧边栏，同时为 AI 提供客户/项目的查询与维护工具。

## 特性

- **客户 → 项目 两级目录**：工作区内以客户为顶层目录，每个客户下是多个项目文件夹。
- **侧边栏工作台面板**：替换默认侧边栏，展示客户分组、项目卡片（阶段、负责人、截止日期、标签）。
- **仪表盘**：一键展开统计概览（项目总数 / 进行中 / 已交付 / 已归档 / 客户数）与到期提醒（逾期、即将到期），点击提醒直达项目详情。
- **筛选与搜索**：按阶段 / 产品线 / 负责人筛选，按关键词搜索。
- **新建项目**：在 UI 中直接创建客户与项目，自动生成 `project.md`。
- **项目文件归集**：项目详情内置「项目文件」区，把 Word / Excel / PPT / PDF / 图片 / 压缩包等按类型自动归集，支持按类别与关键词过滤，点击可直接打开。
- **会话引用项目**：在会话输入框输入 `@` 或 `/` 可引用当前 / 任意项目，把项目上下文（含 `project.md`）交给模型。
- **AI 工具**：为 Harness 会话注入 `workbench_list_customers` / `workbench_list_projects` / `workbench_list_project_files` 等工具，模型可以直接查询与维护你的工作区。
- **Overlay 状态**：项目阶段、负责人等非文件元数据保存在 `overlay.json`，不污染你的项目文件。
- **设置页**：可在 Harness 设置中修改工作区根目录与数据目录。

## 环境要求

- Node.js >= 22.19.0
- pnpm >= 10
- DeepSeek Harness（`@deepseek-ai/dsh-*` 系列 `0.1.0-rc.6` 或 `0.1.0-rc.7`）

## 即插即用安装

将 `dsh-workbench` 安装到 Harness 的 profile 中：

```bash
cd ~/.dsh/profiles/web   # 或 desktop profile
pnpm add dsh-workbench
```

然后在 profile 的 `package.json` 中注册 bundle：

```json
{
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-workbench"]
    }
  }
}
```

> 插件自带的 [cordis.patch.yml](./cordis.patch.yml) 会自动禁用内置 `ui-sidebar` 并注入工作台，无需手动配置。

从 GitHub 安装（未发布 npm 时）：

```bash
pnpm add git+https://github.com/<your-name>/dsh-workbench.git
```

## 工作区结构

默认工作区为 `~/Documents/工作空间`（可在设置中修改）：

```
工作空间/
├── 客户A/
│   ├── 项目1/
│   │   ├── project.md      # 项目元数据（frontmatter）
│   │   └── ...             # 项目内容
│   └── 项目2/
│       └── project.md
└── 客户B/
    └── 项目3/
        └── project.md
```

`project.md` frontmatter 示例：

```yaml
---
title: 数据中台建设
productLine: 数据平台
stage: planning        # opportunity | requirement | planning | execution | acceptance | retrospective
owner: 李四
tags: [中台, 数据]
startedAt: 2026-08-01
dueAt: 2026-12-31
---
```

非文件状态（如阶段、负责人）若写在 frontmatter 会被同步；除此之外的临时状态保存在数据目录的 `overlay.json`。

## 配置项

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `workspaceRoot` | `~/Documents/工作空间` | 客户 / 项目根目录 |
| `dataDir` | `~/.dsh-workbench` | overlay 等非文件状态存储位置 |

## AI 工具

插件注册的模型工具（模型可直接在会话中调用）：

- `workbench_list_customers` — 列出全部客户及项目数
- `workbench_list_projects` — 按客户 / 关键词 / 阶段筛选列出项目
- `workbench_get_project` — 获取单个项目详情与 `project.md` 正文
- `workbench_list_project_files` — 归集并列出项目内的文件（按 word / excel / ppt / pdf 等分类，可按类别与关键词过滤）
- `workbench_create_project` — 在指定客户下新建项目并生成 `project.md`
- `workbench_update_project` — 更新项目元数据（标题、阶段、负责人、产品线）
- `workbench_archive_project` — 归档 / 恢复项目
- `workbench_move_project` — 变更项目所属客户（移动文件夹）
- `workbench_delete_project` — 删除项目（移入 `.trash`）
- `workbench_create_customer` / `workbench_rename_customer` — 新建 / 重命名客户
- `workbench_statistics` — 工作台统计：阶段 / 客户 / 产品线 / 负责人分布与到期概览
- `workbench_due_reminders` — 到期提醒：已逾期与即将到期项目（支持 `days`、`customer` 过滤）
- `workbench_batch_update` — 批量更新多个项目（阶段 / 负责人 / 产品线 / 归档 / 所属客户）

模型可以在会话中直接说「列出所有客户和项目」「有哪些项目快到期了」「把官网改版和 App 项目标记为已完成」「找一下官网项目里的 PPT」来使用。

## 在项目里工作

**打开项目详情**：在左侧工作台展开客户分组，点击项目即可打开详情，包含项目元数据、`project.md` 文档，以及「项目文件」归集区。

**引用项目进会话**：在会话输入框输入 `@` 会弹出项目候选（输入「当前项目」引用左侧打开的项目），`/` 可直接把当前打开的项目交给对话。被引用的项目会附上标题、客户、阶段、负责人、截止日期、标签与 `project.md` 正文，模型可以直接基于它工作。

**文件归集**：项目文件夹内的文件按扩展名自动归为 `word / excel / ppt / pdf / text / image / archive / other` 八类。在项目详情的「项目文件」区可按类别切换、按文件名搜索，点击文件可直接在系统中打开。Word、Excel、PPT、PDF 等办公文件无需整理目录即可按类型快速查找。

## 开发

```bash
pnpm install
pnpm check    # typecheck + test + build
pnpm test     # 仅运行测试
pnpm build    # 仅构建（产物输出到 lib/）
```

详见 [docs/development.md](./docs/development.md)。

## License

MIT © 2026 dsh-workbench contributors。详见 [LICENSE](./LICENSE)。
