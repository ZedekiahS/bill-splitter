import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { before, beforeEach, test } from "node:test";

// This suite is deliberately restricted to one disposable, local emulator project.
const PROJECT = "demo-bill-splitter-permissions";
const host = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8280";
const hostMatch = /^(localhost|127\.0\.0\.1):(\d{1,5})$/.exec(host);
if (!hostMatch || Number(hostMatch[2]) < 1 || Number(hostMatch[2]) > 65535) {
  throw new Error("FIRESTORE_EMULATOR_HOST must be localhost:<port> or 127.0.0.1:<port>.");
}
const origin = `http://${host}`;
const database = `projects/${PROJECT}/databases/(default)`;
const documents = `${database}/documents`;
const PAYER = "payer";
const DEBTOR = "debtor";
const OUTSIDER = "outsider";
const OTHER_DEBTOR = "other-debtor";
const EXISTING = "bills/existing-bill";
const timestamp = new Date("2026-09-18T12:00:00.000Z");

function authToken(uid) {
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    sub: uid,
    user_id: uid,
    iat: now,
    exp: now + 3600,
    auth_time: now,
    firebase: { sign_in_provider: "custom", identities: {} },
  })}.`;
}

async function request(path, { method = "GET", body, uid, admin = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (admin) headers.Authorization = "Bearer owner";
  else if (uid) headers.Authorization = `Bearer ${authToken(uid)}`;
  const response = await fetch(`${origin}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; }
  catch { data = raw; }
  return { status: response.status, data };
}

async function allowed(resultPromise) {
  const result = await resultPromise;
  assert.ok(result.status >= 200 && result.status < 300, JSON.stringify(result));
  return result.data;
}

async function denied(resultPromise) {
  const result = await resultPromise;
  assert.equal(result.status, 403, JSON.stringify(result));
  assert.equal(result.data?.error?.status, "PERMISSION_DENIED", JSON.stringify(result));
}

function value(input) {
  if (input === null) return { nullValue: null };
  if (input instanceof Date) return { timestampValue: input.toISOString() };
  if (typeof input === "string") return { stringValue: input };
  if (typeof input === "boolean") return { booleanValue: input };
  if (typeof input === "number") {
    return Number.isInteger(input) ? { integerValue: String(input) } : { doubleValue: input };
  }
  if (Array.isArray(input)) return { arrayValue: { values: input.map(value) } };
  if (input && typeof input === "object") return { mapValue: { fields: fields(input) } };
  throw new Error(`Unsupported fixture value: ${String(input)}`);
}

function fields(data) {
  return Object.fromEntries(Object.entries(data).map(([key, input]) => [key, value(input)]));
}

function write(path, data, { uid, admin = false, merge = false, serverTimes = [], deleteFields = [] } = {}) {
  const update = { update: { name: `${documents}/${path}`, fields: fields(data) } };
  if (merge) update.updateMask = { fieldPaths: [...Object.keys(data), ...deleteFields] };
  if (serverTimes.length) {
    update.updateTransforms = serverTimes.map(fieldPath => ({ fieldPath, setToServerValue: "REQUEST_TIME" }));
  }
  return request(`/v1/${documents}:commit`, { method: "POST", body: { writes: [update] }, uid, admin });
}

function remove(path, uid) {
  return request(`/v1/${documents}:commit`, {
    method: "POST", uid, body: { writes: [{ delete: `${documents}/${path}` }] },
  });
}

function get(path, uid) {
  return request(`/v1/${documents}/${path}`, { uid });
}

function query(collectionId, uid, { field, op = "EQUAL", operand, orderBy, direction = "DESCENDING", limit } = {}) {
  const structuredQuery = { from: [{ collectionId }] };
  if (field) structuredQuery.where = { fieldFilter: { field: { fieldPath: field }, op, value: value(operand) } };
  if (orderBy) structuredQuery.orderBy = [{ field: { fieldPath: orderBy }, direction }];
  if (limit) structuredQuery.limit = limit;
  return request(`/v1/${documents}:runQuery`, { method: "POST", uid, body: { structuredQuery } });
}

function profile(uid, overrides = {}) {
  return { uid, email: null, displayName: null, phoneNumber: null, photoURL: null, ...overrides };
}

