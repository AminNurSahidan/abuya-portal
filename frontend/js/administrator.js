const TABS = [
  { key: "users", label: "User", icon: "group", add: "Tambah User", search: "Cari username..." },
  { key: "branches", label: "Cabang", icon: "storefront", add: "Tambah Cabang", search: "Cari nama atau kode cabang..." },
  { key: "products", label: "Produk", icon: "inventory_2", add: "Tambah Produk", search: "Cari nama produk atau unit..." },
  { key: "pics", label: "PIC", icon: "badge", add: "Tambah PIC", search: "Cari nama PIC..." },
  { key: "mapping", label: "Mapping Cabang", icon: "account_tree" }
];

const COLUMNS = {
  users: ["Username", "Role", "Brand", "Cabang", "Status", "Login terakhir", ""],
  branches: ["Kode", "Nama cabang", "Brand", ""],
  products: ["Nama produk", "Unit", "Brand", ""],
  pics: ["Nama PIC", "Shipping", "Brand", ""]
};

const SCOPED_ROLES = ["SM", "AM", "AMKA"];
const PAGE_SIZE = 20;
const DEFAULTS = { tab: "users", q: "", role: "", ship: "", page: 1 };

const state = readParams(DEFAULTS);
const data = { users: [], branches: [], products: [], pics: [] };
const branchCache = {};
const map = { userId: "", selected: new Set(), original: new Set(), branches: [] };
let modalSubmit = null;
let busy = false;
let searchTimer;

bootApp(async (user) => {
  if (user.role !== "Master") {
    $("denyNotice").hidden = false;
    return;
  }
  if (!TABS.some((t) => t.key === state.tab)) state.tab = "users";
  $("adminArea").hidden = false;
  fillBrandSelects();
  bindUI();
  $("fSearch").value = state.q;
  $("fRole").value = state.role;
  $("fShip").value = state.ship;
  renderTabs();
  applyTab();
  await loadAll();
});

function bindUI() {
  $("fSearch").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.q = e.target.value.trim();
      state.page = 1;
      sync();
      renderList();
    }, 200);
  });
  $("fRole").addEventListener("change", (e) => { state.role = e.target.value; state.page = 1; sync(); renderList(); });
  $("fShip").addEventListener("change", (e) => { state.ship = e.target.value; state.page = 1; sync(); renderList(); });
  $("prevBtn").addEventListener("click", () => { state.page -= 1; sync(); renderList(); });
  $("nextBtn").addEventListener("click", () => { state.page += 1; sync(); renderList(); });
  $("addBtn").addEventListener("click", () => openForm(state.tab, null));
  $("uploadBtn").addEventListener("click", () => openUpload(state.tab));
  $("templateBtn").addEventListener("click", () => downloadTemplate(state.tab));
  bindUpload();

  $("modalClose").addEventListener("click", closeModal);
  $("modalCancel").addEventListener("click", closeModal);
  $("modal").addEventListener("mousedown", (e) => { if (e.target === $("modal")) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("modal").hidden) closeModal(); });
  $("modalForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!modalSubmit || busy) return;
    busy = true;
    $("modalSubmit").disabled = true;
    try {
      await modalSubmit();
    } catch (err) {
      if (err.status !== 401) showToast(err.message, true);
    } finally {
      busy = false;
      $("modalSubmit").disabled = false;
    }
  });
  $("uRole").addEventListener("change", toggleUserBrand);
  ["uUsername", "uPassword", "bCode", "bName", "pName", "cName", "rPassword", "rPassword2"].forEach((id) => {
    $(id).addEventListener("input", () => $(id).classList.remove("invalid"));
  });

  $("mapUserSearch").addEventListener("input", renderMapUsers);
  $("mapBranchSearch").addEventListener("input", renderMapBranches);
  $("mapAll").addEventListener("click", () => {
    visibleMapBranches().forEach((b) => map.selected.add(b.id));
    renderMapBranches();
  });
  $("mapNone").addEventListener("click", () => {
    visibleMapBranches().forEach((b) => map.selected.delete(b.id));
    renderMapBranches();
  });
  $("mapReset").addEventListener("click", () => {
    map.selected = new Set(map.original);
    renderMapBranches();
  });
  $("mapSave").addEventListener("click", saveMapping);
}

function sync() {
  writeParams(state, DEFAULTS);
}

function fillBrandSelects() {
  const def = activeBrandId() || (App.brands[0] ? String(App.brands[0].id) : "");
  [["uBrand", false], ["bBrand", false], ["pBrand", true], ["cBrand", true]].forEach(([id, allowAll]) => {
    const select = $(id);
    select.innerHTML = "";
    if (allowAll) {
      const all = document.createElement("option");
      all.value = "";
      all.textContent = "Semua brand";
      select.appendChild(all);
    }
    App.brands.forEach((b) => {
      const opt = document.createElement("option");
      opt.value = String(b.id);
      opt.textContent = b.name;
      select.appendChild(opt);
    });
    select.value = def;
  });
}

