/*
ScriptWatch instrument-console visual layer v0.1.1

Presentation-only companion to dashboard/app.js. It derives source-state
semantics from existing rendered values and classes. No collector contract is
changed here.
*/

(() => {
  const byId = id => document.getElementById(id);
  const finite = value => Number.isFinite(Number(value));

  function classifyGlobalTelemetry() {
    const statusText = String(byId("status-text")?.textContent || "").toUpperCase();
    const footer = String(byId("footer-status")?.textContent || "").toUpperCase();
    const stale = document.body.classList.contains("telemetry-stale");
    const hardFault = statusText.includes("PROCESS EXITED") ||
      statusText.includes("DASHBOARD CONNECTION ERROR") ||
      footer.includes("DASHBOARD CONNECTION ERROR") ||
      footer.includes("OBSERVED INDESIGN PROCESS EXITED");

    document.body.classList.toggle("telemetry-fault", hardFault);
    if (hardFault) return "fault";
    if (stale) return "dormant";
    return "live";
  }

  function sourceNode(id, label) {
    const node = document.createElement("div");
    node.className = "source-node state-unsupported";
    node.dataset.source = id;
    node.innerHTML = `
      <span class="source-lamp" aria-hidden="true"></span>
      <div class="source-copy">
        <span>${label}</span>
        <strong>WAITING</strong>
      </div>`;
    return node;
  }

  function ensureSourceBus() {
    if (document.querySelector(".source-bus")) return;
    const topbar = document.querySelector(".topbar");
    if (!topbar) return;

    const bus = document.createElement("div");
    bus.className = "source-bus";
    bus.setAttribute("aria-label", "ScriptWatch telemetry sources");
    bus.appendChild(sourceNode("host", "Host telemetry"));
    bus.appendChild(sourceNode("process", "InDesign process"));
    bus.appendChild(sourceNode("heartbeat", "Heartbeat"));
    bus.appendChild(sourceNode("harness", "Harness"));
    topbar.insertAdjacentElement("afterend", bus);
  }

  function setSource(id, state, text) {
    const node = document.querySelector(`.source-node[data-source="${id}"]`);
    if (!node) return;
    node.classList.remove("state-live", "state-dormant", "state-fault", "state-unsupported");
    node.classList.add(`state-${state}`);
    const strong = node.querySelector("strong");
    if (strong) strong.textContent = text;
  }

  function ensureCapacityRack() {
    if (document.querySelector(".capacity-rack")) return;
    const dialBank = document.querySelector(".dial-bank");
    if (!dialBank) return;

    const rack = document.createElement("div");
    rack.className = "capacity-rack";
    rack.innerHTML = `
      <div class="capacity-meter" data-meter="ram-headroom">
        <div class="capacity-track"><div class="capacity-fill"></div></div>
        <div class="capacity-copy"><span>RAM headroom</span><strong>--</strong><small>available physical memory</small></div>
      </div>
      <div class="capacity-meter" data-meter="commit-headroom">
        <div class="capacity-track"><div class="capacity-fill"></div></div>
        <div class="capacity-copy"><span>Commit headroom</span><strong>--</strong><small>remaining commit limit</small></div>
      </div>`;
    dialBank.insertAdjacentElement("afterend", rack);
  }

  function gaugePercent(id) {
    const el = byId(id);
    if (!el) return null;
    const raw = el.style.getPropertyValue("--p").trim();
    if (raw === "" || !finite(raw)) return null;
    return Math.max(0, Math.min(100, Number(raw)));
  }

  function setMeter(name, percent, state) {
    const meter = document.querySelector(`.capacity-meter[data-meter="${name}"]`);
    if (!meter) return;
    meter.classList.remove("state-live", "state-dormant", "state-fault", "state-unsupported");
    meter.classList.add(`state-${state}`);

    const available = percent !== null && finite(percent);
    const p = available ? Math.max(0, Math.min(100, Number(percent))) : 0;
    meter.style.setProperty("--meter-p", p);
    const strong = meter.querySelector("strong");
    if (strong) strong.textContent = available ? `${p.toFixed(1)}%` : "N/A";
  }

  function stateForGauge(id, globalState) {
    const gauge = byId(id);
    if (!gauge) return "unsupported";
    const card = gauge.closest(".dial-card");
    if (globalState === "fault") return "fault";
    if (globalState === "dormant") return "dormant";
    if (card?.classList.contains("unavailable")) return "dormant";
    return gaugePercent(id) === null ? "dormant" : "live";
  }

  function applyGaugeState(id, state) {
    const gauge = byId(id);
    if (!gauge) return;
    gauge.classList.remove("state-live", "state-dormant", "state-fault", "state-unsupported");
    gauge.classList.add(`state-${state}`);
  }

  function applyCounterStates(globalState) {
    document.querySelectorAll(".counter-card").forEach(card => {
      card.classList.remove("state-live", "state-dormant", "state-fault", "state-unsupported");
      if (globalState === "fault") {
        card.classList.add("state-fault");
      } else if (globalState === "dormant") {
        card.classList.add("state-dormant");
      } else if (card.classList.contains("unavailable")) {
        card.classList.add("state-dormant");
      } else {
        card.classList.add("state-live");
      }
    });
  }

  function updateSourceBus(globalState) {
    const ram = gaugePercent("ram-gauge");
    const cpu = gaugePercent("cpu-gauge");
    const hbText = String(byId("heartbeat-state")?.textContent || "").toUpperCase();
    const hbAge = String(byId("heartbeat-age")?.textContent || "");
    const harnessCard = byId("harness-card");
    const harnessVersion = String(byId("harness-version")?.textContent || "");

    setSource(
      "host",
      globalState === "fault" ? "fault" : globalState === "dormant" ? "dormant" : (ram === null ? "dormant" : "live"),
      globalState === "fault" ? "FAULT" : globalState === "dormant" ? "DORMANT" : (ram === null ? "UNAVAILABLE" : "LIVE")
    );

    setSource(
      "process",
      globalState === "fault" ? "fault" : globalState === "dormant" ? "dormant" : (cpu === null ? "dormant" : "live"),
      globalState === "fault" ? "EXITED / FAULT" : globalState === "dormant" ? "DORMANT" : (cpu === null ? "UNAVAILABLE" : "LIVE")
    );

    if (globalState === "fault") {
      setSource("heartbeat", "fault", "UNAVAILABLE");
    } else if (hbText === "LIVE" && globalState === "live") {
      setSource("heartbeat", "live", hbAge && hbAge !== "--" ? `LIVE · ${hbAge}` : "LIVE");
    } else {
      setSource("heartbeat", "dormant", hbText === "LIVE" ? "DORMANT" : "NO DATA");
    }

    const harnessVisible = harnessCard && !harnessCard.hidden;
    if (!harnessVisible) {
      setSource("harness", "unsupported", "NOT PUBLISHED");
    } else if (globalState === "fault") {
      setSource("harness", "fault", harnessVersion || "FAULT");
    } else if (globalState === "dormant") {
      setSource("harness", "dormant", harnessVersion ? `${harnessVersion} · DORMANT` : "DORMANT");
    } else {
      setSource("harness", "live", harnessVersion ? `${harnessVersion} · LIVE` : "LIVE");
    }
  }

  function updateCapacity(globalState) {
    const ramUsed = gaugePercent("ram-gauge");
    const commitUsed = gaugePercent("commit-gauge");
    const ramState = stateForGauge("ram-gauge", globalState);
    const commitState = stateForGauge("commit-gauge", globalState);
    setMeter("ram-headroom", ramUsed === null ? null : 100 - ramUsed, ramState);
    setMeter("commit-headroom", commitUsed === null ? null : 100 - commitUsed, commitState);
  }

  function updateVisualState() {
    ensureSourceBus();
    ensureCapacityRack();
    const globalState = classifyGlobalTelemetry();

    ["progress-gauge", "cpu-gauge", "ram-gauge", "commit-gauge"].forEach(id => {
      let state = globalState;
      if (id === "progress-gauge") {
        const processOnly = byId("job-panel")?.classList.contains("process-only");
        if (processOnly && globalState === "live") state = "unsupported";
        else if (gaugePercent(id) === null && globalState === "live") state = "dormant";
      } else {
        state = stateForGauge(id, globalState);
      }
      applyGaugeState(id, state);
    });

    applyCounterStates(globalState);
    updateSourceBus(globalState);
    updateCapacity(globalState);
  }

  window.setInterval(updateVisualState, 500);
  updateVisualState();
})();
