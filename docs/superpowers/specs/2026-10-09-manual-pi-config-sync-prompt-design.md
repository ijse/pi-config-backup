# 手动 Pi 配置同步 Prompt 设计

## 目标与调用方式

在 Pi 对话中手动粘贴/调用一段 Prompt。它只同步明确允许的本机 Pi 配置到私有仓库 `/Users/liyi/pi-config-backup`（GitHub：`ijse/pi-config-backup`），并且在任何安全或 Git 前置检查失败时停止。Prompt 不安装新依赖、不调用付费服务、不 force-push、不自动 pull/merge/rebase，也不显示秘密或配置正文。

## 精确同步清单

默认拒绝所有未列出的路径、符号链接和非普通文件。执行前，逐段检查每个目标路径及其父目录（至仓库根目录）均不是符号链接；受管理目标中出现任意非普通文件或符号链接时停止。源到目标的映射如下：

| 源 | 目标 |
| --- | --- |
| `~/.pi/agent/AGENTS.md` | `agent/AGENTS.md` |
| `~/.pi/agent/{settings.json,keybindings.json,loadout.json,loadout-profiles.json,open-tui.json,web-search.json}` | 同名 `agent/` 文件 |
| `~/.pi/web-search.json` | `web-search.json` |
| `~/.pi/agent/{extensions,skills,agents,local-packages}` | 同名 `agent/` 目录 |
| `~/.pi/agent/mcp.json` | 仅生成 `agent/mcp.json.example`，绝不复制原文件 |

目录同步只允许普通文本/源码/JSON/Markdown、清单、锁文件和文档文件；递归排除 `node_modules/`、`.git/`、`.env*`、认证/凭据/密钥/证书文件、日志、临时文件、缓存、会话和备份。不要跟随符号链接。同步过程仅拥有上表的目标文件/目录：允许在它们内删除已由同步管理的陈旧内容，但永不删除或改写 `README.md`、`.gitignore`、`docs/`、`.git/` 或其他清单外路径。

## 安全控制

1. 真实 `agent/auth.json`、`agent/mcp.json`、session/cache/npm/git 目录和任何秘密文件必须同时在复制阶段硬排除，并由 `.gitignore` 覆盖；只允许 `agent/mcp.json.example` 被暂存。
2. `.gitignore` 是受控的仓库元数据例外：Prompt 必须确保并暂存明确的 denylist 规则（至少 `agent/auth.json`、`agent/mcp.json`、`agent/sessions/`、`agent/backups/`、`agent/npm/`、`agent/git/`、`agent/web-search-cache/`、`agent/mcp*-cache.json`、`agent/models-store.json`、`agent/session-summary.json`、`agent/pi-cache-optimizer-stats.d/`、`**/node_modules/`、`**/.git/`、`.env*`、`*.pem`、`*.key`），不得改动其他 `.gitignore` 规则。递归发现所有名称或路径匹配认证、credential、token、secret、password、key、certificate、session、cache、backup、log、tmp 或 denylist 的源候选；按上表映射成仓库相对路径，并对每一个以 `git check-ignore -v` 验证。无法分类、映射或验证即停止。
3. 在复制前和提交前均运行 `git ls-files` 的 denylist 检查。任何已跟踪的真实 MCP、认证、会话、缓存、依赖、`.env` 或密钥/证书路径都必须导致停止；`.gitignore` 不能作为已跟踪文件的补救措施。
4. MCP 模板采用严格的保守 schema：顶层只允许 `imports`（固定空数组）、`mcpServers`（对象）和 `settings`（对象）；settings 仅保留值恰为字符串 `off`/`on` 的 `hostConfigDiscovery` 和值恰为字符串 `compact`/`full`/`off` 的 `mcpFooterStatus`。每台 server 的名称必须匹配 `[A-Za-z0-9_-]{1,64}`；仅保留 `type`（`http`、`stdio` 或 `sse`）、`command`（不含空白、引号或 `=` 的单一可执行文件名）和 `url`（仅 `https`、无用户信息、query 或 fragment；host 必须是普通域名，path 不含 `@`、`:`、`=`）。所有 `headers`、`env`、`args`、imports 内容和未知字段一律删除，而不是猜测其安全性。任何删除的认证字段在同名位置写 `${SET_THIS_LOCALLY}` 仅当 JSON 结构需要该字段。任一值不符合 schema 时停止。模板必须能解析为 JSON，且绝不含源文件中被删除的值。
5. 暂存前对每一个待提交普通文件执行不回显内容的 fail-closed 秘密扫描：检测私钥 PEM、Bearer/Basic/Cookie、常见 API key/token、连接串、敏感字段赋值及明显高熵凭据。命中、无法扫描、二进制文件或不确定内容时，取消暂存并停止；不在输出中回显匹配值。
6. 在提交前人工审查 `git diff --cached --name-status` 与删除项。除受控 `.gitignore` 例外外，若任一路径不在清单内，或 `git ls-files` 显示真实 MCP 或任一受限路径，停止。

## Git 与远端流程

1. 确认工作树在同步前干净，分支为 `main`，upstream 为 `origin/main`。`remote.origin.url` 必须精确匹配允许的 HTTPS `https://github.com/ijse/pi-config-backup.git` 或 SSH `git@github.com:ijse/pi-config-backup.git` 形式；所有配置的 `remote.origin.pushurl` 也必须精确匹配其中之一。缺失、额外或不匹配的 push URL 均停止。
2. 通过 GitHub CLI 确认 `ijse` 账户已登录；使用该账户的凭据推送，但不得打印 token。运行 fetch 后，`HEAD` 必须等于 `origin/main`。远端领先、分叉、鉴权失败或没有 upstream 时停止，不自动整合远端变更。
3. 按清单同步并暂存。无暂存差异时报告“无需同步”，不创建提交或推送。
4. 通过所有安全检查后，以包含本地时间的消息创建一个提交并推送。普通 Git 无法原子化 commit/push：若 push 失败，必须报告“本地提交已创建但未推送”及 SHA，并保留提交以便用户处理；绝不报告成功。
5. 成功后使用远端分支 SHA 与 `HEAD` 精确比对，确认一致。

## 验收与报告

成功报告只能包含：是否有变更、提交 SHA（若有）、远端验证结果、仓库 URL 及非敏感的文件数量。不得输出 token、密码、Cookie、认证文件、配置正文或秘密扫描命中内容。

通过条件：初始 Git 基线一致；所有暂存路径符合清单或受控 `.gitignore` 例外；denylist 的 `git ls-files` 结果为空，且每个存在的受限源路径均通过 `git check-ignore -v`；MCP 模板为合法的白名单 JSON；秘密扫描与路径审查通过；有变化时远端 SHA 等于 `HEAD`，无变化时没有新提交。`git fsck` 可作为对象完整性补充检查，但不是安全检查的替代品。

此交付物为提示词/文档设计，不改变 Pi 运行时代码，免于独立行为测试。
