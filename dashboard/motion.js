/*
ScriptWatch sample-motion bridge v0.1.0

Presentation-only bridge between the authoritative dashboard sample marker and
visual liveness carriers. It does not poll the backend. Motion is triggered by
fresh rendered samples, not by a free-running animation clock.
*/

(() => {
  "use strict";

  const byId = id => document.getElementById(id);
  const SAMPLE_MARKER_ID = "counter-bank-state";
  const HEARTBEAT_WRITES_ID = "heartbeat-writes";
  const DEFAULT_CADENCE_MS = 1800;
  const MIN_MOTION_MS = 420;
  const MAX_MOTION_MS = 3200;

  let lastSampleMarker = "";
  let lastSampleAt = null;
  let lastHeartbeatWrites = null;

  function finiteNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function motionDuration(cadenceMs) {
    const cadence = finiteNumber(cadenceMs) || DEFAULT_CADENCE_MS;
    return Math.max(MIN_MOTION_MS, Math.min(MAX_MOTION_MS, cadence * 0.74));
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

  function heartbeatWriteValue() {
    const raw = String(byId(HEARTBEAT_WRITES_ID)?.textContent || "").replace(/[^0-9.-]/g, "");
    return raw === "" ? null : finiteNumber(raw);
  }

  function syncHeartbeatAnnunciation() {
    const absent = Boolean(byId("job-panel")?.classList.contains("process-only"));
    document.body.classList.toggle("heartbeat-absent", absent);
  }

  function pulseCollectorSources(durationMs) {
    ["host", "process"].forEach(source => {
      pulse(document.querySelector(`.source-node[data-source="${source}"]`), durationMs);
    });

    document.querySelectorAll('.counter-card[data-source="host"], .counter-card[data-source="process"], .counter-card:not([data-source])')
      .forEach(node => {
        if (node.closest("#job-metric-bank")) return;
        pulse(node, durationMs);
      });

    document.querySelectorAll(".capacity-meter").forEach(node => pulse(node, durationMs));
  }

  function pulseHeartbeatSources(durationMs) {
    pulse(document.querySelector('.source-node[data-source="heartbeat"]'), durationMs);
    pulse(document.querySelector('.source-node[data-source="harness"]'), durationMs);
    document.querySelectorAll("#job-metric-bank .counter-card").forEach(node => pulse(node, durationMs));
  }

  function onFreshRenderedSample() {
    const now = performance.now();
    const cadenceMs = lastSampleAt === null ? DEFAULT_CADENCE_MS : Math.max(1, now - lastSampleAt);
    lastSampleAt = now;
    const durationMs = motionDuration(cadenceMs);

    syncHeartbeatAnnunciation();
    pulseCollectorSources(durationMs);

    const heartbeatWrites = heartbeatWriteValue();
    const heartbeatChanged = heartbeatWrites !== null && (
      lastHeartbeatWrites === null ? heartbeatWrites > 0 : heartbeatWrites !== lastHeartbeatWrites
    );
    if (heartbeatChanged) pulseHeartbeatSources(durationMs);
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

  observeFreshSamples();
  observeHeartbeatMode();
})();
