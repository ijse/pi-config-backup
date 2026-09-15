# Pi Subagents 使用指南（@narumitw/pi-subagents v3）

`@narumitw/pi-subagents` 会在独立的 Pi 子进程里运行任务。子代理继承主会话的 provider/model/thinking level（可单独指定 thinkingLevel），默认只给只读工具，适合把大任务拆成并行探索、后台验证或隔离实现。

> 安全边界：子代理不是沙箱。给它 `bash`、`edit`、`write`、`powershell` 就等于允许它按当前用户权限执行命令或改文件。并行写文件前要确保职责不重叠。

## 工具速查

主会话会看到这些工具：

| 工具 | 用途 |
| --- | --- |
| `subagent_spawn` | 启动一个后台子任务，立即返回 `jobId` |
| `subagent_wait` | 等待某个 job 完成，或提前返回子代理消息 |
| `subagent_send` | 给运行中的子代理发问题，或回复子代理的问题 |
| `subagent_inspect` | 查看当前保留的 job 元数据 |
| `subagent_cancel` | 取消排队或运行中的 job |

子代理内部会自动获得通信工具 `subagent_send` / `subagent_wait`，外加你在 `tools` 里授予的工作工具。

## 推荐用法

### 只读探索

让子代理先调查代码，不允许写入：

```text
用 subagent_spawn 开一个只读任务：分析认证模块入口、核心文件和测试位置。tools 只给 read, grep, find, ls。最后输出路径和证据。
```

等需要结果时：

```text
等待这个 job，并根据结果继续方案设计。
```

### 隔离实现

只有在任务边界清晰时才授予写权限：

```text
用 subagent_spawn 实现 xxx。允许 tools: read, grep, find, ls, edit, write, bash。限定只修改 src/auth/** 和相关测试，完成后说明改动和验证命令。
```

主代理仍需复核 diff 和测试结果，不要直接信任子代理结论。

### 与子代理沟通

- 主代理提问：`subagent_send`，指定 `recipient: jobId`
- 子代理如果反向提问，主代理收到后用同一个 `requestId` 回复
- `subagent_wait` 超时不会取消 job；需要取消时显式用 `subagent_cancel`

## 建议的工具策略

| 任务类型 | tools |
| --- | --- |
| 代码探索 / 审查 | `read, grep, find, ls` |
| 需要运行测试 | `read, grep, find, ls, bash` |
| 小范围改动 | `read, grep, find, ls, edit, write` |
| 改动 + 验证 | `read, grep, find, ls, edit, write, bash` |

## 调用模板

```json
{
  "task": "你是只读代码探索子代理。目标：找出订单模块的入口、核心数据流和测试文件。约束：不要修改文件；输出必须包含文件路径和简短证据。",
  "tools": ["read", "grep", "find", "ls"],
  "thinkingLevel": "medium",
  "timeout": 300
}
```

```json
{
  "task": "你是实现子代理。目标：在不改变公共 API 的前提下修复 xxx。只允许修改 src/foo/** 和 tests/foo/**。完成后运行相关测试并汇报。",
  "tools": ["read", "grep", "find", "ls", "edit", "write", "bash"],
  "thinkingLevel": "high",
  "timeout": 900
}
```
