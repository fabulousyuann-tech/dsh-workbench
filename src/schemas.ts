import { z } from "zod";

import { PROJECT_STAGES, SPACE_COLORS, SPACE_ICONS } from "./types.ts";

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
  spaceId: z.string().min(1),
  workspaceRoot: z.string(),
  rules: z.string().optional(),
  hiddenWorkspaces: z.array(z.string().min(1)).optional(),
});

export const workspaceListResultSchema = z.object({
  spaceId: z.string().min(1),
  current: z.string(),
  workspaces: z.array(z.string()),
});

export const inspectWorkspacePathsRequestSchema = z.object({
  paths: z.array(z.string().min(1)).max(500),
});

export const workspacePathStatusResultSchema = z.object({
  availablePaths: z.array(z.string().min(1)),
  missingPaths: z.array(z.string().min(1)),
});

export const listProjectsRequestSchema = z.object({
  spaceId: z.string().min(1).optional(),
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
  spaceId: z.string().min(1).optional(),
});

export const projectIdRequestSchema = idRequestSchema.extend({
  customerId: z.string().min(1).optional(),
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
  spaceId: z.string().min(1).optional(),
});

export const hideWorkspacesRequestSchema = z.object({
  paths: z.array(z.string().min(1)),
  spaceId: z.string().min(1).optional(),
});

export const createProjectRequestSchema = z.object({
  spaceId: z.string().min(1).optional(),
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
  spaceId: z.string().min(1).optional(),
  name: z.string().min(1),
});

export const createCustomerResultSchema = z.object({
  id: z.string().min(1),
  folderPath: z.string().min(1),
});

export const renameCustomerRequestSchema = z.object({
  spaceId: z.string().min(1).optional(),
  id: z.string().min(1),
  name: z.string().min(1),
});

export const renameCustomerResultSchema = z.object({
  id: z.string().min(1),
  folderPath: z.string().min(1),
  name: z.string().min(1),
});

export const updateProjectRequestSchema = z.object({
  spaceId: z.string().min(1).optional(),
  id: z.string().min(1),
  customerId: z.string().min(1).optional(),
  title: z.string().optional(),
  stage: projectStageSchema.optional(),
  owner: z.string().optional(),
  productLine: z.string().optional(),
  archived: z.boolean().optional(),
});

export const moveProjectRequestSchema = z.object({
  spaceId: z.string().min(1).optional(),
  id: z.string().min(1),
  sourceCustomerId: z.string().min(1).optional(),
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
  spaceId: z.string().min(1).optional(),
  id: z.string().min(1),
  customerId: z.string().min(1).optional(),
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
  spaceId: z.string().min(1),
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
  spaceId: z.string().min(1).optional(),
  days: z.number().int().nonnegative().optional(),
  customer: z.string().optional(),
});

export const dueRemindersResultSchema = z.object({
  spaceId: z.string().min(1),
  workspaceRoot: z.string(),
  horizonDays: z.number().int().nonnegative(),
  overdue: z.array(dueReminderItemSchema),
  dueSoon: z.array(dueReminderItemSchema),
});