async function loadAll() {
  const brand = activeBrandId();
  const q = qs({ brand_id: brand });
  tableSkeleton($("tbody"), 7);
  try {
    const [users, branches, products, pics] = await Promise.all([
      api("/users" + q),
      api("/branches" + q),
      api("/products" + q),
      api("/pics" + q)
    ]);
    data.users = users;
    data.branches = branches;
    data.products = products;
    data.pics = pics;
    renderTabs();
    renderList();
    if (state.tab === "mapping") renderMapUsers();
  } catch (err) {
    if (err.status === 401) return;
    tableMessage($("tbody"), 7, "error", "Data belum bisa dimuat.");
    showToast(err.message, true);
  }
}

function renderTabs() {
  const box = $("adminTabs");
  box.innerHTML = "";
  TABS.forEach((t) => {
    const active = state.tab === t.key;
    const btn = el("button", "tab" + (active ? " active" : ""));
    btn.type = "button";
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", active ? "true" : "false");
    btn.append(icon_(t.icon), el("span", "", t.label));
    const count = t.key === "mapping" ? data.users.filter((u) => SCOPED_ROLES.includes(u.role)).length : data[t.key].length;
    btn.appendChild(el("span", "tab-count", formatNumber(count)));
    btn.addEventListener("click", () => {
      if (state.tab === t.key) return;
      state.tab = t.key;
      state.q = "";
      state.role = "";
      state.ship = "";
      state.page = 1;
      $("fSearch").value = "";
      $("fRole").value = "";
      $("fShip").value = "";
      sync();
      renderTabs();
      applyTab();
      if (t.key === "mapping") renderMapUsers();
      else renderList();
    });
    box.appendChild(btn);
  });
}

function applyTab() {
  const isMap = state.tab === "mapping";
  $("listPanel").hidden = isMap;
  $("mappingPanel").hidden = !isMap;
  if (isMap) return;
  const tab = TABS.find((t) => t.key === state.tab);
  $("fSearch").placeholder = tab.search;
  $("addText").textContent = tab.add;
  $("fRole").closest(".cs").hidden = state.tab !== "users";
  $("fShip").closest(".cs").hidden = state.tab !== "pics";
  $("uploadBtn").hidden = !UPLOAD[state.tab];
  $("templateBtn").hidden = !UPLOAD[state.tab];
  const row = $("theadRow");
  row.innerHTML = "";
  COLUMNS[state.tab].forEach((c) => row.appendChild(el("th", "", c)));
}

function filtered() {
  const q = state.q.toLowerCase();
  const rows = data[state.tab] || [];
  return rows.filter((r) => {
    if (state.tab === "users") {
      if (state.role && r.role !== state.role) return false;
      return !q || r.username.includes(q);
    }
    if (state.tab === "branches") return !q || r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q);
    if (state.tab === "products") return !q || r.name.toLowerCase().includes(q) || (r.unit || "").toLowerCase().includes(q);
    if (state.tab === "pics") {
      if (state.ship && r.shipping !== state.ship) return false;
      return !q || r.name.toLowerCase().includes(q);
    }
    return true;
  });
}

function renderList() {
  if (state.tab === "mapping") return;
  const rows = filtered();
  const cols = COLUMNS[state.tab].length;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  if (state.page > pages) state.page = pages;
  const body = $("tbody");
  body.innerHTML = "";
  if (!rows.length) {
    tableMessage(body, cols, "inbox", state.q || state.role || state.ship ? "Tidak ada data yang cocok." : "Belum ada data.");
  } else {
    rows.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE).forEach((r) => body.appendChild(renderRow(r)));
  }
  renderPager({ total: rows.length, page: state.page, size: PAGE_SIZE }, "data");
}

function brandCell(brand, allLabel) {
  const td = el("td");
  if (brand) td.appendChild(el("span", "brand-tag", brand.name));
  else td.appendChild(el("span", "muted", allLabel || "-"));
  return td;
}

function actionCell(buttons) {
  const td = el("td", "actions");
  const box = el("div", "row-actions");
  buttons.forEach(([icon, title, fn, danger, disabled]) => {
    const b = el("button", "btn-icon" + (danger ? " danger" : ""));
    b.type = "button";
    b.title = title;
    b.setAttribute("aria-label", title);
    b.disabled = !!disabled;
    b.appendChild(icon_(icon));
    b.addEventListener("click", fn);
    box.appendChild(b);
  });
  td.appendChild(box);
  return td;
}

