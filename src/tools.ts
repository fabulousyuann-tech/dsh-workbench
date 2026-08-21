import type { Context } from "@deepseek-ai/cordis";
import { defineTool, type ToolDefinition } from "@deepseek-ai/dsh-tools";

import type { WorkbenchService } from "./service.ts";
import { PROJECT_STAGES, type ProjectDetail, type ProjectStage } from "./types.ts";

/** 一个只含文本的模型可见内容块。 */
function textBlock(content: string): { type: "text"; text: string }[] {
  return [{ type: "text", text: content }];
}

/** 把项目详情投影为纯 JSON 值（丢弃内部路径/时间戳字段），供模型输出 schema 校验。 */
function projectDetailValue(project: ProjectDetail) {
  return {
    id: project.id,
    title: project.title,
    customerName: project.customerName,
    stage: project.stage,
    archived: project.archived,
    ...(project.productLine === undefined ? {} : { productLine: project.productLine }),
    ...(project.owner === undefined ? {} : { owner: project.owner }),
    ...(project.date === undefined ? {} : { date: project.date }),
    tags: project.tags,
    hasProjectDoc: project.hasProjectDoc,
    projectMarkdown: project.projectMarkdown,
  };
}

function listCustomersTool(service: WorkbenchService): ToolDefinition {
  return defineTool({
    name: "workbench_list_customers",
    description: "列出工作台中的所有客户（每个客户是一个顶层文件夹），可用于定位要创建项目的客户 ID。",
    parameters: {},
    output: {
      schema: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            id: { type: "string", required: true, description: "客户 ID（客户文件夹名）" },
            name: { type: "string", required: true, description: "客户名称" },
            projectCount: { type: "integer", required: true, description: "该客户下的项目数" },
          },
        },
      },
      render: (_args, value) => {
        if (value.length === 0) return textBlock("工作台当前没有客户。");
        const lines = value.map((c) => `- ${c.name}（${c.id}，${c.projectCount} 个项目）`);
        return textBlock(`客户列表（${value.length}）：\n${lines.join("\n")}`);
      },
    },
    async execute(_args, exec) {
      const result = await service.listProjects({ query: "", filter: "all" }, exec.signal);
      return result.customers.map((customer) => ({
        id: customer.id,
        name: customer.name,
        projectCount: customer.projects.length,
      }));
    },
  });
}

function listProjectsTool(service: WorkbenchService): ToolDefinition {
  return defineTool({
    name: "workbench_list_projects",
    description:
      "列出工作台中的项目。可按客户名、关键词、阶段过滤；返回项目概览与当前工作空间目录。",
    parameters: {
      customer: { type: "string", description: "按客户名称（部分匹配）过滤" },
      query: { type: "string", description: "按标题/ID/客户/产品线/标签关键词过滤" },
      filter: {
        type: "string",
        enum: ["all", ...PROJECT_STAGES],
        description: "阶段过滤：all 全部，或指定阶段（opportunity/requirement/planning/execution/acceptance/retrospective）",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          workspaceRoot: { type: "string", required: true, description: "工作空间根目录" },
          revision: { type: "integer", required: true, description: "目录修订号" },
          customers: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: true,
              properties: {
                id: { type: "string", required: true },
                name: { type: "string", required: true },
                projectCount: { type: "integer", required: true },
              },
            },
          },
          projects: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: true,
              properties: {
                id: { type: "string", required: true, description: "项目 ID（项目文件夹名）" },
                title: { type: "string", required: true, description: "项目标题" },
                customer: { type: "string", required: true, description: "所属客户名称" },
                stage: { type: "string", required: true, enum: [...PROJECT_STAGES], description: "项目阶段" },
                archived: { type: "boolean", required: true, description: "是否已归档" },
                productLine: { type: "string", description: "产品线" },
                owner: { type: "string", description: "负责人" },
                date: { type: "string", description: "创建日期 YYYY-MM-DD" },
                tags: { type: "array", required: true, items: { type: "string" } },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const lines = [
          `工作空间：${value.workspaceRoot}`,
          `项目数：${value.projects.length}`,
          "",
          ...value.projects.map((project) => {
            const extras = [
              project.productLine === undefined ? "" : `产品线：${project.productLine}`,
              project.owner === undefined ? "" : `负责人：${project.owner}`,
            ].filter((item) => item !== "");
            return `- [${project.stage}]${project.archived ? "（已归档）" : ""} ${project.title}（客户：${project.customer}${
              extras.length === 0 ? "" : `，${extras.join("，")}`
            }）`;
          }),
        ];
        return textBlock(lines.join("\n"));
      },
    },
    async execute(args, exec) {
      const result = await service.listProjects(
        { query: args.query ?? "", filter: args.filter ?? "all" },
        exec.signal,
      );
      const customer = args.customer?.trim().toLowerCase();
      const projects =
        customer === undefined || customer === ""
          ? result.projects
          : result.projects.filter((project) =>
            project.customerName.toLowerCase().includes(customer),
          );
      return {
        workspaceRoot: result.settings.workspaceRoot,
        revision: result.revision,
        customers: result.customers.map((item) => ({
          id: item.id,
          name: item.name,
          projectCount: item.projects.length,
        })),
        projects: projects.map((project) => ({
          id: project.id,
          title: project.title,
          customer: project.customerName,
          stage: project.stage,
          archived: project.archived,
          ...(project.productLine === undefined ? {} : { productLine: project.productLine }),
          ...(project.owner === undefined ? {} : { owner: project.owner }),
          ...(project.date === undefined ? {} : { date: project.date }),
          tags: project.tags,
        })),
      };
    },
  });
}

