// Bản JavaScript của src/OrderFlow.{h,cpp}: máy trạng thái đơn hàng (HTTP 409 khi chuyển sai), phí huỷ, mã xác nhận giao, sổ COD.
var B_SYSTEM = 32;
var FLOW_TABLE = (() => {
  const CUS = B_CUSTOMER, SHP = B_SHIPPER, STF = B_ADMIN;
  return [
    [CREATED, "confirm", PENDING, STF, "Quản trị viên xác nhận đơn (đơn khách đặt được tự xác nhận)"],
    [CREATED, "reject", CANCELLED, STF, "Quản trị viên từ chối đơn"],
    [CREATED, "cancel", CANCELLED, STF | CUS, "Huỷ đơn (miễn phí)"],
    [PENDING, "cancel", CANCELLED, STF | CUS | B_SYSTEM, "Huỷ đơn (miễn phí; hệ thống tự huỷ khi không tìm được shipper)"],
    [PENDING, "dispatch", DISPATCHED, STF | B_SYSTEM, "Hệ thống mời shipper gần nhất nhận đơn (hoặc quản trị viên phân công)"],
    [DISPATCHED, "accept", ASSIGNED, SHP, "Shipper nhận chuyến"],
    [DISPATCHED, "decline", PENDING, SHP, "Shipper từ chối chuyến"],
    [DISPATCHED, "expire", PENDING, B_SYSTEM, "Lời mời hết hạn mà shipper chưa trả lời"],
    [DISPATCHED, "unassign", PENDING, STF | B_SYSTEM, "Thu hồi phân công (shipper nghỉ, đổi tuyến)"],
    [DISPATCHED, "cancel", CANCELLED, STF | CUS, "Huỷ đơn (mất phí)"],
    [ASSIGNED, "deliver", DELIVERED, SHP | STF | B_SYSTEM, "Giao thành công (mã xác nhận 4 số)"],
    [ASSIGNED, "release", PENDING, SHP, "Shipper nhả đơn khi chưa lấy hàng (hệ thống tìm shipper khác)"],
    [ASSIGNED, "fail", -1, SHP | STF, "Giao thất bại (kèm lý do)"],
    [ASSIGNED, "unassign", PENDING, STF | B_SYSTEM, "Thu hồi phân công (shipper nghỉ, đổi tuyến)"],
    [ASSIGNED, "cancel", CANCELLED, STF | CUS, "Huỷ khi shipper chưa lấy hàng (khách tự huỷ, phí thấp) hoặc quản trị viên huỷ giúp khi đang giao (phí cao)"],
    [FAILED, "requeue", PENDING, STF | CUS, "Giao lại (đưa về hàng chờ; khách tự hẹn giao lại được)"],
    [FAILED, "return", RETURNED, STF | CUS, "Hoàn hàng về kho (tính phí hoàn)"],
    [FAILED, "cancel", CANCELLED, STF, "Huỷ đơn sau khi giao thất bại (phí cao)"]
  ].map(([from, action, to, actors, label]) => ({ from, action, to, actors, label }));
})();
function flowActorName(a) {
  if (a & B_CUSTOMER)
    return "Khách hàng";
  if (a & B_SHIPPER)
    return "Shipper";
  if (a & B_ADMIN)
    return "Quản trị viên";
  return "Hệ thống";
}
var FLOW_ACTION_NAMES = { confirm: "xác nhận", reject: "từ chối", cancel: "huỷ", dispatch: "phân công", accept: "nhận chuyến", decline: "từ chối chuyến", deliver: "xác nhận giao", fail: "báo giao thất bại", requeue: "đưa về hàng chờ", return: "hoàn kho", unassign: "thu hồi phân công", release: "nhả đơn", expire: "hết hạn lời mời" };
var flowActionName = (a) => FLOW_ACTION_NAMES[a] || "thực hiện";
// "" nếu được phép (out.to = trạng thái sau), ngược lại là lý do
function flowCheck(from, action, actor, out = null) {
  let seen = false;
  for (const t of FLOW_TABLE) {
    if (t.from !== from || t.action !== action)
      continue;
    seen = true;
    if (t.actors & actor) {
      if (out)
        out.to = t.to;
      return "";
    }
  }
  const st = orderStatusName(from);
  if (!seen) {
    if (from === DELIVERED || from === RETURNED || from === CANCELLED)
      return `Đơn đang ở trạng thái '${st}' (đã kết thúc), không thể ${flowActionName(action)}`;
    return `Không thể ${flowActionName(action)} khi đơn đang ở trạng thái '${st}'`;
  }
  if (action === "cancel" && actor & B_CUSTOMER)
    return `Đơn đang ở trạng thái '${st}' nên không huỷ trực tiếp được, hãy gửi khiếu nại hoặc liên hệ quản trị viên`;
  return `${flowActorName(actor)} không được ${flowActionName(action)} khi đơn đang ở trạng thái '${st}'`;
}
function cancelRate(status, cfg) {
  if (status === DISPATCHED)
    return cfg.cancelDispatched;
  if (status === ASSIGNED || status === FAILED)
    return cfg.cancelOnRoute;
  return 0;
}
function cancelFee(status, shippingPartNet, cfg) {
  const r = cancelRate(status, cfg);
  if (r <= 0 || shippingPartNet <= 0)
    return 0;
  return ceil500(shippingPartNet * r);
}
var newDeliveryCode = () => randomDigits(4);
// ------------------------------------------------------------------ Sổ COD

