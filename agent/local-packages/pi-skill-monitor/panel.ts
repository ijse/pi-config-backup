import { matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { VIEW_NAMES, VIEWS, type View } from "./core.ts";

interface PanelOptions {
  view: View;
  lines: (view: View) => string[];
  height: () => number;
  repaint: () => void;
  close: () => void;
  cancel: (data: string) => boolean;
  accent: (text: string) => string;
  dim: (text: string) => string;
}
/** A read-only pager. No user text is submitted or written to the session. */
export class SkillPanel {
  private view: View;
  private offset = 0;
  private pageSize = 10;
  private maxOffset = 0;
  private options: PanelOptions;
  constructor(options: PanelOptions) {
    this.options = options;
    this.view = options.view;
  }
  invalidate(): void { /* Lines and theme are computed fresh on each render. */ }
  handleInput(data: string): void {
    if (this.options.cancel(data) || matchesKey(data, "escape") || data === "q") {
      this.options.close();
      return;
    }
    let next = this.view;
    if (data === "1") next = "turn";
    else if (data === "2") next = "history";
    else if (data === "3") next = "available";
    else if (matchesKey(data, "tab") || matchesKey(data, "right")) {
      next = VIEWS[(VIEWS.indexOf(this.view) + 1) % VIEWS.length]!;
    } else if (matchesKey(data, "shift+tab") || matchesKey(data, "left")) {
      next = VIEWS[(VIEWS.indexOf(this.view) + VIEWS.length - 1) % VIEWS.length]!;
    } else if (matchesKey(data, "up") || data === "k") this.offset--;
    else if (matchesKey(data, "down") || data === "j") this.offset++;
    else if (matchesKey(data, "pageUp")) this.offset -= this.pageSize;
    else if (matchesKey(data, "pageDown") || data === " ") this.offset += this.pageSize;
    else if (matchesKey(data, "home")) this.offset = 0;
    else if (matchesKey(data, "end")) this.offset = this.maxOffset;
    if (next !== this.view) { this.view = next; this.offset = 0; }
    this.offset = Math.max(0, Math.min(this.offset, this.maxOffset));
    this.options.repaint();
  }
  render(width: number): string[] {
    if (width < 1) return [];
    // Four header/footer lines; height remains bounded even on a tiny terminal.
    const height = Math.max(1, this.options.height());
    this.pageSize = Math.max(1, height - 4);
    const wrapWidth = Math.max(2, width - 2);
    const lines = this.options.lines(this.view).flatMap(line =>
      line ? wrapTextWithAnsi(line, wrapWidth) : [""]);
    this.maxOffset = Math.max(0, lines.length - this.pageSize);
    this.offset = Math.min(this.offset, this.maxOffset);
    const tabs = VIEWS.map((view, i) => `${i + 1} ${view === this.view ? `[${VIEW_NAMES[view]}]` : VIEW_NAMES[view]}`).join("  ");
    const output = [
      this.options.accent("Skill Monitor · " + tabs),
      this.options.dim("─".repeat(width)),
      ...lines.slice(this.offset, this.offset + this.pageSize).map(line => " " + line),
      this.options.dim("─".repeat(width)),
      this.options.dim(`↑↓/j k 滚动 · Tab/1–3 切换 · Esc/q 关闭 · ${Math.min(this.offset + 1, lines.length)}–${Math.min(this.offset + this.pageSize, lines.length)}/${lines.length}`),
    ];
    return output.slice(0, height).map(line => truncateToWidth(line, width));
  }
}
