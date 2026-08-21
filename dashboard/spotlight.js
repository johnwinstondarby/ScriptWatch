/*
ScriptWatch instrument-console visual layer v0.3.0

Presentation-only companion to dashboard/app.js. It derives source-state
semantics from existing rendered values and classes. No collector contract is
changed here.
*/

(() => {
  const byId = id => document.getElementById(id);
  const finite = value => Number.isFinite(Number(value));

  const COUNTER_SOURCE = {
    "available-ram": "host",
    "commit-headroom": "host",
    "commit-peak": "host",
    "system-cache": "host",
    "kernel-paged": "host",
    "kernel-nonpaged": "host",
    "sys-processes": "host",
    "sys-threads": "host",
    "sys-handles": "host",
    "private-delta": "process",
    "working-set": "process",
    "io-read": "process",
    "io-write": "process",
    "page-faults": "process",
    "gdi": "process",
    "user": "process",
    "threads": "process",
    "handles": "process"
  };

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

  function ensureColumnRoles() {
    const columns = document.querySelectorAll(".dashboard-grid > .column-panel");
    if (columns[0]) columns[0].classList.add("source-column-job");
    if (columns[1]) columns[1].classList.add("source-column-runtime");
    if (columns[2]) columns[2].classList.add("source-column-trends");
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

  function ensureHarnessIndicator() {
    if (byId("harness-indicator")) return;
    const topStatus = document.querySelector(".top-status");
    if (!topStatus) return;

    const indicator = document.createElement("div");
    indicator.id = "harness-indicator";
    indicator.className = "harness-indicator state-unsupported";
    indicator.setAttribute("aria-label", "ScriptWatch Harness state");
    indicator.innerHTML = `
      <span class="harness-indicator-lamp" aria-hidden="true"></span>
      <div>
        <span class="harness-indicator-label">HARNESS =</span>
        <strong>OFF</strong>
        <small>agentless observation</small>
      </div>`;
    topStatus.prepend(indicator);
  }

  function ensureHarnessOffBay() {
    if (byId("harness-off-bay")) return;
    const panel = byId("job-panel");
    if (!panel) return;

    const bay = document.createElement("section");
    bay.id = "harness-off-bay";
    bay.className = "instrument-card harness-off-bay state-unsupported";
    bay.innerHTML = `
      <div class="harness-off-heading">
        <span class="harness-off-lamp" aria-hidden="true"></span>
        <div>
          <span>HARNESS DATA</span>
          <small>semantic telemetry from inside the monitored script</small>
        </div>
        <strong>OFF</strong>
      </div>
      <div class="harness-off-body">
        <b>Agentless observation</b>
        <span>No Harness counters are published by this script. Host and InDesign process telemetry remain available.</span>
      </div>`;

    const summary = byId("process-only-summary");
    if (summary) summary.insertAdjacentElement("afterend", bay);
    else panel.appendChild(bay);
  }

  function ensureProcessCounterBay() {
    if (byId("process-counter-bay")) return;
    const handleCard = byId("handles-spark")?.closest(".spark-card");
    if (!handleCard) return;

    const bay = document.createElement("div");
    bay.id = "process-counter-bay";
    bay.className = "counter-section process-counter-bay";
    bay.innerHTML = `
      <div class="counter-section-head">
        <span>Process telemetry</span>
        <b>agentless source</b>
      </div>
      <div id="process-counter-mount"></div>`;
    handleCard.insertAdjacentElement("afterend", bay);
  }

  function setSource(id, state, text) {
    const node = document.querySelector(`.source-node[data-source="${id}"]`);
    if (!node) return;
    node.classList.remove("state-live", "state-dormant", "state-fault", "state-unsupported");
    node.classList.add(`state-${state}`);
    const strong = node.querySelector("strong");
    if (strong) strong.textContent = text;
  }

  function sourceState(id) {
    const node = document.querySelector(`.source-node[data-source="${id}"]`);
    if (!node) return "unsupported";
    if (node.classList.contains("state-fault")) return "fault";
    if (node.classList.contains("state-dormant")) return "dormant";
    if (node.classList.contains("state-live")) return "live";
    return "unsupported";
  }

  function setStateClass(node, state) {
    if (!node) return;
    node.classList.remove("state-live", "state-dormant", "state-fault", "state-unsupported");
    node.classList.add(`state-${state}`);
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

  function counterSourceGroup(source, label, detail) {
    const group = document.createElement("section");
    group.className = `counter-source-group source-${source} state-unsupported`;
    group.dataset.sourceGroup = source;
    group.innerHTML = `
      <div class="counter-source-heading">
        <span class="counter-source-lamp" aria-hidden="true"></span>
        <div>
          <span>${label}</span>
          <small>${detail}</small>
        </div>
        <strong>WAITING</strong>
      </div>
      <div class="counter-source-grid"></div>`;
    return group;
  }

  function ensureCounterSourceGroups() {
    const bank = byId("counter-bank");
    if (!bank) return;

    const processMount = byId("process-counter-mount");
    let hostGroup = document.querySelector('[data-source-group="host"]');
    let processGroup = document.querySelector('[data-source-group="process"]');
    let otherGroup = document.querySelector('[data-source-group="other"]');

    const directCards = Array.from(bank.children).filter(child => child.classList?.contains("counter-card"));
    if (!hostGroup && !processGroup && directCards.length === 0) return;

    if (!hostGroup) {
      hostGroup = counterSourceGroup("host", "HOST COUNTERS", "Windows host telemetry");
      processGroup = counterSourceGroup("process", "INDESIGN PROCESS COUNTERS", "agentless process telemetry");
      otherGroup = counterSourceGroup("other", "OTHER COUNTERS", "unclassified telemetry");
      otherGroup.hidden = true;
      bank.appendChild(hostGroup);
      bank.appendChild(otherGroup);
      if (processMount) processMount.appendChild(processGroup);
      else bank.appendChild(processGroup);
      bank.classList.add("counter-source-bank");

      const heading = bank.closest(".counter-section")?.querySelector(".counter-section-head span");
      if (heading) heading.textContent = "Host counters";
    }

    if (processGroup && processMount && processGroup.parentElement !== processMount) {
      processMount.appendChild(processGroup);
    }

    const cards = Array.from(bank.querySelectorAll(":scope > .counter-card"));
    cards.forEach(card => {
      const key = card.dataset.counter || "";
      const source = COUNTER_SOURCE[key] || "other";
      card.dataset.source = source;
      const group = document.querySelector(`[data-source-group="${source}"] .counter-source-grid`);
      if (group) group.appendChild(card);
      if (source === "other" && otherGroup) otherGroup.hidden = false;
    });
  }

  function ensureHarnessCounterSection() {
    const card = byId("harness-card");
    const bank = byId("job-metric-bank");
    if (!card || !bank) return;

    bank.classList.add("harness-counter-bank");
    bank.dataset.source = "harness";
    if (!card.querySelector(".harness-counter-heading")) {
      const heading = document.createElement("div");
      heading.className = "harness-counter-heading state-unsupported";
      heading.innerHTML = `
        <span class="counter-source-lamp" aria-hidden="true"></span>
        <div>
          <span>HARNESS COUNTERS</span>
          <small>semantic data published by the monitored script</small>
        </div>
        <strong>OFF</strong>`;
      bank.insertAdjacentElement("beforebegin", heading);
    }
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
    setStateClass(meter, state);

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
    setStateClass(gauge, state);
  }

  function stateForCounter(card, globalState) {
    if (globalState === "fault") return "fault";
    if (globalState === "dormant") return "dormant";

    let source = card.dataset.source || "";
    if (!source && card.closest("#job-metric-bank")) source = "harness";
    if (!source && card.dataset.counter) source = COUNTER_SOURCE[card.dataset.counter] || "other";

    const sourceStatus = source === "other" ? "live" : sourceState(source);
    if (sourceStatus === "fault") return "fault";
    if (sourceStatus === "dormant") return "dormant";
    if (sourceStatus === "unsupported") return "unsupported";
    if (card.classList.contains("unavailable")) return "dormant";
    return "live";
  }

  function applyCounterStates(globalState) {
    document.querySelectorAll(".counter-card").forEach(card => {
      setStateClass(card, stateForCounter(card, globalState));
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
      setSource("harness", "unsupported", "HARNESS = OFF");
    } else if (globalState === "fault") {
      setSource("harness", "fault", "HARNESS = ON · FAULT");
    } else if (globalState === "dormant") {
      setSource("harness", "dormant", "HARNESS = ON · DORMANT");
    } else {
      setSource("harness", "live", harnessVersion ? `HARNESS = ON · ${harnessVersion}` : "HARNESS = ON");
    }
  }

  function updateHarnessIndicator(globalState) {
    const indicator = byId("harness-indicator");
    const card = byId("harness-card");
    if (!indicator) return;

    const harnessVisible = card && !card.hidden;
    const version = String(byId("harness-version")?.textContent || "").trim();
    const strong = indicator.querySelector("strong");
    const small = indicator.querySelector("small");

    let state = "unsupported";
    let value = "OFF";
    let detail = "agentless observation";

    if (harnessVisible) {
      state = globalState;
      value = "ON";
      detail = version && version !== "--" ? version : "published";
      if (globalState === "dormant") detail += " · dormant";
      if (globalState === "fault") detail += " · source unavailable";
    }

    setStateClass(indicator, state);
    if (strong) strong.textContent = value;
    if (small) small.textContent = detail;
  }

  function updateHarnessOffBay() {
    const bay = byId("harness-off-bay");
    const harnessCard = byId("harness-card");
    if (!bay) return;
    const harnessVisible = harnessCard && !harnessCard.hidden;
    bay.hidden = Boolean(harnessVisible);
  }

  function updateCounterSourceGroups() {
    ["host", "process", "other"].forEach(source => {
      const group = document.querySelector(`[data-source-group="${source}"]`);
      if (!group) return;
      const state = source === "other" ? "live" : sourceState(source);
      setStateClass(group, state);
      const status = group.querySelector(".counter-source-heading strong");
      if (status) status.textContent = state.toUpperCase();
    });

    const harnessHeading = document.querySelector(".harness-counter-heading");
    if (harnessHeading) {
      const state = sourceState("harness");
      setStateClass(harnessHeading, state);
      const status = harnessHeading.querySelector("strong");
      if (status) status.textContent = state === "unsupported" ? "OFF" : state.toUpperCase();
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
    ensureColumnRoles();
    ensureSourceBus();
    ensureHarnessIndicator();
    ensureHarnessOffBay();
    ensureCapacityRack();
    ensureProcessCounterBay();
    ensureCounterSourceGroups();
    ensureHarnessCounterSection();

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

    updateSourceBus(globalState);
    updateHarnessIndicator(globalState);
    updateHarnessOffBay();
    updateCounterSourceGroups();
    applyCounterStates(globalState);
    updateCapacity(globalState);
  }

  window.setInterval(updateVisualState, 500);
  updateVisualState();
})();
