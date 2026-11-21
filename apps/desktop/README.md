# Design Clone desktop

The desktop app (Electron). Two kinds of window:

- **Offline windows** show the web app bundled with the desktop app, served
  from `app://bundle/`. They open with a start screen: files kept in the app,
  plus a field to connect to your server.
- **Cloud windows** show your server's own pages, at the address saved on the
  start screen. Sign-in, live editing, comments and history work exactly as in
  a browser, and every web deploy updates them.

Every window runs with context isolation and a sandbox, and pages have no
Node.js access. A window can only navigate within its own origin; a cloud
window may also visit Google's sign-in page. Links anywhere else open in the
default browser. The preload script exposes only the small `window.desktop`
bridge (`apps/web/src/desktop/api.ts`), and the main process accepts calls
only from the top frame of its own windows.

## Commands

From the repository root:

```powershell
pnpm --filter @figma/web build
```

```powershell
pnpm --filter @figma/desktop start
```

The first command builds the web app the desktop app bundles; the second runs
the desktop app with it.

```powershell
pnpm dev:desktop
```

This runs against the web dev server (`pnpm dev`) instead, for live reloading.

```powershell
pnpm --filter @figma/desktop smoke
```

This drives the app through the start screen, the editor, the security rules
and a plugin, and saves screenshots and a `results.json` (to `SMOKE_OUT`, or a
temporary folder). It exits with 1 if a check fails.

## Plan

1. **App shell** (done): windows, the `app://` protocol, security rules,
   settings, the start screen, cloud windows.
2. **Files on disk:** `.design` files with open, save, autosave and recovery.
3. **Native menus** built from the editor's commands, `design://` links, file
   associations.
4. **Windows installers,** plus crash reporting and a release workflow.
5. **Auto-update, macOS and Linux.**
