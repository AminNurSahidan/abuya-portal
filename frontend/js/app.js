const API_BASE = "/api";
const TOKEN_KEY = "abuya_token";
const BRAND_KEY = "abuya_brand";
const LOGOUT_REASON_KEY = "abuya_logout_reason";
const LOGIN_PAGE = "login.html";
const IDLE_MINUTES = 30;

const ROLE_LABELS = {
  SM: "Store Manager",
  AM: "Area Manager",
  AMKA: "AM Kebuli Abuya",
  PIC: "PIC",
  Master: "Master"
};

const PR_STATUSES = [
  { key: "Pending", label: "Pending", tone: "amber" },
  { key: "Approved", label: "Approved", tone: "green" },
  { key: "Rejected", label: "Rejected", tone: "red" },
  { key: "Expired", label: "Expired", tone: "slate" }
];

const SHIPPINGS = [
  { key: "Direct", label: "Direct", desc: "Distribution Center", tone: "blue" },
  { key: "Indirect", label: "Indirect", desc: "Vendor", tone: "orange" }
];

const NAV_ITEMS = [
  { section: "Utama" },
  { key: "dashboard", href: "dashboard.html", icon: "space_dashboard", label: "Dashboard" },
  { section: "Approval" },
  { key: "purchase-request", href: "purchase-request.html", icon: "request_quote", label: "Purchase Request", badge: true },
  { key: "purchase-order", href: "purchase-order.html", icon: "receipt_long", label: "Purchase Order" }
];

const App = { user: null, brands: [] };

const $ = (id) => document.getElementById(id);

let idleTimer = null;
let lastActivity = Date.now();
let toastTimer = null;

function bootApp(onReady) {
  renderShell();
  bindShell();
  document.querySelectorAll("select").forEach(enhanceSelect);
  document.querySelectorAll('input[type="date"]').forEach(enhanceDate);

  if (!getToken()) {
    window.location.replace(LOGIN_PAGE);
    return;
  }

  (async () => {
    try {
      App.user = await api("/auth/me");
      if (App.user.role === "Master") {
        App.brands = await api("/brands");
      }
      renderUserShell();
      startIdleWatch();
      document.body.classList.remove("is-loading");
      loadPendingBadge();
      await onReady(App.user);
    } catch (err) {
      if (err.status === 401) return;
      document.body.classList.remove("is-loading");
      showToast(err.message || "Gagal memuat data.", true);
    }
  })();
}

function renderShell() {
  const active = document.body.dataset.page || "";
  const sidebar = $("sidebar");
  sidebar.innerHTML = "";

  const brandBox = el("div", "sidebar-brand");
  const icon = el("div", "brand-icon");
  icon.appendChild(icon_("hub"));
  const text = el("div", "brand-text");
  text.append(el("span", "brand-name", "Abuya Portal"), el("span", "brand-sub", "Approval Layer"));
  brandBox.append(icon, text);
  sidebar.appendChild(brandBox);

  const switchBox = el("div", "brand-switch");
  switchBox.id = "brandSwitch";
  switchBox.hidden = true;
  const select = el("select");
  select.id = "brandSelect";
  select.setAttribute("aria-label", "Pilih brand");
  switchBox.appendChild(select);
  sidebar.appendChild(switchBox);

  const nav = el("nav", "nav");
  NAV_ITEMS.forEach((item) => {
    if (item.section) {
      nav.appendChild(el("span", "nav-label", item.section));
      return;
    }
    const a = el("a", "nav-item" + (item.key === active ? " active" : ""));
    a.href = item.href;
    a.append(icon_(item.icon), el("span", "", item.label));
    if (item.badge) {
      const badge = el("span", "nav-badge");
      badge.id = "navPendingBadge";
      badge.hidden = true;
      a.appendChild(badge);
    }
    nav.appendChild(a);
  });
  sidebar.appendChild(nav);

  const foot = el("div", "sidebar-foot");
  const logout = el("button", "nav-item logout");
  logout.type = "button";
  logout.id = "logoutBtn";
  logout.append(icon_("logout"), el("span", "", "Keluar"));
  foot.appendChild(logout);
  sidebar.appendChild(foot);

  const topbar = $("topbar");
  topbar.innerHTML = "";
  const left = el("div", "topbar-left");
  const menu = el("button", "icon-btn menu-btn");
  menu.type = "button";
  menu.id = "menuBtn";
  menu.setAttribute("aria-label", "Menu");
  menu.appendChild(icon_("menu"));
  const chip = el("span", "brand-chip");
  chip.id = "brandChip";
  chip.hidden = true;
  left.append(menu, chip);

  const right = el("div", "topbar-right");
  const pill = el("div", "status-pill");
  pill.append(el("span", "status-dot"), el("span", "", "Sistem Normal"));

  const userMenu = el("div", "user-menu");
  const userBtn = el("button", "user-btn");
  userBtn.type = "button";
  userBtn.id = "userBtn";
  const avatar = el("span", "avatar", "-");
  avatar.id = "userAvatar";
  const meta = el("span", "user-meta");
  const name = el("span", "user-name", "Memuat...");
  name.id = "userName";
  const role = el("span", "user-role", "-");
  role.id = "userRole";
  meta.append(name, role);
  const chev = icon_("expand_more");
  chev.classList.add("chevron");
  userBtn.append(avatar, meta, chev);

  const dropdown = el("div", "dropdown");
  dropdown.id = "userDropdown";
  const head = el("div", "dropdown-head");
  const headText = el("span", "dropdown-email", "-");
  headText.id = "userInfo";
  head.appendChild(headText);
  const out = el("button", "dropdown-item danger");
  out.type = "button";
  out.id = "logoutBtn2";
  out.append(icon_("logout"), document.createTextNode("Keluar"));
  dropdown.append(head, out);
  userMenu.append(userBtn, dropdown);
  right.append(pill, userMenu);
  topbar.append(left, right);

  const footer = $("footer");
  footer.innerHTML = "";
  footer.append(
    el("span", "", "© " + new Date().getFullYear() + " PT. Abuya Berkah Sejahtera"),
    el("span", "", "Kebuli Abuya • Almaz Fried Chicken")
  );
}

