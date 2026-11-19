const DEFAULTS = { id: "", zone: "", sector: "" };

const state = readParams(DEFAULTS);
let detail = null;
let rows = [];
let canInput = false;
const nodes = new Map();
const dirty = new Set();

bootApp(async () => {
  if (!state.id) return readonly("Sesi tidak ditemukan.");
  try {
    detail = await api("/wh/sessions/" + state.id);
  } catch (err) {
    if (err.status === 401) return;
    return readonly(err.message);
  }
  $("backLink").href = "wh-session.html?id=" + detail.id;
  renderHead();
  canInput = detail.can.input;
  if (!canInput) {
    readonly(detail.status !== "Aktif" ? "Sesi ini sudah " + detail.status + ", hitungan tidak bisa diubah lagi." : "Role kamu tidak punya akses input hitung. Kamu tetap bisa melihat hasilnya.");
  }
  await loadRows();
  $("area").hidden = false;
  fillZones();
  bindUI();
  renderList();
  if (canInput) {
    startPolling(refresh, 20000);
    setTimeout(() => $("scanInput").focus(), 100);
  }
});

function readonly(msg) {
  $("readonlyText").textContent = msg;
  $("readonlyNotice").hidden = false;
}

function renderHead() {
  document.title = "Input Hitung " + detail.name + " - Abuya Portal";
  $("title").textContent = detail.name;
  const meta = $("meta");
  meta.innerHTML = "";
  const dc = el("span");
  if (detail.dc.wh_code) dc.appendChild(el("span", "wh-code", detail.dc.wh_code));
  dc.appendChild(el("span", "", detail.dc.name));
  meta.append(badge(whStatusConf(detail.status)), dc, el("span", "", formatDay(detail.session_date)));
}

async function loadRows() {
  const data = await api("/wh/sessions/" + detail.id + "/rows" + qs({ size: 5000 }));
  rows = data.items;
}

function zones() {
  const out = [];
  rows.forEach((r) => {
    let z = out.find((x) => x.id === r.zone_id);
    if (!z) {
      z = { id: r.zone_id, name: r.zone, sectors: [] };
      out.push(z);
    }
    if (!z.sectors.some((s) => s.id === r.sector_id)) z.sectors.push({ id: r.sector_id, name: r.sector });
  });
  return out;
}

function setOptions(select, items, value) {
  select.innerHTML = "";
  items.forEach(([v, l]) => {
    const o = document.createElement("option");
    o.value = String(v);
    o.textContent = l;
    select.appendChild(o);
  });
  select.value = String(value);
}

function fillZones() {
  const zs = zones();
  if (!zs.length) {
    $("list").appendChild(emptyBlock("shelves", "Belum ada produk yang ditempatkan di sector DC ini. Atur dulu di Struktur Gudang."));
    $("fZone").disabled = true;
    $("fSector").disabled = true;
    return;
  }
  if (!zs.some((z) => String(z.id) === state.zone)) state.zone = String(zs[0].id);
  setOptions($("fZone"), zs.map((z) => [z.id, z.name]), state.zone);
  fillSectors();
}

function fillSectors() {
  const z = zones().find((x) => String(x.id) === state.zone);
  const sectors = z ? z.sectors : [];
  if (!sectors.some((s) => String(s.id) === state.sector)) state.sector = sectors.length ? String(sectors[0].id) : "";
  setOptions($("fSector"), sectors.map((s) => [s.id, s.name + " (" + sectorStat(s.id).counted + "/" + sectorStat(s.id).total + ")"]), state.sector);
  writeParams(state, DEFAULTS);
}

function sectorStat(sectorId) {
  const list = rows.filter((r) => r.sector_id === Number(sectorId));
  return { counted: list.filter((r) => r.qty !== null).length, total: list.length };
}

