// 学习收益核算 H5 — 零依赖 Node 18 服务端（v2：分组登录/实名管理/家书轮值点评）
// 角色: classAdmin=班主任/副班主任 / monitor=班长(兼组员) / leader=组长 / member=组员
// 端口 3104，数据 data/store.json；PORT / HOST / DATA_DIR 可用环境变量覆盖，空部署首次启动走 /api/setup 初始化班级
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3104;
const ROOT = __dirname;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, "data"));
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const STORE = path.join(DATA_DIR, "store.json");
const CLASS_NAME = process.env.CLASS_NAME || "学习小组"; // 未初始化时初始化页默认展示的班级名
const INITIAL_CODE = process.env.INITIAL_CODE || ""; // 可选：部署时预置的初始登录码（未在初始化表单填写时使用）

// ---------- 默认收支标准（管理人员可在控制台编辑，存于 store.activities） ----------
// freq: daily=每日任务 / weekly=每周任务 / monthly=每月任务
const DEFAULT_ACTIVITIES = [
  { id: "read",    name: "每日读书打卡", income: 500,  expense: 200,  hours: 0.5, freq: "daily",   groupRule: { bonus: 200,  bonusName: "全组及时完成奖励", penalty: -100, penaltyName: "未全员·凝聚补救" } },
  { id: "review",  name: "点评当日家书", income: 500,  expense: 200,  hours: 0.5, freq: "daily", auto: true, groupRule: { bonus: 200, bonusName: "全组点评完成奖励", penalty: -100, penaltyName: "有人未评·凝聚补救" } },
  { id: "meet",    name: "每周周会",     income: 3000, expense: 1500, hours: 3,   freq: "weekly",  groupRule: { bonus: 500,  bonusName: "全组准时参加周会", penalty: -200, penaltyName: "未参加·凝聚补救" } },
  { id: "monthly", name: "月度学习会",   income: 6000, expense: 3000, hours: 6,   freq: "monthly", groupRule: { bonus: 1000, bonusName: "全员参加·凝心聚力", penalty: -400, penaltyName: "未参加·凝聚补救" } },
  { id: "online",  name: "线上视频学习", income: 1000, expense: 500,  hours: 1,   freq: "monthly" },
  { id: "offline", name: "线下大课学习", income: 6000, expense: 3000, hours: 6,   freq: "monthly", groupRule: { bonus: 2000, bonusName: "全组同频奖励" } },
];
// 需管理人员审批的大项
const DEFAULT_SPECIALS = [
  { key: "share_class", name: "利他分享·班内", income: 2000,  expense: 1000,  hours: 2,  fixed: true },
  { key: "share_cross", name: "利他分享·跨班", income: 3000,  expense: 1500,  hours: 3,  fixed: true },
  { key: "share_city",  name: "利他分享·市塾", income: 20000, expense: 6000,  hours: 6,  fixed: true },
  { key: "share_prov",  name: "利他分享·省塾", income: 50000, expense: 12000, hours: 12, fixed: true },
  { key: "visit_host",  name: "企业走访·被走访", income: 6000, expense: 2500, hours: 5, fixed: true },
  { key: "visit_guest", name: "企业走访·参访",   income: 3000, expense: 1500, hours: 3, fixed: true },
  { key: "recruit",     name: "发展塾友",         income: 2000, expense: 1500, hours: 3, fixed: true },
  { key: "innovate",    name: "创新（需定级）",   income: 0,  expense: 0,    hours: 0,  fixed: false },
];

// ---------- 存储 ----------
let store = null;
function load() {
  try { store = JSON.parse(fs.readFileSync(STORE, "utf8")); }
  catch (e) { if (e.code !== "ENOENT") throw e; seed(); }
  // 首次初始化前（setupComplete=false）允许空成员；已初始化但成员为空按数据损坏处理，停止启动以保护原数据
  if (!store || !Array.isArray(store.members) || (!store.members.length && store.setupComplete !== false))
    throw new Error("成员数据无效，已停止启动以保护原数据");
  migrate();
}
let saveTimer = null;
function flushNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE + ".tmp", JSON.stringify(store));
  fs.renameSync(STORE + ".tmp", STORE);
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushNow, 300);
}
process.on("SIGTERM", () => { try { flushNow(); } catch (e) {} process.exit(0); });
process.on("SIGINT", () => { try { flushNow(); } catch (e) {} process.exit(0); });

// 全新部署：不内置任何班级数据，班级名/班主任/分组由首次初始化接口（POST /api/setup）建立
function seed() {
  store = {
    className: "", schemaV2: 9, setupComplete: false,
    groups: [],
    members: [],
    activities: JSON.parse(JSON.stringify(DEFAULT_ACTIVITIES)),
    specials: JSON.parse(JSON.stringify(DEFAULT_SPECIALS)),
    records: {},
    approvals: [],
    tokens: {}, // 持久会话 {token: {mid, at, last}}
    letters: [], // {id,groupId,authorId,authorName,date,content,images:[],late,featured,featuredWeek,comments:[{id,memberId,name,text,at}]}
  };
  initializeConsoleSchema();
  initializeHonorsSchema();
  save();
}
// 旧数据 → 迁移：只保留通用 schema 升级（console v8 / honors v9），班级专属的历史迁移已归档
function migrate() {
  // 旧版存盘没有 setupComplete 字段，一律视为已完成初始化，线上部署行为零变化
  if (store.setupComplete === undefined) store.setupComplete = true;
  // 旧数据没有家书公开起点：取最早的轮值周期锚点（不晚于今天），避免历史家书被当成新家书外露
  if (store.setupComplete === true && !store.settings?.letterOpenSince) {
    const starts = (store.groups || []).map(g => g.letterCycleStart).filter(Boolean).sort();
    store.settings = { ...(store.settings || {}), letterOpenSince: starts.length && starts[0] <= todayCN() ? starts[0] : todayCN() };
    save();
  }
  if (store.schemaV2 >= 9) return;
  if (store.schemaV2 >= 8) { migrateHonors(); return; }
  if (fs.existsSync(STORE)) {
    try { fs.copyFileSync(STORE, STORE + ".pre-console-v8.bak", fs.constants.COPYFILE_EXCL); }
    catch (e) { if (e.code !== "EEXIST") throw e; }
  }
  initializeConsoleSchema();
  migrateHonors();
}

function initializeHonorsSchema() {
  store.letterHonors = store.letterHonors || { classDecisions: {}, schoolAwards: {}, audit: [] };
  store.guideSeen = store.guideSeen || {};
  store.schemaV2 = 9;
}
function migrateHonors() {
  if (fs.existsSync(STORE)) {
    try { fs.copyFileSync(STORE, STORE + ".pre-honors-v9.bak", fs.constants.COPYFILE_EXCL); }
    catch (e) { if (e.code !== "EEXIST") throw e; }
  }
  initializeHonorsSchema();
  save();
}

// 只在版本迁移时补齐字段；不重新任命已被管理员撤下的职务。
function initializeConsoleSchema() {
  store.classOfficers = store.classOfficers || {};
  const legacyTitles = { xuewei: /^(大学委|班级学委|学委)$/, jiwei: /^(班级纪委|纪委)$/, guanai: /^(班级关爱委|关爱委)$/, huodong: /^(班级活动委|活动委)$/ };
  for (const [position, title] of Object.entries(legacyTitles)) {
    const legacy = store.members.find(m => m.role === "classAdmin" && title.test(m.title || ""));
    if (!Object.hasOwn(store.classOfficers, position)) store.classOfficers[position] = legacy?.id || "";
    if (legacy) { legacy.role = "member"; legacy.title = ""; }
  }
  for (const g of store.groups) {
    if (!Array.isArray(g.letterPlan)) g.letterPlan = [];
    for (const position of ["leader", "fudao", "xuewei", "jiwei", "guanai", "huodong"]) {
      if (g[position + "Id"] === undefined) g[position + "Id"] = "";
    }
  }
  const counselors = [...new Set(store.groups.map(g => g.fudaoId).filter(Boolean))];
  for (const id of counselors) {
    const member = store.members.find(m => m.id === id);
    if (member) counselorTaskGroup(member);
  }
  store.schemaV2 = 8;
}

// ---------- 会话（持久化，30天有效，重启不掉线） ----------
const TOKEN_TTL = 30 * 24 * 3600 * 1000;
const tokensMem = {}; // token -> memberId（内存加速，来源 store.tokens）
function initTokens() {
  if (!store.tokens) store.tokens = {};
  const now = Date.now();
  let dirty = false;
  for (const [t, v] of Object.entries(store.tokens)) {
    if (!v || !v.mid || now - (v.last || v.at || 0) > TOKEN_TTL) { delete store.tokens[t]; dirty = true; continue; }
    tokensMem[t] = v.mid;
  }
  if (dirty) save();
}
function issueToken(mid) {
  const t = crypto.randomBytes(16).toString("hex");
  store.tokens = store.tokens || {};
  store.tokens[t] = { mid, at: Date.now(), last: Date.now() };
  tokensMem[t] = mid;
  save();
  return t;
}
function touchToken(req) { // 每小时落一次盘即可，避免写放大
  const t = (req.headers.authorization || "").replace(/^Bearer /, "");
  const v = store.tokens?.[t];
  if (v && Date.now() - (v.last || 0) > 3600e3) { v.last = Date.now(); save(); }
}
function dropToken(req) {
  const t = (req.headers.authorization || "").replace(/^Bearer /, "");
  if (store.tokens && store.tokens[t]) { delete store.tokens[t]; save(); }
  delete tokensMem[t];
}
function revokeMemberTokens(memberId) {
  for (const [token, mid] of Object.entries(tokensMem)) if (mid === memberId) delete tokensMem[token];
  for (const [token, session] of Object.entries(store.tokens || {})) if (session?.mid === memberId) delete store.tokens[token];
}

