import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseMoney, formatMoney, splitShares, remainingFor, memberBalances, settlementText,
} from '../public/scripts/ledger-core.mjs';
import { createStore } from '../public/scripts/ledger-store.mjs';

// These tests exercise the shipped modules with an isolated localStorage substitute.
// No Firebase SDK, credentials, real accounts, or network connections are involved.
function memoryStorage() {
  const entries = new Map();
  return {
    getItem: key => entries.has(String(key)) ? entries.get(String(key)) : null,
    setItem: (key, value) => entries.set(String(key), String(value)),
    removeItem: key => entries.delete(String(key)),
    clear: () => entries.clear(),
    key: index => [...entries.keys()][index] ?? null,
    get length() { return entries.size; },
  };
}

const OWNER = { uid: 'test-owner', displayName: '小周' };
const ALICE = { uid: 'test-alice', displayName: '小林' };
const OUTSIDER = { uid: 'test-outsider', displayName: '小林' };
const DATE = '2026-09-18';
const makeStore = (storage, user = OWNER) => createStore({ mode: 'demo', storage, user });
const deny = operation => assert.rejects(async () => operation());

async function fixture() {
  const storage = memoryStorage();
  const store = makeStore(storage);
  const ledgerId = await store.createLedger({ title: '周末聚餐', currency: 'CNY', ownerName: OWNER.displayName });
  const initial = await store.loadLedger(ledgerId);
  const ownerId = initial.members.find(member => member.uid === OWNER.uid).id;
  const aliceId = await store.addMember(ledgerId, ALICE.displayName);
  return { storage, store, ledgerId, ownerId, aliceId };
}

async function addDinner(f, overrides = {}) {
  return f.store.addExpense(f.ledgerId, {
    title: '晚餐', date: DATE, amountCents: 10000, payerMemberId: f.ownerId,
    shares: { [f.ownerId]: 5000, [f.aliceId]: 5000 }, ...overrides,
  });
}

async function approveAlice(f) {
  const token = await f.store.createInvite(f.ledgerId, f.aliceId);
  const memberStore = makeStore(f.storage, ALICE);
  await memberStore.claimInvite(token, { displayName: ALICE.displayName });
  await f.store.approveClaim(token, ALICE.uid);
  return { token, memberStore };
}

test('money parsing preserves integer cents, including the safe-integer limit', () => {
  assert.equal(parseMoney('0.01'), 1);
  assert.equal(parseMoney('12'), 1200);
  assert.equal(parseMoney('12.30'), 1230);
  assert.equal(parseMoney('90071992547409.91'), Number.MAX_SAFE_INTEGER);
});

test('money parsing rejects missing, non-finite, negative, fractional-cent and unsafe values', () => {
  for (const input of ['', ' ', '0', '-1', 'NaN', 'Infinity', '1e3', '0.001', '12x', '90071992547409.92']) {
    assert.throws(() => parseMoney(input), `must reject ${JSON.stringify(input)}`);
  }
});

test('money parsing optionally accepts explicit zero while preserving validation', () => {
  assert.equal(parseMoney('0', { allowZero: true }), 0);
  assert.equal(parseMoney('0.00', { allowZero: true }), 0);
  assert.equal(parseMoney('10.01', { allowZero: true }), 1001);
  for (const input of ['', ' ', '-1', 'NaN', '0.001', '90071992547409.92']) {
    assert.throws(() => parseMoney(input, { allowZero: true }), `must reject ${JSON.stringify(input)}`);
  }
  assert.throws(() => parseMoney('0'));
});

test('money formatting keeps two decimal places and distinguishes currency', () => {
  assert.match(formatMoney(1234, 'CNY'), /12\.34/);
  assert.match(formatMoney(1, 'CNY'), /0\.01/);
  assert.notEqual(formatMoney(1234, 'CNY'), formatMoney(1234, 'USD'));
});

