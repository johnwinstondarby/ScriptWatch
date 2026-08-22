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

    def test_harness_lane_requires_semantic_change(self):
        js = (DASHBOARD / "motion.js").read_text(encoding="utf-8")
        self.assertIn("pulseHarnessChangeCarrier", js)
        self.assertIn("harnessMetricSignature", js)
        self.assertIn('source-node[data-source="heartbeat"]', js)

    def test_individual_metric_motion_is_change_driven(self):
        js = (DASHBOARD / "motion.js").read_text(encoding="utf-8")
        css = (DASHBOARD / "refinement.css").read_text(encoding="utf-8")
        self.assertIn("markMetricChange", js)
        for value_id in ("progress-percent", "cpu-value", "ram-value", "commit-value"):
            self.assertIn(value_id, js)
        self.assertIn(".counter-card.sample-update.state-live::after", css)
        self.assertIn(".activity-ring.metric-change.state-live::after", css)
        self.assertIn(".capacity-meter.metric-change.state-live", css)
        self.assertIn(".counter-card.sample-pulse.state-live::after", css)
        self.assertIn("animation: none !important", css)

    def test_wall_mode_continuous_motion_is_source_only(self):
        css = (DASHBOARD / "refinement.css").read_text(encoding="utf-8")
        self.assertIn("wall-collector-fresh", css)
        self.assertIn("wall-heartbeat-fresh", css)
        self.assertIn('source-node[data-source="host"]', css)
        self.assertIn('source-node[data-source="process"]', css)
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
