import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

// Run the real browser script in isolation: no Firebase SDK, network, or account.
process.env.TZ = "America/New_York";
const source = await readFile(new URL("../public/scripts/main.js", import.meta.url), "utf8");
const PAYER = "payer";
const DEBTORS = ["alice", "bob"];
const plain = value => Object.fromEntries(Object.entries(value));

function element(tagName = "div") {
  const el = {
    tagName: tagName.toUpperCase(), children: [], style: {}, dataset: {},
    value: "", className: "", selected: false, listeners: {},
    appendChild(child) { this.children.push(child); return child; },
    replaceWith(child) { this.replacement = child; },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    setAttribute(name, value) {
      if (name === "class") this.className = value;
      else if (name.startsWith("data-")) this.dataset[name.slice(5)] = value;
      else this[name] = value;
    },
    querySelectorAll(selector) {
      const found = [];
      const visit = child => {
        const matches = selector.startsWith(".")
          ? child.className.split(/\s+/).includes(selector.slice(1))
          : child.tagName === selector.toUpperCase();
        if (matches) found.push(child);
        child.children.forEach(visit);
      };
      this.children.forEach(visit);
      return found;
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
  };
  Object.defineProperty(el, "selectedOptions", { get: () => el.children.filter(child => child.selected) });
  Object.defineProperty(el, "innerHTML", {
    get: () => el.html || "",
    set(html) {
      el.html = html;
      el.children = [];
      // Only form controls need DOM behavior; no application code is extracted.
      for (const match of html.matchAll(/<(input|button)\b([^>]*)>/g)) {
        const control = element(match[1]);
        for (const attr of match[2].matchAll(/([\w-]+)="([^"]*)"/g)) control.setAttribute(attr[1], attr[2]);
        el.appendChild(control);
      }
    },
  });
  return el;
}

function harness({ amount = "10.00", date = "2026-09-18", splitType = "equal", debtors = DEBTORS,
  percentages = ["50", "50"], original = {} } = {}) {
  const elements = new Map();
  for (const id of ["inputTitle", "inputDate", "inputAmount", "inputPayer", "selectSplitType", "selectDebtors",
    "percentList", "percentRows", "btnEdit", "btnSave", "navBillTitle", "billTitleHeading", "billListContainer"]) {
    elements.set(`#${id}`, element(id === "selectDebtors" ? "select" : "div"));
  }
  const document = {
    querySelector: selector => elements.get(selector) || null,
    querySelectorAll: selector => [...elements.values()].flatMap(el => el.querySelectorAll(selector)),
    createElement: element,
  };
  const writes = [];
  const alerts = [];
  const firestore = () => ({
    collection: name => ({
      add: async payload => { writes.push({ operation: "add", collection: name, payload }); },
      doc: id => ({ update: async payload => { writes.push({ operation: "update", collection: name, id, payload }); } }),
    }),
  });
  firestore.Timestamp = { fromDate: dateValue => {
    assert.ok(Number.isFinite(dateValue.getTime()), "Firestore rejects invalid timestamps");
    const millis = dateValue.getTime();
    return { toDate: () => new Date(millis) };
  } };
  firestore.FieldValue = { serverTimestamp: () => "server-timestamp" };
  const context = vm.createContext({
    firebase: { auth: () => ({ onAuthStateChanged() {} }), firestore },
    document, window: { location: { href: "", search: "" } }, alert: message => alerts.push(String(message)),
    console, URLSearchParams,
  });
  vm.runInContext(source, context, { filename: "public/scripts/main.js" });
  const { rhit } = context;
  rhit.fbAuthManager._user = { uid: PAYER, displayName: "Payer" };
  const originalBill = {
    title: "Original bill", amountCents: 1000, date: firestore.Timestamp.fromDate(new Date("2026-09-18T00:00:00Z")),
    payerUid: PAYER, debtors: DEBTORS, splitType: "equal", shares: { alice: 500, bob: 500 }, paid: { alice: false, bob: false },
    ...original,
  };
  const manager = new rhit.FbSingleBillManager("existing-bill");
  manager._documentSnapshot = { id: "existing-bill", get: field => originalBill[field] };
  rhit.fbSingleBillManager = manager;
  const users = [...new Set([PAYER, ...DEBTORS, ...debtors, ...originalBill.debtors])];
  rhit.fbUsersManager = {
    length: users.length, getUserAtIndex: i => ({ uid: users[i], displayName: users[i], email: "" }),
    getDisplay: uid => uid,
  };
  const create = Object.create(rhit.CreatePageController.prototype);
  const detail = Object.create(rhit.DetailPageController.prototype);
  detail._paidEditable = { ...originalBill.paid };
  detail._canEdit = true;
  detail._editMode = true;
  // Rendering repayment buttons is outside these calculation tests.
  detail._renderDebtorStatusList = () => {};
  const field = id => elements.get(`#${id}`);
  field("inputTitle").value = "Dinner";
  field("inputDate").value = date;
  field("inputAmount").value = amount;
  field("selectSplitType").value = splitType;
  for (const uid of debtors) {
    const option = element("option");
    option.value = uid; option.textContent = uid; option.selected = true;
    field("selectDebtors").appendChild(option);
  }
  for (let i = 0; i < percentages.length; i++) {
    const input = element("input");
    input.className = "percent-input"; input.dataset.uid = debtors[i]; input.value = percentages[i];
    field("percentRows").appendChild(input);
  }
  return { rhit, writes, alerts, create, detail, field, document, originalBill };
}

async function save(mode, options) {
  const h = harness(options);
  if (mode === "create") await h.create.handleSave();
  else await h.detail.saveEdit();
  return h;
}

function saved(h) {
  assert.deepEqual(h.alerts, [], "valid input must not alert");
  assert.equal(h.writes.length, 1, "valid input must write once");
  return h.writes[0].payload;
}

function rejected(h, reason) {
  assert.equal(h.writes.length, 0, `${reason}: invalid input must not write`);
  assert.ok(h.alerts.length > 0, `${reason}: invalid input must explain the error`);
}

test("date regressions run in America/New_York, including DST", () => {
  assert.equal(new Date("2026-01-15T00:00:00Z").getTimezoneOffset(), 300);
  assert.equal(new Date("2026-07-15T00:00:00Z").getTimezoneOffset(), 240);
});

for (const mode of ["create", "edit"]) {
  test(`${mode}: 1 cent split 50/50 allocates exactly 1 cent`, async () => {
    const payload = saved(await save(mode, { amount: "0.01", splitType: "percent" }));
    const shares = Object.values(payload.shares);
    assert.ok(shares.every(value => Number.isSafeInteger(value) && value >= 0));
    assert.equal(shares.reduce((a, b) => a + b, 0), 1);
  });

  test(`${mode}: fractional percentages allocate the remaining cent to the largest remainder`, async () => {
    const payload = saved(await save(mode, { amount: "0.01", splitType: "percent", debtors: ["alice", "bob", "carol"], percentages: ["33.33", "33.33", "33.34"] }));
    assert.deepEqual(plain(payload.shares), { alice: 0, bob: 0, carol: 1 });
  });

  test(`${mode}: percentages below 100 leave the remainder with the payer`, async () => {
    const payload = saved(await save(mode, { amount: "10.00", splitType: "percent", percentages: ["25", "15"] }));
    assert.deepEqual(plain(payload.shares), { alice: 250, bob: 150 });
    assert.equal(payload.amountCents - Object.values(payload.shares).reduce((a, b) => a + b, 0), 600);
  });

  test(`${mode}: explicit zero share is allowed`, async () => {
    const payload = saved(await save(mode, { amount: "0.01", splitType: "percent", percentages: ["0", "100"] }));
    assert.deepEqual(plain(payload.shares), { alice: 0, bob: 1 });
  });

  test(`${mode}: equal split distributes cents among debtors, excluding payer`, async () => {
    const payload = saved(await save(mode, { amount: "0.05", debtors: ["alice", "bob", "carol"] }));
    assert.deepEqual(plain(payload.shares), { alice: 2, bob: 2, carol: 1 });
    assert.equal(Object.hasOwn(payload.shares, PAYER), false);
  });

  test(`${mode}: adding a debtor preserves typed percentages and saves those values`, async () => {
    const h = harness({ splitType: "percent", original: { splitType: "percent" } });
    const controller = mode === "create" ? h.create : h.detail;
    if (mode === "edit") {
      h.detail.updateView();
      h.detail.setEditable(true);
    } else h.create.refreshPercentRows();
    const inputs = h.document.querySelectorAll(".percent-input");
    inputs[0].value = "25";
    inputs[1].value = "15";
    const option = element("option");
    option.value = "carol"; option.textContent = "Carol"; option.selected = true;
    h.field("selectDebtors").appendChild(option);
    controller.refreshPercentRows();
    const refreshed = h.document.querySelectorAll(".percent-input");
    assert.deepEqual(Object.fromEntries(refreshed.map(input => [input.dataset.uid, input.value])), {
      alice: "25", bob: "15", carol: "",
    });
    refreshed.find(input => input.dataset.uid === "carol").value = "20";
    if (mode === "create") await controller.handleSave();
    else await controller.saveEdit();
    assert.deepEqual(plain(saved(h).shares), { alice: 250, bob: 150, carol: 200 });
  });

  test(`${mode}: switching percent to equal and back preserves the percentage draft`, async () => {
    const h = harness({ splitType: "percent", original: { splitType: "percent" } });
    const controller = mode === "create" ? h.create : h.detail;
    if (mode === "edit") {
      h.detail.updateView();
      h.detail.setEditable(true);
    } else h.create.refreshPercentRows();
    const inputs = h.document.querySelectorAll(".percent-input");
    inputs[0].value = "25";
    inputs[1].value = "15";
    h.field("selectSplitType").value = "equal";
    controller.refreshPercentRows();
    h.field("selectSplitType").value = "percent";
    controller.refreshPercentRows();
    const restored = h.document.querySelectorAll(".percent-input");
    assert.deepEqual(Object.fromEntries(restored.map(input => [input.dataset.uid, input.value])), { alice: "25", bob: "15" });
    if (mode === "create") await controller.handleSave();
    else await controller.saveEdit();
    assert.deepEqual(plain(saved(h).shares), { alice: 250, bob: 150 });
  });

  for (const [label, percentages] of [
    ["negative and over-100 individual values", ["-10", "110"]],
    ["NaN", ["NaN", "50"]], ["Infinity", ["Infinity", "50"]],
    ["invalid text", ["abc", "50"]], ["blank value", ["", "50"]],
    ["missing debtor row", ["50"]], ["sum above 100", ["60", "50"]],
    ["all zero", ["0", "0"]], ["over-precise percentage", ["33.333", "50"]],
  ]) {
    test(`${mode}: rejects ${label} percentages without writing`, async () => {
      rejected(await save(mode, { splitType: "percent", percentages }), label);
    });
  }

  test(`${mode}: decimal money is stored as exact integer cents`, async () => {
    for (const [amount, expected] of [["0.29", 29], ["19.99", 1999], ["1.01", 101], ["90071992547409.91", Number.MAX_SAFE_INTEGER]]) {
      assert.equal(saved(await save(mode, { amount })).amountCents, expected, amount);
    }
  });

  for (const amount of ["1.005", "1e2", "0x10", "NaN", "Infinity", "90071992547409.92", "", "-1", "0"]) {
    test(`${mode}: rejects invalid/unsafe money ${JSON.stringify(amount)} without writing`, async () => {
      rejected(await save(mode, { amount }), amount);
    });
  }

  test(`${mode}: date-only values keep UTC midnight and the same New York display key`, async () => {
    for (const date of ["2026-01-15", "2026-03-08", "2026-07-15", "2026-11-01"]) {
      const h = await save(mode, { date });
      const storedDate = saved(h).date.toDate();
      assert.equal(storedDate.toISOString(), `${date}T00:00:00.000Z`);
      assert.equal(h.rhit._toInputDate(storedDate), date);
    }
  });

  test(`${mode}: rejects impossible or malformed calendar dates`, async () => {
    for (const date of ["2026-02-30", "not-a-date", "2026-9-8"]) {
      rejected(await save(mode, { date }), date);
    }
  });
}

test("create: user directory refresh preserves selected debtors and percentage draft", async () => {
  const h = harness({ splitType: "percent", percentages: ["25", "15"] });
  h.create.updateDebtorSelect();
  assert.deepEqual(h.field("selectDebtors").selectedOptions.map(option => option.value), DEBTORS);
  assert.deepEqual(Object.fromEntries(h.document.querySelectorAll(".percent-input").map(input => [input.dataset.uid, input.value])), {
    alice: "25", bob: "15",
  });
  await h.create.handleSave();
  assert.deepEqual(plain(saved(h).shares), { alice: 250, bob: 150 });
});

test("history filters and groups UTC-midnight bills under the selected calendar day", () => {
  const h = harness();
  const history = Object.create(h.rhit.HistoryPageController.prototype);
  history._filterMode = "all";
  history._searchText = "";
  history._selectedDateKeys = new Set(["2026-09-18"]);
  history._mergeBills = () => [{
    id: "bill", title: "Dinner", date: new Date("2026-09-18T00:00:00Z"), amountCents: 100,
    payerUid: PAYER, debtors: DEBTORS, shares: { alice: 50, bob: 50 }, paid: { alice: false, bob: false },
  }];
  history.updateList();
  const rendered = h.field("billListContainer").replacement;
  assert.ok(rendered, "history list renders");
  assert.deepEqual(rendered.children.filter(child => child.tagName === "H5").map(child => child.innerText), ["2026-09-18"]);
});

test("detail opens and saves an existing UTC date without moving it back a day", async () => {
  const h = harness();
  h.detail.updateView();
  assert.equal(h.field("inputDate").value, "2026-09-18");
  h.detail.setEditable(true);
  h.field("inputTitle").value = "Updated title";
  await h.detail.saveEdit();
  assert.equal(saved(h).date.toDate().toISOString(), "2026-09-18T00:00:00.000Z");
});

test("detail displays and resaves maximum safe cents without losing a cent", async () => {
  const shares = { alice: 4503599627370496, bob: 4503599627370495 };
  const h = harness({ original: { amountCents: Number.MAX_SAFE_INTEGER, shares } });
  h.detail.updateView();
  assert.equal(h.field("inputAmount").value, "90071992547409.91");
  h.detail.setEditable(true);
  h.field("inputTitle").value = "Same amount";
  await h.detail.saveEdit();
  const payload = saved(h);
  assert.equal(payload.amountCents, Number.MAX_SAFE_INTEGER);
  assert.deepEqual(plain(payload.shares), shares);
});

for (const [label, amountCents, shares] of [
  ["rounded percentages", 101, { alice: 34, bob: 34, carol: 33 }],
  ["large bill rounding", 100000, { alice: 33333, bob: 33333, carol: 33334 }],
  ["partial payer allocation", 999, { alice: 111, bob: 222 }],
  ["very small shares", 19999, { alice: 1, bob: 2 }],
]) {
  test(`detail title-only edit preserves original ${label} shares`, async () => {
    const debtors = Object.keys(shares);
    const h = harness({ original: { amountCents, splitType: "percent", shares, debtors } });
    h.detail.updateView();
    h.detail.setEditable(true);
    h.field("inputTitle").value = "Only the title changed";
    await h.detail.saveEdit();
    assert.deepEqual(plain(saved(h).shares), shares);
  });
}
