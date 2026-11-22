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
- `polygon`: drop the **Shift+G** shortcut (Figma's Polygon has none, and Shift+G is Figma's Layout guides, U2). Keep it as an alias until U2 takes the key.

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
Code tools      Code (B), Spec (D)
Comment (C)     cloud files only
Actions         (U3)
```
- `ToolSlot` gets a `name` for its menu header and caret label ("Shape tools"), shown at the top of the menu as in Figma.
- A slot entry can be a **command** instead of a tool: Image/video… runs `place-image`. Give `ToolDef` an optional `run`.
- The separate Hand button goes away (H still works).
- "Code snippet" and "Annotation" leave the Code menu. Code snippet stays in quick actions; Annotation moves to the Dev Mode / Inspect tools in U7, and stays in quick actions (Shift+T) until then.

**2. Draw mode toolbar** (`DRAW_TOOLS`)
- Move tools, **Pen / Brush / Pencil**, then Region, Shape, Type and Code slots, Comment, Actions, as in Figma Draw.

**3. Layout guides toggle on Shift+G** (from U1's alias).

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

### Phase U6: Motion panel
Branch `ui-motion-panel` · about 2 days

- Replace the **Animate** list (`panels/AnimateSection.tsx`) with Figma's layout: **Animations** (+) at the top, then **Transform** (Position, Scale with aspect lock, Rotation), then the normal Layout, Appearance, Fill, Stroke and Effects sections, each field with a ◇ keyframe button beside it. The same ◇ goes next to W/H, Opacity, Corner radius, Fill and Stroke when Motion mode is on.
- A shared `<KeyframeButton prop node>` control used by all those fields.
- Timeline header: Play, **add keyframe ◇**, the time as `00:00:000 ms`, auto-keyframe toggle, and − / + zoom buttons (keep the slider as well, or replace it; decide in review). The timeline spans under the left panel too.
- Position in Transform shows the layer's centre (anchor), as Figma's does; check against `editor/motion.ts`.

Tests: keyframe button adds/removes keys for each property; the existing motion tests.

---

### Phase U7: Dev Mode pieces (Inspect)
Branch `ui-dev-mode` · about 3 days

- Inspect tab layout: name and type, **Compare changes** (cloud files: opens version history at this layer), **Layer properties** with a **Code / List** toggle, then Typography, **Colors**, **Assets**, **Export**, **Annotations**.
- **Ready for dev**: a `readyForDev` field on FRAME / COMPONENT / SECTION (optional; no migration), a **Mark as ready for dev** button in Inspect, and a "Ready for development" group at the top of the layers panel in Inspect.
- **Annotation tool (Shift+T)** and **Measurement tool (Shift+M)** in the Inspect toolbar. Shift+M is our Shape builder today: in Figma, Shape builder lives in the vector edit bar and Shift+M measures. Move Shape builder to its vector edit bar button only, then give Shift+M to Measurement. Measurements are stored like annotations and drawn in the same overlay.

Tests: measurement storage and rendering; ready-for-dev toggle; codegen unchanged.

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
