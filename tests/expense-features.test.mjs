import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readReceiptFile, receiptBlob } from '../public/scripts/receipt-files.mjs';
import { receiptUrl, receiptMarkup } from '../public/scripts/receipt-viewer.mjs';
import { itemizedShares, validateExpenseExtras, normalizeSchedule, dueOccurrences, occurrenceId, isScheduledDate } from '../public/scripts/expense-features.mjs';

const item = (amountCents, memberIds = ['a', 'b'], title = '晚餐') => ({ title, amountCents, memberIds });
const recurring = (overrides = {}) => ({ id: 'rent', status: 'active', frequency: 'monthly', startDate: '2026-01-31', ...overrides });
const receipt = (overrides = {}) => ({ name: 'receipt.png', type: 'image/png', size: 3, dataUrl: 'data:image/png;base64,YWJj', ...overrides });

test('small screenshots retain their original bytes and type through download', async () => {
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a02kAAAAASUVORK5CYII=', 'base64');
  const result = await readReceiptFile(new File([bytes], 'stay.png', {type:'image/png'}));
  assert.equal(result.type,'image/png');
  assert.deepEqual(Buffer.from(await receiptBlob(result).arrayBuffer()),bytes);
});

test('receipt picker rejects empty, disguised and oversized files', async () => {
  await assert.rejects(readReceiptFile(new File([], 'empty.png')),/为空/);
  await assert.rejects(readReceiptFile(new File(['%PDF-1.4'], 'fake.png',{type:'image/png'})),/有效/);
  const pdf=Buffer.alloc(2*1024*1024+1);pdf.write('%PDF-1.4');
  await assert.rejects(readReceiptFile(new File([pdf], 'large.pdf',{type:'application/pdf'})),/PDF 不能超过 2 MB/);
  await assert.rejects(readReceiptFile({size:10*1024*1024+1,arrayBuffer(){throw Error('must not read');}}),/10 MB/);
});

test('attachment markup escapes filenames and rejects external or script URLs', () => {
  for(const url of ['https://evil.test/a.png','javascript:alert(1)','//evil.test/a.png','/api/ledgers/abc/receipts/def?redirect=x']) assert.equal(receiptUrl({url}),'');
  const html=receiptMarkup([{name:'<img onerror="alert(1)">',type:'image/png',url:'/api/ledgers/abc/receipts/def'}]);
  assert.ok(html.includes('&lt;img onerror=&quot;alert(1)&quot;&gt;'));
  assert.equal(html.includes('<img onerror='),false);
});

test('itemized bills charge only each item’s selected diners and preserve cents', () => {
  const result = itemizedShares([item(1001, ['a', 'b', 'c']), item(501, ['b', 'c'], '甜点')]);
  assert.equal(result.amountCents, 1502);
  assert.deepEqual(result.shares, { a: 334, b: 585, c: 583 });
  assert.equal(Object.values(result.shares).reduce((a, b) => a + b), result.amountCents);
});

test('each item allocates its own final cent and retains a selected zero share', () => {
  const result = itemizedShares([item(1), item(1, ['b', 'c'])]);
  assert.deepEqual(result.shares, { a: 1, b: 1, c: 0 });
});

test('itemized normalization copies input rows and trims titles without mutating input', () => {
  const input = [item(100, ['a'], '  早餐  ')];
  const before = structuredClone(input);
  const result = itemizedShares(input);
  assert.deepEqual(input, before);
  assert.equal(result.items[0].title, '早餐');
  result.items[0].memberIds.push('b');
  assert.deepEqual(input[0].memberIds, ['a']);
});

test('itemized bills reject missing or duplicate diners and dangerous member keys', () => {
  for (const ids of [[], ['a', 'a'], ['__proto__'], ['constructor'], [''], [null], Array.from({length:9}, (_,i) => `m${i}`)]) assert.throws(() => itemizedShares([item(100, ids)]));
  assert.throws(() => itemizedShares([item(100, ['a','b','c','d','e']), item(100, ['f','g','h','i'])]));
});

