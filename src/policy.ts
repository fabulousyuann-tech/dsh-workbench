import type { AuxiliaryPolicy, ModelRouteRef, SpacePolicy } from "./types.ts";

export interface SessionPolicyOverride {
  model?: ModelRouteRef | null;
  agentPreset?: string | null;
  permissionPreset?: string | null;
}

export interface EffectiveSessionPolicy {
  model?: ModelRouteRef;
  agentPreset?: string;
  permissionPreset?: string;
  source: { model: "explicit" | "space" | "global"; agentPreset: "explicit" | "space" | "global"; permissionPreset: "explicit" | "space" | "global" };
}

/** Explicit new-session values win, then Space policy, then an omitted value delegates to DSH global defaults. */
export function resolveSessionPolicy(space: SpacePolicy, explicit: SessionPolicyOverride = {}): EffectiveSessionPolicy {
  const pick = <T>(override: T | null | undefined, inherited: T | undefined): { value?: T; source: "explicit" | "space" | "global" } => {
    if (override !== undefined) return override === null ? { source: "explicit" } : { value: override, source: "explicit" };
    return inherited === undefined ? { source: "global" } : { value: inherited, source: "space" };
  };
  const model = pick(explicit.model, space.model); const agentPreset = pick(explicit.agentPreset, space.agentPreset);
  const permissionPreset = pick(explicit.permissionPreset, space.permissionPreset);
  return {
    ...(model.value === undefined ? {} : { model: model.value }),
    ...(agentPreset.value === undefined ? {} : { agentPreset: agentPreset.value }),
    ...(permissionPreset.value === undefined ? {} : { permissionPreset: permissionPreset.value }),
    source: { model: model.source, agentPreset: agentPreset.source, permissionPreset: permissionPreset.source },
  };
}

export interface AuxiliaryCapability {
  available: boolean;
  reason?: string;
  policy: AuxiliaryPolicy;
}

/** Optional auxiliary plugin contract: absence is a visible, non-fatal capability state. */
export function resolveAuxiliaryCapability(policy: AuxiliaryPolicy, installed: boolean): AuxiliaryCapability {
  if (policy.mode === "disabled") return { available: false, reason: "disabled-by-space", policy };
  if (!installed) return { available: false, reason: "auxiliary-plugin-not-installed", policy };
  return { available: true, policy };
}

export function modelRouteAvailable(
  groups: readonly { id: string; models: readonly { id: string }[] }[],
  route: ModelRouteRef,
): boolean {
  return groups.some((group) => group.id === route.provider && group.models.some((model) => model.id === route.model));
}
