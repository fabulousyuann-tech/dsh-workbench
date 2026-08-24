# 开发指南

本文档面向需要构建、测试、调试或二次开发 `dsh-workbench` 的开发者。

## 架构概览

插件分为三个构建单元：

| 单元 | 入口 | 产物 | 职责 |
| --- | --- | --- | --- |
| host | `src/index.ts` | `lib/index.js` + `lib/index.d.ts` | Cordis 插件入口，注册服务、设置命名空间与 AI 工具 |
| typert | `src/typert.host.ts` | `lib/typert.host.js` + `lib/typert.host.d.ts` | Typert RPC host，供客户端调用 |
| client | `src/client/index.tsx` | `lib/client.js` | React 侧边栏面板与设置卡片 |

### 目录结构

```
src/
├── index.ts            # 插件入口（apply），注入 settings / tools 上下文
├── service.ts          # 核心业务逻辑：工作区扫描、客户/项目 CRUD、overlay 状态、统计/提醒/批量
├── catalog.ts          # 工作区目录扫描与元数据提取
├── frontmatter.ts      # project.md frontmatter 解析（轻量 YAML 子集）
├── files.ts            # 项目文件扫描与按扩展名归集（word/excel/ppt/pdf/...）
├── overlay.ts          # overlay.json 状态读写（带文件锁并发控制）
├── spaces.ts           # Space CRUD、排序、默认/选择、路径解析与 missing-dir 状态
├── policy.ts           # 新会话策略优先级、route/auxiliary 能力判定
├── auxiliary.ts        # 可选 dshAuxiliary Cordis JSON 服务契约
├── config.ts           # 插件配置（workspaceRoot / dataDir）
├── tools.ts            # 面向模型的 AI 工具（defineTool）
├── remote-contract.ts  # Typert RPC 接口定义
├── remote.ts           # 客户端 RPC 调用封装
├── settingsContract.ts # 设置项 RPC 契约
├── settingsHost.ts     # installSettingsSection 与热更新配置源（服务端）
└── client/             # React 前端
```

### 数据流

```
[磁盘工作区] --scan--> catalog --RPC--> 客户端 sidebar UI
                    --overlay--> 状态持久化
    AI 会话 --tools--> service <--RPC-- UI 操作
```

## 构建

构建由 [tsdown.config.ts](../tsdown.config.ts) 驱动，输出三个 ESM/CJS 产物到 `lib/`：

- host 与 typert 为 Node ESM
- client 为浏览器 CJS，通过 `window.__ModuleLoader__.load` 注册到 Harness 客户端

## 测试

测试位于 `tests/workbench.test.ts`、`tests/spaces.test.ts`、`tests/policy.test.ts`、`tests/sessionOwnership.test.ts` 与 `tests/fileUploadCompat.test.ts`。当前 74 项覆盖
frontmatter/catalog、overlay v1→v2 备份迁移与恢复、Space CRUD/路径规范化/歧义保护、策略优先级、
route 缺失、辅助插件存在/不存在、UI 键盘/响应式契约，以及原有统计/提醒/批量/文件能力：

```bash
pnpm test          # vitest run
pnpm typecheck     # tsc --noEmit
pnpm check         # typecheck + test + build 全量
```

## 本地联调（WebUI）

```bash
# 将插件以 link 方式安装进 web profile
cd ~/.dsh/profiles/web
pnpm add dsh-workbench@link:/绝对/路径/dsh-workbench

# 启动固定版本的 Harness web 服务器
npx --yes @deepseek-ai/dsh@0.1.1-rc.2 web --port 3456 --no-open
```

浏览器打开 http://127.0.0.1:3456/ 即可联调。

## 依赖对齐（重要）

Harness 核心包（`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-api-remotes` 等）必须以 **peerDependencies** 声明，由 Harness 提供单一实例。若某个包被插件重复安装出多副本，可能导致运行时 Symbol 不匹配（例如工具调用报 `Cannot read properties of undefined (reading 'prepare')`）。

当前兼容基线是 CLI/web/runtime `0.1.1-rc.2`，全部 DSH peer/dev 依赖使用同一精确版本。
根开发环境通过 `@deepseek-ai/dsh@0.1.1-rc.2` 提供完整宿主矩阵，避免只升级部分 API 包。
完整矩阵与 API 结论见
[ADR 0001](./adr/0001-dsh-integration-boundaries.md)。

## Sidebar 扩展插槽

Workbench 替代官方 Sidebar 时继续承载 DSH 的公开子插槽，并额外提供一个可选列表插槽：

| 插槽 | owner props | 布局 |
| --- | --- | --- |
| `sidebar.settings.trailing` | `{ wide: boolean }` | 展开时位于“设置”右侧；折叠时位于“设置”上方 |

该插槽适合重启、状态检查等紧凑图标操作。消费者应继续保留不依赖 Workbench 的主入口，且对中断性操作提供显式确认。不要通过 DOM 查询、绝对定位或修改 Workbench 样式插入按钮；不存在该插槽时应静默跳过快捷入口。

修改依赖后务必执行：

```bash
pnpm install --no-frozen-lockfile
pnpm check
```

## 发布

```bash
pnpm check
pnpm pack --pack-destination artifacts
```

发布内容由 package.json 的 `files` 字段控制：运行时与类型产物、`cordis.patch.yml`、README、
开发文档、ADR 与 LICENSE。发布前应解包确认不含 `.pnpm-store`、其它插件源码、本地绝对路径、
credentials 或用户数据。

本包因 npm 上存在无关的同名项目而设置为 `private: true`，禁止误执行 npm publish。
正式分发使用 GitHub Release 的 `.tgz` 与 `.sha256`。发布验证使用真正隔离的 `DSH_HOME`：

```bash
export DSH_HOME="$(mktemp -d)/dsh-home"
dsh plugin --profile web add /absolute/path/dsh-workbench-0.1.3.tgz
dsh --profile web --dump-config
dsh --profile web --port 3469 --no-open
```

安装/移除/重装/升级/降级只改变 profile 依赖和 bundle 层；Bundle 变化必须重启才生效。
官方 `ui-workspace` 必须来自 `@deepseek-ai/dsh-web-app`，不要在 profile 中保留本机源码 link。
