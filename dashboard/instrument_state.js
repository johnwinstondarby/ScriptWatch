/*
ScriptWatch instrument state machine v0.1.0

Pure behavior contract shared by the runtime console and instrument workbench.
It owns data-state semantics only. Source capability (for example Harness OFF)
is a separate axis from instrument data state.
*/

(() => {
  "use strict";

  const STATES = Object.freeze({
    NEVER: "never",
    LIVE: "live",
    DORMANT: "dormant",
    LIMIT: "limit",
    FAULT: "fault"
  });

  const CAPABILITY = Object.freeze({
    AVAILABLE: "available",
    UNSUPPORTED: "unsupported"
  });

  const STATE_SET = new Set(Object.values(STATES));
  const CAPABILITY_SET = new Set(Object.values(CAPABILITY));

  function hasValue(value) {
    return value !== null && value !== undefined && !(typeof value === "number" && !Number.isFinite(value));
  }

  function create(initial) {
    const opts = initial || {};
    const capability = CAPABILITY_SET.has(opts.capability) ? opts.capability : CAPABILITY.AVAILABLE;
    const model = {
      state: STATES.NEVER,
      capability,
      current: null,
      lastKnown: null,
      sampled: false,
      updatedAt: null
    };
    if (opts.state) return transition(model, opts.state, opts.value, opts.updatedAt, capability);
    return model;
  }

  function transition(previous, nextState, value, updatedAt, capability) {
    const prev = previous || create();
    const cap = capability === undefined ? prev.capability : capability;
    if (!CAPABILITY_SET.has(cap)) throw new Error(`Unknown instrument capability: ${cap}`);
    if (!STATE_SET.has(nextState)) throw new Error(`Unknown instrument state: ${nextState}`);

    const next = {
      state: nextState,
      capability: cap,
      current: prev.current,
      lastKnown: prev.lastKnown,
      sampled: prev.sampled,
      updatedAt: updatedAt === undefined ? prev.updatedAt : updatedAt
    };

    if (cap === CAPABILITY.UNSUPPORTED) {
      next.state = STATES.NEVER;
      next.current = null;
      return next;
    }

    if (nextState === STATES.NEVER) {
      next.current = null;
      next.lastKnown = null;
      next.sampled = false;
      return next;
    }

    if (nextState === STATES.LIVE || nextState === STATES.LIMIT) {
      if (!hasValue(value)) throw new Error(`${nextState} requires a value`);
      next.current = value;
      next.lastKnown = value;
      next.sampled = true;
      return next;
    }

    if (nextState === STATES.DORMANT) {
      // Dormant retains the last known value. A caller may seed one when
      // reconstructing persisted state, but zero is never invented.
      if (hasValue(value)) {
        next.lastKnown = value;
        next.sampled = true;
      }
      next.current = null;
      return next;
    }

    if (nextState === STATES.FAULT) {
      // Fault withholds the current value. lastKnown remains internal so a
      // recovery can continue from prior context without presenting it as live.
      next.current = null;
      return next;
    }

    return next;
  }

  function view(model) {
    const m = model || create();
    if (m.capability === CAPABILITY.UNSUPPORTED) {
      return {
        state: "unsupported",
        value: null,
        hasValue: false,
        moving: false,
        fresh: false,
        label: "OFF"
      };
    }

    if (m.state === STATES.NEVER) {
      return { state: STATES.NEVER, value: null, hasValue: false, moving: false, fresh: false, label: "NEVER SAMPLED" };
    }
    if (m.state === STATES.DORMANT) {
      return {
        state: STATES.DORMANT,
        value: m.sampled ? m.lastKnown : null,
        hasValue: m.sampled && hasValue(m.lastKnown),
        moving: false,
        fresh: false,
        label: "DORMANT"
      };
    }
    if (m.state === STATES.FAULT) {
      return { state: STATES.FAULT, value: null, hasValue: false, moving: false, fresh: false, label: "FAULT" };
    }
    if (m.state === STATES.LIMIT) {
      return { state: STATES.LIMIT, value: m.current, hasValue: true, moving: true, fresh: true, label: "AT LIMIT" };
    }
    return { state: STATES.LIVE, value: m.current, hasValue: true, moving: true, fresh: true, label: "LIVE" };
  }

  function boundedState(value, min, max) {
    if (!hasValue(value)) return STATES.NEVER;
    const lo = Number(min);
    const hi = Number(max);
    const v = Number(value);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo || !Number.isFinite(v)) return STATES.LIVE;
    const epsilon = Math.max((hi - lo) * 0.005, Number.EPSILON);
    return v >= hi - epsilon ? STATES.LIMIT : STATES.LIVE;
  }

  window.ScriptWatchInstrumentState = Object.freeze({
    STATES,
    CAPABILITY,
    create,
    transition,
    view,
    boundedState
  });
})();