test('equal splitting allocates every cent deterministically', () => {
  assert.deepEqual(splitShares(100, ['a', 'b', 'c'], { type: 'equal' }), { a: 34, b: 33, c: 33 });
  assert.deepEqual(splitShares(2, ['a', 'b', 'c'], { type: 'equal' }), { a: 1, b: 1, c: 0 });
});

test('amount splitting assigns known unequal accommodation costs directly', () => {
  assert.deepEqual(splitShares(120000, ['a', 'b', 'c'], {
    type: 'amount', amounts: { a: '500', b: '400', c: '300' },
  }), { a: 50000, b: 40000, c: 30000 });
});

test('amount splitting accepts an explicit zero share', () => {
  assert.deepEqual(splitShares(100, ['a', 'b'], {
    type: 'amount', amounts: { a: '0.00', b: '1' },
  }), { a: 0, b: 100 });
});

test('amount splitting preserves fractional currency amounts as exact cents', () => {
  assert.deepEqual(splitShares(3003, ['a', 'b'], {
    type: 'amount', amounts: { a: '10.01', b: '20.02' },
  }), { a: 1001, b: 2002 });
});

test('amount splitting remains exact at the safe-integer limit', () => {
  assert.deepEqual(splitShares(Number.MAX_SAFE_INTEGER, ['a', 'b'], {
    type: 'amount', amounts: { a: '90071992547409.90', b: '0.01' },
  }), { a: Number.MAX_SAFE_INTEGER - 1, b: 1 });
});

test('amount splitting rejects missing, invalid, fractional-cent and unsafe inputs', () => {
  for (const input of [undefined, null, '', ' ', '-1', 'NaN', NaN, 'Infinity', '1e3', '0.001', '12x', '90071992547409.92', 1]) {
    assert.throws(() => splitShares(100, ['a', 'b'], {
      type: 'amount', amounts: { a: input, b: '0' },
    }), `must reject ${String(input)}`);
  }
  assert.throws(() => splitShares(100, ['a', 'b'], { type: 'amount', amounts: { a: '1' } }), /每位/);
  assert.throws(() => splitShares(100, ['a'], { type: 'amount', amounts: null }), /每位/);
});

test('amount splitting rejects a shortfall rather than charging the payer automatically', () => {
  assert.throws(() => splitShares(10000, ['a', 'b'], {
    type: 'amount', amounts: { a: '20', b: '30' },
  }), /不足/);
});

test('amount splitting rejects excess totals using exact arithmetic', () => {
  assert.throws(() => splitShares(100, ['a', 'b'], {
    type: 'amount', amounts: { a: '1', b: '0.01' },
  }), /超出账单金额/);
  assert.throws(() => splitShares(Number.MAX_SAFE_INTEGER, ['a', 'b'], {
    type: 'amount', amounts: { a: '90071992547409.91', b: '90071992547409.91' },
  }), /超出账单金额/);
});

test('amount splitting ignores amounts belonging to unselected members', () => {
  assert.deepEqual(splitShares(100, ['a'], {
    type: 'amount', amounts: { a: '1', unselected: 'invalid' },
  }), { a: 100 });
});

test('stored exact-amount shares determine the outstanding amount and member balances', async () => {
  const f = await fixture();
  const shares = splitShares(120001, [f.ownerId, f.aliceId], {
    type: 'amount', amounts: { [f.ownerId]: '700', [f.aliceId]: '500.01' },
  });
  const expenseId = await addDinner(f, { title: '住宿', amountCents: 120001, shares });
  const snapshot = await makeStore(f.storage).loadLedger(f.ledgerId);
  const expense = snapshot.expenses.find(item => item.id === expenseId);
  assert.deepEqual(expense.shares, { [f.ownerId]: 70000, [f.aliceId]: 50001 });
  assert.equal(remainingFor(expense, f.aliceId), 50001);
  const balances = memberBalances(snapshot);
  assert.equal(balances.find(row => row.memberId === f.ownerId).balanceCents, 50001);
  assert.equal(balances.find(row => row.memberId === f.aliceId).balanceCents, -50001);
});