function getProjectTool(service: WorkbenchService): ToolDefinition {
  return defineTool({
    name: "workbench_get_project",
    description:
      "获取单个项目的详细信息，包括 frontmatter 元数据与 project.md 正文，用于了解项目目标、范围与进度。",
    parameters: {
      id: { type: "string", required: true, description: "项目 ID（项目文件夹名）" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: true,
        properties: {
          id: { type: "string", required: true },
          title: { type: "string", required: true },
          customerName: { type: "string", required: true },
          stage: { type: "string", required: true, enum: [...PROJECT_STAGES] },
          archived: { type: "boolean", required: true, description: "是否已归档" },
          productLine: { type: "string" },
          owner: { type: "string" },
          date: { type: "string" },
          tags: { type: "array", required: true, items: { type: "string" } },
          hasProjectDoc: { type: "boolean", required: true },
          projectMarkdown: { type: "string", required: true, description: "project.md 正文" },
        },
      },
      render: (_args, value) => {
        const lines = [
          `项目：${value.title}（客户：${value.customerName}）`,
          `ID：${value.id}`,
          `阶段：${value.stage}`,
          ...(value.productLine === undefined ? [] : [`产品线：${value.productLine}`]),
          ...(value.owner === undefined ? [] : [`负责人：${value.owner}`]),
          ...(value.date === undefined ? [] : [`创建日期：${value.date}`]),
          value.tags.length === 0 ? "" : `标签：${value.tags.join("、")}`,
        ].filter((line) => line !== "");
        if (value.projectMarkdown !== "") {
          lines.push("", "--- project.md ---", value.projectMarkdown);
        }
        return textBlock(lines.join("\n"));
      },
    },
    async execute(args, exec) {
      return projectDetailValue(await service.getProject({ id: args.id }, exec.signal));
    },
  });
}

