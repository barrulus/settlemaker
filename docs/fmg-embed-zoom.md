# How FMG zooms the embedded /fmg preview — the contract settlemaker must keep

FMG's burg editor (Fantasy-Map-Generator, since commit `04a186af`, cap raised to
32× in `d5f9dd8c`) embeds `/fmg?i=…` in a sandboxed iframe and gives the user
wheel-zoom (up to 32×), drag-pan, double-click zoom, and reset. This note explains
the mechanism, the contract it relies on, and the one improvement that belongs on
the settlemaker side.

## The mechanism: layout zoom, not CSS scale

FMG does **not** use `transform: scale()` on the iframe. A cross-origin iframe is
composited as a raster texture, so CSS-scaling it blurs everything — including
SVG (this was tried and reverted). Instead FMG zooms by **resizing the iframe's
layout**: at zoom factor `k` the iframe becomes `k·100%` of the ~pane size
(pane ≈ 560×320 css px, varies with dialog width) and is panned with negative
`left/top` offsets inside an `overflow: hidden` container. This is the same
mechanism as settlemaker's own `review.html` zoom slider.

Consequence: at 32× on a 320px pane the iframe's layout viewport is ~10,000 px
tall and the whole document re-renders at that size on every zoom step.

## The contract /fmg must keep

1. **The rendered SVG must keep scaling with the viewport, unbounded.** Today
   this holds: the generated root `<svg>` carries only a `viewBox` (no
   width/height attributes, `assemble-svg.ts`), and `style.css` sizes it
   `width/height: 100%`. Any future change that pins the SVG to fixed pixel
   dimensions, adds a `max-width`/`max-height`, or fits the town once via JS at
   load will silently break FMG's zoom (it would just show a bigger letterbox).
2. **Render must stay pure CSS-scaling on resize** — no JS resize listener is
   required (and none should be added for zoom's sake): the SVG re-lays-out for
   free. If a resize listener ever *regenerates* content by viewport size, note
   that FMG will trigger it dozens of times per zoom gesture.
3. **Keep the page free of viewport-sized chrome.** Anything positioned relative
   to the viewport (footers, badges, fixed overlays) would scale/pan with the
   zoom and float over the town. The current page renders nothing but the SVG —
   keep it that way (the license comment in `fmg.html` already records why).

## Why watabou currently "zooms deeper" than settlemaker

Nothing is capped — it's the starting fit. `web/src/main.ts` sets
`preserveAspectRatio="xMidYMid meet"`, so the **entire viewBox** (town plus its
surrounding field belt / margins) letterboxes inside the pane. In FMG's wide,
short pane the town is height-constrained and starts small; 32× multiplies that
small start. Watabou fills its canvas edge-to-edge, so its starting scale — and
therefore every zoom level — looks larger.

## The settlemaker-side improvement worth making

**Tighten the viewBox padding around the settlement** (or make the margin a
render option FMG can request via the URL). The viewBox is computed from the
geometry bounds in `assemble-svg.ts`; if that includes a generous empty belt,
every FMG zoom level wastes that fraction of the pane. This raises the starting
scale while still showing the whole town at 1× — strictly better for the embed.

A stronger variant — switching to `preserveAspectRatio="xMidYMid slice"` — would
fill the pane edge-to-edge like watabou, but crops the town at 1×, which is the
wrong default for a preview. If desired, expose it as a URL option (e.g.
`fit=cover`) rather than changing the default; FMG could then opt in.

## Reference

- FMG embed code: `src/controllers/burg-editor.ts` (`applyPreviewTransform`,
  `updateBurgPreview`) and `src/utils/panZoomUtils.ts` (clamped pan/zoom math,
  `MAX_ZOOM = 32`).
- FMG design doc: `docs/superpowers/specs/2026-08-09-burg-preview-zoom-design.md`
  in the Fantasy-Map-Generator repo.
