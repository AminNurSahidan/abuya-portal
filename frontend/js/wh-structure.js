const DEFAULTS = { dc: "", sector: "" };
const COLS = 6;

const state = readParams(DEFAULTS);
let dcs = [];
let zones = [];
let placements = [];
const selected = new Set();
let searchTimer;
let searchSeq = 0;

const canCreate = () => can(App.user, "wh.structure.create");
const canUpdate = () => can(App.user, "wh.structure.update");
const canDelete = () => can(App.user, "wh.structure.delete");

bootApp(async (user) => {
  if (!can(user, "wh.structure.view")) {
    $("noDcText").textContent = "Role kamu belum punya akses ke Struktur Gudang. Hubungi Master ya.";
    $("noDcNotice").hidden = false;
    return;
  }
  dcs = await api("/wh/dcs");
  if (!dcs.length) {
    $("noDcNotice").hidden = false;
    return;
  }
  if (!dcs.some((d) => String(d.id) === state.dc)) state.dc = String(dcs[0].id);
  const pick = $("dcPick");
  pick.innerHTML = "";
  dcs.forEach((d) => {
    const o = document.createElement("option");
    o.value = String(d.id);
    o.textContent = d.name + (d.wh_code ? " (" + d.wh_code + ")" : "");
    pick.appendChild(o);
  });
  pick.value = state.dc;
  $("dcPickBox").hidden = dcs.length < 2;
  pick.addEventListener("change", async () => {
    state.dc = pick.value;
    state.sector = "";
    await loadZones();
  });
  $("addZoneBtn").hidden = !canCreate();
  $("addZoneBtn").addEventListener("click", () => zoneForm(null));
  $("adder").hidden = !canCreate();
  bindPlacementUI();
  $("area").hidden = false;
  await loadZones();
});

function currentDc() {
  return dcs.find((d) => String(d.id) === state.dc);
}

function findSector(id) {
  for (const z of zones) {
    const s = z.sectors.find((x) => String(x.id) === String(id));
    if (s) return { zone: z, sector: s };
  }
  return null;
}

