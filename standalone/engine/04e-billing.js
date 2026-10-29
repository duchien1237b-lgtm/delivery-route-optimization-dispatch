// Bản JavaScript của src/Billing.{h,cpp}: cân quy đổi theo kích thước, khai giá & bảo hiểm, bồi thường, sổ giao dịch và sao kê của khách.
var MAX_DECLARED = 100000000;
var MAX_DIM = 300;
function volumetricWeight(l, w, h, divisor) {
  if (l <= 0 || w <= 0 || h <= 0 || divisor <= 0)
    return 0;
  const kg = l * w * h / divisor;
  return Math.ceil(kg * 10 - 0.000000001) / 10;
}
var chargedWeight = (weight, l, w, h, divisor) => Math.max(weight, volumetricWeight(l, w, h, divisor));
function insuranceFee(declared, rate, threshold) {
  if (declared <= 0 || declared <= threshold)
    return 0;
  return ceil500(declared * rate);
}
function checkDims(l, w, h) {
  if (l === 0 && w === 0 && h === 0)
    return "";
  if (l <= 0 || w <= 0 || h <= 0)
    return "Hãy nhập đủ dài, rộng, cao (cm) hoặc để trống cả ba";
  if (l > MAX_DIM || w > MAX_DIM || h > MAX_DIM)
    return `Mỗi cạnh tối đa ${MAX_DIM} cm`;
  return "";
}
// "40x30x20" -> [40, 30, 20]; null nếu sai định dạng
function parseDims(s) {
  const m = /^([0-9]{1,3})x([0-9]{1,3})x([0-9]{1,3})$/.exec(s);
  if (!m)
    return null;
  const v = [Number(m[1]), Number(m[2]), Number(m[3])];
  return checkDims(v[0], v[1], v[2]) ? null : v;
}
var dimsText = (l, w, h) => l <= 0 || w <= 0 || h <= 0 ? "" : `${l}x${w}x${h}`;
var compensationCap = (kind, declared, orderTotal, multiplier) => kind === "damaged" || kind === "lost" ? declared > 0 ? declared : Math.floor(orderTotal * multiplier) : orderTotal;
var COMP_KIND_NAMES = { late: "Giao trễ hạn", damaged: "Hàng hư hỏng", lost: "Thất lạc hàng" };
var compensationKindName = (k) => COMP_KIND_NAMES[k] || "Khác";
var vndShort = (v) => vnd(v).replace(" đ", "đ");

class CustomerLedger {
  constructor() {
    this.items = [];
    this.next = 1;
  }
  loadText(text) {
    const items = [];
    let maxId = 0, no = 0;
    for (const raw of meaningfulLines(text)) {
      ++no;
      const sp = raw.length >= 2 && raw[0] === "T" && raw[1] === " " ? splitColumns(raw.slice(2), 10) : null;
      if (!sp)
        throw new Error(`So khach hang dong ${no}: dinh dang sai`);
      const c = sp.cols;
      let t;
      try {
        t = { id: cppStoll(c[0]), kind: c[1], customer: decodeToken(c[2]), amount: cppStoll(c[3]), at: cppStoll(c[4]), by: decodeToken(c[5]), order: cppStoll(c[6]), complaint: cppStoll(c[7]), method: decodeToken(c[8]), ref: decodeToken(c[9]), note: decodeLine(sp.rest) };
      } catch {
        t = null;
      }
      if (!t || t.kind !== "payout" && t.kind !== "collect" && t.kind !== "comp" || t.amount <= 0 || !t.customer)
        throw new Error(`So khach hang dong ${no}: so lieu khong hop le`);
      maxId = Math.max(maxId, t.id);
      items.push(t);
    }
    this.items = items;
    this.next = maxId + 1;
  }
  toText() {
    let o = "# So giao dich khach hang. T id loai(payout|collect|comp) khach so_tien luc(giay) nguoi_ghi ma_don ma_khieu_nai kenh tham_chieu ghi_chu\n";
    for (const t of this.items)
      o += `T ${t.id} ${t.kind} ${encodeToken(t.customer)} ${t.amount} ${t.at} ${encodeToken(t.by)} ${t.order} ${t.complaint} ${encodeToken(t.method)} ${encodeToken(t.ref)} ${encodeLine(t.note)}\n`;
    return o;
  }
  // { error, id }
  add(tx0) {
    const tx = { order: 0, complaint: 0, method: "", ref: "", note: "", by: "", ...tx0 };
    if (tx.kind !== "payout" && tx.kind !== "collect" && tx.kind !== "comp")
      return { error: "Loại giao dịch không hợp lệ", id: 0 };
    if (tx.amount <= 0 || tx.amount > 1e9)
      return { error: "Số tiền phải lớn hơn 0", id: 0 };
    if (!tx.customer)
      return { error: "Thiếu khách hàng", id: 0 };
    if (tx.kind === "comp")
      tx.method = "wallet";
    else if (tx.method !== "bank" && tx.method !== "cash")
      return { error: "Hãy chọn hình thức: chuyển khoản hoặc tiền mặt", id: 0 };
    if (tx.kind !== "comp" && tx.method === "bank" && blen(tx.ref) < 3)
      return { error: "Chuyển khoản cần mã giao dịch ngân hàng", id: 0 };
    if (ulen(tx.ref) > 40)
      return { error: "Mã tham chiếu tối đa 40 ký tự", id: 0 };
    if (ulen(tx.note) > 200)
      return { error: "Ghi chú tối đa 200 ký tự", id: 0 };
    tx.note = tx.note.replace(/[\n\r]/g, " ");
    tx.id = this.next++;
    this.items.push(tx);
    return { error: "", id: tx.id };
  }
  of(customer) {
    return this.items.filter((t) => t.customer === customer);
  }
  ofComplaint(complaint) {
    return this.items.find((t) => t.kind === "comp" && t.complaint === complaint) || null;
  }
  all() {
    return this.items;
  }
}

