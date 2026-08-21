#!/usr/bin/env python3
"""
ScriptWatch - ExtendScript Runtime Monitor
==========================================

An out-of-process observer for long-running InDesign ExtendScript jobs
(DocStats, StyleFix, HeaderFix, NormalFix, TableFix, and anything after them).

It combines two independent signals:

  1. Job state, published by the script itself as a small JSON heartbeat file
     (see ScriptWatchHeartbeat.jsxinc).
  2. Windows process telemetry for InDesign.exe, sampled from outside.

Neither signal depends on the other. If the heartbeat stops, process telemetry
keeps recording. If the script never emits a heartbeat, ScriptWatch still runs
in process-only mode.

Usage
-----
    python scriptwatch.py                              # auto-attach to InDesign
    python scriptwatch.py --heartbeat C:\\SW\\nf.json
    python scriptwatch.py --pid 12345 --interval 5
    python scriptwatch.py --once                       # one snapshot, no loop
    python scriptwatch.py --report run-20260820.csv    # post-run analysis

Every sample is appended to a CSV so the memory question can be answered
empirically after the fact instead of inferred from throughput.

Backends: psutil if installed, otherwise PowerShell (Get-Process). No admin
rights required for either.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import subprocess
import sys
import time
from collections import deque
from datetime import datetime, timezone

# --------------------------------------------------------------------------
# Configuration defaults
# --------------------------------------------------------------------------

DEFAULT_PROCESS = "InDesign"
DEFAULT_INTERVAL = 5.0          # seconds between samples
DEFAULT_STALL = 180             # heartbeat age (s) before status goes STALLED
DEFAULT_TREND_WINDOW = 1800     # seconds of history used for trend fits
DEFAULT_MEM_ALERT = 50.0        # MB/hour slope that trips a memory warning
THROUGHPUT_TOLERANCE = 0.15     # +/- fraction treated as "stable"
MB = 1024.0 * 1024.0

IS_WINDOWS = os.name == "nt"

try:
    import psutil  # type: ignore
except ImportError:  # pragma: no cover - environment dependent
    psutil = None


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------

def hms(seconds):
    """Format a duration as H:MM:SS. Returns '--:--:--' for unknown values."""
    if seconds is None or seconds < 0 or math.isinf(seconds) or math.isnan(seconds):
        return "--:--:--"
    seconds = int(seconds)
    return "%d:%02d:%02d" % (seconds // 3600, (seconds % 3600) // 60, seconds % 60)


def now():
    return time.time()


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).astimezone().isoformat(timespec="seconds")


def slope_per_hour(points):
    """Least-squares slope of (timestamp_seconds, value) pairs, per hour."""
    n = len(points)
    if n < 3:
        return None
    t0 = points[0][0]
    xs = [(t - t0) / 3600.0 for t, _ in points]
    ys = [v for _, v in points]
    mx = sum(xs) / n
    my = sum(ys) / n
    denom = sum((x - mx) ** 2 for x in xs)
    if denom <= 0:
        return None
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / denom


def enable_ansi():
    """Turn on VT processing so in-place redraw works in cmd.exe."""
    if not IS_WINDOWS:
        return True
    try:
        import ctypes
        k = ctypes.windll.kernel32
        h = k.GetStdHandle(-11)
        mode = ctypes.c_uint32()
        if not k.GetConsoleMode(h, ctypes.byref(mode)):
            return False
        return bool(k.SetConsoleMode(h, mode.value | 0x0004))
    except Exception:
        return False


# --------------------------------------------------------------------------
# Heartbeat reader
# --------------------------------------------------------------------------

class Heartbeat(object):
    """
    Reads the JSON heartbeat written by the ExtendScript job.

    Tolerates partial reads: the writer swaps a temp file into place, but if a
    read lands mid-swap the last good sample is retained and the file is simply
    re-read on the next cycle. A parse failure is never treated as a stall.
    """

    FIELDS = ("job", "target", "total", "pass", "fail", "elapsedSeconds",
              "averageTargetMs", "lastCheckpoint", "status", "pid")

    def __init__(self, path):
        self.path = path
        self.data = {}
        self.mtime = None
        self.last_good = None      # wall-clock time of last successful parse
        self.parse_errors = 0
        self.ever_seen = False

    def poll(self):
        if not self.path:
            return
        try:
            st = os.stat(self.path)
        except OSError:
            return
        if self.mtime is not None and st.st_mtime == self.mtime and self.data:
            return  # unchanged since last read
        try:
            with open(self.path, "r", encoding="utf-8-sig") as fh:
                parsed = json.load(fh)
            if not isinstance(parsed, dict):
                raise ValueError("heartbeat is not a JSON object")
        except Exception:
            self.parse_errors += 1
            return
        self.data = parsed
        self.mtime = st.st_mtime
        self.last_good = st.st_mtime
        self.ever_seen = True

    # -- convenience accessors ---------------------------------------------
    def get(self, key, default=None):
        value = self.data.get(key, default)
        return default if value is None else value

    @property
    def age(self):
        if self.last_good is None:
            return None
        return max(0.0, now() - self.last_good)


# --------------------------------------------------------------------------
# Process telemetry
# --------------------------------------------------------------------------

class Probe(object):
    """Base class. sample() returns a dict or None if the process is gone."""

    def __init__(self, pid):
        self.pid = pid
        self.start_time = None

    def sample(self):
        raise NotImplementedError

    @property
    def uptime(self):
        if self.start_time is None:
            return None
        return now() - self.start_time


class PsutilProbe(Probe):
    def __init__(self, pid):
        Probe.__init__(self, pid)
        self.proc = psutil.Process(pid)
        self.cores = psutil.cpu_count() or 1
        self.start_time = self.proc.create_time()
        self.proc.cpu_percent(None)  # prime the CPU delta

    def sample(self):
        try:
            with self.proc.oneshot():
                mi = self.proc.memory_info()
                private = getattr(mi, "private", None)
                commit = getattr(mi, "pagefile", None)
                return {
                    "cpu": self.proc.cpu_percent(None) / float(self.cores),
                    "working_mb": mi.rss / MB,
                    "private_mb": (private if private is not None else mi.vms) / MB,
                    "commit_mb": (commit if commit is not None else mi.vms) / MB,
                    "threads": self.proc.num_threads(),
                    "handles": (self.proc.num_handles()
                                if hasattr(self.proc, "num_handles") else None),
                }
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            return None


class PowerShellProbe(Probe):
    """Fallback for machines where psutil is not installed."""

    PS = ("$ErrorActionPreference='Stop';$p=Get-Process -Id {pid};"
          "[pscustomobject]@{{ws=$p.WorkingSet64;priv=$p.PrivateMemorySize64;"
          "commit=$p.PagedMemorySize64;threads=@($p.Threads).Count;"
          "handles=$p.HandleCount;cpu=$p.TotalProcessorTime.TotalSeconds;"
          "start=(Get-Date $p.StartTime -UFormat %s)}}|ConvertTo-Json -Compress")

    def __init__(self, pid):
        Probe.__init__(self, pid)
        self.cores = os.cpu_count() or 1
        self._prev = None
        first = self._raw()
        if first is None:
            raise RuntimeError("process %s not found" % pid)
        self.start_time = float(first.get("start") or 0) or None

    def _raw(self):
        try:
            out = subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive", "-Command",
                 self.PS.format(pid=self.pid)],
                capture_output=True, text=True, timeout=20)
            if out.returncode != 0 or not out.stdout.strip():
                return None
            return json.loads(out.stdout)
        except Exception:
            return None

    def sample(self):
        raw = self._raw()
        if raw is None:
            return None
        stamp = now()
        cpu_pct = 0.0
        if self._prev is not None:
            dt = stamp - self._prev[0]
            dc = float(raw["cpu"]) - self._prev[1]
            if dt > 0:
                cpu_pct = max(0.0, dc / dt / float(self.cores) * 100.0)
        self._prev = (stamp, float(raw["cpu"]))
        return {
            "cpu": cpu_pct,
            "working_mb": float(raw["ws"]) / MB,
            "private_mb": float(raw["priv"]) / MB,
            "commit_mb": float(raw["commit"]) / MB,
            "threads": int(raw["threads"]),
            "handles": int(raw["handles"]),
        }


def find_process(name_fragment):
    """Return the PID of the largest matching process, or None."""
    fragment = name_fragment.lower()
    if psutil is not None:
        best, best_rss = None, -1
        for proc in psutil.process_iter(["pid", "name", "memory_info"]):
            try:
                pname = (proc.info["name"] or "").lower()
                if fragment in pname:
                    rss = proc.info["memory_info"].rss if proc.info["memory_info"] else 0
                    if rss > best_rss:
                        best, best_rss = proc.info["pid"], rss
            except Exception:
                continue
        return best
    if IS_WINDOWS:
        try:
            out = subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive", "-Command",
                 "(Get-Process -Name '*%s*' | Sort-Object WorkingSet64 -Descending |"
                 " Select-Object -First 1).Id" % name_fragment],
                capture_output=True, text=True, timeout=20)
            value = out.stdout.strip()
            return int(value) if value.isdigit() else None
        except Exception:
            return None
    return None


def is_responding(pid):
    """
    Windows-only UI responsiveness check.

    Note: an InDesign running a modal ExtendScript job normally reports NOT
    RESPONDING because the script owns the main thread and the message pump is
    not being serviced. That is expected, not a fault signal. Treat it as
    information about the UI thread, not about job health.
    """
    if not IS_WINDOWS:
        return None
    try:
        out = subprocess.run(
            ["tasklist", "/FI", "PID eq %d" % pid, "/FI", "STATUS eq NOT RESPONDING",
             "/NH", "/FO", "CSV"],
            capture_output=True, text=True, timeout=15)
        return str(pid) not in out.stdout
    except Exception:
        return None


# --------------------------------------------------------------------------
# Monitor
# --------------------------------------------------------------------------

CSV_COLUMNS = ["iso", "epoch", "pid", "cpu_pct", "working_mb", "private_mb",
               "commit_mb", "threads", "handles", "responding", "job", "target",
               "total", "passed", "failed", "checkpoint", "hb_age_s",
               "rate_per_min", "eta_s", "watch_bytes"]


class Monitor(object):
    def __init__(self, args):
        self.args = args
        self.hb = Heartbeat(args.heartbeat)
        self.hb.poll()
        self.pid = args.pid or self.hb.data.get("pid") or find_process(args.process)
        if not self.pid:
            raise SystemExit("No process matching '%s' found. Pass --pid, or start "
                             "InDesign first." % args.process)
        self.probe = self._make_probe(int(self.pid))
        self.mem_hist = deque()      # (ts, private_mb)
        self.tgt_hist = deque()      # (ts, target)
        self.started = now()
        self.samples = 0
        self.peak_private = 0.0
        self.csv_path = args.csv or "scriptwatch-%s.csv" % datetime.now().strftime("%Y%m%d-%H%M%S")
        self._init_csv()

    def _make_probe(self, pid):
        if psutil is not None:
            return PsutilProbe(pid)
        if IS_WINDOWS:
            return PowerShellProbe(pid)
        raise SystemExit("psutil is not installed and this is not Windows. "
                         "Install psutil: py -m pip install psutil")

    def _init_csv(self):
        exists = os.path.exists(self.csv_path)
        self.csv_file = open(self.csv_path, "a", newline="", encoding="utf-8")
        self.csv = csv.writer(self.csv_file)
        if not exists:
            self.csv.writerow(CSV_COLUMNS)
            self.csv_file.flush()

    # -- derived metrics ---------------------------------------------------
    def _trend_window(self, history):
        cutoff = now() - self.args.trend_window
        return [p for p in history if p[0] >= cutoff]

    def memory_trend(self):
        return slope_per_hour(self._trend_window(self.mem_hist))

    def rate_per_min(self):
        """Targets per minute over the trailing trend window."""
        pts = self._trend_window(self.tgt_hist)
        if len(pts) < 2:
            return None
        dt = pts[-1][0] - pts[0][0]
        dn = pts[-1][1] - pts[0][1]
        if dt <= 30 or dn <= 0:
            return None
        return dn / (dt / 60.0)

    def throughput_trend(self):
        """Compare the recent half of the window against the earlier half."""
        pts = self._trend_window(self.tgt_hist)
        if len(pts) < 6:
            return None, None
        mid = len(pts) // 2
        first, second = pts[:mid + 1], pts[mid:]

        def rate(seq):
            dt = seq[-1][0] - seq[0][0]
            dn = seq[-1][1] - seq[0][1]
            return dn / (dt / 60.0) if dt > 30 and dn > 0 else None

        r1, r2 = rate(first), rate(second)
        if not r1 or not r2:
            return None, None
        ratio = r2 / r1
        if ratio > 1 + THROUGHPUT_TOLERANCE:
            return "rising", ratio
        if ratio < 1 - THROUGHPUT_TOLERANCE:
            return "falling", ratio
        return "stable", ratio

    def eta(self, rate):
        total = self.hb.get("total")
        target = self.hb.get("target")
        if not rate or not total or not target or target >= total:
            return None
        return (total - target) / rate * 60.0

    def status(self):
        if not self.hb.ever_seen:
            return "NO HEARTBEAT", "process telemetry only"
        target, total = self.hb.get("target"), self.hb.get("total")
        declared = str(self.hb.get("status", "")).upper()
        if declared in ("DONE", "COMPLETE", "FINISHED") or (total and target and target >= total):
            return "COMPLETE", ""
        if declared in ("ABORTED", "ERROR", "FAILED"):
            return declared, "job reported failure"
        age = self.hb.age
        if age is not None and age > self.args.stall:
            return "STALLED", "no heartbeat for %s" % hms(age)
        return "RUNNING", ""

    def alerts(self, mem_slope, trend, ratio):
        out = []
        if mem_slope is not None and mem_slope > self.args.mem_alert:
            out.append("memory rising %.1f MB/hr over the last %s"
                       % (mem_slope, hms(self.args.trend_window)))
        if trend == "falling" and ratio:
            out.append("throughput down %.0f%% vs earlier in window"
                       % ((1 - ratio) * 100))
        if self.hb.parse_errors > 5:
            out.append("%d heartbeat parse failures" % self.hb.parse_errors)
        return out

    # -- main loop ---------------------------------------------------------
    def tick(self):
        self.hb.poll()
        proc = self.probe.sample()
        if proc is None:
            return None
        stamp = now()
        self.samples += 1
        self.peak_private = max(self.peak_private, proc["private_mb"])
        self.mem_hist.append((stamp, proc["private_mb"]))
        target = self.hb.get("target")
        if isinstance(target, (int, float)):
            if not self.tgt_hist or self.tgt_hist[-1][1] != target:
                self.tgt_hist.append((stamp, target))
        cutoff = stamp - max(self.args.trend_window * 2, 3600)
        while self.mem_hist and self.mem_hist[0][0] < cutoff:
            self.mem_hist.popleft()
        while self.tgt_hist and self.tgt_hist[0][0] < cutoff:
            self.tgt_hist.popleft()

        rate = self.rate_per_min()
        eta = self.eta(rate)
        responding = is_responding(int(self.pid)) if self.samples % 3 == 1 else None
        watch_bytes = None
        if self.args.watch and os.path.exists(self.args.watch):
            watch_bytes = os.path.getsize(self.args.watch)

        self.csv.writerow([
            iso(stamp), round(stamp, 2), self.pid, round(proc["cpu"], 2),
            round(proc["working_mb"], 1), round(proc["private_mb"], 1),
            round(proc["commit_mb"], 1), proc["threads"], proc["handles"],
            "" if responding is None else int(responding),
            self.hb.get("job", ""), self.hb.get("target", ""), self.hb.get("total", ""),
            self.hb.get("pass", ""), self.hb.get("fail", ""), self.hb.get("lastCheckpoint", ""),
            "" if self.hb.age is None else round(self.hb.age, 1),
            "" if rate is None else round(rate, 3),
            "" if eta is None else round(eta, 0),
            "" if watch_bytes is None else watch_bytes,
        ])
        self.csv_file.flush()
        return {"proc": proc, "rate": rate, "eta": eta, "responding": responding,
                "watch_bytes": watch_bytes, "ts": stamp}

    # -- rendering ---------------------------------------------------------
    def render(self, snap):
        proc = snap["proc"]
        mem_slope = self.memory_trend()
        trend, ratio = self.throughput_trend()
        state, note = self.status()
        target, total = self.hb.get("target"), self.hb.get("total")
        job = self.hb.get("job") or "(no heartbeat - process telemetry only)"

        pct = ""
        if isinstance(target, (int, float)) and isinstance(total, (int, float)) and total:
            pct = "  %5.1f%%" % (100.0 * target / total)

        L = []
        L.append(job)
        L.append("=" * max(28, min(64, len(job))))
        L.append("Target        %s / %s%s" % (target if target is not None else "?",
                                              total if total is not None else "?", pct))
        L.append("Pass / Fail   %s / %s" % (self.hb.get("pass", "?"), self.hb.get("fail", "?")))
        elapsed = self.hb.get("elapsedSeconds")
        L.append("Elapsed       %s   (monitor %s)"
                 % (hms(elapsed) if elapsed else "--:--:--", hms(now() - self.started)))
        L.append("Rate          %s targets/min"
                 % ("%.2f" % snap["rate"] if snap["rate"] else "--"))
        avg = self.hb.get("averageTargetMs")
        if avg:
            L.append("Avg target    %.1f s" % (float(avg) / 1000.0))
        L.append("ETA           %s%s" % (hms(snap["eta"]),
                 "   (finish ~%s)" % datetime.fromtimestamp(now() + snap["eta"]).strftime("%H:%M")
                 if snap["eta"] else ""))
        L.append("")
        L.append("InDesign  pid %s   up %s" % (self.pid, hms(self.probe.uptime)))
        L.append("CPU           %5.1f %%" % proc["cpu"])
        L.append("Private MB    %8.1f   (peak %.1f)" % (proc["private_mb"], self.peak_private))
        L.append("Working MB    %8.1f" % proc["working_mb"])
        L.append("Commit MB     %8.1f" % proc["commit_mb"])
        L.append("Threads       %8s" % proc["threads"])
        L.append("Handles       %8s" % (proc["handles"] if proc["handles"] is not None else "n/a"))
        if snap["responding"] is not None:
            L.append("UI pump       %s"
                     % ("responsive" if snap["responding"]
                        else "blocked (expected during a modal script)"))
        L.append("")
        L.append("Memory trend       %s"
                 % ("%+.1f MB/hour" % mem_slope if mem_slope is not None else "collecting..."))
        L.append("Throughput trend   %s" % (trend or "collecting..."))
        L.append("Heartbeat age      %s"
                 % ("%d sec" % self.hb.age if self.hb.age is not None else "n/a"))
        L.append("Last checkpoint    %s" % self.hb.get("lastCheckpoint", "n/a"))
        if snap["watch_bytes"] is not None:
            L.append("Watched file       %.1f KB" % (snap["watch_bytes"] / 1024.0))
        L.append("Status             %s%s" % (state, "  - " + note if note else ""))
        for alert in self.alerts(mem_slope, trend, ratio):
            L.append("  !  %s" % alert)
        L.append("")
        L.append("log: %s   samples: %d   %s"
                 % (self.csv_path, self.samples, datetime.now().strftime("%H:%M:%S")))
        return L

    def run(self):
        ansi = enable_ansi() and not self.args.no_clear
        prev_lines = 0
        try:
            while True:
                snap = self.tick()
                if snap is None:
                    print("\nProcess %s has exited. Log written to %s"
                          % (self.pid, self.csv_path))
                    return 0
                lines = self.render(snap)
                if ansi:
                    sys.stdout.write("\033[H\033[J")
                elif prev_lines:
                    sys.stdout.write("\n")
                sys.stdout.write("\n".join(lines) + "\n")
                sys.stdout.flush()
                prev_lines = len(lines)
                if self.args.once:
                    return 0
                time.sleep(self.args.interval)
        except KeyboardInterrupt:
            print("\nStopped. Log written to %s" % self.csv_path)
            return 0
        finally:
            self.csv_file.close()


# --------------------------------------------------------------------------
# Post-run report
# --------------------------------------------------------------------------

def report(path, stall_seconds):
    with open(path, newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    if not rows:
        print("No samples in %s" % path)
        return 1

    def num(row, key):
        try:
            return float(row[key])
        except (TypeError, ValueError, KeyError):
            return None

    t0, t1 = num(rows[0], "epoch"), num(rows[-1], "epoch")
    mem = [(num(r, "epoch"), num(r, "private_mb")) for r in rows if num(r, "private_mb")]
    tgt = [(num(r, "epoch"), num(r, "target")) for r in rows if num(r, "target")]
    slope = slope_per_hour(mem)
    job = rows[-1].get("job") or "(unnamed job)"

    print("ScriptWatch report - %s" % path)
    print("Job              %s" % job)
    print("Window           %s -> %s  (%s)"
          % (rows[0]["iso"], rows[-1]["iso"], hms((t1 - t0) if t0 and t1 else None)))
    print("Samples          %d" % len(rows))
    if mem:
        print("Private MB       start %.1f   end %.1f   peak %.1f   delta %+.1f"
              % (mem[0][1], mem[-1][1], max(v for _, v in mem), mem[-1][1] - mem[0][1]))
        if slope is not None:
            verdict = ("flat - no evidence of accumulation" if abs(slope) < 5
                       else "rising - consistent with retention between targets"
                       if slope > 0 else "falling - memory returned to the OS")
            print("Memory slope     %+.2f MB/hour   (%s)" % (slope, verdict))
    if len(tgt) >= 2:
        span = tgt[-1][0] - tgt[0][0]
        done = tgt[-1][1] - tgt[0][1]
        print("Targets          %g -> %g  (%g in %s)" % (tgt[0][1], tgt[-1][1], done, hms(span)))
        if span > 0:
            print("Overall rate     %.2f targets/min" % (done / (span / 60.0)))
        quarter = max(2, len(tgt) // 4)
        for label, seq in (("First quarter", tgt[:quarter]), ("Last quarter", tgt[-quarter:])):
            dt, dn = seq[-1][0] - seq[0][0], seq[-1][1] - seq[0][1]
            if dt > 0 and dn > 0:
                print("%-16s %.2f targets/min" % (label, dn / (dt / 60.0)))
    ages = [num(r, "hb_age_s") or 0 for r in rows]
    stalls = sum(1 for a in ages if a > stall_seconds)
    print("Heartbeat        max age %s   samples over threshold: %d"
          % (hms(max(ages) if ages else None), stalls))
    handles = [num(r, "handles") for r in rows if num(r, "handles")]
    if handles:
        print("Handles          start %d   end %d   peak %d"
              % (handles[0], handles[-1], max(handles)))
    return 0


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------

def main(argv=None):
    ap = argparse.ArgumentParser(
        prog="scriptwatch",
        description="External runtime monitor for InDesign ExtendScript jobs.")
    ap.add_argument("--heartbeat", "-b", default=os.environ.get("SCRIPTWATCH_HEARTBEAT"),
                    help="path to the JSON heartbeat written by the job")
    ap.add_argument("--pid", type=int, help="attach to this PID instead of searching")
    ap.add_argument("--process", default=DEFAULT_PROCESS,
                    help="process name fragment to match (default: InDesign)")
    ap.add_argument("--interval", "-i", type=float, default=DEFAULT_INTERVAL,
                    help="seconds between samples (default: 5)")
    ap.add_argument("--stall", type=int, default=DEFAULT_STALL,
                    help="heartbeat age in seconds before STALLED (default: 180)")
    ap.add_argument("--trend-window", type=int, default=DEFAULT_TREND_WINDOW,
                    help="seconds of history used for trend fits (default: 1800)")
    ap.add_argument("--mem-alert", type=float, default=DEFAULT_MEM_ALERT,
                    help="MB/hour slope that raises a memory alert (default: 50)")
    ap.add_argument("--watch", help="optional log or checkpoint file to track for growth")
    ap.add_argument("--csv", help="sample log path (default: timestamped file here)")
    ap.add_argument("--once", action="store_true", help="print one snapshot and exit")
    ap.add_argument("--no-clear", action="store_true", help="append output instead of redrawing")
    ap.add_argument("--report", metavar="CSV", help="analyze a finished run and exit")
    args = ap.parse_args(argv)

    if args.report:
        return report(args.report, args.stall)
    monitor = Monitor(args)
    time.sleep(0.5)  # let the first CPU delta accumulate before sampling
    return monitor.run()


if __name__ == "__main__":
    sys.exit(main())
