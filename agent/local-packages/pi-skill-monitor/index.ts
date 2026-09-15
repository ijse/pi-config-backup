import type { ExtensionAPI, ExtensionContext, Skill } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { listedSkills, report, statusText, Tracker, VIEWS, type SkillInfo, type View } from "./core.ts";
import { SkillPanel } from "./panel.ts";

const STATUS_KEY = "skill-monitor";

export default function skillMonitor(pi: ExtensionAPI): void {
  let tracker: Tracker | undefined;
  let discovered: SkillInfo[] = [];
  let statusEnabled = true;
  let warned = false;

  function warn(ctx: ExtensionContext): void {
    if (warned) return;
    warned = true;
    if (ctx.hasUI) {
      try { ctx.ui.notify("Skill Monitor 观察失败；未阻止 Agent。可用 /reload 重试。", "warning"); }
      catch { /* UI errors must not interfere with the agent. */ }
    }
  }
  function observe(ctx: ExtensionContext, work: () => void): void {
    try { work(); } catch { warn(ctx); }
  }
  function discoverCommands(): SkillInfo[] {
    return pi.getCommands().filter(command => command.source === "skill").map(command => ({
      name: command.name.replace(/^skill:/, ""), path: command.sourceInfo.path,
      description: command.description,
      source: `${command.sourceInfo.scope} · ${command.sourceInfo.origin}`,
    }));
  }
  function fromSkills(skills: Skill[]): SkillInfo[] {
    return skills.map(skill => ({ name: skill.name, path: skill.filePath,
      description: skill.description,
      source: `${skill.sourceInfo.scope} · ${skill.sourceInfo.origin}`,
    }));
  }
  function catalog(ctx: ExtensionContext): SkillInfo[] {
    // getSystemPrompt reflects Pi's prompt, not later provider-payload rewrites.
    return [...discovered.map(skill => ({ ...skill, listed: false })), ...listedSkills(ctx.getSystemPrompt())];
  }
  function showStatus(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    const text = statusEnabled && tracker ? truncateToWidth(statusText(tracker), 100) : undefined;
    ctx.ui.setStatus(STATUS_KEY, text);
  }
  function rebuild(ctx: ExtensionContext): void {
    tracker = new Tracker(ctx.cwd, catalog(ctx));
    tracker.replay(ctx.sessionManager.getBranch());
    showStatus(ctx);
  }

  pi.on("session_start", (_event, ctx) => {
    observe(ctx, () => { discovered = discoverCommands(); rebuild(ctx); });
  });
  pi.on("before_agent_start", (event, ctx) => {
    observe(ctx, () => {
      discovered = fromSkills(event.systemPromptOptions.skills ?? []);
      if (!tracker) rebuild(ctx);
      else tracker.setCatalog(catalog(ctx));
    });
    // No system-prompt or message patches: this extension is observation-only.
  });
  pi.on("agent_start", (_event, ctx) => {
    observe(ctx, () => {
      tracker?.setCatalog(catalog(ctx));
      showStatus(ctx);
    });
  });
  pi.on("message_end", (event, ctx) => {
    observe(ctx, () => {
      if (!tracker) rebuild(ctx);
      if (tracker?.consume(event.message)) showStatus(ctx);
    });
  });
  // All message_end handlers have finished and native persistence has caught up here.
  pi.on("agent_settled", (_event, ctx) => { observe(ctx, () => rebuild(ctx)); });
  pi.on("session_tree", (_event, ctx) => { observe(ctx, () => rebuild(ctx)); });
  pi.on("session_compact", (_event, ctx) => { observe(ctx, () => rebuild(ctx)); });
  pi.on("session_shutdown", (_event, ctx) => {
    observe(ctx, () => {
      if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
      tracker = undefined;
      discovered = [];
    });
  });

  pi.registerCommand("skill-monitor", {
    description: "只读技能监控：本轮、当前分支历史与可用技能；status on/off 控制底栏",
    getArgumentCompletions(prefix) {
      const args = ["turn", "history", "available", "status on", "status off"];
      const matches = args.filter(arg => arg.startsWith(prefix)).map(value => ({ value, label: value }));
      return matches.length ? matches : null;
    },
    async handler(args, ctx) {
      try {
        const arg = args.trim();
        if (arg === "status on" || arg === "status off") {
          statusEnabled = arg === "status on";
          showStatus(ctx);
          if (ctx.hasUI) ctx.ui.notify(`Skill Monitor 底栏已${statusEnabled ? "开启" : "关闭"}（仅当前扩展实例）`, "info");
          return;
        }
        if (arg && !VIEWS.includes(arg as View)) {
          if (ctx.hasUI) ctx.ui.notify("用法：/skill-monitor [turn|history|available|status on|status off]", "info");
          return;
        }
        discovered = fromSkills(ctx.getSystemPromptOptions().skills ?? []);
        // Commands may run during another extension's async message_end handler,
        // before that message is persisted. Preserve the live tracker in that case.
        if (!tracker || ctx.isIdle()) rebuild(ctx);
        else { tracker.setCatalog(catalog(ctx)); showStatus(ctx); }
        const view: View = (arg || "turn") as View;
        if (ctx.mode === "tui") {
          await ctx.ui.custom<void>((tui, theme, keybindings, done) => new SkillPanel({
            view, lines: selected => report(tracker!, selected),
            height: () => Math.max(1, Math.min(32, tui.terminal.rows - 4)),
            repaint: () => tui.requestRender(), close: () => done(),
            cancel: data => keybindings.matches(data, "tui.select.cancel"),
            accent: text => theme.fg("accent", text), dim: text => theme.fg("dim", text),
          }), { overlay: true, overlayOptions: { width: "90%", maxHeight: "95%" } });
        } else if (ctx.hasUI) {
          // RPC has no custom TUI. The editor is display-only: discard its returned value.
          await ctx.ui.editor(`Skill Monitor · ${view}（只读展示，修改不保存）`, report(tracker!, view).join("\n"));
        }
        // No console output in JSON/print modes: never corrupt the host protocol.
      } catch { warn(ctx); }
    },
  });
}
