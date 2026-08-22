/*
 * ScriptWatch - runtime observer console for long-running InDesign ExtendScript jobs
 * Copyright (C) 2026 John Darby
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
// SPDX-License-Identifier: GPL-3.0-or-later

/* ScriptWatch instrument-state canary. Dependency-free Node test. */
"use strict";

global.window = global;
require("../dashboard/instrument_state.js");

const S = global.ScriptWatchInstrumentState;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function eq(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

// NEVER_SAMPLED is different from a legitimate zero.
let m = S.create();
let v = S.view(m);
eq(v.state, S.STATES.NEVER, "initial state");
eq(v.hasValue, false, "never has no value");
eq(v.value, null, "never does not invent zero");

m = S.transition(m, S.STATES.LIVE, 0, 1);
v = S.view(m);
eq(v.state, S.STATES.LIVE, "zero sample is live");
eq(v.hasValue, true, "zero sample is a real value");
eq(v.value, 0, "zero is preserved");
eq(v.moving, true, "live zero remains live");

// Dormant retains the last known reading and freezes.
m = S.transition(m, S.STATES.LIVE, 50.5, 2);
m = S.transition(m, S.STATES.DORMANT, undefined, 5);
v = S.view(m);
eq(v.state, S.STATES.DORMANT, "dormant state");
eq(v.value, 50.5, "dormant retains last known value");
eq(v.hasValue, true, "dormant exposes last known value");
eq(v.moving, false, "dormant stops motion");

// Persisted dormant state may be seeded explicitly, never with an invented zero.
let persisted = S.create();
persisted = S.transition(persisted, S.STATES.DORMANT, 1418, 5);
v = S.view(persisted);
eq(v.value, 1418, "persisted dormant seed survives");

// At-limit is live and moving.
m = S.transition(m, S.STATES.LIMIT, 100, 6);
v = S.view(m);
eq(v.state, S.STATES.LIMIT, "limit state");
eq(v.value, 100, "limit retains current value");
eq(v.moving, true, "limit remains live/moving");
eq(v.fresh, true, "limit is fresh data");

// Fault withholds the current value but retains internal history.
m = S.transition(m, S.STATES.LIVE, 73, 7);
m = S.transition(m, S.STATES.FAULT, undefined, 8);
v = S.view(m);
eq(v.state, S.STATES.FAULT, "fault state");
eq(v.hasValue, false, "fault withholds current value");
eq(v.value, null, "fault exposes no current value");
eq(v.moving, false, "fault stops motion");
eq(m.lastKnown, 73, "fault retains prior sample internally");

// Capability absence is separate from the data-state machine.
let off = S.create({ capability: S.CAPABILITY.UNSUPPORTED });
v = S.view(off);
eq(v.state, "unsupported", "unsupported capability view");
eq(v.label, "OFF", "unsupported capability label");
eq(v.hasValue, false, "unsupported capability has no data value");

// Bounded helper only marks the declared bound.
eq(S.boundedState(99, 0, 100), S.STATES.LIVE, "below bound is live");
eq(S.boundedState(100, 0, 100), S.STATES.LIMIT, "bound is at-limit");

assert(Object.isFrozen(S.STATES), "state vocabulary must be frozen");
console.log("ScriptWatch instrument state canary: PASS");