function bindUI() {
  $("fZone").addEventListener("change", (e) => {
    state.zone = e.target.value;
    state.sector = "";
    fillSectors();
    renderList();
  });
  $("fSector").addEventListener("change", (e) => {
    state.sector = e.target.value;
    writeParams(state, DEFAULTS);
    renderList();
  });
  $("onlyPending").addEventListener("change", renderList);
  $("scanForm").addEventListener("submit", (e) => {
    e.preventDefault();
    findCode($("scanInput").value);
  });
  if ("BarcodeDetector" in window && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    $("cameraBtn").hidden = false;
    $("cameraBtn").addEventListener("click", openCamera);
  }
}

function currentRows() {
  const only = $("onlyPending").checked;
  return rows.filter((r) => String(r.sector_id) === state.sector && (!only || r.qty === null || dirty.has(key(r))));
}

function key(r) {
  return r.sector_id + "|" + r.barcode;
}

function renderList() {
  const list = $("list");
  list.innerHTML = "";
  nodes.clear();
  const z = zones().find((x) => String(x.id) === state.zone);
  const s = z && z.sectors.find((x) => String(x.id) === state.sector);
  $("sectorName").textContent = s ? z.name + " / " + s.name : "-";
  updateProgress();
  const items = currentRows();
  if (!items.length) {
    list.appendChild(emptyBlock("task_alt", $("onlyPending").checked ? "Semua item di sector ini sudah dihitung." : "Tidak ada produk di sector ini."));
    return;
  }
  items.forEach((r) => list.appendChild(itemNode(r)));
}

function updateProgress() {
  if (!state.sector) {
    $("sectorProgress").textContent = "";
    return;
  }
  const st = sectorStat(state.sector);
  $("sectorProgress").textContent = formatNumber(st.counted) + " dari " + formatNumber(st.total) + " item sudah dihitung";
  const opt = $("fSector").querySelector('option[value="' + state.sector + '"]');
  const z = zones().find((x) => String(x.id) === state.zone);
  const s = z && z.sectors.find((x) => String(x.id) === state.sector);
  if (opt && s) opt.textContent = s.name + " (" + st.counted + "/" + st.total + ")";
}

function itemNode(r) {
  const card = el("div", "count-item" + (r.qty !== null ? " done" : "") + (r.is_active ? "" : " off"));
  card.dataset.key = key(r);
  const info = el("div", "ci-info");
  info.appendChild(el("span", "ci-name", r.name));
  const sub = el("div", "ci-sub");
  sub.appendChild(el("span", "mono", r.barcode));
  if (r.product_code) sub.appendChild(el("span", "", r.product_code));
  if (!r.is_active) sub.appendChild(el("span", "tag-off", "Nonaktif"));
  info.appendChild(sub);

  const qtyBox = el("div", "ci-qty");
  const input = el("input", "input");
  input.type = "number";
  input.min = "0";
  input.step = "any";
  input.inputMode = "decimal";
  input.enterKeyHint = "next";
  input.placeholder = "Qty";
  input.value = r.qty === null ? "" : String(r.qty);
  input.disabled = !canInput || (!r.is_active && r.qty === null);
  input.setAttribute("aria-label", "Qty " + r.name);
  qtyBox.append(input, el("span", "ci-unit", r.unit || ""));

  const foot = el("div", "ci-foot");
  const st = el("span", "ci-state");
  foot.appendChild(st);
  const noteBox = el("div", "ci-note");
  const note = el("input", "input");
  note.placeholder = "Catatan (opsional), contoh: 2 rusak";
  note.maxLength = 300;
  note.value = r.note || "";
  note.disabled = !canInput;
  noteBox.appendChild(note);
  noteBox.hidden = !r.note;
  if (canInput) {
    const toggle = el("button", "note-toggle", r.note ? "Sembunyikan catatan" : "Tambah catatan");
    toggle.type = "button";
    toggle.addEventListener("click", () => {
      noteBox.hidden = !noteBox.hidden;
      toggle.textContent = noteBox.hidden ? (note.value ? "Lihat catatan" : "Tambah catatan") : "Sembunyikan catatan";
      if (!noteBox.hidden) note.focus();
    });
    foot.appendChild(toggle);
  }
  card.append(info, qtyBox, foot, noteBox);
  paintState(st, r);

  const commit = () => save(r, input, note, st, card);
  input.addEventListener("focus", () => card.classList.add("focus"));
  input.addEventListener("blur", () => { card.classList.remove("focus"); commit(); });
  input.addEventListener("input", () => dirty.add(key(r)));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
      focusNext(card);
    }
  });
  note.addEventListener("input", () => dirty.add(key(r)));
  note.addEventListener("blur", commit);
  note.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); note.blur(); } });
  nodes.set(key(r), { card, input, note, st, r });
  return card;
}

