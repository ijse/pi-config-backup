# 半自动路由实施计划

依据已批准设计：`superpowers/specs/2026-09-14-semi-auto-model-router-design.md`。
本机未安装 writing-plans skill，采用显式文件计划；没有激活 /plan 模式。用户已确认开始实施。

1. 独立测试代理根据方案编写 Node 原生测试（tests 独占），核实初始缺失接口；主代理不编写或削弱测试。
2. 主代理实现 src/policy.ts 的纯分类函数与 src/index.ts 的默认 Pi 扩展工厂。无第三方运行时依赖，无模型请求。入口暂不安装。
3. 在明确接口契约后并行实现与测试；停写后独立运行最终测试，主代理复核断言、源文件并重跑确定性验证。失败修复后重新验证。
4. 备份 settings 到用户 backups 子目录，仅编辑允许的模型字段，新增自动发现薄入口。更新 README：命令、规则限制、生效与字段级回滚。
5. 独立检查实际配置/目录 ID/入口离线加载；主代理核验最终 diff。明确区分 mock/离线测试与尚未执行的真实 Copilot 请求。
6. 不重载当前会话、不自动发起付费请求，交用户 /reload 与 /route auto。

文件所有权：主代理 src/**、package.json、README.md、docs/**、全局 settings.json 与 extensions/model-router/index.ts；测试代理 tests/**。不初始化 Git，不全局安装依赖。

测试公开接口：src/policy.ts 导出 classify(text: string, hasImages?: boolean)，返回 {kind: 'continue'|'simple'|'routine'|'complex'|'critical', reason: string}；src/index.ts 默认导出同步 Pi 工厂，仅依赖传入 pi 与事件 ctx。注册 /route、input、session_start、session_tree、model_select、session_shutdown、thinking_level_select。状态 CustomEntry type = 'model-router:state'，data = {version:1, mode:'auto'|'off'|'locked', seenRequest:boolean, asked:{sol:boolean,astra:boolean}}。恢复时未知/非法状态锁定。可选内部模块不作为测试契约。
