import type { BrowserWindow } from 'electron';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Y from 'yjs';
import { decodeDesignFile } from '../../../web/src/desktop/designFile';
import { dialogs, openPath } from './files';
import { linkDialogs, openLink, parseLink } from './links';
import { buildMenu, menuLabels } from './menus';
import { settings } from './settings';
import { createWindow, findWindow, setOpenExternal } from './windows';

/** The names of the layers stored in a .design file (read straight from disk). */
function layersInFile(path: string): string[] {
  const bytes = readFileSync(path);
  const { state } = decodeDesignFile(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return [...doc.getMap<Y.Map<unknown>>('nodes').values()].map((n) => n.get('name')).filter((n): n is string => typeof n === 'string');
}

/**
 * A scripted run of the app (pnpm --filter @figma/desktop smoke): opens the
 * start screen and the editor, checks the bridge and the security rules,
 * and saves screenshots and a results.json to `out`. Exits 0 when all pass.
 */

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loaded(win: BrowserWindow): Promise<void> {
  return new Promise((resolve) => {
    if (!win.webContents.isLoading()) return resolve();
    win.webContents.once('did-finish-load', () => resolve());
  });
}

export async function runSmokeTest(opts: { offlineUrl: (path?: string) => string; out: string }): Promise<number> {
  mkdirSync(opts.out, { recursive: true });
  const external: string[] = [];
  setOpenExternal((url) => void external.push(url));
  const refused: string[] = [];
  const consoleLog: string[] = [];
  const results: Record<string, unknown> = {};
  const checks: Array<[string, boolean]> = [];
  const check = (name: string, ok: boolean) => checks.push([name, ok]);

  const win = createWindow('offline', opts.offlineUrl('/'));
  win.webContents.on('console-message', (e) => {
    const msg = (e as unknown as { message?: string }).message ?? '';
    consoleLog.push(msg.slice(0, 300));
    if (/Refused to|Content Security Policy/i.test(msg)) refused.push(msg.slice(0, 300));
  });
  // Scripts and screenshots go to the window being tested (the first one, then the reopened file window).
  let page: BrowserWindow = win;
  const js = <T>(code: string) => page.webContents.executeJavaScript(code, true) as Promise<T>;
  const shot = async (name: string) => {
    try {
      writeFileSync(join(opts.out, `${name}.png`), (await page.webContents.capturePage()).toPNG());
    } catch (e) {
      console.warn(`[smoke] no screenshot for ${name}: ${e}`);
    }
  };

  try {
    await loaded(win);
    await wait(2500);
    const home = await js<{ bridge: string; role: string; home: boolean; title: string; settings: unknown }>(
      `(async () => ({ bridge: typeof window.desktop, role: window.desktop?.role, home: !!document.querySelector('.desktop-home'), title: document.title, settings: await window.desktop?.getSettings() }))()`,
    );
    results.home = home;
    check('bridge is exposed', home.bridge === 'object');
    check('window is offline', home.role === 'offline');
    check('start screen shows', home.home);
    await shot('1-start');

    // Pages have no Node.js.
    const node = await js<{ require: string; process: string }>(`({ require: typeof require, process: typeof process })`);
    results.node = node;
    check('no require in the page', node.require === 'undefined');
    check('no process in the page', node.process === 'undefined');

    // The editor, on a file kept in the app.
    await js(`location.assign('/local')`);
    await wait(500);
    await loaded(win);
    await wait(4000);
    const editor = await js<{ ready: boolean; canvas: boolean; added: number }>(`(() => {
      const e = window.editor;
      if (!e || !e.ui.ready) return { ready: false, canvas: false, added: 0 };
      const before = e.doc.children(e.pageId).length;
      e.doc.change(() => e.doc.createNode({ type: 'RECTANGLE', name: 'Smoke box', parentId: e.pageId, x: 100, y: 100, width: 240, height: 160,
        fills: [{ type: 'SOLID', color: { r: 0.05, g: 0.6, b: 1 }, opacity: 1, visible: true }], cornerRadius: 16 }));
      e.doc.change(() => e.doc.createNode({ type: 'LINE', name: 'Smoke line', parentId: e.pageId, x: 100, y: 320, width: 240, height: 0,
        strokes: [{ type: 'SOLID', color: { r: 0.9, g: 0.2, b: 0.2 }, opacity: 1, visible: true }], strokeWeight: 4 }));
      e.zoomToRect({ x: 40, y: 40, width: 360, height: 340 });
      return { ready: true, canvas: !!document.querySelector('canvas'), added: e.doc.children(e.pageId).length - before };
    })()`);
    results.editor = editor;
    check('editor opens', editor.ready && editor.canvas);
    check('layers can be added', editor.added === 2);
    await wait(800);
    await shot('2-editor');

    // Leaving the app's origin is blocked; web links go to the browser instead.
    await js(`location.href = 'https://example.com/elsewhere'`);
    await wait(800);
    const stayed = win.webContents.getURL();
    check('navigation away is blocked', stayed.startsWith(opts.offlineUrl('/').replace(/\/$/, '')));
    await js(`window.open('https://example.com/popup', '_blank')`);
    await wait(300);
    results.external = external;
    check('outside links go to the browser', external.includes('https://example.com/elsewhere') && external.includes('https://example.com/popup'));

    // Plugins still run under the page's security policy (their scripts carry its nonce).
    const plugin = await js<boolean>(`(async () => {
      document.querySelector('button[aria-label="Plugins"]').click();
      await new Promise(r => setTimeout(r, 300));
      const row = [...document.querySelectorAll('.plugin-row')].find(r => r.innerText.includes('Make a grid'));
      const t0 = performance.now();
      const marks = {};
      new MutationObserver(() => { if (!marks.frame && document.querySelector('iframe[data-run-id]')) marks.frame = Math.round(performance.now() - t0); }).observe(document.body, { childList: true, subtree: true });
      window.addEventListener('message', (e) => { if (e.data && e.data.__designPlugin && !marks.firstCall) marks.firstCall = Math.round(performance.now() - t0) + ' ' + e.data.method; });
      window.__pluginMarks = marks;
      row.querySelector('button.primary').click();
      for (let i = 0; i < 120 && !document.querySelector('.plugin-window:not(.hidden-run)'); i++) await new Promise(r => setTimeout(r, 50));
      window.__pluginMs = Math.round(performance.now() - t0);
      return !!document.querySelector('.plugin-window:not(.hidden-run)');
    })()`);
    results.pluginMs = await js('window.__pluginMs');
    results.pluginMarks = await js('window.__pluginMarks');
    check('plugins run', plugin);
    if (!plugin) {
      results.pluginDebug = {
        frames: await js(`document.querySelectorAll('iframe[data-run-id]').length`),
        console: consoleLog.slice(-15),
      };
    }
    await shot('3-plugin');

    // A bridge call that only the start screen may make, from the editor page: allowed (same window role), so check the bad-address error instead.
    const badServer = await js<string>(`window.desktop.connectServer('http://example.com').then(() => 'accepted', (e) => e.message)`);
    results.badServer = badServer;
    check('plain http servers are refused', /https/.test(badServer));

    // ---- Files on disk (dialogs answered with paths in the output folder)
    const filesDir = join(opts.out, 'files');
    rmSync(filesDir, { recursive: true, force: true });
    mkdirSync(filesDir, { recursive: true });
    const designPath = join(filesDir, 'Smoke design.design');
    dialogs.save = async () => designPath;
    dialogs.open = async () => designPath;
    await js(`location.assign('/')`);
    await wait(300);
    await loaded(win);
    await wait(1500);
    await js(`window.desktop.newFile()`);
    await wait(400);
    await loaded(win);
    await wait(3500);
    const disk = await js<{ path: string; ready: boolean; status: string; title: string }>(`({ path: location.pathname, ready: !!window.editor?.ui.ready, status: document.querySelector('.sync-status')?.textContent?.trim() ?? '', title: document.title })`);
    results.disk = disk;
    check('new file opens in the editor', disk.path === '/disk' && disk.ready);
    check('new file is on disk', existsSync(designPath));
    await js(`(() => { const e = window.editor; e.doc.change(() => e.doc.createNode({ type: 'RECTANGLE', name: 'Disk box', parentId: e.pageId, x: 0, y: 0, width: 120, height: 80, fills: [{ type: 'SOLID', color: { r: 0.08, g: 0.68, b: 0.36 }, opacity: 1, visible: true }] })); e.zoomToRect({ x: -40, y: -40, width: 200, height: 160 }); })()`);
    await wait(2500);
    check('changes are saved automatically', layersInFile(designPath).includes('Disk box'));
    const status = await js<string>(`document.querySelector('.sync-status')?.textContent?.trim() ?? ''`);
    results.diskStatus = status;
    check('the title shows it saved', status === 'Saved');
    await shot('5-disk');
    const recent = await js<Array<{ path: string }>>(`window.desktop.recentFiles()`);
    check('the file is in recent files', recent.some((r) => r.path === designPath));

    // Rename it in its folder.
    const renamed = await js<{ path: string; name: string }>(`window.desktop.file.rename('Renamed design')`);
    const renamedPath = join(filesDir, 'Renamed design.design');
    check('rename moves the file', renamed.path === renamedPath && existsSync(renamedPath) && !existsSync(designPath));

    // An edit right before closing is saved by the close.
    await js(`(() => { const e = window.editor; e.doc.change(() => e.doc.createNode({ type: 'ELLIPSE', name: 'Last second', parentId: e.pageId, x: 160, y: 0, width: 60, height: 60 })); })()`);
    await new Promise<void>((resolve) => {
      win.once('closed', () => resolve());
      win.close();
    });
    check('closing saves the last change', layersInFile(renamedPath).includes('Last second'));

    // Reopen it in a new window.
    const reopened = openPath(renamedPath);
    if (reopened) {
      await loaded(reopened);
      await wait(3000);
      const names = await reopened.webContents.executeJavaScript(`(() => { const e = window.editor; return e?.ui.ready ? e.doc.children(e.pageId).map(n => n.name) : []; })()`, true);
      results.reopened = names;
      check('the file reopens with its layers', names.includes('Disk box') && names.includes('Last second'));
      page = reopened;
      await shot('6-reopened');
      // Present mode opens a window that reads the same file (read-only). It needs a frame to play.
      await js(`(() => { const e = window.editor; e.doc.change(() => e.doc.createNode({ type: 'FRAME', name: 'Screen', parentId: e.pageId, x: 0, y: 200, width: 320, height: 200, fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1, visible: true }] })); })()`);
      await wait(1500);
      const opened = new Promise<BrowserWindow>((resolve) => reopened.webContents.once('did-create-window', (child) => resolve(child)));
      await js(`void window.open('/disk/present?page=' + window.editor.pageId, '_blank')`);
      const presenter = await Promise.race([opened, wait(5000).then(() => null)]);
      if (presenter) {
        await loaded(presenter);
        await wait(2500);
        const p = await presenter.webContents.executeJavaScript(`({ present: !!document.querySelector('.present'), error: document.querySelector('.loading.error-page, .pv-error')?.textContent ?? null })`, true);
        results.present = p;
        const writeBlocked = await presenter.webContents.executeJavaScript(`window.desktop.file.write(new Uint8Array([1])).then(() => 'written', (e) => e.message)`, true);
        check('present mode plays the file', p.present && !p.error);
        check('present windows cannot write the file', /read-only/.test(String(writeBlocked)));
        presenter.close();
      } else check('present mode plays the file', false);

      // ---- Native menus: the editor's commands, kept in step with the selection.
      await js(`window.editor.select([])`);
      await wait(600);
      const before = menuLabels(reopened);
      results.menus = before.map((m) => m.label);
      const find = (labels: typeof before, menu: string, item: string) => labels.find((m) => m.label === menu)?.items.find((i) => i.startsWith(item));
      check('editor menus are in the menu bar', ['File', 'Edit', 'Object', 'Arrange', 'Plugins', 'View', 'Help'].every((l) => results.menus && (results.menus as string[]).includes(l)));
      check('file menu has the disk commands', !!find(before, 'File', 'Save As') && !!find(before, 'File', 'Upload to Cloud'));
      check('items follow the selection (off with nothing selected)', find(before, 'Object', 'Group selection') === 'Group selection (off)');
      // Click Edit > Select all in the real menu.
      const edit = buildMenu(reopened).items.find((m) => m.label === 'Edit');
      const selectAll = edit?.submenu?.items.find((i) => i.label === 'Select all');
      selectAll?.click(undefined, reopened, undefined as never);
      await wait(800);
      const selected = await js<number>(`window.editor.ui.selection.length`);
      check('menu clicks run editor commands', selected >= 2);
      const after = menuLabels(reopened);
      check('items follow the selection (on once selected)', find(after, 'Object', 'Group selection') === 'Group selection');
      check('open recent lists the file', !!find(after, 'File', 'Open Recent') && settings().recent.includes(renamedPath));
      const recentItems = buildMenu(reopened).items.find((m) => m.label === 'File')?.submenu?.items.find((i) => i.label === 'Open Recent')?.submenu?.items.map((i) => i.label) ?? [];
      check('open recent shows the file name', recentItems.includes('Renamed design'));
    } else check('the file reopens with its layers', false);

    // A missing file gives a reason instead of an empty window.
    let missing = '';
    try {
      openPath(join(filesDir, 'Nope.design'));
    } catch (e) {
      missing = String(e instanceof Error ? e.message : e);
    }
    results.missing = missing;
    check('missing files are explained', /moved or deleted/.test(missing));

    // With SMOKE_SERVER set (e.g. http://localhost:5281), connect and check the cloud window.
    const server = process.env.SMOKE_SERVER;
    if (server) {
      const connected = await js<string>(`window.desktop.connectServer(${JSON.stringify(server)}).then(() => 'ok', (e) => e.message)`);
      results.connect = connected;
      check('connects to the server', connected === 'ok');
      const cloud = findWindow('cloud');
      check('cloud window opens', !!cloud);
      if (cloud) {
        await loaded(cloud);
        await wait(2500);
        const page = await cloud.webContents.executeJavaScript(`({ role: window.desktop?.role, signIn: !!document.querySelector('.auth-card'), path: location.pathname })`, true);
        results.cloud = page;
        check('cloud window shows the server', page.role === 'cloud' && (page.signIn || page.path !== ''));
        writeFileSync(join(opts.out, '4-cloud.png'), (await cloud.webContents.capturePage()).toPNG());
        const blocked = await cloud.webContents.executeJavaScript(`window.desktop.connectServer('https://example.com').then(() => 'accepted', (e) => e.message)`, true);
        check('cloud pages cannot change the server', /Not allowed/.test(String(blocked)));

        // Upload the disk file: sign in on the server with a throwaway test account first.
        const signup = await cloud.webContents.executeJavaScript(`(async () => {
          const pw = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
          const r = await fetch('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Smoke test', email: 'smoke-' + Date.now() + '@example.test', password: pw }) });
          return r.status;
        })()`, true);
        results.signup = signup;
        // The file menu's "Upload to cloud", in the disk window.
        const clicked = await js<boolean>(`(async () => {
          document.querySelector('.file-name').click();
          await new Promise(r => setTimeout(r, 200));
          const item = [...document.querySelectorAll('.file-menu-pop [role=menuitem]')].find(b => b.textContent.includes('Upload to cloud'));
          if (!item) return false;
          item.click();
          return true;
        })()`);
        // Notifications disappear after a few seconds: watch for it while the upload runs.
        const toast = await js<string>(`(async () => {
          for (let i = 0; i < 60; i++) {
            const t = [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ');
            if (t) return t;
            await new Promise(r => setTimeout(r, 100));
          }
          return '';
        })()`);
        await wait(1500);
        const cloudUrl = cloud.webContents.getURL();
        results.upload = { clicked, cloudUrl, toast };
        check('upload to cloud opens the new cloud file', clicked && /\/file\/[\w-]+/.test(cloudUrl) && /Uploaded/.test(toast));
        const fileId = /\/file\/([\w-]+)/.exec(cloudUrl)?.[1];

        // ---- design-clone:// links
        const bad = ['design-clone://file/a%20b', 'design-clone://delete/x', 'https://example.com/file/x', 'design-clone://file/x?server=http://example.com'];
        results.badLinks = bad.map((l) => [l, parseLink(l)]);
        check('malformed links are refused', bad.every((l) => parseLink(l) === null));
        let asked = '';
        linkDialogs.confirmServer = async (s) => ((asked = s), false);
        linkDialogs.error = () => {};
        const other = await openLink('design-clone://file/abc?server=https://other.example', { file: () => {}, server: () => {} });
        check('links to another server ask first (declined: nothing opens)', !other && asked === 'https://other.example' && settings().serverUrl === new URL(server).origin);
        if (fileId) {
          await cloud.loadURL(`${new URL(server).origin}/`);
          await wait(1000);
          const opened = await openLink(`design-clone://file/${fileId}`, { file: (id) => void cloud.loadURL(`${new URL(server).origin}/file/${id}`), server: () => {} });
          await wait(1500);
          check('a link opens the cloud file', opened && cloud.webContents.getURL().endsWith(`/file/${fileId}`));
        }
        if (fileId) await cloud.webContents.executeJavaScript(`fetch('/api/files/${fileId}?forever=1', { method: 'DELETE' }).then(r => r.status)`, true);
      }
    }
  } catch (e) {
    results.error = String(e instanceof Error ? e.stack : e);
    check('ran without errors', false);
  }
  results.refused = refused;
  check('no content security policy violations', refused.length === 0);
  results.checks = Object.fromEntries(checks);
  writeFileSync(join(opts.out, 'results.json'), JSON.stringify(results, null, 2));
  const failed = checks.filter(([, ok]) => !ok).map(([n]) => n);
  console.log(failed.length ? `[smoke] FAILED: ${failed.join(', ')}` : `[smoke] all ${checks.length} checks passed`, `(${opts.out})`);
  return failed.length ? 1 : 0;
}
