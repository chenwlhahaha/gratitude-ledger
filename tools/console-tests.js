#!/usr/bin/env node
"use strict";

// Safe, synthetic integration tests. Never reads or rewrites the project's data/.
// Run: node tools/console-tests.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const SERVER = path.join(ROOT, "server.js");
assert.match(fs.readFileSync(SERVER, "utf8"), /process\.env\.DATA_DIR/, "Server must support isolated DATA_DIR before these tests may run");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "gratitude-console-test-"));
const storeFile = path.join(temp, "store.json");
const targets = { income: 10000, expense: 4000, benefit: 6000, hours: 55 };
const member = (id, groupId, role = "member", title = "") => ({ id, name: `测试-${id}`, groupId, role, title, active: true, code: "test8888", targets: { ...targets } });
const group = (id, leaderId, fudaoId = "") => ({ id, name: `测试组-${id}`, leaderId, fudaoId, xueweiId: "", letterDeadline: "21:00", letterCycleStart: "2026-09-20", letterOrder: [], letterPlan: [] });
const fixture = {
  schemaV2: 7, className: "合成测试班",
  groups: [group("g_a", "leader", "counselor"), group("g_b", "leader_b"), group("g_fudao", "")],
  members: [member("director", null, "classAdmin", "班主任"), member("monitor", "g_a", "monitor", "班长"),
    member("legacy_study", null, "classAdmin", "大学委"), member("leader", "g_a", "leader"),
    { ...member("counselor", "g_a"), taskGroupId: "g_fudao" }, member("leader_b", "g_b", "leader"),
    member("a", "g_a"), member("b", "g_b"), member("discipline", "g_a"), member("care", "g_b"), member("activity", "g_a")],
  activities: [{ id: "read", name: "读书", income: 500, expense: 200, hours: 0.5, freq: "daily" },
    { id: "review", name: "点评", income: 500, expense: 200, hours: 0.5, freq: "daily", auto: true }],
  specials: [{ key: "share_class", name: "分享", income: 2000, expense: 1000, hours: 2, fixed: true }],
  records: { "2026-10-01": { a: { items: { read: true }, customs: [] }, b: { items: { read: true }, customs: [] } } },
  approvals: [{ id: "approval_a", memberId: "a", memberName: "测试-a", groupId: "g_a", date: "2026-10-01", key: "share_class", status: "pending", income: 2000, expense: 1000, hours: 2 }],
  tokens: {},
  letters: [
    { id: "old_a", groupId: "g_a", authorId: "a", authorName: "测试-a", date: "2026-09-18", content: "历史私密家书", images: [], comments: [] },
    { id: "old_leader", groupId: "g_a", authorId: "leader", authorName: "测试-leader", date: "2026-09-18", content: "组长自己的历史家书", images: [], comments: [] },
    { id: "new_a", groupId: "g_a", authorId: "a", authorName: "测试-a", date: "2026-10-01", content: "A组新家书", images: [], comments: [] },
    { id: "new_b", groupId: "g_b", authorId: "b", authorName: "测试-b", date: "2026-10-01", content: "B组新家书", images: [], comments: [] },
  ],
};
fixture.groups[2].letterDeadline = "22:15";
fixture.groups[2].name = "辅导员组";
fixture.groups[0].letterCycleStart = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
fs.writeFileSync(storeFile, JSON.stringify(fixture));
let child, base, logs = "", passed = 0;
const failures = [];
const tokens = {};
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