test('percent splitting uses largest remainders rather than losing a cent', () => {
  assert.deepEqual(splitShares(101, ['a', 'b'], {
    type: 'percent', percentages: { a: '50', b: '50' },
  }), { a: 51, b: 50 });
});

test('partial percentages leave the unallocated amount with the payer', () => {
  assert.deepEqual(splitShares(1000, ['a', 'b'], {
    type: 'percent', percentages: { a: '25', b: '25' },
  }), { a: 250, b: 250 });
});

test('percent splitting rejects invalid individual values and totals above 100', () => {
  for (const percentages of [{ a: '-1', b: '50' }, { a: '101', b: '0' }, { a: '60', b: '50' }, { a: 'NaN', b: '0' }]) {
    assert.throws(() => splitShares(1000, ['a', 'b'], { type: 'percent', percentages }));
  }
});

test('an explicitly selected payer receives a normal participant share', () => {
  assert.deepEqual(splitShares(6000, ['payer', 'friend'], { type: 'equal' }), { payer: 3000, friend: 3000 });
});

test('remaining balance subtracts recorded repayments for the selected member', () => {
  const expense = { amountCents: 10000, shares: { a: 5000, b: 5000 }, repaid: { a: 1200 }, status: 'active' };
  assert.equal(remainingFor(expense, 'a'), 3800);
  assert.equal(remainingFor(expense, 'b'), 5000);
});

function balanceSnapshot() {
  return {
    ledger: { id: 'ledger', title: '周末聚餐', currency: 'CNY', ownerUid: OWNER.uid },
    members: [{ id: 'a', name: '小周', uid: OWNER.uid }, { id: 'b', name: '小林', uid: ALICE.uid }],
    expenses: [
      { id: 'dinner', title: '晚餐', date: DATE, amountCents: 12000, payerMemberId: 'a', shares: { a: 6000, b: 6000 }, repaid: { b: 2000 }, status: 'active' },
      { id: 'taxi', title: '打车', date: DATE, amountCents: 3000, payerMemberId: 'b', shares: { a: 1500, b: 1500 }, repaid: {}, status: 'active' },
    ],
    payments: [{ id: 'repayment', expenseId: 'dinner', fromMemberId: 'b', toMemberId: 'a', amountCents: 2000, date: DATE, type: 'payment', reversedBy: null, reversesId: null }],
    invites: [], claims: [],
  };
}

test('member balances account for consumption and partial repayments without double counting', () => {
  const rows = memberBalances(balanceSnapshot());
  const a = rows.find(row => (row.memberId ?? row.id) === 'a');
  const b = rows.find(row => (row.memberId ?? row.id) === 'b');
  assert.equal(a.paidCents, 12000);
  assert.equal(a.shareCents, 7500);
  assert.equal(a.receivedCents, 2000);
  assert.equal(a.balanceCents, 2500);
  assert.equal(b.repaidCents, 2000);
  assert.equal(b.balanceCents, -2500);
  assert.equal(rows.reduce((sum, row) => sum + row.balanceCents, 0), 0);
});

test('unallocated shares are payer consumption and reversed expenses do not affect balances', () => {
  const snapshot = balanceSnapshot();
  snapshot.expenses = [
    { id: 'active', title: '晚餐', date: DATE, amountCents: 10000, payerMemberId: 'a', shares: { b: 3000 }, repaid: {}, status: 'active' },
    { id: 'cancelled', title: '已冲正', date: DATE, amountCents: 99999, payerMemberId: 'b', shares: { a: 99999 }, repaid: {}, status: 'reversed' },
  ];
  snapshot.payments = [];
  const rows = memberBalances(snapshot);
  const a = rows.find(row => (row.memberId ?? row.id) === 'a');
  assert.equal(a.shareCents, 7000);
  assert.equal(a.balanceCents, 3000);
  assert.equal(rows.reduce((sum, row) => sum + row.balanceCents, 0), 0);
});

