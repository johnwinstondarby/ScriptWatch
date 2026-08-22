# Segmented Dial SVG Contract v0.1

**Asset:** `dashboard/instruments/segmented-dial.svg`
**Status:** v0.1 — interface frozen for compositor development.
**Scope:** artwork only. The SVG owns appearance. ScriptWatch owns value, condition,
freshness, change events, and all animation timing.

---

## 1. Coordinate convention

`viewBox="0 0 200 200"`. Centre is `100,100`. All rotations use `rotate(θ 100 100)`.

Key radii, for anyone editing the artwork:

| Element | Radius |
|---|---|
| Housing outer | 92 |
| Housing inner / well edge | 78 |
| Activity tracer ring | 76 |
| Segment tip | 74 |
| Segment root | 56 |
| Scale tick ring | 50.5 – 53.5 |

Segments span a **260° sweep** beginning at **140°** (SVG degrees, +x axis, y down),
which places the gap at the bottom. Segment *i* sits at `140 + 260·(i/35)`.

---

## 2. Public interface

Seven top-level IDs. These are stable across artwork revisions.

| ID | Role |
|---|---|
| `housing` | Static instrument body and bezel. Carries the only expensive filter. |
| `well` | Recessed face, inner shadow, and instrument scale ticks. Static. |
| `face-off` | Complete unlit segment ring. 36 children. Always visible. |
| `bloom` | Emissive copy of the lit ring. 36 children. Beneath `face-lit`. |
| `face-lit` | Complete illuminated segment ring. 36 children. |
| `activity` | Source-liveness carrier. Value-independent. |
| `glint` | Value-change acknowledgement. Invisible at rest. |

Internal IDs (`seg-shape`, `grad-*`, `fx-*`) are implementation detail and may change.

---

## 3. Segment order rule

`face-lit` and `bloom` each expose **exactly 36 direct children**, ordered

```
child 0  = lowest value segment
child 35 = highest value segment
```

Intended compositor behaviour:

```js
const lit   = faceLit.children;         // 36
const bloom = bloomGroup.children;      // 36, same order
const n     = Math.round(value / 100 * 36);
for (let i = 0; i < 36; i++) {
  const on = i < n;
  lit[i].setAttribute("visibility",   on ? "visible" : "hidden");
  bloom[i].setAttribute("visibility", on ? "visible" : "hidden");
}
```

`face-off` also has 36 children in the same order, but the compositor should not
need to touch them. The unlit ring stays visible at all values, so the boundary
between lit and unlit reads as instrument scale rather than as missing artwork.

---

## 4. Default state — read this before wiring the compositor

**All 36 `face-lit` and `bloom` children ship with `visibility="hidden"`.**

An uninitialised instrument therefore displays zero illuminated segments, not 36.
This is deliberate. If the compositor fails to load or a source never reports, the
dial must not render a confident 100%. A dial that defaults to full is the same
class of defect as a counter that shows `0` when it has never been sampled.

Consequence: **the compositor must set visibility on init**, not only on change.

The instrument still reads as complete at zero — housing, well, scale ticks, unlit
ring, and the activity carrier are all present and independent of value.

---

## 5. Layer roles in detail

### housing
Static. Carries `filter="url(#fx-bezel)"`, an `feSpecularLighting` chain producing a
genuine specular response from the alpha channel rather than a gradient imitating a
bevel. **Never animate this layer and never apply this filter to anything that changes
per frame.**

The filter declares `color-interpolation-filters="sRGB"`. Without it the default
linearRGB pipeline washes the specular highlight out to near-invisibility. If the
bezel ever looks flat after an edit, check this attribute first.

### well
Static. Recessed face gradient, inner shadow ring, and the instrument scale: five
major ticks at 0 / 25 / 50 / 75 / 100 and fifteen minor ticks. Ticks live here rather
than in `face-off` so the compositor can iterate `face-off` children by index without
tripping over non-segment geometry.

### face-off
The unlit ring. Subtly graded, dark at the root and marginally lighter at the tip, so
the ring shows structure without competing with lit segments.

