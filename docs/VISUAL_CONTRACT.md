# ScriptWatch Visual Contract

**Status:** Draft visual contract for the instrument-console dashboard.

The ScriptWatch dashboard is a live operations console. Motion, color, illumination, placement, and source labeling communicate telemetry state and provenance and must remain semantically tied to real observations.

The console is designed for two viewing distances. At operator distance, numbers, provenance, trends, and labels support diagnosis. At NOC distance, motion and condition color must be sufficient to identify a stopped or unhealthy source without reading text.

The governing visual model is:

- **source motion = acquisition liveness**;
- **metric motion = value change**;
- **color = condition**;
- **number = value**;
- **placement = provenance**.

No animation may manufacture independence that the data contract does not expose.

## 1. Instrument data-state vocabulary

Every value-bearing instrument uses the same five-state behavior contract.

| State | Color | Motion | Value rule | Meaning |
|---|---|---|---|---|
| `NEVER_SAMPLED` | neutral gray | none | show em dash; never invent zero | no sample has ever arrived |
| `LIVE` | restrained green | source liveness or truthful metric change only | show current value | fresh telemetry is available |
| `DORMANT` | amber | stopped | retain and dim last known value | a previously sampled source is no longer fresh |
| `AT_LIMIT` | orange | source liveness or truthful metric change only | show current bounded value | fresh telemetry has reached the declared bound |
| `FAULT` | red | stopped | withhold current value | the source reported an error rather than a trustworthy value |

`NEVER_SAMPLED` and a legitimate zero are different states. Zero is displayed only after a real sample reports zero.

`DORMANT` preserves the last known reading. Transitioning a dormant instrument to zero because motion stopped is a contract violation.

`FAULT` does not present a last known number as a current reading. Historical panels and retained internal state may preserve prior samples for diagnosis, but the primary live instrument withholds the current value.

Amber is a data-confidence state. It does not assert that the measured subsystem is itself unhealthy.

### 1.1 Capability is a separate axis

A capability can be absent by design without placing an instrument in one of the five data states. `HARNESS = OFF`, for example, means the current script does not publish the Harness contract. It is neutral gray and is not equivalent to `NEVER_SAMPLED`, `DORMANT`, or `FAULT`.

Backend-specific unsupported counters follow the same rule: capability absence is labeled explicitly and never converted to zero or amber stale data.

The shared behavior implementation lives in `dashboard/instrument_state.js`.

## 2. Motion contract

Motion is evidence, not decoration.

A moving object must correspond to an observable event or a freshness gate derived from observable events. Artificial staggering, random jitter, phase offsets, and decorative free-running animation are prohibited when they create the appearance of independent telemetry.

### 2.1 Indicator independence rule

An independent liveness carrier is justified only when the data contract exposes an independently observable event identity, timestamp, sequence, write count, or equivalent freshness surface for that source.

If two visual carriers are always driven by the same event, they represent one liveness fact and should normally be drawn as one carrier.

The practical review rule is:

> An indicator earns independent motion only when the underlying data can disagree with its neighbors.

Perfect lockstep across a long observation is a diagnostic signal. Review whether the indicators share one acquisition event. If they do, merge the liveness carrier rather than adding stagger or jitter.

### 2.2 Current ScriptWatch acquisition boundaries

The current browser contract receives Host and InDesign process telemetry together in one `Monitor.tick()` payload with one rendered sample timestamp. Host and Process therefore share one collector liveness carrier.

Heartbeat writes are independently observable from collector sampling through the heartbeat write count. Heartbeat therefore owns a separate liveness carrier.

Harness semantic telemetry is transported through the heartbeat. Harness does not receive a second liveness animation merely because the heartbeat updated. Harness metric cards may show metric-change motion when their own displayed values change.

If future collector work exposes independent Host and Process timestamps or event identities, separate carriers may be introduced then.

### 2.3 Source liveness versus metric change

Source-level motion answers: **Is fresh acquisition activity occurring?**

Metric-level motion answers: **Did this value change?**

Within a counter bank, counters that share one source sample do not each receive a liveness pulse. The source carrier owns freshness. Individual counters move only when their own values change.

This produces truthful visual texture. A rapidly changing thread count may move frequently while a stable GDI object count remains quiet, even though both continue to receive fresh samples from the same live source.

The same rule applies to dials and meters. A stable `CPU = 0.0%` does not need artificial metric motion. Collector source motion proves freshness; the dial's green state and numeric zero report condition and value. If CPU changes, the dial may acknowledge that change locally.

