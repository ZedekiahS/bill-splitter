import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { before, beforeEach, test } from "node:test";

// No production endpoint or project can be selected by this test suite.
const PROJECT = "demo-bill-splitter-ledgers";
const host = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8281";
const hostMatch = /^(localhost|127\.0\.0\.1):(\d{1,5})$/.exec(host);
if (!hostMatch || +hostMatch[2] < 1 || +hostMatch[2] > 65535) throw new Error("A loopback Firestore emulator host is required.");
const origin = `http://${host}`;
const documents = `projects/${PROJECT}/databases/(default)/documents`;
const OWNER = "ledger-owner", RECEIVER = "receiver-user", DEBTOR = "debtor-user", OUTSIDER = "outsider";
const LEDGER = "shared-ledger", EXPENSE = "dinner", TOKEN = "3d3bc284-a397-40ab-832e-af7501f601cc";
const ledgerPath = `ledgers/${LEDGER}`;
const expensePath = `${ledgerPath}/expenses/${EXPENSE}`;

function token(uid, provider = "custom") {
  const now = Math.floor(Date.now() / 1000);
  const encode = data => Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({
    iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: uid, user_id: uid,
    iat: now, exp: now + 3600, auth_time: now, firebase: { sign_in_provider: provider, identities: {} },
  })}.`;
}

async function request(path, { method = "GET", body, uid, admin = false, provider } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (admin) headers.Authorization = "Bearer owner";
  else if (uid) headers.Authorization = `Bearer ${token(uid, provider)}`;
  const response = await fetch(`${origin}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function allowed(promise) {
  const result = await promise;
  assert.ok(result.status >= 200 && result.status < 300, JSON.stringify(result));
  return result.data;
}

async function denied(promise) {
  const result = await promise;
  assert.equal(result.status, 403, JSON.stringify(result));
  assert.equal(result.data?.error?.status, "PERMISSION_DENIED", JSON.stringify(result));
}

function value(input) {
  if (input === null) return { nullValue: null };
  if (input instanceof Date) return { timestampValue: input.toISOString() };
  if (typeof input === "string") return { stringValue: input };
  if (typeof input === "boolean") return { booleanValue: input };
  if (typeof input === "number") return Number.isInteger(input) ? { integerValue: String(input) } : { doubleValue: input };
  if (Array.isArray(input)) return { arrayValue: { values: input.map(value) } };
  return { mapValue: { fields: fields(input) } };
}
function fields(data) { return Object.fromEntries(Object.entries(data).map(([key, item]) => [key, value(item)])); }
function update(path, data, { merge = false, serverTimes = [] } = {}) {
  const operation = { update: { name: `${documents}/${path}`, fields: fields(data) } };
  if (merge) operation.updateMask = { fieldPaths: Object.keys(data) };
  if (serverTimes.length) operation.updateTransforms = serverTimes.map(fieldPath => ({ fieldPath, setToServerValue: "REQUEST_TIME" }));
  return operation;
}
function commit(writes, uid, options = {}) {
  return request(`/v1/${documents}:commit`, { method: "POST", body: { writes }, uid, ...options });
}
function write(path, data, uid, options = {}) { return commit([update(path, data, options)], uid, options); }
function get(path, uid) { return request(`/v1/${documents}/${path}`, { uid }); }
function remove(path, uid) { return commit([{ delete: `${documents}/${path}` }], uid); }
function query(collectionId, uid, { parent = "", field, op = "EQUAL", operand } = {}) {
  const structuredQuery = { from: [{ collectionId }] };
  if (field) structuredQuery.where = { fieldFilter: { field: { fieldPath: field }, op, value: value(operand) } };
  return request(`/v1/${documents}${parent ? `/${parent}` : ""}:runQuery`, { method: "POST", uid, body: { structuredQuery } });
}

