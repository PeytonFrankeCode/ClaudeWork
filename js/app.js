/* ============================================================
   Billable — client-side SaaS app
   Data persists in localStorage under the "billable:" namespace.
   ============================================================ */

const LS_USER = "billable:user";
const LS_DATA = "billable:data";

const CURRENCY_LOCALE = {
  USD: "en-US", EUR: "de-DE", GBP: "en-GB", CAD: "en-CA",
  AUD: "en-AU", JPY: "ja-JP", INR: "en-IN",
};

let user = null;
let data = null;          // { clients: [], invoices: [], settings: {}, seq: n }
let invFilter = "all";
let editingInvoiceId = null;
let editingClientId = null;

/* ---------------- Utilities ---------------- */

const $ = (id) => document.getElementById(id);

function money(amount, currency) {
  currency = currency || (data && data.settings.currency) || "USD";
  return new Intl.NumberFormat(CURRENCY_LOCALE[currency] || "en-US", {
    style: "currency", currency,
  }).format(amount);
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
}

function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function initials(name) {
  return name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
}

function save() {
  localStorage.setItem(LS_DATA, JSON.stringify(data));
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2600);
}

/* Effective status: a sent invoice past its due date is overdue. */
function statusOf(inv) {
  if (inv.status === "sent" && inv.due < todayISO()) return "overdue";
  return inv.status;
}

function invoiceTotal(inv) {
  const sub = inv.lines.reduce((s, l) => s + l.qty * l.rate, 0);
  const tax = sub * (inv.tax / 100);
  const disc = sub * (inv.discount / 100);
  return { sub, tax, disc, total: sub + tax - disc };
}

/* ---------------- Auth ---------------- */

let authMode = "login";

function setAuthMode(mode) {
  authMode = mode;
  const signup = mode === "signup";
  $("authTitle").textContent = signup ? "Create your workspace" : "Welcome back";
  $("authSub").textContent = signup ? "Free forever for 3 invoices a month" : "Log in to your workspace";
  $("nameField").style.display = signup ? "" : "none";
  $("bizField").style.display = signup ? "" : "none";
  $("authSubmit").textContent = signup ? "Create free account" : "Log in";
  $("authSwitch").innerHTML = signup
    ? 'Have an account? <a href="#" id="authToggle">Log in</a>'
    : 'No account? <a href="#" id="authToggle">Start free</a>';
  $("authError").textContent = "";
  bindAuthToggle();
}

function bindAuthToggle() {
  $("authToggle").addEventListener("click", (e) => {
    e.preventDefault();
    setAuthMode(authMode === "login" ? "signup" : "login");
  });
}

$("authForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const email = $("authEmail").value.trim().toLowerCase();
  const pass = $("authPass").value;
  const stored = JSON.parse(localStorage.getItem(LS_USER) || "null");

  if (authMode === "signup") {
    const name = $("authName").value.trim() || "You";
    const biz = $("authBiz").value.trim() || name + "'s Business";
    user = { name, biz, email, pass, plan: "starter" };
    localStorage.setItem(LS_USER, JSON.stringify(user));
    data = freshData(name, biz, email);
    save();
    enterApp();
    toast("Workspace created — welcome to Billable! 🎉");
  } else {
    if (!stored || stored.email !== email || stored.pass !== pass) {
      $("authError").textContent = stored
        ? "Wrong email or password."
        : "No account found — switch to “Start free” to sign up.";
      return;
    }
    user = stored;
    data = JSON.parse(localStorage.getItem(LS_DATA)) || freshData(user.name, user.biz, user.email);
    enterApp();
  }
});

$("demoBtn").addEventListener("click", () => {
  user = { name: "Alex Carter", biz: "Carter Design Co.", email: "alex@carterdesign.co", pass: "demo", plan: "pro" };
  localStorage.setItem(LS_USER, JSON.stringify(user));
  data = demoData();
  save();
  enterApp();
  toast("Demo workspace loaded ✨");
});

$("logoutBtn").addEventListener("click", () => {
  user = null;
  $("appShell").hidden = true;
  $("authScreen").style.display = "";
  setAuthMode("login");
});

function freshData(name, biz, email) {
  return {
    clients: [],
    invoices: [],
    seq: 1000,
    settings: { name, biz, email, addr: "", currency: "USD", tax: 0 },
  };
}

function enterApp() {
  $("authScreen").style.display = "none";
  $("appShell").hidden = false;
  $("userAvatar").textContent = initials(user.name);
  $("planChip").textContent = (user.plan || "starter")[0].toUpperCase() + (user.plan || "starter").slice(1) + " plan";
  loadSettingsForm();
  renderAll();
}

/* ---------------- Demo data ---------------- */

