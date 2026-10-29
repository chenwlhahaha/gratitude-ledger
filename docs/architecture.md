# 架构说明

本文给维护者和二次开发者看的：进程怎么跑、数据长什么样、权限怎么判定、接口怎么分组。业务使用说明见 [管理员使用指南](setup.md)。

## 1. 总体结构

```text
浏览器（手机 H5 / PC 控制台）
        │  HTTPS
        ▼
反向代理（Nginx / Caddy）
        │  http://127.0.0.1:3104
        ▼
┌─────────────────────────────────────────────┐
│ server.js（单进程，零第三方依赖）            │
│                                             │
│  路由分发                                    │
│   ├── /api/*      → JSON 接口                │
│   ├── /uploads/*  → DATA_DIR/uploads 图片    │
│   ├── /healthz    → 健康检查                 │
│   └── 其余路径     → public/ 静态文件         │
│                                             │
│  内存中的 store 对象                         │
│   └── 300ms 防抖 → 原子写 DATA_DIR/store.json │
└─────────────────────────────────────────────┘
        │
        ▼
DATA_DIR/
├── store.json
└── uploads/
```

设计取舍：

- **一个班一份进程 + 一份数据目录**。不做多租户，班级之间天然隔离，出问题影响面小，备份和迁移也简单。
- **零运行时依赖**。只用 Node 标准库，避免供应链风险和 `npm install`。升级 Node 版本即可获得安全修复。
- **JSON 全量读写**。班级规模（几十人、每月数百条记录）下完全够用；换来的是可直接阅读、可直接备份、可手工修复的数据文件。
- **前端构建产物入库**。`public/` 随代码提交，服务端直接托管，部署端不需要 Node 构建工具链。

## 2. 进程与静态托管

- 入口：`node server.js`，读取 `PORT`（默认 3104）、`HOST`（默认 `0.0.0.0`）、`DATA_DIR`（默认 `./data`）。
- `/healthz` 返回 `{"ok":true}`，适合负载均衡和监控探活。
- `/api/*` 命中接口分发，其余按文件路径从 `public/` 读取；`/uploads/*` 从 `DATA_DIR/uploads/` 读取。
- HTML 响应带 `Cache-Control: no-cache`，保证发版后立即生效；带哈希的 JS/CSS 允许长缓存。
- 路径会规范化并校验前缀，防止目录穿越。
- 发布窗口内如果存在 `DATA_DIR/.release-maintenance`，写操作返回 503 + `Retry-After`，用于"升级失败自动回滚"的场景。

## 3. store.json 结构

下面是字段示意（值均为占位，实际以运行数据为准）：

