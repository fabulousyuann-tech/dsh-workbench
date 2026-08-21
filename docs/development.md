# 开发指南

本文档面向需要构建、测试、调试或二次开发 `dsh-workbench` 的开发者。

## 架构概览

插件分为三个构建单元：

| 单元 | 入口 | 产物 | 职责 |
| --- | --- | --- | --- |
| host | `src/index.ts` | `lib/index.js` | Cordis 插件入口，注册服务、设置命名空间与 AI 工具 |
| typert | `src/typert.host.ts` | `lib/typert.host.js` | Typert RPC host，供客户端调用 |
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
├── config.ts           # 插件配置（workspaceRoot / dataDir）
├── tools.ts            # 面向模型的 AI 工具（defineTool）
├── remote-contract.ts  # Typert RPC 接口定义
├── remote.ts           # 客户端 RPC 调用封装
├── settingsContract.ts # 设置项 RPC 契约
├── settingsHost.ts     # 设置命名空间注册（服务端）
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

测试位于 `tests/workbench.test.ts`，覆盖 frontmatter 解析、catalog 扫描、overlay 状态、筛选与搜索逻辑、到期计算、统计/提醒/批量、文件归集与会话引用格式化：

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

# 启动 Harness web 服务器
node ~/.dsh/profiles/node_modules/@deepseek-ai/dsh/lib/bin.js --profile web --port 3456
```

浏览器打开 http://127.0.0.1:3456/ 即可联调。

## 依赖对齐（重要）

Harness 核心包（`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-api-remotes` 等）必须以 **peerDependencies** 声明，由 Harness 提供单一实例。若某个包被插件重复安装出多副本，可能导致运行时 Symbol 不匹配（例如工具调用报 `Cannot read properties of undefined (reading 'prepare')`）。

修改依赖后务必执行：

```bash
pnpm install --no-frozen-lockfile
pnpm check
```

## 发布

```bash
pnpm build
npm publish            # 或 pnpm publish
```

发布内容由 package.json 的 `files` 字段控制：`lib/*`、`cordis.patch.yml`、`README.md`、`docs/*.md`、`LICENSE`。
