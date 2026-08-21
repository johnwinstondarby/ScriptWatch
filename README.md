# ScriptWatch

ScriptWatch observes long-running Adobe InDesign ExtendScript jobs without making observability a dependency of the work.

It has four cooperating components and two acquisition paths:

1. `ScriptWatchJob.jsxinc` is the **ScriptWatch Harness** embedded in participating scripts. It standardizes job units, PASS/FAIL accounting, checkpoints, terminal state, version provenance, and optional domain metrics.
2. `ScriptWatchHeartbeat.jsxinc` is the fail-isolated in-process transport used by the Harness.
3. `scriptwatch.py` is the out-of-process collector. It combines heartbeat state with process and host telemetry and writes the canonical sample CSV.
4. `scriptwatch_web.py` presents the collector state in a local browser dashboard.

The Harness path is agent-style instrumentation because the script publishes the meaning of its own work. Process and host telemetry are agentless because ScriptWatch samples them externally. Either path can operate without the other.

## Runtime output

The default runtime directory is the suite DocStats directory. Python resolution order is:

`--dir` → `SCRIPTWATCH_DIR` → configured DocStats path → working directory.

The heartbeat emitter uses DocStats when present and falls back to a ScriptWatch temp folder only when DocStats is unavailable.

## Heartbeat discovery

With no `--heartbeat`, the collector attaches to the newest heartbeat in the runtime directory that could plausibly belong to a live job. Finished heartbeat JSON files remain after their jobs finish, so discovery filters stale terminal artifacts.

A candidate is skipped when its status is terminal (`DONE`, `COMPLETE`, `FINISHED`, `ABORTED`, `ERROR`, `FAILED`) **and** it has not been written within the stall threshold (`--stall`, 180 seconds by default). A job that finished seconds ago remains eligible so the console can show a run crossing the finish line.

When every candidate is skipped, ScriptWatch reports the distinction:

```text
! skipped 3 finished heartbeats in D:\...\DocStats (ABORTED, COMPLETE, DONE); pass --heartbeat to attach anyway
```

An explicit `--heartbeat` bypasses discovery filtering.

## Console monitor

```powershell
python scriptwatch.py
```

Useful options:

```powershell
python scriptwatch.py --pid 12345
python scriptwatch.py --heartbeat "D:\path\NormalFix.json"
python scriptwatch.py --report "D:\path\ScriptWatch_run.csv"
```

ScriptWatch uses `psutil` when installed and otherwise falls back to PowerShell `Get-Process` on Windows. Private bytes are the memory trend and alert signal. Working set and the backend-local pagefile counter remain informational.

### Canonical collector counters

The collector now records both process and host telemetry in the sample CSV. The browser no longer owns a second host-memory sampler.

Process counters include:

- CPU percentage
- private bytes, working set, and backend-local pagefile value
- thread and handle counts
- cumulative read/write/other I/O bytes and operations
- page-fault count
- Windows GDI and USER object counts when available
- process uptime and sampled UI-pump state

Host counters include:

- physical memory total, available, used, and used percent
- system commit charge, limit, percent, and peak
- system cache
- kernel paged and nonpaged pool
- system process, thread, and handle counts

On Windows, host RAM and commit use `GetPerformanceInfo`. Process I/O, page-fault, GDI, and USER counters use Win32 APIs independently of the `psutil` or PowerShell process backend so the meanings remain consistent across those backends. Unsupported counters remain empty rather than being mapped to a different concept.

### Trend coverage

No private-memory slope or throughput trend is reported until the trend window holds at least ten minutes of coverage across eight or more samples. Until that floor is reached, the console and dashboard report the actual collecting interval and no memory-slope alert can fire.

`--report` applies the same memory floor and summarizes the completed run. New-format CSVs also report system RAM/commit movement, process I/O deltas, page faults, GDI/USER objects, handle movement, Harness provenance, and final Harness metrics when present. Older ScriptWatch CSVs remain readable.

## Browser dashboard

```powershell
python scriptwatch_web.py
```

The dashboard binds to `127.0.0.1:8765` by default and opens in the default browser. It requires no additional Python package and uses `Monitor.snapshot()` as its telemetry contract.

### Job execution

- target progress gauge
- PASS / FAIL counts
- elapsed time
- average target time
- throughput and ETA
- heartbeat age and checkpoint
- Harness tool/version/mode/schema provenance when present
- custom Harness metrics as live number-in-box counters

### Runtime health

- active circular dials for InDesign CPU, system physical-memory use, and system commit charge
- sample-driven outer tracers that move only when a fresh telemetry sample arrives
- private memory, peak private memory, private delta since dashboard attach, and qualified private-memory slope
- live counter bank for RAM/commit headroom, cache/kernel pools, working set, I/O deltas, page-fault delta, GDI/USER objects, process threads/handles, and system process/thread/handle counts
- backend-local pagefile counter
- PID, process uptime, and UI-pump state

The circular activity tracer is sample-driven rather than decorative. If the sampler stalls, the tracer stops. Number-in-box counters briefly flash their border when a fresh sample changes the displayed value. Reduced-motion preferences disable those animations.