function bindShell() {
  const sidebar = $("sidebar");
  const overlay = $("overlay");
  const dropdown = $("userDropdown");

  $("menuBtn").addEventListener("click", () => toggleSidebar(true));
  overlay.addEventListener("click", () => toggleSidebar(false));

  $("userBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    dropdown.classList.toggle("show");
  });

  document.addEventListener("click", (e) => {
    if (!dropdown.contains(e.target)) dropdown.classList.remove("show");
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      dropdown.classList.remove("show");
      toggleSidebar(false);
    }
  });

  $("logoutBtn").addEventListener("click", () => logout());
  $("logoutBtn2").addEventListener("click", () => logout());

  $("brandSelect").addEventListener("change", (e) => {
    storageSet(localStorage, BRAND_KEY, e.target.value);
    window.location.reload();
  });

  sidebar.addEventListener("click", (e) => {
    if (e.target.closest("a.nav-item")) toggleSidebar(false);
  });
}

function toggleSidebar(open) {
  $("sidebar").classList.toggle("open", open);
  $("overlay").classList.toggle("show", open);
  document.documentElement.classList.toggle("no-scroll", open);
  document.body.classList.toggle("no-scroll", open);
}

function renderUserShell() {
  const u = App.user;
  $("userName").textContent = u.username;
  $("userRole").textContent = ROLE_LABELS[u.role] || u.role;
  $("userAvatar").textContent = initials(u.username);
  $("userInfo").textContent = (ROLE_LABELS[u.role] || u.role) + (u.brand ? " • " + u.brand.name : " • Semua brand");

  const chip = $("brandChip");
  if (u.role === "Master") {
    const select = $("brandSelect");
    select.innerHTML = "";
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "Semua brand";
    select.appendChild(all);
    App.brands.forEach((b) => {
      const opt = document.createElement("option");
      opt.value = String(b.id);
      opt.textContent = b.name;
      select.appendChild(opt);
    });
    const saved = storageGet(localStorage, BRAND_KEY) || "";
    select.value = App.brands.some((b) => String(b.id) === saved) ? saved : "";
    $("brandSwitch").hidden = false;
    const current = App.brands.find((b) => String(b.id) === select.value);
    chip.textContent = "";
    chip.append(icon_("storefront"), el("span", "", current ? current.name : "Semua brand"));
    chip.hidden = false;
  } else if (u.brand) {
    chip.textContent = "";
    chip.append(icon_("storefront"), el("span", "", u.brand.name));
    chip.hidden = false;
  }
}

function activeBrandId() {
  if (!App.user || App.user.role !== "Master") return null;
  const saved = storageGet(localStorage, BRAND_KEY) || "";
  return App.brands.some((b) => String(b.id) === saved) ? saved : null;
}

function activeBrand() {
  if (!App.user) return null;
  if (App.user.role !== "Master") return App.user.brand;
  const id = activeBrandId();
  return id ? App.brands.find((b) => String(b.id) === id) || null : null;
}

function canCreatePR(user) {
  if (!["SM", "AMKA", "Master"].includes(user.role)) return false;
  if (["SM", "AM", "AMKA"].includes(user.role) && !(user.branches || []).length) return false;
  return true;
}

function hasNoMapping(user) {
  return ["SM", "AM", "AMKA"].includes(user.role) && !(user.branches || []).length;
}

async function loadPendingBadge() {
  try {
    const data = await api("/purchase-requests/summary" + qs({ brand_id: activeBrandId() }));
    const pending = data.by_key.Pending || 0;
    const badge = $("navPendingBadge");
    if (badge) {
      badge.textContent = pending > 99 ? "99+" : pending;
      badge.hidden = pending <= 0;
    }
  } catch (e) {}
}

