<script setup>
import { ref, onMounted, computed } from "vue";
import { api, fmt } from "../api";
import { showToast, showConfirmDialog } from "vant";

const props = defineProps({ member: Object });
const emit = defineEmits(["goto-letters"]);
const bs = ref(null);
const loading = ref(false);
const pending = ref(0);
const noteDialog = ref(false);
const noteText = ref("");
const noteTarget = ref(null);

async function load() {
  bs.value = await api("/api/bootstrap");
  pending.value = bs.value.myPending || 0;
}
onMounted(load);

function isChecked(name) {
  return (bs.value?.myToday?.detail || []).some(d => d.type === "item" && d.name === name);
}

async function toggle(a) {
  const on = !isChecked(a.name);
  loading.value = true;
  try {
    const j = await api("/api/checkin", { actId: a.id, on });
    bs.value.myToday = j.myToday;
    showToast(on ? `完成「${a.name}」+${a.income}` : `已取消「${a.name}」`);
  } catch (e) { showToast(e.message); }
  loading.value = false;
}

async function declare(sp) {
  if (sp.fixed) {
    const ok = await showConfirmDialog({ title: `申报「${sp.name}」`, message: `收入 +${fmt(sp.income)}，费用 ${fmt(sp.expense)}，工时 ${sp.hours}h\n提交后待审批入账` }).then(() => true).catch(() => false);
    if (!ok) return;
    return submitSpecial(sp.key, "");
  }
  noteText.value = "";
  noteTarget.value = sp;
  noteDialog.value = true;
}
async function submitSpecial(key, note) {
  try {
    const j = await api("/api/special", { key, note });
    pending.value++;
    showToast(j.msg || "已提交");
  } catch (e) { showToast(e.message); }
}

const daily = computed(() => (bs.value?.activities || []).filter(a => a.freq === "daily"));
const weekly = computed(() => (bs.value?.activities || []).filter(a => a.freq === "weekly"));
const monthly = computed(() => (bs.value?.activities || []).filter(a => a.freq === "monthly"));
const isMyDutyToday = computed(() => (bs.value?.letterToday?.duties || []).some(x => x.id === props.member.id) && !!props.member.groupId);
</script>

