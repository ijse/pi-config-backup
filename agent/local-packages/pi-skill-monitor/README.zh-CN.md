# Pi Skill Monitor

**查看 Pi 读取过哪些技能文件，而不是猜测模型“正在使用”什么。**

[English](README.md) · [完整行为与限制](docs/behavior.md) · [开发指南](CONTRIBUTING.md) · [MIT 许可证](LICENSE)

一个只读的 [Pi](https://pi.dev) 扩展：独立底栏状态 + `/skill-monitor` 详情面板。当前界面使用中文，分别展示技能文件读取、原生显式加载，以及提示词中列出的技能。

```text
Skills · 读取 brainstorming · 显式 frontend-design
```

以上为底栏示例，不是实际截图。

## 功能

- 底栏显示最近用户轮次的技能记录，不替换现有 footer。
- 提供本轮、当前分支历史、可用技能三个视图，查看次数、时间、来源和路径。
- 恢复会话、重新加载、切换分支时重建记录，不重复累计。
- 标识范围限制和截断读取，不把部分读取称为完整加载。
- 不修改提示词、技能开关、工具执行或会话消息；不调用模型、不联网、不另存监控数据库。

> **已读取 ≠ 正在使用。** 安装审查时读取技能也会计入；历史记录不代表正文仍在模型上下文中。这是证据查看器，不是遵从性或安全审计工具。

## 安装

已验证环境：**`@earendil-works/pi-coding-agent` 0.85.1 + Node.js 22.18+**。未验证其他版本或分支的兼容性。

```sh
pi install git:github.com/ijse/pi-skill-monitor
```

在已打开的 Pi 会话中执行：

```text
/reload
```

由 Pi 管理安装，无需手动创建链接或构建。本项目通过 Git 仓库分发，尚未发布到 npm。Pi 扩展拥有当前用户的系统访问权限，请在安装前审查源码。

**从之前的本地版本迁移：** 只保留一种安装方式。启用 Git 版本前，移除旧的包配置，或移除指向本地源码的 `~/.pi/agent/extensions/skill-monitor` 符号链接；源码可以保留。扩展不会自动迁移或删除原有安装。

## 使用

| 命令 | 功能 |
| --- | --- |
| `/skill-monitor` 或 `/skill-monitor turn` | 查看本轮记录 |
| `/skill-monitor history` | 查看当前分支历史 |
| `/skill-monitor available` | 查看已发现与提示词中列出的技能 |
| `/skill-monitor status off` | 隐藏本扩展底栏 |
| `/skill-monitor status on` | 恢复本扩展底栏 |

面板操作：`1/2/3`、`Tab`、左右键切换视图；上下键或 `j/k` 滚动；`PageUp/PageDown`、空格翻页；`Home/End` 跳至首尾；`Esc/q` 关闭。

底栏开关仅在当前扩展实例生效，reload、重启或切换会话后恢复开启。如果第三方 footer 不展示扩展状态，底栏可能不可见，但命令仍然可用。

## 如何理解记录

| 标签 | 能证明什么 |
| --- | --- |
| 已读取 | 主 Agent 的 `read` 成功返回了技能文件文本，不证明采用。 |
| 范围限制/截断读取 | 请求限制了范围或结果被截断，不保证完整加载。 |
| 显式加载 | 用户消息包含 Pi 原生的顶层技能展开块，不保证模型遵从。 |
| 提示词列出 | 当前可观察的提示词技能元数据中列出，不代表正文已经读取。 |
| 仅发现 | Pi 提供了发现元数据，但该技能未出现在当前可观察的提示词列表中。 |

“本轮”是最近一条实际进入会话的 user 消息及后续工具循环，不是每次模型响应。Steering 或宿主以 user 角色插入的通知也会形成新轮次。

仅覆盖主 Agent 的标准 `read` 与原生技能展开；**不统计 bash/cat、MCP、子 Agent 独立日志或第三方私有注入**。压缩前活动只作为历史展示；不把摘要或 retainedTail 重复计数。手动伪造相同原生展开格式也可能被识别，不能把结果当作认证证据。完整说明见 [行为与限制](docs/behavior.md)。

## 更新与卸载

```sh
pi update --extension git:github.com/ijse/pi-skill-monitor
# 或卸载：
pi remove git:github.com/ijse/pi-skill-monitor
```

之后执行 `/reload`。手动安装的卸载方法见 [开发指南](CONTRIBUTING.md#manual-development-installation)。

## 开发与验证

```sh
git clone https://github.com/ijse/pi-skill-monitor.git
cd pi-skill-monitor
pnpm install --frozen-lockfile --ignore-scripts
pnpm run check
```

依赖安装到项目本地；检查包含 TypeScript、25 项测试，以及真实 Pi 加载器与 `SessionManager` 的集成验证，不需要调用模型。更多信息见 [开发指南](CONTRIBUTING.md) 和 [设计说明](docs/design.md)。

## 许可证

[MIT](LICENSE) © ijse。
