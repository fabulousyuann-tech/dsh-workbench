import type { ProjectDetail, ProjectSummary } from "../types.ts";
import { getSelectedId, subscribeSelectedId } from "./selection.ts";

interface TriggerCandidate {
  name: string;
  description?: string;
}

interface TriggerPick {
  candidate: TriggerCandidate;
}

type PickOutcome = { insert: {
  source: string;
  ref: string;
  label: string;
  clipboardText: string;
} } | { text: string } | undefined;

interface TriggerSource {
  trigger: "@" | "/";
  name: string;
  order?: number;
  candidates: (
    session: unknown,
    req: { query: string; signal: AbortSignal },
  ) => Promise<readonly TriggerCandidate[]>;
  onPick: (pick: TriggerPick) => PickOutcome;
  lexicon?: () => readonly string[] | undefined;
  subscribeLexicon?: (_session: unknown, listener: () => void) => () => void;
  codec?: {
    clipboardText: (ref: string) => string;
    serialize: (ref: string, signal: AbortSignal) => Promise<string>;
  };
}

interface TriggerService {
  registerSource: (src: TriggerSource) => () => void;
}

/** Composer chips occupy a fixed 4em cell; longer labels are centered and clipped. */
const CHIP_UNITS = 8;

function charUnits(ch: string): number {
  return /[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? 2 : 1;
}

export function chipLabel(title: string): string {
  const chars = [...title.trim()];
  if (chars.length === 0) return "项目";
  let used = 0;
  const out: string[] = [];
  for (const ch of chars) {
    const w = charUnits(ch);
    if (used + w > CHIP_UNITS) {
      while (used > CHIP_UNITS - 1 && out.length > 0) {
        used -= charUnits(out[out.length - 1] ?? "");
        out.pop();
      }
      while (out.length > 0 && out[out.length - 1] === " ") {
        used -= 1;
        out.pop();
      }
      out.push("…");
      return out.join("");
    }
    out.push(ch);
    used += w;
  }
  return out.join("");
}

/** 把项目详情格式化为发给模型的上下文文本。 */
export function formatProjectRef(project: ProjectDetail): string {
  const lines = [
    `工作台项目：${project.title}`,
    `客户：${project.customerName}`,
    `阶段：${project.stage}${project.archived ? "（已归档）" : ""}`,
  ];
  if (project.productLine !== undefined && project.productLine !== "") {
    lines.push(`产品线：${project.productLine}`);
  }
  if (project.owner !== undefined && project.owner !== "") {
    lines.push(`负责人：${project.owner}`);
  }
  if (project.startedAt !== undefined && project.startedAt !== "") {
    lines.push(`开始日期：${project.startedAt}`);
  }
  if (project.dueAt !== undefined && project.dueAt !== "") {
    lines.push(`截止日期：${project.dueAt}`);
  }
  if (project.tags.length > 0) {
    lines.push(`标签：${project.tags.join("、")}`);
  }
  if (project.projectMarkdown !== "") {
    lines.push("", "--- project.md ---", project.projectMarkdown.trimEnd());
  }
  return lines.join("\n");
}

export function registerProjectTriggers(
  inputTriggers: TriggerService | undefined,
  load: (id: string) => Promise<ProjectDetail>,
  list: () => Promise<ReadonlyArray<Pick<ProjectSummary, "id" | "title" | "customerName">>>,
): () => void {
  if (inputTriggers === undefined) return () => undefined;

  const serialize = async (ref: string): Promise<string> => {
    const id = ref === "current" ? getSelectedId() : ref;
    if (id === null || id === "") {
      return "当前没有打开的项目。用 @ 选一个，或先在左侧打开项目详情。";
    }
    return formatProjectRef(await load(id));
  };

  const insert = (ref: string, title: string): PickOutcome => ({
    insert: {
      source: "workbench",
      ref,
      label: chipLabel(title),
      clipboardText: `@${title}`,
    },
  });

  const atSource: TriggerSource = {
    trigger: "@",
    name: "workbench",
    order: 30,
    async candidates(_session, req) {
      const query = req.query.trim().toLowerCase();
      const items = await list();
      const rows: TriggerCandidate[] = [];
      const selected = getSelectedId();
      if (selected !== null && (query === "" || "当前".includes(query))) {
        const current = items.find((item) => item.id === selected);
        rows.push({
          name: "当前项目",
          description: current?.title ?? selected,
        });
      }
      // 排名：标题/ID 前缀命中优先于子串命中，客户名命中垫底，
      // 避免项目很多时 @ 面板被无关命中刷屏。
      const scored: Array<{ item: (typeof items)[number]; score: number }> = [];
      for (const item of items) {
        const title = item.title.toLowerCase();
        const id = item.id.toLowerCase();
        const customer = item.customerName.toLowerCase();
        let score = -1;
        if (query === "") {
          score = 0;
        } else if (title.startsWith(query) || id.startsWith(query)) {
          score = 3;
        } else if (title.includes(query) || id.includes(query)) {
          score = 2;
        } else if (customer.includes(query)) {
          score = 1;
        }
        if (score >= 0) scored.push({ item, score });
      }
      scored.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title));
      // 未输入时面板只展示前若干项（都是等权命中），避免一屏刷满；
      // 有查询词时放宽上限让精确匹配尽量露出来。
      const limit = query === "" ? 10 : 20;
      for (const { item } of scored.slice(0, limit)) {
        rows.push({ name: item.title, description: item.id });
      }
      return rows;
    },
    onPick({ candidate }) {
      if (candidate.name === "当前项目") return insert("current", "当前项目");
      return insert(candidate.description ?? candidate.name, candidate.name);
    },
    lexicon() {
      return ["当前项目"];
    },
    subscribeLexicon(_session, listener) {
      return subscribeSelectedId(listener);
    },
    codec: {
      clipboardText: (ref) => (ref === "current" ? "@当前项目" : `@${ref}`),
      serialize,
    },
  };

  const slashSource: TriggerSource = {
    trigger: "/",
    name: "workbench",
    order: 40,
    async candidates(_session, req) {
      const query = req.query.trim().toLowerCase();
      const name = "current project";
      if (query !== "" && !name.includes(query) && !"当前项目".includes(query)) {
        return [];
      }
      return [{ name, description: "把当前打开的项目交给对话" }];
    },
    onPick() {
      return insert("current", "当前项目");
    },
    lexicon() {
      return ["current project", "当前项目"];
    },
    codec: {
      clipboardText: () => "/current project",
      serialize,
    },
  };

  const stopAt = inputTriggers.registerSource(atSource);
  const stopSlash = inputTriggers.registerSource(slashSource);
  return () => {
    stopAt();
    stopSlash();
  };
}
