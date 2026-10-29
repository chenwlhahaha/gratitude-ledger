#!/usr/bin/env node
"use strict";

// 生成一份完全虚构的示例班级数据，用于本地预览、README 截图与演示。
// 用法：
//   node tools/seed-demo.js                  # 写入 ./demo-data/store.json
//   node tools/seed-demo.js --dir /tmp/demo  # 指定目录
//   DATA_DIR=./demo-data PORT=3104 node server.js
//
// 数据全部为虚构：人名、组名、家书正文均非真实内容，可安全提交到公开仓库。

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const args = process.argv.slice(2);
const dirIndex = args.indexOf("--dir");
const outDir = path.resolve(dirIndex >= 0 ? args[dirIndex + 1] : "demo-data");
const storeFile = path.join(outDir, "store.json");

const id = (n = 5) => crypto.randomBytes(n).toString("hex");
const fmt = (offsetDays = 0) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(Date.now() + offsetDays * 86400000));

const today = fmt();
const weekday = (new Date(today + "T00:00:00Z").getUTCDay() + 6) % 7; // 0=周一
const weekStart = fmt(-weekday);

const targets = (income) => ({ income, expense: 4000, benefit: income - 4000, hours: 55 });
const mk = (name, role, groupId, income, title = "") => ({
  id: id(), name, role, code: "13572468", groupId, active: true, title,
  targets: targets(income), taskGroupId: null,
});

const director = mk("陈静", "classAdmin", null, 0, "班主任");
const viceDirector = mk("赵磊", "classAdmin", null, 0, "副班主任");
const monitor = mk("刘洋", "monitor", "", 10000, "班长");
const xuewei = mk("周敏", "member", "", 10000);
const leaderA = mk("王小明", "leader", "", 35700);
const leaderB = mk("李芳", "leader", "", 20000);
const leaderC = mk("张伟", "leader", "", 15000);

const groups = [
  { id: "g_demo_a", name: "感恩组", leaderId: leaderA.id, xueweiId: "", fudaoId: "", jiweiId: "", guanaiId: "", huodongId: "", letterDeadline: "21:00", letterCycleStart: weekStart, letterOrder: [], letterPlan: [] },
  { id: "g_demo_b", name: "谦虚组", leaderId: leaderB.id, xueweiId: "", fudaoId: "", jiweiId: "", guanaiId: "", huodongId: "", letterDeadline: "21:00", letterCycleStart: weekStart, letterOrder: [], letterPlan: [] },
  { id: "g_demo_c", name: "利他组", leaderId: leaderC.id, xueweiId: "", fudaoId: "", jiweiId: "", guanaiId: "", huodongId: "", letterDeadline: "21:00", letterCycleStart: weekStart, letterOrder: [], letterPlan: [] },
];

leaderA.groupId = groups[0].id;
leaderB.groupId = groups[1].id;
leaderC.groupId = groups[2].id;
monitor.groupId = groups[0].id;
xuewei.groupId = groups[1].id;

const extraNames = {
  [groups[0].id]: [["吴强", 16000], ["徐帆", 12000], ["孙悦", 9000], ["马涛", 8000]],
  [groups[1].id]: [["朱琳", 13000], ["胡斌", 11000], ["郭雪", 10000], ["林峰", 7000]],
  [groups[2].id]: [["何静", 12000], ["高远", 9500], ["罗菲", 8800], ["梁晨", 6200]],
};
const members = [director, viceDirector, monitor, xuewei, leaderA, leaderB, leaderC];
for (const [gid, list] of Object.entries(extraNames)) {
  for (const [name, income] of list) members.push(mk(name, "member", gid, income));
}

// 每组按成员顺序排到周一至周五轮值
for (const g of groups) {
  const ordered = members.filter((m) => m.groupId === g.id).slice(0, 5);
  g.letterOrder = ordered.map((m) => m.id);
  g.letterPlan = ordered.map((m, i) => ({ memberId: m.id, day: i }));
}