function createProjectTool(service: WorkbenchService): ToolDefinition {
  return defineTool({
    name: "workbench_create_project",
    description:
      "在指定客户下新建一个项目：创建项目文件夹并写入 project.md 模板。客户 ID 可通过 workbench_list_customers 获取。",
    parameters: {
      customerId: { type: "string", required: true, description: "客户 ID（客户文件夹名）" },
      title: { type: "string", required: true, description: "项目标题" },
      productLine: { type: "string", description: "产品线" },
      stage: {
        type: "string",
        enum: [...PROJECT_STAGES],
        description: "项目阶段，默认 opportunity",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", required: true, description: "新项目 ID（项目文件夹名）" },
          folderPath: { type: "string", required: true, description: "项目文件夹绝对路径" },
        },
      },
      render: (_args, value) => textBlock(`已创建项目 ${value.id}：${value.folderPath}`),
    },
    async execute(args, exec) {
      const request: { customerId: string; title: string; productLine?: string; stage?: ProjectStage } = {
        customerId: args.customerId,
        title: args.title,
      };
      if (args.productLine !== undefined) request.productLine = args.productLine;
      if (args.stage !== undefined) request.stage = args.stage;
      return service.createProject(request, exec.signal);
    },
  });
}

function createCustomerTool(service: WorkbenchService): ToolDefinition {
  return defineTool({
    name: "workbench_create_customer",
    description:
      "在工作空间根目录新建一个客户（顶层文件夹）。客户 ID 即文件夹名。新建后即可用 workbench_create_project 在该客户下创建项目。",
    parameters: {
      name: { type: "string", required: true, description: "客户名称（自动清理非法字符；重名自动加 -2）" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", required: true, description: "客户 ID（客户文件夹名）" },
          folderPath: { type: "string", required: true, description: "客户文件夹绝对路径" },
        },
      },
      render: (_args, value) => textBlock(`已创建客户 ${value.id}：${value.folderPath}`),
    },
    async execute(args, exec) {
      return service.createCustomer({ name: args.name }, exec.signal);
    },
  });
}

/** 重命名客户（客户文件夹整体改名）。 */
function renameCustomerTool(service: WorkbenchService): ToolDefinition {
  return defineTool({
    name: "workbench_rename_customer",
    description:
      "重命名客户：把客户文件夹整体改名（内部项目随目录一起迁移）。客户 ID 即改名前的文件夹名，重命名后 ID 变为新文件夹名。",
    parameters: {
      id: { type: "string", required: true, description: "客户 ID（当前客户文件夹名）" },
      name: { type: "string", required: true, description: "新的客户名称" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", required: true, description: "新的客户 ID（新文件夹名）" },
          name: { type: "string", required: true, description: "新的客户名称" },
          folderPath: { type: "string", required: true, description: "客户文件夹绝对路径" },
        },
      },
      render: (_args, value) => textBlock(`已重命名客户为 ${value.name}（${value.id}）：${value.folderPath}`),
    },
    async execute(args, exec) {
      return service.renameCustomer({ id: args.id, name: args.name }, exec.signal);
    },
  });
}

function updateProjectTool(service: WorkbenchService): ToolDefinition {
  return defineTool({
    name: "workbench_update_project",
    description:
      "更新项目的元数据（标题、阶段、负责人、产品线）。用于把项目阶段推进到下一里程碑、指派负责人等。",
    parameters: {
      id: { type: "string", required: true, description: "项目 ID（项目文件夹名）" },
      title: { type: "string", description: "新的项目标题" },
      stage: { type: "string", enum: [...PROJECT_STAGES], description: "新的项目阶段" },
      owner: { type: "string", description: "新的负责人" },
      productLine: { type: "string", description: "新的产品线" },
    },
    output: {
      schema: { type: "json", description: "更新后的项目详情" },
      render: (_args, value) =>
        textBlock(
          `已更新项目：${JSON.stringify(value, null, 2)}`,
        ),
    },
    async execute(args, exec) {
      const request: { id: string; title?: string; stage?: ProjectStage; owner?: string; productLine?: string } = {
        id: args.id,
      };
      if (args.title !== undefined) request.title = args.title;
      if (args.stage !== undefined) request.stage = args.stage;
      if (args.owner !== undefined) request.owner = args.owner;
      if (args.productLine !== undefined) request.productLine = args.productLine;
      return projectDetailValue(await service.updateProject(request, exec.signal));
    },
  });
}

