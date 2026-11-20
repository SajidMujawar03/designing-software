# Figma Clone — Implementation Plan

A browser-based, collaborative vector design tool. This plan covers the stack, the architecture, the data model, and nine phases. Each phase ends with something you can run and use.

---

## 1. Goals and scope

**In scope (the full product):**
- An infinite canvas with pages, frames, shapes, vector paths, text and images
- Selecting, transforming, grouping, aligning, snapping and smart guides
- Fills, strokes, gradients, effects (shadow, blur), blend modes and masks
- Components, instances, overrides and variants
- Auto layout and constraints
- Real-time multiplayer: live cursors, presence, comments
- Projects, files, version history and sharing permissions
- Export to PNG, JPG, SVG and PDF, plus a code-inspect panel
- Prototyping: links between frames, transitions, and a present mode
- A plugin API (late phase)

**Out of scope (for now):** FigJam whiteboard, Dev Mode, Slides, native desktop app (a PWA covers this), importing `.fig` files.

---

## 2. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) everywhere | One language and shared types across client and server |
| Monorepo | pnpm workspaces + Turborepo | Shared `document` package, fast builds |
| Front end | React 18 + Vite | The app chrome (panels, menus, dialogs) |
| UI state | Zustand | Light, fast, works outside React (tools, renderer) |
| Document state | **Yjs (CRDT)** from day one | Multiplayer, undo/redo, offline support and persistence come from one model; no rewrite later |
| Canvas rendering | **CanvasKit (Skia WASM)**, with Canvas2D as the first version | Skia gives Figma-grade paths, text, blend modes and effects; Canvas2D gets Phase 1 running fast behind the same renderer interface |
| Geometry | Own math library + `bezier-js`, `paper.js` boolean ops (or `clipper2`) | Hit-testing, bounds, boolean operations |
| Text | CanvasKit Paragraph API + font loading (Google Fonts) | Rich text, line breaking, mixed styles |
| Real-time server | Node + Hocuspocus (Yjs WebSocket server) | Sync, awareness (cursors), auth hooks, persistence hooks |
| API server | Node + Fastify + tRPC | Auth, files, teams, sharing, comments |
| Database | PostgreSQL + Drizzle ORM | Users, teams, projects, files, permissions, comments |
| Binary storage | S3-compatible (MinIO locally) | Images, Yjs snapshots, thumbnails, exports |
| Auth | Lucia / Auth.js (email + Google OAuth) | Sessions, OAuth |
| Testing | Vitest (unit), Playwright (end-to-end + visual snapshots) | Rendering correctness needs pixel tests |
| Local dev | Docker Compose (Postgres, MinIO, Redis) | One command to start everything |
| Deployment | Front end on Vercel/Cloudflare; servers on Fly.io/Render | Long-lived WebSockets need a real server |

---

## 3. Repository layout

```
figma-clone/
├─ apps/
│  ├─ web/                 # React editor + dashboard
│  │  └─ src/
│  │     ├─ editor/
│  │     │  ├─ canvas/      # renderer, viewport, hit-testing
│  │     │  ├─ tools/       # select, frame, rect, pen, text, hand…
│  │     │  ├─ interactions/# drag, resize, rotate, snapping, guides
│  │     │  ├─ panels/      # layers, properties, assets, inspect, prototype
│  │     │  ├─ toolbar/
│  │     │  └─ shortcuts/
│  │     ├─ dashboard/      # files, projects, teams
│  │     └─ store/          # Zustand UI stores
│  ├─ api/                 # Fastify + tRPC
│  └─ realtime/            # Hocuspocus server
├─ packages/
│  ├─ document/            # node schema, Yjs bindings, operations (shared)
│  ├─ geometry/            # matrices, bounds, paths, boolean ops
│  ├─ layout/              # auto layout + constraints engine
│  ├─ renderer/            # renderer interface, Canvas2D + CanvasKit backends
│  ├─ export/              # SVG / PNG / PDF exporters
│  └─ ui/                  # shared React components (inputs, color picker…)
├─ docker-compose.yml
└─ PLAN.md
```

---

## 4. Core architecture

