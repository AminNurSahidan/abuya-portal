const DEFAULTS = { dc: "", status: "", placed: "", q: "", page: 1 };
const PAGE_SIZE = 25;
const COLS = 8;

const IMPORT_HEADERS = ["DC", "Zona", "Sector", "Barcode", "Nama Produk", "Kode Produk", "Kategori", "Sub Kategori", "Satuan", "Status"];
const IMPORT_WIDTHS = [18, 16, 14, 14, 32, 14, 14, 16, 10, 12];
const IMPORT_COLS = {
  dc: ["dc", "dcnama", "namadc", "dcname", "dcid", "iddc", "kodedc"],
  zone: ["zona", "zonanama", "namazona", "zone", "zonename"],
  sector: ["sector", "sectornama", "namasector", "sektor", "sectorname"],
  barcode: ["barcode", "kodebarcode"],
  name: ["namaproduk", "produknama", "produk", "productname", "nama"],
  product_code: ["kodeproduk", "productcode", "sku"],
  category: ["kategori", "category"],
  sub_category: ["subkategori", "subcategory"],
  unit: ["satuan", "unit"],
  status: ["status", "statusproduk"]
};

const state = readParams(DEFAULTS);
let dcs = [];
let counts = { all: 0, active: 0, inactive: 0 };
let pageItems = [];
const selected = new Set();
let listSeq = 0;
let searchTimer;

bootApp(async (user) => {
  if (!can(user, "wh.product.view")) {
    $("noDcText").textContent = "Role kamu belum punya akses ke Produk Gudang. Hubungi Master ya.";
    $("noDcNotice").hidden = false;
    return;
  }
  dcs = await api("/wh/dcs");
  if (!dcs.length) {
    $("noDcNotice").hidden = false;
    return;
  }
  const rule = dcs.filter((d) => d.wh_code).map((d) => d.wh_code + " = " + d.name).join(", ");
  $("pageDesc").textContent = "Master produk stock opname. Huruf pertama barcode menentukan DC-nya" + (rule ? " (" + rule + ")." : ".");
  const missing = dcs.filter((d) => !d.wh_code);
  if (missing.length) {
    $("noDcText").textContent = missing.map((d) => d.name).join(", ") + " belum punya kode barcode, jadi belum bisa diisi produk. Master bisa mengaturnya di Administrator → Cabang.";
    $("noDcNotice").hidden = false;
  }
  if (state.dc && !dcs.some((d) => String(d.id) === state.dc)) state.dc = "";
  fillOptions($("fDc"), [["", "Semua DC"]].concat(dcs.map((d) => [String(d.id), d.name + (d.wh_code ? " (" + d.wh_code + ")" : "")])));
  $("fDc").value = state.dc;
  $("fPlaced").value = state.placed;
  $("fSearch").value = state.q;
  $("addBtn").hidden = !can(user, "wh.product.create");
  $("importBtn").hidden = !can(user, "wh.data.import");
  $("templateBtn").hidden = !can(user, "wh.data.import");
  $("exportBtn").hidden = !can(user, "wh.data.export");
  $("bulkOn").hidden = !can(user, "wh.product.update");
  $("bulkOff").hidden = !can(user, "wh.product.update");
  $("bulkDelete").hidden = !can(user, "wh.product.delete");
  $("selHead").hidden = !canBulk();
  $("addBtn").addEventListener("click", () => openForm(null));
  $("importBtn").addEventListener("click", openImport);
  $("templateBtn").addEventListener("click", downloadTemplate);
  $("exportBtn").addEventListener("click", openExport);
  bindFilters();
  $("area").hidden = false;
  sync();
  await loadList();
});

function canBulk() {
  return canAny(App.user, ["wh.product.update", "wh.product.delete"]);
}