### 2.4 Desk and wall modes

Desk view uses discrete source impulses. One authoritative source event produces one bounded source motion event. This exposes acquisition cadence directly.

Wall view uses freshness-gated continuous **source** motion. A fresh source event opens or renews a liveness gate. While the gate is open, the source carrier moves continuously at a speed derived from observed cadence. If fresh events stop, the gate expires and source motion stops automatically.

Individual metric carriers remain change-driven in both views. Wall mode must not convert an entire counter bank into continuously moving decoration.

### 2.5 NOC-distance observability gate

ScriptWatch inherits the operating principle used by successful Spotlight deployments in high-density NOC environments: **motion communicates liveness; color communicates condition**.

At NOC distance an operator should be able to determine, without reading body text:

1. which acquisition sources are alive;
2. whether any source is amber, orange, or red rather than green;
3. whether Harness participation is ON or OFF;
4. where the acquisition chain breaks;
5. which metrics are actively changing when viewed more closely.

The nominal wall should remain visually quiet. Healthy liveness should read as a small number of coherent source carriers rather than a field of synchronized green activity.

## 3. Source bus and Harness state

The console exposes the acquisition architecture as a source bus:

1. host telemetry;
2. InDesign process telemetry;
3. heartbeat telemetry;
4. ScriptWatch Harness telemetry.

Source nodes carry state and provenance. Travelling lane packets carry independently supported acquisition or semantic-change events.

In the current implementation:

- Host → Process represents the shared collector sample containing host and process telemetry;
- Process → Heartbeat represents heartbeat-write liveness;
- Heartbeat → Harness moves only for a real Harness semantic metric change, not as a duplicate heartbeat carrier.

A source-bus segment may carry motion only when the destination it feeds is live or at limit. A healthy upstream source must not visually deliver into a dormant, faulted, never-sampled, or unsupported downstream source.

Harness participation is also exposed as a top-level operator indicator:

- `HARNESS = ON` means the current job publishes the ScriptWatch Harness contract;
- `HARNESS = OFF` means ScriptWatch is observing the job agentlessly;
- `HARNESS = ON` with amber means the monitored script is Harness-enabled but fresh Harness data is unavailable;
- `HARNESS = ON` with red means a known source/process failure prevents current Harness telemetry.

`HARNESS = OFF` is neutral gray rather than amber. The Harness version is shown with the ON state when available.

### 3.1 Annunciation rollup

One underlying condition should produce one primary NOC annunciation. Derived repetitions may remain available for desk-level diagnosis but must be visually subordinate to the source that owns the state.

For heartbeat absence, the Heartbeat source-bus node is the primary amber annunciation. Masthead and Job Execution copies remain readable but are subdued so one missing source does not appear as several independent failures.

Capability OFF states follow the same rule. A neutral Harness OFF indicator can appear in multiple diagnostic contexts without being promoted to an alarm color.

## 4. Instrument families

The reusable instrument vocabulary is:

- `SegmentedDial(state, value)` for bounded ratios such as CPU, RAM, commit, and job progress;
- `FlowLane(state, event)` for acquisition and semantic-flow activity;
- `Counter(state, value)` for totals and point-in-time numeric values;
- `Meter(state, value)` for bounded headroom/capacity values;
- sparkline/history panels for retained time-series context;
- source/capability indicators for acquisition health and Harness ON/OFF.

Each instrument uses authoritative state and value. Individual panels do not invent local state semantics or independent event timing.

Not every value earns a dial. Dense counters remain compact and readable.

### 4.1 Source-aligned counter bays

Counter provenance remains visually explicit after a value leaves the source bus:

- **Host counters** stay in Runtime Health beside system RAM, commit, cache, kernel-pool, and host-capacity instruments.
- **InDesign process counters** sit in Trends & Alerts beside process history and retention signals.
- **Harness counters** stay in Job Execution because they describe the meaning and progress of the script's work.

A Harness data bay remains visible even when Harness is OFF. In that state it states that no Harness counters are published and that ScriptWatch is operating agentlessly.

Source identity and source state are separate dimensions. A process counter remains a process counter when its data turns amber; a Harness counter remains a Harness counter when its feed goes dormant.

### 4.2 Counter indicator rule

A per-counter lamp, runner, or highlight must encode a real counter-level property such as value change. Decorative marks that merely repeat the source bay's liveness are prohibited.