const LETTER_TEXTS = [
  "本周重读《活法》，最大的触动是“付出不亚于任何人的努力”不是一句口号，而是要落到每天的具体选择上。这周我把晨会提前了半小时，先把当天最重要的一件事做完，晚上复盘时明显感觉更踏实。",
  "这周和同事一起处理了一次交付延期，起初我习惯性地先找外部原因，后来想到“要每天反省”，先承认是自己在排期时低估了工序时间。认下来之后，大家一起补了方案，反而比原计划更顺。",
  "读到“利他之心”，我想起上个月帮邻组同事梳理了一次客户方案。当时没想回报，这周他主动来帮我核对数据，才发现善意是会回来的。以后遇到能帮的事，我提醒自己不要先算得失。",
  "本周最大的收获是学会了在情绪上来时先停三分钟。以前遇到客户投诉第一反应是解释，现在先听对方说完，再复述一遍确认，沟通成本低了很多。六项精进里的“不要有感性的烦恼”，我理解得比以前深了。",
  "这周家里老人住院，工作和陪护两头跑，读书时间被切得很碎。但每天睡前读两页成了固定动作，反而成了那几天最安静的时刻。原来坚持不需要很长时间，只需要一个不被打断的小仪式。",
  "跟团队复盘了三个月的目标，发现真正卡住的不是资源，而是我们不敢把问题摊开讲。这次我先做了自我批评，气氛才慢慢打开。反省不是为了自责，是为了让下一次能做得更好。",
  "这周尝试把“感谢”说出口。给合作多年的供应商打了个电话，认真说了谢谢，对方愣了几秒，然后聊了很多。原来一句具体的感谢，比一次饭局更能拉近距离。",
];

const COMMENTS = [
  "读得很真实，尤其是“先听对方说完”这一段，我也有同感。",
  "这周的转变看得见，一起加油。",
  "感谢分享，把读书落到了具体动作上，受启发。",
  "“坚持不需要很长时间，只需要一个不被打断的小仪式”，这句话我记下了。",
  "很有共鸣，下周我也试试先把最重要的一件事做完。",
  "认下来之后反而更顺，这一段值得反复读。",
];

const letters = [];
const records = {};

// 本周已过去的每一天安排一篇轮值家书
for (let d = 0; d <= weekday; d++) {
  const date = fmt(-(weekday - d));
  const g = groups[d % groups.length];
  const plan = g.letterPlan[d % g.letterPlan.length];
  const author = members.find((m) => m.id === plan.memberId);
  if (!author) continue;
  const commenters = members.filter((m) => m.groupId === g.id && m.id !== author.id).slice(0, 3);
  letters.push({
    id: id(8), groupId: g.id, authorId: author.id, authorName: author.name, date,
    content: LETTER_TEXTS[d % LETTER_TEXTS.length],
    images: [], late: false, featured: false, featuredWeek: "", publishToClass: true,
    comments: commenters.map((c, i) => ({
      id: id(6), memberId: c.id, name: c.name, text: COMMENTS[(d + i) % COMMENTS.length],
      at: Date.now() - (d + 1) * 3600000,
      ...(i === 0 ? { reply: { text: "谢谢，一起精进。", at: Date.now() - d * 3600000 } } : {}),
    })),
  });
}

// 过去 20 天的打卡记录
for (let i = 0; i < 20; i++) {
  const date = fmt(-i);
  const dow = new Date(date + "T00:00:00Z").getUTCDay();
  const day = (records[date] = {});
  for (const m of members) {
    if (m.role === "classAdmin") continue;
    if (Math.random() < 0.15) continue;
    day[m.id] = {
      items: { read: true, ...(dow !== 6 ? { review: true } : {}), ...(dow === 1 ? { meet: true } : {}) },
      customs: [],
    };
  }
}

// 荣誉榜示例：一篇班级优秀（工作日）
let honorDate = fmt(-1);
if (new Date(honorDate + "T00:00:00Z").getUTCDay() === 0) honorDate = fmt(-2);
if (new Date(honorDate + "T00:00:00Z").getUTCDay() === 6) honorDate = fmt(-3);