async function loadZones() {
  zones = await api("/wh/dcs/" + state.dc + "/zones");
  if (state.sector && !findSector(state.sector)) state.sector = "";
  if (!state.sector) {
    const first = zones.find((z) => z.sectors.length);
    if (first) state.sector = String(first.sectors[0].id);
  }
  writeParams(state, DEFAULTS);
  renderZones();
  await loadPlacements();
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

function renderZones() {
  const list = $("zoneList");
  list.innerHTML = "";
  const sectorsTotal = zones.reduce((a, z) => a + z.sectors.length, 0);
  $("zoneMeta").textContent = formatNumber(zones.length) + " zona • " + formatNumber(sectorsTotal) + " sector";
  if (!zones.length) {
    list.appendChild(emptyBlock("shelves", canCreate() ? "Belum ada zona. Klik Tambah Zona untuk mulai." : "Belum ada zona di DC ini."));
    return;
  }
  zones.forEach((z) => {
    const block = el("div", "zone-block");
    const top = el("div", "zone-top");
    const title = el("div");
    title.append(el("strong", "", z.name), el("span", "cell-sub", formatNumber(z.sectors.length) + " sector"));
    const tools = el("div", "zone-tools");
    if (canUpdate()) tools.appendChild(iconBtn("edit", "Ganti nama zona", () => zoneForm(z)));
    if (canDelete()) tools.appendChild(iconBtn("delete", "Hapus zona", () => deleteZone(z), true));
    top.append(title, tools);
    block.appendChild(top);
    if (!z.sectors.length) block.appendChild(el("div", "sector-empty", "Belum ada sector."));
    z.sectors.forEach((s) => {
      const row = el("div", "sector-row" + (String(s.id) === state.sector ? " active" : ""));
      row.tabIndex = 0;
      const name = el("div", "sector-name");
      name.append(icon_("view_column"), el("span", "", s.name));
      const right = el("div", "zone-tools");
      right.appendChild(el("span", "sector-count", formatNumber(s.products)));
      if (canUpdate()) right.appendChild(iconBtn("edit", "Ganti nama sector", () => sectorForm(z, s)));
      if (canDelete()) right.appendChild(iconBtn("delete", "Hapus sector", () => deleteSector(s), true));
      row.append(name, right);
      const pick = () => {
        if (state.sector === String(s.id)) return;
        state.sector = String(s.id);
        writeParams(state, DEFAULTS);
        renderZones();
        loadPlacements();
      };
      row.addEventListener("click", pick);
      row.addEventListener("keydown", (e) => { if (e.key === "Enter") pick(); });
      block.appendChild(row);
    });
    if (canCreate()) {
      const add = el("button", "add-sector");
      add.type = "button";
      add.append(icon_("add"), el("span", "", "Tambah sector di " + z.name));
      add.addEventListener("click", () => sectorForm(z, null));
      block.appendChild(add);
    }
    list.appendChild(block);
  });
}

function zoneForm(z) {
  const name = inputEl("zName", { value: z ? z.name : "", maxLength: 100, placeholder: "Contoh : Zona A" });
  formModal({
    title: z ? "Ganti nama zona" : "Tambah zona di " + currentDc().name,
    submitLabel: z ? "Simpan" : "Tambah zona",
    fields: [formField("Nama zona", name)],
    onSubmit: async () => {
      if (!requireValue(name, "Isi nama zona dulu ya.")) return false;
      if (z) await api("/wh/zones/" + z.id, { method: "PATCH", json: { name: name.value.trim() } });
      else await api("/wh/zones", { method: "POST", json: { branch_id: Number(state.dc), name: name.value.trim() } });
      showToast(z ? "Zona diperbarui." : "Zona " + name.value.trim() + " ditambahkan.");
      await loadZones();
    }
  });
}

function sectorForm(z, s) {
  const name = inputEl("secName", { value: s ? s.name : "", maxLength: 100, placeholder: "Contoh : A001" });
  formModal({
    title: s ? "Ganti nama sector" : "Tambah sector di " + z.name,
    submitLabel: s ? "Simpan" : "Tambah sector",
    fields: [formField("Nama sector", name)],
    onSubmit: async () => {
      if (!requireValue(name, "Isi nama sector dulu ya.")) return false;
      if (s) {
        await api("/wh/sectors/" + s.id, { method: "PATCH", json: { name: name.value.trim() } });
      } else {
        const created = await api("/wh/sectors", { method: "POST", json: { zone_id: z.id, name: name.value.trim() } });
        state.sector = String(created.id);
      }
      showToast(s ? "Sector diperbarui." : "Sector " + name.value.trim() + " ditambahkan.");
      await loadZones();
    }
  });
}

async function deleteZone(z) {
  const msg = "Hapus zona " + z.name + " beserta " + formatNumber(z.sectors.length) + " sector dan penempatan produknya? Produknya sendiri tidak terhapus.";
  if (!(await confirmDialog(msg, { danger: true, confirmLabel: "Ya, Hapus" }))) return;
  try {
    await api("/wh/zones/" + z.id + "/delete", { method: "POST" });
    showToast("Zona " + z.name + " dihapus.");
    await loadZones();
  } catch (err) {
    if (err.status !== 401) showToast(err.message, true);
  }
}

async function deleteSector(s) {
  if (!(await confirmDialog("Hapus sector " + s.name + "? Penempatan produk di sector ini ikut terhapus, produknya sendiri tidak.", { danger: true, confirmLabel: "Ya, Hapus" }))) return;
  try {
    const res = await api("/wh/sectors/delete", { method: "POST", json: { ids: [s.id] } });
    if (res.skipped.length) showToast("Sector " + s.name + " tidak bisa dihapus: " + res.skipped[0].reason + ".", true);
    else showToast("Sector " + s.name + " dihapus.");
    await loadZones();
  } catch (err) {
    if (err.status !== 401) showToast(err.message, true);
  }
}

function bindPlacementUI() {
  $("addSearch").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(searchProducts, 250);
  });
  $("addSearch").addEventListener("focus", () => { if ($("addSearch").value.trim()) searchProducts(); });
  $("addSearch").addEventListener("keydown", (e) => {
    if (e.key === "Escape") $("addResults").hidden = true;
    if (e.key === "Enter") {
      e.preventDefault();
      const first = $("addResults").querySelector(".adder-item:not(:disabled)");
      if (first) first.click();
    }
  });
  document.addEventListener("mousedown", (e) => {
    if (!e.target.closest(".adder")) $("addResults").hidden = true;
  });
  $("selAll").addEventListener("change", (e) => {
    placements.forEach((p) => { if (e.target.checked) selected.add(p.id); else selected.delete(p.id); });
    renderPlacements();
  });
  $("bulkClear").addEventListener("click", () => { selected.clear(); renderPlacements(); });
  $("bulkRemove").addEventListener("click", () => removePlacements(Array.from(selected)));
  const removable = canCreate() || canDelete();
  $("selAll").closest("th").hidden = !removable;
}