test('itemized bills validate row counts, item titles and positive exact cents', () => {
  assert.equal(itemizedShares(Array.from({length:8}, () => item(100))).items.length, 8);
  for (const rows of [null, {}, [], Array.from({length:9}, () => item(100)), [item(0)], [item(-1)], [item(1.5)], [item(NaN)], [item(100, ['a'], '')], [item(100, ['a'], 'x'.repeat(121))]]) assert.throws(() => itemizedShares(rows));
});

test('item totals accept the safe cent limit and reject overflow before rounding', () => {
  assert.equal(itemizedShares([item(Number.MAX_SAFE_INTEGER, ['a'])]).shares.a, Number.MAX_SAFE_INTEGER);
  assert.throws(() => itemizedShares([item(Number.MAX_SAFE_INTEGER, ['a']), item(1, ['a'])]));
});

test('optional expense extras default safely for legacy expenses', () => {
  assert.deepEqual(validateExpenseExtras({}), { note: '', items: [], receipts: [] });
  assert.equal(validateExpenseExtras({note:'  分享菜品  '}).note, '分享菜品');
  assert.throws(() => validateExpenseExtras({note:'x'.repeat(1001)}));
  assert.throws(() => validateExpenseExtras({note:{text:'hello'}}));
});

test('item totals and shares must exactly match the saved expense, including zero shares', () => {
  const items = [item(1)];
  assert.equal(validateExpenseExtras({amountCents:1,shares:{a:1,b:0},items}).items.length, 1);
  for (const changed of [{amountCents:2,shares:{a:1,b:0}}, {amountCents:1,shares:{a:0,b:1}}, {amountCents:1,shares:{a:1}}, {amountCents:1,shares:{a:1,b:0,c:0}}]) assert.throws(() => validateExpenseExtras({...changed,items}));
});

test('receipt validation keeps accepted metadata and copies the receipt object', () => {
  const original = receipt({name:'  receipt.png  ',extra:'discard'});
  assert.deepEqual(validateExpenseExtras({receipts:[original]}).receipts, [receipt()]);
  assert.equal(original.name, '  receipt.png  ');
  for (const type of ['image/jpeg','image/webp','application/pdf']) assert.equal(validateExpenseExtras({receipts:[receipt({type,dataUrl:`data:${type};base64,YWJj`})]}).receipts[0].type, type);
});

test('receipts enforce count and byte limits before persistence', () => {
  assert.throws(() => validateExpenseExtras({receipts:Array.from({length:4},()=>receipt())}));
  for (const size of [0,-1,1.5,2097153,NaN]) assert.throws(() => validateExpenseExtras({receipts:[receipt({size})]}));
  const bytes = Buffer.alloc(2097152, 0);
  assert.equal(validateExpenseExtras({receipts:[receipt({size:bytes.length,dataUrl:`data:image/png;base64,${bytes.toString('base64')}`})]}).receipts[0].size, 2097152);
});

test('receipt MIME, encoded length, alphabet and canonical padding must match', () => {
  for (const bad of [receipt({type:'image/svg+xml'}), receipt({dataUrl:'https://example.com/receipt.png'}), receipt({dataUrl:'data:text/html;base64,YWJj'}), receipt({size:2}), receipt({dataUrl:'data:image/png;base64,!!!!'}), receipt({size:1,dataUrl:'data:image/png;base64,YR=='}), receipt({size:2,dataUrl:'data:image/png;base64,YWJ='}), receipt({name:''})]) assert.throws(() => validateExpenseExtras({receipts:[bad]}));
  assert.equal(validateExpenseExtras({receipts:[receipt({size:1,dataUrl:'data:image/png;base64,YQ=='})]}).receipts.length, 1);
});

test('schedule normalization allows reusable templates and validates real calendar dates', () => {
  assert.deepEqual(normalizeSchedule(), {frequency:'none',startDate:null});
  assert.deepEqual(normalizeSchedule({frequency:'weekly',startDate:'2026-10-29'}), {frequency:'weekly',startDate:'2026-10-29'});
  for (const input of [{frequency:'daily',startDate:'2026-10-29'}, {frequency:'monthly',startDate:null}, {frequency:'yearly',startDate:'2025-02-29'}, {frequency:'weekly',startDate:'0000-01-01'}]) assert.throws(() => normalizeSchedule(input));
});

