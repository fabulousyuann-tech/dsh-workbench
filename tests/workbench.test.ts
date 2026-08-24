import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";

import {
  buildProjectMarkdown,
  parseFrontmatter,
  projectFrontmatter,
} from "../src/frontmatter.ts";
import {
  createCustomerFolder,
  createProjectFolder,
  folderDateAndTitle,
  folderNameForTitle,
  formatDay,
  matchesFilter,
  matchesQuery,
  renameCustomerFolder,
  scanWorkspace,
} from "../src/catalog.ts";
import {
  WorkbenchService,
  daysUntil,
  parseDay,
} from "../src/service.ts";
import {
  categorizeFiles,
  categoryOfFile,
  scanProjectFiles,
} from "../src/files.ts";
import {
  inspectWorkspacePathsRequestSchema,
  listProjectsRequestSchema,
  listProjectsResultSchema,
  workspacePathStatusResultSchema,
} from "../src/schemas.ts";
import type { ProjectFile } from "../src/types.ts";
import {
  chipLabel,
  formatProjectRef,
} from "../src/client/projectTriggers.ts";
import {
  decodeOverlay,
  decodeLegacyOverlay,
  emptyOverlay,
  loadOverlay,
  pushRecentWorkspace,
  saveOverlay,
  withOverlayLock,
} from "../src/overlay.ts";
import { en, zh } from "../src/client/locales.ts";
import { resolveConfiguredPath, validateConfig } from "../src/config.ts";
import {
  dragCarriesFiles,
  shouldBridgeFileDragTarget,
} from "../src/client/fileDropBridge.ts";

describe("配置契约", () => {
  it("接受绝对路径与 home 缩写，拒绝相对路径", () => {
    expect(resolveConfiguredPath("dataDir", "~/.dsh-workbench")).toMatch(/[/\\]\.dsh-workbench$/);
    expect(() => validateConfig({ workspaceRoot: "relative/workspace", dataDir: "/tmp/data" }))
      .toThrow("workspaceRoot must be an absolute path or start with ~");
    expect(() => validateConfig({ workspaceRoot: "/tmp/workspace", dataDir: "relative/data" }))
      .toThrow("dataDir must be an absolute path or start with ~");
  });
});