function ledger(overrides = {}) {
  return { title: "Weekend trip", currency: "USD", ownerUid: OWNER,
    memberUids: [OWNER, RECEIVER, DEBTOR], lastApprovedInviteId: null, ...overrides };
}
function member(name, uid = null) { return { name, uid, claimInviteId: null }; }
function expense(overrides = {}) {
  return { title: "Dinner", date: "2026-09-18", amountCents: 15000, payerMemberId: "receiver",
    shares: { debtor: 10000, guest: 5000 }, repaid: { debtor: 0, guest: 0 },
    status: "active", createdByUid: OWNER, lastPaymentId: null, reversedAt: null, ...overrides };
}
function payment(overrides = {}) {
  return { expenseId: EXPENSE, fromMemberId: "debtor", toMemberId: "receiver", amountCents: 4000,
    date: "2026-09-18", note: "Cash received", type: "payment", reversesId: null,
    reversedBy: null, createdByUid: OWNER, ...overrides };
}
function invitation(overrides = {}) {
  return { ledgerId: LEDGER, ownerUid: OWNER, memberId: "guest", memberName: "Guest",
    ledgerTitle: "Weekend trip", status: "open", acceptedUid: null,
    expiresAt: new Date(Date.now() + 86400000), ...overrides };
}
function claim(uid = OUTSIDER) { return { uid, displayName: "New member", status: "pending" }; }

function receive({ id = "payment-1", uid = OWNER, amount = 4000, total = amount,
  paymentPatch = {}, repaidPatch = {}, expensePatch = {} } = {}) {
  return commit([
    update(`${ledgerPath}/payments/${id}`, payment({ amountCents: amount, createdByUid: uid, ...paymentPatch }), { serverTimes: ["createdAt"] }),
    update(expensePath, { repaid: { debtor: total, guest: 0, ...repaidPatch }, lastPaymentId: id, ...expensePatch }, { merge: true }),
  ], uid);
}
function reversal({ id = "reversal-1", original = "payment-1", uid = OWNER, amount = 4000,
  total = 0, paymentPatch = {}, markOriginal = true } = {}) {
  const writes = [
    update(`${ledgerPath}/payments/${id}`, payment({ amountCents: amount, createdByUid: uid,
      type: "reversal", reversesId: original, ...paymentPatch }), { serverTimes: ["createdAt"] }),
    update(expensePath, { repaid: { debtor: total, guest: 0 }, lastPaymentId: id }, { merge: true }),
  ];
  if (markOriginal) writes.push(update(`${ledgerPath}/payments/${original}`, { reversedBy: id }, { merge: true }));
  return commit(writes, uid);
}
function approval({ uid = OUTSIDER, actor = OWNER, tokenId = TOKEN, ledgerId = LEDGER,
  memberId = "guest", include = ["ledger", "member", "invite", "claim"] } = {}) {
  const writes = {
    ledger: update(`ledgers/${ledgerId}`, { memberUids: [OWNER, RECEIVER, DEBTOR, uid], lastApprovedInviteId: tokenId }, { merge: true }),
    member: update(`ledgers/${ledgerId}/members/${memberId}`, { uid, claimInviteId: tokenId }, { merge: true }),
    invite: update(`invites/${tokenId}`, { status: "accepted", acceptedUid: uid }, { merge: true }),
    claim: update(`invites/${tokenId}/claims/${uid}`, { status: "approved" }, { merge: true }),
  };
  return commit(include.map(key => writes[key]), actor);
}

before(async () => {
  const content = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  await allowed(request(`/emulator/v1/projects/${PROJECT}:securityRules`, {
    method: "PUT", admin: true, body: { rules: { files: [{ content }] } },
  }));
});
beforeEach(async () => {
  await allowed(request(`/emulator/v1/${documents}`, { method: "DELETE", admin: true }));
  const seeded = [
    update(ledgerPath, ledger(), { serverTimes: ["createdAt"] }),
    update(`${ledgerPath}/members/owner`, member("Owner", OWNER), { serverTimes: ["createdAt"] }),
    update(`${ledgerPath}/members/receiver`, member("Receiver", RECEIVER), { serverTimes: ["createdAt"] }),
    update(`${ledgerPath}/members/debtor`, member("Debtor", DEBTOR), { serverTimes: ["createdAt"] }),
    update(`${ledgerPath}/members/guest`, member("Guest"), { serverTimes: ["createdAt"] }),
    update(expensePath, expense(), { serverTimes: ["createdAt"] }),
    update("ledgers/private-ledger", ledger({ ownerUid: OUTSIDER, memberUids: [OUTSIDER] }), { serverTimes: ["createdAt"] }),
    update(`invites/${TOKEN}`, invitation(), { serverTimes: ["createdAt"] }),
  ];
  await allowed(commit(seeded, null, { admin: true }));
});

