# ScriptWatch Wall-Mode Behavior

**Status:** implementation note pending merge into the canonical visual contract.

ScriptWatch uses different liveness carriers for operator-distance and NOC-distance viewing while preserving the same semantic rule: motion communicates liveness and color communicates condition.

## Desk view

Desk view uses discrete sample impulses. One authoritative rendered sample produces one bounded motion event. A five-second probe therefore produces visibly discrete five-second arrivals. The motion is allowed to finish after the final sample but no new traverse begins without another sample.

This mode is diagnostic. It exposes sampling cadence directly.

## Wall view

Wall view uses freshness-gated continuous motion. A fresh sample opens a liveness gate. While the gate is open, the carrier moves continuously at a speed derived from observed cadence. Each subsequent fresh sample renews the gate. If samples stop arriving, the gate closes automatically after the freshness window and the carrier stops without a separate stop command.

The default freshness window is 2.6 times observed cadence, clamped to a practical minimum and maximum. The wall animation cycle is also derived from observed cadence.

The behavior preview is activated on the normal dashboard with `?view=wall` or `?view=noc`. This is a behavior preview for the full console, not yet the final tiled wall product.

## Source-specific freshness

Host and InDesign process carriers use collector sample freshness.

Heartbeat and Harness carriers use heartbeat-write freshness. A collector sample cannot animate the Heartbeat or Harness path unless the heartbeat write count advances.

## Zero-valued bounded instruments

A legitimate zero remains a sampled value. Dial liveness therefore cannot depend on the amount of ring fill. In desk view the dial housing acknowledges each sample. In wall view the outer tracer remains active while collector freshness is valid, including when CPU reads `0.0%`.

The job-progress ring remains excluded from freshness-gated continuous wall motion until its heartbeat-specific behavior is exercised against a real Harness-enabled job.

## Source-path rule

A source-bus segment may carry a travelling packet only when the source it feeds is live or at limit. A healthy upstream source must not visually deliver a packet into a dormant, faulted, never-sampled, or unsupported downstream source.

This makes a missing Heartbeat read as a break in the chain rather than a successful green delivery into an amber node.

## Chassis density

Instrument columns end with their active content instead of stretching empty bordered panels to the footer. In process-only mode the Job Execution column also receives slightly less width than the denser Runtime Health and Trends & Alerts columns.

The purpose is to make unused screen area read as neutral chassis rather than as a large powered-off instrument bay.

## Acceptance checks

1. A five-second desk probe produces discrete motion impulses rather than continuous animation.
2. The same probe in wall view remains continuously in motion while samples remain fresh.
3. Wall motion stops automatically when the freshness window expires.
4. `CPU = 0.0%` remains visibly alive in wall view.
5. Process-to-Heartbeat motion stops when Heartbeat has no data.
6. Heartbeat/Harness motion requires heartbeat-write freshness.
7. Job-progress wall motion remains intentionally unresolved until a real Harness job exercises it.
8. Empty bordered column chassis no longer extends to the footer.