test('settlement text identifies the ledger, participants and recorded-payment limitation', () => {
  const text = settlementText(balanceSnapshot());
  assert.match(text, /周末聚餐/);
  assert.match(text, /小周/);
  assert.match(text, /小林/);
  assert.match(text, /记录|登记/);
  assert.match(text, /未.*转账|不.*转账|不.*付款|不.*支付|请.*核对|请.*确认/);
});

test('demo storage persists a newly created ledger and temporary member across store instances', async () => {
  const f = await fixture();
  const reloaded = makeStore(f.storage);
  const snapshot = await reloaded.loadLedger(f.ledgerId);
  assert.equal(snapshot.ledger.title, '周末聚餐');
  assert.equal(snapshot.ledger.currency, 'CNY');
  assert.equal(snapshot.members.find(member => member.id === f.aliceId).name, ALICE.displayName);
  assert.ok((await reloaded.listLedgers()).some(ledger => ledger.id === f.ledgerId));
  for (const key of ['members', 'expenses', 'payments', 'invites', 'claims']) assert.ok(Array.isArray(snapshot[key]), key);
});

test('a new expense retains integer shares, stable member IDs and an active status', async () => {
  const f = await fixture();
  const expenseId = await addDinner(f);
  const expense = (await makeStore(f.storage).loadLedger(f.ledgerId)).expenses.find(item => item.id === expenseId);
  assert.equal(expense.amountCents, 10000);
  assert.equal(expense.payerMemberId, f.ownerId);
  assert.equal(expense.status, 'active');
  assert.deepEqual(expense.shares, { [f.ownerId]: 5000, [f.aliceId]: 5000 });
});

test('partial repayments retain their journal record and update the expense remainder', async () => {
  const f = await fixture();
  const expenseId = await addDinner(f);
  const paymentId = await f.store.recordPayment(f.ledgerId, { expenseId, fromMemberId: f.aliceId, amountCents: 1200, date: DATE, note: '已核对' });
  const snapshot = await makeStore(f.storage).loadLedger(f.ledgerId);
  const payment = snapshot.payments.find(item => item.id === paymentId);
  assert.equal(payment.type, 'payment');
  assert.equal(payment.amountCents, 1200);
  assert.equal(payment.note, '已核对');
  assert.equal(payment.reversedBy, null);
  assert.equal(remainingFor(snapshot.expenses.find(item => item.id === expenseId), f.aliceId), 3800);
});

