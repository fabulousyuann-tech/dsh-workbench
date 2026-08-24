import type { ClientContext, ISessions, SessionId } from "@deepseek-ai/dsh-client-runtime/client";
import type { ConnectionHandle } from "@deepseek-ai/dsh-client-connection/client";

import { modelRouteAvailable, resolveSessionPolicy, type SessionPolicyOverride } from "../policy.ts";
import type { WorkbenchSpace } from "../types.ts";

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
  const connection = (ctx as ClientContext & { connection: ConnectionHandle }).connection;
  const policy = resolveSessionPolicy(space.policy, explicit);
  if (policy.model !== undefined) {
    const { result } = await connection.api.llm.models({});
    if (!result.ok) throw new Error(`Unable to validate Space model route: ${result.error.message}`);
    if (!modelRouteAvailable(result.value.groups, policy.model)) {
      throw new Error(`Space model route is unavailable: ${policy.model.provider}/${policy.model.model}`);
    }
  }
  const payload = { cwd: space.rootPath, ...(policy.agentPreset === undefined ? {} : { agentPreset: policy.agentPreset }) };
  const { result: created } = await connection.api.sessions.create(payload);
  if (!created.ok) throw new Error(`session.create failed: ${created.error.code}: ${created.error.message}`);
  const sessionId = created.value.sessionId;
  const sessions = ctx.sessions as unknown as ISessions;
  const binding = await waitForBinding(sessions, sessionId);
  if (policy.model !== undefined) {
    const { result } = await connection.api.sessions.selectModel({ sessionId, ...policy.model });
    if (!result.ok) throw new Error(`session.selectModel failed: ${result.error.code}: ${result.error.message}`);
  }
  if (policy.permissionPreset !== undefined) {
    const result = await binding.session.command(`/permission ${policy.permissionPreset}`);
    if (!result.ok) throw new Error(`permission policy failed: ${result.error.message}`);
    if (!result.value.matched) throw new Error("Host does not provide the /permission command");
  }
  sessions.open(sessionId);
  return sessionId;
}
