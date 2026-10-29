import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { settlementText } from '../public/scripts/ledger-core.mjs';
import { loginMessages, authErrorSource } from '../public/scripts/login-messages.mjs';
import featureMessages from '../public/scripts/feature-messages.mjs';

const saved = new Map([['bill-splitter-ledger-demo-v1', 'unchanged ledger data']]);
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: key => saved.get(key) ?? null,
  setItem: (key, value) => saved.set(key, value),
} });
const { t, registerMessages, setLanguage, getLanguage, formatDate, translateError } = await import('../public/scripts/i18n.mjs');
registerMessages(loginMessages);
registerMessages(featureMessages);

test('language selection persists across page loads without changing ledger data', async () => {
  assert.equal(getLanguage(), 'zh-CN');
  setLanguage('en');
  assert.equal(t('新建账本'), 'New ledger');
  const reloaded = await import('../public/scripts/i18n.mjs?reload');
  assert.equal(reloaded.getLanguage(), 'en');
  assert.equal(saved.get('bill-splitter-ledger-demo-v1'), 'unchanged ledger data');
  setLanguage('unsupported');
  assert.equal(getLanguage(), 'en');
  setLanguage('zh-CN');
  assert.equal(t('新建账本'), '新建账本');
});

test('storage restrictions do not prevent switching the current page', async () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('disabled'); } });
  const isolated = await import('../public/scripts/i18n.mjs?no-storage');
  isolated.setLanguage('en');
  assert.equal(isolated.t('新建账本'), 'New ledger');
});

test('placeholder values remain literal and calendar dates do not shift across time zones', () => {
  registerMessages({ '邀请{name}': 'Invite {name}' });
  setLanguage('en');
  assert.equal(t('邀请{name}', { name: '小林 {name}' }), 'Invite 小林 {name}');
  assert.equal(formatDate('2026-09-18'), 'Sep 18');
  setLanguage('zh-CN');
  assert.equal(formatDate('2026-09-18'), '9月18日');
});

test('validation and account errors use the selected language without raw service details', () => {
  setLanguage('en');
  assert.equal(translateError(new Error('账本名称不能为空，且不能超过 120 个字。')), 'Ledger name is required and must be no more than 120 characters.');
  assert.match(translateError(new Error('分摊金额合计不足账单金额，请补齐后保存。')), /Allocate the remainder/);
  assert.equal(t(authErrorSource({ code: 'auth/wrong-password' })), 'The email or password is incorrect. Try again.');
  assert.equal(translateError(new Error('Firebase internal failure: secret details')), 'Could not save. Please try again.');
});

test('English settlement export preserves names, expense titles, cents and input records', () => {
  const snapshot = {
    ledger: { title: '周末小账', currency: 'CNY' },
    members: [{ id: 'a', name: '小林' }, { id: 'b', name: 'Zed' }], payments: [],
    expenses: [{ title: '晚餐 Dinner', date: '2026-09-18', id: 'e1', status: 'active', payerMemberId: 'b', amountCents: 1001, shares: { a: 500, b: 501 }, repaid: { a: 0, b: 0 } }],
  };
  const before = JSON.stringify(snapshot);
  const statement = settlementText(snapshot, 'en');
  assert.match(statement, /Settlement statement/);
  assert.match(statement, /小林 → Zed: ¥5\.00 \(晚餐 Dinner · 2026-09-18\)/);
  assert.match(statement, /not a payment receipt/);
  assert.match(settlementText(snapshot), /待结算清单/);
  assert.equal(JSON.stringify(snapshot), before);
});

test('all shared-ledger source messages and login labels have English translations', async () => {
  const { default: appMessages } = await import('../public/scripts/app-messages.mjs');
  registerMessages(appMessages);
  setLanguage('en');
  const sources = await Promise.all(['app.mjs', 'expense-entry.mjs'].map(file => readFile(new URL(`../public/scripts/${file}`, import.meta.url), 'utf8')));
  const keys = sources.flatMap(source => [...source.matchAll(/\bt\((['"])(.*?)\1/g)].map(match => match[2]));
  const login = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  keys.push(...[...login.matchAll(/data-i18n="([^"]+)"/g)].map(match => match[1]));
  const missing = [...new Set(keys)].filter(key => /[\u4e00-\u9fff]/.test(t(key)));
  assert.deepEqual(missing, []);
});

test('item, receipt and recurring-expense errors retain actionable English messages', async () => {
  setLanguage('en');
  for (const source of [
    '项目名称不能为空，且不能超过 120 个字。',
    '项目合计或分摊金额与账单不一致，请重新核对。',
    '每份收据不能超过 200 KB。',
    '请选择有效的 JPG、PNG、WebP 图片或 PDF 收据。',
    '只有模板创建者或账本管理员可以管理此模板。',
    '这期账单已经处理，请刷新账本。',
  ]) {
    assert.equal(translateError(new Error(source)), featureMessages[source]);
    assert.doesNotMatch(translateError(new Error(source)), /[\u4e00-\u9fff]/);
  }
  assert.equal(t('移除收据 {name}', { name: '收据 {name}.pdf' }), 'Remove receipt 收据 {name}.pdf');
  const sources = await Promise.all(['expense-entry.mjs', 'expense-features.mjs', 'receipt-files.mjs', 'ledger-store.mjs'].map(file => readFile(new URL(`../public/scripts/${file}`, import.meta.url), 'utf8')));
  const errors = [...new Set(sources.flatMap(source => [...source.matchAll(/\bError\((['"])(.*?)\1/g)].map(match => match[2])))];
  const internal = new Set(['请明确选择 demo 或 cloud 模式。', '浏览器不支持本地演示存储。', 'Firebase 尚未配置，请使用演示模式或配置真实服务。']);
  assert.deepEqual(errors.filter(source => !internal.has(source) && /[\u4e00-\u9fff]/.test(t(source))), []);
});