A counter can remain visually still while its source remains live. That means the value has not changed, not that the source stopped sampling. Source liveness is asserted once at the acquisition level.

## 5. Color roles

Color hierarchy is intentionally narrow:

- green: live/nominal condition;
- amber: dormant / stale data;
- orange: live bounded value at its declared limit;
- red: fault;
- gray: never sampled or capability absent;
- cyan/purple and similar accents: source identity, structure, and restrained labeling only.

Source identity colors must not compete with state colors on primary value instruments. State has visual priority.

Historical traces are contextual rather than annunciators. Their colors remain green or neutral/desaturated unless the history panel itself is explicitly reporting an abnormal state.

### 5.1 Dimensional material rendering

ScriptWatch uses dimensional rendering to improve visual quality without adding another semantic channel.

**Hue carries condition. Shading carries form. Motion carries liveness or truthful metric change according to scope.**

A state color may be rendered as a tonal family of the same hue using gradients, highlights, shadows, bevels, reflections, and glow. Those effects may make an instrument appear illuminated, recessed, glass-covered, or machined, but they must not introduce a competing state color.

Material effects remain subordinate to source/state hierarchy and must not obscure text, imply freshness, or create false independent activity.

The target is modern instrument glass and illuminated controls rather than decorative beveling across the entire interface.

## 6. Instrument workbench and specimen-strip gate

`dashboard/workbench.html` is the permanent no-backend visual canary for ScriptWatch instruments. It runs with a synthetic driver and does not require InDesign or a ScriptWatch process.

The specimen-strip gate checks at least these distinctions:

1. never-sampled is visually distinct from a legitimate zero;
2. dormant retains the last known value and stops source motion;
3. at-limit remains live while using the limit color;
4. fault stops source motion and withholds the current value;
5. reduced-motion mode preserves state meaning without animation;
6. source/capability labels remain truthful without backend data;
7. unchanged values remain still while their source can remain visibly live;
8. metric-change carriers fire only when that metric changes;
9. dimensional rendering improves close-range quality without weakening semantic hue;
10. source liveness is driven by authoritative event arrival or freshness gates;
11. repeated copies of one condition do not create multiple equal-strength alarms;
12. no two nominally independent carriers are manufactured from one event by phase offset, stagger, or jitter;
13. when two carriers remain in lockstep over a long observation, their event identity is reviewed and merged if it is shared.

The workbench also carries a fake Host → Process → Heartbeat → Harness rig so flow behavior can be reviewed without changing production telemetry code.

A tiled-console specimen may present multiple compact ScriptWatch instances simultaneously so one stopped or non-green critical system can be identified without reading labels.

## 7. Truthfulness rules

- A visual instrument must use an existing authoritative collector or Harness value.
- A percentage dial requires a real denominator.
- Missing data is never displayed as zero.
- Unsupported data is never remapped to a different counter.
- Dormant data retains last known value and is visually marked stale.
- Faulted primary instruments withhold the current value rather than presenting stale data as current.
- Counter source labels must reflect the acquisition path that supplied the value.
- Harness ON/OFF is derived from actual Harness provenance in the current job payload.
- Job failure and telemetry failure are separate.
- Browser stale-sampler state and stale heartbeat state remain distinct concepts.
- Counter placement may change for readability, but source ownership and metric meaning do not.
- Source motion must indicate real acquisition freshness.
- Metric motion must indicate real value change or another explicitly defined metric-level event.
- Artificial staggering, jitter, or phase offset must never simulate independent telemetry.
- Color must encode state consistently enough to remain meaningful at reduced scale.
- Dimensional styling must not imply liveness or condition independently of the state machine.
- Repeated diagnostic copies of one condition must not inflate the apparent alarm count.

## 8. Layering rule

The instrument-console layer sits above the existing ScriptWatch collector/dashboard contract. It may add presentation DOM, re-parent existing counter DOM for source-aligned layout, derive visual state, bind source motion to already-rendered events, and bind metric motion to displayed value changes, but it does not change collector semantics, CSV meanings, Harness behavior, or backend alert rules.

The current runtime implementation is loaded through `dashboard/spotlight.css`, `dashboard/spotlight_sources.css`, `dashboard/material.css`, `dashboard/refinement.css`, `dashboard/spotlight.js`, and `dashboard/motion.js`. The shared state behavior contract is defined in `dashboard/instrument_state.js`.
