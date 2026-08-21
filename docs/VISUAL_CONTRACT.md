# ScriptWatch Visual Contract

**Status:** Draft visual contract for the instrument-console dashboard.

The ScriptWatch dashboard is a live operations console. Motion, color, and illumination communicate telemetry state and must remain semantically tied to data freshness.

## 1. Source-state vocabulary

| State | Color | Motion | Meaning |
|---|---|---|---|
| `LIVE` | green/cyan | active tracer / live lamp | fresh telemetry is arriving |
| `DORMANT` | amber | tracer stopped; optional slow lamp pulse | a source is expected or previously available, but fresh data is unavailable |
| `FAULT` | red | stopped | a known source/process/dashboard failure exists |
| `UNSUPPORTED` | neutral gray | none | the source or counter is absent by design for this job/backend |

A last-known numeric value may remain visible in `DORMANT` or `FAULT` state, but the instrument state must make clear that the value is not fresh.

Amber is therefore a data-confidence state. It does not assert that the measured subsystem is itself unhealthy.

## 2. Motion contract

Instrument motion is data-driven.

- Fresh collector samples keep process/host instruments in the `LIVE` state.
- While `LIVE`, the outer segmented tracer may rotate continuously.
- When the sampler exceeds its stale threshold, the tracer stops and the instrument changes to amber.
- Known process exit or dashboard connection failure stops the tracer and changes the affected source to red.
- `prefers-reduced-motion` disables continuous animation without changing state color or text.

Perpetual decorative animation without a live source is prohibited.

## 3. Source bus

The console exposes the acquisition architecture as a source bus:

1. host telemetry;
2. InDesign process telemetry;
3. heartbeat telemetry;
4. ScriptWatch Harness telemetry.

Each source has its own lamp and state label. A process-only job can therefore show host/process as live, heartbeat as amber/no data, and Harness as neutral/not published.

## 4. Instrument families

The visual layer uses a small reusable instrument vocabulary:

- segmented bounded dial for CPU, RAM, commit, and job progress;
- counter capsule for raw counters and Harness metrics;
- vertical capacity meter for bounded headroom/capacity values;
- sparkline for historical movement;
- source lamp for acquisition health;
- telemetry lane/source bus for data-path state.

Not every value earns a dial. Dense counters remain compact and readable.

## 5. Truthfulness rules

- A visual instrument must use an existing authoritative collector or Harness value.
- A percentage dial requires a real denominator.
- Missing data is never displayed as zero.
- Unsupported data is never remapped to a different counter.
- Last-known values remain distinguishable from current values through source-state color.
- Job failure and telemetry failure are separate. A failed job does not turn healthy process/host telemetry red.
- Browser stale-sampler state and stale heartbeat state remain distinct concepts.

## 6. Layering rule

The instrument-console layer sits above the existing ScriptWatch collector/dashboard contract. It may add presentation DOM and derived visual state, but it does not change collector semantics, CSV meanings, Harness behavior, or backend alert rules.

The current implementation is loaded through `dashboard/spotlight.css` and `dashboard/spotlight.js` after the existing dashboard assets so the original structure remains recoverable and reviewable.