describe("UI contract", () => {
  it("文件拖放兼容层仅桥接侧边栏非资源管理器区域", () => {
    const panel = {} as Element;
    const panelTarget = {
      closest: (selector: string) => selector === "[data-dsh-panel-host]" ? panel : null,
    } as unknown as EventTarget;
    const explorerTarget = {
      closest: (selector: string) => {
        if (selector === "[data-dsh-panel-host]") return panel;
        if (selector.includes('[class*="_explorer"]')) return {} as Element;
        return null;
      },
    } as unknown as EventTarget;
    const chatTarget = {
      closest: () => null,
    } as unknown as EventTarget;

    expect(shouldBridgeFileDragTarget(panelTarget)).toBe(true);
    expect(shouldBridgeFileDragTarget(explorerTarget)).toBe(false);
    expect(shouldBridgeFileDragTarget(chatTarget)).toBe(false);
    expect(dragCarriesFiles({ dataTransfer: { types: ["Files"] } as unknown as DataTransfer })).toBe(true);
    expect(dragCarriesFiles({ dataTransfer: { types: ["text/plain"] } as unknown as DataTransfer })).toBe(false);
  });

  it("中英文文案键保持一致且不暴露占位键", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    expect(zh["settings.expand"]).toBe("展开设置");
    expect(en["settings.collapse"]).toBe("Collapse settings");
  });

  it("可见文案不使用长破折号作为占位或分隔符", () => {
    for (const value of [...Object.values(zh), ...Object.values(en)]) {
      expect(value).not.toMatch(/[—–]/);
    }
  });

  it("项目文件区的结构类都有对应样式", async () => {
    const css = await readFile(new URL("../src/client/WorkbenchProjectDetail.css", import.meta.url), "utf8");
    for (const className of [
      "detailFiles",
      "detailFilesToolbar",
      "detailFilesGroup",
      "detailFileRow",
      "detailFileIcon",
      "detailFileBody",
      "detailFileName",
      "detailFileMeta",
    ]) {
      expect(css).toContain(`.${className}`);
    }
  });

  it("多工作台 UI 覆盖单栏折叠、管理删除与策略确认", async () => {
    const component = await readFile(new URL("../src/client/sidebar/SpaceContextRail.tsx", import.meta.url), "utf8");
    const css = await readFile(new URL("../src/client/sidebar/SpaceContextRail.css", import.meta.url), "utf8");
    expect(component).toContain('event.key.toLowerCase() === "k"');
    expect(component).toContain('event.key === "ArrowDown"');
    expect(component).toContain('role="dialog"');
    expect(component).toContain("space.policyHint");
    expect(component).toContain("space.keep");
    expect(component).toContain('className="spaceLibraryList"');
    expect(component).toContain('className={expanded ? "spaceLibraryGroup expanded"');
    expect(component).toContain('const [expandedSpaceId, setExpandedSpaceId] = useState<string>()');
    expect(component).toContain('void select(space.id)');
    expect(component).toContain('{t("space.add")}');
    expect(component).toContain('{t("space.manage")}');
    expect(component).toContain('t("space.settings")');
    expect(component).toContain('className="spaceManageRail"');
    expect(component).toContain('hidden={!expanded}');
    expect(component).toContain('className="spaceRemoveButton"');
    expect(component).toContain('className="spacePathField"');
    expect(component).toContain('t("space.changePath")');
    expect(component).toContain('t("space.pathChangeConfirm")');
    expect(component).toContain("await face.pickDirectory()");
    expect(component).toContain("face.updateSpace({ spaceId: space.id, rootPath })");
    expect(component).toContain('window.addEventListener("focus", onFocus)');
    expect(component).toContain('t("space.lastRequired")');
    expect(component).not.toContain("draggable");
    expect(component).not.toContain("dataTransfer");
    expect(component).toContain('t("space.moveUp")');
    expect(component).toContain('t("space.moveDown")');
    expect(component).toContain("await face.listModels()");
    expect(component).toContain("<optgroup");
    expect(component).toContain('t("space.inheritDshModel")');
    expect(component).not.toContain('t("space.useWorkbenchModel")');
    expect(component).not.toContain('<label>{t("space.modelProvider")}<input');
    expect(component).not.toContain("<label>Name<");
    expect(css).toContain(".spaceContext.library");
    expect(css).toContain(".spaceLibraryRow.selected");
    expect(css).toContain(".spaceLibraryChildren");
    expect(css).toContain("@media (max-width:600px)");
    expect(css).toContain("prefers-reduced-motion:reduce");
    expect(css).toContain("--dsw-space-blue");
    expect(css).toContain(".spaceSectionHeader");
    expect(css).toContain(".spaceRemoveButton");
    expect(css).toContain(".spacePathField");
    expect(css).toContain(".spaceModelField");
  });

  it("Codex 导航保持紧凑、单栏并交还 DSH 原生侧栏拖拽", async () => {
    const root = await readFile(new URL("../src/client/sidebar/WorkbenchSidebarRoot.tsx", import.meta.url), "utf8");
    const rootCss = await readFile(new URL("../src/client/sidebar/WorkbenchSidebarRoot.css", import.meta.url), "utf8");
    const railCss = await readFile(new URL("../src/client/sidebar/SpaceContextRail.css", import.meta.url), "utf8");
    expect(root).toContain("style={wide ? { width: collapsed ? lastWideWidth.current : width } : undefined}");
    expect(root).not.toContain("WORKBENCH_SIDEBAR_WIDTH");
    expect(root).not.toContain("useWorkbenchSidebarWidth");
    expect(rootCss).not.toContain("data-workbench-sidebar-shell");
    expect(rootCss).toContain(".sidebarLibraryScroll");
    expect(rootCss).toContain("scrollbar-gutter: stable");
    expect(railCss).toContain(".spaceContext.library");
  });

  it("侧栏底部按 DSH list 插槽纵向承载插件并允许通用浮层越界显示", async () => {
    const root = await readFile(new URL("../src/client/sidebar/WorkbenchSidebarRoot.tsx", import.meta.url), "utf8");
    const rootCss = await readFile(new URL("../src/client/sidebar/WorkbenchSidebarRoot.css", import.meta.url), "utf8");
    expect(root).toContain('renderSlot("sidebar.footer.action", { wide })');
    expect(root.indexOf('renderSlot("sidebar.footer.action", { wide })'))
      .toBeLessThan(root.indexOf('renderSlot("sidebar.settings", { wide })'));
    expect(rootCss).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(rootCss).toContain("grid-auto-rows: max-content");
    expect(rootCss).toContain("The library region remains the sole scroll");
    expect(rootCss).toContain("slot itself must never scroll or clip");
    expect(rootCss).not.toContain("max-height: min(36vh, 288px)");
    expect(rootCss).not.toContain("max-height: calc(100vh - 164px)");
    expect(rootCss).not.toContain("overscroll-behavior: contain");
    expect(rootCss).not.toContain(".footerActions:has(");
    expect(rootCss).not.toContain(".footerActions > *");
    const footerCss = rootCss.slice(
      rootCss.indexOf('[data-plugin="dsh-workbench"][data-surface="sidebar"] .footArea'),
      rootCss.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(footerCss).toContain("position: relative");
    expect(footerCss).toContain("z-index: 2");
    expect(footerCss).toContain("overflow: visible");
    expect(footerCss).not.toContain("overflow-y: auto");
    expect(footerCss).not.toContain("overflow-x: hidden");
    expect(rootCss).not.toContain(".collapsed .regionArea {\n  display: none");
    expect(rootCss).not.toContain(".collapsed .footArea {\n  display:none");
    expect(rootCss).not.toContain(".collapsed .footerActions {\n  display: none");
  });

  it("公开设置右侧列表插槽，展开时同行、折叠时排列在设置上方", async () => {
    const root = await readFile(new URL("../src/client/sidebar/WorkbenchSidebarRoot.tsx", import.meta.url), "utf8");
    const rootCss = await readFile(new URL("../src/client/sidebar/WorkbenchSidebarRoot.css", import.meta.url), "utf8");
    const slots = await readFile(new URL("../src/client/sidebar/slots.ts", import.meta.url), "utf8");
    const client = await readFile(new URL("../src/client/index.tsx", import.meta.url), "utf8");

    expect(slots).toContain('"sidebar.settings.trailing": { kind: "list"; scope: "root"');
    expect(slots).toContain('PropsRenderSlots<"sidebar.settings" | "sidebar.settings.trailing" | "sidebar.footer.action">');
    expect(client).toContain('"sidebar.settings.trailing": { kind: "list", scope: "root" }');
    expect(root).toContain('className="settingsRow"');
    expect(root).toContain('renderSlot("sidebar.settings.trailing", { wide })');
    expect(root.indexOf('renderSlot("sidebar.settings", { wide })'))
      .toBeLessThan(root.indexOf('renderSlot("sidebar.settings.trailing", { wide })'));
    expect(rootCss).toContain("grid-template-columns: minmax(0, 1fr) max-content");
    expect(rootCss).toContain('.settingsTrailing:not(:has(> [data-slot] > *))');
    expect(rootCss).toContain("margin-inline-start: 4px");
    expect(rootCss).toContain(".collapsed .settingsTrailing");
    expect(rootCss).toContain("order: -1");
    expect(rootCss).toContain("overflow: visible");
  });

  it("侧栏字阶使用 DSH 原生 typography tokens 并按层级统一", async () => {
    const rootCss = await readFile(new URL("../src/client/sidebar/WorkbenchSidebarRoot.css", import.meta.url), "utf8");
    const hierarchy = rootCss.slice(rootCss.indexOf("0.9.5 typography hierarchy"));
    expect(hierarchy).toContain("font-family: var(--dsw-font-family)");
    expect(hierarchy).toContain("font: var(--dsw-font-base-strong-16)");
    expect(hierarchy).toContain("font: var(--dsw-font-s-strong-14)");
    expect(hierarchy).toContain("font: var(--dsw-font-xs-strong-13)");
    expect(hierarchy).toContain("font: var(--dsw-font-xs-13)");
    expect(hierarchy).toContain("font: var(--dsw-font-xxs-strong-12)");
    expect(hierarchy).toContain("font: var(--dsw-font-xxs-12)");
    expect(hierarchy).toContain(".spaceLibraryName");
    expect(hierarchy).toContain(".customerName");
    expect(hierarchy).toContain(".rowTitleText");
    expect(hierarchy).toContain(".managedSessionTitle");
    expect(hierarchy).toContain(".basicProjectMain > span");
  });

  it("普通会话与工作台会话互斥，客户和项目内可直接进入与删除会话", async () => {
    const panel = await readFile(new URL("../src/client/sidebar/WorkbenchSidebarPanel.tsx", import.meta.url), "utf8");
    const detail = await readFile(new URL("../src/client/WorkbenchProjectDetail.tsx", import.meta.url), "utf8");
    const root = await readFile(new URL("../src/client/sidebar/WorkbenchSidebarRoot.tsx", import.meta.url), "utf8");
    const basicPanel = await readFile(new URL("../src/client/sidebar/UnmanagedSessionsPanel.tsx", import.meta.url), "utf8");
    const rootCss = await readFile(new URL("../src/client/sidebar/WorkbenchSidebarRoot.css", import.meta.url), "utf8");
    const client = await readFile(new URL("../src/client/index.tsx", import.meta.url), "utf8");
    const host = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(panel).toContain('className="customerExpand"');
    expect(panel).toContain('t("customer.openChat")');
    expect(panel).toContain("await openProjectSession(folderPath)");
    expect(panel).toContain("setActiveSessionPath(folderPath)");
    expect(panel).toContain("rebaseDirectoryFromAliases(currentSessionPath ?? activeSessionPath, selectedRootPath, selectedRootAliases)");
    expect(panel).toContain('t("session.openFailed")');
    expect(panel).not.toContain('className="workspaceBar"');
    expect(panel).not.toContain('<span>{t("library.title")}</span>');
    expect(panel).toContain('className="workbenchInlineToolbar"');
    expect(panel).toContain('className="inlineCreateMenuButton"');
    expect(panel).toContain('t("toolbar.addCustomerOrProject")');
    expect(panel).not.toContain("filterMenuOpen");
    expect(panel).not.toContain("PROJECT_STAGES");
    expect(panel).not.toContain('t(`stage.${project.stage}`');
    expect(panel).not.toContain('className="emptyCreateCustomer"');
    expect(detail).not.toContain('t("detail.stage")');
    expect(detail).not.toContain("draftStage");
    expect(panel).toContain("await deleteProject(projectDeleteTarget.id, projectDeleteTarget.customerId)");
    expect(panel).toContain('const result = await listProjects("", "all"');
    expect(panel).toContain("managedSessions.byTargetId[project.folderPath]");
    expect(panel).toContain('className="rowAction rowDeleteAction"');
    expect(panel).not.toContain("<WorkbenchDashboard");
    expect(panel).not.toContain('className="filterRow"');
    expect(root).toContain('<SpaceContextRail');
    expect(root).toContain('className={wide ? "basicPrimaryNewSession" : "newSession"}');
    expect(root).toContain('className="sidebarLibraryScroll"');
    expect(root).toContain('query={query}');
    expect(root).not.toContain('className="tabRow primaryModeRow"');
    expect(root).toContain("<UnmanagedSessionsPanel");
    expect(root).toContain("managedRootPaths={managedRootPaths}");
    expect(root).toContain("removeBasicProject={removeBasicProject}");
    expect(root).toContain("startProjectSession={startProjectSession}");
    expect(root).toContain("moveSessionToProject={moveSessionToProject}");
    expect(basicPanel).toContain("visibleLoose.length > 0");
    expect(basicPanel).toContain('t("sessions.unclassified")');
    expect(basicPanel).toContain("moveTargets={partition.projects}");
    expect(basicPanel).not.toContain('t("sessions.empty")');
    expect(basicPanel).toContain('className="basicProjectNew"');
    expect(basicPanel).toContain('t("sessions.project.newChat")');
    expect(root).toContain("pickDirectory={workbenchFace.pickDirectory}");
    expect(root).toContain('className="sidebarSearch"');
    expect(root.indexOf('className="sidebarSearch"')).toBeLessThan(root.indexOf('className={wide ? "basicPrimaryNewSession" : "newSession"}'));
    expect(rootCss).not.toContain('.regionArea:has(input:not([tabindex="-1"])) .headerNewSession');
    expect(panel).toContain("deriveWorkbenchSessions(");
    expect(panel).toContain("sessionsByProjectId");
    expect(panel).toContain("archiveSession={archiveSession}");
    expect(root).toContain('<WorkbenchBrand name={sidebarTitle} />');
    expect(panel).not.toContain('className="primaryActionGroup"');
    expect(panel).not.toContain('className="primaryNewSession"');
    expect(panel).toContain('const [expanded, setExpanded] = useState(false)');
    expect(client).toContain("spaces: listed.spaces");
    expect(client).toContain("inferLegacyRootAliases(");
    expect(client).toContain("...(aliasesBySpace[space.id] ?? [])");
    expect(client).toContain("await ctx.workspaces.archiveSession(sessionId)");
    expect(client).toContain("await ctx.workspaces.delete(workspaceId)");
    expect(client).toContain("await remote.inspectWorkspacePaths");
    expect(client).toContain("await ctx.workspaces.delete(item.workspaceId)");
    expect(client).toContain('window.addEventListener("focus", onFocus)');
    expect(client).toContain('window.removeEventListener("focus", onFocus)');
    expect(client).toContain('const DEFAULT_ORDINARY_WORKSPACE_TITLE = "normal workspace"');
    expect(client).toContain("void startDefaultOrdinarySession(false)");
    expect(client).toContain("await startDefaultOrdinarySession(true)");
    expect(client).toContain("ctx.workspaces.startSession(workspace.workspaceId)");
    expect(client).toContain("startProjectSession: async (workspaceId)");
    expect(client).toContain("await ctx.workspaces.insertSessionBefore(workspaceId, sessionId)");
    expect(client).not.toContain("ctx.workspaces.createDirectory(");
    expect(host).not.toContain("CASUAL_CHAT_DIRECTORY");
    expect(host).not.toContain(".dsh-casual-chats");
    expect(client).toContain("__dshWorkbenchFreshPage");
    expect(client).toContain("ctx.workspaces.startSession(targetWorkspaceId)");
    expect(client).toContain('window.setTimeout(() => { void load(); }, 250)');
  });
});

