import { PACKAGE_NAME, WORKBENCH_INVOCATIONS } from "./remote-contract.ts";

export const TYPERT = {
  package: PACKAGE_NAME,
  face: "host" as const,
  schemas: [],
  model: {
    services: [],
    events: [],
    objects: [],
  },
  invocations: WORKBENCH_INVOCATIONS,
};
