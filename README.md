# Figma Clone

A browser-based collaborative design tool. See [PLAN.md](PLAN.md) for the full roadmap.

## Run it

```powershell
pnpm install
pnpm dev        # editor at http://localhost:5280
pnpm test       # unit tests
pnpm typecheck
```

## Layout

| Path | What it is |
|---|---|
| `packages/geometry` | Vectors, 2D matrices, rectangles, hit-testing math |
| `packages/document` | The design file: Yjs-backed node tree, edit operations, undo, scene helpers |
| `packages/renderer` | Canvas 2D renderer, text layout, SVG export |
| `apps/web` | The React editor: canvas, tools, panels, shortcuts |

## Shortcuts

| Key | Action |
|---|---|
| V / F / R / O / L / T / H | Move, Frame, Rectangle, Ellipse, Line, Text, Hand |
| Space + drag, middle mouse | Pan |
| Ctrl + wheel, pinch | Zoom |
| Shift+0 / Shift+1 / Shift+2 | Zoom to 100% / fit / selection |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| Ctrl+C / X / V / D | Copy / cut / paste / duplicate |
| Alt + drag | Duplicate while moving |
| Shift while drawing / resizing / rotating | Keep proportions / snap to 15° |
| Alt while drawing / resizing | From center |
| Ctrl+] / Ctrl+[ (add Shift for front/back) | Bring forward / send backward |
| Ctrl+Shift+H / Ctrl+Shift+L | Hide / lock |
| Arrows (Shift = 10px) | Nudge |
| Enter / Esc | Edit text or select children / select parent |
| Ctrl+G / Ctrl+Shift+G | Group / ungroup |
| Ctrl+Alt+G | Frame selection |
| Double-click | Enter a group (select the layer inside) |
| Ctrl + click / Ctrl + drag | Select the deepest layer / move without snapping |
| Alt+A / H / D | Align left / horizontal centers / right |
| Alt+W / V / S | Align top / vertical centers / bottom |
| Alt+Shift+H / V | Distribute horizontal / vertical spacing |
| Tab / Shift+Tab | Select next / previous layer |
| Shift+R | Show or hide rulers (drag from a ruler to add a guide, drop it back to remove) |
| Ctrl+/ or Ctrl+K | Command palette |
| Right-click | Context menu |