function paintState(st, r, mode, msg) {
  st.className = "ci-state";
  st.innerHTML = "";
  if (mode === "saving") {
    st.classList.add("saving");
    st.append(icon_("sync"), el("span", "", "Menyimpan..."));
  } else if (mode === "err") {
    st.classList.add("err");
    st.append(icon_("error"), el("span", "", msg || "Gagal simpan, coba lagi"));
  } else if (r.qty !== null) {
    st.classList.add("ok");
    st.append(icon_("check_circle"), el("span", "", r.updated_by + " • " + timeAgo(r.updated_at)));
  } else {
    st.append(icon_("radio_button_unchecked"), el("span", "", "Belum dihitung"));
  }
}

async function save(r, input, note, st, card) {
  if (!canInput) return;
  const raw = input.value.trim();
  const qty = raw === "" ? null : Number(raw);
  const noteVal = note.value.trim() || null;
  if (qty !== null && (!Number.isFinite(qty) || qty < 0)) {
    paintState(st, r, "err", "Qty harus angka 0 atau lebih");
    return;
  }
  if (qty === r.qty && (noteVal || null) === (r.note || null)) {
    dirty.delete(key(r));
    return;
  }
  const sig = qty + "|" + noteVal;
  if (r._saving === sig) return;
  r._saving = sig;
  if (qty === null && r.qty !== null && !(await confirmDialog("Hapus hitungan " + r.name + " (" + formatQty(r.qty) + ")?", { danger: true, confirmLabel: "Ya, Hapus" }))) {
    r._saving = null;
    input.value = String(r.qty);
    dirty.delete(key(r));
    return;
  }
  paintState(st, r, "saving");
  try {
    const res = await api("/wh/sessions/" + detail.id + "/counts", { method: "PUT", json: { sector_id: r.sector_id, barcode: r.barcode, qty, note: noteVal } });
    Object.assign(r, { qty: res.qty, note: res.note, updated_by: res.updated_by, updated_at: res.updated_at });
    dirty.delete(key(r));
    card.classList.toggle("done", r.qty !== null);
    paintState(st, r);
    updateProgress();
  } catch (err) {
    if (err.status === 401) return;
    paintState(st, r, "err", err.message);
    if (err.status === 400 && /sudah (Selesai|Final)/.test(err.message)) {
      canInput = false;
      readonly(err.message);
      document.querySelectorAll(".count-item input").forEach((i) => { i.disabled = true; });
    }
  } finally {
    r._saving = null;
  }
}

