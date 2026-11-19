const DEFAULTS = { dc: "", status: "", q: "", page: 1 };
const PAGE_SIZE = 20;
const COLS = 6;
const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

const state = readParams(DEFAULTS);
let dcs = [];
let counts = { all: 0, Aktif: 0, Selesai: 0, Final: 0 };
let listSeq = 0;
let searchTimer;

bootApp(async (user) => {
  if (!canAny(user, ["wh.session.view", "wh.count.input"])) {
    $("noDcText").textContent = "Role kamu belum punya akses ke Stock Opname. Hubungi Master ya.";
    $("noDcNotice").hidden = false;
    return;
  }
  dcs = await api("/wh/dcs");
  if (!dcs.length) {
    $("noDcNotice").hidden = false;
    return;
  }
  if (state.dc && !dcs.some((d) => String(d.id) === state.dc)) state.dc = "";
  $("area").hidden = false;
  $("createBtn").hidden = !can(user, "wh.session.create");
  $("createBtn").addEventListener("click", () => openForm(null));
  $("fSearch").value = state.q;
  bindFilters();
  renderDcs();
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
  $("resetBtn").addEventListener("click", () => {
    Object.assign(state, { dc: "", q: "", page: 1 });
    $("fSearch").value = "";
    sync();
    renderDcs();
    loadList();
  });
  $("prevBtn").addEventListener("click", () => goPage(state.page - 1));
  $("nextBtn").addEventListener("click", () => goPage(state.page + 1));
}

function sync() {
  writeParams(state, DEFAULTS);
  $("resetBtn").hidden = !(state.dc || state.q);
}

function goPage(n) {
  if (n < 1) return;
  state.page = n;
  sync();
  loadList();
}

function renderDcs() {
  const grid = $("dcGrid");
  grid.innerHTML = "";
  $("dcMeta").textContent = formatNumber(dcs.length) + " DC" + (state.dc ? " • klik lagi untuk tampilkan semua" : "");
  dcs.forEach((d) => {
    const active = state.dc === String(d.id);
    const card = el("button", "branch-card" + (active ? " active" : ""));
    card.type = "button";
    const top = el("div", "branch-card-top");
    const ic = el("div", "branch-card-icon");
    ic.appendChild(icon_("warehouse"));
    const name = el("div", "branch-card-name");
    const row = el("div", "name-row");
    row.appendChild(el("strong", "", d.name));
    if (d.wh_code) {
      const code = el("span", "wh-code", d.wh_code);
      code.title = "Kode barcode";
      row.appendChild(code);
    }
    name.appendChild(row);
    const stats = el("div", "dc-card-stats");
    [["zones", "zona"], ["sectors", "sector"], ["placements", "item"]].forEach(([k, label]) => {
      const s = el("span");
      s.append(el("b", "", formatNumber(d[k])), document.createTextNode(" " + label));
      stats.appendChild(s);
    });
    name.appendChild(stats);
    top.append(ic, name);
    const foot = el("div", "dc-card-last");
    if (d.last_session) {
      foot.append(badge(whStatusConf(d.last_session.status)), el("span", "", d.last_session.name));
    } else {
      foot.appendChild(el("span", "muted", "Belum ada sesi"));
    }
    card.append(top, foot);
    card.addEventListener("click", () => {
      state.dc = active ? "" : String(d.id);
      state.page = 1;
      sync();
      renderDcs();
      loadList();
    });
    grid.appendChild(card);
  });
}

function renderTabs() {
  const box = $("statusTabs");
  box.innerHTML = "";
  [{ key: "", label: "Semua" }].concat(WH_STATUSES).forEach((t) => {
    const active = state.status === t.key;
    const btn = el("button", "tab" + (active ? " active" : ""));
    btn.type = "button";
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", active ? "true" : "false");
    btn.append(el("span", "", t.label), el("span", "tab-count", formatNumber(t.key ? counts[t.key] || 0 : counts.all || 0)));
    btn.addEventListener("click", () => {
      if (state.status === t.key) return;
      state.status = t.key;
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
  tableSkeleton(body, COLS);
  try {
    const data = await api("/wh/sessions" + qs({ branch_id: state.dc, status: state.status, q: state.q, page: state.page, size: PAGE_SIZE }));
    if (seq !== listSeq) return;
    counts = data.counts;
    renderTabs();
    const pages = Math.max(1, Math.ceil(data.total / data.size));
    if (state.page > pages && data.total > 0) {
      state.page = pages;
      sync();
      loadList();
      return;
    }
    body.innerHTML = "";
    if (!data.items.length) {
      tableMessage(body, COLS, "inventory", state.q || state.status || state.dc ? "Tidak ada sesi yang cocok." : "Belum ada sesi stock opname.");
    } else {
      data.items.forEach((s) => body.appendChild(renderRow(s)));
    }
    renderPager(data, "sesi");
  } catch (err) {
    if (err.status === 401 || seq !== listSeq) return;
    tableMessage(body, COLS, "error", "Data sesi belum bisa dimuat.");
    showToast(err.message, true);
  }
}

function renderRow(s) {
  const tr = el("tr", "row-link");
  const href = "wh-session.html?id=" + s.id;
  tr.addEventListener("click", (e) => {
    if (e.target.closest("a, button")) return;
    window.location.href = href;
  });

  const name = el("td");
  const box = el("div", "session-name");
  const a = el("a", "", s.name);
  a.href = href;
  box.append(a, el("span", "cell-sub", "Dibuat " + s.created_by + " • " + formatDateTime(s.created_at)));
  name.appendChild(box);

  const dc = el("td");
  const dcBox = el("div", "row-menu");
  if (s.dc.wh_code) dcBox.appendChild(el("span", "wh-code", s.dc.wh_code));
  dcBox.appendChild(el("span", "", s.dc.name));
  dc.appendChild(dcBox);

  const date = el("td", "", formatDay(s.session_date));
  const st = el("td");
  st.appendChild(badge(whStatusConf(s.status)));
  if (s.status === "Final" && s.finalized_by) st.appendChild(el("div", "cell-sub", "oleh " + s.finalized_by));

  const prog = el("td");
  prog.appendChild(progressBar(s.progress.counted, s.progress.total));

  const act = el("td", "actions");
  const actBox = el("div", "cell-actions");
  if (s.status === "Aktif" && can(App.user, "wh.count.input")) {
    const input = el("a", "btn btn-sm btn-primary");
    input.href = "wh-count.html?id=" + s.id;
    input.append(icon_("edit_note"), el("span", "", "Input Hitung"));
    actBox.appendChild(input);
  }
  const view = el("a", "btn btn-sm btn-ghost");
  view.href = href;
  view.append(icon_("visibility"), el("span", "", "Lihat"));
  actBox.appendChild(view);
  if (s.status !== "Final" && can(App.user, "wh.session.update")) {
    actBox.appendChild(iconBtn("edit", "Edit sesi", () => openForm(s)));
  }
  if (can(App.user, "wh.session.delete") && (s.status !== "Final" || App.user.role === "Master")) {
    actBox.appendChild(iconBtn("delete", "Hapus sesi", () => removeSession(s), true));
  }
  act.appendChild(actBox);

  tr.append(name, dc, date, st, prog, act);
  return tr;
}

function iconBtn(icon, title, fn, danger) {
  const b = el("button", "btn-icon" + (danger ? " danger" : ""));
  b.type = "button";
  b.title = title;
  b.setAttribute("aria-label", title);
  b.appendChild(icon_(icon));
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    fn();
  });
  return b;
}

function defaultName(iso) {
  const d = parseDay(iso);
  return "SO " + BULAN[d.getMonth()] + " " + d.getFullYear();
}

function openForm(s) {
  const edit = !!s;
  const fields = [];
  let dcSelect = null;
  if (!edit) {
    dcSelect = selectEl("sDc", dcs.map((d) => [d.id, d.name + (d.wh_code ? " (" + d.wh_code + ")" : "")]), state.dc || dcs[0].id);
    fields.push(formField("DC", dcSelect));
  }
  const date = inputEl("sDate", { type: "date", value: edit ? s.session_date : todayISO() });
  const name = inputEl("sName", { value: edit ? s.name : defaultName(todayISO()), maxLength: 150, placeholder: "contoh: SO November 2026" });
  let nameTouched = edit;
  name.addEventListener("input", () => { nameTouched = true; });
  date.addEventListener("change", () => { if (!nameTouched && date.value) name.value = defaultName(date.value); });
  fields.push(formField("Tanggal opname", date), formField("Nama sesi", name, "Contoh: SO November 2026. Nama otomatis mengikuti bulan tanggal opname sampai kamu ubah sendiri."));
  formModal({
    title: edit ? "Edit sesi " + s.name : "Buat sesi stock opname",
    submitLabel: edit ? "Simpan perubahan" : "Buat sesi",
    fields,
    focus: "sName",
    onSubmit: async () => {
      if (!requireValue(date, "Pilih tanggal opname dulu ya.")) return false;
      if (!requireValue(name, "Isi nama sesi dulu ya.")) return false;
      if (edit) {
        await api("/wh/sessions/" + s.id, { method: "PATCH", json: { name: name.value.trim(), session_date: date.value } });
        showToast("Sesi " + name.value.trim() + " diperbarui.");
        await loadList();
      } else {
        const created = await api("/wh/sessions", { method: "POST", json: { branch_id: Number(dcSelect.value), name: name.value.trim(), session_date: date.value } });
        flashToast("Sesi " + created.name + " dibuat.");
        window.location.href = "wh-session.html?id=" + created.id;
      }
    }
  });
}

async function removeSession(s) {
  const msg = "Hapus sesi " + s.name + " (" + s.dc.name + ")? Semua hasil hitung" + (s.status === "Final" ? " dan hasil final" : "") + " di sesi ini ikut terhapus. Tindakan ini tidak bisa dibatalkan.";
  if (!(await confirmDialog(msg, { danger: true, confirmLabel: "Ya, Hapus", typeToConfirm: s.progress.counted ? "HAPUS" : null }))) return;
  try {
    await api("/wh/sessions/delete", { method: "POST", json: { ids: [s.id] } });
    showToast("Sesi " + s.name + " dihapus.");
    dcs = await api("/wh/dcs");
    renderDcs();
    await loadList();
  } catch (err) {
    if (err.status !== 401) showToast(err.message, true);
  }
}