// ---------- 时间 ----------
const todayCN = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
const nowCNMinutes = () => { const s = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()); const [h, m] = s.split(":").map(Number); return h * 60 + m; };
function monthDays(ym) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`);
}
function isoWeekOf(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const ft = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const fd = (ft.getUTCDay() + 6) % 7;
  ft.setUTCDate(ft.getUTCDate() - fd + 3);
  return d.getUTCFullYear() + "-W" + (1 + Math.round((d - ft) / 604800000));
}
// 周几(周一=0..周日=6)
function weekdayOf(dateStr) { return (new Date(dateStr + "T00:00:00Z").getUTCDay() + 6) % 7; }

// ---------- 家书（每人每周一篇；排班=周期内第几天，周期锚定日期 letterCycleStart，可多人同一天） ----------
// 历史家书（系统上线前导入的旧数据）仅作者本人可见；上线后的新家书全组可见供点评
// 公开起点由 store.settings.letterOpenSince 控制（首次初始化/旧数据迁移时写入），缺失时按今天算
const letterOpenSince = () => store.settings?.letterOpenSince || todayCN();
function groupById(gid) { return store.groups.find(g => g.id === gid) || null; }
const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000);
// 某日期在组周期内的天序（0=周期第1天，即组里认定的"周一"）
function cycleDay(gid, date) {
  const g = groupById(gid);
  const start = (g && g.letterCycleStart) || todayCN();
  const diff = daysBetween(start, date);
  if (diff < 0) return null;
  return diff % 7;
}
// 当日排班（可能多人）
function dutyList(gid, date) {
  const g = groupById(gid);
  if (!g || !Array.isArray(g.letterPlan)) return [];
  const idx = cycleDay(gid, date);
  if (idx == null) return [];
  return g.letterPlan.filter(e => e.day === idx)
    .map(e => store.members.find(m => m.id === e.memberId && m.active))
    .filter(Boolean);
}
function myDutyDays(gid, mid) {
  const g = groupById(gid);
  return ((g && Array.isArray(g.letterPlan)) ? g.letterPlan : []).filter(e => e.memberId === mid).map(e => e.day);
}
const lettersOf = (gid, date) => store.letters.filter(l => l.groupId === gid && l.date === date);
const myWeekLetter = (mid, week) => store.letters.find(l => l.authorId === mid && isoWeekOf(l.date) === week) || null;
function deadlinePassed(g, date) {
  if (date !== todayCN()) return date < todayCN();
  const [h, m] = String(g.letterDeadline || "21:00").split(":").map(Number);
  return nowCNMinutes() >= h * 60 + m;
}
// 迟交判定：晚于自己的首个排班日，或排班日当天已过截止时刻（按周期天序）
function letterLate(gid, mid, date) {
  const days = myDutyDays(gid, mid);
  const g = groupById(gid);
  if (!days.length || !g) return false;
  const dd = Math.min(...days);
  const cd = cycleDay(gid, date);
  if (cd == null) return false;
  if (cd > dd) return true;
  if (cd === dd) return deadlinePassed(g, date);
  return false;
}
// 某成员某日是否完成点评：只看当日轮值者的本周家书（轮值者免评，其余评论其家书即完成）
function reviewDone(gid, date, mid) {
  const duties = dutyList(gid, date);
  if (!duties.length) return false;
  const wk = isoWeekOf(date);
  const dutyLetters = duties.map(d => myWeekLetter(d.id, wk)).filter(Boolean);
  if (!dutyLetters.length) return false; // 轮值者还没传，当天点评项不生效
  if (duties.some(d => d.id === mid)) return true; // 轮值者本人免评
  return dutyLetters.some(l => l.comments.some(c => c.memberId === mid));
}
// 当日轮值者的本周家书是否已传
function dutyLetterReady(gid, date) {
  const duties = dutyList(gid, date);
  if (!duties.length) return false;
  const wk = isoWeekOf(date);
  return duties.some(d => myWeekLetter(d.id, wk));
}
// 本周家书看板：按组长排班的参与者，谁传了谁没传
function weekBoard(gid, date = todayCN()) {
  const wk = isoWeekOf(date);
  const g = groupById(gid);
  const plan = (g && Array.isArray(g.letterPlan)) ? g.letterPlan : [];
  const ids = [...new Set(plan.map(e => e.memberId))];
  return ids.map(id => {
    const m = store.members.find(x => x.id === id);
    if (!m) return null;
    const l = myWeekLetter(id, wk);
    const days = [...new Set(plan.filter(e => e.memberId === id).map(e => e.day))].sort((a, b) => a - b);
    return { id, name: m.name, dutyDay: days.length ? days.map(d => "周" + "一二三四五六日"[d]).join("/") : null,
      uploaded: !!l, late: l ? l.late : false, date: l ? l.date : null, letterId: l ? l.id : null };
  }).filter(Boolean).sort((a, b) => (myDutyDays(gid, a.id)[0] ?? 9) - (myDutyDays(gid, b.id)[0] ?? 9));
}

// ---------- 核算 ----------
const act = id => store.activities.find(a => a.id === id);
// 职务是授权来源；成员的旧 role 字段不作为撤职后的组务权限兜底。
const OFFICERS = { leader: "组长", fudao: "辅导员", xuewei: "学委", jiwei: "纪委", guanai: "关爱委", huodong: "活动委" };
const CLASS_LINES = ["xuewei", "jiwei", "guanai", "huodong"];
function officerTitle(g, mid) {
  if (!g) return "";
  return Object.keys(OFFICERS).filter(p => g[p + "Id"] === mid).map(p => OFFICERS[p]).join(" / ");
}
function managedGroupsOf(m) {
  if (!m?.active) return [];
  return store.groups.filter(g => [g.leaderId, g.fudaoId, g.xueweiId].includes(m.id))
    .map(g => ({ id: g.id, name: g.name, title: officerTitle(g, m.id) }));
}
function managedGroupOf(m) { return managedGroupsOf(m)[0] || null; }
function consolePermissions(m) {
  const fullAdmin = !!isAdmin(m);
  const lines = CLASS_LINES.filter(p => store.classOfficers?.[p] === m?.id);
  const manageGroups = store.groups.filter(g => fullAdmin || (m?.active && [g.leaderId, g.fudaoId].includes(m.id))).map(g => g.id);
  const scheduleGroups = store.groups.filter(g => fullAdmin || lines.includes("xuewei") || manageGroups.includes(g.id) || (m?.active && g.xueweiId === m.id)).map(g => g.id);
  const organizationGroups = store.groups.filter(g => fullAdmin || lines.length || (m?.active && Object.keys(OFFICERS).some(p => g[p + "Id"] === m.id))).map(g => g.id);
  return { access: !!m?.active && (fullAdmin || organizationGroups.length > 0 || lines.length > 0),
    fullAdmin, overview: scheduleGroups.length > 0, organization: true, approvals: fullAdmin,
    standards: fullAdmin, reports: scheduleGroups.length > 0, manageGroups, scheduleGroups, organizationGroups, lines };
}
function requireConsoleGroup(m, groupId, capability = "scheduleGroups") {
  const ids = consolePermissions(m)[capability];
  const id = groupId || managedGroupOf(m)?.id || ids[0];
  if (!id || !ids.includes(id)) throw { code: 403, msg: "无权操作该小组" };
  const g = groupById(id);
  if (!g) throw { code: 404, msg: "小组不存在" };
  return g;
}
function accountCapabilities(me, member, permissions = consolePermissions(me)) {
  if (!me?.active || !member) return { canManageAccount: false, canToggleAccount: false };
  if (permissions.fullAdmin) return { canManageAccount: true, canToggleAccount: !isAdmin(member) };
  // 负责组仅能管理本任务组普通成员；旧 role/title 不授予权限，也不能借重置码接管任职账号。
  const protectedAccount = member.id === me.id || isAdmin(member)
    || CLASS_LINES.some(position => store.classOfficers?.[position] === member.id)
    || store.groups.some(g => Object.keys(OFFICERS).some(position => g[position + "Id"] === member.id));
  const allowed = !protectedAccount && permissions.manageGroups.includes(effGid(member));
  return { canManageAccount: allowed, canToggleAccount: allowed };
}
function toggleMemberAccount(member) {
  member.active = !member.active;
  revokeMemberTokens(member.id); // 启用旧停用账号时也清除历史会话，须重新登录。
  save();
  return { ok: true, active: member.active };
}
function resetMemberCode(member, code) {
  member.code = String(code);
  revokeMemberTokens(member.id);
  save();
  return { ok: true };
}
function validMonth(value) {
  const v = value || todayCN().slice(0, 7);
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(v)) throw { code: 400, msg: "月份格式应为 YYYY-MM" };
  return v;
}
function validDate(value) {
  const v = value || todayCN();
  const parsed = new Date(v + "T00:00:00Z");
  if (!/^20\d{2}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(v) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== v)
    throw { code: 400, msg: "日期无效" };
  return v;
}
function personInStudyScope(m, memberId) {
  const person = store.members.find(x => x.id === memberId);
  if (!person || !consolePermissions(m).scheduleGroups.includes(effGid(person))) throw { code: 403, msg: "无权查看该成员" };
  return person;
}
function officerMap(g) {
  return Object.fromEntries(Object.keys(OFFICERS).map(p => {
    const m = store.members.find(x => x.id === g[p + "Id"]);
    return [p, { id: m?.id || "", name: m?.name || "" }];
  }));
}
function counselorTaskGroup(m) {
  let g = store.groups.find(g => g.name === "辅导员组" || g.id === "g_fudao");
  if (!g) {
    g = { id: "g_fudao_" + crypto.randomBytes(3).toString("hex"), name: "辅导员组", letterDeadline: "21:00", letterCycleStart: todayCN(), letterOrder: [], letterPlan: [] };
    for (const position of Object.keys(OFFICERS)) g[position + "Id"] = "";
    store.groups.push(g);
  }
  const old = effGid(m);
  m.taskGroupId = g.id;
  if (old !== g.id) {
    const previous = groupById(old);
    if (previous) previous.letterPlan = (previous.letterPlan || []).filter(p => p.memberId !== m.id);
  }
  if (!(g.letterPlan || []).some(p => p.memberId === m.id)) g.letterPlan.push({ memberId: m.id, day: 0 });
  return g;
}
// 家组（登录/榜单用）与 任务组（打卡/家书/点评结算用，辅导员可跨组）
const effGid = m => (m && m.taskGroupId) || (m && m.groupId) || null;
const groupMembers = gid => store.members.filter(m => m.groupId === gid && m.active); // 家组成员
const taskMembers = gid => store.members.filter(m => m.groupId && effGid(m) === gid && m.active); // 任务组成员（含跨组辅导员）
const loginMembers = g => store.members.filter(m => m.active && (m.groupId === g.id
  || ((g.id === "g_fudao" || g.name === "辅导员组") && effGid(m) === g.id)));
function rec(date, mid) { return (store.records[date] || {})[mid] || { items: {}, customs: [] }; }
const dayItems = (date, mid) => rec(date, mid).items || {};
function approvedSpecials(memberId, date) {
  return store.approvals.filter(a => a.memberId === memberId && a.date === date && a.status === "approved");
}
// 组奖励/补救：按任务组判定
function groupResults(date, gid) {
  const out = [];
  const list = taskMembers(gid);
  const g = groupById(gid);
  if (!list.length || !g) return out;
  const hasToday = lettersOf(gid, date).length > 0;
  // 当日排班者本周家书仍未按时传 → 任务组全员补救
  const duties = dutyList(gid, date);
  if (duties.length && deadlinePassed(g, date)) {
    const wk = isoWeekOf(date);
    const missed = duties.filter(d => { const l = myWeekLetter(d.id, wk); return !l || l.late; });
    if (missed.length) {
      out.push({ actId: "letter_missing", actName: "当日家书", label: `当日排班（${missed.map(m => m.name).join("、")}）家书未按时上传·凝聚补救`, amount: -200,
        members: list.map(m => m.id), doneCount: 0, totalCount: list.length });
    }
  }
  for (const a of store.activities) {
    if (!a.groupRule) continue;
    let done;
    if (a.id === "review") {
      if (!dutyLetterReady(gid, date)) continue; // 轮值者家书未传，点评项不生效
      done = list.filter(m => reviewDone(gid, date, m.id));
      if (!done.length) continue;
    } else {
      done = list.filter(m => dayItems(date, m.id)[a.id]);
      if (!done.length) continue;
    }
    let amount = 0, label = "";
    if (done.length === list.length && a.groupRule.bonus) { amount = a.groupRule.bonus; label = a.groupRule.bonusName; }
    else if (done.length < list.length && a.groupRule.penalty) { amount = a.groupRule.penalty; label = a.groupRule.penaltyName; }
    else continue;
    out.push({ actId: a.id, actName: a.name, label, amount, members: list.map(m => m.id), doneCount: done.length, totalCount: list.length });
  }
  return out;
}
function memberDay(date, mid) {
  const m = store.members.find(x => x.id === mid);
  const r = rec(date, mid);
  let income = 0, expense = 0, hours = 0;
  const detail = [];
  for (const [aid, on] of Object.entries(r.items)) {
    if (!on) continue;
    const a = act(aid); if (!a) continue;
    income += a.income; expense += a.expense; hours += a.hours;
    detail.push({ type: "item", name: a.name, note: "", income: a.income, expense: a.expense });
  }
  // 点评家书（自动项：以评论为准，按任务组）
  if (m && m.groupId && reviewDone(effGid(m), date, mid)) {
    const a = act("review");
    if (a) {
      income += a.income; expense += a.expense; hours += a.hours;
      detail.push({ type: "item", name: a.name, note: "已点评", income: a.income, expense: a.expense });
    }
  }
  for (const s of approvedSpecials(mid, date)) {
    income += s.income; expense += s.expense; hours += s.hours;
    detail.push({ type: "special", name: s.name, note: s.note, income: s.income, expense: s.expense });
  }
  for (const c of r.customs || []) {
    income += c.amount;
    detail.push({ type: "custom", name: c.label, note: c.note, income: c.amount, expense: 0 });
  }
  if (m && m.groupId) {
    for (const gr of groupResults(date, effGid(m))) {
      if (gr.members.includes(mid)) {
        income += gr.amount;
        detail.push({ type: "group", name: gr.label, note: `${gr.doneCount}/${gr.totalCount}人`, income: gr.amount, expense: 0 });
      }
    }
  }
  return { income, expense, hours, benefit: income - expense, detail,
    checked: Object.values(r.items).some(Boolean) || reviewDone(effGid(m), date, mid) };
}
function memberMonth(ym, mid) {
  let income = 0, expense = 0, hours = 0;
  const days = {};
  for (const d of monthDays(ym)) {
    const r = memberDay(d, mid);
    days[d] = r;
    income += r.income; expense += r.expense; hours += r.hours;
  }
  return { income, expense, hours, benefit: income - expense, days };
}
function groupBoard(ym, gid, today) {
  // 学习看板按实际任务归属统计，辅导员不会在所属组与任务组重复计入。
  const ids = taskMembers(gid).map(m => m.id);
  const members = ids.map(id => {
    const m = store.members.find(x => x.id === id);
    const mon = memberMonth(ym, id);
    const g = groupById(gid);
    return { id, name: m.name, role: m.role, officer: officerTitle(g, id), income: mon.income, expense: mon.expense, benefit: mon.benefit, hours: mon.hours,
      target: m.targets.income, rate: m.targets.income ? +(mon.income / m.targets.income).toFixed(2) : 0,
      unitValue: mon.hours ? +(mon.benefit / mon.hours).toFixed(0) : null,
      cross: effGid(m) !== m.groupId, // 跨组标记（本组的人去别组做任务）
      todayRead: !!dayItems(today, id).read,
      todayReview: reviewDone(gid, today, id),
      todayChecked: Object.values(dayItems(today, id)).some(Boolean) || reviewDone(gid, today, id) };
  }).sort((a, b) => b.benefit - a.benefit);
  const totals = members.reduce((s, m) => ({ income: s.income + m.income, expense: s.expense + m.expense, benefit: s.benefit + m.benefit, hours: s.hours + m.hours }), { income: 0, expense: 0, benefit: 0, hours: 0 });
  const trend = monthDays(ym).map(d => ({ d, v: ids.reduce((s, id) => s + memberDay(d, id).benefit, 0) }));
  const unchecked = members.filter(m => !m.todayChecked).map(m => m.name);
  const todayStat = { total: members.length,
    read: members.filter(m => m.todayRead).length,
    review: members.filter(m => m.todayReview).length,
    reviewActive: dutyLetterReady(gid, today) }; // 轮值家书已传，点评才计分
  return { id: gid, name: (groupById(gid) || {}).name, totals, members, trend, unchecked, results: groupResults(today, gid), todayStat };
}

// ---------- HTTP 基础 ----------
const auth = req => { const m = store.members.find(x => x.active && x.id === tokensMem[(req.headers.authorization || "").replace(/^Bearer /, "")]) || null; if (m) touchToken(req); return m; };
const authWithQuery = (req, url) => { const mid = tokensMem[url.searchParams.get("token") || (req.headers.authorization || "").replace(/^Bearer /, "")]; return store.members.find(m => m.active && m.id === mid) || null; };
const isAdmin = m => m && ["classAdmin", "monitor"].includes(m.role);
function json(res, code, obj) { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); }
const readBody = req => new Promise(res => {
  let b = "";
  req.on("data", c => { b += c; if (b.length > 8e6) req.destroy(); });
  req.on("end", () => { try { res(JSON.parse(b || "{}")); } catch (e) { res({}); } });
});
const pub = m => ({ id: m.id, name: m.name, role: m.role, title: m.title || "", groupId: m.groupId, active: m.active, targets: m.targets,
  groupName: m.groupId ? ((groupById(m.groupId) || {}).name || "") : "",
  taskGroupId: m.taskGroupId || null, taskGroupName: m.taskGroupId ? ((groupById(m.taskGroupId) || {}).name || "") : null });
const roleLabel = m => { const lines = CLASS_LINES.filter(p => store.classOfficers?.[p] === m.id); return isAdmin(m) ? (m.title || (m.role === "monitor" ? "班长" : "班主任")) : lines.length ? lines.map(p => "班级" + OFFICERS[p]).join(" / ") : managedGroupOf(m)?.title || (m.title && m.role !== "leader" ? m.title : "组员"); };
function letterBrief(l) {
  return { id: l.id, groupId: l.groupId, groupName: (groupById(l.groupId) || {}).name || "", authorId: l.authorId, authorName: l.authorName,
    helperName: l.helperName || "", date: l.date, week: isoWeekOf(l.date), content: l.content, images: l.images, late: l.late, featured: l.featured,
    ...honorFields(l),
    comments: (l.comments || []).map(c => ({ id: c.id, name: c.name, text: c.text, at: c.at, reply: c.reply || null })) };
}
function letterTodayFor(gid, date = todayCN()) {
  const t = date;
  const g = groupById(gid);
  if (!g) return null;
  const wk = isoWeekOf(t);
  const duties = dutyList(gid, t).map(m => {
    const l = myWeekLetter(m.id, wk);
    return { id: m.id, name: m.name, uploaded: !!l, late: l ? l.late : false, letter: l ? letterBrief(l) : null };
  });
  return { date: t, deadline: g.letterDeadline, duties,
    todayCount: lettersOf(gid, t).length };
}

// 家书归属日：以正文【分享时间】为准（支持提前写/补传），识别不到用上传日；范围限制在 前后合理区间
function letterDateOf(content, today) {
  const m = /【\s*(?:分\s*享\s*时\s*间|时\s*间)\s*】\s*(?:(\d{4})\s*年)?\s*(\d{1,2})\s*月\s*(\d{1,3})\s*日/.exec(String(content || ""));
  if (!m) return today;
  const y = m[1] ? +m[1] : +today.slice(0, 4);
  const mo = +m[2], da = +m[3];
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return today;
  const iso = `${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
  if (isNaN(new Date(iso + "T00:00:00Z"))) return today;
  const diff = daysBetween(today, iso);
  if (diff < -30 || diff > 10) return today; // 只接受前30天~后10天
  return iso;
}