async function oldCounselorMigration(hasCounselorGroup) {
  await stop();
  const legacy = JSON.parse(JSON.stringify(fixture));
  legacy.members.find(m => m.id === "counselor").taskGroupId = null;
  legacy.groups.find(g => g.id === "g_a").letterPlan = [{ memberId: "counselor", day: 0 }, { memberId: "a", day: 1 }];
  if (!hasCounselorGroup) legacy.groups = legacy.groups.filter(g => g.id !== "g_fudao");
  legacy.records["2026-09-15"] = { counselor: { items: { read: true }, customs: [{ id: "old_adjustment", amount: 123, label: "历史调整" }] } };
  legacy.letters.push({ id: "old_counselor", groupId: "g_a", authorId: "counselor", authorName: "测试-counselor", date: "2026-09-15", content: "迁移前的辅导员家书", images: [], comments: [] });
  fs.writeFileSync(storeFile, JSON.stringify(legacy));
  try {
    await start();
    await stop();
    const migrated = JSON.parse(fs.readFileSync(storeFile, "utf8"));
    const counselorGroups = migrated.groups.filter(g => g.name === "辅导员组");
    assert.equal(counselorGroups.length, 1);
    const destination = counselorGroups[0];
    if (hasCounselorGroup) assert.equal(destination.id, "g_fudao", "Existing counselor task group must be reused");
    assert.equal(migrated.members.find(m => m.id === "counselor").taskGroupId, destination.id);
    assert.equal(migrated.members.find(m => m.id === "counselor").groupId, "g_a", "Home group must be retained");
    assert.deepEqual(migrated.groups.find(g => g.id === "g_a").letterPlan, [{ memberId: "a", day: 1 }]);
    assert.equal(destination.letterPlan.filter(p => p.memberId === "counselor").length, 1);
    assert.deepEqual(migrated.records, legacy.records);
    assert.deepEqual(migrated.letters, legacy.letters);
    await start();
    await stop();
    assert.deepEqual(JSON.parse(fs.readFileSync(storeFile, "utf8")), migrated, "Restart must not duplicate the counselor group or restore former schedules");
  } finally { await stop(); }
}