function renderRow(r) {
  const tr = el("tr");
  if (state.tab === "users") {
    const self = r.id === App.user.id;
    const name = el("td");
    const n = el("span", "cell-main", r.username);
    name.appendChild(n);
    if (self) name.appendChild(el("span", "you-tag", "kamu"));
    const role = el("td");
    role.appendChild(el("span", "role-badge role-" + r.role, r.role));
    const branches = el("td");
    if (SCOPED_ROLES.includes(r.role)) {
      const span = el("span", r.branches.length ? "cell-main" : "overdue", r.branches.length ? r.branches.length + " cabang" : "Belum di-mapping");
      span.title = r.branches.map((b) => b.name).join(", ");
      branches.appendChild(span);
    } else {
      branches.appendChild(el("span", "muted", r.role === "PIC" ? "Semua cabang brand" : "Semua cabang"));
    }
    const status = el("td");
    status.appendChild(badge(r.is_active ? { label: "Aktif", tone: "green" } : { label: "Nonaktif", tone: "slate" }));
    const last = el("td", "cell-sub", r.last_login_at ? formatDateTime(r.last_login_at) : "Belum pernah");
    tr.append(
      name,
      role,
      brandCell(r.brand, "Semua brand"),
      branches,
      status,
      last,
      actionCell([
        ["edit", "Edit user", () => openForm("users", r), false, self],
        ["key", "Reset password", () => openReset(r), false, false],
        ["delete", "Hapus user", () => remove("users", r, r.username), true, self]
      ])
    );
  } else if (state.tab === "branches") {
    tr.append(
      el("td", "doc-no mono", r.code),
      el("td", "cell-main", r.name),
      brandCell(r.brand),
      actionCell([
        ["edit", "Edit cabang", () => openForm("branches", r)],
        ["delete", "Hapus cabang", () => remove("branches", r, r.name), true]
      ])
    );
  } else if (state.tab === "products") {
    tr.append(
      el("td", "cell-main", r.name),
      el("td", "", r.unit || "-"),
      brandCell(r.brand, "Semua brand"),
      actionCell([
        ["edit", "Edit produk", () => openForm("products", r)],
        ["delete", "Hapus produk", () => remove("products", r, r.display_name), true]
      ])
    );
  } else if (state.tab === "pics") {
    const ship = el("td");
    ship.appendChild(badge(shippingConf(r.shipping)));
    tr.append(
      el("td", "cell-main", r.name),
      ship,
      brandCell(r.brand, "Semua brand"),
      actionCell([
        ["edit", "Edit PIC", () => openForm("pics", r)],
        ["delete", "Hapus PIC", () => remove("pics", r, r.name), true]
      ])
    );
  }
  return tr;
}

function showFields(entity) {
  document.querySelectorAll(".modal-fields").forEach((f) => { f.hidden = f.dataset.entity !== entity; });
  document.querySelectorAll(".modal-fields .invalid").forEach((n) => n.classList.remove("invalid"));
}

function openModal(title, submitLabel, onSubmit, focusId) {
  $("modalTitle").textContent = title;
  $("modalSubmit").textContent = submitLabel;
  modalSubmit = onSubmit;
  $("modal").hidden = false;
  document.documentElement.classList.add("no-scroll");
  document.body.classList.add("no-scroll");
  if (focusId) setTimeout(() => $(focusId).focus(), 50);
}

function closeModal() {
  $("modal").hidden = true;
  document.querySelector(".modal-card").classList.remove("wide");
  $("modalSubmit").hidden = false;
  $("modalSubmit").disabled = false;
  $("modalCancel").textContent = "Batal";
  modalSubmit = null;
  document.documentElement.classList.remove("no-scroll");
  document.body.classList.remove("no-scroll");
}

function require_(id, msg) {
  const node = $(id);
  if (!String(node.value || "").trim()) {
    node.classList.add("invalid");
    node.focus();
    showToast(msg, true);
    return false;
  }
  return true;
}

function toggleUserBrand() {
  $("uBrandField").hidden = $("uRole").value === "Master";
}

