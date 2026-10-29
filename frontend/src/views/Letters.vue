<script setup>
import { ref, onMounted, computed, nextTick, watch } from "vue";
import MonthlyHonors from "../components/MonthlyHonors.vue";
import LetterHonors from "../components/LetterHonors.vue";
import { api } from "../api";
import { showToast } from "vant";

const props = defineProps({ member: Object, initialSection: { type: String, default: "" } });
const ranking = ref(null), awardManager = ref(null), dailySection = ref(null), uploadSection = ref(null);
const section = ref('daily'), loading = ref(false), loadError = ref('');
const library = ref([]), libraryTotal = ref(0), libraryMore = ref(false), libraryBusy = ref(false), libraryError = ref('');
const search = ref(''), kind = ref('all'), libraryMonth = ref(''), libraryOpen = ref({});
let libraryRequest = 0;
async function loadLibrary(append = false) {
  if (append && libraryBusy.value) return;
  const request = ++libraryRequest;
  libraryBusy.value = true; libraryError.value = '';
  const params = new URLSearchParams({ search: search.value.trim(), kind: kind.value, month: libraryMonth.value, offset: String(append ? library.value.length : 0), limit: '30' });
  try {
    const j = await api('/api/letter-library?' + params);
    if (request !== libraryRequest) return;
    library.value = append ? [...library.value, ...j.list] : j.list;
    libraryTotal.value = j.total; libraryMore.value = j.hasMore;
  } catch (e) { if(request === libraryRequest) libraryError.value = e.message; }
  finally { if(request === libraryRequest) libraryBusy.value = false; }
}
async function jumpTo(target) {
  section.value = 'daily'; await nextTick();
  if (target === 'upload' && d.value && !d.value.myWeekLetter.uploaded) { forWho.value = null; showForm.value = true; }
  if (target === 'review' && dutyToday.value.length) expandedRv.value = dutyToday.value[0].id;
  await nextTick();
  (target === 'upload' ? uploadSection.value : dailySection.value)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function refreshHonors() { ranking.value?.load(); loadLibrary(); if (props.member.groupId) load(); }
watch(() => props.initialSection, value => { if(value) jumpTo(value); });
const d = ref(null); // {today, myReviewDone, myWeekLetter, week, weekBoard, list}
const content = ref("");
const imageDataURL = ref("");
const showForm = ref(false);
const submitting = ref(false);
const cmtDialog = ref(false);
const cmtText = ref("");
const cmtTarget = ref(null);
const rpyDialog = ref(false);
const rpyText = ref("");
const rpyTarget = ref(null); // {letterId, commentId, name}
const hlpShow = ref(false);
const hlpCols = ref([]);
const forWho = ref(null); // 代传对象
const cmtInputs = ref({});
const expandedRv = ref(null); // 今日点评中展开的那篇
const openLetters = ref({});  // 历史家书展开状态
function toggleRv(id) { expandedRv.value = expandedRv.value === id ? null : id; }
// 今日点评只看当天轮值者（如周一=甲组轮值人，大家周一评甲组轮值人的本周家书）
const dutyToday = computed(() => d.value?.today?.duties || []);
const rowState = (duty) => {
  if (!duty.uploaded) return { text: "待上传", cls: "todo" };
  if (duty.id === props.member.id) return { text: "我写的·免评", cls: "ok" };
  if (duty.letter?.comments?.some(c => c.name === props.member.name)) return { text: "已评✓", cls: "ok" };
  return { text: "待评 +500", cls: "todo" };
};
async function quickComment(l) {
  const t = (cmtInputs.value[l.id] || "").trim();
  if (!t) return showToast("写点点评内容吧");
  try {
    await api("/api/letter/comment", { letterId: l.id, text: t });
    showToast("点评成功 +500 已计入");
    expandedRv.value = null;
    load(); ranking.value?.load();
  } catch (e) { showToast(e.message); }
}
const canHelp = computed(() => (d.value?.weekBoard || []).filter(m => !m.uploaded && m.id !== props.member.id).length > 0);
function openHelper() {
  hlpCols.value = (d.value.weekBoard || []).filter(m => !m.uploaded && m.id !== props.member.id)
    .map(m => ({ text: m.name + (m.id === props.member.id ? "（我）" : ""), value: m.id }));
  if (!hlpCols.value.length) return showToast("本周都传完了");
  hlpShow.value = true;
}
function onHelperPick({ selectedOptions }) {
  forWho.value = d.value.weekBoard.find(m => m.id === selectedOptions[0].value);
  hlpShow.value = false;
  content.value = ""; imageDataURL.value = ""; showForm.value = true;
}
async function submit() {
  if (submitting.value) return;
  if (!content.value.trim() && !imageDataURL.value) return showToast("写点内容或附一张图");
  const body = { content: content.value, image: imageDataURL.value || undefined };
  if (forWho.value && forWho.value.id !== props.member.id) body.forMemberId = forWho.value.id;
  submitting.value = true;
  try {
    const j = await api("/api/letter/submit", body);
    showToast(j.msg || "已上传");
    content.value = ""; imageDataURL.value = ""; showForm.value = false; forWho.value = null;
    await load(); ranking.value?.load();
  } catch(e) { showToast(e.message); }
  finally { submitting.value = false; }
}

async function load() {
  if (!props.member.groupId) return;
  loading.value = true; loadError.value = '';
  try { d.value = await api("/api/letters"); }
  catch(e) { loadError.value = e.message; }
  finally { loading.value = false; }
}
onMounted(async () => { await Promise.all([load(), loadLibrary()]); if (props.initialSection) jumpTo(props.initialSection); });

function onFile(e) {
  const f = e.target.files?.[0];
  if (!f) return;
  if (f.size > 2 * 1024 * 1024) { showToast("图片超过2MB"); e.target.value = ""; return; }
  const r = new FileReader();
  r.onload = () => { imageDataURL.value = r.result; };
  r.readAsDataURL(f);
}
function comment(l) { cmtTarget.value = l; cmtText.value = ""; cmtDialog.value = true; }
async function submitComment() {
  if (!cmtText.value.trim()) return showToast("写点点评内容吧");
  try {
    await api("/api/letter/comment", { letterId: cmtTarget.value.id, text: cmtText.value.trim() });
    showToast("点评成功 +分已计入");
    cmtDialog.value = false;
    load(); ranking.value?.load();
  } catch (e) { showToast(e.message); }
}
function reply(l, c) { rpyTarget.value = { letterId: l.id, commentId: c.id, name: c.name }; rpyText.value = ""; rpyDialog.value = true; }
async function submitReply() {
  if (!rpyText.value.trim()) return showToast("写点回复内容吧");
  try {
    await api("/api/letter/reply", { letterId: rpyTarget.value.letterId, commentId: rpyTarget.value.commentId, text: rpyText.value.trim() });
    showToast("已回复感谢");
    rpyDialog.value = false;
    load(); ranking.value?.load();
  } catch (e) { showToast(e.message); }
}
</script>

<template>
  <div class="page letters-page">
    <MonthlyHonors ref="ranking" :member="member" />
    <div class="learning-heading"><h2>家书学习</h2><div v-if="member.groupId"><button type="button" @click="jumpTo('review')">去点评</button><button type="button" @click="jumpTo('upload')">去上传</button></div></div>
    <div class="section-tabs"><button :class="{active:section === 'daily'}" @click="section='daily'">日常家书</button><button :class="{active:section === 'library'}" @click="section='library'">优秀家书库</button></div>
    <LetterHonors ref="awardManager" @changed="refreshHonors" />
    <template v-if="section === 'daily'">
    <div v-if="loadError" class="card mini">{{ loadError }} <button type="button" @click="load">重试</button></div>
    <div v-if="loading && !d" class="card mini">正在加载家书…</div>
    <div v-if="!member.groupId" class="card mini">你尚未分配学习小组，可查看本月荣耀榜、优秀家书库，或使用已授权的评选功能。</div>
    <template v-if="d">
    <!-- 今日点评：只评当天轮值者的家书 -->
    <div ref="dailySection" class="card action-target" v-if="dutyToday.length" style="border:1.5px solid #d3321f;background:#fffaf9">
      <div class="hd">📝 今日点评
        <small v-if="d.myReviewDone">✓ 已完成<template v-if="dutyToday.some(x => x.id === member.id)">（今天轮到你，免评）</template></small>
        <small v-else>提交有效点评，+500</small>
      </div>
      <div v-if="!d.myReviewDone && dutyToday.every(x => !x.uploaded)" class="mini" style="margin:-6px 0 10px">
        今日轮值：{{ dutyToday.map(x => x.name).join("、") }}（{{ d.today.deadline }} 前上传后可评）
      </div>
      <van-cell-group :border="false">
        <van-cell v-for="x in dutyToday" :key="x.id" is-link :border="true" center @click="toggleRv(x.id)">
          <template #title>
            <b class="pos">{{ x.name }}</b> 的家书
            <van-tag v-if="x.letter?.helperName" color="#fdeeea" text-color="#d3321f" style="margin-left:4px">{{ x.letter.helperName }}代传</van-tag>
            <van-tag v-if="x.late" type="warning" plain style="margin-left:4px">迟交</van-tag>
          </template>
          <template #label>
            <span :style="{ color: rowState(x).cls === 'todo' ? '#d3321f' : '#2e9e5b', fontWeight: 600 }">{{ rowState(x).text }}</span>
            <span v-if="x.uploaded" style="color:#98a2b3;margin-left:8px">{{ x.letter.comments.length }}人已评</span>
          </template>
        </van-cell>
      </van-cell-group>
      <div v-for="x in dutyToday" :key="x.id + '-body'">
        <div v-if="expandedRv === x.id" class="rv-body">
          <template v-if="x.uploaded">
            <div class="l-content">{{ x.letter.content }}</div>
            <div v-for="img in x.letter.images" :key="img" style="margin:6px 0"><img :src="img" style="max-width:100%;border-radius:8px"></div>
            <template v-if="x.id !== member.id && !x.letter.comments.some(c => c.name === member.name)">
              <van-field v-model="cmtInputs[x.letter.id]" type="textarea" rows="2" autosize placeholder="一句话点评即可…" style="background:#fff" />
              <van-button type="danger" size="small" round style="margin-top:8px" @click="quickComment(x.letter)">发送点评</van-button>
            </template>
            <div v-else class="mini" style="margin-top:6px">
              {{ x.id === member.id ? "今天轮到你，作者免评" : "你已点评过 ✓" }}
            </div>
          </template>
          <div v-else class="mini">今日轮值者还没上传，等TA传完即可点评</div>
        </div>
      </div>
    </div>

    <!-- 我的家书上传（含帮组员代传） -->
    <div ref="uploadSection" class="card action-target">
      <div class="hd">✍️ 我的本周家书</div>
      <template v-if="d.myWeekLetter.uploaded && !showForm">
        <div class="mini" style="padding:4px 0">
          本周已上传 ✓（{{ d.myWeekLetter.date }}）<template v-if="d.myWeekLetter.late"> <b style="color:#e8a23a">（迟交）</b></template>
        </div>
      </template>
      <template v-else-if="!showForm">
        <van-button type="primary" round block plain @click="forWho = null; showForm = true">上传我的本周家书</van-button>
      </template>
      <template v-else>
        <div class="mini" style="margin-bottom:6px">
          <template v-if="forWho">为 <b class="pos">{{ forWho.name }}</b> 代传（家书计入TA名下）<span v-if="!d.myWeekLetter.uploaded" style="color:#d3321f;margin-left:8px" @click="forWho = null">改传我的</span></template>
          <template v-else-if="d.myWeekLetter.uploaded">（你本周已传过，本次为代传）</template>
          <template v-else>以我的名义上传</template>
        </div>
        <van-field v-model="content" type="textarea" rows="5" autosize placeholder="写下本周的学习与践行感悟…" />
        <div class="row" style="margin-top:10px">
          <label class="img-btn">📷 附图<input type="file" accept="image/png,image/jpeg,image/webp" style="display:none" @change="onFile"></label>
          <img v-if="imageDataURL" :src="imageDataURL" class="preview" />
          <van-button size="small" round @click="showForm=false; forWho=null">取消</van-button><van-button type="danger" size="small" round :loading="submitting" @click="submit" style="margin-left:auto">上传</van-button>
        </div>
      </template>
      <van-button v-if="canHelp && !(showForm && forWho)" type="default" round block plain size="small" style="margin-top:8px" @click="openHelper">🤝 帮还没传的组员代传</van-button>
    </div>

    <!-- 本周家书情况（全组谁传了谁没传） -->
    <div class="card">
      <div class="hd">📋 本周家书情况 <small>{{ d.week }}</small></div>
      <div v-for="m in d.weekBoard" :key="m.id" class="wk-row">
        <span class="wk-day">{{ m.dutyDay || "—" }}</span>
        <span class="wk-name">{{ m.name }}<van-tag v-if="m.id === member.id" plain type="primary" style="margin-left:4px">我</van-tag></span>
        <span class="wk-status">
          <van-tag v-if="m.uploaded" :type="m.late ? 'warning' : 'success'">{{ m.late ? "迟交" : "✓ 已传" }} {{ m.date?.slice(5) }}</van-tag>
          <van-tag v-else type="danger">❌ 未上传</van-tag>
        </span>
      </div>
    </div>

    <!-- 今日排班与点评状态 -->
    <div class="card">
      <div class="hd">今日动态 <small>截止 {{ d.today.deadline }}</small></div>
      <div class="duty-line">
        <template v-if="d.today.duties.length">
          <span style="color:#98a2b3">今日排班：</span>
          <van-tag v-for="x in d.today.duties" :key="x.id" :type="x.uploaded ? 'success' : 'warning'" plain style="margin:2px 4px 2px 0">{{ x.name }}{{ x.uploaded ? "✓" : "待传" }}</van-tag>
        </template>
        <template v-else>今日无排班</template>
      </div>
      <div class="mini" style="margin-top:6px">今日新家书 {{ d.today.todayCount }} 篇 ·
        我今日点评：<b :class="d.myReviewDone ? 'pos' : ''">{{ d.myReviewDone ? "✓ 已完成（已计分）" : "未完成" }}</b>
        <template v-if="d.today.todayCount && !d.myReviewDone"> → 点评今日轮值家书后计分</template>
      </div>
    </div>

    <!-- 本周家书（全组新信，供互相点评） -->
    <div class="card">
      <div class="hd">📖 本周家书 <small>全组新信 · 点开看全文与点评</small></div>
      <div v-if="!d.list.filter(l => l.week === d.week).length" class="mini" style="padding:4px 0">本周还没有全组家书</div>
      <div v-for="l in d.list.filter(l => l.week === d.week)" :key="l.id">
        <van-cell is-link :border="true" center @click="openLetters[l.id] = !openLetters[l.id]">
          <template #title>
            <span>{{ l.date.slice(5) }} · <b class="pos">{{ l.authorName }}</b>的家书</span>
            <van-tag v-if="l.helperName" color="#fdeeea" text-color="#d3321f" style="margin-left:4px">{{ l.helperName }}代传</van-tag>
            <van-tag v-if="l.classHonor" color="#fff1db" text-color="#a76b1d" style="margin-left:4px">班级优秀</van-tag><van-tag v-if="l.schoolHonor" type="danger" style="margin-left:4px">塾里优秀 +500</van-tag><van-tag v-if="l.featured && !l.classHonor && !l.schoolHonor" plain style="margin-left:4px">历史精选</van-tag>
          </template>
          <template #value>
            <span class="mini">{{ l.comments.length }}评</span>
          </template>
        </van-cell>
        <div v-if="openLetters[l.id]" style="padding:8px 4px 12px;border-bottom:1px solid #f4f0ee">
          <div class="l-content">{{ l.content }}</div>
          <div v-for="img in l.images" :key="img" style="margin:6px 0"><img :src="img" style="max-width:100%;border-radius:8px"></div>
          <div class="cmt-hd" @click="comment(l)" v-if="l.authorId !== member.id && !l.comments.some(c => c.name === member.name)">
            ✍️ 写点评
          </div>
          <div v-for="c in l.comments" :key="c.id" class="cmt">
            <b>{{ c.name }}：</b>{{ c.text }}
            <div v-if="c.reply" class="reply">🌷 作者回复：{{ c.reply.text }}</div>
            <div v-else-if="l.authorId === member.id" class="reply-btn" @click="reply(l, c)">↩ 回复感谢</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 我的历史家书（仅自己可见） -->
    <div class="card">
      <div class="hd">📚 我的历史家书 <small>仅自己可见</small></div>
      <div v-if="!d.list.filter(l => l.week !== d.week && l.authorId === member.id).length" class="mini" style="padding:4px 0">还没有历史家书</div>
      <div v-for="l in d.list.filter(l => l.week !== d.week && l.authorId === member.id)" :key="l.id">
        <van-cell is-link :border="true" center @click="openLetters[l.id] = !openLetters[l.id]">
          <template #title>
            <span>{{ l.date.slice(5) }} · <b class="pos">{{ l.authorName }}</b>的家书</span>
            <van-tag v-if="l.helperName" color="#fdeeea" text-color="#d3321f" style="margin-left:4px">{{ l.helperName }}代传</van-tag>
            <van-tag v-if="l.classHonor" color="#fff1db" text-color="#a76b1d" style="margin-left:4px">班级优秀</van-tag><van-tag v-if="l.schoolHonor" type="danger" style="margin-left:4px">塾里优秀 +500</van-tag><van-tag v-if="l.featured && !l.classHonor && !l.schoolHonor" plain style="margin-left:4px">历史精选</van-tag>
          </template>
          <template #value>
            <span class="mini">{{ l.comments.length }}评</span>
          </template>
        </van-cell>
        <div v-if="openLetters[l.id]" style="padding:8px 4px 12px;border-bottom:1px solid #f4f0ee">
          <div class="l-content">{{ l.content }}</div>
          <div v-for="img in l.images" :key="img" style="margin:6px 0"><img :src="img" style="max-width:100%;border-radius:8px"></div>
          <div class="cmt-hd" @click="comment(l)" v-if="l.authorId !== member.id && !l.comments.some(c => c.name === member.name)">
            ✍️ 写点评
          </div>
          <div v-for="c in l.comments" :key="c.id" class="cmt">
            <b>{{ c.name }}：</b>{{ c.text }}
            <div v-if="c.reply" class="reply">🌷 作者回复：{{ c.reply.text }}</div>
            <div v-else-if="l.authorId === member.id" class="reply-btn" @click="reply(l, c)">↩ 回复感谢</div>
          </div>
        </div>
      </div>
    </div>

    </template>
    </template>
    <section v-else class="card library-panel">
      <div class="hd">📚 班级历史优秀家书库 <small>{{ libraryTotal }}篇</small></div>
      <p class="mini">共同学习优秀家书。阅读不自动完成今日点评，也不额外加分。</p>
      <div class="library-search"><input v-model="search" placeholder="搜索作者或正文" @keyup.enter="loadLibrary()"><button type="button" @click="loadLibrary()">搜索</button></div>
      <div class="library-filters"><select v-model="kind" @change="loadLibrary()"><option value="all">全部荣誉</option><option value="class">班级优秀</option><option value="school">塾里优秀</option></select><label>月份 <input type="month" v-model="libraryMonth" @change="loadLibrary()"></label><button v-if="libraryMonth" type="button" @click="libraryMonth='';loadLibrary()">全部月份</button></div>
      <p v-if="libraryError" class="mini">{{ libraryError }} <button @click="loadLibrary()">重试</button></p>
      <p v-else-if="!library.length && !libraryBusy" class="mini">暂无符合条件的优秀家书</p>
      <article v-for="letter in library" :key="letter.id" class="library-letter">
        <button class="library-title" type="button" :aria-expanded="!!libraryOpen[letter.id]" @click="libraryOpen[letter.id]=!libraryOpen[letter.id]"><span><b>{{ letter.authorName }}</b><small>{{ letter.groupName }} · {{ letter.date }}</small></span><span>{{ libraryOpen[letter.id] ? '收起 ﹁' : '阅读全文 ﹀' }}</span></button>
        <div class="honor-tags"><van-tag v-if="letter.classHonor" color="#fff1db" text-color="#a76b1d">班级优秀 · {{ letter.classHonorDate }}</van-tag><van-tag v-if="letter.schoolHonor" type="danger">塾里优秀 +500 · {{ letter.schoolHonorDate }}</van-tag></div>
        <p v-if="!libraryOpen[letter.id]" class="library-excerpt">{{ letter.content?.slice(0, 90) || '图片家书，点击阅读全文' }}</p>
        <div v-else class="l-content">{{ letter.content }}<img v-for="image in letter.images || []" :key="image" :src="image" class="library-image"></div>
      </article>
      <p v-if="libraryBusy" class="mini">加载中…</p><van-button v-if="libraryMore" block plain size="small" :loading="libraryBusy" @click="loadLibrary(true)">加载更多优秀家书</van-button>
    </section>

    <van-dialog v-model:show="cmtDialog" :title="`点评 ${cmtTarget?.authorName || ''} 的家书`" show-cancel-button
      @confirm="submitComment" @cancel="cmtDialog = false">
      <van-field v-model="cmtText" type="textarea" rows="3" placeholder="写下你的点评…" />
    </van-dialog>

    <van-dialog v-model:show="rpyDialog" :title="`回复 ${rpyTarget?.name || ''} 的点评`" show-cancel-button
      @confirm="submitReply" @cancel="rpyDialog = false">
      <van-field v-model="rpyText" type="textarea" rows="3" placeholder="写下你的感谢…" />
    </van-dialog>

    <van-popup v-model:show="hlpShow" position="bottom" round>
      <van-picker :columns="hlpCols" title="替谁代传？（TA本周还没传）" @confirm="onHelperPick" @cancel="hlpShow = false" />
    </van-popup>
  </div>
</template>

<style scoped>
.learning-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:18px 0 12px}.learning-heading h2{font-size:18px;margin:0}.learning-heading button{font-size:13px;border:0;background:none;color:#d3321f;padding:6px}.section-tabs{display:flex;background:#fff;border-radius:12px;padding:4px;margin-bottom:14px;gap:4px}.section-tabs button{flex:1;padding:10px 4px;border:0;border-radius:9px;background:none;color:#7e8792;font-size:14px}.section-tabs button.active{background:#fff1ed;color:#d3321f;font-weight:700}.action-target{scroll-margin-top:72px}.library-search{display:flex;gap:7px;margin:14px 0}.library-search input{min-width:0;flex:1;border:1px solid #eee5df;border-radius:8px;padding:9px;font-size:14px}.library-search button,.library-filters button{border:0;background:#fff1ed;color:#d3321f;border-radius:8px;padding:7px 10px;font-size:13px}.library-filters{display:flex;align-items:center;flex-wrap:wrap;gap:9px;font-size:12px;margin-bottom:12px}.library-filters select,.library-filters input{background:white;border:1px solid #eee5df;border-radius:6px;padding:6px;max-width:150px;font-size:12px}.library-letter{padding:14px 0;border-bottom:1px solid #f4f0ee}.library-title{display:flex;align-items:center;justify-content:space-between;gap:10px;border:0;background:none;padding:0;width:100%;text-align:left;font-size:14px;color:#333}.library-title small{display:block;color:#98a2b3;font-size:12px;margin-top:4px}.library-title>span:last-child{font-size:12px;color:#d3321f;white-space:nowrap}.honor-tags{display:flex;gap:5px;flex-wrap:wrap;margin:9px 0}.library-excerpt{font-size:13px;line-height:1.8;color:#7e8792;margin:8px 0}.library-image{display:block;max-width:100%;border-radius:8px;margin-top:8px}.l-content{overflow-wrap:anywhere}
.duty-line { font-size: 14px; }
.row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.img-btn { border: 1px dashed #d3321f; color: #d3321f; border-radius: 8px; padding: 6px 12px; font-size: 13px; }
.preview { height: 56px; border-radius: 6px; }
.l-content { font-size: 14px; line-height: 1.8; white-space: pre-wrap; }
.cmt-hd { color: #d3321f; font-size: 13px; margin: 10px 0 6px; }
.cmt { background: #faf7f6; border-radius: 8px; padding: 8px 10px; font-size: 13px; margin-top: 6px; }
.cmt b { color: #d3321f; font-weight: 600; }
.reply { margin-top: 6px; padding: 6px 8px; background: #fff; border-left: 2px solid #d3321f; border-radius: 4px; color: #d3321f; }
.reply-btn { margin-top: 6px; color: #d3321f; font-size: 12px; }
.wk-row { display: grid; grid-template-columns: 56px 1fr auto; align-items: center; gap: 8px; padding: 9px 0; border-bottom: 1px solid #f4f0ee; font-size: 14px; }
.wk-row:last-child { border-bottom: none; }
.wk-day { color: #98a2b3; font-size: 12px; white-space: nowrap; }
.wk-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wk-status { justify-self: end; }
.rv-row { display: flex; align-items: center; padding: 10px 2px; border-bottom: 1px solid #f4f0ee; font-size: 14px; cursor: pointer; }
.rv-row:last-of-type { border-bottom: none; }
.rv-body { padding: 10px 4px 14px; border-bottom: 1px solid #f4f0ee; background: #fff; }
</style>
