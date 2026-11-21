# New Figma features — Implementation Plan

Features seen in the Figma screen recording (`docs/Screen Recording 2026-11-21 223438.mp4`) that the clone doesn't have yet, split into phases. Each phase is one branch from the latest `main` and one pull request, following [CONTRIBUTING.md](../CONTRIBUTING.md).

## 1. Scope

**In scope**
- Toolbar: arrow tool and arrowheads, section, slice, scale tool, text on path, code snippets, annotations, Spec documents and live code layers.
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

### Phase F5: Code snippets and annotations
Branch `features-code-specs` · about 4 days

The recording's **Code (B)** and **Spec (D)** tools turned out to be different features in Figma: a live code layer and a document on the canvas (see phase F5b). F5 builds two handoff features that are useful on their own, without the B and D shortcuts:

**1. Code snippet**
- A `CODE_SNIPPET` node type: a frame-like box with auto layout that hugs one text layer in Source Code Pro, plus `codeLanguage` and `codeTheme` fields.
- A small tokenizer colors JS/TS, CSS, HTML, JSON and Python as text ranges, in a dark or light theme. Colors are reapplied while typing and when editing ends.
- A click picks the whole snippet; double-click or Enter edits the code. Language and theme sit in the properties panel. The tool is in the toolbar and quick actions.