function demoData() {
  const clients = [
    { id: "c1", name: "Northwind Co.", email: "accounts@northwind.com", addr: "Seattle, USA" },
    { id: "c2", name: "Maple & Co", email: "billing@mapleco.ca", addr: "Toronto, Canada" },
    { id: "c3", name: "Drift Media", email: "finance@driftmedia.io", addr: "London, UK" },
    { id: "c4", name: "Forge Labs", email: "ap@forgelabs.dev", addr: "Austin, USA" },
  ];
  const L = (desc, qty, rate) => ({ desc, qty, rate });
  const mk = (n, cid, status, issuedOff, dueOff, lines, paidOff = null, tax = 8) => ({
    id: uid(), number: "INV-" + n, clientId: cid, status,
    issued: todayISO(issuedOff), due: todayISO(dueOff),
    paidOn: paidOff === null ? null : todayISO(paidOff),
    currency: "USD", tax, discount: 0, notes: "Thank you for your business!", lines,
  });
  // Payment personalities: Northwind pays early, Maple drifts a little late,
  // Drift Media pays very late, Forge is roughly on time.
  const invoices = [
    mk(1042, "c1", "paid", -150, -120, [L("Brand identity design", 1, 2400), L("Website build (12 hrs)", 12, 120)], -125),
    mk(1043, "c2", "paid", -118, -88, [L("Monthly retainer — design", 1, 1800)], -89),
    mk(1044, "c3", "paid", -85, -55, [L("Campaign landing pages", 3, 650)], -36),
    mk(1045, "c2", "paid", -60, -30, [L("Monthly retainer — design", 1, 1800)], -24),
    mk(1046, "c4", "paid", -45, -15, [L("Design system audit", 1, 1200), L("Component library (8 hrs)", 8, 110)], -14),
    mk(1047, "c1", "paid", -22, -2, [L("Marketing site refresh", 1, 3200)], -6),
    mk(1048, "c3", "sent", -12, 18, [L("Q3 campaign assets", 1, 2750)]),
    mk(1049, "c2", "sent", -30, -6, [L("Monthly retainer — design", 1, 1800)]),
    mk(1050, "c4", "draft", -1, 29, [L("Mobile app UI (phase 1)", 1, 4800)]),
  ];
  return {
    clients, invoices, seq: 1050,
    settings: { name: "Alex Carter", biz: "Carter Design Co.", email: "alex@carterdesign.co", addr: "Portland, OR, USA", currency: "USD", tax: 8 },
  };
}

/* ---------------- Navigation ---------------- */

const VIEW_TITLES = { dashboard: "Dashboard", invoices: "Invoices", clients: "Clients", insights: "Insights", settings: "Settings" };

document.querySelectorAll(".side-link[data-view]").forEach((btn) => {
  btn.addEventListener("click", () => showView(btn.dataset.view));
});

function showView(view) {
  document.querySelectorAll(".side-link[data-view]").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === view));
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== "view-" + view));
  $("viewTitle").textContent = VIEW_TITLES[view];
  if (view === "dashboard") renderDashboard();
  if (view === "insights") renderInsights();
}

function renderAll() {
  renderDashboard();
  renderInvoices();
  renderClients();
  if (!$("view-insights").hidden) renderInsights();
}

/* ---------------- Dashboard ---------------- */

function renderDashboard() {
  let paid = 0, pending = 0, overdue = 0, nPaid = 0, nPending = 0, nOverdue = 0;
  data.invoices.forEach((inv) => {
    const t = invoiceTotal(inv).total;
    const s = statusOf(inv);
    if (s === "paid") { paid += t; nPaid++; }
    else if (s === "sent") { pending += t; nPending++; }
    else if (s === "overdue") { overdue += t; nOverdue++; }
  });
  $("statPaid").textContent = money(paid);
  $("statPaidCount").textContent = `${nPaid} invoice${nPaid === 1 ? "" : "s"} paid`;
  $("statPending").textContent = money(pending);
  $("statPendingCount").textContent = `${nPending} awaiting payment`;
  $("statOverdue").textContent = money(overdue);
  $("statOverdueCount").textContent = `${nOverdue} past due`;
  $("statClients").textContent = data.clients.length;

  drawRevChart();
  renderActivity();
}

function drawRevChart() {
  const canvas = $("revChart");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || canvas.parentElement.clientWidth - 44;
  const H = 220;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  // Bucket paid revenue into the last 6 calendar months.
  const now = new Date();
  const buckets = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleDateString(undefined, { month: "short" }), total: 0 });
  }
  data.invoices.forEach((inv) => {
    if (inv.status !== "paid") return;
    const b = buckets.find((b) => inv.issued.startsWith(b.key));
    if (b) b.total += invoiceTotal(inv).total;
  });

  const max = Math.max(...buckets.map((b) => b.total), 1);
  const padL = 10, padB = 28, padT = 14;
  const chartW = W - padL * 2;
  const chartH = H - padB - padT;
  const barW = Math.min(54, (chartW / buckets.length) * 0.55);

  buckets.forEach((b, i) => {
    const x = padL + (chartW / buckets.length) * (i + 0.5) - barW / 2;
    const h = (b.total / max) * chartH;
    const y = padT + chartH - h;

    const grad = ctx.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, "#5b5bf6");
    grad.addColorStop(1, "#8b5cf6");
    ctx.fillStyle = b.total > 0 ? grad : "#ececf6";
    const r = 7, hh = Math.max(h, 4), yy = b.total > 0 ? y : padT + chartH - 4;
    ctx.beginPath();
    ctx.roundRect(x, yy, barW, hh, [r, r, 0, 0]);
    ctx.fill();

    ctx.fillStyle = "#545468";
    ctx.font = "12px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(b.label, x + barW / 2, H - 8);
    if (b.total > 0) {
      ctx.fillStyle = "#14142b";
      ctx.font = "bold 11px 'Segoe UI', sans-serif";
      ctx.fillText(money(b.total).replace(/\.\d+$/, ""), x + barW / 2, yy - 6);
    }
  });
}