async function counselorGroupManagement() {
  // Use a fresh synthetic store so appointment/account mutations cannot affect
  // the earlier learning-credit regressions or the later migration fixtures.
  await stop();
  const local = JSON.parse(JSON.stringify(fixture));
  local.groups.push(group("g_archive", ""));
  local.members.push(
    { ...member("task_only", "g_a"), taskGroupId: "g_fudao" },
    { ...member("both_memberships", "g_fudao"), taskGroupId: "g_fudao" },
    { ...member("task_study", "g_a"), taskGroupId: "g_fudao" },
    { ...member("task_officer", "g_a"), taskGroupId: "g_fudao" },
    { ...member("archived", "g_archive"), active: false },
  );
  local.members.find(m => m.id === "monitor").taskGroupId = "g_fudao";
  local.members.find(m => m.id === "director").taskGroupId = "g_fudao";
  local.classOfficers = { xuewei: "task_study", jiwei: "", guanai: "", huodong: "" };
  local.groups.find(g => g.id === "g_b").jiweiId = "task_officer";
  fs.writeFileSync(storeFile, JSON.stringify(local));
  await start();
  for (const id of ["director", "monitor", "leader", "counselor", "task_only"]) await login(id);
  let createdMemberId;

  await test("public counselor entry reuses accounts, merges home and task membership once, and hides empty historical groups", async () => {
    const data = await request("/api/groups-public");
    const home = data.groups.find(g => g.id === "g_a");
    const counselors = data.groups.find(g => g.id === "g_fudao");
    assert.ok(home && counselors, "Both existing home group and counselor task group must remain login entries");
    assert.ok(!data.groups.some(g => g.id === "g_archive"));
    for (const id of ["counselor", "task_only"]) {
      assert.equal(home.members.filter(m => m.id === id).length, 1);
      assert.equal(counselors.members.filter(m => m.id === id).length, 1);
      const account = await request("/api/pick-login", null, { memberId: id, code: "test8888" });
      assert.equal(account.member.id, id, "Login from the new entry must preserve the existing account ID");
      assert.equal(account.member.groupId, "g_a");
      assert.equal(account.member.taskGroupId, "g_fudao");
    }
    assert.equal(counselors.members.filter(m => m.id === "both_memberships").length, 1);
    assert.ok(!JSON.stringify(data).includes('"code"'), "Public entry must not expose login codes");
  });

  await test("task-group member can lead counselor group and create an ordinary member without forged privileges", async () => {
    await request("/api/admin/group/officer", "monitor", { groupId: "g_fudao", position: "leader", memberId: "counselor" });
    const view = await consoleFor("counselor", "g_fudao");
    assert.ok(view.scopeGroups.some(g => g.id === "g_fudao" && g.canManage && g.canSchedule));
    assert.ok(view.members.some(m => m.id === "task_only"));
    await request("/api/leader/member", "counselor", {
      groupId: "g_fudao", name: "测试-辅导员组新增", code: "initial123", target: 12000,
      role: "classAdmin", title: "班主任", taskGroupId: "g_b", id: "forged_admin",
    });
    const entries = (await request("/api/groups-public")).groups;
    const matches = entries.flatMap(g => g.members.filter(m => m.name === "测试-辅导员组新增").map(m => ({ ...m, entryGroupId: g.id })));
    assert.equal(matches.length, 1);
    assert.equal(matches[0].entryGroupId, "g_fudao");
    assert.equal(matches[0].role, "member");
    assert.notEqual(matches[0].id, "forged_admin");
    const result = await request("/api/pick-login", null, { memberId: matches[0].id, code: "initial123" });
    tokens.new_counselor_member = result.token;
    createdMemberId = result.member.id;
    assert.equal(result.member.groupId, "g_fudao");
    assert.equal(result.member.taskGroupId, null);
    assert.equal(result.member.role, "member");
    assert.equal(result.member.title, "");
    assert.equal((await request("/api/bootstrap", "new_counselor_member")).consoleAccess, false);
    await request("/api/admin/group/officer", "counselor", { groupId: "g_fudao", position: "leader", memberId: result.member.id }, 403);
  });

  await test("counselor group leader can reset, disable, and restore ordinary accounts without reviving old sessions", async () => {
    const memberId = createdMemberId;
    await request("/api/leader/member/resetcode", "counselor", { groupId: "g_fudao", memberId, code: "replacement456" });
    await request("/api/pick-login", null, { memberId, code: "initial123" }, 401);
    await request("/api/bootstrap", "new_counselor_member", undefined, 401);
    const resetLogin = await request("/api/pick-login", null, { memberId, code: "replacement456" });
    tokens.new_counselor_member = resetLogin.token;
    const disabled = await request("/api/leader/member/toggle", "counselor", { groupId: "g_fudao", memberId });
    assert.equal(disabled.active, false);
    await request("/api/bootstrap", "new_counselor_member", undefined, 401);
    await request("/api/pick-login", null, { memberId, code: "replacement456" }, 401);
    assert.ok(!(await request("/api/groups-public")).groups.flatMap(g => g.members).some(m => m.id === memberId));
    const restored = await request("/api/leader/member/toggle", "counselor", { groupId: "g_fudao", memberId });
    assert.equal(restored.active, true);
    await request("/api/bootstrap", "new_counselor_member", undefined, 401);
    const restoredLogin = await request("/api/pick-login", null, { memberId, code: "replacement456" });
    tokens.new_counselor_member = restoredLogin.token;
    assert.equal(restoredLogin.member.id, memberId);
    assert.equal((await request("/api/groups-public")).groups.flatMap(g => g.members).filter(m => m.id === memberId).length, 1);
  });

  await test("scoped account management rejects self, administrators, committees, other-group officers, and cross-group targets", async () => {
    for (const suffix of ["toggle", "resetcode"]) {
      for (const memberId of ["counselor", "director", "monitor", "task_study", "task_officer", "b"]) {
        await request(`/api/leader/member/${suffix}`, "counselor", { groupId: "g_fudao", memberId, code: "forged999" }, 403);
      }
      await request(`/api/leader/member/${suffix}`, "counselor", { groupId: "g_b", memberId: "b", code: "forged999" }, 403);
      await request(`/api/leader/member/${suffix}`, "task_only", { groupId: "g_fudao", memberId: createdMemberId, code: "forged999" }, 403);
      await request(`/api/leader/member/${suffix}`, "counselor", { groupId: "g_a", memberId: "task_only", code: "forged999" }, 403);
    }
    await request("/api/leader/member", "counselor", { groupId: "g_b", name: "测试-越组", code: "forged999" }, 403);
    // Existing full-admin endpoints retain their authority over committee accounts.
    await request("/api/admin/member/resetcode", "director", { memberId: "task_officer", code: "admin_reset" });
    assert.equal((await request("/api/admin/member/toggle", "monitor", { memberId: "task_officer" })).active, false);
    assert.equal((await request("/api/admin/member/toggle", "monitor", { memberId: "task_officer" })).active, true);
  });

  await test("ordinary group leaders and counselors share scoped member management while respecting separate task groups", async () => {
    await request("/api/leader/member/resetcode", "leader", { groupId: "g_a", memberId: "a", code: "group_reset" });
    assert.equal((await request("/api/pick-login", null, { memberId: "a", code: "group_reset" })).member.id, "a");
    assert.equal((await request("/api/leader/member/toggle", "leader", { groupId: "g_a", memberId: "a" })).active, false);
    assert.equal((await request("/api/leader/member/toggle", "counselor", { groupId: "g_a", memberId: "a" })).active, true);
    for (const suffix of ["toggle", "resetcode"]) {
      await request(`/api/leader/member/${suffix}`, "leader", { groupId: "g_a", memberId: "task_only", code: "forged999" }, 403);
    }
    await request("/api/leader/member/resetcode", "counselor", { groupId: "g_fudao", memberId: "task_only", code: "task_reset" });
    const loginTaskMember = await request("/api/pick-login", null, { memberId: "task_only", code: "task_reset" });
    assert.equal(loginTaskMember.member.groupId, "g_a");
    assert.equal(loginTaskMember.member.taskGroupId, "g_fudao");
  });

  await test("removing counselor-group leader immediately revokes that group's member management", async () => {
    await request("/api/admin/group/officer", "director", { groupId: "g_fudao", position: "leader", memberId: "" });
    for (const suffix of ["toggle", "resetcode"]) {
      await request(`/api/leader/member/${suffix}`, "counselor", { groupId: "g_fudao", memberId: createdMemberId, code: "after_removal" }, 403);
    }
    await request("/api/leader/member", "counselor", { groupId: "g_fudao", name: "测试-撤职后新增", code: "forged999" }, 403);
    await request("/api/console?month=2026-10&group=g_fudao", "counselor", undefined, 403);
    assert.ok((await consoleFor("counselor")).scopeGroups.some(g => g.id === "g_a" && g.canManage), "An independent counselor appointment must remain valid");
  });
}

