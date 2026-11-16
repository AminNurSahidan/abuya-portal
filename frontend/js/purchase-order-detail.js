const poId = parseInt(new URLSearchParams(window.location.search).get("id"), 10);
let po = null;

bootApp(async () => {
  if (!poId) {
    notFound("ID PO tidak valid.");
    return;
  }
  $("exportBtn").hidden = !canExportPO(App.user);
  $("exportBtn").addEventListener("click", exportExcel);
  try {
    po = await api("/purchase-orders/" + poId);
  } catch (err) {
    if (err.status === 401) return;
    notFound(err.status === 404 ? "PO tidak ditemukan atau bukan cabang kamu." : err.message);
    return;
  }
  render();
});

function notFound(msg) {
  $("docNumber").textContent = "PO tidak ditemukan";
  $("docSub").textContent = msg;
}

function render() {
  const pr = po.pr;
  document.title = po.number + " - Abuya Portal";
  $("docNumber").textContent = po.number;
  const sub = $("docSub");
  sub.innerHTML = "";
  sub.append(badge(shippingConf(pr.shipping_category)), el("span", "", pr.branch.name));
  $("exportBtn").disabled = false;

  const sc = shippingConf(pr.shipping_category);
  const grid = $("detailGrid");
  grid.innerHTML = "";
  const refBox = el("div");
  refBox.appendChild(el("div", "detail-label", "Ref PR"));
  const refVal = el("div", "detail-value");
  const a = el("a", "ref-link", pr.number);
  a.href = "purchase-request-detail.html?id=" + pr.id;
  refVal.appendChild(a);
  refBox.appendChild(refVal);
  grid.appendChild(refBox);

  [
    ["Cabang", pr.branch.name],
    ["Brand", pr.branch.brand ? pr.branch.brand.name : "-"],
    ["Shipping", sc.label + (sc.desc ? " (" + sc.desc + ")" : "")],
    ["PIC Final", pr.pic || "-"],
    ["Required Date", formatDay(pr.required_date)],
    ["Release Date", formatDateTime(po.created_at)]
  ].forEach(([label, value]) => {
    const box = el("div");
    box.append(el("div", "detail-label", label), el("div", "detail-value", value));
    grid.appendChild(box);
  });
  const notes = el("div");
  notes.style.gridColumn = "1 / -1";
  notes.append(el("div", "detail-label", "Notes"), el("div", "detail-value plain", pr.notes || "-"));
  grid.appendChild(notes);

  const info = $("infoBox");
  info.innerHTML = "";
  const row = el("div", "info-row");
  row.append(el("span", "", "Diterbitkan"), el("strong", "", formatDateTime(po.created_at) + " oleh " + (po.created_by || "-")));
  info.appendChild(row);

  const list = $("itemList");
  list.innerHTML = "";
  $("itemCount").textContent = po.items.length + " item";
  if (!po.items.length) {
    list.appendChild(el("div", "item-empty", "Item tidak ditemukan."));
  } else {
    po.items.forEach((it, idx) => {
      const r = el("div", "item-row");
      r.append(el("span", "item-no", String(idx + 1)), el("span", "item-name", it.item_name), el("span", "item-qty", "x" + formatNumber(it.qty)));
      list.appendChild(r);
    });
  }
  $("detailLayout").hidden = false;
}

async function exportExcel() {
  const btn = $("exportBtn");
  btn.disabled = true;
  try {
    const rows = await api("/purchase-orders/export" + qs({ po_id: poId }));
    await downloadPOExcel(rows, po.number + ".xlsx");
  } catch (err) {
    if (err.status !== 401) showToast(err.message, true);
  } finally {
    btn.disabled = false;
  }
}