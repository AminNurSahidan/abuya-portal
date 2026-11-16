const DEFAULTS = { shipping: "", branch: "", q: "", from: "", to: "", sort: "created_at", dir: "desc", page: 1 };
const PAGE_SIZE = 20;
const COLUMNS = 8;

const state = readParams(DEFAULTS);
let summary = null;
let listSeq = 0;
let summarySeq = 0;
let searchTimer;
let lastTotal = 0;

bootApp(async (user) => {
  if (!SHIPPINGS.some((s) => s.key === state.shipping)) state.shipping = "";
  $("mappingNotice").hidden = !hasNoMapping(user);
  $("fSearch").value = state.q;
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
  $("fFrom").addEventListener("change", (e) => { state.from = e.target.value; state.page = 1; sync(); loadList(); });
  $("fTo").addEventListener("change", (e) => { state.to = e.target.value; state.page = 1; sync(); loadList(); });
  $("resetBtn").addEventListener("click", () => {
    Object.assign(state, { branch: "", q: "", from: "", to: "", page: 1 });
    $("fSearch").value = "";
    $("fBranch").value = "";
    $("fFrom").value = "";
    $("fTo").value = "";
    sync();
    renderBranches();
    loadList();
  });
  $("prevBtn").addEventListener("click", () => goPage(state.page - 1));
  $("nextBtn").addEventListener("click", () => goPage(state.page + 1));
  $("exportBtn").addEventListener("click", exportExcel);
}

function sync() {
  writeParams(state, DEFAULTS);
  $("resetBtn").hidden = !(state.branch || state.q || state.from || state.to);
}

function setShipping(key) {
  if (state.shipping === key) return;
  state.shipping = key;
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
  const box = $("shipTabs");
  box.innerHTML = "";
  [{ key: "", label: "Semua PO", tone: "" }].concat(SHIPPINGS.map((s) => ({ key: s.key, label: s.label + " • " + s.desc, tone: s.tone }))).forEach((t) => {
    const active = state.shipping === t.key;
    const btn = el("button", "tab" + (active ? " active" : ""));
    btn.type = "button";
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", active ? "true" : "false");
    if (t.tone) btn.appendChild(el("span", "dot tone-" + t.tone));
    btn.appendChild(el("span", "", t.label));
    const count = summary ? (t.key ? summary.by_key[t.key] || 0 : summary.total) : null;
    btn.appendChild(el("span", "tab-count", count === null ? "-" : formatNumber(count)));
    btn.addEventListener("click", () => setShipping(t.key));
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
    const data = await api("/purchase-orders/summary" + qs({ shipping: state.shipping, brand_id: activeBrandId() }));
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
  const conf = state.shipping ? shippingConf(state.shipping) : null;
  $("branchTitle").textContent = conf ? "Cabang dengan PO " + conf.label : "Cabang dengan PO";
  const docs = rows.reduce((a, r) => a + r.count, 0);
  $("branchMeta").textContent = rows.length ? formatNumber(rows.length) + " cabang • " + formatNumber(docs) + " PO" : "";
  grid.innerHTML = "";

  if (!rows.length) {
    grid.appendChild(emptyBlock("storefront", conf ? "Belum ada PO " + conf.label + "." : "Belum ada PO."));
    return;
  }

  rows.forEach((r) => {
    const b = r.branch;
    const active = state.branch === String(b.id);
    const card = el("button", "branch-card" + (active ? " active" : ""));
    card.type = "button";
    card.title = active ? "Klik lagi untuk tampilkan semua cabang" : "Tampilkan PO cabang ini";
    const top = el("div", "branch-card-top");
    const ic = el("div", "branch-card-icon");
    ic.appendChild(icon_("storefront"));
    const name = el("div", "branch-card-name");
    name.appendChild(el("strong", "", b.name));
    if (b.brand) name.appendChild(el("span", "brand-tag", b.brand.name));
    top.append(ic, name);
    const foot = el("div", "branch-card-foot");
    const count = el("span", "branch-card-count", formatNumber(r.count));
    count.appendChild(el("small", "", "PO"));
    foot.appendChild(count);
    if (conf) foot.appendChild(badge(conf));
    card.append(top, foot);
    card.addEventListener("click", () => setBranch(active ? "" : b.id));
    grid.appendChild(card);
  });
}

function filterParams() {
  return {
    shipping: state.shipping,
    branch_id: state.branch,
    q: state.q,
    date_from: state.from,
    date_to: state.to,
    brand_id: activeBrandId()
  };
}

async function loadList() {
  const seq = ++listSeq;
  const body = $("tableBody");
  tableSkeleton(body, COLUMNS);

  try {
    const data = await api("/purchase-orders" + qs(Object.assign(filterParams(), { sort: state.sort, dir: state.dir, page: state.page, size: PAGE_SIZE })));
    if (seq !== listSeq) return;

    const pages = Math.max(1, Math.ceil(data.total / data.size));
    if (state.page > pages && data.total > 0) {
      state.page = pages;
      sync();
      loadList();
      return;
    }

    lastTotal = data.total;
    $("exportBtn").disabled = !data.total;
    body.innerHTML = "";
    if (!data.items.length) {
      const filtered = state.shipping || state.branch || state.q || state.from || state.to;
      tableMessage(body, COLUMNS, "inbox", filtered ? "Tidak ada PO yang cocok dengan filter." : "Belum ada Purchase Order.");
    } else {
      data.items.forEach((po) => body.appendChild(renderRow(po)));
    }
    renderPager(data, "PO");
  } catch (err) {
    if (err.status === 401 || seq !== listSeq) return;
    tableMessage(body, COLUMNS, "error", "Data PO belum bisa dimuat.");
    renderPager({ total: 0, page: 1, size: PAGE_SIZE }, "PO");
    showToast(err.message, true);
  }
}

function renderRow(po) {
  const tr = el("tr", "row-link");
  const href = "purchase-order-detail.html?id=" + po.id;
  tr.addEventListener("click", (e) => {
    if (e.target.closest("a, button")) return;
    window.location.href = href;
  });

  const no = el("td");
  no.appendChild(el("span", "doc-no mono", po.number));

  const ref = el("td");
  const refLink = el("a", "ref-link mono", po.pr.number);
  refLink.href = "purchase-request-detail.html?id=" + po.pr.id;
  ref.appendChild(refLink);

  const branch = el("td");
  const bStack = el("div", "cell-stack");
  bStack.appendChild(el("span", "cell-main", po.pr.branch.name));
  if (po.pr.branch.brand) bStack.appendChild(el("span", "brand-tag", po.pr.branch.brand.name));
  branch.appendChild(bStack);

  const ship = el("td");
  ship.appendChild(badge(shippingConf(po.pr.shipping_category)));

  const pic = el("td", "", po.pr.pic || "-");
  const req = el("td", "", formatDay(po.pr.required_date));

  const rel = el("td");
  const rStack = el("div", "cell-stack");
  rStack.append(el("span", "cell-main", formatDateTime(po.created_at)), el("span", "cell-sub", "oleh " + (po.created_by || "-")));
  rel.appendChild(rStack);

  const act = el("td", "actions");
  const link = el("a", "btn btn-sm btn-ghost");
  link.href = href;
  link.append(icon_("visibility"), el("span", "", "Lihat"));
  act.appendChild(link);

  tr.append(no, ref, branch, ship, pic, req, rel, act);
  return tr;
}

async function exportExcel() {
  if (!lastTotal) return;
  const btn = $("exportBtn");
  btn.disabled = true;
  try {
    const rows = await api("/purchase-orders/export" + qs(filterParams()));
    if (!rows.length) {
      showToast("Tidak ada PO untuk di-export.", true);
      return;
    }
    await downloadPOExcel(rows, "Purchase_Order_" + todayISO() + ".xlsx");
    showToast(lastTotal + " PO di-export ke Excel.");
  } catch (err) {
    if (err.status !== 401) showToast(err.message, true);
  } finally {
    btn.disabled = false;
  }
}