/*
ScriptWatch instrument-console visual layer v0.4.0

Presentation-only companion to dashboard/app.js. It derives source-state
semantics from existing rendered values and classes. No collector contract is
changed here.
*/

(() => {
  "use strict";

  const byId = id => document.getElementById(id);
  const finite = value => Number.isFinite(Number(value));
  const STATE_API = window.ScriptWatchInstrumentState || null;
  const STATES = STATE_API?.STATES || {
    NEVER: "never", LIVE: "live", DORMANT: "dormant", LIMIT: "limit", FAULT: "fault"
  };
  const ALL_STATE_CLASSES = ["never", "live", "dormant", "limit", "fault", "unsupported"];

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

  function consoleState() {
    const statusText = String(byId("status-text")?.textContent || "").toUpperCase();
    const footer = String(byId("footer-status")?.textContent || "").toUpperCase();
    const stale = document.body.classList.contains("telemetry-stale");
    const dashboardFault = statusText.includes("DASHBOARD CONNECTION ERROR") || footer.includes("DASHBOARD CONNECTION ERROR");
    const processExited = statusText.includes("PROCESS EXITED") || footer.includes("OBSERVED INDESIGN PROCESS EXITED");

    document.body.classList.toggle("telemetry-fault", dashboardFault);
    return {
      sampler: dashboardFault ? STATES.FAULT : stale ? STATES.DORMANT : STATES.LIVE,
      processExited
    };
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

  function setStateClass(node, state) {
    if (!node) return;
    ALL_STATE_CLASSES.forEach(s => node.classList.remove(`state-${s}`));
    node.classList.add(`state-${state}`);
  }

  function setSource(id, state, text) {
    const node = document.querySelector(`.source-node[data-source="${id}"]`);
    if (!node) return;
    setStateClass(node, state);
    const strong = node.querySelector("strong");
    if (strong) strong.textContent = text;
  }

  function sourceState(id) {
    const node = document.querySelector(`.source-node[data-source="${id}"]`);
    if (!node) return "unsupported";
    for (const state of [STATES.FAULT, STATES.DORMANT, STATES.LIMIT, STATES.LIVE, STATES.NEVER]) {
      if (node.classList.contains(`state-${state}`)) return state;
    }
    return "unsupported";
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
        <div><span>${label}</span><small>${detail}</small></div>
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
      if (processMount) processMount.appendChild(processGroup); else bank.appendChild(processGroup);
      bank.classList.add("counter-source-bank");
      const heading = bank.closest(".counter-section")?.querySelector(".counter-section-head span");
      if (heading) heading.textContent = "Host counters";
    }

    if (processGroup && processMount && processGroup.parentElement !== processMount) processMount.appendChild(processGroup);
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
        <div><span>HARNESS COUNTERS</span><small>semantic data published by the monitored script</small></div>
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

  function boundedState(percent) {
    if (percent === null) return STATES.NEVER;
    if (STATE_API) return STATE_API.boundedState(percent, 0, 100);
    return percent >= 99.5 ? STATES.LIMIT : STATES.LIVE;
  }

  function stateForGauge(id, state) {
    const gauge = byId(id);
    if (!gauge) return "unsupported";
    if (state.sampler === STATES.FAULT) return STATES.FAULT;
    if (state.sampler === STATES.DORMANT) return STATES.DORMANT;
    const card = gauge.closest(".dial-card");
    if (card?.classList.contains("unavailable")) return "unsupported";
    return boundedState(gaugePercent(id));
  }

  function applyGaugeState(id, instrumentState) {
    const gauge = byId(id);
    if (!gauge) return;
    setStateClass(gauge, instrumentState);
    const value = gauge.querySelector(".ring-center strong");
    if (instrumentState === STATES.FAULT && value) value.textContent = "ERR";
  }

  function setMeter(name, percent, instrumentState) {
    const meter = document.querySelector(`.capacity-meter[data-meter="${name}"]`);
    if (!meter) return;
    setStateClass(meter, instrumentState);
    const available = percent !== null && finite(percent);
    const p = available ? Math.max(0, Math.min(100, Number(percent))) : 0;
    meter.style.setProperty("--meter-p", p);
    const strong = meter.querySelector("strong");
    if (!strong) return;
    if (instrumentState === STATES.FAULT) strong.textContent = "ERR";
    else if (instrumentState === STATES.NEVER) strong.textContent = "—";
    else if (instrumentState === "unsupported") strong.textContent = "N/A";
    else if (available) strong.textContent = `${p.toFixed(1)}%`;
  }

  function stateForCounter(card, state) {
    if (state.sampler === STATES.FAULT) return STATES.FAULT;
    if (state.sampler === STATES.DORMANT) return STATES.DORMANT;
    let source = card.dataset.source || "";
    if (!source && card.closest("#job-metric-bank")) source = "harness";
    if (!source && card.dataset.counter) source = COUNTER_SOURCE[card.dataset.counter] || "other";
    const sourceStatus = source === "other" ? STATES.LIVE : sourceState(source);
    if ([STATES.FAULT, STATES.DORMANT, STATES.NEVER, "unsupported"].includes(sourceStatus)) return sourceStatus;
    if (card.classList.contains("unavailable")) return "unsupported";
    return STATES.LIVE;
  }

  function applyCounterStates(state) {
    document.querySelectorAll(".counter-card").forEach(card => {
      const instrumentState = stateForCounter(card, state);
      setStateClass(card, instrumentState);
      const strong = card.querySelector("strong");
      if (instrumentState === STATES.FAULT && strong) strong.textContent = "ERR";
    });
  }

  function updateSourceBus(state) {
    const ram = gaugePercent("ram-gauge");
    const cpu = gaugePercent("cpu-gauge");
    const hbText = String(byId("heartbeat-state")?.textContent || "").toUpperCase();
    const hbAge = String(byId("heartbeat-age")?.textContent || "");
    const harnessCard = byId("harness-card");
    const harnessVersion = String(byId("harness-version")?.textContent || "");

    let hostState = state.sampler;
    if (state.processExited && hostState !== STATES.FAULT) hostState = STATES.DORMANT;
    if (hostState === STATES.LIVE && ram === null) hostState = STATES.NEVER;
    setSource("host", hostState, hostState === STATES.NEVER ? "NEVER SAMPLED" : hostState.toUpperCase());

    let processState = state.processExited ? STATES.FAULT : state.sampler;
    if (processState === STATES.LIVE && cpu === null) processState = STATES.NEVER;
    setSource("process", processState, processState === STATES.FAULT ? "EXITED / FAULT" : processState === STATES.NEVER ? "NEVER SAMPLED" : processState.toUpperCase());

    if (state.sampler === STATES.FAULT) {
      setSource("heartbeat", STATES.FAULT, "UNAVAILABLE");
    } else if (state.processExited) {
      setSource("heartbeat", STATES.DORMANT, "DORMANT");
    } else if (hbText === "LIVE" && state.sampler === STATES.LIVE) {
      setSource("heartbeat", STATES.LIVE, hbAge && hbAge !== "--" ? `LIVE · ${hbAge}` : "LIVE");
    } else {
      setSource("heartbeat", STATES.DORMANT, hbText === "LIVE" ? "DORMANT" : "NO DATA");
    }

    const harnessVisible = harnessCard && !harnessCard.hidden;
    if (!harnessVisible) {
      setSource("harness", "unsupported", "HARNESS = OFF");
    } else if (state.sampler === STATES.FAULT || state.processExited) {
      setSource("harness", STATES.FAULT, "HARNESS = ON · FAULT");
    } else if (state.sampler === STATES.DORMANT) {
      setSource("harness", STATES.DORMANT, "HARNESS = ON · DORMANT");
    } else {
      setSource("harness", STATES.LIVE, harnessVersion ? `HARNESS = ON · ${harnessVersion}` : "HARNESS = ON");
    }
  }

  function updateHarnessIndicator(state) {
    const indicator = byId("harness-indicator");
    const card = byId("harness-card");
    if (!indicator) return;
    const harnessVisible = card && !card.hidden;
    const version = String(byId("harness-version")?.textContent || "").trim();
    const strong = indicator.querySelector("strong");
    const small = indicator.querySelector("small");
    let instrumentState = "unsupported", value = "OFF", detail = "agentless observation";

    if (harnessVisible) {
      instrumentState = state.sampler;
      if (state.processExited) instrumentState = STATES.FAULT;
      value = "ON";
      detail = version && version !== "--" ? version : "published";
      if (instrumentState === STATES.DORMANT) detail += " · dormant";
      if (instrumentState === STATES.FAULT) detail += " · source unavailable";
    }
    setStateClass(indicator, instrumentState);
    if (strong) strong.textContent = value;
    if (small) small.textContent = detail;
  }

  function updateHarnessOffBay() {
    const bay = byId("harness-off-bay"), harnessCard = byId("harness-card");
    if (bay) bay.hidden = Boolean(harnessCard && !harnessCard.hidden);
  }

  function updateCounterSourceGroups() {
    ["host", "process", "other"].forEach(source => {
      const group = document.querySelector(`[data-source-group="${source}"]`);
      if (!group) return;
      const instrumentState = source === "other" ? STATES.LIVE : sourceState(source);
      setStateClass(group, instrumentState);
      const status = group.querySelector(".counter-source-heading strong");
      if (status) status.textContent = instrumentState === STATES.NEVER ? "WAITING" : instrumentState.toUpperCase();
    });
    const harnessHeading = document.querySelector(".harness-counter-heading");
    if (harnessHeading) {
      const instrumentState = sourceState("harness");
      setStateClass(harnessHeading, instrumentState);
      const status = harnessHeading.querySelector("strong");
      if (status) status.textContent = instrumentState === "unsupported" ? "OFF" : instrumentState.toUpperCase();
    }
  }

  function updateCapacity(state) {
    const ramUsed = gaugePercent("ram-gauge"), commitUsed = gaugePercent("commit-gauge");
    const ramState = stateForGauge("ram-gauge", state), commitState = stateForGauge("commit-gauge", state);
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

    const state = consoleState();
    const processOnly = byId("job-panel")?.classList.contains("process-only");
    const progressState = processOnly ? "unsupported" : state.sampler === STATES.LIVE
      ? (gaugePercent("progress-gauge") === null ? STATES.NEVER : STATES.LIVE)
      : state.sampler;
    applyGaugeState("progress-gauge", progressState);
    applyGaugeState("cpu-gauge", state.processExited ? STATES.FAULT : stateForGauge("cpu-gauge", state));
    applyGaugeState("ram-gauge", stateForGauge("ram-gauge", state));
    applyGaugeState("commit-gauge", stateForGauge("commit-gauge", state));

    updateSourceBus(state);
    updateHarnessIndicator(state);
    updateHarnessOffBay();
    updateCounterSourceGroups();
    applyCounterStates(state);
    updateCapacity(state);
  }

  window.setInterval(updateVisualState, 500);
  updateVisualState();
})();
