#!/usr/bin/env python3
"""
ScriptWatch browser dashboard
=============================

A local, dependency-free HTTP dashboard for ScriptWatch. It reuses the existing
scriptwatch.py Monitor collector, so browser mode records the same CSV telemetry
and applies the same heartbeat, PID-selection, memory-trend, and alert logic.

Run:
    python scriptwatch_web.py
    python scriptwatch_web.py --pid 12345
    python scriptwatch_web.py --heartbeat "D:\\...\\NormalFix.json"

The server binds to 127.0.0.1 by default and opens the dashboard in the default
browser. No network service is exposed unless --host is explicitly changed.
"""

from __future__ import annotations

import argparse
import json
import os
import threading
import time
import webbrowser
from collections import deque
from datetime import datetime
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlparse

import scriptwatch


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
DEFAULT_HISTORY_POINTS = 360  # 30 minutes at the default five-second interval


def _safe_float(value):
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _safe_int(value):
    try:
        if value is None:
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _backend_name(probe):
    name = probe.__class__.__name__
    if name == "PsutilProbe":
        return "psutil"
    if name == "PowerShellProbe":
        return "PowerShell Get-Process"
    return name


class DashboardState:
    def __init__(self, monitor, interval, history_points):
        self.monitor = monitor
        self.interval = interval
        self.lock = threading.Lock()
        self.stop_event = threading.Event()
        self.latest = None
        self.history = deque(maxlen=history_points)
        self.error = None
        self.exited = False
        self.worker = threading.Thread(target=self._run, name="ScriptWatchSampler", daemon=True)

    def start(self):
        self.worker.start()

    def stop(self):
        self.stop_event.set()
        if self.worker.is_alive():
            self.worker.join(timeout=max(2.0, self.interval + 1.0))
        try:
            self.monitor.csv_file.close()
        except Exception:
            pass

    def _run(self):
        while not self.stop_event.is_set():
            started = time.time()
            try:
                snap = self.monitor.tick()
                if snap is None:
                    with self.lock:
                        self.exited = True
                    break
                payload = self._build_payload(snap)
                point = self._history_point(payload)
                with self.lock:
                    self.latest = payload
                    self.history.append(point)
                    self.error = None
            except Exception as exc:  # dashboard must not crash the observed job
                with self.lock:
                    self.error = "%s: %s" % (exc.__class__.__name__, exc)

            elapsed = time.time() - started
            wait_for = max(0.15, self.interval - elapsed)
            self.stop_event.wait(wait_for)

    def _build_payload(self, snap):
        monitor = self.monitor
        proc = snap["proc"]
        mem_slope = monitor.memory_trend()
        throughput_trend, throughput_ratio = monitor.throughput_trend()
        state, status_note = monitor.status()

        target = monitor.hb.get("target")
        total = monitor.hb.get("total")
        passed = monitor.hb.get("pass")
        failed = monitor.hb.get("fail")
        elapsed = monitor.hb.get("elapsedSeconds")
        average_ms = monitor.hb.get("averageTargetMs")
        pct = None
        if isinstance(target, (int, float)) and isinstance(total, (int, float)) and total:
            pct = max(0.0, min(100.0, 100.0 * float(target) / float(total)))

        finish_at = None
        if snap.get("eta") is not None:
            finish_at = datetime.fromtimestamp(time.time() + snap["eta"]).strftime("%I:%M %p").lstrip("0")

        alerts = monitor.alerts(mem_slope, throughput_trend, throughput_ratio)
        heartbeat_age = monitor.hb.age
        heartbeat_path = monitor.hb.path or ""

        return {
            "timestamp": snap["ts"],
            "iso": datetime.fromtimestamp(snap["ts"]).astimezone().isoformat(timespec="seconds"),
            "job": {
                "name": monitor.hb.get("job") or "InDesign process telemetry",
                "status": state,
                "statusNote": status_note,
                "target": _safe_int(target),
                "total": _safe_int(total),
                "percent": pct,
                "pass": _safe_int(passed),
                "fail": _safe_int(failed),
                "elapsedSeconds": _safe_float(elapsed),
                "averageTargetMs": _safe_float(average_ms),
                "ratePerMin": _safe_float(snap.get("rate")),
                "etaSeconds": _safe_float(snap.get("eta")),
                "finishAt": finish_at,
                "lastCheckpoint": monitor.hb.get("lastCheckpoint"),
                "heartbeatAgeSeconds": _safe_float(heartbeat_age),
                "heartbeatPath": heartbeat_path,
                "heartbeatSeen": bool(monitor.hb.ever_seen),
                "heartbeatWrites": monitor.hb.get("writes"),
                "host": monitor.hb.get("host") or "",
                "note": monitor.hb.get("note") or "",
            },
            "process": {
                "pid": int(monitor.pid),
                "backend": _backend_name(monitor.probe),
                "uptimeSeconds": _safe_float(monitor.probe.uptime),
                "cpuPct": _safe_float(proc.get("cpu")),
                "privateMb": _safe_float(proc.get("private_mb")),
                "peakPrivateMb": _safe_float(monitor.peak_private),
                "workingMb": _safe_float(proc.get("working_mb")),
                "pagefileMb": _safe_float(proc.get("pagefile_mb")),
                "threads": _safe_int(proc.get("threads")),
                "handles": _safe_int(proc.get("handles")),
                "responding": snap.get("responding"),
            },
            "trends": {
                "memorySlopeMbHour": _safe_float(mem_slope),
                "throughput": throughput_trend,
                "throughputRatio": _safe_float(throughput_ratio),
                "trendWindowSeconds": monitor.args.trend_window,
            },
            "alerts": alerts,
            "monitor": {
                "samples": monitor.samples,
                "started": monitor.started,
                "csvPath": monitor.csv_path,
                "watchBytes": snap.get("watch_bytes"),
                "directory": monitor.dir,
            },
        }

    def _history_point(self, payload):
        return {
            "t": payload["timestamp"],
            "cpu": payload["process"]["cpuPct"],
            "private": payload["process"]["privateMb"],
            "working": payload["process"]["workingMb"],
            "handles": payload["process"]["handles"],
            "rate": payload["job"]["ratePerMin"],
            "target": payload["job"]["target"],
        }

    def snapshot(self):
        with self.lock:
            latest = dict(self.latest) if self.latest else None
            history = list(self.history)
            error = self.error
            exited = self.exited
        return {"latest": latest, "history": history, "error": error, "processExited": exited}


