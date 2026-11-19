const DEFAULTS = { id: "", view: "monitor", zone: "", sector: "", state: "", q: "", page: 1 };
const PAGE_SIZE = 50;
const COLS = 5;

const state = readParams(DEFAULTS);
let detail = null;
let review = null;
const edits = new Map();
let listSeq = 0;
let searchTimer;
let stopPoll = null;

bootApp(async () => {
  showFlash();
  if (!state.id) return fail("Sesi tidak ditemukan.");
  try {
    await loadDetail();
  } catch (err) {
    if (err.status === 401) return;
    return fail(err.message);
  }
  $("area").hidden = false;
  $("fSearch").value = state.q;
  $("fState").value = state.state;
  bindUI();
  switchView(state.view, true);
  await loadList();
  if (detail.status === "Aktif") startLive();
});

function fail(msg) {
  $("errorText").textContent = msg;
  $("errorNotice").hidden = false;
  $("title").textContent = "Sesi tidak bisa dibuka";
}

function startLive() {
  if (stopPoll) return;
  $("liveTag").hidden = false;
  stopPoll = startPolling(async () => {
    await loadDetail(true);
    if (state.view === "monitor") await loadList(true);
  }, 15000);
}

function stopLive() {
  if (stopPoll) stopPoll();
  stopPoll = null;
  $("liveTag").hidden = true;
}

async function loadDetail(silent) {
  detail = await api("/wh/sessions/" + state.id);
  renderHeader();
  renderSummary();
  if (!silent) fillZoneFilters();
}

function renderHeader() {
  const d = detail;
  document.title = d.name + " - Abuya Portal";
  $("crumbName").textContent = d.name;
  $("title").textContent = d.name;
  const meta = $("meta");
  meta.innerHTML = "";
  const dc = el("span");
  if (d.dc.wh_code) dc.appendChild(el("span", "wh-code", d.dc.wh_code));
  dc.appendChild(el("span", "", d.dc.name));
  const date = el("span");
  date.append(icon_("event"), el("span", "", formatDay(d.session_date)));
  const by = el("span");
  by.append(icon_("person"), el("span", "", "Dibuat " + d.created_by));
  meta.append(badge(whStatusConf(d.status)), dc, date, by);
  if (d.status === "Final") {
    const fin = el("span");
    fin.append(icon_("verified"), el("span", "", "Final oleh " + d.finalized_by + " • " + formatDateTime(d.finalized_at)));
    meta.appendChild(fin);
  }

  const act = $("actions");
  act.innerHTML = "";
  if (d.can.input) {
    const a = el("a", "btn btn-primary");
    a.href = "wh-count.html?id=" + d.id;
    a.append(icon_("edit_note"), el("span", "", "Input Hitung"));
    act.appendChild(a);
  }
  if (d.can.export) {
    act.appendChild(actionBtn("btn btn-ghost", "print", "Cetak Counting Sheet", openPrint));
    act.appendChild(actionBtn("btn btn-ghost", "download", "Export Excel", exportExcel));
  }
  if (d.can.update && d.status === "Aktif") act.appendChild(actionBtn("btn btn-ghost", "lock", "Tutup Sesi", () => setStatus("Selesai")));
  if (d.can.update && d.status === "Selesai") act.appendChild(actionBtn("btn btn-ghost", "lock_open", "Buka Lagi", () => setStatus("Aktif")));
}

function actionBtn(cls, icon, label, fn) {
  const b = el("button", cls);
  b.type = "button";
  b.append(icon_(icon), el("span", "", label));
  b.addEventListener("click", fn);
  return b;
}

