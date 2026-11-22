# Figma UI alignment — Implementation Plan

Fixes for the gaps and naming or placement mismatches in [ui-comparison.md](ui-comparison.md), split into phases. Each phase is one branch from the latest `main` and one pull request, following [CONTRIBUTING.md](../CONTRIBUTING.md). They go smallest and most visible first, so the early phases can ship on their own even if the later layout work waits.

## 1. Scope

**In scope**
- Names: tools, panel sections, commands and shortcuts that differ from Figma's current editor (UI3).
- Toolbar: Figma's seven tool slots, the Actions button, and later the bottom floating toolbar with the mode switcher.
- Right panel: Position / Layout / Appearance sections, Selection colors, Styles, Page.
- Menus: a main menu (logo button) built from the commands, plus the missing commands Figma has there (flip, rotate, tidy up, copy/paste properties, select matching layers, outlines, pixel preview…).
- Motion: a Transform section with keyframe buttons next to the fields, and "Add motion" in the context menu.
- Left navigation rail (File, Assets, Variables).

**Out of scope**
- **Figma's AI features** (Agents, Prototype with Agent, the AI prompts in Actions, Build this with code).
- **Widgets, Publish library, branches.** Plan-level features, not UI alignment.
- **Dev Mode as a paid, separate mode.** We keep the Inspect tab. Phase U7 adds the Dev Mode pieces worth having (Ready for dev, Compare changes, Measurement).
- **Audio in Motion.** A feature of its own; it needs audio export.

## 2. Rules that apply to every phase

- **Names.** A label is fixed in one place and used everywhere: tool labels in `panels/Toolbar.tsx` (`T`), command labels in `editor/commands.ts` (`COMMANDS`), and section titles in each panel's `<Section title>`. The onboarding tour (`panels/Onboarding.tsx`), the keyboard shortcuts sheet, the desktop menus (`desktop/menu.ts`) and the docs in `docs/` repeat some of them, so search for the old name before closing a rename.
- **Tests and selectors.** Unit and smoke tests (`apps/desktop` smoke test, any Playwright checks) find elements by `aria-label` and text. Update them in the same PR as the rename.
- **Shortcuts.** Changes go in `editor/shortcuts.ts` and the command's `shortcut` text. Where Figma's shortcut is new for us, keep the old one working as an alias for one release, so nobody's muscle memory breaks. Check `docs/` and the shortcut sheet for clashes (Shift+G, Shift+M and Ctrl+0 below).
- **No document changes** unless a phase says so. This plan is almost all UI; only U7's Ready for dev status adds a node field (optional, so no migration).
- **Commands first.** Every new action is a `Command` in `editor/commands.ts`. That puts it in quick actions, the desktop menus and the new main menu at once.
- **Done means:** unit tests pass (`pnpm test`), types check, the change has been tried in the browser at `/local` and on a cloud file, the desktop smoke test still passes, `ui-comparison.md` rows are updated to **Same**, then the PR is opened.

## 3. Phases

### Phase U1: Names and shortcuts
Branch `ui-names` · about 1 day

Renames only; no layout changes.