describe("Workspace 注册路径自愈", () => {
  it("批量区分仍存在的目录与已经删除的历史路径", async () => {
    const root = await mkdtemp(join(tmpdir(), "wb-workspace-paths-"));
    const existing = join(root, "existing");
    const missing = join(root, "missing");
    await mkdir(existing);
    const ctx = new Context();
    const service = new WorkbenchService(ctx, { workspaceRoot: root, dataDir: join(root, "data") });
    const request = inspectWorkspacePathsRequestSchema.parse({ paths: [existing, missing, existing] });
    const result = await service.inspectWorkspacePaths(request, new AbortController().signal);
    expect(workspacePathStatusResultSchema.parse(result)).toEqual({
      availablePaths: [existing],
      missingPaths: [missing],
    });
  });
});

describe("frontmatter", () => {
  it("解析基础标量、数组与注释", () => {
    const raw = [
      "---",
      "title: 官网改版",
      "product_line: 数据中台",
      "stage: planning",
      "owner: 张三",
      "tags: [官网, 前端]",
      "# 注释行",
      "---",
      "",
      "# 正文",
    ].join("\n");
    const { data, body } = parseFrontmatter(raw);
    expect(data.title).toBe("官网改版");
    expect(data.product_line).toBe("数据中台");
    expect(data.stage).toBe("planning");
    expect(data.tags).toEqual(["官网", "前端"]);
    expect(body).toContain("# 正文");
  });

  it("没有 frontmatter 时原样返回 body", () => {
    const { data, body } = parseFrontmatter("# 只有正文\n");
    expect(data).toEqual({});
    expect(body).toContain("只有正文");
  });

  it("projectFrontmatter 只保留合法字段", () => {
    const frontmatter = projectFrontmatter(
      "---\ntitle: A\nstage: unknown\nowner: 李四\ntags: [x]\n---\n",
    );
    expect(frontmatter.title).toBe("A");
    expect(frontmatter.stage).toBeUndefined();
    expect(frontmatter.owner).toBe("李四");
    expect(frontmatter.tags).toEqual(["x"]);
  });

  it("buildProjectMarkdown 与解析往返一致", () => {
    const text = buildProjectMarkdown(
      {
        title: "Demo",
        productLine: "P",
        stage: "execution",
        owner: "王五",
        tags: ["a", "b"],
      },
      "# 项目\n",
    );
    expect(projectFrontmatter(text)).toMatchObject({
      title: "Demo",
      productLine: "P",
      stage: "execution",
      owner: "王五",
      tags: ["a", "b"],
    });
  });
});

