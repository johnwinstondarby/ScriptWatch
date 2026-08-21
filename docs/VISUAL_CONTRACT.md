# ScriptWatch Visual Contract

**Status:** Draft visual contract for the instrument-console dashboard.

The ScriptWatch dashboard is a live operations console. Motion, color, illumination, placement, and source labeling communicate telemetry state and provenance and must remain semantically tied to data freshness.

The console is designed for two viewing distances. At operator distance, the numbers, provenance, trends, and labels support diagnosis. At NOC distance, motion and condition color must be sufficient to identify a stopped or unhealthy signal without reading text.

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

Amber is a data-confidence state. It does not assert that the measured subsystem is itself unhealthy.

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

### 2.1 NOC-distance observability gate

ScriptWatch inherits the operating principle used by successful Spotlight deployments in high-density NOC environments: **motion communicates liveness; color communicates condition**.

A primary instrument passes the NOC-distance gate only when an operator can determine, without reading its number or label, whether the monitored signal is alive and whether its condition is normal.

The distance-view contract is:

- green + motion = fresh and normal;
- amber + stopped motion = dormant or stale, with the last known value retained for close inspection;
- orange + motion = fresh but at a declared limit;
- red + stopped motion = fault;
- gray + no motion = never sampled or capability absent, with explicit capability labeling available at operator distance.

The numerical value is diagnostic detail rather than the liveness signal. A value that remains unchanged across many samples must still show visible live motion while fresh samples arrive.

Every primary live instrument therefore requires an **activity carrier** appropriate to its form:

- segmented dial: rotating or circulating tracer;
- flow lane: travelling segments;
- counter: moving runner or equivalent sample-life indicator independent of value change;
- meter: travelling highlight through the active scale;
- source path: travelling packet/dash between acquisition stages;
- history panel: retained history remains static, while a sample-edge cursor or equivalent live acquisition marker may indicate fresh arrival.

Activity carriers stop independently with the source that feeds them. A dormant Harness lane must not stop healthy host/process motion, and a process fault must not falsely mark healthy historical data as live.

### 2.2 Sample-arrival motion

Primary liveness motion is driven by sample arrival rather than by a free-running animation clock.

One rendered sample produces one motion impulse or one bounded traverse. The duration may be derived from observed sample cadence so a slow probe visibly moves more slowly and a fast probe produces more frequent motion. If sample arrival stops, no new liveness impulse is generated.

Collector-driven host/process carriers and heartbeat/Harness carriers remain source-specific. A collector sample does not create Heartbeat or Harness motion unless the heartbeat write state advanced with that sample.

A moving carrier may finish its current sample impulse after the final sample. It must not start another traverse until a new authoritative sample arrives.

### 2.3 Tiled-console legibility

ScriptWatch must remain interpretable when multiple consoles are tiled on a large display or when the dashboard is viewed from across a room.

At reduced scale, the following must remain visible without reading body text:

1. whether each critical source is moving;
2. whether any critical source is amber, orange, or red rather than green;
3. whether Harness participation is ON or OFF;
4. which major bay owns the abnormal signal;
5. whether a fault is local to one source or has propagated across the acquisition path.

Fine typography, exact counts, paths, and trend detail are secondary at this distance. The visual hierarchy must preserve state and motion before text.

The nominal wall should remain visually quiet between motion impulses. Permanent bright underlines or decorative lights are prohibited when they reduce the contrast of a true exception.

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

### 3.1 Annunciation rollup

One underlying condition should produce one primary NOC annunciation. Derived repetitions may remain available for desk-level diagnosis but must be visually subordinate to the source that owns the state.

For heartbeat absence, the Heartbeat source-bus node is the primary amber annunciation. Masthead and Job Execution copies remain readable but are subdued so one missing source does not appear as several independent failures.

Capability OFF states follow the same rule. A neutral Harness OFF indicator can appear in multiple diagnostic contexts without being promoted to an alarm color.

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

A live counter whose numeric value has not changed still requires a liveness carrier. Value change and data freshness are separate conditions.

## 5. Color roles

Color hierarchy is intentionally narrow:

