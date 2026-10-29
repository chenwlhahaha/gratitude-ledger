<script setup>
import { ref, onMounted, computed } from 'vue';
import { api } from '../api';
import { showToast, showConfirmDialog } from 'vant';
const emit = defineEmits(['changed']);
const date = ref(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }));
const state = ref(null), busy = ref(false), error = ref(''), selected = ref(''), nominee = ref(''), notice = ref(false), opened = ref(null);
const canManage = computed(() => state.value?.canSelectClass || state.value?.canRegisterSchool);
const chosenSchoolLetter = computed(() => state.value?.nominees?.find(l => l.id === nominee.value));
const classLetter = computed(() => state.value?.candidates?.find(l => l.id === state.value?.decision?.letterId));
async function load() {
  error.value = '';
  try { state.value = await api('/api/letter-honors?date=' + date.value); selected.value = state.value.decision?.letterId || ''; nominee.value = state.value.schoolAward?.id || ''; notice.value = false; }
  catch (e) { error.value = e.message; }
}
async function action(path, body, message) {
  if (busy.value) return;
  const ok = await showConfirmDialog({ title: '确认评选操作', message }).then(() => true).catch(() => false);
  if (!ok) return;
  busy.value = true;
  try { await api('/api/letter-honors/' + path, body); showToast('已保存'); await load(); emit('changed'); }
  catch (e) { showToast(e.message); }
  finally { busy.value = false; }
}
function selectClass() {
  if (!selected.value) return showToast('请先选择一篇家书');
  action('class', { date: date.value, letterId: selected.value, publishToClass: true }, '选为本日班级优秀家书，正文及图片将对全班可读，加入历史优秀家书库。本项不加分。');
}
function school() {
  if (!nominee.value) return showToast('请选择已推选的家书');
  if (!notice.value) return showToast('请先确认已收到塾里正式评选通知');
  action('school', { date: date.value, letterId: nominee.value, noticeConfirmed: true }, '按所选评选日登记塾里优秀家书，作者奖励 500 分。同一篇获奖不会重复加分。');
}
onMounted(load);
defineExpose({ load });
</script>
<template>
  <section v-if="canManage || error" class="card honor-management">
    <div class="hd">🏅 优秀家书评选 <small>工作日每日最多一篇</small></div>
    <label class="date-line">评选日期 <input type="date" v-model="date" @change="load"></label>
    <p class="mini">班级优秀不加分；班级优秀才可推选塾里。塾里优秀奖励 500 分。</p>
    <p v-if="error" class="mini">{{ error }} <button type="button" @click="load">重试加载评选</button></p>
    <template v-if="state?.canSelectClass">
      <h3>班主任 · 班级评选</h3>
      <p class="status">{{ state.decision?.status === 'selected' ? '已评选：' + (classLetter?.authorName || '班级优秀家书') : state.decision?.status === 'skipped' ? '本日不评' : '尚未评选' }}</p>
      <template v-if="state.decision?.status !== 'selected'">
        <label v-for="letter in state.candidates || []" :key="letter.id" class="candidate"><input type="radio" :value="letter.id" v-model="selected"><span><b>{{ letter.authorName }}</b> · {{ letter.groupName }} · {{ letter.date }}<button class="read-link" type="button" @click.prevent="opened = opened === letter.id ? null : letter.id">{{ opened === letter.id ? '收起正文' : '阅读正文' }}</button><div v-if="opened === letter.id" class="letter-content">{{ letter.content }}<img v-for="image in letter.images || []" :key="image" :src="image"></div></span></label>
        <p v-if="!state.candidates?.length" class="mini">本日暂无可评选家书</p>
        <div class="actions"><van-button type="danger" size="small" :loading="busy" :disabled="!selected" @click="selectClass">选为班级优秀</van-button><van-button size="small" :disabled="busy || state.decision?.status === 'skipped'" @click="action('class', {date, skip:true}, '确认本日没有适合的优秀家书，本日不评？')">本日不评</van-button></div>
      </template>
      <div v-else class="actions"><van-button size="small" :disabled="busy || classLetter?.schoolHonor" @click="action('class', {date,revoke:true}, '撤销本日班级优秀。若已有塾里荣誉，须先撤销塾里登记。')">撤销班级评选</van-button><van-button type="primary" plain size="small" :disabled="busy" @click="action('nominate',{letterId:state.decision.letterId,nominated:!classLetter?.nominatedAt}, classLetter?.nominatedAt ? '取消已推选记录？这不会发送任何消息。' : '请确认已实际向塾里推选。这只登记已推选状态，不会自动发送家书。')">{{ classLetter?.nominatedAt ? '取消已推选记录' : '标记已推选塾里' }}</van-button></div>
    </template>
    <template v-if="state?.canRegisterSchool">
      <h3>大学委 · 塾里结果登记</h3>
      <p class="status" v-if="state.schoolAward">已登记：{{ state.schoolAward.authorName }} · 塾里优秀 +500</p>
      <template v-else>
        <select v-model="nominee" class="nominee-select"><option value="">选择已推选的班级优秀家书</option><option v-for="letter in state.nominees || []" :key="letter.id" :value="letter.id">{{ letter.date }} · {{ letter.authorName }} · {{ letter.groupName }}</option></select>
        <p v-if="!state.nominees?.length" class="mini">暂无已推选家书，须由班主任先登记推选。</p>
        <details v-if="chosenSchoolLetter" class="nominee-reading"><summary>核对 {{ chosenSchoolLetter.authorName }} 的家书正文</summary><div class="letter-content">{{ chosenSchoolLetter.content }}<img v-for="image in chosenSchoolLetter.images || []" :key="image" :src="image"></div></details>
        <label class="notice-check"><input type="checkbox" v-model="notice">我已收到塾里正式通知，并核对获奖者及评选日期</label>
        <van-button size="small" type="danger" :loading="busy" :disabled="!notice || !nominee" @click="school">登记塾里优秀 · +500</van-button>
      </template>
      <van-button v-if="state.schoolAward" size="small" :loading="busy" @click="action('school', {date,letterId:state.schoolAward.id,revoke:true}, '撤销本次塾里优秀登记并回退对应 500 分，保留班级优秀荣誉。')">撤销塾里登记</van-button>
    </template>
  </section>
</template>
<style scoped>
.honor-management h3{font-size:15px;margin:18px 0 8px}.date-line{display:flex;gap:12px;align-items:center;font-size:14px;margin:12px 0}.date-line input{padding:7px;border:1px solid #e8e1db;border-radius:8px;max-width:180px}.status{font-size:14px;color:#946222;background:#fff8eb;padding:9px;border-radius:8px}.candidate{display:flex;align-items:flex-start;gap:9px;padding:11px 0;border-bottom:1px solid #f4f0ee;font-size:13px}.candidate>span{min-width:0;flex:1}.candidate input{margin-top:3px;accent-color:#d3321f}.read-link{display:block;padding:6px 0;border:0;background:none;color:#d3321f;font-size:13px}.letter-content{white-space:pre-wrap;line-height:1.8;overflow-wrap:anywhere}.letter-content img{display:block;max-width:100%;margin-top:8px;border-radius:8px}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.nominee-select{padding:10px;border:1px solid #e8e1db;border-radius:8px;width:100%;font-size:13px;background:white}.nominee-reading{margin-top:10px;font-size:13px}.nominee-reading summary{color:#d3321f;padding:7px 0;cursor:pointer}.notice-check{display:flex;align-items:flex-start;gap:8px;font-size:13px;line-height:1.6;margin:14px 0}.notice-check input{accent-color:#d3321f;margin-top:4px}
</style>