function renderSummary() {
  const p = detail.progress;
  const pct = p.total ? Math.round((p.counted / p.total) * 100) : 0;
  $("sumPct").textContent = pct + "%";
  $("sumCount").textContent = formatNumber(p.counted) + "/" + formatNumber(p.total) + " item dihitung";
  $("sumBar").style.width = pct + "%";
  $("sumBar").classList.toggle("done", pct >= 100);
  $("lastUpdate").textContent = detail.last_count_at ? "Hitungan terakhir " + timeAgo(detail.last_count_at) : "Belum ada hitungan";

  const grid = $("zoneGrid");
  grid.innerHTML = "";
  detail.zones.forEach((z) => {
    const active = state.zone === String(z.id);
    const card = el("button", "zone-card" + (active ? " active" : ""));
    card.type = "button";
    card.title = active ? "Klik lagi untuk tampilkan semua zona" : "Tampilkan zona ini";
    card.append(el("strong", "", z.name), el("span", "zone-sub", formatNumber(z.sectors.length) + " sector"), progressBar(z.counted, z.total));
    card.addEventListener("click", () => {
      state.zone = active ? "" : String(z.id);
      state.sector = "";
      state.page = 1;
      if (state.view !== "monitor") switchView("monitor");
      fillZoneFilters();
      sync();
      renderSummary();
      loadList();
    });
    grid.appendChild(card);
  });
  if (!detail.zones.length) grid.appendChild(emptyBlock("shelves", "DC ini belum punya zona. Atur dulu di Struktur Gudang."));
}

function fillZoneFilters() {
  const z = $("fZone");
  z.innerHTML = "";
  [["", "Semua zona"]].concat(detail.zones.map((x) => [String(x.id), x.name])).forEach(([v, l]) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = l;
    z.appendChild(o);
  });
  if (state.zone && !detail.zones.some((x) => String(x.id) === state.zone)) state.zone = "";
  z.value = state.zone;
  const s = $("fSector");
  s.innerHTML = "";
  const zone = detail.zones.find((x) => String(x.id) === state.zone);
  const sectors = zone ? zone.sectors : detail.zones.flatMap((x) => x.sectors.map((sec) => Object.assign({}, sec, { name: x.name + " / " + sec.name })));
  [["", "Semua sector"]].concat(sectors.map((x) => [String(x.id), x.name])).forEach(([v, l]) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = l;
    s.appendChild(o);
  });
  if (state.sector && !sectors.some((x) => String(x.id) === state.sector)) state.sector = "";
  s.value = state.sector;
}

function bindUI() {
  $("fSearch").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.q = e.target.value.trim();
      state.page = 1;
      sync();
      loadList();
    }, 300);
  });
  $("fZone").addEventListener("change", (e) => {
    state.zone = e.target.value;
    state.sector = "";
    state.page = 1;
    fillZoneFilters();
    sync();
    renderSummary();
    loadList();
  });
  $("fSector").addEventListener("change", (e) => { state.sector = e.target.value; state.page = 1; sync(); loadList(); });
  $("fState").addEventListener("change", (e) => { state.state = e.target.value; state.page = 1; sync(); loadList(); });
  $("resetBtn").addEventListener("click", () => {
    Object.assign(state, { zone: "", sector: "", state: "", q: "", page: 1 });
    $("fSearch").value = "";
    $("fState").value = "";
    fillZoneFilters();
    sync();
    renderSummary();
    loadList();
  });
  $("prevBtn").addEventListener("click", () => goPage(state.page - 1));
  $("nextBtn").addEventListener("click", () => goPage(state.page + 1));
  document.querySelectorAll("#viewTabs .tab").forEach((t) => t.addEventListener("click", () => switchView(t.dataset.view)));
  $("rSearch").addEventListener("input", renderReview);
  $("rDiffOnly").addEventListener("change", renderReview);
}

function sync() {
  writeParams(state, DEFAULTS);
  $("resetBtn").hidden = !(state.zone || state.sector || state.state || state.q);
}

function goPage(n) {
  if (n < 1) return;
  state.page = n;
  sync();
  loadList();
}

function switchView(view, initial) {
  state.view = view === "review" ? "review" : "monitor";
  document.querySelectorAll("#viewTabs .tab").forEach((t) => {
    const on = t.dataset.view === state.view;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
  });
  $("monitorPanel").hidden = state.view !== "monitor";
  $("reviewPanel").hidden = state.view !== "review";
  sync();
  if (state.view === "review") loadReview();
  else if (!initial) loadList();
}