describe("catalog 目录约定", () => {
  it("folderNameForTitle 生成日期前缀并清理非法字符", () => {
    const now = new Date("2026-08-20T10:00:00+08:00");
    expect(folderNameForTitle("  官网-改版  ", now)).toBe("2026-08-20_官网 改版");
    expect(folderNameForTitle("a/b:c", now)).toBe("2026-08-20_abc");
    expect(() => folderNameForTitle("   ", now)).toThrow("empty title");
  });

  it("folderDateAndTitle 解析日期前缀", () => {
    expect(folderDateAndTitle("2026-08-20_官网改版")).toEqual({
      date: "2026-08-20",
      title: "官网改版",
    });
    expect(folderDateAndTitle("旧目录")).toEqual({ title: "旧目录" });
  });

  it("scanWorkspace 扫描客户与项目两层结构", async () => {
    const root = await mkdtemp(join(tmpdir(), "wb-scan-"));
    const customerPath = join(root, "中科云");
    await mkdir(join(customerPath, "2026-08-01_数据平台"), { recursive: true });
    await writeFile(
      join(customerPath, "2026-08-01_数据平台", "project.md"),
      "---\ntitle: 数据平台一期\nproduct_line: 数据中台\nstage: execution\nowner: 张三\ntags: [ETL, 建模]\n---\n\n# 目标\n",
    );
    await mkdir(join(customerPath, "2026-08-10_官网改版"), { recursive: true });

    const { customers, projects } = await scanWorkspace(root, emptyOverlay());
    expect(customers).toHaveLength(1);
    expect(customers[0]!.name).toBe("中科云");
    expect(projects).toHaveLength(2);

    const dataProject = projects.find((p) => p.title === "数据平台一期")!;
    expect(dataProject.productLine).toBe("数据中台");
    expect(dataProject.stage).toBe("execution");
    expect(dataProject.owner).toBe("张三");
    expect(dataProject.tags).toEqual(["ETL", "建模"]);
    expect(dataProject.hasProjectDoc).toBe(true);

    const websiteProject = projects.find((p) => p.title === "官网改版")!;
    expect(websiteProject.stage).toBe("opportunity");
    expect(websiteProject.hasProjectDoc).toBe(false);
  });

  it("createProjectFolder 自动排重并生成 project.md", async () => {
    const root = await mkdtemp(join(tmpdir(), "wb-create-"));
    const customerPath = join(root, "中科云");
    await mkdir(customerPath);
    const first = await createProjectFolder(customerPath, "官网改版", { tags: [] });
    const second = await createProjectFolder(customerPath, "官网改版", { tags: [] });
    const prefix = formatDay(new Date());
    expect(first.id).toBe(`${prefix}_官网改版`);
    expect(second.id).toBe(`${prefix}_官网改版-2`);
    expect(first.folderPath).not.toBe(second.folderPath);

    const { customers, projects } = await scanWorkspace(root, emptyOverlay());
    const customer = customers.find((item) => item.folderPath === customerPath);
    expect(customer?.projects).toHaveLength(2);
    expect(projects.map((p) => p.title).sort()).toEqual(["官网改版", "官网改版"]);
    const created = projects.find((p) => p.id === first.id)!;
    expect(created.hasProjectDoc).toBe(true);
    expect(created.customerName).toBe("中科云");
  });

  it("matchesFilter / matchesQuery 按项目阶段过滤", () => {
    const base = {
      id: "2026-08-20_x",
      folderPath: "/x",
      title: "官网改版",
      createdMs: 1,
      stage: "execution" as const,
      tags: ["官网"],
      hasProjectDoc: true,
      customerId: "c",
      customerName: "中科云",
      archived: false,
    };
    expect(matchesFilter(base, "all")).toBe(true);
    expect(matchesFilter(base, "execution")).toBe(true);
    expect(matchesFilter(base, "planning")).toBe(false);
    expect(matchesFilter({ ...base, stage: "acceptance" }, "acceptance")).toBe(true);
    expect(matchesFilter({ ...base, stage: "acceptance" }, "retrospective")).toBe(false);
    expect(matchesQuery(base, "官网")).toBe(true);
    expect(matchesQuery(base, "中科云")).toBe(true);
    expect(matchesQuery({ ...base, productLine: "数据中台" }, "数据中台")).toBe(true);
    expect(matchesQuery(base, "不存在")).toBe(false);
  });

  it("matchesFilter 归档项目仍按阶段过滤，在全部列表可见", () => {
    const base = {
      id: "2026-08-20_x",
      folderPath: "/x",
      title: "官网改版",
      createdMs: 1,
      stage: "execution" as const,
      tags: [] as string[],
      hasProjectDoc: true,
      customerId: "c",
      customerName: "中科云",
      archived: true,
    };
    expect(matchesFilter(base, "all")).toBe(true);
    expect(matchesFilter(base, "execution")).toBe(true);
    expect(matchesFilter(base, "planning")).toBe(false);
    expect(matchesFilter({ ...base, archived: false }, "execution")).toBe(true);
  });

  describe("listProjects 过滤值边界校验兼容", () => {
    it("新版阶段值与 all 通过校验", () => {
      for (const filter of ["all", "opportunity", "requirement", "planning", "execution", "acceptance", "retrospective"]) {
        const parsed = listProjectsRequestSchema.safeParse({ query: "", filter });
        expect(parsed.success, `filter=${filter} should pass boundary validation`).toBe(true);
      }
    });

    it("legacy 过滤值（active/done/archived）不触发边界校验失败", () => {
      for (const filter of ["active", "done", "archived"]) {
        const parsed = listProjectsRequestSchema.safeParse({ query: "", filter });
        expect(parsed.success, `filter=${filter} should not fail boundary validation`).toBe(true);
      }
    });
  });

  it("scanWorkspace 读取 overlay 的 archived 标记", async () => {
    const root = await mkdtemp(join(tmpdir(), "wb-arch-"));
    const customerPath = join(root, "中科云");
    await mkdir(join(customerPath, "2026-08-01_数据平台"), { recursive: true });
    await writeFile(
      join(customerPath, "2026-08-01_数据平台", "project.md"),
      "---\ntitle: 数据平台一期\n---\n",
    );
    const overlay = emptyOverlay();
    overlay.projects["2026-08-01_数据平台"] = { archived: true };
    const { projects } = await scanWorkspace(root, overlay);
    expect(projects).toHaveLength(1);
    expect(projects[0]!.archived).toBe(true);
  });
});

