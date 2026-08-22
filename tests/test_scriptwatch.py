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

import csv
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import scriptwatch


class ScriptWatchCollectorCanary(unittest.TestCase):
    def write_hb(self, directory, name, status, age=0):
        path = Path(directory) / name
        path.write_text('{"job":"Canary","target":1,"total":2,"status":"%s"}' % status,
                        encoding="utf-8")
        stamp = time.time() - age
        os.utime(path, (stamp, stamp))
        return str(path)

    def test_stale_terminal_discovery(self):
        with tempfile.TemporaryDirectory() as td:
            stale = self.write_hb(td, "old.json", "DONE", age=600)
            live = self.write_hb(td, "live.json", "RUNNING", age=1)
            found, skipped = scriptwatch.discover_heartbeat(td, stale_after=180)
            self.assertEqual(os.path.normcase(found), os.path.normcase(live))
            self.assertEqual(skipped, [(stale, "DONE")])

    def test_all_stale_terminal_reports_skipped(self):
        with tempfile.TemporaryDirectory() as td:
            self.write_hb(td, "a.json", "ABORTED", age=600)
            self.write_hb(td, "b.json", "COMPLETE", age=500)
            found, skipped = scriptwatch.discover_heartbeat(td, stale_after=180)
            self.assertIsNone(found)
            self.assertEqual({status for _, status in skipped}, {"ABORTED", "COMPLETE"})

    def test_recent_terminal_is_eligible(self):
        with tempfile.TemporaryDirectory() as td:
            recent = self.write_hb(td, "recent.json", "DONE", age=2)
            found, skipped = scriptwatch.discover_heartbeat(td, stale_after=180)
            self.assertEqual(os.path.normcase(found), os.path.normcase(recent))
            self.assertEqual(skipped, [])

    def test_csv_contract_has_no_duplicate_columns(self):
        self.assertEqual(len(scriptwatch.CSV_COLUMNS), len(set(scriptwatch.CSV_COLUMNS)))
        for required in (
            "system_physical_used_pct", "system_commit_pct", "io_read_bytes",
            "io_write_bytes", "page_faults", "gdi_objects", "user_objects",
            "tool", "tool_version", "harness_version", "heartbeat_schema",
            "job_mode", "metrics_json",
        ):
            self.assertIn(required, scriptwatch.CSV_COLUMNS)

    def test_system_sample_schema_is_stable(self):
        sample = scriptwatch.system_memory_sample()
        self.assertEqual(set(sample), set(scriptwatch.SYSTEM_COUNTER_KEYS))
        pct = sample.get("physical_used_pct")
        if pct is not None:
            self.assertGreaterEqual(pct, 0)
            self.assertLessEqual(pct, 100)

    def test_legacy_report_remains_readable(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "legacy.csv"
            with path.open("w", newline="", encoding="utf-8") as fh:
                writer = csv.writer(fh)
                writer.writerow(["iso", "epoch", "private_mb", "job", "hb_age_s", "handles"])
                writer.writerow(["2026-08-21T00:00:00-07:00", 1000, 100, "Legacy", 0, 10])
                writer.writerow(["2026-08-21T00:11:00-07:00", 1660, 101, "Legacy", 0, 11])
            self.assertEqual(scriptwatch.report(str(path), 180), 0)


class DashboardContractCanary(unittest.TestCase):
    def test_payload_uses_collector_system_and_harness_contract(self):
        import scriptwatch_web

        class FakeMonitor:
            started = 1000.0
            dir = "runtime"
            def snapshot(self, snap):
                return {
                    "sampled_at": 1010.0, "job": "Canary", "status": "RUNNING",
                    "status_note": "", "target": 2, "total": 10, "percent": 20.0,
                    "passed": 2, "failed": 0, "elapsed": 10, "average_target_ms": 5000,
                    "rate_per_min": 12.0, "eta": 40.0, "checkpoint": 0,
                    "heartbeat_age": 1.0, "heartbeat_path": "canary.json",
                    "heartbeat_seen": True, "writes": 3, "host": "HOST",
                    "heartbeat_note": "NormalFix · harness 1.2",
                    "tool": "NormalFix", "tool_version": "canary",
                    "harness_version": "1.2", "heartbeat_schema": "1.2",
                    "job_mode": "collection",
                    "metrics": [{"name": "Stories", "value": 26, "unit": "stories"}],
                    "pid": 123, "probe": "fake", "uptime": 100, "cpu": 10.0,
                    "private_mb": 1000.0, "peak_private_mb": 1000.0,
                    "working_mb": 500.0, "pagefile_mb": 100.0, "threads": 20,
                    "handles": 200, "page_faults": 300, "gdi_objects": 40,
                    "user_objects": 50, "io_read_bytes": 1000, "io_write_bytes": 2000,
                    "io_other_bytes": 3000, "io_read_ops": 10, "io_write_ops": 20,
                    "io_other_ops": 30,
                    "system": {
                        "physical_total_mb": 64000, "physical_available_mb": 32000,
                        "physical_used_mb": 32000, "physical_used_pct": 50,
                        "commit_mb": 20000, "commit_limit_mb": 80000, "commit_pct": 25,
                        "commit_peak_mb": 25000, "system_cache_mb": 5000,
                        "kernel_paged_mb": 500, "kernel_nonpaged_mb": 300,
                        "process_count": 200, "thread_count": 3000, "handle_count": 100000,
                    },
                    "responding": None, "memory_slope": None, "memory_collecting": True,
                    "throughput_trend": None, "throughput_ratio": None,
                    "throughput_collecting": True, "coverage": 10,
                    "coverage_required": 600, "trend_window": 1800, "samples": 3,
                    "alerts": [], "watch_bytes": None, "csv_path": "canary.csv",
                }

        state = scriptwatch_web.DashboardState(FakeMonitor(), 5, 30)
        payload = state._build_payload({})
        self.assertEqual(payload["system"]["physicalUsedPct"], 50.0)
        self.assertEqual(payload["job"]["harnessVersion"], "1.2")
        self.assertEqual(payload["job"]["metrics"][0]["name"], "Stories")
        self.assertEqual(payload["process"]["gdiObjects"], 40)
        self.assertEqual(payload["process"]["ioReadDeltaBytes"], 0.0)



if __name__ == "__main__":
    unittest.main()
