# dsh-workbench handoff

## Current release candidate

- Current public release: `0.3.1`
- Compatibility baseline: DSH `0.1.1-rc.2`, Node.js `>=22.19.0`, pnpm `11.7.0`
- Scope: one standalone Workbench plugin; no DSH source modifications and no bundled auxiliary plugins
- Distribution: GitHub Release `.tgz` plus SHA-256; do not use the unrelated npm package with the same name
- Release tarball SHA-256: use the `.tgz.sha256` asset generated beside each GitHub Release (the compressed archive digest is build-specific)
- Built client SHA-256: `b44fc8e2aa89fe505a64d88a5bda19c22dce17159d239f634cebc9d1c75c44e9`

## Architecture boundaries

- Workbench replaces the `ui-sidebar` bundle row but keeps DSH's official Workspace, Session, model, logging, settings and conversation implementations.
- Ordinary Sessions/Workspaces and Workbench-owned Sessions are mutually exclusive in the sidebar.
- Workbench owns only its overlay and customer/project directory operations. DSH remains the source of truth for Sessions and Workspace registrations.
- Removing a Space never deletes its root directory. Customer/project deletion moves directories to `.trash`; session deletion uses DSH archive semantics.

## 0.3.0 public release changes

1. The top-level Active section aggregates waiting, running and recently completed Sessions across ordinary projects and every Workbench without changing ownership.
2. Active rows keep their original project or Workbench path, support direct navigation and participate in sidebar search by title or owner path.
3. State comes from DSH native `pendingInteraction`, `running` and `completed` projections; no second task state or transcript store is introduced.
4. Motion uses distinct waiting/running/completed indicators and respects reduced-motion preferences.
5. Release verification passes typecheck, 82 tests and all Host, Client and Typert bundles.

## 0.3.1 public release changes

1. Workbench project rows now keep only a New Project Chat button and a More menu, freeing title width in the dense sidebar.
2. Customer and project rows no longer reserve a separate disclosure arrow. Clicking the directory row toggles its descendants, while clicking a concrete Session remains the only way to open history.
3. Project overview, conversation map and project deletion moved into the official DSH Menu primitive with portal positioning, so the menu is not clipped by the animated Workbench tree or sidebar scroller.
4. Customer rows use the same New Chat and More layout. New Chat starts a blank customer-directory Session; rename and safe deletion live in the official Menu.
5. The current Session's customer and project ancestors auto-expand, open/closed folder icons expose state, and an explicit user toggle can still collapse either level.
6. Actions are visually quiet until hover/focus, remain visible on touch devices and keep native semantic tokens in light and dark themes.
7. Verification passes typecheck, 82 tests, all bundles and the production dependency audit. The local release tarball SHA-256 is `2605fe149b66cf15e32a37237ae571ea167b018b463c7228e1c211b01cde498f`; its isolated profile installs as 0.3.1, preserves official `ui-workspace`, disables only `ui-sidebar`, serves HTTP 200 and matches the built Host/Client checksums.
8. Real 3080 QA confirmed zero customer/project disclosure-arrow elements, 24px New/More actions at 0.42 idle and 1.0 hover opacity, both official portaled menus, concrete Session navigation, ancestor auto-expansion and manual collapse/restore with no console exceptions. The normal profile package-manager update remains blocked by unrelated minimum-release-age entries; no policy was relaxed. The served profile already uses checksum-identical 0.3.1 Host/Client files for QA, while its dependency lock still reports 0.3.0 until a clean official update succeeds.

## 0.2.0 acceptance candidate changes

