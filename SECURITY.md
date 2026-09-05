# Security Policy

## Supported version

安全修复只维护当前最新 release。当前兼容基线为 DSH `0.1.1-rc.2`、`0.1.2-alpha.1`、`0.1.2-alpha.2` 与 `0.1.2-rc.1`。

## Reporting

请不要在公开 issue 中提交密钥、个人路径、会话日志、客户名称或项目文件。请通过 GitHub 的私密漏洞报告功能联系维护者，并提供：受影响版本、最小复现步骤、影响范围和建议修复方向。

## Local data boundary

Workbench 在本机读取配置的工作台目录，并可通过 UI 或模型工具创建、移动文件夹。项目删除使用工作台内部的 `.trash`，但仍应在升级或批量操作前备份重要目录。

安装包不会包含用户的 overlay、工作台目录、会话日志、其他本地插件或凭据。只从可信的 GitHub Release 下载并校验 SHA-256。