class CodLedger {
  constructor() {
    this.entries = [];
    this.remits = [];
    this.closes = [];
    this.nextEntry = this.nextRemit = this.nextClose = 1;
  }
  loadText(text) {
    const ents = [], rems = [], cls = [];
    let no = 0;
    const bad = (why) => new Error(`So COD dong ${no}: ${why}`);
    for (const raw of meaningfulLines(text)) {
      ++no;
      if (raw.length < 2 || raw[1] !== " ")
        throw bad("dinh dang sai");
      const kind = raw[0];
      const n = kind === "E" ? 8 : kind === "R" ? 10 : kind === "K" ? 7 : 0;
      if (!n)
        throw bad("dong phai bat dau bang E, R hoac K");
      const sp = splitColumns(raw.slice(2), n);
      if (!sp)
        throw bad("thieu cot");
      const c = sp.cols;
      try {
        if (kind === "E")
          ents.push({ id: cppStoll(c[0]), order: cppStoll(c[1]), shipper: decodeToken(c[2]), amount: cppStoll(c[3]), state: c[4], collectedAt: cppStoll(c[5]), remittance: cppStoll(c[6]), closeId: cppStoll(c[7]) });
        else if (kind === "R") {
          const r = { id: cppStoll(c[0]), shipper: decodeToken(c[1]), at: cppStoll(c[2]), expected: cppStoll(c[3]), handed: cppStoll(c[4]), state: c[5], settledAt: cppStoll(c[6]), counted: cppStoll(c[7]), confirmedBy: decodeToken(c[8]), entries: [], note: "" };
          if (c[9] !== "-") {
            const items = c[9].split(",");
            if (items.length > 1 && items[items.length - 1] === "")
              items.pop();
            r.entries = items.map(cppStoll);
          }
          r.note = decodeLine(sp.rest);
          rems.push(r);
        } else
          cls.push({ id: cppStoll(c[0]), shipper: decodeToken(c[1]), at: cppStoll(c[2]), orders: cppStoll(c[3]), collected: cppStoll(c[4]), counted: cppStoll(c[5]), by: decodeToken(c[6]) });
      } catch {
        throw bad("gia tri khong hop le");
      }
    }
    this.entries = ents;
    this.remits = rems;
    this.closes = cls;
    this.nextEntry = this.nextRemit = this.nextClose = 1;
    for (const e of ents)
      this.nextEntry = Math.max(this.nextEntry, e.id + 1);
    for (const r of rems)
      this.nextRemit = Math.max(this.nextRemit, r.id + 1);
    for (const k of cls)
      this.nextClose = Math.max(this.nextClose, k.id + 1);
  }
  toText() {
    let o = "# So COD. E id ma_don shipper so_tien trang_thai(held|remitted|settled) thu_luc(giay) phieu_nop chot_ca\n";
    o += "#      R id shipper luc_nop du_kien khai_nop trang_thai thanh_toan_luc dem_duoc nguoi_xac_nhan danh_sach_but_toan ghi_chu\n";
    o += "#      K id shipper luc_chot so_don da_thu dem_duoc nguoi_chot\n";
    for (const e of this.entries)
      o += `E ${e.id} ${e.order} ${encodeToken(e.shipper)} ${e.amount} ${e.state} ${e.collectedAt} ${e.remittance} ${e.closeId}\n`;
    for (const r of this.remits)
      o += `R ${r.id} ${encodeToken(r.shipper)} ${r.at} ${r.expected} ${r.handed} ${r.state} ${r.settledAt} ${r.counted} ${encodeToken(r.confirmedBy)} ${r.entries.length ? r.entries.join(",") : "-"} ${encodeLine(r.note)}\n`;
    for (const k of this.closes)
      o += `K ${k.id} ${encodeToken(k.shipper)} ${k.at} ${k.orders} ${k.collected} ${k.counted} ${encodeToken(k.by)}\n`;
    return o;
  }
  record(order, shipper, amount, now) {
    if (amount <= 0)
      return 0;
    if (this.entries.some((e) => e.order === order))
      return 0;
    const e = { id: this.nextEntry++, order, shipper, amount, state: "held", collectedAt: now, remittance: 0, closeId: 0 };
    this.entries.push(e);
    return e.id;
  }
  // { error, id }
  remit(shipper, handed, now) {
    if (handed < 0 || handed > 1e11)
      return { error: "Số tiền nộp không hợp lệ", id: 0 };
    const r = { id: 0, shipper, at: now, expected: 0, handed, state: "submitted", settledAt: 0, counted: 0, confirmedBy: "", note: "", entries: [] };
    for (const e of this.entries)
      if (e.shipper === shipper && e.state === "held") {
        r.expected += e.amount;
        r.entries.push(e.id);
      }
    if (!r.entries.length)
      return { error: "Bạn không có khoản thu hộ nào đang giữ để nộp", id: 0 };
    r.id = this.nextRemit++;
    for (const e of this.entries)
      if (r.entries.includes(e.id)) {
        e.state = "remitted";
        e.remittance = r.id;
      }
    this.remits.push(r);
    return { error: "", id: r.id };
  }
  confirm(remitId, counted, by, note, now) {
    const r = this.remits.find((x) => x.id === remitId);
    if (!r)
      return "Không có phiếu nộp này";
    if (r.state === "settled")
      return "Phiếu nộp này đã được đối soát";
    if (counted < 0 || counted > 1e11)
      return "Số tiền đếm được không hợp lệ";
    if (blen(note) > 300)
      return "Ghi chú tối đa 300 ký tự";
    Object.assign(r, { state: "settled", settledAt: now, counted, confirmedBy: by, note });
    for (const e of this.entries)
      if (e.remittance === r.id)
        e.state = "settled";
    return "";
  }
  // { error, id }
  close(shipper, by, now) {
    if (this.entries.some((e) => e.shipper === shipper && (e.state === "held" || e.state === "remitted")))
      return { error: "Shipper còn tiền thu hộ chưa nộp hoặc chưa đối soát, chưa chốt ca được", id: 0 };
    const k = { id: 0, shipper, at: now, orders: 0, collected: 0, counted: 0, by };
    const remitIds = [];
    for (const e of this.entries)
      if (e.shipper === shipper && e.state === "settled" && e.closeId === 0) {
        ++k.orders;
        k.collected += e.amount;
        if (!remitIds.includes(e.remittance))
          remitIds.push(e.remittance);
      }
    if (k.orders === 0)
      return { error: "Không có khoản thu hộ nào cần chốt ca", id: 0 };
    for (const rid of remitIds)
      for (const r of this.remits)
        if (r.id === rid)
          k.counted += r.counted;
    k.id = this.nextClose++;
    for (const e of this.entries)
      if (e.shipper === shipper && e.state === "settled" && e.closeId === 0)
        e.closeId = k.id;
    this.closes.push(k);
    return { error: "", id: k.id };
  }
  held(shipper) {
    return this.entries.reduce((s, e) => s + (e.shipper === shipper && e.state === "held" ? e.amount : 0), 0);
  }
  awaiting(shipper) {
    return this.entries.reduce((s, e) => s + (e.shipper === shipper && e.state === "remitted" ? e.amount : 0), 0);
  }
  remittances() {
    return this.remits;
  }
  findRemit(id) {
    return this.remits.find((r) => r.id === id) || null;
  }
  renameShipper(oldName, newName) {
    for (const x of [...this.entries, ...this.remits, ...this.closes])
      if (x.shipper === oldName)
        x.shipper = newName;
  }
}
var remitDiff = (r) => r.state === "settled" ? r.counted - r.expected : r.handed - r.expected;
var closeDiff = (k) => k.counted - k.collected;
