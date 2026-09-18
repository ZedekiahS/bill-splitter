/**
 * @fileoverview
 * Provides the JavaScript interactions for all pages.
 *
 * @author 
 * Zed
 */
/**
 * Bill Splitter - Auth, Home, Create, History, Detail, Unpaid
 */

/** namespace. */
var rhit = rhit || {};

rhit.FB_COLLECTION_USERS = "users";
rhit.FB_COLLECTION_BILLS = "bills";

/** globals */
rhit.fbAuthManager = null;
rhit.fbUsersManager = null;
rhit.fbBillsManagerMine = null;
rhit.fbBillsManagerIOwe = null;
rhit.fbSingleBillManager = null;

rhit.FbAuthManager = class {
  constructor() { this._user = null; }
  beginListening(changeListener) {
    firebase.auth().onAuthStateChanged(async (user) => {
      this._user = user || null;
      if (user) await rhit.ensureUserDoc(user);
      changeListener();
    });
  }
  signIn() {
    Rosefire.signIn("ab7bc0f0-ca17-4aac-851c-5581aa3e3555", (err, rfUser) => {
      if (err) { console.log("Rosefire error!", err); return; }
      firebase.auth().signInWithCustomToken(rfUser.token)
        .catch(e => console.log("signInWithCustomToken", e.message));
    });
  }
  signOut() { firebase.auth().signOut(); }
  get uid() { return this._user ? this._user.uid : ""; }
  get isSignedIn() { return !!this._user; }
  get displayName() {
    const u = this._user; if (!u) return "";
    return u.displayName || u.email || u.phoneNumber || (u.isAnonymous ? "Guest" : "User");
  }
};

