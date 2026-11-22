# Figma vs Design Clone: editor UI comparison

Captured on 2026-11-22 with the Playwright MCP server (Chrome, 1440×900).

- **Figma:** the live editor (UI3, Free plan) on an existing design file, opened read-only. Nothing was drawn or changed. Dev Mode needs a paid plan: it showed an upgrade screen with the Inspect panel only partly visible, so the Dev Mode rows also use Figma's help center ([Guide to Dev Mode](https://help.figma.com/hc/en-us/articles/15023124644247-Guide-to-Dev-Mode), [Add measurements and annotations](https://help.figma.com/hc/en-us/articles/20774752502935-Add-measurements-and-annotations-in-Dev-Mode)). Rows marked *(docs)* come from those pages.
- **Ours:** `pnpm --filter @figma/web dev` at `http://localhost:5280/local` (a local file), commit `e23f6a6` (latest `main`). Cloud-only UI (Comment tool, Share, version history) doesn't show at `/local`; it was checked in the source and is marked *(cloud files)*.

Status key: **Same** · **Different name or place** · **Missing in ours** · **Extra in ours**

| Figma | Ours |
| --- | --- |
| ![Figma editor](ui-comparison/figma-editor.png) | ![Our editor](ui-comparison/ours-editor.png) |
| ![Figma, frame selected](ui-comparison/figma-frame-selected.png) | ![Ours, frame selected](ui-comparison/ours-frame-selected.png) |

## 1. Overall layout

| Feature | Figma (name, location) | Ours (name, location) | Status |
| --- | --- | --- | --- |
| Tool bar | Floating toolbar at the **bottom centre** of the canvas | Top bar across the window (dark), with modes, tools, undo/redo, file name, Plugins, Present, zoom | Different name or place |
| Navigation rail | Narrow left rail: **File**, **Agents**, **Assets**, **Tools**, **Variables** | None; Layers and Assets are tabs at the top of the left panel | Different name or place |
| Main menu | Figma logo button, top left of the left panel | **Main menu**: the ◆ logo button, top left of the top bar | Same (U3; place changes in U5) |
| File name and location | Top of the left panel: file name + chevron (Edit file menu), with "Drafts · Free" under it | Top bar centre: `Untitled ▾ / Page 1` | Different name or place |
| Minimize UI | Button next to the file name; also View menu, Ctrl+Shift+\ | Quick actions only (Minimize UI, Ctrl+Shift+\) | Different name or place |
| Present / Share | Top of the right panel: avatars (Multiplayer tools), **Present** ▷ with **Prototype view** dropdown, **Share** | Top bar right: Plugins, Present ▷, zoom; Share *(cloud files)* | Different name or place |
| Zoom/view options | `44% ▾` on the right panel's tab row | `100%` in the top bar | Different name or place |
| Undo / Redo buttons | None on screen (menu and shortcuts only) | Buttons in the top bar | Extra in ours |
| Help | `?` button, bottom right | Missing (the editor tour is in quick actions) | Missing in ours |
| Editor tour | — | "Welcome to the editor" tour on first open | Extra in ours |

## 2. Toolbar and tools (Design mode)

Figma groups the tools into seven slots with dropdowns. Since U2, ours does too.

![Figma shape tools menu](ui-comparison/figma-shape-tools.png)