async function loadList(silent) {
  const seq = ++listSeq;
  const body = $("tableBody");
  if (!silent) tableSkeleton(body, COLS);
  try {
    const data = await api("/wh/sessions/" + state.id + "/rows" + qs({ zone_id: state.zone, sector_id: state.sector, state: state.state, q: state.q, page: state.page, size: PAGE_SIZE }));
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
      const filtered = state.zone || state.sector || state.state || state.q;
      tableMessage(body, COLS, "inventory_2", filtered ? "Tidak ada item yang cocok." : "Belum ada produk yang ditempatkan di sector DC ini.");
    } else {
      data.items.forEach((r) => body.appendChild(renderRow(r)));
    }
    renderPager(data, "item");
  } catch (err) {
    if (err.status === 401 || seq !== listSeq) return;
    if (!silent) {
      tableMessage(body, COLS, "error", "Data hitung belum bisa dimuat.");
      showToast(err.message, true);
    }
  }
}

function renderRow(r) {
  const tr = el("tr");
  const loc = el("td");
  const lb = el("div", "loc");
  lb.append(el("span", "cell-main", r.sector), el("span", "cell-sub", r.zone));
  loc.appendChild(lb);
  const bc = el("td", "mono", r.barcode);
  const prod = el("td");
  const pb = el("div", "cell-stack");
  pb.appendChild(el("span", "cell-main", r.name));
  const sub = el("span", "cell-sub", [r.product_code, r.unit].filter(Boolean).join(" • ") || "-");
  pb.appendChild(sub);
  if (!r.is_active) pb.appendChild(el("span", "tag-off", "Nonaktif"));
  prod.appendChild(pb);
  const qty = el("td", "num");
  if (r.qty === null) {
    qty.appendChild(el("span", "qty-cell qty-empty", "Belum"));
  } else {
    const q = el("span", "qty-cell", formatQty(r.qty));
    if (r.unit) q.appendChild(el("small", "", r.unit));
    qty.appendChild(q);
    if (r.note) qty.appendChild(el("div", "note-line", r.note));
  }
  const by = el("td");
  if (r.updated_by) {
    const s = el("div", "cell-stack");
    s.append(el("span", "cell-main", r.updated_by), el("span", "cell-sub", formatDateTime(r.updated_at)));
    by.appendChild(s);
  } else {
    by.appendChild(el("span", "muted", "-"));
  }
  tr.append(loc, bc, prod, qty, by);
  return tr;
}

async function setStatus(status) {
  const closing = status === "Selesai";
  const msg = closing
    ? "Tutup sesi " + detail.name + "? Setelah ditutup, tim tidak bisa input hitung lagi sampai sesi dibuka lagi."
    : "Buka lagi sesi " + detail.name + " supaya tim bisa input hitung?";
  if (!(await confirmDialog(msg, { confirmLabel: closing ? "Ya, Tutup" : "Ya, Buka" }))) return;
  try {
    await api("/wh/sessions/" + detail.id + "/status", { method: "POST", json: { status } });
    showToast(closing ? "Sesi ditutup." : "Sesi dibuka lagi.");
    await loadDetail(true);
    if (detail.status === "Aktif") startLive();
    else stopLive();
    if (state.view === "review") await loadReview();
  } catch (err) {
    if (err.status !== 401) showToast(err.message, true);
  }
}

async function loadReview() {
  const body = $("reviewBody");
  tableSkeleton(body, 7);
  try {
    review = await api("/wh/sessions/" + state.id + "/review");
    renderReviewHead();
    renderReview();
  } catch (err) {
    if (err.status === 401) return;
    tableMessage(body, 7, "error", "Data review belum bisa dimuat.");
    showToast(err.message, true);
  }
}

function editable() {
  return !!review && !review.final && detail.can.finalize;
}

function finalValue(r) {
  if (edits.has(r.barcode)) return edits.get(r.barcode).qty;
  return r.qty_final !== null && r.qty_final !== undefined ? r.qty_final : r.qty_count;
}

function noteValue(r) {
  if (edits.has(r.barcode)) return edits.get(r.barcode).note;
  return r.note || "";
}

