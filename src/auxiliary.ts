import type { Context } from "@deepseek-ai/cordis";
import type { AuxiliaryCapabilitiesResult, AuxiliaryRouteRef } from "./types.ts";

export const AUXILIARY_SERVICE = "dshAuxiliary";
export interface DshAuxiliaryContract {
  version: string;
  listRoutes(): Promise<Partial<Record<"vision" | "imageGeneration" | "compression" | "title", AuxiliaryRouteRef[]>>>;
}
const emptyRoutes = () => ({ vision: [], imageGeneration: [], compression: [], title: [] });

/** Optional, versioned Cordis service boundary; no value import from dsh-auxiliary-yuan. */
export async function auxiliaryCapabilities(ctx: Context): Promise<AuxiliaryCapabilitiesResult> {
  const service = ctx.get(AUXILIARY_SERVICE) as DshAuxiliaryContract | undefined;
  if (service === undefined) return { installed: false, routes: emptyRoutes(), message: "Optional auxiliary plugin is not installed" };
  try {
    const listed = await service.listRoutes();
    return { installed: true, version: service.version, routes: { ...emptyRoutes(), ...listed } };
  } catch (cause) {
    return { installed: true, version: service.version, routes: emptyRoutes(), message: cause instanceof Error ? cause.message : "Auxiliary capability lookup failed" };
  }
}