function startIdleWatch() {
  const mark = () => { lastActivity = Date.now(); };
  ["mousemove", "keydown", "click", "scroll", "touchstart"].forEach((evt) => window.addEventListener(evt, mark, { passive: true }));
  idleTimer = setInterval(() => {
    if ((Date.now() - lastActivity) / 60000 >= IDLE_MINUTES) {
      clearInterval(idleTimer);
      storageSet(sessionStorage, LOGOUT_REASON_KEY, "Kamu otomatis keluar karena tidak ada aktivitas lebih dari " + IDLE_MINUTES + " menit. Silakan login lagi.");
      logout();
    }
  }, 30000);
}

async function logout() {
  try {
    await api("/auth/logout", { method: "POST" });
  } catch (e) {}
  clearToken();
  window.location.replace(LOGIN_PAGE);
}

async function api(path, options = {}) {
  const headers = Object.assign({ Authorization: "Bearer " + getToken() }, options.headers || {});
  const init = Object.assign({}, options, { headers });
  if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.json);
    delete init.json;
  }

  let res;
  try {
    res = await fetch(API_BASE + path, init);
  } catch (e) {
    const err = new Error("Gagal terhubung ke server.");
    err.status = 0;
    throw err;
  }

  if (res.status === 401) {
    clearToken();
    storageSet(sessionStorage, LOGOUT_REASON_KEY, "Sesi login kamu sudah tidak valid. Silakan login lagi.");
    window.location.replace(LOGIN_PAGE);
    const err = new Error("Sesi berakhir.");
    err.status = 401;
    throw err;
  }

  if (res.status === 204) return null;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    let msg = "Terjadi kesalahan.";
    if (typeof data.detail === "string") msg = data.detail;
    else if (Array.isArray(data.detail) && data.detail.length) msg = "Data yang diisi belum lengkap atau tidak valid.";
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

function qs(params) {
  const p = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === null || v === undefined || v === "") return;
    if (Array.isArray(v)) v.forEach((x) => p.append(k, x));
    else p.append(k, v);
  });
  const s = p.toString();
  return s ? "?" + s : "";
}

function readParams(defaults) {
  const p = new URLSearchParams(window.location.search);
  const out = {};
  Object.keys(defaults).forEach((k) => {
    const v = p.get(k);
    out[k] = v === null ? defaults[k] : typeof defaults[k] === "number" ? Math.max(1, parseInt(v, 10) || defaults[k]) : v;
  });
  return out;
}

function writeParams(state, defaults) {
  const p = new URLSearchParams();
  Object.keys(defaults).forEach((k) => {
    if (state[k] !== defaults[k] && state[k] !== "" && state[k] !== null) p.set(k, state[k]);
  });
  const s = p.toString();
  window.history.replaceState(null, "", window.location.pathname + (s ? "?" + s : ""));
}

function statusConf(key) {
  return PR_STATUSES.find((s) => s.key === key) || { key, label: key, tone: "slate" };
}

function shippingConf(key) {
  return SHIPPINGS.find((s) => s.key === key) || { key, label: key || "-", desc: "", tone: "slate" };
}

function badge(conf) {
  const b = el("span", "badge tone-" + conf.tone);
  b.append(el("span", "dot"), el("span", "", conf.label));
  return b;
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function icon_(name) {
  return el("span", "material-symbols-outlined", name);
}

function emptyBlock(iconName, msg) {
  const box = el("div", "empty");
  box.style.gridColumn = "1 / -1";
  box.append(icon_(iconName), el("span", "", msg));
  return box;
}

function tableMessage(body, columns, iconName, msg) {
  body.innerHTML = "";
  const tr = el("tr", "empty-row");
  const td = el("td");
  td.colSpan = columns;
  td.appendChild(emptyBlock(iconName, msg));
  tr.appendChild(td);
  body.appendChild(tr);
}

function tableSkeleton(body, columns, rows = 5) {
  body.innerHTML = "";
  for (let i = 0; i < rows; i++) {
    const tr = el("tr", "skeleton-row");
    const td = el("td");
    td.colSpan = columns;
    td.appendChild(el("div", "skeleton"));
    tr.appendChild(td);
    body.appendChild(tr);
  }
}

function renderPager(data, label) {
  const pages = Math.max(1, Math.ceil(data.total / data.size));
  const from = data.total ? (data.page - 1) * data.size + 1 : 0;
  const to = Math.min(data.page * data.size, data.total);
  $("pagerInfo").textContent = data.total
    ? "Menampilkan " + formatNumber(from) + "–" + formatNumber(to) + " dari " + formatNumber(data.total) + " " + label
    : "0 " + label;
  $("pageNum").textContent = data.page + " / " + pages;
  $("prevBtn").disabled = data.page <= 1;
  $("nextBtn").disabled = data.page >= pages;
  return pages;
}

function bindSortHeaders(state, onChange) {
  document.querySelectorAll("th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (state.sort === key) state.dir = state.dir === "asc" ? "desc" : "asc";
      else {
        state.sort = key;
        state.dir = "asc";
      }
      paintSortHeaders(state);
      onChange();
    });
  });
  paintSortHeaders(state);
}

