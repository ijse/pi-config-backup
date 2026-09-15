import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";

export interface SkillInfo {
  name: string;
  path: string;
  description?: string;
  source?: string;
  listed?: boolean;
}
export type EvidenceKind = "read" | "explicit";
export interface Evidence {
  id: string;
  path: string;
  name: string;
  kind: EvidenceKind;
  turn: number;
  time: number;
  partial: boolean;
}
export interface Summary {
  skill: SkillInfo;
  reads: number;
  explicit: number;
  partial: number;
  first: number;
  last: number;
}
export type View = "turn" | "history" | "available";
export const VIEWS: View[] = ["turn", "history", "available"];
export const VIEW_NAMES: Record<View, string> = {
  turn: "本轮记录", history: "当前分支历史", available: "可用技能",
};

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}
function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => {
    const block = object(part);
    return block?.type === "text" && typeof block.text === "string" ? [block.text] : [];
  }).join("\n");
}
/** All untrusted metadata goes through this before terminal rendering. */
export function plain(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/g, " ");
}
export function unescapeXml(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos);/g, (_all, key: string) =>
    ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[key]!);
}

/** Inspect only the available_skills block, never arbitrary skill mentions. */
export function listedSkills(prompt: string): SkillInfo[] {
  const result: SkillInfo[] = [];
  for (const section of prompt.matchAll(/<available_skills>([\s\S]*?)<\/available_skills>/g)) {
    for (const block of section[1]!.matchAll(/<skill>([\s\S]*?)<\/skill>/g)) {
      const field = (tag: string) => {
        const value = block[1]!.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))?.[1];
        return value === undefined ? undefined : unescapeXml(value.trim());
      };
      const name = field("name"), path = field("location");
      if (name && path) result.push({ name, path, description: field("description"), listed: true });
    }
  }
  return result;
}

export class Paths {
  private cache = new Map<string, string>();
  readonly cwd: string;
  readonly home: string;
  constructor(cwd: string, home = homedir()) { this.cwd = cwd; this.home = home; }
  absolute(path: string): string {
    if (path.startsWith("@")) path = path.slice(1);
    if (path === "~") path = this.home;
    else if (path.startsWith("~/")) path = resolve(this.home, path.slice(2));
    return resolve(this.cwd, path);
  }
  normalize(path: string): string {
    const absolute = this.absolute(path);
    const cached = this.cache.get(absolute);
    if (cached) return cached;
    let canonical = absolute;
    try { canonical = realpathSync(absolute); } catch { /* Removed historical files remain visible. */ }
    this.cache.set(absolute, canonical);
    return canonical;
  }
}

interface PendingRead { path: string; name: string; turn: number; partial: boolean }
export class Tracker {
  turn = 0;
  compactions = 0;
  readonly evidence: Evidence[] = [];
  readonly catalog = new Map<string, SkillInfo>();
  private pending = new Map<string, PendingRead>();
  private seen = new Set<string>();
  readonly paths: Paths;