```json
{
  "className": "示例班",
  "schemaV2": 9,
  "setupComplete": true,
  "settings": { "letterOpenSince": "2026-10-01" },
  "groups": [
    {
      "id": "g_example01",
      "name": "第一组",
      "leaderId": "m_leader",
      "fudaoId": "",
      "xueweiId": "",
      "jiweiId": "",
      "guanaiId": "",
      "huodongId": "",
      "letterDeadline": "21:00",
      "letterCycleStart": "2026-10-01",
      "letterOrder": [],
      "letterPlan": [{ "memberId": "m_a", "day": 0 }]
    }
  ],
  "members": [
    {
      "id": "m_admin",
      "name": "示例班主任",
      "role": "classAdmin",
      "title": "班主任",
      "code": "由管理员设置",
      "groupId": null,
      "taskGroupId": null,
      "active": true,
      "targets": { "income": 0, "expense": 0, "benefit": 0, "hours": 0 }
    }
  ],
  "classOfficers": { "xuewei": "", "jiwei": "", "guanai": "", "huodong": "" },
  "activities": [],
  "specials": [],
  "records": {
    "2026-10-08": {
      "m_a": {
        "items": { "read": true },
        "customs": [{ "id": "adj01", "amount": 100, "label": "组内加分", "note": "" }]
      }
    }
  },
  "approvals": [],
  "letters": [],
  "letterHonors": { "classDecisions": {}, "schoolAwards": {}, "audit": [] },
  "guideSeen": {},
  "tokens": {}
}
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `className` | 班级名称，登录页与控制台展示 |
| `schemaV2` | 数据结构版本，当前为 `9`；启动时按此判断是否需要迁移 |
| `setupComplete` | 是否已完成首次初始化；新装为 `false`，旧数据迁移时补 `true` |
| `settings.letterOpenSince` | 家书可见起始日：此日之后的同组家书可被组员阅读点评；更早的只有作者本人可见 |
| `groups[]` | 小组及组内职务、家书截止时间、周期锚点、排班表（`letterPlan` 的 `day` 为周一 0 至周日 6） |
| `members[]` | 成员；`role` 取值 `classAdmin` / `monitor` / `leader` / `member`；`taskGroupId` 用于辅导员跨组任务归属；`active` 为账号启停 |
| `classOfficers` | 班级条线职务（学委 / 纪委 / 关爱委 / 活动委），存成员 id |
| `activities[]` | 收支标准：`income` / `expense` / `hours` / `freq` / `groupRule` |
| `specials[]` | 需审批的大项定义（固定金额或需定级） |
| `records` | `日期 → 成员 id → { items, customs }`；`items` 是打卡项，`customs` 是加减分明细 |
| `approvals[]` | 大项申请与审批状态（`pending` / `approved` / `rejected`） |
| `letters[]` | 家书：作者、代传人、归属日期、正文、图片、迟交标记、点评与作者回复 |
| `letterHonors` | 每日班级优秀与塾里优秀的决定、获奖记录和审计日志 |
| `guideSeen` | 首次使用指引是否已读 |
| `tokens` | 持久化会话，默认 30 天有效，重启不掉线 |

家书图片以 `/uploads/<随机文件名>` 形式存路径，实际文件在 `DATA_DIR/uploads/`，单张限 2 MB。

### 写入方式

- 内存 `store` 为唯一事实来源；修改后调用 `save()`，300ms 防抖后写 `store.json.tmp` 并原子 `rename`。
- 进程收到 `SIGTERM` / `SIGINT` 会立即落盘再退出，所以 `systemctl stop` 不会丢数据。
- 启动时如果 `store.json` 解析失败，或已初始化（`setupComplete` 不为 `false`）但成员数据结构非法，服务会**拒绝启动**，避免带着坏数据继续写入。

## 4. schemaV2 迁移机制

启动流程：读取 `store.json` → 无文件则建空 store → 校验 → `migrate()` → 监听端口。

- `schemaV2` 是唯一的版本标尺，当前目标值 `9`。
- 版本低于目标时按阶段补齐：先补 v8（控制台/组务职务），再补 v9（优秀家书与使用指引已读状态）。
- 迁移**只补字段、不重写历史业务数据**：打卡记录、家书、审批、评选结果原样保留。
- 大版本迁移前会自动复制 `store.json.pre-console-v8.bak` / `store.json.pre-honors-v9.bak`，失败可回滚。
- 迁移函数是幂等的：重复启动不会重复执行已完成步骤；已被管理员撤下的职务不会因迁移被重新任命。
- 新装实例直接落到当前 schema，不经过历史迁移。

修改数据结构时必须遵守：

1. 递增 `schemaV2`，在 `migrate()` 里写可重入的补齐逻辑；
2. 不删除旧字段的读取兼容，除非确认所有部署都已升级；
3. 迁移前保留备份，并在 PR 里说明影响范围（见 PR 模板）。

## 5. 权限模型

### 5.1 角色

| 角色 | 存储 | 说明 |
| --- | --- | --- |
| 班主任 / 副班主任 | `role: classAdmin` + `title` | 全班管理员 |
| 班长 | `role: monitor` | 与管理员同级，可管理全班 |
| 组长 | `role: leader` 或组的 `leaderId` | 管理本组组务 |
| 辅导员 | 组的 `fudaoId` | 辅导负责组；学习任务在辅导员组 |
| 组学委 / 纪委 / 关爱委 / 活动委 | 组的 `xueweiId` / `jiweiId` / `guanaiId` / `huodongId` | 按组查看组织与学习 |
| 班级学委 / 纪委 / 关爱委 / 活动委 | `classOfficers` | 统筹各组同名委员 |
| 组员 | `role: member` | 打卡、写家书、点评、申报 |

同一个人可以同时是组员和组职务；职务只是附加能力，不改变学习任务归属。

### 5.2 能力判定

服务端 `consolePermissions(member)` 计算控制台能力，核心规则：

| 能力 | 判定 |
| --- | --- |
| `fullAdmin` | `role` 为 `classAdmin` 或 `monitor` |
| 管理范围 `manageGroups` | 管理员 = 全部小组；否则为本人任组长或辅导员的组 |
| 学习范围 `scheduleGroups` | 管理员；班级学委 = 全部；否则为管理范围 + 本人任组学委的组 |
| 组织范围 `organizationGroups` | 管理员；班级条线委员 = 全部；否则为本人担任任一组职务的组 |
| 审批 / 收支标准 | 仅 `fullAdmin` |
| 报表导出 | 需要 `reports`，导出内容限制在 `scheduleGroups` 内 |
| 成员账号管理 | 管理员可管理非管理员账号；组长/辅导员只能管理本任务组普通成员 |

两个特例：**班级优秀家书**只能由 `title` 为"班主任"的账号设置（副班主任、班长不可）；**塾里优秀**只能由班级学委登记，且只在工作日生效。

所有接口在服务端二次校验，前端菜单隐藏只是体验优化，不构成安全边界。

### 5.3 会话

- 登录成功签发随机 token，写入 `store.tokens`，默认 30 天有效，每小时刷新活跃时间。
- 请求头 `Authorization: Bearer <token>`；CSV 导出等下载链接额外支持 `?token=`。
- 停用账号、重置登录码会撤销该成员已有会话。

## 6. API 分组

所有接口以 `/api/` 开头，返回 JSON；错误格式为 `{ "error": "..." }`。

| 分组 | 主要路径 | 说明 |
| --- | --- | --- |
| 初始化 | `GET/POST /api/setup` | 全新实例判断是否需要初始化；提交班级、班主任、登录码、分组 |
| 登录 | `/api/groups-public`、`/api/login`、`/api/pick-login`、`/api/logout` | 选组选姓名登录、统一下发 token |
| 个人 | `/api/bootstrap`、`/api/checkin`、`/api/special`、`/api/my`、`/api/group` | 首页聚合、打卡、大项申报、我的明细、小组看板 |
| 家书 | `/api/letters`、`/api/letter/submit`、`/api/letter/comment`、`/api/letter/reply` | 周排班、上传/代传、点评、作者回复 |
| 荣誉 | `/api/letter-honors*`、`/api/monthly-rankings`、`/api/letter-library`、`/api/guide/seen` | 每日优秀、月榜、优秀家书库、指引已读 |
| 控制台 | `/api/console`、`/api/console/member`、`/api/console/letters`、`/api/console/export` | 概览、成员明细、家书列表、CSV 导出 |
| 组务 | `/api/leader/*` | 排班与截止时间、组内加减分、组员账号 |
| 班级管理 | `/api/admin/*` | 班级、小组、班委、成员、审批、评选、收支标准 |
| 健康检查 | `GET /healthz` | 探活 |

约定：读接口用 `GET`，写接口用 `POST` + JSON body；月份参数 `month=YYYY-MM`，日期参数 `date=YYYY-MM-DD`，服务端统一校验格式。

## 7. 时间与统计口径

- "今天"按中国时区计算（`Asia/Shanghai`），与服务器本地时区无关。
- 家书归属日期优先取正文里的【分享时间】，识别不到才用上传日。
- 周从周一开始，家书周期以组的 `letterCycleStart` 为锚点。
- 收益 = 收入 − 费用；工时单独累计，用于"单位时间收益"。
- 修改收支标准只影响之后的核算，不回溯已产生的历史月份。

## 8. 前端

- Vue 3 + Vite + Vant 4，构建输出到 `public/`（`vite.config.js` 中 `outDir: "../public"`，`base: "./"`）。
- 开发时 `npm run dev`，`/api` 代理到 `127.0.0.1:3104`。
- 页面：登录、今日、家书、小组、我的、管理控制台、首次初始化；组件包括首次使用指引、优秀家书、月榜。
- 控制台按能力动态生成菜单，无权限的区块不渲染。
- 状态管理用组件内 `ref/computed`，未引入 Pinia/Vuex；请求封装在 `src/api.js`。

## 9. 扩展建议

想加新功能时，优先考虑：

1. **新打卡项** → 在 `DEFAULT_ACTIVITIES` 增加定义，控制台可改分值，不需要改表结构；
2. **新审批大项** → 在 `DEFAULT_SPECIALS` 增加定义；
3. **新报表字段** → 改 `csvReport`，保持 CSV 兼容（新增列放末尾）；
4. **新角色** → 先想清楚它属于"班级条线"还是"组内职务"，再扩展 `OFFICERS` / `CLASS_LINES` 与 `consolePermissions`，并补权限测试。

不要为了一个小功能引入数据库或前端状态库——当前规模下，简单可靠的收益远大于架构复杂度。
