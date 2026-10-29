<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { api, fmt, getToken } from "../api";
import { showConfirmDialog } from "vant";

const props = defineProps({ member: Object });
const emit = defineEmits(["changed"]);
const data = ref(null), section = ref("overview"), groupId = ref(""), month = ref("");
const className = computed(() => data.value?.className || "");
const brandSeal = computed(() => className.value.trim().charAt(0));
const loading = ref(false), error = ref(""), notice = ref(""), busy = ref(false);
const scope = computed(() => data.value?.scopeGroups || []);
const p = computed(() => data.value?.permissions || {});
const groups = computed(() => data.value?.groups || []);
const members = computed(() => data.value?.members || []);
const positions = [{ key: "leader", label: "组长" }, { key: "fudao", label: "辅导员" }, { key: "xuewei", label: "学委" }, { key: "jiwei", label: "纪委" }, { key: "guanai", label: "关爱委" }, { key: "huodong", label: "活动委" }];
const lines = positions.slice(2);
const canManage = id => (p.value.manageGroups || []).includes(id);
const canSchedule = id => (p.value.scheduleGroups || []).includes(id);
const studyGroups = computed(() => scope.value.filter(g => g.canStudy));
const workGroups = computed(() => scope.value.filter(g => (!groupId.value || g.id === groupId.value) && (canManage(g.id) || canSchedule(g.id) || g.canStudy)));
const menu = computed(() => [
  { id: "overview", title: "班级／小组概览", sub: "学习情况与收支", show: p.value.overview },
  { id: "work", title: "组务管理", sub: "家书、排班与成员", show: workGroups.value.length > 0 },
  { id: "org", title: "组织与班委", sub: "班委关系与人员", show: p.value.organization },
  { id: "approve", title: "审批管理", sub: "现有活动申请", show: p.value.approvals },
  { id: "standards", title: "收支标准", sub: "班级核算规则", show: p.value.standards },
  { id: "reports", title: "评选与报表", sub: "家书评选与导出", show: p.value.reports },
].filter(x => x.show));
const pageTitle = computed(() => menu.value.find(x => x.id === section.value)?.title || "管理控制台");
const overviewMembers = computed(() => {
  const roster = new Map(members.value.map(m => [m.id, m]));
  const unique = new Map();
  for (const g of groups.value) for (const m of g.members || []) {
    const person = roster.get(m.id);
    if (!unique.has(m.id) || (person?.taskGroupId || person?.groupId) === g.id) unique.set(m.id, m);
  }
  return [...unique.values()];
});
const stats = computed(() => {
  const ms = overviewMembers.value;
  const week = [...new Map(groups.value.flatMap(g => g.weekBoard || []).map(m => [m.id, m])).values()];
  return { total: ms.length, read: ms.filter(m => m.todayRead).length, review: ms.filter(m => m.todayReview).length,
    letter: week.filter(m => m.uploaded).length, letterTotal: week.length, benefit: ms.reduce((s, m) => s + (m.benefit || 0), 0) };
});
let loadSeq = 0;
async function load() {
  const seq = ++loadSeq; loading.value = true; error.value = "";
  try {
    const q = new URLSearchParams(); if (month.value) q.set("month", month.value); if (groupId.value) q.set("group", groupId.value);
    const next = await api("/api/console?" + q);
    if (seq !== loadSeq) return;
    data.value = next; month.value = next.month;
    if (!menu.value.some(x => x.id === section.value)) section.value = menu.value[0]?.id || "org";
    if (!workGroups.value.some(g => g.id === workGroup.value)) workGroup.value = workGroups.value[0]?.id || "";
    if (drawer.value?.type === "group") drawer.value.group = groups.value.find(g => g.id === drawer.value.group.id) || drawer.value.group;
  } catch (e) { if (seq === loadSeq) error.value = e.message; }
  finally { if (seq === loadSeq) loading.value = false; }
}
async function mutate(path, body, message, after) {
  if (busy.value) return false;
  busy.value = true; notice.value = ""; error.value = "";
  try {
    await api(path, body); notice.value = message;
    if (after) await after();
    await load(); emit("changed"); return true;
  } catch (e) { error.value = e.message; return false; }
  finally { busy.value = false; }
}
async function confirmAction(message) {
  return showConfirmDialog({ title: "确认操作", message }).then(() => true).catch(() => false);
}
function changeSection(id) { section.value = id; drawer.value = null; notice.value = ""; }
onMounted(load);

