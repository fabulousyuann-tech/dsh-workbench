# dsh-workbench handoff

## Current release candidate

- Public version: `0.1.3`
- Compatibility baseline: DSH `0.1.1-rc.2`, Node.js `>=22.19.0`, pnpm `11.7.0`
- Scope: one standalone Workbench plugin; no DSH source modifications and no bundled auxiliary plugins
- Distribution: GitHub Release `.tgz` plus SHA-256; do not use the unrelated npm package with the same name
- Release tarball SHA-256: use the `.tgz.sha256` asset generated beside each GitHub Release (the compressed archive digest is build-specific)
- Built client SHA-256: `28b28502c4df9ec605afedb6d315dbfe46f1fa92a27947bcbee3840b437fa696`

## Architecture boundaries

- Workbench replaces the `ui-sidebar` bundle row but keeps DSH's official Workspace, Session, model, logging, settings and conversation implementations.
- Ordinary Sessions/Workspaces and Workbench-owned Sessions are mutually exclusive in the sidebar.
- Workbench owns only its overlay and customer/project directory operations. DSH remains the source of truth for Sessions and Workspace registrations.
- Removing a Space never deletes its root directory. Customer/project deletion moves directories to `.trash`; session deletion uses DSH archive semantics.

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

Remaining release action: commit and tag `v0.1.3`; GitHub Actions will create the `.tgz` and checksum release files. Local release tarball SHA-256: `730f0fcc8e5e7784ebf9790bb80f781b61fd9cf42b51e19b802e1d19963a12d8`.

## Working tree policy

The repository may contain user-owned uncommitted work. Preserve it, do not reset or delete unrelated files, and use focused patches. Internal local notes remain ignored and should not be uploaded to GitHub.
