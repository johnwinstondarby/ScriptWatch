# ScriptWatch Visual Contract

**Status:** Draft visual contract for the instrument-console dashboard.

The ScriptWatch dashboard is a live operations console. Motion, color, illumination, placement, and source labeling communicate telemetry state and provenance and must remain semantically tied to data freshness.

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

## 3. Source bus and Harness state

The console exposes the acquisition architecture as a source bus:

1. host telemetry;
2. InDesign process telemetry;
3. heartbeat telemetry;
4. ScriptWatch Harness telemetry.

Each source has its own lamp and state label. A process-only job can therefore show host/process as live, heartbeat as amber/no data, and Harness as neutral/off.

Harness participation is also exposed as a top-level operator indicator because it changes the semantic depth of the observation:

- `HARNESS = ON` means the current job publishes the ScriptWatch Harness contract;
- `HARNESS = OFF` means ScriptWatch is observing the job agentlessly;
- `HARNESS = ON` with amber means the monitored script is Harness-enabled but fresh Harness data is unavailable;
- `HARNESS = ON` with red means a known source/process failure prevents current Harness telemetry.

`HARNESS = OFF` is neutral gray rather than amber. The absence of Harness instrumentation is a capability distinction, not stale data. The Harness version is shown with the ON state when available.

## 4. Instrument families

The visual layer uses a small reusable instrument vocabulary:

- segmented bounded dial for CPU, RAM, commit, and job progress;
- counter capsule for raw counters and Harness metrics;
- vertical capacity meter for bounded headroom/capacity values;
- sparkline for historical movement;
- source lamp for acquisition health;
- telemetry lane/source bus for data-path state.

Not every value earns a dial. Dense counters remain compact and readable.

### 4.1 Source-aligned counter bays

Counter provenance remains visually explicit after a value leaves the source bus. Counter families are placed near the part of the console that interprets them:

- **Host counters** stay in Runtime Health beside system RAM, commit, cache, kernel-pool, and host-capacity instruments.
- **InDesign process counters** sit in Trends & Alerts beside process history and retention signals. This includes working set, I/O, page faults, GDI/USER objects, threads, and handles.
- **Harness counters** stay in Job Execution because they describe the meaning and progress of the script's work.

A Harness data bay remains visible even when Harness is OFF. In that state it states that no Harness counters are published and that ScriptWatch is operating agentlessly. When Harness is ON, the live Harness provenance and custom counter bank replace that OFF bay.

Source identity and source state are separate dimensions. A process counter remains a process counter when its data turns amber; a Harness counter remains a Harness counter when its feed goes dormant.

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
- Counter placement may change for readability, but source ownership and metric meaning do not.

## 6. Layering rule

The instrument-console layer sits above the existing ScriptWatch collector/dashboard contract. It may add presentation DOM, re-parent existing counter DOM for source-aligned layout, and derive visual state, but it does not change collector semantics, CSV meanings, Harness behavior, or backend alert rules.

The current implementation is loaded through `dashboard/spotlight.css`, `dashboard/spotlight_sources.css`, and `dashboard/spotlight.js` after the existing dashboard assets so the original structure remains recoverable and reviewable.
