import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  classify, decide, freshState, parseState, tierOf, PROVIDER, ROUTES, STATE_TYPE,
  type RouterState, type Tier,
} from "./policy.ts";

const HELP = "/route status | auto | reset | off | luna | terra | sol | astra";
const modelKey = (model: ExtensionContext["model"]) => model ? `${model.provider}/${model.id}` : "none";

export default function modelRouter(pi: ExtensionAPI) {
  let state: RouterState = freshState();
  let revision = 0;
  let running = false;
  let disposed = false;
  let ownTarget: string | undefined;
  let pendingConfirm: AbortController | undefined;

  function notify(ctx: ExtensionContext, text: string, type: "info" | "warning" = "info") {
    if (!ctx.hasUI || disposed) return;
    // Host UI failure must not swallow the user's original prompt.
    try { ctx.ui.notify(text, type); } catch { /* presentation only */ }
  }

  function showStatus(ctx: ExtensionContext) {
    if (!ctx.hasUI || disposed) return;
    try {
      const scope = ctx.mode === "tui" ? state.mode : "inactive (non-TUI)";
      ctx.ui.setStatus("model-router", `route:${scope} · ${ctx.model?.id ?? "none"}`);
    } catch { /* presentation only */ }
  }

  function save(ctx: ExtensionContext) {
    try { pi.appendEntry(STATE_TYPE, structuredClone(state)); }
    catch {
      // If consent/lock cannot be persisted, stop automation instead of re-prompting.
      state.mode = "locked";
      notify(ctx, "路由状态保存失败，已暂停自动路由；可用 /route auto 重试。", "warning");
    }
    showStatus(ctx);
  }

  function invalidate() {
    revision++;
    pendingConfirm?.abort();
  }

  function restore(ctx: ExtensionContext) {
    invalidate();
    disposed = false;
    const branch = ctx.sessionManager.getBranch();
    const record = [...branch].reverse().find(entry => entry.type === "custom" && entry.customType === STATE_TYPE);
    if (record?.type === "custom") {
      state = parseState(record.data) ?? freshState();
    } else {
      const hasHistory = branch.some(entry => ["message", "custom_message", "compaction", "branch_summary"].includes(entry.type));
      state = freshState(!hasHistory && ctx.mode === "tui" && tierOf(ctx.model) === "terra" ? "auto" : "locked");
    }
    if (state.mode === "auto" && !tierOf(ctx.model)) state.mode = "locked";
    showStatus(ctx);
  }

  function available(ctx: ExtensionContext, tier: Tier) {
    const model = ctx.modelRegistry.find(PROVIDER, ROUTES[tier].id);
    if (!model) notify(ctx, `目标模型 ${ROUTES[tier].id} 不在目录中，保持当前模型。`, "warning");
    return model;
  }

  function stillCurrent(ctx: ExtensionContext, stamp: number, original: string) {
    return !disposed && revision === stamp && modelKey(ctx.model) === original &&
      ctx.mode === "tui" && ctx.hasUI && ctx.isIdle();
  }

  async function consent(ctx: ExtensionContext, tier: "sol" | "astra", reason: string, stamp: number, original: string) {
    if (!stillCurrent(ctx, stamp, original)) return false;
    const controller = new AbortController();
    pendingConfirm = controller;
    try {
      const confirmed = await ctx.ui.confirm(
        `升级到 ${ROUTES[tier].id}？`,
        `当前：${ctx.model?.id ?? "none"}\n原因：${reason}\n思考：${ROUTES[tier].thinking}。可能增加用量。\n` +
        "本地规则仅供参考；同意后本任务保持该模型，/route reset 回到 Terra。拒绝或60秒超时保留当前模型。",
        { timeout: 60_000, signal: controller.signal },
      );
      return confirmed === true && !controller.signal.aborted && stillCurrent(ctx, stamp, original);
    } catch {
      notify(ctx, "升级确认未完成，保持当前模型。", "warning");
      return false;
    } finally {
      if (pendingConfirm === controller) pendingConfirm = undefined;
    }
  }

  async function apply(ctx: ExtensionContext, tier: Tier, stamp: number, original: string): Promise<boolean> {
    if (!stillCurrent(ctx, stamp, original)) return false;
    const target = available(ctx, tier);
    if (!target) return false;
    const targetKey = modelKey(target);
    ownTarget = targetKey;
    try {
      if (modelKey(ctx.model) !== targetKey && !(await pi.setModel(target))) {
        notify(ctx, `无法切换到 ${target.id}（认证未配置），保持当前模型。`, "warning");
        return false;
      }
      // External model changes, branch changes, off, or shutdown invalidate this operation.
      if (disposed || stamp !== revision || modelKey(ctx.model) !== targetKey) return false;
      try {
        pi.setThinkingLevel(ROUTES[tier].thinking);
        const actual = pi.getThinkingLevel();
        if (actual !== ROUTES[tier].thinking) {
          state.mode = "locked";
          notify(ctx, `当前 ${target.id} / ${actual}：思考档位被钳制，已暂停自动路由。`, "warning");
          save(ctx);
          return false;
        }
        notify(ctx, `已切换：${target.id} / ${actual}` + (tier === "sol" || tier === "astra" ? "；任务结束后 /route reset 回到 Terra。" : "。"));
        return true;
      } catch {
        state.mode = "locked";
        let actual = "unknown";
        try { actual = pi.getThinkingLevel(); } catch { /* report unknown rather than success */ }
        notify(ctx, `当前模型 ${ctx.model?.id ?? "none"} / ${actual}；思考档位设置失败，已暂停自动路由。`, "warning");
        save(ctx);
        return false;
      }
    } catch {
      // Do not print provider exceptions: they may contain credentials or request headers.
      notify(ctx, `切换未完成，当前模型为 ${ctx.model?.id ?? "none"}。请检查模型权限或认证。`, "warning");
      if (modelKey(ctx.model) !== original) {
        state.mode = "locked";
        save(ctx);
      }
      return false;
    } finally {
      ownTarget = undefined;
      showStatus(ctx);
    }
  }

  pi.on("session_start", (_event, ctx) => restore(ctx));
  pi.on("session_tree", (_event, ctx) => restore(ctx));
  pi.on("session_shutdown", () => {
    disposed = true;
    invalidate();
  });
  pi.on("model_select", (event, ctx) => {
    if (event.source === "restore" || disposed) return;
    if (ownTarget === modelKey(event.model) && event.source === "set") {
      showStatus(ctx);
      return;
    }
    invalidate();
    state.mode = "locked";
    save(ctx);
    notify(ctx, "模型已由手动操作或其他扩展改变，自动路由暂停；/route auto 重新启用。");
  });
  pi.on("thinking_level_select", (_event, ctx) => showStatus(ctx));

  pi.on("input", async (event, ctx) => {
    const unchanged = { action: "continue" as const };
    if (disposed || ctx.mode !== "tui" || !ctx.hasUI || event.source !== "interactive" ||
        event.streamingBehavior !== undefined || !ctx.isIdle() || event.text.trimStart().startsWith("/")) return unchanged;
    if (running) {
      // A second user input supersedes an outstanding idle-time confirmation.
      invalidate();
      return unchanged;
    }
    if (state.mode !== "auto") return unchanged;
    const current = tierOf(ctx.model);
    if (!current) {
      state.mode = "locked";
      save(ctx);
      return unchanged;
    }
    const task = classify(event.text, !!event.images?.length);
    if (task.kind === "continue") return unchanged;
    const next = decide(state, current, task);
    const firstRequest = !state.seenRequest;
    state.seenRequest = true;
    if (firstRequest) save(ctx);
    if (!next || state.mode !== "auto") return unchanged;

    running = true;
    const stamp = revision;
    const original = modelKey(ctx.model);
    try {
      if (!available(ctx, next)) return unchanged;
      if (next === "sol" || next === "astra") {
        state.asked[next] = true;
        save(ctx);
        if (state.mode !== "auto" || !(await consent(ctx, next, task.reason, stamp, original))) return unchanged;
      }
      if (await apply(ctx, next, stamp, original)) save(ctx);
    } finally {
      running = false;
    }
    return unchanged;
  });

  pi.registerCommand("route", {
    description: "半自动 Copilot 路由；status / auto / reset / off / luna / terra / sol / astra",
    getArgumentCompletions(prefix) {
      const items = ["status", "auto", "reset", "off", "luna", "terra", "sol", "astra"]
        .filter(value => value.startsWith(prefix)).map(value => ({ value, label: value }));
      return items.length ? items : null;
    },
    handler: async (args, ctx) => {
      const command = args.trim().toLowerCase() || "status";
      if (command === "status") {
        showStatus(ctx);
        notify(ctx, `${HELP}\n状态：${state.mode}；当前 ${ctx.model?.id ?? "none"} / ${pi.getThinkingLevel()}\n` +
          `本任务已询问：Sol=${state.asked.sol}，Astra=${state.asked.astra}。` +
          (ctx.mode === "tui" ? "" : " 非TUI：自动路由不运行。"));
        return;
      }
      if (disposed || !ctx.isIdle()) {
        notify(ctx, "Agent 忙碌中，请结束当前任务后再操作路由。", "warning");
        return;
      }
      if (command === "off") {
        invalidate();
        state.mode = "off";
        save(ctx);
        notify(ctx, "自动路由已关闭，当前模型保持不变。");
        return;
      }
      if (!["auto", "reset", "luna", "terra", "sol", "astra"].includes(command)) {
        notify(ctx, HELP, "warning");
        return;
      }
      if (ctx.mode !== "tui" || !ctx.hasUI) {
        notify(ctx, "路由切换仅在 Pi TUI 中可用；非交互模式请显式指定 --model。", "warning");
        return;
      }
      if (running) {
        notify(ctx, "另一个路由确认正在进行；可取消弹窗或 /route off。", "warning");
        return;
      }
      const reset = command === "auto" || command === "reset";
      const target: Tier = reset ? "terra" : command as Tier;
      if (!available(ctx, target)) return;
      running = true;
      const stamp = ++revision;
      const original = modelKey(ctx.model);
      try {
        if ((target === "sol" || target === "astra") &&
            !(await consent(ctx, target, "用户通过 /route 明确请求选档", stamp, original))) return;
        if (await apply(ctx, target, stamp, original)) {
          state = freshState(reset ? "auto" : "locked");
          save(ctx);
          notify(ctx, reset ? "半自动路由已开启，新任务从 Terra 开始。" : "手动选档已锁定；/route auto 恢复自动路由。");
        }
      } finally {
        running = false;
      }
    },
  });
}
