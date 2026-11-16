const prId = parseInt(new URLSearchParams(window.location.search).get("id"), 10);
let pr = null;
let products = [];
let busy = false;

bootApp(async () => {
  if (!prId) {
    notFound("ID PR tidak valid.");
    return;
  }
  if (document.referrer && document.referrer.includes("purchase-request.html")) {
    $("backLink").href = document.referrer;
  }
  $("addItemBtn").addEventListener("click", addItem);
  $("qtyInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addItem();
    }
  });
  $("productInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      $("qtyInput").focus();
    }
  });
  showFlash();
  await load();
});

async function load() {
  try {
    pr = await api("/purchase-requests/" + prId);
  } catch (err) {
    if (err.status === 401) return;
    notFound(err.status === 404 ? "PR tidak ditemukan atau bukan cabang kamu." : err.message);
    return;
  }
  if (pr.can_edit && !products.length) {
    try {
      products = await api("/products" + qs({ brand_id: pr.brand ? pr.brand.id : null }));
      const list = $("productList");
      list.innerHTML = "";
      products.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.display_name;
        list.appendChild(opt);
      });
    } catch (e) {}
  }
  render();
}

function notFound(msg) {
  $("docNumber").textContent = "PR tidak ditemukan";
  $("docSub").textContent = msg;
  $("detailLayout").hidden = true;
}

function render() {
  document.title = pr.number + " - Abuya Portal";
  $("docNumber").textContent = pr.number;
  const sub = $("docSub");
  sub.innerHTML = "";
  sub.append(badge(statusConf(pr.status)), el("span", "", pr.branch.name));

  const head = $("headActions");
  head.innerHTML = "";
  if (pr.po) {
    const a = el("a", "btn btn-ghost");
    a.href = "purchase-order-detail.html?id=" + pr.po.id;
    a.append(icon_("receipt_long"), el("span", "", "Lihat " + pr.po.number));
    head.appendChild(a);
  }

  const sc = shippingConf(pr.shipping_category);
  const grid = $("detailGrid");
  grid.innerHTML = "";
  [
    ["Cabang", pr.branch.name],
    ["Brand", pr.brand ? pr.brand.name : "-"],
    ["Shipping", sc.label + (sc.desc ? " (" + sc.desc + ")" : "")],
    ["PIC Final", pr.pic || "-"],
    ["Required Date", formatDay(pr.required_date)],
    ["Status", null]
  ].forEach(([label, value]) => {
    const box = el("div");
    box.appendChild(el("div", "detail-label", label));
    const v = el("div", "detail-value");
    if (value === null) v.appendChild(badge(statusConf(pr.status)));
    else v.textContent = value;
    box.appendChild(v);
    grid.appendChild(box);
  });
  const notes = el("div");
  notes.style.gridColumn = "1 / -1";
  notes.append(el("div", "detail-label", "Notes"), el("div", "detail-value plain", pr.notes || "-"));
  grid.appendChild(notes);

  const info = $("infoBox");
  info.innerHTML = "";
  info.appendChild(infoRow("Dibuat", formatDateTime(pr.created_at) + " oleh " + (pr.created_by || "-")));
  if (pr.updated_at) info.appendChild(infoRow("Terakhir diubah", formatDateTime(pr.updated_at) + " oleh " + (pr.updated_by || "-")));
  if (pr.po) info.appendChild(infoRow("PO terbit", pr.po.number + " • " + formatDateTime(pr.po.created_at)));

  $("itemAdder").hidden = !pr.can_edit;
  renderItems();
  renderActions();
  $("detailLayout").hidden = false;
}

function infoRow(label, value) {
  const row = el("div", "info-row");
  row.append(el("span", "", label), el("strong", "", value));
  return row;
}

function renderItems() {
  const list = $("itemList");
  list.innerHTML = "";
  $("itemCount").textContent = pr.items.length + " item";
  if (!pr.items.length) {
    list.appendChild(el("div", "item-empty", "Belum ada item."));
    return;
  }
  pr.items.forEach((it, idx) => {
    const row = el("div", "item-row");
    row.append(el("span", "item-no", String(idx + 1)), el("span", "item-name", it.item_name));
    if (pr.can_edit) {
      const qty = el("input", "input");
      qty.type = "number";
      qty.min = "1";
      qty.value = it.qty;
      qty.setAttribute("aria-label", "Jumlah " + it.item_name);
      qty.addEventListener("change", () => updateQty(it, qty));
      const del = el("button", "btn-icon danger");
      del.type = "button";
      del.title = "Hapus item";
      del.disabled = pr.items.length <= 1;
      del.appendChild(icon_("delete"));
      del.addEventListener("click", () => removeItem(it));
      row.append(qty, del);
    } else {
      row.appendChild(el("span", "item-qty", "x" + formatNumber(it.qty)));
    }
    list.appendChild(row);
  });
}