function renderActivity() {
  const list = $("activityList");
  const colors = { paid: "#10b981", sent: "#f59e0b", overdue: "#ef4444", draft: "#94a3b8" };
  const verbs = { paid: "was paid", sent: "is awaiting payment", overdue: "is overdue", draft: "saved as draft" };
  const items = [...data.invoices]
    .sort((a, b) => b.issued.localeCompare(a.issued))
    .slice(0, 7);
  list.innerHTML = items.length
    ? items.map((inv) => {
        const s = statusOf(inv);
        const c = data.clients.find((c) => c.id === inv.clientId);
        return `<li><span class="dot" style="background:${colors[s]}"></span>
          <span><b>${esc(inv.number)}</b> · ${esc(c ? c.name : "—")} ${verbs[s]} — <b>${money(invoiceTotal(inv).total, inv.currency)}</b></span>
          <time>${fmtDate(inv.issued)}</time></li>`;
      }).join("")
    : '<li class="muted">No activity yet — create your first invoice.</li>';
}

/* ---------------- Invoices ---------------- */

$("invSearch").addEventListener("input", renderInvoices);
$("invFilters").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  invFilter = chip.dataset.f;
  document.querySelectorAll("#invFilters .chip").forEach((c) => c.classList.toggle("active", c === chip));
  renderInvoices();
});

function renderInvoices() {
  const q = $("invSearch").value.trim().toLowerCase();
  const rows = data.invoices
    .map((inv) => ({ inv, s: statusOf(inv), c: data.clients.find((c) => c.id === inv.clientId) }))
    .filter(({ inv, s, c }) => {
      if (invFilter !== "all" && s !== invFilter) return false;
      if (q && !(inv.number.toLowerCase().includes(q) || (c && c.name.toLowerCase().includes(q)))) return false;
      return true;
    })
    .sort((a, b) => b.inv.issued.localeCompare(a.inv.issued));

  $("invEmpty").hidden = data.invoices.length > 0;
  $("invTable").style.display = data.invoices.length ? "" : "none";

  $("invBody").innerHTML = rows.map(({ inv, s, c }) => `
    <tr>
      <td class="num">${esc(inv.number)}</td>
      <td>${esc(c ? c.name : "—")}</td>
      <td>${fmtDate(inv.issued)}</td>
      <td>${fmtDate(inv.due)}</td>
      <td class="amt">${money(invoiceTotal(inv).total, inv.currency)}</td>
      <td><span class="status ${s}">${s.toUpperCase()}</span></td>
      <td><div class="row-actions">
        <button class="icon-btn" title="Preview / PDF" onclick="previewInvoice('${inv.id}')">👁</button>
        ${s === "draft" ? `<button class="icon-btn" title="Mark sent" onclick="setStatus('${inv.id}','sent')">📤</button>` : ""}
        ${s === "sent" || s === "overdue" ? `<button class="icon-btn" title="Mark paid" onclick="setStatus('${inv.id}','paid')">💸</button><button class="icon-btn" title="Smart nudge" onclick="openNudge('${inv.id}')">✉</button>` : ""}
        <button class="icon-btn" title="Edit" onclick="openInvoiceEditor('${inv.id}')">✏️</button>
        <button class="icon-btn" title="Delete" onclick="deleteInvoice('${inv.id}')">🗑</button>
      </div></td>
    </tr>`).join("");
}

function setStatus(id, status) {
  const inv = data.invoices.find((i) => i.id === id);
  if (!inv) return;
  inv.status = status;
  if (status === "paid") inv.paidOn = todayISO();
  save();
  renderAll();
  toast(status === "paid" ? `💸 ${inv.number} marked as paid` : `📤 ${inv.number} marked as sent`);
}

function deleteInvoice(id) {
  const inv = data.invoices.find((i) => i.id === id);
  if (!inv || !confirm(`Delete ${inv.number}? This can't be undone.`)) return;
  data.invoices = data.invoices.filter((i) => i.id !== id);
  save();
  renderAll();
  toast("Invoice deleted");
}

/* ----- Invoice editor ----- */