function openForm(entity, rec) {
  const edit = !!rec;
  const def = activeBrandId() || (App.brands[0] ? String(App.brands[0].id) : "");
  showFields(entity);

  if (entity === "users") {
    $("uUsername").value = edit ? rec.username : "";
    $("uUsername").disabled = edit;
    $("uUsernameField").querySelector(".hint").hidden = edit;
    $("uPasswordField").hidden = edit;
    $("uPassword").value = "";
    $("uRole").value = edit ? rec.role : "SM";
    $("uBrand").value = edit && rec.brand ? String(rec.brand.id) : def;
    $("uActiveField").hidden = !edit;
    $("uActive").checked = edit ? rec.is_active : true;
    toggleUserBrand();
    openModal(edit ? "Edit user " + rec.username : "Tambah user", edit ? "Simpan perubahan" : "Tambah user", async () => {
      const role = $("uRole").value;
      const brandId = role === "Master" ? null : Number($("uBrand").value) || null;
      if (role !== "Master" && !brandId) {
        showToast("Pilih brand dulu ya.", true);
        return;
      }
      if (edit) {
        if (rec.role !== role && SCOPED_ROLES.includes(rec.role) && !SCOPED_ROLES.includes(role) && rec.branches.length) {
          if (!(await confirmDialog("Mapping cabang " + rec.username + " akan dihapus karena role " + role + " tidak pakai mapping. Lanjut?", { danger: true, confirmLabel: "Ya, Lanjut" }))) return;
        }
        await api("/users/" + rec.id, { method: "PATCH", json: { role, brand_id: brandId, is_active: $("uActive").checked } });
        showToast("User " + rec.username + " diperbarui.");
      } else {
        let username = $("uUsername").value.trim();
        if (username.includes("@")) username = username.split("@")[0];
        if (!require_("uUsername", "Isi username dulu ya.")) return;
        if (!/^[a-z0-9._-]{3,50}$/.test(username)) {
          $("uUsername").classList.add("invalid");
          showToast("Username 3-50 karakter: huruf kecil, angka, titik, strip, atau underscore.", true);
          return;
        }
        if ($("uPassword").value.length < 6) {
          $("uPassword").classList.add("invalid");
          showToast("Password minimal 6 karakter.", true);
          return;
        }
        await api("/users", { method: "POST", json: { username, password: $("uPassword").value, role, brand_id: brandId } });
        showToast("User " + username + " ditambahkan." + (SCOPED_ROLES.includes(role) ? " Jangan lupa atur mapping cabangnya." : ""));
      }
      closeModal();
      await loadAll();
    }, edit ? "uRole" : "uUsername");
  }

  if (entity === "branches") {
    $("bCode").value = edit ? rec.code : "";
    $("bName").value = edit ? rec.name : "";
    $("bBrand").value = edit && rec.brand ? String(rec.brand.id) : def;
    openModal(edit ? "Edit cabang" : "Tambah cabang", edit ? "Simpan perubahan" : "Tambah cabang", async () => {
      if (!require_("bCode", "Isi kode cabang dulu ya.") || !require_("bName", "Isi nama cabang dulu ya.") || !require_("bBrand", "Pilih brand dulu ya.")) return;
      const body = { code: $("bCode").value.trim(), name: $("bName").value.trim(), brand_id: Number($("bBrand").value) };
      if (edit) await api("/branches/" + rec.id, { method: "PATCH", json: body });
      else await api("/branches", { method: "POST", json: body });
      showToast("Cabang " + body.name + (edit ? " diperbarui." : " ditambahkan."));
      closeModal();
      await loadAll();
    }, "bCode");
  }

  if (entity === "products") {
    $("pName").value = edit ? rec.name : "";
    $("pUnit").value = edit ? rec.unit || "" : "";
    $("pBrand").value = edit ? (rec.brand ? String(rec.brand.id) : "") : def;
    openModal(edit ? "Edit produk" : "Tambah produk", edit ? "Simpan perubahan" : "Tambah produk", async () => {
      if (!require_("pName", "Isi nama produk dulu ya.")) return;
      const brandId = Number($("pBrand").value) || null;
      const body = { name: $("pName").value.trim(), unit: $("pUnit").value.trim() || null };
      if (edit) await api("/products/" + rec.id, { method: "PATCH", json: Object.assign(body, brandId ? { brand_id: brandId } : { clear_brand: true }, { unit: body.unit || "" }) });
      else await api("/products", { method: "POST", json: Object.assign(body, { brand_id: brandId }) });
      showToast("Produk " + body.name + (edit ? " diperbarui." : " ditambahkan."));
      closeModal();
      await loadAll();
    }, "pName");
  }

  if (entity === "pics") {
    $("cName").value = edit ? rec.name : "";
    $("cShip").value = edit && rec.shipping ? rec.shipping : "Direct";
    $("cBrand").value = edit ? (rec.brand ? String(rec.brand.id) : "") : def;
    openModal(edit ? "Edit PIC" : "Tambah PIC", edit ? "Simpan perubahan" : "Tambah PIC", async () => {
      if (!require_("cName", "Isi nama PIC dulu ya.")) return;
      const brandId = Number($("cBrand").value) || null;
      const body = { name: $("cName").value.trim(), shipping: $("cShip").value };
      if (edit) await api("/pics/" + rec.id, { method: "PATCH", json: Object.assign(body, brandId ? { brand_id: brandId } : { clear_brand: true }) });
      else await api("/pics", { method: "POST", json: Object.assign(body, { brand_id: brandId }) });
      showToast("PIC " + body.name + (edit ? " diperbarui." : " ditambahkan."));
      closeModal();
      await loadAll();
    }, "cName");
  }
}

function openReset(rec) {
  showFields("password");
  $("rPassword").value = "";
  $("rPassword2").value = "";
  openModal("Reset password " + rec.username, "Reset password", async () => {
    const p1 = $("rPassword").value;
    if (p1.length < 6) {
      $("rPassword").classList.add("invalid");
      showToast("Password minimal 6 karakter.", true);
      return;
    }
    if (p1 !== $("rPassword2").value) {
      $("rPassword2").classList.add("invalid");
      showToast("Password tidak sama.", true);
      return;
    }
    await api("/users/" + rec.id + "/reset-password", { method: "POST", json: { new_password: p1 } });
    closeModal();
    showToast("Password " + rec.username + " sudah di-reset. User perlu login ulang.");
    if (rec.id === App.user.id) logout();
  }, "rPassword");
}

async function remove(entity, rec, label) {
  const names = { users: "user", branches: "cabang", products: "produk", pics: "PIC" };
  if (!(await confirmDialog("Hapus " + names[entity] + " " + label + "? Tindakan ini tidak bisa dibatalkan.", { danger: true, confirmLabel: "Ya, Hapus" }))) return;
  try {
    await api("/" + entity + "/delete", { method: "POST", json: { ids: [rec.id] } });
    showToast(label + " dihapus.");
    await loadAll();
  } catch (err) {
    if (err.status !== 401) showToast(err.message, true);
  }
}