<template>
  <div class="page" v-if="bs">
    <div class="stats">
      <div class="s"><b>{{ fmt(bs.myToday.income) }}</b><span>今日收入</span></div>
      <div class="s"><b>{{ fmt(bs.myToday.expense) }}</b><span>今日费用</span></div>
      <div class="s hl"><b>{{ fmt(bs.myToday.benefit) }}</b><span>今日收益</span></div>
      <div class="s"><b>{{ bs.myToday.hours }}</b><span>工时(h)</span></div>
    </div>

    <!-- 每日任务 -->
    <div class="card">
      <div class="hd">🌅 每日任务</div>
      <!-- 1. 家书点评（只评当日轮值者） -->
      <div class="task ck" :class="{ on: bs.myReviewDone }" @click="emit('goto-letters', 'review')">
        <div class="nm">点评当日家书 <span class="who">（今日轮值：{{ (bs.letterToday?.duties || []).map(x => x.name).join("、") || "无" }}）</span></div>
        <div class="val">
          <template v-if="bs.myReviewDone">✓ 已完成<template v-if="(bs.letterToday?.duties || []).some(x => x.id === member.id)">（今天轮到你，免评）</template></template>
          <template v-else-if="!(bs.letterToday?.duties || []).length">今日无轮值安排</template>
          <template v-else-if="!bs.letterToday.duties.every(x => x.uploaded)">等轮值者上传后可点评</template>
          <template v-else>去点评 ›</template>
        </div>
      </div>
      <!-- 2. 每日打卡项 -->
      <div class="task ck" v-for="a in daily" :key="a.id" :class="{ on: isChecked(a.name) }" @click="toggle(a)">
        <div class="nm">{{ a.name }}</div>
        <div class="val">+{{ fmt(a.income) }} / -{{ fmt(a.expense) }} · {{ a.hours }}h</div>
      </div>
    </div>

    <!-- 每周任务 -->
    <div class="card">
      <div class="hd">📅 每周任务</div>
      <!-- 1. 家书上传（每人每周一篇） -->
      <div class="task ck" :class="{ on: bs.myWeekLetter?.uploaded }" @click="emit('goto-letters', 'upload')">
        <div class="nm">家书上传 <span class="who">（我的排班日：{{ bs.myDutyDay || "未排" }}）</span></div>
        <div class="val">
          <template v-if="bs.myWeekLetter?.uploaded">✓ 本周已上传（{{ (bs.myWeekLetter.date || "").slice(5) }}{{ bs.myWeekLetter.late ? " 迟交" : "" }}）</template>
          <template v-else-if="isMyDutyToday">今天轮到我 → 去上传（{{ bs.letterToday?.deadline }} 截止）</template>
          <template v-else>未上传 → 去上传 · 今日排班：{{ (bs.letterToday?.duties || []).map(x => x.name).join("、") || "—" }}</template>
        </div>
      </div>
      <!-- 2. 每周项目 -->
      <div class="task ck" v-for="a in weekly" :key="a.id" :class="{ on: isChecked(a.name) }" @click="toggle(a)">
        <div class="nm">{{ a.name }}</div>
        <div class="val">+{{ fmt(a.income) }} / -{{ fmt(a.expense) }} · {{ a.hours }}h</div>
      </div>
    </div>

    <!-- 每月任务 -->
    <div class="card">
      <div class="hd">🗓 每月任务</div>
      <div class="task ck" v-for="a in monthly" :key="a.id" :class="{ on: isChecked(a.name) }" @click="toggle(a)">
        <div class="nm">{{ a.name }}</div>
        <div class="val">+{{ fmt(a.income) }} / -{{ fmt(a.expense) }} · {{ a.hours }}h</div>
      </div>
    </div>

    <div class="card">
      <div class="hd">大项申报 <small>提交后待审批</small>
        <van-tag v-if="pending" type="danger" plain>{{ pending }} 待审</van-tag>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        <van-button v-for="sp in bs.specials" :key="sp.key" size="small" plain type="primary" @click="declare(sp)">
          {{ sp.name }}<template v-if="sp.fixed"> +{{ fmt(sp.income) }}</template>
        </van-button>
      </div>
    </div>

    <div class="card">
      <div class="hd">今日明细</div>
      <div v-if="!bs.myToday.detail.length" class="mini">今天还没开始，从上面的任务开始吧</div>
      <div v-for="(d, i) in bs.myToday.detail" :key="i" style="display:flex;justify-content:space-between;font-size:13px;padding:6px 0;border-bottom:1px dashed #f2f2f4">
        <span>{{ d.name }}<template v-if="d.note"> · {{ d.note }}</template></span>
        <span :class="d.income >= 0 ? 'pos' : 'neg'">{{ d.income >= 0 ? "+" : "" }}{{ fmt(d.income) }}</span>
      </div>
    </div>

    <van-dialog v-model:show="noteDialog" :title="`申报「${noteTarget?.name || ''}」`" show-cancel-button
      @confirm="submitSpecial(noteTarget.key, noteText)" @cancel="noteDialog = false">
      <van-field v-model="noteText" label="说明" placeholder="请填写申请说明（等级/金额由审批时确定）" />
    </van-dialog>
  </div>
</template>

<style scoped>
.task { border: 1.5px solid #e8e6e3; border-radius: 12px; padding: 13px 12px; margin-bottom: 10px; background: #fff; }
.task:last-child { margin-bottom: 0; }
.task .nm { font-size: 15px; font-weight: 600; }
.task .who { font-size: 12px; color: #98a2b3; font-weight: normal; }
.task .val { font-size: 12px; color: #98a2b3; margin-top: 4px; }
.task.on { border-color: #d3321f; background: #fdeeea; position: relative; }
.task.on .nm { color: #d3321f; }
.task.on .val { color: #d3321f; }
.task.on::after { content: "✓"; position: absolute; top: 6px; right: 10px; color: #d3321f; font-weight: bold; }
</style>