const drawer = ref(null), detailLoading = ref(false), detailError = ref("");
let detailSeq = 0;
function closeDrawer() { detailSeq++; drawer.value = null; detailLoading.value = false; detailError.value = ""; }
function openGroup(g) { detailSeq++; detailLoading.value = false; detailError.value = ""; drawer.value = { type: "group", group: g }; }
async function openMember(m) {
  const seq = ++detailSeq; drawer.value = { type: "member", name: m.name, detail: null }; detailLoading.value = true; detailError.value = "";
  try {
    const detail = await api("/api/console/member?" + new URLSearchParams({ memberId: m.id, month: month.value }));
    if (seq === detailSeq) drawer.value = { type: "member", name: m.name, detail };
  } catch (e) { if (seq === detailSeq) detailError.value = e.message; }
  finally { if (seq === detailSeq) detailLoading.value = false; }
}
function onEscape(e) { if (e.key === "Escape") closeDrawer(); }
onMounted(() => document.addEventListener("keydown", onEscape));
onBeforeUnmount(() => { document.removeEventListener("keydown", onEscape); loadSeq++; detailSeq++; workSeq++; });
const dayRows = computed(() => {
  const days = drawer.value?.detail?.days || {};
  return Array.isArray(days) ? days : Object.entries(days).map(([date, row]) => ({ date, ...row }));
});
function reviewLabel(g, m) {
  const duty = (g.letterToday?.duties || []).some(x => x.id === m.id);
  return duty ? "作者免评" : m.todayReview ? "已完成" : !g.todayStat?.reviewActive ? "等待家书" : "待完成";
}

// 组务复用已有排班、加分、成员接口。
const workGroup = ref(""), config = ref(null), letters = ref([]), workLoading = ref(false), workError = ref("");
const draftDeadline = ref("21:00"), draftPlan = ref([]), planPick = ref({});
const adjustment = ref({ memberId: "", amount: "", label: "组内调整", note: "" });
const addMemberForm = ref({ name: "", code: "", target: 10000 });
const workScope = computed(() => scope.value.find(g => g.id === workGroup.value));
let workSeq = 0;
async function loadWork() {
  const seq = ++workSeq; config.value = null; letters.value = []; workError.value = ""; planPick.value = Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, ""]));
  if (!workGroup.value) { workLoading.value = false; return; }
  workLoading.value = true;
  const gid = workGroup.value;
  try {
    const result = await Promise.allSettled([
      canSchedule(gid) || canManage(gid) ? api("/api/leader/letter-config?group=" + encodeURIComponent(gid)) : Promise.resolve(null),
      workScope.value?.canStudy ? api("/api/console/letters?group=" + encodeURIComponent(gid)) : Promise.resolve({ list: [] }),
    ]);
    if (seq !== workSeq) return;
    if (result[0].status === "fulfilled") {
      config.value = result[0].value;
      if (config.value) { draftDeadline.value = config.value.deadline; draftPlan.value = config.value.plan.map(x => ({ ...x })); adjustment.value.memberId = config.value.members[0]?.id || ""; }
    }
    if (result[1].status === "fulfilled") letters.value = result[1].value.list || [];
    workError.value = result.filter(x => x.status === "rejected").map(x => x.reason.message).join("；");
  } finally { if (seq === workSeq) workLoading.value = false; }
}
watch([workGroup, section], () => { if (section.value === "work" || section.value === "reports") loadWork(); });
const planFor = day => draftPlan.value.filter(x => x.day === day);
function addPlan(day) {
  const id = planPick.value[day];
  if (!id || draftPlan.value.some(x => x.day === day && x.memberId === id)) return;
  const candidate = config.value.candidates.find(x => x.id === id);
  if (candidate) draftPlan.value.push({ day, memberId: id, name: candidate.name });
  planPick.value[day] = "";
}
function removePlan(day, id) { draftPlan.value = draftPlan.value.filter(x => !(x.day === day && x.memberId === id)); }
async function savePlan() {
  if (!draftDeadline.value) { error.value = "请填写家书截止时间"; return; }
  await mutate("/api/leader/letter-config", { groupId: workGroup.value, deadline: draftDeadline.value, plan: draftPlan.value.map(({ day, memberId }) => ({ day, memberId })) }, "家书排班与截止时间已保存", loadWork);
}
async function adjust() {
  if (!adjustment.value.memberId || !Number(adjustment.value.amount) || !adjustment.value.label.trim()) { error.value = "请选择成员，填写名目和非零金额"; return; }
  if (await confirmAction(`将为所选成员计入今日「${adjustment.value.label}」${adjustment.value.amount}，确认提交？`))
    await mutate("/api/leader/adjust", { ...adjustment.value, groupId: workGroup.value, date: data.value.today, amount: Number(adjustment.value.amount) }, "已计入成员今日收支", async () => { adjustment.value.amount = ""; adjustment.value.note = ""; await loadWork(); });
}
async function addMember() {
  if (!addMemberForm.value.name.trim() || !addMemberForm.value.code.trim()) { error.value = "姓名和登录码必填"; return; }
  await mutate("/api/leader/member", { ...addMemberForm.value, name: addMemberForm.value.name.trim(), groupId: workGroup.value, target: Number(addMemberForm.value.target) }, "成员已添加", async () => { addMemberForm.value = { name: "", code: "", target: 10000 }; await loadWork(); });
}
function openLetter(l) { detailSeq++; detailLoading.value = false; detailError.value = ""; drawer.value = { type: "letter", letter: l }; }
async function featureLetter(l) {
  if (!(await confirmAction(l.featured ? `取消 ${l.authorName} 的精选家书？` : `将 ${l.authorName} 的家书设为精选并按现有规则计分？`))) return;
  await mutate(l.featured ? "/api/admin/letter/unfeature" : "/api/admin/letter/feature", { letterId: l.id }, l.featured ? "已取消精选" : "已设为精选", async () => { await loadWork(); if (drawer.value?.type === "letter") drawer.value.letter = letters.value.find(x => x.id === l.id) || l; });
}

