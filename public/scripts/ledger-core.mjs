// Pure money and ledger calculations. Values in storage are integer cents.
export function assertCents(value, allowZero = false) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) throw new Error("金额必须是支持范围内的整数分。");
  return value;
}

function decimalUnits(value) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value).trim());
  if (!match) throw new Error("请输入最多两位小数的有效数字。");
  return BigInt(match[1]) * 100n + BigInt((match[2] || "").padEnd(2, "0"));
}

export function parseMoney(value, { allowZero = false } = {}) {
  const cents = decimalUnits(value);
  if (cents < (allowZero ? 0n : 1n) || cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(allowZero ? "金额必须为非负数且在支持范围内。" : "金额必须大于零且在支持范围内。");
  }
  return Number(cents);
}

export function formatMoney(cents, currency = "CNY") {
  if (!Number.isSafeInteger(cents)) throw new Error("金额超出支持范围。");
  const amount = BigInt(cents);
  const absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? "−" : ""}${currency === "CNY" ? "¥" : currency === "USD" ? "$" : `${currency} `}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

export function validateDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "") || value.startsWith("0000-")) throw new Error("请选择有效日期。");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("请选择有效日期。");
  return value;
}

export function splitShares(amountCents, memberIds, { type = "equal", percentages = {}, amounts = {} } = {}) {
  assertCents(amountCents);
  if (!Array.isArray(memberIds) || !memberIds.length || new Set(memberIds).size !== memberIds.length
    || memberIds.some(id => typeof id !== "string" || !id || ["__proto__", "constructor", "prototype"].includes(id))) {
    throw new Error("请选择不同的参与成员。");
  }
  const amount = BigInt(amountCents);
  if (type === "equal") {
    const count = BigInt(memberIds.length);
    return Object.fromEntries(memberIds.map((id, index) => [id, Number(amount / count + (BigInt(index) < amount % count ? 1n : 0n))]));
  }
  if (type === "amount") {
    const rows = memberIds.map(id => {
      if (!amounts || !Object.hasOwn(amounts, id) || typeof amounts[id] !== "string" || !amounts[id].trim()) {
        throw new Error("请填写每位参与人的分摊金额，可明确填写 0。");
      }
      const cents = decimalUnits(amounts[id]);
      if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("分摊金额超出支持范围。");
      return [id, cents];
    });
    const total = rows.reduce((sum, [, cents]) => sum + cents, 0n);
    if (total < amount) throw new Error("分摊金额合计不足账单金额，请补齐后保存。");
    if (total > amount) throw new Error("分摊金额合计超出账单金额，请调整后保存。");
    return Object.fromEntries(rows.map(([id, cents]) => [id, Number(cents)]));
  }
  if (type !== "percent") throw new Error("分摊方式无效。");
  const units = memberIds.map(id => {
    if (!Object.hasOwn(percentages, id)) throw new Error("请填写每位参与人的比例，可明确填写 0。");
    const value = decimalUnits(percentages[id]);
    if (value > 10000n) throw new Error("每位成员的比例应在 0–100% 之间。");
    return value;
  });
  const total = units.reduce((sum, value) => sum + value, 0n);
  if (total <= 0n || total > 10000n) throw new Error("比例合计必须大于 0 且不超过 100%。");
  const rows = memberIds.map((id, index) => ({ id, index, cents: amount * units[index] / 10000n, remainder: amount * units[index] % 10000n }));
  let extra = (amount * total + 5000n) / 10000n - rows.reduce((sum, row) => sum + row.cents, 0n);
  const order = [...rows].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (const row of order) { if (extra <= 0n) break; row.cents++; extra--; }
  return Object.fromEntries(rows.map(row => [row.id, Number(row.cents)]));
}

export function remainingFor(expense, memberId) {
  if (!expense || expense.status !== "active" || memberId === expense.payerMemberId) return 0;
  return Math.max(0, (expense.shares[memberId] || 0) - (expense.repaid[memberId] || 0));
}

