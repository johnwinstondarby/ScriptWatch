/*
ScriptWatch authored-instrument diagnostics v0.4.0

Independent observation layer for compositor acceptance. It does not drive
telemetry, artwork state, or motion. It records what the rendered dashboard did
so value-change glints can be verified without relying on video timing.

v0.4 separates semantic glint issuance from browser rendering. The compositor
increments data-sw-glint-seq synchronously when it decides a metric-change glint
has been earned. Diagnostics compare that issued-event sequence against
independently observed rendered-value changes. Opacity/rAF starts remain a
secondary rendering observation and are not the semantic acceptance gate.
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

  function glintSequence(glint) {
    const value = Number(glint?.dataset?.swGlintSeq || 0);
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
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
      glintEventsIssued: 0,
      renderedGlintStarts: 0,
      valueEvents: [],
      glintIssueEvents: [],
      renderedGlintEvents: [],
      lastValue: displayValue(valueNode.textContent),
      lastState: stateOf(gauge),
      lastGlintSeq: glintSequence(glint),
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

    const issueObserver = new MutationObserver(() => {
      const currentSeq = glintSequence(glint);
      if (currentSeq <= metric.lastGlintSeq) {
        metric.lastGlintSeq = currentSeq;
        return;
      }

      // Sequence deltas are counted even if several attribute updates are
      // delivered in one MutationObserver batch. The compositor owns the event
      // identity; browser frame scheduling cannot erase an issued event.
      for (let seq = metric.lastGlintSeq + 1; seq <= currentSeq; seq += 1) {
        metric.glintEventsIssued += 1;
        metric.glintIssueEvents.push({
          tMs: elapsedMs(),
          sampleEvent: stats.sampleEvents,
          seq,
          value: glint.dataset.swGlintValue || displayValue(valueNode.textContent),
          state: glint.dataset.swGlintState || stateOf(gauge)
        });
      }
      metric.lastGlintSeq = currentSeq;
    });
    issueObserver.observe(glint, { attributes: true, attributeFilter: ["data-sw-glint-seq"] });

    // Rendering observation is intentionally secondary. DevTools, background
    // throttling, or a delayed animation frame may prevent a visible sweep from
    // starting even though the semantic glint event was correctly issued.
    const renderedObserver = new MutationObserver(() => {
      const opacity = Number(glint.getAttribute("opacity") || 0) || 0;
      if (metric.lastGlintOpacity <= 0.001 && opacity > 0.001) {
        metric.renderedGlintStarts += 1;
        metric.renderedGlintEvents.push({
          tMs: elapsedMs(),
          sampleEvent: stats.sampleEvents,
          value: displayValue(valueNode.textContent),
          state: stateOf(gauge)
        });
      }
      metric.lastGlintOpacity = opacity;
    });
    renderedObserver.observe(glint, { attributes: true, attributeFilter: ["opacity"] });
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
          rightSample: match.sampleEvent,
          leftSeq: event.seq,
          rightSeq: match.seq
        });
      }
    }
    return pairs;
  }

  function lockstep(toleranceMs = 25) {
    const left = stats.metrics.cpu?.glintIssueEvents || [];
    const right = stats.metrics.ram?.glintIssueEvents || [];
    const tolerance = Math.max(0, Number(toleranceMs) || 25);
    const pairs = pairGlintEvents(left, right, tolerance);
    const denominator = Math.min(left.length, right.length);
    const ratio = denominator ? pairs.length / denominator : 0;
    return {
      channel: "semantic-glint-issued",
      toleranceMs: tolerance,
      cpuGlints: left.length,
      ramGlints: right.length,
      pairedGlints: pairs.length,
      pairedRatio: Number(ratio.toFixed(3)),
      suspectedLockstep: denominator >= 2 && ratio >= 0.8,
      note: "Lockstep is a diagnostic trigger. Coincident issued glints are acceptable only when both displayed metrics genuinely changed.",
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
          seq: "",
          value: event.value,
          previous: event.previous,
          previousState: event.previousState,
          state: event.state,
          eligible: event.eligible
        });
      }
      for (const event of metric.glintIssueEvents || []) {
        rows.push({
          tMs: event.tMs,
          metric: config.key,
          event: "glint-issued",
          sampleEvent: event.sampleEvent,
          seq: event.seq,
          value: event.value,
          previous: "",
          previousState: "",
          state: event.state,
          eligible: ""
        });
      }
      for (const event of metric.renderedGlintEvents || []) {
        rows.push({
          tMs: event.tMs,
          metric: config.key,
          event: "glint-rendered",
          sampleEvent: event.sampleEvent,
          seq: "",
          value: event.value,
          previous: "",
          previousState: "",
          state: event.state,
          eligible: ""
        });
      }
    }
    rows.sort((a, b) => a.tMs - b.tMs || a.metric.localeCompare(b.metric) || a.event.localeCompare(b.event));
    return rows;
  }

  function snapshot() {
    const metrics = {};
    for (const config of METRICS) {
      const gauge = document.getElementById(config.gaugeId);
      const metric = stats.metrics[config.key] || {};
      const svg = gauge?.querySelector("svg[data-sw-instrument='segmented-dial']");
      const activity = activityVisible(gauge);
      const issued = metric.glintEventsIssued || 0;
      const rendered = metric.renderedGlintStarts || 0;
      const eligible = metric.eligibleValueChanges || 0;
      metrics[config.key] = {
        mounted: Boolean(svg),
        namespace: svg?.dataset.swInstance || null,
        state: stateOf(gauge),
        value: displayValue(document.getElementById(config.valueId)?.textContent),
        litSegments: visibleSegmentCount(gauge),
        valueChanges: metric.valueChanges || 0,
        eligibleValueChanges: eligible,
        glintEventsIssued: issued,
        renderedGlintStarts: rendered,
        glintMatchesEligibleChanges: issued === eligible,
        activityVisible: activity,
        sharedSourceActivityCorrect: activity === false,
        valueChangeTimesMs: (metric.valueEvents || []).map(event => event.tMs),
        glintIssueTimesMs: (metric.glintIssueEvents || []).map(event => event.tMs),
        renderedGlintStartTimesMs: (metric.renderedGlintEvents || []).map(event => event.tMs)
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
      metric.glintEventsIssued = 0;
      metric.renderedGlintStarts = 0;
      metric.valueEvents = [];
      metric.glintIssueEvents = [];
      metric.renderedGlintEvents = [];
      metric.lastValue = displayValue(document.getElementById(config.valueId)?.textContent);
      metric.lastState = stateOf(document.getElementById(config.gaugeId));
      const glint = document.getElementById(config.gaugeId)?.querySelector('[data-sw-role="glint"]');
      metric.lastGlintSeq = glintSequence(glint);
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