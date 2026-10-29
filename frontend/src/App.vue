<script setup>
import { ref, onMounted, watch } from "vue";
import { showToast } from "vant";
import { getToken, setToken, api } from "./api";
import Login from "./views/Login.vue";
import Setup from "./views/Setup.vue";
import Today from "./views/Today.vue";
import Letters from "./views/Letters.vue";
import Mine from "./views/Mine.vue";
import Group from "./views/Group.vue";
import Console from "./views/Console.vue";
import FirstUseGuide from "./components/FirstUseGuide.vue";

const token = ref(getToken());
const member = ref(null);
const className = ref("");
const setupState = ref("checking"); // checking=检查中 needed=需要初始化 done=可直接使用
const roleLabel = ref("");
const tab = ref("today");
const isAdminRole = ref(false);
const hasGroup = ref(true);
const managed = ref(null); // 我担任职务的组（组长/学委/辅导员）
const consoleAccess = ref(false);
const startupError = ref("");
const starting = ref(false);
const guideOpen = ref(false);
const guideSeen = ref(true);
const lettersSection = ref("");

function applyMember(m, label, mg) {
  member.value = m;
  roleLabel.value = label || m.title || (m.role === "leader" ? "组长" : m.role === "monitor" ? "班长" : m.role === "classAdmin" ? "班主任" : "组员");
  isAdminRole.value = ["classAdmin", "monitor"].includes(m.role);
  hasGroup.value = !!m.groupId;
  managed.value = mg || null;
}
async function refreshAccess(initial = false) {
  const bs = await api("/api/bootstrap", null, { silent: true });
  applyMember(bs.member, bs.roleLabel, bs.managed);
  if (bs.className) className.value = bs.className;
  consoleAccess.value = bs.consoleAccess ?? isAdminRole.value;
  if (initial) guideSeen.value = !!bs.guideSeen;
  if (initial) tab.value = consoleAccess.value && (window.matchMedia("(min-width: 1024px)").matches || !hasGroup.value) ? "console" : hasGroup.value ? "today" : "mine";
  else if (!consoleAccess.value && tab.value === "console") tab.value = hasGroup.value ? "today" : "mine";
  if (tab.value === "today" && !guideSeen.value) guideOpen.value = true;
}
async function startSession() {
  starting.value = true; startupError.value = "";
  try { await refreshAccess(true); }
  catch (e) {
    if (e.status === 401) { localStorage.removeItem("hx_token"); token.value = ""; }
    else startupError.value = e.message || "暂时无法连接，请重试";
  } finally { starting.value = false; }
}
async function checkSetup() {
  let data = null;
  try {
    const r = await fetch("/api/setup", { headers: { Accept: "application/json" } });
    if (r.ok) data = await r.json();
  } catch (_) { /* 接口不可用时按已初始化处理，保持原有登录流程 */ }
  if (data?.className) className.value = data.className;
  setupState.value = data?.needsSetup ? "needed" : "done";
}
async function onSetupDone(m, t) {
  setupState.value = "done";
  await onLoggedIn(m, t);
}
async function onLoggedIn(m, t) { setToken(t); token.value = t; applyMember(m); await startSession(); }
function goLetters(section = "") { lettersSection.value = section; tab.value = "letters"; }
function onLogout() {
  fetch("/api/logout", { method: "POST", headers: { Authorization: "Bearer " + getToken() } }).catch(() => {});
  localStorage.removeItem("hx_token");
  token.value = "";
  member.value = null;
  guideOpen.value = false;
  guideSeen.value = true;
}
async function dismissGuide() {
  if (!guideOpen.value) return;
  guideOpen.value = false;
  if (guideSeen.value) return;
  guideSeen.value = true;
  try { await api("/api/guide/seen", {}); }
  catch (_) { showToast("使用说明已关闭，稍后仍可再次查看"); }
}
watch(tab, value => { if (value === "today" && member.value && !guideSeen.value) guideOpen.value = true; });

onMounted(async () => {
  await checkSetup();
  if (setupState.value !== "done" || !token.value) return;
  await startSession();
});
</script>

<template>
  <div v-if="setupState === 'checking'" class="page"><div class="card">正在检查初始化状态…</div></div>
  <Setup v-else-if="setupState === 'needed'" @done="onSetupDone" />
  <Login v-else-if="!token" @logged-in="onLoggedIn" />
  <div v-else-if="startupError" class="page"><div class="card"><p>{{ startupError }}</p><van-button @click="startSession">重新加载</van-button><van-button @click="onLogout">重新登录</van-button></div></div>
  <div v-else-if="starting" class="page"><div class="card">正在加载班级资料…</div></div>
  <div v-else-if="member" :class="{ 'console-mode': tab === 'console' }">
    <div class="header-bar">
      <div>
        <div class="t">{{ className }}<em>·学习收益核算</em></div>
        <div class="sub">{{ (member.taskGroupName || member.groupName) ? (member.taskGroupName || member.groupName) + " · " : "" }}{{ member.name }}（{{ roleLabel }}）</div>
      </div>
      <div class="app-actions">
        <button class="help-button" @click="guideOpen = true"><van-icon name="question-o" />使用说明</button>
        <button v-if="consoleAccess" class="mode-button" @click="tab = tab === 'console' ? (hasGroup ? 'today' : 'mine') : 'console'">{{ tab === 'console' ? '个人学习' : '管理控制台' }}</button>
        <van-button size="small" plain hairline type="default" @click="onLogout">退出</van-button>
      </div>
    </div>

    <Today v-if="tab === 'today' && hasGroup" :member="member" @goto-letters="goLetters" />
    <Letters v-else-if="tab === 'letters'" :member="member" :initial-section="lettersSection" />
    <Mine v-else-if="tab === 'mine'" :member="member" />
    <Group v-else-if="tab === 'group' && hasGroup" :member="member" />
    <Console v-else-if="tab === 'console' && consoleAccess" :member="member" @changed="refreshAccess().catch(() => {})" />

    <van-tabbar v-if="tab !== 'console'" v-model="tab" fixed placeholder @change="value => { if (value === 'letters') lettersSection = ''; }">
      <van-tabbar-item v-if="hasGroup" name="today" icon="clock-o">今日</van-tabbar-item>
      <van-tabbar-item name="letters" icon="mail">家书</van-tabbar-item>
      <van-tabbar-item name="mine" icon="chart-trending-o">我的</van-tabbar-item>
      <van-tabbar-item v-if="hasGroup" name="group" icon="friends-o">小组</van-tabbar-item>
      <van-tabbar-item v-if="consoleAccess" name="console" icon="setting-o">控制台</van-tabbar-item>
    </van-tabbar>
    <FirstUseGuide :show="guideOpen" :first-use="!guideSeen" :class-name="className" @close="dismissGuide" />
  </div>
</template>

<style scoped>
.help-button { display: inline-flex; align-items: center; gap: 4px; border: 0; background: transparent; color: #a46e4f; font: inherit; font-size: 12px; padding: 8px 0; white-space: nowrap; cursor: pointer; }
@media(max-width:600px) { .header-bar { gap: 8px; flex-wrap: wrap; } .app-actions { margin-left: auto; gap: 10px; } }
</style>