export function consumptionShares(expense) {
  const amount = BigInt(assertCents(expense.amountCents));
  const shares = new Map(Object.entries(expense.shares).map(([id, cents]) => [id, assertCents(cents, true)]));
  const allocated = [...shares.values()].reduce((sum, cents) => sum + BigInt(cents), 0n);
  if (allocated > amount) throw new Error("分摊金额不能超过总额。");
  const remainder = amount - allocated;
  if (remainder > 0n) {
    shares.set(expense.payerMemberId, Number(BigInt(shares.get(expense.payerMemberId) || 0) + remainder));
  }
  return Object.fromEntries(shares);
}

export function memberBalances({ members, expenses, payments }) {
  const result = new Map(members.map(member => [member.id, {
    memberId: member.id, name: member.name, balanceCents: 0, paidCents: 0, shareCents: 0, repaidCents: 0, receivedCents: 0,
  }]));
  function add(id, field, value) {
    const row = result.get(id);
    if (!row) throw new Error("账本记录引用了不存在的成员。");
    const sum = row[field] + value;
    if (!Number.isSafeInteger(sum)) throw new Error("账本合计超出支持范围。");
    row[field] = sum;
  }
  const active = new Set();
  for (const expense of expenses) {
    if (expense.status !== "active") continue;
    active.add(expense.id);
    add(expense.payerMemberId, "paidCents", expense.amountCents);
    let allocated = 0;
    for (const [id, cents] of Object.entries(expense.shares)) { add(id, "shareCents", cents); allocated += cents; }
    add(expense.payerMemberId, "shareCents", expense.amountCents - allocated);
  }
  for (const payment of payments) {
    if (payment.type !== "payment" || payment.reversedBy || !active.has(payment.expenseId)) continue;
    add(payment.fromMemberId, "repaidCents", payment.amountCents);
    add(payment.toMemberId, "receivedCents", payment.amountCents);
  }
  for (const row of result.values()) {
    const balance = BigInt(row.paidCents) - BigInt(row.shareCents) + BigInt(row.repaidCents) - BigInt(row.receivedCents);
    if (balance > BigInt(Number.MAX_SAFE_INTEGER) || balance < -BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("账本合计超出支持范围。");
    row.balanceCents = Number(balance);
  }
  return [...result.values()];
}

export function settlementText(snapshot, locale = 'zh-CN') {
  const { ledger, expenses, members } = snapshot;
  const balances = memberBalances(snapshot);
  const names = new Map(members.map(member => [member.id, member.name]));
  const english = locale === 'en';
  const lines = [`${ledger.title} · ${ledger.currency}`, english ? "Settlement statement (based on ledger entries; not a payment receipt)" : "待结算清单（按记账记录计算，不是转账凭证）", ""];
  for (const expense of expenses.filter(row => row.status === "active")) {
    for (const memberId of Object.keys(expense.shares)) {
      const left = remainingFor(expense, memberId);
      if (left > 0) lines.push(english ? `${names.get(memberId)} → ${names.get(expense.payerMemberId)}: ${formatMoney(left, ledger.currency)} (${expense.title} · ${expense.date})` : `${names.get(memberId)} → ${names.get(expense.payerMemberId)}：${formatMoney(left, ledger.currency)}（${expense.title} · ${expense.date}）`);
    }
  }
  if (lines.length === 3) lines.push(english ? "No outstanding repayments in the current records." : "当前记录没有待确认的还款。");
  lines.push("", english ? "Member net balances (same ledger and currency)" : "成员净余额（同一账本、同一币种）");
  balances.forEach(row => {
    const label = english ? (row.balanceCents > 0 ? "To receive " : row.balanceCents < 0 ? "To pay " : "Settled ") : (row.balanceCents > 0 ? "待收 " : row.balanceCents < 0 ? "待付 " : "已平衡 ");
    lines.push(`${row.name}${english ? ': ' : '：'}${label}${formatMoney(Math.abs(row.balanceCents), ledger.currency)}`);
  });
  lines.push("", english ? "Payments are confirmed by the recipient or ledger owner. This app does not transfer money." : "还款由收款人或账本管理员确认；本应用不代为转账。");
  return lines.join("\n");
}
