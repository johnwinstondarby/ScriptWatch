#!/usr/bin/env python3
"""
ScriptWatch - ExtendScript Runtime Monitor
==========================================

Out-of-process observer for long-running Adobe InDesign ExtendScript jobs.

ScriptWatch combines two independent acquisition paths:
  1. Harness/heartbeat job state published by the script itself.
  2. Agentless process and host telemetry sampled outside InDesign.

Either path can operate without the other. Every sample is appended to CSV so
post-run analysis uses the same evidence shown live in the console/dashboard.
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
DEFAULT_INTERVAL = 5.0
DEFAULT_STALL = 180
DEFAULT_TREND_WINDOW = 1800
DEFAULT_MEM_ALERT = 50.0
MIN_TREND_SPAN = 600.0
MIN_TREND_SAMPLES = 8
THROUGHPUT_TOLERANCE = 0.15
MB = 1024.0 * 1024.0
IS_WINDOWS = os.name == "nt"

DOCSTATS_DIR = (r"D:\Recovery Community Dropbox\DARBY FAMILY"
                r"\!!!New Business 2025\AI Ecosystem\DocStats")


def resolve_dir(explicit=None):
    for candidate in (explicit, os.environ.get("SCRIPTWATCH_DIR"), DOCSTATS_DIR):
        if candidate and os.path.isdir(candidate):
            return candidate
    return os.getcwd()


try:
    import psutil  # type: ignore
except ImportError:  # pragma: no cover - environment dependent
    psutil = None


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------

def hms(seconds):
    if seconds is None or seconds < 0 or math.isinf(seconds) or math.isnan(seconds):
        return "--:--:--"
    seconds = int(seconds)
    return "%d:%02d:%02d" % (seconds // 3600, (seconds % 3600) // 60, seconds % 60)


def now():
    return time.time()


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).astimezone().isoformat(timespec="seconds")


def slugify(text):
    out = "".join(c if (c.isalnum() or c in "._-") else "-" for c in str(text))
    return out.strip("-") or "job"


def slope_per_hour(points):
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


def _round_or_blank(value, digits=1):
    if value is None:
        return ""
    try:
        return round(float(value), digits)
    except (TypeError, ValueError):
        return ""


def _int_or_blank(value):
    if value is None:
        return ""
    try:
        return int(value)
    except (TypeError, ValueError):
        return ""


# --------------------------------------------------------------------------
# Heartbeat reader
# --------------------------------------------------------------------------

TERMINAL_STATUSES = ("DONE", "COMPLETE", "FINISHED", "ABORTED", "ERROR", "FAILED")


def discover_heartbeat(directory, stale_after=DEFAULT_STALL):
    """Return (newest plausible heartbeat, skipped stale terminal candidates)."""
    now_ts = time.time()
    best, best_mtime, skipped = None, -1.0, []
    try:
        names = os.listdir(directory)
    except OSError:
        return None, skipped
    for name in names:
        if not name.lower().endswith(".json"):
            continue
        path = os.path.join(directory, name)
        try:
            mtime = os.path.getmtime(path)
            with open(path, "r", encoding="utf-8-sig") as fh:
                data = json.load(fh)
            if not (isinstance(data, dict) and "job" in data and "target" in data):
                continue
            status = str(data.get("status", "")).upper()
            if status in TERMINAL_STATUSES and (now_ts - mtime) > stale_after:
                skipped.append((path, status))
                continue
            if mtime > best_mtime:
                best, best_mtime = path, mtime
        except Exception:
            continue
    return best, skipped


class Heartbeat(object):
    """Read the swap-written JSON heartbeat while retaining the last good parse."""

    FIELDS = (
        "job", "target", "total", "pass", "fail", "elapsedSeconds",
        "averageTargetMs", "lastCheckpoint", "status", "pid", "tool",
        "toolVersion", "harnessVersion", "mode", "metrics", "schemaVersion",
    )

    def __init__(self, path):
        self.path = path
        self.data = {}
        self.mtime = None
        self.last_good = None
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
            return
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

    def get(self, key, default=None):
        value = self.data.get(key, default)
        return default if value is None else value

    @property
    def age(self):
        if self.last_good is None:
            return None
        return max(0.0, now() - self.last_good)


# --------------------------------------------------------------------------
# Host telemetry
# --------------------------------------------------------------------------

SYSTEM_COUNTER_KEYS = (
    "physical_total_mb", "physical_available_mb", "physical_used_mb",
    "physical_used_pct", "commit_mb", "commit_limit_mb", "commit_pct",
    "commit_peak_mb", "system_cache_mb", "kernel_paged_mb",
    "kernel_nonpaged_mb", "process_count", "thread_count", "handle_count",
)


def empty_system_sample():
    return dict((key, None) for key in SYSTEM_COUNTER_KEYS)


def system_memory_sample():
    """
    Host physical-memory and commit counters.

    Windows uses GetPerformanceInfo so physical RAM and commit charge have real
    denominators. Non-Windows uses psutil physical-memory fields when available;
    Windows-specific commit/cache/kernel counters remain unavailable there.
    """
    empty = empty_system_sample()
    if IS_WINDOWS:
        try:
            import ctypes
            from ctypes import wintypes

            class PERFORMANCE_INFORMATION(ctypes.Structure):
                _fields_ = [
                    ("cb", wintypes.DWORD),
                    ("CommitTotal", ctypes.c_size_t),
                    ("CommitLimit", ctypes.c_size_t),
                    ("CommitPeak", ctypes.c_size_t),
                    ("PhysicalTotal", ctypes.c_size_t),
                    ("PhysicalAvailable", ctypes.c_size_t),
                    ("SystemCache", ctypes.c_size_t),
                    ("KernelTotal", ctypes.c_size_t),
                    ("KernelPaged", ctypes.c_size_t),
                    ("KernelNonpaged", ctypes.c_size_t),
                    ("PageSize", ctypes.c_size_t),
                    ("HandleCount", wintypes.DWORD),
                    ("ProcessCount", wintypes.DWORD),
                    ("ThreadCount", wintypes.DWORD),
                ]

            info = PERFORMANCE_INFORMATION()
            info.cb = ctypes.sizeof(info)
            fn = ctypes.windll.psapi.GetPerformanceInfo
            fn.argtypes = [ctypes.POINTER(PERFORMANCE_INFORMATION), wintypes.DWORD]
            fn.restype = wintypes.BOOL
            if not fn(ctypes.byref(info), info.cb):
                return empty

            page = float(info.PageSize)

            def pages_mb(value):
                return float(value) * page / MB

            total = pages_mb(info.PhysicalTotal)
            available = pages_mb(info.PhysicalAvailable)
            used = max(0.0, total - available)
            commit = pages_mb(info.CommitTotal)
            commit_limit = pages_mb(info.CommitLimit)
            return {
                "physical_total_mb": total,
                "physical_available_mb": available,
                "physical_used_mb": used,
                "physical_used_pct": (100.0 * used / total) if total else None,
                "commit_mb": commit,
                "commit_limit_mb": commit_limit,
                "commit_pct": (100.0 * commit / commit_limit) if commit_limit else None,
                "commit_peak_mb": pages_mb(info.CommitPeak),
                "system_cache_mb": pages_mb(info.SystemCache),
                "kernel_paged_mb": pages_mb(info.KernelPaged),
                "kernel_nonpaged_mb": pages_mb(info.KernelNonpaged),
                "process_count": int(info.ProcessCount),
                "thread_count": int(info.ThreadCount),
                "handle_count": int(info.HandleCount),
            }
        except Exception:
            return empty

    if psutil is not None:
        try:
            vm = psutil.virtual_memory()
            total = float(vm.total) / MB
            available = float(vm.available) / MB
            used = max(0.0, total - available)
            result = dict(empty)
            result.update({
                "physical_total_mb": total,
                "physical_available_mb": available,
                "physical_used_mb": used,
                "physical_used_pct": (100.0 * used / total) if total else None,
                "process_count": len(psutil.pids()),
            })
            return result
        except Exception:
            pass
    return empty


PROCESS_EXTRA_KEYS = (
    "io_read_bytes", "io_write_bytes", "io_other_bytes",
    "io_read_ops", "io_write_ops", "io_other_ops", "page_faults",
    "gdi_objects", "user_objects",
)


def empty_process_extras():
    return dict((key, None) for key in PROCESS_EXTRA_KEYS)


def windows_process_extras(pid):
    """
    Windows process I/O, page-fault, GDI, and USER counters.

    These counters are collected through Win32 APIs independently of psutil or
    the PowerShell fallback so both process backends publish the same semantics.
    Unavailable fields remain None rather than being mapped to another counter.
    """
    result = empty_process_extras()
    if not IS_WINDOWS:
        return result
    try:
        import ctypes
        from ctypes import wintypes

        PROCESS_QUERY_INFORMATION = 0x0400
        PROCESS_VM_READ = 0x0010
        GR_GDIOBJECTS = 0
        GR_USEROBJECTS = 1

        class IO_COUNTERS(ctypes.Structure):
            _fields_ = [
                ("ReadOperationCount", ctypes.c_ulonglong),
                ("WriteOperationCount", ctypes.c_ulonglong),
                ("OtherOperationCount", ctypes.c_ulonglong),
                ("ReadTransferCount", ctypes.c_ulonglong),
                ("WriteTransferCount", ctypes.c_ulonglong),
                ("OtherTransferCount", ctypes.c_ulonglong),
            ]

        class PROCESS_MEMORY_COUNTERS_EX(ctypes.Structure):
            _fields_ = [
                ("cb", wintypes.DWORD),
                ("PageFaultCount", wintypes.DWORD),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
                ("PrivateUsage", ctypes.c_size_t),
            ]

        kernel32 = ctypes.windll.kernel32
        kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel32.OpenProcess.restype = wintypes.HANDLE
        kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel32.CloseHandle.restype = wintypes.BOOL
        kernel32.GetProcessIoCounters.argtypes = [wintypes.HANDLE, ctypes.POINTER(IO_COUNTERS)]
        kernel32.GetProcessIoCounters.restype = wintypes.BOOL
        handle = kernel32.OpenProcess(
            PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, int(pid))
        if not handle:
            return result
        try:
            io_info = IO_COUNTERS()
            if kernel32.GetProcessIoCounters(handle, ctypes.byref(io_info)):
                result.update({
                    "io_read_bytes": int(io_info.ReadTransferCount),
                    "io_write_bytes": int(io_info.WriteTransferCount),
                    "io_other_bytes": int(io_info.OtherTransferCount),
                    "io_read_ops": int(io_info.ReadOperationCount),
                    "io_write_ops": int(io_info.WriteOperationCount),
                    "io_other_ops": int(io_info.OtherOperationCount),
                })

            pmc = PROCESS_MEMORY_COUNTERS_EX()
            pmc.cb = ctypes.sizeof(pmc)
            get_mem = ctypes.windll.psapi.GetProcessMemoryInfo
            get_mem.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESS_MEMORY_COUNTERS_EX), wintypes.DWORD]
            get_mem.restype = wintypes.BOOL
            if get_mem(handle, ctypes.byref(pmc), pmc.cb):
                result["page_faults"] = int(pmc.PageFaultCount)

            try:
                user32 = ctypes.windll.user32
                user32.GetGuiResources.argtypes = [wintypes.HANDLE, wintypes.DWORD]
                user32.GetGuiResources.restype = wintypes.DWORD
                result["gdi_objects"] = int(user32.GetGuiResources(handle, GR_GDIOBJECTS))
                result["user_objects"] = int(user32.GetGuiResources(handle, GR_USEROBJECTS))
            except Exception:
                pass
        finally:
            kernel32.CloseHandle(handle)
    except Exception:
        pass
    return result


# --------------------------------------------------------------------------
# Process telemetry backends
# --------------------------------------------------------------------------

class Probe(object):
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
        self.proc.cpu_percent(None)

    def sample(self):
        try:
            with self.proc.oneshot():
                mi = self.proc.memory_info()
                private = getattr(mi, "private", None)
                pagefile = getattr(mi, "pagefile", None)
                out = {
                    "cpu": self.proc.cpu_percent(None) / float(self.cores),
                    "working_mb": mi.rss / MB,
                    "private_mb": (private if private is not None else mi.vms) / MB,
                    "pagefile_mb": (pagefile if pagefile is not None else mi.vms) / MB,
                    "threads": self.proc.num_threads(),
                    "handles": (self.proc.num_handles()
                                if hasattr(self.proc, "num_handles") else None),
                }
            if not IS_WINDOWS:
                try:
                    io = self.proc.io_counters()
                    out.update({
                        "io_read_bytes": getattr(io, "read_bytes", None),
                        "io_write_bytes": getattr(io, "write_bytes", None),
                        "io_other_bytes": getattr(io, "other_bytes", None),
                        "io_read_ops": getattr(io, "read_count", None),
                        "io_write_ops": getattr(io, "write_count", None),
                        "io_other_ops": getattr(io, "other_count", None),
                        "page_faults": getattr(mi, "num_page_faults", None),
                        "gdi_objects": None,
                        "user_objects": None,
                    })
                except Exception:
                    out.update(empty_process_extras())
            return out
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            return None


class PowerShellProbe(Probe):
    """Get-Process fallback when psutil is unavailable."""

    PS = ("$ErrorActionPreference='Stop';$p=Get-Process -Id {pid};"
          "[pscustomobject]@{{ws=$p.WorkingSet64;priv=$p.PrivateMemorySize64;"
          "paged=$p.PagedMemorySize64;threads=@($p.Threads).Count;"
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
            "pagefile_mb": float(raw["paged"]) / MB,
            "threads": int(raw["threads"]),
            "handles": int(raw["handles"]),
        }


def enrich_process_sample(proc, pid):
    if proc is None:
        return None
    extras = windows_process_extras(pid) if IS_WINDOWS else empty_process_extras()
    if not IS_WINDOWS and isinstance(proc, dict):
        for key in PROCESS_EXTRA_KEYS:
            if key in proc:
                extras[key] = proc[key]
    out = dict(proc)
    out.update(extras)
    return out


def find_processes(name_fragment):
    fragment = name_fragment.lower()
    found = []
    if psutil is not None:
        for proc in psutil.process_iter(["pid", "name", "memory_info"]):
            try:
                if fragment in (proc.info["name"] or "").lower():
                    mi = proc.info["memory_info"]
                    found.append((proc.info["pid"], mi.rss if mi else 0))
            except Exception:
                continue
    elif IS_WINDOWS:
        try:
            out = subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive", "-Command",
                 "Get-Process -Name '*%s*' -ErrorAction SilentlyContinue |"
                 " ForEach-Object { \"$($_.Id) $($_.WorkingSet64)\" }" % name_fragment],
                capture_output=True, text=True, timeout=20)
            for line in out.stdout.splitlines():
                bits = line.split()
                if len(bits) == 2 and bits[0].isdigit():
                    found.append((int(bits[0]), int(bits[1])))
        except Exception:
            pass
    found.sort(key=lambda pair: pair[1], reverse=True)
    return found


def pid_holding(path, candidates):
    if psutil is None or not path:
        return None
    try:
        target = os.path.normcase(os.path.abspath(path))
    except Exception:
        return None
    for pid in candidates:
        try:
            for handle in psutil.Process(pid).open_files():
                if os.path.normcase(os.path.abspath(handle.path)) == target:
                    return pid
        except Exception:
            continue
    return None


def is_responding(pid):
    """Windows UI-pump status; blocked is expected during modal ExtendScript."""
    if not IS_WINDOWS:
        return None
    try:
        out = subprocess.run(
            ["tasklist", "/FI", "PID eq %d" % pid,
             "/FI", "STATUS eq NOT RESPONDING", "/NH", "/FO", "CSV"],
            capture_output=True, text=True, timeout=15)
        return str(pid) not in out.stdout
    except Exception:
        return None


# --------------------------------------------------------------------------
# Monitor
# --------------------------------------------------------------------------

CSV_COLUMNS = [
    "iso", "epoch", "pid", "cpu_pct", "working_mb", "private_mb", "pagefile_mb",
    "threads", "handles", "page_faults", "gdi_objects", "user_objects",
    "io_read_bytes", "io_write_bytes", "io_other_bytes",
    "io_read_ops", "io_write_ops", "io_other_ops", "responding",
    "system_physical_total_mb", "system_physical_available_mb", "system_physical_used_mb",
    "system_physical_used_pct", "system_commit_mb", "system_commit_limit_mb",
    "system_commit_pct", "system_commit_peak_mb", "system_cache_mb",
    "system_kernel_paged_mb", "system_kernel_nonpaged_mb", "system_processes",
    "system_threads", "system_handles",
    "job", "tool", "tool_version", "harness_version", "heartbeat_schema", "job_mode",
    "target", "total", "passed", "failed", "checkpoint", "hb_age_s",
    "rate_per_min", "eta_s", "watch_bytes", "heartbeat_note", "metrics_json",
]


class Monitor(object):
    def __init__(self, args):
        self.args = args
        self.dir = resolve_dir(args.dir)
        self.warnings = []
        hb_path = args.heartbeat
        if not hb_path:
            hb_path, skipped = discover_heartbeat(self.dir, args.stall)
            if not hb_path and skipped:
                self.warnings.append(
                    "skipped %d finished heartbeat%s in %s (%s); pass --heartbeat to "
                    "attach anyway" % (
                        len(skipped), "" if len(skipped) == 1 else "s", self.dir,
                        ", ".join(sorted(set(status for _, status in skipped))),
                    ))
        self.hb = Heartbeat(hb_path)
        self.hb.poll()
        self.pid = args.pid or self.hb.data.get("pid") or self._choose_pid()
        if not self.pid:
            raise SystemExit("No process matching '%s' found. Pass --pid, or start "
                             "InDesign first." % args.process)
        self.probe = self._make_probe(int(self.pid))
        self.mem_hist = deque()
        self.tgt_hist = deque()
        self.started = now()
        self.samples = 0
        self.peak_private = 0.0
        self.csv_path = args.csv or os.path.join(
            self.dir, "ScriptWatch_%s_%s.csv" % (
                slugify(self.hb.get("job") or args.process),
                datetime.now().strftime("%Y%m%d-%H%M%S"),
            ))
        self._init_csv()

    def _choose_pid(self):
        found = find_processes(self.args.process)
        if not found:
            return None
        if len(found) > 1:
            pids = [pid for pid, _ in found]
            holder = pid_holding(self.hb.get("lock"), pids)
            if holder:
                self.warnings.append(
                    "%d %s instances running; matched pid %d by heartbeat lock file"
                    % (len(found), self.args.process, holder))
                return holder
            self.warnings.append(
                "%d %s instances running; attached to pid %d by working set. "
                "Use --pid to be certain." % (len(found), self.args.process, pids[0]))
        return found[0][0]

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
        return [point for point in history if point[0] >= cutoff]

    def coverage(self):
        pts = self._trend_window(self.mem_hist)
        return (pts[-1][0] - pts[0][0]) if len(pts) >= 2 else 0.0

    def memory_trend(self):
        pts = self._trend_window(self.mem_hist)
        if len(pts) < MIN_TREND_SAMPLES or (pts[-1][0] - pts[0][0]) < MIN_TREND_SPAN:
            return None
        return slope_per_hour(pts)

    def rate_per_min(self):
        pts = self._trend_window(self.tgt_hist)
        if len(pts) < 2:
            return None
        dt = pts[-1][0] - pts[0][0]
        dn = pts[-1][1] - pts[0][1]
        if dt <= 30 or dn <= 0:
            return None
        return dn / (dt / 60.0)

    def throughput_trend(self):
        pts = self._trend_window(self.tgt_hist)
        if len(pts) < 6 or (pts[-1][0] - pts[0][0]) < MIN_TREND_SPAN:
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
        return self.warnings + out

    def _metrics_json(self):
        metrics = self.hb.get("metrics", [])
        if not isinstance(metrics, list):
            return "[]"
        try:
            return json.dumps(metrics, separators=(",", ":"), ensure_ascii=False)
        except Exception:
            return "[]"

    # -- main loop ---------------------------------------------------------
    def tick(self):
        self.hb.poll()
        proc = self.probe.sample()
        if proc is None:
            return None
        proc = enrich_process_sample(proc, int(self.pid))
        system = system_memory_sample()
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

        row = [
            iso(stamp), round(stamp, 2), self.pid,
            _round_or_blank(proc.get("cpu"), 2),
            _round_or_blank(proc.get("working_mb"), 1),
            _round_or_blank(proc.get("private_mb"), 1),
            _round_or_blank(proc.get("pagefile_mb"), 1),
            _int_or_blank(proc.get("threads")), _int_or_blank(proc.get("handles")),
            _int_or_blank(proc.get("page_faults")), _int_or_blank(proc.get("gdi_objects")),
            _int_or_blank(proc.get("user_objects")), _int_or_blank(proc.get("io_read_bytes")),
            _int_or_blank(proc.get("io_write_bytes")), _int_or_blank(proc.get("io_other_bytes")),
            _int_or_blank(proc.get("io_read_ops")), _int_or_blank(proc.get("io_write_ops")),
            _int_or_blank(proc.get("io_other_ops")),
            "" if responding is None else int(responding),
            _round_or_blank(system.get("physical_total_mb"), 1),
            _round_or_blank(system.get("physical_available_mb"), 1),
            _round_or_blank(system.get("physical_used_mb"), 1),
            _round_or_blank(system.get("physical_used_pct"), 2),
            _round_or_blank(system.get("commit_mb"), 1),
            _round_or_blank(system.get("commit_limit_mb"), 1),
            _round_or_blank(system.get("commit_pct"), 2),
            _round_or_blank(system.get("commit_peak_mb"), 1),
            _round_or_blank(system.get("system_cache_mb"), 1),
            _round_or_blank(system.get("kernel_paged_mb"), 1),
            _round_or_blank(system.get("kernel_nonpaged_mb"), 1),
            _int_or_blank(system.get("process_count")), _int_or_blank(system.get("thread_count")),
            _int_or_blank(system.get("handle_count")),
            self.hb.get("job", ""), self.hb.get("tool", ""),
            self.hb.get("toolVersion", ""), self.hb.get("harnessVersion", ""),
            self.hb.get("schemaVersion", ""), self.hb.get("mode", ""),
            self.hb.get("target", ""), self.hb.get("total", ""),
            self.hb.get("pass", ""), self.hb.get("fail", ""),
            self.hb.get("lastCheckpoint", ""),
            "" if self.hb.age is None else round(self.hb.age, 1),
            "" if rate is None else round(rate, 3),
            "" if eta is None else round(eta, 0),
            "" if watch_bytes is None else watch_bytes,
            self.hb.get("note", ""), self._metrics_json(),
        ]
        self.csv.writerow(row)
        self.csv_file.flush()
        return {
            "proc": proc, "system": system, "rate": rate, "eta": eta,
            "responding": responding, "watch_bytes": watch_bytes, "ts": stamp,
        }

    # -- rendering ---------------------------------------------------------
    def render(self, snap):
        proc = snap["proc"]
        system = snap["system"]
        mem_slope = self.memory_trend()
        trend, ratio = self.throughput_trend()
        state, note = self.status()
        target, total = self.hb.get("target"), self.hb.get("total")
        job = self.hb.get("job") or "(no heartbeat - process telemetry only)"

        pct = ""
        if isinstance(target, (int, float)) and isinstance(total, (int, float)) and total:
            pct = "  %5.1f%%" % (100.0 * target / total)

        lines = [job, "=" * max(28, min(64, len(job)))]
        lines.append("Target        %s / %s%s" % (
            target if target is not None else "?", total if total is not None else "?", pct))
        lines.append("Pass / Fail   %s / %s" % (self.hb.get("pass", "?"), self.hb.get("fail", "?")))
        elapsed = self.hb.get("elapsedSeconds")
        lines.append("Elapsed       %s   (monitor %s)" % (
            hms(elapsed) if elapsed else "--:--:--", hms(now() - self.started)))
        lines.append("Rate          %s targets/min" % ("%.2f" % snap["rate"] if snap["rate"] else "--"))
        avg = self.hb.get("averageTargetMs")
        if avg:
            lines.append("Avg target    %.1f s" % (float(avg) / 1000.0))
        lines.append("ETA           %s%s" % (
            hms(snap["eta"]),
            "   (finish ~%s)" % datetime.fromtimestamp(now() + snap["eta"]).strftime("%H:%M")
            if snap["eta"] else ""))

        if self.hb.get("harnessVersion"):
            lines.append("Harness       %s%s%s" % (
                self.hb.get("harnessVersion"),
                "   tool " + str(self.hb.get("tool")) if self.hb.get("tool") else "",
                " " + str(self.hb.get("toolVersion")) if self.hb.get("toolVersion") else ""))

        lines.append("")
        lines.append("InDesign  pid %s   up %s" % (self.pid, hms(self.probe.uptime)))
        lines.append("CPU           %5.1f %%" % proc["cpu"])
        lines.append("Private MB    %8.1f   (peak %.1f)" % (proc["private_mb"], self.peak_private))
        lines.append("Working MB    %8.1f" % proc["working_mb"])
        lines.append("Pagefile MB   %8.1f" % proc["pagefile_mb"])
        lines.append("Threads       %8s" % proc["threads"])
        lines.append("Handles       %8s" % (proc["handles"] if proc["handles"] is not None else "n/a"))
        if proc.get("gdi_objects") is not None:
            lines.append("GDI / USER    %s / %s" % (proc.get("gdi_objects"), proc.get("user_objects")))
        if proc.get("io_read_bytes") is not None:
            lines.append("I/O read/write %.1f / %.1f MB" % (
                proc.get("io_read_bytes") / MB, proc.get("io_write_bytes") / MB))
        if snap["responding"] is not None:
            lines.append("UI pump       %s" % (
                "responsive" if snap["responding"] else "blocked (expected during a modal script)"))

        if system.get("physical_used_pct") is not None:
            lines.append("Host RAM      %5.1f %% used" % system["physical_used_pct"])
        if system.get("commit_pct") is not None:
            lines.append("Host commit   %5.1f %%" % system["commit_pct"])

        lines.append("")
        collecting = "collecting... %s of %s" % (hms(self.coverage()), hms(MIN_TREND_SPAN))
        lines.append("Memory trend       %s" % (
            "%+.1f MB/hour" % mem_slope if mem_slope is not None else collecting))
        lines.append("Throughput trend   %s" % (trend or collecting))
        lines.append("Heartbeat age      %s" % (
            "%d sec" % self.hb.age if self.hb.age is not None else "n/a"))
        lines.append("Last checkpoint    %s" % self.hb.get("lastCheckpoint", "n/a"))
        if snap["watch_bytes"] is not None:
            lines.append("Watched file       %.1f KB" % (snap["watch_bytes"] / 1024.0))
        lines.append("Status             %s%s" % (state, "  - " + note if note else ""))
        for alert in self.alerts(mem_slope, trend, ratio):
            lines.append("  !  %s" % alert)
        lines.append("")
        if self.hb.path:
            lines.append("heartbeat: %s" % self.hb.path)
        lines.append("log: %s" % self.csv_path)
        lines.append("samples: %d   %s" % (self.samples, datetime.now().strftime("%H:%M:%S")))
        return lines

    def snapshot(self, snap):
        proc = snap["proc"]
        system = snap["system"]
        mem_slope = self.memory_trend()
        trend, ratio = self.throughput_trend()
        state, note = self.status()
        target, total = self.hb.get("target"), self.hb.get("total")
        pct = None
        if isinstance(target, (int, float)) and isinstance(total, (int, float)) and total:
            pct = 100.0 * target / total
        return {
            "job": self.hb.get("job"),
            "status": state,
            "status_note": note,
            "heartbeat_path": self.hb.path,
            "heartbeat_age": self.hb.age,
            "heartbeat_seen": self.hb.ever_seen,
            "host": self.hb.get("host"),
            "writes": self.hb.get("writes"),
            "heartbeat_note": self.hb.get("note"),
            "heartbeat_schema": self.hb.get("schemaVersion"),
            "tool": self.hb.get("tool"),
            "tool_version": self.hb.get("toolVersion"),
            "harness_version": self.hb.get("harnessVersion"),
            "job_mode": self.hb.get("mode"),
            "metrics": self.hb.get("metrics", []),
            "target": target,
            "total": total,
            "percent": pct,
            "passed": self.hb.get("pass"),
            "failed": self.hb.get("fail"),
            "checkpoint": self.hb.get("lastCheckpoint"),
            "elapsed": self.hb.get("elapsedSeconds"),
            "average_target_ms": self.hb.get("averageTargetMs"),
            "rate_per_min": snap["rate"],
            "eta": snap["eta"],
            "pid": self.pid,
            "probe": ("psutil" if isinstance(self.probe, PsutilProbe)
                      else "PowerShell Get-Process"),
            "uptime": self.probe.uptime,
            "cpu": proc["cpu"],
            "private_mb": proc["private_mb"],
            "peak_private_mb": self.peak_private,
            "working_mb": proc["working_mb"],
            "pagefile_mb": proc["pagefile_mb"],
            "threads": proc["threads"],
            "handles": proc["handles"],
            "page_faults": proc.get("page_faults"),
            "gdi_objects": proc.get("gdi_objects"),
            "user_objects": proc.get("user_objects"),
            "io_read_bytes": proc.get("io_read_bytes"),
            "io_write_bytes": proc.get("io_write_bytes"),
            "io_other_bytes": proc.get("io_other_bytes"),
            "io_read_ops": proc.get("io_read_ops"),
            "io_write_ops": proc.get("io_write_ops"),
            "io_other_ops": proc.get("io_other_ops"),
            "system": system,
            "responding": snap["responding"],
            "memory_slope": mem_slope,
            "memory_collecting": mem_slope is None,
            "throughput_trend": trend,
            "throughput_ratio": ratio,
            "throughput_collecting": trend is None,
            "coverage": self.coverage(),
            "coverage_required": MIN_TREND_SPAN,
            "trend_window": self.args.trend_window,
            "samples": self.samples,
            "alerts": self.alerts(mem_slope, trend, ratio),
            "watch_bytes": snap["watch_bytes"],
            "csv_path": self.csv_path,
            "sampled_at": snap["ts"],
        }

    def run(self):
        ansi = enable_ansi() and not self.args.no_clear
        prev_lines = 0
        try:
            while True:
                snap = self.tick()
                if snap is None:
                    print("\nProcess %s has exited. Log written to %s" % (self.pid, self.csv_path))
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
            value = row.get(key)
            return float(value) if value not in (None, "") else None
        except (TypeError, ValueError):
            return None

    def series(key):
        return [num(row, key) for row in rows if num(row, key) is not None]

    def print_delta(label, key, unit=""):
        values = series(key)
        if not values:
            return
        suffix = (" " + unit) if unit else ""
        print("%-17s start %.1f%s   end %.1f%s   peak %.1f%s   delta %+.1f%s"
              % (label, values[0], suffix, values[-1], suffix, max(values), suffix,
                 values[-1] - values[0], suffix))

    t0, t1 = num(rows[0], "epoch"), num(rows[-1], "epoch")
    mem = [(num(row, "epoch"), num(row, "private_mb"))
           for row in rows if num(row, "epoch") is not None and num(row, "private_mb") is not None]
    tgt = [(num(row, "epoch"), num(row, "target"))
           for row in rows if num(row, "epoch") is not None and num(row, "target") is not None]
    slope = slope_per_hour(mem)
    job = rows[-1].get("job") or "(unnamed job)"

    print("ScriptWatch report - %s" % path)
    print("Job              %s" % job)
    print("Window           %s -> %s  (%s)" % (
        rows[0].get("iso", ""), rows[-1].get("iso", ""),
        hms((t1 - t0) if t0 is not None and t1 is not None else None)))
    print("Samples          %d" % len(rows))

    tool = rows[-1].get("tool") or ""
    tool_version = rows[-1].get("tool_version") or ""
    harness_version = rows[-1].get("harness_version") or ""
    if harness_version:
        print("Harness          %s%s%s" % (
            harness_version, "   " + tool if tool else "",
            " " + tool_version if tool_version else ""))
    heartbeat_notes = [str(row.get("heartbeat_note") or "").strip()
                       for row in rows if str(row.get("heartbeat_note") or "").strip()]
    if heartbeat_notes:
        print("Heartbeat note   %s" % heartbeat_notes[-1])

    if mem:
        print("Private MB       start %.1f   end %.1f   peak %.1f   delta %+.1f" % (
            mem[0][1], mem[-1][1], max(value for _, value in mem), mem[-1][1] - mem[0][1]))
        span = (mem[-1][0] - mem[0][0]) if len(mem) >= 2 else 0
        if span < MIN_TREND_SPAN:
            print("Memory slope     not reported - only %s of coverage" % hms(span))
        elif slope is not None:
            verdict = ("flat - no evidence of accumulation" if abs(slope) < 5
                       else "rising - consistent with retention between targets"
                       if slope > 0 else "falling - memory returned to the OS")
            print("Memory slope     %+.2f MB/hour   (%s)" % (slope, verdict))

    print_delta("System RAM %", "system_physical_used_pct", "%")
    print_delta("System commit %", "system_commit_pct", "%")

    def byte_delta(label, key):
        values = series(key)
        if values:
            print("%-17s delta %+.1f MB" % (label, (values[-1] - values[0]) / MB))

    byte_delta("I/O read", "io_read_bytes")
    byte_delta("I/O write", "io_write_bytes")
    byte_delta("I/O other", "io_other_bytes")

    for label, key in (("Page faults", "page_faults"), ("GDI objects", "gdi_objects"),
                       ("USER objects", "user_objects"), ("Handles", "handles")):
        values = series(key)
        if values:
            print("%-17s start %d   end %d   peak %d   delta %+d" % (
                label, values[0], values[-1], max(values), values[-1] - values[0]))

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

    ages = [num(row, "hb_age_s") or 0 for row in rows]
    stalls = sum(1 for age in ages if age > stall_seconds)
    print("Heartbeat        max age %s   samples over threshold: %d" % (
        hms(max(ages) if ages else None), stalls))

    metrics_rows = [row.get("metrics_json") for row in rows if row.get("metrics_json")]
    if metrics_rows:
        try:
            metrics = json.loads(metrics_rows[-1])
            if metrics:
                print("Harness metrics  %d final metric%s recorded" % (
                    len(metrics), "" if len(metrics) == 1 else "s"))
                for metric in metrics[:12]:
                    if isinstance(metric, dict):
                        unit = str(metric.get("unit") or "")
                        print("  %-15s %s%s" % (
                            str(metric.get("name") or "metric"), metric.get("value"),
                            (" " + unit) if unit else ""))
        except Exception:
            pass
    return 0


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------

def build_parser():
    ap = argparse.ArgumentParser(
        prog="scriptwatch",
        description="External runtime monitor for InDesign ExtendScript jobs.")
    ap.add_argument("--dir", "-d", help="runtime directory for heartbeat discovery and sample log")
    ap.add_argument("--heartbeat", "-b", default=os.environ.get("SCRIPTWATCH_HEARTBEAT"),
                    help="heartbeat JSON path; newest plausible heartbeat is auto-discovered")
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
    ap.add_argument("--csv", help="sample log path (default: timestamped file in runtime directory)")
    ap.add_argument("--once", action="store_true", help="print one snapshot and exit")
    ap.add_argument("--no-clear", action="store_true", help="append output instead of redrawing")
    ap.add_argument("--report", metavar="CSV", help="analyze a finished run and exit")
    return ap


def main(argv=None):
    args = build_parser().parse_args(argv)
    if args.report:
        return report(args.report, args.stall)
    monitor = Monitor(args)
    time.sleep(0.5)
    return monitor.run()


if __name__ == "__main__":
    sys.exit(main())
