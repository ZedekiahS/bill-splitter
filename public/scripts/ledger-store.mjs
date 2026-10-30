import { splitShares } from "./ledger-core.mjs";
import { occurrenceId } from "./expense-features.mjs";
import { createStateStore, text, expenseData, templateData, requireOccurrence, occurrenceData, requireSource, paymentData, requireInvite, readableInvite, approval, readable, owner, receiver, templateAccess, newId, withId, requireUser } from "./ledger-domain.mjs";
const DEMO_KEY = "bill-splitter-ledger-demo-v1";
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
function splitDetails(record) {
  const { note = "", items = [], receipts = [], ...base } = record;
  return { base, details: { note, items }, receipts: { files: receipts } };
}
function attachDetails(records, details, receipts = []) {
  const files = new Map(receipts.map(({id, files}) => [id, files]));
  const byId = new Map(details.map(({ id, note, items }) => [id, { note, items, receipts: files.get(id) || [] }]));
  return records.map(record => ({ ...record, ...(byId.get(record.id) || { note: record.note || "", items: record.items || [], receipts: record.receipts || [] }) }));
}
function seed() {
  const state = { ledgers: {}, members: {}, expenses: {}, payments: {}, invites: {}, claims: {} };
  const createdAt = "2026-09-18T12:00:00.000Z";
  for (const [id, title, names, rows] of [
    ["demo-roommates", "合租生活", ["Zed", "小林", "阿杰", "小周"], [["九月水电费", 36800, "2026-09-15"], ["周末补充日用品", 12650, "2026-09-17"]]],
    ["demo-travel", "杭州周末旅行", ["Zed", "小雨", "阿杰", "安安"], [["湖边民宿两晚", 168000, "2026-09-12"], ["返程打车", 9600, "2026-09-14"]]],
    ["demo-dinner", "朋友聚餐", ["Zed", "小林", "安安"], [["周五火锅", 42600, "2026-09-18"]]],
  ]) {
    state.ledgers[id] = { ownerUid: "demo-zed", memberUids: ["demo-zed"], title, currency: "CNY", createdAt, lastApprovedInviteId: null };
    state.members[id] = {}; state.expenses[id] = {}; state.payments[id] = {};
    names.forEach((name, index) => { state.members[id][`m${index}`] = { name, uid: index ? null : "demo-zed", createdAt, claimInviteId: null }; });
    rows.forEach(([name, amount, date], index) => {
      state.expenses[id][`e${index}`] = expenseData({ title: name, date, amountCents: amount, payerMemberId: "m0", shares: splitShares(amount, Object.keys(state.members[id])) }, state.members[id], "demo-zed", createdAt);
    });
    if (id === "demo-roommates") {
      state.expenses[id].e1.payerMemberId = "m1";
      state.expenses[id].e0.repaid.m1 = 4000;
      state.expenses[id].e0.lastPaymentId = "p0";
      state.payments[id].p0 = {
        expenseId: "e0", fromMemberId: "m1", toMemberId: "m0", amountCents: 4000, date: "2026-09-16",
        note: "演示记录：已核对部分还款", type: "payment", reversesId: null, reversedBy: null,
        createdByUid: "demo-zed", createdAt: "2026-09-16T12:00:00.000Z",
      };
    }
  }
  return state;
}