describe("catalog 客户管理", () => {
  it("createCustomerFolder 新建客户文件夹并自动排重", async () => {
    const root = await mkdtemp(join(tmpdir(), "wb-customer-"));
    const first = await createCustomerFolder(root, "中科云");
    const second = await createCustomerFolder(root, "中科云");
    expect(first.id).toBe("中科云");
    expect(second.id).toBe("中科云-2");
    const { customers } = await scanWorkspace(root, emptyOverlay());
    expect(customers.map((c) => c.name).sort()).toEqual(["中科云", "中科云-2"]);
  });

  it("createCustomerFolder 清理非法字符并拒绝空名", async () => {
    const root = await mkdtemp(join(tmpdir(), "wb-customer-"));
    const created = await createCustomerFolder(root, "  A/B:C  ");
    expect(created.id).toBe("ABC");
    await expect(createCustomerFolder(root, "   ")).rejects.toThrow("empty customer name");
  });

  it("renameCustomerFolder 整体改名并迁移内部项目", async () => {
    const root = await mkdtemp(join(tmpdir(), "wb-rename-"));
    await createCustomerFolder(root, "中科云");
    await createProjectFolder(join(root, "中科云"), "数据平台", { tags: [] });
    const renamed = await renameCustomerFolder(root, "中科云", "中科云科技");
    expect(renamed.id).toBe("中科云科技");
    const { customers, projects } = await scanWorkspace(root, emptyOverlay());
    expect(customers).toHaveLength(1);
    expect(customers[0]!.name).toBe("中科云科技");
    expect(projects).toHaveLength(1);
    expect(projects[0]!.customerName).toBe("中科云科技");
  });

  it("renameCustomerFolder 目标重名时抛错", async () => {
    const root = await mkdtemp(join(tmpdir(), "wb-rename-"));
    await createCustomerFolder(root, "甲");
    await createCustomerFolder(root, "乙");
    await expect(renameCustomerFolder(root, "甲", "乙")).rejects.toThrow(/already exists/);
  });

  it("scanWorkspace 包含空客户目录", async () => {
    const root = await mkdtemp(join(tmpdir(), "wb-empty-"));
    await createCustomerFolder(root, "新客户");
    const { customers, projects } = await scanWorkspace(root, emptyOverlay());
    expect(customers).toHaveLength(1);
    expect(customers[0]!.name).toBe("新客户");
    expect(customers[0]!.projects).toHaveLength(0);
    expect(projects).toHaveLength(0);
  });
});

