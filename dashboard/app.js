const $ = (id) => document.getElementById(id);

let lastSampleTimestamp = null;
let activityAngle = 0;

function num(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  return Number(value).toFixed(digits);
}

function integer(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  return Math.round(Number(value)).toLocaleString();
}

function duration(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds)) || Number(seconds) < 0) return "--:--:--";
  let s = Math.floor(Number(seconds));
  const h = Math.floor(s / 3600);
  s %= 3600;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function memoryValue(mb, digits = 1) {
  if (mb === null || mb === undefined || !Number.isFinite(Number(mb))) return "--";
  const value = Number(mb);
  if (Math.abs(value) >= 1024) return `${(value / 1024).toFixed(digits)} GB`;
  return `${value.toFixed(digits)} MB`;
}

function signedMemory(mb) {
  if (mb === null || mb === undefined || !Number.isFinite(Number(mb))) return "--";
  const value = Number(mb);
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${memoryValue(Math.abs(value))}`;
}

function setGauge(el, percent) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  el.style.setProperty("--p", p);
}

function setDial(gauge, value, detailEl, detail) {
  const available = value !== null && value !== undefined && Number.isFinite(Number(value));
  setGauge(gauge, available ? value : 0);
  gauge.closest(".dial-card")?.classList.toggle("unavailable", !available);
  if (detailEl) detailEl.textContent = detail || "--";
}

function sparkline(svg, history, key) {
  // Number(null) is 0, so nulls must be removed explicitly or missing data is
  // drawn as a real zero. Timestamp-derived x positions preserve real gaps.
  const points = history.map(p => ({
    t: Number(p.t),
    v: (p[key] === null || p[key] === undefined || !Number.isFinite(Number(p[key])))
      ? null
      : Number(p[key]),
  }));
  const known = points.filter(p => p.v !== null);
  if (known.length < 2) {
    svg.innerHTML = "";
    return;
  }

  let min = Math.min(...known.map(p => p.v));
  let max = Math.max(...known.map(p => p.v));
  if (max === min) {
    max += 1;
    min -= 1;
  }

  const t0 = points[0].t;
  const span = (points[points.length - 1].t - t0) || 1;
  const segments = [];
  let run = [];
  for (const p of points) {
    if (p.v === null) {
      if (run.length > 1) segments.push(run);
      run = [];
      continue;
    }
    const x = ((p.t - t0) / span) * 400;
    const y = 66 - ((p.v - min) / (max - min)) * 60;
    run.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  if (run.length > 1) segments.push(run);

  svg.innerHTML = segments.map(seg => `<polyline points="${seg.join(" ")}"></polyline>`).join("");
}

function statusClass(status) {
  const s = String(status || "collecting").toLowerCase();
  if (s === "running") return "running";
  if (s === "complete" || s === "done" || s === "finished") return "complete";
  if (s === "stalled") return "stalled";
  if (s === "error" || s === "failed" || s === "aborted") return "error";
  if (s === "no heartbeat") return "no-heartbeat";
  return "collecting";
}

function setTopStatus(status, text) {
  const cls = statusClass(status);
  $("status-dot").className = `status-dot ${cls}`;
  $("status-text").className = `status-text status-${cls}`;
  $("status-text").textContent = text;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function alertClass(text) {
  const s = String(text).toLowerCase();
  if (s.includes("memory rising") || s.includes("parse failure") || s.includes("stalled")) return "danger";
  return "";
}

function setQualification(card, collecting) {
  card.classList.toggle("unqualified", collecting);
  card.classList.toggle("qualified", !collecting);
}

function animateFreshSample(timestamp) {
  if (timestamp === null || timestamp === undefined || timestamp === lastSampleTimestamp) return false;
  lastSampleTimestamp = timestamp;
  activityAngle += 83;
  document.querySelectorAll(".activity-ring").forEach(ring => {
    ring.style.setProperty("--activity-angle", activityAngle);
    ring.classList.remove("sample-hit");
    void ring.offsetWidth;
    ring.classList.add("sample-hit");
    window.setTimeout(() => ring.classList.remove("sample-hit"), 620);
  });
  return true;
}

const COUNTER_REGISTRY = [
  { key: "available-ram", label: "Available RAM", get: d => d.system?.physicalAvailableMb, format: v => memoryValue(v) },
  { key: "commit-headroom", label: "Commit headroom", get: d => {
      const s = d.system || {};
      return Number.isFinite(Number(s.commitLimitMb)) && Number.isFinite(Number(s.commitMb))
        ? Number(s.commitLimitMb) - Number(s.commitMb) : null;
    }, format: v => memoryValue(v) },
  { key: "private-delta", label: "Private Δ", get: d => d.process?.privateDeltaMb, format: v => signedMemory(v), note: "since attach" },
  { key: "working-set", label: "Working set", get: d => d.process?.workingMb, format: v => memoryValue(v) },
  { key: "threads", label: "Threads", get: d => d.process?.threads, format: v => integer(v), note: "InDesign" },
  { key: "handles", label: "Handles", get: d => d.process?.handles, format: v => integer(v), note: "InDesign" },
  { key: "sys-processes", label: "System processes", get: d => d.system?.processCount, format: v => integer(v) },
  { key: "sys-threads", label: "System threads", get: d => d.system?.threadCount, format: v => integer(v) },
  { key: "sys-handles", label: "System handles", get: d => d.system?.handleCount, format: v => integer(v) },
];

function ensureCounterBank() {
  const bank = $("counter-bank");
  if (bank.children.length) return;
  bank.innerHTML = COUNTER_REGISTRY.map(c =>
    `<div class="counter-card" data-counter="${c.key}"><span>${escapeHtml(c.label)}</span><strong>--</strong>${c.note ? `<small>${escapeHtml(c.note)}</small>` : ""}</div>`
  ).join("");
}

function renderCounterBank(latest, freshSample) {
  ensureCounterBank();
  for (const spec of COUNTER_REGISTRY) {
    const card = document.querySelector(`[data-counter="${spec.key}"]`);
    if (!card) continue;
    const raw = spec.get(latest);
    const available = raw !== null && raw !== undefined && Number.isFinite(Number(raw));
    const text = available ? spec.format(raw) : "--";
    const strong = card.querySelector("strong");
    const changed = strong.textContent !== text && strong.textContent !== "--";
    strong.textContent = text;
    card.classList.toggle("unavailable", !available);
    if (freshSample && changed) {
      card.classList.remove("sample-update");
      void card.offsetWidth;
      card.classList.add("sample-update");
      window.setTimeout(() => card.classList.remove("sample-update"), 460);
    }
  }
}

function render(payload) {
  const latest = payload.latest;
  if (!latest) {
    $("footer-status").textContent = payload.error ? `Collector error: ${payload.error}` : "Collecting first sample…";
    return;
  }

  const job = latest.job;
  const proc = latest.process;
  const system = latest.system || {};
  const trends = latest.trends;
  const history = payload.history || [];
  const noHeartbeat = !job.heartbeatSeen;
  const freshSample = animateFreshSample(latest.timestamp);

  $("job-name").textContent = job.name;
  setTopStatus(job.status, `${job.status}${job.statusNote ? " · " + job.statusNote : ""}`);

  $("job-panel").classList.toggle("process-only", noHeartbeat);
  $("process-only-banner").hidden = !noHeartbeat;
  $("process-only-summary").hidden = !noHeartbeat;

  const percent = job.percent;
  $("progress-percent").textContent = percent === null ? "--" : `${num(percent, 1)}%`;
  setGauge($("progress-gauge"), percent || 0);
  $("target-value").textContent = `${integer(job.target)} / ${integer(job.total)}`;
  $("pass-value").textContent = integer(job.pass);
  $("fail-value").textContent = integer(job.fail);
  $("checkpoint-value").textContent = integer(job.lastCheckpoint);
  $("elapsed-value").textContent = duration(job.elapsedSeconds);
  $("eta-value").textContent = duration(job.etaSeconds);
  $("finish-value").textContent = job.finishAt ? `finish ~${job.finishAt}` : "";
  $("avg-value").textContent = job.averageTargetMs == null ? "--" : `${num(job.averageTargetMs / 1000, 2)} s`;
  $("rate-value").textContent = num(job.ratePerMin, 2);

  $("heartbeat-state").textContent = job.heartbeatSeen ? "LIVE" : "NO HEARTBEAT";
  $("heartbeat-state").style.color = job.heartbeatSeen ? "var(--green)" : "var(--amber)";
  $("heartbeat-age").textContent = job.heartbeatAgeSeconds == null ? "n/a" : `${integer(job.heartbeatAgeSeconds)} sec`;
  $("heartbeat-writes").textContent = integer(job.heartbeatWrites);
  $("heartbeat-host").textContent = job.host || "--";
  $("heartbeat-path").textContent = job.heartbeatPath || "process telemetry only";

  const monitorElapsed = latest.monitor.started == null ? null : latest.timestamp - latest.monitor.started;
  $("po-pid").textContent = integer(proc.pid);
  $("po-probe").textContent = proc.backend || "--";
  $("po-monitor-elapsed").textContent = duration(monitorElapsed);
  $("po-uptime").textContent = duration(proc.uptimeSeconds);
  $("po-samples").textContent = integer(latest.monitor.samples);
  $("po-coverage").textContent = duration(trends.coverageSeconds);
  $("po-required").textContent = duration(trends.coverageRequiredSeconds);
  $("po-csv-path").textContent = latest.monitor.csvPath || "CSV path pending…";

  // Three bounded dials: process CPU, physical RAM use, and system commit charge.
  $("cpu-value").textContent = proc.cpuPct == null ? "--" : `${num(proc.cpuPct, 1)}%`;
  setDial($("cpu-gauge"), proc.cpuPct, $("cpu-detail"), "process load");

  $("ram-value").textContent = system.physicalUsedPct == null ? "--" : `${num(system.physicalUsedPct, 1)}%`;
  setDial(
    $("ram-gauge"), system.physicalUsedPct, $("ram-detail"),
    system.physicalUsedMb == null || system.physicalTotalMb == null
      ? "host counter unavailable"
      : `${memoryValue(system.physicalUsedMb)} / ${memoryValue(system.physicalTotalMb)}`
  );

  $("commit-value").textContent = system.commitPct == null ? "--" : `${num(system.commitPct, 1)}%`;
  setDial(
    $("commit-gauge"), system.commitPct, $("commit-detail"),
    system.commitMb == null || system.commitLimitMb == null
      ? "host counter unavailable"
      : `${memoryValue(system.commitMb)} / ${memoryValue(system.commitLimitMb)}`
  );

  $("private-value").textContent = proc.privateMb == null ? "--" : integer(proc.privateMb);
  $("private-delta").textContent = signedMemory(proc.privateDeltaMb);
  $("private-peak").textContent = proc.peakPrivateMb == null ? "--" : memoryValue(proc.peakPrivateMb);

  const memoryText = trends.memoryCollecting
    ? "trend pending"
    : `${trends.memorySlopeMbHour >= 0 ? "+" : ""}${num(trends.memorySlopeMbHour, 1)} MB/hr`;
  $("memory-slope").textContent = memoryText;
  $("memory-slope-foot").textContent = trends.memoryCollecting ? "pending" : memoryText;
  $("memory-coverage").textContent = trends.memoryCollecting
    ? `${duration(trends.coverageSeconds)} of ${duration(trends.coverageRequiredSeconds)}`
    : `${duration(trends.coverageSeconds)} coverage`;
  $("memory-qualification").textContent = trends.memoryCollecting
    ? "raw samples · trend not yet qualified"
    : "least-squares slope · qualified";
  setQualification($("memory-spark-card"), trends.memoryCollecting);

  $("pid-value").textContent = integer(proc.pid);
  $("backend-value").textContent = proc.backend;
  $("uptime-value").textContent = duration(proc.uptimeSeconds);
  $("responding-value").textContent = proc.responding === null
    ? "not sampled"
    : (proc.responding ? "responsive" : "blocked · expected during modal script");
  $("pagefile-value").textContent = proc.pagefileMb == null ? "--" : memoryValue(proc.pagefileMb);

  renderCounterBank(latest, freshSample);
  if (freshSample) {
    $("counter-bank-state").textContent = `sample ${new Date(latest.timestamp * 1000).toLocaleTimeString()}`;
  }

  // Without a heartbeat there is no throughput source at all. "Unavailable"
  // differs from a trend still collecting toward its qualification floor.
  const trend = noHeartbeat
    ? "unavailable"
    : (trends.throughputCollecting ? "collecting…" : (trends.throughput || "stable"));
  $("throughput-trend").textContent = trend;
  $("throughput-coverage").textContent = noHeartbeat
    ? "requires a job heartbeat"
    : (trends.throughputCollecting
      ? `${duration(trends.coverageSeconds)} of ${duration(trends.coverageRequiredSeconds)}`
      : `${duration(trends.coverageSeconds)} coverage`);
  $("rate-qualification").textContent = noHeartbeat
    ? "no throughput source · this job publishes no heartbeat"
    : (trends.throughputCollecting ? "raw samples · trend not yet qualified" : "throughput trend · qualified");
  $("rate-coverage").textContent = noHeartbeat ? "--" : duration(trends.coverageSeconds);

  const rateCard = $("rate-spark-card");
  rateCard.classList.toggle("unavailable", noHeartbeat);
  if (noHeartbeat) {
    rateCard.classList.remove("qualified", "unqualified");
  } else {
    setQualification(rateCard, trends.throughputCollecting);
  }
  const trendBanner = $("throughput-trend").closest(".trend-banner");
  if (trendBanner) trendBanner.classList.toggle("unavailable", noHeartbeat);

  $("trend-arrow").textContent = noHeartbeat ? "·" : (trend === "rising" ? "↗" : trend === "falling" ? "↘" : "→");
  $("trend-arrow").style.color = noHeartbeat
    ? "var(--muted)"
    : (trend === "falling" ? "var(--amber)" : trend === "rising" ? "var(--green)" : "var(--cyan)");
  $("rate-now").textContent = `${num(job.ratePerMin, 2)} tgt/min`;
  $("handles-now").textContent = integer(proc.handles);

  sparkline($("memory-spark"), history, "private");
  sparkline($("rate-spark"), history, "rate");
  sparkline($("handles-spark"), history, "handles");

  const alerts = latest.alerts || [];
  $("alert-count").textContent = alerts.length;
  $("alerts-list").innerHTML = alerts.length
    ? alerts.map(a => `<div class="alert-item ${alertClass(a)}">${escapeHtml(a)}</div>`).join("")
    : '<div class="alert-item quiet">No active alerts.</div>';

  $("samples-value").textContent = integer(latest.monitor.samples);
  $("coverage-value").textContent = duration(trends.coverageSeconds);
  $("coverage-required").textContent = duration(trends.coverageRequiredSeconds);
  $("trend-window").textContent = duration(trends.trendWindowSeconds);
  $("watch-size").textContent = latest.monitor.watchBytes == null ? "--" : `${num(latest.monitor.watchBytes / 1024, 1)} KB`;
  $("csv-path").textContent = latest.monitor.csvPath;
  $("last-sample").textContent = `Last sample ${new Date(latest.timestamp * 1000).toLocaleTimeString()}`;

  const cadence = latest.monitor.intervalSeconds || (history.length > 1
    ? Math.max(1, (history[history.length - 1].t - history[0].t) / (history.length - 1))
    : 5);
  const sampleAge = Date.now() / 1000 - latest.timestamp;
  const stale = sampleAge > Math.max(15, cadence * 3);
  document.body.classList.toggle("telemetry-stale", stale || payload.processExited);

  if (payload.processExited) {
    $("footer-status").textContent = "Observed InDesign process exited. Historical telemetry remains displayed.";
    setTopStatus("error", "PROCESS EXITED · last known state shown");
  } else if (stale) {
    $("footer-status").textContent = `Sampler has not reported for ${duration(sampleAge)} · telemetry below is stale`;
    $("status-dot").className = "status-dot stale";
    $("status-text").className = "status-text status-stale";
    $("status-text").textContent = `STALE · no sampler update for ${duration(sampleAge)}`;
  } else if (payload.error) {
    $("footer-status").textContent = `Collector warning: ${payload.error}`;
  } else {
    $("footer-status").textContent = job.heartbeatSeen
      ? "Heartbeat + process telemetry + host memory telemetry"
      : "Process + host telemetry only · no heartbeat from this job";
  }
}

async function poll() {
  try {
    const response = await fetch(`/api/status?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(await response.json());
  } catch (err) {
    $("footer-status").textContent = `Dashboard connection error: ${err.message}`;
    setTopStatus("error", "DASHBOARD CONNECTION ERROR");
    document.body.classList.add("telemetry-stale");
  }
}

poll();
setInterval(poll, 2000);