// The demo is explicitly selected; cloud mode never seeds or copies these records.
export function createStore({ mode, firebase = globalThis.firebase, storage = globalThis.localStorage, user } = {}) {
  if (mode !== "demo" && mode !== "cloud") throw new Error("请明确选择 demo 或 cloud 模式。");
  const demoUser = user || { uid: "demo-zed", displayName: "Zed" };
  const store = { mode, get currentUser() { return mode === "demo" ? demoUser : firebase?.auth().currentUser; } };
  const me = () => requireUser(store.currentUser);
  if (mode === "demo") {
    if (!storage) throw new Error("浏览器不支持本地演示存储。");
    if (!storage.getItem(DEMO_KEY)) storage.setItem(DEMO_KEY, JSON.stringify(seed()));
    const read = () => { const state = JSON.parse(storage.getItem(DEMO_KEY)); state.templates ||= {}; state.occurrences ||= {}; return state; };
    const mutate = fn => {
      const state = read();
      const result = fn(state, me(), new Date().toISOString());
      storage.setItem(DEMO_KEY, JSON.stringify(state));
      return result;
    };
    Object.assign(store,createStateStore({read,mutate,user:demoUser}));
    return store;
  }

  if (!firebase?.firestore || !firebase?.auth) throw new Error("Firebase 尚未配置，请使用演示模式或配置真实服务。");
  const db = firebase.firestore();
  const stamp = () => firebase.firestore.FieldValue.serverTimestamp();
  const ledgerRef = id => db.collection("ledgers").doc(id);
  const nested = (id, collection, docId) => ledgerRef(id).collection(collection).doc(docId);
  const inviteRef = token => db.collection("invites").doc(token);
  const data = snapshot => {
    if (!snapshot.exists) throw new Error("记录不存在或已不可访问。");
    return snapshot.data();
  };
  const getRows = async query => (await query.get()).docs.map(doc => withId(doc.id, doc.data()));
  Object.assign(store, {
    async listLedgers() { return getRows(db.collection("ledgers").where("memberUids", "array-contains", me().uid)); },
    async loadLedger(id) {
      const user = me(), ledger = data(await ledgerRef(id).get()); readable(ledger, user);
      const [members, expenses, payments, templates, occurrences, expenseDetails, templateDetails, expenseReceipts] = await Promise.all(["members", "expenses", "payments", "templates", "occurrences", "expenseDetails", "templateDetails", "expenseReceipts"].map(name => getRows(ledgerRef(id).collection(name))));
      const invites = ledger.ownerUid === user.uid ? (await getRows(db.collection("invites").where("ownerUid", "==", user.uid))).filter(invite => invite.ledgerId === id) : [];
      const claims = (await Promise.all(invites.map(async invite => (await getRows(inviteRef(invite.id).collection("claims"))).map(claim => ({ ...claim, inviteToken: invite.id }))))).flat();
      return { ledger: withId(id, ledger), members, expenses: attachDetails(expenses, expenseDetails, expenseReceipts), payments, templates: attachDetails(templates, templateDetails), occurrences, invites, claims };
    },
    async createLedger(payload) {
      const user = me(), ref = ledgerRef(newId()), currency = text(payload.currency || "CNY", "币种", 3).toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error("币种应为三位代码，例如 CNY。");
      const batch = db.batch();
      batch.set(ref, { ownerUid: user.uid, memberUids: [user.uid], title: text(payload.title, "账本名称"), currency, createdAt: stamp(), lastApprovedInviteId: null });
      batch.set(ref.collection("members").doc("owner"), { name: text(payload.ownerName || user.displayName || "我", "成员名字"), uid: user.uid, createdAt: stamp(), claimInviteId: null });
      await batch.commit(); return ref.id;
    },
    async addMember(id, name) {
      const user = me(); owner(data(await ledgerRef(id).get()), user); const ref = nested(id, "members", newId());
      await ref.set({ name: text(name, "成员名字"), uid: null, createdAt: stamp(), claimInviteId: null }); return ref.id;
    },
    async addExpense(id, payload) {
      const user = me(), ref = nested(id, "expenses", newId());
      await db.runTransaction(async tx => {
        const ledger = data(await tx.get(ledgerRef(id))); readable(ledger, user);
        const memberIds = [...new Set([payload.payerMemberId, ...Object.keys(payload.shares || {})])];
        const members = {};
        for (const memberId of memberIds) members[memberId] = data(await tx.get(nested(id, "members", memberId)));
        const record = expenseData(payload, members, user.uid, stamp());
        if (ledger.ownerUid !== user.uid && members[record.payerMemberId].uid !== user.uid) throw new Error("只能记录由自己垫付的费用。");
        requireSource(payload);
        let occurrenceRef;
        if (record.sourceTemplateId) {
          const template = data(await tx.get(nested(id, "templates", record.sourceTemplateId)));
          requireOccurrence(ledger, template, record.sourceDate, user, record);
          occurrenceRef = nested(id, "occurrences", occurrenceId(record.sourceTemplateId, record.sourceDate));
          if ((await tx.get(occurrenceRef)).exists) throw new Error("这期账单已经处理，请刷新账本。");
        }
        const { base, details, receipts } = splitDetails(record);
        tx.set(ref, base); tx.set(nested(id, "expenseDetails", ref.id), details);
        tx.set(nested(id, "expenseReceipts", ref.id), receipts);
        if (occurrenceRef) tx.set(occurrenceRef, occurrenceData(record.sourceTemplateId, record.sourceDate, "posted", ref.id, user, stamp()));
      }); return ref.id;
    },
    async saveTemplate(id, payload, templateId) {
      const user = me(), ref = nested(id, "templates", templateId || newId());
      await db.runTransaction(async tx => {
        const ledger = data(await tx.get(ledgerRef(id))); readable(ledger, user);
        const previous = templateId ? data(await tx.get(ref)) : null;
        if (previous) templateAccess(ledger, previous, user);
        const members = {};
        for (const memberId of [...new Set([payload.payerMemberId, ...Object.keys(payload.shares || {})])]) members[memberId] = data(await tx.get(nested(id, "members", memberId)));
        const record = templateData(payload, members, user, stamp(), previous);
        if (ledger.ownerUid !== user.uid && members[record.payerMemberId].uid !== user.uid) throw new Error("只能记录由自己垫付的费用。");
        const { base, details } = splitDetails(record);
        tx.set(ref, base); tx.set(nested(id, "templateDetails", ref.id), details);
      }); return ref.id;
    },
    async setTemplateStatus(id, templateId, status) {
      if (!["active", "paused", "archived"].includes(status)) throw new Error("模板状态无效。");
      const user = me(), ref = nested(id, "templates", templateId);
      await db.runTransaction(async tx => {
        const ledger = data(await tx.get(ledgerRef(id))), template = data(await tx.get(ref)); templateAccess(ledger, template, user);
        tx.update(ref, { status, updatedAt: stamp() });
      });
    },
    async skipOccurrence(id, templateId, date) {
      const user = me(), ref = nested(id, "occurrences", occurrenceId(templateId, date));
      await db.runTransaction(async tx => {
        const ledger = data(await tx.get(ledgerRef(id))), template = data(await tx.get(nested(id, "templates", templateId)));
        requireOccurrence(ledger, template, date, user);
        if ((await tx.get(ref)).exists) throw new Error("这期账单已经处理，请刷新账本。");
        tx.set(ref, occurrenceData(templateId, date, "skipped", null, user, stamp()));
      }); return ref.id;
    },
    async recordPayment(id, payload) {
      const user = me(), ref = nested(id, "payments", newId()), expenseRef = nested(id, "expenses", payload.expenseId);
      await db.runTransaction(async tx => {
        const ledger = data(await tx.get(ledgerRef(id))), expense = data(await tx.get(expenseRef));
        const payer = data(await tx.get(nested(id, "members", expense.payerMemberId))); receiver(ledger, expense, payer, user);
        const record = paymentData(payload.expenseId, expense, payload, user.uid, stamp());
        tx.set(ref, record); tx.update(expenseRef, { repaid: { ...expense.repaid, [record.fromMemberId]: expense.repaid[record.fromMemberId] + record.amountCents }, lastPaymentId: ref.id });
      }); return ref.id;
    },
    async reversePayment(id, paymentId) {
      const user = me(), originalRef = nested(id, "payments", paymentId), reversalRef = nested(id, "payments", newId());
      await db.runTransaction(async tx => {
        const ledger = data(await tx.get(ledgerRef(id))), payment = data(await tx.get(originalRef));
        if (payment.type !== "payment" || payment.reversedBy) throw new Error("这条还款记录不可再次撤销。");
        const expenseRef = nested(id, "expenses", payment.expenseId), expense = data(await tx.get(expenseRef));
        const payer = data(await tx.get(nested(id, "members", expense.payerMemberId))); receiver(ledger, expense, payer, user);
        tx.set(reversalRef, { ...payment, type: "reversal", reversesId: paymentId, reversedBy: null, date: today(), note: "撤销还款确认", createdByUid: user.uid, createdAt: stamp() });
        tx.update(originalRef, { reversedBy: reversalRef.id });
        tx.update(expenseRef, { repaid: { ...expense.repaid, [payment.fromMemberId]: expense.repaid[payment.fromMemberId] - payment.amountCents }, lastPaymentId: reversalRef.id });
      }); return reversalRef.id;
    },
    async reverseExpense(id, expenseId) {
      const user = me(), ref = nested(id, "expenses", expenseId);
      await db.runTransaction(async tx => {
        const ledger = data(await tx.get(ledgerRef(id))), expense = data(await tx.get(ref));
        const payer = data(await tx.get(nested(id, "members", expense.payerMemberId))); receiver(ledger, expense, payer, user);
        if (Object.values(expense.repaid).some(value => value !== 0)) throw new Error("请先撤销关联的还款确认，再撤销费用。");
        tx.update(ref, { status: "reversed", reversedAt: stamp() });
      });
    },
    async createInvite(id, memberId) {
      const user = me(), ref = inviteRef(newId());
      await db.runTransaction(async tx => {
        const ledger = data(await tx.get(ledgerRef(id))); owner(ledger, user);
        const member = data(await tx.get(nested(id, "members", memberId)));
        if (member.uid !== null) throw new Error("只能邀请尚未绑定账号的临时成员。");
        tx.set(ref, { ledgerId: id, ownerUid: user.uid, memberId, memberName: member.name, ledgerTitle: ledger.title,
          status: "open", acceptedUid: null, createdAt: stamp(), expiresAt: firebase.firestore.Timestamp.fromDate(new Date(Date.now() + 7 * 86400000)) });
      }); return ref.id;
    },
    async getInvite(token) { const user = me(), invite = data(await inviteRef(token).get()); readableInvite(invite, user); return withId(token, invite); },
    async claimInvite(token, { displayName } = {}) {
      const user = me(), ref = inviteRef(token).collection("claims").doc(user.uid);
      return db.runTransaction(async tx => {
        const invite = data(await tx.get(inviteRef(token))); requireInvite(invite);
        const existing = await tx.get(ref);
        if (existing.exists) return withId(user.uid, existing.data());
        const claim = { uid: user.uid, displayName: text(displayName || user.displayName || "申请人", "名字"), status: "pending", createdAt: stamp() };
        tx.set(ref, claim); return { ...claim, id: user.uid };
      });
    },
    async approveClaim(token, claimantUid) {
      const user = me(), ref = inviteRef(token), claimRef = ref.collection("claims").doc(claimantUid);
      await db.runTransaction(async tx => {
        const invite = data(await tx.get(ref)), ledgerDocument = ledgerRef(invite.ledgerId), memberRef = nested(invite.ledgerId, "members", invite.memberId);
        const ledger = data(await tx.get(ledgerDocument)), member = data(await tx.get(memberRef)), claim = data(await tx.get(claimRef));
        approval(ledger, member, invite, claim, claimantUid, user);
        tx.update(ledgerDocument, { memberUids: [...ledger.memberUids, claimantUid], lastApprovedInviteId: token });
        tx.update(memberRef, { uid: claimantUid, claimInviteId: token });
        tx.update(ref, { status: "accepted", acceptedUid: claimantUid }); tx.update(claimRef, { status: "approved" });
      });
    },
  });
  return store;
}