test("01 ledger creation atomically includes an owner member", async () => {
  await allowed(commit([
    update("ledgers/new-ledger", ledger({ memberUids: [OWNER] }), { serverTimes: ["createdAt"] }),
    update("ledgers/new-ledger/members/owner", member("Owner", OWNER), { serverTimes: ["createdAt"] }),
  ], OWNER));
});
test("02 ledger creation cannot impersonate owners or pre-authorize other accounts", async () => {
  await denied(write("ledgers/new-ledger", ledger({ memberUids: [OWNER] }), OUTSIDER, { serverTimes: ["createdAt"] }));
  await denied(write("ledgers/new-ledger", ledger(), OWNER, { serverTimes: ["createdAt"] }));
  await denied(write("ledgers/new-ledger", ledger({ memberUids: [OWNER] }), null, { serverTimes: ["createdAt"] }));
  await denied(write("ledgers/new-ledger", ledger({ memberUids: [OWNER] }), OWNER, { serverTimes: ["createdAt"], provider: "anonymous" }));
});
test("03 only ledger members can read ledgers and nested data", async () => {
  for (const uid of [OWNER, RECEIVER, DEBTOR]) {
    await allowed(get(ledgerPath, uid));
    await allowed(query("members", uid, { parent: ledgerPath }));
    await allowed(query("expenses", uid, { parent: ledgerPath }));
    await allowed(query("payments", uid, { parent: ledgerPath }));
  }
  for (const uid of [OUTSIDER, undefined]) {
    await denied(get(ledgerPath, uid));
    await denied(get(`${ledgerPath}/members/guest`, uid));
    await denied(get(expensePath, uid));
    await denied(query("payments", uid, { parent: ledgerPath }));
  }
  await denied(get("ledgers/private-ledger", OWNER));
});
test("04 ledger list queries must constrain memberUids to the current user", async () => {
  const rows = await allowed(query("ledgers", OWNER, { field: "memberUids", op: "ARRAY_CONTAINS", operand: OWNER }));
  assert.equal(rows.filter(row => row.document).length, 1);
  await denied(query("ledgers", OWNER));
  await denied(query("ledgers", OWNER, { field: "memberUids", op: "ARRAY_CONTAINS_ANY", operand: [OWNER, OUTSIDER] }));
});
test("05 only owner manages temporary members and names", async () => {
  await allowed(write(`${ledgerPath}/members/new-guest`, member("Another guest"), OWNER, { serverTimes: ["createdAt"] }));
  await allowed(write(`${ledgerPath}/members/guest`, { name: "Updated guest" }, OWNER, { merge: true }));
  await denied(write(`${ledgerPath}/members/another`, member("Another"), DEBTOR, { serverTimes: ["createdAt"] }));
  await denied(write(`${ledgerPath}/members/debtor`, { name: "Changed" }, DEBTOR, { merge: true }));
  await denied(write(`${ledgerPath}/members/forged`, member("Forged", OUTSIDER), OWNER, { serverTimes: ["createdAt"] }));
  await denied(write(`${ledgerPath}/members/duplicate-owner`, member("Duplicate owner", OWNER), OWNER, { serverTimes: ["createdAt"] }));
});
test("06 owner cannot bypass invitations to bind accounts or alter membership", async () => {
  await denied(write(ledgerPath, { memberUids: [OWNER, RECEIVER, DEBTOR, OUTSIDER] }, OWNER, { merge: true }));
  await denied(write(`${ledgerPath}/members/guest`, { uid: OUTSIDER }, OWNER, { merge: true }));
  await denied(write(ledgerPath, { ownerUid: OUTSIDER }, OWNER, { merge: true }));
});
test("07 owner can record an expense for any existing ledger payer", async () => {
  await allowed(write(`${ledgerPath}/expenses/new-expense`, expense({ payerMemberId: "guest" }), OWNER, { serverTimes: ["createdAt"] }));
});
test("08 bound members can record their own expenses but cannot impersonate payers", async () => {
  await allowed(write(`${ledgerPath}/expenses/member-expense`, expense({ createdByUid: RECEIVER }), RECEIVER, { serverTimes: ["createdAt"] }));
  await denied(write(`${ledgerPath}/expenses/forged-payer`, expense({ createdByUid: DEBTOR }), DEBTOR, { serverTimes: ["createdAt"] }));
  await denied(write(`${ledgerPath}/expenses/forged-author`, expense(), RECEIVER, { serverTimes: ["createdAt"] }));
});
test("09 outsiders and unknown cross-ledger payer IDs cannot create expenses", async () => {
  await denied(write(`${ledgerPath}/expenses/new-expense`, expense({ createdByUid: OUTSIDER }), OUTSIDER, { serverTimes: ["createdAt"] }));
  await denied(write(`${ledgerPath}/expenses/new-expense`, expense({ payerMemberId: "not-in-this-ledger" }), OWNER, { serverTimes: ["createdAt"] }));
});
test("10 new expenses reject pre-paid balances and malformed basic data", async () => {
  for (const patch of [{ repaid: { debtor: 1, guest: 0 } }, { repaid: { debtor: 0 } }, { amountCents: -1 },
    { amountCents: 1.5 }, { status: "reversed" }, { lastPaymentId: "fake" }, { extra: true }]) {
    await denied(write(`${ledgerPath}/expenses/new-expense`, expense(patch), OWNER, { serverTimes: ["createdAt"] }));
  }
  for (const shares of [{ debtor: -1, guest: 5000 }, { debtor: 1.5, guest: 5000 },
    { debtor: "10000", guest: 5000 }, { debtor: 15000, guest: 1 }, { debtor: 10000, foreign: 5000 }]) {
    const repaid = Object.fromEntries(Object.keys(shares).map(id => [id, 0]));
    await denied(write(`${ledgerPath}/expenses/invalid-shares`, expense({ shares, repaid }), OWNER, { serverTimes: ["createdAt"] }));
  }
});
test("11 owner can atomically record partial and final receipts", async () => {
  await allowed(receive());
  await allowed(receive({ id: "payment-2", amount: 6000, total: 10000 }));
  const doc = await allowed(get(expensePath, DEBTOR));
  assert.equal(doc.fields.repaid.mapValue.fields.debtor.integerValue, "10000");
});
test("12 bound receiver can confirm receipts", async () => {
  await allowed(receive({ uid: RECEIVER }));
});
test("13 debtor and outsiders cannot mark money received", async () => {
  await denied(receive({ uid: DEBTOR }));
  await denied(receive({ uid: OUTSIDER }));
});
test("14 journal entries and aggregate balances cannot be written independently", async () => {
  await denied(write(`${ledgerPath}/payments/payment-1`, payment(), OWNER, { serverTimes: ["createdAt"] }));
  await denied(write(expensePath, { repaid: { debtor: 4000, guest: 0 }, lastPaymentId: "payment-1" }, OWNER, { merge: true }));
});
test("15 receipts reject overpayment, zero, negative, and fractional cents", async () => {
  for (const amount of [10001, 0, -1, 0.5]) await denied(receive({ amount }));
  await allowed(receive());
  await denied(receive({ id: "too-much", amount: 6001, total: 10001 }));
});
test("16 journal receiver, debtor, expense, and author must match the transaction", async () => {
  for (const paymentPatch of [{ toMemberId: "guest" }, { fromMemberId: "receiver" },
    { fromMemberId: "foreign-member" }, { expenseId: "foreign-expense" }, { createdByUid: OUTSIDER }]) {
    await denied(receive({ paymentPatch }));
  }
});
test("17 one receipt cannot change another debtor or reuse an existing journal entry", async () => {
  await denied(receive({ repaidPatch: { guest: 1000 } }));
  await allowed(receive());
  await denied(receive({ amount: 8000, total: 8000 }));
  await denied(write(expensePath, { repaid: { debtor: 8000, guest: 0 }, lastPaymentId: "payment-1" }, OWNER, { merge: true }));
});
test("18 receipt transactions cannot also mutate immutable expense fields", async () => {
  for (const expensePatch of [{ amountCents: 20000 }, { payerMemberId: "owner" }, { shares: { debtor: 20000, guest: 0 } }, { title: "Changed" }]) {
    await denied(receive({ expensePatch }));
  }
});
test("19 concurrent receipts cannot both consume the same outstanding balance", async () => {
  const results = await Promise.all([
    receive({ id: "race-a", amount: 6000, total: 6000 }),
    receive({ id: "race-b", amount: 6000, total: 6000 }),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 403], JSON.stringify(results));
  const doc = await allowed(get(expensePath, OWNER));
  assert.equal(doc.fields.repaid.mapValue.fields.debtor.integerValue, "6000");
  const rows = await allowed(query("payments", OWNER, { parent: ledgerPath }));
  assert.equal(rows.filter(row => row.document).length, 1);
});
test("20 receiver can reverse a receipt atomically with an immutable reversal entry", async () => {
  await allowed(receive());
  await allowed(reversal({ uid: RECEIVER }));
  const doc = await allowed(get(expensePath, OWNER));
  assert.equal(doc.fields.repaid.mapValue.fields.debtor.integerValue, "0");
  const original = await allowed(get(`${ledgerPath}/payments/payment-1`, OWNER));
  assert.equal(original.fields.reversedBy.stringValue, "reversal-1");
  await denied(reversal({ id: "reversal-again", total: -4000 }));
});
test("21 reversals cannot fabricate or partially undo a payment", async () => {
  await allowed(receive());
  await denied(reversal({ amount: 2000, total: 2000 }));
  await denied(reversal({ original: "does-not-exist" }));
  await denied(reversal({ markOriginal: false }));
  await denied(reversal({ uid: DEBTOR }));
  await denied(write(`${ledgerPath}/payments/payment-1`, { reversedBy: "fake-reversal" }, OWNER, { merge: true }));
});
test("22 whole expense reversal requires zero received balance and stops further receipts", async () => {
  await allowed(write(expensePath, { status: "reversed" }, RECEIVER, { merge: true, serverTimes: ["reversedAt"] }));
  await denied(receive());
  await denied(write(expensePath, { status: "active", reversedAt: null }, OWNER, { merge: true }));
});
test("23 settled expenses cannot be reversed or deleted without reversing receipts", async () => {
  await allowed(receive());
  await denied(write(expensePath, { status: "reversed" }, OWNER, { merge: true, serverTimes: ["reversedAt"] }));
  for (const path of [ledgerPath, `${ledgerPath}/members/guest`, expensePath, `${ledgerPath}/payments/payment-1`]) {
    await denied(remove(path, OWNER));
  }
  await denied(write(`${ledgerPath}/private/unrecognized`, { data: true }, OWNER));
});
test("24 only owner can create a minimal invitation for an unbound ledger member", async () => {
  await allowed(write("invites/39b8894d-e91f-46f3-9e1a-64a25f9ce963", invitation(), OWNER, { serverTimes: ["createdAt"] }));
  await denied(write("invites/d2619460-e248-4ab5-a810-dd0e72c5a09e", invitation(), DEBTOR, { serverTimes: ["createdAt"] }));
  await denied(write("invites/582292d3-e695-455a-963e-34f901ec6c93", invitation({ memberId: "receiver", memberName: "Receiver" }), OWNER, { serverTimes: ["createdAt"] }));
  await denied(write("invites/a7f6e5d7-6cf3-4b60-9a4f-58e2b91b26da", invitation({ email: "unnecessary@example.test" }), OWNER, { serverTimes: ["createdAt"] }));
});
test("25 exact invitation token previews do not permit invite listing or ledger access", async () => {
  await allowed(get(`invites/${TOKEN}`, OUTSIDER));
  await denied(get(`invites/${TOKEN}`));
  await denied(request(`/v1/${documents}/invites/${TOKEN}`, { uid: OUTSIDER, provider: "anonymous" }));
  await denied(query("invites", OUTSIDER));
  await allowed(query("invites", OWNER, { field: "ownerUid", operand: OWNER }));
  await denied(get(ledgerPath, OUTSIDER));
  await allowed(write(`invites/${TOKEN}`, { expiresAt: new Date("2020-01-01") }, null, { merge: true, admin: true }));
  await denied(get(`invites/${TOKEN}`, OUTSIDER));
});
test("26 claim creation is self-only, pending, unexpired, and excludes anonymous-auth users", async () => {
  // claimInvite() first reads its own not-yet-created claim in a transaction.
  const missing = await get(`invites/${TOKEN}/claims/${OUTSIDER}`, OUTSIDER);
  assert.equal(missing.status, 404, JSON.stringify(missing));
  await denied(write(`invites/${TOKEN}/claims/someone-else`, claim("someone-else"), OUTSIDER, { serverTimes: ["createdAt"] }));
  await denied(write(`invites/${TOKEN}/claims/${OUTSIDER}`, { ...claim(), status: "approved" }, OUTSIDER, { serverTimes: ["createdAt"] }));
  await denied(write(`invites/${TOKEN}/claims/${OUTSIDER}`, claim(), OUTSIDER, { serverTimes: ["createdAt"], provider: "anonymous" }));
  await allowed(write(`invites/${TOKEN}/claims/${OUTSIDER}`, claim(), OUTSIDER, { serverTimes: ["createdAt"] }));
  await allowed(get(`invites/${TOKEN}/claims/${OUTSIDER}`, OUTSIDER));
  await allowed(query("claims", OWNER, { parent: `invites/${TOKEN}` }));
  await denied(get(`invites/${TOKEN}/claims/${OUTSIDER}`, DEBTOR));
});
test("27 a pending claim does not grant any ledger access or self-approval", async () => {
  await allowed(write(`invites/${TOKEN}/claims/${OUTSIDER}`, claim(), OUTSIDER, { serverTimes: ["createdAt"] }));
  await denied(get(ledgerPath, OUTSIDER));
  await denied(get(expensePath, OUTSIDER));
  await denied(approval({ actor: OUTSIDER }));
  await denied(write(`invites/${TOKEN}/claims/${OUTSIDER}`, { status: "approved" }, OUTSIDER, { merge: true }));
});
test("28 owner approval atomically binds a guest account and grants member access", async () => {
  await allowed(write(`invites/${TOKEN}/claims/${OUTSIDER}`, claim(), OUTSIDER, { serverTimes: ["createdAt"] }));
  await allowed(approval());
  await allowed(get(ledgerPath, OUTSIDER));
  await allowed(get(expensePath, OUTSIDER));
  await allowed(write(`${ledgerPath}/expenses/new-member-expense`, expense({ payerMemberId: "guest", createdByUid: OUTSIDER }), OUTSIDER, { serverTimes: ["createdAt"] }));
  await denied(approval());
});
test("29 each incomplete approval is denied even for the owner", async () => {
  await allowed(write(`invites/${TOKEN}/claims/${OUTSIDER}`, claim(), OUTSIDER, { serverTimes: ["createdAt"] }));
  for (const omitted of ["ledger", "member", "invite", "claim"]) {
    await denied(approval({ include: ["ledger", "member", "invite", "claim"].filter(key => key !== omitted) }));
  }
});
test("30 expired invitations and cross-ledger member bindings cannot be approved", async () => {
  await allowed(write(`invites/${TOKEN}/claims/${OUTSIDER}`, claim(), OUTSIDER, { serverTimes: ["createdAt"] }));
  await denied(approval({ memberId: "receiver" }));
  await denied(approval({ ledgerId: "private-ledger" }));
  await allowed(write(`invites/${TOKEN}`, { expiresAt: new Date("2020-01-01") }, null, { merge: true, admin: true }));
  await denied(approval());
  await denied(write(`invites/${TOKEN}/claims/new-user`, claim("new-user"), "new-user", { serverTimes: ["createdAt"] }));
});

