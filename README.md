# ScriptWatch

ScriptWatch observes long-running Adobe InDesign ExtendScript jobs from outside the InDesign process.

It has four cooperating components and two acquisition paths:

1. `ScriptWatchJob.jsxinc` is the **ScriptWatch Harness** embedded in suite tools. It standardizes job units, PASS/FAIL accounting, checkpoints, terminal state, and harness-version reporting.
2. `ScriptWatchHeartbeat.jsxinc` is the in-process emitter used by the Harness to publish small job-state heartbeats.
3. `scriptwatch.py` is the out-of-process collector. It combines heartbeat state with Windows process telemetry and writes a CSV.
4. `scriptwatch_web.py` presents the collector data in a local browser dashboard and adds host-level memory/commit telemetry for visualization.

The heartbeat path is agent-style instrumentation because each participating tool publishes its own work state through the Harness. Process and host telemetry remain agentless because ScriptWatch samples them from outside InDesign. Either path can operate without the other: a tool without the Harness still receives process telemetry, and a heartbeat can continue describing job state even when a particular host counter is unavailable.

## Runtime output

The default runtime directory is the suite DocStats directory. Python resolution order is:

`--dir` → `SCRIPTWATCH_DIR` → configured DocStats path → working directory.

The heartbeat emitter uses DocStats when present and falls back to a ScriptWatch temp folder only when DocStats is unavailable.

### Heartbeat discovery

With no `--heartbeat`, the collector attaches to the newest heartbeat in the runtime directory that could plausibly belong to a live job. Finished heartbeats outlive their jobs: `finish()` writes a terminal status and releases the lock, but the JSON stays in DocStats. Once several tools are writing slugged files, the newest file by modification time can be a completed run from an earlier session.

A candidate is skipped when its status is terminal (`DONE`, `COMPLETE`, `FINISHED`, `ABORTED`, `ERROR`, `FAILED`) **and** it has not been written within the stall threshold (`--stall`, 180 seconds by default). A job that finished seconds ago remains eligible so the console can show a run crossing the finish line. When every candidate is skipped, the collector reports why instead of silently implying that no heartbeat was ever written:

```text
! skipped 3 finished heartbeats in D:\...\DocStats (ABORTED, COMPLETE, DONE); pass --heartbeat to attach anyway
```

An explicit `--heartbeat` bypasses discovery filtering. Naming a heartbeat file is an instruction to attach to that file, including a finished run.

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

ScriptWatch uses `psutil` when installed and otherwise falls back to PowerShell `Get-Process`. Private bytes are the memory trend and alert signal. Working set and the backend-local pagefile counter are informational.

Each CSV sample also records the current `heartbeat_note`. Harness-managed jobs prefix that note with `<tool> · harness <version>`, giving completed runs a durable record of the Harness contract that produced their job counters. The final heartbeat preserves the same prefix even when a phase label or terminal error is appended.

### Trend coverage

No slope or throughput trend is reported until the window holds at least ten minutes of coverage across eight or more samples. InDesign allocates hard during start-up, so an hourly rate extrapolated from the first minute of a run reports warm-up as a leak. Until the floor is met, the console and the dashboard both report actual coverage (`collecting... 0:02:30 of 0:10:00`) and no memory alert can fire. `--report` applies the same floor and states when a run was too short to characterize.

## Browser dashboard

```powershell
python scriptwatch_web.py
```

The dashboard binds to `127.0.0.1:8765` by default and opens in the default browser. It requires no new Python package and reuses the existing `scriptwatch.py` collector.

The three-column dashboard is organized as:

### Job execution

- target progress gauge
- PASS / FAIL counts
- elapsed time
- average target time
- throughput and ETA
- heartbeat age and checkpoint

### Runtime health

- active circular dials for InDesign CPU, system physical-memory use, and system commit charge
- sample-driven outer tracers that move only when a fresh telemetry sample arrives
- private memory, peak private memory, private delta since dashboard attach, and qualified private-memory slope
- a data-driven number-in-box counter bank for available RAM, commit headroom, working set, process threads/handles, and system process/thread/handle counts
- backend-local pagefile counter
- PID, process uptime, and UI-pump state

On Windows, the host memory/commit dials use `GetPerformanceInfo` from `psapi.dll`. Physical RAM and system commit therefore have real denominators. The host probe also exposes system process, thread, handle, cache, and kernel-pool counters for future counter-bank expansion. On non-Windows systems with `psutil`, physical RAM remains available while Windows-specific commit counters are shown as unavailable rather than mapped to a different concept.

