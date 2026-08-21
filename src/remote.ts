import type { TypertRemoteContribution } from "@deepseek-ai/dsh-typert-protocol";

import { PACKAGE_NAME, WORKBENCH_INVOCATIONS } from "./remote-contract.ts";

export const TYPERT_REMOTE: TypertRemoteContribution = {
  package: PACKAGE_NAME,
  descriptors: WORKBENCH_INVOCATIONS,
};

export default TYPERT_REMOTE;