**1. Tool names** (`panels/Toolbar.tsx`, `T`)
- `textPath`: "Text on a path" → **Text on path**.
- `hand`: "Hand" → **Hand tool**.
- `annotate`: "Annotate" → **Annotation**, shortcut **Shift+T** (new key in `shortcuts.ts`; check nothing else uses it).
- `polygon`: drop the **Shift+G** shortcut (Figma's Polygon has none); Shift+G becomes Layout guides in this phase.

**2. Right-panel section names**
- `PropertiesPanel.tsx:218` "Layer" → **Appearance**.
- `LayoutPanels.tsx:386` "Layout grid" → **Layout guide** (and the "Remove grid" title → "Remove layout guide").
- `PropertiesPanel.tsx:623` "Background" → **Page** (the section shown with nothing selected), and drop the separate "Page 1 · Page" header line there.
- `Styles.tsx:178` "Local styles" → **Styles**, with the groups named Text styles, Color styles, Effect styles, Layout guide styles.

**3. Command names** (`editor/commands.ts`)
| Ours | Figma |
| --- | --- |
| Show UI (`hide-ui`) | Show/Hide UI |
| Show rulers | Rulers |
| Show/Hide layout grids (`layout-grids`) | Layout guides |
| Show annotations | Annotations |
| Ungroup | Ungroup selection |
| Show/Hide, Lock/Unlock | Show/Hide selection, Lock/Unlock selection |
| Reset all changes (`reset-instance`) | Reset instance |
| Annotate a layer | Annotation |
| Place image… | Image/video… (images only for now; video in a later phase) |

**4. Shortcuts**
- **Zoom to 100%: Ctrl+0.** Both already work (`shortcuts.ts:132` and `:151`); only the shown shortcut changes, in the `zoom-100` command and the zoom menu. Shift+0 stays.
- **Layout guides: Shift+G** (was Ctrl+Shift+4; keep it as an alias).
- Figma's newer shortcuts as aliases, shown in menus: Ungroup **Ctrl+Backspace**, Flatten **Alt+Shift+F**, Bring to front **]**, Send to back **[**. The old ones keep working.

**5. Zoom menu** (`Toolbar.tsx`, `ZoomMenu`)
- Add **Zoom to 50%** and **Zoom to 200%**, in Figma's order: Zoom in, Zoom out, Zoom to fit, Zoom to 50%, Zoom to 100%, Zoom to 200%. Then a divider and the view toggles that exist (Pixel grid/Snap to pixel grid, Layout guides, Rulers, Multiplayer cursors, Comments on cloud files).

Tests: the rename sweep (grep old names under `apps/` and `docs/`), shortcut tests for Ctrl+0, Shift+G, Shift+T.

---

### Phase U2: Toolbar slots and menus
Branch `ui-toolbar-slots` · about 1–2 days

**1. Figma's seven slots** (`TOOLS` in `Toolbar.tsx`)
```
Move tools      Move (V), Hand tool (H), Scale (K)
Region tools    Frame (F), Section (Shift+S), Slice (S)
Shape tools     Rectangle (R), Line (L), Arrow (Shift+L), Ellipse (O), Polygon, Star, Image/video… (Ctrl+Shift+K)
Creation tools  Pen (P), Pencil (Shift+P)
Type tools      Text (T), Text on path
Code tools      Code (B), Spec (D), Code snippet, Annotation (Shift+T)  (the last two are ours; kept here by choice)
Comment (C)     cloud files only
Actions         (U3)
```
- `ToolSlot` gets a `name` for its menu header and caret label ("Shape tools"), shown at the top of the menu as in Figma.
- A slot entry can be a **command** instead of a tool: Image/video… runs `place-image`. Give `ToolDef` an optional `run`.
- The separate Hand button goes away (H still works).
- "Code snippet" and "Annotation" stay in the Code tools menu next to Code and Spec (decided in U4; U2 had moved them to quick actions). They are also in Actions.

**2. Draw mode toolbar** (`DRAW_TOOLS`)
- Move tools, **Pen / Brush / Pencil**, then Region, Shape, Type and Code slots, Comment, Actions, as in Figma Draw.


Tests: toolbar unit test for slot contents and the remembered last tool per slot; check the tour still points at the right buttons.

---

### Phase U3: Actions and the main menu
Branch `ui-main-menu` · about 2–3 days

**1. Actions**
- Rename the palette to **Actions** (title, `aria-label`, tour text). Ctrl+K opens it; keep Ctrl+/ as an alias.
- An **Actions** button (grid icon) at the end of the toolbar opens it.
- Move the debug commands (Renderer: use Canvas 2D, Create a 10,000-layer test page) behind a `?debug` flag or a Developer submenu.

**2. Main menu** (new `panels/MainMenu.tsx`)
- The logo becomes a **Main menu** button. Its menu: Back to files, Actions… (Ctrl+K), File, Edit, View, Object, Text, Arrange, Vector, Plugins, Preferences, Libraries, Help and account.
- Move `MENUS` and `fileEntries` out of `desktop/menu.ts` into a shared `editor/menus.ts`, so the desktop's native menu bar and the web main menu come from one list. The desktop keeps its native menus and hides this button, or shows it too (decide in review).
- Submenus open on hover, keyboard navigable (arrows, Enter, Escape), reusing the context menu's styles from `panels/Menus.tsx`.

**3. Missing commands** (all in `editor/commands.ts`, listed in the menus)
- Edit: **Copy properties / Paste properties** (Ctrl+Alt+C / Ctrl+Alt+V; fills, strokes, effects, opacity, corner radius, text style), **Pick color** (I), **Select matching layers** (Ctrl+Alt+A), **Select inverse** (Ctrl+Shift+A), **Select none**, **Paste to replace** (Ctrl+Shift+R).
  - Ctrl+Alt+V is our Local variables today: move variables to the Variables button only (U5) and give the shortcut to Paste properties, as in Figma.
- Object: **Flip horizontal** (Shift+H), **Flip vertical** (Shift+V), **Rotate 180° / 90° left / 90° right**, **Remove fill** (Alt+/), **Remove stroke** (Shift+/), **Swap fill and stroke** (Shift+X), **Wrap in new section**, **Hide other layers**, **Collapse layers** (Alt+L).
  - Shift+H, Shift+V and Shift+X are free in `shortcuts.ts` (Ctrl+Shift+H is Show/Hide; that stays).
- Arrange: **Tidy up** (Ctrl+Alt+Shift+T), **Pack horizontal / vertical**, **Distribute left / horizontal centers / right / top / vertical centers / bottom**, **Round to pixel**.
- View: **Pixel grid** (separate from Snap to pixel grid), **Outlines** (Ctrl+Y, wireframe render in `packages/renderer`), **Pixel preview**, **Show slices**, **Previous / next page** (Page Up / Page Down), **Zoom to previous / next frame** (Shift+N / N).
- Text: Bold, Italic, Underline, Strikethrough, Bulleted list, Numbered list, as commands on the selected text layers (the text panel already has the controls).
- Preferences: move the existing settings (snap, nudge amount, theme) here and add **Keep tool selected after use** and **Highlight layers on hover**, saved in `editor/prefs.ts`.

**4. File-name menu** → Figma's "Edit file menu": Show version history (cloud), Export…, Duplicate, Rename, Move to trash (cloud), plus our extras (Files in this browser, New file).

**5. Context menu** (`panels/Menus.tsx`): add **Paste here**, **Paste to replace**, **Copy/Paste as** submenu (PNG, SVG, CSS), **Select layer** submenu (layers under the cursor), **Move to page**, **Flip horizontal / vertical**, **Add motion** (switches to Motion and opens the Animations + menu).

Tests: one test per new command (flip, rotate, tidy up, copy/paste properties, select matching); menu model test that every id in `editor/menus.ts` exists in `COMMANDS`; desktop smoke test for the shared menu.

---

**Done in U3 / moved to later.** Built: Actions (button, Ctrl+K, debug commands behind `?debug`), the Main menu with one menu list shared with the desktop app (`editor/menus.ts`), and the Edit, Object, Text, Arrange, View and Preferences commands above, plus Paste here and Add motion in the context menu. Moved to a later phase because they need renderer or model work, or more UI than a menu item:
- **Flip horizontal / vertical** (Shift+H / Shift+V): needs a flip in the node model, drawn by all three renderers.
- **Outlines, Pixel preview, Pixel grid, Show slices**: renderer modes.
- **Paste to replace, Copy/Paste as, Select layer, Move to page** in the context menu, and **Bulleted / Numbered list**, **Create link** in Text.
- **Remove stroke** has no shortcut: Figma's Shift+/ is our `?` (keyboard shortcuts).
- The file-name menu got Figma's names (Rename, Show version history) but not Publish library, Duplicate or Move to trash.

---

### Phase U4: Right panel sections
Branch `ui-right-panel` · about 2–3 days

**1. Header**: the layer type with a dropdown ("Frame ▾") for converting between frame / group / section, plus quick buttons (Create component, Use as mask, Add auto layout) on the right, as in Figma.

**2. Position**: Alignment buttons, Position X/Y, Rotation with flip buttons, and **Constraints** (moved from `LayoutPanels.tsx:347`) at the bottom.

**3. Layout**: one section with the auto layout toggle (icon button) and **Flow** buttons (Freeform / Vertical / Horizontal / Grid; we have no grid auto layout, so Grid is shown disabled with a "coming later" tooltip), then **Dimensions** W/H with lock aspect ratio, Clip content, and the auto layout fields when it's on. Replaces today's "Layout" + "Auto layout" pair.

**4. Appearance**: Opacity, Corner radius, the eye (Hide), Blend mode, in Figma's layout (opacity and corner radius side by side).

**5. Selection colors** (new): every distinct solid paint used in the selection and its descendants, with a count ("+9"); editing one swaps it everywhere it's used. Needs a `collectPaints(doc, ids)` helper in `packages/document` (with tests) and a doc change per edit.

**6. Shape** (Flatten, Outline): drop the section; both are in the header's quick buttons, the context menu and the Object menu.

**7. Annotations** in the Design tab: move to the Inspect tab (U7).

**8. Prototype tab, nothing selected**: put Device and Flows behind a **Show prototype settings** link, as Figma does.

Tests: panel unit tests for Position/Layout/Appearance values on mixed selections; `collectPaints` tests; the existing PropertiesPanel tests updated.

---

**Done in U4 / moved to later.** Built: the header (type, Create component, Use as mask, a Boolean groups menu with Flatten and Outline stroke), Position (alignment, X/Y, rotation, constraints), Layout (auto layout + / −, Flow, W/H and sizing, Clip content, auto layout fields), Appearance (opacity, corner radius, blend mode, eye; polygon and star counts), Selection colors (`packages/document/src/selectionColors.ts`), the Design tab's text section renamed **Typography**, and Show prototype settings. Not done:
- **Convert-type dropdown** in the header (Frame ↔ Group ↔ Section): needs a node type change in the document model.
- **Flip buttons** next to rotation: wait for flip (see U3).
- **Lock aspect ratio** and **Grid** auto layout.
- **Selection colors** don't include text range colors or gradients.
- **Annotations** stay in the Design tab until U7.

---

### Phase U5: Floating toolbar and left rail
Branch `ui-layout` · about 3–4 days

The biggest visual change, so it comes after the smaller fixes have landed.

**1. Bottom floating toolbar**
- Move the tools out of `<header className="toolbar">` into a floating bar centred at the bottom of the canvas (`canvas-area`). The **mode switcher** sits at its right end as icon toggles in Figma's order: **Draw, Design, Motion, Dev Mode** (Dev Mode = switches the right panel to Inspect; U7).
- In Motion the bar floats above the timeline (it follows `--timeline-h`).
- Undo/Redo buttons go away (menu and shortcuts only), as in Figma.

**2. Top of the left panel**: the file name with the Edit file menu chevron, "Drafts / project" under it, and **Minimize UI** button.

**3. Top of the right panel**: avatars (Multiplayer tools), **Present** ▷ with a **Prototype view** dropdown, **Share** (cloud), and below it the tab row with the zoom menu at the right end. The mode name replaces the tabs in Draw ("Draw") and Motion ("Motion Beta").

**4. Left navigation rail**: File (pages and layers), **Assets** (moved from the left-panel tab), **Variables** (opens the variables panel; removes the Variables section from the right panel), **Plugins** (our Tools: moves the Plugins button here).
- Pages header gets a **search** button (filters pages by name).

**5. Help button** (`?`, bottom right): Keyboard shortcuts, Show the editor tour, Help docs link.

**6. Desktop app**: check the title bar and window controls still fit (Electron's custom title bar overlaps the top-left), and that the native menus still work with the web main menu.

Tests: layout smoke test at 1440×900 and 1024×768 (nothing overlaps the canvas); minimize/hide UI still work; the tour updated for the new places; screenshots in `docs/ui-comparison/` refreshed.

---

**Done in U5 / changed.** Built: the floating toolbar with the Draw / Design / Motion / Dev Mode switch (Dev Mode opens the Inspect tab; leaving it returns to Design), the navigation rail (Main menu, File, Assets, Variables, Plugins), the left panel head (file menu, Minimize UI), the right panel head (avatars, Present, Share) with the zoom at the end of the tab row, the Find magnifier next to Pages (Figma's magnifier there is Find, not a page search as this plan first said) and the Help button. Minimize UI now keeps the rail and toolbar. Changed from the plan:
- **Undo / Redo buttons are kept**, small, at the top of the left panel (Figma has none).
- **Motion keeps the Design / Prototype / Inspect tabs**; only Draw shows the mode name.
- The toolbar stays dark rather than Figma's light bar.
- No Prototype view dropdown next to Present.
Also fixed here: Add page (File menu) and Remove all guides on this page (View menu) were missing from the menus since U3, and the Design tab header shows the layer's name again.

---

### Phase U6: Motion panel
Branch `ui-motion-panel` · about 2 days

- Replace the **Animate** list (`panels/AnimateSection.tsx`) with Figma's layout: **Animations** (+) at the top, then **Transform** (Position, Scale with aspect lock, Rotation), then the normal Layout, Appearance, Fill, Stroke and Effects sections, each field with a ◇ keyframe button beside it. The same ◇ goes next to W/H, Opacity, Corner radius, Fill and Stroke when Motion mode is on.
- A shared `<KeyframeButton prop node>` control used by all those fields.
- Timeline header: Play, **add keyframe ◇**, the time as `00:00:000 ms`, auto-keyframe toggle, and − / + zoom buttons (keep the slider as well, or replace it; decide in review). The timeline spans under the left panel too.
- Position in Transform shows the layer's centre (anchor), as Figma's does; check against `editor/motion.ts`.

Tests: keyframe button adds/removes keys for each property; the existing motion tests.

---

**Done in U6 / changed.** Built: `KeyframeButton` and `Keyed` (`panels/AnimateSection.tsx`), the Transform section (Position, Scale with aspect lock, Rotation) in place of Position and the old Animate list, ◇ on W/H, Opacity, Corner radius, Stroke weight and in the Fill, Stroke and Effects headers, and the timeline's Add keyframe ◇ and − / + zoom (the slider stays). Also fixed: the timeline header buttons were white on the light timeline, so Play and the others were hard to see. Not done:
- **Position as the centre** (Figma's anchor): ours still shows the top-left, as the keyframes store it.
- **The timeline spanning under the left panel**, and Figma's `00:00:000 ms` time format.
- **Audio**.

---

### Phase U7: Dev Mode pieces (Inspect)
Branch `ui-dev-mode` · about 3 days

- Inspect tab layout: name and type, **Compare changes** (cloud files: opens version history at this layer), **Layer properties** with a **Code / List** toggle, then Typography, **Colors**, **Assets**, **Export**, **Annotations**.
- **Ready for dev**: a `readyForDev` field on FRAME / COMPONENT / SECTION (optional; no migration), a **Mark as ready for dev** button in Inspect, and a "Ready for development" group at the top of the layers panel in Inspect.
- **Annotation tool (Shift+T)** and **Measurement tool (Shift+M)** in the Inspect toolbar. Shift+M is our Shape builder today: in Figma, Shape builder lives in the vector edit bar and Shift+M measures. Move Shape builder to its vector edit bar button only, then give Shift+M to Measurement. Measurements are stored like annotations and drawn in the same overlay.

Tests: measurement storage and rendering; ready-for-dev toggle; codegen unchanged.

**Done in U7 / changed.** Built: `devStatus` and page `measurements` fields with helpers (`packages/document/src/devMode.ts`, optional, no migration); Mark as ready for dev, the Ready for dev badge and the Ready for development list; Compare changes (opens version history in account files); the Code / List toggle; the Measurement tool and pinned measurements (drawn in pink in Dev Mode, while measuring, and when annotations are shown; listed per layer in Inspect; "Remove all measurements on this page" in View); and the Dev Mode toolbar (Move tools, Annotation, Measurement, Comment). Changed from the plan:
- **Shape builder keeps Shift+M** in Design mode; Shift+M is Measurement only in Dev Mode.
- **Annotations stay in the Design tab** as well as Inspect (moving them would hide them from Design mode).
- **Compare changes** opens the file's version history; there's no per-layer diff yet.
- No Completed status, Dev resources or Code Connect.

---

## 4. Order and estimates

| Phase | Size | Depends on |
| --- | --- | --- |
| U1 Names and shortcuts | 1 day | — |
| U2 Toolbar slots | 1–2 days | U1 |
| U3 Actions and main menu | 2–3 days | U1 |
| U4 Right panel sections | 2–3 days | U1 |
| U5 Floating toolbar and left rail | 3–4 days | U2, U3 |
| U6 Motion panel | 2 days | U4 |
| U7 Dev Mode pieces | 3 days | U2, U5 |

About 14–18 days in all. U2, U3 and U4 can run in parallel after U1 (they touch different files: `Toolbar.tsx`, `commands.ts`/`Menus.tsx`/new `MainMenu.tsx`, and the panels).

## 5. Shortcut changes in one place

| Action | Now | After | Phase |
| --- | --- | --- | --- |
| Zoom to 100% (shown) | Shift+0 | **Ctrl+0** (both keep working) | U1 |
| Layout guides | Ctrl+Shift+4 | **Shift+G** (old alias) | U1/U2 |
| Polygon | Shift+G | none | U1/U2 |
| Annotation | none | **Shift+T** | U1 |
| Ungroup | Ctrl+Shift+G | **Ctrl+Backspace** + old | U1 |
| Flatten | Ctrl+E | **Alt+Shift+F** + old | U1 |
| Bring to front / Send to back | Ctrl+Shift+] / [ | **]** / **[** + old | U1 |
| Actions | Ctrl+/ and Ctrl+K | **Ctrl+K** (Ctrl+/ alias) | U3 |
| Paste properties | — (Ctrl+Alt+V = Local variables) | **Ctrl+Alt+V** | U3 |
| Flip horizontal / vertical | — | **Shift+H / Shift+V** | U3 |
| Measurement | — (Shift+M = Shape builder) | **Shift+M** | U7 |

## 6. Testing

- Every phase: `pnpm test`, type check, the desktop smoke test, and a pass through the changed UI in the browser (Playwright MCP) at `/local` and on a cloud file.
- After U5 and at the end: re-run the comparison walk-through from `ui-comparison.md` and update its status column and screenshots.

## 7. Follow-ups: what's still different (phases V1–V7)

U1–U7 left these differences from Figma. Same rules as section 2; one branch and pull request per phase, smallest first.

| Phase | What | Size |
| --- | --- | --- |
| **V1** Flip | `flipX` / `flipY` on layers (a mirror around the box centre in `localTransform`, so every renderer, hit testing and bounds follow; SVG export and codegen too). Flip horizontal (Shift+H) / vertical (Shift+V) in Object, the right-click menu, and buttons next to rotation in Position. | ½ day |
| **V2** Convert layer type | The header's type dropdown: Frame ↔ Group ↔ Section, as Figma's "Frame ▾". Also Object > Convert to frame / Convert to section. A new container takes the old one's place and children; fills, strokes and effects carry over where the new type has them. | 1 day |
| **V3** View modes | Outlines (Ctrl+Y): every layer drawn as a 1px outline, no fills (CanvasKit and Canvas 2D). Pixel preview: the canvas drawn at 1× and scaled up without smoothing. Pixel grid toggle (Shift+'), Show slices. | 2 days |
| **V4** Lock aspect ratio | `constrainProportions` on layers; the lock button next to W/H; W/H edits and resize handles keep the ratio while it's on. | ½ day |
| **V5** Motion position as the centre | Transform's Position shows and edits the layer's centre (as Figma's anchor); keyframes keep storing x/y, so it's a conversion in the panel only. | ½ day |
| **V6** Grid auto layout | Flow > Grid: `layoutMode: 'GRID'` with row and column counts and gaps, children placed in order into cells (`packages/layout`), shown in the canvas and exported. | 3 days |
| **V7** Compare changes per layer | In account files, Compare changes lists the selected layer's property differences against a chosen version (from version history). | 2 days |
| **V8** Audio in Motion | An Audio section and track on the timeline: an uploaded sound, its start and volume, played with the timeline and mixed into video export. | 3–4 days |

V1 (flip) is done on branch `ui-flip`. V2 (convert layer type) is done on branch `ui-convert-type`: the header's type dropdown and Object > Convert to section / Convert to frame. V3 (view modes) is done on branch `ui-view-modes`: Outlines is a view-only copy of the page drawn as hairlines (no shortcut: Figma's Ctrl+Y is Redo on Windows), Pixel preview (Ctrl+Shift+P) renders at one pixel per unit and scales up, plus the Pixel grid and Show slices toggles. V4 (lock aspect ratio) is done on branch `ui-lock-ratio`: `constrainProportions` on layers, the lock button next to W/H, and W/H edits and resize handles keep the ratio while it's on.
