/*
ScriptWatch sample-motion bridge v0.2.1

Presentation-only bridge between authoritative rendered sample markers and
visual liveness carriers. It does not poll the backend.

Desk view: one rendered sample produces one bounded motion impulse.
Wall view: motion remains continuous only while a freshness gate is open; the
gate closes automatically if another sample does not arrive in time.
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
      pulseHeartbeatSources(motionDuration(heartbeatCadenceMs));
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

  observeFreshSamples();
  observeHeartbeatMode();
})();