function fillOptions(select, items) {
  select.innerHTML = "";
  items.forEach(([v, l]) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = l;
    select.appendChild(o);
  });
}

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
  $("fDc").addEventListener("change", (e) => { state.dc = e.target.value; state.page = 1; sync(); loadList(); });
  $("fPlaced").addEventListener("change", (e) => { state.placed = e.target.value; state.page = 1; sync(); loadList(); });
  $("resetBtn").addEventListener("click", () => {
    Object.assign(state, { dc: "", placed: "", q: "", page: 1 });
    $("fSearch").value = "";
    $("fDc").value = "";
    $("fPlaced").value = "";
    sync();
    loadList();
  });
  $("prevBtn").addEventListener("click", () => goPage(state.page - 1));
  $("nextBtn").addEventListener("click", () => goPage(state.page + 1));
  $("selAll").addEventListener("change", (e) => {
    pageItems.forEach((p) => { if (e.target.checked) selected.add(p.barcode); else selected.delete(p.barcode); });
    syncSelection();
  });
  $("bulkClear").addEventListener("click", () => { selected.clear(); syncSelection(); });
  $("bulkOn").addEventListener("click", () => setStatus(Array.from(selected), true));
  $("bulkOff").addEventListener("click", () => setStatus(Array.from(selected), false));
  $("bulkDelete").addEventListener("click", () => removeProducts(Array.from(selected)));
}

function sync() {
  writeParams(state, DEFAULTS);
  $("resetBtn").hidden = !(state.dc || state.placed || state.q);
}

function goPage(n) {
  if (n < 1) return;
  state.page = n;
  sync();
  loadList();
}

