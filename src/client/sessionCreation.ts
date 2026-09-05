import { modelRouteAvailable, resolveSessionPolicy, type SessionPolicyOverride } from "../policy.ts";
import type { WorkbenchSpace } from "../types.ts";
import {
  agentPresetRemote,
  createLegacyPresetSession,
  modelGroups,
  selectSessionModel,
  sessionCreator,
  type ClientContext,
  type ISessions,
  type SessionId,
} from "./dshCompatibility.ts";

async function waitForBinding(sessions: ISessions, sessionId: SessionId): Promise<NonNullable<ReturnType<ISessions["binding"]>>> {
  const current = sessions.binding(sessionId); if (current !== undefined) return current;
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => { stop(); reject(new Error("New session did not reach the client catalog")); }, 10_000);
    const stop = sessions.list.subscribe(() => {
      const binding = sessions.binding(sessionId);
      if (binding !== undefined) { window.clearTimeout(timer); stop(); resolve(binding); }
    });
  });
}

/** Validate policy, create, configure and only then navigate: the visible transition is atomic. */
export async function createSpaceSession(ctx: ClientContext, space: WorkbenchSpace, explicit: SessionPolicyOverride = {}): Promise<SessionId> {
  const policy = resolveSessionPolicy(space.policy, explicit);
  if (policy.model !== undefined) {
    const groups = await modelGroups(ctx);
    if (!modelRouteAvailable(groups, policy.model)) {
      throw new Error(`Space model route is unavailable: ${policy.model.provider}/${policy.model.model}`);
    }
  }
  const sessions = ctx.sessions as unknown as ISessions;
  const presetRemote = policy.agentPreset === undefined ? undefined : agentPresetRemote(ctx);
  let sessionId: SessionId;
  if (policy.agentPreset !== undefined && presetRemote === undefined) {
    // rc.2 accepts the preset as part of session birth and has no preset Remote.
    sessionId = await createLegacyPresetSession(ctx, space.rootPath, policy.agentPreset);
  } else {
    // DSH 0.1.2 moved creation behind the concrete sessions controller.
    sessionId = await sessionCreator(ctx).create({ cwd: space.rootPath });
  }
  const binding = await waitForBinding(sessions, sessionId);
  if (policy.agentPreset !== undefined && presetRemote !== undefined) {
    const selected = await presetRemote.select(sessionId, policy.agentPreset);
    if (!selected.ok) {
      throw new Error(`agent preset failed: ${selected.error?.code ?? "UNKNOWN"}: ${selected.error?.message ?? "Unknown error"}`);
    }
  }
  if (policy.model !== undefined) {
    await selectSessionModel(ctx, sessionId, policy.model);
  }
  if (policy.permissionPreset !== undefined) {
    const result = await binding.session.command(`/permission ${policy.permissionPreset}`);
    if (!result.ok) {
      throw new Error(`permission policy failed: ${result.error?.message ?? "Unknown error"}`);
    }
    if (result.value?.matched !== true) throw new Error("Host does not provide the /permission command");
  }
  sessions.open(sessionId);
  return sessionId;
}