function mapUsers() {
  const q = $("mapUserSearch").value.trim().toLowerCase();
  return data.users.filter((u) => SCOPED_ROLES.includes(u.role) && (!q || u.username.includes(q)));
}

function renderMapUsers() {
  const list = $("mapUserList");
  const users = mapUsers();
  list.innerHTML = "";
  $("mapUserMeta").textContent = formatNumber(users.length) + " user";
  if (!users.length) {
    const li = el("li");
    li.appendChild(emptyBlock("group", "Belum ada user SM, AM, atau AMKA."));
    list.appendChild(li);
    return;
  }
  users.forEach((u) => {
    const li = el("li");
    const btn = el("button", "map-user" + (map.userId === u.id ? " active" : ""));
    btn.type = "button";
    const body = el("span", "map-user-body");
    body.append(el("span", "map-user-name", u.username), el("span", "map-user-sub", u.role + (u.brand ? " • " + u.brand.name : "")));
    btn.append(el("span", "avatar", initials(u.username)), body, el("span", "map-count" + (u.branches.length ? "" : " zero"), String(u.branches.length)));
    btn.addEventListener("click", () => selectMapUser(u));
    li.appendChild(btn);
    list.appendChild(li);
  });
}

async function selectMapUser(u) {
  if (map.userId && map.userId !== u.id && isMapDirty()) {
    if (!(await confirmDialog("Perubahan mapping belum disimpan. Pindah user dan buang perubahan?", { danger: true, confirmLabel: "Buang perubahan" }))) return;
  }
  map.userId = u.id;
  map.original = new Set(u.branches.map((b) => b.id));
  map.selected = new Set(map.original);
  $("mapBranchSearch").value = "";
  $("mapTitle").textContent = "Cabang untuk " + u.username;
  renderMapUsers();
  const brandId = u.brand ? u.brand.id : null;
  if (!brandId) {
    map.branches = [];
  } else if (branchCache[brandId]) {
    map.branches = branchCache[brandId];
  } else {
    try {
      branchCache[brandId] = await api("/branches" + qs({ brand_id: brandId }));
      map.branches = branchCache[brandId];
    } catch (err) {
      if (err.status !== 401) showToast(err.message, true);
      return;
    }
  }
  $("mapToolbar").hidden = false;
  $("mapActions").hidden = false;
  renderMapBranches();
}

function visibleMapBranches() {
  const q = $("mapBranchSearch").value.trim().toLowerCase();
  return map.branches.filter((b) => !q || b.name.toLowerCase().includes(q) || b.code.toLowerCase().includes(q));
}

function isMapDirty() {
  if (map.selected.size !== map.original.size) return true;
  for (const id of map.selected) if (!map.original.has(id)) return true;
  return false;
}

function renderMapBranches() {
  const box = $("mapBranchList");
  box.innerHTML = "";
  const rows = visibleMapBranches();
  const user = data.users.find((u) => u.id === map.userId);
  $("mapMeta").textContent = formatNumber(map.selected.size) + " dari " + formatNumber(map.branches.length) + " cabang dipilih" + (user && user.brand ? " • " + user.brand.name : "");
  if (!rows.length) {
    box.appendChild(emptyBlock("storefront", map.branches.length ? "Tidak ada cabang yang cocok." : "Belum ada cabang untuk brand ini."));
  }
  rows.forEach((b) => {
    const label = el("label", "map-branch" + (map.selected.has(b.id) ? " checked" : ""));
    const cb = el("input");
    cb.type = "checkbox";
    cb.checked = map.selected.has(b.id);
    cb.addEventListener("change", () => {
      if (cb.checked) map.selected.add(b.id);
      else map.selected.delete(b.id);
      renderMapBranches();
    });
    label.append(cb, el("span", "", b.name), el("span", "code", b.code));
    box.appendChild(label);
  });
  const actions = $("mapActions");
  let note = actions.querySelector(".map-actions-note");
  if (isMapDirty()) {
    if (!note) {
      note = el("span", "map-actions-note", "Ada perubahan belum disimpan");
      actions.prepend(note);
    }
  } else if (note) {
    note.remove();
  }
  $("mapSave").disabled = !isMapDirty();
  $("mapReset").disabled = !isMapDirty();
}

async function saveMapping() {
  const user = data.users.find((u) => u.id === map.userId);
  if (!user || busy) return;
  busy = true;
  $("mapSave").disabled = true;
  try {
    const updated = await api("/users/" + user.id + "/branches", { method: "PUT", json: { branch_ids: Array.from(map.selected) } });
    const idx = data.users.findIndex((u) => u.id === updated.id);
    if (idx >= 0) data.users[idx] = updated;
    map.original = new Set(updated.branches.map((b) => b.id));
    map.selected = new Set(map.original);
    showToast("Mapping " + updated.username + " disimpan (" + updated.branches.length + " cabang).");
    renderMapUsers();
    renderMapBranches();
  } catch (err) {
    if (err.status !== 401) showToast(err.message, true);
  } finally {
    busy = false;
    $("mapSave").disabled = !isMapDirty();
  }
}

