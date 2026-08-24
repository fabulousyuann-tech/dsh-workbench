import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { projectFrontmatter, buildProjectMarkdown } from "./frontmatter.ts";
import { customerProjectKey } from "./overlay.ts";
import type {
  CustomerSummary,
  ProjectFilter,
  ProjectFrontmatter,
  ProjectSummary,
  ProjectStage,
  OverlayStore,
} from "./types.ts";

const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})_(.+)$/;
const PROJECT_STAGE_DEFAULT: ProjectStage = "opportunity";
const SKIP_DIRS = new Set(["_index", "node_modules", ".git"]);

export function formatDay(now: Date): string {
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function readableTitle(title: string): string {
  return title
    .trim()
    .replace(/[\\/:*?"<>|\n\r]/g, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function folderNameForTitle(title: string, now: Date): string {
  const safe = readableTitle(title);
  if (safe === "") throw new Error("empty title");
  return `${formatDay(now)}_${safe}`;
}

export function folderDateAndTitle(folderName: string): { date?: string; title: string } {
  const matched = DATE_PREFIX.exec(folderName);
  if (matched === null || matched[1] === undefined || matched[2] === undefined) {
    return { title: folderName };
  }
  return { date: matched[1], title: matched[2] };
}

export function isSkippedDir(name: string): boolean {
  return SKIP_DIRS.has(name) || name.startsWith(".");
}

/** 客户文件夹名：清理非法字符后的名称（不附加日期前缀）。 */
export function customerFolderName(name: string): string {
  const safe = readableTitle(name);
  if (safe === "") throw new Error("empty customer name");
  return safe;
}

/** 在 workspaceRoot 下新建客户文件夹（重名自动加 -2、-3…）。 */
export async function createCustomerFolder(
  workspaceRoot: string,
  name: string,
): Promise<{ id: string; folderPath: string }> {
  const base = customerFolderName(name);
  let id = base;
  let suffix = 2;
  while (true) {
    const folderPath = join(workspaceRoot, id);
    const exists = await stat(folderPath).then(() => true, () => false);
    if (!exists) {
      await mkdir(folderPath);
      return { id, folderPath };
    }
    id = `${base}-${suffix}`;
    suffix += 1;
  }
}

/** 重命名客户文件夹：<root>/<id> → <root>/<newName>（整个目录连同内部项目一起迁移）。 */
export async function renameCustomerFolder(
  workspaceRoot: string,
  id: string,
  name: string,
): Promise<{ id: string; folderPath: string; name: string }> {
  const targetName = customerFolderName(name);
  const currentPath = join(workspaceRoot, id);
  if (targetName === id) return { id, folderPath: currentPath, name: targetName };
  const targetPath = join(workspaceRoot, targetName);
  const exists = await stat(targetPath).then(() => true, () => false);
  if (exists) throw new Error(`target already exists: ${targetPath}`);
  await rename(currentPath, targetPath);
  return { id: targetName, folderPath: targetPath, name: targetName };
}

/** 在指定客户目录下新建项目文件夹，并写入 project.md 模板。 */
export async function createProjectFolder(
  customerPath: string,
  title: string,
  frontmatter: ProjectFrontmatter,
  now = new Date(),
): Promise<{ id: string; folderPath: string }> {
  const base = folderNameForTitle(title, now);
  let id = base;
  let suffix = 2;
  while (true) {
    const folderPath = join(customerPath, id);
    const exists = await stat(folderPath).then(() => true, () => false);
    if (!exists) {
      await mkdir(folderPath);
      const frontmatterBody: ProjectFrontmatter = {
        ...frontmatter,
        title: frontmatter.title ?? readableTitle(title),
      };
      await writeFile(
        join(folderPath, "project.md"),
        buildProjectMarkdown(frontmatterBody, "# 项目\n\n目标、范围、里程碑和进度见对话上下文与任务文件。\n"),
        "utf8",
      );
      return { id, folderPath };
    }
    id = `${base}-${suffix}`;
    suffix += 1;
  }
}

export async function readProjectMarkdown(folderPath: string): Promise<string> {
  try {
    return await readFile(join(folderPath, "project.md"), "utf8");
  } catch {
    return "";
  }
}

export async function writeProjectMarkdown(folderPath: string, text: string): Promise<void> {
  const body = text.endsWith("\n") ? text : `${text}\n`;
  await writeFile(join(folderPath, "project.md"), body, "utf8");
}

async function isDirectory(path: string): Promise<boolean> {
  const info = await stat(path).catch(() => undefined);
  return info !== undefined && info.isDirectory();
}

async function scanProject(
  customer: CustomerSummary,
  folderName: string,
  overlay: OverlayStore,
): Promise<ProjectSummary | undefined> {
  const folderPath = join(customer.folderPath, folderName);
  if (!(await isDirectory(folderPath))) return undefined;
  if (isSkippedDir(folderName)) return undefined;

  const info = await stat(folderPath);
  const { date, title: folderTitle } = folderDateAndTitle(folderName);
  const rawDoc = await readProjectMarkdown(folderPath);
  const frontmatter = rawDoc === "" ? { tags: [] as string[] } : projectFrontmatter(rawDoc);

  const overlayItem = overlay.projects[customerProjectKey(customer.id, folderName)]
    ?? overlay.projects[folderName];
  const title = overlayItem?.title ?? frontmatter.title ?? folderTitle;
  const productLine = overlayItem?.productLine ?? frontmatter.productLine;
  const stage = overlayItem?.stage ?? frontmatter.stage ?? PROJECT_STAGE_DEFAULT;
  const owner = overlayItem?.owner ?? frontmatter.owner;
  const archived = overlayItem?.archived === true;

  return {
    id: folderName,
    folderPath,
    title,
    createdMs: Math.round(info.birthtimeMs > 0 ? info.birthtimeMs : info.mtimeMs),
    ...(date === undefined ? {} : { date }),
    ...(productLine === undefined ? {} : { productLine }),
    stage,
    ...(owner === undefined ? {} : { owner }),
    ...(frontmatter.startedAt === undefined ? {} : { startedAt: frontmatter.startedAt }),
    ...(frontmatter.dueAt === undefined ? {} : { dueAt: frontmatter.dueAt }),
    tags: frontmatter.tags,
    hasProjectDoc: rawDoc !== "",
    customerId: customer.id,
    customerName: customer.name,
    archived,
  };
}

/** 扫描工作空间根目录：一层客户，二层项目。 */
export async function scanWorkspace(
  workspaceRoot: string,
  overlay: OverlayStore,
): Promise<{ customers: CustomerSummary[]; projects: ProjectSummary[] }> {
  const root = await isDirectory(workspaceRoot);
  if (!root) return { customers: [], projects: [] };

  const entries = await readdir(workspaceRoot, { withFileTypes: true });
  const customers: CustomerSummary[] = [];
  const projects: ProjectSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (isSkippedDir(name)) continue;
    const folderPath = join(workspaceRoot, name);
    const hasCustomerDoc = await isDirectory(folderPath) && await fileExists(join(folderPath, "_customer.md"));
    const customer: CustomerSummary = {
      id: name,
      folderPath,
      name,
      hasCustomerDoc,
      projects: [],
    };
    const projectEntries = await readdir(folderPath, { withFileTypes: true }).catch(() => []);
    for (const projectEntry of projectEntries) {
      if (!projectEntry.isDirectory()) continue;
      const project = await scanProject(customer, projectEntry.name, overlay);
      if (project !== undefined) {
        customer.projects.push(project);
        projects.push(project);
      }
    }
    customer.projects.sort((left, right) => right.createdMs - left.createdMs);
    customers.push(customer);
  }
  customers.sort((left, right) => left.name.localeCompare(right.name, "zh"));
  projects.sort((left, right) => right.createdMs - left.createdMs);
  return { customers, projects };
}

async function fileExists(path: string): Promise<boolean> {
  const info = await stat(path).catch(() => undefined);
  return info !== undefined && info.isFile();
}

export function matchesFilter(project: ProjectSummary, filter: ProjectFilter): boolean {
  if (filter === "all") return true;
  return project.stage === filter;
}

export function matchesQuery(project: ProjectSummary, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return project.title.toLowerCase().includes(needle)
    || project.id.toLowerCase().includes(needle)
    || project.customerName.toLowerCase().includes(needle)
    || (project.productLine ?? "").toLowerCase().includes(needle)
    || project.tags.some((tag) => tag.toLowerCase().includes(needle));
}
