<script setup>
import { ref, onMounted } from "vue";
import { api, fmt } from "../api";

const props = defineProps({ member: Object });
const my = ref(null);
const bs = ref(null);

onMounted(async () => {
  bs.value = await api("/api/bootstrap");
  my.value = await api("/api/my");
});
</script>

<template>
  <div class="page" v-if="my">
    <div class="stats">
      <div class="s"><b>{{ fmt(my.totals.income) }}</b><span>累计收入</span></div>
      <div class="s"><b>{{ fmt(my.totals.expense) }}</b><span>累计费用</span></div>
      <div class="s hl"><b>{{ fmt(my.totals.benefit) }}</b><span>学习收益</span></div>
      <div class="s"><b>{{ my.totals.hours }}</b><span>工时(h)</span></div>
    </div>

    <div class="card">
      <div class="hd">目标完成情况</div>
      <van-progress :percentage="Math.min(100, Math.round((my.rate || 0) * 100))" :show-pivot="true" stroke-width="8" />
      <p class="mini" style="margin-top:10px">
        收入 {{ fmt(my.totals.income) }} / 目标 {{ fmt(my.targets.income) }}（{{ Math.round((my.rate || 0) * 100) }}%）
        <template v-if="my.unitValue">· 单位时间附加值 <b class="pos">{{ my.unitValue }}</b></template>
      </p>
    </div>

    <div class="card">
      <div class="hd">{{ my.month }} 月历 <small>数字=当日收益</small></div>
      <div class="cal">
        <div v-for="(r, d) in my.days" :key="d" class="d" :class="{ pos: r.benefit > 0, neg: r.benefit < 0, today: d === bs.today }">
          <span>{{ +String(d).slice(8) }}</span><b>{{ r.checked ? fmt(r.benefit) : "·" }}</b>
        </div>
      </div>
    </div>
  </div>
</template>
