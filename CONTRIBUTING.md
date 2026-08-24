# Contributing

感谢参与 dsh-workbench。

1. 使用 Node.js `>=22.19.0` 与 pnpm `11.7.0`。
2. 从分支提交改动，不要提交 `artifacts/`、`plugins/`、`.pnpm-store/`、用户目录或 DSH profile 数据。
3. 运行 `pnpm install --frozen-lockfile` 和 `pnpm check`。
4. 涉及 DSH 集成边界时同步更新 ADR；用户可见变化同步更新 README 与 CHANGELOG。
5. PR 中说明兼容的 DSH 版本、验证范围和回滚方式。

不要修改或复制 DSH 官方源码来绕过公开 API，也不要把其他本地插件合并进本包。
