import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
DASHBOARD = ROOT / "dashboard"


class VisualContractTests(unittest.TestCase):
    def test_layer_load_order(self):
        html = (DASHBOARD / "index.html").read_text(encoding="utf-8")
        self.assertLess(html.index('href="style.css"'), html.index('href="spotlight.css"'))
        self.assertLess(html.index('href="spotlight.css"'), html.index('href="spotlight_sources.css"'))
        self.assertLess(html.index('src="instrument_state.js"'), html.index('src="app.js"'))
        self.assertLess(html.index('src="app.js"'), html.index('src="spotlight.js"'))

    def test_visual_layer_does_not_poll_backend(self):
        js = (DASHBOARD / "spotlight.js").read_text(encoding="utf-8")
        self.assertNotIn("fetch(", js)
        for source in ("host", "process", "heartbeat", "harness"):
            self.assertIn(f'sourceNode("{source}"', js)

    def test_source_state_vocabulary_is_pinned(self):
        css = (DASHBOARD / "spotlight.css").read_text(encoding="utf-8")
        source_css = (DASHBOARD / "spotlight_sources.css").read_text(encoding="utf-8")
        contract = (ROOT / "docs" / "VISUAL_CONTRACT.md").read_text(encoding="utf-8")
        combined_css = css + "\n" + source_css
        for state in ("never", "live", "dormant", "limit", "fault", "unsupported"):
            self.assertIn(f"state-{state}", combined_css)
        for state in ("NEVER_SAMPLED", "LIVE", "DORMANT", "AT_LIMIT", "FAULT"):
            self.assertIn(state, contract)
        self.assertIn("--sw-console-amber", css)
        self.assertIn("--sw-console-limit", css)
        self.assertIn("telemetry-stale", css)
        self.assertIn("telemetry-fault", css)

    def test_shared_instrument_state_machine_is_pinned(self):
        state_js = (DASHBOARD / "instrument_state.js").read_text(encoding="utf-8")
        spotlight = (DASHBOARD / "spotlight.js").read_text(encoding="utf-8")
        contract = (ROOT / "docs" / "VISUAL_CONTRACT.md").read_text(encoding="utf-8")
        for state in ("NEVER", "LIVE", "DORMANT", "LIMIT", "FAULT"):
            self.assertIn(f'{state}:', state_js)
        self.assertIn("lastKnown", state_js)
        self.assertIn("boundedState", state_js)
        self.assertIn("ScriptWatchInstrumentState", spotlight)
        self.assertIn("instrument_state.js", contract)
        self.assertIn("Dormant", contract)
        self.assertIn("last known", contract)

    def test_workbench_exists_and_is_backend_free(self):
        html = (DASHBOARD / "workbench.html").read_text(encoding="utf-8")
        for name in ("SegmentedDial", "FlowLane", "Counter", "Meter"):
            self.assertIn(name, html)
        for state in ("Never sampled", "Live", "Dormant", "At limit", "Fault"):
            self.assertIn(state, html)
        self.assertIn('src="instrument_state.js"', html)
        self.assertNotIn("fetch(", html)
        self.assertIn("Host → Process → Heartbeat → Harness", html)
        self.assertIn("transitionModel", html)
        self.assertIn("rigModels", html)

    def test_harness_state_is_explicit(self):
        js = (DASHBOARD / "spotlight.js").read_text(encoding="utf-8")
        contract = (ROOT / "docs" / "VISUAL_CONTRACT.md").read_text(encoding="utf-8")
        self.assertIn('id = "harness-indicator"', js)
        self.assertIn("HARNESS = OFF", js)
        self.assertIn("HARNESS = ON", js)
        self.assertIn("`HARNESS = ON · ${harnessVersion}`", js)
        self.assertIn("`HARNESS = ON`", contract)
        self.assertIn("`HARNESS = OFF`", contract)

    def test_counter_sources_are_partitioned(self):
        js = (DASHBOARD / "spotlight.js").read_text(encoding="utf-8")
        css = (DASHBOARD / "spotlight_sources.css").read_text(encoding="utf-8")
        contract = (ROOT / "docs" / "VISUAL_CONTRACT.md").read_text(encoding="utf-8")
        for source in ("host", "process"):
            self.assertIn(f'"{source}"', js)
            self.assertIn(f"source-{source}", css)
        self.assertIn("HARNESS COUNTERS", js)
        self.assertIn("harness-counter-bank", css)
        self.assertIn("Host counters", contract)
        self.assertIn("InDesign process counters", contract)
        self.assertIn("Harness counters", contract)

    def test_source_bays_are_spatially_separated(self):
        js = (DASHBOARD / "spotlight.js").read_text(encoding="utf-8")
        css = (DASHBOARD / "spotlight_sources.css").read_text(encoding="utf-8")
        contract = (ROOT / "docs" / "VISUAL_CONTRACT.md").read_text(encoding="utf-8")
        self.assertIn("process-counter-bay", js)
        self.assertIn("process-counter-mount", js)
        self.assertIn("source-column-runtime", js)
        self.assertIn("source-column-trends", js)
        self.assertIn("process-counter-bay", css)
        self.assertIn("Runtime Health", contract)
        self.assertIn("Trends & Alerts", contract)

    def test_harness_off_bay_remains_visible_as_capability_state(self):
        js = (DASHBOARD / "spotlight.js").read_text(encoding="utf-8")
        css = (DASHBOARD / "spotlight_sources.css").read_text(encoding="utf-8")
        contract = (ROOT / "docs" / "VISUAL_CONTRACT.md").read_text(encoding="utf-8")
        self.assertIn("harness-off-bay", js)
        self.assertIn("HARNESS DATA", js)
        self.assertIn("No Harness counters are published", js)
        self.assertIn("harness-off-bay", css)
        self.assertIn("A Harness data bay remains visible even when Harness is OFF", contract)

    def test_counter_marks_are_not_decorative(self):
        css = (DASHBOARD / "spotlight.css").read_text(encoding="utf-8")
        contract = (ROOT / "docs" / "VISUAL_CONTRACT.md").read_text(encoding="utf-8")
        self.assertIn("Decorative dots", contract)
        self.assertIn("per-counter lamp or dot must encode a real property", contract)
        self.assertIn(".counter-card::before { content:none", css)

    def test_reduced_motion_is_preserved(self):
        css = (DASHBOARD / "spotlight.css").read_text(encoding="utf-8")
        source_css = (DASHBOARD / "spotlight_sources.css").read_text(encoding="utf-8")
        workbench = (DASHBOARD / "workbench.html").read_text(encoding="utf-8")
        self.assertIn("prefers-reduced-motion", css)
        self.assertIn("prefers-reduced-motion", source_css)
        self.assertIn("prefers-reduced-motion", workbench)


if __name__ == "__main__":
    unittest.main()
