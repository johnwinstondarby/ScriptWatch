# ScriptWatch Visual Contract

**Status:** Draft visual contract for the instrument-console dashboard.

The ScriptWatch dashboard is a live operations console. Motion, color, illumination, placement, and source labeling communicate telemetry state and provenance and must remain semantically tied to data freshness.

## 1. Instrument data-state vocabulary

Every value-bearing instrument uses the same five-state behavior contract.

| State | Color | Motion | Value rule | Meaning |
|---|---|---|---|---|
| `NEVER_SAMPLED` | neutral gray | none | show em dash; never invent zero | no sample has ever arrived |
| `LIVE` | restrained green | active | show current value | fresh telemetry is arriving |
| `DORMANT` | amber | stopped | retain and dim last known value | a previously sampled source is no longer fresh |
| `AT_LIMIT` | orange | active | show current bounded value | fresh telemetry has reached the instrument's declared bound |
| `FAULT` | red | stopped | withhold current value | the source reported an error rather than a trustworthy value |

`NEVER_SAMPLED` and a legitimate zero are different states. Zero is displayed only after a real sample reports zero.

`DORMANT` preserves the last known reading. Transitioning a dormant instrument to zero because motion stopped is a contract violation.

`FAULT` does not present a last known number as a current reading. Historical panels and retained internal state may preserve prior samples for diagnosis, but the primary live instrument withholds the current value.

Amber is a data-confidence state. It does not assert that the measured subsystem itself is unhealthy.

### 1.1 Capability is a separate axis

A capability can be absent by design without placing an instrument in one of the five data states. `HARNESS = OFF`, for example, means the current script does not publish the Harness contract. It is neutral gray and is not equivalent to `NEVER_SAMPLED`, `DORMANT`, or `FAULT`.

Backend-specific unsupported counters follow the same rule: capability absence is labeled explicitly and never converted to zero or amber stale data.

The shared behavior implementation lives in `dashboard/instrument_state.js`.

## 2. Motion contract

Instrument motion is data-driven.

- Fresh `LIVE` samples keep the instrument moving.
- `AT_LIMIT` is still live, so bounded instruments continue moving while orange identifies the limit condition.
- `DORMANT`, `FAULT`, and `NEVER_SAMPLED` stop instrument motion.
- When the sampler exceeds its stale threshold, previously sampled instruments transition to `DORMANT` and retain their last known values.
- Known source failure transitions the affected instrument to `FAULT` and withholds the current live value.
- `prefers-reduced-motion` disables continuous animation without changing state color, value rules, or text labels.

Perpetual decorative animation without a live source is prohibited.

## 3. Source bus and Harness state

The console exposes the acquisition architecture as a source bus:

1. host telemetry;
2. InDesign process telemetry;
3. heartbeat telemetry;
4. ScriptWatch Harness telemetry.

Each source has its own lamp and state label. Source capability and source freshness remain distinguishable.

Harness participation is also exposed as a top-level operator indicator because it changes the semantic depth of the observation:

- `HARNESS = ON` means the current job publishes the ScriptWatch Harness contract;
- `HARNESS = OFF` means ScriptWatch is observing the job agentlessly;
- `HARNESS = ON` with amber means the monitored script is Harness-enabled but fresh Harness data is unavailable;
- `HARNESS = ON` with red means a known source/process failure prevents current Harness telemetry.

`HARNESS = OFF` is neutral gray rather than amber. The Harness version is shown with the ON state when available.

## 4. Instrument families

The reusable instrument vocabulary is:

- `SegmentedDial(state, value)` for bounded ratios such as CPU, RAM, commit, and job progress;
- `FlowLane(state, value)` for telemetry flow/rate and source-path activity;
- `Counter(state, value)` for totals and point-in-time numeric values;
- `Meter(state, value)` for bounded headroom/capacity values;
- sparkline/history panels for retained time-series context;
- source/capability indicators for acquisition health and Harness ON/OFF.