1. Each Workbench project row now exposes a conversation-map action. It opens in DSH's root `shell.overlay`, preserving the single Workbench sidebar and leaving official conversation/session ownership intact.
2. M1 maps only current, non-archived DSH Sessions whose Workspace/cwd resolves to the selected project. User-created fork children remain visible and are linked by `parentId`; subagents and sessions owned by other projects are excluded.
3. M2 lazily reads a bounded DSH history page for the selected card and projects human prompts, assistant previews and a tool-step count. It never persists tool arguments/results or a second transcript database.
4. M3 forks at the selected completed turn through DSH native `sessions.fork({ sessionId, atSeq, increaseTitle: true })`; the child inherits cwd/Workspace membership from DSH and opens immediately.
5. M4 archives through DSH `workspaces.archiveSession`, reacts to live Session/Workspace baselines, prunes stale node positions and keeps only finite, capped local layout metadata. Layout identity survives root-path relocation and migrates across an unambiguous customer move.
6. The map supports card drag, canvas pan/zoom, fit, Escape/close, responsive inspector mode, light/dark semantic tokens, empty/loading/error states and a 40-message bounded history posture.
7. `tests/project-map.test.ts` covers ownership, lineage, archived/subagent exclusion, old-root rebasing, stable layout, turn folding, payload non-retention and native DSH API contracts.
8. Final candidate verification: `pnpm check` passes 80 tests plus typecheck and all bundles; `pnpm audit --prod` reports no known vulnerabilities. The local tarball SHA-256 is `26c52e2db741facc78b22d116b8e73a037a9b5adb10396130ac6771b30d12db1` and the client SHA-256 is `9f91de9d966530fba04a4b04e9d75f9f0b118af8ac11d631aa38103ce8defdea`.
9. A fresh isolated DSH home installed the exact tarball, kept official `ui-workspace`, disabled only official `ui-sidebar`, started successfully and served a checksum-identical client with no browser warnings/errors. The real web profile is installed and restarted on port 3080 at `0.2.0`; visual QA passed the project-map empty state, light theme, sidebar alignment, 279px expanded → 56px collapsed resize and zero console warnings/errors.

## 0.1.3 public release changes

- The empty Recent Chats placeholder is removed. Unowned DSH Sessions appear only when present, under a collapsed “Unclassified chats” recovery section with a count.
- Search matches expand the recovery section automatically; ordinary project and Workbench ownership rules remain mutually exclusive.
- Each unclassified Session can be moved into an existing ordinary project through the public `ctx.workspaces.insertSessionBefore(...)` API. This updates DSH's durable Workspace membership without moving files or rewriting Session logs.

## 0.1.2 public release changes

- Workbench now publishes the `sidebar.settings.trailing` root list slot for compact, optional plugin actions next to DSH Settings.
- Expanded mode keeps trailing actions on the same row; collapsed mode stacks them immediately above Settings.
- An empty slot is layout-neutral, and consumers remain optional so Workbench has no dependency on any restart or utility plugin.

## 0.1.1 public release changes

- The shared `sidebar.footer.action` host no longer scrolls or clips its descendants. Footer plugins keep natural flow height while popovers can overlay the independently scrolling library region.
- The compatibility fix is generic in expanded and collapsed modes; it contains no selectors for a specific billing plugin.

## 0.1.0 public release changes

- Overlay metadata is customer-scoped (`spaceId + customerId + projectId`). Legacy keys remain readable and migrate when edited.
- Same-name projects inside one Space now require `customerId`; ambiguous operations fail instead of choosing the first project.
- Search loads the complete catalog for ownership calculation and filters locally, so a session cannot jump to the Workbench root while searching.
- Session owner map and React list identity use full folder paths rather than folder names.
- Repeated project deletion receives a collision-safe `.trash` suffix.
- The model delete tool requires `confirmed=true` after explicit user confirmation.
- Public repository ignores local artifacts, sibling plugins and private QA/handoff material; CI checks, release automation and public docs were added.

## Verification completed before tagging

1. `pnpm check`: typecheck, 75 tests and all three bundles pass, including unclassified-session ownership and move-action contracts.
2. `pnpm audit --prod`: no known vulnerabilities.
3. Tarball inspection: no local paths, user data, credentials, sibling plugin source or source maps.
4. Fresh isolated install, `--dump-config`, server startup and served-client checksum pass.
5. Migration from the previous internal build to the public `0.1.0` runtime passes in isolation.
6. A fresh isolated DSH profile installed the exact `0.1.3` tarball, loaded the Host/client bundles, returned the web shell, and matched the built client checksum. Browser QA verified that an empty unclassified section consumes zero space and reported no console errors or warnings.

Published: GitHub Release `v0.1.3` completed successfully. The published `dsh-workbench-0.1.3.tgz` SHA-256 is `0e24b8c3c165ed4dccdc596e82d901a7e5fa8b411146da0199d53eed87e75550`; its downloaded checksum file and embedded package version were verified. The locally built macOS tarball SHA-256 is `730f0fcc8e5e7784ebf9790bb80f781b61fd9cf42b51e19b802e1d19963a12d8`; compressed archive digests may differ across builders, so users must use the checksum asset beside the downloaded GitHub package.

## Working tree policy

The repository may contain user-owned uncommitted work. Preserve it, do not reset or delete unrelated files, and use focused patches. Internal local notes remain ignored and should not be uploaded to GitHub.