test('monthly drafts preserve January 31 anchor through February and later months', () => {
  assert.deepEqual(dueOccurrences([recurring()], [], '2026-04-30').map(d=>d.date), ['2026-01-31','2026-02-28','2026-03-31','2026-04-30']);
  assert.deepEqual(dueOccurrences([recurring({startDate:'2024-01-31'})], [], '2024-03-30').map(d=>d.date), ['2024-01-31','2024-02-29']);
});

test('yearly drafts preserve leap-day anchor and return to February 29', () => {
  assert.deepEqual(dueOccurrences([recurring({frequency:'yearly',startDate:'2024-02-29'})], [], '2028-02-29').map(d=>d.date), ['2024-02-29','2025-02-28','2026-02-28','2027-02-28','2028-02-29']);
});

test('weekly drafts keep calendar days across daylight saving transitions', () => {
  assert.deepEqual(dueOccurrences([recurring({frequency:'weekly',startDate:'2026-03-01'})], [], '2026-03-22').map(d=>d.date), ['2026-03-01','2026-03-08','2026-03-15','2026-03-22']);
});

test('posted and skipped periods stay suppressed, including a reversed posted expense', () => {
  const completed = [{templateId:'rent',date:'2026-01-31',status:'posted',expenseStatus:'reversed'},{templateId:'rent',date:'2026-02-28',status:'skipped'}];
  assert.deepEqual(dueOccurrences([recurring()], completed, '2026-03-31'), [{templateId:'rent',date:'2026-03-31',id:'rent_2026-03-31'}]);
});

test('paused, archived, manual and future templates never produce drafts', () => {
  const templates = [recurring({status:'paused'}),recurring({status:'archived'}),recurring({frequency:'none',startDate:null}),recurring({startDate:'2027-01-01'})];
  assert.deepEqual(dueOccurrences(templates, [], '2026-10-29'), []);
});

test('draft generation is read-only, stable and deduplicates template snapshots', () => {
  const templates = [recurring(),recurring()], before = structuredClone(templates);
  const result = dueOccurrences(templates, [], '2026-01-31');
  assert.equal(result.length, 1);
  assert.deepEqual(templates, before);
  assert.deepEqual(result, dueOccurrences(templates, [], '2026-01-31'));
  assert.equal('amountCents' in result[0], false);
});

test('overdue generation is bounded and exposes the next period after completion', () => {
  const template = recurring({frequency:'weekly',startDate:'0001-01-01'});
  const first = dueOccurrences([template], [], '9999-12-31');
  assert.equal(first.length, 100);
  const completed = first.map(d=>({...d,status:'posted'}));
  const next = dueOccurrences([template], completed, '9999-12-31');
  assert.equal(next.length, 100);
  assert.ok(next[0].date > first[99].date);
});

test('draft IDs reject path-like identifiers and invalid dates', () => {
  assert.equal(occurrenceId('rent-2_abc','2026-10-29'),'rent-2_abc_2026-10-29');
  for (const id of ['', '../rent', 'a/b', 'a\\b', 'x'.repeat(129)]) assert.throws(() => occurrenceId(id,'2026-10-29'));
  assert.throws(() => occurrenceId('rent','2026-02-30'));
  assert.throws(() => dueOccurrences([],[],'2026-02-30'));
});

test('scheduled-date checks validate exact occurrences beyond the pending draft cap', () => {
  assert.equal(isScheduledDate(recurring(),'2040-02-29'),true);
  assert.equal(isScheduledDate(recurring(),'2026-02-28'),true);
  assert.equal(isScheduledDate(recurring(),'2026-03-28'),false);
  assert.equal(isScheduledDate(recurring(),'2025-12-31'),false);
  assert.equal(isScheduledDate(recurring(),'2026-02-30'),false);
  assert.equal(isScheduledDate(recurring({frequency:'none',startDate:null}),'2026-02-28'),false);
  const leap = recurring({frequency:'yearly',startDate:'2024-02-29'});
  assert.equal(isScheduledDate(leap,'2028-02-29'),true);
  assert.equal(isScheduledDate(leap,'2028-02-28'),false);
  const weekly = recurring({frequency:'weekly',startDate:'2026-03-01'});
  assert.equal(isScheduledDate(weekly,'2026-03-15'),true);
  assert.equal(isScheduledDate(weekly,'2026-03-16'),false);
});
