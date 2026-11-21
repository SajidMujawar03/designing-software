import type { BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWindow, findWindow, setOpenExternal } from './windows';

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
  const js = <T>(code: string) => win.webContents.executeJavaScript(code, true) as Promise<T>;
  const shot = async (name: string) => {
    try {
      writeFileSync(join(opts.out, `${name}.png`), (await win.webContents.capturePage()).toPNG());
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
