# F9: Motion timeline

This is the plan for phase F9 of [features-plan.md](features-plan.md). It follows **Figma Motion** (open beta), as described in Figma's help center (sources at the end). The goal is to match its model and behaviour, adapted to this codebase.

## 1. What Figma Motion does

### Mode and timeline
- **Motion mode** is a toolbar toggle beside Design. Only people who can edit the file can use it.
- The **timeline** sits across the bottom of the screen and only shows in Motion mode. Its controls, from left to right:
  - Play/Pause (Space)
  - the auto-keyframe toggle (a red bar across the timeline and the playhead while it's on)
  - the current time (type to jump)
  - the duration (default **2000 ms**; type it, or drag the handle at the timeline's right end)
  - seconds or milliseconds
  - the playback mode (**Loop, Once, Ping-pong**; clicking cycles through them)
  - collapse all layers
- Resize the timeline by dragging its top edge, or collapse it. Zoom with a slider, a pinch, or Ctrl/Cmd plus the wheel.
- **Tracks:**
  - Each animated layer gets one **layer track**, with a row under it for each animated property.
  - Dragging the track moves all of the layer's animations; dragging its ends stretches them together.
  - Selecting a property row and pressing Delete removes all of that property's keyframes.

### Keyframes
- A keyframe is one property's value at a point in time. It takes at least two to animate, and Figma fills in the frames between them.
- Every property that can be animated shows a **diamond** beside its field in the right sidebar. Clicking it adds a keyframe at the playhead.
- **Auto-keyframe:** while it's on, any change (from the sidebar or a handle on the canvas) records a keyframe at the playhead.
- **Selecting:**
  - Unselected keyframes are outlined blue diamonds; selected ones are filled.
  - Click to select one; Shift-click or drag a marquee to select several.
  - Clicking a layer track selects all of its keyframes.
  - Double-clicking a keyframe moves the playhead to it, so you can edit its value in the sidebar.
- **Moving and deleting:**
  - Drag to move keyframes. Shift-drag snaps them to the playhead, which also lines them up with other keyframes.
  - Delete removes the selected keyframes.
- Keyframes farther apart mean slower motion.
- The documented properties are position, rotation, opacity and Motion's own **Scale X/Y in %**. The LottieFiles guide adds size, corner radius, stroke weight and solid colours as the ones that export reliably.

### Easing (click the line between two keyframes)
- **Bézier presets:** Linear, Ease in, Ease out, Ease in and out, Ease in back, Ease out back, Ease in and out back, and **Hold** (jumps at the next keyframe, with no in-between).
- **Custom Bézier:** a curve editor where x is time and y is progress. You drag the two handles or type `cubic-bezier(...)`. y outside 0–1 gives wind-up or overshoot, and clicking a corner point resets the curve.
- **Spring presets:** Gentle, Quick, Bouncy and Slow.
- **Custom spring:**
  - *Time-based:* bounciness and duration.
  - *Physics-based:* stiffness, damping and mass. Its length comes from the physics, so it may end before or after the next keyframe; the segment line shows where it really ends.
- Curves and springs can be saved as easing variables.

### Presets, styles and components
- **Preset animations:** "+" in the sidebar's **Animations** section adds a ready-made animation at the playhead. It's a clip you can drag, stretch, and change type, settings, duration and easing.
- **Composite styles** apply several presets at once. Newer: custom saved styles that can be published to a library.
- **Animated components:**
  - Instances show as **purple tracks**.
  - An instance can be dragged along the timeline (to stagger copies), but its timing and animation are locked to the main component.

### Export and handoff
- Only **top-level frames** export as animations; they carry a Motion icon. Animated layers must be inside one.
- **Animated export** goes in the Export section's Animated tab, as **MP4, WebM, GIF or SVG**. Options: size, frame rate, quality (MP4/WebM) and loop (GIF). Lottie and dotLottie export were added later; shaders, video and angular gradients don't carry over, and shadows and blur stay static.
- **Dev Mode handoff:**
  - The Inspect panel has a **Motion tab** with a read-only timeline.
  - **Code** copies the animation as CSS (default), React or JSON.
  - The MCP server shares keyframes and easing.
- **Newer additions:** audio tracks, animating text by character, word or line, time-stamped comments, and the Figma agent drafting keyframes.

## 2. What we build, and what we don't (yet)

| In F9 | Later | Not planned |
|---|---|---|
| Motion mode and the timeline, play/scrub, duration, Loop/Once/Ping-pong, ms/s, zoom | Preset animations and composite styles (M5) | Audio tracks |
| Keyframes on 12 properties: position, rotation, scale X/Y, opacity, width, height, corner radius, fill colour, stroke colour, stroke weight, blur | Animated component instances and stagger (M5) | AI-drafted keyframes |
| Auto-keyframe, the diamond in the sidebar, select, marquee, move, snap to playhead, delete | Text by character/word/line (M5) | Shaders |
| All easing presets, custom Bézier, springs (presets, time-based, physics) | Lottie/dotLottie (M7) | Time-stamped comments (can reuse comments later) |
| MP4, WebM and GIF export of top-level frames | Animated SVG (M7) | |
| Presenter plays a frame's timeline; Inspect Motion tab with CSS/JSON code | Easing variables (with the variables system) | |

## 3. Data model

All new fields are optional, so there's **no schema bump**. This is the same approach as F6–F8. An older app ignores the fields and shows each layer's own values, which are its static design, so files stay safe to open. (The outline in features-plan.md guessed v6; it isn't needed.)

```ts
// The timeline belongs to a top-level frame (what Figma exports), as in Figma.
interface MotionTimeline {
  duration: number;            // ms, default 2000
  playback: 'LOOP' | 'ONCE' | 'PING_PONG';
}
SceneNode.motion?: MotionTimeline | null;            // only on top-level frames

// Keyframes live on the animated layer itself (any depth inside that frame).
type MotionProperty =
  | 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'opacity'
  | 'width' | 'height' | 'cornerRadius'
  | 'fillColor' | 'strokeColor' | 'strokeWeight' | 'blur';

interface Keyframe {
  id: string;
  time: number;                // ms from the timeline start
  value: number | string;      // colours as hex RGBA
  /** Easing of the segment from this keyframe to the next. */
  easing: MotionEasing;
}

type MotionEasing =
  | { type: 'LINEAR' | 'EASE_IN' | 'EASE_OUT' | 'EASE_IN_AND_OUT'
          | 'EASE_IN_BACK' | 'EASE_OUT_BACK' | 'EASE_IN_AND_OUT_BACK' | 'HOLD' }
  | { type: 'BEZIER'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'SPRING'; preset?: 'GENTLE' | 'QUICK' | 'BOUNCY' | 'SLOW';
      mode: 'TIME' | 'PHYSICS';
      bounce?: number; duration?: number;              // TIME
      stiffness?: number; damping?: number; mass?: number }; // PHYSICS

SceneNode.keyframes?: Partial<Record<MotionProperty, Keyframe[]>> | null;
```

**Rules:**
- **Base values:** a layer's normal fields are its **design (rest) state**. A property with keyframes takes its value from them: before the first keyframe it holds the first value, and after the last it holds the last.
- **x/y:** keyframes store absolute positions in the parent (as the sidebar shows them). Playback uses the difference from the base position as a **visual offset**, so auto layout isn't re-run every frame. That also means animating a child of an auto layout frame works, as it does in Figma.
- **Width and height** are visual only during playback; they don't re-flow parents or re-fit text, in this version. Scale X/Y (%) is Motion's own property, around the layer's centre. It has no base field and its rest value is 100%.
- **Fill and stroke colour** animate the top solid paint. Gradients and images keep their values; that's the documented Lottie limitation too.
- **Default easing:** new segments use Ease in and out. This is a choice of ours; Figma doesn't document its default.
- **Pure functions** in `packages/document/src/motion.ts`:
  - `sampleEasing(e, k)`: the 8 presets as cubic-béziers; back variants via y outside 0–1; HOLD as a step.
  - `springAt(e, tMs)`: a damped harmonic oscillator. Time mode maps bounce and duration to stiffness and damping; physics mode reports its settle time for drawing the segment line.
  - `valueAt(n, prop, t)` and `poseAt(doc, frameId, t) → Map<NodeId, NodePatch>`.
  - `timelineTime(motion, elapsed)`: maps elapsed time through Loop, Once or Ping-pong.

## 4. Playback without changing the document

The renderers read nodes through `doc.get` and `doc.children` (about 16 call sites across CanvasKit, Canvas 2D and SVG).

1. **A posed view:** `posedDocument(doc, pose)` returns a read-only view of the document. Its prototype is the document; it overrides `get`, `children`, `ancestors` and `descendants` to return posed nodes. The renderers, `worldTransform`, bounds and exports all read through the same methods, so the view needs **no changes in the renderers**. Built in M1, replacing the earlier idea of a `pose` option on `SceneOptions`.
   - Offsets and rotation are ordinary fields. Scale X/Y are pose-only fields (`motionScaleX/Y`) that `localTransform` applies around the box centre.
   - Opacity, size, radius, colours, stroke and blur are ordinary fields.
2. **Caches:** the view reports a new `subtreeVersion` for any subtree holding a posed layer, so raster and picture caches redraw it. Path and paragraph caches are already keyed by content.
3. **The clock:** a `MotionPlayer` in the web app keeps `{ playing, time, frameId }` in the UI store. Each `requestAnimationFrame` advances the time and requests a canvas redraw with `pose = poseAt(doc, frameId, time)`. Scrubbing sets the time. **Nothing goes into the document or undo history.**
4. **Leaving Motion mode** clears the pose, so the canvas shows the design state again.
5. **Performance target:** 60 fps for a frame with 50 animated layers. `poseAt` only visits nodes that have keyframes; the frame's animated ids are indexed when the document changes.

## 5. Editing

- **Motion mode** (`ui.motionMode`) is a third toolbar choice next to Design and Draw. Turning it on picks the selected top-level frame (or the one under the selection), creating its `motion` with the defaults. It also shows the **Timeline** panel at the bottom of the canvas area, a resizable dock.
- **Timeline panel** (`panels/Timeline.tsx`, drawn with DOM and CSS, no canvas):
  - Header: Play/Pause, auto-keyframe, current time, duration (field, plus a drag handle on the ruler), ms/s, playback mode, collapse all.
  - Body: a ruler with ms ticks, the playhead, and a layer track for each animated layer. Each track has a bar from its first to last keyframe (drag to shift it), with property rows under it holding diamonds and the segment lines between them. Dragging the bar's ends to stretch the timing is not built yet.
  - Zoom slider; Ctrl/Cmd plus the wheel zooms.
- **Properties panel:** fields show values at the playhead, and edits follow the rules below. Built in M3 as an **Animate** section listing every animatable property with its diamond and value (including Scale X/Y, which has no design field), rather than a diamond on each existing field. The diamond is empty with no keyframes, half-filled when the property is animated, and filled when there's a keyframe at the playhead; clicking it adds a keyframe holding the current value, or removes the one at the playhead.
- **Editing a value in Motion mode:**
  - Auto-keyframe on: writes or updates a keyframe at the playhead.
  - Off, and the property has a keyframe at the playhead: updates that keyframe.
  - Off, and the property is animated with no keyframe here: shows a hint ("Turn on auto-keyframe or add a keyframe") and changes nothing.
  - Off, and the property isn't animated: changes the design value, as in Design mode.
  - Moving or rotating on the canvas follows the same rules (this covers Figma's on-canvas auto-keyframe handle).
- **Selecting keyframes:**
  - Click; Shift-click; marquee.
  - Click a track to select all its keyframes.
  - Double-click to move the playhead there.
- **Moving and deleting:**
  - Drag with snapping to the playhead, other keyframes and 10 ms steps; Shift-drag snaps to the playhead.
  - Delete removes the selected keyframes; Delete on a selected property row removes them all.
  - Ctrl/Cmd+C and V copy and paste keyframes at the playhead. Figma doesn't document this; we add it because it's cheap.
- **Easing popover:** opens from a segment line.
  - The list of presets.
  - A **curve editor** (SVG): two draggable handles, y can go outside 0–1, a `cubic-bezier()` text field, and a corner click resets the curve.
  - A **spring** tab with Gentle, Quick, Bouncy and Slow, plus Time (bounce, duration) and Physics (stiffness, damping, mass), with a preview of the curve.
- **Undo:** every keyframe edit is one `doc.change` and undoes normally; scrubbing doesn't create undo steps.
- **Shortcuts** (new entries in `COMMANDS`, so the desktop menus get them):
  - Space: play/pause, in Motion mode while the canvas has focus.
  - Motion mode has no shortcut for now (Figma documents none, and Shift+M is the shape builder here). It's in the toolbar's mode switch and quick actions ("Motion mode").
  - Space: a tap plays or pauses; holding Space and dragging still pans.
  - K: add a keyframe for the property last edited.
  - `,` and `.`: step the playhead back and forward 1 frame at 60 fps.

## 6. Export

The Export panel gets an **Animated** tab when a top-level frame with `motion` is selected. Options: format (MP4, WebM, GIF), size (1x, 2x or custom), frame rate (24/30/60) and quality (MP4/WebM), plus loop (GIF).

**Pipeline:**
1. Draw each frame offscreen with the renderer at `pose = poseAt(t)`.
2. Pass it to `VideoEncoder` (WebCodecs; Chrome and Electron): **H.264** for MP4 via `mp4-muxer`, **VP9** for WebM via `webm-muxer`. GIF uses `gifenc`, which handles palette quantisation.
3. Run it in a progress dialog that can be cancelled.

The desktop app uses the same code (Electron is Chromium) and saves through the existing save dialog. If `VideoEncoder` is missing, MP4 and WebM are disabled with an explanation, and GIF still works.

**New dependencies** (small, MIT, pure JS): `mp4-muxer`, `webm-muxer`, `gifenc`.

## 7. Handoff and prototypes

- **Inspect panel:** a Motion tab for animated frames, with a read-only timeline (the Timeline component in a read-only mode) and **Code**.
  - **CSS** generates `@keyframes` per layer and property group, with `animation-timing-function` from the béziers. Springs become `linear()` easing samples. Playback maps to `animation-iteration-count` and `animation-direction: alternate`.
  - **JSON** is the timeline and keyframes as stored.
  - Copy button.
- **Presenter:** a screen whose frame has `motion` plays its timeline when it opens, using the playback mode. It uses the same `poseAt` with the presenter's renderer, and stops when you navigate away.

## 8. Milestones (each is one PR)

| # | What | Size |
|---|---|---|
| **M1** | Model and evaluation: types, `motion.ts` (easing, springs, keyframe values, `poseAt`, playback time), `posedDocument` for drawing poses, tests | 3–4 days |
| **M2** | Motion mode, the Timeline panel, playback and scrubbing, duration/playback/units, zoom, the read-only tracks | 4–5 days |
| **M3** | Keyframe editing: diamonds, auto-keyframe, value editing rules, select/marquee/move/snap/delete/copy, easing popover with the curve and spring editors | ~1 week |
| **M4** | Animated export: MP4, WebM, GIF, progress dialog, desktop save | 3–4 days |
| **M5** | Preset animations and composite styles, animated component instances (purple tracks, stagger, locked timing), text by character/word/line | ~1 week |
| **M6** | Inspect Motion tab (CSS/JSON code), the presenter plays timelines | 2–3 days |
| **M7** (optional) | Lottie JSON / dotLottie and animated SVG export | ~1 week |

M1–M4 make a complete, usable Motion feature (about 3 weeks). M5–M7 follow Figma's newer additions.

## 9. Testing

- **Unit tests:**
  - easing presets against known values; back overshoot; HOLD steps
  - springs settle to 1, and physics settle time vs damping
  - `valueAt` before, between and after keyframes, plus colour interpolation
  - Loop, Once and Ping-pong time mapping
  - `poseAt` with nested layers and auto layout children
- **Renderer tests:** a posed render matches a document edited to the same values (pixel diff on the Canvas 2D renderer). Bounds include scale and offset.
- **Editing tests:** the auto-keyframe rules, moving with snapping, delete, undo.
- **Export test:** encode 10 frames of a 64×64 timeline to WebM and GIF in a browser test, then check the file headers and frame counts.
- **Manual check in the browser** for each milestone, with a screenshot (or a short GIF from M4 onwards) in the PR.

## 10. Risks and open questions

- **Shortcut clash:** Shift+M (see section 5).
- **Raster caches** assume nodes only change through the document. Posed drawing must skip them (M1), or zoomed-out playback will show stale frames.
- **Collaboration:** keyframes are document data, so they sync. Playhead and playing state are per person (UI store), as in Figma.
- **Components:** keyframes on a main component's layers should reach instances (as overrides do). Until M5, Motion mode treats instance internals as read-only.
- **Very long timelines** at 60 fps and 2x export can be slow. The progress dialog and cancel cover this, and the custom-size limits mirror Figma's (above 1920×1080 or 30 fps is still allowed here, since there's no plan gating).

## Sources

- [Explore Figma Motion](https://help.figma.com/hc/en-us/articles/41274629073303-Explore-Figma-Motion)
- [Use the Figma Motion timeline](https://help.figma.com/hc/en-us/articles/41405906446999-Use-the-Figma-Motion-timeline)
- [Add, select, and delete keyframes](https://help.figma.com/hc/en-us/articles/41307938657559-Add-select-and-delete-keyframes)
- [Adjust an animation's easing](https://help.figma.com/hc/en-us/articles/41414048690839-Adjust-an-animation-s-easing)
- [Hand off animations to development](https://help.figma.com/hc/en-us/articles/41296356954263-Hand-off-animations-to-development)
- [Motion design fundamentals: Create a bouncy square animation](https://help.figma.com/hc/en-us/articles/41523076548503-Motion-design-fundamentals-Create-a-bouncy-square-animation)
- [Preset animation styles](https://help.figma.com/hc/en-us/articles/41307886266135)
- [Export animations](https://help.figma.com/hc/en-us/articles/41307983648407)
- [Animated components](https://help.figma.com/hc/en-us/articles/41307940738967)
- [Forum: Motion adds custom styles, audio, text animations and Lottie export](https://forum.figma.com/product-updates-3/motion-adds-custom-styles-audio-text-animations-and-lottie-export-58554)
- [LottieFiles: Figma Motion export](https://docs.lottiefiles.com/en/integrations/figma/04_figma-to-lottie/figma-motion-export)
