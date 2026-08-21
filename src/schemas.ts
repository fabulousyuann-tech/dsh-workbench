import { z } from "zod";

import { PROJECT_STAGES } from "./types.ts";

const projectStageSchema = z.enum(PROJECT_STAGES);
// 旧版客户端（迁移前）可能发送 active/done/archived 等 legacy 值。
// 这些值必须显式列入枚举：网关的边界校验基于枚举/JSON Schema，不识别 Zod 的 .catch()，
// 否则 listProjects 请求会被 "wire field 'request' failed boundary validation" 拦截。
const LEGACY_PROJECT_FILTERS = ["active", "done", "archived"] as const;
const projectFilterSchema = z.enum(["all", ...PROJECT_STAGES, ...LEGACY_PROJECT_FILTERS]);

export const projectSummarySchema = z.object({
  id: z.string().min(1),
  folderPath: z.string().min(1),
  title: z.string(),
  date: z.string().optional(),
  createdMs: z.number().int().nonnegative(),
  productLine: z.string().optional(),
  stage: projectStageSchema,
  owner: z.string().optional(),
  startedAt: z.string().optional(),
  dueAt: z.string().optional(),
  tags: z.array(z.string()),
  hasProjectDoc: z.boolean(),
  customerId: z.string().min(1),
  customerName: z.string().min(1),
  archived: z.boolean(),
});

export const customerSummarySchema = z.object({
  id: z.string().min(1),
  folderPath: z.string().min(1),
  name: z.string(),
  hasCustomerDoc: z.boolean(),
  projects: z.array(projectSummarySchema),
});

export const workbenchSettingsSchema = z.object({
  workspaceRoot: z.string(),
  rules: z.string().optional(),
});

export const workspaceListResultSchema = z.object({
  current: z.string(),
  workspaces: z.array(z.string()),
});

export const listProjectsRequestSchema = z.object({
  query: z.string(),
  filter: projectFilterSchema,
});

export const listProjectsResultSchema = z.object({
  settings: workbenchSettingsSchema,
  customers: z.array(customerSummarySchema),
  projects: z.array(projectSummarySchema),
  revision: z.number().int().nonnegative(),
});

export const idRequestSchema = z.object({
  id: z.string().min(1),
});

export const projectDetailSchema = projectSummarySchema.and(
  z.object({
    projectMarkdown: z.string(),
  }),
);

export const revisionResultSchema = z.object({
  revision: z.number().int().nonnegative(),
});

export const setWorkspaceRootRequestSchema = z.object({
  path: z.string().min(1),
});

export const createProjectRequestSchema = z.object({
  customerId: z.string().min(1),
  title: z.string().min(1),
  productLine: z.string().optional(),
  stage: projectStageSchema.optional(),
});

export const createProjectResultSchema = z.object({
  id: z.string().min(1),
  folderPath: z.string().min(1),
});

export const createCustomerRequestSchema = z.object({
  name: z.string().min(1),
});

export const createCustomerResultSchema = z.object({
  id: z.string().min(1),
  folderPath: z.string().min(1),
});

export const renameCustomerRequestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

export const renameCustomerResultSchema = z.object({
  id: z.string().min(1),
  folderPath: z.string().min(1),
  name: z.string().min(1),
});

export const updateProjectRequestSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  stage: projectStageSchema.optional(),
  owner: z.string().optional(),
  productLine: z.string().optional(),
  archived: z.boolean().optional(),
});

export const moveProjectRequestSchema = z.object({
  id: z.string().min(1),
  customerId: z.string().min(1),
});

export const deleteProjectResultSchema = z.object({
  id: z.string().min(1),
  trashedPath: z.string().min(1),
});

export const deleteCustomerResultSchema = z.object({
  id: z.string().min(1),
  trashedPath: z.string().min(1),
  projects: z.number().int().nonnegative(),
});

export const fileCategorySchema = z.enum(["word", "excel", "ppt", "pdf", "text", "image", "archive", "other"]);

export const projectFileSchema = z.object({
  name: z.string().min(1),
  relativePath: z.string().min(1),
  category: fileCategorySchema,
  sizeBytes: z.number().int().nonnegative(),
  modifiedMs: z.number().int().nonnegative(),
});

export const listProjectFilesRequestSchema = z.object({
  id: z.string().min(1),
  query: z.string().optional(),
  category: fileCategorySchema.optional(),
});

export const projectFilesResultSchema = z.object({
  id: z.string().min(1),
  folderPath: z.string().min(1),
  files: z.array(projectFileSchema),
  byCategory: z.record(fileCategorySchema, z.number().int().nonnegative()),
});

export const emptyObjectSchema = z.object({});

export const statisticsResultSchema = z.object({
  workspaceRoot: z.string(),
  totalProjects: z.number().int().nonnegative(),
  activeProjects: z.number().int().nonnegative(),
  archivedProjects: z.number().int().nonnegative(),
  doneProjects: z.number().int().nonnegative(),
  customers: z.number().int().nonnegative(),
  byStage: z.record(z.string(), z.number().int().nonnegative()),
  byCustomer: z.array(z.object({
    id: z.string().min(1),
    name: z.string(),
    count: z.number().int().nonnegative(),
  })),
  byProductLine: z.array(z.object({
    productLine: z.string(),
    count: z.number().int().nonnegative(),
  })),
  byOwner: z.array(z.object({
    owner: z.string(),
    count: z.number().int().nonnegative(),
  })),
  overdueProjects: z.number().int().nonnegative(),
  dueSoonProjects: z.number().int().nonnegative(),
});

export const dueReminderItemSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  customerName: z.string().min(1),
  stage: projectStageSchema,
  dueAt: z.string(),
  daysLeft: z.number().int(),
  overdue: z.boolean(),
  owner: z.string().optional(),
});

export const dueRemindersRequestSchema = z.object({
  days: z.number().int().nonnegative().optional(),
  customer: z.string().optional(),
});

export const dueRemindersResultSchema = z.object({
  workspaceRoot: z.string(),
  horizonDays: z.number().int().nonnegative(),
  overdue: z.array(dueReminderItemSchema),
  dueSoon: z.array(dueReminderItemSchema),
});