$("newInvoiceBtn").addEventListener("click", () => openInvoiceEditor());
$("addLineBtn").addEventListener("click", () => addLineRow());

function openInvoiceEditor(id = null) {
  if (!data.clients.length) {
    showView("clients");
    toast("Add a client first — invoices need someone to bill 🙂");
    openClientModal();
    return;
  }
  editingInvoiceId = id;
  const inv = id ? data.invoices.find((i) => i.id === id) : null;

  $("invModalTitle").textContent = inv ? "Edit " + inv.number : "New invoice";
  $("invClient").innerHTML = data.clients
    .map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
  $("invClient").value = inv ? inv.clientId : data.clients[0].id;
  $("invNumber").value = inv ? inv.number : "INV-" + (data.seq + 1);
  $("invIssued").value = inv ? inv.issued : todayISO();
  $("invDue").value = inv ? inv.due : todayISO(30);
  $("invCurrency").value = inv ? inv.currency : data.settings.currency;
  $("invTax").value = inv ? inv.tax : data.settings.tax;
  $("invDiscount").value = inv ? inv.discount : 0;
  $("invNotes").value = inv ? inv.notes : "";

  $("lineItems").innerHTML = "";
  (inv ? inv.lines : [{ desc: "", qty: 1, rate: 0 }]).forEach(addLineRow);
  updateEditorTotals();
  $("invoiceModal").hidden = false;
}

function addLineRow(line = { desc: "", qty: 1, rate: 0 }) {
  const row = document.createElement("div");
  row.className = "line-item";
  row.innerHTML = `
    <input class="li-desc" placeholder="Description (e.g. Logo design)" value="${esc(line.desc)}" required>
    <input class="li-qty" type="number" min="0" step="0.25" value="${line.qty}" title="Quantity">
    <input class="li-rate" type="number" min="0" step="0.01" value="${line.rate}" title="Rate">
    <span class="li-amount">$0.00</span>
    <button type="button" class="li-del" title="Remove line">✕</button>`;
  row.querySelector(".li-del").addEventListener("click", () => {
    if ($("lineItems").children.length > 1) { row.remove(); updateEditorTotals(); }
  });
  row.querySelectorAll("input").forEach((i) => i.addEventListener("input", updateEditorTotals));
  $("lineItems").appendChild(row);
  updateEditorTotals();
}

function readEditorLines() {
  return [...$("lineItems").children].map((row) => ({
    desc: row.querySelector(".li-desc").value.trim(),
    qty: parseFloat(row.querySelector(".li-qty").value) || 0,
    rate: parseFloat(row.querySelector(".li-rate").value) || 0,
  }));
}

function updateEditorTotals() {
  const cur = $("invCurrency").value;
  const lines = readEditorLines();
  [...$("lineItems").children].forEach((row, i) => {
    row.querySelector(".li-amount").textContent = money(lines[i].qty * lines[i].rate, cur);
  });
  const sub = lines.reduce((s, l) => s + l.qty * l.rate, 0);
  const tax = sub * ((parseFloat($("invTax").value) || 0) / 100);
  const disc = sub * ((parseFloat($("invDiscount").value) || 0) / 100);
  $("tSubtotal").textContent = money(sub, cur);
  $("tTax").textContent = money(tax, cur);
  $("tDiscount").textContent = "−" + money(disc, cur);
  $("tTotal").textContent = money(sub + tax - disc, cur);
}

["invTax", "invDiscount", "invCurrency"].forEach((id) =>
  $(id).addEventListener("input", updateEditorTotals));

let saveAs = "draft";
$("invoiceForm").querySelectorAll("[data-save]").forEach((btn) =>
  btn.addEventListener("click", () => (saveAs = btn.dataset.save)));

$("invoiceForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const lines = readEditorLines().filter((l) => l.desc);
  if (!lines.length) { toast("Add at least one line item"); return; }

  const payload = {
    clientId: $("invClient").value,
    issued: $("invIssued").value,
    due: $("invDue").value,
    currency: $("invCurrency").value,
    tax: parseFloat($("invTax").value) || 0,
    discount: parseFloat($("invDiscount").value) || 0,
    notes: $("invNotes").value.trim(),
    lines,
  };

  if (editingInvoiceId) {
    const inv = data.invoices.find((i) => i.id === editingInvoiceId);
    Object.assign(inv, payload);
    if (saveAs === "sent" && inv.status === "draft") inv.status = "sent";
    toast(`${inv.number} updated`);
  } else {
    data.seq += 1;
    data.invoices.push({ id: uid(), number: "INV-" + data.seq, status: saveAs, ...payload });
    toast(saveAs === "sent" ? `📤 INV-${data.seq} created & marked sent` : `INV-${data.seq} saved as draft`);
  }
  save();
  closeModal("invoiceModal");
  renderAll();
});

/* ---------------- Invoice preview / PDF ---------------- */

