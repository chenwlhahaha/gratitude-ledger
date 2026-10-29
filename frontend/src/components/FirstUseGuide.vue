<script setup>
import { computed } from "vue";
const props = defineProps({ show: Boolean, firstUse: Boolean, className: { type: String, default: "" } });
const emit = defineEmits(["close"]);
const intro = computed(() => props.className.trim() ? `欢迎来到${props.className.trim()}，一起从今天开始。` : "一起从今天开始。");
const steps = [
  { icon: "passed", title: "每天读书，完成后再打卡", text: "在「今日」点击每日读书任务，完成情况会自动记录。" },
  { icon: "comment-o", title: "读家书，也留下你的收获", text: "进入「家书」，阅读今日轮值家书并发送点评。只打开阅读不会完成点评；当天作者免评。" },
  { icon: "edit", title: "每周一篇，分享你的收获", text: "在「我的本周家书」上传文字或图片，可提前上传，也可帮未上传的组员代传。" },
  { icon: "records", title: "其他学习，如实登记", text: "周会、月度学习等完成后再打卡；大项申报提交后，需要等待审批。" },
  { icon: "chart-trending-o", title: "每份投入，都有记录", text: "首页查看今日收益，「我的」查看累计记录。家书页展示本月荣耀榜，也可阅读班级历史优秀家书。" },
];
</script>

<template>
  <van-popup :show="show" round closeable :close-on-click-overlay="false" class="first-use-guide"
    role="dialog" aria-modal="true" aria-labelledby="first-guide-title"
    @update:show="value => { if (!value) emit('close'); }">
    <div class="guide-heading"><span class="guide-seal">谢</span><span>{{ firstUse ? '首次使用指引' : '使用说明' }}</span></div>
    <h2 id="first-guide-title">把每天的学习，<br>变成看得见的成长</h2>
    <p class="guide-intro">{{ intro }}</p>
    <div class="guide-steps">
      <div v-for="step in steps" :key="step.title" class="guide-step"><span class="guide-icon"><van-icon :name="step.icon" /></span><div><h3>{{ step.title }}</h3><p>{{ step.text }}</p></div></div>
    </div>
    <div class="guide-footer"><van-button type="primary" block round @click="emit('close')">知道了，开始打卡</van-button><p>以后可在「使用说明」中再次查看</p></div>
  </van-popup>
</template>

<style scoped>
.first-use-guide { width: min(90vw, 430px); max-height: 90vh; box-sizing: border-box; padding: 28px 24px 22px; background: #fffdf9; }
.guide-heading { display: flex; align-items: center; gap: 8px; color: #9e7c61; font-size: 12px; padding-right: 24px; }
.guide-seal { display: grid; place-items: center; width: 27px; height: 27px; border-radius: 7px; color: #fff; background: #d3321f; font-family: serif; font-size: 18px; }
h2 { margin: 18px 0 9px; font-size: 24px; line-height: 1.5; font-weight: 600; color: #343b44; }
.guide-intro { color: #8b8075; font-size: 13px; line-height: 1.7; margin: 0 0 22px; }
.guide-steps { display: grid; gap: 19px; }
.guide-step { display: grid; grid-template-columns: 31px minmax(0, 1fr); gap: 11px; }
.guide-icon { display: grid; place-items: center; width: 31px; height: 31px; border-radius: 9px; background: #f8ece2; color: #a87550; font-size: 18px; }
h3 { font-size: 14px; line-height: 1.6; margin: 0 0 4px; font-weight: 600; color: #43474d; }
.guide-step p { color: #7a7f88; font-size: 12px; line-height: 1.8; margin: 0; }
.guide-footer { margin-top: 24px; }
.guide-footer p { font-size: 11px; text-align: center; color: #948b81; margin: 11px 0 0; }
@media(max-width:360px) { .first-use-guide { padding: 24px 19px 20px; } h2 { font-size: 22px; } }
</style>
