# Pi 半自动模型路由（本地扩展）

在 Pi TUI 中以 GitHub Copilot Terra 为日常基线，明确简单任务可用 Luna，复杂任务升级 Sol/Astra 前确认。**本地规则，不调用分类模型，不新增 LLM 工具，不修改提示词或工具 loadout。**

## 生效

本次已设置新会话默认 `github-copilot/gpt-5.6-terra` / `medium`，更新截图中的15个快捷模型。

1. 等待当前任务及所有 Subagent 结束。
2. 输入 `/reload` 加载扩展。
3. 当前已有会话默认保守锁定，输入 `/route auto` 才接管并回到 Terra。
4. 全新启动的 Terra 空白会话会自动启用。若新建会话仍继承其他模型，执行 `/route auto`。

只重载扩展不保证旧会话的 Ctrl+P scope 重建；新进程会读取新的15模型列表，已有会话可用 `/scoped-models` 检查。

## 命令

| 命令 | 行为 |
|---|---|
| `/route`、`/route status` | 当前模式、模型、思考强度、升级询问状态与帮助 |
| `/route auto`、`/route reset` | 回 Terra/medium，开启新的路由任务 |
| `/route off` | 关闭自动路由，保持当前模型 |
| `/route luna` | Luna/low，锁定手动模式 |
| `/route terra` | Terra/medium，锁定手动模式 |
| `/route sol`、`/route astra` | 确认后选档（medium），锁定手动模式 |

`/model`、Ctrl+P 或其他扩展改变模型会暂停自动路由；`/route auto` 恢复。手动改变思考强度不会被每条消息重置。

## 路由规则与预算边界

- 一个路由任务由新会话或 `/route reset` 开始，不自动猜测你何时换了主题。
- 首次独立请求是400字符以内的明确翻译、润色、术语解释或摘要，且无代码/风险/图片/文件引用信号，可从 Terra 降为 Luna/low。
- Luna 遇到实质性编码或不确定任务恢复 Terra。简短“继续”“好的”“2”不会切换。
- 跨模块重构、系统设计、难复现排障建议 Sol；安全审计、生产故障、数据一致性等深度排障建议 Astra。两者同时命中时建议 Astra。
- 每个候选在同一任务只自动询问一次。只有明确同意才升级，拒绝/关闭/60秒超时保留原模型。
- 一旦接受 Sol 或 Astra，**保持该档直到 reset 或手动更改**；不会为了短问答降级，也不会继续自动建议更贵的档位。任务结束后记得 `/route reset`。
- 仅处理 TUI 的空闲、普通 interactive 输入。斜杠命令（包括 skill/template）、排队、steering、扩展注入、RPC/print/JSON 不自动路由。不会在工具循环/重试/压缩中切换。
- 不自动跨 provider；目标不存在/认证或切换失败时不回退到其他昂贵模型。提示实际状态，不打印 provider 的潜在敏感错误内容。
- 这是保守启发式，不是语义分类器、费用上限或其他扩展的权限防火墙。规则可能漏判或误判，弹窗建议可拒绝。
- 切换可能影响缓存。不同模型费用不同，不能承诺固定节省比例；真实消耗看 GitHub 用量页。
- Subagent 仍继承主模型；当前 Subagent 接口不能逐 job 选模型。本扩展不改变它，也不在后台弹窗。

## 文件与状态

- 生效配置：`~/.pi/agent/settings.json`
- 薄入口：`~/.pi/agent/extensions/model-router/index.ts`
- 实现：本目录 `src/index.ts`、`src/policy.ts`
- 状态：当前会话分支的 `model-router:state` 自定义条目，不进入模型上下文，不含原始提示词；未知状态保守锁定。
- 备份：`~/.pi/agent/backups/model-router-20260914/settings.before.json`（0600）。

## 验证

Node >=22.18，无需安装依赖：

```sh
cd ~/.pi/agent/local-packages/pi-model-router
node --experimental-strip-types --test tests/*.test.mjs
```

测试由独立 Subagent 设计编写，包含纯分类及 mock Pi 的路由/确认/恢复行为。离线加载使用已安装 Pi 的真实扩展加载器；不运行其他用户扩展、不读取认证、不发起真实 Copilot 请求。测试报告在 `tests/`。

## 回滚

1. 空闲时将 `~/.pi/agent/extensions/model-router/index.ts` 移到扩展目录外（不要仅放入同目录另一 `.ts` 文件）。
2. 参考 `settings.before.json` 恢复 `defaultModel`、`enabledModels` 与本次新增的四个 `modelThinkingLevels` 键；其他配置保持原样。若期间从未更改任何配置，也可以完整恢复备份，但先核对 diff。
3. `/reload` 并手动 `/model` 选择旧模型；启动新进程读取旧默认。

不删除会话、不触碰 OAuth 凭据，不自动覆盖后续配置修改。
