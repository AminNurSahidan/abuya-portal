const API_BASE = "/api";
const TOKEN_KEY = "abuya_token";
const LOGIN_PAGE = "login.html";

const ROLE_LABELS = {
  admin: "Admin",
  am: "Area Manager",
  amka: "AMKA",
  approver: "Approver",
  gudang: "Staff Gudang",
  staff: "Staff"
};

const STAT_FIELDS = {
  statPending: "pending_pr",
  statPo: "po_this_month",
  statLow: "low_stock",
  statOpname: "opname_running"
};

const ACTIVITY_ICONS = {
  auth: { icon: "login", cls: "slate" },
  users: { icon: "manage_accounts", cls: "blue" },
  master: { icon: "database", cls: "slate" },
  approval: { icon: "approval", cls: "blue" },
  inventory: { icon: "inventory_2", cls: "green" },
  opname: { icon: "fact_check", cls: "slate" },
  warning: { icon: "warning", cls: "amber" }
};

const $ = (id) => document.getElementById(id);

const sidebar = $("sidebar");
const overlay = $("overlay");
const userBtn = $("userBtn");
const userDropdown = $("userDropdown");

init();

async function init() {
  $("year").textContent = new Date().getFullYear();
  renderDate();
  bindUI();

  if (!getToken()) {
    window.location.replace(LOGIN_PAGE);
    return;
  }

  try {
    const user = await api("/auth/me");
    renderUser(user);
    document.body.classList.remove("is-loading");
    const summary = await api("/dashboard/summary");
    renderStats(summary.stats || {});
    renderActivity(summary.activity || []);
    renderBranches(summary.branches || []);
  } catch (err) {
    if (err.status === 401) return;
    document.body.classList.remove("is-loading");
    renderActivityError();
    renderBranchesError();
    showToast(err.message || "Gagal memuat data.", true);
  }
}

async function api(path, options = {}) {
  const headers = Object.assign({ Authorization: "Bearer " + getToken() }, options.headers || {});
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";

  let res;
  try {
    res = await fetch(API_BASE + path, Object.assign({}, options, { headers }));
  } catch (e) {
    const err = new Error("Gagal terhubung ke server.");
    err.status = 0;
    throw err;
  }

  if (res.status === 401) {
    clearToken();
    window.location.replace(LOGIN_PAGE);
    const err = new Error("Sesi berakhir.");
    err.status = 401;
    throw err;
  }

  if (res.status === 204) return null;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(typeof data.detail === "string" ? data.detail : "Terjadi kesalahan.");
    err.status = res.status;
    throw err;
  }
  return data;
}

function bindUI() {
  $("menuBtn").addEventListener("click", () => toggleSidebar(true));
  overlay.addEventListener("click", () => toggleSidebar(false));

  userBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    userDropdown.classList.toggle("show");
  });

  document.addEventListener("click", (e) => {
    if (!userDropdown.contains(e.target)) userDropdown.classList.remove("show");
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      userDropdown.classList.remove("show");
      toggleSidebar(false);
    }
  });

  $("logoutBtn").addEventListener("click", logout);
  $("logoutBtn2").addEventListener("click", logout);

  $("searchInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.value.trim()) {
      window.location.href = "search.html?q=" + encodeURIComponent(e.target.value.trim());
    }
  });

  $("notifBtn").addEventListener("click", () => {
    window.location.href = "purchase-request.html?status=pending";
  });
}

function toggleSidebar(open) {
  sidebar.classList.toggle("open", open);
  overlay.classList.toggle("show", open);
  document.documentElement.classList.toggle("no-scroll", open);
  document.body.classList.toggle("no-scroll", open);
}

async function logout() {
  try {
    await api("/auth/logout", { method: "POST" });
  } catch (e) {}
  clearToken();
  window.location.replace(LOGIN_PAGE);
}

function renderUser(user) {
  const name = user.full_name || user.email.split("@")[0];
  const firstName = name.split(" ")[0];

  $("userName").textContent = name;
  $("userRole").textContent = ROLE_LABELS[user.role] || user.role;
  $("userEmail").textContent = user.email;
  $("userAvatar").textContent = initials(name);
  $("heroName").textContent = firstName;
  $("greeting").textContent = greetingByHour();

  if (user.role === "admin") {
    document.querySelectorAll(".admin-only").forEach((el) => { el.hidden = false; });
  }
}

