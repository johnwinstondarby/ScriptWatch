/*
ScriptWatch authored-instrument diagnostics v0.3.0

Independent observation layer for compositor acceptance. It does not drive
telemetry, artwork state, or motion. It records what the rendered dashboard did
so value-change glints can be verified without relying on video timing.

v0.3 keeps the v0.2 timestamped event/lockstep diagnostics and aligns glint
eligibility with the production contract: the rendered string must change while
both the prior and current instrument states are active (LIVE or AT_LIMIT).
*/

(() => {
  "use strict";

  const METRICS = [
    { key: "cpu", gaugeId: "cpu-gauge", valueId: "cpu-value" },
    { key: "ram", gaugeId: "ram-gauge", valueId: "ram-value" }
  ];

  const stats = {
    startedAt: performance.now(),
    sampleEvents: 0,
    lastSampleMarker: "",
    metrics: {}
  };

  function elapsedMs() {
    return Math.round(performance.now() - stats.startedAt);
  }

  function displayValue(text) {
    const value = String(text || "").trim();
    return value && value !== "--" && value !== "—" ? value : null;
  }

  function stateOf(gauge) {
    if (!gauge) return "missing";
    for (const state of ["fault", "dormant", "limit", "live", "never", "unsupported"]) {
      if (gauge.classList.contains(`state-${state}`)) return state;
    }
    return "unknown";
  }

  function activeMetricState(state) {
    return state === "live" || state === "limit";
  }

  function visibleSegmentCount(gauge) {
    const face = gauge?.querySelector('[data-sw-role="face-lit"]');
    if (!face) return null;
    return Array.from(face.children).filter(node => node.getAttribute("visibility") !== "hidden").length;
  }

  function activityVisible(gauge) {
    const activity = gauge?.querySelector('[data-sw-role="activity"]');
    if (!activity) return null;
    return activity.getAttribute("visibility") !== "hidden";
  }

  function installSampleObserver() {
    const marker = document.getElementById("counter-bank-state");
    if (!marker) {
      window.setTimeout(installSampleObserver, 100);
      return;
    }
    stats.lastSampleMarker = String(marker.textContent || "");
    const observer = new MutationObserver(() => {
      const current = String(marker.textContent || "");
      if (!current || current === stats.lastSampleMarker || !current.startsWith("sample ")) return;
      stats.lastSampleMarker = current;
      stats.sampleEvents += 1;
    });
    observer.observe(marker, { childList: true, characterData: true, subtree: true });
  }

  function installMetricObserver(config) {
    const gauge = document.getElementById(config.gaugeId);
    const valueNode = document.getElementById(config.valueId);
    const glint = gauge?.querySelector('[data-sw-role="glint"]');
    if (!gauge || !valueNode || !glint) {
      window.setTimeout(() => installMetricObserver(config), 100);
      return;
    }
    if (stats.metrics[config.key]?.installed) return;

    const metric = {
      installed: true,
      valueChanges: 0,
      eligibleValueChanges: 0,
      glintStarts: 0,
      valueEvents: [],
      glintEvents: [],
      lastValue: displayValue(valueNode.textContent),
      lastState: stateOf(gauge),
      lastGlintOpacity: Number(glint.getAttribute("opacity") || 0) || 0
    };
    stats.metrics[config.key] = metric;

    const valueObserver = new MutationObserver(() => {
      const current = displayValue(valueNode.textContent);
      if (current === metric.lastValue) return;
      const previous = metric.lastValue;
      const previousState = metric.lastState;
      const currentState = stateOf(gauge);
      const hadPrior = previous !== null;
      metric.lastValue = current;
      metric.lastState = currentState;
      if (!hadPrior || current === null) return;

      metric.valueChanges += 1;
      const eligible = activeMetricState(previousState) && activeMetricState(currentState);
      if (eligible) metric.eligibleValueChanges += 1;
      metric.valueEvents.push({
        tMs: elapsedMs(),
        sampleEvent: stats.sampleEvents,
        previous,
        value: current,
        previousState,
        state: currentState,
        eligible
      });
    });
    valueObserver.observe(valueNode, { childList: true, characterData: true, subtree: true });

    // Keep state history current even when the displayed value is unchanged.
    // This makes wake/recovery exclusions observable rather than inferred.
    const stateObserver = new MutationObserver(() => {
      metric.lastState = stateOf(gauge);
    });
    stateObserver.observe(gauge, { attributes: true, attributeFilter: ["class"] });

    const glintObserver = new MutationObserver(() => {
      const opacity = Number(glint.getAttribute("opacity") || 0) || 0;
      if (metric.lastGlintOpacity <= 0.001 && opacity > 0.001) {
        metric.glintStarts += 1;
        metric.glintEvents.push({
          tMs: elapsedMs(),
          sampleEvent: stats.sampleEvents,
          value: displayValue(valueNode.textContent),
          state: stateOf(gauge)
        });
      }
      metric.lastGlintOpacity = opacity;
    });
    glintObserver.observe(glint, { attributes: true, attributeFilter: ["opacity"] });
  }

  function pairGlintEvents(left, right, toleranceMs) {
    const remaining = right.map((event, index) => ({ event, index }));
    const pairs = [];
    for (const event of left) {
      if (!remaining.length) break;
      let bestAt = -1;
      let bestDelta = Infinity;
      for (let index = 0; index < remaining.length; index += 1) {
        const delta = Math.abs(event.tMs - remaining[index].event.tMs);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestAt = index;
        }
      }
      if (bestAt >= 0 && bestDelta <= toleranceMs) {
        const match = remaining.splice(bestAt, 1)[0].event;
        pairs.push({
          leftMs: event.tMs,
          rightMs: match.tMs,
          deltaMs: bestDelta,
          leftSample: event.sampleEvent,
          rightSample: match.sampleEvent
        });
      }
    }
    return pairs;
  }

  function lockstep(toleranceMs = 25) {
    const left = stats.metrics.cpu?.glintEvents || [];
    const right = stats.metrics.ram?.glintEvents || [];
    const tolerance = Math.max(0, Number(toleranceMs) || 25);
    const pairs = pairGlintEvents(left, right, tolerance);
    const denominator = Math.min(left.length, right.length);
    const ratio = denominator ? pairs.length / denominator : 0;
    return {
      toleranceMs: tolerance,
      cpuGlints: left.length,
      ramGlints: right.length,
      pairedGlints: pairs.length,
      pairedRatio: Number(ratio.toFixed(3)),
      suspectedLockstep: denominator >= 2 && ratio >= 0.8,
      note: "Lockstep is a diagnostic trigger. After rendered-string binding, coincident glints are acceptable only when both displayed metrics genuinely changed.",
      pairs
    };
  }

  function eventTimeline() {
    const rows = [];
    for (const config of METRICS) {
      const metric = stats.metrics[config.key];
      if (!metric) continue;
      for (const event of metric.valueEvents || []) {
        rows.push({
          tMs: event.tMs,
          metric: config.key,
          event: "value-change",
          sampleEvent: event.sampleEvent,
          value: event.value,
          previous: event.previous,
          previousState: event.previousState,
          state: event.state,
          eligible: event.eligible
        });
      }
      for (const event of metric.glintEvents || []) {
        rows.push({
          tMs: event.tMs,
          metric: config.key,
          event: "glint-start",
          sampleEvent: event.sampleEvent,
          value: event.value,
          previous: "",
          previousState: "",
          state: event.state,
          eligible: ""
        });
      }
    }
    rows.sort((a, b) => a.tMs - b.tMs || a.metric.localeCompare(b.metric));
    return rows;
  }

  function snapshot() {
    const metrics = {};
    for (const config of METRICS) {
      const gauge = document.getElementById(config.gaugeId);
      const metric = stats.metrics[config.key] || {};
      const svg = gauge?.querySelector("svg[data-sw-instrument='segmented-dial']");
      const activity = activityVisible(gauge);
      metrics[config.key] = {
        mounted: Boolean(svg),
        namespace: svg?.dataset.swInstance || null,
        state: stateOf(gauge),
        value: displayValue(document.getElementById(config.valueId)?.textContent),
        litSegments: visibleSegmentCount(gauge),
        valueChanges: metric.valueChanges || 0,
        eligibleValueChanges: metric.eligibleValueChanges || 0,
        glintStarts: metric.glintStarts || 0,
        glintMatchesEligibleChanges: (metric.glintStarts || 0) === (metric.eligibleValueChanges || 0),
        activityVisible: activity,
        sharedSourceActivityCorrect: activity === false,
        valueChangeTimesMs: (metric.valueEvents || []).map(event => event.tMs),
        glintStartTimesMs: (metric.glintEvents || []).map(event => event.tMs)
      };
    }
    return {
      elapsedSeconds: Number(((performance.now() - stats.startedAt) / 1000).toFixed(1)),
      sampleEvents: stats.sampleEvents,
      metrics,
      lockstep: lockstep()
    };
  }

  function print() {
    const snap = snapshot();
    console.log("ScriptWatch instrument diagnostics", {
      elapsedSeconds: snap.elapsedSeconds,
      sampleEvents: snap.sampleEvents
    });
    console.table(snap.metrics);
    const timeline = eventTimeline();
    if (timeline.length) console.table(timeline);
    console.log("Glint lockstep diagnostic", snap.lockstep);
    return snap;
  }

  function reset() {
    stats.startedAt = performance.now();
    stats.sampleEvents = 0;
    const marker = document.getElementById("counter-bank-state");
    stats.lastSampleMarker = String(marker?.textContent || "");
    for (const config of METRICS) {
      const metric = stats.metrics[config.key];
      if (!metric) continue;
      metric.valueChanges = 0;
      metric.eligibleValueChanges = 0;
      metric.glintStarts = 0;
      metric.valueEvents = [];
      metric.glintEvents = [];
      metric.lastValue = displayValue(document.getElementById(config.valueId)?.textContent);
      metric.lastState = stateOf(document.getElementById(config.gaugeId));
      const glint = document.getElementById(config.gaugeId)?.querySelector('[data-sw-role="glint"]');
      metric.lastGlintOpacity = Number(glint?.getAttribute("opacity") || 0) || 0;
    }
    return snapshot();
  }

  function frameProbe(seconds = 30) {
    const durationMs = Math.max(1000, Number(seconds) * 1000 || 30000);
    return new Promise(resolve => {
      const gaps = [];
      const start = performance.now();
      let previous = start;
      function frame(now) {
        gaps.push(now - previous);
        previous = now;
        if (now - start < durationMs) {
          requestAnimationFrame(frame);
          return;
        }
        const sorted = gaps.slice().sort((a, b) => a - b);
        const percentile = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 0;
        resolve({
          durationSeconds: Number(((now - start) / 1000).toFixed(1)),
          frames: gaps.length,
          averageFrameMs: Number((gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length)).toFixed(2)),
          p95FrameMs: Number(percentile(0.95).toFixed(2)),
          maxFrameMs: Number(Math.max(...gaps).toFixed(2)),
          over33ms: gaps.filter(v => v > 33).length,
          over50ms: gaps.filter(v => v > 50).length,
          note: "Responsiveness probe only; use browser Performance tools for paint/composite cost."
        });
      }
      requestAnimationFrame(frame);
    });
  }

  window.ScriptWatchInstrumentDiagnostics = {
    snapshot,
    print,
    reset,
    events: eventTimeline,
    lockstep,
    frameProbe
  };
  installSampleObserver();
  METRICS.forEach(installMetricObserver);
})();