function bill(overrides = {}) {
  return {
    title: "Shared dinner", date: timestamp, amountCents: 10000,
    payerUid: PAYER, debtors: [DEBTOR], splitType: "equal",
    shares: { [DEBTOR]: 10000 }, paid: { [DEBTOR]: false }, status: "open", ...overrides,
  };
}

function createBill(data = bill(), uid = PAYER) {
  return write("bills/new-bill", data, { uid, serverTimes: ["createdAt"] });
}

function editBill(data, uid = PAYER, options = {}) {
  return write(EXISTING, data, { uid, merge: true, serverTimes: ["lastUpdated"], ...options });
}

before(async () => {
  const content = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  await allowed(request(`/emulator/v1/projects/${PROJECT}:securityRules`, {
    method: "PUT", admin: true, body: { rules: { files: [{ content }] } },
  }));
});

beforeEach(async () => {
  await allowed(request(`/emulator/v1/${documents}`, { method: "DELETE", admin: true }));
  for (const uid of [PAYER, DEBTOR, OUTSIDER, OTHER_DEBTOR]) {
    await allowed(write(`users/${uid}`, profile(uid, { displayName: uid }), {
      admin: true, serverTimes: ["lastSeen"],
    }));
  }
  await allowed(write(EXISTING, bill(), { admin: true, serverTimes: ["createdAt"] }));
  await allowed(write("bills/other-bill", bill({
    payerUid: OUTSIDER, debtors: [OTHER_DEBTOR], shares: { [OTHER_DEBTOR]: 10000 }, paid: { [OTHER_DEBTOR]: false },
  }), { admin: true, serverTimes: ["createdAt"] }));
});

test("01 anonymous clients cannot read or write user profiles", async () => {
  await denied(get(`users/${PAYER}`));
  await denied(query("users"));
  await denied(write("users/new-user", profile("new-user"), { serverTimes: ["lastSeen"] }));
  await denied(write(`users/${PAYER}`, { displayName: "Changed" }, { merge: true, serverTimes: ["lastSeen"] }));
  await denied(remove(`users/${PAYER}`));
});

test("02 anonymous clients cannot read or write bills", async () => {
  await denied(get(EXISTING));
  await denied(query("bills"));
  await denied(write("bills/anonymous-bill", bill(), { serverTimes: ["createdAt"] }));
  await denied(editBill({ title: "Changed" }, null));
  await denied(remove(EXISTING));
});

test("03 unknown collections deny authenticated and anonymous access", async () => {
  await allowed(write("unknown/record", { title: "Private" }, { admin: true }));
  for (const uid of [undefined, PAYER]) {
    await denied(get("unknown/record", uid));
    await denied(query("unknown", uid));
    await denied(write("unknown/new-record", { title: "No" }, { uid }));
  }
});

test("04 authenticated directory query and profile reads remain available", async () => {
  const rows = await allowed(query("users", PAYER, { orderBy: "displayName", direction: "ASCENDING", limit: 500 }));
  assert.equal(rows.filter(row => row.document).length, 4);
  await allowed(get(`users/${DEBTOR}`, PAYER));
});

test("05 users can create their own profile with nullable provider fields", async () => {
  await allowed(write("users/new-user", profile("new-user"), { uid: "new-user", serverTimes: ["lastSeen"] }));
});

test("06 current ensureUserDoc merge and profile refresh are allowed", async () => {
  await allowed(write(`users/${PAYER}`, profile(PAYER, { email: "payer@example.test", displayName: "Payer" }), {
    uid: PAYER, merge: true, serverTimes: ["lastSeen"],
  }));
  const result = await allowed(get(`users/${PAYER}`, PAYER));
  assert.equal(result.fields.displayName.stringValue, "Payer");
});

test("07 users cannot create or update another user's profile", async () => {
  await denied(write("users/victim", profile("victim"), { uid: PAYER, serverTimes: ["lastSeen"] }));
  await denied(write(`users/${DEBTOR}`, { displayName: "Forged" }, { uid: PAYER, merge: true, serverTimes: ["lastSeen"] }));
});

test("08 profile uid must agree with path and authenticated identity", async () => {
  await denied(write("users/new-user", profile(PAYER), { uid: "new-user", serverTimes: ["lastSeen"] }));
  await denied(write(`users/${PAYER}`, { uid: DEBTOR }, { uid: PAYER, merge: true, serverTimes: ["lastSeen"] }));
});

