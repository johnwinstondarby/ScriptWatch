# ScriptWatch

ScriptWatch observes long-running Adobe InDesign ExtendScript jobs from outside the InDesign process.

It has three layers:

1. `ScriptWatchHeartbeat.jsxinc` publishes small job-state heartbeats from ExtendScript.
2. `scriptwatch.py` collects heartbeat state plus Windows process telemetry and writes a CSV.
3. `scriptwatch_web.py` presents the same collector data in a local browser dashboard.

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

- CPU
- private memory and peak private memory
- private-memory slope
- working set
- backend-local pagefile counter
- threads and handles
- PID, process uptime, and UI-pump state

### Trends & alerts

- throughput trend
- throughput sparkline
- handle-count sparkline
- ScriptWatch alerts
- sample count and trend window
- watched-file growth
- CSV path

The dashboard uses a dark operations-console visual language inspired by classic infrastructure monitoring tools without reproducing a specific product interface.

Every derived value in `/api/status` comes from `Monitor.snapshot()` in the collector, so the dashboard and the console cannot disagree about the same run. The payload carries `memoryCollecting`, `throughputCollecting`, `coverageSeconds`, and `coverageRequiredSeconds` so panels can render a collecting state rather than plotting a warm-up artifact as a trend.

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