function focusNext(card) {
  let n = card.nextElementSibling;
  while (n) {
    const inp = n.querySelector(".ci-qty input");
    if (inp && !inp.disabled) {
      inp.focus();
      inp.select();
      n.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    n = n.nextElementSibling;
  }
  $("scanInput").focus();
}

function goTo(r) {
  if (String(r.zone_id) !== state.zone || String(r.sector_id) !== state.sector) {
    state.zone = String(r.zone_id);
    state.sector = String(r.sector_id);
    $("fZone").value = state.zone;
    fillSectors();
    $("fSector").value = state.sector;
  }
  if ($("onlyPending").checked && r.qty !== null) $("onlyPending").checked = false;
  renderList();
  const n = nodes.get(key(r));
  if (!n) return;
  n.card.scrollIntoView({ behavior: "smooth", block: "center" });
  n.card.classList.add("flash");
  setTimeout(() => n.card.classList.remove("flash"), 1200);
  if (!n.input.disabled) {
    n.input.focus();
    n.input.select();
  }
}

async function findCode(raw) {
  const q = String(raw || "").trim();
  if (!q) return;
  const up = q.toUpperCase();
  const low = q.toLowerCase();
  const exact = rows.filter((r) => r.barcode.toUpperCase() === up);
  let hits = exact.length ? exact : rows.filter((r) => r.name.toLowerCase().includes(low) || (r.product_code || "").toLowerCase() === low);
  $("scanInput").value = "";
  if (!hits.length) {
    showToast("Produk " + q + " tidak ada di sector mana pun di DC ini.", true);
    return;
  }
  const here = hits.find((r) => String(r.sector_id) === state.sector);
  if (here) return goTo(here);
  if (hits.length === 1) {
    const r = hits[0];
    if (await confirmDialog(r.name + " ada di " + r.zone + " / " + r.sector + ". Pindah ke sector itu?", { confirmLabel: "Ya, Pindah" })) goTo(r);
    return;
  }
  pickHit(hits.slice(0, 30), q);
}

function pickHit(hits, q) {
  const list = el("div", "list-plain");
  let modal = null;
  hits.forEach((r) => {
    const b = el("button", "btn btn-ghost hit-btn");
    b.type = "button";
    b.style.justifyContent = "flex-start";
    b.style.width = "100%";
    b.append(el("span", "mono", r.barcode), el("span", "", " " + r.name + " — " + r.zone + " / " + r.sector));
    b.addEventListener("click", () => {
      modal.close();
      goTo(r);
    });
    list.appendChild(b);
  });
  modal = formModal({ title: "Hasil pencarian \"" + q + "\"", fields: [list], cancelLabel: "Tutup" });
}

let camStream = null;

async function openCamera() {
  const video = el("video", "cam-video");
  video.setAttribute("playsinline", "");
  video.muted = true;
  const hint = el("p", "cam-hint", "Arahkan kamera ke barcode produk.");
  let active = true;
  const modal = formModal({
    title: "Scan barcode",
    fields: [video, hint],
    cancelLabel: "Tutup",
    onClose: () => {
      active = false;
      if (camStream) camStream.getTracks().forEach((t) => t.stop());
      camStream = null;
    }
  });
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    video.srcObject = camStream;
    await video.play();
    const detector = new window.BarcodeDetector();
    const loop = async () => {
      if (!active) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length) {
          const value = codes[0].rawValue;
          modal.close();
          if (navigator.vibrate) navigator.vibrate(80);
          findCode(value);
          return;
        }
      } catch (e) {}
      setTimeout(loop, 250);
    };
    loop();
  } catch (err) {
    hint.textContent = "Kamera tidak bisa dibuka. Izinkan akses kamera di browser, atau ketik barcode-nya manual.";
  }
}

async function refresh() {
  if (!canInput) return;
  const data = await api("/wh/sessions/" + detail.id + "/rows" + qs({ sector_id: state.sector, size: 5000 }));
  let changed = false;
  data.items.forEach((fresh) => {
    const k = key(fresh);
    const r = rows.find((x) => key(x) === k);
    if (!r || dirty.has(k)) return;
    if (r.qty === fresh.qty && r.note === fresh.note && r.updated_at === fresh.updated_at) return;
    Object.assign(r, { qty: fresh.qty, note: fresh.note, updated_by: fresh.updated_by, updated_at: fresh.updated_at });
    changed = true;
    const n = nodes.get(k);
    if (n && document.activeElement !== n.input && document.activeElement !== n.note) {
      n.input.value = r.qty === null ? "" : String(r.qty);
      n.note.value = r.note || "";
      n.card.classList.toggle("done", r.qty !== null);
      paintState(n.st, r);
    }
  });
  if (changed) updateProgress();
}