### Trends & alerts

- throughput trend and sparkline
- private-memory trend and sparkline
- handle-count sparkline
- ScriptWatch alerts
- sample count, trend coverage, and trend window
- watched-file growth
- CSV path

The dashboard binds to loopback. Binding elsewhere with `--host` publishes job names, runtime paths, and process telemetry to anyone who can reach the port, and ScriptWatch prints a warning saying so.

Stopping the dashboard stops only the observer. It does not terminate InDesign or the observed ExtendScript job.

## ScriptWatch Harness adoption

`ScriptWatchJob.jsxinc` is the preferred adoption point for suite tools and an optional integration point for other ExtendScript authors.

Current Harness contract version: **1.2**.  
Current heartbeat schema version: **1.2**.

Include order:

```javascript
#include "ScriptWatchHeartbeat.jsxinc"
#include "ScriptWatchJob.jsxinc"
```

Observation is fail-isolated. If the heartbeat transport is unavailable, the tool continues and Harness calls degrade to no-op observation.

### Structured provenance

Harness 1.2 publishes these structured fields in addition to the human-readable note prefix:

- `tool`
- `toolVersion`
- `harnessVersion`
- `mode`
- heartbeat `schemaVersion`

The collector records the fields directly in CSV. The note still begins with `<tool> · harness <version>` for human inspection.

### Loop-based tools

```javascript
var result = ScriptWatchJob.run({
    job: "NormalFix Read-Only Sweep",
    tool: "NormalFix",
    toolVersion: "1.0.0",
    targets: paragraphs,
    checkpointEvery: 25,
    onTarget: function (para, n, session) {
        session.metric("Paragraphs visited", n, { unit: "paragraphs" });
        return inspectParagraph(para);
    }
});
```

The Harness performs start, per-target PASS/FAIL accounting, checkpoint plus optional `$.gc()`, and terminal `finish()` in a `finally`. It returns:

```text
{ tool, toolVersion, harnessVersion, mode, total, completed, pass, fail, errors, aborted }
```

One target is the unit the ETA is built from. For a nested tool, use the outer loop as the target and report inner position through `note()` or `metric()`.

`false` is a FAIL, a thrown error is a FAIL, and any other return is a PASS. A failing target continues by default. With `continueOnError: false`, either an explicit `false` or a thrown target error publishes `ABORTED` and is rethrown to the caller after the terminal heartbeat is written.

### Phase-based tools

Tools whose main control flow is already owned elsewhere can use a phase/session Harness:

```javascript
var job = ScriptWatchJob.begin({
    job: "DocStats Inventory",
    tool: "DocStats",
    toolVersion: "1.2.0",
    total: 3
});

job.step("Counting stories");
job.metric("Stories", 26, { unit: "stories" });
job.pass();

job.step("Auditing styles");
job.pass();

job.end("DONE");
```

This form is also the preferred integration pattern when another subsystem, such as a mutation transaction engine, owns sequencing. ScriptWatch observes progress and state; it does not replace mutation safety, verification, rollback, or durable transaction journaling.

### Custom metrics

Harness 1.2 adds a bounded custom numeric metric channel:

```javascript
job.metric("Stories", 26, {
    unit: "stories",
    display: "counter"
});

job.metric("Scan progress", 72.4, {
    unit: "%",
    min: 0,
    max: 100,
    display: "dial"
});
```

The transport accepts up to 32 current metrics per job. Metric values must be finite numbers. Supported display metadata is `counter`, `dial`, or `trend`; unsupported values normalize to `counter`. The current dashboard renders custom metrics as number-in-box counters while preserving display/min/max metadata in the heartbeat and CSV for future presentation logic.

This channel keeps domain telemetry out of the fixed ScriptWatch process schema. ScriptWatch knows the process and host. The Harness lets the script describe its own work.

## Raw heartbeat API

The raw heartbeat API remains available for unusual jobs that do not fit either Harness shape. Suite tools should prefer the Harness so job semantics stay comparable.

```javascript
#include "ScriptWatchHeartbeat.jsxinc"
ScriptWatch.start({ job: "Custom Job", total: targets.length });
ScriptWatch.metric("Items", 12, { unit: "items" });
ScriptWatch.tick({ target: 1, ok: true });
ScriptWatch.finish("DONE");
```

Public heartbeat calls catch their own errors, writes are throttled, heartbeat replacement uses a temporary file to avoid torn reads, and `start()` resets prior job state so persistent ExtendScript engines do not carry metrics or write counters into the next run.

## Canary tests

The repository includes dependency-free canaries:

```powershell
python -m unittest discover -s tests -p "test_*.py" -v
node tests\harness_canary.js
node tests\heartbeat_canary.js
```

The collector canary covers heartbeat discovery, CSV-schema uniqueness, host-sample schema stability, and legacy-report compatibility. The JavaScript canaries cover Harness 1.2 provenance/metrics/fail-fast behavior and heartbeat 1.2 metric serialization, terminal state, lock release, and persistent-engine reset behavior.