function organizationPerson(m) {
  const { targets, ...person } = pub(m);
  return person;
}
function consoleData(me, url) {
  const permissions = consolePermissions(me);
  if (!permissions.access) throw { code: 403, msg: "仅班委、组长或辅导员可进入控制台" };
  const month = validMonth(url.searchParams.get("month"));
  const date = validDate(url.searchParams.get("date"));
  const selected = url.searchParams.get("group");
  if (selected && !permissions.organizationGroups.includes(selected)) throw { code: 403, msg: "无权查看该小组" };
  const scopeGroups = store.groups.filter(g => permissions.organizationGroups.includes(g.id)).map(g => ({
    id: g.id, name: g.name, officers: officerMap(g), canStudy: permissions.scheduleGroups.includes(g.id),
    canManage: permissions.manageGroups.includes(g.id), canSchedule: permissions.scheduleGroups.includes(g.id),
  }));
  const selectedGroups = scopeGroups.filter(g => !selected || selected === g.id);
  const studyIds = selectedGroups.filter(g => g.canStudy).map(g => g.id);
  const groups = studyIds.map(gid => {
    const letterToday = letterTodayFor(gid, date);
    return { ...groupBoard(month, gid, date), officers: officerMap(groupById(gid)),
      letterToday: { date, deadline: letterToday.deadline, duties: letterToday.duties.map(({ letter, ...d }) => d), todayCount: letterToday.todayCount },
      weekBoard: weekBoard(gid, date) };
  });
  const roster = store.members.filter(m => {
    if (permissions.fullAdmin) return !selected || m.groupId === selected || effGid(m) === selected;
    if (studyIds.includes(effGid(m)) || selectedGroups.some(g => g.canStudy && m.groupId === g.id)) return true;
    return selectedGroups.some(g => permissions.lines.some(p => g.officers[p]?.id === m.id)) || m.id === me.id;
  });
  const members = roster.map(m => ({ ...(permissions.fullAdmin || studyIds.includes(effGid(m)) ? pub(m) : organizationPerson(m)),
    ...accountCapabilities(me, m, permissions) }));
  const approvals = permissions.fullAdmin ? store.approvals.filter(a => !selected || a.groupId === selected) : [];
  return { className: store.className, today: todayCN(), date, month, member: permissions.overview ? pub(me) : organizationPerson(me), roleLabel: roleLabel(me),
    permissions, scopeGroups, groups, members,
    appointmentCandidates: permissions.fullAdmin ? store.members.filter(m => m.active).map(organizationPerson) : [],
    classOfficers: CLASS_LINES.map(position => ({ position, label: "班级" + OFFICERS[position], memberId: store.classOfficers[position] || "", name: store.members.find(m => m.id === store.classOfficers[position])?.name || "" })),
    officerPositions: Object.entries(OFFICERS).map(([key, label]) => ({ key, label })),
    activities: permissions.overview || permissions.standards ? store.activities : [],
    pending: approvals.filter(a => a.status === "pending"), approvals,
  };
}
function csvReport(res, me, url, legacyAdmin = false) {
  if (!me) throw { code: 401, msg: "请先登录" };
  const permissions = consolePermissions(me);
  if ((legacyAdmin && !permissions.fullAdmin) || !permissions.reports) throw { code: 403, msg: "无权导出报表" };
  const month = validMonth(url.searchParams.get("month"));
  const selected = url.searchParams.get("group");
  if (selected && !permissions.scheduleGroups.includes(selected)) throw { code: 403, msg: "无权导出该小组" };
  const groups = store.groups.filter(g => permissions.scheduleGroups.includes(g.id) && (!selected || g.id === selected));
  const days = monthDays(month), lines = [];
  for (const g of groups) {
    lines.push([], [`【${g.name}】${month} 学习收益核算表`], ["成员", ...days.map(d => +d.slice(8)), "收入", "费用", "收益", "工时", "目标完成率"]);
    for (const m of taskMembers(g.id)) {
      const mon = memberMonth(month, m.id);
      lines.push([m.name, ...days.map(d => mon.days[d].benefit || ""), mon.income, mon.expense, mon.benefit, mon.hours,
        m.targets.income ? Math.round(mon.income / m.targets.income * 100) + "%" : ""]);
    }
  }
  const escape = v => { let t = String(v ?? ""); if (/^[=+@-]/.test(t) && typeof v !== "number") t = "'" + t; return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const csv = "\ufeff" + lines.map(r => r.map(escape).join(",")).join("\n");
  res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${month}.csv"` });
  res.end(csv);
}

// ---------- 每日优秀家书与月榜（旧 featured 与历史加分独立保留） ----------
const canSelectClass = m => !!(m?.active && m.role === "classAdmin" && m.title === "班主任");
const canRegisterSchool = m => !!(m?.active && store.classOfficers?.xuewei === m.id);
function honorFields(l) {
  const decision = Object.values(store.letterHonors.classDecisions).find(d => d.status === "selected" && d.letterId === l.id);
  const award = Object.values(store.letterHonors.schoolAwards).find(a => a.letterId === l.id);
  return { classHonor: !!decision, classHonorDate: decision?.date || null, nominatedAt: decision ? l.nominatedAt || null : null,
    schoolHonor: !!award, schoolHonorDate: award?.date || null };
}
function publicHonorBrief(l) { const { comments, ...brief } = letterBrief(l); return { ...brief, comments: [] }; }
function honorAudit(me, action, data) {
  store.letterHonors.audit.push({ id: crypto.randomBytes(8).toString("hex"), at: Date.now(), actorId: me.id, action, ...data });
}
function honorDate(value) {
  const date = validDate(value);
  const day = new Date(date + "T00:00:00Z").getUTCDay();
  if (day === 0 || day === 6) throw { code: 400, msg: "优秀家书只在工作日评选" };
  return date;
}
function ranked(list, value) {
  list.sort((a, b) => value(b) - value(a) || a.id.localeCompare(b.id));
  let rank = 0, last;
  list.forEach((row, i) => { const current = value(row); if (i === 0 || current !== last) rank = i + 1; row.rank = rank; last = current; });
  return list;
}
function monthlyRankings(month, me) {
  const people = ranked(store.members.filter(m => m.active && m.groupId && groupById(m.groupId)).map(m => {
    const mon = memberMonth(month, m.id);
    return { id: m.id, name: m.name, groupId: m.groupId, groupName: groupById(m.groupId).name, income: mon.income, expense: mon.expense, benefit: mon.benefit };
  }), m => m.benefit);
  const groups = ranked(store.groups.map(g => {
    const members = people.filter(p => p.groupId === g.id);
    const totalBenefit = members.reduce((sum, p) => sum + p.benefit, 0);
    return { id: g.id, name: g.name, count: members.length, totalBenefit, averageBenefit: members.length ? totalBenefit / members.length : 0 };
  }).filter(g => g.count), g => g.averageBenefit);
  return { month, asOf: new Date().toISOString(), people, groups, myRank: people.find(p => p.id === me.id)?.rank || null, myGroupRank: groups.find(g => g.id === me.groupId)?.rank || null };
}
async function honorApi(req, res, url, me) {
  const u = url.pathname, POST = req.method === "POST", GET = req.method === "GET";
  if (u === "/api/guide/seen" && POST) {
    if (!store.guideSeen[me.id]) { store.guideSeen[me.id] = Date.now(); save(); }
    return json(res, 200, { ok: true, guideSeen: true, seenAt: store.guideSeen[me.id] });
  }
  if (u === "/api/monthly-rankings" && GET) return json(res, 200, monthlyRankings(validMonth(url.searchParams.get("month")), me));
  if (u === "/api/letter-library" && GET) {
    const kind = url.searchParams.get("kind") || "all";
    if (!["all", "class", "school"].includes(kind)) throw { code: 400, msg: "家书类型无效" };
    const search = (url.searchParams.get("search") || "").trim().toLowerCase();
    const month = url.searchParams.get("month") ? validMonth(url.searchParams.get("month")) : "";
    const offset = Number(url.searchParams.get("offset") || 0), limit = Number(url.searchParams.get("limit") || 30);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw { code: 400, msg: "分页参数无效" };
    const matches = store.letters.filter(l => {
      const h = honorFields(l);
      return l.publishToClass === true && h.classHonor && (kind !== "school" || h.schoolHonor)
        && (!month || (kind === "school" ? h.schoolHonorDate : h.classHonorDate)?.startsWith(month))
        && (!search || [l.authorName, l.content, groupById(l.groupId)?.name].join(" ").toLowerCase().includes(search));
    }).sort((a, b) => (honorFields(b).classHonorDate + b.id).localeCompare(honorFields(a).classHonorDate + a.id));
    return json(res, 200, { list: matches.slice(offset, offset + limit).map(publicHonorBrief), total: matches.length, hasMore: offset + limit < matches.length });
  }
  if (u === "/api/letter-honors" && GET) {
    const date = validDate(url.searchParams.get("date"));
    const school = store.letterHonors.schoolAwards[date];
    return json(res, 200, { date, canSelectClass: canSelectClass(me), canRegisterSchool: canRegisterSchool(me),
      decision: store.letterHonors.classDecisions[date] || null,
      candidates: canSelectClass(me) ? store.letters.filter(l => l.date === date).map(publicHonorBrief) : [],
      nominees: canSelectClass(me) || canRegisterSchool(me) ? store.letters.filter(l => honorFields(l).classHonor && l.nominatedAt && l.publishToClass).map(publicHonorBrief) : [],
      schoolAward: school ? publicHonorBrief(store.letters.find(l => l.id === school.letterId)) : null });
  }
  if (u === "/api/letter-honors/class" && POST) {
    if (!canSelectClass(me)) throw { code: 403, msg: "仅当前班主任可以评选班级优秀家书" };
    const body = await readBody(req), date = honorDate(body.date);
    const old = store.letterHonors.classDecisions[date];
    const oldLetter = old?.letterId ? store.letters.find(l => l.id === old.letterId) : null;
    if ((body.revoke || body.skip || (old && old.letterId !== body.letterId)) && oldLetter && honorFields(oldLetter).schoolHonor)
      throw { code: 409, msg: "请先处理塾里获奖记录，再撤销或改选班级优秀家书" };
    let next = null;
    if (body.skip === true) next = { date, status: "skipped", letterId: null, actorId: me.id, at: Date.now() };
    else if (body.revoke !== true) {
      const l = store.letters.find(l => l.id === body.letterId && l.date === date);
      if (!l) throw { code: 400, msg: "请选择该工作日的家书" };
      if (body.publishToClass !== true) throw { code: 400, msg: "请确认将该家书公开到全班优秀家书库" };
      if (old?.status === "selected" && old.letterId === l.id) return json(res, 200, { ok: true, decision: old });
      next = { date, status: "selected", letterId: l.id, actorId: me.id, at: Date.now() };
      l.publishToClass = true;
    }
    if (oldLetter && (!next || next.letterId !== oldLetter.id)) { delete oldLetter.nominatedAt; oldLetter.publishToClass = false; }
    if (next) store.letterHonors.classDecisions[date] = next; else delete store.letterHonors.classDecisions[date];
    honorAudit(me, next?.status === "selected" ? "class.select" : next ? "class.skip" : "class.revoke", { date, previousLetterId: old?.letterId || null, letterId: next?.letterId || null });
    save(); return json(res, 200, { ok: true, decision: next });
  }
  if (u === "/api/letter-honors/nominate" && POST) {
    if (!canSelectClass(me)) throw { code: 403, msg: "仅当前班主任可以标记已推选塾里" };
    const { letterId, nominated } = await readBody(req);
    const l = store.letters.find(l => l.id === letterId);
    if (!l || !honorFields(l).classHonor || !l.publishToClass) throw { code: 400, msg: "只有班级优秀家书可以推选塾里" };
    if (typeof nominated !== "boolean") throw { code: 400, msg: "推选状态无效" };
    if (!nominated && honorFields(l).schoolHonor) throw { code: 409, msg: "请先处理塾里获奖记录" };
    if (nominated !== !!l.nominatedAt) {
      if (nominated) l.nominatedAt = Date.now(); else delete l.nominatedAt;
      honorAudit(me, nominated ? "class.nominate" : "class.unnominate", { letterId }); save();
    }
    return json(res, 200, { ok: true, letter: publicHonorBrief(l) });
  }
  if (u === "/api/letter-honors/school" && POST) {
    if (!canRegisterSchool(me)) throw { code: 403, msg: "仅当前大学委可以登记塾里通知" };
    const body = await readBody(req), date = honorDate(body.date);
    const old = store.letterHonors.schoolAwards[date];
    if (body.revoke === true) {
      if (!old) return json(res, 200, { ok: true });
      if (old.letterId !== body.letterId) throw { code: 409, msg: "获奖家书不匹配" };
      const l = store.letters.find(l => l.id === old.letterId);
      const record = store.records[date]?.[l.authorId];
      if (record) record.customs = (record.customs || []).filter(c => c.id !== old.scoreId);
      delete store.letterHonors.schoolAwards[date];
      honorAudit(me, "school.revoke", { date, letterId: l.id, scoreId: old.scoreId }); save();
      return json(res, 200, { ok: true });
    }
    if (body.noticeConfirmed !== true) throw { code: 400, msg: "请确认已收到塾里正式获奖通知" };
    const l = store.letters.find(l => l.id === body.letterId);
    if (!l || !honorFields(l).classHonor || !l.nominatedAt || !l.publishToClass) throw { code: 400, msg: "只能登记已推选的班级优秀家书" };
    if (old) {
      if (old.letterId === l.id) return json(res, 200, { ok: true, schoolAward: publicHonorBrief(l) });
      throw { code: 409, msg: "该工作日已有一篇塾里优秀家书" };
    }
    if (honorFields(l).schoolHonor) throw { code: 409, msg: "该家书已获塾里优秀，不重复登记加分" };
    if (date < honorFields(l).classHonorDate) throw { code: 400, msg: "塾里评选日期不能早于班级评选日期" };
    const id = crypto.randomBytes(8).toString("hex"), scoreId = "school-honor:" + id;
    const day = store.records[date] = store.records[date] || {};
    const record = day[l.authorId] = day[l.authorId] || { items: {}, customs: [] };
    record.customs = record.customs || [];
    record.customs.push({ id: scoreId, amount: 500, label: "塾里优秀家书", note: date, letterId: l.id });
    store.letterHonors.schoolAwards[date] = { id, date, letterId: l.id, scoreId, actorId: me.id, receivedAt: Date.now() };
    honorAudit(me, "school.register", { date, letterId: l.id, scoreId }); save();
    return json(res, 200, { ok: true, schoolAward: publicHonorBrief(l) });
  }
  return false;
}

async function api(req, res, url) {
  const u = url.pathname, POST = req.method === "POST", me = auth(req);
  const need = role => {
    if (role === "admin" && !isAdmin(me)) throw { code: 403, msg: "仅管理人员可用" };
    if (role === "leader" && !["classAdmin", "monitor", "leader"].includes(me?.role)) throw { code: 403, msg: "仅组长/管理人员可用" };
  };

  if (url.searchParams.has("month")) validMonth(url.searchParams.get("month"));
  if (url.searchParams.has("date")) validDate(url.searchParams.get("date"));

  // ---- 公开接口（登录页） ----
  if (u === "/api/groups-public") {
    return json(res, 200, {
      className: store.className,
      groups: store.groups.map(g => ({ id: g.id, name: g.name, deadline: g.letterDeadline,
        members: loginMembers(g).map(m => ({ id: m.id, name: m.name, title: m.title || "", role: m.role, officer: officerTitle(g, m.id) })) }))
        .filter(g => g.members.length > 0), // 辅导员组兼容跨组任务成员；纯历史空组继续隐藏。
      managers: store.members.filter(m => m.active && (isAdmin(m) || (!m.groupId && consolePermissions(m).access))).map(m => ({ id: m.id, name: m.name, title: roleLabel(m) })),
    });
  }
  // ---- 首次初始化（无需登录）：空部署时建立班级、班主任与分组 ----
  if (u === "/api/setup") {
    if (req.method === "GET") return json(res, 200, { needsSetup: store.setupComplete === false, className: store.className || CLASS_NAME });
    if (!POST) return json(res, 405, { error: "请求方法不支持" });
    if (store.setupComplete !== false) return json(res, 409, { error: "已完成初始化" });
    const body = await readBody(req);
    const className = String(body.className == null ? "" : body.className).trim();
    const adminName = String(body.adminName == null ? "" : body.adminName).trim();
    const adminCode = String(body.adminCode == null ? "" : body.adminCode).trim() || INITIAL_CODE;
    if (!className || !adminName || !adminCode) return json(res, 400, { error: "班级名称、班主任姓名和登录码必填" });
    if ([...className].length > 30) return json(res, 400, { error: "班级名称不能超过 30 个字" });
    if ([...adminName].length > 20) return json(res, 400, { error: "班主任姓名不能超过 20 个字" });
    if (adminCode.length < 6 || adminCode.length > 32) return json(res, 400, { error: "登录码需为 6～32 位" });
    const rawGroups = Array.isArray(body.groups) ? body.groups : [];
    if (rawGroups.length > 12) return json(res, 400, { error: "分组最多 12 个" });
    const groupNames = [];
    for (const raw of rawGroups) {
      const name = String(raw == null ? "" : raw).trim();
      if (!name) continue;
      if ([...name].length > 20) return json(res, 400, { error: "分组名称不能超过 20 个字" });
      if (!groupNames.includes(name)) groupNames.push(name); // 去重，保留首次出现的顺序
    }
    if (!groupNames.length) groupNames.push("学习组");
    store.className = className;
    store.setupComplete = true;
    store.groups = groupNames.map(name => ({ id: "g_" + crypto.randomBytes(4).toString("hex"), name,
      leaderId: "", letterDeadline: "21:00", letterCycleStart: todayCN(), letterOrder: [], letterPlan: [] }));
    const admin = { id: crypto.randomBytes(5).toString("hex"), name: adminName, role: "classAdmin", code: adminCode, groupId: null,
      active: true, title: "班主任", targets: { income: 0, expense: 0, benefit: 0, hours: 0 } };
    store.members.push(admin);
    // 家书公开起点 = 建班当天，之前导入的历史家书保持仅作者可见
    store.settings = { ...(store.settings || {}), letterOpenSince: todayCN() };
    save();
    return json(res, 200, { token: issueToken(admin.id), member: { id: admin.id, name: admin.name, role: admin.role, title: admin.title } });
  }
  if (u === "/api/admin/export" || u === "/api/console/export") {
    return csvReport(res, authWithQuery(req, url), url, u === "/api/admin/export");
  }
  if (u === "/api/login" && POST) {
    const { name, code } = await readBody(req);
    const m = store.members.find(x => x.name === name && String(x.code) === String(code) && x.active);
    if (!m) return json(res, 401, { error: "姓名或登录码不正确" });
    return json(res, 200, { token: issueToken(m.id), member: pub(m) });
  }
  if (u === "/api/pick-login" && POST) {
    const { memberId, code } = await readBody(req);
    const m = store.members.find(x => x.id === memberId && String(x.code) === String(code) && x.active);
    if (!m) return json(res, 401, { error: "登录码不正确" });
    return json(res, 200, { token: issueToken(m.id), member: pub(m) });
  }
  if (u === "/api/logout" && POST) { dropToken(req); return json(res, 200, { ok: true }); }
  if (!me) return json(res, 401, { error: "请先登录" });
  if (["/api/guide/seen", "/api/monthly-rankings", "/api/letter-library", "/api/letter-honors", "/api/letter-honors/class", "/api/letter-honors/nominate", "/api/letter-honors/school"].includes(u)) {
    if (await honorApi(req, res, url, me) === false) return json(res, 405, { error: "请求方法不支持" });
    return;
  }

  if (u === "/api/console") {
    if (req.method !== "GET") return json(res, 405, { error: "仅支持读取" });
    return json(res, 200, consoleData(me, url));
  }
  if (u === "/api/console/member") {
    const member = personInStudyScope(me, url.searchParams.get("memberId"));
    const month = validMonth(url.searchParams.get("month"));
    const mon = memberMonth(month, member.id);
    const { days, ...totals } = mon;
    return json(res, 200, { member: pub(member), month, totals, days });
  }
  if (u === "/api/console/letters") {
    const permissions = consolePermissions(me);
    if (!permissions.overview) return json(res, 403, { error: "无权查看学习内容" });
    const selected = url.searchParams.get("group");
    if (selected) requireConsoleGroup(me, selected);
    const allowed = selected ? [selected] : permissions.scheduleGroups;
    const list = store.letters.filter(l => allowed.includes(l.groupId) && (l.date >= letterOpenSince() || l.authorId === me.id))
      .sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id)).slice(0, 200).map(letterBrief);
    return json(res, 200, { list });
  }
  // ---- 通用 ----
  if (u === "/api/bootstrap") {
    const t = todayCN(), ym = t.slice(0, 7);
    const mon = memberMonth(ym, me.id);
    return json(res, 200, {
      className: store.className, member: pub(me), roleLabel: roleLabel(me), today: t, guideSeen: !!store.guideSeen[me.id],
      canSelectClass: canSelectClass(me), canRegisterSchool: canRegisterSchool(me),
      activities: store.activities.filter(a => !a.auto), specials: store.specials,
      myToday: memberDay(t, me.id),
      myMonthTotals: { income: mon.income, expense: mon.expense, benefit: mon.benefit, hours: mon.hours },
      myPending: store.approvals.filter(a => a.memberId === me.id && a.status === "pending").length,
      letterToday: me.groupId ? letterTodayFor(effGid(me)) : null,
      myReviewDone: me.groupId ? reviewDone(effGid(me), t, me.id) : false,
      myWeekLetter: (() => {
        if (!me.groupId) return null;
        const l = myWeekLetter(me.id, isoWeekOf(t));
        return l ? { uploaded: true, late: l.late, date: l.date } : { uploaded: false, late: false, date: null };
      })(),
      myDutyDay: (() => {
        if (!me.groupId) return null;
        const days = [...new Set(myDutyDays(effGid(me), me.id))].sort((a, b) => a - b);
        return days.length ? days.map(d => "周" + "一二三四五六日"[d]).join("/") : null;
      })(),
      managed: managedGroupOf(me), managedGroups: managedGroupsOf(me),
      consoleAccess: consolePermissions(me).access, consolePermissions: consolePermissions(me),
    });
  }
  if (u === "/api/checkin" && POST) {
    const { actId, on } = await readBody(req);
    const a = act(actId);
    if (!a || a.auto) return json(res, 400, { error: "该项目无需手动打卡" });
    if (!me.groupId) return json(res, 403, { error: "管理人员无需打卡" });
    const t = todayCN();
    const d = (store.records[t] = store.records[t] || {});
    const r = (d[me.id] = d[me.id] || { items: {}, customs: [] });
    if (on) r.items[actId] = true;
    else delete r.items[actId];
    save();
    return json(res, 200, { ok: true, myToday: memberDay(t, me.id) });
  }
  if (u === "/api/special" && POST) {
    const { key, note, amount } = await readBody(req);
    const sp = store.specials.find(s => s.key === key);
    if (!sp) return json(res, 400, { error: "无效项目" });
    if (!me.groupId) return json(res, 403, { error: "管理人员不申报大项" });
    store.approvals.push({
      id: crypto.randomBytes(5).toString("hex"), memberId: me.id, memberName: me.name, groupId: me.groupId,
      date: todayCN(), key, name: sp.name, note: note || "",
      amount: sp.fixed ? sp.income : (Number(amount) || 0), income: sp.fixed ? sp.income : 0,
      expense: sp.expense, hours: sp.hours, status: "pending",
      createdAt: Date.now(), decidedAt: 0,
    });
    save();
    return json(res, 200, { ok: true, msg: "已提交，待审批" });
  }
  if (u === "/api/my") {
    const ym = url.searchParams.get("month") || todayCN().slice(0, 7);
    const mon = memberMonth(ym, me.id);
    return json(res, 200, {
      month: ym,
      days: Object.fromEntries(Object.entries(mon.days).map(([d, r]) => [d, { income: r.income, expense: r.expense, benefit: r.benefit, hours: r.hours, checked: r.checked }])),
      totals: { income: mon.income, expense: mon.expense, benefit: mon.benefit, hours: mon.hours },
      targets: me.targets,
      rate: me.targets.income ? +(mon.income / me.targets.income).toFixed(3) : 0,
      unitValue: mon.hours ? +(mon.benefit / mon.hours).toFixed(1) : null,
    });
  }
  if (u === "/api/group") {
    if (!me.groupId) return json(res, 403, { error: "管理人员请使用控制台查看全班" });
    const ym = url.searchParams.get("month") || todayCN().slice(0, 7);
    return json(res, 200, groupBoard(ym, effGid(me), todayCN()));
  }

  // ---- 家书（按任务组） ----
  if (u === "/api/letters") {
    if (!me.groupId) return json(res, 400, { error: "无小组" });
    const egid = effGid(me);
    // 新家书看本任务组的（供点评）；历史家书跟人走——自己写的无论当年挂在哪个组名下都能看到（辅导员跨组）
    const list = store.letters.filter(l => (l.date >= letterOpenSince() && l.groupId === egid) || l.authorId === me.id)
      .sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id)).slice(0, 60).map(letterBrief);
    const wk = isoWeekOf(todayCN());
    const mine = myWeekLetter(me.id, wk);
    return json(res, 200, { today: letterTodayFor(egid), myReviewDone: reviewDone(egid, todayCN(), me.id),
      myWeekLetter: mine ? { uploaded: true, late: mine.late, date: mine.date } : { uploaded: false, late: false, date: null },
      week: isoWeekOf(todayCN()), weekBoard: weekBoard(egid), list });
  }
  if (u === "/api/letter/submit" && POST) {
    const { content, image, forMemberId } = await readBody(req);
    if (!me.groupId) return json(res, 403, { error: "管理人员不发布家书" });
    const egid = effGid(me);
    const t = todayCN(), g = groupById(egid);
    const wk = isoWeekOf(t);
    // 代传：家书算被帮人的，帮传人记录在 helperName
    let author = me;
    if (forMemberId && forMemberId !== me.id) {
      author = store.members.find(x => x.id === forMemberId && x.active);
      if (!author || effGid(author) !== egid) return json(res, 400, { error: "代传对象必须是本任务组成员" });
    }
    if (myWeekLetter(author.id, wk)) return json(res, 400, { error: forMemberId ? `${author.name} 本周家书已上传` : "本周家书已上传（每人每周一篇）" });
    const ctext = String(content || "").trim();
    if (!ctext && !image) return json(res, 400, { error: "请写点内容或附一张图" });
    let images = [];
    if (image) {
      const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(image);
      if (!m) return json(res, 400, { error: "图片格式不支持" });
      if (m[2].length > 2.8e6) return json(res, 400, { error: "图片过大（限2MB）" });
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      const fn = crypto.randomBytes(8).toString("hex") + "." + (m[1] === "jpeg" ? "jpg" : m[1]);
      fs.writeFileSync(path.join(UPLOAD_DIR, fn), Buffer.from(m[2], "base64"));
      images.push("/uploads/" + fn);
    }
    const late = letterLate(egid, author.id, t);
    const helper = author.id !== me.id ? me.name : "";
    const ldate = letterDateOf(ctext, t); // 几号的家书登记几号（正文【分享时间】优先）
    store.letters.push({ id: crypto.randomBytes(5).toString("hex"), groupId: egid, authorId: author.id, authorName: author.name, helperName: helper,
      date: ldate, content: ctext, images, late, featured: false, featuredWeek: "", comments: [] });
    save();
    const who = helper ? `（${author.name}）` : "";
    return json(res, 200, { ok: true, late, date: ldate, msg: (late ? "已发布（迟交）" : "已发布，等待大家点评") + (helper ? `，已计入${author.name}名下` : "") });
  }
  if (u === "/api/letter/comment" && POST) {
    const { letterId, text } = await readBody(req);
    const l = store.letters.find(x => x.id === letterId);
    if (!l) return json(res, 400, { error: "家书不存在" });
    if (!(l.authorId === me.id || (l.date >= letterOpenSince() && l.groupId === effGid(me)))) return json(res, 403, { error: "无权点评该家书" });
    const t = String(text || "").trim();
    if (!t) return json(res, 400, { error: "写点点评内容吧" });
    if (l.authorId === me.id) return json(res, 400, { error: "作者是自己，无需点评" });
    if (l.comments.some(c => c.memberId === me.id)) return json(res, 400, { error: "今天已点评过了" });
    l.comments.push({ id: crypto.randomBytes(4).toString("hex"), memberId: me.id, name: me.name, text: t, at: Date.now(), reply: null });
    save();
    return json(res, 200, { ok: true });
  }
  if (u === "/api/letter/reply" && POST) { // 作者回复感谢
    const { letterId, commentId, text } = await readBody(req);
    const l = store.letters.find(x => x.id === letterId);
    if (!l) return json(res, 400, { error: "家书不存在" });
    if (l.authorId !== me.id) return json(res, 403, { error: "只有家书作者可以回复" });
    const c = l.comments.find(x => x.id === commentId);
    if (!c) return json(res, 400, { error: "点评不存在" });
    const t = String(text || "").trim();
    if (!t) return json(res, 400, { error: "写点回复内容吧" });
    c.reply = { text: t, at: Date.now() };
    save();
    return json(res, 200, { ok: true });
  }

  // ---- 组务：组长与辅导员同权；学委在学习条线管理排班 ----
  if (u === "/api/leader/adjust" && POST) {
    const { groupId, memberId, date, amount, label, note } = await readBody(req);
    const g = requireConsoleGroup(me, groupId, "manageGroups");
    const m = store.members.find(x => x.id === memberId && x.active);
    const day = validDate(date);
    const value = Number(amount);
    if (!m || !Number.isFinite(value) || value === 0) return json(res, 400, { error: "成员或调整金额无效" });
    if (effGid(m) !== g.id) return json(res, 403, { error: "只能操作本任务组成员" });
    const d = (store.records[day] = store.records[day] || {});
    const r = (d[memberId] = d[memberId] || { items: {}, customs: [] });
    r.customs.push({ id: crypto.randomBytes(4).toString("hex"), amount: value, label: label || "组务调整", note: note || "" });
    save();
    return json(res, 200, { ok: true });
  }
  if (u === "/api/leader/member" && POST) {
    const { groupId, name, code, target } = await readBody(req);
    const g = requireConsoleGroup(me, groupId, "manageGroups");
    if (!String(name || "").trim() || !String(code || "").trim()) return json(res, 400, { error: "姓名和登录码必填" });
    const income = target == null ? 10000 : Number(target);
    if (!Number.isFinite(income) || income < 0) return json(res, 400, { error: "目标无效" });
    store.members.push({ id: crypto.randomBytes(5).toString("hex"), name: String(name).trim(), role: "member", code: String(code), groupId: g.id, active: true, title: "", taskGroupId: null,
      targets: { income, expense: 4000, benefit: income - 4000, hours: 55 } });
    save();
    return json(res, 200, { ok: true });
  }
  if (["/api/leader/member/toggle", "/api/leader/member/resetcode"].includes(u) && POST) {
    const { groupId, memberId, code } = await readBody(req);
    const g = requireConsoleGroup(me, groupId, "manageGroups");
    const member = store.members.find(m => m.id === memberId);
    const capability = u.endsWith("/toggle") ? "canToggleAccount" : "canManageAccount";
    if (!member || effGid(member) !== g.id || !accountCapabilities(me, member)[capability])
      return json(res, 403, { error: "只能管理本任务组的普通成员账号" });
    if (capability === "canToggleAccount") return json(res, 200, toggleMemberAccount(member));
    if (!String(code || "").trim()) return json(res, 400, { error: "登录码必填" });
    return json(res, 200, resetMemberCode(member, code));
  }
  if (u === "/api/leader/letter-config" && POST) {
    const { groupId, deadline, plan } = await readBody(req);
    const g = requireConsoleGroup(me, groupId || url.searchParams.get("group"));
    if (deadline != null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(deadline)) return json(res, 400, { error: "截止时间应为 HH:mm" });
    if (plan != null) {
      const valid = taskMembers(g.id).map(m => m.id);
      if (!Array.isArray(plan) || plan.some(e => !e || !valid.includes(e.memberId) || !Number.isInteger(e.day) || e.day < 0 || e.day > 6)) return json(res, 400, { error: "排班包含无效成员或日期" });
      const seen = new Set();
      g.letterPlan = plan.filter(e => { const key = e.memberId + ":" + e.day; if (seen.has(key)) return false; seen.add(key); return true; }).map(e => ({ memberId: e.memberId, day: e.day }));
    }
    if (deadline != null) g.letterDeadline = deadline;
    save();
    return json(res, 200, { ok: true, deadline: g.letterDeadline, plan: g.letterPlan });
  }
  if (u === "/api/leader/letter-config" && req.method === "GET") {
    const g = requireConsoleGroup(me, url.searchParams.get("group"));
    const members = taskMembers(g.id).map(m => {
      const mon = memberMonth(todayCN().slice(0, 7), m.id);
      return { id: m.id, name: m.name, officer: officerTitle(g, m.id), income: mon.income, target: m.targets.income };
    });
    const names = id => store.members.find(m => m.id === id)?.name || "";
    return json(res, 200, { group: { id: g.id, name: g.name, myTitle: officerTitle(g, me.id) }, deadline: g.letterDeadline || "21:00",
      plan: (g.letterPlan || []).map(e => ({ memberId: e.memberId, name: names(e.memberId), day: e.day })),
      candidates: taskMembers(g.id).map(m => ({ id: m.id, name: m.name })), members });
  }

  // ---- 管理控制台（班主任/副班主任/班长） ----
  if (u.startsWith("/api/admin/")) {
    try { need("admin"); } catch (e) { return json(res, e.code, { error: e.msg }); }
  } else return json(res, 404, { error: "not found" });

  if (u === "/api/admin/class") {
    const ym = url.searchParams.get("month") || todayCN().slice(0, 7);
    const t = todayCN();
    return json(res, 200, {
      className: store.className, month: ym, today: t,
      groups: store.groups.map(g => ({ ...groupBoard(ym, g.id, t), letterToday: letterTodayFor(g.id) })),
      pending: store.approvals.filter(a => a.status === "pending"),
      members: store.members.map(pub),
    });
  }
  if (u === "/api/admin/group" && POST) {
    const { name } = await readBody(req);
    if (!name) return json(res, 400, { error: "组名必填" });
    store.groups.push({ id: "g_" + crypto.randomBytes(4).toString("hex"), name, leaderId: "", letterDeadline: "21:00", letterCycleStart: todayCN(), letterOrder: [], letterPlan: [] });
    save();
    return json(res, 200, { ok: true });
  }
  if (u === "/api/admin/class/officer" && POST) {
    const { position, memberId } = await readBody(req);
    if (!CLASS_LINES.includes(position)) return json(res, 400, { error: "班委职务无效" });
    const m = memberId ? store.members.find(x => x.id === memberId && x.active) : null;
    if (memberId && !m) return json(res, 400, { error: "请选择有效成员" });
    store.classOfficers[position] = m?.id || "";
    save();
    return json(res, 200, { ok: true });
  }
  if (u === "/api/admin/group/officer" && POST) {
    const { groupId, position, memberId } = await readBody(req);
    const g = groupById(groupId);
    if (!g || !Object.hasOwn(OFFICERS, position)) return json(res, 400, { error: "小组或职务无效" });
    const m = memberId ? store.members.find(x => x.id === memberId && x.active) : null;
    if (memberId && !m) return json(res, 400, { error: "请选择有效成员" });
    if (m && position === "fudao" && !m.groupId) return json(res, 400, { error: "辅导员须有个人所属组，才能参加辅导员组学习" });
    if (m && position !== "fudao" && m.groupId !== g.id && effGid(m) !== g.id) return json(res, 400, { error: "该职务须由本组成员担任" });
    g[position + "Id"] = m?.id || "";
    if (m && position === "fudao") counselorTaskGroup(m);
    if (m && position === "leader" && !(g.letterPlan || []).some(e => e.memberId === m.id) && effGid(m) === g.id) g.letterPlan.push({ memberId: m.id, day: 0 });
    save();
    return json(res, 200, { ok: true });
  }
  if (u === "/api/admin/group/leader" && POST) {
    return json(res, 400, { error: "请使用 /api/admin/group/officer" });
  }
  if (u === "/api/admin/member" && POST) {
    const { name, code, groupId, target } = await readBody(req);
    if (!name || !code || !groupId) return json(res, 400, { error: "姓名/登录码/小组必填" });
    store.members.push({ id: crypto.randomBytes(5).toString("hex"), name, role: "member", code: String(code), groupId, active: true, title: "", taskGroupId: null,
      targets: { income: target || 10000, expense: 4000, benefit: (target || 10000) - 4000, hours: 55 } });
    const g = groupById(groupId);
    if (g) (g.letterPlan = g.letterPlan || []).push({ memberId: store.members[store.members.length - 1].id, day: 0 });
    save();
    return json(res, 200, { ok: true });
  }
  if (u === "/api/admin/member/taskgroup" && POST) { // 设置成员的任务组（辅导员跨组）
    const { memberId, taskGroupId } = await readBody(req);
    const m = store.members.find(x => x.id === memberId);
    if (!m) return json(res, 400, { error: "参数错误" });
    if (store.groups.some(g => g.fudaoId === m.id)) {
      const cg = store.groups.find(g => g.name === "辅导员组" || g.id === "g_fudao");
      if (taskGroupId !== cg?.id) return json(res, 400, { error: "辅导员的个人学习任务归辅导员组" });
    }
    if (taskGroupId === null || taskGroupId === "") m.taskGroupId = null;
    else {
      const g = groupById(taskGroupId);
      if (!g) return json(res, 400, { error: "小组不存在" });
      m.taskGroupId = g.id;
    }
    save();
    return json(res, 200, { ok: true, taskGroupId: m.taskGroupId });
  }
  if (u === "/api/admin/member/toggle" && POST) {
    const { memberId } = await readBody(req);
    const m = store.members.find(x => x.id === memberId);
    if (!m || isAdmin(m)) return json(res, 400, { error: "管理人员账号不能在此停用" });
    return json(res, 200, toggleMemberAccount(m));
  }
  if (u === "/api/admin/member/resetcode" && POST) {
    const { memberId, code } = await readBody(req);
    const m = store.members.find(x => x.id === memberId);
    if (!m || !code) return json(res, 400, { error: "参数错误" });
    return json(res, 200, resetMemberCode(m, code));
  }
  if (u === "/api/admin/approvals") {
    const st = url.searchParams.get("status") || "pending";
    return json(res, 200, store.approvals.filter(a => a.status === st));
  }
  if (u === "/api/admin/approval/decide" && POST) {
    const { id, ok, amount } = await readBody(req);
    const a = store.approvals.find(x => x.id === id && x.status === "pending");
    if (!a) return json(res, 400, { error: "无效申请" });
    if (ok) {
      if (amount != null && Number(amount) > 0) { a.income = Number(amount); a.amount = Number(amount); }
      a.status = "approved";
    } else a.status = "rejected";
    a.decidedAt = Date.now();
    save();
    return json(res, 200, { ok: true });
  }
  if (u === "/api/admin/award" && POST) {
    const { memberId, amount, label, note } = await readBody(req);
    const m = store.members.find(x => x.id === memberId);
    if (!m || !amount) return json(res, 400, { error: "参数不完整" });
    const d = (store.records[todayCN()] = store.records[todayCN()] || {});
    const r = (d[memberId] = d[memberId] || { items: {}, customs: [] });
    r.customs.push({ id: crypto.randomBytes(4).toString("hex"), amount, label: label || "管理加分", note: note || "" });
    save();
    return json(res, 200, { ok: true });
  }
  if (["/api/admin/letter/feature", "/api/admin/letter/unfeature"].includes(u) && POST) {
    return json(res, 410, { error: "旧版每周精选已停用，请使用每日班级/塾里优秀家书；历史记录保持不变" });
  }
  if (u === "/api/admin/activity" && POST) {
    const { id, income, expense, hours, bonus, penalty, weeklyMax } = await readBody(req);
    const a = act(id);
    if (!a) return json(res, 400, { error: "无效项目" });
    if (income != null) a.income = Number(income) || 0;
    if (expense != null) a.expense = Number(expense) || 0;
    if (hours != null) a.hours = Number(hours) || 0;
    if (weeklyMax != null) a.weeklyMax = Number(weeklyMax) || 0;
    if (bonus != null || penalty != null) {
      a.groupRule = a.groupRule || { bonus: 0, penalty: 0, bonusName: "全组奖励", penaltyName: "凝聚补救" };
      if (bonus != null) a.groupRule.bonus = Number(bonus) || 0;
      if (penalty != null) a.groupRule.penalty = Number(penalty) || 0;
    }
    save();
    return json(res, 200, { ok: true, activity: a });
  }
  return json(res, 404, { error: "not found" });
}

