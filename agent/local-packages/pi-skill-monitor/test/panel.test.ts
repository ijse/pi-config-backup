import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { SkillPanel } from "../panel.ts";

test("panel supports Chinese, long paths, tiny terminals, paging, tabs and close", () => {
  let closed = false, repaints = 0;
  const panel = new SkillPanel({ view: "turn",
    lines: view => [`SECTION ${view}`, ...Array.from({ length: 60 }, (_, i) => `${i} 很长的中文路径 /${"abc/".repeat(70)}`)],
    height: () => 12, repaint: () => { repaints++; }, close: () => { closed = true; },
    cancel: key => key === "custom-cancel", accent: value => value, dim: value => value,
  });
  for (const width of [0, 1, 2, 10, 40, 120]) {
    const lines = panel.render(width);
    assert.ok(lines.length <= 12);
    assert.ok(lines.every(line => visibleWidth(line) <= width));
  }
  const before = panel.render(80).join("\n");
  panel.handleInput("j");
  assert.notEqual(panel.render(80).join("\n"), before);
  panel.handleInput("2");
  assert.match(panel.render(80).join("\n"), /SECTION history/);
  panel.handleInput("\t");
  assert.match(panel.render(80).join("\n"), /SECTION available/);
  panel.invalidate();
  panel.handleInput("custom-cancel");
  assert.equal(closed, true);
  assert.ok(repaints >= 3);
});

test("one-line terminal never gets more than one line", () => {
  const panel = new SkillPanel({ view: "turn", lines: () => ["hello"], height: () => 1,
    repaint() {}, close() {}, cancel: () => false, accent: t => t, dim: t => t });
  assert.equal(panel.render(3).length, 1);
});
