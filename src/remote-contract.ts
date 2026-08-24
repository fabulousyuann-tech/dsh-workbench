import type { InvocationDescriptor } from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";

import {
  createCustomerRequestSchema,
  createCustomerResultSchema,
  createProjectRequestSchema,
  createProjectResultSchema,
  deleteCustomerResultSchema,
  deleteProjectResultSchema,
  dueRemindersRequestSchema,
  dueRemindersResultSchema,
  emptyObjectSchema,
  hideWorkspacesRequestSchema,
  idRequestSchema,
  inspectWorkspacePathsRequestSchema,
  listProjectFilesRequestSchema,
  listProjectsRequestSchema,
  listProjectsResultSchema,
  moveProjectRequestSchema,
  projectIdRequestSchema,
  projectDetailSchema,
  projectFilesResultSchema,
  renameCustomerRequestSchema,
  renameCustomerResultSchema,
  revisionResultSchema,
  setWorkspaceRootRequestSchema,
  statisticsResultSchema,
  updateProjectRequestSchema,
  workbenchSettingsSchema,
  workspaceListResultSchema,
  workspacePathStatusResultSchema,
  createSpaceRequestSchema,
  listSpacesRequestSchema,
  listSpacesResultSchema,
  migrationStatusSchema,
  removeSpaceRequestSchema,
  removeSpaceResultSchema,
  reorderSpacesRequestSchema,
  resolveSpaceRequestSchema,
  resolveSpaceResultSchema,
  setSpaceRequestSchema,
  spaceSchema,
  updateSpacePolicyRequestSchema,
  updateSpaceRequestSchema,
  searchSpacesRequestSchema,
  searchSpacesResultSchema,
  spacePolicyResultSchema,
  auxiliaryCapabilitiesResultSchema,
} from "./schemas.ts";

export const PACKAGE_NAME = "dsh-workbench";
export const REMOTE_NAMESPACE = "workbench";

function codec(typeSymbol: string, schema: z.ZodType<unknown>) {
  return { mode: "strict" as const, typeSymbol, schema };
}

function jsonParam(
  name: string,
  typeSymbol: string,
  schema: z.ZodType<unknown>,
): InvocationDescriptor["parameters"][number] {
  return {
    name,
    wire: name,
    source: "json",
    codec: codec(typeSymbol, schema),
  };
}

function invocation(
  method: string,
  request: z.ZodType<unknown>,
  result: z.ZodType<unknown>,
): InvocationDescriptor {
  return {
    id: `${PACKAGE_NAME}#${REMOTE_NAMESPACE}/${method}`,
    service: REMOTE_NAMESPACE,
    namespace: REMOTE_NAMESPACE,
    method,
    invocation: { kind: "direct" },
    parameters: [jsonParam("request", `${PACKAGE_NAME}#${method}Request`, request)],
    cancellation: { parameter: "signal" },
    result: codec(`${PACKAGE_NAME}#${method}Result`, result),
    sourceLocation: { file: "src/service.ts", line: 1, column: 1 },
  };
}

export const WORKBENCH_INVOCATIONS: readonly InvocationDescriptor[] = [
  invocation("listProjects", listProjectsRequestSchema, listProjectsResultSchema),
  invocation("getProject", projectIdRequestSchema, projectDetailSchema),
  invocation("listProjectFiles", listProjectFilesRequestSchema, projectFilesResultSchema),
  invocation("getRevision", emptyObjectSchema, revisionResultSchema),
  invocation("getSettings", emptyObjectSchema, workbenchSettingsSchema),
  invocation("listWorkspaces", emptyObjectSchema, workspaceListResultSchema),
  invocation("inspectWorkspacePaths", inspectWorkspacePathsRequestSchema, workspacePathStatusResultSchema),
  invocation("setWorkspaceRoot", setWorkspaceRootRequestSchema, workbenchSettingsSchema),
  invocation("hideWorkspaces", hideWorkspacesRequestSchema, workbenchSettingsSchema),
  invocation("refreshCatalog", emptyObjectSchema, listProjectsResultSchema),
  invocation("createProject", createProjectRequestSchema, createProjectResultSchema),
  invocation("createCustomer", createCustomerRequestSchema, createCustomerResultSchema),
  invocation("renameCustomer", renameCustomerRequestSchema, renameCustomerResultSchema),
  invocation("updateProject", updateProjectRequestSchema, projectDetailSchema),
  invocation("moveProject", moveProjectRequestSchema, projectDetailSchema),
  invocation("deleteProject", projectIdRequestSchema, deleteProjectResultSchema),
  invocation("deleteCustomer", idRequestSchema, deleteCustomerResultSchema),
  invocation("statistics", emptyObjectSchema, statisticsResultSchema),
  invocation("dueReminders", dueRemindersRequestSchema, dueRemindersResultSchema),
  invocation("listSpaces", listSpacesRequestSchema, listSpacesResultSchema),
  invocation("createSpace", createSpaceRequestSchema, spaceSchema),
  invocation("updateSpace", updateSpaceRequestSchema, spaceSchema),
  invocation("removeSpace", removeSpaceRequestSchema, removeSpaceResultSchema),
  invocation("reorderSpaces", reorderSpacesRequestSchema, z.array(spaceSchema)),
  invocation("setDefaultSpace", setSpaceRequestSchema, spaceSchema),
  invocation("setSelectedSpace", setSpaceRequestSchema, spaceSchema),
  invocation("updateSpacePolicy", updateSpacePolicyRequestSchema, spaceSchema),
  invocation("getSpace", setSpaceRequestSchema, spaceSchema),
  invocation("getSpacePolicy", setSpaceRequestSchema, spacePolicyResultSchema),
  invocation("resolveSpace", resolveSpaceRequestSchema, resolveSpaceResultSchema),
  invocation("getMigrationStatus", emptyObjectSchema, migrationStatusSchema),
  invocation("searchSpaces", searchSpacesRequestSchema, searchSpacesResultSchema),
  invocation("getAuxiliaryCapabilities", emptyObjectSchema, auxiliaryCapabilitiesResultSchema),
];
