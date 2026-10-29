# 贡献指南

感谢愿意一起完善这个项目。这个应用服务于真实的班级，改动会直接影响学员的打卡与核算记录，所以我们对**数据安全**和**兼容性**的要求高于一般项目。

## 1. 开发环境

| 工具 | 版本 | 用途 |
| --- | --- | --- |
| Node.js | 18+（建议 20 LTS） | 后端运行与测试 |
| npm | 随 Node 附带 | 仅前端依赖与构建 |
| Chrome | 可选 | 本地浏览器冒烟测试 |
| Playwright | 可选 | `tools/ui-smoke.cjs` 依赖 |

启动后端（零依赖，不需要安装）：

```bash
node server.js
# http://127.0.0.1:3104
```

初始化一个临时班级，避免污染本地数据：

```bash
DATA_DIR=$(mktemp -d) PORT=3199 node server.js
```

前端开发：

```bash
cd frontend
npm ci
npm run dev      # /api 代理到 127.0.0.1:3104
npm run build    # 输出到 ../public
```

## 2. 提交前必须跑的测试

```bash
node tools/console-tests.js
node tools/honors-tests.js
```

这两个脚本使用**纯合成数据**、临时目录、临时端口，不会读写真实 `data/`。新增后端行为时，请把用例补进对应脚本（而不是另起一套框架）。

可选（需要本机 Chrome / Playwright，CI 不执行）：

```bash
node tools/ui-smoke.cjs
node tools/counselor-ui-smoke.cjs
```

改前端后至少跑一次 `npm run build`，确认构建通过。`public/` 的产物是否提交，按 PR 类型决定：

- 只改文档 / 后端：不提交 `public/`；
- 改前端用户可见行为：提交重新构建后的 `public/`，并在 PR 里注明；
- 纯重构且产物无变化：不必提交。

## 3. 分支命名

从 `main` 切出，使用 `类型/简短描述`：

| 前缀 | 场景 | 示例 |
| --- | --- | --- |
| `feat/` | 新功能 | `feat/monthly-export-filter` |
| `fix/` | 缺陷修复 | `fix/letter-date-parse` |
| `docs/` | 文档 | `docs/deploy-caddy` |
| `chore/` | 构建、CI、依赖、杂务 | `chore/ci-node22` |
| `test/` | 只加/改测试 | `test/letter-honors` |

描述用小写英文和连字符，避免中文、空格和姓名。

## 4. 提交信息

采用 [Conventional Commits](https://www.conventionalcommits.org/)：

```text
<type>(<scope>): <subject>

<body 可选>
```

常用类型：`feat`、`fix`、`docs`、`chore`、`test`、`refactor`、`perf`。

示例：

```text
feat(console): 支持按小组导出月度报表
fix(letter): 修正【分享时间】跨月时的归属日期
docs: 补充 Caddy 反向代理示例
```

要求：

- 一个提交只做一件事，不要把格式化、重命名和功能混在一起；
- 标题不超过 72 个字符，说清"做了什么"；
- 涉及数据迁移、权限变化、接口变更时，在正文里写明影响和回滚方式。

## 5. 代码风格

### 后端

- 保持**零运行时依赖**：只用 Node 标准库。确有必要引入依赖时，必须在 PR 中说明原因、体积、维护状态和替代方案，并经维护者同意。
- 单文件 `server.js` 是有意为之，新增逻辑按现有分段注释归位，不要为了"分层"拆成一堆小文件。
- 保持 CommonJS、`"use strict"`、现有命名与中文注释风格；错误用 `{ code, msg }` 抛出，由统一分发转成 JSON。
- 所有写操作走 `save()`；不要在请求里直接同步写 `store.json`。
- 新增接口必须在服务端校验权限和参数，不能只靠前端隐藏。

### 前端

- Vue 3 `<script setup>` + Composition API，Vant 4 组件；不引入新的 UI 框架或状态库。
- 颜色、间距、圆角优先复用 `src/style.css` 中的变量与现有类名。
- 移动端优先：新页面在 375px 宽度下不能横向滚动。
- 文案使用简体中文，避免出现具体班级、真实姓名。

### 文档

- 中文文档，命令可复制执行。
- 示例中的班级、姓名、域名、IP 一律用占位（如"示例班""第一组""ledger.example.com""127.0.0.1"）。

## 6. Pull Request 流程

1. Fork 或从主仓库切分支，按上面的规范提交。
2. 本地跑完第 2 节的测试，确认全绿。
3. 按 PR 模板填写：变更说明、影响范围、测试方式、是否涉及数据迁移、截图。
4. CI 必须通过（Node 18/20/22 后端测试 + 前端构建）。
5. 至少 **1 名维护者 review 通过**后才能合并；涉及数据结构、权限、审批金额的改动建议 2 人 review。
6. 合并方式默认 squash merge，提交信息保持 Conventional Commits。

维护者会关注：

- 是否破坏了已有数据（尤其是 `records`、`letters`、`approvals`）；
- 权限判断是否在服务端生效；
- 是否把真实数据、真实姓名、部署信息带进了仓库；
- 测试是否覆盖了边界（跨月、跨周、空小组、停用账号、代传）。

## 7. 数据隐私红线

**以下内容一律不得出现在 Issue、PR、提交、测试、截图和文档中：**

- 真实学员 / 家长 / 老师的姓名、手机号、微信、住址；
- 真实家书正文、点评内容、图片；
- 真实班级名称、学校名称、机构内部称呼；
- 真实服务器 IP、域名、SSH 别名、端口映射、登录码、token；
- `data/` 目录下的任何文件（`.gitignore` 已忽略，但请提交前再确认一次）。

写测试一律用合成数据：

```js
const member = { id: "m_a", name: "测试-a", code: "test-code", groupId: "g_a", role: "member" };
```

发现仓库里已经混入真实数据，请立刻按 [安全策略](SECURITY.md) 私密报告，不要在公开 Issue 里贴内容。

## 8. 报告问题

- 功能缺陷、使用疑问：用仓库的 Issue 模板提交；
- 安全问题、数据泄露：**不要公开提交 Issue**，见 [SECURITY.md](SECURITY.md)；
- 新班级接入咨询：用"新班级接入"模板，说明班级规模、部署环境和想用的功能，不要贴真实名单。

## 9. 行为规范

参与本项目即表示同意遵守 [行为准则](CODE_OF_CONDUCT.md)。讨论对事不对人，涉及学员数据的讨论请私密进行。