function renderReviewHead() {
  const info = $("reviewInfo");
  info.innerHTML = "";
  const lines = [];
  if (review.final) {
    lines.push(el("span", "", "Hasil sudah difinalisasi oleh " + detail.finalized_by + " pada " + formatDateTime(detail.finalized_at) + "."));
  } else if (detail.can.finalize) {
    lines.push(el("span", "", "Cek qty hitung per produk (gabungan semua sector). Ubah Qty final kalau ada koreksi, lalu klik Finalisasi."));
  } else {
    lines.push(el("span", "", "Rekap qty hitung per produk (gabungan semua sector)."));
  }
  if (!review.final && review.uncounted) {
    const w = el("span", "review-warn");
    w.append(icon_("warning"), el("span", "", formatNumber(review.uncounted) + " item di sector belum dihitung dan tidak ikut finalisasi."));
    lines.push(w);
  }
  lines.forEach((l) => info.appendChild(l));

  const act = $("reviewActions");
  act.innerHTML = "";
  if (editable() && review.items.length) {
    act.appendChild(actionBtn("btn btn-ghost", "restart_alt", "Reset koreksi", () => { edits.clear(); renderReview(); }));
    act.appendChild(actionBtn("btn btn-primary", "verified", "Finalisasi", finalize));
  }
  if (review.final && detail.can.unfinalize) act.appendChild(actionBtn("btn btn-danger", "undo", "Batalkan Final", unfinalize));
}

function renderReview() {
  if (!review) return;
  const body = $("reviewBody");
  body.innerHTML = "";
  const q = $("rSearch").value.trim().toLowerCase();
  const diffOnly = $("rDiffOnly").checked;
  const rows = review.items.filter((r) => {
    if (q && !r.barcode.toLowerCase().includes(q) && !r.name.toLowerCase().includes(q)) return false;
    if (diffOnly && Number(finalValue(r)) === Number(r.qty_count)) return false;
    return true;
  });
  const diffCount = review.items.filter((r) => Number(finalValue(r)) !== Number(r.qty_count)).length;
  $("reviewInfoFoot").textContent = formatNumber(review.items.length) + " produk • " + formatNumber(diffCount) + " ada selisih";
  if (!rows.length) {
    tableMessage(body, 7, "fact_check", review.items.length ? "Tidak ada produk yang cocok." : "Belum ada hasil hitung di sesi ini.");
    return;
  }
  rows.forEach((r) => body.appendChild(reviewRow(r)));
}

function reviewRow(r) {
  const tr = el("tr");
  const prod = el("td");
  const pb = el("div", "cell-stack");
  pb.append(el("span", "cell-main", r.name), el("span", "cell-sub", r.unit || "-"));
  prod.appendChild(pb);
  const loc = el("td", "cell-sub", r.sectors);
  const cnt = el("td", "num");
  cnt.appendChild(el("span", "qty-cell", formatQty(r.qty_count)));
  const fin = el("td", "num");
  const diff = el("td", "num");
  const note = el("td");
  const paintDiff = () => {
    diff.innerHTML = "";
    const d = Number(finalValue(r)) - Number(r.qty_count);
    const s = el("span", d > 0 ? "diff-plus" : d < 0 ? "diff-minus" : "diff-zero", d === 0 ? "0" : (d > 0 ? "+" : "") + formatQty(d));
    diff.appendChild(s);
  };
  if (editable()) {
    const input = el("input", "input final-input");
    input.type = "number";
    input.min = "0";
    input.step = "any";
    input.inputMode = "decimal";
    input.value = String(finalValue(r));
    const noteIn = el("input", "input note-input");
    noteIn.maxLength = 300;
    noteIn.placeholder = "Alasan koreksi";
    noteIn.value = noteValue(r);
    const store = () => {
      const qty = input.value === "" ? r.qty_count : Number(input.value);
      const n = noteIn.value.trim();
      if (qty === Number(r.qty_count) && !n) edits.delete(r.barcode);
      else edits.set(r.barcode, { qty, note: n });
      paintDiff();
      $("reviewInfoFoot").textContent = formatNumber(review.items.length) + " produk • " + formatNumber(review.items.filter((x) => Number(finalValue(x)) !== Number(x.qty_count)).length) + " ada selisih";
    };
    input.addEventListener("input", store);
    noteIn.addEventListener("input", store);
    fin.appendChild(input);
    note.appendChild(noteIn);
  } else {
    fin.appendChild(el("span", "qty-cell", r.qty_final === null || r.qty_final === undefined ? "-" : formatQty(r.qty_final)));
    note.appendChild(el("span", r.note ? "" : "muted", r.note || "-"));
  }
  paintDiff();
  tr.append(el("td", "mono", r.barcode), prod, loc, cnt, fin, diff, note);
  return tr;
}

