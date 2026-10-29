<script setup>
import { ref, onMounted } from "vue";
import { api, fmt } from "../api";

const props = defineProps({ member: Object });
const g = ref(null);

onMounted(async () => { g.value = await api("/api/group"); });
</script>

<template>
  <div class="page" v-if="g">
    <div class="stats">
      <div class="s"><b>{{ fmt(g.totals.income) }}</b><span>小组收入</span></div>
      <div class="s"><b>{{ fmt(g.totals.expense) }}</b><span>小组费用</span></div>
      <div class="s hl"><b>{{ fmt(g.totals.benefit) }}</b><span>小组收益</span></div>
      <div class="s"><b>{{ g.totals.hours }}</b><span>总工时</span></div>
    </div>

    <div class="card">
      <div class="hd">✅ 今日打卡 <small>读书 · 点评（实时）</small></div>
      <div v-for="m in g.members" :key="m.id" class="tk-row">
        <span class="dot" :class="{ ok: m.todayRead }"></span>
        <span class="tk-name">{{ m.name }}<van-tag v-if="m.officer" type="primary" plain style="margin-left:4px">{{ m.officer }}</van-tag><van-tag v-if="m.id === member.id" plain type="primary" style="margin-left:4px">我</van-tag></span>
        <van-tag :type="m.todayRead ? 'success' : 'danger'" plain>{{ m.todayRead ? "读书✓" : "读书✗" }}</van-tag>
        <van-tag v-if="!g.todayStat.reviewActive" type="gray" plain>点评·待家书</van-tag>
        <van-tag v-else :type="m.todayReview ? 'success' : 'danger'" plain>{{ m.todayReview ? "点评✓" : "点评✗" }}</van-tag>
      </div>
      <div class="mini" style="margin-top:8px">全组：读书 {{ g.todayStat.read }}/{{ g.todayStat.total }} · 点评 {{ g.todayStat.review }}/{{ g.todayStat.total }}
        <template v-if="!g.todayStat.reviewActive">（今日轮值家书上传后点评才计分）</template>
      </div>
    </div>

    <div class="card">
      <div class="hd">成员榜 <small>按收益排序</small></div>
      <div v-for="(m, i) in g.members" :key="m.id" class="rank-row">
        <span class="rank-no" :class="'r' + (i + 1)">{{ i + 1 }}</span>
        <span style="flex:1">
          <span class="dot" :class="{ ok: m.todayChecked }"></span>{{ m.name }}<van-tag v-if="m.officer" type="primary" plain style="margin-left:6px">{{ m.officer }}</van-tag>
          <div class="mini">收入 {{ fmt(m.income) }}/{{ fmt(m.target) }} · {{ m.hours }}h · 附加值 {{ m.unitValue ?? "—" }}</div>
        </span>
        <span :class="m.benefit >= 0 ? 'pos' : 'neg'">{{ fmt(m.benefit) }}</span>
      </div>
    </div>

    <div class="card">
      <div class="hd">今日小组结算</div>
      <div v-if="!g.results.length" class="mini">暂无</div>
      <div v-for="(r, i) in g.results" :key="i" style="display:flex;justify-content:space-between;font-size:13px;padding:6px 0;border-bottom:1px dashed #f2f2f4">
        <span>{{ r.label }}（{{ r.doneCount }}/{{ r.totalCount }}人）</span>
        <span :class="r.amount >= 0 ? 'pos' : 'neg'">{{ r.amount >= 0 ? "+" : "" }}{{ r.amount }} ×全员</span>
      </div>
    </div>

    <div class="card">
      <div class="hd">每日收益趋势</div>
      <div class="trend">
        <i v-for="t in g.trend" :key="t.d" :class="{ z: t.v <= 0 }" :style="{ height: Math.max(2, Math.abs(t.v) / Math.max(...g.trend.map(x => Math.abs(x.v)), 1) * 100) + '%' }"></i>
      </div>
    </div>
  </div>
</template>