const officerEdit = ref(null), officerMember = ref(""), orgSearch = ref(""), newGroup = ref("");
const orgGroups = computed(() => scope.value.filter(g => !groupId.value || g.id === groupId.value));
const orgMembers = computed(() => members.value.filter(m => (!groupId.value || m.groupId === groupId.value || m.taskGroupId === groupId.value) && (!orgSearch.value || m.name.includes(orgSearch.value))));
const officerCandidates = computed(() => (data.value?.appointmentCandidates || members.value).filter(m => m.active !== false && (!officerEdit.value?.groupId || (officerEdit.value.position === "fudao" ? !!m.groupId : m.groupId === officerEdit.value.groupId || m.taskGroupId === officerEdit.value.groupId))));
function memberTitles(m) {
  const titles = [];
  if (m.role === "monitor") titles.push("班长");
  if (m.role === "classAdmin") titles.push(m.title || "班主任");
  for (const officer of data.value.classOfficers || []) if (officer.memberId === m.id) titles.push(officer.label || "班级" + (lines.find(x => x.key === officer.position)?.label || "班委"));
  for (const g of scope.value) for (const pos of positions) if (g.officers?.[pos.key]?.id === m.id) titles.push(g.name + "·" + pos.label);
  return [...new Set(titles)].join("、") || m.title || "组员";
}
const editingCounselor = computed(() => !!memberEdit.value && scope.value.some(g => g.officers?.fudao?.id === memberEdit.value.id));
function editOfficer(group, pos) {
  officerEdit.value = { groupId: group?.id || "", groupName: group?.name || "全班", position: pos.key, label: pos.label };
  officerMember.value = group ? group.officers?.[pos.key]?.id || "" : data.value.classOfficers?.find(x => x.position === pos.key)?.memberId || "";
}
async function saveOfficer() {
  const target = officerEdit.value;
  await mutate(target.groupId ? "/api/admin/group/officer" : "/api/admin/class/officer", { ...(target.groupId ? { groupId: target.groupId } : {}), position: target.position, memberId: officerMember.value || null }, "班委任命已更新", () => { officerEdit.value = null; });
}
async function createGroup() {
  if (!newGroup.value.trim()) return;
  await mutate("/api/admin/group", { name: newGroup.value.trim() }, "小组已创建", () => { newGroup.value = ""; });
}
const memberEdit = ref(null), taskGroupId = ref(""), resetCode = ref("");
const canManageAccount = m => !!m && (p.value.fullAdmin || m.canManageAccount === true);
const canToggleAccount = m => !!m && (p.value.fullAdmin ? !["monitor", "classAdmin"].includes(m.role) : m.canToggleAccount === true);
const memberManagementVisible = computed(() => p.value.fullAdmin || members.value.some(canManageAccount));
function accountAction(m, action) {
  return { path: `/api/${p.value.fullAdmin ? "admin" : "leader"}/member/${action}`, body: { memberId: m.id, ...(!p.value.fullAdmin ? { groupId: m.taskGroupId || m.groupId } : {}) } };
}
function editMember(m) { if (!canManageAccount(m)) return; memberEdit.value = m; taskGroupId.value = m.taskGroupId || ""; resetCode.value = ""; }
async function saveTaskGroup() { await mutate("/api/admin/member/taskgroup", { memberId: memberEdit.value.id, taskGroupId: taskGroupId.value || null }, "学习任务组已更新", () => { memberEdit.value = null; }); }
async function saveCode() {
  if (!canManageAccount(memberEdit.value)) return;
  if (!resetCode.value.trim()) { error.value = "请填写新登录码"; return; }
  const action = accountAction(memberEdit.value, "resetcode");
  await mutate(action.path, { ...action.body, code: resetCode.value.trim() }, "登录码已重置", () => { memberEdit.value = null; resetCode.value = ""; });
}
async function toggleMember(m) {
  if (!canToggleAccount(m)) return;
  if (!(await confirmAction(`确认${m.active !== false ? "停用" : "启用"} ${m.name} 的账号？`))) return;
  const action = accountAction(m, "toggle");
  await mutate(action.path, action.body, "账号状态已更新", () => { memberEdit.value = null; });
}

