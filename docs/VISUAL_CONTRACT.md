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

Each source has its own lamp and state label. A process-only job can therefore show host/process as live, heartbeat as amber/no data, and Harness as neutral/off.

### 3.1 Explicit Harness state

Harness participation is always visible as a binary operator indicator:

- `HARNESS = ON` means the monitored script is publishing the ScriptWatch Harness contract;
- `HARNESS = OFF` means ScriptWatch is observing the script through agentless process/host telemetry and any separately available raw heartbeat data.

`OFF` is neutral/gray because a non-Harness script can still be observed correctly. It is not a fault. When a Harness-enabled job stops publishing fresh data, the indicator remains logically `ON` but changes to amber `DORMANT`. A known loss caused by process/dashboard failure uses red `FAULT`.

The Harness version is shown with the ON state when available.

## 4. Instrument families

The visual layer uses a small reusable instrument vocabulary:

- segmented bounded dial for CPU, RAM, commit, and job progress;
- counter capsule for raw counters and Harness metrics;
- vertical capacity meter for bounded headroom/capacity values;
- sparkline for historical movement;
- source lamp for acquisition health;
- telemetry lane/source bus for data-path state.

Not every value earns a dial. Dense counters remain compact and readable.

### 4.1 Counters by acquisition source

Counter presentation preserves provenance. Counters are visually grouped into source bays rather than mixed into one undifferentiated bank.

**Host counters** contain Windows/system values such as available RAM, commit headroom and peak, system cache, kernel pools, and system process/thread/handle totals.

**InDesign process counters** contain values sampled from the monitored InDesign process such as private-memory delta, working set, I/O deltas, page faults, GDI/USER objects, threads, and handles.

**Harness counters** contain only semantic values published by the monitored script through `ScriptWatchJob.metric()`. Harness counters live in their own Harness data bay and are shown only when `HARNESS = ON`. The bay remains conceptually separate from process/host counters because Harness data describes the work rather than the operating system process.

Source identity and source health are separate visual dimensions. A host counter remains a host counter when its source goes dormant; its state changes to amber without changing provenance.

## 5. Truthfulness rules

- A visual instrument must use an existing authoritative collector or Harness value.
- A percentage dial requires a real denominator.
- Missing data is never displayed as zero.
- Unsupported data is never remapped to a different counter.
- Last-known values remain distinguishable from current values through source-state color.
- Counter source labels must reflect the acquisition path that supplied the value.
- Harness ON/OFF is derived from actual Harness provenance in the current job payload, not from user configuration or expectation.
- Job failure and telemetry failure are separate. A failed job does not turn healthy process/host telemetry red.
- Browser stale-sampler state and stale heartbeat state remain distinct concepts.

## 6. Layering rule

The instrument-console layer sits above the existing ScriptWatch collector/dashboard contract. It may add presentation DOM and derived visual state, but it does not change collector semantics, CSV meanings, Harness behavior, or backend alert rules.

The current implementation is loaded through `dashboard/spotlight.css`, `dashboard/spotlight_sources.css`, and `dashboard/spotlight.js` after the existing dashboard assets so the original structure remains recoverable and reviewable.
