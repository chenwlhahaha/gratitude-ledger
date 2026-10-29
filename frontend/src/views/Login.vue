<script setup>
import { ref, onMounted } from "vue";
import { api, setToken } from "../api";
import { showFailToast } from "vant";

const emit = defineEmits(["logged-in"]);
const step = ref(1); // 1=选组 2=选人 3=输码
const data = ref(null);
const group = ref(null);
const picked = ref(null);
const managerMode = ref(false);
const code = ref("");

onMounted(async () => {
  data.value = await fetch("/api/groups-public").then(r => r.json());
});

function pickGroup(g) { group.value = g; picked.value = null; step.value = 2; }
function pickMember(m) { picked.value = m; code.value = ""; step.value = 3; }
function back(n) { step.value = n; if (n === 1) { group.value = null; picked.value = null; managerMode.value = false; } if (n === 2) picked.value = null; }
function openManagers() { managerMode.value = true; picked.value = null; code.value = ""; step.value = 2; }

async function login() {
  if (!code.value.trim()) return showFailToast("请输入登录码");
  try {
    const j = await fetch("/api/pick-login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberId: picked.value.id, code: code.value.trim() }),
    }).then(r => r.json());
    if (!j.token) return showFailToast(j.error || "登录失败");
    emit("logged-in", j.member, j.token);
  } catch (e) { showFailToast("网络错误"); }
}
</script>

<template>
  <div class="login-wrap" v-if="data">
    <div class="login-box">
      <div class="logo-circle">谢</div>
      <h2>{{ data.className }} · 学习收益核算</h2>

      <!-- 第1步：选组 -->
      <template v-if="step === 1">
        <p class="mini" style="text-align:center;margin:8px 0 16px">选择你的小组</p>
        <div class="g-grid">
          <button type="button" v-for="g in data.groups" :key="g.id" class="g-card" @click="pickGroup(g)">
            <div class="g-name">{{ g.name }}</div>
            <div class="g-sub">{{ g.members.length }} 人 · 家书 {{ g.deadline }} 截止</div>
          </button>
        </div>
        <button type="button" class="mgr-entry" @click="openManagers">班级管理 / 班委入口 →</button>
      </template>

      <!-- 第2步：选人 -->
      <template v-else-if="step === 2">
        <p class="mini" style="text-align:center;margin:8px 0 14px">
          {{ managerMode ? "选择身份" : group.name + " · 你是？" }}
          <span class="back" @click="back(1)">返回</span>
        </p>
        <div class="m-grid">
          <button type="button" v-for="m in (managerMode ? data.managers : group.members)" :key="m.id" class="m-card" @click="pickMember(m)">
            <span>{{ m.name }}</span>
            <small v-if="managerMode ? m.title : (m.officer || m.title)">{{ managerMode ? m.title : (m.officer || m.title) }}</small>
          </button>
        </div>
      </template>

      <!-- 第3步：输码 -->
      <template v-else>
        <p class="mini" style="text-align:center;margin:8px 0 14px">
          {{ picked.name }}<template v-if="picked.title">（{{ picked.title }}）</template>
          <span class="back" @click="back(2)">重选</span>
        </p>
        <van-field v-model="code" type="digit" placeholder="请输入登录码" @keyup.enter="login" style="text-align:center;font-size:20px;letter-spacing:6px" />
        <van-button type="primary" round block class="hx-btn" style="margin-top:16px" @click="login">进 入</van-button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.login-wrap { min-height: 100vh; background: #fff; display: flex; align-items: flex-start; justify-content: center; padding: 60px 20px 20px; }
.login-box { width: min(94vw, 380px); }
h2 { font-size: 20px; text-align: center; color: #222; }
.g-grid { display: grid; gap: 10px; }
.g-card { cursor: pointer; background: #fff; text-align: left; color: inherit; font: inherit; border: 1.5px solid #eee; border-radius: 14px; padding: 16px; }
.g-card:active { border-color: #d3321f; background: #fdeeea; }
.g-name { font-size: 17px; font-weight: 700; }
.g-sub { font-size: 12px; color: #98a2b3; margin-top: 4px; }
.m-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.m-card { cursor: pointer; background: #fff; color: inherit; font: inherit; border: 1.5px solid #eee; border-radius: 12px; padding: 14px 8px; text-align: center; font-size: 15px; }
.m-card:active { border-color: #d3321f; background: #fdeeea; }
.m-card small { display: block; color: #d3321f; font-size: 11px; margin-top: 2px; min-height: 13px; }
.mgr-entry { display: block; width: 100%; cursor: pointer; border: 0; background: transparent; text-align: center; margin-top: 22px; color: #98a2b3; font-size: 13px; }
.mgr-entry:active { color: #d3321f; }
.back { color: #d3321f; margin-left: 10px; font-size: 13px; }
</style>