function previewInvoice(id) {
  const inv = data.invoices.find((i) => i.id === id);
  const c = data.clients.find((c) => c.id === inv.clientId) || { name: "—", email: "", addr: "" };
  const s = data.settings;
  const { sub, tax, disc, total } = invoiceTotal(inv);
  const st = statusOf(inv);

  $("previewBody").innerHTML = `
  <div class="inv-doc">
    <div class="inv-doc-head">
      <div class="inv-doc-biz">
        <div class="inv-doc-mark">${esc(initials(s.biz || s.name))}</div>
        <div><h2>${esc(s.biz)}</h2><p>${esc(s.addr || "")}</p><p>${esc(s.email)}</p></div>
      </div>
      <div class="inv-doc-no">
        <h1>${esc(inv.number)}</h1>
        <p>Issued ${fmtDate(inv.issued)}</p>
        <p>Due ${fmtDate(inv.due)}</p>
        <p><span class="status ${st}">${st.toUpperCase()}</span></p>
      </div>
    </div>
    <div class="inv-doc-parties">
      <div><h4>Billed to</h4><p><b>${esc(c.name)}</b></p><p>${esc(c.addr || "")}</p><p>${esc(c.email)}</p></div>
    </div>
    <table>
      <thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
      <tbody>
        ${inv.lines.map((l) => `<tr>
          <td>${esc(l.desc)}</td><td>${l.qty}</td>
          <td>${money(l.rate, inv.currency)}</td>
          <td>${money(l.qty * l.rate, inv.currency)}</td></tr>`).join("")}
      </tbody>
    </table>
    <div class="inv-doc-totals">
      <div><span>Subtotal</span><span>${money(sub, inv.currency)}</span></div>
      ${inv.tax ? `<div><span>Tax (${inv.tax}%)</span><span>${money(tax, inv.currency)}</span></div>` : ""}
      ${inv.discount ? `<div><span>Discount (${inv.discount}%)</span><span>−${money(disc, inv.currency)}</span></div>` : ""}
      <div class="grand"><span>Total due</span><span>${money(total, inv.currency)}</span></div>
    </div>
    ${inv.notes ? `<div class="inv-doc-notes">${esc(inv.notes)}</div>` : ""}
    <div class="inv-doc-foot">Generated with Billable · billable.app</div>
  </div>`;
  $("previewModal").hidden = false;
}

/* ---------------- Clients ---------------- */

$("newClientBtn").addEventListener("click", () => openClientModal());
$("cliSearch").addEventListener("input", renderClients);

function renderClients() {
  const q = $("cliSearch").value.trim().toLowerCase();
  const list = data.clients.filter((c) =>
    !q || c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q));

  $("cliEmpty").hidden = data.clients.length > 0;

  $("clientGrid").innerHTML = list.map((c) => {
    const invs = data.invoices.filter((i) => i.clientId === c.id);
    const billed = invs.reduce((s, i) => s + invoiceTotal(i).total, 0);
    const open = invs.filter((i) => ["sent", "overdue"].includes(statusOf(i))).length;
    return `<div class="client-card">
      <div class="avatar">${esc(initials(c.name))}</div>
      <h3>${esc(c.name)}</h3>
      <p class="muted">${esc(c.email)}</p>
      <div class="client-meta">
        <div><b>${money(billed)}</b><span>total billed</span></div>
        <div><b>${invs.length}</b><span>invoices</span></div>
        <div><b>${open}</b><span>open</span></div>
      </div>
      <div class="row-actions" style="justify-content:flex-start">
        <button class="icon-btn" onclick="openClientModal('${c.id}')">✏️ Edit</button>
        <button class="icon-btn" onclick="deleteClient('${c.id}')">🗑 Delete</button>
      </div>
    </div>`;
  }).join("");
}

function openClientModal(id = null) {
  editingClientId = id;
  const c = id ? data.clients.find((c) => c.id === id) : null;
  $("cliModalTitle").textContent = c ? "Edit client" : "Add client";
  $("cliName").value = c ? c.name : "";
  $("cliEmail").value = c ? c.email : "";
  $("cliAddr").value = c ? c.addr || "" : "";
  $("clientModal").hidden = false;
  setTimeout(() => $("cliName").focus(), 50);
}

$("clientForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const payload = {
    name: $("cliName").value.trim(),
    email: $("cliEmail").value.trim(),
    addr: $("cliAddr").value.trim(),
  };
  if (editingClientId) {
    Object.assign(data.clients.find((c) => c.id === editingClientId), payload);
    toast("Client updated");
  } else {
    data.clients.push({ id: uid(), ...payload });
    toast(`${payload.name} added to your client book`);
  }
  save();
  closeModal("clientModal");
  renderAll();
});

function deleteClient(id) {
  const c = data.clients.find((c) => c.id === id);
  const n = data.invoices.filter((i) => i.clientId === id).length;
  if (!confirm(`Delete ${c.name}${n ? ` and their ${n} invoice(s)` : ""}?`)) return;
  data.clients = data.clients.filter((c) => c.id !== id);
  data.invoices = data.invoices.filter((i) => i.clientId !== id);
  save();
  renderAll();
  toast("Client removed");
}