async function loadPlacements() {
  selected.clear();
  const found = findSector(state.sector);
  $("adder").hidden = !canCreate() || !found;
  if (!found) {
    placements = [];
    $("placeZone").textContent = "Pilih sector";
    $("placeSector").textContent = zones.length ? "Belum ada sector dipilih" : "-";
    $("placeMeta").textContent = "";
    tableMessage($("placeBody"), COLS, "view_column", zones.length ? "Pilih atau tambah sector di sebelah kiri." : "Tambah zona dan sector dulu.");
    $("bulkBar").hidden = true;
    return;
  }
  $("placeZone").textContent = found.zone.name;
  $("placeSector").textContent = found.sector.name;
  tableSkeleton($("placeBody"), COLS, 4);
  try {
    placements = await api("/wh/sectors/" + state.sector + "/placements");
    renderPlacements();
  } catch (err) {
    if (err.status === 401) return;
    tableMessage($("placeBody"), COLS, "error", "Produk sector belum bisa dimuat.");
    showToast(err.message, true);
  }
}

function renderPlacements() {
  const body = $("placeBody");
  body.innerHTML = "";
  const removable = canCreate() || canDelete();
  const reorder = canUpdate() || canCreate();
  $("placeMeta").textContent = formatNumber(placements.length) + " produk";
  $("selAll").checked = placements.length > 0 && placements.every((p) => selected.has(p.id));
  $("selAll").indeterminate = selected.size > 0 && !$("selAll").checked;
  $("bulkBar").hidden = !selected.size;
  $("bulkInfo").textContent = formatNumber(selected.size) + " produk dipilih";
  if (!placements.length) {
    tableMessage(body, COLS, "inventory_2", canCreate() ? "Belum ada produk. Cari produk di kolom atas untuk menambahkan." : "Belum ada produk di sector ini.");
    return;
  }
  placements.forEach((p, i) => {
    const tr = el("tr");
    if (removable) {
      const td = el("td", "sel-col");
      const box = el("input");
      box.type = "checkbox";
      box.checked = selected.has(p.id);
      box.setAttribute("aria-label", "Pilih " + p.name);
      box.addEventListener("change", () => {
        if (box.checked) selected.add(p.id);
        else selected.delete(p.id);
        renderPlacements();
      });
      td.appendChild(box);
      tr.appendChild(td);
    }
    const prod = el("td");
    const stack = el("div", "cell-stack");
    stack.appendChild(el("span", "cell-main", p.name));
    stack.appendChild(el("span", "cell-sub", [p.product_code, p.category].filter(Boolean).join(" • ") || "-"));
    if (!p.is_active) stack.appendChild(el("span", "tag-off", "Nonaktif"));
    prod.appendChild(stack);
    const act = el("td", "actions");
    const box = el("div", "cell-actions");
    if (reorder) {
      const ob = el("div", "order-btns");
      const up = iconBtn("arrow_upward", "Naikkan", () => move(i, -1));
      const down = iconBtn("arrow_downward", "Turunkan", () => move(i, 1));
      up.disabled = i === 0;
      down.disabled = i === placements.length - 1;
      ob.append(up, down);
      box.appendChild(ob);
    }
    if (removable) box.appendChild(iconBtn("remove_circle", "Keluarkan dari sector", () => removePlacements([p.id]), true));
    act.appendChild(box);
    tr.append(el("td", "num", String(i + 1)), el("td", "mono", p.barcode), prod, el("td", "", p.unit || "-"), act);
    body.appendChild(tr);
  });
}