test("09 profile writes reject undeclared role fields and invalid profile types", async () => {
  await denied(write("users/new-user", profile("new-user", { role: "admin" }), { uid: "new-user", serverTimes: ["lastSeen"] }));
  await denied(write(`users/${PAYER}`, { role: "admin" }, { uid: PAYER, merge: true, serverTimes: ["lastSeen"] }));
  await denied(write(`users/${PAYER}`, { displayName: 123 }, { uid: PAYER, merge: true, serverTimes: ["lastSeen"] }));
  await denied(write(`users/${PAYER}`, { lastSeen: timestamp }, { uid: PAYER, merge: true }));
});

test("10 profile deletion is denied even to its owner", async () => {
  await denied(remove(`users/${PAYER}`, PAYER));
  await denied(remove(`users/${DEBTOR}`, PAYER));
});

test("11 payer can create the exact current frontend bill shape", async () => {
  await allowed(createBill());
  const result = await allowed(get("bills/new-bill", PAYER));
  assert.ok(result.fields.createdAt.timestampValue);
  assert.equal(result.fields.lastUpdated, undefined);
});

test("12 bill creation cannot impersonate a different payer", async () => {
  await denied(createBill(bill({ payerUid: OUTSIDER }), PAYER));
});

test("13 bill creation rejects missing, unknown, or invalid basic fields", async () => {
  const missingTitle = bill();
  delete missingTitle.title;
  const invalid = [
    missingTitle, bill({ title: "" }), bill({ extra: true }), bill({ amountCents: 0 }),
    bill({ amountCents: -1 }), bill({ amountCents: 1.5 }), bill({ amountCents: "10000" }),
    bill({ date: "2026-09-18" }), bill({ debtors: [], shares: {}, paid: {} }), bill({ debtors: DEBTOR }),
    bill({ debtors: [DEBTOR, DEBTOR] }),
    bill({ debtors: [PAYER], shares: { [PAYER]: 10000 }, paid: { [PAYER]: false } }),
    bill({ splitType: "unsupported" }), bill({ status: "closed" }),
  ];
  for (const data of invalid) await denied(createBill(data));
  await denied(write("bills/new-bill", bill(), { uid: PAYER }));
  await denied(write("bills/new-bill", bill({ createdAt: timestamp }), { uid: PAYER }));
});

test("14 payer and listed debtor can get an individual bill", async () => {
  await allowed(get(EXISTING, PAYER));
  await allowed(get(EXISTING, DEBTOR));
});

test("15 unrelated authenticated users cannot get another bill", async () => {
  await denied(get(EXISTING, OUTSIDER));
});

test("16 current payerUid filter with createdAt ordering is allowed", async () => {
  const rows = await allowed(query("bills", PAYER, { field: "payerUid", operand: PAYER, orderBy: "createdAt" }));
  assert.deepEqual(rows.filter(row => row.document).map(row => row.document.name), [`${documents}/${EXISTING}`]);
});

test("17 current debtor array-contains filter with createdAt ordering is allowed", async () => {
  const rows = await allowed(query("bills", DEBTOR, {
    field: "debtors", op: "ARRAY_CONTAINS", operand: DEBTOR, orderBy: "createdAt",
  }));
  assert.deepEqual(rows.filter(row => row.document).map(row => row.document.name), [`${documents}/${EXISTING}`]);
});

test("18 authenticated unfiltered bill collection queries are denied", async () => {
  await denied(query("bills", PAYER));
  await denied(query("bills", DEBTOR));
});

test("19 queries mixing the caller with unrelated identities are denied", async () => {
  await denied(query("bills", PAYER, { field: "payerUid", op: "IN", operand: [PAYER, OUTSIDER], orderBy: "createdAt" }));
  await denied(query("bills", DEBTOR, {
    field: "debtors", op: "ARRAY_CONTAINS_ANY", operand: [DEBTOR, OTHER_DEBTOR], orderBy: "createdAt",
  }));
});