test("31 eight participants with a separate payer stay within Firestore access limits", async () => {
  const ids = Array.from({ length: 8 }, (_, index) => `participant-${index}`);
  await allowed(commit(ids.map(id => update(`${ledgerPath}/members/${id}`, member(id), { serverTimes: ["createdAt"] })), OWNER));
  const shares = Object.fromEntries(ids.map(id => [id, 1000]));
  const repaid = Object.fromEntries(ids.map(id => [id, 0]));
  // A non-owner receiver needs the complete membership and payer checks too.
  await allowed(write(`${ledgerPath}/expenses/eight-person`, expense({ shares, repaid, createdByUid: RECEIVER }), RECEIVER, { serverTimes: ["createdAt"] }));
  await allowed(write(`${ledgerPath}/members/ninth`, member("Ninth"), OWNER, { serverTimes: ["createdAt"] }));
  await denied(write(`${ledgerPath}/expenses/nine-person`, expense({ shares: { ...shares, ninth: 1000 }, repaid: { ...repaid, ninth: 0 } }), OWNER, { serverTimes: ["createdAt"] }));
});

function recurringTemplate(overrides = {}) {
  return {title:'Monthly rent',amountCents:15000,payerMemberId:'receiver',shares:{debtor:10000,guest:5000},
    frequency:'monthly',startDate:'2026-01-31',status:'active',createdByUid:OWNER,...overrides};
}
async function createTemplate(overrides={},uid=OWNER,id='rent') {
  return allowed(write(`${ledgerPath}/templates/${id}`,recurringTemplate(overrides),uid,{serverTimes:['createdAt','updatedAt']}));
}
function postOccurrence({templateId='rent',date='2026-01-31',id='rent-jan',actor=OWNER,expensePatch={},occurrencePatch={},include=['expense','occurrence','details']}={}) {
  const writes={
    details:update(`${ledgerPath}/expenseDetails/${id}`,{note:'Confirmed rent',items:[]}),
    expense:update(`${ledgerPath}/expenses/${id}`,expense({sourceTemplateId:templateId,sourceDate:date,createdByUid:actor,...expensePatch}),{serverTimes:['createdAt']}),
    occurrence:update(`${ledgerPath}/occurrences/${templateId}_${date}`,{templateId,date,status:'posted',expenseId:id,createdByUid:actor,...occurrencePatch},{serverTimes:['createdAt']})
  };
  return commit(include.map(name=>writes[name]),actor);
}

