let options = null;
let items = [];
let submitting = false;

bootApp(async (user) => {
  if (!canCreatePR(user)) {
    const msg = hasNoMapping(user)
      ? "Akun kamu belum punya mapping cabang, jadi belum bisa membuat PR. Hubungi Master ya."
      : "Role " + (ROLE_LABELS[user.role] || user.role) + " tidak bisa membuat Purchase Request.";
    block(msg);
    return;
  }

  try {
    options = await api("/purchase-requests/form-options" + qs({ brand_id: activeBrandId() }));
  } catch (err) {
    if (err.status !== 401) block(err.message);
    return;
  }

  if (!options.branches.length) {
    block("Belum ada cabang yang bisa kamu pakai untuk membuat PR.");
    return;
  }

  const approveNow = options.can_approve_now;
  $("approveBtn").hidden = !approveNow;
  $("submitText").textContent = approveNow ? "Simpan sebagai Pending" : "Kirim PR";
  $("submitBtn").className = "btn " + (approveNow ? "btn-ghost" : "btn-primary");
  $("pageSub").textContent = approveNow
    ? "Simpan sebagai Pending untuk di-review dulu, atau Simpan & Approve supaya PO langsung terbit."
    : "Isi data PR, tambahkan item barang, lalu kirim untuk di-approve AM.";

  const tomorrow = addDaysISO(todayISO(), 1);
  $("requiredDate").min = tomorrow;

  fillBranchSelect($("branch"), options.branches, options.branches.length === 1 ? options.branches[0].id : "", "-- Pilih cabang --");
  $("prForm").hidden = false;

  $("branch").addEventListener("change", onBranchChange);
  $("shipping").addEventListener("change", onShippingChange);
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
  $("prForm").addEventListener("submit", (e) => {
    e.preventDefault();
    submit(false);
  });
  $("approveBtn").addEventListener("click", () => submit(true));
  ["branch", "requiredDate", "shipping", "pic"].forEach((id) => $(id).addEventListener("change", () => $(id).classList.remove("invalid")));

  onBranchChange();
  renderItems();
});

function block(msg) {
  $("blockText").textContent = msg;
  $("blockNotice").hidden = false;
  $("prForm").hidden = true;
}

function selectedBranch() {
  return options.branches.find((b) => String(b.id) === $("branch").value) || null;
}

function branchBrandId() {
  const b = selectedBranch();
  return b && b.brand ? b.brand.id : null;
}

function productsForBranch() {
  const brandId = branchBrandId();
  return options.products.filter((p) => !p.brand || p.brand.id === brandId);
}

function onBranchChange() {
  const branch = selectedBranch();
  const ship = $("shipping");
  const prev = ship.value;
  ship.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = branch ? "-- Pilih shipping --" : "Pilih cabang dulu";
  ship.appendChild(ph);

  if (branch) {
    const directOnly = branch.brand && branch.brand.direct_only;
    SHIPPINGS.filter((s) => !directOnly || s.key === "Direct").forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.key;
      opt.textContent = s.label + " (" + s.desc + ")";
      ship.appendChild(opt);
    });
    if (directOnly) ship.value = "Direct";
    else if (SHIPPINGS.some((s) => s.key === prev)) ship.value = prev;
  }
  ship.disabled = !branch;

  const allowed = new Set(productsForBranch().map((p) => p.id));
  const before = items.length;
  items = items.filter((it) => allowed.has(it.product_id));
  if (items.length < before) showToast((before - items.length) + " item dihapus karena bukan untuk brand cabang ini.");

  const list = $("productList");
  list.innerHTML = "";
  productsForBranch().forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.display_name;
    list.appendChild(opt);
  });
  $("productInput").disabled = !branch;
  $("qtyInput").disabled = !branch;
  $("addItemBtn").disabled = !branch;
  $("productInput").placeholder = branch ? "Ketik untuk cari barang..." : "Pilih cabang dulu";

  onShippingChange();
  renderItems();
}

function onShippingChange() {
  const pic = $("pic");
  const prev = pic.value;
  const ship = $("shipping").value;
  const brandId = branchBrandId();
  pic.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = ship ? "-- Pilih PIC --" : "Pilih shipping dulu";
  pic.appendChild(ph);

  if (ship) {
    const seen = new Set();
    options.pics
      .filter((p) => (!p.shipping || p.shipping === ship) && (!p.brand || p.brand.id === brandId))
      .forEach((p) => {
        if (seen.has(p.name)) return;
        seen.add(p.name);
        const opt = document.createElement("option");
        opt.value = p.name;
        opt.textContent = p.name;
        pic.appendChild(opt);
      });
    if (seen.has(prev)) pic.value = prev;
  }
  $("picField").hidden = !ship;
}