async function move(index, dir) {
  const j = index + dir;
  if (j < 0 || j >= placements.length) return;
  const copy = placements.slice();
  [copy[index], copy[j]] = [copy[j], copy[index]];
  placements = copy;
  renderPlacements();
  try {
    await api("/wh/sectors/" + state.sector + "/order", { method: "PUT", json: { ids: placements.map((p) => p.id) } });
  } catch (err) {
    if (err.status !== 401) showToast(err.message, true);
    await loadPlacements();
  }
}

async function removePlacements(ids) {
  if (!ids.length) return;
  const names = placements.filter((p) => ids.includes(p.id)).map((p) => p.name);
  const msg = ids.length === 1 ? "Keluarkan " + names[0] + " dari sector ini?" : "Keluarkan " + formatNumber(ids.length) + " produk dari sector ini?";
  if (!(await confirmDialog(msg + " Produknya tetap ada di Produk Gudang.", { danger: true, confirmLabel: "Ya, Keluarkan" }))) return;
  try {
    await api("/wh/placements/delete", { method: "POST", json: { ids } });
    showToast(formatNumber(ids.length) + " produk dikeluarkan dari sector.");
    await refreshCounts();
    await loadPlacements();
  } catch (err) {
    if (err.status !== 401) showToast(err.message, true);
  }
}

async function refreshCounts() {
  zones = await api("/wh/dcs/" + state.dc + "/zones");
  renderZones();
}

async function searchProducts() {
  const q = $("addSearch").value.trim();
  const box = $("addResults");
  if (!q) {
    box.hidden = true;
    return;
  }
  const seq = ++searchSeq;
  try {
    const opts = await api("/wh/products/options" + qs({ branch_id: state.dc, q, sector_id: state.sector, limit: 30 }));
    if (seq !== searchSeq) return;
    box.innerHTML = "";
    if (!opts.length) {
      box.appendChild(el("div", "adder-empty", "Tidak ada produk aktif yang cocok di " + currentDc().name + "."));
    }
    opts.forEach((o) => {
      const b = el("button", "adder-item");
      b.type = "button";
      b.disabled = o.placed;
      const stack = el("div", "cell-stack");
      stack.append(el("span", "cell-main", o.name), el("span", "cell-sub mono", o.barcode + (o.unit ? " • " + o.unit : "")));
      b.append(stack, el("span", o.placed ? "cell-sub" : "btn btn-sm btn-ghost", o.placed ? "Sudah ada" : "Tambah"));
      b.addEventListener("click", () => addProduct(o));
      box.appendChild(b);
    });
    box.hidden = false;
  } catch (err) {
    if (err.status !== 401) showToast(err.message, true);
  }
}

async function addProduct(o) {
  try {
    const res = await api("/wh/sectors/" + state.sector + "/placements", { method: "POST", json: { barcodes: [o.barcode] } });
    if (res.added) showToast(o.name + " ditambahkan.");
    else if (res.skipped.length) showToast(res.skipped[0].reason + ".", true);
    $("addSearch").value = "";
    $("addResults").hidden = true;
    $("addSearch").focus();
    await refreshCounts();
    await loadPlacements();
  } catch (err) {
    if (err.status !== 401) showToast(err.message, true);
  }
}