test('32 templates use ledger membership and prevent payer impersonation',async()=>{
  await createTemplate();
  await allowed(get(`${ledgerPath}/templates/rent`,DEBTOR));
  await denied(get(`${ledgerPath}/templates/rent`,OUTSIDER));
  await denied(write(`${ledgerPath}/templates/fake`,recurringTemplate({createdByUid:DEBTOR}),DEBTOR,{serverTimes:['createdAt','updatedAt']}));
  await createTemplate({createdByUid:RECEIVER},RECEIVER,'own');
});
test('33 only creator or owner can manage templates; creation identity is immutable',async()=>{
  await createTemplate({createdByUid:RECEIVER},RECEIVER);
  const path=`${ledgerPath}/templates/rent`;
  await denied(write(path,{status:'paused'},DEBTOR,{merge:true,serverTimes:['updatedAt']}));
  await allowed(write(path,{status:'paused'},RECEIVER,{merge:true,serverTimes:['updatedAt']}));
  await allowed(write(path,{status:'active'},OWNER,{merge:true,serverTimes:['updatedAt']}));
  await denied(write(path,{createdByUid:OWNER},RECEIVER,{merge:true,serverTimes:['updatedAt']}));
  await denied(remove(path,OWNER));
});
test('34 receipt and item details are readable only with the expense and cannot be rewritten',async()=>{
  const details={note:'Dinner receipt',items:[{title:'Soup',amountCents:10000,memberIds:['debtor']},{title:'Drink',amountCents:5000,memberIds:['guest']}],receipts:[{name:'receipt.pdf',type:'application/pdf',size:5,dataUrl:'data:application/pdf;base64,JVBERi0='}]};
  const path=`${ledgerPath}/expenses/details`;
  await allowed(commit([update(path,expense(),{serverTimes:['createdAt']}),update(`${ledgerPath}/expenseDetails/details`,{note:details.note,items:details.items}),update(`${ledgerPath}/expenseReceipts/details`,{files:details.receipts})],OWNER));
  await denied(get(`${ledgerPath}/expenseDetails/details`,OUTSIDER));
  await denied(get(`${ledgerPath}/expenseReceipts/details`,OUTSIDER));
  await denied(write(`${ledgerPath}/expenseDetails/details`,{note:'Changed'},OWNER,{merge:true}));
});
test('35 detail bounds reject oversized notes, active content and invalid item members or totals',async()=>{
  for(const patch of [
    {note:'x'.repeat(1001)},
    {receipts:[{name:'script.svg',type:'image/svg+xml',size:5,dataUrl:'data:image/svg+xml;base64,YWJjZGU='}]},
    {receipts:[{name:'large.png',type:'image/png',size:204801,dataUrl:'data:image/png;base64,YWJjZGU='}]},
    {items:[{title:'Missing',amountCents:15000,memberIds:['unknown']}]},
    {items:[{title:'Wrong total',amountCents:14999,memberIds:['guest']}]},
    {items:[{title:'Duplicate',amountCents:15000,memberIds:['guest','guest']}]},
  ]) await denied(commit([update(`${ledgerPath}/expenses/bad-details`,expense(),{serverTimes:['createdAt']}),update(`${ledgerPath}/expenseDetails/bad-details`,{note:patch.note||'',items:patch.items||[]}),update(`${ledgerPath}/expenseReceipts/bad-details`,{files:patch.receipts||[]})],OWNER));
});
test('36 recurring posting atomically links a new expense and its occurrence',async()=>{
  await createTemplate();
  await denied(postOccurrence({include:['expense']}));
  await denied(postOccurrence({include:['occurrence']}));
  await denied(postOccurrence({occurrencePatch:{expenseId:'other'}}));
  await allowed(postOccurrence());
});
test('37 completed occurrence cannot be reused or removed even after its expense is reversed',async()=>{
  await createTemplate(); await allowed(postOccurrence());
  await denied(postOccurrence({id:'second-post'}));
  await allowed(write(`${ledgerPath}/expenses/rent-jan`,{status:'reversed'},OWNER,{merge:true,serverTimes:['reversedAt']}));
  await denied(postOccurrence({id:'after-reversal'}));
  await denied(remove(`${ledgerPath}/occurrences/rent_2026-01-31`,OWNER));
});
test('38 skipped dates cannot later be posted and other members cannot skip them',async()=>{
  await createTemplate();
  const path=`${ledgerPath}/occurrences/rent_2026-01-31`,record={templateId:'rent',date:'2026-01-31',status:'skipped',expenseId:null,createdByUid:DEBTOR};
  await denied(write(path,record,DEBTOR,{serverTimes:['createdAt']}));
  await allowed(write(path,{...record,createdByUid:OWNER},OWNER,{serverTimes:['createdAt']}));
  await denied(postOccurrence());
});
test('39 occurrence dates respect schedule, month end, future and paused state',async()=>{
  await createTemplate();
  await denied(postOccurrence({date:'2026-02-27'}));
  await denied(postOccurrence({date:'2099-01-31'}));
  await denied(postOccurrence({date:'2026-01-01'}));
  await allowed(postOccurrence({date:'2026-02-28',id:'february'}));
  await allowed(write(`${ledgerPath}/templates/rent`,{status:'paused'},OWNER,{merge:true,serverTimes:['updatedAt']}));
  await denied(postOccurrence());
});
test('40 recurring payer and participant scope stays within the validated template',async()=>{
  await createTemplate();
  await denied(postOccurrence({expensePatch:{payerMemberId:'owner'}}));
  await denied(postOccurrence({expensePatch:{shares:{owner:15000},repaid:{owner:0}}}));
  await denied(postOccurrence({actor:RECEIVER}));
  await allowed(postOccurrence({expensePatch:{amountCents:20000,shares:{debtor:10000,guest:10000}}}));
});
test('41 recurring expenses support eight sharers and a separate payer within rule lookup limits',async()=>{
  const ids=Array.from({length:8},(_,i)=>`roommate-${i}`),shares=Object.fromEntries(ids.map(id=>[id,1000])),repaid=Object.fromEntries(ids.map(id=>[id,0]));
  await allowed(commit(ids.map(id=>update(`${ledgerPath}/members/${id}`,member(id),{serverTimes:['createdAt']})),null,{admin:true}));
  await createTemplate({amountCents:8000,shares});
  await allowed(postOccurrence({expensePatch:{amountCents:8000,shares,repaid}}));
});


