# New Figma features — Implementation Plan

Features seen in the Figma screen recording (`docs/Screen Recording 2026-11-21 223438.mp4`) that the clone doesn't have yet, split into phases. Each phase is one branch from the latest `main` and one pull request, following [CONTRIBUTING.md](../CONTRIBUTING.md).

## 1. Scope

**In scope**
- Toolbar: arrow tool and arrowheads, section, slice, scale tool, text on path, code block, spec annotations.
- Quick actions: tabs, find and replace, view toggles (pixel grid, minimize/hide UI, multiplayer cursors, nudge amount).
- Panels: layer thumbnails, the page's "Show in exports".
- Draw mode: brush strokes, copying a stroke's style, variable width profiles, and the Lasso, Bend, Cut, Erase and Paint actions.
- Motion: a keyframe timeline (outline only here; it gets its own detailed plan).

**Out of scope**
- **Agents/MCP editing of the canvas.** A project of its own.
- **Widgets** (interactive objects on the canvas). They would build on the plugin system, but they're too big for this plan.

**Already built** (no work needed): the move, hand, frame (with presets), shape, line, pen, pencil and text tools, placing images, comments, the quick actions palette, rulers, export with preview, stroke position/join/dash, corner radius, alignment, handle mirroring, variables, assets, prototype and plugins.

## 2. Rules that apply to every phase

- **Document model.** New node types and fields go in `packages/document/src/types.ts`, with defaults in `defaults.ts`. New *optional* fields don't need a migration. A new **node type** does: bump `SCHEMA_VERSION` in `migrations.ts` and add a no-op migration, so older apps open newer files read-only instead of silently dropping layers.
- **Rendering.** Every visual change goes into all three outputs: `packages/renderer/src/canvaskit.ts` (the main renderer), `canvas2d.ts` (the fallback) and `svg.ts` (export). `renderBounds` must include anything drawn outside the node's box (the invisible-line bug came from missing this).
- **Commands.** New actions are added to `apps/web/src/editor/commands.ts`. That puts them in the quick actions palette and the desktop app's native menus (`apps/web/src/desktop/menu.ts`) with no extra work. Shortcuts go in `editor/shortcuts.ts`.
- **Tools.** New `ToolId`s go in `editor/store.ts`, their classes in `editor/tools/`, registered in `tools/index.ts` and shown in `panels/Toolbar.tsx`.
- **Other outputs.** Update CSS/codegen (`inspect/codegen.ts`) and the plugin API (`plugins/api.ts`) when a node type or field is added, so plugins and Inspect can see it.
- **Multiplayer.** Everything goes through the Yjs document, so it syncs automatically. Per-user view settings (pixel snap, hidden UI, nudge amount) live in `localStorage`, never in the document.
- **Done means:** unit tests pass (`pnpm test`), types check, the feature has been tried in the browser, the desktop smoke test still passes, then the PR is opened.

## 3. Phases

### Phase F1: Quick wins
Branch `features-quick-wins` · about 2–3 days

**1. Arrowheads on line and vector ends**
- Model: add `startCap` / `endCap` to LINE and open VECTOR paths, with the values `NONE | ROUND | SQUARE | LINE_ARROW | TRIANGLE_ARROW | CIRCLE | DIAMOND`. The existing `strokeCap` stays as the default for both ends.
- Renderer: a shared `capGeometry(end, direction, strokeWeight)` in `packages/renderer` builds the arrowhead path. It is drawn after the stroke in canvaskit and canvas2d, and as a `<path>` (or marker) in SVG. `renderBounds` grows by the arrowhead size.
- UI: an "End points" row in the stroke section of `PropertiesPanel.tsx` (start, swap, end), like the one in the video.
- Tests: cap geometry, bounds including arrowheads, SVG output.

**2. Arrow tool (Shift+L)**
- A `LineTool` variant that creates a LINE with `endCap: 'LINE_ARROW'`. It goes in the shape menu next to Line.

