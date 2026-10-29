<script setup>
import { ref } from "vue";
import { api } from "../api";

const emit = defineEmits(["done"]);
const className = ref("");
const adminName = ref("");
const adminCode = ref("");
const groups = ref(["", "", ""]);
const error = ref("");
const submitting = ref(false);

function addGroup() {
  if (groups.value.length >= 12) { error.value = "分组最多 12 个"; return; }
  groups.value.push("");
}
function removeGroup(index) { groups.value.splice(index, 1); error.value = ""; }

async function submit() {
  if (submitting.value) return;
  error.value = "";
  const name = className.value.trim();
  const admin = adminName.value.trim();
  const code = adminCode.value.trim();
  if (!name) { error.value = "请填写班级名称"; return; }
  if (!admin) { error.value = "请填写班主任姓名"; return; }
  if (code.length < 6) { error.value = "登录码至少 6 位"; return; }
  if (code.length > 32) { error.value = "登录码最多 32 位"; return; }
  const groupNames = [...new Set(groups.value.map(g => g.trim()).filter(Boolean))];
  const body = { className: name, adminName: admin, adminCode: code };
  if (groupNames.length) body.groups = groupNames;
  submitting.value = true;
  try {
    const j = await api("/api/setup", body);
    if (!j.token) throw new Error("初始化失败，请重试");
    emit("done", j.member, j.token);
  } catch (e) {
    error.value = e.status === 409 ? "该班级已完成初始化，请刷新页面后登录" : (e.message || "初始化失败，请重试");
  } finally { submitting.value = false; }
}
</script>

<template>
  <div class="page setup-page">
    <form class="card setup-card" novalidate @submit.prevent="submit">
      <div class="setup-head">
        <span class="setup-seal" aria-hidden="true">初</span>
        <div>
          <h1 class="setup-title">首次初始化</h1>
          <p class="mini setup-sub">第一次启动，请先填写班级基础信息。完成后会自动创建班主任账号并进入系统。</p>
        </div>
      </div>

      <div class="setup-fields">
        <van-field v-model="className" label="班级名称" placeholder="例如：三年级二班" maxlength="30" required clearable />
        <van-field v-model="adminName" label="班主任" placeholder="管理员姓名" maxlength="20" required clearable />
        <van-field v-model="adminCode" type="password" label="登录码" placeholder="6–32 位" maxlength="32" required clearable />
      </div>
      <p class="setup-hint">登录码用于统一登录，请勿使用弱口令（如 123456、生日或手机号后六位）。</p>

      <div class="setup-groups">
        <div class="setup-groups-head"><b>分组名称</b><span class="mini">可选，最多 12 个；全部留空则自动创建「学习组」</span></div>
        <div v-for="(g, index) in groups" :key="index" class="setup-group-row">
          <van-field v-model="groups[index]" :placeholder="'分组 ' + (index + 1) + '，如：第一组'" maxlength="20" />
          <button type="button" class="setup-remove" :aria-label="'删除分组 ' + (index + 1)" @click="removeGroup(index)">×</button>
        </div>
        <button type="button" class="setup-add" @click="addGroup">＋ 添加分组</button>
      </div>

      <p v-if="error" class="setup-error" role="alert">{{ error }}</p>
      <van-button type="primary" round block class="hx-btn setup-submit" native-type="submit" :loading="submitting" loading-text="正在初始化…">完成初始化，进入系统</van-button>
    </form>
  </div>
</template>

<style scoped>
.setup-page { padding-top: 28px; padding-bottom: 40px; }
.setup-card { max-width: 480px; margin: 0 auto; padding: 22px 18px 20px; }
.setup-head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 14px; }
.setup-seal { flex: none; display: grid; place-items: center; width: 42px; height: 42px; border-radius: 11px; background: var(--hx-red); color: #fff; font-family: serif; font-size: 22px; }
.setup-title { margin: 0; font-size: 20px; line-height: 1.4; color: #26303e; }
.setup-sub { margin: 6px 0 0; line-height: 1.7; }
.setup-fields { margin: 0 -18px; border-top: 1px solid #f4f0ee; }
.setup-fields :deep(.van-cell) { padding-left: 18px; padding-right: 18px; }
.setup-hint { margin: 12px 0 16px; padding: 10px 12px; border-radius: 10px; background: #fdf6ef; color: #a4714f; font-size: 12px; line-height: 1.7; }
.setup-groups { margin: 0 -18px; padding-top: 14px; border-top: 1px solid #f4f0ee; }
.setup-groups-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; flex-wrap: wrap; padding: 0 18px 2px; }
.setup-groups-head b { font-size: 14px; color: #26303e; }
.setup-group-row { display: flex; align-items: center; gap: 2px; padding-right: 18px; }
.setup-group-row :deep(.van-cell) { background: transparent; padding-left: 18px; }
.setup-group-row :deep(.van-cell)::after { left: 18px; right: 18px; }
.setup-remove { flex: none; width: 30px; height: 30px; border-radius: 50%; border: 1px solid #f0d7d1; background: #fff4f1; color: var(--hx-red); font-size: 18px; line-height: 1; cursor: pointer; }
.setup-remove:active { background: #fdeeea; }
.setup-add { margin: 8px 18px 0; width: calc(100% - 36px); border: 1px dashed #e6dcd6; border-radius: 10px; background: #fffdfb; color: #a4714f; padding: 9px 12px; font: inherit; font-size: 13px; cursor: pointer; }
.setup-add:active { border-color: var(--hx-red); color: var(--hx-red); }
.setup-error { margin: 14px 0 0; padding: 10px 12px; border-radius: 10px; background: #fdeeeb; color: #b02a19; font-size: 13px; line-height: 1.6; }
.setup-submit { margin-top: 16px; }
@media(max-width:360px) { .setup-card { padding: 18px 14px 16px; } .setup-fields, .setup-groups { margin-left: -14px; margin-right: -14px; } .setup-fields :deep(.van-cell), .setup-group-row :deep(.van-cell) { padding-left: 14px; } .setup-add { margin-left: 14px; margin-right: 14px; width: calc(100% - 28px); } }
</style>