function renderActions() {
  const box = $("actions");
  box.innerHTML = "";
  if (!pr.can_edit) return;

  if (App.user.role === "AMKA") {
    box.append(
      actionBtn("btn btn-ghost", "save", "Simpan Draft", saveDraft),
      actionBtn("btn btn-primary", "task_alt", "Approve", approve)
    );
  } else {
    box.append(
      actionBtn("btn btn-danger", "block", "Tolak", reject),
      actionBtn("btn btn-primary", "task_alt", "Approve", approve)
    );
  }
}

function actionBtn(cls, icon, label, fn) {
  const b = el("button", cls);
  b.type = "button";
  b.append(icon_(icon), el("span", "", label));
  b.addEventListener("click", fn);
  return b;
}

async function run(fn) {
  if (busy) return;
  busy = true;
  document.querySelectorAll("#actions button, #itemList button, #addItemBtn").forEach((b) => { b.disabled = true; });
  try {
    await fn();
  } catch (err) {
    if (err.status !== 401) {
      showToast(err.message, true);
      await load();
    }
  } finally {
    busy = false;
    if (pr) renderItems();
    if (pr) renderActions();
    $("addItemBtn").disabled = false;
  }
}

function addItem() {
  const name = $("productInput").value.trim();
  const qty = parseInt($("qtyInput").value, 10);
  const product = products.find((p) => p.display_name.toLowerCase() === name.toLowerCase());
  if (!product) {
    showToast(name ? "Barang tidak ditemukan. Pilih dari daftar yang muncul." : "Pilih barang dulu ya.", true);
    $("productInput").focus();
    return;
  }
  if (!qty || qty < 1) {
    showToast("Isi jumlah dulu ya (minimal 1).", true);
    $("qtyInput").focus();
    return;
  }
  run(async () => {
    pr = await api("/purchase-requests/" + prId + "/items", { method: "POST", json: { product_id: product.id, qty } });
    $("productInput").value = "";
    $("qtyInput").value = "";
    render();
    showToast(product.display_name + " ditambahkan.");
  });
}

function updateQty(item, input) {
  const qty = parseInt(input.value, 10);
  if (!qty || qty < 1) {
    input.value = item.qty;
    showToast("Jumlah minimal 1.", true);
    return;
  }
  if (qty === item.qty) return;
  run(async () => {
    pr = await api("/purchase-requests/" + prId + "/items/" + item.id, { method: "PATCH", json: { qty } });
    render();
    showToast("Jumlah " + item.item_name + " diubah jadi " + qty + ".");
  });
}

async function removeItem(item) {
  if (!(await confirmDialog("Hapus " + item.item_name + " dari PR ini?", { danger: true, confirmLabel: "Ya, Hapus" }))) return;
  run(async () => {
    pr = await api("/purchase-requests/" + prId + "/items/" + item.id, { method: "DELETE" });
    render();
    showToast("Item dihapus.");
  });
}

async function approve() {
  if (!(await confirmDialog("Approve " + pr.number + " dan terbitkan PO?", { confirmLabel: "Ya, Approve" }))) return;
  run(async () => {
    pr = await api("/purchase-requests/" + prId + "/approve", { method: "POST" });
    render();
    showToast(pr.number + " disetujui, " + (pr.po ? pr.po.number : "PO") + " terbit.");
    loadPendingBadge();
  });
}

async function reject() {
  if (!(await confirmDialog("Yakin mau menolak " + pr.number + "?", { danger: true, confirmLabel: "Ya, Tolak" }))) return;
  run(async () => {
    pr = await api("/purchase-requests/" + prId + "/reject", { method: "POST" });
    render();
    showToast(pr.number + " ditolak.");
  });
}

function saveDraft() {
  run(async () => {
    pr = await api("/purchase-requests/" + prId + "/touch", { method: "POST" });
    flashToast(pr.number + " disimpan sebagai draft (masih Pending).");
    window.location.href = "purchase-request.html";
  });
}