export const modelRouteRefSchema = z.object({
  provider: z.string().min(1), model: z.string().min(1), reasoningEffort: z.string().min(1).optional(),
});
export const auxiliaryPolicySchema = z.object({
  mode: z.enum(["inherit", "override", "disabled"]),
  visionRouteId: z.string().min(1).optional(), imageGenerationRouteId: z.string().min(1).optional(),
});
export const spacePolicySchema = z.object({
  model: modelRouteRefSchema.optional(), agentPreset: z.string().min(1).optional(),
  permissionPreset: z.string().min(1).optional(), auxiliary: auxiliaryPolicySchema,
});
export const spaceSchema = z.object({
  id: z.string().min(1), rootPath: z.string().min(1), rootPathHistory: z.array(z.string().min(1)).optional(), name: z.string().min(1),
  color: z.enum(SPACE_COLORS), icon: z.enum(SPACE_ICONS), order: z.number().int().nonnegative(),
  pinned: z.boolean(), rules: z.string().optional(), hiddenWorkspacePaths: z.array(z.string().min(1)),
  policy: spacePolicySchema, createdAt: z.string().min(1), updatedAt: z.string().min(1),
});
export const spaceStatusSchema = spaceSchema.extend({ pathStatus: z.enum(["available", "missing"]) });
export const migrationStatusSchema = z.object({
  state: z.enum(["not-needed", "completed", "failed"]), fromVersion: z.literal(1).optional(),
  migratedAt: z.string().optional(), backupPath: z.string().optional(), message: z.string().optional(),
});
export const listSpacesRequestSchema = z.object({ selectedSpaceId: z.string().min(1).optional() });
export const listSpacesResultSchema = z.object({
  spaces: z.array(spaceStatusSchema), defaultSpaceId: z.string().min(1), selectedSpaceId: z.string().min(1), migration: migrationStatusSchema,
});
export const createSpaceRequestSchema = z.object({
  rootPath: z.string().min(1), name: z.string().min(1).optional(), color: z.enum(SPACE_COLORS).optional(),
  icon: z.enum(SPACE_ICONS).optional(), pinned: z.boolean().optional(), makeDefault: z.boolean().optional(),
});
export const updateSpaceRequestSchema = z.object({
  spaceId: z.string().min(1), rootPath: z.string().min(1).optional(), name: z.string().optional(),
  color: z.enum(SPACE_COLORS).optional(), icon: z.enum(SPACE_ICONS).optional(), pinned: z.boolean().optional(), rules: z.string().optional(),
});
export const removeSpaceRequestSchema = z.object({ spaceId: z.string().min(1) });
export const removeSpaceResultSchema = z.object({ removedSpaceId: z.string().min(1), defaultSpaceId: z.string().min(1) });
export const reorderSpacesRequestSchema = z.object({ spaceIds: z.array(z.string().min(1)).min(1) });
export const setSpaceRequestSchema = z.object({ spaceId: z.string().min(1) });
export const updateSpacePolicyRequestSchema = z.object({
  spaceId: z.string().min(1), model: modelRouteRefSchema.nullable().optional(),
  agentPreset: z.string().nullable().optional(), permissionPreset: z.string().nullable().optional(), auxiliary: auxiliaryPolicySchema.optional(),
});
export const spacePolicyResultSchema = z.object({ spaceId: z.string().min(1), policy: spacePolicySchema });
export const resolveSpaceRequestSchema = z.object({ spaceId: z.string().min(1).optional(), selectedSpaceId: z.string().min(1).optional() });
export const resolveSpaceResultSchema = z.object({
  spaceId: z.string().min(1), rootPath: z.string().min(1), source: z.enum(["explicit", "selected", "default"]),
});
export const searchSpacesRequestSchema = z.object({ query: z.string() });
export const searchSpacesResultSchema = z.object({
  query: z.string(),
  projects: z.array(projectSummarySchema.extend({ spaceId: z.string().min(1), spaceName: z.string().min(1) })),
  overview: z.array(z.object({ spaceId: z.string().min(1), name: z.string().min(1), customers: z.number().int().nonnegative(), projects: z.number().int().nonnegative(), pathStatus: z.enum(["available", "missing"]) })),
});
const auxiliaryRouteSchema = z.object({ id: z.string().min(1), label: z.string().min(1) });
export const auxiliaryCapabilitiesResultSchema = z.object({
  installed: z.boolean(), version: z.string().optional(), message: z.string().optional(),
  routes: z.object({ vision: z.array(auxiliaryRouteSchema), imageGeneration: z.array(auxiliaryRouteSchema), compression: z.array(auxiliaryRouteSchema), title: z.array(auxiliaryRouteSchema) }),
});