**2. Annotations** (like Figma's Dev Mode annotations)
- A note pinned to a layer, with optional measurements to show (width, height, fill, font and so on), read live from the layer.
- Stored as `annotations` on the target node (not as layers), and drawn by the canvas overlay with a leader line. Shift+Y shows or hides them.
- Visible in Inspect, and their notes are included in codegen comments.

---

### Phase F5b: Spec documents and code layers
Branch `features-spec-code-layers` · about 2 weeks · **bumps `SCHEMA_VERSION`**

Figma's own versions of the recording's **Spec (D)** and **Code (B)** tools ([Specs](https://help.figma.com/hc/en-us/articles/44049066011671-Guide-to-Specs-in-Figma), [code layers](https://help.figma.com/hc/en-us/articles/44193259600535-Code-layers-in-Figma-Design)), without the AI parts.

**1. Spec (D): a document on the canvas**
- A `SPEC` node type: a page-like card holding a list of blocks, stored in the node as a Yjs array so people can edit it together.
- **Blocks:** headings 1–3, paragraph, bullet and numbered lists, to-do, quote, divider, image, code (reusing the F5 tokenizer), and an embed of a frame from the file.
- **Adding blocks:** a "/" menu and Markdown shortcuts (`#`, `-`, `1.`, `[]`, `>`, three backticks, `---`). Each block's handle offers **Turn into** and drag to reorder.
- **Editing:** a DOM editor positioned over the card while it's being edited; the card is drawn on the canvas otherwise. Rendered by all three outputs, so exports and thumbnails work. **Open full-screen editor** shows the document as a page.
- Comments work on it like on any layer.
- **Out of scope:** the Figma agent, "Summarize AI", standalone Spec files and MCP editing.

**2. Code (B): a live code layer**
- A `CODE_LAYER` node type holding files (HTML, CSS, JS) and a size. B, then drag or pick a frame size.
- **Running:** a sandboxed iframe (scripts only, no network, no access to the app; the plugin system's nonce approach) positioned over the canvas, following pan and zoom. **Play** runs it; when stopped, the canvas shows a snapshot of its HTML and CSS (rendered without scripts through an SVG `foreignObject`), so exports and thumbnails have something to draw.
- **Code editor panel:** file tabs with syntax highlighting (the F5 tokenizer), **Reload code layer**, and a Browser tab.
- **Out of scope for now:** building from a prompt or a selection (needs an AI integration), GitHub or local-folder import, point and edit, and "Extract designs" (turning the running page into layers). Each could be its own phase.

---

### Phase F6: Draw mode, part 1 (brushes)
Branch `features-draw-mode` · about 5 days

Matches Figma Draw ([Draw with illustration tools](https://help.figma.com/hc/en-us/articles/31440438150935-Draw-with-illustration-tools), [Explore Figma Draw](https://help.figma.com/hc/en-us/articles/31440394517143-Explore-Figma-Draw)).

**1. Draw mode.** A **Design / Draw** toggle in the toolbar (Figma has no shortcut for it; ours is also in quick actions). In draw mode:
- The toolbar offers **Pen** (the vector pen), **Brush** and **Pencil**.
- The layers panel shows bigger previews.
- The right sidebar becomes a short set of sliders for the selected strokes.

**2. Brush and Pencil**
- Freehand strokes, smoothed (the existing Catmull-Rom fitting) and stored as vectors that remember their brush (`brush: { tool, style }`). Holding Shift draws a straight line.
- A secondary bar sets the current tool's **colour, weight and style**. Settings are kept per tool and per person. The pencil starts as Figma's round 3 px black line.
- **Ctrl+click a stroke** samples its colour, weight and style. The bar shows the hint "Ctrl+click a stroke to sample properties".

**3. Styles**
- **Pencil:** solid, dashed, dotted.
- **Brush:** Figma's two kinds. *Stretch* brushes (smooth, tapered, rough) run a shape along the stroke; *scatter* brushes (dots, dashes) repeat a mark along it.
- Scatter and dashed/dotted styles draw now, as dash patterns. Stretch shapes draw as round strokes until F7 adds width profiles.

---

### Phase F7: Draw mode, part 2 (width, vector edit actions)
Branch `features-draw-actions` · about 1–2 weeks

From Figma's [Edit vector layers](https://help.figma.com/hc/en-us/articles/360039957634) and [stroke properties](https://help.figma.com/hc/en-us/articles/360049283914) pages.

**1. Width**
- **Width profile:** presets that taper a uniform stroke.
- **Variable width:** width points along a stroke. Drag to move, Shift-click to select several, Delete to remove. Not on dashed, dynamic or branching strokes.
- **Model:** `widthProfile: Array<{ t: number; width: number }>`.
- **Rendering:** the stroke is turned into a filled outline by offsetting the flattened path by the interpolated half-width (in `pathops.ts`), in all three outputs. Bounds use the widest point.
- Stretch brush styles become width profiles.

**2. Vector edit actions** (the secondary bar in vector edit mode), each one undo step with tests on simple paths:
- **Move (V)**
- **Lasso (Q):** selects points and paths inside a freehand loop.
- **Bend:** adds curve handles to a segment, with the existing mirroring options.
- **Cut (X):** click to split a path, or drag across paths to divide them into separate layers.
- **Eraser (Shift+E):** removes what's under it, adding editable points where it cut.
- **Paint (Shift+B):** fills closed regions formed by strokes, one at a time or by dragging across several (solid or gradient).
- **Shape builder:** joins or subtracts regions of overlapping shapes.

**3. Later or optional:**
- **Dynamic stroke:** frequency, wiggle and smoothen sliders.
- **Stroke caps:** reverse triangle.
- **Custom brushes:** right-click a closed path, then **Create brush**.
- **Radial and linear repeat transforms.**

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
| F5 | Code snippets, annotations | ~4 days | **v3** (CODE_SNIPPET) |
| F5b | Spec documents, live code layers (two PRs) | ~2 weeks | **v4** (SPEC), **v5** (CODE_LAYER) |
| F6 | Draw mode and brushes | ~5 days | Optional fields |
| F7 | Width profiles and draw actions | 1–2 weeks | Optional fields |
| F8 | Text on path | ~1 week | Optional fields |
| F9 | Motion timeline | 3–4 weeks | **v6** (separate plan) |

F1–F3 can ship in any order. F5b builds on F5's tokenizer. F7 needs F6. F9 is best done last.

## 5. Desktop app

- Nothing extra is needed for menus or shortcuts, because they come from `COMMANDS`.
- After F4, F5 and F5b, the `.design` format still works unchanged, since it saves the whole Yjs state. Older desktop versions open newer files read-only because of the schema check.
- Release a new desktop version after F1–F3, after F4–F5b, and after F6–F7, following the release steps in CONTRIBUTING.md.

## 6. Testing

- **Unit tests** for every geometry piece: cap geometry, width-profile outlines, glyphs on a path, cut and erase splitting, and find and replace.
- **Renderer bounds tests** (`bounds.test.ts`) for arrowheads and width profiles.
- **Migration tests** for each `SCHEMA_VERSION` bump: an older app sees the file as read-only.
- **Manual check in the browser** for each phase, with a screenshot in the PR.
- When the Playwright suite exists, add screenshot tests for arrowheads, sections, code snippets, specs, brush strokes and text on path.
