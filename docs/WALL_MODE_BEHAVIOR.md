# ScriptWatch Wall-Mode Behavior

**Status:** implementation note aligned to the canonical visual contract.

ScriptWatch uses different source-liveness behavior for operator-distance and NOC-distance viewing while preserving one semantic model:

- source motion = acquisition liveness;
- metric motion = value change;
- color = condition.

## Desk view

Desk view uses discrete source impulses. One authoritative source event produces one bounded motion event. A five-second collector therefore produces visibly discrete five-second source arrivals.

Individual counters, dials, and meters do not all pulse on that source event. They move only when their own displayed values change.

This mode is diagnostic. It exposes sampling cadence and local value changes without manufacturing independent activity.

## Wall view

Wall view uses freshness-gated continuous motion at the **source** level. A fresh source event opens a liveness gate. While the gate is open, the source carrier moves continuously at a speed derived from observed cadence. Each subsequent event renews the gate. If events stop arriving, the gate closes automatically and source motion stops.

The default freshness window is 2.6 times observed cadence, clamped to a practical minimum and maximum. The wall animation cycle is also derived from observed cadence.

Individual metric carriers remain change-driven in wall view. The counter bank therefore does not turn into a synchronized field of green motion.

The behavior preview is activated on the normal dashboard with `?view=wall` or `?view=noc`. This is a behavior preview for the full console, not yet the final tiled wall product.

## Current acquisition boundaries

The browser currently receives Host and InDesign process telemetry together in one `Monitor.tick()` payload with one rendered timestamp. Host and Process therefore share one collector liveness fact.

The Host → Process lane is the single collector carrier.

Heartbeat writes are independently observable. The Process → Heartbeat lane owns heartbeat liveness.

Harness semantic telemetry rides the heartbeat transport. Heartbeat → Harness does not mirror every heartbeat write. That lane moves only when Harness metric values change.

If future collector work exposes independent Host and Process event identities or timestamps, separate liveness carriers may be added then.

## Metric change

Within a source group, an individual counter moves only when its displayed value changes. A stable `GDI OBJECTS 621` remains still while the collector source stays visibly live. A thread count that changes frequently produces frequent local motion.

The same rule applies to dials and meters. A stable `CPU = 0.0%` is a legitimate current value. Source motion proves that acquisition is alive; the dial itself moves only when its value changes.

Job progress follows the same rule. The progress dial acknowledges a displayed progress change rather than ordinary collector sampling. Heartbeat source motion separately proves heartbeat liveness.

## Source-path rule

A source-bus segment may carry a travelling packet only when the source it feeds is live or at limit. A healthy upstream source must not visually deliver a packet into a dormant, faulted, never-sampled, or unsupported downstream source.

This makes a missing Heartbeat read as a break in the chain rather than a successful green delivery into an amber node.

## No manufactured independence

Stagger, phase offset, jitter, and random delay are prohibited when used to make one shared event look like several independent events.

An independent carrier requires an independently observable event identity, timestamp, sequence, write count, or equivalent freshness surface.

If two carriers remain in perfect lockstep over a long observation, review whether they share one acquisition event. If they do, merge the liveness carrier.

## Chassis density

Instrument columns end with their active content instead of stretching empty bordered panels to the footer. In process-only mode the Job Execution column also receives slightly less width than the denser Runtime Health and Trends & Alerts columns.

Unused screen area should read as neutral chassis rather than as a large powered-off instrument bay.

## Acceptance checks

1. A five-second desk collector produces one collector-liveness impulse per sample.
2. Host and Process do not each receive duplicate liveness pulses from the same `Monitor.tick()` event.
3. The same collector in wall view keeps one source carrier moving while collector freshness remains valid.
4. Wall source motion stops automatically when the freshness window expires.
5. Individual counters move only when their own values change.
6. A stable `CPU = 0.0%` can remain locally still while the collector source remains visibly alive.
7. Process → Heartbeat motion occurs only on independently observed heartbeat writes.
8. Heartbeat → Harness motion occurs only on Harness semantic metric change.
9. Process-to-Heartbeat motion stops when Heartbeat has no data.
10. No jitter or phase offset is used to fake independence.
11. Empty bordered column chassis does not extend to the footer.