const approvalStatus = ref("pending"), approvalAmounts = ref({});
const approvalLabels = { pending: "待处理", approved: "已通过", rejected: "已驳回" };
const approvalList = computed(() => (data.value?.approvals || data.value?.pending || []).filter(a => (a.status || "pending") === approvalStatus.value));
async function decide(a, ok) {
  const amount = Number(approvalAmounts.value[a.id]);
  if (ok && !a.fixed && !a.income && !(amount > 0)) { error.value = "请填写大于零的批准金额"; return; }
  if (!(await confirmAction(`确认${ok ? "通过" : "驳回"} ${a.memberName} 的「${a.name}」申请？`))) return;
  await mutate("/api/admin/approval/decide", { id: a.id, ok, ...(ok && amount > 0 ? { amount } : {}) }, ok ? "申请已通过" : "申请已驳回");
}
const editActivity = ref(null);
function openActivity(a) { editActivity.value = JSON.parse(JSON.stringify(a)); }
async function saveActivity() {
  const a = editActivity.value;
  if (!(await confirmAction(`保存「${a.name}」标准后全班生效，确认保存？`))) return;
  await mutate("/api/admin/activity", { id: a.id, income: Number(a.income), expense: Number(a.expense), hours: Number(a.hours), ...(a.groupRule ? { bonus: Number(a.groupRule.bonus || 0), penalty: Number(a.groupRule.penalty || 0) } : {}) }, "收支标准已保存", () => { editActivity.value = null; });
}
const award = ref({ memberId: "", label: "优秀家书 +500", amount: 500, note: "" });
async function giveAward() {
  if (!award.value.memberId || !Number(award.value.amount) || !award.value.label.trim()) { error.value = "请选择成员并填写名目和金额"; return; }
  if (!(await confirmAction(`确认计入今日「${award.value.label}」${award.value.amount}？`))) return;
  await mutate("/api/admin/award", { ...award.value, amount: Number(award.value.amount) }, "评选加分已计入成员今日", () => { award.value.note = ""; });
}
function exportUrl(gid = "") { return "/api/console/export?" + new URLSearchParams({ token: getToken(), month: month.value, ...(gid ? { group: gid } : groupId.value ? { group: groupId.value } : {}) }); }
</script>

