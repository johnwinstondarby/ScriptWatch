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

import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
DASHBOARD = ROOT / "dashboard"


class SampleMotionContractTests(unittest.TestCase):
    def test_motion_bridge_is_loaded_after_visual_layers(self):
        html = (DASHBOARD / "index.html").read_text(encoding="utf-8")
        self.assertIn('src="motion.js"', html)
        self.assertLess(html.index('src="spotlight.js"'), html.index('src="motion.js"'))

    def test_motion_bridge_uses_rendered_events_without_backend_polling(self):
        js = (DASHBOARD / "motion.js").read_text(encoding="utf-8")
        self.assertIn('SAMPLE_MARKER_ID = "counter-bank-state"', js)
        self.assertIn('HEARTBEAT_WRITES_ID = "heartbeat-writes"', js)
        self.assertIn("MutationObserver", js)
        self.assertIn("onFreshRenderedSample", js)
        self.assertIn("observeHarnessMetricChanges", js)
        self.assertNotIn("fetch(", js)

    def test_one_collector_event_has_one_liveness_carrier(self):
        js = (DASHBOARD / "motion.js").read_text(encoding="utf-8")
        self.assertIn("pulseCollectorCarrier", js)
        self.assertIn("Host -> Process lane is therefore the single collector", js)
        self.assertIn("source-node[data-source=\"host\"]", js)
        self.assertNotIn('["host", "process"].forEach', js)
        self.assertNotIn("querySelectorAll('.counter-card[data-source=", js)

    def test_heartbeat_has_independent_carrier(self):
        js = (DASHBOARD / "motion.js").read_text(encoding="utf-8")
        self.assertIn("pulseHeartbeatCarrier", js)
        self.assertIn('source-node[data-source="process"]', js)
        self.assertIn("heartbeatChanged", js)
        self.assertIn('openFreshnessGate("heartbeat"', js)

    def test_harness_carrier_requires_semantic_change(self):
        js = (DASHBOARD / "motion.js").read_text(encoding="utf-8")
        self.assertIn("pulseHarnessChangeCarrier", js)
        self.assertIn("harnessMetricSignature", js)
        self.assertIn('source-node[data-source="heartbeat"]', js)

    def test_travelling_lines_are_suppressed_in_favor_of_local_cues(self):
        css = (DASHBOARD / "refinement.css").read_text(encoding="utf-8")
        self.assertIn("Travelling line/slug effects are intentionally suppressed", css)
        self.assertIn(".source-node:not(:last-child)::before", css)
        self.assertIn("opacity: 0 !important", css)
        self.assertIn("swSourceLampPulse", css)
        self.assertIn(".source-node.sample-pulse.state-live .source-lamp", css)
        self.assertNotIn("@keyframes swWallPacket", css)

    def test_individual_metric_motion_is_change_driven_and_local(self):
        js = (DASHBOARD / "motion.js").read_text(encoding="utf-8")
        css = (DASHBOARD / "refinement.css").read_text(encoding="utf-8")
        self.assertIn("markMetricChange", js)
        for value_id in ("progress-percent", "cpu-value", "ram-value", "commit-value"):
            self.assertIn(value_id, js)
        self.assertIn(".counter-card.sample-update.state-live::after", css)
        self.assertIn(".counter-card.sample-update.state-live strong", css)
        self.assertIn("swMetricValueAck", css)
        self.assertIn(".activity-ring.metric-change.state-live::after", css)
        self.assertIn(".capacity-meter.metric-change.state-live", css)
        self.assertIn("animation: none !important", css)

    def test_wall_mode_continuous_motion_is_source_only_and_local(self):
        css = (DASHBOARD / "refinement.css").read_text(encoding="utf-8")
        self.assertIn("wall-collector-fresh", css)
        self.assertIn("wall-heartbeat-fresh", css)
        self.assertIn("swWallSourceAlive", css)
        self.assertIn('source-node[data-source="host"].state-live .source-lamp', css)
        self.assertIn('source-node[data-source="process"].state-live .source-lamp', css)
        self.assertNotIn("wall-collector-fresh .counter-card[data-source", css)
        self.assertNotIn("wall-collector-fresh #cpu-gauge", css)

    def test_no_manufactured_independence_is_pinned(self):
        contract = (ROOT / "docs" / "VISUAL_CONTRACT.md").read_text(encoding="utf-8")
        wall = (ROOT / "docs" / "WALL_MODE_BEHAVIOR.md").read_text(encoding="utf-8")
        self.assertIn("Indicator independence rule", contract)
        self.assertIn("Artificial staggering, random jitter, phase offsets", contract)
        self.assertIn("underlying data can disagree with its neighbors", contract)
        self.assertIn("No manufactured independence", wall)
        self.assertIn("Stagger, phase offset, jitter", wall)

    def test_heartbeat_absence_has_one_primary_annunciation(self):
        motion = (DASHBOARD / "motion.js").read_text(encoding="utf-8")
        material = (DASHBOARD / "material.css").read_text(encoding="utf-8")
        contract = (ROOT / "docs" / "VISUAL_CONTRACT.md").read_text(encoding="utf-8")
        self.assertIn("heartbeat-absent", motion)
        self.assertIn(".heartbeat-absent #status-dot.no-heartbeat", material)
        self.assertIn("Annunciation rollup", contract)
        self.assertIn("Heartbeat source-bus node is the primary amber annunciation", contract)


if __name__ == "__main__":
    unittest.main()
