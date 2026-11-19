const DEFAULTS = { module: "", q: "", from: "", to: "", page: 1 };
const PAGE_SIZE = 30;

const MODULE_CONF = {
  approval: { icon: "approval", tone: "blue" },
  warehouse: { icon: "warehouse", tone: "teal" },
  master: { icon: "database", tone: "slate" },
  users: { icon: "manage_accounts", tone: "green" },
  roles: { icon: "admin_panel_settings", tone: "amber" },
  auth: { icon: "login", tone: "slate" }
};

const ACTION_CONF = {
  create_pr: { icon: "add_circle", tone: "blue" },
  approve_pr: { icon: "task_alt", tone: "green" },
  reject_pr: { icon: "block", tone: "red" },
  add_item: { icon: "playlist_add", tone: "amber" },
  update_item: { icon: "edit", tone: "amber" },
  delete_item: { icon: "playlist_remove", tone: "amber" },
  save_draft: { icon: "save", tone: "slate" },
  delete_pr: { icon: "delete", tone: "red" },
  delete_po: { icon: "delete", tone: "red" },
  login: { icon: "login", tone: "slate" },
  logout: { icon: "logout", tone: "slate" }
};

const state = readParams(DEFAULTS);
let modules = {};
let byModule = {};
let listSeq = 0;
let searchTimer;

const isMaster = () => App.user && App.user.role === "Master";
const columns = () => (isMaster() ? ["Waktu", "Aktivitas", "Modul", "Dokumen", "Brand"] : ["Waktu", "Aktivitas", "Modul", "Dokumen"]);

bootApp(async (user) => {
  if (!can(user, "log.view")) {
    $("denyNotice").hidden = false;
    return;
  }
  $("logArea").hidden = false;
  $("pageDesc").textContent = isMaster()
    ? "Riwayat semua perubahan di Abuya Portal."
    : "Riwayat perubahan di Approval dan ABWarehouse untuk brand " + (user.brand ? user.brand.name : "kamu") + ".";
  $("fSearch").value = state.q;
  $("fFrom").value = state.from;
  $("fTo").value = state.to;
  const row = $("theadRow");
  columns().forEach((c) => row.appendChild(el("th", "", c)));
  bindFilters();
  sync();
  await loadList();
});

function bindFilters() {
  $("fSearch").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.q = e.target.value.trim();
      state.page = 1;
      sync();
      loadList();
    }, 300);
  });
  $("fFrom").addEventListener("change", (e) => { state.from = e.target.value; state.page = 1; sync(); loadList(); });
  $("fTo").addEventListener("change", (e) => { state.to = e.target.value; state.page = 1; sync(); loadList(); });
  $("resetBtn").addEventListener("click", () => {
    Object.assign(state, { q: "", from: "", to: "", page: 1 });
    $("fSearch").value = "";
    $("fFrom").value = "";
    $("fTo").value = "";
    sync();
    loadList();
  });
  $("prevBtn").addEventListener("click", () => goPage(state.page - 1));
  $("nextBtn").addEventListener("click", () => goPage(state.page + 1));
}

function sync() {
  writeParams(state, DEFAULTS);
  $("resetBtn").hidden = !(state.q || state.from || state.to);
}

function goPage(n) {
  if (n < 1) return;
  state.page = n;
  sync();
  loadList();
  document.querySelector(".table-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderTabs() {
  const box = $("moduleTabs");
  box.innerHTML = "";
  const total = Object.values(byModule).reduce((a, b) => a + b, 0);
  [{ key: "", label: "Semua", icon: "history" }]
    .concat(Object.keys(modules).map((k) => ({ key: k, label: modules[k], icon: (MODULE_CONF[k] || {}).icon || "history" })))
    .forEach((t) => {
      const active = state.module === t.key;
      const btn = el("button", "tab" + (active ? " active" : ""));
      btn.type = "button";
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", active ? "true" : "false");
      btn.append(icon_(t.icon), el("span", "", t.label));
      btn.appendChild(el("span", "tab-count", formatNumber(t.key ? byModule[t.key] || 0 : total)));
      btn.addEventListener("click", () => {
        if (state.module === t.key) return;
        state.module = t.key;
        state.page = 1;
        sync();
        renderTabs();
        loadList();
      });
      box.appendChild(btn);
    });
}

async function loadList() {
  const seq = ++listSeq;
  const body = $("tableBody");
  const cols = columns().length;
  tableSkeleton(body, cols);
  try {
    const data = await api("/logs" + qs({
      module: state.module,
      q: state.q,
      date_from: state.from,
      date_to: state.to,
      brand_id: isMaster() ? activeBrandId() : "",
      page: state.page,
      size: PAGE_SIZE
    }));
    if (seq !== listSeq) return;
    modules = data.modules;
    byModule = data.by_module;
    if (state.module && !modules[state.module]) {
      state.module = "";
      sync();
      loadList();
      return;
    }
    const pages = Math.max(1, Math.ceil(data.total / data.size));
    if (state.page > pages && data.total > 0) {
      state.page = pages;
      sync();
      loadList();
      return;
    }
    renderTabs();
    body.innerHTML = "";
    if (!data.items.length) {
      const filtered = state.q || state.from || state.to;
      let msg = filtered ? "Tidak ada log yang cocok dengan filter." : "Belum ada log.";
      if (!filtered && state.module === "warehouse") msg = "Belum ada log ABWarehouse. Log akan muncul di sini setelah modul gudang aktif di Abuya Portal.";
      tableMessage(body, cols, "history", msg);
    } else {
      data.items.forEach((r) => body.appendChild(renderRow(r)));
    }
    renderPager(data, "log");
  } catch (err) {
    if (err.status === 401 || seq !== listSeq) return;
    tableMessage(body, cols, "error", "Log belum bisa dimuat.");
    renderPager({ total: 0, page: 1, size: PAGE_SIZE }, "log");
    showToast(err.message, true);
  }
}

function renderRow(r) {
  const tr = el("tr");

  const time = el("td", "log-time");
  const tStack = el("div", "cell-stack");
  tStack.append(el("span", "cell-main", formatDateTime(r.created_at)), el("span", "cell-sub", timeAgo(r.created_at)));
  time.appendChild(tStack);

  const act = el("td");
  const box = el("div", "log-act");
  const conf = ACTION_CONF[r.action] || MODULE_CONF[r.module] || MODULE_CONF.approval;
  const ic = el("div", "log-icon tone-" + conf.tone);
  ic.appendChild(icon_(conf.icon));
  const text = el("p", "log-text");
  text.append(el("strong", "", r.actor_name), document.createTextNode(" " + r.description));
  box.append(ic, text);
  act.appendChild(box);

  const mod = el("td");
  const mConf = MODULE_CONF[r.module] || MODULE_CONF.approval;
  mod.appendChild(badge({ label: modules[r.module] || r.module, tone: mConf.tone }));

  const ref = el("td", "log-ref");
  if (r.ref && r.module === "approval" && can(App.user, "pr.view")) {
    const a = el("a", "ref-link mono", r.ref);
    a.href = "purchase-request.html?q=" + encodeURIComponent(r.ref);
    ref.appendChild(a);
  } else {
    ref.appendChild(el("span", r.ref ? "mono" : "muted", r.ref || "-"));
  }

  tr.append(time, act, mod, ref);
  if (isMaster()) {
    const brand = el("td");
    if (r.brand) brand.appendChild(el("span", "brand-tag", r.brand.name));
    else brand.appendChild(el("span", "muted", "-"));
    tr.appendChild(brand);
  }
  return tr;
}