Each primary instrument owns its own state rendering and motion behavior. The dashboard supplies authoritative state and value; individual panels do not invent local state semantics.

Not every value earns a dial. Dense counters remain compact and readable.

### 4.1 Source-aligned counter bays

Counter provenance remains visually explicit after a value leaves the source bus. Counter families are placed near the part of the console that interprets them:

- **Host counters** stay in Runtime Health beside system RAM, commit, cache, kernel-pool, and host-capacity instruments.
- **InDesign process counters** sit in Trends & Alerts beside process history and retention signals. This includes working set, I/O, page faults, GDI/USER objects, threads, and handles.
- **Harness counters** stay in Job Execution because they describe the meaning and progress of the script's work.

A Harness data bay remains visible even when Harness is OFF. In that state it states that no Harness counters are published and that ScriptWatch is operating agentlessly. When Harness is ON, live Harness provenance and custom counters occupy the bay.

Source identity and source state are separate dimensions. A process counter remains a process counter when its data turns amber; a Harness counter remains a Harness counter when its feed goes dormant.

### 4.2 Counter indicator rule

A per-counter lamp or dot must encode a real property such as counter freshness or change. Decorative dots that repeat the source bay's state without adding information are prohibited. Source-group lamps carry source health; individual counter marks are added only when they convey additional counter-level state.

## 5. Color roles

Color hierarchy is intentionally narrow:

- green: live telemetry;
- amber: dormant / stale data;
- orange: live bounded value at its declared limit;
- red: fault;
- gray: never sampled or capability absent;
- cyan/purple and similar accents: source identity, structure, and restrained labeling only.

Source identity colors must not compete with state colors on primary value instruments. State has visual priority.

## 6. Instrument workbench and specimen-strip gate

`dashboard/workbench.html` is the permanent no-backend visual canary for ScriptWatch instruments. It runs with a synthetic driver and does not require InDesign or a ScriptWatch process.

Every primary instrument family is displayed in all five data states side by side. New instrument behavior is reviewed in the workbench before it enters the runtime console.

The specimen-strip gate checks at least these distinctions:

1. never-sampled is visually distinct from a legitimate zero;
2. dormant retains the last known value and stops motion;
3. at-limit remains live and moving while using the limit color;
4. fault stops motion and withholds the current value;
5. reduced-motion mode preserves state meaning without animation;
6. source/capability labels remain truthful without backend data.

The workbench also carries a fake Host → Process → Heartbeat → Harness rig so flow behavior can be reviewed without changing production telemetry code.

## 7. Truthfulness rules

- A visual instrument must use an existing authoritative collector or Harness value.
- A percentage dial requires a real denominator.
- Missing data is never displayed as zero.
- Unsupported data is never remapped to a different counter.
- Dormant data retains last known value and is visually marked stale.
- Faulted primary instruments withhold the current value rather than presenting stale data as current.
- Counter source labels must reflect the acquisition path that supplied the value.
- Harness ON/OFF is derived from actual Harness provenance in the current job payload, not from user configuration or expectation.
- Job failure and telemetry failure are separate. A failed job does not turn healthy process/host telemetry red.
- Browser stale-sampler state and stale heartbeat state remain distinct concepts.
- Counter placement may change for readability, but source ownership and metric meaning do not.

## 8. Layering rule

The instrument-console layer sits above the existing ScriptWatch collector/dashboard contract. It may add presentation DOM, re-parent existing counter DOM for source-aligned layout, and derive visual state, but it does not change collector semantics, CSV meanings, Harness behavior, or backend alert rules.

The current runtime implementation is loaded through `dashboard/spotlight.css`, `dashboard/spotlight_sources.css`, and `dashboard/spotlight.js`. The shared state behavior contract is defined in `dashboard/instrument_state.js`; production instruments migrate to it incrementally so visual work does not destabilize the collector.
