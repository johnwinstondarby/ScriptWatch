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
  const values = history.map(p => Number(p[key])).filter(v => Number.isFinite(v));
  if (values.length < 2) {
    svg.innerHTML = "";
    return;
  }

  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max === min) {
    max += 1;
    min -= 1;
  }

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 400;
    const y = 66 - ((v - min) / (max - min)) * 60;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  svg.innerHTML = `<polyline points="${points}"></polyline>`;
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
  $("status-text").textContent = `${job.status}${job.statusNote ? " · " + job.statusNote : ""}`;
  $("status-dot").className = `status-dot ${statusClass(job.status)}`;

  $("job-panel").classList.toggle("process-only", noHeartbeat);
  $("process-only-banner").hidden = !noHeartbeat;

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
    ? collectingText(trends)
    : `${duration(trends.coverageSeconds)} coverage`;

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
    ? collectingText(trends)
    : `${duration(trends.coverageSeconds)} coverage`;
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

  if (payload.processExited) {
    $("footer-status").textContent = "Observed InDesign process exited. Historical telemetry remains displayed.";
    $("status-dot").className = "status-dot error";
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
    $("status-dot").className = "status-dot error";
  }
}

poll();
setInterval(poll, 2000);