/** 归档或恢复项目（archived=false 即恢复）。 */
function archiveProjectTool(service: WorkbenchService): ToolDefinition {
  return defineTool({
    name: "workbench_archive_project",
    description:
      "归档或恢复项目。归档后项目仍在列表中以“已归档”徽标标识（不影响按阶段过滤），适合已完结/暂停的项目；archived=false 恢复。",
    parameters: {
      id: { type: "string", required: true, description: "项目 ID（项目文件夹名）" },
      archived: {
        type: "boolean",
        description: "true 归档，false 恢复；默认 true",
      },
    },
    output: {
      schema: { type: "json", description: "更新后的项目详情" },
      render: (_args, value) =>
        textBlock(
          `归档状态已更新：${JSON.stringify(value, null, 2)}`,
        ),
    },
    async execute(args, exec) {
      return projectDetailValue(
        await service.updateProject(
          { id: args.id, archived: args.archived ?? true },
          exec.signal,
        ),
      );
    },
  });
}

/** 变更项目所属客户（移动项目文件夹）。 */
function moveProjectTool(service: WorkbenchService): ToolDefinition {
  return defineTool({
    name: "workbench_move_project",
    description:
      "把项目移动到另一个客户名下（项目文件夹整体迁移到目标客户目录）。目标客户 ID 可用 workbench_list_customers 获取。",
    parameters: {
      id: { type: "string", required: true, description: "项目 ID（项目文件夹名）" },
      customerId: { type: "string", required: true, description: "目标客户 ID（客户文件夹名）" },
    },
    output: {
      schema: { type: "json", description: "移动后的项目详情" },
      render: (_args, value) =>
        textBlock(`已移动项目：${JSON.stringify(value, null, 2)}`),
    },
    async execute(args, exec) {
      return projectDetailValue(
        await service.moveProject({ id: args.id, customerId: args.customerId }, exec.signal),
      );
    },
  });
}

/** 删除项目（移入回收站 .trash，可从磁盘手动恢复）。 */
function deleteProjectTool(service: WorkbenchService): ToolDefinition {
  return defineTool({
    name: "workbench_delete_project",
    description:
      "删除项目：把项目文件夹移入工作空间的 .trash 回收站并清空其工作台记录。注意：建议先归档而非删除；删除前请与用户确认。",
    parameters: {
      id: { type: "string", required: true, description: "项目 ID（项目文件夹名）" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", required: true, description: "已删除的项目 ID" },
          trashedPath: { type: "string", required: true, description: "回收站中的路径" },
        },
      },
      render: (_args, value) =>
        textBlock(`已删除项目 ${value.id}，移入回收站：${value.trashedPath}`),
    },
    async execute(args, exec) {
      return service.deleteProject({ id: args.id }, exec.signal);
    },
  });
}