**3. View settings in quick actions**
- A small `prefs` store (`editor/prefs.ts`, saved to `localStorage`) holding `snapToPixel`, `showCursors`, `nudge` and `bigNudge`.
- **Snap to pixel grid (Ctrl+Shift+'):** `snapPx` in `tools/types.ts` and the transform code use it only when it's on.
- **Multiplayer cursors (Ctrl+Alt+\\):** `presenceOverlay.ts` skips drawing cursors when it's off. Presence is still sent.
- **Minimize UI (Ctrl+Shift+\\)** collapses the side panels to icon strips. **Show/Hide UI (Ctrl+\\)** hides all panels and the toolbar, leaving only the canvas.
- **Nudge amount…:** a small dialog for the arrow-key distances (default 1 px, and 10 px with Shift). `editor.nudge` reads them.
- These show as checkbox rows under a "Common settings" heading in the palette, as in the video.

**4. Page "Show in exports"**
- Model: a `exportBackground` field on PAGE. When it's on, exporting a top-level frame or a selection paints the page colour behind it (`editor/export.ts`).
- UI: a checkbox under the page colour in the properties panel when nothing is selected.

**5. Lock and hide buttons in the layer list**
- Check that they show on hover for every row as in the video, and fix it if they don't.

---

### Phase F2: Quick actions tabs and find and replace
Branch `features-find-replace` · about 3 days

**1. Palette tabs.** "All", "Assets" and "Plugins & widgets" tabs in `CommandPalette` (`panels/Menus.tsx`). Assets lists components and styles from `libraryStore`, and choosing one inserts or applies it. Plugins lists installed and example plugins with their descriptions, and choosing one runs it.

**2. Find and replace (Ctrl+F)**
- A floating panel with search and replace fields, and options for match case, whole word, and current page vs all pages.
- Searches TEXT node characters, plus layer names when a toggle is on. Results are listed, and clicking one selects it and zooms to it.
- "Replace" and "Replace all" edit the text in one Yjs transaction (one undo step). The runs' styles are kept by replacing within runs (`packages/document/src/text.ts`).
- Tests: matching, replacing across styled runs, undo in one step.

---

### Phase F3: Layer thumbnails
Branch `features-layer-thumbnails` · about 2 days

- A 24 px preview next to each layer in `LayersPanel.tsx`, rendered with the existing export path at a small scale into a shared offscreen canvas.
- A cache keyed by node id and its last-change counter, filled lazily for visible rows only (the list is virtualized) and throttled while editing, so big files stay fast.
- A toggle in the layers panel menu ("Show thumbnails").
- Check performance against `load.perf.test.ts` with the large test file.

---

### Phase F4: Section, slice and scale tools
Branch `features-section-slice-scale` · about 4–5 days · **bumps `SCHEMA_VERSION` to 2**

**1. Section (Shift+S)**
- A new `SECTION` node type: a top-level container with a name label drawn inside its top-left corner, a fill, and no clipping or auto layout.
- Frames dropped into a section become its children, and dragging the section moves them.
- Inside the Frame tool menu (Frame / Section / Slice), as in the video.

**2. Slice (S)**
- A new `SLICE` node type: an invisible rectangle with export settings. It is drawn only as a dashed outline while selected, and it's skipped by the renderer, hit testing and the "select all" command.
- Export renders everything under its rectangle (`editor/export.ts`). It is included in "Export all".

**3. Scale tool (K)**
- Resizing with the scale tool multiplies stroke weights, effect radii, corner radii, font sizes and line heights by the same factor, for the node and its children.
- It's a mode of the select tool (`tools/select.ts`) plus a menu entry. Tests cover how each property scales.

The migration from version 1 to 2 changes nothing in existing files. Its job is to stop older apps from editing files that contain sections or slices.

---

### Phase F5: Code block and spec annotations
Branch `features-code-specs` · about 4 days

**1. Code block (B)**
- A new `CODE_BLOCK` node type with `code`, `language` and theme fields.
- Rendered as a rounded box with monospaced, syntax-highlighted text. A small tokenizer handles JS/TS, CSS, HTML, JSON and Python. The text goes through the existing text layout, using a bundled monospace font.
- Double-click to edit it in place (a textarea over the canvas). A language picker sits in the properties panel.

**2. Spec / annotation (D)**
- An annotation pinned to a layer: a label, a note, and optional properties to show (width, height, fill, font and so on), read live from the layer.
- Stored as `annotations` on the target node (not as layers), and drawn by the canvas overlay with a leader line. A toggle shows or hides them.
- Visible in Inspect mode, and their notes are included in codegen comments.

---

### Phase F6: Draw mode, part 1 (brushes)
Branch `features-draw-mode` · about 5 days

**1. Draw mode.** A toolbar mode (a toggle at the end of the toolbar) that swaps the tools for Pen, Marker and Pencil, as in the video. The properties panel title changes to "Draw".

**2. Brush strokes**
- An extension of the existing `PencilTool`. The stroke is smoothed (Catmull-Rom to Bézier, already used on release) and stored as a VECTOR with `strokeWeight`, round caps and joins.
- A floating brush bar while drawing: colour, size slider and brush style (round, flat, tapered).
- **Ctrl+click a stroke to copy its style:** it picks up the stroke's colour, width and style, and the hint banner "Ctrl+click a stroke to sample properties" is shown.

**3. Brush styles** are stored as a `brush` field on the vector and rendered as a variable-width outline in phase F7. Until then, they're plain strokes.

---

### Phase F7: Draw mode, part 2 (width profiles and actions)
Branch `features-draw-actions` · about 1–2 weeks

**1. Variable width profile**
- Model: `widthProfile: Array<{ t: number; width: number }>` along the path (t from 0 to 1).
- Renderer: the stroke is turned into a filled outline by offsetting the flattened path by the interpolated half-width on each side (in `pathops.ts`), rendered in all three outputs. Bounds use the widest point.
- UI: a preset picker (uniform, taper start, taper end, taper both, bulge) in the stroke section. Dragging width points on the canvas comes later.
- Tests: outline geometry, bounds, SVG.

**2. Draw-mode actions** (the bar shown in the video)
- **Move:** drag selected strokes.
- **Lasso:** select strokes by drawing a freehand loop; hit testing uses path–polygon intersection.
- **Bend:** drag a point on a stroke to bend it smoothly; nearby points move with a falloff.
- **Cut:** split a stroke where a drawn line crosses it, using the path intersection helpers from boolean ops.
- **Erase:** remove the parts of strokes under the eraser; each stroke is split into the pieces that are left.
- **Paint:** fill a closed area formed by strokes. It uses the PathKit union and boolean ops on the strokes' outlines and takes the region under the click.
- Each action is one undo step and has tests on simple paths.

---

### Phase F8: Text on path
Branch `features-text-on-path` · about 1 week

- Model: a `path` field on TEXT nodes (a reference to a vector or shape id, or its own copy of the path), plus `pathOffset` and `pathSide`.
- Layout: lay the text out on a single line, then place each glyph along the path by arc length, rotated to the tangent (`packages/renderer/src/textlayout.ts`). It is drawn glyph by glyph in canvaskit and canvas2d, and as `<textPath>` in SVG.
- Tool: "Text on path" in the Text menu. Clicking a shape's outline starts typing along it.
- Editing: the caret and selection follow the path. Hit testing maps a click to the nearest glyph.
- Tests: glyph placement on a line, a circle and a curve.

---

### Phase F9: Motion timeline (outline; gets its own plan)
About 3–4 weeks

- **Mode:** a "Motion" mode (beta) with a timeline panel under the canvas: play/pause, a time counter, a seconds ruler, one track per animated layer, and zoom.
- **Model:** `animations` per node, holding keyframes on properties (position, size, rotation, opacity, fills, corner radius) with easing. Uses the existing easing curves from the prototype's smart animate.
- **Playback:** interpolates properties at time t and renders without changing the document. Scrubbing updates the canvas live.
- **Export:** MP4 or GIF (WebCodecs in the browser, Electron in the desktop app), and Lottie JSON later.
- **Prototype:** the presenter can play a frame's timeline when the frame opens.

Before starting, write `docs/motion-plan.md` with the data model, the playback loop, and how keyframes interact with auto layout and components.

## 4. Order and estimates

| Phase | What | Size | Schema change |
|---|---|---|---|
| F1 | Arrowheads, arrow tool, view settings, page export background | 2–3 days | Optional fields |
| F2 | Palette tabs, find and replace | ~3 days | None |
| F3 | Layer thumbnails | ~2 days | None |
| F4 | Section, slice, scale tool | 4–5 days | **v2** (new node types) |
| F5 | Code block, spec annotations | ~4 days | **v3** (CODE_BLOCK) |
| F6 | Draw mode and brushes | ~5 days | Optional fields |
| F7 | Width profiles and draw actions | 1–2 weeks | Optional fields |
| F8 | Text on path | ~1 week | Optional fields |
| F9 | Motion timeline | 3–4 weeks | **v4** (separate plan) |

F1–F3 can ship in any order. F7 needs F6. F9 is best done last.

## 5. Desktop app

- Nothing extra is needed for menus or shortcuts, because they come from `COMMANDS`.
- After F4 and F5, the `.design` format still works unchanged, since it saves the whole Yjs state. Older desktop versions open newer files read-only because of the schema check.
- Release a new desktop version after F1–F3, after F4–F5, and after F6–F7, following the release steps in CONTRIBUTING.md.

## 6. Testing

- **Unit tests** for every geometry piece: cap geometry, width-profile outlines, glyphs on a path, cut and erase splitting, and find and replace.
- **Renderer bounds tests** (`bounds.test.ts`) for arrowheads and width profiles.
- **Migration tests** for each `SCHEMA_VERSION` bump: an older app sees the file as read-only.
- **Manual check in the browser** for each phase, with a screenshot in the PR.
- When the Playwright suite exists, add screenshot tests for arrowheads, sections, code blocks, brush strokes and text on path.
