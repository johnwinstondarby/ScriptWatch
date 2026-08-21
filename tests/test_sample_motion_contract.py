import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
DASHBOARD = ROOT / "dashboard"


class SampleMotionContractTests(unittest.TestCase):
    def test_motion_bridge_is_loaded_after_visual_layers(self):
        html = (DASHBOARD / "index.html").read_text(encoding="utf-8")
        self.assertIn('src="motion.js"', html)
        self.assertLess(html.index('src="spotlight.js"'), html.index('src="motion.js"'))

    def test_motion_bridge_uses_rendered_sample_marker_without_backend_polling(self):
        js = (DASHBOARD / "motion.js").read_text(encoding="utf-8")
        self.assertIn('SAMPLE_MARKER_ID = "counter-bank-state"', js)
        self.assertIn('HEARTBEAT_WRITES_ID = "heartbeat-writes"', js)
        self.assertIn("MutationObserver", js)
        self.assertIn("onFreshRenderedSample", js)
        self.assertNotIn("fetch(", js)

    def test_liveness_carriers_require_sample_pulse(self):
        css = (DASHBOARD / "material.css").read_text(encoding="utf-8")
        self.assertIn(".source-node.sample-pulse.state-live", css)
        self.assertIn(".counter-card.sample-pulse.state-live::after", css)
        self.assertIn(".capacity-meter.sample-pulse.state-live", css)
        self.assertIn("swCounterRunner var(--sw-sample-duration) linear 1", css)
        self.assertIn("swMaterialPacket var(--sw-sample-duration) linear 1", css)
        self.assertNotIn("swCounterRunner 2.6s ease-in-out infinite", css)
        self.assertNotIn("swMaterialPacket 2.2s linear infinite", css)
        self.assertNotIn("swMeterGlint 2.1s linear infinite", css)

    def test_heartbeat_absence_has_one_primary_annunciation(self):
        motion = (DASHBOARD / "motion.js").read_text(encoding="utf-8")
        css = (DASHBOARD / "material.css").read_text(encoding="utf-8")
        contract = (ROOT / "docs" / "VISUAL_CONTRACT.md").read_text(encoding="utf-8")
        self.assertIn("heartbeat-absent", motion)
        self.assertIn(".heartbeat-absent #status-dot.no-heartbeat", css)
        self.assertIn("Annunciation rollup", contract)
        self.assertIn("Heartbeat source-bus node is the primary amber annunciation", contract)

    def test_history_lines_do_not_consume_alarm_colors(self):
        css = (DASHBOARD / "material.css").read_text(encoding="utf-8")
        contract = (ROOT / "docs" / "VISUAL_CONTRACT.md").read_text(encoding="utf-8")
        self.assertIn(".sparkline.amber polyline", css)
        self.assertIn("#78a894", css)
        self.assertIn("Historical traces are contextual rather than annunciators", contract)

    def test_contract_pins_sample_arrival_semantics(self):
        contract = (ROOT / "docs" / "VISUAL_CONTRACT.md").read_text(encoding="utf-8")
        self.assertIn("Sample-arrival motion", contract)
        self.assertIn("One rendered sample produces one motion impulse or one bounded traverse", contract)
        self.assertIn("must not free-run", contract)


if __name__ == "__main__":
    unittest.main()