describe("overlay", () => {
  it("decodeOverlay 兼容缺省与非法字段", () => {
    const store = decodeLegacyOverlay({
      schemaVersion: 1,
      members: [{ uid: "u1", name: "张三" }, { uid: "", name: "" }],
      recentWorkspaces: ["/a", "/b", "", 42],
      projects: {
        ok: { title: "T", stage: "execution" },
        archived: { archived: true },
        unarchived: { archived: false },
        badStage: { stage: "nope" },
        empty: {},
      },
    });
    expect(store.members).toEqual([{ uid: "u1", name: "张三" }]);
    expect(store.recentWorkspaces).toEqual(["/a", "/b"]);
    expect(store.projects.ok).toEqual({ title: "T", stage: "execution" });
    expect(store.projects.archived).toEqual({ archived: true });
    expect(store.projects.unarchived).toEqual({ archived: false });
    expect(store.projects.badStage).toBeUndefined();
    expect(store.projects.empty).toBeUndefined();
  });

  it("pushRecentWorkspace 按 MRU 去重并截断", () => {
    const items = ["/a", "/b", "/c"];
    expect(pushRecentWorkspace(items, "/d")).toEqual(["/d", "/a", "/b", "/c"]);
    expect(pushRecentWorkspace(items, "/b")).toEqual(["/b", "/a", "/c"]);
    const many = ["/1", "/2", "/3", "/4", "/5", "/6", "/7", "/8"];
    expect(pushRecentWorkspace(many, "/9")).toHaveLength(8);
    expect(pushRecentWorkspace(many, "/9")[0]).toBe("/9");
  });

  it("Space 顺序可原子往返", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wb-overlay-"));
    const store = emptyOverlay();
    await saveOverlay(dir, store);
    expect(Object.keys((await loadOverlay(dir)).spaces)).toEqual(Object.keys(store.spaces));
  });

  it("loadOverlay 文件缺失时返回空 overlay", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wb-overlay-"));
    const loaded = await loadOverlay(dir);
    const expected = emptyOverlay();
    expect(loaded).toEqual({
      ...expected,
      spaces: Object.fromEntries(Object.entries(expected.spaces).map(([id, space]) => [id, {
        ...space,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      }])),
    });
  });

  it("saveOverlay 原子写入后可重新读取", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wb-overlay-"));
    const store = emptyOverlay();
    store.spaces[store.defaultSpaceId]!.rootPath = "/workspace";
    store.projects["2026-08-20_demo"] = { stage: "execution" };
    await saveOverlay(dir, store);
    expect(await loadOverlay(dir)).toEqual(store);
  });

  it("withOverlayLock 串行化并发写", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wb-overlay-"));
    const first = withOverlayLock(dir, async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return "first";
    });
    const second = withOverlayLock(dir, async () => "second");
    expect(await first).toBe("first");
    expect(await second).toBe("second");
  });
});

describe("到期计算", () => {
  it("parseDay 解析 YYYY-MM-DD 并拒绝非法输入", () => {
    expect(parseDay("2026-08-20")).toEqual(new Date(2026, 7, 20));
    expect(parseDay("2026-13-01")).toBeUndefined();
    expect(parseDay("2026-02-30")).toBeUndefined();
    expect(parseDay("not-a-date")).toBeUndefined();
    expect(parseDay("20260820")).toBeUndefined();
  });

  it("daysUntil 按整天计算差值", () => {
    const today = new Date(2026, 7, 20);
    expect(daysUntil("2026-08-20", today)).toBe(0);
    expect(daysUntil("2026-08-18", today)).toBe(-2);
    expect(daysUntil("2026-08-25", today)).toBe(5);
    expect(daysUntil("bad", today)).toBeUndefined();
  });
});

