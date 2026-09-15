export type TaskKind = "continue" | "simple" | "routine" | "complex" | "critical";
export type Classification = { kind: TaskKind; reason: string };

// Deliberately narrow and deterministic. These are suggestions, not semantic judgments.
const CONTINUATION = /^(?:好(?:的|吧)?|行|可以|是的|嗯|收到|谢谢|继续(?:吧)?|接着(?:做)?|没问题|同意|确认|[0-9]{1,2}|ok(?:ay)?|yes|no|thanks|thank you|continue|go on|proceed|sure|done)[\s.!！。?？]*$/iu;
const CRITICAL = /安全审计|生产(?:环境)?(?:故障|事故)|线上(?:故障|事故)|数据一致性|分布式一致性|并发(?:问题|故障|死锁|排障)|死锁排查|\b(?:security audit|production (?:incident|outage)|data consistency|distributed consistency|race condition|deadlock|concurrency (?:bug|debugging))\b/iu;
const COMPLEX = /跨(?:模块|服务|系统|文件).*重构|系统设计|架构设计|复杂(?:重构|调试|排障)|难(?:以)?复现|疑难(?:问题|排障)|\b(?:system design|architecture design|cross[- ](?:module|service|file) refactor(?:ing)?|refactor(?:ing)? across (?:multiple )?(?:modules|services|files)|complex refactor(?:ing)?|hard[- ]to[- ]reproduce|elusive bug)\b/iu;
const CODE_OR_RISK = /```|~~~|`|(?:^|\s)@\S+|(?:[\w.-]+\/)+[\w.-]+|\b[\w-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|json|md|ya?ml|sql|sh|vue|css|html)\b|代码|修改|调试|重构|架构|安全|故障|并发|一致性|文件|实现|修复|排查|部署|数据库|\b(?:code|coding|debug|fix|modify|implement|refactor|architecture|security|incident|concurren\w*|consistency|file|deploy|database)\b/iu;
const SIMPLE = /^(?:(?:请|帮我|请帮我|麻烦)(?:简单|简短)?\s*)?(?:翻译|润色|解释(?:一下)?(?:术语|概念)?|(?:简短|简单)?摘要|总结(?:一下)?|用一句话解释|什么是|translate\b|polish\b|explain\b|define\b|summari[sz]e\b|what (?:is|does)\b)/iu;

export function classify(text: string, hasImages = false): Classification {
  const value = text.trim();
  if ((!value || CONTINUATION.test(value)) && !hasImages) {
    return { kind: "continue", reason: "简短确认或续接，保持当前模型" };
  }
  if (CRITICAL.test(value)) {
    return { kind: "critical", reason: "命中安全、生产故障或一致性深度排障规则" };
  }
  if (COMPLEX.test(value)) {
    return { kind: "complex", reason: "命中跨模块重构、系统设计或疑难排障规则" };
  }
  if (!hasImages && value.length <= 400 && !CODE_OR_RISK.test(value) && SIMPLE.test(value)) {
    return { kind: "simple", reason: "短的独立翻译、润色、解释或摘要请求" };
  }
  return { kind: "routine", reason: "常规或不确定任务，使用日常基线" };
}

export type Tier = "luna" | "terra" | "sol" | "astra";
export type Mode = "auto" | "off" | "locked";
export type RouterState = {
  version: 1;
  mode: Mode;
  seenRequest: boolean;
  asked: { sol: boolean; astra: boolean };
};
export const STATE_TYPE = "model-router:state";
export const PROVIDER = "github-copilot";
export const ROUTES = {
  luna: { id: "gpt-5.6-luna", thinking: "low", rank: 0 },
  terra: { id: "gpt-5.6-terra", thinking: "medium", rank: 1 },
  sol: { id: "gpt-5.6-sol", thinking: "medium", rank: 2 },
  astra: { id: "gpt-6-astra", thinking: "medium", rank: 3 },
} as const;

export function freshState(mode: Mode = "locked"): RouterState {
  return { version: 1, mode, seenRequest: false, asked: { sol: false, astra: false } };
}

export function parseState(data: unknown): RouterState | undefined {
  if (!data || typeof data !== "object") return;
  const d = data as Partial<RouterState>;
  if (d.version !== 1 || !["auto", "off", "locked"].includes(d.mode ?? "") ||
      typeof d.seenRequest !== "boolean" || !d.asked ||
      typeof d.asked.sol !== "boolean" || typeof d.asked.astra !== "boolean") return;
  return { version: 1, mode: d.mode!, seenRequest: d.seenRequest,
    asked: { sol: d.asked.sol, astra: d.asked.astra } };
}

export function tierOf(model?: { provider: string; id: string }): Tier | undefined {
  if (model?.provider !== PROVIDER) return;
  return (Object.keys(ROUTES) as Tier[]).find(tier => ROUTES[tier].id === model.id);
}

// Pure transition decision: no input mutation, I/O, model calls, or history inspection.
export function decide(state: RouterState, current: Tier, task: Classification): Tier | undefined {
  if (state.mode !== "auto" || task.kind === "continue") return;
  // An approved premium tier stays fixed for this task; explicit commands can change it.
  if (ROUTES[current].rank >= ROUTES.sol.rank) return;
  if (task.kind === "critical" && ROUTES[current].rank < ROUTES.astra.rank && !state.asked.astra) return "astra";
  if (task.kind === "complex" && ROUTES[current].rank < ROUTES.sol.rank && !state.asked.sol) return "sol";
  if (current === "luna" && task.kind !== "simple") return "terra";
  if (!state.seenRequest && current === "terra" && task.kind === "simple") return "luna";
}
