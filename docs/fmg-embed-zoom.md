# Embedding and zoom

This is guidance for an application hosting the [URL renderer](url-api.md), not
an API for controlling a cross-origin iframe after loading it. The npm package
generates SVG; the host page supplies layout, zoom, downloads and diagnostics.

## Responsive preview

Put the map in a viewport-sized container and scale the SVG with CSS using its
`viewBox`. City and village roots need not have identical size attributes. Size
the displayed element explicitly rather than assuming that generated width and
height attributes alone implement a responsive layout.

```css
html, body, #map { margin: 0; width: 100%; height: 100%; }
#map svg { display: block; width: 100%; height: 100%; }
```

Keep the full view box as the initial fit if the preview is intended to show the
entire settlement and its surrounding terrain. Cropping the frame is a host
presentation decision; it changes what is visible, not the generated settlement.
There is no `fit=cover` URL parameter in the current library parser.

## Host-owned navigation

A parent page can pan a larger iframe inside an overflow-hidden container. If it
uses layout resizing for zoom, the renderer should remain responsive to viewport
changes without regenerating the settlement. Regeneration on each resize can
block interaction and does not belong in zoom handling.

A host using its own SVG DOM can implement local pan/zoom directly. A cross-origin
iframe does not expose that DOM to its parent. This contract defines no
`postMessage` zoom, result, or automatic water-resurvey messages. Specific zoom
limits and input gestures are application choices, not engine guarantees.

## Diagnostics remain visible

A renderer must show parse/generation errors and measured-water warnings within
the page. Some embedded previews disable pointer events, so explanations must be
readable without hovering or clicking. Do not replace a failed measured-water map
with a plain dry map. Include required survey coverage when an error supplies it.

Map navigation and diagnostics need deliberate layout: a warning should remain
readable at the initial fit rather than being reduced to an unreadable part of a
zoomed map. The older expectation of an SVG-only page does not override the
measured-water diagnostic requirements.

## Multiple maps and tiles

Use separate image/iframe documents for independent maps. Inline SVGs can share
conflicting IDs even with different city `clipId` options. See the
[SVG embedding rules](scene-schema.md#embedding-svg) and
[local tile helpers](geojson.md#tiling). Preserve `data-bg="paper"` and village
scale metadata when post-processing output for those helpers.
