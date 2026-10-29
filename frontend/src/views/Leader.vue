<script setup>
import { ref, onMounted } from "vue";
import { api, fmt } from "../api";
import { showToast } from "vant";

const props = defineProps({ member: Object });
const g = ref(null);
const today = ref("");
const adj = ref({ memberId: "", label: "组长调整", amount: "", note: "" });
const add = ref({ name: "", code: "", target: 10000 });
const lcfg = ref({ deadline: "21:00", plan: [], candidates: [] });
const dlDialog = ref(false);
const dlText = ref("");
const pickShow = ref(false);
const pickDay = ref(0);
const pickCols = ref([]);

async function load() {
  const bs = await api("/api/bootstrap");
  today.value = bs.today;
  lcfg.value = await api("/api/leader/letter-config");
  g.value = { name: lcfg.value.group.name, myTitle: lcfg.value.group.myTitle, members: lcfg.value.members };
  if (!adj.value.memberId && g.value.members.length) adj.value.memberId = g.value.members[0].id;
}
onMounted(load);

function saveDeadline() { dlText.value = lcfg.value.deadline; dlDialog.value = true; }
async function submitDeadline() {
  if (!/^\d{1,2}:\d{2}$/.test(dlText.value.trim())) return showToast("格式：如 21:00");
  const j = await api("/api/leader/letter-config", { deadline: dlText.value.trim().padStart(5, "0") });
  lcfg.value.deadline = j.deadline;
  dlDialog.value = false;
  showToast("已保存");
}
const DAYS = "一二三四五六日";
const planOfDay = d => lcfg.value.plan.filter(p => p.day === d);
function openPick(d) {
  pickDay.value = d;
  const onDay = planOfDay(d).map(p => p.memberId);
  pickCols.value = lcfg.value.candidates.filter(c => !onDay.includes(c.id)).map(c => ({ text: c.name, value: c.id }));
  if (!pickCols.value.length) return showToast("该天已排满所有可选成员");
  pickShow.value = true;
}
async function onPick({ selectedOptions }) {
  const c = selectedOptions[0];
  lcfg.value.plan.push({ memberId: c.value, name: c.text, day: pickDay.value });
  pickShow.value = false;
  await pushPlan();
}
async function removeFrom(day, memberId) {
  lcfg.value.plan = lcfg.value.plan.filter(p => !(p.day === day && p.memberId === memberId));
  await pushPlan();
}
async function pushPlan() {
  try {
    await api("/api/leader/letter-config", { plan: lcfg.value.plan.map(p => ({ memberId: p.memberId, day: p.day })) });
    showToast("排班已保存");
  } catch (e) { showToast(e.message); load(); }
}

async function adjust() {
  if (!adj.value.memberId || !adj.value.amount) return showToast("请选成员并填金额");
  await api("/api/leader/adjust", { memberId: adj.value.memberId, date: today.value, amount: Number(adj.value.amount), label: adj.value.label, note: adj.value.note });
  showToast("已计入今日");
  load();
}
async function addMember() {
  if (!add.value.name || !add.value.code) return showToast("姓名和登录码必填");
  await api("/api/leader/member", { name: add.value.name, code: add.value.code, target: Number(add.value.target) || 10000 });
  showToast("已添加");
  add.value = { name: "", code: "", target: 10000 };
  load();
}
</script>

<template>
  <div class="page" v-if="g">
    <div class="card">
      <div class="hd">组务管理 <small>{{ g.name }} · 我的职务：{{ g.myTitle }}</small></div>
      <div class="mini">组长、学委、辅导员均可排班、加分、添加组员</div>
    </div>

    <div class="card">
      <div class="hd">加分/扣分 <small>计入成员今日</small></div>
      <van-picker :columns="g.members.map(m => ({ text: m.name, value: m.id }))" v-model="adj.memberId" />
      <van-field v-model="adj.label" label="名目" placeholder="如：优秀家书 +500" />
      <van-field v-model="adj.amount" label="金额" type="number" placeholder="正数加分 / 负数扣分" />
      <van-field v-model="adj.note" label="备注" placeholder="选填" />
      <van-button type="primary" round block class="hx-btn" style="margin-top:10px" @click="adjust">提交</van-button>
    </div>

    <div class="card">
      <div class="hd">📅 家书排班 <small>谁来写、周几写（可多人同一天）</small></div>
      <div class="mini" style="margin-bottom:8px">截止时刻：<b class="pos">{{ lcfg.deadline }}</b>
        <span style="color:#d3321f;margin-left:12px" @click="saveDeadline">修改</span>
        · 已排 {{ lcfg.plan.length }} 人次
      </div>
      <div v-for="d in 7" :key="d" class="plan-row">
        <span class="mini" style="width:40px;flex-shrink:0">周{{ DAYS[d - 1] }}</span>
        <div class="plan-tags">
          <van-tag v-for="p in planOfDay(d - 1)" :key="p.memberId" type="primary" plain size="large" closeable
            style="margin:2px 4px 2px 0" @close="removeFrom(d - 1, p.memberId)">{{ p.name }}</van-tag>
          <van-tag size="large" color="#fdeeea" text-color="#d3321f" style="margin:2px 0" @click="openPick(d - 1)">＋ 添加</van-tag>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="hd">本组成员</div>
      <div v-for="m in g.members" :key="m.id" class="rank-row">
        <span style="flex:1">{{ m.name }}<van-tag v-if="m.officer" type="primary" plain style="margin-left:6px">{{ m.officer }}</van-tag>
          <div class="mini">收入 {{ fmt(m.income) }} / 目标 {{ fmt(m.target) }}</div>
        </span>
      </div>
    </div>

    <div class="card">
      <div class="hd">添加组员</div>
      <van-field v-model="add.name" label="姓名" placeholder="新成员姓名" />
      <van-field v-model="add.code" label="登录码" type="digit" placeholder="如 810008" />
      <van-field v-model="add.target" label="月目标" type="number" placeholder="默认 10000" />
      <van-button type="primary" round block plain class="hx-btn" style="margin-top:10px" @click="addMember">添加</van-button>
    </div>

    <van-dialog v-model:show="dlDialog" title="每日家书截止时刻" show-cancel-button @confirm="submitDeadline" @cancel="dlDialog = false">
      <van-field v-model="dlText" label="HH:MM" placeholder="如 21:00" />
    </van-dialog>

    <van-popup v-model:show="pickShow" position="bottom" round>
      <van-picker :columns="pickCols" title="添加到该天" @confirm="onPick" @cancel="pickShow = false" />
    </van-popup>
  </div>
</template>

<style scoped>
.plan-row { display: flex; align-items: flex-start; padding: 7px 0; border-bottom: 1px solid #f4f0ee; }
.plan-row:last-child { border-bottom: none; }
.plan-tags { flex: 1; display: flex; flex-wrap: wrap; align-items: center; }
</style>
