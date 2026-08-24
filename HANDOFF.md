# dsh-workbench handoff

## Current release candidate

- Public version: `0.1.0`
- Compatibility baseline: DSH `0.1.1-rc.2`, Node.js `>=22.19.0`, pnpm `11.7.0`
- Scope: one standalone Workbench plugin; no DSH source modifications and no bundled auxiliary plugins
- Distribution: GitHub Release `.tgz` plus SHA-256; do not use the unrelated npm package with the same name
- Release tarball SHA-256: `84a70e7fc00999e9270bca4dd7695334b6ae14345353d457f36d37078d426771`
- Built client SHA-256: `5bdb64f9c6929012ff4ec4c35b76d137128741a5a7271350cc57d6f5d64c58d4`

## Architecture boundaries

- Workbench replaces the `ui-sidebar` bundle row but keeps DSH's official Workspace, Session, model, logging, settings and conversation implementations.
- Ordinary Sessions/Workspaces and Workbench-owned Sessions are mutually exclusive in the sidebar.
- Workbench owns only its overlay and customer/project directory operations. DSH remains the source of truth for Sessions and Workspace registrations.
- Removing a Space never deletes its root directory. Customer/project deletion moves directories to `.trash`; session deletion uses DSH archive semantics.

## 0.1.0 public release changes

- Overlay metadata is customer-scoped (`spaceId + customerId + projectId`). Legacy keys remain readable and migrate when edited.
- Same-name projects inside one Space now require `customerId`; ambiguous operations fail instead of choosing the first project.
- Search loads the complete catalog for ownership calculation and filters locally, so a session cannot jump to the Workbench root while searching.
- Session owner map and React list identity use full folder paths rather than folder names.
- Repeated project deletion receives a collision-safe `.trash` suffix.
- The model delete tool requires `confirmed=true` after explicit user confirmation.
- Public repository ignores local artifacts, sibling plugins and private QA/handoff material; CI checks, release automation and public docs were added.

## Verification completed before tagging

1. `pnpm check`: typecheck, 73 tests and all three bundles pass.
2. `pnpm audit --prod`: no known vulnerabilities.
3. Tarball inspection: no local paths, user data, credentials, sibling plugin source or source maps.
4. Fresh isolated install, `--dump-config`, server startup and served-client checksum pass.
5. Migration from the previous internal build to the public `0.1.0` runtime passes in isolation.
6. The internal real-profile build passed UI smoke; relocated historical session ownership and search hierarchy remain correct, with no console errors or warnings. The exact public `0.1.0` package is verified in a fresh isolated profile.

Remaining release action: commit the prepared tree and tag `v0.1.0`; GitHub Actions will create the `.tgz` and checksum release files.

## Working tree policy

The repository may contain user-owned uncommitted work. Preserve it, do not reset or delete unrelated files, and use focused patches. Internal local notes remain ignored and should not be uploaded to GitHub.
