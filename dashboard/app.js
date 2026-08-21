const $ = (id) => document.getElementById(id);

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

function setGauge(el, percent) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  el.style.setProperty("--p", p);
}

function sparkline(svg, history, key) {
  // Number(null) is 0, so a JSON null read straight into the trace plots a gap
  // in the data as a real reading at the bottom of the scale. Throughput is
  // null until the collector has enough samples to compute a rate, and handles
  // are null on non-Windows backends, so both would otherwise open with a
  // fabricated climb from zero.
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

  // x is derived from the timestamp, not the array index, so all three charts
  // share one time axis and a gap stays visibly a gap.
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

function collectingText(trends) {
  return `collecting… ${duration(trends.coverageSeconds)} of ${duration(trends.coverageRequiredSeconds)}`;
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

function render(payload) {
  const latest = payload.latest;
  if (!latest) {
    $("footer-status").textContent = payload.error ? `Collector error: ${payload.error}` : "Collecting first sample…";
    return;
  }

  const job = latest.job;
  const proc = latest.process;
  const trends = latest.trends;
  const history = payload.history || [];
  const noHeartbeat = !job.heartbeatSeen;

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

  $("cpu-value").textContent = proc.cpuPct == null ? "--" : `${num(proc.cpuPct, 1)}%`;
  setGauge($("cpu-gauge"), proc.cpuPct || 0);

  $("private-value").textContent = proc.privateMb == null ? "--" : integer(proc.privateMb);
  $("private-peak").textContent = proc.peakPrivateMb == null ? "peak --" : `peak ${num(proc.peakPrivateMb, 1)} MB`;
  $("peak-private-value").textContent = num(proc.peakPrivateMb, 1);

  const memoryText = trends.memoryCollecting
    ? collectingText(trends)
    : `${trends.memorySlopeMbHour >= 0 ? "+" : ""}${num(trends.memorySlopeMbHour, 1)} MB/hr`;
  $("memory-slope").textContent = memoryText;
  $("memory-slope-foot").textContent = memoryText;
  $("memory-coverage").textContent = trends.memoryCollecting
    ? `raw samples · ${duration(trends.coverageSeconds)} of ${duration(trends.coverageRequiredSeconds)}`
    : `${duration(trends.coverageSeconds)} coverage`;
  $("memory-qualification").textContent = trends.memoryCollecting
    ? "raw samples · trend not yet qualified"
    : "least-squares slope · qualified";
  setQualification($("memory-spark-card"), trends.memoryCollecting);

  $("working-value").textContent = num(proc.workingMb, 1);
  $("pagefile-value").textContent = proc.pagefileMb == null ? "--" : `${num(proc.pagefileMb, 1)} MB`;
  $("threads-value").textContent = integer(proc.threads);
  $("handles-value").textContent = integer(proc.handles);
  $("pid-value").textContent = integer(proc.pid);
  $("backend-value").textContent = proc.backend;
  $("uptime-value").textContent = duration(proc.uptimeSeconds);
  $("responding-value").textContent = proc.responding === null
    ? "not sampled"
    : (proc.responding ? "responsive" : "blocked · expected during modal script");

  const trend = trends.throughputCollecting ? "collecting…" : (trends.throughput || "stable");
  $("throughput-trend").textContent = trend;
  $("throughput-coverage").textContent = trends.throughputCollecting
    ? `raw samples · ${duration(trends.coverageSeconds)} of ${duration(trends.coverageRequiredSeconds)}`
    : `${duration(trends.coverageSeconds)} coverage`;
  $("rate-qualification").textContent = trends.throughputCollecting
    ? "raw samples · trend not yet qualified"
    : "throughput trend · qualified";
  $("rate-coverage").textContent = duration(trends.coverageSeconds);
  setQualification($("rate-spark-card"), trends.throughputCollecting);
  $("trend-arrow").textContent = trend === "rising" ? "↗" : trend === "falling" ? "↘" : "→";
  $("trend-arrow").style.color = trend === "falling" ? "var(--amber)" : trend === "rising" ? "var(--green)" : "var(--cyan)";
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

  // The sampler can stall without the HTTP server noticing: a PowerShell probe
  // can sit in a subprocess for up to 20 seconds. Compare the sample age
  // against the observed cadence rather than trusting that data is current.
  const cadence = history.length > 1
    ? Math.max(1, (history[history.length - 1].t - history[0].t) / (history.length - 1))
    : 5;
  const sampleAge = Date.now() / 1000 - latest.timestamp;
  const stale = sampleAge > Math.max(15, cadence * 3);

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
      ? "Heartbeat + process telemetry"
      : "Process telemetry only · no heartbeat from this job";
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
  }
}

poll();
setInterval(poll, 2000);
