/*
 * ScriptWatch - runtime observer console for long-running InDesign ExtendScript jobs
 * Copyright (C) 2026 John Darby
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
// SPDX-License-Identifier: GPL-3.0-or-later

/*
ScriptWatch sample-motion bridge v0.3.0

Presentation-only bridge between authoritative rendered events and visual
motion. It does not poll the backend and it does not synthesize phase offsets.

Source motion = acquisition liveness.
Metric motion = value change.
Color = condition.

The current dashboard exposes one collector sample containing both host and
InDesign process telemetry, plus an independently observable heartbeat write
count. Therefore host/process share one collector liveness carrier. Heartbeat
gets its own carrier. Harness lane motion is reserved for semantic metric
change rather than mirroring the heartbeat event.
*/

(() => {
  "use strict";

  function ensureRefinementLayer() {
    if (document.querySelector('link[data-scriptwatch-refinement="1"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "refinement.css";
    link.dataset.scriptwatchRefinement = "1";
    document.head.appendChild(link);
  }

  ensureRefinementLayer();

  const byId = id => document.getElementById(id);
  const SAMPLE_MARKER_ID = "counter-bank-state";
  const HEARTBEAT_WRITES_ID = "heartbeat-writes";
  const DEFAULT_CADENCE_MS = 1800;
  const MIN_MOTION_MS = 420;
  const MAX_MOTION_MS = 3200;
  const MIN_WALL_CYCLE_MS = 1800;
  const MAX_WALL_CYCLE_MS = 12000;
  const MIN_FRESH_MS = 1500;
  const MAX_FRESH_MS = 30000;

  const params = new URLSearchParams(window.location.search);
  const wallMode = ["wall", "noc"].includes(String(params.get("view") || "").toLowerCase());
  document.body.classList.toggle("view-wall", wallMode);

  let lastSampleMarker = "";
  let lastSampleAt = null;
  let lastHeartbeatWrites = null;
  let lastHeartbeatWriteAt = null;
  let lastHarnessMetricSignature = null;
  let collectorFreshTimer = null;
  let heartbeatFreshTimer = null;

  function finiteNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function motionDuration(cadenceMs) {
    const cadence = finiteNumber(cadenceMs) || DEFAULT_CADENCE_MS;
    return Math.max(MIN_MOTION_MS, Math.min(MAX_MOTION_MS, cadence * 0.74));
  }

  function wallCycle(cadenceMs) {
    const cadence = finiteNumber(cadenceMs) || DEFAULT_CADENCE_MS;
    return Math.max(MIN_WALL_CYCLE_MS, Math.min(MAX_WALL_CYCLE_MS, cadence * 1.08));
  }

  function freshnessWindow(cadenceMs) {
    const cadence = finiteNumber(cadenceMs) || DEFAULT_CADENCE_MS;
    return Math.max(MIN_FRESH_MS, Math.min(MAX_FRESH_MS, cadence * 2.6));
  }

  function eligible(node) {
    return Boolean(node && (
      node.classList.contains("state-live") ||
      node.classList.contains("state-limit")
    ));
  }

  function pulse(node, durationMs) {
    if (!eligible(node)) return;
    node.style.setProperty("--sw-sample-duration", `${Math.round(durationMs)}ms`);
    node.classList.remove("sample-pulse");
    void node.offsetWidth;
    node.classList.add("sample-pulse");
  }

  function markMetricChange(node) {
    if (!node || !eligible(node)) return;
    node.classList.remove("metric-change");
    void node.offsetWidth;
    node.classList.add("metric-change");
    window.setTimeout(() => node.classList.remove("metric-change"), 720);
  }

  function heartbeatWriteValue() {
    const raw = String(byId(HEARTBEAT_WRITES_ID)?.textContent || "").replace(/[^0-9.-]/g, "");
    return raw === "" ? null : finiteNumber(raw);
  }

  function openFreshnessGate(kind, cadenceMs) {
    const className = kind === "heartbeat" ? "wall-heartbeat-fresh" : "wall-collector-fresh";
    const cycleName = kind === "heartbeat" ? "--sw-wall-heartbeat-cycle" : "--sw-wall-cycle";
    const cycleMs = wallCycle(cadenceMs);
    const ttlMs = freshnessWindow(cadenceMs);

    document.body.style.setProperty(cycleName, `${Math.round(cycleMs)}ms`);
    document.body.classList.add(className);

    if (kind === "heartbeat") {
      if (heartbeatFreshTimer) window.clearTimeout(heartbeatFreshTimer);
      heartbeatFreshTimer = window.setTimeout(() => {
        document.body.classList.remove(className);
        heartbeatFreshTimer = null;
      }, ttlMs);
    } else {
      if (collectorFreshTimer) window.clearTimeout(collectorFreshTimer);
      collectorFreshTimer = window.setTimeout(() => {
        document.body.classList.remove(className);
        collectorFreshTimer = null;
      }, ttlMs);
    }
  }

  function syncHeartbeatAnnunciation() {
    const absent = Boolean(byId("job-panel")?.classList.contains("process-only"));
    document.body.classList.toggle("heartbeat-absent", absent);
    if (absent) {
      document.body.classList.remove("wall-heartbeat-fresh");
      if (heartbeatFreshTimer) {
        window.clearTimeout(heartbeatFreshTimer);
        heartbeatFreshTimer = null;
      }
    }
  }

  /* One collector sample carries both host and process data in the current web
     contract. The Host -> Process lane is therefore the single collector
     liveness carrier. Do not pulse every counter or both source nodes. */
  function pulseCollectorCarrier(durationMs) {
    pulse(document.querySelector('.source-node[data-source="host"]'), durationMs);
  }

  /* Heartbeat writes are independently observable from collector sampling.
     The Process -> Heartbeat lane owns heartbeat liveness. */
  function pulseHeartbeatCarrier(durationMs) {
    pulse(document.querySelector('.source-node[data-source="process"]'), durationMs);
  }

  /* Harness transport currently rides the heartbeat. The Heartbeat -> Harness
     lane therefore moves only when Harness semantic metric values change, not
     on every heartbeat write. */
  function pulseHarnessChangeCarrier(durationMs = 620) {
    pulse(document.querySelector('.source-node[data-source="heartbeat"]'), durationMs);
  }

  function onFreshRenderedSample() {
    const now = performance.now();
    const cadenceMs = lastSampleAt === null ? DEFAULT_CADENCE_MS : Math.max(1, now - lastSampleAt);
    lastSampleAt = now;
    const durationMs = motionDuration(cadenceMs);

    syncHeartbeatAnnunciation();
    pulseCollectorCarrier(durationMs);
    openFreshnessGate("collector", cadenceMs);

    const heartbeatWrites = heartbeatWriteValue();
    const heartbeatChanged = heartbeatWrites !== null && (
      lastHeartbeatWrites === null ? heartbeatWrites > 0 : heartbeatWrites !== lastHeartbeatWrites
    );

    if (heartbeatChanged) {
      const heartbeatCadenceMs = lastHeartbeatWriteAt === null
        ? cadenceMs
        : Math.max(1, now - lastHeartbeatWriteAt);
      lastHeartbeatWriteAt = now;
      pulseHeartbeatCarrier(motionDuration(heartbeatCadenceMs));
      openFreshnessGate("heartbeat", heartbeatCadenceMs);
    }

    if (heartbeatWrites !== null) lastHeartbeatWrites = heartbeatWrites;
  }

  function observeFreshSamples() {
    const marker = byId(SAMPLE_MARKER_ID);
    if (!marker) {
      window.setTimeout(observeFreshSamples, 100);
      return;
    }

    lastSampleMarker = marker.textContent || "";
    const observer = new MutationObserver(() => {
      const current = marker.textContent || "";
      if (!current || current === lastSampleMarker || !current.startsWith("sample ")) return;
      lastSampleMarker = current;
      onFreshRenderedSample();
    });
    observer.observe(marker, { childList: true, characterData: true, subtree: true });
  }

  function observeHeartbeatMode() {
    const panel = byId("job-panel");
    if (!panel) return;
    syncHeartbeatAnnunciation();
    const observer = new MutationObserver(syncHeartbeatAnnunciation);
    observer.observe(panel, { attributes: true, attributeFilter: ["class"] });
  }

  function watchTextChange(valueNode, instrumentNode) {
    if (!valueNode || !instrumentNode) return;
    let previous = String(valueNode.textContent || "");
    const observer = new MutationObserver(() => {
      const current = String(valueNode.textContent || "");
      if (current === previous) return;
      const hadPriorValue = previous !== "" && previous !== "--" && previous !== "—";
      previous = current;
      if (hadPriorValue) markMetricChange(instrumentNode);
    });
    observer.observe(valueNode, { childList: true, characterData: true, subtree: true });
  }

  function observeMetricChanges() {
    [
      ["progress-percent", "progress-gauge"],
      ["cpu-value", "cpu-gauge"],
      ["ram-value", "ram-gauge"],
      ["commit-value", "commit-gauge"],
    ].forEach(([valueId, instrumentId]) => watchTextChange(byId(valueId), byId(instrumentId)));

    document.querySelectorAll(".capacity-meter").forEach(meter => {
      watchTextChange(meter.querySelector("strong"), meter);
    });
  }

  function harnessMetricSignature() {
    const bank = byId("job-metric-bank");
    if (!bank) return "";
    return Array.from(bank.querySelectorAll(".counter-card strong"))
      .map(node => String(node.textContent || ""))
      .join("\u241f");
  }

  function observeHarnessMetricChanges() {
    const bank = byId("job-metric-bank");
    if (!bank) {
      window.setTimeout(observeHarnessMetricChanges, 100);
      return;
    }

    lastHarnessMetricSignature = harnessMetricSignature();
    const observer = new MutationObserver(() => {
      const current = harnessMetricSignature();
      if (current === lastHarnessMetricSignature) return;
      const hadPrior = lastHarnessMetricSignature !== null && lastHarnessMetricSignature !== "";
      lastHarnessMetricSignature = current;
      if (hadPrior) pulseHarnessChangeCarrier();
    });
    observer.observe(bank, { childList: true, characterData: true, subtree: true });
  }

  observeFreshSamples();
  observeHeartbeatMode();
  observeMetricChanges();
  observeHarnessMetricChanges();
})();
