# 最终独立验证报告

## 结论：PASS（离线验收范围）

- 阶段：生产文件停止写入后的最终独立验证；本代理独立补测并实际执行，不再委派。
- 最终结果：**165 tests / 165 pass / 0 fail / 0 skipped / 0 cancelled / 0 todo**。
- 原独立测试 154 项全部保留，新增 11 项；未修改、弱化、跳过或删除原断言。
- 全量测试命令退出码 **0**；证据包装器退出码 **0**。
- 运行前后 20 个验证输入文件 SHA-256 一致，`changedFiles: []`。
- 未发现本轮验收范围内失败；**mock 和离线加载不等于 Copilot 端到端实测**。

## 验证对象与边界

工作目录：`/Users/liyi/.pi/agent/local-packages/pi-model-router`

依据：`docs/superpowers/specs/2026-09-14-semi-auto-model-router-design.md`，按本轮用户声明的“已批准规范”执行（文档正文尚留有“待用户审阅”旧状态字样，本轮未改文档）。项目无 Git 验证基线，本轮以精确文件 SHA-256 固定对象，未初始化仓库。

环境：Node **v22.22.3**，可执行文件 `/Users/liyi/n/bin/node`；真实已安装 Pi **0.85.1**。使用原生 strip-types，无依赖安装。

只新增 `tests/**` 文件。未写入 src、docs、package、全局 settings、薄入口、备份或模型目录。未读取 `auth.json` 或用户会话，未运行扩展全量发现，未启动 Pi 模型会话，未 reload 当前会话，未联网或发模型请求。

## 需求覆盖及证据

| 验收项 | 测试与结果 |
| --- | --- |
| settings 仅修改批准字段 | `local-installation.test.mjs`：读取真实 settings 与指定备份，构建“备份 + 精确批准变更”的期望对象；逐顶层键深比较，检查增删与嵌套值，保留所有无关设置和已有每模型 thinking 键。失败只报告不同键名，不转储用户无关设置。PASS |
| 精确默认、四档 thinking、15 模型 | 同文件：默认 `github-copilot/gpt-5.6-terra` / `medium`；完整有序列表逐项相等且 15 项无重复；Terra/Sol/Astra=medium，Luna=low。PASS |
| 15 个 Copilot ID 存在 | 同文件：真实 `models-store.json` 的 `github-copilot.models` 中，每个批准 ID 恰好存在一次且 provider 正确。只使用模型元数据，不构造 AuthStorage/ModelRegistry。PASS |
| 四档支持目标 thinking | 同文件：reasoning=true、目标档非 null、映射值等于目标强度，并调用真实 Pi AI 纯函数 `getSupportedThinkingLevels` 和 `clampThinkingLevel`，验证目标受支持且不被钳制。PASS |
| 真实薄入口可离线加载 | `real-loader.test.mjs`：使用指定真实 `loader.js` 的 `loadExtensions([薄入口], '/synthetic/path')`，零加载错误，恰好一个扩展。不是 mock factory 加载，不调用 discover 或创建 AgentSession。PASS |
| 唯一 /route、预期 handlers、零工具 | 同文件：命令列表精确为 `['route']`；六类 handler 各一次；tools/flags/shortcuts/messageRenderers/entryRenderers 均为空，无 provider 注册或 markdown transformer。PASS |
| 无模型调用/输入不变 | 同文件：真实加载后只对合成上下文调用 session_start、status、续接 input、shutdown；续接严格返回 continue 且事件不变，无模型切换、消息发送、工具变更或持久化 runtime 动作。加载前拦截 fetch/HTTP/socket/TLS、子进程、文件写入和私有文件读取，全部违规计数为零；关闭 jiti 文件缓存。没有真实模型上下文或调用。PASS |
| appendEntry 失败保守锁定 | `failure-boundaries.test.mjs`：首次请求保存、已询问标志保存、切换成功后的保存三个失败点；均明确警告、status=locked，后续普通输入不切换/不弹窗/不反复保存；存储恢复后显式 reset 可重新授权。PASS |
| 原始异常字符串不外泄 | 同文件：provider 切换、thinking setter、UI confirm 三类合成异常；仍显示通用警告，但 UI/status、持久化、确认信息及 console 不含合成 message/stack canary。PASS |
| 上轮三个缺陷回归 | 原测试不变：`Refactor across multiple modules.` 正确为 complex（最终 TAP #35）；获准 Sol 后遇到高风险请求仍保持（#80；Astra #81）；thinking setter 抛错仍报告实际 Luna/medium（#99）。PASS |
| 其他既有行为 | `policy.test.mjs` 50 项 + `router.test.mjs` 104 项：分类优先级、风险/附件、首次降档、Luna 回基线、确认真值与超时结果、失败不回退、命令/无 UI/忙碌、手动锁定与 thinking 保持、异步过期和互斥、当前分支恢复、非法记录保守锁定、无原提示持久化。PASS |

真实 loader 的六类 handler：`input`、`model_select`、`session_shutdown`、`session_start`、`session_tree`、`thinking_level_select`。

核验的完整模型顺序（均加 `github-copilot/`）：

1. gpt-5.6-terra
2. gpt-5.6-luna
3. gpt-5.6-sol
4. gpt-6-astra
5. gpt-5.3-codex
6. gpt-5.4-mini
7. gemini-3.8-flash
8. gpt-5.5
9. grok-4.6
10. gpt-5-mini
11. gpt-5.4
12. mai-code-1.1-flash
13. gemini-3.7-flash
14. gemini-3.6-flash
15. grok-4.5

## 实际执行

### 补充用例初跑