  constructor(cwd: string, skills: SkillInfo[] = [], home?: string) {
    this.paths = new Paths(cwd, home);
    this.setCatalog(skills);
  }
  setCatalog(skills: SkillInfo[]): void {
    this.catalog.clear();
    for (const skill of skills) {
      const path = this.paths.normalize(skill.path);
      const previous = this.catalog.get(path);
      this.catalog.set(path, { ...previous, ...skill, path,
        source: skill.source ?? previous?.source,
        description: skill.description ?? previous?.description,
        listed: Boolean(skill.listed || previous?.listed),
      });
    }
  }
  skill(path: string, name?: string): SkillInfo {
    return this.catalog.get(path) ?? {
      path, name: name || (basename(path) === "SKILL.md" ? basename(dirname(path)) : basename(path, ".md")),
      source: "未在当前发现列表中", listed: false,
    };
  }
  /** Called with the event message itself: message_end precedes persistence in Pi. */
  consume(value: unknown): boolean {
    const message = object(value);
    if (!message) return false;
    const time = typeof message.timestamp === "number" && Number.isFinite(message.timestamp)
      ? message.timestamp : 0;
    if (message.role === "user") {
      this.turn++;
      // Pi's native expansion format; raw commands and examples in code fences do not count.
      const match = textContent(message.content).match(
        /^<skill name="([^"\r\n]+)" location="([^"\r\n]+)">\r?\n[\s\S]*\r?\n<\/skill>(?:\r?\n\r?\n[\s\S]+)?$/,
      );
      if (match) {
        this.evidence.push({ id: `explicit:${this.turn}`, name: match[1]!,
          path: this.paths.normalize(match[2]!), kind: "explicit", turn: this.turn, time, partial: false });
      }
      return true;
    }
    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const value of message.content) {
        const call = object(value);
        if (call?.type !== "toolCall" || call.name !== "read" || typeof call.id !== "string") continue;
        const args = object(call.arguments);
        if (typeof args?.path !== "string" || !args.path) continue;
        if (typeof args.limit === "number" && args.limit < 1) continue;
        const requested = this.paths.absolute(args.path);
        const path = this.paths.normalize(args.path);
        const requestedSkill = basename(requested) === "SKILL.md";
        if (!requestedSkill && basename(path) !== "SKILL.md" && !this.catalog.has(path)) continue;
        const name = this.catalog.get(path)?.name ?? (requestedSkill ? basename(dirname(requested)) : this.skill(path).name);
        this.pending.set(call.id, { path, name, turn: this.turn,
          partial: typeof args.offset === "number" && args.offset > 1 || typeof args.limit === "number" });
      }
      return false;
    }
    if (message.role !== "toolResult" || typeof message.toolCallId !== "string") return false;
    const id = message.toolCallId;
    const pending = this.pending.get(id);
    this.pending.delete(id);
    if (!pending || this.seen.has(id) || message.toolName !== "read" || message.isError !== false) return false;
    // Require a successful text result, not just a tool call or a cancelled/empty result.
    if (!textContent(message.content).trim()) return false;
    const details = object(message.details);
    const truncation = object(details?.truncation);
    if (truncation?.firstLineExceedsLimit === true || truncation?.outputBytes === 0) return false;
    this.seen.add(id);
    this.evidence.push({ id, path: pending.path, name: pending.name,
      kind: "read", turn: pending.turn, time,
      partial: pending.partial || truncation?.truncated === true });
    return true;
  }
  replay(entries: readonly unknown[]): void {
    this.turn = 0;
    this.compactions = 0;
    this.pending.clear();
    this.seen.clear();
    this.evidence.length = 0;
    for (const value of entries) {
      const entry = object(value);
      if (entry?.type === "message") this.consume(entry.message);
      else if (entry?.type === "compaction") this.compactions++;
      // Neither summaries nor retainedTail are counted again.
    }
  }
  summaries(view: "turn" | "history"): Summary[] {
    const groups = new Map<string, Summary>();
    for (const e of this.evidence) {
      if (view === "turn" && e.turn !== this.turn) continue;
      let row = groups.get(e.path);
      if (!row) {
        row = { skill: this.skill(e.path, e.name), reads: 0, explicit: 0, partial: 0, first: e.time, last: e.time };
        groups.set(e.path, row);
      }
      if (e.kind === "read") row.reads++;
      else row.explicit++;
      if (e.partial) row.partial++;
      row.last = Math.max(row.last, e.time);
      row.first = Math.min(row.first, e.time);
    }
    return [...groups.values()].sort((a, b) => b.last - a.last || a.skill.path.localeCompare(b.skill.path));
  }
}

export function statusText(tracker: Tracker): string {
  const rows = tracker.summaries("turn");
  if (!rows.length) return "Skills · 本轮暂无记录";
  const labels = rows.slice(0, 2).map((r) => {
    const name = [...plain(r.skill.name)].slice(0, 24).join("");
    const kinds = [r.reads ? "读取" : "", r.explicit ? "显式" : ""].filter(Boolean).join("/");
    return `${kinds} ${name}${[...r.skill.name].length > 24 ? "…" : ""}`;
  });
  return `Skills · ${labels.join(" · ")}${rows.length > 2 ? ` · +${rows.length - 2}` : ""}`;
}
function date(time: number): string {
  return time ? new Date(time).toLocaleString("zh-CN", { hour12: false }) : "未知时间";
}
export function report(tracker: Tracker, view: View): string[] {
  const lines = [
    `${VIEW_NAMES[view]} · 用户轮次 ${tracker.turn}`,
    "只读观察主 Agent；读取 ≠ 使用，历史 ≠ 仍在上下文。",
    "覆盖 read 与原生显式展开；不含 bash/MCP/子 Agent/第三方私有注入。",
    "",
  ];
  if (view === "available") {
    const skills = [...tracker.catalog.values()].sort((a, b) => a.name.localeCompare(b.name));
    lines.push(`已发现/列出 ${skills.length} 项；提示词中列出 ${skills.filter(s => s.listed).length} 项。`,
      "“列出”来自 Pi 当前提示词，非最终网络请求；不表示技能已被调用。", "");
    for (const s of skills) {
      lines.push(`${s.listed ? "[提示词列出]" : "[仅发现]"} ${plain(s.name)}`,
        `  来源：${plain(s.source ?? "提示词列表")}`, `  路径：${plain(s.path)}`);
      if (s.description) lines.push(`  ${plain(s.description)}`);
      lines.push("");
    }
    if (!skills.length) lines.push("当前没有可观察到的技能元数据。");
    return lines;
  }
  if (tracker.compactions) lines.push(`本分支经过 ${tracker.compactions} 次压缩；压缩前记录仅作历史。`, "");
  const rows = tracker.summaries(view);
  if (!rows.length) lines.push("暂无已读取或显式加载记录。");
  for (const row of rows) {
    lines.push(plain(row.skill.name),
      `  已读取 ${row.reads} 次 · 显式加载 ${row.explicit} 次${row.partial ? ` · 范围限制/截断读取 ${row.partial} 次` : ""}`,
      `  首次：${date(row.first)}  最近：${date(row.last)}`,
      `  来源：${plain(row.skill.source ?? "Pi 技能列表")}`,
      `  路径：${plain(row.skill.path)}`, "");
  }
  return lines;
}