// orders: [{id, status, cod, total, returnFee, cancelFee, receiverPays, at, codSettled}]
function billingStatement(orders, txs) {
  const s = { lines: [], balance: 0, pending: 0, available: 0, codTotal: 0, fees: 0, comps: 0, paidOut: 0, collected: 0 };
  const add = (at, kind, order, amount, pending, text) => {
    if (amount === 0)
      return;
    s.lines.push({ at, kind, order, amount, pending, text, ref: "", tx: 0 });
  };
  for (const o of orders) {
    const id = "#" + o.id;
    if (o.status === DELIVERED) {
      add(o.at, "cod", o.id, o.cod, !o.codSettled, `Tiền thu hộ đơn ${id}${o.codSettled ? "" : " (chờ shipper nộp & đối soát)"}`);
      if (!o.receiverPays)
        add(o.at, "fee", o.id, -o.total, false, `Cước đơn ${id}`);
      s.codTotal += o.cod;
      if (!o.receiverPays)
        s.fees += o.total;
    } else if (o.status === RETURNED) {
      add(o.at, "return", o.id, -o.returnFee, false, `Phí hoàn hàng đơn ${id}`);
      s.fees += o.returnFee;
    } else if (o.status === CANCELLED) {
      add(o.at, "cancel", o.id, -o.cancelFee, false, `Phí huỷ đơn ${id}`);
      s.fees += o.cancelFee;
    }
  }
  for (const t of txs) {
    const l = { at: t.at, kind: t.kind, order: t.order, amount: 0, pending: false, text: "", ref: t.ref, tx: t.id };
    if (t.kind === "comp") {
      l.amount = t.amount;
      l.text = `Bồi thường khiếu nại #${t.complaint}${t.note ? ": " + t.note : ""}`;
      s.comps += t.amount;
    } else if (t.kind === "payout") {
      l.amount = -t.amount;
      l.text = `${t.method === "bank" ? "Chuyển khoản" : "Trả tiền mặt"} cho khách ${vndShort(t.amount)}`;
      s.paidOut += t.amount;
    } else {
      l.amount = t.amount;
      l.text = `Khách nộp bù ${t.method === "bank" ? "(chuyển khoản)" : "(tiền mặt)"}`;
      s.collected += t.amount;
    }
    if (t.note && t.kind !== "comp")
      l.text += ": " + t.note;
    s.lines.push(l);
  }
  s.lines.sort((a, b) => a.at - b.at);
  for (const l of s.lines) {
    s.balance += l.amount;
    if (l.pending)
      s.pending += l.amount;
  }
  s.available = s.balance - s.pending;
  return s;
}
