import pathlib
import unittest
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[1]
DASHBOARD = ROOT / "dashboard"
ASSET = DASHBOARD / "instruments" / "segmented-dial.svg"


class InstrumentCompositorTests(unittest.TestCase):
    def test_index_loads_compositor_after_runtime_layers(self):
        html = (DASHBOARD / "index.html").read_text(encoding="utf-8")
        self.assertIn('href="instrument_compositor.css"', html)
        self.assertIn('src="instrument_compositor.js"', html)
        self.assertLess(html.index('src="motion.js"'), html.index('src="instrument_compositor.js"'))

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

    def test_compositor_namespaces_internal_svg_ids(self):
        js = (DASHBOARD / "instrument_compositor.js").read_text(encoding="utf-8")
        self.assertIn("function namespaceSvg", js)
        self.assertIn("const idMap = new Map()", js)
        self.assertIn('`${prefix}__${original}`', js)
        self.assertIn("url\\(#([^)]+)\\)", js)
        self.assertIn('next.startsWith("#")', js)
        self.assertIn("node.setAttribute(attrName, after)", js)

    def test_v02_mounts_cpu_and_ram_only_and_does_not_duplicate_source_liveness(self):
        js = (DASHBOARD / "instrument_compositor.js").read_text(encoding="utf-8")
        self.assertIn('gaugeId: "cpu-gauge"', js)
        self.assertIn('gaugeId: "ram-gauge"', js)
        self.assertNotIn('gaugeId: "commit-gauge"', js)
        self.assertGreaterEqual(js.count("allowActivity: false"), 2)
        self.assertIn("CPU, RAM, and Commit share one collector acquisition event", js)
        self.assertIn('gauge.classList.remove("activity-ring")', js)
        self.assertIn('prefix: "cpu"', js)
        self.assertIn('prefix: "ram"', js)

    def test_value_change_glint_is_local_and_initialization_is_explicit(self):
        js = (DASHBOARD / "instrument_compositor.js").read_text(encoding="utf-8")
        self.assertIn("syncInstance(instance, true)", js)
        self.assertIn("const changed = !initializing", js)
        self.assertIn("fireGlint(instance)", js)
        self.assertIn("setSegments(instance, count)", js)

    def test_failure_preserves_legacy_dial(self):
        js = (DASHBOARD / "instrument_compositor.js").read_text(encoding="utf-8")
        self.assertIn("failToLegacy", js)
        self.assertIn('instance.gauge.classList.remove("svg-instrument-mounted")', js)
        self.assertIn('instance.gauge.classList.add("activity-ring")', js)
        self.assertIn("The authored SVG is inserted only after its contract validates", js)


if __name__ == "__main__":
    unittest.main()