/* ============================================================
   Payment Intelligence — the Billable moat.
   Learns each client's payment behavior from history and turns it
   into grades, predicted pay dates, a cash-flow forecast, and
   tone-matched nudge emails.
   ============================================================ */

const DAY = 86400000;
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / DAY);

/* Behavior profile for one client, from their paid invoices. */
function clientStats(clientId) {
  const paid = data.invoices.filter((i) => i.clientId === clientId && i.status === "paid" && i.paidOn);
  if (!paid.length) return { n: 0, avgDays: null, onTimeRate: null, avgLate: null };
  const toPay = paid.map((i) => daysBetween(i.issued, i.paidOn));
  const lateBy = paid.map((i) => daysBetween(i.due, i.paidOn));
  return {
    n: paid.length,
    avgDays: toPay.reduce((s, d) => s + d, 0) / paid.length,
    onTimeRate: lateBy.filter((d) => d <= 0).length / paid.length,
    avgLate: lateBy.reduce((s, d) => s + d, 0) / paid.length,
  };
}

/* Grade + playbook advice. Overdue open invoices drag the grade down. */
function gradeClient(clientId) {
  const s = clientStats(clientId);
  const hasOverdue = data.invoices.some((i) => i.clientId === clientId && statusOf(i) === "overdue");
  if (!s.n) return { letter: "—", label: "No history yet", tip: "Standard Net-30 terms", cls: "new" };
  let score = 100 - Math.max(0, s.avgLate) * 4 - (1 - s.onTimeRate) * 30 - (hasOverdue ? 15 : 0);
  if (score >= 85) return { letter: "A", label: s.avgLate < -2 ? "Pays early" : "Pays on time", tip: "Safe for bigger projects", cls: "a" };
  if (score >= 65) return { letter: "B", label: "Mostly reliable", tip: "Gentle reminder at due date", cls: "b" };
  if (score >= 45) return { letter: "C", label: "Slow payer", tip: "Use Net-15 + remind early", cls: "c" };
  return { letter: "D", label: "Chronically late", tip: "Ask for a deposit up front", cls: "d" };
}

/* Predicted payment date for an open invoice. */
function predictPayDate(inv) {
  const s = clientStats(inv.clientId);
  if (s.avgDays === null) return inv.due; // no history → trust the due date
  const d = new Date(inv.issued + "T00:00:00");
  d.setDate(d.getDate() + Math.round(s.avgDays));
  const iso = d.toISOString().slice(0, 10);
  return iso < todayISO() ? todayISO() : iso; // can't land in the past
}

function renderInsights() {
  const open = data.invoices.filter((i) => ["sent", "overdue"].includes(statusOf(i)));
  const paid = data.invoices.filter((i) => i.status === "paid" && i.paidOn);

  // Headline stats
  const allDays = paid.map((i) => daysBetween(i.issued, i.paidOn));
  $("insAvgDays").textContent = allDays.length
    ? Math.round(allDays.reduce((s, d) => s + d, 0) / allDays.length) + " days" : "—";
  const onTime = paid.filter((i) => daysBetween(i.due, i.paidOn) <= 0).length;
  $("insOnTime").textContent = paid.length ? Math.round((onTime / paid.length) * 100) + "%" : "—";
  const in30 = open.filter((i) => daysBetween(todayISO(), predictPayDate(i)) <= 30);
  $("insProjected").textContent = money(in30.reduce((s, i) => s + invoiceTotal(i).total, 0));

  const ranked = data.clients
    .map((c) => ({ c, s: clientStats(c.id) }))
    .filter((x) => x.s.n > 0)
    .sort((a, b) => a.s.avgLate - b.s.avgLate);
  $("insBestClient").textContent = ranked.length ? ranked[0].c.name : "—";
  $("insBestClientSub").textContent = ranked.length
    ? `avg ${Math.round(ranked[0].s.avgDays)} days to pay` : "pays fastest";

  // Reliability table
  $("gradeBody").innerHTML = data.clients.map((c) => {
    const s = clientStats(c.id);
    const g = gradeClient(c.id);
    return `<tr>
      <td><b>${esc(c.name)}</b></td>
      <td><span class="grade grade-${g.cls}">${g.letter}</span> <span class="muted small">${g.label}</span></td>
      <td>${s.avgDays === null ? "—" : Math.round(s.avgDays) + " days"}</td>
      <td>${s.onTimeRate === null ? "—" : Math.round(s.onTimeRate * 100) + "%"}</td>
      <td class="muted small">${g.tip}</td>
    </tr>`;
  }).join("") || '<tr><td colspan="5" class="muted">Add clients and invoices to build intelligence.</td></tr>';

  // Predicted payments
  $("predBody").innerHTML = open
    .map((inv) => ({ inv, eta: predictPayDate(inv) }))
    .sort((a, b) => a.eta.localeCompare(b.eta))
    .map(({ inv, eta }) => {
      const c = data.clients.find((c) => c.id === inv.clientId);
      const late = statusOf(inv) === "overdue";
      return `<tr>
        <td><b>${esc(inv.number)}</b><br><span class="muted small">${esc(c ? c.name : "—")}</span></td>
        <td class="amt">${money(invoiceTotal(inv).total, inv.currency)}</td>
        <td>${fmtDate(eta)}${late ? ' <span class="status overdue">LATE</span>' : ""}</td>
        <td><button class="icon-btn" title="Smart nudge" onclick="openNudge('${inv.id}')">✉ Nudge</button></td>
      </tr>`;
    }).join("") || '<tr><td colspan="4" class="muted">Nothing outstanding — you\'re fully paid up 🎉</td></tr>';

  drawForecastChart(open);
}

