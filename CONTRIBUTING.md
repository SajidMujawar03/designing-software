# Branches, pull requests and releases

These rules keep `main` complete and releases matching their code. Most of
them come from mistakes that already happened once.

## Branches

- Start every piece of work from the **latest `main`**:
  ```powershell
  git checkout main
  ```
  ```powershell
  git pull
  ```
  ```powershell
  git checkout -b <branch-name>
  ```
- Use one branch per piece of work (a phase, a desktop milestone, a fix), and
  name it after what it is: `desktop-updates`, `fix-invisible-lines`.
- Don't commit straight to `main`. Everything reaches it through a pull
  request.

## Pull requests

- Open the pull request **into `main`**. It should show only that branch's
  own commits.
- Merge with **Create a merge commit**, not squash or rebase. The branches
  build on each other, and squashing or rebasing gives the same work new
  commits, so later pull requests would repeat it and conflict.
- Wait for CI (typecheck, tests, build) to pass before merging.
- After merging, delete the branch on GitHub (the button on the pull request).

### Stacked pull requests

Sometimes work starts before the work it depends on is merged. Then its pull
request is **stacked**: its base is the other branch, not `main`, so it shows
only its own commits.

1. Merge the **lower** pull request (the one into `main`) first.
2. Then point the upper pull request at `main` before merging it. If you
   deleted the lower branch when merging, GitHub does this automatically.
   Otherwise, click **Edit** next to the pull request's title and change the
   base to `main`.
3. Only then merge the upper one.

If the upper one gets merged while its base is still the other branch, its
work lands in that branch, not in `main`. To fix that, open a pull request
from that branch into `main`.

## Releasing the desktop app

A release is built from a **tag**. The tag must point at a commit on `main`
that already has the new version.

1. **Bump the version** in `apps/desktop/package.json` (for example `0.2.0`)
   inside the pull request that ships the changes.
2. **Merge that pull request** into `main`.
3. **Update your `main`:**
   ```powershell
   git checkout main
   ```
   ```powershell
   git pull
   ```
   Check that the version is the new one:
   ```powershell
   Select-String '"version"' apps/desktop/package.json
   ```
4. **Tag and push the tag.** The tag is `desktop-v` plus the version, exactly:
   ```powershell
   git tag desktop-v0.2.0
   ```
   ```powershell
   git push origin desktop-v0.2.0
   ```
5. Watch **Actions › Desktop release**. It builds Windows, macOS and Linux,
   smoke-tests each, and publishes the GitHub Release with the installers and
   update files.

Always in this order: **merge, pull, check the version, tag.** If you tag
before merging, the tag lands on the old code. The workflow then stops at
"Check the tag matches the app version", and nothing is published.

### Fixing a wrong tag

**If the release workflow failed and nothing was published** (no GitHub
Release for that tag), delete the tag, fix what was wrong, and tag again:

```powershell
git push origin --delete desktop-v0.2.0
```

```powershell
git tag -d desktop-v0.2.0
```

**If a release was published**, never move, reuse or delete its tag.
Installed apps may already have updated to it. Fix the problem in a new pull
request, bump the version again (for example `0.2.1`), and release that.

### Trying builds without releasing

Run **Actions › Desktop release › Run workflow** on your branch. It builds and
smoke-tests all three platforms without publishing anything, because only
tags publish. Do this before merging changes to packaging or the workflow.

## Before opening a pull request

- `pnpm typecheck` and `pnpm test` pass.
- For changes to the desktop app, also run
  `pnpm --filter @figma/desktop smoke`, after `pnpm --filter @figma/web build`.