| Figma slot → tools (shortcut) | Ours | Status |
| --- | --- | --- |
| **Move tools**: Move (V), **Hand tool** (H), Scale (K) | Move tools: Move (V), Hand tool (H), Scale (K) | Same (U2) |
| **Region tools**: Frame (F), Section (Shift+S), Slice (S) | Region tools: Frame (F), Section (Shift+S), Slice (S) | Same (U2) |
| **Shape tools**: Rectangle (R), Line (L), Arrow (Shift+L), Ellipse (O), Polygon, Star, **Image/video…** (Ctrl+Shift+K) | Shape tools: Rectangle (R), Line (L), Arrow (Shift+L), Ellipse (O), Polygon, Star, Image/video… (Ctrl+Shift+K) | Same (U2) |
| Image/video… | Image/video… in Shape tools and quick actions (Ctrl+Shift+K); images only | Same name and place (U2); no video yet |
| **Creation tools**: Pen (P), Pencil (Shift+P) | Creation tools: Pen (P), Pencil (Shift+P) | Same (U2) |
| **Type tools**: Text (T), **Text on path** | Text menu: Text (T), Text on path | Same (U1) |
| **Code tools**: Code (B), Spec (D) | Code tools: Code (B), Spec (D). Code snippet and Annotation (Shift+T) are in quick actions | Same (U2) |
| **Comment** (C) | Comment (C) *(cloud files only)* | Same |
| **Actions** (grid icon, Ctrl+K): AI prompts plus the command list | **Actions** button (grid icon) after the tool slots; Ctrl+K (Ctrl+/ also works) | Same (U3; no AI prompts) |
| Annotation (Shift+T), Measurement (Shift+M) *(docs; not shown on the Free plan's Design toolbar)* | Annotation (Shift+T) in quick actions; no Measurement tool (Alt-hover shows distances) | Different name or place / Missing in ours (Measurement) |
| Frame presets (right panel while the Frame tool is on) | Frame presets in the right panel (Phone, …) | Same |
| Measurement is Shift+M in Figma *(docs)* | Shift+M is our Shape builder (vector edit bar, quick actions) | Different shortcut (clash if Measurement is added) |

## 3. Modes

| Feature | Figma | Ours | Status |
| --- | --- | --- | --- |
| Mode switcher | Segmented icons at the **right end of the bottom toolbar**, in this order: **Draw**, **Design**, **Motion (Beta)**, **Dev Mode** | Text tabs at the left of the top bar: **Design**, **Draw**, **Motion** | Different name or place (order, position, Dev Mode) |
| Mode name on the right panel | The tab row shows the mode: "Draw", "Motion Beta" | Design / Prototype / Inspect tabs stay the same in every mode | Different name or place |
| Draw toolbar | Move, **Pen / Brush / Pencil** (drawn as real pens), Frame, Shape, Text, Code, Comment, Actions | Move tools, Pen, Brush, Pencil, Region, Shape, Type and Code tools (Comment on cloud files) | Same (U2; Actions comes in U3) |
| Dev Mode | Mode in the toolbar (Shift+D), paid plans; its own right panel (Inspect, Plugins) | **Inspect tab** in the right panel, in every mode | Different name or place |

![Figma Draw mode](ui-comparison/figma-draw.png)

## 4. Left panel

| Feature | Figma | Ours | Status |
| --- | --- | --- | --- |
| Pages | "Pages" header, **search** and **+ (Add new page)** | "Pages" header with + (Add page) | Missing in ours (page search) |
| Layers | "Layers" header with a layout/collapse toggle; thumbnails for frames | "Layers" header with "Show layer icons" toggle; "Layer thumbnails" in quick actions | Same |
| Find | Find (magnifier) next to Pages; Edit > Find (Ctrl+F) | Find and replace… (Ctrl+F) in quick actions | Different name or place |
| Assets | Left rail **Assets**: All libraries, Created in this file, UI kits (iOS and iPadOS, Material 3, Simple Design System), Add more libraries | **Assets** tab: Local components, Libraries | Different name or place (rail vs tab; no UI kits) |
| Variables | Left rail **Variables** (collections) | "Variables" section in the right panel when nothing is selected → **Open variables**; Local variables (Ctrl+Alt+V) | Different name or place |
| Tools | Left rail **Tools**: plugins, widgets, shaders, AI image tools | **Plugins** button in the top bar (built-in plugins, Write a plugin, Add from a URL/file) | Different name or place |
| Agents | Left rail **Agents** (AI chat on the file) | — | Missing in ours |

## 5. Right panel: Design tab

Nothing selected:

| Figma | Ours | Status |
| --- | --- | --- |
| **Page** (background colour, opacity, eye) | **Page** (colour, opacity, Hide, Remove, Show in exports) | Same (U1) |
| **Styles** with + : Text styles, Color styles, Effect styles, **Layout guide styles** | **Styles** (hint text until a style exists), groups Text / Color / Effect styles | Same (U1; no Layout guide styles yet) |
| Export | Export (Layers on this page / all pages, Export files) | Same |
| — | **File → Export file as JSON** | Extra in ours |

Layer selected (frame / group):

| Figma section → contents | Ours | Status |
| --- | --- | --- |
| Header: layer type with dropdown ("Frame ▾", "Group ▾"), quick buttons (component, mask, …) | Name + type text ("Frame 1 · Frame") | Different name or place |
| **Position**: Alignment, Position X/Y, Rotation (with flip buttons), constraints | Alignment buttons at the top, X/Y and rotation in **Layout**; **Constraints** section on children | Different name or place |
| **Layout**: auto layout toggle; Flow: **Freeform / Vertical / Horizontal / Grid**; Dimensions W/H, lock aspect ratio, Clip content | **Layout** (X, Y, W, H, rotation, corner radius, Clip content) + separate **Auto layout** section with + | Different name or place |
| **Appearance**: Opacity, Corner radius, Hide (eye), Blend mode | **Appearance**: Opacity, blend mode list | Same name (U1); layout differs (U4) |
| Fill, Stroke, Effects | Fill, Stroke, Effects | Same |
| **Selection colors** | — | Missing in ours |
| **Layout guide** | **Layout guide** | Same (U1) |
| Export | Export | Same |
| — | **Shape** (Flatten, Outline) | Extra in ours |
| — | **Annotations** section in the Design tab | Extra in ours (Figma puts annotations on the canvas / Dev Mode) |
| Text layer: **Typography** | Typography | Same |
| Instance / component properties | Instance / Properties / Variants | Same |

## 6. Prototype tab

| Figma | Ours | Status |
| --- | --- | --- |
| **Prototype with Agent** (AI) | — | Missing in ours |
| Flow starting point (on frames) | Flow starting point ("Start a prototype here") | Same |
| Interactions (+) | Interactions | Same |
| Scroll behavior → **Position** (Scroll with parent…) and Overflow | Scroll behavior → Overflow (No scrolling, Vertical, Horizontal, Both directions); "Position when scrolling" | Same |
| **Show prototype settings** (device, background, starting frame), hidden behind a link | **Device** and **Flows** sections shown directly when nothing is selected | Different name or place |
| Present ▷ + **Prototype view** dropdown | Present ▷ | Missing in ours (Prototype view dropdown) |

## 7. Inspect / Dev Mode

![Our Inspect tab](ui-comparison/ours-inspect.png)

| Figma (Dev Mode, paid) | Ours (Inspect tab) | Status |
| --- | --- | --- |
| Separate mode with Inspect and Plugins tabs | Inspect tab next to Design / Prototype | Different name or place |
| Layer name, type, last updated; **Compare changes** *(docs)* | Name + type; no change comparison | Missing in ours (Compare changes) |
| **Ready for dev** / Mark as ready for dev, "Ready for development" in the layers panel | — | Missing in ours |
| Dev resources, Component info, Code Connect *(docs)* | — | Missing in ours |
| **Layer properties** with **Code / List** toggle | Layout (W, H, X, Y), Fill, Typography as lists | Different name or place |
| Code: language dropdown (CSS, iOS, Android, plugins) | **Code**: CSS, SwiftUI, Compose | Same |
| Colors, Assets (icon detection, downloads), Export | Fill colours; Export is in the Design tab | Different name or place |
| Annotation (Shift+T) and Measurement (Shift+M) tools *(docs)* | Annotation (Shift+T, quick actions), Spec tool; Annotations (Shift+Y) | Different name or place |

## 8. Motion

| Figma | Ours | Status |
| --- | --- | --- |
| "Motion Beta" mode; timeline at the bottom across the left panel too | Motion mode; timeline at the bottom, under the canvas only | Same (layout differs slightly) |
| Timeline header: Play ▷, keyframe ◇, time `00:00:000 ms`, auto-keyframe toggle, zoom − / + on timeline, ruler `0s, 200ms … 1s … 2s` | Play (Space), auto-keyframe toggle, current time `0ms` / duration `2000ms`, `ms`/`s` unit toggle, selected layer name, zoom slider, ruler `0ms … 2500ms` | Different name or place (ours shows the duration and uses a slider for zoom; Figma has a keyframe ◇ button and − / + zoom) |
| Right panel **Animations** (+) at the top | **Animations** (+) under Animate | Same |
| **Transform**: Position, Scale, Rotation, each with a ◇ keyframe button beside the field | **Animate** section: a list of ◇ X, Y, Width, Height, Rotation, Scale X, Scale Y, Opacity, Corner radius, Fill, Stroke, Stroke weight, Blur, shown **above** the normal Design sections | Different name or place |
| Keyframe ◇ on Layout (W/H) and Appearance fields | Keyframes only in the Animate list | Different name or place |
| **Audio** section, Add audio | — | Missing in ours |
| Right-click → **Add motion** (Design mode) | Motion mode in quick actions | Missing in ours (context menu item) |

| Figma Motion | Our Motion |
| --- | --- |
| ![Figma Motion](ui-comparison/figma-motion.png) | ![Our Motion](ui-comparison/ours-motion.png) |

## 9. Menus and quick actions

| Figma | Ours | Status |
| --- | --- | --- |
| **Main menu**: Back to files, Actions…, File, Edit, View, Object, Text, Arrange, Vector, Plugins, Widgets, Preferences, Libraries, Open in desktop app, Help and account | **Main menu**: Back to files, Actions…, File, Edit, View, Object, Text, Arrange, Vector, Plugins, Preferences, Libraries, Help | Same (U3; no Widgets, Open in desktop app or account items) |
| **Actions** (Ctrl+K): AI prompts on top (Ask for changes, Create variations, …), then All / Assets / Plugins & widgets tabs and suggested commands | **Actions** (Ctrl+K; Ctrl+/ also works): All / Assets / Plugins & widgets tabs, full command list | Same (U3; no AI prompts) |
| Edit file menu (chevron by file name): Show version history, Publish library…, Export…, Add to sidebar, Create branch…, File color profile, Duplicate, Rename, Move file…, Move to trash | File-name menu: Rename, Your account's files / Back to files, New file, Libraries…, Show version history (cloud), Theme, Files in this browser | Different name or place (no Publish library, Duplicate, Move to trash) |
| Edit menu: Copy properties / Paste properties, Pick color (I), Select matching layers, Select inverse, Paste to replace, Paste over selection | Edit: Copy as (PNG, SVG), Copy properties (Ctrl+Alt+C), Paste properties (Ctrl+Alt+V), Pick color (I), Select all, Select matching layers (Ctrl+Alt+A), Select none, Select inverse (Ctrl+Shift+A) | Same (U3); missing Paste to replace, Paste over selection |
| Object menu: Wrap in new section, Flip horizontal/vertical, Rotate 90°/180°, Remove fill/stroke, Swap fill and stroke, Boolean groups | Object: Wrap in new section, Rotate 180° / 90° left / 90° right, Boolean groups, Hide other layers, Collapse layers (Alt+L), Remove fill (Alt+/), Remove stroke, Swap fill and stroke (Shift+X) | Same (U3); missing Flip horizontal/vertical |
| Arrange menu: Tidy up, Pack, Distribute horizontal/vertical spacing, Distribute left/centers/right/top/bottom | Arrange: Round to pixel, Align ×6, Tidy up (Ctrl+Alt+Shift+T), Pack horizontal/vertical, Distribute spacing and Distribute left/centers/right/top/bottom | Same (U3) |
| Vector menu: Join, Smooth join, Delete and heal, Split, Simplify, Offset | Vector edit actions (F6) | Same (not compared item by item) |
| Text menu: Bold, Italic, Underline, Strikethrough, Create link, Bulleted / Numbered list | Text: Bold (Ctrl+B), Italic (Ctrl+I), Underline (Ctrl+U), Strikethrough (Ctrl+Shift+X), on selected text layers or while editing | Same (U3); missing Create link and lists |
| Right-click: Copy, **Paste here**, **Paste to replace**, **Copy/Paste as**, Build this with code, **Add motion**, **Select layer**, **Move to page**, order, group, Flatten, Outline stroke, mask, auto layout, Create component, Plugins, Widgets, Show/Hide, Lock/Unlock, **Flip** | Copy, Copy as PNG/SVG, Paste, **Paste here**, Duplicate, Delete, order ×4, group, component, variants, instance commands, frame, auto layout, mask, boolean ×4, Flatten, Outline stroke, **Add motion**, Show/Hide, Lock/Unlock, Zoom to selection | Different name or place (U3 added Paste here and Add motion; missing Paste to replace, Copy/Paste as, Select layer, Move to page, Flip) |
| Theme in Preferences > Theme | Main menu > Preferences > Theme (also the file-name menu and Actions) | Same (U3) |
| — | "Renderer: use Canvas 2D", "Create a 10,000-layer test page": only listed in Actions with `?debug` in the address | Extra in ours (hidden since U3) |

![Figma main menu](ui-comparison/figma-main-menu.png)
![Our quick actions](ui-comparison/ours-quick-actions.png)

## 10. View settings

| Figma (View menu and zoom/view options) | Ours | Status |
| --- | --- | --- |
| Zoom in/out, Zoom to fit, **Zoom to 50% / 100% / 200%**, Zoom to selection | Zoom in/out, Zoom to fit, Zoom to selection, Zoom to 50% / 100% / 200%, then view toggles | Same (U1) |
| Zoom to 100% = **Ctrl+0** | Zoom to 100% = **Ctrl+0** (Shift+0 also works) | Same (U1) |
| Pixel grid, Snap to pixel grid, **Pixel preview** | Snap to pixel grid (quick actions) | Missing in ours (Pixel grid toggle, Pixel preview) |
| **Layout guides** (Shift+G) | **Layout guides** (Shift+G; Ctrl+Shift+4 also works) | Same (U1) |
| Rulers (Shift+R) | Show rulers (Shift+R) | Same |
| **Outlines**, Mask outlines, Frame outlines | — | Missing in ours |
| Show slices, Comments (Shift+C), Annotations (Shift+Y), Additional labels, Multiplayer cursors | Show annotations (Shift+Y), Multiplayer cursors | Missing in ours (Show slices, Additional labels) |
| Previous/next page, Zoom to previous/next frame (N / Shift+N) | View: Previous page / Next page (Page Up / Page Down), Zoom to previous / next frame (Shift+N / N) | Same (U3) |
| Preferences: snapping, Keep tool selected after use, Nudge amount…, etc. | Preferences: Snap to pixel grid, Keep tool selected after use, Highlight layers on hover, Nudge amount…, Theme | Missing in ours (the other preferences) |

## 11. Export

| Figma | Ours | Status |
| --- | --- | --- |
| Export section (+) in the Design tab, Export… (Ctrl+Shift+E) | Export section, Export selection (Ctrl+Shift+E) | Same |
| File > **Export frames to PDF…** | — | Missing in ours |
| File > Save local copy… (.fig) | Export file as JSON (right panel) | Different name or place |
| Save to version history…, Show version history | Version history *(cloud files)* | Same |
| Motion export (video) | Video / Lottie / dotLottie / animated SVG export | Same |

## Prioritized fixes (smallest and most visible first)

1. ~~**"Text on a path" → "Text on path"** in the Text menu.~~ Done in U1.
2. ~~**Rename "Hand" to "Hand tool" and move it into the Move menu**~~ (done in U1 and U2) (Move, Hand tool, Scale), dropping the separate Hand button.
3. ~~**Rename right-panel sections**~~ (done in U1): "Layer" → **Appearance**, "Layout grid" → **Layout guide** (and "Show/Hide layout grids" → **Layout guides**, Shift+G), "Background" → **Page**, "Local styles" → **Styles**.
4. ~~**Zoom to 100% shortcut**~~ (done in U1): Ctrl+0 (Figma) instead of Shift+0; add Zoom to 50% / 200% to the zoom menu.
5. ~~**Group the shape buttons into one "Shape tools" slot** (Rectangle, Line, Arrow, Ellipse, Polygon, Star, Image/video…) and **Pen + Pencil into "Creation tools"**. Our toolbar then has Figma's seven slots.~~ Done in U2.
6. ~~**Code menu**~~ (done in U1 and U2): move "Code snippet" and "Annotate" out (Figma has Code and Spec only). Rename "Annotate" to **Annotation** with Shift+T.
7. **Mode switcher order and names**: Draw, Design, Motion, Dev Mode; consider renaming the Inspect tab to Dev Mode, or keep Inspect and note the difference.
8. ~~**Rename "quick actions" to Actions** and add an Actions button to the toolbar.~~ Done in U3.
9. **Add Selection colors** to the Design tab (Figma shows it for any multi-colour selection).
10. **Restructure Position / Layout**: split X/Y/rotation and alignment into a **Position** section; put auto layout's Flow (Freeform / Vertical / Horizontal / Grid) and Dimensions into **Layout**.
11. **Move the toolbar to the bottom centre** with the mode switcher at its right end, and put Present / Share / zoom at the top of the right panel. This is the biggest visual difference.
12. ~~**Add a main menu** (logo button)~~ Done in U3, except Flip, Outlines and Pixel preview: with File / Edit / View / Object / Text / Arrange / Vector / Preferences. That gives a home to missing commands: Tidy up, Flip, Rotate, Copy/Paste properties, Select matching layers, Outlines, Pixel preview.
13. **Motion**: name the property section **Transform** (Position, Scale, Rotation) with ◇ buttons beside the normal fields, and add **Add motion** to the right-click menu.
14. **Left navigation rail** (File, Assets, Variables): larger change; it moves Assets out of the left-panel tabs and Variables out of the right panel.
15. Dev Mode extras: Ready for dev, Compare changes, Measurement tool (Shift+M).

Not worth copying: Figma's AI entries (Agents, Prototype with Agent, Actions AI prompts, Build this with code), Widgets, Publish library / branches (plan features).
