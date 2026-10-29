<script setup>
import { ref, computed, onMounted } from 'vue';
import { api, fmt } from '../api';
const props = defineProps({ member: Object });
const data = ref(null), error = ref('');
const month = ref(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 7));
const boards = computed(() => data.value ? [
  { key: 'people', title: '个人榜', label: '本月累计学习收益 · 分', list: data.value.people || [], mine: data.value.myRank },
  { key: 'groups', title: '小组榜', label: '本月人均学习收益 · 分', list: data.value.groups || [], mine: data.value.myGroupRank },
] : []);
function winners(list) {
  const top = list.filter(x => x.rank <= 3);
  if (top.length === 3 && top.every((x, i) => x.rank === i + 1)) return [top[1], top[0], top[2]];
  return top;
}
function podiumPosition(list, item) {
  const top = list.filter(x => x.rank <= 3), first = top.filter(x => x.rank === 1);
  if (first.length !== 1) return {};
  if (item.rank === 1) return { gridColumn: '2', gridRow: '1' };
  const rest = top.filter(x => x.rank !== 1), position = rest.findIndex(x => x.id === item.id);
  if (position === 0) return { gridColumn: '1', gridRow: '1' };
  if (position === 1) return { gridColumn: '3', gridRow: '1' };
  return { gridColumn: String((position - 2) % 3 + 1), gridRow: String(Math.floor((position - 2) / 3) + 2) };
}
function formattedScore(board,item) { return Number(score(board,item) || 0).toLocaleString('zh-CN', { maximumFractionDigits: board.key === 'groups' ? 2 : 0 }); }
const asOfLabel = computed(() => data.value?.asOf ? new Date(data.value.asOf).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '当前');
function score(board, item) { return board.key === 'people' ? item.benefit : item.averageBenefit; }
function mineRank(value) { return typeof value === 'object' ? value?.rank : value; }
function isMine(board, item) { return board.key === 'people' ? item.id === props.member.id : item.id === props.member.groupId; }
async function load() {
  error.value = '';
  try { data.value = await api('/api/monthly-rankings?month=' + month.value); }
  catch (e) { error.value = e.message; }
}
defineExpose({ load });
onMounted(load);
</script>
<template>
  <section class="honor-board" aria-label="本月荣耀榜">
    <header class="honor-heading"><h2>🏆 本月荣耀榜</h2><span>{{ Number(month.slice(5)) }}月 · 进行中</span></header>
    <div v-if="error" class="card mini">{{ error }} <button class="text-button" @click="load">重新加载</button></div>
    <div v-else-if="!data" class="card mini">正在加载本月排名…</div>
    <section v-for="board in boards" :key="board.key" class="podium-panel">
      <header><h3>{{ board.title }}</h3><small>{{ board.label }}</small></header>
      <div class="podium" :class="{ many: winners(board.list).length > 3 }" role="list" :aria-label="board.title + '前三名'">
        <article v-for="item in winners(board.list)" :key="item.id" class="winner" :data-rank="item.rank" :style="podiumPosition(board.list,item)" :class="{ mine: isMine(board,item) }" role="listitem">
          <div class="medal">{{ item.rank === 1 ? '🥇' : item.rank === 2 ? '🥈' : '🥉' }}</div>
          <span class="winner-rank">{{ item.rank }}</span><b class="winner-name">{{ item.name }}</b>
          <strong>{{ formattedScore(board, item) }}</strong><small v-if="board.key === 'people'">{{ item.groupName || '未分组' }}</small><small v-else>{{ item.count }}人 · 总收益 {{ fmt(item.totalBenefit) }}</small>
        </article>
      </div>
      <p v-if="!board.list.length" class="empty">本月暂无排名数据</p>
      <p class="my-rank">{{ board.key === 'people' ? '我的排名' : '本组排名' }}：{{ mineRank(board.mine) ? '第 ' + mineRank(board.mine) + ' 名' : '暂无排名' }}</p>
    </section>
    <details v-if="data" class="full-ranks"><summary><b>完整排名</b><span class="expand">展开查看 ﹀</span><span class="collapse">收起排名 ﹁</span></summary>
      <p class="mini">数据截至 {{ asOfLabel }}</p>
      <section v-for="board in boards" :key="board.key"><h4>{{ board.title }} · 其余名次</h4>
        <div v-for="item in board.list.filter(x => x.rank > 3)" :key="item.id" class="rank-row" :class="{ mine: isMine(board,item) }"><b>{{ item.rank }}</b><span>{{ item.name }}<small v-if="board.key === 'people'">{{ item.groupName }}</small><small v-else>{{ item.count }}人</small></span><strong>{{ formattedScore(board,item) }}</strong></div>
        <p v-if="!board.list.some(x => x.rank > 3)" class="mini">暂无其余名次</p>
      </section>
      <p class="mini rank-note">同分并列，按 1、2、2、4 排列。每人只计入所属小组。<br>班级优秀家书不加分 · 塾里优秀家书奖励 500 分</p>
    </details>
  </section>