function drawForecastChart(open) {
  const canvas = $("forecastChart");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || canvas.parentElement.clientWidth - 44;
  const H = 200;
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  // Bucket expected income into the next 6 weeks.
  const buckets = [];
  for (let w = 0; w < 6; w++) {
    const d = new Date(); d.setDate(d.getDate() + w * 7);
    buckets.push({ label: w === 0 ? "This week" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }), total: 0 });
  }
  open.forEach((inv) => {
    const w = Math.min(5, Math.max(0, Math.floor(daysBetween(todayISO(), predictPayDate(inv)) / 7)));
    buckets[w].total += invoiceTotal(inv).total;
  });

  const max = Math.max(...buckets.map((b) => b.total), 1);
  const padL = 10, padB = 28, padT = 16;
  const chartW = W - padL * 2, chartH = H - padB - padT;
  const barW = Math.min(64, (chartW / 6) * 0.55);
  buckets.forEach((b, i) => {
    const x = padL + (chartW / 6) * (i + 0.5) - barW / 2;
    const h = (b.total / max) * chartH;
    const y = padT + chartH - h;
    const grad = ctx.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, "#10b981"); grad.addColorStop(1, "#34d399");
    ctx.fillStyle = b.total > 0 ? grad : "#ececf6";
    ctx.beginPath();
    ctx.roundRect(x, b.total > 0 ? y : padT + chartH - 4, barW, Math.max(h, 4), [7, 7, 0, 0]);
    ctx.fill();
    ctx.fillStyle = "#545468"; ctx.font = "12px 'Segoe UI', sans-serif"; ctx.textAlign = "center";
    ctx.fillText(b.label, x + barW / 2, H - 8);
    if (b.total > 0) {
      ctx.fillStyle = "#14142b"; ctx.font = "bold 11px 'Segoe UI', sans-serif";
      ctx.fillText(money(b.total).replace(/\.\d+$/, ""), x + barW / 2, y - 6);
    }
  });
}

/* ----- Smart nudge composer ----- */

let nudgeInvoiceId = null;

function nudgeToneFor(inv) {
  const late = daysBetween(inv.due, todayISO());
  if (late < 0) return "gentle";
  if (late <= 7) return "friendly";
  if (late <= 21) return "firm";
  return "final";
}

function buildNudge(inv, tone) {
  const c = data.clients.find((c) => c.id === inv.clientId) || { name: "there", email: "" };
  const s = data.settings;
  const total = money(invoiceTotal(inv).total, inv.currency);
  const late = daysBetween(inv.due, todayISO());
  const stats = clientStats(inv.clientId);
  const history = stats.n > 1 && stats.avgLate <= 1
    ? "You're usually so prompt with these — " : "";

  const subjects = {
    gentle: `Heads up: ${inv.number} (${total}) is due ${fmtDate(inv.due)}`,
    friendly: `Quick reminder — invoice ${inv.number} (${total})`,
    firm: `Follow-up: invoice ${inv.number} is ${late} days past due`,
    final: `Final notice: invoice ${inv.number} — ${total} outstanding`,
  };
  const bodies = {
    gentle: `Hi ${c.name},\n\nJust a friendly heads-up that invoice ${inv.number} for ${total} is due on ${fmtDate(inv.due)}.\n\nNo action needed if it's already scheduled — just keeping it on your radar!\n\nThanks,\n${s.name}\n${s.biz}`,
    friendly: `Hi ${c.name},\n\nHope all's well! ${history}just a quick note that invoice ${inv.number} for ${total} was due on ${fmtDate(inv.due)}.\n\nCould you let me know when payment is scheduled? Happy to resend the invoice if that helps.\n\nThanks so much,\n${s.name}\n${s.biz}`,
    firm: `Hi ${c.name},\n\nFollowing up on invoice ${inv.number} for ${total}, which is now ${late} days past its ${fmtDate(inv.due)} due date.\n\nPlease arrange payment within the next 5 business days, or let me know right away if something is holding it up.\n\nRegards,\n${s.name}\n${s.biz}`,
    final: `Dear ${c.name},\n\nThis is a final notice regarding invoice ${inv.number} for ${total}, now ${late} days overdue (due ${fmtDate(inv.due)}).\n\nIf payment is not received within 7 days, I'll have to pause further work and may add late fees as outlined in our terms. I'd much rather resolve this simply — please reply today with a payment date.\n\nRegards,\n${s.name}\n${s.biz}`,
  };
  return { subject: subjects[tone], body: bodies[tone], email: c.email };
}

