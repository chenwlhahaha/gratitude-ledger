#!/usr/bin/env node
"use strict";
// Synthetic-only integration suite: never reads the real data directory.
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), net = require("node:net");
const { spawn } = require("node:child_process");
const ROOT = path.resolve(__dirname, ".."), SERVER = path.join(ROOT, "server.js");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "gratitude-honors-test-")), storeFile = path.join(temp, "store.json");
const person = (id, groupId, role = "member", title = "") => ({ id, name: `测试-${id}`, groupId, role, title, active: true, code: "test8888", targets: { income: 10000, expense: 0, hours: 1 } });
const group = id => ({ id, name: id, letterPlan: [], letterCycleStart: "2026-10-01", leaderId: "", fudaoId: "", xueweiId: "" });
const letter = (id, authorId, groupId, date) => ({ id, authorId, authorName: `测试-${authorId}`, groupId, date, content: `合成正文-${id}`, images: ["/uploads/synthetic.jpg"], comments: [{ id: "private", memberId: "other", name: "私密同组点评", text: "不得全班公开", at: 1 }] });
const fixture = { schemaV2: 8, className: "合成班", groups: [group("a"), group("b"), group("c"), group("g_fudao")],
  members: [person("director", null, "classAdmin", "班主任"), person("vice", null, "classAdmin", "副班主任"), person("monitor", null, "monitor", "班长"), person("study", null), person("legacy_study", null, "classAdmin", "大学委"), person("one", "a"), { ...person("counselor", "a"), taskGroupId: "g_fudao" }, person("two", "b"), person("three", "c"), { ...person("inactive", "a"), active: false }],
  classOfficers: { xuewei: "study", jiwei: "", guanai: "", huodong: "" },
  activities: [{ id: "read", name: "读书", income: 500, expense: 200, hours: 0.5, freq: "daily" }], specials: [], tokens: {},
  records: { "2026-10-01": { one: { items: { read: true }, customs: [{ id: "old", amount: 500, label: "优秀家书（本周精选）", note: "2026-10-01" }] }, counselor: { items: {}, customs: [{ id: "c", amount: 800, label: "历史调整" }] }, two: { items: {}, customs: [{ id: "b", amount: 800, label: "历史调整" }] }, three: { items: {}, customs: [{ id: "d", amount: 100, label: "历史调整" }] } } },
  approvals: [{ id: "pending", memberId: "two", date: "2026-10-01", status: "pending", income: 9000, expense: 0, hours: 0 }, { id: "rejected", memberId: "two", date: "2026-10-01", status: "rejected", income: 9000, expense: 0, hours: 0 }],
  letters: [ { ...letter("one", "one", "a", "2026-10-01"), featured: true }, letter("two", "two", "b", "2026-10-01"), letter("three", "three", "c", "2026-10-02"), letter("old", "one", "a", "2026-09-18") ] };
