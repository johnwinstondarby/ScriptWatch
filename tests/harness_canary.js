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

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const calls = [];
global.$ = { gc() { calls.push(["gc"]); } };
global.ScriptWatch = {
  start(opts) { calls.push(["start", opts]); return "canary.json"; },
  note(text) { calls.push(["note", text]); },
  tick(opts) { calls.push(["tick", opts]); return true; },
  metric(name, value, opts) { calls.push(["metric", name, value, opts]); return true; },
  checkpoint(target, gc) { calls.push(["checkpoint", target, gc]); return target; },
  finish(status, note) { calls.push(["finish", status, note]); return "canary.json"; },
};

const source = fs.readFileSync(path.join(__dirname, "..", "ScriptWatchJob.jsxinc"), "utf8");
vm.runInThisContext(source, { filename: "ScriptWatchJob.jsxinc" });

assert.strictEqual(ScriptWatchJob.VERSION, "1.2");

calls.length = 0;
const result = ScriptWatchJob.run({
  job: "Harness Canary",
  tool: "NormalFix",
  toolVersion: "canary",
  targets: [1, 2, 3, 4],
  checkpointEvery: 2,
  onTarget(value, n, session) {
    session.metric("Targets seen", n, { unit: "targets" });
    return n !== 3;
  },
});
assert.strictEqual(result.pass, 3);
assert.strictEqual(result.fail, 1);
assert.strictEqual(result.aborted, false);
assert.strictEqual(result.harnessVersion, "1.2");
const start = calls.find(c => c[0] === "start")[1];
assert.strictEqual(start.tool, "NormalFix");
assert.strictEqual(start.toolVersion, "canary");
assert.strictEqual(start.harnessVersion, "1.2");
assert.strictEqual(start.mode, "collection");
assert.strictEqual(calls.filter(c => c[0] === "checkpoint").length, 2);
assert.strictEqual(calls.filter(c => c[0] === "metric").length, 4);
assert.strictEqual(calls.filter(c => c[0] === "finish").pop()[1], "DONE");

calls.length = 0;
let threw = false;
try {
  ScriptWatchJob.run({
    job: "Fail Fast",
    tool: "NormalFix",
    targets: [1, 2],
    continueOnError: false,
    onTarget(value, n) { return n !== 1; },
  });
} catch (err) {
  threw = true;
}
assert.strictEqual(threw, true);
assert.strictEqual(calls.filter(c => c[0] === "finish").pop()[1], "ABORTED");

calls.length = 0;
const phase = ScriptWatchJob.begin({
  job: "Phase Canary",
  tool: "DocStats",
  toolVersion: "1.2.3",
  total: 2,
});
phase.step("one");
phase.metric("Stories", 26, { unit: "stories", display: "counter" });
phase.pass();
phase.step("two");
phase.pass();
phase.end("DONE");
const phaseStart = calls.find(c => c[0] === "start")[1];
assert.strictEqual(phaseStart.mode, "phase");
assert.strictEqual(phaseStart.harnessVersion, "1.2");
assert.ok(calls.some(c => c[0] === "metric" && c[1] === "Stories" && c[2] === 26));

console.log("ScriptWatch Harness canary: PASS");
