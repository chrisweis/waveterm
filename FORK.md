# Personal Fork Notes

This is a personal fork of [wavetermdev/waveterm](https://github.com/wavetermdev/waveterm) at [github.com/chrisweis/waveterm](https://github.com/chrisweis/waveterm). It tracks upstream and layers on a small set of personal customizations.

> **If you are a future Claude session**: this file is the authoritative description of the fork layout and update workflow. Read it before suggesting changes to branches, remotes, or the CI workflow.

---

## What's customized

- **Folders-first directory preview** — `frontend/app/view/preview/preview-directory.tsx` sorts directories above files in the directory preview pane (the `..` parent row stays pinned at the top).
- **Pinned workspaces** — workspaces can be pinned so they sort to the top of the workspace switcher. A thumbtack toggle appears on each row (always visible when pinned, hover-only otherwise). Pin state is a `Pinned` bool on the `Workspace` Go struct; `wcore.ListWorkspaces` stable-sorts pinned-first; the `workspace.SetWorkspacePinned` service RPC persists it. The switcher dropdown also resets its scroll to the top on each open (via a callback ref on the `OverlayScrollbarsComponent`) so the pinned items are shown first. Touches `pkg/waveobj/wtype.go`, `pkg/wcore/workspace.go`, `pkg/service/workspaceservice/workspaceservice.go`, `frontend/app/tab/workspaceswitcher.{tsx,scss}`, plus regenerated `frontend/types/gotypes.d.ts` and `frontend/app/store/services.ts` (via `task generate`).

That's it. If you add more, document them here.

## Branch + remote layout

| Branch | What it holds | What to do with it |
|---|---|---|
| `main` | Tracks `upstream/main` exactly — no local commits | Never commit here. Used only as the rebase base. |
| `folders-first` | Your customization commits on top of `main` (the sort change, `.github/workflows/fork-build.yml`, this file, plus anything you add later) | Rebase onto `main` each time you pull upstream. Push to the fork to trigger a build. |

Remotes:

- `origin` → `https://github.com/chrisweis/waveterm.git` (personal fork, single source of truth for the `folders-first` branch)
- `upstream` → `https://github.com/wavetermdev/waveterm.git` (Wave project, read-only)

## The update cycle (run when you want the latest Wave)

Run this on **one machine at a time** — parallel rebases on both PC and Mac will diverge history.

```bash
# 1. refresh main against upstream
git checkout main
git fetch upstream
git merge --ff-only upstream/main
git push origin main

# 2. replay the customization on top of the new main
git checkout folders-first
git rebase main
git push --force-with-lease origin folders-first

# 3. wait for CI (see next section)
```

The `--force-with-lease` on step 2 is needed because rebasing rewrites `folders-first`'s history. It's the safe variant — it refuses the push if the other machine pushed something you haven't seen yet.

### Syncing the second machine afterwards

```bash
git fetch origin
git checkout main          && git reset --hard origin/main
git checkout folders-first && git reset --hard origin/folders-first
```

## Getting a new installer (the actual payoff)

Every push to `folders-first` runs the [Fork Build workflow](.github/workflows/fork-build.yml) on GitHub Actions, which produces unsigned Windows + macOS installers in the cloud — no local build tooling needed on either machine.

1. Go to https://github.com/chrisweis/waveterm/actions
2. Click the latest "Fork Build" run
3. Scroll to the **Artifacts** section at the bottom of the run page
4. Download `wave-windows` (contains `.exe`, `.msi`, `.zip`) or `wave-darwin` (contains `.dmg`, `.zip`)
5. Install

**First-run warnings are expected** because the builds are unsigned:

- **Windows**: SmartScreen says "Windows protected your PC" → click "More info" → "Run anyway"
- **macOS**: Gatekeeper refuses to open the app → right-click the app in Finder → "Open" (only needed the first time), or from Terminal: `xattr -d com.apple.quarantine /Applications/Wave.app`

Artifacts are retained for 30 days. First build is ~15–25 minutes cold; subsequent builds are ~8–12 minutes with caches warm.

## Adding another customization

1. On `folders-first`, make your code change.
2. `git commit` (add a new commit rather than amending, so it's easy to read later).
3. `git push origin folders-first` triggers a build.
4. Document what changed in the "What's customized" section above.

If upstream later touches the same lines, `git rebase main` will surface the conflict — resolve and continue.

## First-time setup on a new machine

```bash
git clone https://github.com/chrisweis/waveterm.git
cd waveterm
git remote add upstream https://github.com/wavetermdev/waveterm.git
git fetch upstream
git checkout folders-first
```

If the machine is only used to *install* Wave (not to build locally), you're done — downloads come from the Actions tab. No Node / Go / Task / Zig needed.

If you also want to build locally, see upstream's `BUILD.md` for the toolchain (Node 22, Go 1.25+, Task, Zig on non-Mac). On Windows, tools installed via winget aren't added to PATH automatically — see `.claude-build-env.ps1` (gitignored) for a helper that prepends them.

## Gotchas

- **Never use `task package` to build an installer** (CI or local). Its deps `[clean, npm:install, build:backend, build:tsunamiscaffold]` run in **parallel**, so `clean` (`rm -rf dist`) can race with / clobber `build:backend`'s output. The result is an installer with **no `wavesrv` binary** — the app launches (visible in Task Manager / Activity Monitor) but never shows a window, and Wave's `waveapp.log` shows `error running wavesrv ... ENOENT`. This bricked a local Windows install (2026-06-25). Build **sequentially** instead — see below. The Fork Build CI workflow was switched off `task package` for this reason and now verifies `wavesrv` is present before packaging.
- **Sequential build (the safe replacement for `task package`):** from the repo root, run `task build:backend`, then confirm `dist/bin/wavesrv.*` exists, then `task build:tsunamiscaffold`, `npm run build:prod` (re-confirm `dist/bin/wavesrv.*` survived), and finally `npm exec electron-builder -- -c electron-builder.config.cjs -p never`. A good Windows installer is ~165 MB; a backend-less broken one is ~130 MB. On Windows, `source .claude-build-env.ps1` first for PATH. On macOS no Zig is needed (native CGO builds both arm64 + amd64; requires Xcode Command Line Tools).
- **Unsigned binaries** — expected; see first-run section above. Signing requires a paid DigiCert cert (Windows) or Apple Developer account (macOS).
- **Don't commit to `main` on the fork** — it should mirror upstream exactly. All local work lives on `folders-first` or additional branches.
- **`package-lock.json` noise** — `npm install` will regenerate entries for optional native deps (`sharp`, `@emnapi/*`, `@img/*`) that upstream has removed. Don't commit these regenerated entries; they'll just re-appear and create rebase churn. If you see lockfile diff after a build, `git checkout -- package-lock.json` or stash it.
- **Only one machine updates at a time** — see the force-with-lease note above.
- **CI won't fire on `main`** — `fork-build.yml` only triggers on push to `folders-first` or manual dispatch. That's intentional; `main` should match upstream exactly, so there's no point building it.

## Manual build trigger

If you want to rebuild without changing code (e.g., re-running after a flaky failure):

1. Go to https://github.com/chrisweis/waveterm/actions/workflows/fork-build.yml
2. Click **Run workflow** → pick `folders-first` → **Run workflow**

## Related files

- [`.github/workflows/fork-build.yml`](.github/workflows/fork-build.yml) — the CI workflow that produces installers
- `.claude-build-env.ps1` (gitignored, Windows only) — helper that sets PATH for local builds