for (let i = 0; i < 65; i++) fixture.letters.push(letter("archived-" + i, "one", "a", "2026-09-17"));
fs.writeFileSync(storeFile, JSON.stringify(fixture));
let child, base, logs = "", passed = 0;
const failures = [], tokens = {};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function start() {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [SERVER], { cwd: ROOT, env: { ...process.env, HOST: "127.0.0.1", DATA_DIR: temp, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", data => { logs += data; });
  child.stderr.on("data", data => { logs += data; });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`Server exited early (${child.exitCode}): ${logs}`);
    try { const response = await fetch(`${base}/api/groups-public`); if (response.ok) return; } catch (_) {}
    await sleep(50);
  }
  throw new Error(`Server did not start: ${logs}`);
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const current = child;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { current.kill("SIGKILL"); reject(new Error("Server did not stop")); }, 5000);
    current.once("exit", () => { clearTimeout(timer); resolve(); });
    current.kill("SIGTERM");
  });
}
async function request(route, who, body, expected = 200) {
  const response = await fetch(base + route, { method: body === undefined ? "GET" : "POST", headers: { ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch (_) { data = text; }
  assert.equal(response.status, expected, `${who || "anonymous"} ${route}: ${response.status} ${text.slice(0, 350)}`);
  return data;
}
async function login(id) { const result = await request("/api/login", null, { name: `测试-${id}`, code: "test8888" }); assert.ok(result.token); tokens[id] = result.token; return result; }
async function test(name, fn) {
  try { await fn(); passed++; process.stdout.write(`PASS ${name}\n`); }
  catch (error) { failures.push({ name, error }); process.stderr.write(`FAIL ${name}: ${error.message}\n`); }
}
const consoleFor = (who, groupId = "") => request(`/api/console?month=2026-10${groupId ? `&group=${groupId}` : ""}`, who);
const permissions = data => data.permissions || data.consolePermissions;
const ids = items => items.map(x => x.id).sort();
const scopeIds = data => ids(data.scopeGroups);
const letters = data => Array.isArray(data) ? data : data.list || data.letters;

async function main() {
  await start();
  for (const m of fixture.members.filter(m => m.active)) await login(m.id);
  await test("schema8 upgrades with backup, preserving legacy scores, letters and appointments", async () => {
    await stop();
    const saved = JSON.parse(fs.readFileSync(storeFile));
    assert.equal(saved.schemaV2, 9);
    assert.deepEqual(saved.letters, fixture.letters);
    assert.deepEqual(saved.records, fixture.records);
    assert.deepEqual(saved.classOfficers, fixture.classOfficers);
    assert.equal(saved.guideSeen.director, undefined);
    assert.equal(JSON.parse(fs.readFileSync(storeFile + ".pre-honors-v9.bak")).schemaV2, 8);
    await start();
    assert.equal((await request("/api/bootstrap", "one")).guideSeen, false);
  });
  await test("guide dismissal persists per account, is idempotent and never checks in", async () => {
    const before = (await request("/api/bootstrap", "one")).myToday;
    const first = await request("/api/guide/seen", "one", {});
    assert.deepEqual(await request("/api/guide/seen", "one", {}), first);
    assert.equal((await request("/api/bootstrap", "one")).guideSeen, true);
    assert.equal((await request("/api/bootstrap", "two")).guideSeen, false);
    assert.deepEqual((await request("/api/bootstrap", "one")).myToday, before);
  });
  await test("monthly rankings use unique home groups, task income, net benefit and competitive ties", async () => {
    const r = await request("/api/monthly-rankings?month=2026-10", "counselor");
    assert.equal(r.people.length, 4);
    assert.deepEqual(r.people.map(p => p.rank), [1, 1, 1, 4]);
    assert.equal(r.people.find(p => p.id === "one").expense, 200);
    assert.equal(r.people.find(p => p.id === "counselor").groupId, "a");
    assert.equal(r.groups.length, 3);
    assert.equal(r.groups.find(g => g.id === "a").count, 2);
    assert.equal(r.groups.find(g => g.id === "a").totalBenefit, 1600);
    assert.deepEqual(r.groups.map(g => g.rank), [1, 1, 3]);
    assert.equal(r.myRank, 1); assert.equal(r.myGroupRank, 1);
    await request("/api/monthly-rankings?month=2026-13", "one", undefined, 400);
    await request("/api/monthly-rankings", null, undefined, 401);
  });
  await test("only strict current director and appointed committee have award permissions", async () => {
    for (const id of ["vice", "monitor", "study", "legacy_study", "one"]) {
      await request("/api/letter-honors/class", id, { date: "2026-10-01", letterId: "one", publishToClass: true }, 403);
    }
    for (const id of ["director", "vice", "monitor", "legacy_study", "one"]) {
      await request("/api/letter-honors/school", id, { date: "2026-10-01", letterId: "one", noticeConfirmed: true }, 403);
    }
    const admin = await request("/api/letter-honors?date=2026-10-01", "director");
    assert.equal(admin.canSelectClass, true); assert.equal(admin.candidates.length, 2);
    assert.equal(admin.candidates[0].content, "合成正文-one");
    assert.deepEqual(admin.candidates[0].comments, []);
    assert.deepEqual((await request("/api/letter-honors?date=2026-10-01", "one")).candidates, []);
    assert.equal((await request("/api/letter-honors", "study")).canRegisterSchool, true);
  });
  await test("daily class selection requires public confirmation, workdays and matching letter date; no points", async () => {
    const before = await request("/api/monthly-rankings?month=2026-10", "one");
    await request("/api/letter-honors/class", "director", { date: "2026-10-03", skip: true }, 400);
    await request("/api/letter-honors/class", "director", { date: "2026-10-01", letterId: "three", publishToClass: true }, 400);
    await request("/api/letter-honors/class", "director", { date: "2026-10-01", letterId: "one" }, 400);
    await request("/api/letter-honors/class", "director", { date: "2026-10-01", letterId: "one", publishToClass: true });
    await request("/api/letter-honors/class", "director", { date: "2026-10-01", letterId: "one", publishToClass: true });
    const after = await request("/api/monthly-rankings?month=2026-10", "one");
    assert.deepEqual(after.people, before.people);
    const library = await request("/api/letter-library", "two");
    assert.equal(library.total, 1); assert.equal(library.list[0].classHonor, true);
    assert.equal(library.list[0].schoolHonor, false); assert.deepEqual(library.list[0].comments, []);
    assert.deepEqual(library.list[0].images, ["/uploads/synthetic.jpg"]);
  });
  await test("school requires nomination and official notice, awards only 500 on independent selection date", async () => {
    await request("/api/letter-honors/school", "study", { date: "2026-10-02", letterId: "one", noticeConfirmed: true }, 400);
    await request("/api/letter-honors/nominate", "director", { letterId: "two", nominated: true }, 400);
    await request("/api/letter-honors/nominate", "director", { letterId: "one", nominated: true });
    await request("/api/letter-honors/school", "study", { date: "2026-10-02", letterId: "one" }, 400);
    await request("/api/letter-honors/school", "study", { date: "2026-10-03", letterId: "one", noticeConfirmed: true }, 400);
    await request("/api/letter-honors/school", "study", { date: "2026-09-30", letterId: "one", noticeConfirmed: true }, 400);
    const before = (await request("/api/monthly-rankings?month=2026-10", "one")).people.find(p => p.id === "one").benefit;
    await request("/api/letter-honors/school", "study", { date: "2026-10-02", letterId: "one", noticeConfirmed: true });
    await request("/api/letter-honors/school", "study", { date: "2026-10-02", letterId: "one", noticeConfirmed: true });
    await request("/api/letter-honors/school", "study", { date: "2026-10-05", letterId: "one", noticeConfirmed: true }, 409);
    assert.equal((await request("/api/monthly-rankings?month=2026-10", "one")).people.find(p => p.id === "one").benefit, before + 500);
    const l = (await request("/api/letter-library?kind=school&month=2026-10", "three")).list[0];
    assert.equal(l.schoolHonorDate, "2026-10-02"); assert.equal(l.classHonorDate, "2026-10-01");
    await stop();
    const stored = JSON.parse(fs.readFileSync(storeFile));
    assert.equal(stored.records["2026-10-02"].one.customs.filter(c => c.amount === 500).length, 1);
    assert.match(stored.records["2026-10-02"].one.customs[0].id, /^school-honor:/);
    await start();
    assert.equal((await request("/api/bootstrap", "one")).guideSeen, true);
    assert.equal((await request("/api/letter-honors?date=2026-10-02", "study")).schoolAward.id, "one");
  });
  await test("school prerequisites block class revocation, replacement and nomination removal", async () => {
    for (const b of [{ revoke: true }, { skip: true }, { letterId: "two", publishToClass: true }]) await request("/api/letter-honors/class", "director", { date: "2026-10-01", ...b }, 409);
    await request("/api/letter-honors/nominate", "director", { letterId: "one", nominated: false }, 409);
    await request("/api/letter-honors/class", "director", { date: "2026-10-02", letterId: "three", publishToClass: true });
    await request("/api/letter-honors/nominate", "director", { letterId: "three", nominated: true });
    await request("/api/letter-honors/school", "study", { date: "2026-10-02", letterId: "three", noticeConfirmed: true }, 409);
  });
  await test("precise idempotent school withdrawal preserves legacy +500 and class honor", async () => {
    await request("/api/letter-honors/school", "study", { date: "2026-10-02", letterId: "two", revoke: true }, 409);
    await request("/api/letter-honors/school", "study", { date: "2026-10-02", letterId: "one", revoke: true });
    await request("/api/letter-honors/school", "study", { date: "2026-10-02", letterId: "one", revoke: true });
    assert.equal((await request("/api/monthly-rankings?month=2026-10", "one")).people.find(p => p.id === "one").benefit, 800);
    const l = (await request("/api/letter-library", "two")).list.find(l => l.id === "one");
    assert.equal(l.classHonor, true); assert.equal(l.schoolHonor, false); assert.equal(l.featured, true);
  });
  await test("replacement clears nomination and skip is distinct from unselected", async () => {
    await request("/api/letter-honors/class", "director", { date: "2026-10-01", letterId: "two", publishToClass: true });
    assert.equal((await request("/api/letter-honors?date=2026-10-01", "study")).nominees.some(l => l.id === "one"), false);
    await request("/api/letter-honors/class", "director", { date: "2026-10-01", skip: true });
    assert.equal((await request("/api/letter-honors?date=2026-10-01", "one")).decision.status, "skipped");
    await request("/api/letter-honors/class", "director", { date: "2026-10-01", revoke: true });
    assert.equal((await request("/api/letter-honors?date=2026-10-01", "one")).decision, null);
  });
  await test("private commentary and legacy write endpoints remain protected", async () => {
    await request("/api/letter/comment", "three", { letterId: "three", text: "本人不点评" }, 400);
    await request("/api/letter/comment", "two", { letterId: "three", text: "跨组不点评" }, 403);
    await request("/api/letter/comment", "counselor", { letterId: "old", text: "历史不点评" }, 403);
    await request("/api/letter/reply", "two", { letterId: "one", commentId: "private", text: "跨组不回复" }, 403);
    await request("/api/letter/comment", "one", { letterId: "old", text: "本人不点评" }, 400);
    for (const action of ["feature", "unfeature"]) await request("/api/admin/letter/" + action, "director", { letterId: "one" }, 410);
    const r = await request("/api/letter-library?kind=all&search=three", "one");
    assert.equal(r.total, 1); assert.deepEqual(r.list[0].comments, []);
    await request("/api/letter-library?limit=1000", "one", undefined, 400);
  });
  await test("library is independent of 60-letter daily feed and supports pagination without private leakage", async () => {
    await stop();
    const stored = JSON.parse(fs.readFileSync(storeFile));
    // Synthetic archived awards model historical workday selections; no real data involved.
    const days = Array.from({ length: 180 }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)).filter(d => ![0, 6].includes(new Date(d).getUTCDay())).slice(0, 65);
    for (let i = 0; i < 65; i++) {
      const l = stored.letters.find(l => l.id === "archived-" + i); l.publishToClass = true;
      stored.letterHonors.classDecisions[days[i]] = { date: days[i], status: "selected", letterId: l.id };
    }
    fs.writeFileSync(storeFile, JSON.stringify(stored)); await start();
    const first = await request("/api/letter-library?offset=0&limit=30", "two"), third = await request("/api/letter-library?offset=60&limit=30", "two");
    assert.equal(first.total, 66); assert.equal(first.list.length, 30); assert.equal(first.hasMore, true);
    assert.equal(third.list.length, 6); assert.equal(third.hasMore, false);
    assert.ok(third.list.every(l => l.comments.length === 0));
    const own = await request("/api/letters", "one");
    assert.equal(own.list.find(l => l.id === "one").classHonor, false);
  });
  await stop();
  process.stdout.write(`\n${passed} passed; ${failures.length} failed\n`);
  if (failures.length) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await stop(); fs.rmSync(temp, { recursive: true, force: true }); });