async function main() {
  await start();
  for (const item of fixture.members) await login(item.id);

  await test("schema7 migration preserves synthetic data and restart is idempotent", async () => {
    await stop();
    const first = JSON.parse(fs.readFileSync(storeFile, "utf8"));
    assert.equal(first.schemaV2, 9);
    assert.equal(first.classOfficers.xuewei, "legacy_study");
    assert.equal(first.members.find(m => m.id === "legacy_study").role, "member");
    assert.equal(first.members.find(m => m.id === "counselor").taskGroupId, "g_fudao");
    assert.equal(first.members.length, fixture.members.length);
    assert.deepEqual(first.records, fixture.records);
    assert.deepEqual(first.letters, fixture.letters);
    await start();
    await stop();
    assert.deepEqual(JSON.parse(fs.readFileSync(storeFile, "utf8")), first);
    await start();
    await request("/api/bootstrap", "monitor"); // persisted token survives restart
  });

  await test("monitor and director have identical full permissions", async () => {
    const a = await consoleFor("monitor"), b = await consoleFor("director");
    assert.equal(permissions(a).fullAdmin, true);
    assert.deepEqual(permissions(a), permissions(b));
    assert.deepEqual(scopeIds(a), ["g_a", "g_b", "g_fudao"]);
    assert.equal(a.members.length, fixture.members.length);
    assert.ok(a.pending.some(item => item.id === "approval_a"));
    assert.ok(a.officerPositions);
    for (const m of a.members) assert.ok(!Object.hasOwn(m, "code"), "Credentials must not appear in console data");
  });

  await test("group leader and counselor have identical group authority", async () => {
    const a = await consoleFor("leader"), b = await consoleFor("counselor");
    assert.deepEqual(permissions(a), permissions(b));
    assert.deepEqual(scopeIds(a), ["g_a"]);
    assert.deepEqual(scopeIds(b), ["g_a"]);
    assert.equal(permissions(a).fullAdmin, false);
    assert.ok(a.scopeGroups[0].canManage && a.scopeGroups[0].canSchedule);
    assert.ok(!a.members.some(m => m.id === "b"));
    const boot = await request("/api/bootstrap", "counselor");
    assert.equal(boot.consoleAccess, true);
    assert.equal(boot.member.taskGroupId, "g_fudao");
    assert.ok(boot.managedGroups.some(g => g.id === "g_a"));
  });

  await test("ordinary member cannot enter console or operate management endpoints", async () => {
    assert.equal((await request("/api/bootstrap", "a")).consoleAccess, false);
    await request("/api/console", "a", undefined, 403);
    await request("/api/leader/member", "a", { groupId: "g_a", name: "越权", code: "secret" }, 403);
    await request("/api/console/export?month=2026-10", "a", undefined, 403);
  });

  await test("legacy study officer can study and schedule every group without admin authority", async () => {
    const view = await consoleFor("legacy_study");
    assert.equal(permissions(view).fullAdmin, false);
    assert.deepEqual(scopeIds(view), ["g_a", "g_b", "g_fudao"]);
    assert.ok(view.scopeGroups.every(g => g.canStudy && g.canSchedule && !g.canManage));
    await request("/api/leader/letter-config?group=g_b", "legacy_study");
    await request("/api/admin/class", "legacy_study", undefined, 403);
    await request("/api/admin/approvals", "legacy_study", undefined, 403);
    await request("/api/admin/group/officer", "legacy_study", { groupId: "g_a", position: "leader", memberId: "a" }, 403);
  });

  await test("monitor and director can appoint every class and group committee", async () => {
    await request("/api/admin/group/officer", "monitor", { groupId: "g_a", position: "fudao", memberId: "director" }, 400);
    for (const [position, id] of [["jiwei", "discipline"], ["guanai", "care"], ["huodong", "activity"]]) {
      await request("/api/admin/class/officer", "monitor", { position, memberId: id });
      await request("/api/admin/group/officer", "director", { groupId: id === "care" ? "g_b" : "g_a", position, memberId: id });
    }
    const view = await consoleFor("director");
    for (const [position, id] of [["jiwei", "discipline"], ["guanai", "care"], ["huodong", "activity"]]) {
      const value = Array.isArray(view.classOfficers) ? view.classOfficers.find(item => item.position === position) : view.classOfficers[position];
      assert.equal(typeof value === "string" ? value : value?.id || value?.memberId, id);
    }
  });

  await test("non-study committee officers receive organization only without study or financial data", async () => {
    for (const who of ["discipline", "care", "activity"]) {
      const view = await consoleFor(who);
      assert.equal(permissions(view).fullAdmin, false);
      assert.equal(permissions(view).organization, true);
      assert.equal(permissions(view).overview, false);
      assert.equal(permissions(view).reports, false);
      assert.equal(view.groups.length, 0);
      assert.ok(view.scopeGroups.every(g => !g.canStudy && !g.canManage && !g.canSchedule));
      const { member: ownAccount, ...organizationData } = view;
      assert.ok(!JSON.stringify(organizationData).includes('"income"'), "Organization response must not leak other members' financial values");
      await request("/api/console/member?memberId=b&month=2026-10", who, undefined, 403);
      await request("/api/console/export?month=2026-10", who, undefined, 403);
      await request("/api/leader/letter-config?group=g_a", who, undefined, 403);
    }
  });

  await test("cross-group query and forged member mutations are forbidden", async () => {
    await request("/api/console?month=2026-10&group=g_b", "leader", undefined, 403);
    await request("/api/console/member?memberId=b&month=2026-10", "leader", undefined, 403);
    await request("/api/leader/letter-config?group=g_b", "leader", undefined, 403);
    await request("/api/leader/letter-config", "leader", { groupId: "g_b", deadline: "20:00" }, 403);
    await request("/api/leader/member", "leader", { groupId: "g_b", name: "伪造跨组", code: "secret" }, 403);
    await request("/api/leader/adjust", "leader", { groupId: "g_a", memberId: "b", date: "2026-10-02", amount: 100 }, 403);
    await request("/api/leader/adjust", "leader", { groupId: "g_b", memberId: "b", date: "2026-10-02", amount: 100 }, 403);
    await request("/api/console/member?memberId=a&month=2026-10", "leader");
    await request("/api/admin/class/officer", "leader", { position: "jiwei", memberId: "a" }, 403);
    await request("/api/admin/group/officer", "counselor", { groupId: "g_a", position: "leader", memberId: "a" }, 403);
  });

  await test("console letters respect management scope and historical author privacy", async () => {
    const list = letters(await request("/api/console/letters?group=g_a", "leader"));
    assert.ok(Array.isArray(list));
    assert.ok(list.some(l => l.id === "new_a"));
    assert.ok(list.some(l => l.id === "old_leader"));
    assert.ok(!list.some(l => ["old_a", "new_b"].includes(l.id)));
    await request("/api/console/letters?group=g_b", "leader", undefined, 403);
    const admin = letters(await request("/api/console/letters?group=g_a", "director"));
    assert.ok(!admin.some(l => l.id === "old_a"), "Full management permission must retain historical author privacy");
  });

  await test("query-token CSV export enforces the same scope", async () => {
    const csv = await request(`/api/console/export?month=2026-10&group=g_a&token=${tokens.leader}`);
    assert.equal(typeof csv, "string");
    assert.ok(csv.includes("测试-a"));
    assert.ok(!csv.includes("测试-b"));
    await request(`/api/console/export?month=2026-10&group=g_b&token=${tokens.leader}`, null, undefined, 403);
  });

  await test("invalid month and impossible dates return 400", async () => {
    for (const month of ["bad", "2026-13", "2026-00", "2026-1"]) {
      await request(`/api/console?month=${month}`, "monitor", undefined, 400);
      await request(`/api/console/export?month=${month}`, "monitor", undefined, 400);
      await request(`/api/console/member?memberId=a&month=${month}`, "monitor", undefined, 400);
    }
    await request("/api/leader/adjust", "leader", { groupId: "g_a", memberId: "a", date: "2026-02-30", amount: 100 }, 400);
    await request("/api/console?month=2026-10&date=2026-02-30", "monitor", undefined, 400);
    await request("/api/leader/letter-config", "leader", { groupId: "g_a", deadline: "29:90" }, 400);
  });

  await test("read check-in is idempotent and its financial effect matches personal and console views", async () => {
    const boot = await request("/api/bootstrap", "a");
    const month = boot.today.slice(0, 7);
    await request("/api/checkin", "a", { actId: "read", on: false });
    const before = (await request(`/api/my?month=${month}`, "a")).totals;
    await request("/api/checkin", "a", { actId: "read", on: true });
    const after = (await request(`/api/my?month=${month}`, "a")).totals;
    assert.equal(after.income - before.income, 500);
    assert.equal(after.expense - before.expense, 200);
    assert.equal(after.benefit - before.benefit, 300);
    assert.equal(after.hours - before.hours, 0.5);
    await request("/api/checkin", "a", { actId: "read", on: true });
    assert.deepEqual((await request(`/api/my?month=${month}`, "a")).totals, after);
    const view = await request(`/api/console?month=${month}&group=g_a`, "monitor");
    const row = view.groups[0].members.find(m => m.id === "a");
    for (const key of ["income", "expense", "benefit", "hours"]) assert.equal(row[key], after[key]);
    await request("/api/checkin", "a", { actId: "read", on: false });
    assert.deepEqual((await request(`/api/my?month=${month}`, "a")).totals, before);
  });

  await test("new letter publication, review credit, duplicate prevention, and author reply still work", async () => {
    await request("/api/leader/letter-config", "leader", { groupId: "g_a", deadline: "23:59", plan: [{ memberId: "leader", day: 0 }] });
    const boot = await request("/api/bootstrap", "a");
    const month = boot.today.slice(0, 7);
    const content = "集成回归专用家书：今天学习到了认真倾听。";
    await request("/api/letter/submit", "leader", { content });
    await request("/api/letter/submit", "leader", { content }, 400);
    const letter = letters(await request("/api/letters", "a")).find(item => item.content === content);
    assert.ok(letter && letter.authorId === "leader" && letter.groupId === "g_a");
    const before = (await request(`/api/my?month=${month}`, "a")).totals;
    await request("/api/letter/comment", "b", { letterId: letter.id, text: "跨组不可点评" }, 403);
    await request("/api/letter/comment", "leader", { letterId: letter.id, text: "作者不可自评" }, 400);
    await request("/api/letter/comment", "a", { letterId: letter.id, text: "感谢分享，我会把倾听用到今天的沟通中。" });
    await request("/api/letter/comment", "a", { letterId: letter.id, text: "重复点评" }, 400);
    const after = (await request(`/api/my?month=${month}`, "a")).totals;
    assert.equal(after.income - before.income, 500);
    assert.equal(after.expense - before.expense, 200);
    assert.equal(after.hours - before.hours, 0.5);
    assert.equal((await request("/api/bootstrap", "a")).myReviewDone, true);
    const reviewed = letters(await request("/api/letters", "leader")).find(item => item.id === letter.id);
    assert.equal(reviewed.comments.length, 1);
    const commentId = reviewed.comments[0].id;
    await request("/api/letter/reply", "a", { letterId: letter.id, commentId, text: "越权回复" }, 403);
    await request("/api/letter/reply", "leader", { letterId: letter.id, commentId, text: "感谢你的认真点评。" });
    const replied = letters(await request("/api/console/letters?group=g_a", "monitor")).find(item => item.id === letter.id);
    assert.ok(JSON.stringify(replied.comments[0].reply).includes("感谢你的认真点评"));
  });

  await test("approval decisions change study totals once and CSV reports the same real amounts", async () => {
    const month = (await request("/api/bootstrap", "a")).today.slice(0, 7);
    const before = (await request(`/api/my?month=${month}`, "a")).totals;
    await request("/api/special", "a", { key: "share_class", note: "集成回归待批申请" });
    const pending = await request("/api/admin/approvals?status=pending", "monitor");
    const approval = pending.find(item => item.note === "集成回归待批申请");
    assert.ok(approval);
    await request("/api/admin/approval/decide", "leader", { id: approval.id, ok: true }, 403);
    await request("/api/admin/approval/decide", "director", { id: approval.id, ok: true });
    await request("/api/admin/approval/decide", "monitor", { id: approval.id, ok: true }, 400);
    const after = (await request(`/api/my?month=${month}`, "a")).totals;
    assert.equal(after.income - before.income, 2000);
    assert.equal(after.expense - before.expense, 1000);
    assert.equal(after.benefit - before.benefit, 1000);
    assert.equal(after.hours - before.hours, 2);
    const csv = await request(`/api/console/export?month=${month}&group=g_a`, "monitor");
    const csvRow = csv.split(/\r?\n/).find(row => row.startsWith("测试-a,")).split(",");
    assert.deepEqual(csvRow.slice(-5, -1).map(Number), [after.income, after.expense, after.benefit, after.hours]);
    await request("/api/special", "a", { key: "share_class", note: "集成回归退回申请" });
    const rejected = (await request("/api/admin/approvals?status=pending", "monitor")).find(item => item.note === "集成回归退回申请");
    await request("/api/admin/approval/decide", "monitor", { id: rejected.id, ok: false });
    assert.deepEqual((await request(`/api/my?month=${month}`, "a")).totals, after);
  });

  await test("retired featured write routes return 410 without changing existing letter or totals", async () => {
    const before = (await request("/api/my?month=2026-10", "a")).totals;
    const beforeLetters = await request("/api/letters", "a");
    await request("/api/admin/letter/feature", "leader", { letterId: "new_a" }, 403);
    await request("/api/admin/letter/feature", "monitor", { letterId: "new_a" }, 410);
    await request("/api/admin/letter/feature", "director", { letterId: "new_a" }, 410);
    await request("/api/admin/letter/unfeature", "director", { letterId: "new_a" }, 410);
    assert.deepEqual((await request("/api/my?month=2026-10", "a")).totals, before);
    assert.deepEqual(await request("/api/letters", "a"), beforeLetters);
  });

  await test("counselor can manage two groups while personal study remains in counselor group", async () => {
    await request("/api/admin/group/officer", "monitor", { groupId: "g_b", position: "fudao", memberId: "counselor" });
    assert.deepEqual(scopeIds(await consoleFor("counselor")), ["g_a", "g_b"]);
    await request("/api/leader/letter-config", "counselor", { groupId: "g_b", deadline: "20:30", plan: [{ memberId: "b", day: 2 }] });
    const schedule = await request("/api/leader/letter-config?group=g_b", "counselor");
    assert.equal(schedule.deadline, "20:30");
    assert.ok(schedule.plan.some(item => item.memberId === "b" && item.day === 2));
    await request("/api/leader/adjust", "counselor", { groupId: "g_b", memberId: "b", date: "2026-10-02", amount: 125, label: "测试加分" });
    await request("/api/leader/member", "counselor", { groupId: "g_b", name: "测试-新增成员", code: "test1234", target: 10000 });
    const view = await consoleFor("monitor", "g_b");
    assert.ok(view.members.some(m => m.name === "测试-新增成员" && m.groupId === "g_b"));
    await request("/api/checkin", "counselor", { actId: "read", on: true });
    const boot = await request("/api/bootstrap", "counselor");
    assert.equal(boot.member.taskGroupId, "g_fudao");
    const personalLetters = await request("/api/letters", "counselor");
    assert.equal(personalLetters.today.deadline, "22:15");
  });

  await test("removing leadership immediately removes legacy role fallback", async () => {
    await request("/api/admin/group/officer", "director", { groupId: "g_a", position: "leader", memberId: "" });
    assert.equal((await request("/api/bootstrap", "leader")).consoleAccess, false);
    await request("/api/console", "leader", undefined, 403);
    await request("/api/leader/letter-config?group=g_a", "leader", undefined, 403);
  });

  await test("inactive accounts cannot keep using existing bearer or query tokens", async () => {
    await request("/api/admin/member/toggle", "monitor", { memberId: "counselor" });
    await request("/api/bootstrap", "counselor", undefined, 401);
    await request("/api/console", "counselor", undefined, 401);
    await request(`/api/console/export?month=2026-10&group=g_b&token=${tokens.counselor}`, null, undefined, 401);
    await request("/api/login", null, { name: "测试-counselor", code: "test8888" }, 401);
  });

  await counselorGroupManagement();
  await test("schema7 counselor without task group moves to existing counselor group without changing history", () => oldCounselorMigration(true));
  await test("schema7 counselor migration creates missing counselor group once and preserves history", () => oldCounselorMigration(false));
}

(async () => {
  try { await main(); }
  catch (error) { failures.push({ name: "test harness", error }); process.stderr.write(`${error.stack}\n`); }
  finally { await stop(); fs.rmSync(temp, { recursive: true, force: true }); }
  process.stdout.write(`\n${passed} passed; ${failures.length} failed. Temporary synthetic data removed.\n`);
  if (failures.length) {
    for (const { name, error } of failures) process.stderr.write(`\n${name}\n${error.stack}\n`);
    process.exitCode = 1;
  }
})();