function paintSortHeaders(state) {
  document.querySelectorAll("th.sortable").forEach((th) => {
    const on = th.dataset.sort === state.sort;
    th.classList.toggle("sorted", on);
    let ic = th.querySelector(".sort-icon");
    if (!ic) {
      ic = icon_("unfold_more");
      ic.classList.add("sort-icon");
      th.appendChild(ic);
    }
    ic.textContent = on ? (state.dir === "asc" ? "arrow_upward" : "arrow_downward") : "unfold_more";
  });
}

function fillBranchSelect(select, branches, value, allLabel) {
  select.innerHTML = "";
  const all = document.createElement("option");
  all.value = "";
  all.textContent = allLabel || "Semua cabang";
  select.appendChild(all);
  branches.forEach((b) => {
    const opt = document.createElement("option");
    opt.value = String(b.id);
    opt.textContent = b.name;
    select.appendChild(opt);
  });
  select.value = branches.some((b) => String(b.id) === String(value)) ? String(value) : "";
  return select.value;
}

function confirmDialog(message, opts = {}) {
  return new Promise((resolve) => {
    const backdrop = el("div", "confirm-backdrop");
    const card = el("div", "confirm-card");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    const p = el("p", "", message);
    const actions = el("div", "confirm-actions");
    const cancel = el("button", "btn btn-ghost", "Batal");
    cancel.type = "button";
    const ok = el("button", "btn " + (opts.danger ? "btn-danger-solid" : "btn-primary"), opts.confirmLabel || "Ya, Lanjutkan");
    ok.type = "button";
    actions.append(cancel, ok);
    card.append(p, actions);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
    ok.focus();

    const close = (val) => {
      document.removeEventListener("keydown", onKey);
      backdrop.remove();
      resolve(val);
    };
    const onKey = (e) => {
      if (e.key === "Escape") close(false);
    };
    document.addEventListener("keydown", onKey);
    cancel.addEventListener("click", () => close(false));
    ok.addEventListener("click", () => close(true));
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close(false);
    });
  });
}

function showToast(msg, isError) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.toggle("error", !!isError);
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3500);
}

function flashToast(msg) {
  storageSet(sessionStorage, "abuya_flash", msg);
}

function showFlash() {
  const msg = storageGet(sessionStorage, "abuya_flash");
  if (msg) {
    storageRemove(sessionStorage, "abuya_flash");
    showToast(msg);
  }
}