### Trends & alerts

- throughput trend
- throughput sparkline
- handle-count sparkline
- ScriptWatch alerts
- sample count and trend window
- watched-file growth
- CSV path

The dashboard uses a dark operations-console visual language inspired by classic infrastructure monitoring tools without reproducing a specific product interface.

Process/job derived values in `/api/status` come from `Monitor.snapshot()` in the collector, so the dashboard and the console do not re-derive the same run state. Host-level memory and commit counters are an independent dashboard enrichment sampled beside that state. The payload carries `memoryCollecting`, `throughputCollecting`, `coverageSeconds`, and `coverageRequiredSeconds` so panels can render a collecting state rather than plotting a warm-up artifact as a trend.

The circular activity tracer is sample-driven rather than decorative: it advances only when `latest.timestamp` changes. If the sampler stalls, the tracer stops. Number-in-box counters can briefly flash their border when a fresh sample changes the value. Reduced-motion preferences disable those animations.

The dashboard binds to loopback. Binding elsewhere with `--host` publishes job names, DocStats paths, and process telemetry to anyone who can reach the port, and prints a warning saying so.

Useful options:

```powershell
python scriptwatch_web.py --pid 12345
python scriptwatch_web.py --heartbeat "D:\path\NormalFix.json"
python scriptwatch_web.py --port 8877
python scriptwatch_web.py --no-browser
```

Stopping the dashboard stops only the observer. It does not terminate InDesign or the observed ExtendScript job.

## ScriptWatch Harness adoption

`ScriptWatchJob.jsxinc` is the single adoption point for suite tools. DocStats, StyleFix, HeaderFix, NormalFix, TableFix, and later tools can describe their work through the same contract while `ScriptWatchHeartbeat.jsxinc` remains the transport layer underneath it.

Current Harness contract version: **1.1**.

Include order:

```javascript
#include "ScriptWatchHeartbeat.jsxinc"
#include "ScriptWatchJob.jsxinc"
```

### Loop-based tools

```javascript
var result = ScriptWatchJob.run({
    job: "NormalFix Read-Only Sweep",
    tool: "NormalFix",
    targets: paragraphs,
    checkpointEvery: 25,
    onTarget: function (para, n) {
        return normalizeParagraph(para);
    }
});
```

The Harness performs start, per-target tick, PASS/FAIL accounting, checkpoint plus optional `$.gc()`, and terminal `finish()` in a `finally`. It returns:

```text
{ total, completed, pass, fail, errors, aborted }
```

### Phase-based tools

Tools that are not natural loops can use named phases as their unit of work:

```javascript
var job = ScriptWatchJob.begin({
    job: "DocStats Inventory",
    tool: "DocStats",
    total: 3
});

job.step("Counting stories"); job.pass();
job.step("Auditing styles");  job.fail("style table missing");
job.end("DONE");
```

Three conventions keep job reporting comparable across tools:

- **One target is the unit the ETA is built from.** For a nested tool, that is the outer loop. Report inner position with `note()` rather than counting inner items as targets.
- **`false` is a FAIL, a thrown error is a FAIL, anything else is a PASS.** A tool returning nothing reports a pass, which is appropriate for successful read-only work.
- **A failing target continues by default.** With `continueOnError: false`, either an explicit `false` result or a thrown target error marks the run `ABORTED`; thrown errors are rethrown after the terminal heartbeat is published, and explicit `false` is converted to an error for the same fail-fast contract.

The Harness keeps `<tool> · harness 1.1` at the front of every heartbeat note, including phase labels and terminal messages. Observation is fail-isolated: if `ScriptWatchHeartbeat.jsxinc` is unavailable, monitoring calls become no-ops while the work still runs through the Harness.

## Raw heartbeat API

The raw heartbeat API remains available for unusual jobs that do not fit either Harness shape. Suite tools should prefer the Harness so job semantics stay comparable.

```javascript
#include "ScriptWatchHeartbeat.jsxinc"
ScriptWatch.start({ job: "NormalFix Read-Only Sweep", total: targets.length });

// inside the loop
ScriptWatch.tick({ target: i + 1, ok: result });
if ((i + 1) % 25 === 0) {
    ScriptWatch.checkpoint(i + 1, true); // durable checkpoint + $.gc()
}

// in finally / shutdown path
ScriptWatch.finish("DONE");
```

The heartbeat writer is fail-isolated from the observed job. Public calls catch their own errors, writes are throttled, and heartbeat replacement uses a temporary file to avoid torn reads.