function openNudge(id, tone) {
  const inv = data.invoices.find((i) => i.id === id);
  if (!inv) return;
  nudgeInvoiceId = id;
  tone = tone || nudgeToneFor(inv);
  const c = data.clients.find((c) => c.id === inv.clientId);
  const g = gradeClient(inv.clientId);
  const late = daysBetween(inv.due, todayISO());

  $("nudgeMeta").innerHTML = `<b>${esc(inv.number)}</b> · ${esc(c ? c.name : "—")} ·
    ${money(invoiceTotal(inv).total, inv.currency)} ·
    ${late > 0 ? `<span class="status overdue">${late} DAYS LATE</span>` : `due ${fmtDate(inv.due)}`}
    &nbsp;<span class="grade grade-${g.cls}">${g.letter}</span> <span class="muted small">${g.label} — suggested tone preselected</span>`;

  document.querySelectorAll("#nudgeTones .chip").forEach((ch) =>
    ch.classList.toggle("active", ch.dataset.tone === tone));

  const n = buildNudge(inv, tone);
  $("nudgeSubject").value = n.subject;
  $("nudgeBody").value = n.body;
  $("nudgeMailBtn").href = `mailto:${encodeURIComponent(n.email)}?subject=${encodeURIComponent(n.subject)}&body=${encodeURIComponent(n.body)}`;
  $("nudgeModal").hidden = false;
}

$("nudgeTones").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (chip && nudgeInvoiceId) openNudge(nudgeInvoiceId, chip.dataset.tone);
});

$("nudgeCopyBtn").addEventListener("click", async () => {
  const text = `Subject: ${$("nudgeSubject").value}\n\n${$("nudgeBody").value}`;
  try { await navigator.clipboard.writeText(text); toast("Nudge copied — paste it into any email 📋"); }
  catch { toast("Select the text and copy manually"); }
});

/* ---------------- Settings ---------------- */

function loadSettingsForm() {
  const s = data.settings;
  $("setBiz").value = s.biz;
  $("setName").value = s.name;
  $("setEmail").value = s.email;
  $("setAddr").value = s.addr || "";
  $("setCurrency").value = s.currency;
  $("setTax").value = s.tax;
  $("planName").textContent = (user.plan || "starter")[0].toUpperCase() + (user.plan || "starter").slice(1);
}

$("settingsForm").addEventListener("submit", (e) => {
  e.preventDefault();
  Object.assign(data.settings, {
    biz: $("setBiz").value.trim(),
    name: $("setName").value.trim(),
    email: $("setEmail").value.trim(),
    addr: $("setAddr").value.trim(),
    currency: $("setCurrency").value,
    tax: parseFloat($("setTax").value) || 0,
  });
  save();
  renderAll();
  toast("Settings saved");
});

document.querySelectorAll("[data-plan]").forEach((btn) =>
  btn.addEventListener("click", () => {
    user.plan = btn.dataset.plan;
    localStorage.setItem(LS_USER, JSON.stringify(user));
    $("planChip").textContent = user.plan[0].toUpperCase() + user.plan.slice(1) + " plan";
    $("planName").textContent = user.plan[0].toUpperCase() + user.plan.slice(1);
    toast(`Switched to the ${user.plan[0].toUpperCase() + user.plan.slice(1)} plan 🎉`);
  }));

$("exportBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "billable-export.json";
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Workspace exported");
});

$("resetBtn").addEventListener("click", () => {
  if (!confirm("Erase ALL workspace data? This cannot be undone.")) return;
  localStorage.removeItem(LS_DATA);
  localStorage.removeItem(LS_USER);
  location.reload();
});

/* ---------------- Modals ---------------- */

function closeModal(id) {
  $(id).hidden = true;
}
document.querySelectorAll(".modal-wrap").forEach((w) =>
  w.addEventListener("click", (e) => { if (e.target === w) w.hidden = true; }));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") document.querySelectorAll(".modal-wrap").forEach((w) => (w.hidden = true));
});

window.addEventListener("resize", () => {
  if ($("appShell").hidden) return;
  if (!$("view-dashboard").hidden) drawRevChart();
  if (!$("view-insights").hidden) renderInsights();
});

/* ---------------- Boot ---------------- */

(function boot() {
  if (location.hash === "#signup") setAuthMode("signup");
  else setAuthMode("login");

  const stored = JSON.parse(localStorage.getItem(LS_USER) || "null");
  const storedData = JSON.parse(localStorage.getItem(LS_DATA) || "null");
  if (stored && storedData && location.hash !== "#signup") {
    user = stored;
    data = storedData;
    enterApp();
  }
})();
