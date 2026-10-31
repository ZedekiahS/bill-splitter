import { assertCents, splitShares, validateDate } from './ledger-core.mjs';

const MAX_CENTS = BigInt(Number.MAX_SAFE_INTEGER);
const RECEIPT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const DAY_MS = 86400000;
const MAX_RECEIPT_BYTES = 2 * 1024 * 1024;

function nonemptyText(value, limit, message) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > limit) throw new Error(message);
  return value.trim();
}

function safeTotal(value) {
  if (value > MAX_CENTS) throw new Error('账单合计超出支持范围。');
  return Number(value);
}

export function itemizedShares(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 8) throw new Error('请填写 1–8 个消费项目。');
  const totals = new Map();
  let amount = 0n;
  const normalized = items.map(item => {
    const title = nonemptyText(item?.title, 120, '项目名称不能为空，且不能超过 120 个字。');
    const amountCents = assertCents(item.amountCents);
    if (!Array.isArray(item.memberIds) || !item.memberIds.length || item.memberIds.length > 8) throw new Error('每个项目请选择 1–8 位参与成员。');
    const memberIds = [...item.memberIds];
    const shares = splitShares(amountCents, memberIds);
    for (const [id, cents] of Object.entries(shares)) totals.set(id, (totals.get(id) || 0n) + BigInt(cents));
    if (totals.size > 8) throw new Error('每笔费用最多选择 8 位分摊成员；账本成员数量不受此限制。');
    amount += BigInt(amountCents);
    safeTotal(amount);
    return { title, amountCents, memberIds };
  });
  return { amountCents: safeTotal(amount), shares: Object.fromEntries([...totals].map(([id, cents]) => [id, safeTotal(cents)])), items: normalized };
}

