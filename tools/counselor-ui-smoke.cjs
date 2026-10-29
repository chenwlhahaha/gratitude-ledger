#!/usr/bin/env node
// Synthetic-only end-to-end checks for counselor-group entry and member management.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net');
const { spawn } = require('node:child_process');
const { chromium } = require('/Users/edy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hx-counselor-ui-'));
const screenshots = process.env.QA_SCREENSHOTS || path.join(os.tmpdir(), 'hx-counselor-ui-qa');
fs.mkdirSync(screenshots, { recursive: true });
const targets = { income: 10000, expense: 4000, benefit: 6000, hours: 55 };
const person = (id, groupId, taskGroupId = null, role = 'member') => ({ id, name: '测试-' + id, groupId, taskGroupId, role, active: true, code: 'demo-code', targets });
const group = (id, name, leaderId = '', fudaoId = '') => ({ id, name, leaderId, fudaoId, letterDeadline: '21:00', letterPlan: [], letterOrder: [], letterCycleStart: '2026-10-19' });
const fixture = {
  schemaV2: 7, className: '合成测试班',
  groups: [group('a', '测试家组', 'homeleader', 'counselor'), group('g_fudao', '辅导员组', 'fdleader'), group('archive', '历史空组')],
  members: [person('director', null, null, 'classAdmin'), person('homeleader', 'a'), person('fdleader', 'a', 'g_fudao'), person('counselor', 'a', 'g_fudao'), person('resident', 'g_fudao')],
  activities: [{ id: 'read', name: '读书', income: 500, expense: 200, hours: 0.5, freq: 'daily' }],
  specials: [], records: {}, approvals: [], tokens: {}, letters: [],
};
fixture.members[0].title = '班主任';
fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify(fixture));
let child, browser, base, logs = '', passed = 0;
const errors = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function api(route, token, body, status = 200) {
  const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json(); assert.equal(response.status, status, route + ': ' + JSON.stringify(result)); return result;
}
async function check(name, run) { await run(); passed++; console.log('PASS ' + name); }
async function menu(page, text) { await page.locator('.console-sidebar button').filter({ hasText: text }).click(); }
async function accountRow(page) { return page.locator('.c-table tbody tr').filter({ hasText: '测试-新增辅导员组员' }); }
async function confirm(page) { await page.locator('.van-dialog__confirm').click(); }
(async () => {
  const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve)); base = 'http://127.0.0.1:' + port;
  child = spawn(process.execPath, [path.join(root, 'server.js')], { cwd: root, env: { ...process.env, DATA_DIR: dir, HOST: '127.0.0.1', PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', data => logs += data);
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/healthz')).ok) break; } catch {} if (child.exitCode !== null) throw Error(logs); await sleep(50); }
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(base);
  await check('mobile login shows counselor group and hides empty archive', async () => {
    await page.getByRole('button', { name: /^辅导员组 / }).waitFor();
    assert.equal(await page.getByRole('button', { name: /^历史空组 / }).count(), 0);
    await page.screenshot({ path: path.join(screenshots, 'counselor-entry-mobile.png'), fullPage: true });
    await page.getByRole('button', { name: /^辅导员组 / }).click();
    assert.equal(await page.locator('.m-card').count(), 3);
    await page.locator('.m-card').filter({ hasText: '测试-fdleader' }).click();
    await page.getByPlaceholder('请输入登录码').fill('demo-code');
    await page.getByRole('button', { name: '进 入', exact: true }).click();
    await page.locator('.header-bar').waitFor();
  });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.reload(); await page.locator('.console-sidebar').waitFor();
  const token = await page.evaluate(() => localStorage.getItem('hx_token'));
  await check('counselor-group leader can add an ordinary member', async () => {
    await menu(page, '组务管理');
    await page.getByLabel('姓名', { exact: true }).fill('测试-新增辅导员组员');
    await page.getByLabel('登录码', { exact: true }).fill('demo-code');
    await page.getByRole('button', { name: '添加成员', exact: true }).click();
    await page.getByText('成员已添加', { exact: true }).waitFor();
    const state = await api('/api/console', token);
    const added = state.members.find(m => m.name === '测试-新增辅导员组员');
    assert.equal(added.groupId, 'g_fudao'); assert.ok(added.canManageAccount);
    const entry = (await api('/api/groups-public')).groups.find(g => g.id === 'g_fudao');
    assert.equal(entry.members.filter(m => m.id === added.id).length, 1);
    await page.screenshot({ path: path.join(screenshots, 'counselor-group-add.png'), fullPage: true });
  });
  await menu(page, '组织与班委');
  await check('leader sees scoped account controls without task-group reassignment', async () => {
    const protectedRow = page.locator('.c-table tbody tr').filter({ hasText: '测试-counselor' }).filter({ has: page.locator('td.strong') });
    assert.equal(await protectedRow.getByRole('button', { name: '管理成员' }).count(), 0);
    await (await accountRow(page)).getByRole('button', { name: '管理成员' }).click();
    const modal = page.getByRole('dialog');
    assert.equal(await modal.getByLabel('学习任务组').count(), 0);
    await modal.getByLabel('新登录码').fill('12345678');
    await modal.getByRole('button', { name: '重置登录码', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const session = await api('/api/login', null, { name: '测试-新增辅导员组员', code: '12345678' });
    assert.equal(session.member.groupId, 'g_fudao');
    await (await accountRow(page)).getByRole('button', { name: '管理成员' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '停用账号', exact: true }).click(); await confirm(page);
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await (await accountRow(page)).getByText('已停用', { exact: true }).waitFor();
    await api('/api/bootstrap', session.token, undefined, 401);
    await (await accountRow(page)).getByRole('button', { name: '管理成员' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '启用账号', exact: true }).click(); await confirm(page);
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await (await accountRow(page)).getByText('正常', { exact: true }).waitFor();
    await api('/api/login', null, { name: '测试-新增辅导员组员', code: '12345678' });
    await page.screenshot({ path: path.join(screenshots, 'counselor-member-management.png'), fullPage: true });
  });
  await check('no page errors or horizontal overflow', async () => {
    assert.deepEqual(errors, []);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  });
  console.log(JSON.stringify({ passed, screenshots, synthetic: true }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (child && child.exitCode === null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)); }
  fs.rmSync(dir, { recursive: true, force: true });
});