test('42 eight item rows, eight members and three receipts remain within rule budgets',async()=>{
  const ids=Array.from({length:8},(_,i)=>`meal-${i}`), shares=Object.fromEntries(ids.map(id=>[id,1000])),repaid=Object.fromEntries(ids.map(id=>[id,0]));
  await allowed(commit(ids.map(id=>update(`${ledgerPath}/members/${id}`,member(id),{serverTimes:['createdAt']})),null,{admin:true}));
  const items=Array.from({length:8},(_,i)=>({title:`Dish ${i}`,amountCents:1000,memberIds:ids}));
  await allowed(commit([
    update(`${ledgerPath}/expenses/eight-items`,expense({amountCents:8000,shares,repaid}),{serverTimes:['createdAt']}),
    update(`${ledgerPath}/expenseDetails/eight-items`,{note:'Shared dishes',items}),
    update(`${ledgerPath}/expenseReceipts/eight-items`,{files:Array.from({length:3},()=>({name:'receipt.pdf',type:'application/pdf',size:5,dataUrl:'data:application/pdf;base64,JVBERi0='}))})
  ],OWNER));
});

test('43 detail and receipt documents cannot be attached to old expenses or rewritten',async()=>{
  await denied(write(`${ledgerPath}/expenseDetails/${EXPENSE}`,{note:'Late tampering',items:[]},OWNER));
  await denied(write(`${ledgerPath}/expenseReceipts/${EXPENSE}`,{files:[]},OWNER));
  await denied(write(`${ledgerPath}/expenseDetails/missing`,{note:'Orphan',items:[]},OWNER));
});
test('44 template detail edits require an authorized atomic template update',async()=>{
  await createTemplate();
  const path=`${ledgerPath}/templateDetails/rent`;
  await denied(write(path,{note:'Unlinked edit',items:[]},OWNER));
  await denied(commit([
    update(`${ledgerPath}/templates/rent`,{status:'active'},{merge:true,serverTimes:['updatedAt']}),
    update(path,{note:'Unauthorized edit',items:[]})
  ],DEBTOR));
  await allowed(commit([
    update(`${ledgerPath}/templates/rent`,{status:'active'},{merge:true,serverTimes:['updatedAt']}),
    update(path,{note:'Updated note',items:[]})
  ],OWNER));
  await denied(get(path,OUTSIDER));
});