function addItem() {
  const name = $("productInput").value.trim();
  const qty = parseInt($("qtyInput").value, 10);
  if (!name) {
    showToast("Pilih barang dulu ya.", true);
    $("productInput").focus();
    return;
  }
  const product = productsForBranch().find((p) => p.display_name.toLowerCase() === name.toLowerCase());
  if (!product) {
    showToast("Barang tidak ditemukan. Pilih dari daftar yang muncul.", true);
    $("productInput").focus();
    return;
  }
  if (!qty || qty < 1) {
    showToast("Isi jumlah dulu ya (minimal 1).", true);
    $("qtyInput").focus();
    return;
  }
  const existing = items.find((it) => it.product_id === product.id);
  if (existing) {
    showToast("Barang ini sudah ada di daftar. Ubah jumlahnya langsung di daftar.", true);
    return;
  }
  items.push({ product_id: product.id, name: product.display_name, qty });
  $("productInput").value = "";
  $("qtyInput").value = "";
  $("productInput").focus();
  renderItems();
}

function renderItems() {
  const list = $("itemList");
  list.innerHTML = "";
  $("itemCount").textContent = items.length + " item";
  if (!items.length) {
    list.appendChild(el("div", "item-empty", "Belum ada item. Tambahkan minimal 1 barang."));
    return;
  }
  items.forEach((it, idx) => {
    const row = el("div", "item-row");
    const qty = el("input", "input");
    qty.type = "number";
    qty.min = "1";
    qty.value = it.qty;
    qty.setAttribute("aria-label", "Jumlah " + it.name);
    qty.addEventListener("change", () => {
      const v = parseInt(qty.value, 10);
      if (!v || v < 1) {
        qty.value = it.qty;
        showToast("Jumlah minimal 1.", true);
        return;
      }
      it.qty = v;
    });
    const del = el("button", "btn-icon danger");
    del.type = "button";
    del.title = "Hapus item";
    del.appendChild(icon_("delete"));
    del.addEventListener("click", () => {
      items.splice(idx, 1);
      renderItems();
    });
    row.append(el("span", "item-no", String(idx + 1)), el("span", "item-name", it.name), qty, del);
    list.appendChild(row);
  });
}

function validate() {
  const checks = [
    ["branch", "Pilih cabang dulu ya."],
    ["requiredDate", "Pilih Required Date dulu ya."],
    ["shipping", "Pilih shipping dulu ya."],
    ["pic", "Pilih PIC Final dulu ya."]
  ];
  for (const [id, msg] of checks) {
    if (!$(id).value) {
      $(id).classList.add("invalid");
      $(id).focus();
      showToast(msg, true);
      return false;
    }
  }
  if ($("requiredDate").value <= todayISO()) {
    $("requiredDate").classList.add("invalid");
    showToast("Required Date minimal besok.", true);
    return false;
  }
  if (!items.length) {
    showToast("Tambahkan minimal 1 item barang dulu ya.", true);
    $("productInput").focus();
    return false;
  }
  return true;
}

async function submit(approveNow) {
  if (submitting || !validate()) return;
  if (approveNow && !(await confirmDialog("Simpan PR ini sebagai Approved dan langsung terbitkan PO?", { confirmLabel: "Ya, Approve" }))) return;

  submitting = true;
  $("submitBtn").disabled = true;
  $("approveBtn").disabled = true;
  try {
    const pr = await api("/purchase-requests", {
      method: "POST",
      json: {
        branch_id: Number($("branch").value),
        required_date: $("requiredDate").value,
        shipping_category: $("shipping").value,
        pic: $("pic").value,
        notes: $("notes").value.trim() || null,
        items: items.map((it) => ({ product_id: it.product_id, qty: it.qty })),
        approve_now: approveNow
      }
    });
    flashToast(pr.po ? pr.number + " disetujui, " + pr.po.number + " terbit." : pr.number + " berhasil dibuat.");
    window.location.href = "purchase-request-detail.html?id=" + pr.id;
  } catch (err) {
    if (err.status === 401) return;
    showToast(err.message, true);
    submitting = false;
    $("submitBtn").disabled = false;
    $("approveBtn").disabled = false;
  }
}