const UPLOAD = {
  products: {
    noun: "produk",
    endpoint: "/products/bulk",
    allowAll: true,
    cols: {
      name: ["product name", "nama produk", "produk", "product", "nama"],
      unit: ["unit", "satuan"],
      brand: ["brand"]
    },
    required: { name: "Product Name", unit: "Unit", brand: "Brand" },
    preview: [["Product Name", "name"], ["Unit", "unit"], ["Brand", "brandName"]],
    template: {
      file: "Template_Upload_Produk.xlsx",
      sheet: "Result",
      headers: ["Product Name", "Unit", "Brand"],
      widths: [31.6, 8, 20],
      rows: [["Air Mineral 330ml", "Carton", "Almaz Fried Chicken"], ["Acar", "pack", "Kebuli Abuya"]]
    },
    key: (it) => [it.name.toLowerCase(), (it.unit || "").toLowerCase(), it.brand_id].join("|"),
    item: (r) => ({ name: r.name, unit: r.unit || null, brand_id: r.brand_id })
  },
  branches: {
    noun: "cabang",
    endpoint: "/branches/bulk",
    allowAll: false,
    cols: {
      code: ["branch code", "kode cabang", "kode", "code"],
      name: ["branch name", "nama cabang", "cabang", "branch", "nama"],
      brand: ["brand"]
    },
    required: { code: "Branch Code", name: "Branch Name" },
    preview: [["Kode", "code"], ["Nama cabang", "name"], ["Brand", "brandName"]],
    template: {
      file: "Template_Upload_Cabang.xlsx",
      sheet: "Report",
      headers: ["Branch Code", "Branch Name", "Brand"],
      widths: [14, 32, 24],
      rows: [["AFC10", "Almaz Cibubur", "Almaz Fried Chicken"], ["KBA10", "Kebuli Cibubur", "Kebuli Abuya"]]
    },
    key: (it) => it.code.toLowerCase(),
    item: (r) => ({ code: r.code, name: r.name, brand_id: r.brand_id })
  },
  pics: {
    noun: "PIC",
    endpoint: "/pics/bulk",
    allowAll: true,
    cols: {
      name: ["pic name", "nama pic", "pic", "nama"],
      shipping: ["shipping", "pengiriman"],
      brand: ["brand"]
    },
    required: { name: "PIC Name", shipping: "Shipping" },
    preview: [["Nama PIC", "name"], ["Shipping", "shipping"], ["Brand", "brandName"]],
    template: {
      file: "Template_Upload_PIC.xlsx",
      sheet: "Report",
      headers: ["PIC Name", "Shipping", "Brand"],
      widths: [28, 12, 24],
      rows: [["DC Cikarang", "Direct", ""], ["CV Sumber Pangan", "Indirect", "Almaz Fried Chicken"]]
    },
    key: (it) => [it.name.toLowerCase(), it.shipping, it.brand_id].join("|"),
    item: (r) => ({ name: r.name, shipping: r.shipping, brand_id: r.brand_id })
  }
};

const upload = { entity: "", fileName: "", sheets: [], rows: [], valid: [] };

function bindUpload() {
  const drop = $("upDrop");
  drop.addEventListener("click", () => $("upFile").click());
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("drag");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("drag");
    if (e.dataTransfer.files[0]) readUploadFile(e.dataTransfer.files[0]);
  });
  $("upFile").addEventListener("change", (e) => {
    if (e.target.files[0]) readUploadFile(e.target.files[0]);
    e.target.value = "";
  });
  $("upSheet").addEventListener("change", () => {
    parseSheet();
    computeUpload();
  });
  $("upBrand").addEventListener("change", computeUpload);
}

function cellText(cell) {
  let v = cell ? cell.value : null;
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) v = v.richText.map((t) => t.text).join("");
    else if (v.text !== undefined) v = v.text;
    else if (v.result !== undefined) v = v.result;
    else v = "";
  }
  return String(v).replace(/\s+/g, " ").trim();
}

function findHeader(ws, conf) {
  const max = Math.min(ws.rowCount, 10);
  for (let r = 1; r <= max; r++) {
    const row = ws.getRow(r);
    const map = {};
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const h = cellText(cell).toLowerCase();
      Object.entries(conf.cols).forEach(([key, aliases]) => {
        if (map[key] === undefined && aliases.includes(h)) map[key] = col;
      });
    });
    if (Object.keys(conf.required).every((k) => map[k] !== undefined)) return { row: r, map };
  }
  return null;
}

