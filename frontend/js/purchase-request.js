const DEFAULTS = { status: "", branch: "", shipping: "", q: "", from: "", to: "", sort: "created_at", dir: "desc", page: 1 };
const PAGE_SIZE = 20;
const COLUMNS = 8;
const REVIEW_ROLES = ["AM", "AMKA", "Master"];

const state = readParams(DEFAULTS);
let summary = null;
let listSeq = 0;
let summarySeq = 0;
let searchTimer;

bootApp(async (user) => {
  if (!PR_STATUSES.some((s) => s.key === state.status)) state.status = "";
  $("createBtn").hidden = !canCreatePR(user);
  $("mappingNotice").hidden = !hasNoMapping(user);

  $("fSearch").value = state.q;
  $("fShipping").value = state.shipping;
  $("fFrom").value = state.from;
  $("fTo").value = state.to;

  bindFilters();
  bindSortHeaders(state, () => { state.page = 1; sync(); loadList(); });
  renderTabs();

  try {
    const branches = await api("/branches" + qs({ brand_id: activeBrandId() }));
    state.branch = fillBranchSelect($("fBranch"), branches, state.branch);
  } catch (e) {
    fillBranchSelect($("fBranch"), [], "");
  }

  sync();
  showFlash();
  await Promise.all([loadSummary(), loadList()]);
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
  $("fBranch").addEventListener("change", (e) => setBranch(e.target.value));
  $("fShipping").addEventListener("change", (e) => { state.shipping = e.target.value; state.page = 1; sync(); loadList(); });
  $("fFrom").addEventListener("change", (e) => { state.from = e.target.value; state.page = 1; sync(); loadList(); });
  $("fTo").addEventListener("change", (e) => { state.to = e.target.value; state.page = 1; sync(); loadList(); });
  $("resetBtn").addEventListener("click", () => {
    Object.assign(state, { branch: "", shipping: "", q: "", from: "", to: "", page: 1 });
    $("fSearch").value = "";
    $("fBranch").value = "";
    $("fShipping").value = "";
    $("fFrom").value = "";
    $("fTo").value = "";
    sync();
    renderBranches();
    loadList();
  });
  $("prevBtn").addEventListener("click", () => goPage(state.page - 1));
  $("nextBtn").addEventListener("click", () => goPage(state.page + 1));
}

function sync() {
  writeParams(state, DEFAULTS);
  $("resetBtn").hidden = !(state.branch || state.shipping || state.q || state.from || state.to);
}

function setStatus(key) {
  if (state.status === key) return;
  state.status = key;
  state.page = 1;
  sync();
  renderTabs();
  loadSummary();
  loadList();
}

function setBranch(id) {
  state.branch = id ? String(id) : "";
  state.page = 1;
  $("fBranch").value = state.branch;
  sync();
  renderBranches();
  loadList();
}

function goPage(n) {
  if (n < 1) return;
  state.page = n;
  sync();
  loadList();
  document.querySelector(".table-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderTabs() {
  const box = $("statusTabs");
  box.innerHTML = "";
  [{ key: "", label: "Semua", tone: "" }].concat(PR_STATUSES).forEach((t) => {
    const active = state.status === t.key;
    const btn = el("button", "tab" + (active ? " active" : ""));
    btn.type = "button";
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", active ? "true" : "false");
    if (t.tone) btn.appendChild(el("span", "dot tone-" + t.tone));
    btn.appendChild(el("span", "", t.label));
    const count = summary ? (t.key ? summary.by_key[t.key] || 0 : summary.total) : null;
    btn.appendChild(el("span", "tab-count", count === null ? "-" : formatNumber(count)));
    btn.addEventListener("click", () => setStatus(t.key));
    box.appendChild(btn);
  });
}

async function loadSummary() {
  const seq = ++summarySeq;
  const grid = $("branchGrid");
  if (!summary) {
    grid.innerHTML = "";
    for (let i = 0; i < 3; i++) grid.appendChild(el("div", "skeleton"));
  }
  try {
    const data = await api("/purchase-requests/summary" + qs({ status: state.status, brand_id: activeBrandId() }));
    if (seq !== summarySeq) return;
    summary = data;
    renderTabs();
    renderBranches();
  } catch (err) {
    if (err.status === 401 || seq !== summarySeq) return;
    grid.innerHTML = "";
    grid.appendChild(emptyBlock("storefront", "Data cabang belum bisa dimuat."));
  }
}

function renderBranches() {
  if (!summary) return;
  const grid = $("branchGrid");
  const rows = summary.branches;
  const conf = state.status ? statusConf(state.status) : null;
  $("branchTitle").textContent = conf ? "Cabang dengan PR " + conf.label : "Semua cabang";
  const docs = rows.reduce((a, r) => a + r.count, 0);
  $("branchMeta").textContent = rows.length ? formatNumber(rows.length) + " cabang • " + formatNumber(docs) + " PR" : "";
  grid.innerHTML = "";

  if (!rows.length) {
    grid.appendChild(emptyBlock("storefront", conf ? "Tidak ada cabang dengan PR " + conf.label + "." : "Belum ada PR."));
    return;
  }

  rows.forEach((r) => {
    const b = r.branch;
    const active = state.branch === String(b.id);
    const card = el("button", "branch-card" + (active ? " active" : ""));
    card.type = "button";
    card.title = active ? "Klik lagi untuk tampilkan semua cabang" : "Tampilkan PR cabang ini";
    const top = el("div", "branch-card-top");
    const ic = el("div", "branch-card-icon");
    ic.appendChild(icon_("storefront"));
    const name = el("div", "branch-card-name");
    name.appendChild(el("strong", "", b.name));
    if (b.brand) name.appendChild(el("span", "brand-tag", b.brand.name));
    top.append(ic, name);
    const foot = el("div", "branch-card-foot");
    const count = el("span", "branch-card-count", formatNumber(r.count));
    count.appendChild(el("small", "", "PR"));
    foot.appendChild(count);
    if (conf) foot.appendChild(badge(conf));
    card.append(top, foot);
    card.addEventListener("click", () => setBranch(active ? "" : b.id));
    grid.appendChild(card);
  });
}

async function loadList() {
  const seq = ++listSeq;
  const body = $("tableBody");
  tableSkeleton(body, COLUMNS);

  try {
    const data = await api("/purchase-requests" + qs({
      status: state.status,
      branch_id: state.branch,
      shipping: state.shipping,
      q: state.q,
      date_from: state.from,
      date_to: state.to,
      brand_id: activeBrandId(),
      sort: state.sort,
      dir: state.dir,
      page: state.page,
      size: PAGE_SIZE
    }));
    if (seq !== listSeq) return;

    const pages = Math.max(1, Math.ceil(data.total / data.size));
    if (state.page > pages && data.total > 0) {
      state.page = pages;
      sync();
      loadList();
      return;
    }

    body.innerHTML = "";
    if (!data.items.length) {
      const filtered = state.status || state.branch || state.shipping || state.q || state.from || state.to;
      tableMessage(body, COLUMNS, "inbox", filtered ? "Tidak ada PR yang cocok dengan filter." : "Belum ada Purchase Request.");
    } else {
      data.items.forEach((pr) => body.appendChild(renderRow(pr)));
    }
    renderPager(data, "PR");
  } catch (err) {
    if (err.status === 401 || seq !== listSeq) return;
    tableMessage(body, COLUMNS, "error", "Data PR belum bisa dimuat.");
    renderPager({ total: 0, page: 1, size: PAGE_SIZE }, "PR");
    showToast(err.message, true);
  }
}

function renderRow(pr) {
  const tr = el("tr", "row-link");
  const href = "purchase-request-detail.html?id=" + pr.id;
  tr.addEventListener("click", (e) => {
    if (e.target.closest("a, button")) return;
    window.location.href = href;
  });

  const no = el("td");
  const noStack = el("div", "cell-stack");
  noStack.append(el("span", "doc-no mono", pr.number), el("span", "cell-sub", formatDateTime(pr.created_at)));
  no.appendChild(noStack);

  const branch = el("td");
  const bStack = el("div", "cell-stack");
  bStack.appendChild(el("span", "cell-main", pr.branch.name));
  if (pr.brand) bStack.appendChild(el("span", "brand-tag", pr.brand.name));
  branch.appendChild(bStack);

  const ship = el("td");
  const sc = shippingConf(pr.shipping_category);
  const sStack = el("div", "cell-stack");
  sStack.append(el("span", "cell-main", sc.label), el("span", "cell-sub", sc.desc));
  ship.appendChild(sStack);

  const pic = el("td", "", pr.pic || "-");

  const req = el("td");
  const reqSpan = el("span", "req-date", formatDay(pr.required_date));
  if (pr.status === "Pending" && pr.required_date) {
    const days = Math.round((parseDay(pr.required_date) - parseDay(todayISO())) / 86400000);
    if (days <= 1) {
      reqSpan.classList.add("soon");
      reqSpan.appendChild(el("small", "", "Expired besok"));
    } else if (days <= 3) {
      reqSpan.appendChild(el("small", "cell-sub", days + " hari lagi"));
    }
  }
  req.appendChild(reqSpan);

  const st = el("td");
  const stStack = el("div", "cell-stack");
  stStack.appendChild(badge(statusConf(pr.status)));
  if (pr.po) stStack.appendChild(el("span", "cell-sub mono", pr.po.number));
  st.appendChild(stStack);

  const items = el("td", "num", formatNumber(pr.item_count));

  const act = el("td", "actions");
  const review = pr.status === "Pending" && REVIEW_ROLES.includes(App.user.role);
  const link = el("a", "btn btn-sm " + (review ? "btn-primary" : "btn-ghost"));
  link.href = href;
  link.append(icon_(review ? "rate_review" : "visibility"), el("span", "", review ? "Review" : "Lihat"));
  act.appendChild(link);

  tr.append(no, branch, ship, pic, req, st, items, act);
  return tr;
}