async function finalize() {
  for (const [b, e] of edits) {
    if (!Number.isFinite(e.qty) || e.qty < 0) {
      showToast("Qty final " + b + " tidak valid.", true);
      return;
    }
  }
  const diffs = review.items.filter((r) => Number(finalValue(r)) !== Number(r.qty_count)).length;
  let msg = "Finalisasi " + detail.name + " dengan " + formatNumber(review.items.length) + " produk";
  msg += diffs ? " (" + formatNumber(diffs) + " dikoreksi)?" : "?";
  if (review.uncounted) msg += " Masih ada " + formatNumber(review.uncounted) + " item belum dihitung.";
  msg += " Setelah Final, hitungan dikunci dan sesi tidak bisa diubah lagi.";
  if (!(await confirmDialog(msg, { confirmLabel: "Ya, Finalisasi" }))) return;
  try {
    const items = review.items.map((r) => ({ barcode: r.barcode, qty_final: Number(finalValue(r)), note: noteValue(r) || null }));
    await api("/wh/sessions/" + detail.id + "/finalize", { method: "POST", json: { items } });
    edits.clear();
    showToast("Sesi difinalisasi.");
    stopLive();
    await loadDetail(true);
    await loadReview();
  } catch (err) {
    if (err.status !== 401) showToast(err.message, true);
  }
}

async function unfinalize() {
  if (!(await confirmDialog("Batalkan finalisasi " + detail.name + "? Qty final dihapus dan status kembali jadi Selesai.", { danger: true, confirmLabel: "Ya, Batalkan" }))) return;
  try {
    await api("/wh/sessions/" + detail.id + "/unfinalize", { method: "POST" });
    showToast("Finalisasi dibatalkan.");
    await loadDetail(true);
    await loadReview();
  } catch (err) {
    if (err.status !== 401) showToast(err.message, true);
  }
}

async function fetchAllRows(zoneId) {
  const data = await api("/wh/sessions/" + detail.id + "/rows" + qs({ zone_id: zoneId || "", size: 5000 }));
  return data.items;
}

async function exportExcel() {
  try {
    showToast("Menyiapkan file Excel...");
    const [rows, rv] = await Promise.all([fetchAllRows(), api("/wh/sessions/" + detail.id + "/review")]);
    const sheets = [
      {
        name: "Rekap",
        headers: ["Barcode", "Nama Produk", "Satuan", "Lokasi", "Qty Hitung", "Qty Final", "Selisih", "Catatan"],
        widths: [14, 34, 10, 36, 12, 12, 10, 28],
        rows: rv.items.map((r) => {
          const fin = r.qty_final === null || r.qty_final === undefined ? null : r.qty_final;
          return [r.barcode, r.name, r.unit || "", r.sectors, r.qty_count, fin === null ? "" : fin, fin === null ? "" : fin - r.qty_count, r.note || ""];
        })
      },
      {
        name: "Detail Hitung",
        headers: ["Zona", "Sector", "Barcode", "Nama Produk", "Kode Produk", "Satuan", "Qty", "Catatan", "Dihitung Oleh", "Waktu"],
        widths: [16, 16, 14, 34, 14, 10, 10, 24, 16, 18],
        rows: rows.map((r) => [r.zone, r.sector, r.barcode, r.name, r.product_code || "", r.unit || "", r.qty === null ? "" : r.qty, r.note || "", r.updated_by || "", r.updated_at ? formatDateTime(r.updated_at) : ""])
      }
    ];
    await writeXlsx(sheets, "SO_" + safeName(detail.dc.name) + "_" + safeName(detail.name) + ".xlsx");
    showToast("File Excel diunduh.");
  } catch (err) {
    if (err.status !== 401) showToast(err.message, true);
  }
}