describe("AI 增强（统计/到期/批量）", () => {
  /** 今天加 offset 天的 YYYY-MM-DD。 */
  function dayOffset(offset: number): string {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return formatDay(date);
  }

  async function makeFixture() {
    const root = await mkdtemp(join(tmpdir(), "wb-svc-"));
    const wsRoot = join(root, "ws");
    const dataDir = join(root, "data");
    await mkdir(wsRoot, { recursive: true });
    const ctx = new Context();
    const service = new WorkbenchService(ctx, { workspaceRoot: wsRoot, dataDir });
    return { ctx, service, wsRoot };
  }

  async function seedWorkspace(wsRoot: string) {
    const customer = join(wsRoot, "中科云");
    await mkdir(join(customer, "2026-07-01_数据平台"), { recursive: true });
    await writeFile(
      join(customer, "2026-07-01_数据平台", "project.md"),
      `---\ntitle: 数据平台一期\ndue_at: ${dayOffset(-19)}\nstage: execution\nowner: 张三\nproduct_line: 数据中台\n---\n`,
    );
    await mkdir(join(customer, "2026-08-10_官网改版"), { recursive: true });
    await writeFile(
      join(customer, "2026-08-10_官网改版", "project.md"),
      `---\ntitle: 官网改版\ndue_at: ${dayOffset(2)}\nstage: planning\n---\n`,
    );
    const customer2 = join(wsRoot, "海康智造");
    await mkdir(join(customer2, "2026-08-01_产线数字化"), { recursive: true });
    await writeFile(
      join(customer2, "2026-08-01_产线数字化", "project.md"),
      `---\ntitle: 产线数字化\nstage: acceptance\n---\n`,
    );
  }

  it("statistics 统计含归档、分布与到期概览", async () => {
    const { ctx, service, wsRoot } = await makeFixture();
    try {
      await seedWorkspace(wsRoot);
      const overlay = emptyOverlay(wsRoot);
      overlay.projects["2026-08-10_官网改版"] = { archived: true };
      await saveOverlay(service.dataDir, overlay);

      const stats = await service.statistics({}, new AbortController().signal);
      expect(stats.workspaceRoot).toBe(wsRoot);
      expect(stats.totalProjects).toBe(3);
      expect(stats.activeProjects).toBe(2);
      expect(stats.archivedProjects).toBe(1);
      expect(stats.doneProjects).toBe(1);
      expect(stats.customers).toBe(2);
      expect(stats.byStage.execution).toBe(1);
      expect(stats.byStage.planning).toBe(1);
      expect(stats.byStage.acceptance).toBe(1);
      expect(stats.byOwner).toEqual([{ owner: "张三", count: 1 }]);
      expect(stats.byProductLine).toEqual([{ productLine: "数据中台", count: 1 }]);
      // 官网改版已归档，不应计入 dueSoon
      expect(stats.overdueProjects).toBe(1);
      expect(stats.dueSoonProjects).toBe(0);
    } finally {
      service.stopWatch();
    }
  });

  it("dueReminders 区分逾期与即将到期", async () => {
    const { ctx, service, wsRoot } = await makeFixture();
    try {
      await seedWorkspace(wsRoot);
      const signal = new AbortController().signal;
      const result = await service.dueReminders({}, signal);
      expect(result.overdue).toHaveLength(1);
      expect(result.overdue[0]!.id).toBe("2026-07-01_数据平台");
      expect(result.overdue[0]!.daysLeft).toBeLessThan(0);
      expect(result.overdue[0]!.owner).toBe("张三");
      expect(result.dueSoon).toHaveLength(1);
      expect(result.dueSoon[0]!.id).toBe("2026-08-10_官网改版");
      // acceptance 项目不在提醒里
      const onlyOverdue = await service.dueReminders({ days: 0 }, signal);
      expect(onlyOverdue.overdue).toHaveLength(1);
      expect(onlyOverdue.dueSoon).toHaveLength(0);
      // 按客户过滤
      const filtered = await service.dueReminders({ customer: "海康" }, signal);
      expect(filtered.overdue).toHaveLength(0);
      expect(filtered.dueSoon).toHaveLength(0);
    } finally {
      service.stopWatch();
    }
  });

  it("listProjects 兼容 legacy 过滤值（按 all 处理）", async () => {
    const { ctx, service, wsRoot } = await makeFixture();
    try {
      await seedWorkspace(wsRoot);
      const signal = new AbortController().signal;
      const all = await service.listProjects({ query: "", filter: "all" }, signal);
      for (const legacy of ["active", "done", "archived"] as const) {
        const result = await service.listProjects({ query: "", filter: legacy }, signal);
        expect(result.projects.map((p) => p.id)).toEqual(all.projects.map((p) => p.id));
        expect(result.customers.length).toBe(all.customers.length);
      }
    } finally {
      service.stopWatch();
    }
  });

  it("新建空客户后 listProjects 结果通过 Typert result schema", async () => {
    const { service } = await makeFixture();
    try {
      const signal = new AbortController().signal;
      await service.createCustomer({ name: "测试客户" }, signal);
      const result = await service.listProjects({ query: "", filter: "all" }, signal);
      expect(result.customers.map((customer) => customer.name)).toEqual(["测试客户"]);
      expect(result.projects).toEqual([]);
      expect(listProjectsResultSchema.safeParse(result)).toMatchObject({ success: true });
    } finally {
      service.stopWatch();
    }
  });

  it("batchUpdate 批量设置阶段并移动客户", async () => {
    const { ctx, service, wsRoot } = await makeFixture();
    try {
      await seedWorkspace(wsRoot);
      await createCustomerFolder(wsRoot, "新客户");
      const signal = new AbortController().signal;
      const result = await service.batchUpdate(
        { ids: ["2026-07-01_数据平台", "2026-08-10_官网改版"], stage: "execution", customerId: "新客户" },
        signal,
      );
      expect(result.updated).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.errors).toEqual([]);

      const { projects } = await service.listProjects({ query: "", filter: "all" }, signal);
      const moved = projects.find((p) => p.id === "2026-07-01_数据平台")!;
      expect(moved.customerName).toBe("新客户");
      expect(moved.stage).toBe("execution");
    } finally {
      service.stopWatch();
    }
  });

  it("batchUpdate 未知 ID 计入失败", async () => {
    const { ctx, service, wsRoot } = await makeFixture();
    try {
      await seedWorkspace(wsRoot);
      const result = await service.batchUpdate(
        { ids: ["2026-07-01_数据平台", "不存在的项目"], owner: "李四" },
        new AbortController().signal,
      );
      expect(result.updated).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.errors[0]!.id).toBe("不存在的项目");
      const { projects } = await service.listProjects({ query: "", filter: "all" }, new AbortController().signal);
      expect(projects.find((p) => p.id === "2026-07-01_数据平台")!.owner).toBe("李四");
    } finally {
      service.stopWatch();
    }
  });
});