// ---------- 静态 ----------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  // The release transaction briefly blocks writes while validating a schema upgrade.
  // This lets a failed release restore its shutdown backup without losing user edits.
  if (!["GET", "HEAD"].includes(req.method) && fs.existsSync(path.join(DATA_DIR, ".release-maintenance"))) {
    res.setHeader("Retry-After", "2");
    return json(res, 503, { error: "系统正在更新，请稍后重试" });
  }
  if (url.pathname === "/healthz" && req.method === "GET") return json(res, 200, { ok: true });
  if (url.pathname.startsWith("/api/")) return api(req, res, url).catch(e => json(res, e.code || 500, { error: e.msg || e.message }));
  let p = url.pathname === "/" ? "/index.html" : url.pathname;
  const root = p.startsWith("/uploads/") ? DATA_DIR : path.join(ROOT, "public");
  const rel = p.startsWith("/uploads/") ? p : p;
  const file = path.join(root, path.normalize(rel).replace(/^([.][.][/\\])+/, ""));
  const allowed = p.startsWith("/uploads/") ? file.startsWith(DATA_DIR) : file.startsWith(path.join(ROOT, "public"));
  if (!allowed) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (e, buf) => {
    if (e) { res.writeHead(404); return res.end("404"); }
    const isHtml = file.endsWith("index.html");
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      "Cache-Control": isHtml ? "no-cache" : "public, max-age=86400", // HTML 不缓存保证更新即时生效，静态资源带哈希可长缓存
    });
    res.end(buf);
  });
});
load();
initTokens();
server.listen(PORT, process.env.HOST || "0.0.0.0", () => console.log(`[gratitude-ledger] :${PORT} today=${todayCN()} groups=${store.groups.length} members=${store.members.length} sessions=${Object.keys(store.tokens || {}).length}`));
