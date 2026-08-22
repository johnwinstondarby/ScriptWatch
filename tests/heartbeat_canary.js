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
const os = require("os");
const path = require("path");
const vm = require("vm");

const td = fs.mkdtempSync(path.join(os.tmpdir(), "scriptwatch-heartbeat-"));

class MockFile {
  constructor(filePath) {
    this.fsName = path.resolve(String(filePath));
    this.name = path.basename(this.fsName);
    this.encoding = "UTF-8";
    this.lineFeed = "Unix";
    this.fd = null;
  }
  get exists() { return fs.existsSync(this.fsName); }
  open(mode) {
    if (mode !== "w") return false;
    fs.mkdirSync(path.dirname(this.fsName), { recursive: true });
    this.fd = fs.openSync(this.fsName, "w");
    return true;
  }
  write(text) { fs.writeSync(this.fd, String(text)); }
  close() { if (this.fd !== null) { fs.closeSync(this.fd); this.fd = null; } }
  remove() { try { fs.unlinkSync(this.fsName); return true; } catch (_) { return false; } }
  rename(newName) {
    const destination = path.join(path.dirname(this.fsName), newName);
    fs.renameSync(this.fsName, destination);
    this.fsName = destination;
    this.name = path.basename(destination);
    return true;
  }
}

class MockFolder {
  constructor(folderPath) { this.fsName = path.resolve(String(folderPath)); }
  get exists() { return fs.existsSync(this.fsName); }
  create() { fs.mkdirSync(this.fsName, { recursive: true }); return true; }
}
MockFolder.temp = new MockFolder(td);

global.File = MockFile;
global.Folder = MockFolder;
global.$ = {
  getenv(name) { return name === "COMPUTERNAME" ? "CANARYHOST" : ""; },
  writeln() {},
  gc() {},
};

const source = fs.readFileSync(path.join(__dirname, "..", "ScriptWatchHeartbeat.jsxinc"), "utf8");
vm.runInThisContext(source, { filename: "ScriptWatchHeartbeat.jsxinc" });
assert.strictEqual(ScriptWatch.SCHEMA_VERSION, "1.2");

const hb1 = path.join(td, "run1.json");
ScriptWatch.start({
  path: hb1,
  job: "Heartbeat Canary",
  tool: "NormalFix",
  toolVersion: "canary",
  harnessVersion: "1.2",
  mode: "collection",
  total: 5,
  everyTargets: 0,
  everyMs: 0,
});
assert.strictEqual(ScriptWatch.metric("Stories", 26, { unit: "stories", display: "counter", force: true }), true);
assert.strictEqual(ScriptWatch.metric("Progress", 40, { unit: "%", min: 0, max: 100, display: "dial", force: true }), true);
assert.strictEqual(ScriptWatch.metric("bad", NaN, {}), false);
ScriptWatch.tick({ target: 2, pass: 2, fail: 0, force: true });
ScriptWatch.finish("DONE", "NormalFix · harness 1.2 · complete");

const data1 = JSON.parse(fs.readFileSync(hb1, "utf8"));
assert.strictEqual(data1.schemaVersion, "1.2");
assert.strictEqual(data1.tool, "NormalFix");
assert.strictEqual(data1.toolVersion, "canary");
assert.strictEqual(data1.harnessVersion, "1.2");
assert.strictEqual(data1.mode, "collection");
assert.strictEqual(data1.status, "DONE");
assert.strictEqual(data1.metrics.length, 2);
assert.strictEqual(data1.metrics[1].min, 0);
assert.strictEqual(data1.metrics[1].max, 100);
assert.strictEqual(data1.metrics[1].display, "dial");
assert.ok(!fs.existsSync(hb1.replace(/\.json$/i, ".lock")));

const hb2 = path.join(td, "run2.json");
ScriptWatch.start({ path: hb2, job: "Second", tool: "StyleFix", harnessVersion: "1.2", total: 1 });
const data2 = JSON.parse(fs.readFileSync(hb2, "utf8"));
assert.strictEqual(data2.status, "RUNNING");
assert.deepStrictEqual(data2.metrics, []);
assert.strictEqual(data2.writes, 0);
assert.ok(!data2.note);
ScriptWatch.finish("DONE");

console.log("ScriptWatch heartbeat canary: PASS");