```
 ┌──────────── Browser ────────────────────────────────────────┐
 │  React panels ──read/write──► Document (Y.Doc)              │
 │       ▲                          │  observe changes           │
 │       │                          ▼                            │
 │  Zustand UI store ◄── Tools ──► Scene graph cache ──► Renderer│
 │  (selection, tool,     (pointer   (world transforms,  (Canvas │
 │   viewport, hover)     events)     bounds, spatial     Kit)   │
 │                                    index R-tree)              │
 └──────────────────────────┬──────────────────────────────────┘
                            │ Yjs updates + awareness (WebSocket)
                 ┌──────────▼──────────┐        ┌──────────────┐
                 │ Realtime (Hocuspocus)├──────►│ Postgres / S3 │
                 └─────────────────────┘        └──────▲───────┘
                                                       │
                 ┌─────────────────────┐               │
                 │ API (Fastify+tRPC)  ├───────────────┘
                 └─────────────────────┘
```

**Rules:**
1. **The Y.Doc is the only source of truth for the design.** UI state (selection, tool, zoom, hover) lives in Zustand and never goes into the document.
2. **Every edit is a named operation** in `packages/document/ops` (for example `createNode`, `setProps`, `reparent`, `reorder`, `deleteNodes`). Each runs inside one `doc.transact()`. That gives one undo step per user action and makes edits testable.
3. **The scene graph cache** is rebuilt incrementally from Yjs change events. It holds world matrices, bounds and an R-tree (`rbush`) for hit-testing and viewport culling.
4. **The renderer only draws.** It reads the scene cache and the viewport, redraws dirty regions on `requestAnimationFrame`, and never mutates state.
5. **Tools are state machines** (idle → pointerDown → dragging → commit/cancel). They show a preview while dragging and commit to the document once on pointer-up.

---

## 5. Document model

```ts
type NodeId = string; // nanoid

interface BaseNode {
  id: NodeId;
  type: 'DOCUMENT' | 'PAGE' | 'FRAME' | 'GROUP' | 'RECTANGLE' | 'ELLIPSE'
      | 'POLYGON' | 'STAR' | 'LINE' | 'VECTOR' | 'TEXT' | 'IMAGE'
      | 'BOOLEAN' | 'COMPONENT' | 'COMPONENT_SET' | 'INSTANCE' | 'SECTION';
  name: string;
  parentId: NodeId | null;
  index: string;              // fractional index for ordering (no conflicts in multiplayer)
  visible: boolean;
  locked: boolean;
  // transform (relative to parent)
  x: number; y: number; width: number; height: number; rotation: number;
  flipX: boolean; flipY: boolean;
  // appearance
  opacity: number;
  blendMode: BlendMode;
  fills: Paint[];             // SOLID | LINEAR | RADIAL | ANGULAR | DIAMOND | IMAGE
  strokes: Paint[];
  strokeWeight: number; strokeAlign: 'INSIDE' | 'CENTER' | 'OUTSIDE';
  strokeCap, strokeJoin, dashPattern: number[];
  effects: Effect[];          // DROP_SHADOW | INNER_SHADOW | LAYER_BLUR | BACKGROUND_BLUR
  cornerRadius: number | [number, number, number, number];
  isMask: boolean;
  constraints: { horizontal: Constraint; vertical: Constraint };
  exportSettings: ExportSetting[];
  reactions: Reaction[];      // prototyping
}
// Type-specific fields: FRAME (clipsContent, layoutMode, padding, itemSpacing…),
// TEXT (characters, styleRuns[], textAutoResize…), VECTOR (vectorNetwork),
// INSTANCE (componentId, overrides), BOOLEAN (operation), IMAGE (imageHash).
```

**How it is stored in Yjs:**
- `doc.getMap('nodes')`: `NodeId → Y.Map` of properties. Nodes are a flat map, not a tree, so moving a layer is one field change.
- The tree comes from `parentId` plus a fractional `index`, so two users can reorder at the same time without conflicts.
- Text content is `Y.Text`, so two people can edit the same text box.
- `doc.getMap('styles')`, `doc.getMap('components')`, `doc.getMap('variables')` hold shared styles, components and design tokens.
- Images are stored in S3 by content hash; the document only stores the hash.