rhit.ensureUserDoc = async function (user) {
  try {
    await firebase.firestore().collection(rhit.FB_COLLECTION_USERS).doc(user.uid)
      .set({
        uid: user.uid,
        email: user.email || null,
        displayName: user.displayName || null,
        phoneNumber: user.phoneNumber || null,
        photoURL: user.photoURL || null,
        lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
  } catch (e) { console.log("ensureUserDoc error", e); }
};

rhit.FbUsersManager = class {
  constructor() {
    this._documentSnapshots = [];
    this._ref = firebase.firestore().collection(rhit.FB_COLLECTION_USERS);
    this._unsubscribe = null;
  }
  beginListening(changeListener) {
    this._unsubscribe = this._ref.orderBy("displayName").limit(500).onSnapshot(qs => {
      this._documentSnapshots = qs.docs;
      changeListener();
    });
  }
  stopListening() { if (this._unsubscribe) this._unsubscribe(); }
  get length() { return this._documentSnapshots.length; }
  getUserAtIndex(i) {
    const d = this._documentSnapshots[i];
    return {
      uid: d.id,
      displayName: d.get("displayName") || d.get("email") || d.get("phoneNumber") || "User",
      email: d.get("email") || "",
      phoneNumber: d.get("phoneNumber") || "",
    };
  }
  getDisplay(uid) {
    const d = this._documentSnapshots.find(x => x.id === uid);
    if (!d) return "User";
    return d.get("displayName") || d.get("email") || d.get("phoneNumber") || "User";
  }
  getContact(uid) {
    const d = this._documentSnapshots.find(x => x.id === uid);
    return d ? { email: d.get("email") || "", phoneNumber: d.get("phoneNumber") || "" } : { email: "", phoneNumber: "" };
  }
};

rhit.FbBillsManager = class {
  constructor(filterType, uid) {
    this._filterType = filterType; 
    this._uid = uid;
    this._documentSnapshots = [];
    this._ref = firebase.firestore().collection(rhit.FB_COLLECTION_BILLS);
    this._unsubscribe = null;
  }
  beginListening(changeListener) {
    let query;
    if (this._filterType === "paidByMe") {
      query = this._ref.where("payerUid", "==", this._uid).orderBy("createdAt", "desc");
    } else {
      query = this._ref.where("debtors", "array-contains", this._uid).orderBy("createdAt", "desc");
    }
    this._unsubscribe = query.onSnapshot(qs => {
      this._documentSnapshots = qs.docs;
      changeListener();
    });
  }
  stopListening() { if (this._unsubscribe) this._unsubscribe(); }
  get length() { return this._documentSnapshots.length; }
  getBillAtIndex(i) {
    const d = this._documentSnapshots[i]; const data = d.data();
    return {
      id: d.id,
      title: data.title,
      amountCents: data.amountCents,
      date: data.date?.toDate ? data.date.toDate() : new Date(),
      payerUid: data.payerUid,
      debtors: data.debtors || [],
      splitType: data.splitType,
      shares: data.shares || {},
      paid: data.paid || {}, 
    };
  }
};

rhit.FbSingleBillManager = class {
  constructor(billId) {
    this._ref = firebase.firestore().collection(rhit.FB_COLLECTION_BILLS).doc(billId);
    this._documentSnapshot = null; this._unsubscribe = null;
  }
  beginListening(changeListener) {
    this._unsubscribe = this._ref.onSnapshot(doc => {
      if (doc.exists) { this._documentSnapshot = doc; changeListener(); }
      else { window.location.href = "/history.html"; }
    });
  }
  stopListening() { if (this._unsubscribe) this._unsubscribe(); }

  get id() { return this._documentSnapshot.id; }
  get title() { return this._documentSnapshot.get("title"); }
  get amountCents() { return this._documentSnapshot.get("amountCents"); }
  get date() { const t = this._documentSnapshot.get("date"); return t?.toDate ? t.toDate() : new Date(); }
  get payerUid() { return this._documentSnapshot.get("payerUid"); }
  get debtors() { return this._documentSnapshot.get("debtors") || []; }
  get splitType() { return this._documentSnapshot.get("splitType"); }
  get shares() { return this._documentSnapshot.get("shares") || {}; }
  get paid() { return this._documentSnapshot.get("paid") || {}; }

  async updateBill(payload) {
    await this._ref.update({ ...payload, lastUpdated: firebase.firestore.FieldValue.serverTimestamp() });
  }
};

rhit.LoginPageController = class {
  constructor() {
    const roseBtn = document.querySelector("#rosefireButton");
    if (roseBtn) roseBtn.addEventListener("click", () => rhit.fbAuthManager.signIn());

    const loginBtn = document.querySelector("#loginButton");
    const showLoginError = message => {
      const error = document.querySelector("#login-error");
      if (error) { error.textContent = message; error.hidden = false; }
      else alert(message);
    };
    const emailLogin = async event => {
      event.preventDefault();
      const email = (document.querySelector("#inputEmail")?.value || "").trim();
      const pw = document.querySelector("#inputPassword")?.value || "";
      if (!email || !pw) { showLoginError("请填写邮箱与密码。"); return; }
      loginBtn.disabled = true; loginBtn.textContent = "正在登录…";
      try { await firebase.auth().signInWithEmailAndPassword(email, pw); }
      catch (err) { showLoginError(err.message); }
      finally { loginBtn.disabled = false; loginBtn.textContent = "登录并继续"; }
    };
    const loginForm = document.querySelector("#emailLoginForm");
    if (loginForm) loginForm.addEventListener("submit", emailLogin);
    else if (loginBtn) loginBtn.addEventListener("click", emailLogin);

    const signupBtn = document.querySelector("#signupButton");
    if (signupBtn) signupBtn.addEventListener("click", () => {
      const email = (document.querySelector("#inputEmail")?.value || "").trim();
      const pw = document.querySelector("#inputPassword")?.value || "";
      if (!email || !pw) { showLoginError("请填写邮箱与密码，再注册账号。"); return; }
      firebase.auth().createUserWithEmailAndPassword(email, pw).catch(err => showLoginError(err.message));
    });
  }
};

rhit.HomePageController = class {
  constructor() {
    const helloEl = document.querySelector("#helloUser");
    if (helloEl) helloEl.innerHTML = `Hello ${rhit.fbAuthManager.displayName}`;

    const btnCreate = document.querySelector("#btnCreateBill");
    if (btnCreate) btnCreate.addEventListener("click", () => window.location.href = "/create.html");
    const btnHistory = document.querySelector("#btnHistory");
    if (btnHistory) btnHistory.addEventListener("click", () => window.location.href = "/history.html");
    const btnUnpaid = document.querySelector("#btnUnpaid");
    if (btnUnpaid) btnUnpaid.addEventListener("click", () => window.location.href = "/unpaid.html");

    const signOutBtn = document.querySelector("#menuSignOut"); 
    if (signOutBtn) signOutBtn.addEventListener("click", () => rhit.fbAuthManager.signOut());
  }
};

rhit.CreatePageController = class {
  constructor() {
    const signOutBtn = document.querySelector("#menuSignOut");
    if (signOutBtn) signOutBtn.addEventListener("click", () => rhit.fbAuthManager.signOut());

    const payerInput = document.querySelector("#inputPayer");
    if (payerInput) payerInput.value = rhit.fbAuthManager.displayName || "Me";

    rhit.fbUsersManager = new rhit.FbUsersManager();
    rhit.fbUsersManager.beginListening(this.updateDebtorSelect.bind(this));

    const splitSel = document.querySelector("#selectSplitType");
    if (splitSel) splitSel.addEventListener("change", () => this.refreshPercentRows());
    const debtorSel = document.querySelector("#selectDebtors");
    if (debtorSel) debtorSel.addEventListener("change", () => this.refreshPercentRows());

    const cancelBtn = document.querySelector("#btnCancel");
    if (cancelBtn) cancelBtn.addEventListener("click", () => window.location.href = "/home.html");
    const saveBtn = document.querySelector("#btnSave");
    if (saveBtn) saveBtn.addEventListener("click", () => this.handleSave());
  }
  updateDebtorSelect() {
    const select = document.querySelector("#selectDebtors"); if (!select) return;
    const selected = new Set(Array.from(select.selectedOptions, option => option.value));
    select.innerHTML = "";
    for (let i = 0; i < rhit.fbUsersManager.length; i++) {
      const u = rhit.fbUsersManager.getUserAtIndex(i);
      if (u.uid === rhit.fbAuthManager.uid) continue;
      const opt = document.createElement("option");
      opt.value = u.uid; opt.textContent = `${u.displayName}${u.email ? ` (${u.email})` : ""}`;
      opt.selected = selected.has(u.uid);
      select.appendChild(opt);
    }
    this.refreshPercentRows();
  }
  refreshPercentRows() {
    const splitType = document.querySelector("#selectSplitType")?.value;
    const select = document.querySelector("#selectDebtors");
    const wrapper = document.querySelector("#percentList");
    const rows = document.querySelector("#percentRows");
    if (!select || !wrapper || !rows) return;
    const previous = this._percentDraft || (this._percentDraft = new Map());
    document.querySelectorAll(".percent-input").forEach(e => previous.set(e.dataset.uid, e.value));
    const chosen = Array.from(select.selectedOptions).map(o => ({ uid: o.value, label: o.textContent }));
    if (splitType !== "percent" || chosen.length === 0) { wrapper.style.display = "none"; rows.innerHTML = ""; return; }
    wrapper.style.display = "block"; rows.innerHTML = "";
    chosen.forEach(c => {
      const div = document.createElement("div"); div.className = "form-group";
      div.innerHTML = `<label class="bmd-label-floating">${c.label}</label>
        <input type="number" min="0" max="100" step="0.01" class="form-control percent-input" data-uid="${c.uid}" placeholder="0">`;
      div.querySelector("input").value = previous.get(c.uid) ?? "";
      rows.appendChild(div);
    });
  }
  async handleSave() {
    try {
      const title = (document.querySelector("#inputTitle")?.value || "").trim();
      const dateStr = document.querySelector("#inputDate")?.value;
      const amountStr = document.querySelector("#inputAmount")?.value;
      const splitType = document.querySelector("#selectSplitType")?.value;
      const debtorUids = Array.from(document.querySelector("#selectDebtors")?.selectedOptions || []).map(o => o.value);

      if (!title) return alert("Please input a title.");
      const date = rhit._parseInputDate(dateStr);
      if (!date) return alert("Please choose a valid date.");
      const cents = rhit._parseAmountToCents(amountStr);
      if (cents <= 0) return alert("Enter a positive amount with at most 2 decimal places, within the supported range.");
      if (debtorUids.length === 0) return alert("Please select at least one debtor.");

      const entries = Array.from(document.querySelectorAll(".percent-input"));
      const shares = rhit._splitAmount(cents, debtorUids, splitType, entries);

      const paid = {}; debtorUids.forEach(uid => paid[uid] = false);

      await firebase.firestore().collection(rhit.FB_COLLECTION_BILLS).add({
        title,
        date: firebase.firestore.Timestamp.fromDate(date),
        amountCents: cents,
        payerUid: rhit.fbAuthManager.uid,
        debtors: debtorUids,
        splitType,
        shares,
        paid,
        status: "open",
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      window.location.href = "/history.html";
    } catch (e) { alert("Save failed: " + e.message); }
  }
};

rhit.HistoryPageController = class {
  constructor() {
    const signOutBtn = document.querySelector("#menuSignOut");
    if (signOutBtn) signOutBtn.addEventListener("click", () => rhit.fbAuthManager.signOut());

    const navBtnCal = document.querySelector("#navBtnCalendar");
    if (navBtnCal) navBtnCal.addEventListener("click", () => {
      const panel = document.querySelector("#dateFilterPanel");
      if (panel) panel.style.display = (panel.style.display === "none" || panel.style.display === "") ? "block" : "none";
    });

    this._filterMode = "all"; // "all" | "paidByMe" | "iOwe"
    const btnMine = document.querySelector("#filterMinePaid");
    const btnIOwe = document.querySelector("#filterIOwe");
    if (btnMine) btnMine.addEventListener("click", () => { this._filterMode = "paidByMe"; this.updateList(); });
    if (btnIOwe) btnIOwe.addEventListener("click", () => { this._filterMode = "iOwe"; this.updateList(); });

    this._searchText = "";
    const searchInput = document.querySelector("#searchInput");
    if (searchInput) searchInput.addEventListener("input", (e) => { this._searchText = e.target.value.toLowerCase(); this.updateList(); });

    this._selectedDateKeys = new Set(); // key: 'YYYY-MM-DD'
    const btnAddDate = document.querySelector("#btnAddDate");
    const btnClearDates = document.querySelector("#btnClearDates");
    if (btnAddDate) btnAddDate.addEventListener("click", () => {
      const el = document.querySelector("#datePicker");
      if (!el || !el.value) return;
      this._selectedDateKeys.add(el.value);
      this._renderSelectedDateChips();
      this.updateList();
    });
    if (btnClearDates) btnClearDates.addEventListener("click", () => {
      this._selectedDateKeys.clear();
      this._renderSelectedDateChips();
      this.updateList();
    });

    rhit.fbUsersManager = new rhit.FbUsersManager(); rhit.fbUsersManager.beginListening(() => { /* for names */ });
    rhit.fbBillsManagerMine = new rhit.FbBillsManager("paidByMe", rhit.fbAuthManager.uid);
    rhit.fbBillsManagerIOwe = new rhit.FbBillsManager("iOwe", rhit.fbAuthManager.uid);
    const refresh = this.updateList.bind(this);
    rhit.fbBillsManagerMine.beginListening(refresh);
    rhit.fbBillsManagerIOwe.beginListening(refresh);

    const backBtn = document.querySelector("#btnBackHome");
    if (backBtn) backBtn.addEventListener("click", () => window.location.href = "/home.html");
  }

  _renderSelectedDateChips() {
    const host = document.querySelector("#selectedDates");
    if (!host) return;
    host.innerHTML = "";
    this._selectedDateKeys.forEach(key => {
      const chip = document.createElement("span");
      chip.className = "badge badge-pill badge-primary mr-2 mb-2";
      chip.textContent = key;
      chip.style.cursor = "pointer";
      chip.addEventListener("click", () => {
        this._selectedDateKeys.delete(key);
        this._renderSelectedDateChips();
        this.updateList();
      });
      host.appendChild(chip);
    });
  }

  _mergeBills() {
    const a = [];
    for (let i = 0; i < rhit.fbBillsManagerMine.length; i++) a.push(rhit.fbBillsManagerMine.getBillAtIndex(i));
    for (let i = 0; i < rhit.fbBillsManagerIOwe.length; i++) a.push(rhit.fbBillsManagerIOwe.getBillAtIndex(i));
    const map = new Map();
    a.forEach(b => map.set(b.id, b));
    return Array.from(map.values());
  }

  updateList() {
    let bills = this._mergeBills();

    if (this._filterMode === "paidByMe") bills = bills.filter(b => b.payerUid === rhit.fbAuthManager.uid);
    if (this._filterMode === "iOwe") bills = bills.filter(b => b.debtors.includes(rhit.fbAuthManager.uid));

    if (this._searchText) bills = bills.filter(b => (b.title || "").toLowerCase().includes(this._searchText));

    if (this._selectedDateKeys.size > 0) {
      bills = bills.filter(b => this._selectedDateKeys.has(rhit._toInputDate(b.date)));
    }

    bills.sort((x, y) => y.date - x.date);
    const groups = new Map(); 
    bills.forEach(b => {
      const k = rhit._toInputDate(b.date);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(b);
    });

    const container = document.createElement("div");
    container.id = "billListContainer";

    if (bills.length === 0) {
      const empty = document.createElement("div");
      empty.className = "text-muted";
      empty.innerText = "No bills found.";
      container.appendChild(empty);
    } else {
      groups.forEach((list, dayKey) => {
        const h = document.createElement("h5");
        h.className = "mt-3 mb-2";
        h.innerText = dayKey;
        container.appendChild(h);

        list.forEach(b => {
          const allPaid = b.debtors.every(uid => !!b.paid[uid]);
          const iAmPayer = (b.payerUid === rhit.fbAuthManager.uid);
          const total = rhit._fmtMoney(b.amountCents);
          const payerName = rhit.fbUsersManager.getDisplay(b.payerUid);

          const card = document.createElement("div");
          card.className = "card mb-2";
          card.innerHTML = `
            <div class="card-body">
              <div class="d-flex align-items-center">
                <input type="checkbox" class="mr-2" ${allPaid ? "checked" : ""} disabled>
                <div class="flex-grow-1">
                  <div class="h6 mb-1">${b.title || "Bill"}</div>
                  <div class="text-muted small">${total} • payer: ${payerName}</div>
                </div>
                ${(!allPaid && iAmPayer) ? `<button class="btn btn-sm btn-outline-primary btnRemindAll" data-id="${b.id}">Remind all</button>` : ""}
                <button class="btn btn-sm btn-outline-secondary ml-2 btnDetail" data-id="${b.id}">Detail</button>
              </div>
            </div>
          `;
          card.querySelector(".btnDetail").addEventListener("click", () => {
            window.location.href = `/detail.html?id=${b.id}`;
          });
          const btnAll = card.querySelector(".btnRemindAll");
          if (btnAll) btnAll.addEventListener("click", () => this._remindAll(b));

          container.appendChild(card);
        });
      });
    }

    const old = document.querySelector("#billListContainer");
    if (old) old.replaceWith(container); else document.querySelector("#historyPage").appendChild(container);
  }

  _remindAll(bill) {
    const unpaid = bill.debtors.filter(uid => !bill.paid[uid]);
    unpaid.forEach(uid => {
      const { email, phoneNumber } = rhit.fbUsersManager.getContact(uid);
      const title = bill.title || "Bill";
      const payer = rhit.fbUsersManager.getDisplay(bill.payerUid);
      const amount = rhit._fmtMoney(bill.shares[uid] || 0);
      const body = `Hi, this is a reminder for "${title}". You owe ${amount} to ${payer}.`;

      if (phoneNumber) {
        const sms = `sms:${encodeURIComponent(phoneNumber)}?&body=${encodeURIComponent(body)}`;
        window.open(sms, "_blank");
      } else if (email) {
        const mail = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent("Reminder: " + title)}&body=${encodeURIComponent(body)}`;
        window.open(mail, "_blank");
      }
    });

    $("#remindModalTitle").text("Reminder sent");
    $("#remindModalBody").text("Reminders opened in your email/SMS app.");
    $("#remindModal").modal("show");
  }
};

rhit.DetailPageController = class {
  constructor() {
    const q = new URLSearchParams(window.location.search);
    this._billId = q.get("id"); 
    if (!this._billId) { window.location.href = "/history.html"; return; }

    this._paidEditable = {};
    this._editMode = false;
    this._canEdit = false;

    const signOutBtn = document.querySelector("#menuSignOut");
    if (signOutBtn) signOutBtn.addEventListener("click", () => rhit.fbAuthManager.signOut());

    rhit.fbSingleBillManager = new rhit.FbSingleBillManager(this._billId);
    rhit.fbUsersManager = new rhit.FbUsersManager(); 
    rhit.fbUsersManager.beginListening(() => {});
    rhit.fbSingleBillManager.beginListening(this.updateView.bind(this));

    const backBtn = document.querySelector("#btnBack"); 
    if (backBtn) backBtn.addEventListener("click", () => window.history.back());
    const btnEdit = document.querySelector("#btnEdit"); 
    if (btnEdit) btnEdit.addEventListener("click", () => this.setEditable(true));
    const btnSave = document.querySelector("#btnSave"); 
    if (btnSave) btnSave.addEventListener("click", () => this.saveEdit());

    const splitSel = document.querySelector("#selectSplitType");
    if (splitSel) splitSel.addEventListener("change", () => this.refreshPercentRows());
    const debtSel = document.querySelector("#selectDebtors");
    if (debtSel) debtSel.addEventListener("change", () => this.refreshPercentRows());
  }

  updateView() {
    const b = rhit.fbSingleBillManager;

    document.querySelector("#navBillTitle").innerHTML = b.title || "Bill";
    document.querySelector("#billTitleHeading").innerHTML = b.title || "Bill";
    document.querySelector("#inputTitle").value = b.title || "";
    document.querySelector("#inputDate").value = rhit._toInputDate(b.date);
    document.querySelector("#inputPayer").value = rhit.fbUsersManager.getDisplay(b.payerUid);
    document.querySelector("#inputAmount").value = rhit._amountText(b.amountCents);
    document.querySelector("#selectSplitType").value = b.splitType || "equal";

    const sel = document.querySelector("#selectDebtors"); 
    if (sel) sel.innerHTML = "";
    for (let i = 0; i < rhit.fbUsersManager.length; i++) {
      const u = rhit.fbUsersManager.getUserAtIndex(i);
      if (u.uid === b.payerUid) continue;
      const opt = document.createElement("option");
      opt.value = u.uid; 
      opt.textContent = `${u.displayName}${u.email ? ` (${u.email})` : ""}`;
      if (b.debtors.includes(u.uid)) opt.selected = true;
      sel.appendChild(opt);
    }

    this._paidEditable = { ...(b.paid || {}) };

    this._canEdit = (rhit.fbAuthManager.uid === b.payerUid);
    const btnEdit = document.querySelector("#btnEdit");
    if (btnEdit) btnEdit.style.display = this._canEdit ? "inline-block" : "none";
    const btnSave = document.querySelector("#btnSave");
    if (btnSave) btnSave.style.display = "none";

    this.refreshPercentRows(b);

    this._renderDebtorStatusList();

    this.setEditable(false);
  }

  _renderDebtorStatusList() {
    const b = rhit.fbSingleBillManager;
    const list = document.createElement("div"); 
    list.id = "debtorStatusList";

    b.debtors.forEach(uid => {
      const paidNow = !!this._paidEditable[uid];
      const name = rhit.fbUsersManager.getDisplay(uid);
      const share = rhit._fmtMoney(b.shares[uid] || 0);
      const row = document.createElement("div");
      row.className = "d-flex align-items-center justify-content-between border rounded px-2 py-2 mb-2";

      const canToggle = this._canEdit && this._editMode;

      row.innerHTML = `
        <div class="mr-3"><strong>${name}</strong> • ${share}</div>
        <div class="d-flex align-items-center">
          <label class="mb-0 mr-2 small">Paid</label>
          <input type="checkbox" class="paid-toggle mr-3" data-uid="${uid}" ${paidNow ? "checked" : ""} ${canToggle ? "" : "disabled"}>
          ${paidNow ? "" : `<button class="btn btn-sm btn-outline-primary btnRemind" data-uid="${uid}">Remind</button>`}
        </div>
      `;

      list.appendChild(row);
    });

    const holder = document.querySelector("#debtorStatusList");
    if (holder) holder.replaceWith(list);

    document.querySelectorAll(".paid-toggle").forEach(cb => {
      cb.addEventListener("change", (e) => {
        const uid = e.target.dataset.uid;
        this._paidEditable[uid] = e.target.checked;
        this._renderDebtorStatusList();
      });
    });

    document.querySelectorAll(".btnRemind").forEach(btn => {
      btn.addEventListener("click", () => this.remind(btn.dataset.uid, rhit.fbSingleBillManager));
    });
  }

  setEditable(flag) {
    this._editMode = flag;
    ["inputTitle", "inputDate", "inputAmount", "selectSplitType", "selectDebtors"]
      .forEach(id => {
        const el = document.querySelector(`#${id}`);
        if (el) el.disabled = !flag;
      });

    const btnEdit = document.querySelector("#btnEdit");
    const btnSave = document.querySelector("#btnSave");
    if (btnEdit && this._canEdit) btnEdit.style.display = flag ? "none" : "inline-block";
    if (btnSave && this._canEdit) btnSave.style.display = flag ? "inline-block" : "none";

    this.refreshPercentRows();
    this._renderDebtorStatusList();
  }

  refreshPercentRows(existingBill = null) {
    const splitType = document.querySelector("#selectSplitType")?.value;
    const wrapper = document.querySelector("#percentList");
    const rows = document.querySelector("#percentRows");
    if (!wrapper || !rows) return;
    const previous = this._percentDraft || (this._percentDraft = new Map());
    document.querySelectorAll(".percent-input").forEach(e => previous.set(e.dataset.uid, e.value));
    if (!this._editMode) previous.clear();

    const sel = document.querySelector("#selectDebtors");
    const chosen = Array.from(sel.selectedOptions).map(o => o.value);

    if (!this._editMode || splitType !== "percent" || chosen.length === 0) {
      wrapper.style.display = "none"; rows.innerHTML = ""; return;
    }
    wrapper.style.display = "block"; rows.innerHTML = "";

    const bill = (existingBill || rhit.fbSingleBillManager);
    const shares = bill.shares || {};
    const total = bill.amountCents;

    chosen.forEach(uid => {
      const name = rhit.fbUsersManager.getDisplay(uid);
      let pct = "";
      if (total > 0 && shares[uid] >= 0) pct = rhit._sharePercent(shares[uid], total);
      const div = document.createElement("div"); 
      div.className = "form-group";
      div.innerHTML = `
        <label class="bmd-label-floating">${name}</label>
        <input type="number" min="0" max="100" step="0.01" class="form-control percent-input" data-uid="${uid}">
      `;
      div.querySelector("input").value = previous.get(uid) ?? pct;
      rows.appendChild(div);
    });
  }

  async saveEdit() {
    try {
      const title = (document.querySelector("#inputTitle").value || "").trim();
      const dateStr = document.querySelector("#inputDate").value;
      const amountCents = rhit._parseAmountToCents(document.querySelector("#inputAmount").value);
      const splitType = document.querySelector("#selectSplitType").value;
      const debtorUids = Array.from(document.querySelector("#selectDebtors").selectedOptions).map(o => o.value);

      if (!title) return alert("Title required.");
      const date = rhit._parseInputDate(dateStr);
      if (!date) return alert("Please choose a valid date.");
      if (amountCents <= 0) return alert("Enter a positive amount with at most 2 decimal places, within the supported range.");
      if (debtorUids.length === 0) return alert("Select at least one debtor.");

      const entries = Array.from(document.querySelectorAll(".percent-input"));
      const bill = rhit.fbSingleBillManager;
      // Displayed percentages are an approximation of stored cents. A title,
      // date or repayment edit must not recalculate those original amounts.
      const sameSplit = amountCents === bill.amountCents && splitType === bill.splitType
        && debtorUids.length === bill.debtors.length
        && new Set(debtorUids).size === debtorUids.length
        && debtorUids.every(uid => bill.debtors.includes(uid));
      const samePercents = splitType !== "percent" || (entries.length === debtorUids.length
        && new Set(entries.map(e => e.dataset.uid)).size === debtorUids.length
        && entries.every(e => debtorUids.includes(e.dataset.uid)
          && rhit._parseHundredths(e.value) !== null
          && rhit._parseHundredths(e.value) === rhit._parseHundredths(rhit._sharePercent(bill.shares[e.dataset.uid], amountCents))));
      const storedShares = debtorUids.map(uid => bill.shares[uid]);
      const validStoredShares = Object.keys(bill.shares).length === debtorUids.length
        && storedShares.every(n => Number.isSafeInteger(n) && n >= 0)
        && storedShares.reduce((sum, n) => sum + n, 0) <= amountCents;
      const shares = sameSplit && samePercents && validStoredShares
        ? { ...bill.shares }
        : rhit._splitAmount(amountCents, debtorUids, splitType, entries);

      const newPaid = {};
      debtorUids.forEach(uid => newPaid[uid] = !!this._paidEditable[uid]);

      await rhit.fbSingleBillManager.updateBill({
        title,
        date: firebase.firestore.Timestamp.fromDate(date),
        amountCents,
        splitType,
        debtors: debtorUids,
        shares,
        paid: newPaid,
      });

      this.setEditable(false);
    } catch (e) { alert("Save failed: " + e.message); }
  }

  remind(uid, bill) {
    const { email, phoneNumber } = rhit.fbUsersManager.getContact(uid);
    const title = bill.title || "Bill";
    const payer = rhit.fbUsersManager.getDisplay(bill.payerUid);
    const amount = rhit._fmtMoney(bill.shares[uid] || 0);
    const body = `Hi, this is a reminder for "${title}". You owe ${amount} to ${payer}.`;
    if (phoneNumber) {
      const sms = `sms:${encodeURIComponent(phoneNumber)}?&body=${encodeURIComponent(body)}`;
      window.open(sms, "_blank");
      $("#remindModalTitle").text("Reminder sent");
      $("#remindModalBody").text(`An SMS reminder was opened for ${phoneNumber}.`);
    } else if (email) {
      const mail = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent("Reminder: " + title)}&body=${encodeURIComponent(body)}`;
      window.open(mail, "_blank");
      $("#remindModalTitle").text("Reminder sent");
      $("#remindModalBody").text(`An email reminder was opened for ${email}.`);
    } else {
      $("#remindModalTitle").text("No contact");
      $("#remindModalBody").text("This user has no phone/email available.");
    }
    $("#remindModal").modal("show");
  }
};


rhit.UnpaidPageController = class {
  constructor() {
    const signOutBtn = document.querySelector("#menuSignOut");
    if (signOutBtn) signOutBtn.addEventListener("click", () => rhit.fbAuthManager.signOut());

    rhit.fbBillsManagerIOwe = new rhit.FbBillsManager("iOwe", rhit.fbAuthManager.uid);
    rhit.fbUsersManager = new rhit.FbUsersManager(); rhit.fbUsersManager.beginListening(() => { /* for names */ });
    rhit.fbBillsManagerIOwe.beginListening(this.updateList.bind(this));
  }

  updateList() {
    const me = rhit.fbAuthManager.uid;
    const list = [];

    for (let i = 0; i < rhit.fbBillsManagerIOwe.length; i++) {
      const b = rhit.fbBillsManagerIOwe.getBillAtIndex(i);
      if (b.debtors.includes(me) && !b.paid[me]) list.push(b);
    }

    list.sort((a, b) => b.date - a.date);

    const container = document.createElement("div");
    container.id = "unpaidListContainer";

    if (list.length === 0) {
      const empty = document.createElement("div");
      empty.className = "text-muted";
      empty.innerText = "All clear! You have no unpaid bills.";
      container.appendChild(empty);
    } else {
      list.forEach(b => {
        const share = rhit._fmtMoney(b.shares[me] || 0);
        const payerName = rhit.fbUsersManager.getDisplay(b.payerUid);
        const card = document.createElement("div");
        card.className = "card mb-2";
        card.innerHTML = `
          <div class="card-body d-flex justify-content-between align-items-center">
            <div>
              <div class="h6 mb-1">${b.title || "Bill"}</div>
              <div class="text-muted small">${share} • payer: ${payerName}</div>
            </div>
            <button class="btn btn-sm btn-outline-primary btnDetail" data-id="${b.id}">Detail</button>
          </div>`;
        card.querySelector(".btnDetail").addEventListener("click", () => {
          window.location.href = `/detail.html?id=${b.id}`;
        });
        container.appendChild(card);
      });
    }

    const old = document.querySelector("#unpaidListContainer");
    if (old) old.replaceWith(container); else document.querySelector("#unpaidPage").appendChild(container);
  }
};

rhit.checkForRedirects = function () {
  if (document.querySelector("#loginPage") && rhit.fbAuthManager.isSignedIn) {
    const next = new URLSearchParams(window.location.search || "").get("next") || "";
    window.location.href = /^\/app\.html(?:[?#]|$)/.test(next) ? next : "/app.html";
  }
  if (!document.querySelector("#loginPage") && !rhit.fbAuthManager.isSignedIn) {
    window.location.href = "/";
  }
};

rhit.initializePage = function () {
  if (document.querySelector("#loginPage")) new rhit.LoginPageController();
  if (document.querySelector("#homePage")) new rhit.HomePageController();
  if (document.querySelector("#createPage")) new rhit.CreatePageController();
  if (document.querySelector("#historyPage")) new rhit.HistoryPageController();
  if (document.querySelector("#detailPage")) new rhit.DetailPageController();
  if (document.querySelector("#unpaidPage")) new rhit.UnpaidPageController();
};

// Parse decimal text without floating-point multiplication or silent rounding.
rhit._parseHundredths = value => {
  const text = String(value ?? "").trim();
  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const units = BigInt(whole || "0") * 100n + BigInt(fraction.padEnd(2, "0"));
  return units <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(units) : null;
};
rhit._parseAmountToCents = s => rhit._parseHundredths(s) ?? 0;
rhit._sharePercent = (share, total) => ((share / total) * 100).toFixed(2);

rhit._splitAmount = (amountCents, debtorUids, splitType, entries) => {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error("Invalid amount.");
  if (debtorUids.length === 0 || new Set(debtorUids).size !== debtorUids.length) {
    throw new Error("Select distinct debtors.");
  }
  if (splitType === "equal") {
    const base = Math.floor(amountCents / debtorUids.length);
    const remainder = amountCents % debtorUids.length;
    return Object.fromEntries(debtorUids.map((uid, i) => [uid, base + (i < remainder ? 1 : 0)]));
  }
  if (splitType !== "percent") throw new Error("Choose a valid split type.");
  const percents = new Map(entries.map(e => [e.dataset.uid, rhit._parseHundredths(e.value)]));
  if (entries.length !== debtorUids.length || percents.size !== debtorUids.length
    || debtorUids.some(uid => !percents.has(uid) || percents.get(uid) === null || percents.get(uid) > 10000)) {
    throw new Error("Enter a percentage from 0 to 100 for each debtor, with at most 2 decimal places.");
  }
  const totalPercent = Array.from(percents.values()).reduce((sum, p) => sum + p, 0);
  if (totalPercent <= 0 || totalPercent > 10000) {
    throw new Error("Percentages must total more than 0 and at most 100. The payer covers the remainder.");
  }
  // Round the assigned total once, then distribute its remaining cents by
  // fractional remainder. Ties follow participant order, including equal splits.
  const parts = debtorUids.map((uid, index) => {
    const numerator = BigInt(amountCents) * BigInt(percents.get(uid));
    return { uid, index, cents: Number(numerator / 10000n), remainder: Number(numerator % 10000n) };
  });
  const target = Number((BigInt(amountCents) * BigInt(totalPercent) + 5000n) / 10000n);
  const extra = target - parts.reduce((sum, p) => sum + p.cents, 0);
  const ranked = [...parts].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; i < extra; i++) ranked[i].cents++;
  return Object.fromEntries(parts.map(p => [p.uid, p.cents]));
};

rhit._amountText = cents => {
  const amount = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, "0")}`;
};
rhit._fmtMoney = cents => `$${rhit._amountText(Number(cents || 0))}`;
// Bill dates are calendar dates stored at UTC midnight, including older bills.
rhit._toInputDate = d => d.toISOString().slice(0, 10);
rhit._parseInputDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "") || value.startsWith("0000-")) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && rhit._toInputDate(date) === value ? date : null;
};

rhit.main = function () {
  rhit.fbAuthManager = new rhit.FbAuthManager();
  rhit.fbAuthManager.beginListening(() => {
    rhit.checkForRedirects();
    rhit.initializePage();
  });
};
rhit.main();