const letterHonors = { classDecisions: {}, schoolAwards: {}, audit: [] };
const honoredLetter = letters.find((l) => l.date <= honorDate) || letters[0];
if (honoredLetter) {
  honoredLetter.publishToClass = true;
  honoredLetter.nominatedAt = Date.now() - 86400000;
  letterHonors.classDecisions[honorDate] = {
    id: id(8), date: honorDate, letterId: honoredLetter.id, status: "selected",
    actorId: director.id, at: Date.now() - 86400000,
  };
}

const store = {
  className: "示例班",
  setupComplete: true,
  schemaV2: 9,
  settings: { letterOpenSince: fmt(-60) },
  groups,
  members,
  classOfficers: { xuewei: xuewei.id, jiwei: "", guanai: "", huodong: "" },
  activities: [
    { id: "read", name: "每日读书打卡", income: 500, expense: 200, hours: 0.5, freq: "daily", groupRule: { bonus: 200, bonusName: "全组及时完成奖励", penalty: -100, penaltyName: "未全员·凝聚补救" } },
    { id: "review", name: "点评当日家书", income: 500, expense: 200, hours: 0.5, freq: "daily", auto: true, groupRule: { bonus: 200, bonusName: "全组点评完成奖励", penalty: -100, penaltyName: "有人未评·凝聚补救" } },
    { id: "meet", name: "每周周会", income: 3000, expense: 1500, hours: 3, freq: "weekly", groupRule: { bonus: 500, bonusName: "全组准时参加周会", penalty: -200, penaltyName: "未参加·凝聚补救" } },
    { id: "monthly", name: "月度学习会", income: 6000, expense: 3000, hours: 6, freq: "monthly", groupRule: { bonus: 1000, bonusName: "全员参加·凝心聚力", penalty: -400, penaltyName: "未参加·凝聚补救" } },
    { id: "online", name: "线上视频学习", income: 1000, expense: 500, hours: 1, freq: "monthly" },
    { id: "offline", name: "线下大课学习", income: 6000, expense: 3000, hours: 6, freq: "monthly", groupRule: { bonus: 2000, bonusName: "全组同频奖励" } },
  ],
  specials: [
    { key: "share_class", name: "利他分享·班内", income: 2000, expense: 1000, hours: 2, fixed: true },
    { key: "share_cross", name: "利他分享·跨班", income: 3000, expense: 1500, hours: 3, fixed: true },
    { key: "share_city", name: "利他分享·市塾", income: 20000, expense: 6000, hours: 6, fixed: true },
    { key: "visit_host", name: "企业走访·被走访", income: 6000, expense: 2500, hours: 5, fixed: true },
    { key: "visit_guest", name: "企业走访·参访", income: 3000, expense: 1500, hours: 3, fixed: true },
    { key: "recruit", name: "发展塾友", income: 2000, expense: 1500, hours: 3, fixed: true },
  ],
  records,
  approvals: [
    { id: id(8), memberId: members[7].id, memberName: members[7].name, date: fmt(-1), name: "利他分享·班内", note: "下周班级分享，主题：把六项精进落到车间", amount: 2000, income: 2000, expense: 1000, hours: 2, status: "pending" },
    { id: id(8), memberId: members[9].id, memberName: members[9].name, date: fmt(-2), name: "企业走访·参访", note: "参访同学企业生产线，学习现场管理", amount: 3000, income: 3000, expense: 1500, hours: 3, status: "pending" },
  ],
  tokens: {},
  letters,
  letterHonors,
  guideSeen: Object.fromEntries(members.map((m) => [m.id, Date.now()])),
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(storeFile, JSON.stringify(store, null, 2));
console.log(`示例数据已写入 ${storeFile}`);
console.log(`启动预览：DATA_DIR=${path.relative(process.cwd(), outDir) || "."} PORT=3104 node server.js`);
console.log(`登录：任选组 → 选名字 → 登录码 13572468（班主任：${director.name}）`);