---

## 6. Phases

Rough estimates assume one full-time developer. Each phase ends with a demoable build.

### Phase 0 — Foundation (week 1)
- Monorepo, TypeScript, ESLint, Prettier, Vitest, Playwright, CI (GitHub Actions)
- Docker Compose for Postgres and MinIO
- `packages/geometry`: `Mat2D`, `Rect`, `Vec2`, bounds union, point-in-shape
- `packages/document`: node types, Yjs schema, the first operations and their unit tests
- **Done when:** `pnpm dev` starts an empty editor shell and the tests pass in CI.

### Phase 1 — Canvas and basic shapes (weeks 2–4)
- Viewport: pan (space+drag, middle mouse, trackpad), zoom (ctrl+wheel, pinch, `Shift+0/1/2`), zoom to fit and zoom to selection
- Canvas2D renderer behind the `Renderer` interface; HiDPI support; viewport culling
- Tools: Select (V), Frame (F), Rectangle (R), Ellipse (O), Line (L), Text (T, single style), Hand (H)
- Selection: click, shift-click, marquee, select inside frames, double-click to go into groups
- Transform handles: move, resize (Shift keeps aspect ratio, Alt resizes from center), rotate, arrow-key nudge
- Undo/redo with `Y.UndoManager`; copy, paste, duplicate, delete
- Layers panel: tree, rename, reorder by drag and drop, hide, lock
- Properties panel: position, size, rotation, fill color, stroke, opacity, corner radius
- Saving in the browser with `y-indexeddb`
- **Done when:** you can draw, edit and arrange shapes; a reload keeps the work.

### Phase 2 — Real editor feel (weeks 5–7)
- Snapping to edges, centers and pixel grid; smart guides with distance labels; equal-spacing hints
- Align and distribute; tidy up
- Group and ungroup (Ctrl+G); frames that clip; nested frames; frame presets (phone, desktop)
- Layer reparenting by dragging shapes into frames on the canvas
- Pages (create, rename, switch)
- Right-click context menu; full keyboard shortcut map; command palette (Ctrl+/)
- Rulers and guides
- **Done when:** laying out a screen feels close to Figma.

### Phase 3 — Vectors, paint and effects (weeks 8–11)
- Switch the renderer to **CanvasKit** (Canvas2D stays as a fallback and for tests)
- Pen tool (P) and pencil; vector networks; edit mode for points, bezier handles, corners
- Polygon and star tools; boolean operations (union, subtract, intersect, exclude); flatten; outline stroke
- Paints: multiple fills, linear/radial/angular/diamond gradients with an on-canvas gradient editor, image fills (fill, fit, crop, tile)
- Strokes: inside/center/outside, dashes, caps, joins
- Effects: drop shadow, inner shadow, layer blur, background blur; blend modes; masks
- Color picker with eyedropper, hex/RGB/HSL, document colors
- Image import by drag and drop and paste
- **Done when:** you can draw an icon from scratch and style it fully.

### Phase 4 — Text (weeks 12–13)
- Rich text with CanvasKit Paragraph: mixed fonts, weights, sizes, colors in one box
- Font picker with Google Fonts and local fonts (Local Font Access API)
- Auto width, auto height, fixed size; alignment; line height; letter spacing; lists; text case and decoration
- An on-canvas text editor: caret, selection, IME input, copy and paste
- Text styles, color styles and effect styles (shared styles panel)
- **Done when:** text editing feels native and uses shared styles.

### Phase 5 — Layout (weeks 14–16)
- Constraints (left, right, left and right, center, scale) applied when a parent frame resizes
- **Auto layout** in `packages/layout`: horizontal, vertical and wrap direction; padding; gap; alignment; hug/fill/fixed sizing; absolute-position children; min/max size
- Layout grids (columns, rows, grid)
- **Done when:** a button resizes with its label and a list grows with its content.

