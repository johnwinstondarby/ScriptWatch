#!/usr/bin/env python3
# ScriptWatch - runtime observer console for long-running InDesign ExtendScript jobs
# Copyright (C) 2026 John Darby
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.
# SPDX-License-Identifier: GPL-3.0-or-later

"""
ScriptWatch browser dashboard
=============================

Dependency-free local HTTP dashboard for ScriptWatch. The web layer consumes
Monitor.snapshot() as the single telemetry contract. Process counters, host
memory/commit counters, heartbeat provenance, and Harness metrics are sampled
and persisted by scriptwatch.py before they reach the browser.
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
DEFAULT_HISTORY_POINTS = 360


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


def _system_payload(raw):
    raw = raw or {}
    return {
        "physicalTotalMb": _safe_float(raw.get("physical_total_mb")),
        "physicalAvailableMb": _safe_float(raw.get("physical_available_mb")),
        "physicalUsedMb": _safe_float(raw.get("physical_used_mb")),
        "physicalUsedPct": _safe_float(raw.get("physical_used_pct")),
        "commitMb": _safe_float(raw.get("commit_mb")),
        "commitLimitMb": _safe_float(raw.get("commit_limit_mb")),
        "commitPct": _safe_float(raw.get("commit_pct")),
        "commitPeakMb": _safe_float(raw.get("commit_peak_mb")),
        "systemCacheMb": _safe_float(raw.get("system_cache_mb")),
        "kernelPagedMb": _safe_float(raw.get("kernel_paged_mb")),
        "kernelNonpagedMb": _safe_float(raw.get("kernel_nonpaged_mb")),
        "processCount": _safe_int(raw.get("process_count")),
        "threadCount": _safe_int(raw.get("thread_count")),
        "handleCount": _safe_int(raw.get("handle_count")),
    }


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
        self.baselines = {}
        self.worker = threading.Thread(target=self._run, name="ScriptWatchSampler", daemon=True)

    def start(self):
        self.worker.start()

    def stop(self):
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
            except Exception as exc:
                with self.lock:
                    self.error = "%s: %s" % (exc.__class__.__name__, exc)

            elapsed = time.time() - started
            self.stop_event.wait(max(0.15, self.interval - elapsed))

    def _delta(self, key, value):
        value = _safe_float(value)
        if value is None:
            return None
        if key not in self.baselines:
            self.baselines[key] = value
        return value - self.baselines[key]

    def _build_payload(self, snap):
        monitor = self.monitor
        state = monitor.snapshot(snap)
        system = _system_payload(state.get("system"))

        finish_at = None
        if state["eta"] is not None:
            finish_at = datetime.fromtimestamp(
                time.time() + state["eta"]).strftime("%I:%M %p").lstrip("0")

        percent = state["percent"]
        if percent is not None:
            percent = max(0.0, min(100.0, percent))

        private_mb = _safe_float(state["private_mb"])
        private_delta = self._delta("private_mb", private_mb)
        io_read = _safe_int(state.get("io_read_bytes"))
        io_write = _safe_int(state.get("io_write_bytes"))
        io_other = _safe_int(state.get("io_other_bytes"))
        page_faults = _safe_int(state.get("page_faults"))

        metrics = state.get("metrics")
        if not isinstance(metrics, list):
            metrics = []

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
                "note": state.get("heartbeat_note") or "",
                "tool": state.get("tool") or "",
                "toolVersion": state.get("tool_version") or "",
                "harnessVersion": state.get("harness_version") or "",
                "heartbeatSchema": state.get("heartbeat_schema") or "",
                "mode": state.get("job_mode") or "",
                "metrics": metrics,
            },
            "process": {
                "pid": _safe_int(state["pid"]),
                "backend": state["probe"],
                "uptimeSeconds": _safe_float(state["uptime"]),
                "cpuPct": _safe_float(state["cpu"]),
                "privateMb": private_mb,
                "privateBaselineMb": self.baselines.get("private_mb"),
                "privateDeltaMb": private_delta,
                "peakPrivateMb": _safe_float(state["peak_private_mb"]),
                "workingMb": _safe_float(state["working_mb"]),
                "pagefileMb": _safe_float(state["pagefile_mb"]),
                "threads": _safe_int(state["threads"]),
                "handles": _safe_int(state["handles"]),
                "pageFaults": page_faults,
                "pageFaultDelta": self._delta("page_faults", page_faults),
                "gdiObjects": _safe_int(state.get("gdi_objects")),
                "userObjects": _safe_int(state.get("user_objects")),
                "ioReadBytes": io_read,
                "ioWriteBytes": io_write,
                "ioOtherBytes": io_other,
                "ioReadDeltaBytes": self._delta("io_read_bytes", io_read),
                "ioWriteDeltaBytes": self._delta("io_write_bytes", io_write),
                "ioOtherDeltaBytes": self._delta("io_other_bytes", io_other),
                "ioReadOps": _safe_int(state.get("io_read_ops")),
                "ioWriteOps": _safe_int(state.get("io_write_ops")),
                "ioOtherOps": _safe_int(state.get("io_other_ops")),
                "responding": state["responding"],
            },
            "system": system,
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
                "intervalSeconds": self.interval,
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
            "ramPct": payload["system"]["physicalUsedPct"],
            "commitPct": payload["system"]["commitPct"],
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
                    help="heartbeat JSON path; newest plausible heartbeat is auto-discovered")
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
    ap.add_argument("--host", default=DEFAULT_HOST, help="HTTP bind host (default: 127.0.0.1)")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT, help="HTTP port (default: 8765)")
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
    url = "http://%s:%d/" % (
        "127.0.0.1" if args.host in ("0.0.0.0", "::") else args.host, args.port)

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
