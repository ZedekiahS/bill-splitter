import { assertCents, remainingFor, splitShares, validateDate } from "./ledger-core.mjs";

const DEMO_KEY = "bill-splitter-ledger-demo-v1";
const today = () => new Date().toISOString().slice(0, 10);
const withId = (id, value) => ({ ...value, id });
function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function text(value, label, max = 120) {
  const result = String(value || "").trim();
  if (!result || result.length > max) throw new Error(`${label}不能为空，且不能超过 ${max} 个字。`);
  return result;
}
function expiryMillis(value) { return value?.toMillis ? value.toMillis() : new Date(value).getTime(); }
function requireUser(user) {
  if (!user?.uid || user.isAnonymous) throw new Error("请先使用真实账号登录，再进行此操作。");
  return user;
}
function readable(ledger, user) {
  if (!ledger || !ledger.memberUids.includes(user.uid)) throw new Error("你还不是该账本成员。认领申请须由管理员批准。");
}
function owner(ledger, user) {
  readable(ledger, user);
  if (ledger.ownerUid !== user.uid) throw new Error("只有账本管理员可以进行此操作。");
}
function receiver(ledger, expense, payer, user) {
  readable(ledger, user);
  if (ledger.ownerUid !== user.uid && payer?.uid !== user.uid) throw new Error("只有收款人或账本管理员可以确认或撤销记录。");
  if (expense.status !== "active") throw new Error("这笔费用已撤销。");
}
function expenseData(payload, members, uid, createdAt) {
  const amountCents = assertCents(payload.amountCents);
  const payerMemberId = payload.payerMemberId;
  const shares = { ...payload.shares };
  if (!Object.hasOwn(members, payerMemberId)) throw new Error("请选择账本中的付款人。");
  const entries = Object.entries(shares);
  if (entries.length > 8) throw new Error("每笔费用最多选择 8 位分摊成员；账本成员数量不受此限制。");
  if (!entries.length || entries.some(([id]) => !Object.hasOwn(members, id))) throw new Error("请选择账本中的参与成员。");
  const total = entries.reduce((sum, [, cents]) => sum + BigInt(assertCents(cents, true)), 0n);
  if (total > BigInt(amountCents)) throw new Error("分摊金额不能超过总额。");
  return {
    title: text(payload.title, "费用名称"), date: validateDate(payload.date), amountCents, payerMemberId, shares,
    repaid: Object.fromEntries(entries.map(([id]) => [id, 0])), status: "active", createdByUid: uid,
    createdAt, lastPaymentId: null, reversedAt: null,
  };
}
function paymentData(expenseId, expense, payload, uid, createdAt) {
  const amountCents = assertCents(payload.amountCents);
  const fromMemberId = payload.fromMemberId;
  if (amountCents > remainingFor(expense, fromMemberId)) throw new Error("确认金额不能超过这位成员尚未偿还的金额。");
  return { expenseId, fromMemberId, toMemberId: expense.payerMemberId, amountCents,
    date: validateDate(payload.date || today()), note: String(payload.note || "").trim().slice(0, 300),
    type: "payment", reversesId: null, reversedBy: null, createdByUid: uid, createdAt };
}
function requireInvite(invite) {
  if (!invite || invite.status !== "open" || expiryMillis(invite.expiresAt) <= Date.now()) throw new Error("邀请已失效、过期或被认领。");
}
function readableInvite(invite, user) {
  if (invite?.status === "accepted") {
    if (invite.acceptedUid !== user.uid && invite.ownerUid !== user.uid) throw new Error("这份邀请已由其他账号认领。");
    return;
  }
  requireInvite(invite);
}
function approval(ledger, member, invite, claim, claimantUid, user) {
  owner(ledger, user); requireInvite(invite);
  if (!claim || claim.uid !== claimantUid || claim.status !== "pending") throw new Error("找不到待审核的认领申请。");
  if (!member || member.uid !== null || ledger.memberUids.includes(claimantUid)) throw new Error("成员已绑定账号，或申请人已经加入账本。");
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
    const read = () => JSON.parse(storage.getItem(DEMO_KEY));
    const mutate = fn => {
      const state = read();
      const result = fn(state, me(), new Date().toISOString());
      storage.setItem(DEMO_KEY, JSON.stringify(state));
      return result;
    };
    const rows = table => Object.entries(table || {}).map(([id, data]) => withId(id, data));
    Object.assign(store, {
      async listLedgers() { const uid = me().uid; return rows(read().ledgers).filter(ledger => ledger.memberUids.includes(uid)); },
      async loadLedger(id) {
        const state = read(), ledger = state.ledgers[id], user = me(); readable(ledger, user);
        const invites = ledger.ownerUid === user.uid ? rows(state.invites).filter(invite => invite.ledgerId === id) : [];
        return { ledger: withId(id, ledger), members: rows(state.members[id]), expenses: rows(state.expenses[id]), payments: rows(state.payments[id]), invites,
          claims: invites.flatMap(invite => rows(state.claims[invite.id]).map(claim => ({ ...claim, inviteToken: invite.id }))) };
      },
      async createLedger(payload) { return mutate((state, user, createdAt) => {
        const id = newId(), currency = text(payload.currency || "CNY", "币种", 3).toUpperCase();
        if (!/^[A-Z]{3}$/.test(currency)) throw new Error("币种应为三位代码，例如 CNY。");
        state.ledgers[id] = { ownerUid: user.uid, memberUids: [user.uid], title: text(payload.title, "账本名称"), currency, createdAt, lastApprovedInviteId: null };
        state.members[id] = { owner: { name: text(payload.ownerName || user.displayName || "我", "成员名字"), uid: user.uid, createdAt, claimInviteId: null } };
        state.expenses[id] = {}; state.payments[id] = {}; return id;
      }); },
      async addMember(id, name) { return mutate((state, user, createdAt) => {
        owner(state.ledgers[id], user); const memberId = newId();
        state.members[id][memberId] = { name: text(name, "成员名字"), uid: null, createdAt, claimInviteId: null }; return memberId;
      }); },
      async addExpense(id, payload) { return mutate((state, user, createdAt) => {
        const ledger = state.ledgers[id]; readable(ledger, user);
        const data = expenseData(payload, state.members[id], user.uid, createdAt);
        if (ledger.ownerUid !== user.uid && state.members[id][data.payerMemberId].uid !== user.uid) throw new Error("只能记录由自己垫付的费用。");
        const expenseId = newId(); state.expenses[id][expenseId] = data; return expenseId;
      }); },
      async recordPayment(id, payload) { return mutate((state, user, createdAt) => {
        const expense = state.expenses[id]?.[payload.expenseId]; if (!expense) throw new Error("费用不存在。");
        receiver(state.ledgers[id], expense, state.members[id][expense.payerMemberId], user);
        const data = paymentData(payload.expenseId, expense, payload, user.uid, createdAt), paymentId = newId();
        expense.repaid[data.fromMemberId] += data.amountCents; expense.lastPaymentId = paymentId;
        state.payments[id][paymentId] = data; return paymentId;
      }); },
      async reversePayment(id, paymentId) { return mutate((state, user, createdAt) => {
        const payment = state.payments[id]?.[paymentId];
        if (!payment || payment.type !== "payment" || payment.reversedBy) throw new Error("这条还款记录不可再次撤销。");
        const expense = state.expenses[id][payment.expenseId]; receiver(state.ledgers[id], expense, state.members[id][expense.payerMemberId], user);
        const reversalId = newId();
        state.payments[id][reversalId] = { ...payment, type: "reversal", reversesId: paymentId, reversedBy: null, date: today(), note: "撤销还款确认", createdByUid: user.uid, createdAt };
        payment.reversedBy = reversalId; expense.repaid[payment.fromMemberId] -= payment.amountCents; expense.lastPaymentId = reversalId;
        return reversalId;
      }); },
      async reverseExpense(id, expenseId) { return mutate((state, user, timestamp) => {
        const expense = state.expenses[id]?.[expenseId]; if (!expense) throw new Error("费用不存在。");
        receiver(state.ledgers[id], expense, state.members[id][expense.payerMemberId], user);
        if (Object.values(expense.repaid).some(value => value !== 0)) throw new Error("请先撤销关联的还款确认，再撤销费用。");
        expense.status = "reversed"; expense.reversedAt = timestamp;
      }); },
      async createInvite(id, memberId) { return mutate((state, user, createdAt) => {
        const ledger = state.ledgers[id]; owner(ledger, user); const member = state.members[id]?.[memberId];
        if (!member || member.uid !== null) throw new Error("只能邀请尚未绑定账号的临时成员。");
        const token = newId(); state.invites[token] = { ledgerId: id, ownerUid: user.uid, memberId, memberName: member.name, ledgerTitle: ledger.title,
          status: "open", acceptedUid: null, createdAt, expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() }; state.claims[token] = {}; return token;
      }); },
      async getInvite(token) { const user = me(), invite = read().invites[token]; readableInvite(invite, user); return withId(token, invite); },
      async claimInvite(token, { displayName } = {}) { return mutate((state, user, createdAt) => {
        const invite = state.invites[token]; requireInvite(invite);
        if (state.ledgers[invite.ledgerId].memberUids.includes(user.uid)) throw new Error("你已经是该账本成员。");
        if (!state.claims[token][user.uid]) state.claims[token][user.uid] = { uid: user.uid, displayName: text(displayName || user.displayName || "申请人", "名字"), status: "pending", createdAt };
        return withId(user.uid, state.claims[token][user.uid]);
      }); },
      async approveClaim(token, claimantUid) { return mutate((state, user) => {
        const invite = state.invites[token]; requireInvite(invite);
        const ledger = state.ledgers[invite.ledgerId], member = state.members[invite.ledgerId][invite.memberId], claim = state.claims[token]?.[claimantUid];
        approval(ledger, member, invite, claim, claimantUid, user);
        ledger.memberUids.push(claimantUid); ledger.lastApprovedInviteId = token;
        member.uid = claimantUid; member.claimInviteId = token; invite.status = "accepted"; invite.acceptedUid = claimantUid; claim.status = "approved";
      }); },
    });
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
      const [members, expenses, payments] = await Promise.all(["members", "expenses", "payments"].map(name => getRows(ledgerRef(id).collection(name))));
      const invites = ledger.ownerUid === user.uid ? (await getRows(db.collection("invites").where("ownerUid", "==", user.uid))).filter(invite => invite.ledgerId === id) : [];
      const claims = (await Promise.all(invites.map(async invite => (await getRows(inviteRef(invite.id).collection("claims"))).map(claim => ({ ...claim, inviteToken: invite.id }))))).flat();
      return { ledger: withId(id, ledger), members, expenses, payments, invites, claims };
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
        tx.set(ref, record);
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