function openPrint() {
  const zoneSel = selectEl("pZone", [["", "Semua zona"]].concat(detail.zones.map((z) => [z.id, z.name])), state.zone);
  const blank = el("label", "check-row");
  const blankBox = el("input");
  blankBox.type = "checkbox";
  blankBox.id = "pBlank";
  blankBox.checked = true;
  blank.append(blankBox, el("span", "", "Kosongkan kolom Qty (untuk dihitung manual)"));
  formModal({
    title: "Cetak Counting Sheet",
    submitLabel: "Buat PDF",
    fields: [formField("Zona", zoneSel, "Setiap sector dicetak di halaman terpisah."), blank],
    onSubmit: async () => {
      await printSheets(zoneSel.value, blankBox.checked);
    }
  });
}

async function printSheets(zoneId, blank) {
  await ensurePdf();
  const rows = await fetchAllRows(zoneId);
  if (!rows.length) {
    showToast("Tidak ada produk untuk dicetak.", true);
    return false;
  }
  const groups = [];
  rows.forEach((r) => {
    let g = groups[groups.length - 1];
    if (!g || g.sector_id !== r.sector_id) {
      g = { sector_id: r.sector_id, zone: r.zone, sector: r.sector, rows: [] };
      groups.push(g);
    }
    g.rows.push(r);
  });
  const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
  groups.forEach((g, i) => {
    if (i) doc.addPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("COUNTING SHEET STOCK OPNAME", 14, 16);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    const info = [
      ["DC", detail.dc.name],
      ["Sesi", detail.name + " (" + formatDay(detail.session_date) + ")"],
      ["Zona / Sector", g.zone + " / " + g.sector],
      ["Dicetak", formatDateTime(new Date().toISOString()) + " oleh " + App.user.username]
    ];
    info.forEach(([k, v], n) => {
      doc.text(k, 14, 24 + n * 5);
      doc.text(": " + v, 42, 24 + n * 5);
    });
    doc.autoTable({
      startY: 46,
      head: [["No", "Barcode", "Nama Produk", "Satuan", "Qty Fisik", "Catatan"]],
      body: g.rows.map((r, n) => [n + 1, r.barcode, r.name + (r.is_active ? "" : " (nonaktif)"), r.unit || "", blank || r.qty === null ? "" : formatQty(r.qty), blank ? "" : r.note || ""]),
      styles: { fontSize: 9, cellPadding: 2.2, lineColor: [203, 213, 225], lineWidth: 0.1, minCellHeight: 8, valign: "middle" },
      headStyles: { fillColor: [22, 62, 100], textColor: 255, fontStyle: "bold" },
      columnStyles: { 0: { cellWidth: 10, halign: "center" }, 1: { cellWidth: 28 }, 3: { cellWidth: 20 }, 4: { cellWidth: 24, halign: "right" }, 5: { cellWidth: 40 } },
      margin: { left: 14, right: 14 }
    });
    const y = Math.min(doc.lastAutoTable.finalY + 18, 270);
    doc.setFontSize(9.5);
    [["Dihitung oleh", 14], ["Diperiksa oleh", 82], ["Disetujui oleh", 150]].forEach(([label, x]) => {
      doc.text(label, x, y);
      doc.line(x, y + 18, x + 46, y + 18);
    });
  });
  const pages = doc.internal.getNumberOfPages();
  for (let n = 1; n <= pages; n++) {
    doc.setPage(n);
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text("Halaman " + n + " dari " + pages, 196, 290, { align: "right" });
  }
  doc.save("CountingSheet_" + safeName(detail.dc.name) + "_" + safeName(detail.name) + ".pdf");
  showToast(formatNumber(groups.length) + " sector dicetak.");
}