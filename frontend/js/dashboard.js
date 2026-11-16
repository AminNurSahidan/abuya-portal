const STAT_ICONS = {
  Pending: "pending_actions",
  Approved: "task_alt",
  Rejected: "block",
  Expired: "event_busy"
};

const ACTIVITY_ICONS = {
  auth: { icon: "login", tone: "slate" },
  approval: { icon: "approval", tone: "blue" },
  users: { icon: "manage_accounts", tone: "green" },
  master: { icon: "database", tone: "slate" }
};

const filters = { branch: "", from: "", to: "" };
let loadSeq = 0;

bootApp(async (user) => {
  $("todayDate").textContent = new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  $("greeting").textContent = greetingByHour();
  $("heroName").textContent = user.username;
  $("heroCreate").hidden = !canCreatePR(user);
  $("mappingNotice").hidden = !hasNoMapping(user);

  $("fBranch").addEventListener("change", (e) => { filters.branch = e.target.value; load(); });
  $("fFrom").addEventListener("change", (e) => { filters.from = e.target.value; load(); });
  $("fTo").addEventListener("change", (e) => { filters.to = e.target.value; load(); });
  $("fReset").addEventListener("click", () => {
    filters.branch = "";
    filters.from = "";
    filters.to = "";
    $("fBranch").value = "";
    $("fFrom").value = "";
    $("fTo").value = "";
    load();
  });

  renderStatSkeleton();
  await load(true);
});

async function load(first) {
  const seq = ++loadSeq;
  $("fReset").hidden = !(filters.branch || filters.from || filters.to);
  try {
    const data = await api("/dashboard/summary" + qs({
      brand_id: activeBrandId(),
      branch_id: filters.branch,
      date_from: filters.from,
      date_to: filters.to
    }));
    if (seq !== loadSeq) return;
    if (first) fillBranchSelect($("fBranch"), data.branches, filters.branch, "Semua cabang");
    renderStats(data);
    renderExpiring(data.expiring);
    renderTop($("topPo"), data.top_by_po, "x");
    renderTop($("topQty"), data.top_by_qty, "");
    renderActivity(data.activity);
    renderBranches(data.branches);
  } catch (err) {
    if (err.status === 401) return;
    showToast(err.message, true);
  }
}

function renderStatSkeleton() {
  const box = $("statCards");
  box.innerHTML = "";
  PR_STATUSES.forEach(() => box.appendChild(el("div", "skeleton stat-skel")));
}

function renderStats(data) {
  const box = $("statCards");
  box.innerHTML = "";
  PR_STATUSES.forEach((s) => {
    const count = data.status_counts[s.key] || 0;
    const a = el("a", "stat");
    a.href = "purchase-request.html" + qs({ status: s.key, branch: filters.branch });
    const ic = el("div", "stat-icon tone-" + s.tone);
    ic.appendChild(icon_(STAT_ICONS[s.key]));
    const body = el("div", "stat-body");
    body.append(el("span", "stat-label", "PR " + s.label), el("span", "stat-value", formatNumber(count)));
    const pct = data.total ? Math.round((count / data.total) * 100) : 0;
    body.appendChild(el("span", "stat-pct", pct + "% dari " + formatNumber(data.total) + " PR"));
    a.append(ic, body);
    box.appendChild(a);
  });
}

function renderExpiring(rows) {
  const list = $("expiringList");
  list.innerHTML = "";
  $("expiringMeta").textContent = rows.length ? rows.length + " PR" : "";
  if (!rows.length) {
    const li = el("li");
    li.appendChild(emptyBlock("event_available", "Tidak ada PR Pending yang expired besok."));
    list.appendChild(li);
    return;
  }
  rows.forEach((r) => {
    const li = el("li");
    const a = el("a");
    a.href = "purchase-request-detail.html?id=" + r.id;
    const ic = el("span", "ex-icon");
    ic.appendChild(icon_("timer"));
    const body = el("span", "ex-body");
    body.append(el("span", "ex-no", r.number), el("span", "ex-branch", r.branch));
    const chev = icon_("chevron_right");
    chev.classList.add("chev");
    a.append(ic, body, chev);
    li.appendChild(a);
    list.appendChild(li);
  });
}

function renderTop(list, rows, suffix) {
  list.innerHTML = "";
  if (!rows.length) {
    const li = el("li");
    li.appendChild(emptyBlock("bar_chart", "Belum ada data PO."));
    list.appendChild(li);
    return;
  }
  const max = Math.max(...rows.map((r) => r.value), 1);
  rows.forEach((r, i) => {
    const li = el("li");
    const bar = el("span", "top-bar");
    const fill = el("span");
    fill.style.width = Math.max(4, Math.round((r.value / max) * 100)) + "%";
    bar.appendChild(fill);
    const name = el("span", "top-name", r.item_name);
    name.title = r.item_name;
    li.append(el("span", "top-rank", String(i + 1)), name, bar, el("span", "top-value", formatNumber(r.value) + suffix));
    list.appendChild(li);
  });
}

function renderActivity(rows) {
  const list = $("activityList");
  list.innerHTML = "";
  if (!rows.length) {
    const li = el("li");
    li.appendChild(emptyBlock("history", "Belum ada aktivitas."));
    list.appendChild(li);
    return;
  }
  rows.forEach((r) => {
    const conf = ACTIVITY_ICONS[r.module] || ACTIVITY_ICONS.approval;
    const li = el("li");
    const ic = el("div", "activity-icon tone-" + conf.tone);
    ic.appendChild(icon_(conf.icon));
    const body = el("div", "activity-body");
    const text = el("p", "activity-text");
    text.append(el("strong", "", r.actor_name), document.createTextNode(" " + r.description));
    body.append(text, el("span", "activity-time", timeAgo(r.created_at)));
    li.append(ic, body);
    list.appendChild(li);
  });
}

function renderBranches(rows) {
  const list = $("branchList");
  list.innerHTML = "";
  const scoped = ["SM", "AM", "AMKA"].includes(App.user.role);
  $("branchPanelTitle").textContent = scoped ? "Cabang saya" : "Cabang";
  $("branchCount").textContent = rows.length ? rows.length + " cabang" : "";
  if (!rows.length) {
    const li = el("li");
    li.appendChild(emptyBlock("storefront", scoped ? "Belum ada cabang yang di-mapping." : "Belum ada cabang."));
    list.appendChild(li);
    return;
  }
  const limit = 8;
  rows.slice(0, limit).forEach((b) => {
    const li = el("li");
    li.append(icon_("storefront"), el("span", "", b.name));
    if (b.brand) li.appendChild(el("span", "brand-tag", b.brand.code));
    list.appendChild(li);
  });
  if (rows.length > limit) {
    list.appendChild(el("li", "more", "+" + (rows.length - limit) + " cabang lainnya"));
  }
}

function greetingByHour() {
  const h = new Date().getHours();
  if (h < 11) return "Selamat pagi";
  if (h < 15) return "Selamat siang";
  if (h < 18) return "Selamat sore";
  return "Selamat malam";
}