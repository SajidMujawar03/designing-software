import type { PluginManifest } from './api';

/** Plugins that come with the app: useful on their own, and examples of the API. */
export const BUILTIN_PLUGINS: PluginManifest[] = [
  {
    id: 'builtin.rename',
    name: 'Rename layers',
    description: 'Rename the selected layers with a pattern: "Item $n" numbers them.',
    builtin: true,
    code: `
const sel = await design.getSelection();
if (!sel.length) { await design.notify('Select some layers to rename.'); await design.close(); return; }
await design.showUI(\`
  <label>New name (<b>$n</b> = number, <b>$name</b> = current name)
    <input id="pattern" value="Item $n" style="width:100%;margin-top:4px">
  </label>
  <label>Start at <input id="start" type="number" value="1" style="width:70px"></label>
  <div style="display:flex;gap:8px;justify-content:flex-end">
    <button id="cancel">Cancel</button><button id="go" class="primary">Rename \${sel.length}</button>
  </div>\`, { width: 280, height: 170 });
document.getElementById('cancel').onclick = () => design.close();
document.getElementById('go').onclick = async () => {
  const pattern = document.getElementById('pattern').value;
  const start = Number(document.getElementById('start').value) || 1;
  // Top to bottom on the canvas, then left to right.
  const ordered = [...sel].sort((a, b) => a.y - b.y || a.x - b.x);
  await design.updateNodes(ordered.map((n, i) => [n.id, { name: pattern.replaceAll('$n', String(start + i)).replaceAll('$name', n.name) }]));
  await design.notify('Renamed ' + ordered.length + ' layers.');
  await design.close();
};`,
  },
  {
    id: 'builtin.lorem',
    name: 'Fill text with placeholder copy',
    description: 'Replaces the text of the selected text layers with placeholder sentences.',
    builtin: true,
    code: `
const words = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat'.split(' ');
const sentence = (n) => { const w = Array.from({ length: n }, () => words[Math.floor(Math.random() * words.length)]); w[0] = w[0][0].toUpperCase() + w[0].slice(1); return w.join(' ') + '.'; };
const texts = (await design.getSelection()).filter((n) => n.type === 'TEXT');
if (!texts.length) await design.notify('Select text layers first.');
else {
  await design.updateNodes(texts.map((t) => [t.id, { characters: sentence(4 + Math.floor(Math.random() * 8)) }]));
  await design.notify('Filled ' + texts.length + ' text layer' + (texts.length === 1 ? '' : 's') + '.');
}
await design.close();`,
  },
  {
    id: 'builtin.grid',
    name: 'Make a grid of copies',
    description: 'Creates rows and columns of rectangles or circles: a quick way to lay out placeholders.',
    builtin: true,
    code: `
await design.showUI(\`
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
    <label>Columns <input id="cols" type="number" value="4" style="width:100%"></label>
    <label>Rows <input id="rows" type="number" value="3" style="width:100%"></label>
    <label>Size <input id="size" type="number" value="80" style="width:100%"></label>
    <label>Gap <input id="gap" type="number" value="16" style="width:100%"></label>
  </div>
  <label>Shape <select id="shape" style="width:100%"><option value="RECTANGLE">Rectangles</option><option value="ELLIPSE">Circles</option></select></label>
  <div style="display:flex;gap:8px;justify-content:flex-end"><button id="cancel">Cancel</button><button id="go" class="primary">Create</button></div>\`, { width: 260, height: 230 });
document.getElementById('cancel').onclick = () => design.close();
document.getElementById('go').onclick = async () => {
  const v = (id) => Math.max(1, Number(document.getElementById(id).value) || 1);
  const cols = Math.min(50, v('cols')), rows = Math.min(50, v('rows')), size = v('size'), gap = Number(document.getElementById('gap').value) || 0;
  const type = document.getElementById('shape').value;
  const sel = await design.getSelection();
  const ox = sel[0] ? sel[0].x + sel[0].width + 40 : 0, oy = sel[0] ? sel[0].y : 0;
  const colors = [[0.05,0.6,1],[0.08,0.68,0.36],[0.95,0.28,0.13],[1,0.8,0.16],[0.59,0.28,1]];
  const list = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const [R, G, B] = colors[(r * cols + c) % colors.length];
    list.push({ type, name: type === 'ELLIPSE' ? 'Circle' : 'Box', x: ox + c * (size + gap), y: oy + r * (size + gap), width: size, height: size, cornerRadius: type === 'RECTANGLE' ? 8 : 0,
      fills: [{ type: 'SOLID', color: { r: R, g: G, b: B }, opacity: 1, visible: true }] });
  }
  const ids = await design.createNodes(list);
  await design.setSelection(ids);
  await design.zoomToNodes(ids);
  await design.close();
};`,
  },
  {
    id: 'builtin.stats',
    name: 'Selection stats',
    description: 'A live panel counting layers by type in the selection (shows events in action).',
    builtin: true,
    code: `
await design.showUI('<div id="out">Loading…</div>', { width: 220, height: 180 });
const render = async () => {
  const sel = await design.getSelection();
  const all = [];
  for (const n of sel) { all.push(n); all.push(...await design.find({ within: n.id })); }
  const counts = {};
  for (const n of all) counts[n.type] = (counts[n.type] || 0) + 1;
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([t, c]) => '<tr><td>' + t.toLowerCase() + '</td><td style="text-align:right">' + c + '</td></tr>').join('');
  document.getElementById('out').innerHTML = sel.length
    ? '<b>' + all.length + ' layers</b> in the selection<table style="width:100%;margin-top:8px">' + rows + '</table>'
    : 'Select layers to count them.';
};
design.on('selectionchange', render);
design.on('documentchange', render);
render();`,
  },
];