```sh
node --experimental-strip-types --test tests/local-installation.test.mjs tests/real-loader.test.mjs tests/failure-boundaries.test.mjs > tests/supplemental.tap 2>&1
```

退出码 **0**；11 pass / 0 fail / 0 skipped，936.792375 ms。新增用例在当前修复后生产版本上首次即通过；本轮没有针对旧生产版本重新取得 RED 证据，也未进行源码突变或生产回退。

### 最终全量运行

```sh
cd /Users/liyi/.pi/agent/local-packages/pi-model-router
node tests/run-final-verification.mjs
```

包装器先哈希输入，通过 `/bin/bash -c` **实际执行**以下原始命令，再保存完整 stdout/stderr 与运行后哈希：

```sh
node --experimental-strip-types --test tests/*.test.mjs
```

- 开始：`2026-09-14T09:44:32.078Z`
- 完成：`2026-09-14T09:44:33.054Z`
- 原始命令退出码：**0**；signal=null；executionError=null
- 包装器退出码：**0**
- TAP：**165 tests，165 pass，0 fail，0 cancelled，0 skipped，0 todo**
- 测试运行器耗时：**928.105458 ms**
- 完整 TAP：`tests/final.tap`，**32382 bytes**；已逐项检查最终输出。
- 机器可读证据：`tests/final-evidence.json`，包含命令、版本、时间、退出码、20 个输入文件运行前后 SHA-256 和 TAP SHA-256。

## 变更与产物

本轮新增：

- `tests/local-installation.test.mjs`（4 项）
- `tests/real-loader.test.mjs`（1 项真实 loader 集成冒烟）
- `tests/failure-boundaries.test.mjs`（6 项）
- `tests/run-final-verification.mjs`（证据包装器，不计入测试数量）
- `tests/supplemental.tap`
- `tests/final.tap`
- `tests/final-evidence.json`
- `tests/FINAL-REPORT.md`

原 `tests/mock-pi.mjs`、`tests/policy.test.mjs`、`tests/router.test.mjs`、`tests/preliminary.tap` 未改。

## 文件 SHA-256

以下均为最终全量运行对象；生产/配置/测试输入运行前后相同。**完整 20 文件清单及前后值见 `tests/final-evidence.json`**（包括 README、所有 docs、package、全部测试源码与真实 Pi 包版本文件）。

| 文件 | SHA-256 |
| --- | --- |
| `src/index.ts` | `f1cf7feab1bdb8a562d597f602cce599387cef12d02736b5d52d36a9df36e30a` |
| `src/policy.ts` | `adc3bd9ab9adb2c4a33f236ce5cb117fe6b6ef6112e76459c6930d2b47069234` |
| 规范 `docs/superpowers/specs/2026-09-14-semi-auto-model-router-design.md` | `2163808fe799cde90bdd5f78e54bcf8035bc98f97adedd69f6c34130a65fd1a3` |
| `/Users/liyi/.pi/agent/settings.json` | `85ff8240145429a2738accec53aa36a9bf36161f7f8416df1cd630046dc81289` |
| `/Users/liyi/.pi/agent/backups/model-router-20260914/settings.before.json` | `3e46394013bbc9ae56499240c6ab508437c2abddbad42181d10d92c4ba8b947a` |
| `/Users/liyi/.pi/agent/models-store.json` | `0fd2c84819f2b6c869d4467311e7989caa69e5a8f48692990e7b79d1a22e14b4` |
| `/Users/liyi/.pi/agent/extensions/model-router/index.ts` | `942e2d34e499fbb63d28f4dad9c4cb279dc87601401a0757d01d1d9c44961274` |
| 真实 Pi `dist/core/extensions/loader.js` | `a1393de916487a2c47107ac7239f3139dcdb938705f88ba1ea5a954b3c8bb483` |
| 真实 Pi AI `dist/models.js` | `42610d47fe293d99f4b05b147971e181c7312ea47c9be2906a4803955276a8a4` |
| `tests/final.tap` | `5c06fa946d8bd314a92189989451a802bdbc4bd474cead2226c34e4988568475` |

## 残余缺口与限制

1. **没有 Copilot 实际调用权限、OAuth 有效性、端点可达性或真实请求成功的实测。**15 个 ID 和四档 thinking 验证只证明本地元数据及 Pi 能力解析支持，不证明远端接受请求。
2. **没有真实 TUI 人工交互/60 秒墙钟计时验收。**现有测试验证 timeout=60000、false/关闭/异常分支和过期确认；实际弹窗布局、倒计时和键盘操作未运行。
3. reload/resume/fork/tree 与并发调度主要使用合成分支和 mock API；真实 loader 冒烟不等于真实 AgentSession 全生命周期或磁盘会话恢复验收。本轮按要求没有读取用户会话。
4. 只加载指定薄入口，不发现其他扩展。因此唯一 `/route` 是本扩展注册结果，不证明用户所有扩展间不存在同名命令或行为冲突；也未启动新真实会话验证全局配置最终合并。
5. 未测任务质量、真实用量/账单、缓存影响或节省比例；规则仍会误判/漏判，后台 Subagent/RPC 范围限制仍在。
6. 真实文件与 loader 测试有意绑定本机指定绝对路径，属于安装验收，不是任意机器可直接执行的便携测试。哈希固定了列出的输入与关键 loader/能力模块，未为全部全局依赖制作封闭依赖快照。
7. 本轮没有覆盖所有理论上可能的第三方 API 异常、系统调用或时序排列；离线拦截是测试安全防线，不宣称是 OS 级完备沙箱。

上述均为明确的离线边界或未执行项，不计作已通过的端到端验证。已请求的本轮新增离线验收项目全部实际执行通过。