test('overpayment and invalid payment amounts fail without changing the journal', async () => {
  const f = await fixture();
  const expenseId = await addDinner(f);
  const before = await f.store.loadLedger(f.ledgerId);
  for (const amountCents of [5001, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await deny(() => f.store.recordPayment(f.ledgerId, { expenseId, fromMemberId: f.aliceId, amountCents, date: DATE }));
  }
  const after = await f.store.loadLedger(f.ledgerId);
  assert.deepEqual(after.expenses, before.expenses);
  assert.deepEqual(after.payments, before.payments);
});

test('payment reversal appends a trace, preserves the original, and cannot be repeated', async () => {
  const f = await fixture();
  const expenseId = await addDinner(f);
  const paymentId = await f.store.recordPayment(f.ledgerId, { expenseId, fromMemberId: f.aliceId, amountCents: 1200, date: DATE });
  await f.store.reversePayment(f.ledgerId, paymentId);
  const snapshot = await f.store.loadLedger(f.ledgerId);
  const original = snapshot.payments.find(item => item.id === paymentId);
  const reversal = snapshot.payments.find(item => item.reversesId === paymentId);
  assert.ok(reversal);
  assert.equal(reversal.type, 'reversal');
  assert.equal(original.amountCents, 1200);
  assert.equal(original.reversedBy, reversal.id);
  assert.equal(remainingFor(snapshot.expenses.find(item => item.id === expenseId), f.aliceId), 5000);
  await deny(() => f.store.reversePayment(f.ledgerId, paymentId));
  assert.deepEqual((await f.store.loadLedger(f.ledgerId)).payments, snapshot.payments);
});

test('expense reversal requires payment reversal first and preserves both original records', async () => {
  const f = await fixture();
  const expenseId = await addDinner(f);
  const paymentId = await f.store.recordPayment(f.ledgerId, { expenseId, fromMemberId: f.aliceId, amountCents: 1200, date: DATE });
  await deny(() => f.store.reverseExpense(f.ledgerId, expenseId));
  const beforeReversal = await f.store.loadLedger(f.ledgerId);
  assert.equal(beforeReversal.expenses.find(item => item.id === expenseId).status, 'active');
  assert.equal(beforeReversal.payments.find(item => item.id === paymentId).reversedBy, null);
  await f.store.reversePayment(f.ledgerId, paymentId);
  await f.store.reverseExpense(f.ledgerId, expenseId);
  const snapshot = await f.store.loadLedger(f.ledgerId);
  assert.equal(snapshot.expenses.find(item => item.id === expenseId).status, 'reversed');
  assert.equal(snapshot.expenses.find(item => item.id === expenseId).amountCents, 10000);
  assert.ok(snapshot.payments.find(item => item.id === paymentId).reversedBy);
  assert.ok(snapshot.payments.some(item => item.reversesId === paymentId));
  assert.ok(memberBalances(snapshot).every(member => member.balanceCents === 0));
  await deny(() => f.store.recordPayment(f.ledgerId, { expenseId, fromMemberId: f.aliceId, amountCents: 100, date: DATE }));
  await deny(() => f.store.reverseExpense(f.ledgerId, expenseId));
});

test('an unrelated user cannot read, list or modify another user ledger', async () => {
  const f = await fixture();
  const outsider = makeStore(f.storage, OUTSIDER);
  assert.ok(!(await outsider.listLedgers()).some(ledger => ledger.id === f.ledgerId));
  await deny(() => outsider.loadLedger(f.ledgerId));
  await deny(() => outsider.addMember(f.ledgerId, '越权成员'));
  await deny(() => outsider.addExpense(f.ledgerId, { title: '越权', date: DATE, amountCents: 100, payerMemberId: f.ownerId, shares: { [f.aliceId]: 100 } }));
});

test('invitation claim is pending until owner approval and never matches an account by name', async () => {
  const f = await fixture();
  const token = await f.store.createInvite(f.ledgerId, f.aliceId);
  const claimant = makeStore(f.storage, ALICE);
  const invitation = await claimant.getInvite(token);
  assert.equal(invitation.ledgerId, f.ledgerId);
  assert.equal(invitation.memberId, f.aliceId);
  assert.equal(invitation.memberName, ALICE.displayName);
  await claimant.claimInvite(token, { displayName: ALICE.displayName });
  await deny(() => claimant.loadLedger(f.ledgerId));
  const snapshot = await f.store.loadLedger(f.ledgerId);
  assert.notEqual(snapshot.members.find(member => member.id === f.aliceId).uid, ALICE.uid);
  assert.ok(snapshot.claims.some(claim => claim.uid === ALICE.uid && claim.status === 'pending'));
  await deny(() => makeStore(f.storage, OUTSIDER).loadLedger(f.ledgerId));
});

test('explicit approval binds the UID without changing member IDs or existing expense shares', async () => {
  const f = await fixture();
  const expenseId = await addDinner(f);
  await approveAlice(f);
  const snapshot = await makeStore(f.storage, ALICE).loadLedger(f.ledgerId);
  assert.equal(snapshot.members.find(member => member.id === f.aliceId).uid, ALICE.uid);
  assert.equal(snapshot.expenses.find(item => item.id === expenseId).shares[f.aliceId], 5000);
  await deny(() => makeStore(f.storage, OUTSIDER).loadLedger(f.ledgerId));
});

test('an accepted invitation can be reopened by its approved account and owner, but not another account', async () => {
  const f = await fixture();
  const { token, memberStore } = await approveAlice(f);
  const invitation = await memberStore.getInvite(token);
  assert.equal(invitation.status, 'accepted');
  assert.equal(invitation.acceptedUid, ALICE.uid);
  assert.equal(invitation.ledgerId, f.ledgerId);
  assert.equal((await f.store.getInvite(token)).acceptedUid, ALICE.uid);
  await deny(() => makeStore(f.storage, OUTSIDER).getInvite(token));
});

test('approved member can manage own payments but cannot impersonate a payer or administer members', async () => {
  const f = await fixture();
  const ownerExpense = await addDinner(f);
  const { memberStore } = await approveAlice(f);
  const ownExpense = await memberStore.addExpense(f.ledgerId, { title: '打车', date: DATE, amountCents: 1000, payerMemberId: f.aliceId, shares: { [f.ownerId]: 1000 } });
  await deny(() => memberStore.addExpense(f.ledgerId, { title: '假冒垫付', date: DATE, amountCents: 1000, payerMemberId: f.ownerId, shares: { [f.aliceId]: 1000 } }));
  await deny(() => memberStore.addMember(f.ledgerId, '越权'));
  await deny(() => memberStore.createInvite(f.ledgerId, f.ownerId));
  await deny(() => memberStore.recordPayment(f.ledgerId, { expenseId: ownerExpense, fromMemberId: f.aliceId, amountCents: 100, date: DATE }));
  await deny(() => memberStore.reverseExpense(f.ledgerId, ownerExpense));
  const paymentId = await memberStore.recordPayment(f.ledgerId, { expenseId: ownExpense, fromMemberId: f.ownerId, amountCents: 500, date: DATE });
  await memberStore.reversePayment(f.ledgerId, paymentId);
  await memberStore.reverseExpense(f.ledgerId, ownExpense);
  assert.equal((await f.store.loadLedger(f.ledgerId)).expenses.find(item => item.id === ownExpense).status, 'reversed');
});

test('store reloads shared storage before writes so older instances do not erase each other', async () => {
  const f = await fixture();
  const second = makeStore(f.storage);
  const one = await f.store.addMember(f.ledgerId, '成员一');
  const two = await second.addMember(f.ledgerId, '成员二');
  const members = (await f.store.loadLedger(f.ledgerId)).members;
  assert.ok(members.some(member => member.id === one));
  assert.ok(members.some(member => member.id === two));
});

test('invalid expense amounts, unknown members and oversplitting are rejected atomically', async () => {
  const f = await fixture();
  const before = await f.store.loadLedger(f.ledgerId);
  for (const overrides of [
    { amountCents: -1 }, { amountCents: 1.5 }, { amountCents: Number.MAX_SAFE_INTEGER + 1 },
    { payerMemberId: 'unknown' }, { shares: { unknown: 100 } },
    { shares: { [f.aliceId]: 10001 } }, { shares: { [f.aliceId]: -1 } },
  ]) await deny(() => addDinner(f, overrides));
  assert.deepEqual((await f.store.loadLedger(f.ledgerId)).expenses, before.expenses);
});

test('a ledger may contain more than eight members but a single expense has at most eight shares', async () => {
  const f = await fixture();
  const memberIds = [f.ownerId, f.aliceId];
  for (let i = 0; i < 7; i++) memberIds.push(await f.store.addMember(f.ledgerId, `同行人${i + 1}`));
  assert.equal((await f.store.loadLedger(f.ledgerId)).members.length, 9);
  await deny(() => addDinner(f, { shares: Object.fromEntries(memberIds.map(id => [id, 100])) }));
  assert.equal((await f.store.loadLedger(f.ledgerId)).expenses.length, 0);
  const expenseId = await addDinner(f, { shares: Object.fromEntries(memberIds.slice(1).map(id => [id, 100])) });
  assert.equal((await f.store.loadLedger(f.ledgerId)).expenses.find(row => row.id === expenseId).payerMemberId, f.ownerId);
});
