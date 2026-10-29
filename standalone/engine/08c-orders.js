// Bản JavaScript của src/WebOrders.inc: đơn hàng, báo giá, điều phối, chuyến giao, sổ COD, khiếu nại, thông báo, cấu hình, báo cáo.
// Quy ước mã lỗi: 400 dữ liệu sai · 401 chưa đăng nhập · 403 sai vai trò hoặc đơn của người khác (IDOR)
//                 · 409 chuyển trạng thái không hợp lệ (flowCheck) · 429 gửi quá nhanh.
// 1234567 -> "1.234.567đ"
function money(v) {
  const s = String(Math.abs(v));
  let out = "";
  for (let i = 0;i < s.length; i++) {
    if (i && (s.length - i) % 3 === 0)
      out += ".";
    out += s[i];
  }
  return (v < 0 ? "-" : "") + out + "đ";
}
var shipperNameOf = (idx) => idx >= 0 && idx < S.shippers.length ? S.shippers[idx].name : "";
// Tên đăng nhập của tài khoản shipper gắn với một shipper trong đội xe
function accountOfShipper(shipperName) {
  for (const a of S.accounts.all())
    if (a.role === SHIPPER && a.link === shipperName)
      return a.username;
  return "";
}
function feeFor(o) {
  const km = feeDistances(S.graph, S.depot, [o])[0];
  return shippingFee(km, chargedWeightOf(o), o.urgent, o.cod);
}
// Số lần khách đã dùng mã (không tính đơn exceptId — khi sửa đơn)
var promoUsedBy = (user, code, exceptId = -1) => S.orders.filter((o) => o.owner === user && o.promo === code && o.id !== exceptId).length;
// Báo giá = hoá đơn: cùng một hàm tính cho báo giá, tạo đơn, sửa đơn và hoá đơn
function quoteFor(o, owner, promoCode, exceptId = -1) {
  const fee = feeFor(o);
  let tier = "", pct = -1;
  const a = owner ? S.accounts.find(owner) : null;
  if (a && a.role === CUSTOMER) {
    const t = tierFor(a.done);
    tier = t.name;
    pct = t.pct;
  }
  const used = a ? promoUsedBy(owner, promoCode, exceptId) : 0;
  const q = computeQuote(fee, tier, pct, promoCode, S.promos, nowSeconds(), used);
  q.insurance = insuranceFee(o.declaredValue, CONFIG.insRate, CONFIG.insThreshold);
  q.total = q.net + q.insurance;
  q.chargedWeight = chargedWeightOf(o);
  q.volWeight = volumetricWeight(o.dimL, o.dimW, o.dimH, CONFIG.volDivisor);
  return q;
}
var quoteJson = (q) => ({ fee: feeJson(q.fee), gross: q.gross, loyaltyDiscount: q.loyaltyDiscount, promoDiscount: q.promoDiscount, net: q.net, tier: q.tier, tierPct: q.tierPct, promo: q.promo, promoError: q.promoError, insurance: q.insurance, total: q.total, chargedWeight: q.chargedWeight, volWeight: q.volWeight });
// Phí huỷ = tỉ lệ x phần cước vận chuyển còn phải trả (sau khi trừ giảm giá)
function cancelFeeOf(o) {
  const f = feeFor(o);
  const part = f.valid ? shippingPart(f) : 0;
  return cancelFee(cancelFeeStatus(o), Math.max(0, part - o.loyaltyDiscount - o.promoDiscount), CONFIG);
}
// Trả lại lượt dùng mã khi đơn bị huỷ / từ chối trước khi xuất phát
function releasePromo(o) {
  if (!o.promo)
    return;
  S.promos.giveBack(o.promo);
  mark(D_PROMOS);
  o.promo = "";
  o.promoDiscount = 0;
}
var logOrder = (type, o, detail = "") => S.shift.log(S.shift.clock, type, o.id, o.shipper, detail);
// ------------------------------------------------------------ Đọc và kiểm tra trường của đơn
// Khai giá, kích thước (dài / rộng / cao cm), người trả cước — dùng chung cho tạo, sửa đơn và báo giá
function readBillingFields(r, o) {
  const value = num(r, "value", o.declaredValue);
  if (value < 0 || value > MAX_DECLARED || Math.floor(value) !== value)
    throw new Invalid("Giá trị hàng khai báo phải là số nguyên từ 0 đến 100.000.000 đ", { value: "Từ 0 đến 100.000.000 đ" });
  o.declaredValue = value;
  if (has(r, "length") || has(r, "width") || has(r, "height")) {
    const dim = (k) => {
      const v = str(r, k) === "" ? 0 : num(r, k);
      if (v < 0 || v > MAX_DIM || Math.floor(v) !== v)
        throw new Invalid("Kích thước mỗi cạnh là số nguyên từ 1 đến 300 cm", { [k]: "Từ 1 đến 300 cm" });
      return v;
    };
    const l = dim("length"), w = dim("width"), h = dim("height");
    const e = checkDims(l, w, h);
    if (e)
      throw new Invalid(e, { length: e });
    o.dimL = l;
    o.dimW = w;
    o.dimH = h;
  }
  if (has(r, "payer")) {
    const payer = str(r, "payer");
    if (payer !== "sender" && payer !== "receiver")
      throw new Invalid("Người trả cước là người gửi hoặc người nhận", { payer: "Chọn người trả cước" });
    o.receiverPays = payer === "receiver";
  }
}
function readOrderFields(r, o0) {
  const o = { ...o0 };
  if (has(r, "destination") && str(r, "destination"))
    o.destination = integer(r, "destination");
  if (!S.graph.hasNode(o.destination))
    throw new Invalid("Hãy chọn điểm giao trên bản đồ", { destination: "Hãy chọn điểm giao" });
  o.weight = num(r, "weight", o.weight);
  if (!(o.weight > 0) || o.weight > 5000)
    throw new Invalid("Khối lượng phải từ 0 đến 5000 kg", { weight: "Khối lượng phải lớn hơn 0 và tối đa 5000 kg" });
  o.urgent = integer(r, "urgent", o.urgent ? 1 : 0) === 1;
  if (has(r, "deadline"))
    o.deadline = str(r, "deadline") === "" ? -1 : integer(r, "deadline");
  if (o.deadline < -1)
    throw new Invalid("Hạn giao phải >= 0 phút, hoặc để trống nếu không có hạn", { deadline: "Hạn giao không hợp lệ" });
  if (o.deadline > 1440)
    throw new Invalid("Hạn giao tính trong ca, tối đa 1440 phút (24 giờ)", { deadline: "Tối đa 1440 phút" });
  o.note = trimmed(str(r, "note", o.note)).replace(/[#\n\r]/g, "-");
  if (blen(o.note) > 200)
    throw new Invalid("Ghi chú tối đa 200 ký tự", { note: "Ghi chú tối đa 200 ký tự" });
  const cod = num(r, "cod", o.cod);
  if (cod < 0 || cod > MAX_COD || Math.floor(cod) !== cod)
    throw new Invalid("Tiền thu hộ phải là số nguyên từ 0 đến 50.000.000 đ", { cod: "Từ 0 đến 50.000.000 đ" });
  o.cod = cod;
  o.phone = normalizePhone(str(r, "phone", o.phone));
  if (o.phone && !validPhone(o.phone))
    throw new Invalid("Số điện thoại phải gồm 10 chữ số, bắt đầu bằng 0", { phone: "10 chữ số, bắt đầu bằng 0" });
  o.recipient = trimmed(str(r, "recipient", o.recipient)).replace(/[#\n\r_]/g, " ");
  if (ulen(o.recipient) > 60)
    throw new Invalid("Tên người nhận quá dài (tối đa 60 ký tự)", { recipient: "Tối đa 60 ký tự" });
  if (o.cod > 0 && !o.phone)
    throw new Invalid("Đơn thu hộ cần số điện thoại người nhận để xác nhận khi giao", { phone: "Bắt buộc với đơn thu hộ" });
  readBillingFields(r, o);
  if (o.receiverPays && !o.phone)
    throw new Invalid("Người nhận trả cước thì cần số điện thoại người nhận", { phone: "Bắt buộc khi người nhận trả cước" });
  return o;
}
var nextOrderId = () => S.orders.reduce((m, o) => Math.max(m, o.id), 100) + 1;
var isOpenStatus = (st) => st === CREATED || st === PENDING || st === DISPATCHED || st === ASSIGNED || st === FAILED;
var newOrder = () => ({ ...newOrderRecord(), id: -1, destination: -1, shipper: -1, status: PENDING, tried: [], searchSince: 0, noShipperAt: 0 });
// Hạn giao là phút tính từ đầu ca: không nhận hạn đã qua so với đồng hồ ca hiện tại
function checkDeadlineAhead(o) {
  if (o.deadline >= 0 && o.deadline < S.shift.clock)
    throw new Invalid(`Hạn giao (phút ${o.deadline}) đã qua: đồng hồ ca đang ở phút ${Math.trunc(S.shift.clock)}`, { deadline: "Hạn giao đã qua" });
}
// ------------------------------------------------------------ Tạo / sửa / xoá đơn
// Khách nợ phí (số dư ví đối soát âm) quá hạn mức thì phải thanh toán trước khi đặt đơn mới
function checkDebtLimit(customer) {
  const limit = CONFIG.debtLimit;
  if (limit <= 0)
    return;
  const debt = -statementOf(customer, orderFees()).balance;
  if (debt > limit)
    throw new Conflict(`Bạn đang nợ ${money(debt)} cước / phí chưa thanh toán (hạn mức ${money(limit)}). Hãy chuyển khoản hoặc nộp tiền tại kho, kế toán ghi nhận xong là đặt đơn được ngay.`);
}

// Khách đặt đơn: điểm giao không được là kho, và hàng không được nặng hơn xe lớn nhất của đội.
function checkCustomerLoad(o) {
  if (o.destination === S.depot)
    throw new Invalid("Điểm giao không được trùng với kho", { destination: "Điểm giao không được là kho" });
  const cap = S.shippers.reduce((m, sh) => Math.max(m, sh.capacity), 0);
  if (cap > 0 && o.weight > cap)
    throw new Invalid(`Hàng nặng quá: xe lớn nhất của đội chở được tối đa ${Math.round(cap)} kg`, { weight: `Tối đa ${Math.round(cap)} kg` });
}

function createOrder(r) {
  let o = newOrder();
  o.id = isCustomer() ? nextOrderId() : integer(r, "id", nextOrderId());
  if (S.orders.some((x) => x.id === o.id))
    throw new BadRequest(`Mã đơn ${o.id} đã tồn tại`);
  if (isCustomer() && integer(r, "address", 0) > 0) {
    const ad = ownAddress(integer(r, "address"));
    Object.assign(o, { destination: ad.node, recipient: ad.recipient, phone: ad.phone, address: ad.id });
  }
  o = readOrderFields(r, o);
  checkDeadlineAhead(o);
  const cfg = CONFIG;
  if (isCustomer()) {
    if (blen(o.recipient) < 2)
      throw new Invalid("Hãy nhập tên người nhận", { recipient: "Hãy nhập tên người nhận" });
    if (!o.phone)
      throw new Invalid("Hãy nhập số điện thoại người nhận", { phone: "Hãy nhập số điện thoại người nhận" });
    o.owner = S.me.username;
    const open = S.orders.filter((x) => x.owner === o.owner && isOpenStatus(x.status)).length;
    if (open >= cfg.maxOpenOrders)
      throw new BadRequest(`Bạn đang có ${open} đơn chưa hoàn tất (tối đa ${cfg.maxOpenOrders}). Hãy đợi các đơn này xong rồi đặt thêm.`);
    checkDebtLimit(o.owner);
    if (!S.graph.hasNode(S.depot))
      throw new BadRequest("Hệ thống chưa có kho");
    checkCustomerLoad(o);
    if (unreachableFrom(S.graph, S.depot).includes(o.destination))
      throw new Invalid(`Kho chưa có đường tới ${nodeName(o.destination)}, chưa nhận đơn tới điểm này`, { destination: "Chưa có đường tới điểm này" });
    // Ghép tự động bật: đơn khách đặt được tự xác nhận và hệ thống đi tìm shipper ngay. Tắt: quản trị viên xác nhận rồi phân công tay như trước.
    o.status = cfg.autoMatch ? PENDING : CREATED;
  } else {
    if (has(r, "owner") && str(r, "owner")) {
      o.owner = lowerCopy(str(r, "owner"));
      const a = S.accounts.find(o.owner);
      if (!a || a.role !== CUSTOMER)
        throw new BadRequest(`Không có tài khoản khách hàng '${o.owner}'`);
    }
    o.status = PENDING;
  }
  o.createdAt = nowSeconds();
  if (o.status === PENDING)
    o.searchSince = o.createdAt;
  o.createdBy = S.me.username;
  o.deliveryCode = newDeliveryCode();
  const code = normalizeCode(str(r, "promo"));
  const q = quoteFor(o, o.owner, code);
  if (code && q.promoError)
    throw new Invalid(q.promoError, { promo: q.promoError });
  if (isCustomer() && !q.fee.valid)
    throw new BadRequest("Không tính được cước tới điểm này");
  o.gross = q.fee.valid ? q.gross : 0;
  o.loyaltyDiscount = q.loyaltyDiscount;
  o.promoDiscount = q.promoDiscount;
  o.promo = q.promo;
  o.insuranceFee = q.insurance;
  if (o.promo) {
    S.promos.consume(o.promo);
    mark(D_PROMOS);
  }
  S.orders.push(o);
  mark(D_ORDERS);
  logOrder("created", o, S.me.username);
  audit("order.create", String(o.id), `tới ${nodeName(o.destination)}, ${money(q.total)}`);
  if (isCustomer() && !cfg.autoMatch)
    notifyStaff("order", o.id, `Đơn mới #${o.id} của ${S.me.displayName} đang chờ xác nhận`);
  const newId = o.id;
  matchPending();
  const cur = findOrderById(newId);
  // sau khi ghép: có thể đã được mời cho một shipper
  return { ...stateJson(), created: newId, order: { id: newId, status: cur.status, net: q.net, total: q.total }, message: isCustomer() ? `Đã tạo đơn ${newId}` + (cfg.autoMatch ? ", hệ thống đang tìm shipper gần nhất" : ", đang chờ quản trị viên xác nhận") : `Đã tạo đơn ${newId}` };
}
// Nhân viên sửa đơn Mới / Chờ giao; khách tự sửa đơn của mình khi còn ở trạng thái Mới (chưa được xác nhận)
function updateOrder(r) {
  const id = integer(r, "id");
  const o = orderForActor(id);
  const i = S.orders.indexOf(o);
  if (isCustomer() && o.status !== CREATED && o.status !== PENDING)
    throw new Conflict(`Đơn ${id} đã có shipper nhận nên không tự sửa được nữa. Hãy huỷ đơn (kèm lý do) rồi đặt lại, hoặc gửi khiếu nại / liên hệ quản trị viên nếu cần đổi thông tin.`);
  if (o.status !== CREATED && o.status !== PENDING)
    throw new Conflict(`Chỉ sửa được đơn ở trạng thái 'Mới' hoặc 'Chờ giao', đơn ${id} đang ở '${orderStatusName(o.status)}'`);
  const edited = readOrderFields(r, o);
  if (edited.deadline !== o.deadline)
    checkDeadlineAhead(edited);
  if (isCustomer()) {
    if (blen(edited.recipient) < 2)
      throw new Invalid("Hãy nhập tên người nhận", { recipient: "Hãy nhập tên người nhận" });
    if (!edited.phone)
      throw new Invalid("Hãy nhập số điện thoại người nhận", { phone: "Hãy nhập số điện thoại người nhận" });
    if (edited.destination !== o.destination || edited.weight !== o.weight) checkCustomerLoad(edited);
    if (edited.destination !== o.destination && unreachableFrom(S.graph, S.depot).includes(edited.destination))
      throw new Invalid(`Kho chưa có đường tới ${nodeName(edited.destination)}`, { destination: "Chưa có đường tới điểm này" });
    if (edited.destination !== o.destination)
      edited.address = 0;
  }
  if (has(r, "owner") && isAdmin()) {
    edited.owner = lowerCopy(str(r, "owner"));
    if (edited.owner) {
      const a = S.accounts.find(edited.owner);
      if (!a || a.role !== CUSTOMER)
        throw new BadRequest(`Không có tài khoản khách hàng '${edited.owner}'`);
    }
  }
  // Giá phải khớp đơn đã sửa: tính lại với mã giảm giá cũ (mã không còn hợp lệ thì bỏ mã)
  const oldPromo = o.promo;
  const q = quoteFor(edited, edited.owner, oldPromo, id);
  edited.gross = q.fee.valid ? q.gross : 0;
  edited.loyaltyDiscount = q.loyaltyDiscount;
  edited.promoDiscount = q.promoDiscount;
  edited.promo = q.promo;
  edited.insuranceFee = q.insurance;
  if (oldPromo && !q.promo) {
    S.promos.giveBack(oldPromo);
    mark(D_PROMOS);
  }
  S.orders[i] = edited;
  edited.tried = [];
  // tải trọng / điểm giao có thể đổi: cho mọi shipper cơ hội nhận lại
  edited.noShipperAt = 0;
  mark(D_ORDERS);
  audit("order.update", String(id), money(q.total) + (q.promoError ? ", " + q.promoError : ""));
  if (isCustomer())
    notifyStaff("order", id, `Khách ${S.me.displayName} vừa sửa đơn #${id}`);
  else if (edited.owner)
    notify(edited.owner, "order", id, `Đơn #${id} vừa được quản trị viên chỉnh sửa`);
  matchPending();
  return { ...stateJson(), message: `Đã cập nhật đơn ${id}` + (q.promoError ? ". Mã giảm giá đã bị bỏ: " + q.promoError : "") };
}
function removeOrder(r) {
  const id = integer(r, "id");
  const i = S.orders.findIndex((o) => o.id === id);
  if (i < 0)
    throw new BadRequest(`Không có đơn ${id}`);
  const o = S.orders[i];
  if (o.status === ASSIGNED || o.status === DISPATCHED)
    throw new Conflict(`Đơn ${id} đang trong chuyến giao. Huỷ hoặc thu hồi phân công trước rồi mới xoá.`);
  if (o.status === CREATED || o.status === PENDING)
    releasePromo(o);
  S.orders.splice(i, 1);
  mark(D_ORDERS);
  audit("order.remove", String(id));
  return stateJson();
}
// ------------------------------------------------------------ Máy trạng thái: xác nhận, từ chối, huỷ
function staffOrder(id) {
  const o = findOrderById(id);
  if (!o)
    throw new BadRequest(`Không có đơn ${id}`);
  return o;
}
function flowTo(o, action) {
  const out = { to: 0 };
  const why = flowCheck(o.status, action, actorBit(), out);
  if (why)
    throw new Conflict(why);
  return out.to;
}
function confirmOrder(r) {
  const o = staffOrder(integer(r, "id"));
  o.status = flowTo(o, "confirm");
  mark(D_ORDERS);
  logOrder("confirmed", o, S.me.username);
  audit("order.confirm", String(o.id));
  o.searchSince = nowSeconds();
  notify(o.owner, "order", o.id, `Đơn #${o.id} đã được xác nhận, hệ thống đang tìm shipper`);
  matchPending();
  return { ...stateJson(), message: `Đã xác nhận đơn ${o.id}` };
}
function rejectOrder(r) {
  const o = staffOrder(integer(r, "id"));
  const reason = trimmed(str(r, "reason"));
  if (blen(reason) < 3)
    throw new Invalid("Hãy nhập lý do từ chối", { reason: "Hãy nhập lý do (ít nhất 3 ký tự)" });
  o.status = flowTo(o, "reject");
  o.proofNote = "Từ chối: " + utf8Prefix(reason, 150);
  o.closedAt = nowSeconds();
  releasePromo(o);
  mark(D_ORDERS);
  logOrder("rejected", o, reason);
  audit("order.reject", String(o.id), reason);
  notify(o.owner, "order", o.id, `Đơn #${o.id} bị từ chối: ${reason}`);
  return { ...stateJson(), message: `Đã từ chối đơn ${o.id}` };
}
function cancelOrder(r) {
  const id = integer(r, "id");
  const o = orderForActor(id);
  if (isShipper())
    throw new Forbidden("Shipper không huỷ đơn");
  flowTo(o, "cancel");
  if (isCustomer() && o.status === ASSIGNED && pickedUp(o))
    throw new Conflict("Shipper đã lấy hàng và đang trên đường giao nên không huỷ trực tiếp được. Hãy gửi khiếu nại hoặc liên hệ quản trị viên.");
  const reason = trimmed(str(r, "reason"));
  if (blen(reason) > 150)
    throw new Invalid("Lý do huỷ tối đa 150 ký tự", { reason: "Tối đa 150 ký tự" });
  // Đơn đã có shipper nhận (hoặc quản trị viên huỷ giúp) thì bắt buộc nêu lý do, để shipper và hệ thống biết vì sao
  const hasCarrier = o.status === DISPATCHED || o.status === ASSIGNED || o.status === FAILED;
  if ((isStaff() || hasCarrier) && blen(reason) < 3)
    throw new Invalid("Hãy chọn hoặc nhập lý do huỷ", { reason: "Hãy nhập lý do (ít nhất 3 ký tự)" });
  const fee = cancelFeeOf(o);
  const prev = o.status;
  const carrierAcct = o.shipper >= 0 ? accountOfShipper(shipperNameOf(o.shipper)) : "";
  if (!S.shift.cancel(id, S.orders))
    throw new Conflict(`Không huỷ được đơn ở trạng thái '${orderStatusName(o.status)}'`);
  S.shift.dropEmptyPendingTrips();
  S.shift.dropEmptyAutoTrips();
  o.cancelFee = fee;
  o.closedAt = nowSeconds();
  o.proofNote = (isStaff() ? "Huỷ bởi quản trị viên: " : "Khách huỷ: ") + utf8Prefix(reason, 150);
  if (reason)
    logOrder("reason", o, (isStaff() ? "Quản trị viên: " : "Khách: ") + reason);
  if (prev === CREATED || prev === PENDING)
    releasePromo(o);
  mark(D_ORDERS);
  audit("order.cancel", String(id), orderStatusName(prev) + (fee ? ", phí huỷ " + money(fee) : "") + (reason ? ": " + reason : ""));
  const msg = `Đơn #${id} đã huỷ` + (fee ? ", phí huỷ " + money(fee) : ", không mất phí");
  if (isStaff())
    notify(o.owner, "order", id, msg + (reason ? ". Lý do: " + reason : ""));
  else
    notifyStaff("order", id, `Khách ${S.me.displayName} đã huỷ đơn #${id}` + (fee ? ` (phí huỷ ${money(fee)})` : ""));
  notify(carrierAcct, "trip", id, `Đơn #${id} đã bị huỷ` + (reason ? ` (lý do: ${reason})` : "") + ", bỏ khỏi chuyến của bạn");
  matchPending();
  // shipper vừa được nhả ra có thể nhận đơn khác
  return { ...stateJson(), message: msg, cancelFee: fee };
}
// ------------------------------------------------------------ Giao hàng: mã xác nhận, COD, thống kê
// Gọi đúng một lần khi đơn chuyển sang Đã giao (do shipper xác nhận hoặc do đồng hồ mô phỏng)
function onDelivered(o) {
  const cfg = CONFIG;
  if (o.deliveredReal === 0)
    o.deliveredReal = nowSeconds();
  const fee = feeFor(o);
  const total = orderTotal(o, fee);
  const collect = orderCollect(o, fee);
  const ship = shipperNameOf(o.shipper);
  if (collect > 0 && !o.codRecorded) {
    S.cod.record(o.id, ship, collect, nowSeconds());
    o.codRecorded = true;
    mark(D_COD);
  }
  if (ship) {
    const st = S.stats.at(ship);
    ++st.delivered;
    if (o.deadline < 0 || o.deliveredAt <= o.deadline + 0.000000001)
      ++st.onTime;
    const part = fee.valid ? shippingPart(fee) : 0;
    const shipping = Math.max(0, part - o.loyaltyDiscount - o.promoDiscount);
    st.income += floor500(shipping * cfg.shipperShare);
    mark(D_STATS);
  }
  const a = o.owner ? S.accounts.find(o.owner) : null;
  if (a) {
    const before = tierFor(a.done).name;
    S.accounts.addDelivered(o.owner, total);
    mark(D_USERS);
    const after = tierFor(S.accounts.find(o.owner).done).name;
    notify(o.owner, "order", o.id, `Đơn #${o.id} đã giao thành công. Hãy đánh giá shipper nhé!`);
    if (before !== after)
      notify(o.owner, "account", 0, `Chúc mừng! Bạn đã lên hạng ${after} và được giảm cước nhiều hơn.`);
  }
  mark(D_ORDERS);
}
function deliverOrder(r) {
  const id = integer(r, "id");
  const o = orderForActor(id);
  if (isShipper() && o.shipper !== myShipperIndex())
    throw new Forbidden(`Đơn ${id} không nằm trong chuyến của bạn`);
  flowTo(o, "deliver");
  const now = nowSeconds();
  const note = trimmed(str(r, "note"));
  if (blen(note) > 150)
    throw new Invalid("Ghi chú tối đa 150 ký tự", { note: "Ghi chú tối đa 150 ký tự" });
  const force = isStaff() && flag(r, "force");
  if (force) {
    if (blen(note) < 3)
      throw new Invalid("Giao thay cần ghi rõ lý do", { note: "Ghi lý do giao thay" });
  } else {
    if (!S.limiter.allow("code:" + id, now, 6, 600))
      throw new TooMany("Nhập sai mã quá nhiều lần, hãy thử lại sau ít phút", S.limiter.retryAfter("code:" + id, now, 600));
    if (trimmed(str(r, "code")) !== o.deliveryCode || !o.deliveryCode)
      throw new BadRequest("Mã xác nhận giao không đúng. Hãy hỏi người nhận mã 4 số hiển thị trong đơn của họ.");
  }
  const collect = orderCollect(o, feeFor(o));
  if (collect > 0) {
    const cash = num(r, "cash", -1);
    if (cash !== collect)
      throw new Invalid(`Hãy thu của người nhận đúng ${money(collect)}${o.receiverPays ? " (gồm cước do người nhận trả)" : ""}`, { cash: `Cần thu đủ ${money(collect)}` });
  }
  const atT = Math.max(S.shift.clock, o.eta);
  S.shift.advance(atT);
  if (!S.shift.deliver(id, S.orders, atT))
    throw new Conflict(`Không xác nhận giao được đơn ở trạng thái '${orderStatusName(o.status)}'`);
  o.deliveredReal = now;
  if (note)
    o.proofNote = note;
  onDelivered(o);
  audit(force ? "order.deliver_force" : "order.deliver", String(id), collect ? "thu " + money(collect) : "");
  matchPending();
  // shipper vừa giao xong đã rảnh
  return { ...stateJson(), message: `Đã xác nhận giao đơn ${id}` + (collect ? ", ghi nhận đã thu " + money(collect) : "") };
}
// Phí hoàn hàng (cùng công thức với summarize): tỉ lệ hoàn × phần cước không gồm phí thu hộ, làm tròn lên 500 đ
function chargeReturn(o) {
  const f = feeFor(o);
  o.returnFee = f.valid ? ceil500((f.total - f.cod) * TARIFF.returnRate) : 0;
  o.closedAt = nowSeconds();
}
function failOrder(r) {
  const id = integer(r, "id");
  const reason = integer(r, "reason", FAIL_ABSENT);
  if (reason < 0 || reason >= FAIL_REASON_COUNT)
    throw new BadRequest("Lý do thất bại không hợp lệ");
  const o = orderForActor(id);
  if (isShipper() && o.shipper !== myShipperIndex())
    throw new Forbidden(`Đơn ${id} không nằm trong chuyến của bạn`);
  const why = flowCheck(o.status, "fail", actorBit());
  if (why)
    throw new Conflict(why);
  const ship = o.shipper;
  const st = S.shift.fail(id, S.orders, reason);
  if (st < 0)
    throw new Conflict("Chỉ báo thất bại được với đơn đang giao");
  if (st === RETURNED)
    chargeReturn(o);
  if (ship >= 0) {
    ++S.stats.at(shipperNameOf(ship)).failed;
    mark(D_STATS);
  }
  mark(D_ORDERS);
  audit("order.fail", String(id), failReasonName(reason));
  const text = st === RETURNED ? failReasonReturns(reason) ? `: ${failReasonName(reason)}, hoàn hàng về kho` : ` thất bại lần thứ ${MAX_ATTEMPTS}: chuyển sang hoàn hàng về kho` : ` giao thất bại: ${failReasonName(reason)}`;
  notify(o.owner, "order", id, `Đơn #${id}` + text);
  if (st === FAILED)
    notifyStaff("order", id, `Đơn #${id} giao thất bại, cần quyết định giao lại hay hoàn kho`);
  matchPending();
  return { ...stateJson(), message: `Đơn ${id}` + text };
}
// Giao lại: nhân viên, hoặc chính khách hàng (hẹn giao lại, có thể sửa SĐT / ghi chú cho lần giao sau)
function requeueOrder(r) {
  const o = orderForActor(integer(r, "id"));
  const why = flowCheck(o.status, "requeue", actorBit());
  if (why)
    throw new Conflict(why);
  const phone = normalizePhone(str(r, "phone"));
  if (phone && !validPhone(phone))
    throw new Invalid("Số điện thoại phải gồm 10 chữ số, bắt đầu bằng 0", { phone: "10 chữ số, bắt đầu bằng 0" });
  const note = trimmed(str(r, "note")).replace(/[#\n\r]/g, "-");
  if (blen(note) > 200)
    throw new Invalid("Ghi chú tối đa 200 ký tự", { note: "Ghi chú tối đa 200 ký tự" });
  if (!S.shift.requeue(o.id, S.orders))
    throw new Conflict("Chỉ đơn giao thất bại mới đưa lại hàng chờ được");
  if (phone)
    o.phone = phone;
  if (note)
    o.note = note;
  S.shift.dropEmptyAutoTrips();
  o.tried = [];
  // lần giao lại: ai cũng được mời
  o.noShipperAt = 0;
  o.searchSince = nowSeconds();
  mark(D_ORDERS);
  audit("order.requeue", String(o.id), phone ? "SĐT mới " + phone : "");
  if (isCustomer() && !CONFIG.autoMatch)
    notifyStaff("order", o.id, `Khách ${S.me.displayName} yêu cầu giao lại đơn #${o.id}`);
  else if (!isCustomer())
    notify(o.owner, "order", o.id, `Đơn #${o.id} sẽ được giao lại`);
  matchPending();
  return { ...stateJson(), message: isCustomer() ? `Đã yêu cầu giao lại đơn ${o.id}, hệ thống đang tìm shipper` : `Đã đưa đơn ${o.id} về hàng chờ` };
}
function returnOrder(r) {
  const o = orderForActor(integer(r, "id"));
  const why = flowCheck(o.status, "return", actorBit());
  if (why)
    throw new Conflict(why);
  if (!S.shift.returnToDepot(o.id, S.orders))
    throw new Conflict("Chỉ đơn giao thất bại mới hoàn kho được");
  chargeReturn(o);
  mark(D_ORDERS);
  audit("order.return", String(o.id), "phí hoàn " + money(o.returnFee));
  const msg = `Đơn #${o.id} được hoàn về kho, phí hoàn ${money(o.returnFee)}`;
  S.shift.dropEmptyAutoTrips();
  if (isCustomer())
    notifyStaff("order", o.id, `Khách ${S.me.displayName} yêu cầu hoàn đơn #${o.id} về kho`);
  else
    notify(o.owner, "order", o.id, msg);
  return { ...stateJson(), message: isCustomer() ? msg : `Đã chuyển đơn ${o.id} sang hoàn kho` };
}
function rateOrder(r) {
  const o = orderForActor(integer(r, "id"));
  if (o.status !== DELIVERED)
    throw new Conflict("Chỉ đánh giá được đơn đã giao");
  const stars = integer(r, "stars", 0);
  if (stars < 1 || stars > 5)
    throw new Invalid("Hãy chọn từ 1 đến 5 sao", { stars: "Chọn từ 1 đến 5 sao" });
  const rv = { order: o.id, customer: S.me.username, shipper: shipperNameOf(o.shipper), stars, comment: trimmed(str(r, "comment")), at: nowSeconds() };
  if (S.reviews.ofOrder(o.id))
    throw new Conflict("Đơn này đã được đánh giá");
  const e = S.reviews.add(rv);
  if (e)
    throw new BadRequest(e);
  mark(D_REVIEWS);
  audit("order.rate", String(o.id), `${stars} sao`);
  notify(accountOfShipper(rv.shipper), "order", o.id, `Đơn #${o.id} được đánh giá ${stars} sao`);
  return { ok: true, message: "Cảm ơn bạn đã đánh giá" };
}
// ------------------------------------------------------------ Danh sách, chi tiết, hoá đơn, tra cứu công khai
function timelineJson(o) {
  const arr = [];
  if (o.createdAt > 0)
    arr.push({ type: "created", at: o.createdAt, t: null, who: o.createdBy, detail: "" });
  // Khách không thấy việc hệ thống mời / bị từ chối / bỏ lỡ từng shipper (như app Grab chỉ báo "đang tìm tài xế")
  const hiddenFromCustomer = ["offered", "declined", "expired", "offer_withdrawn", "recalled", "released", "assigned"];
  for (const e of S.shift.events)
    if (e.order === o.id && !(o.createdAt > 0 && e.type === "created") && !(isCustomer() && hiddenFromCustomer.includes(e.type)))
      arr.push({ type: e.type, at: null, t: e.t, who: e.shipper >= 0 ? shipperNameOf(e.shipper) : null, detail: e.detail });
  return arr;
}
function invoiceJson(o) {
  const fee = feeFor(o);
  const gross = orderGross(o, fee);
  const lines = [];
  if (fee.valid && Math.trunc(fee.total) === gross) {
    const line = (label, v) => {
      if (v !== 0)
        lines.push({ label, amount: v });
    };
    line("Cước mở đầu", fee.base);
    line("Cước theo quãng đường", fee.distance);
    line("Phụ phí khối lượng", fee.weight);
    line("Phụ thu hoả tốc", fee.urgent);
    line("Phí thu hộ", fee.cod);
    const sum = fee.base + fee.distance + fee.weight + fee.urgent + fee.cod;
    if (Math.abs(sum - fee.total) > 0.5)
      lines.push({ label: "Làm tròn", amount: fee.total - sum });
  } else
    lines.push({ label: "Cước vận chuyển (đã chốt khi đặt đơn)", amount: gross });
  const net = Math.max(0, gross - o.loyaltyDiscount - o.promoDiscount);
  const total = net + o.insuranceFee;
  return {
    order: o.id,
    status: orderStatusName(o.status),
    recipient: o.recipient,
    destination: nodeName(o.destination),
    km: fee.valid ? fee.km : 0,
    weight: o.weight,
    chargedWeight: chargedWeightOf(o),
    dims: dimsText(o.dimL, o.dimW, o.dimH),
    lines,
    gross,
    loyaltyDiscount: o.loyaltyDiscount,
    promo: o.promo,
    promoDiscount: o.promoDiscount,
    net,
    value: o.declaredValue,
    insurance: o.insuranceFee,
    total,
    payer: o.receiverPays ? "receiver" : "sender",
    collect: o.cod + (o.receiverPays ? total : 0),
    cancelFee: o.cancelFee,
    returnFee: o.returnFee,
    cod: o.cod,
    payable: o.status === CANCELLED ? o.cancelFee : o.status === RETURNED ? o.returnFee : total,
    createdAt: o.createdAt
  };
}
function orderDetailJson(o, index) {
  const fee = feeFor(o);
  const j = orderRow(o, index, fee, unreachableSet(), carrierMap());
  const trip = S.shift.tripOfOrder(o.id);
  if (trip && !(isCustomer() && !trip.accepted))
    j.trip = { id: trip.id, accepted: trip.accepted, shipper: trip.shipperName };
  const rv = S.reviews.ofOrder(o.id);
  if (rv)
    j.review = { stars: rv.stars, comment: rv.comment };
  // Khách xem được SĐT shipper khi đơn đang trên đường
  if (isCustomer() && o.status === ASSIGNED && o.shipper >= 0) {
    const a = S.accounts.find(accountOfShipper(shipperNameOf(o.shipper)));
    j.carrierPhone = a ? a.phone : "";
  }
  return { ok: true, order: j, timeline: timelineJson(o), invoice: invoiceJson(o) };
}
function ordersListJson(r) {
  const view = currentView();
  const fees = orderFees();
  let rows = [];
  const byStatus = {};
  S.orders.forEach((o, i) => {
    if (!view.all && !view.orders.has(o.id))
      return;
    rows.push(i);
    byStatus[o.status] = (byStatus[o.status] || 0) + 1;
  });
  const st = trimmed(str(r, "status"));
  if (st) {
    const want = new Set(intList(st));
    rows = rows.filter((i) => want.has(S.orders[i].status));
  }
  if (isStaff() && trimmed(str(r, "owner"))) {
    const ow = lowerCopy(trimmed(str(r, "owner")));
    rows = rows.filter((i) => S.orders[i].owner === ow);
  }
  if (has(r, "urgent") && str(r, "urgent")) {
    const u = integer(r, "urgent") === 1;
    rows = rows.filter((i) => S.orders[i].urgent === u);
  }
  const from = num(r, "from", 0), to = num(r, "to", 0);
  if (from > 0)
    rows = rows.filter((i) => S.orders[i].createdAt >= from);
  if (to > 0)
    rows = rows.filter((i) => S.orders[i].createdAt <= to);
  const q = trimmed(str(r, "q"));
  if (q) {
    const idx = new TextIndex;
    for (const i of rows) {
      const o = S.orders[i];
      idx.add(i, `${o.id} ${o.recipient} ${o.phone} ${o.note} ${nodeName(o.destination)}` + (isShipper() ? "" : ` ${o.owner} ${ownerDisplay(o.owner)}`));
    }
    const hit = new Set(idx.search(q));
    rows = rows.filter((i) => hit.has(i));
  }
  const key = sortKey(r, ["id", "created", "status", "net", "deadline", "destination"], "id");
  const desc = sortDesc(r, true);
  rows.sort((a, b) => {
    const x = S.orders[a], y = S.orders[b];
    let c = 0;
    if (key === "id")
      c = x.id - y.id;
    else if (key === "created")
      c = x.createdAt - y.createdAt;
    else if (key === "status")
      c = x.status - y.status;
    else if (key === "net")
      c = orderNet(x, fees[a]) - orderNet(y, fees[b]);
    else if (key === "deadline")
      c = (x.deadline < 0 ? 1e9 : x.deadline) - (y.deadline < 0 ? 1e9 : y.deadline);
    else
      c = byteCompare(normalizeVi(nodeName(x.destination)), normalizeVi(nodeName(y.destination)));
    if (c === 0)
      return desc ? y.id - x.id : x.id - y.id;
    return desc ? -Math.sign(c) : Math.sign(c);
  });
  const p = paginate(r, rows.length);
  const unreachable = unreachableSet();
  const carrier = carrierMap();
  const orders = rows.slice(p.begin, p.end).map((i) => orderRow(S.orders[i], i, fees[i], unreachable, carrier));
  return { ok: true, orders, page: pageJson(p), byStatus };
}
// Tra cứu công khai: mã đơn + SĐT người nhận. Mọi trường hợp không khớp đều trả về cùng một thông báo.
function trackOrder(r) {
  const now = nowSeconds();
  if (!S.limiter.allow("track:" + S.ip, now, 20, 600))
    throw new TooMany("Bạn tra cứu quá nhiều lần, hãy thử lại sau ít phút", S.limiter.retryAfter("track:" + S.ip, now, 600));
  const notFound = "Không tìm thấy đơn phù hợp. Hãy kiểm tra lại mã đơn và số điện thoại người nhận.";
  const code = trimmed(str(r, "code"));
  const phone = normalizePhone(str(r, "phone"));
  if (!code || code.length > 9 || !phone || !/^[0-9]+$/.test(code))
    throw new BadRequest(notFound);
  const o = findOrderById(Number(code));
  if (!o || !o.phone || o.phone !== phone)
    throw new BadRequest(notFound);
  const carrier = carrierMap();
  const steps = [{ type: "created", at: o.createdAt }];
  for (const e of S.shift.events)
    if (e.order === o.id && e.type !== "created")
      steps.push({ type: e.type, t: e.t });
  const ship = carrier.get(o.id) || "";
  const first = ship ? ship.slice(ship.lastIndexOf(" ") + 1) : "";
  return {
    ok: true,
    order: { id: o.id, status: o.status, statusName: orderStatusName(o.status), destination: nodeName(o.destination), urgent: o.urgent, carrier: first || null, cod: o.cod, collect: orderCollect(o, feeFor(o)), deliveredReal: o.deliveredReal },
    steps
  };
}
function publicInfo() {
  const bad = unreachableSet();
  const nodes = S.graph.nodeIds().filter((id) => id !== S.depot && !bad.has(id)).map((id) => ({ id, name: nodeName(id) }));
  return {
    ok: true,
    nodes,
    depot: nodeName(S.depot),
    tariff: tariffJson(),
    tiers: CONFIG.tiers.map((t) => ({ name: t.name, minDone: t.minDone, pct: t.pct })),
    delivered: S.orders.filter((o) => o.status === DELIVERED).length,
    shippers: S.shippers.length,
    demo: S.demo
  };
}
function quoteHandler(r) {
  const now = nowSeconds();
  if (!S.authed && !S.limiter.allow("quote:" + S.ip, now, 60, 60))
    throw new TooMany("Bạn báo giá quá nhanh, hãy thử lại sau ít giây", 10);
  const o = newOrder();
  o.destination = requireNode(r, "destination");
  o.weight = num(r, "weight", 1);
  if (!(o.weight > 0) || o.weight > 5000)
    throw new BadRequest("Khối lượng phải lớn hơn 0 và tối đa 5000 kg");
  o.urgent = integer(r, "urgent", 0) === 1;
  const cod = num(r, "cod", 0);
  if (cod < 0 || cod > MAX_COD)
    throw new BadRequest("Tiền thu hộ phải từ 0 đến 50.000.000 đ");
  o.cod = Math.trunc(cod);
  readBillingFields(r, o);
  const code = S.authed ? normalizeCode(str(r, "promo")) : "";
  const q = quoteFor(o, isCustomer() ? S.me.username : "", code);
  const out = { ...quoteJson(q), ok: true, collect: o.cod + (o.receiverPays ? q.total : 0) };
  if (!S.authed && str(r, "promo"))
    out.promoError = "Hãy đăng nhập để dùng mã giảm giá";
  return out;
}
// ------------------------------------------------------------ Mã giảm giá
function promosJson() {
  const now = nowSeconds();
  return {
    ok: true,
    promos: S.promos.all().map((p) => ({ code: p.code, type: p.type, value: p.value, maxDiscount: p.maxDiscount, minFee: p.minFee, maxUses: p.maxUses, used: p.used, perUser: p.perUser, expires: p.expires, expired: p.expires > 0 && p.expires < now, active: p.active, description: p.description }))
  };
}
function savePromo(r) {
  const p = newPromo();
  p.code = normalizeCode(str(r, "code"));
  p.type = lowerCopy(str(r, "type", "pct"));
  p.value = Math.trunc(num(r, "value"));
  p.maxDiscount = Math.trunc(num(r, "maxDiscount", 0));
  p.minFee = Math.trunc(num(r, "minFee", 0));
  p.maxUses = integer(r, "maxUses", 0);
  p.perUser = integer(r, "perUser", 1);
  p.expires = Math.trunc(num(r, "expires", 0));
  p.active = !has(r, "active") || flag(r, "active");
  p.description = trimmed(str(r, "description"));
  const old = S.promos.find(p.code);
  if (old)
    p.used = old.used;
  let e = checkPromo(p);
  if (e)
    throw new Invalid(e, { code: e });
  e = S.promos.upsert(p);
  if (e)
    throw new BadRequest(e);
  mark(D_PROMOS);
  audit("promo.save", p.code, `${p.type} ${p.value}`);
  return { ...promosJson(), message: "Đã lưu mã " + p.code };
}
// ------------------------------------------------------------ Điều phối và ca giao
function pendingOrders() {
  const p = { orders: [], idx: [] };
  let created = 0;
  S.orders.forEach((o, i) => {
    if (o.status === PENDING) {
      p.orders.push({ ...o });
      p.idx.push(i);
    }
    created += o.status === CREATED;
  });
  if (!p.orders.length)
    throw new BadRequest(created ? `Chưa có đơn nào chờ giao: còn ${created} đơn mới cần xác nhận trước.` : !S.orders.length ? "Chưa có đơn hàng nào" : "Mọi đơn đều đã được phân công. Không còn đơn chờ giao.");
  return p;
}
// Shipper nghỉ đột xuất hoặc tắt "sẵn sàng" không được điều phối; bật tính điểm thì shipper điểm cao được xét trước.
// only >= 0: chỉ xét một shipper (phân công tay hoặc ghép tự động).
// startAfter >= 0: shipper chỉ có thể xuất phát từ kho vào phút này (ghép tự động: giờ hiện tại + thời gian chạy tới kho).
function runDispatch(pend, v, back, only = -1, startAfter = -1) {
  const map = [];
  S.shippers.forEach((_, i) => {
    if (!S.shift.isAbsent(i) && shipperReady(i) && (only < 0 || only === i))
      map.push(i);
  });
  if (CONFIG.scoreAware) {
    const score = new Map(map.map((i) => [i, shipperScore(S.shippers[i].name)]));
    map.sort((a, b) => score.get(b) - score.get(a));
  }
  const avail = map.map((i) => S.shippers[i]);
  const d = new Dispatcher(S.graph, S.depot, pend.orders, avail, back);
  d.setStartTime(S.shift.clock);
  d.setShipperFreeAt(map.map((i) => startAfter >= 0 ? startAfter : S.shift.freeAt(i)));
  d.setRush(rushPtr(), S.shiftStart);
  const rep = d.compareAll(v);
  for (const p of [...rep.multi, ...rep.single])
    for (const rt of p.routes)
      if (rt.shipper >= 0)
        rt.shipper = map[rt.shipper];
  return rep;
}
function dispatchVehicle(r) {
  let v = vehicleFromInt(integer(r, "vehicle", 0));
  if (v === ANY_VEHICLE)
    v = MOTORBIKE;
  return v;
}
function dispatchPreview(r) {
  if (!S.graph.hasNode(S.depot))
    throw new BadRequest("Chưa chọn kho");
  const v = dispatchVehicle(r);
  const back = integer(r, "return", 1) === 1;
  const pend = pendingOrders();
  const rep = runDispatch(pend, v, back);
  if (rep.error)
    throw new BadRequest(rep.error);
  return {
    clock: S.shift.clock,
    pending: pend.orders.length,
    ok: true,
    depot: S.depot,
    vehicle: vehicleName(v),
    returnToDepot: back,
    scoreAware: CONFIG.scoreAware,
    priorityOrder: rep.priorityOrder.map((i) => pend.orders[i].id),
    matrixMicros: rep.matrixMicros,
    single: rep.single.map((p) => planJson(p, pend.orders, S.shippers)),
    multi: rep.multi.map((p) => planJson(p, pend.orders, S.shippers))
  };
}
// Áp dụng một phương án: đơn sang "Đã phân công" và chờ shipper nhận chuyến (chế độ mô phỏng thì vào thẳng "Đang giao")
function dispatchApply(r) {
  if (!S.graph.hasNode(S.depot))
    throw new BadRequest("Chưa chọn kho");
  const key = str(r, "plan");
  const v = dispatchVehicle(r);
  const back = integer(r, "return", 1) === 1;
  const pend = pendingOrders();
  const rep = runDispatch(pend, v, back);
  if (rep.error)
    throw new BadRequest(rep.error);
  let chosen = null;
  for (const p of [...rep.multi, ...rep.single])
    if (p.key === key)
      chosen = p;
  if (!chosen)
    throw new BadRequest(`Không có phương án '${key}'`);
  if (chosen.skipped)
    throw new Conflict("Phương án này không chạy được: " + chosen.note);
  const n = applyPlan(chosen, pend);
  if (n === 0)
    throw new BadRequest("Phương án không giao được đơn nào");
  audit("dispatch.apply", chosen.key, `${n} đơn`);
  return { ...stateJson(), message: `Đã áp dụng “${chosen.name}”: ${n} đơn được phân công` };
}
// Tạo chuyến theo phương án, ghi nhật ký và báo cho khách / shipper. Trả về số đơn được phân công.
function applyPlan(plan, pend) {
  const tripsBefore = S.shift.trips.length;
  const n = S.shift.apply(plan, pend.idx, S.orders, S.shippers, !CONFIG.autoDeliver);
  if (n === 0)
    return 0;
  for (const i of pend.idx) {
    const o = S.orders[i];
    if (o.status !== DISPATCHED && o.status !== ASSIGNED)
      continue;
    logOrder("assigned", o, shipperNameOf(o.shipper));
    notify(o.owner, "order", o.id, `Đơn #${o.id} đã được phân công cho ${shipperNameOf(o.shipper)}`);
  }
  for (const trip of S.shift.trips.slice(tripsBefore))
    notify(accountOfShipper(trip.shipperName), "trip", 0, `Bạn có chuyến mới #${trip.id} gồm ${trip.stops.length} đơn` + (trip.accepted ? "" : ", hãy mở và nhận chuyến"));
  mark(D_ORDERS);
  return n;
}
// Phân công tay: quản trị viên chọn các đơn Chờ giao và một shipper; thứ tự giao theo phương án "deadline" cho riêng shipper đó
function dispatchAssign(r) {
  if (!S.graph.hasNode(S.depot))
    throw new BadRequest("Chưa chọn kho");
  const si = integer(r, "shipper", -1);
  if (si < 0 || si >= S.shippers.length)
    throw new Invalid("Hãy chọn shipper", { shipper: "Hãy chọn shipper" });
  const name = S.shippers[si].name;
  if (S.shift.isAbsent(si))
    throw new Conflict(`${name} đang nghỉ đột xuất, không phân công được`);
  if (!shipperReady(si))
    throw new Conflict(`${name} đang tắt "sẵn sàng nhận chuyến" hoặc tài khoản bị khoá`);
  const pend = { orders: [], idx: [] };
  const seen = new Set;
  for (const id of intList(str(r, "orders"))) {
    if (seen.has(id))
      continue;
    seen.add(id);
    const o = findOrderById(id);
    if (!o)
      throw new BadRequest(`Không có đơn ${id}`);
    if (o.status !== PENDING)
      throw new Conflict(`Đơn ${id} đang ở '${orderStatusName(o.status)}', chỉ phân công được đơn Chờ giao`);
    pend.orders.push({ ...o });
    pend.idx.push(S.orders.indexOf(o));
  }
  if (!pend.orders.length)
    throw new Invalid("Hãy chọn ít nhất một đơn", { orders: "Chọn đơn cần phân công" });
  const back = integer(r, "return", 1) === 1;
  const rep = runDispatch(pend, S.shippers[si].vehicle, back, si);
  if (rep.error)
    throw new BadRequest(rep.error);
  let chosen = null;
  for (const p of rep.multi)
    if (p.key === "deadline")
      chosen = p;
  if (!chosen || chosen.skipped)
    throw new Conflict(`Không lập được chuyến cho ${name}` + (chosen ? ": " + chosen.note : ""));
  const n = applyPlan(chosen, pend);
  if (n === 0)
    throw new Conflict(`Không đơn nào hợp với ${name} (quá tải trọng, xe không tới được điểm giao hoặc hết giờ)`);
  const left = pend.orders.length - n;
  audit("dispatch.assign", name, `${n} đơn`);
  return { ...stateJson(), assigned: n, left, message: `Đã phân công ${n} đơn cho ${name}` + (left ? `. ${left} đơn không xếp được (quá tải trọng / xe không tới được), vẫn ở hàng chờ` : "") };
}
// ------------------------------------------------------------ Ghép đơn tự động (kiểu Grab)
// Đơn Chờ giao được mời cho shipper GẦN NHẤT: gần = thời gian chạy ngắn nhất từ chỗ shipper đang đứng tới kho lấy hàng
// (Dijkstra theo thời gian, đúng loại xe, có tính giờ cao điểm). Shipper có số giây (offerSeconds) để nhận;
// từ chối hoặc hết hạn thì mời người gần nhất kế tiếp, hết người thì báo khách để khách thử lại hoặc huỷ.
// Lộ trình của chuyến vẫn do phương án "deadline" của Dispatcher lập (xuất phát từ kho, không quay về).
function systemAudit(action, target, detail = "") {
  S.audit.add("hệ thống", "system", action, target, detail, nowSeconds());
  mark(D_AUDIT);
}
var alreadyTried = (o, si) => o.tried.includes(si);
function markTried(o, si) {
  if (si >= 0 && !alreadyTried(o, si))
    o.tried = [...o.tried, si];
}
var shipperEligible = (si) => !S.shift.isAbsent(si) && shipperReady(si);
// Đường nhanh nhất từ nơi shipper đứng tới kho
function approachOf(from, v) {
  const a = { ok: false, path: [], times: [], minutes: 0, km: 0 };
  if (from < 0 || !S.graph.hasNode(from) || !S.graph.hasNode(S.depot))
    return a;
  const clock = S.shift.clock;
  if (from === S.depot) {
    a.ok = true;
    a.path = [S.depot];
    a.times = [clock];
    return a;
  }
  const rush = rushPtr();
  const tree = dijkstra(S.graph, from, MIN_HEAP, { criterion: TIME, vehicle: v, target: S.depot, rush, departAt: rush ? S.shiftStart + clock : -1 });
  a.path = getPath(tree, S.depot);
  if (!a.path.length)
    return a;
  a.times.push(clock);
  let tm = 0;
  for (let i = 1;i < a.path.length; i++) {
    const e = S.graph.getEdge(a.path[i - 1], a.path[i]);
    tm += travelMinutesAt(e, v, S.shiftStart + clock + tm, rush);
    a.km += e.distance;
    a.times.push(clock + tm);
  }
  a.minutes = tm;
  a.ok = true;
  return a;
}
// Shipper có thể được mời cho đơn này: sẵn sàng, không nghỉ, rảnh, chở nổi, chưa từ chối / bỏ lỡ đơn này.
// Xếp theo: (điểm hiệu suất nếu bật) -> thời gian tới kho -> km -> điểm -> thứ tự trong đội xe.
function matchCandidates(o) {
  const out = [];
  S.shippers.forEach((sh, si) => {
    if (!shipperEligible(si) || alreadyTried(o, si))
      return;
    if (o.weight > sh.capacity)
      return;
    if (S.shift.busy(si, S.orders))
      return;
    const ap = approachOf(shipperNode(si), sh.vehicle);
    if (!ap.ok)
      return;
    out.push({ shipper: si, ap, score: shipperScore(sh.name) });
  });
  const byScore = CONFIG.scoreAware;
  out.sort((a, b) => {
    if (byScore && a.score !== b.score)
      return a.score > b.score ? -1 : 1;
    if (Math.abs(a.ap.minutes - b.ap.minutes) > 0.000000001)
      return a.ap.minutes < b.ap.minutes ? -1 : 1;
    if (Math.abs(a.ap.km - b.ap.km) > 0.000000001)
      return a.ap.km < b.ap.km ? -1 : 1;
    if (a.score !== b.score)
      return a.score > b.score ? -1 : 1;
    return a.shipper - b.shipper;
  });
  return out;
}
// Còn shipper nào (kể cả đang bận) có thể được mời cho đơn này không?
var anyoneLeft = (o) => S.shippers.some((sh, si) => shipperEligible(si) && !alreadyTried(o, si) && o.weight <= sh.capacity);
// Lập chuyến một đơn cho shipper và gửi lời mời. false nếu shipper này không giao nổi đơn (xe không tới được...).
function offerTo(o, c) {
  const pend = { orders: [{ ...o }], idx: [S.orders.indexOf(o)] };
  const clock = S.shift.clock;
  const rep = runDispatch(pend, S.shippers[c.shipper].vehicle, false, c.shipper, clock + c.ap.minutes);
  if (rep.error)
    return false;
  let chosen = null;
  for (const p of rep.multi)
    if (p.key === "deadline")
      chosen = p;
  if (!chosen || chosen.skipped)
    return false;
  if (!chosen.routes.some((rt) => rt.orders.length))
    return false;
  if (S.shift.apply(chosen, pend.idx, S.orders, S.shippers, true, true) === 0)
    return false;
  const t = S.shift.trips[S.shift.trips.length - 1];
  t.offerUntil = nowSeconds() + CONFIG.offerSeconds;
  t.offerClock = clock;
  t.fromNode = c.ap.path[0];
  t.approach = c.ap.path;
  t.approachTimes = c.ap.times;
  const mins = Math.round(c.ap.minutes);
  t.note = `Ghép tự động: shipper gần nhất (${mins} phút tới kho)`;
  o.noShipperAt = 0;
  const name = S.shippers[c.shipper].name;
  S.shift.log(clock, "offered", o.id, c.shipper, `${mins} phút tới kho`);
  notify(accountOfShipper(name), "trip", o.id, `Đơn mới #${o.id} gần bạn: lấy ở kho (${mins} phút) rồi giao tới ${nodeName(o.destination)}. Hãy nhận trong ${CONFIG.offerSeconds} giây`);
  mark(D_ORDERS);
  return true;
}
function notifyNoShipper(o) {
  if (o.noShipperAt > 0)
    return;
  o.noShipperAt = nowSeconds();
  S.shift.log(S.shift.clock, "no_shipper", o.id, -1, "");
  notify(o.owner, "order", o.id, `Chưa có shipper nhận đơn #${o.id}. Bạn có thể bấm “Tìm lại” hoặc huỷ đơn.`);
  mark(D_ORDERS);
}
// Mời đơn cho shipper gần nhất còn phù hợp. true nếu đã gửi được lời mời.
function matchOne(o) {
  for (const c of matchCandidates(o)) {
    if (offerTo(o, c))
      return true;
    markTried(o, c.shipper);
  }
  if (!anyoneLeft(o))
    notifyNoShipper(o);
  return false;
}
// Ghép mọi đơn Chờ giao (đơn gấp, hạn sớm trước). Trả về số lời mời mới.
function matchPending() {
  if (!CONFIG.autoMatch || !S.graph.hasNode(S.depot))
    return 0;
  // đơn nhập từ file (chưa có giờ đặt) chờ quản trị viên phân công hoặc bấm “Tìm shipper”
  const ids = S.orders.filter((o) => o.status === PENDING && (o.createdAt > 0 || o.searchSince > 0)).map((o) => o.id);
  if (!ids.length)
    return 0;
  ids.sort((a, b) => {
    const x = findOrderById(a), y = findOrderById(b);
    return higherPriority(x, y) ? -1 : higherPriority(y, x) ? 1 : 0;
  });
  let n = 0;
  for (const id of ids) {
    const o = findOrderById(id);
    if (o && o.status === PENDING && matchOne(o))
      ++n;
  }
  return n;
}
// Gỡ lời mời chưa trả lời của một shipper (họ tắt "sẵn sàng" hoặc nghỉ đột xuất): đơn về hàng chờ, không tính là từ chối
function withdrawOffers(si, why) {
  const ids = S.shift.trips.filter((t) => t.shipper === si && !t.accepted).map((t) => t.id);
  for (const tid of ids) {
    const t = S.shift.findTrip(tid);
    const orders = t.stops.map((st) => st.orderId);
    S.shift.decline(tid, S.orders, why);
    for (const oid of orders) {
      const o = findOrderById(oid);
      if (o) {
        o.searchSince = nowSeconds();
        logOrder("offer_withdrawn", o, why);
      }
    }
  }
  if (ids.length)
    mark(D_ORDERS);
}
// Lời mời quá hạn: coi như shipper bỏ lỡ, mời người kế tiếp
function expireOffer(tripId) {
  const t = S.shift.findTrip(tripId);
  if (!t)
    return;
  const si = t.shipper;
  const name = t.shipperName;
  const orders = t.stops.map((st) => st.orderId);
  S.shift.decline(tripId, S.orders, "Hết thời gian trả lời");
  for (const oid of orders) {
    const o = findOrderById(oid);
    if (o) {
      markTried(o, si);
      logOrder("expired", o, name);
      systemAudit("offer.expire", String(oid), name);
    }
  }
  notify(accountOfShipper(name), "trip", 0, `Bạn đã bỏ lỡ lời mời #${tripId} vì hết thời gian trả lời`);
  mark(D_ORDERS);
}
// Chờ quá lâu mà không ai nhận: hệ thống tự huỷ đơn (miễn phí) và báo khách
function giveUpOrder(o) {
  const out = { to: 0 };
  if (flowCheck(o.status, "cancel", B_SYSTEM, out))
    return;
  if (!S.shift.cancel(o.id, S.orders))
    return;
  o.closedAt = nowSeconds();
  o.proofNote = "Hệ thống huỷ: không tìm được shipper";
  releasePromo(o);
  logOrder("gave_up", o, "");
  systemAudit("order.giveup", String(o.id), "không tìm được shipper");
  notify(o.owner, "order", o.id, `Đơn #${o.id} đã tự huỷ vì không tìm được shipper (không mất phí). Bạn có thể đặt lại sau.`);
  mark(D_ORDERS);
}
// Đồng hồ ca chạy tới phút t. Chế độ mô phỏng giao hàng thì đơn tới hạn tự giao.
function runClockTo(t) {
  if (!CONFIG.autoDeliver) {
    S.shift.advance(t);
    return 0;
  }
  const before = S.orders.filter((o) => o.status === ASSIGNED).map((o) => o.id);
  const n = S.shift.progress(t, S.orders);
  for (const id of before) {
    const o = findOrderById(id);
    if (o && o.status === DELIVERED)
      onDelivered(o);
  }
  if (n)
    matchPending();
  return n;
}
// Chạy mỗi yêu cầu (trong handle): đồng hồ ca nhích theo giờ thật, lời mời quá hạn, đơn chờ quá lâu, ghép đơn (tối đa 1 lần / 2 giây)
function liveTick() {
  const now = nowSeconds();
  const cfg = CONFIG;
  if (S.lastTick === 0)
    S.lastTick = now;
  const dt = Math.min(Math.max(0, now - S.lastTick), 600);
  S.lastTick = now;
  if (cfg.clockSpeed > 0 && dt > 0 && S.shift.active())
    runClockTo(S.shift.clock + dt * cfg.clockSpeed / 60);
  const expired = S.shift.trips.filter((t) => !t.accepted && t.offerUntil > 0 && now >= t.offerUntil).map((t) => t.id);
  for (const id of expired)
    expireOffer(id);
  if (cfg.matchGiveUp > 0) {
    const stale = S.orders.filter((o) => o.status === PENDING && o.searchSince > 0 && now - o.searchSince >= cfg.matchGiveUp * 60).map((o) => o.id);
    for (const id of stale) {
      const o = findOrderById(id);
      if (o)
        giveUpOrder(o);
    }
  }
  if (expired.length || now - S.lastMatch >= 2) {
    S.lastMatch = now;
    matchPending();
  }
}
// Khách bấm “Tìm lại”: xoá danh sách đã từ chối, mời lại từ đầu
function retryOrder(r) {
  const o = orderForActor(integer(r, "id"));
  if (o.status !== PENDING)
    throw new Conflict(`Chỉ tìm lại được shipper cho đơn đang ở 'Chờ giao' (đơn ${o.id} đang ở '${orderStatusName(o.status)}')`);
  o.tried = [];
  o.noShipperAt = 0;
  o.searchSince = nowSeconds();
  logOrder("retry", o, S.me.username);
  mark(D_ORDERS);
  audit("order.retry", String(o.id));
  const offers = matchPending();
  const cur = findOrderById(o.id);
  return { ...stateJson(), message: cur.status === DISPATCHED ? `Đã gửi đơn ${o.id} cho shipper gần nhất` : offers ? `Đang tìm shipper cho đơn ${o.id}` : `Chưa có shipper rảnh, hệ thống sẽ tiếp tục tìm cho đơn ${o.id}` };
}
// Shipper nhả đơn đã nhận khi chưa lấy hàng (như tài xế Grab huỷ chuyến): đơn quay lại hàng chờ và được mời cho người khác
function releaseOrder(r) {
  const id = integer(r, "id");
  const o = orderForActor(id);
  if (o.shipper !== myShipperIndex())
    throw new Forbidden(`Đơn ${id} không nằm trong chuyến của bạn`);
  const why = flowCheck(o.status, "release", actorBit());
  if (why)
    throw new Conflict(why);
  if (pickedUp(o))
    throw new Conflict("Bạn đã lấy hàng nên không nhả đơn được nữa. Hãy giao hoặc báo giao thất bại.");
  const reason = trimmed(str(r, "reason"));
  if (blen(reason) < 3)
    throw new Invalid("Hãy nhập lý do nhả đơn", { reason: "Hãy nhập lý do (ít nhất 3 ký tự)" });
  if (blen(reason) > 150)
    throw new Invalid("Lý do tối đa 150 ký tự", { reason: "Tối đa 150 ký tự" });
  const ship = o.shipper;
  if (!S.shift.release(id, S.orders))
    throw new Conflict("Không nhả được đơn này");
  S.shift.dropEmptyAutoTrips();
  markTried(o, ship);
  o.noShipperAt = 0;
  o.searchSince = nowSeconds();
  ++S.stats.at(S.me.link).declines;
  mark(D_STATS | D_ORDERS);
  logOrder("released", o, reason);
  audit("order.release", String(id), reason);
  notify(o.owner, "order", id, `Shipper ${S.me.link} không thể giao đơn #${id}, hệ thống đang tìm shipper khác cho bạn`);
  notifyStaff("order", id, `${S.me.link} nhả đơn #${id}: ${reason}`);
  matchPending();
  return { ...stateJson(), message: `Đã nhả đơn ${id}, hệ thống sẽ tìm shipper khác` };
}
// Shipper đánh giá khách sau khi giao xong (đánh giá hai chiều)
function rateCustomer(r) {
  const o = orderForActor(integer(r, "id"));
  if (o.shipper !== myShipperIndex())
    throw new Forbidden(`Đơn ${o.id} không do bạn giao`);
  if (o.status !== DELIVERED)
    throw new Conflict("Chỉ đánh giá được khách của đơn đã giao");
  const stars = integer(r, "stars", 0);
  if (stars < 1 || stars > 5)
    throw new Invalid("Hãy chọn từ 1 đến 5 sao", { stars: "Chọn từ 1 đến 5 sao" });
  if (!o.owner)
    throw new Conflict("Đơn này không gắn với tài khoản khách hàng");
  if (S.custReviews.ofOrder(o.id))
    throw new Conflict("Bạn đã đánh giá khách của đơn này");
  const rv = { order: o.id, customer: o.owner, shipper: S.me.link, stars, comment: trimmed(str(r, "comment")), at: nowSeconds() };
  const e = S.custReviews.add(rv);
  if (e)
    throw new BadRequest(e);
  mark(D_CREVIEWS);
  audit("order.rate_customer", String(o.id), `${stars} sao`);
  notify(o.owner, "order", o.id, `Shipper ${S.me.link} đánh giá bạn ${stars} sao cho đơn #${o.id}`);
  return { ...stateJson(), message: "Cảm ơn bạn đã đánh giá khách hàng" };
}
// Quản trị viên thu hồi chuyến / lời mời shipper chưa nhận (shipper không phản hồi): đơn về Chờ giao, không tính là shipper từ chối
function recallTrip(r) {
  const id = integer(r, "id");
  const t = S.shift.findTrip(id);
  if (!t)
    throw new BadRequest(`Không có chuyến ${id} (có thể lời mời đã hết hạn hoặc đã được thu hồi)`);
  if (t.accepted)
    throw new Conflict(`Shipper đã nhận chuyến ${id}. Hãy báo shipper nghỉ đột xuất hoặc huỷ từng đơn nếu cần.`);
  const reason = trimmed(str(r, "reason"));
  if (blen(reason) < 3)
    throw new Invalid("Hãy nhập lý do thu hồi", { reason: "Hãy nhập lý do (ít nhất 3 ký tự)" });
  const ship = t.shipperName;
  const ids = t.stops.map((st) => st.orderId);
  const n = S.shift.decline(id, S.orders, "Thu hồi: " + utf8Prefix(reason, 150));
  if (n < 0)
    throw new Conflict(`Không thu hồi được chuyến ${id}`);
  mark(D_ORDERS);
  for (const oid of ids) {
    const o = findOrderById(oid);
    if (o) {
      o.searchSince = nowSeconds();
      logOrder("recalled", o, reason);
    }
  }
  audit("trip.recall", String(id), `${ship}: ${reason}`);
  notify(accountOfShipper(ship), "trip", 0, `Chuyến #${id} đã được quản trị viên thu hồi: ${reason}`);
  matchPending();
  return { ...stateJson(), message: `Đã thu hồi chuyến ${id} của ${ship}: ${n} đơn trở về hàng chờ` };
}
function acceptTrip(r) {
  const id = integer(r, "id");
  const t = S.shift.findTrip(id);
  if (!t)
    throw new BadRequest(`Không có chuyến ${id} (lời mời có thể đã hết hạn hoặc bị thu hồi)`);
  if (t.shipper !== myShipperIndex())
    throw new Forbidden("Chuyến này không phải của bạn");
  const ids = t.stops.map((s) => s.orderId);
  const autoTrip = t.fromNode >= 0;
  const n = S.shift.accept(id, S.orders);
  if (n < 0)
    throw new Conflict("Chuyến này đã được nhận rồi");
  ++S.stats.at(S.me.link).accepted;
  mark(D_STATS | D_ORDERS);
  for (const oid of ids) {
    const o = findOrderById(oid);
    if (o) {
      logOrder("accepted", o, S.me.link);
      o.noShipperAt = 0;
      notify(o.owner, "order", oid, autoTrip ? `${S.me.link} đã nhận đơn #${oid} và đang tới kho lấy hàng` : `Đơn #${oid} đang được ${S.me.link} giao tới bạn`);
    }
  }
  audit("trip.accept", String(id), `${n} đơn`);
  return { ...stateJson(), message: `Đã nhận chuyến ${id} (${n} đơn)` };
}
function declineTrip(r) {
  const id = integer(r, "id");
  const t = S.shift.findTrip(id);
  if (!t)
    throw new BadRequest(`Không có chuyến ${id} (lời mời có thể đã hết hạn hoặc bị thu hồi)`);
  if (t.shipper !== myShipperIndex())
    throw new Forbidden("Chuyến này không phải của bạn");
  const reason = trimmed(str(r, "reason"));
  if (blen(reason) < 3)
    throw new Invalid("Hãy nhập lý do từ chối", { reason: "Hãy nhập lý do (ít nhất 3 ký tự)" });
  const ids = t.stops.map((s) => s.orderId);
  const n = S.shift.decline(id, S.orders, utf8Prefix(reason, 150));
  if (n < 0)
    throw new Conflict("Chuyến đã được nhận, không từ chối được nữa");
  ++S.stats.at(S.me.link).declines;
  mark(D_STATS | D_ORDERS);
  const me = myShipperIndex();
  for (const oid of ids) {
    const o = findOrderById(oid);
    if (o) {
      markTried(o, me);
      // đơn này không mời lại shipper đã từ chối
      o.searchSince = nowSeconds();
      logOrder("declined", o, reason);
    }
  }
  if (!CONFIG.autoMatch)
    notifyStaff("trip", 0, `${S.me.link} từ chối chuyến ${id}: ${reason}. ${n} đơn trở lại hàng chờ.`);
  audit("trip.decline", String(id), reason);
  matchPending();
  return { ...stateJson(), message: `Đã từ chối chuyến ${id}` };
}
function shiftProgress(r) {
  const t = num(r, "t");
  if (t < 0)
    throw new BadRequest("Thời điểm không hợp lệ");
  if (isShipper() && !CONFIG.autoDeliver)
    throw new Forbidden("Đồng hồ ca do quản trị viên quản lý; shipper hãy xác nhận từng đơn bằng mã giao hàng");
  if (!CONFIG.autoDeliver) {
    // Chạy thật: đồng hồ chỉ nhích tới, shipper phải xác nhận từng đơn bằng mã
    runClockTo(t);
    return { ...stateJson(), delivered: 0, message: `Đồng hồ ca chạy tới phút ${Math.trunc(t)}. Shipper cần xác nhận từng đơn bằng mã giao hàng.` };
  }
  return { ...stateJson(), delivered: runClockTo(t) };
}
function shiftAbsent(r) {
  const i = integer(r, "index");
  if (i < 0 || i >= S.shippers.length)
    throw new BadRequest("Không có shipper này");
  if (S.shift.isAbsent(i))
    throw new Conflict(S.shippers[i].name + " đã được báo nghỉ");
  const carried = S.orders.filter((o) => o.shipper === i && (o.status === ASSIGNED || o.status === DISPATCHED)).map((o) => o.id);
  const n = S.shift.shipperAbsent(i, S.shippers[i].name, S.orders);
  S.shift.dropEmptyPendingTrips();
  for (const id of carried) {
    const o = findOrderById(id);
    if (o && o.status === PENDING) {
      // đơn quay về hàng chờ: tìm shipper khác, không mời lại người vừa nghỉ
      markTried(o, i);
      o.noShipperAt = 0;
      o.searchSince = nowSeconds();
      notify(o.owner, "order", id, `Shipper phụ trách đơn #${id} nghỉ đột xuất, hệ thống đang tìm shipper khác cho bạn`);
    }
  }
  mark(D_ORDERS);
  audit("shipper.absent", S.shippers[i].name, `${n} đơn trả về hàng chờ`);
  notify(accountOfShipper(S.shippers[i].name), "trip", 0, "Bạn được ghi nhận nghỉ đột xuất, các đơn chưa giao đã trả về hàng chờ");
  const offers = matchPending();
  const msg = S.shippers[i].name + " nghỉ đột xuất" + (n ? `: ${n} đơn chưa giao quay về hàng chờ` + (CONFIG.autoMatch ? offers ? `, hệ thống đã mời ${offers} đơn cho shipper khác` : ", hệ thống sẽ ghép cho shipper khác khi có người rảnh" : ", hãy điều phối lại cho người còn lại") : "");
  return { ...stateJson(), message: msg, returned: n };
}
// ------------------------------------------------------------ Sổ COD
function codJson(r) {
  const only = isShipper() ? S.me.link : trimmed(str(r, "shipper"));
  const names = new Set;
  for (const s of S.shippers)
    if (!only || s.name === only)
      names.add(s.name);
  for (const e of S.cod.entries)
    if (!only || e.shipper === only)
      names.add(e.shipper);
  let totalHeld = 0, totalAwait = 0;
  const shippers = [];
  for (const name of [...names].sort(byteCompare)) {
    const entries = S.cod.entries.filter((e) => e.shipper === name).map((e) => ({ id: e.id, order: e.order, amount: e.amount, state: e.state, at: e.collectedAt, remittance: e.remittance }));
    const remittances = S.cod.remittances().filter((m) => m.shipper === name).map((m) => ({ id: m.id, at: m.at, expected: m.expected, handed: m.handed, state: m.state, counted: m.counted, diff: remitDiff(m), note: m.note, confirmedBy: m.confirmedBy, settledAt: m.settledAt, orders: m.entries.length }));
    const closes = S.cod.closes.filter((c) => c.shipper === name).map((c) => ({ id: c.id, at: c.at, orders: c.orders, collected: c.collected, counted: c.counted, diff: closeDiff(c), by: c.by }));
    const held = S.cod.held(name), awaiting = S.cod.awaiting(name);
    totalHeld += held;
    totalAwait += awaiting;
    shippers.push({ shipper: name, held, awaiting, entries, remittances, closes });
  }
  return { ok: true, shippers, held: totalHeld, awaiting: totalAwait };
}
// ------------------------------------------------------------ Khiếu nại
// ------------------------------------------------------------ Ví / sao kê đối soát của khách hàng
// Tiền thu hộ đang chờ cho tới khi phiếu nộp COD chứa đơn được đối soát; đơn không có bút toán COD coi như đã đối soát.
function statementOf(customer, fees) {
  const settled = new Map;
  for (const e of S.cod.entries)
    settled.set(e.order, e.state === "settled");
  const facts = [];
  S.orders.forEach((o, i) => {
    if (o.owner !== customer)
      return;
    facts.push({
      id: o.id,
      status: o.status,
      cod: o.cod,
      total: orderTotal(o, fees[i]),
      returnFee: o.returnFee,
      cancelFee: o.cancelFee,
      receiverPays: o.receiverPays,
      at: o.status === DELIVERED && o.deliveredReal ? o.deliveredReal : o.closedAt ? o.closedAt : o.createdAt,
      codSettled: !settled.has(o.id) || settled.get(o.id)
    });
  });
  return billingStatement(facts, S.ledger.of(customer));
}
var statementSummary = (st) => ({ balance: st.balance, pending: st.pending, available: st.available, codTotal: st.codTotal, fees: st.fees, comps: st.comps, paidOut: st.paidOut, collected: st.collected });
function walletJson(customer) {
  const st = statementOf(customer, orderFees());
  const lines = st.lines.map((l) => ({ at: l.at, kind: l.kind, order: l.order, amount: l.amount, pending: l.pending, text: l.text, ref: l.ref, tx: l.tx }));
  return { ...statementSummary(st), ok: true, customer, name: ownerDisplay(customer), debtLimit: CONFIG.debtLimit, lines };
}
function customerAccount(user) {
  const a = S.accounts.find(user);
  if (!a || a.role !== CUSTOMER)
    throw new BadRequest(`Không có tài khoản khách hàng '${user}'`);
  return a;
}
function walletsJson() {
  const fees = orderFees();
  const rows = [];
  let owed = 0, debt = 0, pending = 0;
  for (const a of S.accounts.all()) {
    if (a.role !== CUSTOMER)
      continue;
    const st = statementOf(a.username, fees);
    if (!st.lines.length)
      continue;
    rows.push({ ...statementSummary(st), customer: a.username, name: a.displayName, lines: st.lines.length });
    if (st.available > 0)
      owed += st.available;
    if (st.balance < 0)
      debt -= st.balance;
    pending += st.pending;
  }
  return { ok: true, customers: rows, owed, debt, pending };
}
// Chi trả cho khách (không vượt quá số "có thể rút") hoặc ghi nhận khách nộp bù khi số dư âm
function walletPayout(r) {
  const cust = lowerCopy(trimmed(str(r, "customer")));
  customerAccount(cust);
  const kind = str(r, "kind", "payout");
  if (kind !== "payout" && kind !== "collect")
    throw new BadRequest("Loại giao dịch là payout (chi trả) hoặc collect (thu bù)");
  const amount = num(r, "amount", 0);
  if (!(amount > 0) || Math.floor(amount) !== amount || amount > 1e9)
    throw new Invalid("Số tiền phải là số nguyên lớn hơn 0", { amount: "Số tiền không hợp lệ" });
  const st = statementOf(cust, orderFees());
  if (kind === "payout" && amount > st.available)
    throw new Conflict(st.available > 0 ? `Chỉ chi trả được tối đa ${money(st.available)} (phần tiền thu hộ đã đối soát)` : `Khách chưa có tiền có thể rút (số dư khả dụng ${money(st.available)})`);
  if (kind === "collect" && st.balance >= 0)
    throw new Conflict(`Khách không nợ: số dư hiện là ${money(st.balance)}`);
  if (kind === "collect" && amount > -st.balance)
    throw new Conflict(`Khách chỉ nợ ${money(-st.balance)}`);
  const tx = { kind, customer: cust, amount, at: nowSeconds(), by: S.me.username, method: str(r, "method", "bank"), ref: trimmed(str(r, "ref")), note: trimmed(str(r, "note")) };
  const { error } = S.ledger.add(tx);
  if (error)
    throw new Invalid(error, { [blen(tx.ref) < 3 && tx.method === "bank" ? "ref" : "note"]: error });
  mark(D_LEDGER);
  const what = kind === "payout" ? `Đã chi trả ${money(amount)} cho ${ownerDisplay(cust)}` : `Đã ghi nhận ${ownerDisplay(cust)} nộp bù ${money(amount)}`;
  audit("wallet." + kind, cust, `${money(amount)} ${tx.method}` + (tx.ref ? " " + tx.ref : ""));
  notify(cust, "wallet", 0, kind === "payout" ? `Bạn vừa được chi trả ${money(amount)}` + (tx.method === "bank" ? ` (chuyển khoản ${tx.ref})` : " (tiền mặt)") : `Đã nhận khoản nộp bù ${money(amount)}. Cảm ơn bạn!`);
  return { ...walletJson(cust), message: what };
}
// Bồi thường khiếu nại vào ví đối soát. Mỗi khiếu nại bồi thường một lần, có trần theo loại.
var compensationCapOf = (o, kind) => compensationCap(kind, o.declaredValue, orderTotal(o, feeFor(o)), CONFIG.compMultiplier);
function compensationBlock(o, kind) {
  if (kind === "late") {
    if (o.status !== DELIVERED || o.deadline < 0 || o.deliveredAt <= o.deadline + 0.000000001)
      return "Đơn không giao trễ hạn nên không bồi thường trễ hạn";
  } else if (kind === "damaged" || kind === "lost") {
    if (o.status !== ASSIGNED && o.status !== DELIVERED && o.status !== FAILED && o.status !== RETURNED)
      return `Hàng chưa rời kho (đơn đang '${orderStatusName(o.status)}') nên chưa thể hư hỏng / thất lạc`;
  } else if (kind !== "other")
    return "Loại bồi thường không hợp lệ";
  return "";
}
function compensate(r) {
  const id = integer(r, "id");
  const c = S.complaints.find(id);
  if (!c)
    throw new BadRequest(`Không có khiếu nại ${id}`);
  if (S.ledger.ofComplaint(id))
    throw new Conflict(`Khiếu nại #${id} đã được bồi thường`);
  const o = findOrderById(c.order);
  if (!o)
    throw new Conflict(`Đơn #${c.order} của khiếu nại không còn trong hệ thống`);
  if (o.owner !== c.owner)
    throw new Conflict(`Đơn #${o.id} không còn thuộc khách gửi khiếu nại`);
  const kind = str(r, "kind");
  const block = compensationBlock(o, kind);
  if (block)
    throw new Invalid(block, { kind: block });
  const cap = compensationCapOf(o, kind);
  const amount = num(r, "amount", 0);
  if (!(amount > 0) || Math.floor(amount) !== amount)
    throw new Invalid("Số tiền bồi thường phải là số nguyên lớn hơn 0", { amount: "Số tiền không hợp lệ" });
  if (amount > cap)
    throw new Invalid(`Bồi thường ${compensationKindName(kind)} tối đa ${money(cap)}`, { amount: `Tối đa ${money(cap)}` });
  const note = trimmed(str(r, "note"));
  const tx = { kind: "comp", customer: c.owner, amount, at: nowSeconds(), by: S.me.username, order: o.id, complaint: id, note: compensationKindName(kind) + (note ? ": " + note : "") };
  const { error } = S.ledger.add(tx);
  if (error)
    throw new Invalid(error, { note: error });
  mark(D_LEDGER);
  if (!S.complaints.addMessage(id, S.me.username, roleKey(S.me.role), `Đã bồi thường ${money(tx.amount)} vào ví đối soát (${tx.note})`, tx.at))
    mark(D_COMPL);
  audit("complaint.compensate", String(id), `${money(tx.amount)} ${kind}, đơn ${o.id}`);
  notify(c.owner, "wallet", o.id, `Khiếu nại #${id}: bạn được bồi thường ${money(tx.amount)} vào ví đối soát`);
  return { ok: true, complaint: complaintJson(S.complaints.find(id), true), message: `Đã bồi thường ${money(tx.amount)} cho khiếu nại #${id}` };
}
function complaintJson(c, withMessages) {
  const j = { id: c.id, owner: c.owner, ownerName: ownerDisplay(c.owner), order: c.order, title: c.title, status: c.status, statusName: complaintStatusName(c.status), created: c.created, updated: c.updated, assignee: c.assignee, messageCount: c.msgs.length };
  const comp = S.ledger.ofComplaint(c.id);
  j.compensation = comp ? { amount: comp.amount, note: comp.note, by: comp.by, at: comp.at } : null;
  if (withMessages && isStaff() && !comp) {
    const o = findOrderById(c.order);
    if (o) {
      const caps = {};
      for (const k of ["late", "damaged", "lost", "other"])
        caps[k] = compensationBlock(o, k) ? null : compensationCapOf(o, k);
      j.compCaps = caps;
      j.orderValue = o.declaredValue;
    }
  }
  if (withMessages)
    j.messages = c.msgs.map((m) => ({ at: m.at, author: m.author, authorName: ownerDisplay(m.author), role: m.role, text: m.text }));
  return j;
}
function complaintForActor(id) {
  const c = S.complaints.find(id);
  if (!c && !isCustomer())
    throw new BadRequest(`Không có khiếu nại ${id}`);
  if (!c || isCustomer() && c.owner !== S.me.username)
    throw new Forbidden("Khiếu nại này không phải của bạn");
  return c;
}
function complaintsListJson(r) {
  let rows = S.complaints.all().filter((c) => isStaff() || c.owner === S.me.username);
  const byStatus = new Map;
  for (const c of rows)
    byStatus.set(c.status, (byStatus.get(c.status) || 0) + 1);
  const st = lowerCopy(trimmed(str(r, "status")));
  if (st)
    rows = rows.filter((c) => c.status === st);
  const q = trimmed(str(r, "q"));
  if (q) {
    const idx = new TextIndex;
    rows.forEach((c, i) => idx.add(i, `${c.id} ${c.order} ${c.title} ${c.owner} ${ownerDisplay(c.owner)}`));
    const hit = new Set(idx.search(q));
    rows = rows.filter((_, i) => hit.has(i));
  }
  const key = sortKey(r, ["updated", "created", "status", "id"], "updated");
  stableSort(rows, (a, b) => key === "created" ? a.created - b.created : key === "status" ? byteCompare(a.status, b.status) : key === "id" ? a.id - b.id : a.updated - b.updated, sortDesc(r, true));
  const p = paginate(r, rows.length);
  return { ok: true, complaints: rows.slice(p.begin, p.end).map((c) => complaintJson(c, false)), page: pageJson(p), byStatus: Object.fromEntries([...byStatus.entries()].sort((x, y) => byteCompare(x[0], y[0]))) };
}
// ------------------------------------------------------------ Thông báo
function notificationsJson(r) {
  const unreadOnly = flag(r, "unread");
  const limit = clamp(integer(r, "limit", 30), 1, 100);
  const notifications = S.notes.of(S.me.username, unreadOnly).slice(0, limit).map((x) => ({ id: x.id, at: x.at, read: x.read, kind: x.kind, order: x.order, text: x.text }));
  return { ok: true, notifications, unread: S.notes.unread(S.me.username) };
}
// ------------------------------------------------------------ Cấu hình
// Đọc trường thứ k của "a:b:c" như std::getline: thất bại khi đã hết chuỗi mà chưa đọc được gì
var getlineOk = (parts, k) => parts.length > k + 1 || parts.length === k + 1 && parts[k] !== "";
function updateConfig(r) {
  const cfg = Object.assign(new Config, CONFIG, { tiers: CONFIG.tiers.map((x) => ({ ...x })) });
  const t = { ...TARIFF };
  const setNum = (k, obj, f) => {
    if (has(r, k) && str(r, k))
      obj[f] = num(r, k);
  };
  for (const f of ["firstKm", "firstFee", "perKm", "freeKg", "perKg", "urgent", "codRate", "codMin", "returnRate"])
    setNum(f, t, f);
  for (const f of ["cancelDispatched", "cancelOnRoute", "shipperShare"])
    setNum(f, cfg, f);
  if (has(r, "maxOpenOrders"))
    cfg.maxOpenOrders = integer(r, "maxOpenOrders");
  for (const f of ["insRate", "compMultiplier"])
    setNum(f, cfg, f);
  if (has(r, "insThreshold") && str(r, "insThreshold"))
    cfg.insThreshold = Math.trunc(num(r, "insThreshold"));
  if (has(r, "volDivisor") && str(r, "volDivisor"))
    cfg.volDivisor = integer(r, "volDivisor");
  if (has(r, "debtLimit") && str(r, "debtLimit"))
    cfg.debtLimit = Math.trunc(num(r, "debtLimit"));
  if (has(r, "scoreAware"))
    cfg.scoreAware = flag(r, "scoreAware");
  if (has(r, "autoDeliver"))
    cfg.autoDeliver = flag(r, "autoDeliver");
  if (has(r, "autoMatch"))
    cfg.autoMatch = flag(r, "autoMatch");
  if (has(r, "offerSeconds"))
    cfg.offerSeconds = integer(r, "offerSeconds");
  if (has(r, "matchGiveUp"))
    cfg.matchGiveUp = integer(r, "matchGiveUp");
  if (has(r, "clockSpeed"))
    cfg.clockSpeed = num(r, "clockSpeed");
  if (has(r, "tiers")) {
    // "Đồng:0:0,Bạc:5:0.03,..." (tên:số đơn tối thiểu:phần trăm giảm dạng thập phân)
    const items = str(r, "tiers").split(",");
    if (items.length && items[items.length - 1] === "")
      items.pop();
    const tiers = [];
    for (const item of items) {
      const parts = item.split(":");
      if (!getlineOk(parts, 0) || !getlineOk(parts, 1) || !getlineOk(parts, 2))
        throw new BadRequest("Hạng thân thiết phải có dạng tên:số đơn:phần trăm");
      const x = { name: trimmed(parts[0]), minDone: 0, pct: 0 };
      try {
        x.minDone = cppStoll(parts[1]);
        x.pct = cppStod(parts[2]);
      } catch {
        throw new BadRequest("Số liệu hạng thân thiết không hợp lệ");
      }
      tiers.push(x);
    }
    cfg.tiers = tiers;
  }
  let e = checkTariff(t);
  if (!e)
    e = cfg.check();
  if (e)
    throw new BadRequest(e);
  Object.assign(CONFIG, cfg);
  Object.assign(TARIFF, t);
  mark(D_CONFIG);
  audit("config.update", "config", "biểu phí / hạng / quy tắc");
  matchPending();
  // vừa bật ghép tự động: các đơn đang chờ được mời ngay
  return { ...configJson(), ok: true, message: "Đã lưu cấu hình" };
}
// ------------------------------------------------------------ Báo cáo theo vai trò
// Việc cần xử lý của nhân viên: mức độ (danger / warn / info), số lượng, mã ví dụ và trang cần mở
function alertsJson(fees) {
  const now = nowSeconds();
  const arr = [];
  const add = (level, kind, text, ids, view) => {
    if (!ids.length)
      return;
    arr.push({ level, kind, count: ids.length, text, ids: kind === "debt" ? [] : ids.slice(0, 5), view });
  };
  let cap = 0;
  S.shippers.forEach((s, i) => {
    if (!S.shift.isAbsent(i))
      cap = Math.max(cap, s.capacity);
  });
  const lateRisk = [], stale = [], failed = [], urgent = [], heavy = [];
  for (const o of S.orders) {
    if (o.status === ASSIGNED && o.deadline >= 0 && o.eta > o.deadline + 0.000000001)
      lateRisk.push(o.id);
    if (o.status === CREATED && o.createdAt > 0 && now - o.createdAt > 30 * 60)
      stale.push(o.id);
    if (o.status === FAILED)
      failed.push(o.id);
    if (o.status === PENDING && o.urgent)
      urgent.push(o.id);
    if (o.status === PENDING && cap > 0 && o.weight > cap + 0.000000001)
      heavy.push(o.id);
  }
  const waitingTrips = S.shift.trips.filter((t) => !t.accepted).map((t) => t.id);
  const remits = S.cod.remits.filter((m) => m.state === "submitted").map((m) => m.id);
  const oldComplaints = S.complaints.all().filter((c) => c.status !== "resolved" && now - c.created > 24 * 3600).map((c) => c.id);
  const debtors = [];
  let idx = 0;
  for (const a of S.accounts.all()) {
    if (a.role !== CUSTOMER)
      continue;
    ++idx;
    if (statementOf(a.username, fees).balance < 0)
      debtors.push(idx);
  }
  add("danger", "late", "đơn đang giao dự kiến trễ hạn", lateRisk, "tracking");
  add("warn", "failed", "đơn giao thất bại chờ quyết định giao lại / hoàn kho", failed, "queue");
  add("warn", "stale", "đơn mới chờ xác nhận quá 30 phút", stale, "queue");
  add("warn", "heavy", "đơn nặng hơn mọi xe đang có mặt, cần chia kiện", heavy, "queue");
  add("info", "urgent", "đơn hoả tốc đang chờ điều phối", urgent, "dispatch");
  add("info", "trips", "chuyến chờ shipper nhận", waitingTrips, "tracking");
  add("info", "remit", "phiếu nộp COD chờ đối soát", remits, "cod");
  add("warn", "complaints", "khiếu nại mở quá 24 giờ", oldComplaints, "complaints");
  add("info", "debt", "khách hàng đang nợ phí (số dư âm)", debtors, "wallet");
  return arr;
}
// Doanh thu 14 ngày gần nhất theo ngày giao xong (giờ Việt Nam, UTC+7)
function dailyJson(fees) {
  const DAY = 86400, TZ = 7 * 3600;
  const today = Math.floor((nowSeconds() + TZ) / DAY);
  const by = new Map;
  S.orders.forEach((o, i) => {
    if (o.status !== DELIVERED || o.deliveredReal <= 0)
      return;
    const d = Math.floor((o.deliveredReal + TZ) / DAY);
    if (d <= today - 14 || d > today)
      return;
    const v = by.get(d) || [0, 0, 0];
    v[0] += 1;
    v[1] += orderTotal(o, fees[i]);
    v[2] += o.cod;
    by.set(d, v);
  });
  const arr = [];
  for (let d = today - 13;d <= today; ++d) {
    const v = by.get(d) || [0, 0, 0];
    arr.push({ day: d * DAY - TZ, delivered: v[0], revenue: v[1], cod: v[2] });
  }
  return arr;
}
function reportJson() {
  const fees = orderFees();
  const j = { ok: true, role: roleKey(S.me.role) };
  const byStatus = new Map;
  let revenue = 0, discounts = 0, cancelFees = 0, codTotal = 0, late = 0, deliveredCount = 0, insurance = 0, returnFees = 0;
  S.orders.forEach((o, i) => {
    if (isCustomer() && o.owner !== S.me.username)
      return;
    if (isShipper() && !shipperSees(o, myShipperIndex()))
      return;
    byStatus.set(o.status, (byStatus.get(o.status) || 0) + 1);
    if (o.status === DELIVERED) {
      ++deliveredCount;
      revenue += orderTotal(o, fees[i]);
      insurance += o.insuranceFee;
      discounts += o.loyaltyDiscount + o.promoDiscount;
      codTotal += o.cod;
      if (o.deadline >= 0 && o.deliveredAt > o.deadline + 0.000000001)
        ++late;
    }
    cancelFees += o.cancelFee;
    returnFees += o.returnFee;
  });
  const statuses = [...byStatus.keys()].sort((a, b) => a - b);
  j.byStatus = Object.fromEntries(statuses.map((s) => [orderStatusName(s), byStatus.get(s)]));
  j.delivered = deliveredCount;
  j.late = late;
  j.onTimeRate = deliveredCount ? 100 * (deliveredCount - late) / deliveredCount : 100;
  if (isCustomer()) {
    Object.assign(j, { spent: revenue, saved: discounts, tier: tierJson(S.me.done), orders: S.orders.filter((o) => o.owner === S.me.username).length, wallet: statementSummary(statementOf(S.me.username, fees)) });
  } else if (isShipper()) {
    j.stats = shipperStatsJson(S.me.link);
  } else {
    j.open = statuses.reduce((s, k) => s + (isOpenStatus(k) ? byStatus.get(k) : 0), 0);
    j.complaintsOpen = S.complaints.all().filter((c) => c.status !== "resolved").length;
    let held = 0, awaiting = 0;
    for (const s of S.shippers) {
      held += S.cod.held(s.name);
      awaiting += S.cod.awaiting(s.name);
    }
    j.codHeld = held;
    j.codAwaiting = awaiting;
    j.shippers = S.shippers.map((s, i) => {
      const st = S.stats.get(s.name);
      return { name: s.name, delivered: st.delivered, failed: st.failed, declines: st.declines, score: shipperScore(s.name), income: st.income, ready: shipperReady(i) };
    });
    j.alerts = alertsJson(fees);
    if (isAdmin()) {
      Object.assign(j, { revenue, discounts, cancelFees, codTotal, insurance, returnFees, daily: dailyJson(fees) });
      const rc = new Map, sc = new Map;
      for (const a of S.accounts.all()) {
        rc.set(roleKey(a.role), (rc.get(roleKey(a.role)) || 0) + 1);
        sc.set(statusKey(a.status), (sc.get(statusKey(a.status)) || 0) + 1);
      }
      const sorted = (m) => Object.fromEntries([...m.entries()].sort((x, y) => byteCompare(x[0], y[0])));
      j.users = { byRole: sorted(rc), byStatus: sorted(sc) };
      const top = S.accounts.all().filter((a) => a.role === CUSTOMER && a.done > 0).map((a) => ({ spent: a.spent, name: a.displayName }));
      top.sort((a, b) => b.spent !== a.spent ? b.spent - a.spent : byteCompare(b.name, a.name));
      j.topCustomers = top.slice(0, 5).map((x) => ({ name: x.name, spent: x.spent }));
      j.promos = S.promos.all().map((p) => ({ code: p.code, used: p.used, maxUses: p.maxUses }));
    }
  }
  return j;
}
// ------------------------------------------------------------ Đăng ký các tuyến
var auditRows = (r) => S.audit.filter(trimmed(str(r, "actor")), trimmed(str(r, "action")), trimmed(str(r, "target")), Math.trunc(num(r, "from", 0)), Math.trunc(num(r, "to", 0)));
POST("order/add", (r) => createOrder(r));
// Tạo đơn mẫu ngẫu nhiên tại các điểm kho tới được. Xoá hết đơn hiện có.
POST("orders/random", (r) => {
  if (!S.graph.hasNode(S.depot))
    throw new BadRequest("Chưa chọn kho");
  const count = clamp(integer(r, "count", 8), 1, 15);
  if (S.shift.active())
    S.shift.reset(S.orders, true);
  const cand = bfs(S.graph, S.depot).filter((id) => id !== S.depot);
  if (!cand.length)
    throw new BadRequest("Kho chưa nối với điểm nào");
  for (let i = cand.length - 1;i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cand[i], cand[j]] = [cand[j], cand[i]];
  }
  const notes = ["Tài liệu", "Đồ ăn", "Quần áo", "Điện thoại", "Sách", "Thuốc", "Hoa tươi", "Linh kiện"];
  const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  S.orders = [];
  for (let i = 0;i < count; i++) {
    const urgent = ri(0, 3) === 0;
    S.orders.push({
      ...newOrder(),
      id: 101 + i,
      destination: cand[i % cand.length],
      weight: Math.round((0.5 + Math.random() * 11.5) * 10) / 10,
      urgent,
      deadline: urgent || ri(0, 2) === 0 ? ri(3, 12) * 10 : -1,
      note: notes[i % 8],
      createdAt: nowSeconds(),
      createdBy: S.me.username
    });
  }
  ensureDeliveryCodes();
  mark(D_ORDERS);
  audit("orders.random", "orders", `${count} đơn`);
  return stateJson();
});
POST("order/update", (r) => updateOrder(r));
POST("order/remove", (r) => removeOrder(r));
POST("order/confirm", (r) => confirmOrder(r));
POST("order/reject", (r) => rejectOrder(r));
POST("order/cancel", (r) => cancelOrder(r));
POST("shift/cancel", (r) => cancelOrder(r));
POST("order/deliver", (r) => deliverOrder(r));
POST("order/rate", (r) => rateOrder(r));
POST("order/rate-customer", (r) => rateCustomer(r));
POST("order/retry", (r) => retryOrder(r));
POST("order/release", (r) => releaseOrder(r));
POST("shift/fail", (r) => failOrder(r));
POST("shift/requeue", (r) => requeueOrder(r));
POST("shift/return", (r) => returnOrder(r));
// Khách tự phục vụ (cùng xử lý với bản của nhân viên, orderForActor chặn đơn của người khác)
POST("order/edit", (r) => updateOrder(r));
POST("order/redeliver", (r) => requeueOrder(r));
POST("order/return", (r) => returnOrder(r));
GET("orders/list", (r) => ordersListJson(r));
GET("order/get", (r) => {
  const o = orderForActor(integer(r, "id"));
  return orderDetailJson(o, S.orders.indexOf(o));
});
GET("order/invoice", (r) => ({ ok: true, invoice: invoiceJson(orderForActor(integer(r, "id"))) }));
GET("track", (r) => trackOrder(r));
GET("public/info", () => publicInfo());
GET("quote", (r) => quoteHandler(r));
GET("promos", () => promosJson());
POST("promos/save", (r) => savePromo(r));
POST("promos/remove", (r) => {
  const code = normalizeCode(str(r, "code"));
  const e = S.promos.remove(code);
  if (e)
    throw new BadRequest(e);
  mark(D_PROMOS);
  audit("promo.remove", code);
  return { ...promosJson(), message: "Đã xoá mã " + code };
});
GET("dispatch", (r) => dispatchPreview(r));
POST("dispatch/apply", (r) => dispatchApply(r));
POST("trip/accept", (r) => acceptTrip(r));
POST("trip/decline", (r) => declineTrip(r));
POST("trip/recall", (r) => recallTrip(r));
POST("dispatch/assign", (r) => dispatchAssign(r));
POST("shift/progress", (r) => shiftProgress(r));
POST("shift/absent", (r) => shiftAbsent(r));
GET("cod", (r) => codJson(r));
POST("cod/remit", (r) => {
  const handed = num(r, "handed", S.cod.held(S.me.link));
  if (handed < 0 || Math.floor(handed) !== handed)
    throw new Invalid("Số tiền nộp phải là số nguyên không âm", { handed: "Số tiền không hợp lệ" });
  const held = S.cod.held(S.me.link);
  const { error, id } = S.cod.remit(S.me.link, handed, nowSeconds());
  if (error)
    throw new Conflict(error);
  mark(D_COD);
  const diff = handed - held;
  audit("cod.remit", String(id), money(handed) + (diff ? ", chênh " + money(diff) : ""));
  notifyStaff("cod", 0, `${S.me.link} nộp thu hộ ${money(handed)}` + (diff ? ` (chênh lệch ${money(diff)})` : "") + ", chờ xác nhận");
  return { ...codJson(r), message: `Đã nộp ${money(handed)}, chờ quản trị viên xác nhận` };
});
POST("cod/confirm", (r) => {
  const id = integer(r, "remit");
  const m = S.cod.findRemit(id);
  if (!m)
    throw new BadRequest(`Không có phiếu nộp ${id}`);
  const counted = num(r, "counted");
  if (counted < 0 || Math.floor(counted) !== counted)
    throw new Invalid("Số tiền đếm được phải là số nguyên không âm", { counted: "Số tiền không hợp lệ" });
  const note = trimmed(str(r, "note"));
  const shipper = m.shipper;
  const e = S.cod.confirm(id, counted, S.me.username, note, nowSeconds());
  if (e)
    throw new Conflict(e);
  mark(D_COD);
  const diff = remitDiff(S.cod.findRemit(id));
  audit("cod.confirm", String(id), "đếm " + money(counted) + (diff ? ", chênh " + money(diff) : ", khớp"));
  notify(accountOfShipper(shipper), "cod", 0, `Phiếu nộp #${id} đã đối soát` + (diff ? ", chênh lệch " + money(diff) : ", khớp số tiền"));
  return { ...codJson(r), message: diff ? "Đã đối soát, chênh lệch " + money(diff) : "Đã đối soát, khớp số tiền" };
});
POST("cod/close", (r) => {
  const name = trimmed(str(r, "shipper"));
  if (shipperIndexByName(name) < 0)
    throw new BadRequest("Chọn một shipper trong đội xe");
  const { error, id } = S.cod.close(name, S.me.username, nowSeconds());
  if (error)
    throw new Conflict(error);
  mark(D_COD);
  audit("cod.close", name, `ca #${id}`);
  notify(accountOfShipper(name), "cod", 0, `Ca của bạn đã được chốt (#${id})`);
  return { ...codJson(r), message: "Đã chốt ca của " + name };
});
GET("complaints", (r) => {
  const id = integer(r, "id", 0);
  if (id > 0)
    return { ok: true, complaint: complaintJson(complaintForActor(id), true) };
  return complaintsListJson(r);
});
POST("complaint/add", (r) => {
  const o = orderForActor(integer(r, "order"));
  const { error, id } = S.complaints.create(S.me.username, o.id, trimmed(str(r, "title")), trimmed(str(r, "body")), nowSeconds());
  if (error)
    throw new Invalid(error, { body: error });
  mark(D_COMPL);
  audit("complaint.add", String(id), "đơn " + o.id);
  notifyStaff("complaint", o.id, `Khiếu nại mới #${id} về đơn #${o.id}`);
  return { ok: true, id, complaint: complaintJson(S.complaints.find(id), true), message: "Đã gửi khiếu nại" };
});
POST("complaint/message", (r) => {
  const id = integer(r, "id");
  const c = complaintForActor(id);
  const owner = c.owner;
  const e = S.complaints.addMessage(id, S.me.username, roleKey(S.me.role), trimmed(str(r, "text")), nowSeconds());
  if (e)
    throw new Conflict(e);
  mark(D_COMPL);
  if (isStaff())
    notify(owner, "complaint", c.order, `Khiếu nại #${id} có phản hồi mới`);
  else
    notifyStaff("complaint", c.order, `Khách trả lời khiếu nại #${id}`);
  return { ok: true, complaint: complaintJson(S.complaints.find(id), true) };
});
POST("complaint/compensate", (r) => compensate(r));
GET("wallet", (r) => {
  if (isCustomer())
    return walletJson(S.me.username);
  const cust = lowerCopy(trimmed(str(r, "customer")));
  customerAccount(cust);
  return walletJson(cust);
});
GET("wallets", () => walletsJson());
POST("wallet/payout", (r) => walletPayout(r));
POST("complaint/status", (r) => {
  const id = integer(r, "id");
  const c = S.complaints.find(id);
  if (!c)
    throw new BadRequest(`Không có khiếu nại ${id}`);
  const to = lowerCopy(str(r, "status"));
  const e = S.complaints.setStatus(id, to, S.me.username, nowSeconds());
  if (e)
    throw new Conflict(e);
  mark(D_COMPL);
  audit("complaint.status", String(id), to);
  notify(c.owner, "complaint", c.order, `Khiếu nại #${id}: ${complaintStatusName(to)}`);
  return { ok: true, complaint: complaintJson(S.complaints.find(id), true) };
});
GET("notifications", (r) => notificationsJson(r));
POST("notifications/read", (r) => {
  if (!S.notes.markRead(S.me.username, integer(r, "id")))
    throw new BadRequest("Không có thông báo này");
  mark(D_NOTES);
  return { ok: true, unread: S.notes.unread(S.me.username) };
});
POST("notifications/read-all", () => {
  S.notes.markAllRead(S.me.username);
  mark(D_NOTES);
  return { ok: true, unread: 0 };
});
GET("config", () => ({ ...configJson(), ok: true }));
POST("config/update", (r) => updateConfig(r));
GET("audit", (r) => {
  const rows = auditRows(r);
  const p = paginate(r, rows.length, 20);
  return { ok: true, entries: rows.slice(p.begin, p.end).map((e) => ({ id: e.id, at: e.at, actor: e.actor, role: e.role, action: e.action, target: e.target, detail: e.detail })), page: pageJson(p) };
});
// Tải CSV đi qua exportText ở 09-main.js; đăng ký ở đây để khớp bảng phân quyền
GET("audit/export", (r) => {
  audit("audit.export", "audit");
  return { ok: true, text: AuditLog.csv(auditRows(r)) };
});
DOWNLOADS["audit/export"] = (r) => {
  audit("audit.export", "audit");
  return AuditLog.csv(auditRows(r));
};
GET("reports/summary", () => reportJson());