class DashboardHandler(SimpleHTTPRequestHandler):
    state = None

    def __init__(self, *args, directory=None, **kwargs):
        super().__init__(*args, directory=directory, **kwargs)

    def log_message(self, fmt, *args):
        return

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/status":
            self._send_json(self.state.snapshot())
            return
        if parsed.path == "/api/health":
            self._send_json({"ok": True, "time": time.time()})
            return
        if parsed.path == "/":
            self.path = "/index.html"
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _send_json(self, value):
        data = json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)


def make_monitor_args(args):
    return SimpleNamespace(
        heartbeat=args.heartbeat,
        pid=args.pid,
        process=args.process,
        interval=args.interval,
        stall=args.stall,
        trend_window=args.trend_window,
        mem_alert=args.mem_alert,
        watch=args.watch,
        csv=args.csv,
        dir=args.dir,
        once=False,
        no_clear=True,
    )


def main(argv=None):
    ap = argparse.ArgumentParser(
        prog="scriptwatch_web",
        description="Browser dashboard for ScriptWatch / InDesign ExtendScript jobs.")
    ap.add_argument("--heartbeat", "-b", default=os.environ.get("SCRIPTWATCH_HEARTBEAT"),
                    help="heartbeat JSON path; newest valid heartbeat is auto-discovered when omitted")
    ap.add_argument("--pid", type=int, help="attach to a specific InDesign PID")
    ap.add_argument("--process", default=scriptwatch.DEFAULT_PROCESS,
                    help="process name fragment (default: InDesign)")
    ap.add_argument("--interval", "-i", type=float, default=scriptwatch.DEFAULT_INTERVAL,
                    help="sample interval in seconds (default: 5)")
    ap.add_argument("--stall", type=int, default=scriptwatch.DEFAULT_STALL,
                    help="heartbeat age in seconds before STALLED")
    ap.add_argument("--trend-window", type=int, default=scriptwatch.DEFAULT_TREND_WINDOW,
                    help="seconds of history used by trend calculations")
    ap.add_argument("--mem-alert", type=float, default=scriptwatch.DEFAULT_MEM_ALERT,
                    help="private-memory MB/hour slope that raises an alert")
    ap.add_argument("--watch", help="optional log/checkpoint file whose size should be tracked")
    ap.add_argument("--csv", help="sample CSV path; defaults to DocStats")
    ap.add_argument("--dir", help="runtime directory; overrides SCRIPTWATCH_DIR / DocStats")
    ap.add_argument("--host", default=DEFAULT_HOST,
                    help="HTTP bind host (default: 127.0.0.1)")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT,
                    help="HTTP port (default: 8765)")
    ap.add_argument("--history-points", type=int, default=DEFAULT_HISTORY_POINTS,
                    help="number of recent samples sent to the browser")
    ap.add_argument("--no-browser", action="store_true",
                    help="do not open the default browser automatically")
    args = ap.parse_args(argv)

    monitor = scriptwatch.Monitor(make_monitor_args(args))
    state = DashboardState(monitor, max(0.5, args.interval), max(30, args.history_points))
    state.start()

    dashboard_dir = Path(__file__).resolve().parent / "dashboard"
    if not dashboard_dir.is_dir():
        raise SystemExit("Dashboard assets not found: %s" % dashboard_dir)

    handler = lambda *a, **kw: DashboardHandler(*a, directory=str(dashboard_dir), **kw)
    DashboardHandler.state = state

    server = ThreadingHTTPServer((args.host, args.port), handler)
    url = "http://%s:%d/" % ("127.0.0.1" if args.host in ("0.0.0.0", "::") else args.host, args.port)

    print("ScriptWatch browser dashboard")
    print("  URL:       %s" % url)
    print("  PID:       %s" % monitor.pid)
    print("  heartbeat: %s" % (monitor.hb.path or "none - process telemetry only"))
    print("  CSV:       %s" % monitor.csv_path)
    print("Press Ctrl+C to stop the dashboard. The observed InDesign process is not terminated.")

    if not args.no_browser:
        threading.Timer(0.75, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        print("\nStopping ScriptWatch dashboard.")
    finally:
        server.shutdown()
        server.server_close()
        state.stop()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
