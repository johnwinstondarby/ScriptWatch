# ScriptWatch

ScriptWatch observes long-running Adobe InDesign ExtendScript jobs from outside the InDesign process.

It has three layers:

1. `ScriptWatchHeartbeat.jsxinc` publishes small job-state heartbeats from ExtendScript.
2. `scriptwatch.py` collects heartbeat state plus Windows process telemetry and writes a CSV.
3. `scriptwatch_web.py` presents the collector data in a local browser dashboard and adds host-level memory/commit telemetry for visualization.

No ScriptUI scraping is used. The observer can continue collecting process telemetry even when a job has no heartbeat.

## Runtime output

The default runtime directory is the suite DocStats directory. Python resolution order is:

`--dir` → `SCRIPTWATCH_DIR` → configured DocStats path → working directory.

The heartbeat emitter uses DocStats when present and falls back to a ScriptWatch temp folder only when DocStats is unavailable.

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

## Heartbeat wiring

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
