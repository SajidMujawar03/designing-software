import type { CodeFiles, SceneNode } from './types';

/**
 * Code layers: HTML, CSS and JavaScript that run in a sandboxed frame on the
 * canvas (like Figma's code layers, without the AI agent). The page they run
 * in has no network access and can't reach the app.
 */

export const SAMPLE_CODE_FILES: CodeFiles = {
  html: `<main>
  <h1>Hello from a code layer</h1>
  <p>Press the button: this is running code.</p>
  <button id="count">Clicked 0 times</button>
</main>`,
  css: `body {
  margin: 0;
  font-family: Inter, system-ui, sans-serif;
  background: #f5f7ff;
  color: #1e1e1e;
}
main {
  padding: 32px;
}
h1 {
  margin: 0 0 8px;
  font-size: 24px;
}
button {
  margin-top: 12px;
  padding: 10px 16px;
  border: 0;
  border-radius: 8px;
  background: #0d99ff;
  color: white;
  font: inherit;
  cursor: pointer;
}`,
  js: `let clicks = 0;
const button = document.getElementById('count');
button.addEventListener('click', () => {
  clicks++;
  button.textContent = 'Clicked ' + clicks + ' time' + (clicks === 1 ? '' : 's');
});`,
};

/** The sandbox's own policy: inline code only, no network, no plugins or frames. */
export const CODE_LAYER_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'media-src data: blob:',
  'font-src data:',
  "connect-src 'none'",
].join('; ');

const NONCE_OK = /^[A-Za-z0-9+/=]+$/;

/**
 * The page a code layer runs in (an iframe `srcdoc`). `nonce` is the app
 * page's script nonce: frames built from srcdoc inherit the app's content
 * security policy, so their scripts must carry it.
 */
export function codeLayerDocument(files: CodeFiles, opts: { nonce?: string } = {}): string {
  const nonce = opts.nonce && NONCE_OK.test(opts.nonce) ? opts.nonce : '';
  const n = nonce ? ` nonce="${nonce}"` : '';
  // Scripts written in the HTML get the nonce too, so they run like the JS file.
  const html = nonce ? files.html.replace(/<script\b(?![^>]*\bnonce=)/gi, `<script${n}`) : files.html;
  const js = files.js.replace(/<\/script/gi, '<\\/script');
  const css = files.css.replace(/<\/style/gi, '<\\/style');
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CODE_LAYER_CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${css}</style>
</head><body>
${html}
<script${n}>
${js}
</script>
</body></html>`;
}

/** Changes whenever what a code layer's snapshot shows would change (its files or size). */
export function codeSnapshotKey(n: SceneNode): string {
  const f = n.codeFiles ?? { html: '', css: '', js: '' };
  const text = `${Math.round(n.width)}x${Math.round(n.height)}\n${f.html}\n${f.css}`;
  // FNV-1a: short and stable; it only has to tell versions apart.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36) + ':' + text.length.toString(36);
}