test("20 original payer can save the full current edit payload", async () => {
  await allowed(editBill({
    title: "Dinner updated", date: new Date("2026-09-19T12:00:00.000Z"), amountCents: 12000,
    splitType: "percent", debtors: [DEBTOR, OTHER_DEBTOR],
    shares: { [DEBTOR]: 3000, [OTHER_DEBTOR]: 6000 }, paid: { [DEBTOR]: false, [OTHER_DEBTOR]: true },
  }));
  const result = await allowed(get(EXISTING, PAYER));
  assert.equal(result.fields.title.stringValue, "Dinner updated");
  assert.ok(result.fields.lastUpdated.timestampValue);
});

test("21 original payer can update paid state", async () => {
  await allowed(editBill({ paid: { [DEBTOR]: true } }));
  const result = await allowed(get(EXISTING, DEBTOR));
  assert.equal(result.fields.paid.mapValue.fields[DEBTOR].booleanValue, true);
});

test("22 debtor cannot modify bill details or mark themselves paid", async () => {
  await denied(editBill({ title: "Debtor edit" }, DEBTOR));
  await denied(editBill({ paid: { [DEBTOR]: true } }, DEBTOR));
});

test("23 outsider cannot modify existing bill details", async () => {
  await denied(editBill({ title: "Outsider edit" }, OUTSIDER));
});

test("24 outsider cannot gain access by adding themselves as a debtor", async () => {
  await denied(editBill({
    debtors: [DEBTOR, OUTSIDER], shares: { [DEBTOR]: 5000, [OUTSIDER]: 5000 },
    paid: { [DEBTOR]: false, [OUTSIDER]: false },
  }, OUTSIDER));
});

test("25 debtor and outsider cannot take ownership in their update payload", async () => {
  for (const uid of [DEBTOR, OUTSIDER]) {
    await denied(editBill({
      payerUid: uid, debtors: [PAYER], shares: { [PAYER]: 10000 }, paid: { [PAYER]: false },
    }, uid));
  }
});

test("26 even the payer cannot change identity, creation time, or status", async () => {
  for (const patch of [{ payerUid: OUTSIDER }, { createdAt: new Date("2020-01-01T00:00:00Z") }, { status: "closed" }]) {
    await denied(editBill(patch));
  }
});

test("27 deleting a required field cannot bypass update validation", async () => {
  for (const field of ["title", "amountCents", "debtors", "payerUid", "createdAt", "status"]) {
    await denied(editBill({}, PAYER, { deleteFields: [field] }));
  }
});

test("28 payer updates reject unknown fields, malformed fields, and forged update time", async () => {
  await denied(editBill({ unexpected: true }));
  await denied(editBill({ amountCents: "10000" }));
  await denied(editBill({ title: "Changed", lastUpdated: timestamp }, PAYER, { serverTimes: [] }));
});

test("29 bill deletion is denied to payer, debtor, and outsider", async () => {
  for (const uid of [PAYER, DEBTOR, OUTSIDER]) await denied(remove(EXISTING, uid));
});

test("30 default deny covers nested user and bill subcollections", async () => {
  for (const path of [`users/${PAYER}/private/existing`, `${EXISTING}/notes/existing`]) {
    await allowed(write(path, { text: "Private fixture" }, { admin: true }));
    for (const uid of [undefined, PAYER, DEBTOR]) {
      await denied(get(path, uid));
      await denied(write(path, { text: "Changed" }, { uid }));
      await denied(remove(path, uid));
    }
  }
});

test("31 payer membership changes immediately revoke and grant read access", async () => {
  await allowed(editBill({
    debtors: [OTHER_DEBTOR], shares: { [OTHER_DEBTOR]: 10000 }, paid: { [OTHER_DEBTOR]: false },
  }));
  await denied(get(EXISTING, DEBTOR));
  await allowed(get(EXISTING, OTHER_DEBTOR));
  await allowed(get(EXISTING, PAYER));
});

test("32 shares and paid maps must match debtor keys, with boolean paid values", async () => {
  const invalid = [
    { shares: [] }, { paid: [] }, { shares: {} }, { paid: {} },
    { shares: { [DEBTOR]: 10000, [OUTSIDER]: 0 } },
    { paid: { [DEBTOR]: false, [OUTSIDER]: false } },
    { paid: { [DEBTOR]: "false" } }, { paid: { [DEBTOR]: 1 } },
  ];
  for (const patch of invalid) {
    await denied(createBill(bill(patch)));
    await denied(editBill(patch));
  }
});