function receiptData(receipt) {
  if (!receipt || typeof receipt !== 'object') throw new Error('收据文件无效，请重新选择。');
  const name = nonemptyText(receipt.name, 120, '收据文件名不能为空，且不能超过 120 个字。');
  const { type, size, dataUrl } = receipt;
  if (!RECEIPT_TYPES.has(type)) throw new Error('收据仅支持 JPG、PNG、WebP 或 PDF。');
  if (!Number.isInteger(size) || size < 1 || size > MAX_RECEIPT_BYTES) throw new Error('每份收据不能超过 2 MB。');
  const prefix = `data:${type};base64,`;
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(prefix)) throw new Error('收据文件无效，请重新选择。');
  const encoded = dataUrl.slice(prefix.length);
  if (encoded.length !== Math.ceil(size / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('收据文件无效，请重新选择。');
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const tail = alphabet.indexOf(encoded[encoded.length - padding - 1]);
  if (encoded.length / 4 * 3 - padding !== size || (padding === 2 && tail % 16 !== 0) || (padding === 1 && tail % 4 !== 0)) throw new Error('收据文件无效，请重新选择。');
  return { name, type, size, dataUrl };
}

export function validateExpenseExtras(payload) {
  const note = payload.note ?? '';
  if (typeof note !== 'string' || note.trim().length > 1000) throw new Error('备注不能超过 1000 个字。');
  const sourceItems = payload.items ?? [];
  const sourceReceipts = payload.receipts ?? [];
  if (!Array.isArray(sourceItems)) throw new Error('消费项目无效。');
  if (!Array.isArray(sourceReceipts) || sourceReceipts.length > 3) throw new Error('每笔账单最多添加 3 份收据。');
  let items = [];
  if (sourceItems.length) {
    const result = itemizedShares(sourceItems);
    const shares = payload.shares;
    if (result.amountCents !== payload.amountCents || !shares || typeof shares !== 'object' || Array.isArray(shares)
      || Object.keys(result.shares).length !== Object.keys(shares).length
      || Object.entries(result.shares).some(([id, cents]) => !Object.hasOwn(shares, id) || shares[id] !== cents)) {
      throw new Error('项目合计或分摊金额与账单不一致，请重新核对。');
    }
    items = result.items;
  }
  return { note: note.trim(), items, receipts: sourceReceipts.map(receiptData) };
}

export function normalizeSchedule({ frequency = 'none', startDate = null } = {}) {
  if (!['none', 'weekly', 'monthly', 'yearly'].includes(frequency)) throw new Error('请选择有效的重复周期。');
  if (frequency === 'none') return { frequency, startDate: startDate === null ? null : validateDate(startDate) };
  return { frequency, startDate: validateDate(startDate) };
}

export function occurrenceId(templateId, date) {
  if (typeof templateId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(templateId)) throw new Error('账单模板编号无效。');
  return `${templateId}_${validateDate(date)}`;
}

function daysInMonth(year, month) {
  const date = new Date(0);
  date.setUTCFullYear(year, month + 1, 0);
  return date.getUTCDate();
}

function dateAt(startDate, frequency, index) {
  if (frequency === 'weekly') return new Date(Date.parse(`${startDate}T00:00:00Z`) + index * 7 * DAY_MS).toISOString().slice(0, 10);
  const [anchorYear, anchorMonth, anchorDay] = startDate.split('-').map(Number);
  const months = (anchorYear * 12 + anchorMonth - 1) + (frequency === 'yearly' ? index * 12 : index);
  const year = Math.floor(months / 12), month = months % 12;
  const day = Math.min(anchorDay, daysInMonth(year, month));
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function isScheduledDate(template, date) {
  let schedule;
  try { schedule = normalizeSchedule(template); validateDate(date); }
  catch { return false; }
  const { frequency, startDate } = schedule;
  if (frequency === 'none' || date < startDate) return false;
  const [year, month] = date.split('-').map(Number);
  const [startYear, startMonth] = startDate.split('-').map(Number);
  const index = frequency === 'weekly'
    ? (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / (7 * DAY_MS)
    : frequency === 'yearly' ? year - startYear : (year - startYear) * 12 + month - startMonth;
  return Number.isInteger(index) && index >= 0 && dateAt(startDate, frequency, index) === date;
}

// Pending occurrences are projections, never expenses. A completion record is
// retained even if its expense is later reversed, so refresh cannot charge twice.
export function dueOccurrences(templates, occurrences, today) {
  validateDate(today);
  if (!Array.isArray(templates) || !Array.isArray(occurrences)) throw new Error('周期账单记录无效。');
  const completedByTemplate = new Map();
  for (const occurrence of occurrences) {
    if (!occurrence || !['posted', 'skipped'].includes(occurrence.status)) continue;
    if (!completedByTemplate.has(occurrence.templateId)) completedByTemplate.set(occurrence.templateId, new Set());
    completedByTemplate.get(occurrence.templateId).add(occurrence.date);
  }
  const drafts = [], seenTemplates = new Set();
  for (const template of templates) {
    if (!template || template.status !== 'active' || template.frequency === 'none') continue;
    const { frequency, startDate } = normalizeSchedule(template);
    if (frequency === 'none' || startDate > today) continue;
    occurrenceId(template.id, startDate);
    if (seenTemplates.has(template.id)) continue;
    seenTemplates.add(template.id);
    const completed = completedByTemplate.get(template.id) || new Set();
    const [endYear, endMonth] = today.split('-').map(Number);
    const [startYear, startMonth] = startDate.split('-').map(Number);
    const maximumIndex = frequency === 'weekly'
      ? Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / (7 * DAY_MS))
      : frequency === 'yearly' ? endYear - startYear : (endYear - startYear) * 12 + endMonth - startMonth;
    let pending = 0;
    // At most one iteration per completed record plus 100 displayed drafts;
    // an ancient start date does not require scanning thousands of years.
    for (let index = 0; index <= Math.min(maximumIndex, completed.size + 99) && pending < 100; index++) {
      const date = dateAt(startDate, frequency, index);
      if (date > today) break;
      if (completed.has(date)) continue;
      drafts.push({ templateId: template.id, date, id: occurrenceId(template.id, date) });
      pending++;
    }
  }
  return drafts.sort((a, b) => a.date.localeCompare(b.date) || a.templateId.localeCompare(b.templateId));
}
