import pathlib
import unittest
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[1]
DASHBOARD = ROOT / "dashboard"
ASSET = DASHBOARD / "instruments" / "segmented-dial.svg"


class InstrumentCompositorTests(unittest.TestCase):
    def test_index_loads_compositor_and_diagnostics_after_runtime_layers(self):
        html = (DASHBOARD / "index.html").read_text(encoding="utf-8")
        self.assertIn('href="instrument_compositor.css"', html)
        self.assertIn('src="instrument_compositor.js"', html)
        self.assertIn('src="instrument_diagnostics.js"', html)
        self.assertLess(html.index('src="motion.js"'), html.index('src="instrument_compositor.js"'))
        self.assertLess(html.index('src="instrument_compositor.js"'), html.index('src="instrument_diagnostics.js"'))

    def test_svg_contract_is_present(self):
        root = ET.parse(ASSET).getroot()
        ns = {"svg": "http://www.w3.org/2000/svg"}
        by_id = {node.attrib.get("id"): node for node in root.iter() if node.attrib.get("id")}
        for public_id in ("housing", "well", "face-off", "bloom", "face-lit", "activity", "glint"):
            self.assertIn(public_id, by_id)
        self.assertEqual(root.attrib.get("viewBox"), "0 0 200 200")
        self.assertEqual(len(list(by_id["face-lit"])), 36)
        self.assertEqual(len(list(by_id["bloom"])), 36)
        self.assertEqual(len(list(by_id["face-off"])), 36)
        self.assertFalse(root.findall(".//svg:script", ns))
        self.assertFalse(root.findall(".//svg:text", ns))
        self.assertFalse(root.findall(".//svg:image", ns))

    def test_lit_geometry_defaults_hidden(self):
        root = ET.parse(ASSET).getroot()
        by_id = {node.attrib.get("id"): node for node in root.iter() if node.attrib.get("id")}
        self.assertTrue(all(child.attrib.get("visibility") == "hidden" for child in by_id["face-lit"]))
        self.assertTrue(all(child.attrib.get("visibility") == "hidden" for child in by_id["bloom"]))

    def test_artwork_rev021_resting_ring_is_tuned(self):
        root = ET.parse(ASSET).getroot()
        by_id = {node.attrib.get("id"): node for node in root.iter() if node.attrib.get("id")}
        stops = [stop.attrib.get("stop-color") for stop in list(by_id["grad-off"])]
        self.assertEqual(stops, ["#17252E", "#21343F", "#2C4653"])
        contract = (ROOT / "docs" / "SEGMENTED_DIAL_SVG_CONTRACT_v0_1.md").read_text(encoding="utf-8")
        self.assertIn("artwork rev 0.2.1", contract)
        self.assertIn("resting texture", contract)

    def test_compositor_namespaces_internal_svg_ids(self):
        js = (DASHBOARD / "instrument_compositor.js").read_text(encoding="utf-8")
        self.assertIn("function namespaceSvg", js)
        self.assertIn("const idMap = new Map()", js)
        self.assertIn('`${prefix}__${original}`', js)
        self.assertIn("url\\(#([^)]+)\\)", js)
        self.assertIn('next.startsWith("#")', js)
        self.assertIn("node.setAttribute(attrName, after)", js)

    def test_v04_mounts_cpu_and_ram_only_and_does_not_duplicate_source_liveness(self):
        js = (DASHBOARD / "instrument_compositor.js").read_text(encoding="utf-8")
        self.assertIn('gaugeId: "cpu-gauge"', js)
        self.assertIn('gaugeId: "ram-gauge"', js)
        self.assertNotIn('gaugeId: "commit-gauge"', js)
        self.assertGreaterEqual(js.count("allowActivity: false"), 2)
        self.assertIn("CPU, RAM, and Commit share one collector acquisition event", js)
        self.assertIn('gauge.classList.remove("activity-ring")', js)
        self.assertIn('prefix: "cpu"', js)
        self.assertIn('prefix: "ram"', js)

    def test_authored_dial_palette_tracks_instrument_state(self):
        css = (DASHBOARD / "instrument_compositor.css").read_text(encoding="utf-8")
        for state in ("live", "dormant", "limit", "fault", "never", "unsupported"):
            self.assertIn(f"state-{state}", css)
        self.assertIn('[id$="__grad-off"] stop:nth-child(1)', css)
        self.assertIn('[id$="__grad-lit"] stop:nth-child(5)', css)
        self.assertIn('--sw-dial-bloom', css)
        self.assertIn('[data-sw-role="bloom"]', css)
        self.assertIn("The off ring follows state too", css)

    def test_glint_uses_rendered_string_while_raw_value_drives_magnitude(self):
        js = (DASHBOARD / "instrument_compositor.js").read_text(encoding="utf-8")
        self.assertIn("syncInstance(instance, true)", js)
        self.assertIn("function readDisplayedValue", js)
        self.assertIn("const rawValue = readPercent(instance.gauge)", js)
        self.assertIn("const displayedValue = readDisplayedValue(instance.valueEl)", js)
        self.assertIn("const count = litCountFor(rawValue, state)", js)
        self.assertIn("const displayChanged = !initializing", js)
        self.assertIn("displayedValue !== instance.lastDisplayedValue", js)
        self.assertIn("const stableActiveState = activeMetricState(state) && activeMetricState(previousState)", js)
        self.assertIn("if (displayChanged && stableActiveState)", js)
        self.assertIn("issueGlint(instance, displayedValue, state)", js)
        self.assertIn("instance.lastDisplayedValue = displayedValue", js)
        self.assertIn("instance.lastRawValue = rawValue", js)
        self.assertIn("setSegments(instance, count)", js)
        self.assertNotIn("value !== instance.lastValue", js)

    def test_glint_semantic_event_is_issued_before_render_scheduling(self):
        js = (DASHBOARD / "instrument_compositor.js").read_text(encoding="utf-8")
        self.assertIn("function issueGlint", js)
        self.assertIn("instance.glintSeq += 1", js)
        self.assertIn("glint.dataset.swGlintSeq = String(instance.glintSeq)", js)
        self.assertIn("glint.dataset.swGlintValue = displayedValue", js)
        self.assertIn("glint.dataset.swGlintState = state", js)
        issue_body = js[js.index("function issueGlint"):js.index("function fireGlint")]
        self.assertLess(issue_body.index("swGlintSeq"), issue_body.index("fireGlint(instance)"))
        self.assertIn('instance.handles.glint.dataset.swGlintSeq = "0"', js)

    def test_diagnostics_compare_issued_glints_to_independent_value_eligibility(self):
        js = (DASHBOARD / "instrument_diagnostics.js").read_text(encoding="utf-8")
        self.assertNotIn("fetch(", js)
        self.assertIn("eligibleValueChanges", js)
        self.assertIn("glintEventsIssued", js)
        self.assertIn("renderedGlintStarts", js)
        self.assertIn("glintMatchesEligibleChanges", js)
        self.assertIn("sharedSourceActivityCorrect", js)
        self.assertIn("previousState", js)
        self.assertIn("activeMetricState(previousState) && activeMetricState(currentState)", js)
        self.assertIn('attributeFilter: ["data-sw-glint-seq"]', js)
        self.assertIn("glintSequence(glint)", js)
        self.assertIn("browser frame scheduling cannot erase an issued event", js)
        self.assertIn("window.ScriptWatchInstrumentDiagnostics", js)
        self.assertIn("frameProbe", js)
        self.assertIn("use browser Performance tools for paint/composite cost", js)

    def test_diagnostics_timestamp_issued_glints_and_flag_lockstep_without_claiming_causality(self):
        js = (DASHBOARD / "instrument_diagnostics.js").read_text(encoding="utf-8")
        self.assertIn("glintIssueEvents", js)
        self.assertIn("renderedGlintEvents", js)
        self.assertIn("valueEvents", js)
        self.assertIn("glintIssueTimesMs", js)
        self.assertIn("renderedGlintStartTimesMs", js)
        self.assertIn("valueChangeTimesMs", js)
        self.assertIn("function lockstep", js)
        self.assertIn('channel: "semantic-glint-issued"', js)
        self.assertIn("suspectedLockstep", js)
        self.assertIn("Lockstep is a diagnostic trigger", js)
        self.assertIn("Coincident issued glints are acceptable only when both displayed metrics genuinely changed", js)
        self.assertIn('event: "glint-issued"', js)
        self.assertIn('event: "glint-rendered"', js)
        self.assertIn("events: eventTimeline", js)
        self.assertIn("lockstep,", js)

    def test_failure_preserves_legacy_dial(self):
        js = (DASHBOARD / "instrument_compositor.js").read_text(encoding="utf-8")
        self.assertIn("failToLegacy", js)
        self.assertIn('instance.gauge.classList.remove("svg-instrument-mounted")', js)
        self.assertIn('instance.gauge.classList.add("activity-ring")', js)
        self.assertIn("The authored SVG is inserted only after its contract validates", js)


if __name__ == "__main__":
    unittest.main()