- green: live telemetry;
- amber: dormant / stale data;
- orange: live bounded value at its declared limit;
- red: fault;
- gray: never sampled or capability absent;
- cyan/purple and similar accents: source identity, structure, and restrained labeling only.

Source identity colors must not compete with state colors on primary value instruments. State has visual priority.

Historical traces are contextual rather than annunciators. Their colors remain green or neutral/desaturated unless the history panel itself is explicitly reporting an abnormal state.

### 5.1 Dimensional material rendering

ScriptWatch uses dimensional rendering to improve visual quality without adding another semantic channel.

**Hue carries condition. Shading carries form. Motion carries liveness.**

A state color may be rendered as a tonal family of the same hue using gradients, highlights, shadows, bevels, reflections, and glow. Those effects may make an instrument appear illuminated, recessed, glass-covered, or machined, but they must not introduce a competing state color.

The material rules are:

1. a green live instrument may use dark green, nominal green, bright green, and pale green specular highlights, but it remains unambiguously green;
2. amber, orange, red, and gray instruments receive the same dimensional treatment within their own hue families;
3. static glow, shading, or reflection never proves liveness; only the activity carrier does;
4. `DORMANT`, `FAULT`, and `NEVER_SAMPLED` stop their activity carriers even though dimensional shading remains visible;
5. `AT_LIMIT` keeps its activity carrier moving because the source is still live;
6. material effects remain subordinate to the source/state hierarchy and cannot obscure text or reduce contrast;
7. the chassis remains relatively restrained so illuminated telemetry instruments carry the visual attention;
8. close-range material detail may disappear at NOC distance without weakening the motion-and-color signals.

The target is modern instrument glass and illuminated controls rather than decorative beveling across the entire interface.

The runtime material layer lives in `dashboard/material.css`. It is presentation-only and may add liveness carriers that are already authorized by the state contract, but it does not redefine state, thresholds, source provenance, or collector values.

## 6. Instrument workbench and specimen-strip gate

`dashboard/workbench.html` is the permanent no-backend visual canary for ScriptWatch instruments. It runs with a synthetic driver and does not require InDesign or a ScriptWatch process.

Every primary instrument family is displayed in all five data states side by side. New instrument behavior is reviewed in the workbench before it enters the runtime console.

The specimen-strip gate checks at least these distinctions:

1. never-sampled is visually distinct from a legitimate zero;
2. dormant retains the last known value and stops motion;
3. at-limit remains live and moving while using the limit color;
4. fault stops motion and withholds the current value;
5. reduced-motion mode preserves state meaning without animation;
6. source/capability labels remain truthful without backend data;
7. an unchanged live value still carries visible liveness motion;
8. the same instrument remains classifiable by state when viewed at reduced scale or from NOC distance;
9. dimensional material rendering improves close-range quality without weakening the semantic hue or liveness carrier;
10. liveness motion is triggered by sample arrival rather than a free-running visual clock;
11. repeated copies of one condition do not create multiple equal-strength alarms.

The workbench also carries a fake Host → Process → Heartbeat → Harness rig so flow behavior can be reviewed without changing production telemetry code.

A future tiled-console specimen may present multiple compact ScriptWatch instances simultaneously so one stopped or non-green critical system can be identified without reading labels. This is a visual-canary requirement rather than a backend multi-instance feature.

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
- Motion must indicate fresh sampling rather than numeric change alone.
- Color must encode state consistently enough to remain meaningful at reduced scale.
- Dimensional styling must not imply liveness or condition independently of the state machine.
- Sample-driven carriers must not free-run between authoritative samples.
- Repeated diagnostic copies of one condition must not inflate the apparent alarm count.

## 8. Layering rule

The instrument-console layer sits above the existing ScriptWatch collector/dashboard contract. It may add presentation DOM, re-parent existing counter DOM for source-aligned layout, derive visual state, and bind motion to already-rendered sample events, but it does not change collector semantics, CSV meanings, Harness behavior, or backend alert rules.

The current runtime implementation is loaded through `dashboard/spotlight.css`, `dashboard/spotlight_sources.css`, `dashboard/material.css`, `dashboard/spotlight.js`, and `dashboard/motion.js`. The shared state behavior contract is defined in `dashboard/instrument_state.js`; production instruments migrate to it incrementally so visual work does not destabilize the collector.