function initials(name) {
  return String(name).split(/[.\s_-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
}

function formatNumber(n) {
  return new Intl.NumberFormat("id-ID").format(n || 0);
}

function parseDay(isoDate) {
  return new Date(isoDate + "T00:00:00");
}

function formatDay(isoDate) {
  if (!isoDate) return "-";
  return parseDay(isoDate).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function formatDateTime(iso) {
  if (!iso) return "-";
  return parseDateTime(iso).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function parseDateTime(iso) {
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? iso : iso + "Z");
}

function formatDMY(value, isDateOnly) {
  if (!value) return "-";
  const d = isDateOnly ? parseDay(value) : parseDateTime(value);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return dd + "-" + mm + "-" + d.getFullYear();
}

function todayISO() {
  const wib = new Date(Date.now() + 7 * 3600 * 1000);
  return wib.toISOString().slice(0, 10);
}

function addDaysISO(iso, days) {
  const d = parseDay(iso);
  d.setDate(d.getDate() + days);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + mm + "-" + dd;
}

function timeAgo(iso) {
  const diff = Math.floor((Date.now() - parseDateTime(iso).getTime()) / 1000);
  if (diff < 60) return "Baru saja";
  if (diff < 3600) return Math.floor(diff / 60) + " menit lalu";
  if (diff < 86400) return Math.floor(diff / 3600) + " jam lalu";
  if (diff < 604800) return Math.floor(diff / 86400) + " hari lalu";
  return formatDateTime(iso);
}

const PO_EXPORT_HEADERS = ["Purchase Date", "Required Date", "PO Number", "PR Number", "Branch", "Product Name", "Unit", "Purchase Qty", "Shipping", "PIC", "Notes", "PO Created By"];
const PO_EXPORT_WIDTHS = [14, 14, 18, 18, 24, 28, 9, 13, 10, 18, 24, 15];

async function downloadPOExcel(rows, filename) {
  if (typeof ExcelJS === "undefined") {
    showToast("Library Excel belum termuat. Coba refresh halaman.", true);
    return;
  }
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Purchase Order");
  ws.columns = PO_EXPORT_HEADERS.map((header, i) => ({ header, width: PO_EXPORT_WIDTHS[i] }));
  ws.getRow(1).eachCell((cell) => {
    cell.font = { name: "Arial", size: 10, italic: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF163E64" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = { top: { style: "dashed" }, bottom: { style: "dashed" }, left: { style: "dashed" }, right: { style: "dashed" } };
  });
  rows.forEach((r) => {
    ws.addRow([
      formatDMY(r.purchase_date),
      formatDMY(r.required_date, true),
      r.po_number,
      r.pr_number,
      r.branch,
      r.product_name,
      r.unit,
      r.qty === null ? "" : r.qty,
      r.shipping,
      r.pic,
      r.notes,
      r.created_by
    ]);
  });
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function getToken() {
  return storageGet(localStorage, TOKEN_KEY) || storageGet(sessionStorage, TOKEN_KEY);
}

function clearToken() {
  storageRemove(localStorage, TOKEN_KEY);
  storageRemove(sessionStorage, TOKEN_KEY);
}

function storageGet(store, k) {
  try { return store.getItem(k); } catch (e) { return null; }
}

function storageSet(store, k, v) {
  try { store.setItem(k, v); } catch (e) {}
}

function storageRemove(store, k) {
  try { store.removeItem(k); } catch (e) {}
}

const SELECT_VALUE = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
const CHEVRON_SVG = '<svg viewBox="0 0 360 360" aria-hidden="true"><path d="M325.6 79.4c-5.9-5.9-15.4-5.9-21.2 0L180 203.8 55.6 79.4c-5.9-5.9-15.4-5.9-21.2 0s-5.9 15.4 0 21.2l135 135c2.9 2.9 6.8 4.4 10.6 4.4s7.7-1.5 10.6-4.4l135-135c5.9-5.8 5.9-15.3 0-21.2z"/></svg>';
let openSelect = null;

function enhanceSelect(select) {
  if (select._cs) return;
  const wrap = el("div", "cs");
  select.parentNode.insertBefore(wrap, select);
  wrap.appendChild(select);
  select.classList.add("cs-native");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");

  const trigger = el("button", "cs-trigger");
  trigger.type = "button";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  const label = el("span", "cs-label");
  trigger.appendChild(label);
  trigger.insertAdjacentHTML("beforeend", CHEVRON_SVG);
  wrap.appendChild(trigger);

  if (select.id) trigger.id = select.id + "Trigger";
  const labelEl = select.id ? document.querySelector('label[for="' + select.id + '"]') : null;
  if (labelEl) labelEl.htmlFor = trigger.id;
  const aria = select.getAttribute("aria-label");
  if (aria) trigger.setAttribute("aria-label", aria);

  const panel = el("div", "cs-panel");
  panel.setAttribute("role", "listbox");
  const searchBox = el("div", "cs-search");
  const search = el("input");
  search.type = "search";
  search.placeholder = "Cari...";
  search.setAttribute("aria-label", "Cari pilihan");
  searchBox.appendChild(search);
  const list = el("div", "cs-options");
  panel.append(searchBox, list);
  document.body.appendChild(panel);

  const cs = { wrap, trigger, panel, list, search, active: -1, items: [] };
  select._cs = cs;

  const options = () => Array.from(select.options).filter((o) => !o.disabled && !(select.required && o.value === ""));

  const refresh = () => {
    const opt = select.options[select.selectedIndex];
    label.textContent = opt ? opt.textContent : "";
    trigger.classList.toggle("placeholder", !select.value);
    trigger.disabled = select.disabled;
    trigger.classList.toggle("invalid", select.classList.contains("invalid"));
    if (wrap.classList.contains("open")) renderOptions();
  };

  const renderOptions = () => {
    const q = search.value.trim().toLowerCase();
    list.innerHTML = "";
    cs.items = options().filter((o) => !q || o.textContent.toLowerCase().includes(q));
    if (!cs.items.length) {
      list.appendChild(el("div", "cs-empty", "Tidak ada yang cocok."));
      cs.active = -1;
      return;
    }
    cs.items.forEach((o, i) => {
      const item = el("button", "cs-option" + (o.value === select.value ? " selected" : ""));
      item.type = "button";
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", o.value === select.value ? "true" : "false");
      item.textContent = o.textContent;
      item.addEventListener("mousedown", (e) => e.preventDefault());
      item.addEventListener("click", () => choose(o.value));
      item.addEventListener("mousemove", () => setActive(i, false));
      list.appendChild(item);
    });
    const sel = cs.items.findIndex((o) => o.value === select.value);
    setActive(sel >= 0 ? sel : 0, true);
  };

  const setActive = (i, scroll) => {
    cs.active = i;
    Array.from(list.children).forEach((c, idx) => c.classList.toggle("active", idx === i));
    const node = list.children[i];
    if (scroll && node && node.scrollIntoView) node.scrollIntoView({ block: "nearest" });
  };

  const position = () => {
    const r = trigger.getBoundingClientRect();
    panel.style.width = r.width + "px";
    const h = panel.offsetHeight;
    const below = window.innerHeight - r.bottom - 8;
    const up = h > below && r.top - 8 > below;
    panel.classList.toggle("up", up);
    wrap.classList.toggle("up", up);
    panel.style.left = r.left + "px";
    if (up) {
      panel.style.top = "auto";
      panel.style.bottom = window.innerHeight - r.top + "px";
    } else {
      panel.style.bottom = "auto";
      panel.style.top = r.bottom + "px";
    }
  };

  const open = () => {
    if (select.disabled) return;
    if (openSelect && openSelect !== cs) openSelect.close();
    if (openDate) openDate.close(false);
    openSelect = cs;
    search.value = "";
    searchBox.hidden = options().length <= 8;
    wrap.classList.add("open");
    trigger.setAttribute("aria-expanded", "true");
    renderOptions();
    position();
    panel.classList.add("show");
    if (!searchBox.hidden) setTimeout(() => search.focus({ preventScroll: true }), 30);
  };

  const close = (refocus) => {
    if (!wrap.classList.contains("open")) return;
    wrap.classList.remove("open");
    panel.classList.remove("show");
    trigger.setAttribute("aria-expanded", "false");
    if (openSelect === cs) openSelect = null;
    if (refocus) trigger.focus({ preventScroll: true });
  };

  const choose = (value) => {
    const changed = value !== select.value;
    SELECT_VALUE.set.call(select, value);
    refresh();
    close(true);
    if (changed) select.dispatchEvent(new Event("change", { bubbles: true }));
  };

  cs.close = close;

  trigger.addEventListener("click", () => (wrap.classList.contains("open") ? close(false) : open()));

  const onKey = (e) => {
    const isOpen = wrap.classList.contains("open");
    if (!isOpen) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key) && e.target === trigger) {
        e.preventDefault();
        open();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(cs.active + 1, cs.items.length - 1), true);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(cs.active - 1, 0), true);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (cs.items[cs.active]) choose(cs.items[cs.active].value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") {
      close(false);
    }
  };
  trigger.addEventListener("keydown", onKey);
  search.addEventListener("keydown", onKey);
  search.addEventListener("input", renderOptions);

  document.addEventListener("mousedown", (e) => {
    if (!wrap.classList.contains("open")) return;
    if (wrap.contains(e.target) || panel.contains(e.target)) return;
    close(false);
  });
  window.addEventListener("scroll", (e) => {
    if (!wrap.classList.contains("open")) return;
    if (e.target && panel.contains(e.target)) return;
    close(false);
  }, true);
  window.addEventListener("resize", () => close(false));

  Object.defineProperty(select, "value", {
    configurable: true,
    get() { return SELECT_VALUE.get.call(select); },
    set(v) { SELECT_VALUE.set.call(select, v); refresh(); }
  });
  select.focus = () => trigger.focus();

  new MutationObserver(refresh).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "class"] });
  refresh();
}

