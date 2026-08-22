/*
ScriptWatch instrument compositor v0.1.0

Loads authored SVG instrument artwork into the live dashboard without changing
collector or Harness semantics. v0.1 mounts the segmented-dial asset on CPU only.

Source motion remains owned by source-level telemetry. CPU's embedded activity
carrier is intentionally disabled because CPU, RAM, and Commit currently share
one Monitor.tick() acquisition event. The local glint acknowledges CPU value
change only.
*/

(() => {
  "use strict";

  const ASSET_URL = "instruments/segmented-dial.svg";
  const PUBLIC_IDS = ["housing", "well", "face-off", "bloom", "face-lit", "activity", "glint"];
  const STATE_CLASSES = ["never", "live", "dormant", "limit", "fault", "unsupported"];
  const SEGMENT_COUNT = 36;

  const PALETTES = {
    live: {
      stops: ["#0A4F35", "#179A63", "#31E08F", "#8DF7C6", "#E4FFF3"],
      bloom: "#5CEFB0"
    },
    dormant: {
      stops: ["#4B3210", "#8B5D1B", "#C9902D", "#F3C86C", "#FFF0C7"],
      bloom: "#E5AD43"
    },
    limit: {
      stops: ["#4B1D0D", "#943815", "#E4682A", "#FF9C68", "#FFE1CE"],
      bloom: "#FF8150"
    }
  };

  const INSTRUMENTS = [
    {
      gaugeId: "cpu-gauge",
      valueId: "cpu-value",
      prefix: "cpu",
      allowActivity: false
    }
  ];

  let assetTextPromise = null;

  function assetText() {
    if (!assetTextPromise) {
      assetTextPromise = fetch(ASSET_URL, { cache: "force-cache" }).then(response => {
        if (!response.ok) throw new Error(`SVG asset HTTP ${response.status}`);
        return response.text();
      });
    }
    return assetTextPromise;
  }

  function parseSvg(text) {
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    const parserError = doc.querySelector("parsererror");
    if (parserError) throw new Error("segmented-dial.svg parse failure");
    const svg = doc.documentElement;
    if (!svg || String(svg.localName).toLowerCase() !== "svg") {
      throw new Error("segmented-dial.svg has no SVG root");
    }
    return svg;
  }

  function validateContract(svg) {
    const handles = {};
    for (const id of PUBLIC_IDS) {
      const node = svg.querySelector(`#${id}`);
      if (!node) throw new Error(`segmented-dial.svg contract missing #${id}`);
      handles[id] = node;
    }
    if (svg.getAttribute("viewBox") !== "0 0 200 200") {
      throw new Error("segmented-dial.svg contract viewBox mismatch");
    }
    if (handles["face-lit"].children.length !== SEGMENT_COUNT) {
      throw new Error("segmented-dial.svg face-lit must expose 36 direct children");
    }
    if (handles.bloom.children.length !== SEGMENT_COUNT) {
      throw new Error("segmented-dial.svg bloom must expose 36 direct children");
    }
    if (handles["face-off"].children.length !== SEGMENT_COUNT) {
      throw new Error("segmented-dial.svg face-off must expose 36 direct children");
    }
    if (svg.querySelector("script, text, image, animate, animateTransform, animateMotion, set")) {
      throw new Error("segmented-dial.svg contains prohibited active/text/raster content");
    }
    return handles;
  }

  function namespaceSvg(svg, prefix, publicHandles) {
    const idMap = new Map();
    const originalNodes = new Map();

    svg.querySelectorAll("[id]").forEach(node => {
      const original = node.id;
      if (!original) return;
      const namespaced = `${prefix}__${original}`;
      idMap.set(original, namespaced);
      originalNodes.set(original, node);
      node.id = namespaced;
    });

    const rewriteValue = value => {
      let next = String(value);
      next = next.replace(/url\(#([^)]+)\)/g, (match, id) =>
        idMap.has(id) ? `url(#${idMap.get(id)})` : match
      );
      if (next.startsWith("#") && idMap.has(next.slice(1))) {
        next = `#${idMap.get(next.slice(1))}`;
      }
      return next;
    };

    svg.querySelectorAll("*").forEach(node => {
      for (const attrName of node.getAttributeNames()) {
        const before = node.getAttribute(attrName);
        const after = rewriteValue(before);
        if (after !== before) node.setAttribute(attrName, after);
      }
    });

    const handles = {};
    for (const id of PUBLIC_IDS) {
      const node = publicHandles[id] || originalNodes.get(id);
      if (!node) throw new Error(`namespace lost public handle ${id}`);
      node.dataset.swRole = id;
      handles[id] = node;
    }

    svg.dataset.swInstrument = "segmented-dial";
    svg.dataset.swInstance = prefix;
    svg.removeAttribute("role");
    svg.removeAttribute("aria-label");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.classList.add("svg-instrument-art");

    return {
      handles,
      internal: originalId => originalNodes.get(originalId) || null,
      idMap
    };
  }

  function readPercent(gauge) {
    const raw = gauge.style.getPropertyValue("--p").trim();
    if (raw === "") return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    return Math.max(0, Math.min(100, value));
  }

  function readState(gauge) {
    for (const state of STATE_CLASSES) {
      if (gauge.classList.contains(`state-${state}`)) return state;
    }
    if (gauge.closest(".dial-card")?.classList.contains("unavailable")) return "unsupported";
    return "never";
  }

  function litCountFor(value, state) {
    if (value === null) return 0;
    if (!["live", "dormant", "limit"].includes(state)) return 0;
    return Math.max(0, Math.min(SEGMENT_COUNT, Math.round(value / 100 * SEGMENT_COUNT)));
  }

  function applyPalette(instance, state) {
    const palette = PALETTES[state] || PALETTES.live;
    const gradient = instance.internal("grad-lit");
    if (gradient) {
      const stops = Array.from(gradient.querySelectorAll("stop"));
      stops.forEach((stop, index) => {
        const color = palette.stops[Math.min(index, palette.stops.length - 1)];
        if (color) stop.setAttribute("stop-color", color);
      });
    }
    instance.handles.bloom.setAttribute("fill", palette.bloom);
  }

  function setSegments(instance, count) {
    const lit = Array.from(instance.handles["face-lit"].children);
    const bloom = Array.from(instance.handles.bloom.children);
    for (let index = 0; index < SEGMENT_COUNT; index += 1) {
      const visibility = index < count ? "visible" : "hidden";
      lit[index].setAttribute("visibility", visibility);
      bloom[index].setAttribute("visibility", visibility);
    }
  }

  function setActivityEnabled(instance, enabled) {
    instance.handles.activity.setAttribute("visibility", enabled ? "visible" : "hidden");
    if (!enabled) instance.handles.activity.removeAttribute("transform");
  }

  function cancelGlint(instance) {
    instance.glintToken += 1;
    instance.handles.glint.setAttribute("opacity", "0");
  }

  function fireGlint(instance) {
    const glint = instance.handles.glint;
    const token = ++instance.glintToken;
    const started = performance.now();
    const duration = 620;

    function frame(now) {
      if (token !== instance.glintToken) return;
      const progress = Math.min(1, (now - started) / duration);
      const angle = -150 + progress * 300;
      const opacity = Math.sin(progress * Math.PI) * 0.78;
      glint.setAttribute("opacity", opacity.toFixed(3));
      glint.setAttribute("transform", `rotate(${angle.toFixed(2)} 100 100)`);
      if (progress < 1) {
        requestAnimationFrame(frame);
      } else {
        glint.setAttribute("opacity", "0");
      }
    }

    requestAnimationFrame(frame);
  }

  function syncInstance(instance, initializing = false) {
    const state = readState(instance.gauge);
    const value = readPercent(instance.gauge);
    const count = litCountFor(value, state);

    if (state !== instance.lastState) {
      if (["live", "dormant", "limit"].includes(state)) applyPalette(instance, state);
      instance.svg.dataset.swState = state;
      instance.lastState = state;
    }

    if (count !== instance.lastLitCount || initializing) {
      setSegments(instance, count);
      instance.lastLitCount = count;
    }

    // CPU shares the collector acquisition with RAM and Commit, so its local
    // activity carrier would duplicate one source event three times. Keep it off.
    setActivityEnabled(instance, Boolean(instance.config.allowActivity));

    const changed = !initializing && value !== null && instance.lastValue !== null && value !== instance.lastValue;
    if (changed && (state === "live" || state === "limit")) {
      fireGlint(instance);
    }
    if (!["live", "limit"].includes(state)) cancelGlint(instance);

    if (value !== null) instance.lastValue = value;
  }

  function scheduleSync(instance) {
    if (instance.syncQueued) return;
    instance.syncQueued = true;
    queueMicrotask(() => {
      instance.syncQueued = false;
      try {
        syncInstance(instance, false);
      } catch (error) {
        failToLegacy(instance, error);
      }
    });
  }

  function failToLegacy(instance, error) {
    try { instance.observer?.disconnect(); } catch (_) {}
    try { cancelGlint(instance); } catch (_) {}
    try { instance.svg?.remove(); } catch (_) {}
    if (instance.gauge) {
      instance.gauge.classList.remove("svg-instrument-mounted");
      if (instance.hadActivityRing) instance.gauge.classList.add("activity-ring");
    }
    console.warn(`ScriptWatch SVG compositor fallback for ${instance.config.gaugeId}:`, error);
  }

  async function mount(config) {
    const gauge = document.getElementById(config.gaugeId);
    const valueEl = document.getElementById(config.valueId);
    if (!gauge || !valueEl || gauge.classList.contains("svg-instrument-mounted")) return null;

    const text = await assetText();
    const svg = parseSvg(text);
    const publicHandles = validateContract(svg);
    const namespaced = namespaceSvg(svg, config.prefix, publicHandles);

    const instance = {
      config,
      gauge,
      valueEl,
      svg,
      handles: namespaced.handles,
      internal: namespaced.internal,
      lastValue: null,
      lastState: null,
      lastLitCount: -1,
      glintToken: 0,
      syncQueued: false,
      observer: null,
      hadActivityRing: gauge.classList.contains("activity-ring")
    };

    // The authored SVG is inserted only after its contract validates. Until
    // this point the legacy CSS dial remains untouched and is the fail-safe.
    gauge.insertBefore(svg, gauge.firstChild);
    gauge.classList.add("svg-instrument-mounted");
    gauge.classList.remove("activity-ring");

    syncInstance(instance, true);

    const observer = new MutationObserver(() => scheduleSync(instance));
    observer.observe(gauge, { attributes: true, attributeFilter: ["class", "style"] });
    observer.observe(valueEl, { childList: true, characterData: true, subtree: true });
    const card = gauge.closest(".dial-card");
    if (card) observer.observe(card, { attributes: true, attributeFilter: ["class"] });
    instance.observer = observer;

    return instance;
  }

  async function start() {
    for (const config of INSTRUMENTS) {
      try {
        await mount(config);
      } catch (error) {
        console.warn(`ScriptWatch SVG compositor did not mount ${config.gaugeId}:`, error);
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
