import { assertCents, remainingFor, splitShares, validateDate, consumptionShares } from "./ledger-core.mjs";
import { validateExpenseExtras, normalizeSchedule, isScheduledDate, occurrenceId } from "./expense-features.mjs";
import { expenseVersion, legacyHistory, ensureHistory, appendHistory } from './expense-history.mjs';

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const withId = (id, value) => ({ ...value, id });
function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function text(value, label, max = 120) {
  const result = typeof value === "string" ? value.trim() : "";
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
    ...validateExpenseExtras({ ...payload, amountCents, shares }),
    sourceTemplateId: payload.sourceTemplateId || null, sourceDate: payload.sourceDate || null,
  };
}

function templateAccess(ledger, template, user) {
  readable(ledger, user);
  if (!template || (ledger.ownerUid !== user.uid && template.createdByUid !== user.uid)) throw new Error("只有模板创建者或账本管理员可以管理此模板。");
}
function templateData(payload, members, user, timestamp, previous) {
  const schedule = normalizeSchedule(payload);
  const shares = consumptionShares(payload);
  const expense = expenseData({ ...payload, shares, date: today(), receipts: [], sourceTemplateId: null, sourceDate: null }, members, user.uid, timestamp);
  return { title: expense.title, amountCents: expense.amountCents, payerMemberId: expense.payerMemberId,
    shares: expense.shares, note: expense.note, items: expense.items, ...schedule,
    status: previous?.status || "active", createdByUid: previous?.createdByUid || user.uid,
    createdAt: previous?.createdAt || timestamp, updatedAt: timestamp };
}
function requireOccurrence(ledger, template, date, user, record) {
  templateAccess(ledger, template, user);
  validateDate(date);
  if (template.status !== "active" || date > today() || !isScheduledDate(template, date)) throw new Error("这期账单尚未到期或已暂停。");
  if (record && (record.payerMemberId !== template.payerMemberId || Object.keys(record.shares).some(id => !Object.hasOwn(template.shares, id)))) throw new Error("周期账单的垫付人与参与成员应与模板一致。");
}
function occurrenceData(templateId, date, status, expenseId, user, createdAt) {
  return { templateId, date, status, expenseId, createdByUid: user.uid, createdAt };
}
function requireSource(payload) {
  if (Boolean(payload.sourceTemplateId) !== Boolean(payload.sourceDate)) throw new Error("周期账单来源不完整。");
  if (payload.sourceTemplateId) occurrenceId(payload.sourceTemplateId, payload.sourceDate);
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


export { text, expenseData, templateData, requireOccurrence, occurrenceData, requireSource, paymentData, requireInvite, readableInvite, approval, readable, owner, receiver, templateAccess, newId, withId, requireUser };

export function createStateStore({read,mutate,user}) {
  const store={};
  const me=()=>requireUser(user);
    const rows = table => Object.entries(table || {}).map(([id, data]) => withId(id, data));
    Object.assign(store, {
      async listLedgers() { const uid = me().uid; return rows(read().ledgers).filter(ledger => ledger.memberUids.includes(uid)); },
      async loadLedger(id) {
        const state = read(), ledger = state.ledgers[id], user = me(); readable(ledger, user);
        const invites = ledger.ownerUid === user.uid ? rows(state.invites).filter(invite => invite.ledgerId === id) : [];
        return { ledger: withId(id, ledger), members: rows(state.members[id]), expenses: rows(state.expenses[id]).map(expense=>({...expense,version:expense.version||1,history:expense.history||legacyHistory(expense.id,expense,state.payments[id],state.members[id])})), payments: rows(state.payments[id]), templates: rows(state.templates[id]), occurrences: rows(state.occurrences[id]), invites,
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
        requireSource(payload);
        const expenseId = newId();
        if (data.sourceTemplateId) {
          requireOccurrence(ledger, state.templates[id]?.[data.sourceTemplateId], data.sourceDate, user, data);
          const key = occurrenceId(data.sourceTemplateId, data.sourceDate);
          state.occurrences[id] ||= {};
          if (state.occurrences[id][key]) throw new Error("这期账单已经处理，请刷新账本。");
          state.occurrences[id][key] = occurrenceData(data.sourceTemplateId, data.sourceDate, "posted", expenseId, user, createdAt);
        }
        data.receipts=data.receipts.map(file=>({...file,id:newId()}));data.version=1;
        state.expenses[id][expenseId] = data;ensureHistory(state,id,expenseId);return expenseId;
      }); },
      async updateExpense(id, expenseId, payload) { return mutate((state,user,timestamp)=>{
        const previous=state.expenses[id]?.[expenseId];if(!previous)throw new Error('费用不存在。');
        receiver(state.ledgers[id],previous,state.members[id][previous.payerMemberId],user);
        if(!Number.isSafeInteger(payload.expectedVersion)||payload.expectedVersion<1)throw new Error('请重新打开账单后再更正。');
        if(payload.expectedVersion!==(previous.version||1))throw Object.assign(new Error('账单已被其他成员更新。请保留输入，关闭后重新打开账单核对。'),{statusCode:409});
        const reason=text(payload.changeReason,'更正说明',300),files=payload.receipts??[];
        if(!Array.isArray(files)||files.length>3)throw new Error('每笔账单最多添加 3 份收据。');
        const retained=new Set();
        const receipts=files.map(file=>{
          if(file?.id){const old=(previous.receipts||[]).find(row=>row.id===file.id);if(!old||retained.has(file.id))throw new Error('收据不属于这笔账单或已重复选择。');retained.add(file.id);return structuredClone(old);}
          return {...validateExpenseExtras({receipts:[file]}).receipts[0],id:newId()};
        });
        const next=expenseData({...payload,receipts:[],sourceTemplateId:previous.sourceTemplateId,sourceDate:previous.sourceDate},state.members[id],previous.createdByUid,previous.createdAt);
        if(state.ledgers[id].ownerUid!==user.uid&&state.members[id][next.payerMemberId].uid!==user.uid)throw new Error('只能记录由自己垫付的费用。');
        next.receipts=receipts;
        const financial=record=>JSON.stringify([record.amountCents,record.payerMemberId,Object.entries(consumptionShares(record)).sort(([a],[b])=>a.localeCompare(b)),record.items||[]]);
        const financialChanged=financial(next)!==financial(previous);
        if(financialChanged&&Object.values(previous.repaid).some(value=>value!==0))throw new Error('已有收款记录。请先撤销相关收款，再更改金额、垫付人或分摊。');
        if(!financialChanged)next.shares=structuredClone(previous.shares);
        next.repaid=Object.fromEntries(Object.keys(next.shares).map(key=>[key,previous.repaid[key]||0]));
        const before=expenseVersion(previous),after=expenseVersion(next);
        if(JSON.stringify(before)===JSON.stringify(after))throw new Error('没有需要保存的更改。');
        ensureHistory(state,id,expenseId);
        Object.assign(previous,next,{lastPaymentId:previous.lastPaymentId,updatedAt:timestamp});
        appendHistory(state,id,expenseId,user,timestamp,{type:'updated',reason,before,after});return expenseId;
      }); },
      async saveTemplate(id, payload, templateId) { return mutate((state, user, timestamp) => {
        const ledger = state.ledgers[id]; readable(ledger, user);
        state.templates[id] ||= {};
        const previous = templateId ? state.templates[id][templateId] : null;
        if (templateId) templateAccess(ledger, previous, user);
        const record = templateData(payload, state.members[id], user, timestamp, previous);
        if (ledger.ownerUid !== user.uid && state.members[id][record.payerMemberId].uid !== user.uid) throw new Error("只能记录由自己垫付的费用。");
        const key = templateId || newId(); state.templates[id][key] = record; return key;
      }); },
      async setTemplateStatus(id, templateId, status) { return mutate((state, user, timestamp) => {
        const template = state.templates[id]?.[templateId]; templateAccess(state.ledgers[id], template, user);
        if (!["active", "paused", "archived"].includes(status)) throw new Error("模板状态无效。");
        template.status = status; template.updatedAt = timestamp;
      }); },
      async skipOccurrence(id, templateId, date) { return mutate((state, user, timestamp) => {
        requireOccurrence(state.ledgers[id], state.templates[id]?.[templateId], date, user);
        state.occurrences[id] ||= {}; const key = occurrenceId(templateId, date);
        if (state.occurrences[id][key]) throw new Error("这期账单已经处理，请刷新账本。");
        state.occurrences[id][key] = occurrenceData(templateId, date, "skipped", null, user, timestamp); return key;
      }); },
      async recordPayment(id, payload) { return mutate((state, user, createdAt) => {
        const expense = state.expenses[id]?.[payload.expenseId]; if (!expense) throw new Error("费用不存在。");
        receiver(state.ledgers[id], expense, state.members[id][expense.payerMemberId], user);
        const data = paymentData(payload.expenseId, expense, payload, user.uid, createdAt), paymentId = newId();
        ensureHistory(state,id,payload.expenseId);
        expense.repaid[data.fromMemberId] += data.amountCents; expense.lastPaymentId = paymentId;
        state.payments[id][paymentId] = data;
        appendHistory(state,id,payload.expenseId,user,createdAt,{type:'payment',paymentId,amountCents:data.amountCents,fromMemberId:data.fromMemberId,toMemberId:data.toMemberId,note:data.note});return paymentId;
      }); },
      async reversePayment(id, paymentId) { return mutate((state, user, createdAt) => {
        const payment = state.payments[id]?.[paymentId];
        if (!payment || payment.type !== "payment" || payment.reversedBy) throw new Error("这条还款记录不可再次撤销。");
        const expense = state.expenses[id][payment.expenseId]; receiver(state.ledgers[id], expense, state.members[id][expense.payerMemberId], user);
        const reversalId = newId();
        ensureHistory(state,id,payment.expenseId);
        state.payments[id][reversalId] = { ...payment, type: "reversal", reversesId: paymentId, reversedBy: null, date: today(), note: "撤销还款确认", createdByUid: user.uid, createdAt };
        payment.reversedBy = reversalId; expense.repaid[payment.fromMemberId] -= payment.amountCents; expense.lastPaymentId = reversalId;
        appendHistory(state,id,payment.expenseId,user,createdAt,{type:'payment-reversed',paymentId:reversalId,amountCents:payment.amountCents,fromMemberId:payment.fromMemberId,toMemberId:payment.toMemberId});
        return reversalId;
      }); },
      async reverseExpense(id, expenseId) { return mutate((state, user, timestamp) => {
        const expense = state.expenses[id]?.[expenseId]; if (!expense) throw new Error("费用不存在。");
        receiver(state.ledgers[id], expense, state.members[id][expense.payerMemberId], user);
        if (Object.values(expense.repaid).some(value => value !== 0)) throw new Error("请先撤销关联的还款确认，再撤销费用。");
        ensureHistory(state,id,expenseId);
        expense.status = "reversed"; expense.reversedAt = timestamp;
        appendHistory(state,id,expenseId,user,timestamp,{type:'reversed'});
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
