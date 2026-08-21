import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
DASHBOARD = ROOT / "dashboard"


class VisualContractTests(unittest.TestCase):
    def test_layer_load_order(self):
        html = (DASHBOARD / "index.html").read_text(encoding="utf-8")
        self.assertLess(html.index('href="style.css"'), html.index('href="spotlight.css"'))
        self.assertLess(html.index('src="app.js"'), html.index('src="spotlight.js"'))

    def test_visual_layer_does_not_poll_backend(self):
        js = (DASHBOARD / "spotlight.js").read_text(encoding="utf-8")
        self.assertNotIn("fetch(", js)
        for source in ("host", "process", "heartbeat", "harness"):
            self.assertIn(f'sourceNode("{source}"', js)

    def test_source_state_vocabulary_is_pinned(self):
        css = (DASHBOARD / "spotlight.css").read_text(encoding="utf-8")
        contract = (ROOT / "docs" / "VISUAL_CONTRACT.md").read_text(encoding="utf-8")
        for state in ("live", "dormant", "fault", "unsupported"):
            self.assertIn(f"state-{state}", css)
            self.assertIn(state.upper(), contract)
        self.assertIn("--sw-console-amber", css)
        self.assertIn("telemetry-stale", css)
        self.assertIn("telemetry-fault", css)

    def test_reduced_motion_is_preserved(self):
        css = (DASHBOARD / "spotlight.css").read_text(encoding="utf-8")
        self.assertIn("prefers-reduced-motion", css)


if __name__ == "__main__":
    unittest.main()