### Phase 6 — Components (weeks 17–20)
- Create a component (Ctrl+Alt+K); instances that update live; detach instance
- Overrides (text, fills, visibility, nested instances) that survive component updates
- Variants and component properties (boolean, text, instance swap, variant)
- Assets panel; team libraries (publish and subscribe across files)
- Variables (color, number, string, boolean) with modes, such as light and dark
- **Done when:** a small design system can be built and reused across files.

### Phase 7 — Back end and multiplayer (weeks 21–24)
- Auth (email + Google), users, teams, projects, files, permissions (owner, editor, viewer)
- Dashboard: recent files, projects, thumbnails, search, trash
- Hocuspocus server: Yjs sync, Postgres persistence (snapshots + update log), auth on connect
- Awareness: live cursors with names, others' selections, avatars in the toolbar, follow mode
- Comments: pins on the canvas, threads, mentions, resolve
- Version history: named versions, autosave checkpoints, restore
- Share dialog with link permissions
- Offline editing with sync when the connection returns
- **Done when:** two browsers edit the same file live with cursors and comments.

### Phase 8 — Export, inspect and prototype (weeks 25–27)
- Export settings per layer: PNG/JPG at 1x–4x, SVG, PDF; batch export; copy as PNG/SVG
- Inspect panel: CSS, iOS and Android code; measurements between layers on hover
- Prototyping: connections between frames (on click, hover, after delay), transitions (instant, dissolve, smart animate, slide), scroll behavior, overlays
- Present mode in a new tab, with a device frame
- **Done when:** a clickable prototype can be shared and assets exported.

### Phase 9 — Performance, polish and plugins (weeks 28+)
- Performance: render in a Web Worker with `OffscreenCanvas`; tile cache; level of detail at low zoom; target 60 fps with 10,000+ nodes
- Large-file loading: lazy-load pages
- Accessibility of the app chrome, theming (light/dark), onboarding
- Plugin API: sandboxed iframe + message-based API that mirrors the document operations
- Hardening: error reporting (Sentry), document migrations, load tests on the realtime server
- **Done when:** large files stay smooth and third parties can write plugins.

---

## 7. Hard problems and how they are handled

| Problem | Approach |
|---|---|
| Multiplayer conflicts | Yjs CRDT; flat node map; fractional indexes for ordering; a check that repairs cycles if two users reparent into each other |
| Undo in multiplayer | `Y.UndoManager` scoped to the local user's transactions only |
| Rendering speed | Dirty-rect redraws, R-tree culling, cached pictures (`SkPicture`) per node, worker rendering |
| Text quality | CanvasKit Paragraph (HarfBuzz shaping) instead of Canvas2D text |
| Boolean ops on curves | `paper.js` path booleans, or `clipper2` on flattened curves for speed |
| Component overrides | Overrides stored by a path of node IDs in the instance, applied when the instance tree is resolved |
| Auto layout | A dedicated, pure layout pass that runs before render and writes computed sizes into the scene cache, not the document |
| Pixel-identical export | One renderer for screen, PNG and PDF (CanvasKit has a PDF backend); SVG has its own serializer |

---

## 8. Testing

- **Unit (Vitest):** geometry, every document operation, the layout engine, override resolution, SVG export
- **Rendering (Playwright):** draw a reference file and compare screenshots against stored images
- **End-to-end (Playwright):** draw, transform, undo, reload, two-browser multiplayer
- **Performance:** a benchmark file with 10,000 nodes; frame time tracked in CI

---

## 9. Milestones

| Milestone | After phase | What you have |
|---|---|---|
| **M1 — Local editor** | 2 | Single-user editor that saves in the browser |
| **M2 — Design tool** | 5 | Vectors, effects, rich text, auto layout |
| **M3 — Design system** | 6 | Components, variants, styles, variables |
| **M4 — Collaborative product** | 7 | Accounts, sharing, live multiplayer, comments, history |
| **M5 — Feature-complete** | 9 | Export, inspect, prototyping, performance, plugins |

---

## 10. First steps

1. Set up the monorepo, tooling and CI (Phase 0).
2. Write `packages/document` with its Yjs schema and operations, test-first.
3. Build the viewport and Canvas2D renderer, then the Rectangle and Select tools.
4. Add the layers and properties panels, then undo/redo and browser saving.