/** 项目文件归集：按类别 / 关键词列出项目文件夹内的文件（Office、PDF、图片等）。 */
function listProjectFilesTool(service: WorkbenchService): ToolDefinition {
  return defineTool({
    name: "workbench_list_project_files",
    description:
      "列出项目文件夹内归集后的文件。按扩展名归为 word / excel / ppt / pdf / text / image / archive / other，可按类别或文件名关键词过滤。用于查找项目里的 Word、Excel、PPT、PDF 等文档。",
    parameters: {
      id: { type: "string", required: true, description: "项目 ID（项目文件夹名）" },
      query: { type: "string", description: "按文件名 / 相对路径关键词过滤" },
      category: {
        type: "string",
        enum: ["word", "excel", "ppt", "pdf", "text", "image", "archive", "other"],
        description: "按归集类别过滤",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", required: true, description: "项目 ID" },
          folderPath: { type: "string", required: true, description: "项目文件夹路径" },
          files: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: true,
              properties: {
                name: { type: "string", required: true, description: "文件名" },
                relativePath: { type: "string", required: true, description: "相对项目文件夹的路径" },
                category: { type: "string", required: true, description: "归集类别" },
                sizeBytes: { type: "integer", required: true, description: "文件大小（字节）" },
                modifiedMs: { type: "integer", required: true, description: "最后修改时间（毫秒时间戳）" },
              },
            },
          },
          byCategory: {
            type: "object",
            required: true,
            additionalProperties: true,
            description: "各类别文件数（含未过滤的全部文件）",
          },
        },
      },
      render: (_args, value) => {
        const catLabel: Record<string, string> = {
          word: "Word 文档",
          excel: "Excel 表格",
          ppt: "PPT 演示",
          pdf: "PDF",
          text: "文本 / Markdown",
          image: "图片",
          archive: "压缩包",
          other: "其他",
        };
        const counts = Object.entries(value.byCategory)
          .filter(([, count]) => Number(count) > 0)
          .map(([category, count]) => `${catLabel[category] ?? category} ${count} 个`);
        const lines = [
          `项目：${value.id}`,
          `目录：${value.folderPath}`,
          `归集：${counts.length === 0 ? "（空）" : counts.join("，")}`,
          "",
        ];
        if (value.files.length === 0) {
          lines.push("没有匹配的文件。");
        } else {
          lines.push(`文件（${value.files.length}）：`);
          for (const file of value.files) {
            const kb = file.sizeBytes / 1024;
            const size = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`;
            lines.push(`- [${file.category}] ${file.relativePath}（${size}）`);
          }
        }
        return textBlock(lines.join("\n"));
      },
    },
    async execute(args, exec) {
      const result = await service.listProjectFiles(
        {
          id: args.id,
          ...(args.query === undefined ? {} : { query: args.query }),
          ...(args.category === undefined ? {} : { category: args.category }),
        },
        exec.signal,
      );
      return {
        id: result.id,
        folderPath: result.folderPath,
        files: result.files.map((file) => ({
          name: file.name,
          relativePath: file.relativePath,
          category: file.category,
          sizeBytes: file.sizeBytes,
          modifiedMs: file.modifiedMs,
        })),
        byCategory: result.byCategory,
      };
    },
  });
}

/** 工作台统计快照（含归档项目）。 */
function statisticsTool(service: WorkbenchService): ToolDefinition {
  return defineTool({
    name: "workbench_statistics",
    description:
      "获取工作台统计快照：项目总数、各阶段/客户/产品线/负责人分布、已归档/已交付数量、以及到期提醒概览（逾期/即将到期项目数）。",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          workspaceRoot: { type: "string", required: true, description: "工作空间根目录" },
          totalProjects: { type: "integer", required: true, description: "全部项目数（含归档）" },
          activeProjects: { type: "integer", required: true, description: "未归档项目数" },
          archivedProjects: { type: "integer", required: true, description: "已归档项目数" },
          doneProjects: { type: "integer", required: true, description: "未归档且已交付的项目数" },
          customers: { type: "integer", required: true, description: "客户数" },
          overdueProjects: { type: "integer", required: true, description: "已过到期日且未完结的项目数" },
          dueSoonProjects: { type: "integer", required: true, description: "7 天内到期且未完结的项目数" },
          byStage: {
            type: "object",
            required: true,
            additionalProperties: true,
            description: "各阶段项目数（键为阶段名）",
          },
          byCustomer: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: true,
              properties: {
                id: { type: "string", required: true },
                name: { type: "string", required: true },
                count: { type: "integer", required: true },
              },
            },
          },
          byProductLine: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: true,
              properties: {
                productLine: { type: "string", required: true },
                count: { type: "integer", required: true },
              },
            },
          },
          byOwner: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: true,
              properties: {
                owner: { type: "string", required: true },
                count: { type: "integer", required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const stageLines = PROJECT_STAGES.map((stage) => `  - ${stage}: ${String(value.byStage[stage] ?? 0)}`).join("\n");
        const customerLines = value.byCustomer.map((item) => `  - ${item.name}（${item.count}）`).join("\n");
        const productLines = value.byProductLine.map((item) => `  - ${item.productLine}（${item.count}）`).join("\n");
        const ownerLines = value.byOwner.map((item) => `  - ${item.owner}（${item.count}）`).join("\n");
        return textBlock(
          [
            `工作空间：${value.workspaceRoot}`,
            `项目：共 ${value.totalProjects}（未归档 ${value.activeProjects}，已归档 ${value.archivedProjects}，已交付 ${value.doneProjects}）`,
            `客户：${value.customers} 个`,
            `到期：逾期 ${value.overdueProjects}，7 天内到期 ${value.dueSoonProjects}`,
            "",
            `按阶段：\n${stageLines}`,
            `按客户：\n${customerLines === "" ? "  （无）" : customerLines}`,
            `按产品线：\n${productLines === "" ? "  （无）" : productLines}`,
            `按负责人：\n${ownerLines === "" ? "  （无）" : ownerLines}`,
          ].join("\n"),
        );
      },
    },
    async execute(_args, exec) {
      const stats = await service.statistics({}, exec.signal);
      return {
        workspaceRoot: stats.workspaceRoot,
        totalProjects: stats.totalProjects,
        activeProjects: stats.activeProjects,
        archivedProjects: stats.archivedProjects,
        doneProjects: stats.doneProjects,
        customers: stats.customers,
        overdueProjects: stats.overdueProjects,
        dueSoonProjects: stats.dueSoonProjects,
        byStage: stats.byStage,
        byCustomer: stats.byCustomer.map((item) => ({ id: item.id, name: item.name, count: item.count })),
        byProductLine: stats.byProductLine.map((item) => ({ productLine: item.productLine, count: item.count })),
        byOwner: stats.byOwner.map((item) => ({ owner: item.owner, count: item.count })),
      };
    },
  });
}

/** 到期提醒：已过期与近期到期的项目。 */
function dueRemindersTool(service: WorkbenchService): ToolDefinition {
  return defineTool({
    name: "workbench_due_reminders",
    description:
      "获取到期提醒：列出已过到期日（overdue）与未来几天内到期（dueSoon）的项目，可用于周会提醒、催办、排期。",
    parameters: {
      days: { type: "integer", description: "提前提醒窗口（天），默认 7；0 只列已过期" },
      customer: { type: "string", description: "按客户名称（部分匹配）过滤" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          workspaceRoot: { type: "string", required: true },
          horizonDays: { type: "integer", required: true, description: "提前提醒窗口（天）" },
          overdue: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: true,
              properties: {
                id: { type: "string", required: true },
                title: { type: "string", required: true },
                customerName: { type: "string", required: true },
                stage: { type: "string", required: true, enum: [...PROJECT_STAGES] },
                dueAt: { type: "string", required: true, description: "到期日 YYYY-MM-DD" },
                daysLeft: { type: "integer", required: true, description: "距到期天数（负数已过期）" },
                overdue: { type: "boolean", required: true },
                owner: { type: "string" },
              },
            },
          },
          dueSoon: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: true,
              properties: {
                id: { type: "string", required: true },
                title: { type: "string", required: true },
                customerName: { type: "string", required: true },
                stage: { type: "string", required: true, enum: [...PROJECT_STAGES] },
                dueAt: { type: "string", required: true },
                daysLeft: { type: "integer", required: true },
                overdue: { type: "boolean", required: true },
                owner: { type: "string" },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const line = (item: { title: string; customerName: string; dueAt: string; daysLeft: number; owner?: string }) =>
          `- ${item.title}（客户：${item.customerName}${item.owner === undefined ? "" : `，负责人：${item.owner}`}，到期 ${item.dueAt}，剩 ${item.daysLeft} 天）`;
        const sections: string[] = [`工作空间：${value.workspaceRoot}`, `提醒窗口：${value.horizonDays} 天`];
        if (value.overdue.length > 0) {
          sections.push("", `⚠ 已逾期（${value.overdue.length}）：`, ...value.overdue.map(line));
        }
        if (value.dueSoon.length > 0) {
          sections.push("", `即将到期（${value.dueSoon.length}）：`, ...value.dueSoon.map(line));
        }
        if (value.overdue.length === 0 && value.dueSoon.length === 0) {
          sections.push("", "近期没有到期项目。");
        }
        return textBlock(sections.join("\n"));
      },
    },
    async execute(args, exec) {
      const result = await service.dueReminders(
        {
          ...(args.days === undefined ? {} : { days: args.days }),
          ...(args.customer === undefined ? {} : { customer: args.customer }),
        },
        exec.signal,
      );
      const toValue = (item: { id: string; title: string; customerName: string; stage: ProjectStage; dueAt: string; daysLeft: number; overdue: boolean; owner?: string }) => ({
        id: item.id,
        title: item.title,
        customerName: item.customerName,
        stage: item.stage,
        dueAt: item.dueAt,
        daysLeft: item.daysLeft,
        overdue: item.overdue,
        ...(item.owner === undefined ? {} : { owner: item.owner }),
      });
      return {
        workspaceRoot: result.workspaceRoot,
        horizonDays: result.horizonDays,
        overdue: result.overdue.map(toValue),
        dueSoon: result.dueSoon.map(toValue),
      };
    },
  });
}

/** 批量更新项目（阶段/负责人/产品线/归档/所属客户）。 */
function batchUpdateTool(service: WorkbenchService): ToolDefinition {
  return defineTool({
    name: "workbench_batch_update",
    description:
      "批量更新项目：对多个项目同时设置阶段、负责人、产品线、归档状态，或整体移动到另一个客户。执行前请与用户确认目标项目与改动。",
    parameters: {
      ids: {
        type: "array",
        required: true,
        items: { type: "string" },
        description: "项目 ID 列表（项目文件夹名）",
      },
      stage: { type: "string", enum: [...PROJECT_STAGES], description: "统一设置的项目阶段" },
      owner: { type: "string", description: "统一设置的负责人（空字符串清除）" },
      productLine: { type: "string", description: "统一设置的产品线（空字符串清除）" },
      archived: { type: "boolean", description: "统一归档（true）或恢复（false）" },
      customerId: { type: "string", description: "目标客户 ID，把项目整体移动过去（可用 workbench_list_customers 获取）" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          updated: { type: "integer", required: true, description: "成功处理的项目数" },
          failed: { type: "integer", required: true, description: "失败的项目数" },
          errors: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string", required: true },
                error: { type: "string", required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const lines = [`批量更新完成：成功 ${value.updated}，失败 ${value.failed}`];
        if (value.errors.length > 0) {
          lines.push("", "失败明细：", ...value.errors.map((item) => `- ${item.id}: ${item.error}`));
        }
        return textBlock(lines.join("\n"));
      },
    },
    async execute(args, exec) {
      const request: { ids: string[]; stage?: ProjectStage; owner?: string; productLine?: string; archived?: boolean; customerId?: string } = {
        ids: args.ids,
      };
      if (args.stage !== undefined) request.stage = args.stage;
      if (args.owner !== undefined) request.owner = args.owner;
      if (args.productLine !== undefined) request.productLine = args.productLine;
      if (args.archived !== undefined) request.archived = args.archived;
      if (args.customerId !== undefined) request.customerId = args.customerId;
      return service.batchUpdate(request, exec.signal);
    },
  });
}

/** 注册全部模型可见的工作台工具；返回一次性释放全部注册的 disposer。 */
export function registerWorkbenchTools(ctx: Context, service: WorkbenchService): () => void {
  const disposers = [
    ctx.tools.register(listCustomersTool(service)),
    ctx.tools.register(listProjectsTool(service)),
    ctx.tools.register(getProjectTool(service)),
    ctx.tools.register(createProjectTool(service)),
    ctx.tools.register(createCustomerTool(service)),
    ctx.tools.register(renameCustomerTool(service)),
    ctx.tools.register(updateProjectTool(service)),
    ctx.tools.register(archiveProjectTool(service)),
    ctx.tools.register(moveProjectTool(service)),
    ctx.tools.register(deleteProjectTool(service)),
    ctx.tools.register(listProjectFilesTool(service)),
    ctx.tools.register(statisticsTool(service)),
    ctx.tools.register(dueRemindersTool(service)),
    ctx.tools.register(batchUpdateTool(service)),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