</template>
<style scoped>
.honor-board{margin-bottom:16px}.honor-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:2px 0 12px}.honor-heading h2{font-size:19px;color:#946222;margin:0}.honor-heading>span{font-size:12px;color:#947b5b;background:#f6eddb;padding:5px 8px;border-radius:6px;white-space:nowrap}.podium-panel{padding:14px 12px 0;background:#fff;border-radius:15px;margin-bottom:11px;overflow:hidden}.podium-panel header{display:flex;justify-content:space-between;align-items:center;gap:8px}.podium-panel h3{margin:0;font-size:15px}.podium-panel header small{font-size:11px;color:#7e8792}.podium{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));align-items:end;gap:6px;padding-top:10px}.winner{position:relative;display:flex;flex-direction:column;align-items:center;gap:5px;min-width:0;text-align:center;padding:12px 5px 10px;border-radius:12px 12px 0 0;background:linear-gradient(#fffcf9,#f3e4d8)}.winner[data-rank="1"]{background:linear-gradient(#fffaf0,#f8eacb);padding-top:23px}.winner[data-rank="2"]{background:linear-gradient(#fff,#edf1f5)}.medal{font-size:25px}.winner-rank{font-size:17px;font-weight:800;color:#92601b}.winner-name{font-size:14px;overflow-wrap:anywhere}.winner strong{font-size:17px;color:#a76b1d;font-variant-numeric:tabular-nums}.winner small{font-size:11px;line-height:1.5;color:#8b7b6b;overflow-wrap:anywhere}.winner.mine .winner-name{color:#d3321f}.my-rank{background:#fff9ef;color:#916127;font-size:12px;margin:0 -12px;padding:8px;text-align:center}.empty{color:#98a2b3;font-size:13px;text-align:center}.full-ranks{background:#fff;border-radius:15px;padding:0 14px}.full-ranks summary{display:flex;align-items:center;justify-content:space-between;min-height:46px;list-style:none;cursor:pointer;font-size:13px}.full-ranks summary::-webkit-details-marker{display:none}.full-ranks summary span{font-size:12px;color:#89919a}.collapse{display:none}.full-ranks[open] .expand{display:none}.full-ranks[open] .collapse{display:inline}.full-ranks h4{font-size:13px;margin:18px 0 8px}.rank-row{display:grid;grid-template-columns:25px 1fr auto;gap:8px;padding:10px 0;border-bottom:1px solid #f4f0ee;font-size:14px}.rank-row small{display:block;font-size:11px;color:#98a2b3;margin-top:3px}.rank-row.mine{color:#d3321f}.rank-note{padding:12px 0;line-height:1.8}.text-button{border:0;background:none;color:#d3321f}.many{grid-template-columns:repeat(3,minmax(0,1fr))}
@media(max-width:350px){.honor-heading h2{font-size:17px}.winner strong{font-size:15px}.podium-panel header small{font-size:11px}}
</style>
