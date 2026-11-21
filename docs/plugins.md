# Writing plugins

A plugin is a piece of JavaScript that runs in a sandboxed frame and changes the
file through the `design` API. It can show its own small panel, react to the
selection, and create, read, change or delete layers.

Open **Plugins** (the puzzle button in the toolbar, or "Plugins…" in the command
palette) to run one, write one, or add one from a URL or a file.

## A first plugin

```js
// Every call returns a promise.
const sel = await design.getSelection();
for (const n of sel) await design.updateNode(n.id, { opacity: 0.5 });
await design.notify('Halved the opacity of ' + sel.length + ' layers.');
await design.close();
```

Your code runs inside an `async` function, so `await` and `return` work at the
top level. A plugin keeps running until it calls `design.close()` or the user
stops it. A plugin without a panel shows a small "Running… Stop" chip.

## Sharing a plugin

A plugin is described by a manifest, a JSON file:

```json
{
  "id": "acme.tidy",
  "name": "Tidy up",
  "description": "Rounds positions and sizes to whole pixels.",
  "main": "code.js",
  "allowedDomains": ["api.acme.com"]
}
```

- `id`: letters, numbers, `.`, `_` and `-`. Adding a plugin with the same id
  replaces it. Ids starting with `builtin.` are reserved.
- `code` holds the code inline, or `main` points to a file next to the manifest
  (when added from a URL).
- `allowedDomains`: hosts the plugin may `fetch` from, over HTTPS. Without it the
  plugin has no network access at all.

Added plugins are kept in the browser they were added in.

## The sandbox

Plugins run in an iframe with `sandbox="allow-scripts"` and no
`allow-same-origin`, so they get an opaque origin: they can't read the app's
cookies, storage or session, call the server as the user, or reach the page
around them. A content security policy blocks every network request except to
`allowedDomains`, and loading outside scripts, styles or images (data: and blob:
images are fine). Plugins only reach the file through the API below, and every
call is checked by the app before it changes anything. On a view-only file,
calls that change it fail.

## API

Layers are plain JSON objects with the same properties the app uses: `id`,
`type`, `name`, `parentId`, `x`, `y`, `width`, `height`, `rotation`, `opacity`,
`visible`, `locked`, `fills`, `strokes`, `effects`, `cornerRadius`, and for text
`characters`, `fontFamily`, `fontSize` and so on. Colors are `{ r, g, b }` from 0
to 1. A fill looks like
`{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1, visible: true }`.

### Reading

| Call | Returns |
| --- | --- |
| `currentPage()` | `{ id, name }` |
| `pages()` | `[{ id, name }]` |
| `getSelection()` | the selected layers |
| `getNode(id)` | a layer, or `null` |
| `children(id?)` | the layers directly in a layer (or the current page) |
| `find({ type?, name?, within? })` | layers on the current page (or under `within`); `name` matches part of the name, ignoring case. At most 5,000. |
| `getStyles()` | the file's styles |
| `getVariables()` | the file's variables |

### Changing

| Call | Does |
| --- | --- |
| `createNode(props)` | creates a layer and returns its id. `type` is one of `FRAME`, `SECTION`, `SLICE`, `RECTANGLE`, `ELLIPSE`, `POLYGON`, `STAR`, `LINE`, `TEXT`, `VECTOR`; `parentId` defaults to the current page (a section must go on a page or in another section). |
| `createNodes([props, …])` | creates up to 5,000 layers as one undo step; returns their ids |
| `updateNode(id, props)` | changes a layer and returns it |
| `updateNodes([[id, props], …])` | changes many layers as one undo step |
| `moveNode(id, parentId, aboveId?)` | moves a layer into a page, frame or group |
| `deleteNodes(ids)` | deletes layers; returns how many |

`id`, `type`, `parentId`, `index` and component links can't be set through
`createNode` or `updateNode` (use `moveNode` to move a layer). Every change is
undoable from the app like any other edit, and is shared live with
collaborators.

### Editor

| Call | Does |
| --- | --- |
| `setSelection(ids)` | selects layers on the current page |
| `zoomToNodes(ids)` | zooms the canvas to the layers |
| `notify(message, { error? })` | shows a short message |
| `exportNode(id, { format?: 'PNG' \| 'SVG', scale? })` | a PNG as a data URL, or SVG text |

### Panel

| Call | Does |
| --- | --- |
| `showUI(html, { width?, height? })` | puts your HTML in the plugin's panel and shows it |
| `resize(width, height)` | resizes the panel |
| `close()` | stops the plugin |

Scripts inside the HTML you give `showUI` don't run; wire up the panel from your
plugin code, which runs in the same page:

```js
await design.showUI('<button id="go" class="primary">Go</button>', { width: 200, height: 80 });
document.getElementById('go').onclick = async () => { /* … */ };
```

The panel comes with basic styles for `button`, `button.primary`, `input`,
`select` and `label`, and follows the app's light or dark theme.

### Events

```js
design.on('selectionchange', (ids) => { … });
design.on('documentchange', () => { … }); // after edits pause
design.on('pagechange', (pageId) => { … });
design.off('selectionchange', handler);
```

## Errors

Calls that fail reject their promise with an `Error` whose message says why.
Uncaught errors in a plugin are shown to the user.

## Examples

The built-in plugins in `apps/web/src/plugins/examples.ts` are small, complete
examples: renaming layers with a pattern, filling text, making a grid of shapes
and a live selection-stats panel.