describe("文件归集", () => {
  it("categoryOfFile 按扩展名归类办公文档", () => {
    expect(categoryOfFile("方案.docx")).toBe("word");
    expect(categoryOfFile("预算.xlsx")).toBe("excel");
    expect(categoryOfFile("汇报.pptx")).toBe("ppt");
    expect(categoryOfFile("合同.pdf")).toBe("pdf");
    expect(categoryOfFile("README.md")).toBe("text");
    expect(categoryOfFile("photo.png")).toBe("image");
    expect(categoryOfFile("archive.zip")).toBe("archive");
    expect(categoryOfFile("无扩展名")).toBe("other");
    expect(categoryOfFile("data.unknown")).toBe("other");
  });

  it("categoryOfFile 大小写不敏感", () => {
    expect(categoryOfFile("CONTRACT.DOCX")).toBe("word");
    expect(categoryOfFile("DATA.XLS")).toBe("excel");
  });

  it("scanProjectFiles 递归扫描并跳过隐藏/依赖目录", async () => {
    const root = await mkdtemp(join(tmpdir(), "wb-files-"));
    const project = join(root, "2026-08-20_官网改版");
    await mkdir(join(project, "docs", "sub"), { recursive: true });
    await writeFile(join(project, "project.md"), "# 项目\n");
    await writeFile(join(project, "docs", "方案.docx"), "x");
    await writeFile(join(project, "docs", "sub", "预算.xlsx"), "y");
    await mkdir(join(project, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(project, "node_modules", "pkg", "index.js"), "z");
    await mkdir(join(project, ".git"), { recursive: true });
    await writeFile(join(project, ".git", "config"), "c");

    const files = await scanProjectFiles(project);
    const paths = files.map((f) => f.relativePath).sort();
    expect(paths).toEqual(["docs/sub/预算.xlsx", "docs/方案.docx", "project.md"]);
    const docx = files.find((f) => f.relativePath === "docs/方案.docx")!;
    expect(docx.category).toBe("word");
    expect(docx.sizeBytes).toBe(1);
    expect(docx.modifiedMs).toBeGreaterThan(0);
  });

  it("categorizeFiles 统计各类别数量", () => {
    const files: ProjectFile[] = [
      { name: "a.docx", relativePath: "a.docx", category: "word", sizeBytes: 1, modifiedMs: 1 },
      { name: "b.xlsx", relativePath: "b.xlsx", category: "excel", sizeBytes: 1, modifiedMs: 1 },
      { name: "c.docx", relativePath: "c.docx", category: "word", sizeBytes: 1, modifiedMs: 1 },
      { name: "d.txt", relativePath: "d.txt", category: "text", sizeBytes: 1, modifiedMs: 1 },
    ];
    const counts = categorizeFiles(files);
    expect(counts.word).toBe(2);
    expect(counts.excel).toBe(1);
    expect(counts.text).toBe(1);
    expect(counts.ppt).toBe(0);
    expect(counts.pdf).toBe(0);
    expect(counts.image).toBe(0);
    expect(counts.archive).toBe(0);
    expect(counts.other).toBe(0);
  });

  it("listProjectFiles 支持按类别与关键词过滤", async () => {
    const root = await mkdtemp(join(tmpdir(), "wb-list-"));
    const wsRoot = join(root, "ws");
    const dataDir = join(root, "data");
    await mkdir(join(wsRoot, "中科云", "2026-08-20_官网改版"), { recursive: true });
    await writeFile(join(wsRoot, "中科云", "2026-08-20_官网改版", "project.md"), "---\ntitle: 官网改版\n---\n");
    await writeFile(join(wsRoot, "中科云", "2026-08-20_官网改版", "方案.docx"), "x");
    await writeFile(join(wsRoot, "中科云", "2026-08-20_官网改版", "预算.xlsx"), "y");
    const ctx = new Context();
    const service = new WorkbenchService(ctx, { workspaceRoot: wsRoot, dataDir });
    try {
      const all = await service.listProjectFiles({ id: "2026-08-20_官网改版" }, new AbortController().signal);
      expect(all.byCategory.word).toBe(1);
      expect(all.byCategory.excel).toBe(1);
      expect(all.files).toHaveLength(3);

      const onlyExcel = await service.listProjectFiles(
        { id: "2026-08-20_官网改版", category: "excel" },
        new AbortController().signal,
      );
      expect(onlyExcel.files.map((f) => f.name)).toEqual(["预算.xlsx"]);

      const keyword = await service.listProjectFiles(
        { id: "2026-08-20_官网改版", query: "方案" },
        new AbortController().signal,
      );
      expect(keyword.files.map((f) => f.name)).toEqual(["方案.docx"]);

      await expect(
        service.listProjectFiles({ id: "不存在" }, new AbortController().signal),
      ).rejects.toThrow("project not found");
    } finally {
      service.stopWatch();
    }
  });
});

describe("会话触发器", () => {
  it("chipLabel 按显示宽度截断中文", () => {
    expect(chipLabel("官网改版")).toBe("官网改版");
    expect(chipLabel("")).toBe("项目");
    const long = "这是一个非常长的项目名称用来测试截断逻辑是否工作";
    const out = chipLabel(long);
    expect(out.endsWith("…")).toBe(true);
    expect(out.startsWith("这是一")).toBe(true);
    expect([...out]).toHaveLength(4);
  });

  it("formatProjectRef 汇总项目上下文", () => {
    const ref = formatProjectRef({
      id: "2026-08-20_官网改版",
      folderPath: "/ws/中科云/2026-08-20_官网改版",
      title: "官网改版",
      createdMs: 1,
      stage: "execution",
      tags: ["官网", "前端"],
      hasProjectDoc: true,
      customerId: "中科云",
      customerName: "中科云",
      archived: false,
      productLine: "数据中台",
      owner: "张三",
      startedAt: "2026-08-01",
      dueAt: "2026-09-01",
      projectMarkdown: "# 目标\n上线官网",
    });
    expect(ref).toContain("工作台项目：官网改版");
    expect(ref).toContain("客户：中科云");
    expect(ref).toContain("阶段：execution");
    expect(ref).toContain("产品线：数据中台");
    expect(ref).toContain("负责人：张三");
    expect(ref).toContain("截止日期：2026-09-01");
    expect(ref).toContain("标签：官网、前端");
    expect(ref).toContain("--- project.md ---");
  });

  it("formatProjectRef 无 markdown 时不含文档段", () => {
    const ref = formatProjectRef({
      id: "x",
      folderPath: "/x",
      title: "无文档",
      createdMs: 1,
      stage: "opportunity",
      tags: [],
      hasProjectDoc: false,
      customerId: "c",
      customerName: "客户",
      archived: false,
      projectMarkdown: "",
    });
    expect(ref).toContain("工作台项目：无文档");
    expect(ref).not.toContain("project.md");
  });
});