function renderTabs() {
  const box = $("statusTabs");
  box.innerHTML = "";
  [["", "Semua", counts.all], ["active", "Aktif", counts.active], ["inactive", "Nonaktif", counts.inactive]].forEach(([key, label, n]) => {
    const active = state.status === key;
    const btn = el("button", "tab" + (active ? " active" : ""));
    btn.type = "button";
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", active ? "true" : "false");
    btn.append(el("span", "", label), el("span", "tab-count", formatNumber(n)));
    btn.addEventListener("click", () => {
      if (state.status === key) return;
      state.status = key;
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
    const data = await api("/wh/products" + qs({ branch_id: state.dc, status: state.status, placed: state.placed, q: state.q, page: state.page, size: PAGE_SIZE }));
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
    pageItems = data.items;
    body.innerHTML = "";
    if (!data.items.length) {
      tableMessage(body, COLS, "barcode", state.q || state.dc || state.placed || state.status ? "Tidak ada produk yang cocok." : "Belum ada produk gudang.");
    } else {
      data.items.forEach((p) => body.appendChild(renderRow(p)));
    }
    syncSelection();
    renderPager(data, "produk");
  } catch (err) {
    if (err.status === 401 || seq !== listSeq) return;
    tableMessage(body, COLS, "error", "Data produk belum bisa dimuat.");
    showToast(err.message, true);
  }
}

function syncSelection() {
  const onPage = pageItems.filter((p) => selected.has(p.barcode)).length;
  $("selAll").checked = pageItems.length > 0 && onPage === pageItems.length;
  $("selAll").indeterminate = onPage > 0 && onPage < pageItems.length;
  document.querySelectorAll("input.row-check").forEach((c) => { c.checked = selected.has(c.value); });
  $("bulkBar").hidden = !selected.size;
  $("bulkInfo").textContent = formatNumber(selected.size) + " produk dipilih";
}

function iconBtn(icon, title, fn, danger) {
  const b = el("button", "btn-icon" + (danger ? " danger" : ""));
  b.type = "button";
  b.title = title;
  b.setAttribute("aria-label", title);
  b.appendChild(icon_(icon));
  b.addEventListener("click", fn);
  return b;
}

function renderRow(p) {
  const tr = el("tr");
  if (canBulk()) {
    const td = el("td", "sel-col");
    const box = el("input", "row-check");
    box.type = "checkbox";
    box.value = p.barcode;
    box.checked = selected.has(p.barcode);
    box.setAttribute("aria-label", "Pilih " + p.name);
    box.addEventListener("change", () => {
      if (box.checked) selected.add(p.barcode);
      else selected.delete(p.barcode);
      syncSelection();
    });
    td.appendChild(box);
    tr.appendChild(td);
  }
  const bc = el("td");
  const bcBox = el("div", "barcode-cell");
  if (p.dc && p.dc.wh_code) {
    const code = el("span", "wh-code", p.dc.wh_code);
    code.title = p.dc.name;
    bcBox.appendChild(code);
  }
  bcBox.appendChild(el("span", "mono", p.barcode));
  bc.appendChild(bcBox);
  const prod = el("td");
  const stack = el("div", "cell-stack");
  stack.append(el("span", "cell-main", p.name), el("span", "cell-sub", p.product_code || "-"));
  prod.appendChild(stack);
  const cat = el("td");
  const cs = el("div", "cell-stack");
  cs.append(el("span", "", p.category || "-"), el("span", "cell-sub", p.sub_category || ""));
  cat.appendChild(cs);
  const loc = el("td");
  if (p.placements.length) {
    const ll = el("div", "loc-list");
    p.placements.slice(0, 2).forEach((x) => ll.appendChild(el("span", "", x)));
    if (p.placements.length > 2) {
      const more = el("span", "loc-more", "+" + (p.placements.length - 2) + " lainnya");
      more.title = p.placements.join("\n");
      ll.appendChild(more);
    }
    loc.appendChild(ll);
  } else {
    loc.appendChild(el("span", "muted", "Belum ada"));
  }
  const st = el("td");
  st.appendChild(badge(p.is_active ? { label: "Aktif", tone: "green" } : { label: "Nonaktif", tone: "slate" }));
  if (!p.is_active && p.deactivated_at) st.appendChild(el("div", "cell-sub", "sejak " + formatDMY(p.deactivated_at)));
  const act = el("td", "actions");
  const box = el("div", "cell-actions");
  if (can(App.user, "wh.product.update")) {
    box.appendChild(iconBtn("edit", "Edit produk", () => openForm(p)));
    box.appendChild(iconBtn(p.is_active ? "toggle_off" : "toggle_on", p.is_active ? "Nonaktifkan" : "Aktifkan", () => setStatus([p.barcode], !p.is_active)));
  }
  if (can(App.user, "wh.product.delete")) box.appendChild(iconBtn("delete", "Hapus produk", () => removeProducts([p.barcode]), true));
  act.appendChild(box);
  tr.append(bc, prod, cat, el("td", "", p.unit || "-"), loc, st, act);
  return tr;
}

function openForm(p) {
  const edit = !!p;
  const codes = dcs.filter((d) => d.wh_code).map((d) => d.wh_code + " = " + d.name).join(", ");
  const barcode = inputEl("pBarcode", { value: edit ? p.barcode : "", maxLength: 60, placeholder: "contoh: A00015" });
  barcode.disabled = edit;
  barcode.classList.add("mono");
  const name = inputEl("pName", { value: edit ? p.name : "", maxLength: 200 });
  const code = inputEl("pCode", { value: edit ? p.product_code || "" : "", maxLength: 60 });
  const cat = inputEl("pCat", { value: edit ? p.category || "" : "", maxLength: 100 });
  const sub = inputEl("pSub", { value: edit ? p.sub_category || "" : "", maxLength: 100 });
  const unit = inputEl("pUnit", { value: edit ? p.unit || "" : "", maxLength: 30, placeholder: "contoh: Pack" });
  formModal({
    title: edit ? "Edit produk " + p.barcode : "Tambah produk gudang",
    submitLabel: edit ? "Simpan perubahan" : "Tambah produk",
    focus: edit ? "pName" : "pBarcode",
    fields: [
      formField("Barcode", barcode, edit ? "Barcode tidak bisa diubah." : "Huruf pertama = kode DC (" + (codes || "belum ada DC dengan kode barcode") + ")."),
      formField("Nama produk", name),
      formField("Kode produk", code),
      formField("Kategori", cat),
      formField("Sub kategori", sub),
      formField("Satuan", unit)
    ],
    onSubmit: async () => {
      if (!edit && !requireValue(barcode, "Isi barcode dulu ya.")) return false;
      if (!requireValue(name, "Isi nama produk dulu ya.")) return false;
      const body = { name: name.value.trim(), product_code: code.value.trim() || null, category: cat.value.trim() || null, sub_category: sub.value.trim() || null, unit: unit.value.trim() || null };
      if (edit) {
        await api("/wh/products/" + encodeURIComponent(p.barcode), { method: "PATCH", json: body });
        showToast("Produk " + body.name + " diperbarui.");
      } else {
        const created = await api("/wh/products", { method: "POST", json: Object.assign({ barcode: barcode.value.trim() }, body) });
        showToast("Produk " + created.name + " ditambahkan ke " + created.dc.name + ".");
      }
      await loadList();
    }
  });
}

async function setStatus(barcodes, active) {
  if (!barcodes.length) return;
  const msg = active
    ? "Aktifkan " + formatNumber(barcodes.length) + " produk?"
    : "Nonaktifkan " + formatNumber(barcodes.length) + " produk? Produk nonaktif tidak muncul lagi untuk dihitung di sesi baru, tapi riwayatnya tetap aman.";
  if (!(await confirmDialog(msg, { confirmLabel: active ? "Ya, Aktifkan" : "Ya, Nonaktifkan", danger: !active }))) return;
  try {
    const res = await api("/wh/products/status", { method: "POST", json: { barcodes, active } });
    showToast(formatNumber(res.added) + " produk " + (active ? "diaktifkan." : "dinonaktifkan."));
    selected.clear();
    await loadList();
  } catch (err) {
    if (err.status !== 401) showToast(err.message, true);
  }
}

async function removeProducts(barcodes) {
  if (!barcodes.length) return;
  const msg = (barcodes.length === 1 ? "Hapus produk " + barcodes[0] + "?" : "Hapus " + formatNumber(barcodes.length) + " produk?") + " Produk yang sudah pernah dihitung tidak bisa dihapus (nonaktifkan saja).";
  if (!(await confirmDialog(msg, { danger: true, confirmLabel: "Ya, Hapus", typeToConfirm: barcodes.length > 1 ? "HAPUS" : null }))) return;
  try {
    const res = await api("/wh/products/delete", { method: "POST", json: { barcodes } });
    let txt = formatNumber(res.added) + " produk dihapus.";
    if (res.skipped.length) txt += " " + formatNumber(res.skipped.length) + " dilewati karena sudah dipakai di stock opname.";
    showToast(txt, !res.added);
    selected.clear();
    await loadList();
  } catch (err) {
    if (err.status !== 401) showToast(err.message, true);
  }
}

async function downloadTemplate() {
  try {
    const sample = dcs.find((d) => d.wh_code) || { name: "DC A", wh_code: "A" };
    await writeXlsx([{
      name: "Data Gudang",
      headers: IMPORT_HEADERS,
      widths: IMPORT_WIDTHS,
      rows: [
        [sample.name, "Zona Dry", "Rak 01", sample.wh_code + "00001", "Tepung Bumbu Original 1kg", "SKU-001", "Bumbu", "Tepung", "Pack", "Active"],
        [sample.name, "Zona Dry", "Rak 01", sample.wh_code + "00002", "Minyak Goreng 18L", "SKU-002", "Minyak", "Minyak", "Jerigen", "Active"],
        [sample.name, "Zona Chiller", "Chiller 01", sample.wh_code + "00003", "Keju Slice 84pcs", "SKU-003", "Dairy", "Keju", "Pack", "Not Active"]
      ]
    }], "Template_Import_Data_Gudang.xlsx");
  } catch (err) {
    showToast(err.message, true);
  }
}

function openExport() {
  const dcSel = selectEl("eDc", dcs.map((d) => [d.id, d.name]), state.dc || dcs[0].id);
  formModal({
    title: "Export data gudang",
    submitLabel: "Download Excel",
    fields: [formField("DC", dcSel, "Isi file: zona, sector, dan produk per sector, plus produk yang belum ditempatkan. Format sama dengan template import, jadi bisa diedit lalu diimport lagi.")],
    onSubmit: async () => {
      const dc = dcs.find((d) => String(d.id) === dcSel.value);
      const rows = await api("/wh/dcs/" + dc.id + "/export");
      await writeXlsx([{
        name: "Data Gudang",
        headers: IMPORT_HEADERS,
        widths: IMPORT_WIDTHS,
        rows: rows.map((r) => [r.dc, r.zone, r.sector, r.barcode, r.name, r.product_code, r.category, r.sub_category, r.unit, r.status])
      }], "Data_Gudang_" + safeName(dc.name) + "_" + todayISO() + ".xlsx");
      showToast(formatNumber(rows.length) + " baris diexport.");
    }
  });
}

function normHeader(v) {
  return String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function cellText(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("").trim();
    if (v.text !== undefined) return cellText(v.text);
    if (v.result !== undefined) return cellText(v.result);
    return "";
  }
  return String(v).trim();
}

async function parseFile(file) {
  await ensureExcel();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  let best = null;
  wb.eachSheet((ws) => {
    for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
      const map = {};
      ws.getRow(r).eachCell((cell, col) => {
        const h = normHeader(cellText(cell.value));
        Object.entries(IMPORT_COLS).forEach(([key, aliases]) => {
          const rank = aliases.indexOf(h);
          if (rank >= 0 && (map[key] === undefined || rank < map[key].rank)) map[key] = { col, rank };
        });
      });
      const score = Object.keys(map).length;
      if (map.barcode || map.zone) {
        if (!best || score > best.score) best = { ws, headerRow: r, map, score };
        break;
      }
    }
  });
  if (!best) throw new Error("Kolom Barcode atau Zona tidak ditemukan. Pakai file dari tombol Template atau Export.");
  const rows = [];
  for (let r = best.headerRow + 1; r <= best.ws.rowCount; r++) {
    const row = best.ws.getRow(r);
    const item = { row: r };
    let any = false;
    Object.keys(IMPORT_COLS).forEach((key) => {
      const v = best.map[key] ? cellText(row.getCell(best.map[key].col).value) : "";
      item[key] = v;
      if (v) any = true;
    });
    if (any) rows.push(item);
  }
  return { sheet: best.ws.name, rows, cols: Object.keys(best.map) };
}

function openImport() {
  const file = el("input");
  file.type = "file";
  file.accept = ".xlsx";
  file.hidden = true;
  const drop = el("div", "upload-drop");
  drop.append(icon_("upload_file"), el("strong", "", "Pilih file Excel (.xlsx)"), el("span", "", "atau tarik file ke sini"));
  drop.addEventListener("click", () => file.click());
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("drag"); }));
  drop.addEventListener("drop", (e) => { if (e.dataTransfer.files[0]) handle(e.dataTransfer.files[0]); });
  const info = el("div", "hint-box");
  info.innerHTML = "";
  info.append(
    el("div", "", "Kolom yang dibaca: DC, Zona, Sector, Barcode, Nama Produk, Kode Produk, Kategori, Sub Kategori, Satuan, Status."),
    el("div", "", "• Produk baru wajib punya Nama Produk. Huruf pertama barcode harus kode DC."),
    el("div", "", "• Zona dan sector yang belum ada otomatis dibuat. Produk otomatis ditempatkan di sector yang diisi."),
    el("div", "", "• File export dari ABWarehouse lama juga bisa dipakai.")
  );
  const result = el("div");
  const upd = el("label", "check-row");
  const updBox = el("input");
  updBox.type = "checkbox";
  upd.append(updBox, el("span", "", "Perbarui data produk yang barcode-nya sudah ada"));
  let parsed = null;
  const modal = formModal({
    title: "Import data gudang",
    submitLabel: "Import",
    wide: true,
    fields: [drop, file, info, upd, result],
    onSubmit: async ({ submit }) => {
      if (!parsed) {
        showToast("Pilih file Excel dulu ya.", true);
        return false;
      }
      submit.textContent = "Mengimport...";
      try {
        const res = await api("/wh/import", { method: "POST", json: { rows: parsed.rows, update_existing: updBox.checked } });
        showResult(res);
        parsed = null;
        submit.hidden = true;
        modal.cancel.textContent = "Tutup";
        await loadList();
        return false;
      } finally {
        submit.textContent = "Import";
      }
    }
  });

  async function handle(f) {
    result.innerHTML = "";
    try {
      parsed = await parseFile(f);
      if (!parsed.rows.length) throw new Error("File tidak punya baris data.");
      if (parsed.rows.length > 10000) throw new Error("Maksimal 10.000 baris per import. Pecah filenya dulu ya.");
      drop.querySelector("strong").textContent = f.name;
      drop.querySelector("span:last-child").textContent = "Klik untuk ganti file";
      const sum = el("div", "import-summary");
      const chip = (label, n) => {
        const c = el("span", "import-chip");
        c.append(el("b", "", formatNumber(n)), document.createTextNode(" " + label));
        return c;
      };
      const barcodes = new Set(parsed.rows.filter((r) => r.barcode).map((r) => r.barcode.toUpperCase()));
      const zonesSet = new Set(parsed.rows.filter((r) => r.zone).map((r) => (r.dc + "|" + r.zone).toLowerCase()));
      sum.append(chip("baris", parsed.rows.length), chip("barcode", barcodes.size), chip("zona", zonesSet.size));
      const prev = el("div", "import-preview");
      const t = el("table");
      const head = el("tr");
      IMPORT_HEADERS.forEach((h) => head.appendChild(el("th", "", h)));
      const thead = el("thead");
      thead.appendChild(head);
      const tb = el("tbody");
      parsed.rows.slice(0, 8).forEach((r) => {
        const tr = el("tr");
        ["dc", "zone", "sector", "barcode", "name", "product_code", "category", "sub_category", "unit", "status"].forEach((k) => tr.appendChild(el("td", "", r[k] || "")));
        tb.appendChild(tr);
      });
      t.append(thead, tb);
      prev.appendChild(t);
      result.append(sum, prev);
      if (parsed.rows.length > 8) result.appendChild(el("div", "hint-box", "Menampilkan 8 dari " + formatNumber(parsed.rows.length) + " baris (sheet " + parsed.sheet + ")."));
      modal.submit.hidden = false;
    } catch (err) {
      parsed = null;
      result.appendChild(el("div", "skip-item", err.message));
    }
  }

  function showResult(res) {
    result.innerHTML = "";
    const sum = el("div", "import-summary");
    [["produk baru", res.products_added], ["produk diperbarui", res.products_updated], ["zona baru", res.zones_added], ["sector baru", res.sectors_added], ["penempatan baru", res.placements_added], ["dilewati", res.skipped.length]].forEach(([l, n]) => {
      const c = el("span", "import-chip");
      c.append(el("b", "", formatNumber(n)), document.createTextNode(" " + l));
      sum.appendChild(c);
    });
    result.appendChild(sum);
    if (res.skipped.length) {
      const list = el("div", "skip-list");
      res.skipped.slice(0, 200).forEach((s) => {
        const item = el("div", "skip-item");
        item.append(el("b", "", "Baris " + s.row + " (" + s.label + "): "), document.createTextNode(s.reason));
        list.appendChild(item);
      });
      result.appendChild(list);
    }
    showToast("Import selesai.");
  }

  file.addEventListener("change", () => { if (file.files[0]) handle(file.files[0]); });
}