async function readUploadFile(file) {
  if (!/\.xlsx$/i.test(file.name)) {
    showToast("File harus format .xlsx ya.", true);
    return;
  }
  if (typeof ExcelJS === "undefined") {
    showToast("Library Excel belum termuat. Coba refresh halaman.", true);
    return;
  }
  const conf = UPLOAD[upload.entity];
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    upload.sheets = [];
    wb.worksheets.forEach((ws) => {
      const header = findHeader(ws, conf);
      if (header) upload.sheets.push({ ws, header });
    });
  } catch (err) {
    showToast("File tidak bisa dibaca. Pastikan file .xlsx tidak rusak.", true);
    return;
  }
  if (!upload.sheets.length) {
    showToast("Kolom wajib tidak ditemukan. File harus punya kolom: " + Object.values(conf.required).join(", ") + ".", true);
    return;
  }
  upload.fileName = file.name;
  const drop = $("upDrop");
  drop.classList.add("has-file");
  $("upDropTitle").textContent = file.name;
  $("upDropHint").textContent = "Ganti file";
  const sheet = $("upSheet");
  sheet.innerHTML = "";
  upload.sheets.forEach((s, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = s.ws.name;
    sheet.appendChild(opt);
  });
  sheet.value = "0";
  $("upSheetField").hidden = upload.sheets.length < 2;
  $("upDetail").hidden = false;
  parseSheet();
  computeUpload();
}

function parseSheet() {
  const s = upload.sheets[Number($("upSheet").value) || 0];
  const { ws, header } = s;
  upload.rows = [];
  for (let r = header.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const raw = {};
    Object.entries(header.map).forEach(([key, col]) => { raw[key] = cellText(row.getCell(col)); });
    if (Object.values(raw).every((v) => !v)) continue;
    raw._row = r;
    upload.rows.push(raw);
  }
  upload.hasBrandCol = header.map.brand !== undefined;
}

function resolveBrand(text, allowAll) {
  const t = text.trim().toLowerCase();
  if (!t) return { ok: false, empty: true };
  if (allowAll && ["semua", "semua brand", "all", "all brand", "-"].includes(t)) return { ok: true, id: null, name: "Semua brand" };
  const b = App.brands.find((x) => x.name.toLowerCase() === t || x.code.toLowerCase() === t);
  return b ? { ok: true, id: b.id, name: b.name } : { ok: false };
}

function normalizeShipping(text) {
  const t = text.trim().toLowerCase();
  if (["direct", "dc", "distribution center"].includes(t)) return "Direct";
  if (["indirect", "vendor"].includes(t)) return "Indirect";
  return "";
}

function computeUpload() {
  const conf = UPLOAD[upload.entity];
  const selected = $("upBrand").value;
  const selBrand = selected ? App.brands.find((b) => String(b.id) === selected) : null;
  const seen = new Set();
  const counts = { ok: 0, invalid: 0, dup: 0 };
  upload.valid = [];

  upload.rows.forEach((r) => {
    r._status = "ok";
    r._reason = "";
    {
      const missing = Object.entries(conf.required).find(([k]) => !r[k]);
      if (missing) {
        r._status = "invalid";
        r._reason = missing[1] + " kosong";
      }
    }
    if (r._status === "ok") {
      let brand = null;
      if (upload.hasBrandCol && r.brand) {
        const res = resolveBrand(r.brand, conf.allowAll);
        if (!res.ok) {
          r._status = "invalid";
          r._reason = "Brand \"" + r.brand + "\" tidak dikenal";
        } else {
          brand = res;
        }
      } else if (selBrand) {
        brand = { id: selBrand.id, name: selBrand.name };
      } else if (conf.allowAll) {
        brand = { id: null, name: "Semua brand" };
      } else {
        r._status = "invalid";
        r._reason = "Brand belum dipilih";
      }
      if (brand) {
        r.brand_id = brand.id;
        r.brandName = brand.name;
      }
    }
    if (r._status === "ok" && upload.entity === "pics") {
      const ship = normalizeShipping(r.shipping);
      if (!ship) {
        r._status = "invalid";
        r._reason = "Shipping harus Direct/Indirect";
      } else {
        r.shipping = ship;
      }
    }
    if (r._status === "ok" && upload.entity === "branches") r.code = r.code.toUpperCase();
    if (r._status === "ok") {
      const item = conf.item(r);
      const key = conf.key(item);
      if (seen.has(key)) {
        r._status = "dup";
        r._reason = "Dobel di file";
      } else {
        seen.add(key);
        upload.valid.push(item);
      }
    }
    counts[r._status] += 1;
  });

  const summary = $("upSummary");
  summary.innerHTML = "";
  summary.appendChild(badge({ label: formatNumber(counts.ok) + " " + conf.noun + " siap diimport", tone: "green" }));
  if (counts.dup) summary.appendChild(badge({ label: formatNumber(counts.dup) + " dobel", tone: "amber" }));
  if (counts.invalid) summary.appendChild(badge({ label: formatNumber(counts.invalid) + " tidak valid", tone: "red" }));

  $("upBrandHint").textContent = conf.required.brand
    ? "Brand diambil dari kolom Brand di file. Isi kolom Brand harus sama dengan nama brand di sistem (contoh: Almaz Fried Chicken, Kebuli Abuya, Distribution Center)."
    : upload.hasBrandCol
      ? "Brand diambil dari kolom Brand di file. Baris yang kolom Brand-nya kosong pakai brand di atas."
      : "Semua baris akan masuk ke brand di atas.";

  const head = $("upHead");
  head.innerHTML = "";
  head.appendChild(el("th", "", "Baris"));
  conf.preview.forEach(([label]) => head.appendChild(el("th", "", label)));
  head.appendChild(el("th", "", "Keterangan"));
  const body = $("upBody");
  body.innerHTML = "";
  const ordered = upload.rows.filter((r) => r._status === "invalid").concat(upload.rows.filter((r) => r._status !== "invalid"));
  const limit = 60;
  ordered.slice(0, limit).forEach((r) => {
    const tr = el("tr", r._status === "ok" ? "" : "skip");
    tr.appendChild(el("td", "", String(r._row)));
    conf.preview.forEach(([, key]) => tr.appendChild(el("td", "", key === "brandName" ? r.brandName || r.brand || "-" : r[key] || "-")));
    tr.appendChild(el("td", r._status === "ok" ? "cell-sub" : "reason", r._status === "ok" ? "OK" : r._reason));
    body.appendChild(tr);
  });
  if (ordered.length > limit) {
    const tr = el("tr");
    const td = el("td", "upload-more", "+" + formatNumber(ordered.length - limit) + " baris lainnya");
    td.colSpan = conf.preview.length + 2;
    tr.appendChild(td);
    body.appendChild(tr);
  }

  $("modalSubmit").disabled = !upload.valid.length;
  $("modalSubmit").textContent = upload.valid.length ? "Import " + formatNumber(upload.valid.length) + " " + conf.noun : "Import";
}

