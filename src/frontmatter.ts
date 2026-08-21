import type { ProjectFrontmatter, ProjectStage } from "./types.ts";
import { PROJECT_STAGES } from "./types.ts";

/**
 * 极简 frontmatter 解析器：只支持 `key: value` 标量、`key: [a, b]` 字符串数组。
 * M1 够用，后续需要更复杂结构再换 YAML 依赖。
 */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function parseScalar(value: string): string | number | boolean {
  const trimmed = value.trim();
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === "true";
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function parseArray(value: string): string[] {
  const inner = value.trim();
  if (inner === "[]") return [];
  const withoutBrackets = inner.startsWith("[") && inner.endsWith("]")
    ? inner.slice(1, -1)
    : inner;
  return withoutBrackets
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

export function parseFrontmatter(raw: string): {
  data: Record<string, string | number | boolean | string[]>;
  body: string;
} {
  const matched = FRONTMATTER_RE.exec(raw);
  if (matched === null || matched[1] === undefined) return { data: {}, body: raw };
  const data: Record<string, string | number | boolean | string[]> = {};
  for (const line of matched[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon <= 0) continue;
    const key = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim();
    if (key === "") continue;
    if (value.startsWith("[") && value.endsWith("]")) data[key] = parseArray(value);
    else if (value !== "") data[key] = parseScalar(value);
  }
  const body = raw.slice(matched[0].length).replace(/^\r?\n/, "");
  return { data, body };
}

export function isProjectStage(value: unknown): value is ProjectStage {
  return typeof value === "string" && (PROJECT_STAGES as readonly string[]).includes(value);
}

/** 读取 frontmatter 字段，兼容 snake_case 与 camelCase 两种键名（buildProjectMarkdown 写 snake_case）。 */
function pickField(
  data: Record<string, string | number | boolean | string[]>,
  snake: string,
  camel: string,
): string | undefined {
  const value = data[snake] ?? data[camel];
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function projectFrontmatter(raw: string): ProjectFrontmatter {
  const { data } = parseFrontmatter(raw);
  const frontmatter: ProjectFrontmatter = { tags: [] };
  const title = pickField(data, "title", "title");
  if (title !== undefined) frontmatter.title = title;
  const productLine = pickField(data, "product_line", "productLine");
  if (productLine !== undefined) frontmatter.productLine = productLine;
  if (isProjectStage(data.stage)) frontmatter.stage = data.stage;
  const owner = pickField(data, "owner", "owner");
  if (owner !== undefined) frontmatter.owner = owner;
  const startedAt = pickField(data, "started_at", "startedAt");
  if (startedAt !== undefined) frontmatter.startedAt = startedAt;
  const dueAt = pickField(data, "due_at", "dueAt");
  if (dueAt !== undefined) frontmatter.dueAt = dueAt;
  if (Array.isArray(data.tags)) {
    frontmatter.tags = data.tags.filter((tag): tag is string => typeof tag === "string");
  }
  return frontmatter;
}

export function buildProjectMarkdown(frontmatter: ProjectFrontmatter, body: string): string {
  const lines = ["---"];
  if (frontmatter.title !== undefined && frontmatter.title !== "") lines.push(`title: ${frontmatter.title}`);
  if (frontmatter.productLine !== undefined && frontmatter.productLine !== "") {
    lines.push(`product_line: ${frontmatter.productLine}`);
  }
  if (frontmatter.stage !== undefined) lines.push(`stage: ${frontmatter.stage}`);
  if (frontmatter.owner !== undefined && frontmatter.owner !== "") lines.push(`owner: ${frontmatter.owner}`);
  if (frontmatter.startedAt !== undefined && frontmatter.startedAt !== "") {
    lines.push(`started_at: ${frontmatter.startedAt}`);
  }
  if (frontmatter.dueAt !== undefined && frontmatter.dueAt !== "") lines.push(`due_at: ${frontmatter.dueAt}`);
  if (frontmatter.tags.length > 0) lines.push(`tags: [${frontmatter.tags.join(", ")}]`);
  lines.push("---", "");
  const bodyText = body.trim();
  if (bodyText !== "") {
    lines.push(bodyText.endsWith("\n") ? bodyText : `${bodyText}\n`);
  }
  return lines.join("\n");
}
