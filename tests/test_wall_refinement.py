import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
DASHBOARD = ROOT / "dashboard"


class WallRefinementTests(unittest.TestCase):
    def test_refinement_layer_is_loaded_by_motion_bridge(self):
        motion = (DASHBOARD / "motion.js").read_text(encoding="utf-8")
        self.assertIn('link.href = "refinement.css"', motion)
        self.assertIn('data-scriptwatch-refinement', motion)

    def test_wall_mode_is_freshness_gated(self):
        motion = (DASHBOARD / "motion.js").read_text(encoding="utf-8")
        css = (DASHBOARD / "refinement.css").read_text(encoding="utf-8")
        self.assertIn('params.get("view")', motion)
        self.assertIn('"wall-collector-fresh"', motion)
        self.assertIn('"wall-heartbeat-fresh"', motion)
        self.assertIn("freshnessWindow", motion)
        self.assertIn("wallCycle", motion)
        self.assertIn("body.view-wall.wall-collector-fresh", css)
        self.assertIn("body.view-wall.wall-heartbeat-fresh", css)

    def test_wall_motion_speed_derives_from_observed_cadence(self):
        motion = (DASHBOARD / "motion.js").read_text(encoding="utf-8")
        self.assertIn("now - lastSampleAt", motion)
        self.assertIn("now - lastHeartbeatWriteAt", motion)
        self.assertIn("cadence * 1.08", motion)
        self.assertIn("cadence * 2.6", motion)

    def test_zero_value_dials_have_independent_liveness_carrier(self):
        css = (DASHBOARD / "refinement.css").read_text(encoding="utf-8")
        self.assertIn("#cpu-gauge.state-live::after", css)
        self.assertIn("#ram-gauge.state-live::after", css)
        self.assertIn("#commit-gauge.state-live::after", css)
        self.assertIn("swDialSampleAck", css)
        self.assertNotIn("#progress-gauge.state-live::after", css)

    def test_source_packet_requires_live_destination(self):
        css = (DASHBOARD / "refinement.css").read_text(encoding="utf-8")
        self.assertIn(":has(+ .source-node.state-live)", css)
        self.assertIn(":has(+ .source-node.state-dormant)", css)
        self.assertIn("sample-pulse:not(:has(+ .source-node.state-live))", css)

    def test_empty_column_chassis_does_not_stretch(self):
        css = (DASHBOARD / "refinement.css").read_text(encoding="utf-8")
        self.assertIn("align-items: start", css)
        self.assertIn("align-self: start", css)
        self.assertIn("grid-template-columns: .88fr 1.06fr 1.06fr", css)


if __name__ == "__main__":
    unittest.main()