### face-lit
Per-segment gradient running dark root → saturated body → pale tip, which is what
produces "lit from within" rather than "filled with green". The gradient is defined
once in `objectBoundingBox` space on `#seg-shape`; each `<use>` rotates it into place,
so the ramp stays radially correct at every angle.

v0.1 ships the nominal green ramp only. Condition colour substitution (amber, orange,
red, grey) is a later revision — the compositor should swap the `fill` on the
`face-lit` group, not on individual children.

### bloom
A blurred emissive copy beneath `face-lit`, group opacity `0.5`, `mix-blend-mode: screen`.

The blur is applied **once to the group**, not per child. Toggling child visibility
re-runs the filter, but that happens at telemetry cadence (well under 1 Hz), never per
animation frame. Do not move this filter onto individual segments.

To disable bloom entirely, set the group's `opacity` to `0` — opacity is applied after
filtering, so this costs nothing.

### activity
A short luminous arc on the r=76 ring, soft-ended by gradient rather than by blur.
**It carries no filter on purpose**, so the compositor can `rotate(θ 100 100)` it every
frame without triggering a filter recomputation.

Requirements it satisfies: visible at value zero, independent of `face-lit`, cheap to
transform, no embedded animation. The compositor decides when and how fast it moves,
and stopping it is what expresses a dead source.

### glint
A 52° band across the value ring, `opacity="0"` at rest, `mix-blend-mode: plus-lighter`.
Reserved for **value-change acknowledgement**, which is distinct from source liveness.

Transform and opacity only. An unchanged metric should simply not fire it; absence of a
glint must not read as staleness, because staleness is `activity`'s job.

---

## 6. Rules that must survive future artwork revisions

1. Seven public IDs, unchanged.
2. 36 direct children in `face-lit` and `bloom`, ordered low to high.
3. No `<text>`, no fonts, no raster, no external references, no `<script>`, no SMIL.
4. No autonomous animation of any kind. Opening the file must produce a still image.
5. Expensive filters on static layers only.
6. Animatable layers respond to transform and opacity alone.
7. Lit geometry hidden by default.

If artwork ever requires breaking one of these, document the issue and revise the
contract before changing the file.

---

## 7. Export and editing guidance

If the artwork is regenerated from Illustrator:

- Export with **Styling: Presentation Attributes**, **Object IDs: Preserve**, and
  **Minify off**, then hand-check that the seven IDs survived.
- Illustrator will not author `feSpecularLighting`. Keep the `<defs>` block from this
  file and re-attach `filter="url(#fx-bezel)"` to the housing path after export.
- Illustrator flattens `<use>` into 36 duplicated paths. That is acceptable as long as
  the 36 remain direct children in order, but the file grows and the per-segment
  gradient orientation must then be verified individually. Round-tripping through the
  generator is preferable for the segment rings.
- Strip `<metadata>`, `<sodipodi:*>`, and `data-name` attributes before commit.

---

## 8. Compatibility notes

- **Chromium and Firefox** render the full chain: specular bezel, screen-blended bloom,
  `plus-lighter` glint.
- **`mix-blend-mode` inside SVG** is applied via the `style` attribute rather than a
  presentation attribute, because presentation-attribute support is inconsistent.
- **Non-browser rasterisers** (cairosvg, librsvg, most SVG-to-PNG tooling) silently drop
  `feSpecularLighting` and `mix-blend-mode`. The instrument still renders, but flat.
  Do not use a server-side rasteriser to judge appearance.
- **Illustrator** does not display `feSpecularLighting`. The bezel will look flat in the
  editor and correct in the browser. This is expected.
- The dial is legible at 100 px, comfortable at 140 px, and holds detail at 400 px.
  Below roughly 90 px the minor scale ticks stop resolving; that is the practical floor.

---

## 9. Verification

`dial-verify.html` in the same folder loads the asset, drives it exactly as a compositor
would, and asserts the contract. It is a development aid rather than a shipped artefact.

It checks: the seven IDs, the viewBox, 36 children in each ring group, absence of text,
image, script and SMIL nodes, hidden-by-default lit geometry, and independence of
`activity` from `face-lit`. It renders the dial simultaneously at 100, 140, and 400 px.