<template>
  <div class="pc-console">
    <aside class="console-sidebar">
      <div class="console-brand"><span>{{ brandSeal }}</span><div>班级管理工作台<small>{{ className ? className + ' · 共同精进' : '共同精进' }}</small></div></div>
      <nav aria-label="控制台导航"><button v-for="(item, i) in menu" :key="item.id" :class="{ active: section === item.id }" @click="changeSection(item.id)"><span class="nav-index">0{{ i + 1 }}</span><span>{{ item.title }}<small>{{ item.sub }}</small></span><b>›</b></button></nav>
      <div class="sidebar-person"><b>{{ member.name }}</b><span>{{ data?.roleLabel || member.title }}</span><small>学习归属：{{ member.taskGroupName || member.groupName || '未分组' }}</small></div>
    </aside>
    <main class="console-main">
      <header class="console-heading"><div><div class="console-eyebrow">{{ className }} / 管理控制台</div><h1>{{ pageTitle }}</h1><p>{{ data?.today }} · {{ p.fullAdmin ? '全班管理' : '按当前职务显示负责范围' }}</p></div><div class="console-filters"><label>核算月份<input v-model="month" type="month" :disabled="loading || busy" @change="load" /></label><label>管理范围<select v-model="groupId" :disabled="loading || busy" @change="load"><option value="">全部授权小组</option><option v-for="g in scope" :key="g.id" :value="g.id">{{ g.name }}</option></select></label><button class="c-button" :disabled="loading || busy" @click="load">{{ loading ? '刷新中…' : '刷新' }}</button></div></header>
      <div v-if="error" class="console-alert error" role="alert">{{ error }} <button :disabled="loading || busy" @click="load">重试</button></div>
      <div v-if="notice" class="console-alert success" role="status">{{ notice }}</div>
      <div v-if="!data && loading" class="console-empty">正在加载控制台…</div>
      <template v-if="data">
        <div v-if="loading" class="console-refresh" role="status">正在更新数据…</div>
        <fieldset class="console-content" :disabled="busy || loading">
        <template v-if="section === 'overview'">
          <div class="console-stats"><article><span>今日读书</span><b>{{ stats.read }}<small>/ {{ stats.total }}</small></b><p>按成员去重统计</p></article><article><span>今日点评</span><b>{{ stats.review }}<small>/ {{ stats.total }}</small></b><p>含当日作者免评</p></article><article><span>本周家书</span><b>{{ stats.letter }}<small>/ {{ stats.letterTotal }}</small></b><p>按已排班成员统计</p></article><article class="accent"><span>{{ month }} 学习收益</span><b>{{ fmt(stats.benefit) }}</b><p>收入减费用 · 按成员去重</p></article></div>
          <section class="console-panel"><div class="panel-title"><div><h2>各组学习情况</h2><p>今日完成情况与所选月份核算结果</p></div><span class="c-badge">{{ groups.length }} 个小组</span></div><div class="table-wrap"><table class="c-table"><thead><tr><th>小组</th><th>今日读书</th><th>今日点评</th><th>本周家书</th><th>今日轮值</th><th>收入</th><th>费用</th><th>收益</th><th></th></tr></thead><tbody><tr v-for="g in groups" :key="g.id"><td><button class="c-link strong" @click="openGroup(g)">{{ g.name }}</button></td><td><span :class="['c-status', { done: g.todayStat?.read === g.todayStat?.total && g.todayStat?.total }]">{{ g.todayStat?.read || 0 }} / {{ g.todayStat?.total || 0 }}</span></td><td>{{ g.todayStat?.reviewActive ? `${g.todayStat.review} / ${g.todayStat.total}` : '等待家书' }}</td><td>{{ (g.weekBoard || []).filter(x => x.uploaded).length }} / {{ g.weekBoard?.length || 0 }}</td><td>{{ (g.letterToday?.duties || []).map(x => x.name + (x.uploaded ? ' ✓' : ' 待传')).join('、') || '无排班' }}</td><td>{{ fmt(g.totals?.income) }}</td><td>{{ fmt(g.totals?.expense) }}</td><td class="c-red strong">{{ fmt(g.totals?.benefit) }}</td><td><button class="c-link" @click="openGroup(g)">查看成员 ›</button></td></tr></tbody></table></div><div v-if="!groups.length" class="console-empty">当前范围暂无学习数据</div></section>
          <section class="console-panel"><div class="panel-title"><div><h2>本周家书与今日排班</h2><p>查看各组家书提交情况</p></div></div><div class="group-week-grid"><article v-for="g in groups" :key="g.id"><div class="week-head"><b>{{ g.name }}</b><small>每日截止 {{ g.letterToday?.deadline || '—' }}</small></div><div v-for="m in g.weekBoard || []" :key="m.id" class="week-member"><span>{{ m.name }} <small>{{ m.dutyDay || '未排班' }}</small></span><span :class="['c-status', { done: m.uploaded }]">{{ m.uploaded ? (m.late ? '迟交' : '已上传') : '待上传' }}</span></div><p v-if="!g.weekBoard?.length" class="muted">暂无家书排班</p></article></div></section>
        </template>

        <template v-else-if="section === 'work'">
          <section class="console-panel compact"><label class="inline-label">当前组务<select v-model="workGroup" :disabled="workLoading"><option v-for="g in workGroups" :key="g.id" :value="g.id">{{ g.name }}</option></select></label><p class="muted">管理负责组；个人学习任务归 {{ member.taskGroupName || member.groupName || '所属任务组' }}。</p></section>
          <div v-if="workError" class="console-alert error">{{ workError }} <button @click="loadWork">重试</button></div><div v-if="workLoading" class="console-empty">正在加载组务…</div>
          <template v-else>
            <section v-if="config && canSchedule(workGroup)" class="console-panel"><div class="panel-title"><div><h2>家书排班</h2><p>可安排同一天多人，保存后同步生效</p></div><div class="inline-label">每日截止<input v-model="draftDeadline" type="time" aria-label="家书截止时间" required /><button class="c-button primary" @click="savePlan">保存排班</button></div></div><div class="plan-week"><article v-for="day in 7" :key="day"><b>周{{ '一二三四五六日'[day - 1] }}</b><div class="plan-chips"><span v-for="item in planFor(day - 1)" :key="item.memberId">{{ item.name }}<button :aria-label="'移除' + item.name" @click="removePlan(day - 1, item.memberId)">×</button></span><small v-if="!planFor(day - 1).length">未排班</small></div><select v-model="planPick[day - 1]" :aria-label="'周' + '一二三四五六日'[day - 1] + '添加成员'" @change="addPlan(day - 1)"><option value="">＋ 添加成员</option><option v-for="m in config.candidates.filter(m => !planFor(day - 1).some(x => x.memberId === m.id))" :key="m.id" :value="m.id">{{ m.name }}</option></select></article></div></section>
            <div v-if="config && canManage(workGroup)" class="console-two-col"><section class="console-panel"><div class="panel-title"><div><h2>组内加分／扣分</h2><p>计入 {{ data.today }} 的收支</p></div></div><form class="c-form" @submit.prevent="adjust"><label>成员<select v-model="adjustment.memberId" required><option v-for="m in config.members" :key="m.id" :value="m.id">{{ m.name }}</option></select></label><label>名目<input v-model="adjustment.label" required /></label><label>金额<input v-model="adjustment.amount" type="number" step="any" required placeholder="正数加分，负数扣分" /></label><label>备注<input v-model="adjustment.note" /></label><button class="c-button primary" type="submit">提交调整</button></form></section><section class="console-panel"><div class="panel-title"><div><h2>添加组员</h2><p>新成员加入 {{ workScope?.name }}</p></div></div><form class="c-form" @submit.prevent="addMember"><label>姓名<input v-model="addMemberForm.name" required /></label><label>登录码<input v-model="addMemberForm.code" required autocomplete="new-password" /></label><label>月收入目标<input v-model="addMemberForm.target" type="number" min="0" required /></label><button class="c-button primary" type="submit">添加成员</button></form></section></div>
            <section v-if="workScope?.canStudy" class="console-panel"><div class="panel-title"><div><h2>家书列表</h2><p>授权范围内可阅读的新家书及本人的历史家书</p></div><span class="c-badge">{{ letters.length }} 篇</span></div><div class="table-wrap"><table class="c-table"><thead><tr><th>日期</th><th>作者</th><th>提交情况</th><th>点评</th><th>精选</th><th></th></tr></thead><tbody><tr v-for="l in letters" :key="l.id"><td>{{ l.date }}</td><td class="strong">{{ l.authorName }}<small v-if="l.helperName"> · {{ l.helperName }}代传</small></td><td>{{ l.late ? '迟交' : '已上传' }}</td><td>{{ l.comments?.length || 0 }} 条</td><td>{{ l.featured ? '精选家书' : '—' }}</td><td><button class="c-link" @click="openLetter(l)">阅读全文 ›</button></td></tr></tbody></table></div><div v-if="!letters.length" class="console-empty">暂无可阅读的家书</div></section>
          </template>
        </template>

        <template v-else-if="section === 'org'">
          <section class="console-panel"><div class="panel-title"><div><h2>班级班委</h2><p>班级委员统筹各组同名委员；任命由班长、班主任管理</p></div></div><div class="class-officer-grid"><article v-for="pos in lines" :key="pos.key" :class="{ 'line-active': (p.lines || []).includes(pos.key) }"><span>班级{{ pos.label }}</span><b>{{ data.classOfficers?.find(x => x.position === pos.key)?.name || '空缺' }}</b><small>统筹各组{{ pos.label }}</small><button v-if="p.fullAdmin" class="c-link" @click="editOfficer(null, pos)">任命／调整</button></article></div></section>
          <section class="console-panel"><div class="panel-title"><div><h2>各组班委</h2><p>所属组与辅导负责组分别管理，辅导员的学习任务在自己的任务组</p></div></div><div class="table-wrap"><table class="c-table"><thead><tr><th>小组</th><th v-for="pos in positions" :key="pos.key">{{ pos.label }}</th></tr></thead><tbody><tr v-for="g in orgGroups" :key="g.id"><td class="strong">{{ g.name }}</td><td v-for="pos in positions" :key="pos.key"><button v-if="p.fullAdmin" class="officer-cell" @click="editOfficer(g, pos)"><span>{{ g.officers?.[pos.key]?.name || '空缺' }}</span><small>调整</small></button><span v-else>{{ g.officers?.[pos.key]?.name || '—' }}</span></td></tr></tbody></table></div><div v-if="!orgGroups.length" class="console-empty">当前范围暂无小组</div><form v-if="p.fullAdmin" class="new-group-form" @submit.prevent="createGroup"><label>新建小组<input v-model="newGroup" placeholder="小组名称" required /></label><button class="c-button" type="submit">创建小组</button></form></section>
          <section class="console-panel"><div class="panel-title"><div><h2>{{ p.overview ? '成员名单' : '对应条线组委' }}</h2><p>辅导员组单独显示为学习任务归属</p></div><input v-model="orgSearch" placeholder="按姓名查找" aria-label="按姓名查找" /></div><div class="table-wrap"><table class="c-table"><thead><tr><th>姓名</th><th>所属组</th><th>学习任务组</th><th>身份</th><th>状态</th><th v-if="memberManagementVisible"></th></tr></thead><tbody><tr v-for="m in orgMembers" :key="m.id"><td class="strong">{{ m.name }}</td><td>{{ m.groupName || '未分组' }}</td><td>{{ m.taskGroupName || m.groupName || '未分组' }}</td><td>{{ memberTitles(m) }}</td><td><span :class="['c-status', { done: m.active !== false }]">{{ m.active === false ? '已停用' : '正常' }}</span></td><td v-if="memberManagementVisible"><button v-if="canManageAccount(m)" class="c-link" @click="editMember(m)">管理成员</button><span v-else class="muted">—</span></td></tr></tbody></table></div><div v-if="!orgMembers.length" class="console-empty">没有符合条件的成员</div></section>
        </template>

        <template v-else-if="section === 'approve'">
          <section class="console-panel"><div class="panel-title"><div><h2>活动申请</h2><p>查看申请内容并处理</p></div><div class="c-segment"><button v-for="(label, key) in approvalLabels" :key="key" :class="{ active: approvalStatus === key }" @click="approvalStatus = key">{{ label }} <small>{{ (data.approvals || data.pending || []).filter(a => (a.status || 'pending') === key).length }}</small></button></div></div><div class="table-wrap"><table class="c-table"><thead><tr><th>申请人／日期</th><th>活动</th><th>说明</th><th>收入／申请金额</th><th>费用／工时</th><th>{{ approvalStatus === 'pending' ? '处理' : '状态' }}</th></tr></thead><tbody><tr v-for="a in approvalList" :key="a.id"><td><b>{{ a.memberName }}</b><small class="block">{{ a.date }}</small></td><td>{{ a.name }}</td><td class="wrap-text">{{ a.note || '—' }}</td><td>{{ a.income || a.amount || '待定' }}</td><td>{{ fmt(a.expense) }} / {{ a.hours || 0 }}h</td><td><div v-if="approvalStatus === 'pending'" class="approval-actions"><input v-if="!a.fixed && !a.income" v-model="approvalAmounts[a.id]" type="number" min="0" placeholder="批准金额" :aria-label="a.memberName + '的批准金额'" /><button class="c-button primary small" @click="decide(a, true)">通过</button><button class="c-button small" @click="decide(a, false)">驳回</button></div><span v-else class="c-status">{{ approvalLabels[a.status] }}</span></td></tr></tbody></table></div><div v-if="!approvalList.length" class="console-empty">暂无{{ approvalLabels[approvalStatus] }}申请</div></section>
        </template>

        <template v-else-if="section === 'standards'">
          <section class="console-panel"><div class="panel-title"><div><h2>班级收支标准</h2><p>核算沿用当前标准，修改后全班生效</p></div></div><div class="table-wrap"><table class="c-table"><thead><tr><th>学习项目</th><th>收入</th><th>费用</th><th>工时</th><th>全组奖励</th><th>未全员补救</th><th></th></tr></thead><tbody><tr v-for="a in data.activities || []" :key="a.id"><td class="strong">{{ a.name }}</td><td class="c-red">{{ fmt(a.income) }}</td><td>{{ fmt(a.expense) }}</td><td>{{ a.hours }}h</td><td>{{ a.groupRule ? fmt(a.groupRule.bonus) : '—' }}</td><td>{{ a.groupRule ? fmt(a.groupRule.penalty) : '—' }}</td><td><button class="c-link" @click="openActivity(a)">编辑标准</button></td></tr></tbody></table></div><div v-if="!data.activities?.length" class="console-empty">暂无收支标准</div></section>
        </template>

        <template v-else-if="section === 'reports'">
          <div class="console-two-col"><section v-if="p.fullAdmin" class="console-panel"><div class="panel-title"><div><h2>评选加分</h2><p>按现有规则计入成员今日</p></div></div><form class="c-form" @submit.prevent="giveAward"><label>成员<select v-model="award.memberId" required><option value="">选择成员</option><option v-for="m in members.filter(m => m.active !== false && m.groupId)" :key="m.id" :value="m.id">{{ m.groupName || '未分组' }} · {{ m.name }}</option></select></label><label>名目<input v-model="award.label" required /></label><label>金额<input v-model="award.amount" type="number" step="any" required /></label><label>备注<input v-model="award.note" /></label><button class="c-button primary" type="submit">提交评选加分</button></form></section><section class="console-panel"><div class="panel-title"><div><h2>月度统计导出</h2><p>{{ month }} · CSV 文件，可使用 Excel 打开</p></div></div><p class="muted">导出内容与当前账号的授权范围一致。</p><div class="export-list"><a class="c-button primary" :href="exportUrl()">导出{{ groupId ? '当前小组' : p.fullAdmin ? '全班' : '全部授权小组' }}报表</a><a v-for="g in studyGroups.filter(g => !groupId || g.id === groupId)" :key="g.id" class="c-button" :href="exportUrl(g.id)">导出 {{ g.name }}</a></div></section></div>
          <section v-if="p.fullAdmin && workGroups.length" class="console-panel"><div class="panel-title"><div><h2>优秀家书评选</h2><p>阅读家书后设置或取消精选</p></div><select v-model="workGroup" :disabled="workLoading"><option v-for="g in workGroups.filter(g => g.canStudy)" :key="g.id" :value="g.id">{{ g.name }}</option></select></div><div v-if="workError" class="console-alert error">{{ workError }} <button @click="loadWork">重试</button></div><p v-if="workLoading" class="console-empty">正在加载家书…</p><div v-else class="table-wrap"><table class="c-table"><thead><tr><th>日期</th><th>作者</th><th>点评数</th><th>精选状态</th><th></th></tr></thead><tbody><tr v-for="l in letters" :key="l.id"><td>{{ l.date }}</td><td>{{ l.authorName }}</td><td>{{ l.comments?.length || 0 }}</td><td>{{ l.featured ? '已精选' : '未精选' }}</td><td><button class="c-link" @click="openLetter(l)">阅读与评选 ›</button></td></tr></tbody></table><div v-if="!letters.length" class="console-empty">暂无可评选的家书</div></div></section>
        </template>
        </fieldset>
      </template>
    </main>

    <div v-if="drawer" class="console-drawer-mask" @click.self="closeDrawer"><aside class="console-drawer" role="dialog" aria-modal="true" :aria-label="drawer.type === 'group' ? drawer.group.name : drawer.type === 'member' ? drawer.name : '家书详情'"><header><div><span class="console-eyebrow">{{ drawer.type === 'group' ? '小组详情' : drawer.type === 'member' ? '成员学习明细' : '家书阅读' }}</span><h2>{{ drawer.type === 'group' ? drawer.group.name : drawer.type === 'member' ? drawer.name : drawer.letter.authorName + '的家书' }}</h2></div><button class="drawer-close" aria-label="关闭详情" @click="closeDrawer">×</button></header><div class="drawer-body"><div v-if="detailLoading" class="console-empty">正在加载成员明细…</div><p v-if="detailError" class="console-alert error">{{ detailError }}</p><template v-if="drawer.type === 'group'"><p class="muted">{{ data.today }} 今日情况 · {{ month }} 月度收支</p><div class="table-wrap"><table class="c-table"><thead><tr><th>成员</th><th>读书</th><th>点评</th><th>月收益</th></tr></thead><tbody><tr v-for="m in drawer.group.members" :key="m.id"><td><button class="c-link strong" @click="openMember(m)">{{ m.name }}</button><small class="block">{{ m.officer }}</small></td><td><span :class="['c-status', { done: m.todayRead }]">{{ m.todayRead ? '已完成' : '待完成' }}</span></td><td>{{ reviewLabel(drawer.group, m) }}</td><td class="c-red">{{ fmt(m.benefit) }}</td></tr></tbody></table></div><div v-if="!drawer.group.members?.length" class="console-empty">暂无成员</div></template><template v-if="drawer.type === 'member' && drawer.detail"><p class="muted">所属组：{{ drawer.detail.member.groupName || '未分组' }} · 学习任务组：{{ drawer.detail.member.taskGroupName || drawer.detail.member.groupName || '未分组' }}</p><div class="member-totals"><div v-for="(label, key) in { income: '收入', expense: '费用', benefit: '收益', hours: '工时' }" :key="key"><span>{{ label }}</span><b>{{ fmt(drawer.detail.totals?.[key]) }}</b></div></div><h3>{{ month }} 每日明细</h3><div class="table-wrap"><table class="c-table"><thead><tr><th>日期</th><th>收入</th><th>费用</th><th>收益</th><th>工时</th></tr></thead><tbody><tr v-for="day in dayRows" :key="day.date"><td>{{ day.date }}</td><td>{{ fmt(day.income) }}</td><td>{{ fmt(day.expense) }}</td><td class="c-red">{{ fmt(day.benefit) }}</td><td>{{ day.hours || 0 }}h</td></tr></tbody></table></div></template><template v-if="drawer.type === 'letter'"><div class="letter-meta"><span>{{ drawer.letter.groupName }} · {{ drawer.letter.date }}</span><span v-if="drawer.letter.featured" class="c-badge">精选家书</span></div><p v-if="drawer.letter.helperName" class="muted">{{ drawer.letter.helperName }}代传</p><div class="console-letter-content">{{ drawer.letter.content || '（图片家书）' }}</div><img v-for="img in drawer.letter.images || []" :key="img" :src="img" alt="家书附图" class="console-letter-image" /><button v-if="p.fullAdmin" class="c-button primary" :disabled="busy" @click="featureLetter(drawer.letter)">{{ drawer.letter.featured ? '取消精选' : '设为精选家书' }}</button><h3>点评 · {{ drawer.letter.comments?.length || 0 }}</h3><div v-for="c in drawer.letter.comments || []" :key="c.id" class="console-comment"><b>{{ c.name }}</b><p>{{ c.text }}</p><div v-if="c.reply" class="comment-reply">作者回复：{{ c.reply.text }}</div></div><p v-if="!drawer.letter.comments?.length" class="muted">暂无点评</p></template></div></aside></div>

    <div v-if="officerEdit || memberEdit || editActivity" class="console-modal-mask" @click.self="!busy && (officerEdit = null, memberEdit = null, editActivity = null)"><section class="console-modal" role="dialog" aria-modal="true"><header><h2>{{ officerEdit ? `${officerEdit.groupName} · ${officerEdit.label}任命` : memberEdit ? `${memberEdit.name} · 成员管理` : `编辑标准 · ${editActivity.name}` }}</h2><button class="drawer-close" :disabled="busy" aria-label="关闭" @click="officerEdit = null; memberEdit = null; editActivity = null">×</button></header><div v-if="error" class="console-alert error" role="alert">{{ error }}</div><fieldset :disabled="busy" class="console-content"><form v-if="officerEdit" class="c-form" @submit.prevent="saveOfficer"><p class="muted">{{ officerEdit.position === 'fudao' ? '辅导员可从全班成员中选择，学习任务归自己的任务组。' : officerEdit.groupId ? '从本组所属或任务在本组的成员中选择。' : '从全班成员中选择。' }}</p><label>任职成员<select v-model="officerMember"><option value="">空缺（撤销任命）</option><option v-for="m in officerCandidates" :key="m.id" :value="m.id">{{ m.name }} · {{ m.groupName || '未分组' }}</option></select></label><button class="c-button primary" type="submit">{{ busy ? '保存中…' : '保存任命' }}</button></form><div v-else-if="memberEdit" class="c-form"><p class="muted">所属组：{{ memberEdit.groupName || '未分组' }}</p><form v-if="p.fullAdmin" class="c-form" @submit.prevent="saveTaskGroup"><label>学习任务组<select v-model="taskGroupId" :disabled="editingCounselor"><option value="">跟随所属组</option><option v-for="g in scope" :key="g.id" :value="g.id">{{ g.name }}</option></select></label><p v-if="editingCounselor" class="muted">现任辅导员的学习任务归辅导员组，由系统保持该归属。</p><button v-else class="c-button" type="submit">保存任务组</button></form><p v-else class="muted">学习任务组：{{ memberEdit.taskGroupName || memberEdit.groupName || '未分组' }}</p><form v-if="canManageAccount(memberEdit)" class="c-form form-divider" @submit.prevent="saveCode"><label>新登录码<input v-model="resetCode" required autocomplete="new-password" /></label><button class="c-button" type="submit">重置登录码</button></form><button v-if="canToggleAccount(memberEdit)" class="c-button danger" @click="toggleMember(memberEdit)">{{ memberEdit.active !== false ? '停用账号' : '启用账号' }}</button></div><form v-else-if="editActivity" class="c-form" @submit.prevent="saveActivity"><label>收入<input v-model="editActivity.income" type="number" min="0" required /></label><label>费用<input v-model="editActivity.expense" type="number" min="0" required /></label><label>工时<input v-model="editActivity.hours" type="number" min="0" step="0.1" required /></label><template v-if="editActivity.groupRule"><label>全组奖励<input v-model="editActivity.groupRule.bonus" type="number" /></label><label>未全员补救<input v-model="editActivity.groupRule.penalty" type="number" /></label></template><button class="c-button primary" type="submit">{{ busy ? '保存中…' : '保存标准' }}</button></form></fieldset></section></div>
  </div>
</template>
