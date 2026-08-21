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
        """
        The sampler owns the CSV handle and closes it in its own finally block,
        so shutdown never closes the file out from under a write in progress.
        The join budget must exceed the probe's own timeout: a PowerShell sample
        can sit in a subprocess for up to 20 seconds, which is far longer than
        one sample interval.
        """
        self.stop_event.set()
        if self.worker.is_alive():
            self.worker.join(timeout=max(30.0, self.interval + 25.0))
            if self.worker.is_alive():
                print("Sampler still finishing a probe; CSV will close when it returns.")

    def _run(self):
        try:
            self._sample_loop()
        finally:
            try:
                self.monitor.csv_file.close()
            except Exception:
                pass

    def _sample_loop(self):
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
        """
        Every derived value comes from Monitor.snapshot(), which is the single
        source of truth shared with the console. Re-deriving trends here would
        let the dashboard and the console disagree about the same run.
        """
        monitor = self.monitor
        state = monitor.snapshot(snap)

        finish_at = None
        if state["eta"] is not None:
            finish_at = datetime.fromtimestamp(
                time.time() + state["eta"]).strftime("%I:%M %p").lstrip("0")

        percent = state["percent"]
        if percent is not None:
            percent = max(0.0, min(100.0, percent))

        return {
            "timestamp": state["sampled_at"],
            "iso": datetime.fromtimestamp(state["sampled_at"]).astimezone().isoformat(timespec="seconds"),
            "job": {
                "name": state["job"] or "InDesign process telemetry",
                "status": state["status"],
                "statusNote": state["status_note"],
                "target": _safe_int(state["target"]),
                "total": _safe_int(state["total"]),
                "percent": percent,
                "pass": _safe_int(state["passed"]),
                "fail": _safe_int(state["failed"]),
                "elapsedSeconds": _safe_float(state["elapsed"]),
                "averageTargetMs": _safe_float(state["average_target_ms"]),
                "ratePerMin": _safe_float(state["rate_per_min"]),
                "etaSeconds": _safe_float(state["eta"]),
                "finishAt": finish_at,
                "lastCheckpoint": state["checkpoint"],
                "heartbeatAgeSeconds": _safe_float(state["heartbeat_age"]),
                "heartbeatPath": state["heartbeat_path"] or "",
                "heartbeatSeen": bool(state["heartbeat_seen"]),
                "heartbeatWrites": state["writes"],
                "host": state["host"] or "",
                "note": monitor.hb.get("note") or "",
            },
            "process": {
                "pid": _safe_int(state["pid"]),
                "backend": state["probe"],
                "uptimeSeconds": _safe_float(state["uptime"]),
                "cpuPct": _safe_float(state["cpu"]),
                "privateMb": _safe_float(state["private_mb"]),
                "peakPrivateMb": _safe_float(state["peak_private_mb"]),
                "workingMb": _safe_float(state["working_mb"]),
                "pagefileMb": _safe_float(state["pagefile_mb"]),
                "threads": _safe_int(state["threads"]),
                "handles": _safe_int(state["handles"]),
                "responding": state["responding"],
            },
            "trends": {
                "memorySlopeMbHour": _safe_float(state["memory_slope"]),
                "memoryCollecting": state["memory_collecting"],
                "throughput": state["throughput_trend"],
                "throughputRatio": _safe_float(state["throughput_ratio"]),
                "throughputCollecting": state["throughput_collecting"],
                "coverageSeconds": _safe_float(state["coverage"]),
                "coverageRequiredSeconds": _safe_float(state["coverage_required"]),
                "trendWindowSeconds": state["trend_window"],
            },
            "alerts": state["alerts"],
            "monitor": {
                "samples": state["samples"],
                "started": monitor.started,
                "csvPath": state["csv_path"],
                "watchBytes": state["watch_bytes"],
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
    """
    Start from the collector's own parser defaults, then apply whatever the
    dashboard was given. A new flag in scriptwatch.build_parser() reaches the
    web layer without a matching edit here.
    """
    values = vars(scriptwatch.build_parser().parse_args([]))
    for key, value in vars(args).items():
        if key in values and value is not None:
            values[key] = value
    values.update({"once": False, "no_clear": True, "report": None})
    return SimpleNamespace(**values)


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
    if args.host not in ("127.0.0.1", "localhost", "::1"):
        print("  WARNING:   bound to %s, not loopback. This dashboard publishes job" % args.host)
        print("             names, DocStats file paths, and process telemetry to")
        print("             anyone who can reach this port.")
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