function openUpload(entity) {
  const conf = UPLOAD[entity];
  if (!conf) return;
  upload.entity = entity;
  upload.rows = [];
  upload.valid = [];
  upload.sheets = [];
  showFields("upload");
  const box = document.querySelector('.modal-fields[data-entity="upload"]');
  const old = box.querySelector(".upload-result");
  if (old) old.remove();
  $("upDrop").hidden = false;
  $("upDrop").classList.remove("has-file");
  $("upDropTitle").textContent = "Pilih file .xlsx";
  $("upDropHint").textContent = "Klik atau tarik file ke sini. Kolom wajib: " + Object.values(conf.required).join(", ");
  $("upDetail").hidden = true;

  const brand = $("upBrand");
  brand.innerHTML = "";
  if (conf.allowAll) {
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "Semua brand";
    brand.appendChild(all);
  }
  App.brands.forEach((b) => {
    const opt = document.createElement("option");
    opt.value = String(b.id);
    opt.textContent = b.name;
    brand.appendChild(opt);
  });
  brand.value = activeBrandId() || (conf.allowAll ? "" : App.brands[0] ? String(App.brands[0].id) : "");
  $("upBrandField").hidden = !!conf.required.brand;

  document.querySelector(".modal-card").classList.add("wide");
  openModal("Upload " + conf.noun + " dari Excel", "Import", async () => {
    if (!upload.valid.length) return;
    const res = await api(conf.endpoint, { method: "POST", json: { items: upload.valid } });
    await loadAll();
    showUploadResult(conf, res);
  });
  $("modalSubmit").disabled = true;
}

function showUploadResult(conf, res) {
  $("upDrop").hidden = true;
  $("upDetail").hidden = true;
  const box = document.querySelector('.modal-fields[data-entity="upload"]');
  const wrap = el("div", "upload-result upload-detail");
  const sum = el("div", "upload-summary");
  sum.appendChild(badge({ label: formatNumber(res.added) + " " + conf.noun + " ditambahkan", tone: "green" }));
  if (res.skipped.length) sum.appendChild(badge({ label: formatNumber(res.skipped.length) + " dilewati", tone: "amber" }));
  wrap.appendChild(sum);
  if (res.skipped.length) {
    const list = el("ul", "result-list");
    res.skipped.slice(0, 200).forEach((s) => {
      const li = el("li");
      li.append(el("span", "", s.label), el("span", "", s.reason));
      list.appendChild(li);
    });
    wrap.appendChild(list);
  }
  box.appendChild(wrap);
  $("modalTitle").textContent = "Hasil import " + conf.noun;
  $("modalSubmit").hidden = true;
  $("modalCancel").textContent = "Tutup";
  modalSubmit = null;
  showToast(formatNumber(res.added) + " " + conf.noun + " berhasil diimport.");
}

async function downloadTemplate(entity) {
  const conf = UPLOAD[entity];
  if (!conf) return;
  if (typeof ExcelJS === "undefined") {
    showToast("Library Excel belum termuat. Coba refresh halaman.", true);
    return;
  }
  const t = conf.template;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(t.sheet);
  ws.columns = t.headers.map((h, i) => ({ header: h, width: t.widths[i] }));
  const border = { top: { style: "dotted" }, bottom: { style: "dotted" }, left: { style: "dotted" }, right: { style: "dotted" } };
  ws.getRow(1).eachCell((cell) => {
    cell.font = { name: "Arial", size: 10, bold: true };
    cell.alignment = { horizontal: "center" };
    cell.border = border;
  });
  t.rows.forEach((row) => {
    const r = ws.addRow(row);
    r.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: "Arial", size: 10 };
      cell.border = border;
    });
  });
  const buffer = await wb.xlsx.writeBuffer();
  saveBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), t.file);
}