const INPUT_VALUE = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
const DP_WEEKDAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const DP_MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const DP_MONTHS_LONG = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
let openDate = null;

function isoOf(y, m, d) {
  return y + "-" + String(m + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
}

function enhanceDate(input) {
  if (input._dp) return;
  const wrap = el("div", "dp");
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  input.tabIndex = -1;
  input.setAttribute("aria-hidden", "true");

  const trigger = el("button", "dp-trigger");
  trigger.type = "button";
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");
  const label = el("span", "dp-label");
  trigger.append(label, el("span", "dp-icon"));
  wrap.appendChild(trigger);

  if (input.id) trigger.id = input.id + "Trigger";
  const labelEl = input.id ? document.querySelector('label[for="' + input.id + '"]') : null;
  if (labelEl) labelEl.htmlFor = trigger.id;
  const aria = input.getAttribute("aria-label");
  if (aria) trigger.setAttribute("aria-label", aria);
  const placeholder = input.getAttribute("placeholder") || aria || "Pilih tanggal";

  const pop = el("div", "dp-pop");
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", aria || "Pilih tanggal");
  const head = el("div", "dp-head");
  const prev = el("button", "dp-nav prev");
  prev.type = "button";
  prev.setAttribute("aria-label", "Sebelumnya");
  const title = el("button", "dp-title");
  title.type = "button";
  const next = el("button", "dp-nav next");
  next.type = "button";
  next.setAttribute("aria-label", "Berikutnya");
  head.append(prev, title, next);
  const body = el("div", "dp-body");
  const foot = el("div", "dp-foot");
  const clearBtn = el("button", "dp-link", "Hapus");
  clearBtn.type = "button";
  const todayBtn = el("button", "dp-link strong", "Hari ini");
  todayBtn.type = "button";
  foot.append(clearBtn, todayBtn);
  pop.append(head, body, foot);
  document.body.appendChild(pop);

  const st = { view: "days", year: 0, month: 0, focus: "" };
  input._dp = st;

  const min = () => input.getAttribute("min") || "";
  const max = () => input.getAttribute("max") || "";
  const allowed = (iso) => (!min() || iso >= min()) && (!max() || iso <= max());
  const monthAllowed = (y, m) => {
    const first = isoOf(y, m, 1);
    const last = isoOf(y, m, new Date(y, m + 1, 0).getDate());
    return (!min() || last >= min()) && (!max() || first <= max());
  };

  const refresh = () => {
    const v = INPUT_VALUE.get.call(input);
    label.textContent = v ? formatDay(v) : placeholder;
    label.classList.toggle("placeholder", !v);
    trigger.disabled = input.disabled;
    trigger.classList.toggle("invalid", input.classList.contains("invalid"));
    if (wrap.classList.contains("open")) render();
  };

  const render = (anim) => {
    body.innerHTML = "";
    const today = todayISO();
    const value = INPUT_VALUE.get.call(input);
    if (st.view === "days") {
      title.textContent = DP_MONTHS_LONG[st.month] + " " + st.year;
      title.setAttribute("aria-label", "Pilih bulan, " + title.textContent);
      prev.disabled = !monthAllowed(st.month === 0 ? st.year - 1 : st.year, (st.month + 11) % 12);
      next.disabled = !monthAllowed(st.month === 11 ? st.year + 1 : st.year, (st.month + 1) % 12);
      const week = el("div", "dp-week");
      DP_WEEKDAYS.forEach((d) => week.appendChild(el("span", "", d)));
      const grid = el("div", "dp-grid" + (anim ? " " + anim : ""));
      grid.setAttribute("role", "grid");
      const first = new Date(st.year, st.month, 1);
      const offset = (first.getDay() + 6) % 7;
      const start = new Date(st.year, st.month, 1 - offset);
      for (let i = 0; i < 42; i++) {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        if (i >= 35 && d.getMonth() !== st.month) break;
        const iso = isoOf(d.getFullYear(), d.getMonth(), d.getDate());
        const btn = el("button", "dp-day", String(d.getDate()));
        btn.type = "button";
        btn.dataset.iso = iso;
        btn.setAttribute("aria-label", formatDay(iso));
        if (d.getMonth() !== st.month) btn.classList.add("out");
        if (iso === today) btn.classList.add("today");
        if (iso === value) {
          btn.classList.add("selected");
          btn.setAttribute("aria-pressed", "true");
        }
        btn.disabled = !allowed(iso);
        btn.tabIndex = iso === st.focus ? 0 : -1;
        btn.addEventListener("click", () => pick(iso));
        grid.appendChild(btn);
      }
      body.append(week, grid);
    } else {
      title.textContent = String(st.year);
      title.setAttribute("aria-label", "Kembali ke kalender " + st.year);
      prev.disabled = !!min() && st.year - 1 < Number(min().slice(0, 4));
      next.disabled = !!max() && st.year + 1 > Number(max().slice(0, 4));
      const grid = el("div", "dp-months" + (anim ? " " + anim : ""));
      const cur = today.slice(0, 7);
      const sel = value ? value.slice(0, 7) : "";
      DP_MONTHS.forEach((name, m) => {
        const key = st.year + "-" + String(m + 1).padStart(2, "0");
        const btn = el("button", "dp-month", name);
        btn.type = "button";
        if (key === cur) btn.classList.add("today");
        if (key === sel) btn.classList.add("selected");
        btn.disabled = !monthAllowed(st.year, m);
        btn.addEventListener("click", () => {
          st.month = m;
          st.view = "days";
          st.focus = firstFocusable();
          render("zoom");
          focusDay();
        });
        grid.appendChild(btn);
      });
      body.appendChild(grid);
    }
    clearBtn.disabled = !value;
    todayBtn.disabled = !allowed(today);
  };

  const firstFocusable = () => {
    const value = INPUT_VALUE.get.call(input);
    if (value && value.slice(0, 7) === isoOf(st.year, st.month, 1).slice(0, 7)) return value;
    const today = todayISO();
    if (today.slice(0, 7) === isoOf(st.year, st.month, 1).slice(0, 7) && allowed(today)) return today;
    const days = new Date(st.year, st.month + 1, 0).getDate();
    for (let d = 1; d <= days; d++) {
      const iso = isoOf(st.year, st.month, d);
      if (allowed(iso)) return iso;
    }
    return isoOf(st.year, st.month, 1);
  };

  const focusDay = () => {
    const btn = body.querySelector('.dp-day[data-iso="' + st.focus + '"]');
    if (btn) btn.focus({ preventScroll: true });
  };

  const shiftMonth = (delta) => {
    const d = new Date(st.year, st.month + delta, 1);
    st.year = d.getFullYear();
    st.month = d.getMonth();
  };

  const position = () => {
    const r = trigger.getBoundingClientRect();
    const w = 296;
    const h = pop.offsetHeight || 380;
    const below = window.innerHeight - r.bottom;
    const up = below < h + 12 && r.top > below;
    pop.classList.toggle("up", up);
    const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    pop.style.left = left + "px";
    pop.style.top = (up ? r.top - h - 6 : r.bottom + 6) + "px";
  };

  const open = () => {
    if (input.disabled) return;
    if (openDate && openDate !== st) openDate.close(false);
    if (typeof openSelect !== "undefined" && openSelect) openSelect.close(false);
    openDate = st;
    const base = INPUT_VALUE.get.call(input) || (min() && todayISO() < min() ? min() : todayISO());
    st.year = Number(base.slice(0, 4));
    st.month = Number(base.slice(5, 7)) - 1;
    st.view = "days";
    st.focus = firstFocusable();
    render();
    wrap.classList.add("open");
    trigger.setAttribute("aria-expanded", "true");
    position();
    pop.classList.add("show");
    setTimeout(focusDay, 40);
  };

  const close = (refocus) => {
    if (!wrap.classList.contains("open")) return;
    wrap.classList.remove("open");
    pop.classList.remove("show");
    trigger.setAttribute("aria-expanded", "false");
    if (openDate === st) openDate = null;
    if (refocus) trigger.focus({ preventScroll: true });
  };
  st.close = close;

  const setValue = (v) => {
    const changed = v !== INPUT_VALUE.get.call(input);
    INPUT_VALUE.set.call(input, v);
    refresh();
    if (changed) input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const pick = (iso) => {
    if (!allowed(iso)) return;
    setValue(iso);
    close(true);
  };

  trigger.addEventListener("click", () => (wrap.classList.contains("open") ? close(false) : open()));
  trigger.addEventListener("keydown", (e) => {
    if (["ArrowDown", "Enter", " "].includes(e.key) && !wrap.classList.contains("open")) {
      e.preventDefault();
      open();
    }
  });

  prev.addEventListener("click", () => {
    if (st.view === "days") {
      shiftMonth(-1);
      st.focus = firstFocusable();
      render("slide-prev");
    } else {
      st.year -= 1;
      render("slide-prev");
    }
  });
  next.addEventListener("click", () => {
    if (st.view === "days") {
      shiftMonth(1);
      st.focus = firstFocusable();
      render("slide-next");
    } else {
      st.year += 1;
      render("slide-next");
    }
  });
  title.addEventListener("click", () => {
    st.view = st.view === "days" ? "months" : "days";
    if (st.view === "days") st.focus = firstFocusable();
    render("zoom");
    if (st.view === "days") focusDay();
  });
  clearBtn.addEventListener("click", () => {
    setValue("");
    close(true);
  });
  todayBtn.addEventListener("click", () => pick(todayISO()));

  pop.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (st.view !== "days" || !e.target.classList.contains("dp-day")) return;
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (moves[e.key] !== undefined || e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      const cur = parseDay(e.target.dataset.iso);
      if (e.key === "PageUp") cur.setMonth(cur.getMonth() - 1);
      else if (e.key === "PageDown") cur.setMonth(cur.getMonth() + 1);
      else cur.setDate(cur.getDate() + moves[e.key]);
      const iso = isoOf(cur.getFullYear(), cur.getMonth(), cur.getDate());
      const anim = iso.slice(0, 7) > isoOf(st.year, st.month, 1).slice(0, 7) ? "slide-next" : iso.slice(0, 7) < isoOf(st.year, st.month, 1).slice(0, 7) ? "slide-prev" : "";
      st.year = cur.getFullYear();
      st.month = cur.getMonth();
      st.focus = iso;
      if (anim) render(anim);
      else Array.from(body.querySelectorAll(".dp-day")).forEach((b) => { b.tabIndex = b.dataset.iso === iso ? 0 : -1; });
      focusDay();
    }
  });

  document.addEventListener("mousedown", (e) => {
    if (!wrap.classList.contains("open")) return;
    if (wrap.contains(e.target) || pop.contains(e.target)) return;
    close(false);
  });
  window.addEventListener("scroll", (e) => {
    if (!wrap.classList.contains("open")) return;
    if (e.target && pop.contains(e.target)) return;
    close(false);
  }, true);
  window.addEventListener("resize", () => close(false));

  Object.defineProperty(input, "value", {
    configurable: true,
    get() { return INPUT_VALUE.get.call(input); },
    set(v) { INPUT_VALUE.set.call(input, v); refresh(); }
  });
  input.focus = () => trigger.focus();

  new MutationObserver(refresh).observe(input, { attributes: true, attributeFilter: ["disabled", "class", "min", "max"] });
  refresh();
}