function renderStats(stats) {
  Object.entries(STAT_FIELDS).forEach(([el, key]) => {
    const v = stats[key];
    $(el).textContent = typeof v === "number" ? formatNumber(v) : "-";
  });

  const pending = stats.pending_pr;
  if (typeof pending === "number" && pending > 0) {
    const badge = $("navPendingBadge");
    badge.textContent = pending > 99 ? "99+" : pending;
    badge.hidden = false;
    $("notifDot").hidden = false;
  }
}

function renderActivity(rows) {
  const list = $("activityList");
  list.innerHTML = "";

  if (!rows.length) {
    list.appendChild(emptyState("history", "Belum ada aktivitas."));
    return;
  }

  rows.forEach((row) => {
    const conf = ACTIVITY_ICONS[row.module] || ACTIVITY_ICONS.approval;
    const li = document.createElement("li");
    li.className = "activity-item";

    const icon = document.createElement("div");
    icon.className = "activity-icon " + conf.cls;
    const iconInner = document.createElement("span");
    iconInner.className = "material-symbols-outlined";
    iconInner.textContent = conf.icon;
    icon.appendChild(iconInner);

    const body = document.createElement("div");
    body.className = "activity-body";

    const text = document.createElement("p");
    text.className = "activity-text";
    const actor = document.createElement("strong");
    actor.textContent = row.actor_name || "Sistem";
    text.append(actor, " " + (row.description || ""));

    const time = document.createElement("span");
    time.className = "activity-time";
    time.textContent = timeAgo(row.created_at);

    body.append(text, time);
    li.append(icon, body);
    list.appendChild(li);
  });
}

function renderActivityError() {
  const list = $("activityList");
  list.innerHTML = "";
  list.appendChild(emptyState("history", "Aktivitas belum bisa dimuat."));
}

function renderBranches(rows) {
  const list = $("branchList");
  list.innerHTML = "";

  if (!rows.length) {
    list.appendChild(emptyState("storefront", "Belum ada cabang yang di-assign."));
    return;
  }

  rows.forEach((b) => {
    const li = document.createElement("li");
    li.className = "branch-item";

    const icon = document.createElement("span");
    icon.className = "material-symbols-outlined";
    icon.textContent = "storefront";

    const name = document.createElement("span");
    name.textContent = b.name || "-";

    li.append(icon, name);

    if (b.brand && b.brand.name) {
      const brand = document.createElement("span");
      brand.className = "branch-brand";
      brand.textContent = b.brand.name;
      li.appendChild(brand);
    }

    list.appendChild(li);
  });
}

function renderBranchesError() {
  const list = $("branchList");
  list.innerHTML = "";
  list.appendChild(emptyState("storefront", "Data cabang belum bisa dimuat."));
}

function emptyState(iconName, msg) {
  const li = document.createElement("li");
  li.className = "empty";
  const icon = document.createElement("span");
  icon.className = "material-symbols-outlined";
  icon.textContent = iconName;
  const text = document.createElement("span");
  text.textContent = msg;
  li.append(icon, text);
  return li;
}

function renderDate() {
  $("todayDate").textContent = new Date().toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

function greetingByHour() {
  const h = new Date().getHours();
  if (h < 11) return "Selamat pagi";
  if (h < 15) return "Selamat siang";
  if (h < 18) return "Selamat sore";
  return "Selamat malam";
}

function initials(name) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

function formatNumber(n) {
  return new Intl.NumberFormat("id-ID").format(n);
}

function timeAgo(iso) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "Baru saja";
  if (diff < 3600) return Math.floor(diff / 60) + " menit lalu";
  if (diff < 86400) return Math.floor(diff / 3600) + " jam lalu";
  if (diff < 604800) return Math.floor(diff / 86400) + " hari lalu";
  return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
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

function storageRemove(store, k) {
  try { store.removeItem(k); } catch (e) {}
}

let toastTimer;
function showToast(msg, isError) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.toggle("error", !!isError);
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3000);
}