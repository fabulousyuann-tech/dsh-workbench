# ADR 0001: DSH integration boundaries for multi-Space Workbench

- Status: accepted
- Date: 2026-08-22
- Scope: M0 compatibility and public integration seams

## Context

`dsh-workbench` owns a project-management overlay and the sidebar shell, while DSH owns Workspace registration, Session persistence, model credentials, Agent presets, permission presets, and the browser runtime. The multi-Space work needs explicit boundaries before its durable schema and creation flow are implemented.

The rc.2 compatibility workspace uses the following effective matrix:

| Surface | Observed version/source | Decision |
| --- | --- | --- |
| DSH CLI package | `@deepseek-ai/dsh 0.1.1-rc.2` | Pin the standalone launcher instead of following `latest` at startup. |
| DSH runtime/API/client components | `0.1.1-rc.2` | Compile, test, and peer against one exact host matrix. |
| Cordis | `4.0.1` | Keep exact peer/dev alignment. |
| React | `18.3.1` | Keep the existing React 18 peer range and do not bundle React. |
| Official Workspace UI | `@deepseek-ai/dsh-client-ui-workspace 0.1.1-rc.2` | Resolve it from the standalone DSH installation; never link an external source checkout into a release profile. |

“No RC mixing” for this plugin means one exact rc.2 dependency surface in development, packaging, and the target DSH profile.

## Decision

### Package and composition

- `dsh-workbench` remains one Bundle with `dsh.bundle.patch = ./cordis.patch.yml`.
- Its stable `dsh-workbench` row owns the sidebar shell. The patch disables only the stock `ui-sidebar` row.
- Official `ui-workspace` remains enabled and supplies `sidebar.workspaces` plus the new-session Workspace picker. Workbench reaches those surfaces through slots and runtime services, not source imports or patched private modules.
- Browser output remains a lazy-CJS `window.__ModuleLoader__.load(...)` factory. React, Cordis, runtime, UI primitives, and UI slots remain external to the bundle.
- DSH value/type dependencies are exact rc.2 peer + dev dependencies. Ordinary implementation libraries remain regular dependencies.
- Host settings use `installSettingsSection`; browser writes use the namespace-matched `ctx.settingsScope` scope so writes carry revision fences. The v1 workspace root remains domain overlay data until M1 migrates it into Workbench Spaces; `dataDir` is the Host technical setting exposed by the M0 card.

### Workspace and Session APIs

- DSH Workspace IDs, canonical paths, membership, order, archive state, and Session logs remain DSH-owned.
- Workbench may call the public Workspace runtime/API to list, create, rename, reorder, remove registrations, open paths, and choose directories. It does not duplicate the registry.
- `ctx.workspaces.startSession(workspaceId?)` is navigation convenience only. It cannot carry a model or permission policy.
- The public `session.create` request in rc.8 accepts `workspaceId?`, `cwd?`, `sessionId?`, and `agentPreset?`. `workspaceId` and `cwd` are mutually exclusive. The resolved Agent preset is stored in the Session header.
- The public `session.selectModel` request applies a complete `{ provider, model, reasoningEffort? }` selection to an already-created Session. Workbench policy must therefore resolve any UI route reference to this structured public selection before the first prompt.
- rc.8 exposes no permission preset field on `session.create`. The supported per-Session mutation is the public `/permission <preset>` command used by the official permission UI. The default preset remains in DSH's `permission` settings namespace.

The future M3 creation transaction will therefore use this public sequence:

1. Resolve or create the target DSH Workspace by canonical path.
2. Call `session.create({ workspaceId, agentPreset? })` with a caller-preallocated Session ID for retry safety.
3. If a Space model override exists, call `session.selectModel` for the new blank Session.
4. If a Space permission override exists, run `/permission <preset>` on that blank Session.
5. Open the Session and allow the first user prompt only after all requested policy steps succeed.

If a policy step fails, Workbench keeps the blank Session and presents a retry/change-policy recovery state. It does not silently substitute another route or preset. Existing Sessions are never rewritten when Space defaults change.

## Consequences

- M1 can build Workbench Space identity and migration without forking any DSH registry data.
- M3 needs a small client-side creation controller over public API faces; `startSession()` alone is insufficient.
- Agent preset creation is one-step, while model and permission overrides are a bounded pre-prompt sequence. UI must present that sequence as one operation.
- A model policy cannot be treated as an opaque single model string at the execution boundary; it must resolve to DSH's provider/model pair.
- Removing a Workbench Space removes only Workbench metadata and, when explicitly requested, the DSH registration. It never deletes directories or Session logs.

## Rejected alternatives

- Forking or patching official `ui-workspace`: rejected because it duplicates DSH-owned behavior and creates a local source dependency.
- Guessing extra fields on `ctx.workspaces.startSession`: rejected because the public signature only accepts `workspaceId?`.
- Applying Space defaults by changing global DSH model or permission settings: rejected because concurrent Spaces and existing Sessions would affect one another.
- Importing client values from `dsh-auxiliary-yuan`: rejected; any later integration must use a versioned Cordis service or JSON/RPC contract.
