// Bản JavaScript của src/WebServer.cpp: trạng thái app, kiểm tra quyền, các hàm dựng JSON và API bản đồ / thuật toán.
// API tài khoản ở 08b-account.js (WebAccount.inc), API đơn hàng ở 08c-orders.js (WebOrders.inc), khởi động ở 09-main.js.
//
// Khác bản C++ (xem mục "Giả định" trong README):
//   - "Ổ đĩa" là localStorage của trình duyệt: mỗi file data/*.txt là một khoá "dt08.f.<tên file>", chưa có thì dùng dữ liệu mẫu nhúng sẵn.
//   - Không có cookie: mã phiên giữ ở localStorage (Ghi nhớ đăng nhập) hoặc sessionStorage; bảng phiên lưu ở localStorage.
//   - Không có yêu cầu từ trang khác nên bỏ qua kiểm tra Origin và mã CSRF (vẫn cấp mã CSRF để giao diện dùng chung).
var LS_PREFIX = "dt08.f.";
var LS_SESSIONS = "dt08.sessions";
var TOKEN_KEY = "dt08.token";
var lsGet = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
var lsSet = (k, v) => {
  try {
    if (v == null)
      localStorage.removeItem(k);
    else
      localStorage.setItem(k, v);
    return true;
  } catch {
    return false;
  }
};
var ssGet = (k) => {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
};
var ssSet = (k, v) => {
  try {
    if (v == null)
      sessionStorage.removeItem(k);
    else
      sessionStorage.setItem(k, v);
  } catch {}
};
// Đọc một "file" dữ liệu: bản đã ghi trong trình duyệt, nếu chưa có thì bản mẫu nhúng trong file HTML
var fileText = (name) => {
  const v = lsGet(LS_PREFIX + name);
  return v != null ? v : DATA[name] ?? null;
};
var fileExists = (name) => fileText(name) != null;
function writeDataFile(name, text) {
  if (!lsSet(LS_PREFIX + name, text))
    console.warn(`[Canh bao] Khong ghi duoc ${name} vao trinh duyet (het dung luong hoac che do an danh)`);
}
var DATASETS = [
  { key: "hcm", title: "Nội thành TP.HCM", description: "14 điểm, đường hai chiều. Có đường cấm xe tải, cao tốc cấm xe máy và cụm Cần Giờ chưa có tuyến nối.", mapFile: "map.txt", ordersFile: "orders.txt" },
  { key: "oneway", title: "Quận 1: đường một chiều", description: "Đồ thị có hướng, một số tuyến đối tác trợ giá nên chi phí âm. Dijkstra sẽ cho kết quả sai, cần Bellman-Ford.", mapFile: "map_oneway.txt", ordersFile: "orders_oneway.txt" },
  { key: "negcycle", title: "Dữ liệu lỗi: chu trình âm", description: "Ba tuyến khuyến mãi chồng nhau tạo vòng lặp có tổng chi phí âm. Dùng để kiểm tra Bellman-Ford.", mapFile: "map_negcycle.txt", ordersFile: "" },
  { key: "city", title: "Đô thị mô phỏng (2.000 điểm)", description: "Lưới 2.000 giao lộ, sông phía đông chỉ qua được ở 5 cây cầu, vành đai cấm xe máy, trung tâm cấm xe tải. Dùng để thử thuật toán trên đồ thị lớn: so A* với Dijkstra, điều phối 24 đơn.", mapFile: "map_city.txt", ordersFile: "orders_city.txt" },
  { key: "saved", title: "Bản đồ đã lưu", description: "Bản đồ và đơn hàng bạn đã lưu bằng nút Lưu (lưu trong trình duyệt này).", mapFile: "my_map.txt", ordersFile: "my_orders.txt" }
];
// ============================== Trạng thái app ==============================
var S = {
  graph: new Graph,
  orders: [],
  shippers: [],
  depot: 0,
  dataset: "",
  shiftStart: 8 * 60,
  rush: new RushProfile,
  shift: new ShiftManager,
  history: new UndoRedo(30),
  index: new PlaceIndex,
  indexDirty: true,
  notice: "",
  // Đăng nhập & phân quyền
  accounts: new AccountStore,
  sessions: new SessionStore,
  guard: new LoginGuard,
  me: null,
  authed: false,
  token: "",
  clientToken: "",
  setCookie: null,
  csrf: "",
  ip: "local",
  device: "",
  // Thương mại, hỗ trợ, sổ COD
  promos: new PromoStore,
  addresses: new AddressBook,
  reviews: new ReviewStore,
  custReviews: new ReviewStore,
  // shipper đánh giá khách (đánh giá hai chiều)
  stats: new StatsStore,
  notes: new NotificationStore,
  audit: new AuditLog,
  mailbox: new Mailbox,
  complaints: new ComplaintStore,
  cod: new CodLedger,
  ledger: new CustomerLedger,
  resets: new ResetStore,
  limiter: new RateLimiter,
  demo: true,
  dirty: 0,
  rev: 0,
  // tăng mỗi khi dữ liệu đổi: giao diện hỏi nhẹ (api/me) rồi mới tải lại state
  lastTick: 0,
  lastMatch: 0
  // giây (đồng hồ thật) lần chạy đồng hồ ca / ghép đơn gần nhất
};
// Lỗi trả về giao diện: status là mã HTTP tương ứng của bản C++
class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
    this.fields = null;
    this.retryAfter = 0;
  }
}

class BadRequest extends HttpError {
  constructor(m) {
    super(m, 400);
  }
}

class Invalid extends BadRequest {
  constructor(m, fields) {
    super(m);
    this.fields = fields;
  }
}

class Forbidden extends HttpError {
  constructor(m) {
    super(m, 403);
  }
}

class Conflict extends HttpError {
  constructor(m) {
    super(m, 409);
  }
}

class Unauthorized extends HttpError {
  constructor(m) {
    super(m, 401);
  }
}

class TooMany extends HttpError {
  constructor(m, wait) {
    super(m, 429);
    this.retryAfter = wait;
  }
}

class NeedLogin extends HttpError {
  constructor(m) {
    super(m, 401);
    this.auth = true;
  }
}
var D_USERS = 1, D_PROMOS = 2, D_ADDR = 4, D_REVIEWS = 8, D_STATS = 16, D_NOTES = 32, D_AUDIT = 64, D_COMPL = 128, D_COD = 256, D_CONFIG = 512, D_ORDERS = 1024, D_FLEET = 2048, D_LEDGER = 4096, D_CREVIEWS = 8192;
var mark = (bits) => {
  S.dirty |= bits;
  ++S.rev;
};
var nowSeconds = () => Math.floor(Date.now() / 1000);
// "Chrome trên Windows"... đủ để người dùng nhận ra thiết bị trong danh sách phiên
function deviceName(ua) {
  const has2 = (x) => ua.includes(x);
  const browser = has2("Edg/") ? "Edge" : has2("Firefox/") ? "Firefox" : has2("Chrome/") ? "Chrome" : has2("Safari/") ? "Safari" : !ua ? "Ứng dụng dòng lệnh" : "Trình duyệt khác";
  const os = has2("Windows") ? "Windows" : has2("Android") ? "Android" : has2("iPhone") || has2("iPad") ? "iOS" : has2("Mac OS") ? "macOS" : has2("Linux") ? "Linux" : "";
  return os ? `${browser} trên ${os}` : browser;
}
// Xác định tài khoản của yêu cầu và kiểm tra quyền (401 chưa đăng nhập, 403 vai trò không có quyền)
function authorize(method, path) {
  S.authed = false;
  S.me = null;
  S.setCookie = null;
  S.csrf = "";
  S.ip = "local";
  S.device = deviceName(typeof navigator !== "undefined" ? navigator.userAgent || "" : "");
  S.token = S.clientToken;
  if (S.token) {
    const user = S.sessions.resolve(S.token, nowSeconds());
    const a = user ? S.accounts.find(user) : null;
    if (a && a.status === ACC_ACTIVE) {
      S.me = { ...a };
      S.authed = true;
      S.csrf = S.sessions.csrf(S.token);
    } else if (a)
      S.sessions.remove(S.token);
  }
  if (!isPublic(method, path)) {
    if (!S.authed)
      throw new NeedLogin("Bạn cần đăng nhập để dùng chức năng này");
    if (!canAccess(S.me.role, method, path))
      throw new Forbidden(`Tài khoản ${roleName(S.me.role)} không có quyền dùng chức năng này`);
  }
}
var isAdmin = () => S.authed && S.me.role === ADMIN;
var isStaff = () => isAdmin();
// nhân viên vận hành = quản trị viên (đã bỏ vai trò điều phối viên)
var isShipper = () => S.authed && S.me.role === SHIPPER;
var isCustomer = () => S.authed && S.me.role === CUSTOMER;
var actorBit = () => S.authed ? roleBit(S.me.role) : B_GUEST;
// ----------------------------------------------------- Nhật ký kiểm toán & thông báo
var actorLabel = () => S.authed ? S.me.username : "(khách)";
function audit(action, target, detail = "") {
  S.audit.add(actorLabel(), S.authed ? roleKey(S.me.role) : "guest", action, target, detail, nowSeconds());
  mark(D_AUDIT);
}
function notify(user, kind, order, text) {
  if (!user || !S.accounts.find(user))
    return;
  S.notes.add(user, kind, order, text, nowSeconds());
  mark(D_NOTES);
}
function notifyStaff(kind, order, text) {
  for (const a of S.accounts.all())
    if (a.role === ADMIN && a.status === ACC_ACTIVE)
      notify(a.username, kind, order, text);
}
var nodeName = (id) => S.graph.hasNode(id) ? S.graph.getNode(id).name : "#" + id;
function fixDepot() {
  if (!S.graph.hasNode(S.depot)) {
    const ids = S.graph.nodeIds();
    S.depot = ids.length ? ids[0] : -1;
  }
}
var cloneOrders = (os) => os.map((o) => ({ ...o }));
var snapshot = () => ({ graph: S.graph.clone(), orders: cloneOrders(S.orders), depot: S.depot, dataset: S.dataset });
function commitMap(before, label, resetShift) {
  S.history.record(before, label);
  mapChanged(resetShift);
}
// Thay đổi làm sai lộ trình đã giao (xoá điểm/đường, đổi kho...) thì huỷ ca giao đang chạy
function mapChanged(resetShift) {
  S.indexDirty = true;
  mark(D_ORDERS);
  if (resetShift && S.shift.active()) {
    S.shift.reset(S.orders, true);
    S.notice = "Bản đồ thay đổi nên ca giao đang chạy đã được huỷ. Các đơn quay về trạng thái chờ giao.";
  }
}
var shipperIndexByName = (name) => S.shippers.findIndex((s) => s.name === name);
// Bản ghi đọc từ file -> đơn trong bộ nhớ (Order(const OrderRecord&))
function orderFromRecord(r) {
  const o = { ...r, shipper: -1, tried: [], searchSince: 0, noShipperAt: 0 };
  delete o.shipperName;
  return o;
}
function ensureDeliveryCodes() {
  for (const o of S.orders)
    if (!o.deliveryCode)
      o.deliveryCode = newDeliveryCode();
}
// Ném Error (thông báo của FileIO) nếu không nạp được
function loadDataset(key) {
  const d = DATASETS.find((x) => x.key === key);
  if (!d)
    throw new Error(`Khong co bo du lieu '${key}'`);
  const mt = fileText(d.mapFile);
  if (mt == null)
    throw new Error(d.key === "saved" ? "Chưa có bản đồ nào được lưu trong trình duyệt này" : `Khong mo duoc file ${d.mapFile}`);
  const g = loadMapText(mt);
  let recs = [];
  let live = false;
  if (key === "hcm" && fileExists("orders_live.txt")) {
    try {
      recs = loadOrdersText(fileText("orders_live.txt"), g);
      live = true;
    } catch (e) {
      console.warn(`[Canh bao] orders_live.txt loi (${e.message}), dung orders.txt`);
    }
  }
  if (!live && d.ordersFile && fileExists(d.ordersFile))
    recs = loadOrdersText(fileText(d.ordersFile), g);
  S.graph = g;
  S.orders = recs.map(orderFromRecord);
  if (live)
    S.orders.forEach((o, i) => {
      o.shipper = shipperIndexByName(recs[i].shipperName);
      if (o.status === DISPATCHED || o.status === ASSIGNED)
        Object.assign(o, { status: PENDING, shipper: -1, eta: -1 });
    });
  ensureDeliveryCodes();
  S.dataset = key;
  S.depot = 0;
  fixDepot();
}
// ============================ Đọc tham số request ===========================
var has = (r, k) => r[k] !== undefined && r[k] !== null;
var str = (r, k, def = "") => has(r, k) ? String(r[k]) : def;
// std::stod phải đọc hết chuỗi và ra số hữu hạn
var FULL_NUMBER = /^[ \t\n\v\f\r]*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
function num(r, k, def) {
  if (!has(r, k)) {
    if (def !== undefined)
      return def;
    throw new BadRequest(`Thiếu tham số '${k}'`);
  }
  const v = String(r[k]);
  const d = Number(v.trim());
  if (!FULL_NUMBER.test(v) || !Number.isFinite(d))
    throw new BadRequest(`Tham số '${k}' phải là số, nhận được "${v}"`);
  return d;
}
var integer = (r, k, def) => Math.trunc(num(r, k, def));
function intList(s) {
  const out = [];
  for (const it of String(s).split(",")) {
    if (!it)
      continue;
    let n;
    try {
      n = cppStoll(it);
    } catch {
      throw new BadRequest(`Danh sách số không hợp lệ: "${s}"`);
    }
    out.push(n);
  }
  return out;
}
function requireNode(r, k) {
  const id = integer(r, k);
  if (!S.graph.hasNode(id))
    throw new BadRequest(`Không có điểm #${id} trên bản đồ`);
  return id;
}
function departParam(r) {
  if (!has(r, "depart") || str(r, "depart") === "")
    return -1;
  const d = num(r, "depart");
  if (d < 0 || d >= 24 * 60)
    throw new BadRequest("Giờ xuất phát không hợp lệ");
  return d;
}
var rushPtr = () => S.rush.enabled ? S.rush : null;
var rushJson = () => ({ enabled: S.rush.enabled, windows: S.rush.windows.map((w) => ({ start: w.start, end: w.end })), ramp: S.rush.ramp, sensitivity: [...S.rush.sensitivity].slice(0, 3) });
var vehicleParam = (r) => vehicleFromInt(integer(r, "vehicle", 3));
var criterionParam = (r) => criterionFromString(str(r, "criterion", "distance"));
var clamp = (x, a, b) => Math.min(b, Math.max(a, x));
// ================================ JSON helpers ==============================
function graphJson() {
  const g = S.graph;
  const nodes = g.nodeIds().map((id) => {
    const n = g.getNode(id);
    return { id, name: n.name, x: n.x, y: n.y, degree: g.neighbors(id).length };
  });
  const edges = [];
  for (const u of g.nodeIds())
    for (const e of g.neighbors(u)) {
      if (!g.directed && e.to < u)
        continue;
      edges.push({ u, v: e.to, km: e.distance, time: e.time, cost: e.cost, costK: edgeCostK(e), allowed: e.allowed, jam: e.jam, closed: e.closed, peak: e.peak });
    }
  return {
    directed: g.directed,
    nodes,
    edges,
    stats: { nodes: g.nodeCount(), edges: g.edgeCount(), components: connectedComponents(g).length, negative: g.hasNegativeCost(), traffic: g.trafficCount() }
  };
}
// Cước của từng đơn theo biểu phí, song song với S.orders
// Khối lượng tính cước: max(khối lượng thật, quy đổi theo kích thước)
var chargedWeightOf = (o) => chargedWeight(o.weight, o.dimL, o.dimW, o.dimH, CONFIG.volDivisor);
function orderFees() {
  const km = feeDistances(S.graph, S.depot, S.orders);
  return S.orders.map((o, i) => shippingFee(km[i], chargedWeightOf(o), o.urgent, o.cod));
}
var feeJson = (f) => f.valid ? { km: f.km, base: f.base, distance: f.distance, weight: f.weight, urgent: f.urgent, cod: f.cod, total: f.total } : null;
// ------------------------------------------------- Phạm vi dữ liệu theo vai trò (chống IDOR)
var myShipperIndex = () => isShipper() ? shipperIndexByName(S.me.link) : -1;
function shipperSees(o, idx) {
  if (idx < 0 || o.shipper !== idx)
    return false;
  return o.status === DISPATCHED || o.status === ASSIGNED || o.status === DELIVERED || o.status === FAILED || o.status === RETURNED;
}
function currentView() {
  const v = { all: true, shipper: -1, orders: new Set };
  if (isStaff())
    return v;
  v.all = false;
  if (isShipper()) {
    v.shipper = myShipperIndex();
    for (const o of S.orders)
      if (shipperSees(o, v.shipper))
        v.orders.add(o.id);
    for (const t of S.shift.trips)
      if (v.shipper >= 0 && t.shipper === v.shipper)
        for (const st of t.stops)
          v.orders.add(st.orderId);
  } else
    for (const o of S.orders)
      if (o.owner === S.me.username)
        v.orders.add(o.id);
  return v;
}
function tripVisible(t, v) {
  if (v.all)
    return true;
  if (v.shipper >= 0)
    return t.shipper === v.shipper;
  if (!t.accepted)
    return false;
  // khách chưa biết shipper nào được mời, chỉ thấy chuyến sau khi có người nhận
  return t.stops.some((st) => v.orders.has(st.orderId));
}
var canSeeOrder = (o) => {
  const v = currentView();
  return v.all || v.orders.has(o.id);
};
var findOrderById = (id) => S.orders.find((o) => o.id === id) || null;
// Không có -> 400 (nhân viên); có nhưng không phải của mình / không tồn tại với người khác -> 403
function orderForActor(id) {
  const o = findOrderById(id);
  if (!o) {
    if (isStaff())
      throw new BadRequest(`Không có đơn ${id}`);
    throw new Forbidden(`Đơn ${id} không thuộc quyền xem của bạn`);
  }
  if (!canSeeOrder(o))
    throw new Forbidden(`Đơn ${id} không thuộc quyền xem của bạn`);
  return o;
}
var orderGross = (o, fee) => o.gross > 0 ? o.gross : fee.valid ? Math.trunc(fee.total) : 0;
var orderNet = (o, fee) => Math.max(0, orderGross(o, fee) - o.loyaltyDiscount - o.promoDiscount);
var orderTotal = (o, fee) => orderNet(o, fee) + o.insuranceFee;
var orderCollect = (o, fee) => o.cod + (o.receiverPays ? orderTotal(o, fee) : 0);
function ownerDisplay(user) {
  const a = S.accounts.find(user);
  return a ? a.displayName : user;
}
function shipperScore(name) {
  const { avg, count } = S.reviews.average(name);
  return performanceScore(S.stats.get(name), avg, count);
}
function shipperReady(idx) {
  if (idx < 0 || idx >= S.shippers.length)
    return false;
  for (const a of S.accounts.all())
    if (a.role === SHIPPER && a.link === S.shippers[idx].name)
      return a.ready && a.status === ACC_ACTIVE;
  return true;
}
function shipperAccountOf(idx) {
  if (idx < 0 || idx >= S.shippers.length)
    return null;
  for (const a of S.accounts.all())
    if (a.role === SHIPPER && a.link === S.shippers[idx].name)
      return a;
  return null;
}
// Nơi shipper đang đứng khi rảnh: chỗ giao đơn gần nhất (trong ca) > vị trí đã lưu trong tài khoản > rải đều theo thứ tự id điểm
function shipperNode(idx) {
  const n = S.shift.standbyOf(idx);
  if (n >= 0 && S.graph.hasNode(n))
    return n;
  const a = shipperAccountOf(idx);
  if (a && a.home >= 0 && S.graph.hasNode(a.home))
    return a.home;
  const ids = S.graph.nodeIds().slice().sort((x, y) => x - y);
  if (!ids.length)
    return S.depot;
  return ids[Math.floor(idx * ids.length / Math.max(1, S.shippers.length))];
}
// Thông tin shipper khách được xem sau khi shipper nhận đơn (kiểu Grab: tên, xe, biển số, SĐT, điểm đánh giá)
function carrierInfoJson(idx) {
  if (idx < 0 || idx >= S.shippers.length)
    return null;
  const s = S.shippers[idx];
  const a = shipperAccountOf(idx);
  const { avg, count } = S.reviews.average(s.name);
  return { name: s.name, vehicleName: vehicleName(s.vehicle), plate: a ? a.plate : "", phone: a ? a.phone : "", rating: count ? avg : null, ratings: count };
}
// Shipper đã lấy hàng tại kho chưa? Đơn Đang giao mà giờ ca chưa tới giờ rời kho thì khách còn huỷ được (phí thấp)
function pickedUp(o) {
  if (o.status === FAILED)
    return true;
  if (o.status !== ASSIGNED)
    return false;
  const t = S.shift.tripOfOrder(o.id);
  if (!t || !t.pathTimes.length)
    return true;
  return S.shift.clock >= t.pathTimes[0] - 0.000000001;
}
// Trạng thái dùng để tính phí huỷ: shipper đã nhận nhưng chưa lấy hàng tính như "đã phân công".
// Ghép tự động: lời mời chưa ai nhận (DISPATCHED) chưa ràng buộc shipper nào nên huỷ miễn phí.
function cancelFeeStatus(o) {
  if (o.status === ASSIGNED && !pickedUp(o)) return DISPATCHED;
  if (o.status === DISPATCHED && CONFIG.autoMatch) return PENDING;
  return o.status;
}
// Người xem hiện tại huỷ được đơn này ngay bây giờ không? (khách không huỷ được sau khi shipper đã lấy hàng)
function cancelAllowedNow(o) {
  if (flowCheck(o.status, "cancel", actorBit()))
    return false;
  return !(isCustomer() && o.status === ASSIGNED && pickedUp(o));
}
// Phần cước shipper nhận (cùng công thức với lúc ghi nhận đã giao)
function shipperEarning(o, fee) {
  const part = fee.valid ? shippingPart(fee) : 0;
  const shipping = Math.max(0, part - o.loyaltyDiscount - o.promoDiscount);
  return floor500(shipping * CONFIG.shipperShare);
}
// Một đơn dưới dạng JSON, đã lọc theo vai trò của người xem
function orderRow(o, index, fee, unreachable, carrier) {
  const late = o.deadline >= 0 && (o.status === DELIVERED && o.deliveredAt > o.deadline + 0.000000001 || o.status === ASSIGNED && o.eta > o.deadline + 0.000000001);
  const j = {
    status: o.status,
    statusName: orderStatusName(o.status),
    carrier: carrier.has(o.id) && !(isCustomer() && o.status === DISPATCHED) ? carrier.get(o.id) : null,
    eta: o.eta >= 0 ? o.eta : null,
    deliveredAt: o.deliveredAt >= 0 ? o.deliveredAt : null,
    late,
    index,
    id: o.id,
    destination: o.destination,
    destinationName: nodeName(o.destination),
    weight: o.weight,
    urgent: o.urgent,
    deadline: o.deadline,
    note: o.note,
    attempts: o.attempts,
    failReason: o.failReason,
    failReasonName: o.failReason >= 0 ? failReasonName(o.failReason) : null,
    cod: o.cod,
    phone: o.phone,
    recipient: o.recipient,
    fee: feeJson(fee),
    gross: orderGross(o, fee),
    loyaltyDiscount: o.loyaltyDiscount,
    promo: o.promo,
    promoDiscount: o.promoDiscount,
    net: orderNet(o, fee),
    value: o.declaredValue,
    insurance: o.insuranceFee,
    total: orderTotal(o, fee),
    dims: dimsText(o.dimL, o.dimW, o.dimH),
    chargedWeight: chargedWeightOf(o),
    receiverPays: o.receiverPays,
    collect: orderCollect(o, fee),
    returnFee: o.returnFee,
    cancelFee: o.cancelFee,
    createdAt: o.createdAt,
    deliveredReal: o.deliveredReal,
    reachable: !unreachable.has(o.destination)
  };
  if (!isShipper()) {
    j.owner = o.owner;
    j.ownerName = o.owner ? ownerDisplay(o.owner) : null;
  }
  j.noShipper = o.status === PENDING && o.noShipperAt > 0;
  j.tried = o.tried.length;
  if (isCustomer() || isStaff()) {
    const known = o.shipper >= 0 && (o.status === ASSIGNED || o.status === DELIVERED || o.status === FAILED || o.status === RETURNED);
    j.carrierInfo = known ? carrierInfoJson(o.shipper) : null;
    if (o.status === DISPATCHED && isStaff() && o.shipper >= 0 && o.shipper < S.shippers.length)
      j.offeredTo = S.shippers[o.shipper].name;
  }
  if (isShipper() || isStaff()) {
    const cs = o.owner ? S.custReviews.averageOfCustomer(o.owner) : { avg: 0, count: 0 };
    j.earn = shipperEarning(o, fee);
    j.customerName = o.owner ? ownerDisplay(o.owner) : null;
    j.customerRating = cs.count ? cs.avg : null;
    j.customerRatings = cs.count;
    j.ratedCustomer = S.custReviews.ofOrder(o.id) != null;
  }
  if (isCustomer() || isStaff()) {
    j.proof = o.proofNote;
    j.rated = S.reviews.ofOrder(o.id) != null;
    // Phí huỷ nếu huỷ ngay bây giờ (cùng công thức với order/cancel) -> giao diện báo trước cho người dùng
    if (cancelAllowedNow(o)) {
      const part = fee.valid ? shippingPart(fee) : 0;
      j.cancelFeeNow = cancelFee(cancelFeeStatus(o), Math.max(0, part - o.loyaltyDiscount - o.promoDiscount), CONFIG);
    }
  }
  // Mã xác nhận giao: chỉ chủ đơn thấy
  if (isCustomer() && o.owner === S.me.username)
    j.code = o.deliveryCode;
  return j;
}
var unreachableSet = () => new Set(S.graph.hasNode(S.depot) ? unreachableFrom(S.graph, S.depot) : []);
function carrierMap() {
  const carrier = new Map;
  for (const t of S.shift.trips)
    for (const s of t.stops)
      carrier.set(s.orderId, t.shipperName);
  return carrier;
}
function ordersJson(fees) {
  const view = currentView();
  const unreachable = unreachableSet();
  const carrier = carrierMap();
  const out = [];
  S.orders.forEach((o, i) => {
    if (!view.all && !view.orders.has(o.id))
      return;
    out.push(orderRow(o, i, fees[i], unreachable, carrier));
  });
  return out;
}
function shippersJson() {
  if (isCustomer())
    return [];
  const mine = myShipperIndex();
  const out = [];
  S.shippers.forEach((s, i) => {
    if (isShipper() && i !== mine)
      return;
    out.push({ index: i, name: s.name, capacity: s.capacity, vehicle: s.vehicle, vehicleName: vehicleName(s.vehicle), ready: shipperReady(i), score: shipperScore(s.name), absent: S.shift.isAbsent(i), busy: S.shift.busy(i, S.orders), node: shipperNode(i) });
  });
  return out;
}
var datasetsJson = () => DATASETS.map((d) => ({ key: d.key, title: d.title, description: d.description, available: fileExists(d.mapFile) }));
function eventsJson() {
  const view = currentView();
  const out = [];
  for (const e of S.shift.events) {
    if (!view.all) {
      const mine = view.shipper >= 0 ? e.shipper === view.shipper && e.type !== "absent" && e.type !== "available" : e.order >= 0 && view.orders.has(e.order);
      if (!mine)
        continue;
    }
    out.push({ t: e.t, type: e.type, order: e.order, shipper: e.shipper, who: e.shipper >= 0 && e.shipper < S.shippers.length ? S.shippers[e.shipper].name : null, detail: e.detail });
  }
  return out;
}
function shiftJson() {
  const view = currentView();
  const trips = [];
  for (const t of S.shift.trips) {
    if (!tripVisible(t, view))
      continue;
    const stops = [];
    for (const s of t.stops) {
      if (!view.all && view.shipper < 0 && !view.orders.has(s.orderId))
        continue;
      stops.push({ order: s.orderId, node: s.node, name: nodeName(s.node), pathIndex: s.pathIndex, eta: s.eta });
    }
    trips.push({ id: t.id, shipper: t.shipper, name: t.shipperName, accepted: t.accepted, vehicle: t.vehicle, vehicleName: vehicleName(t.vehicle), path: t.path, pathTimes: t.pathTimes, stops, km: t.km, minutes: t.minutes, cost: t.cost, load: t.load, capacity: t.capacity, note: t.note || "", reroutes: t.reroutes || 0, from: t.fromNode, approach: t.approach, approachTimes: t.approachTimes, offerLeft: !t.accepted && t.offerUntil > 0 && !isCustomer() ? Math.max(0, t.offerUntil - nowSeconds()) : null, service: PHUT_MOI_DIEM });
  }
  return {
    maxAttempts: MAX_ATTEMPTS,
    active: S.shift.active(),
    clock: S.shift.clock,
    speed: CONFIG.clockSpeed,
    autoMatch: CONFIG.autoMatch,
    offerSeconds: CONFIG.offerSeconds,
    trips,
    history: view.all ? S.shift.history.map((h) => ({ id: h.id, when: h.when, plan: h.plan, orders: h.orders, shippers: h.shippers, predictedLate: h.predictedLate, km: h.km, cost: h.cost, makespan: h.makespan })) : [],
    events: eventsJson(),
    failReasons: Array.from({ length: FAIL_REASON_COUNT }, (_, k) => ({ id: k, name: failReasonName(k), returns: failReasonReturns(k) }))
  };
}
var tariffJson = () => ({ firstKm: TARIFF.firstKm, firstFee: TARIFF.firstFee, perKm: TARIFF.perKm, freeKg: TARIFF.freeKg, perKg: TARIFF.perKg, urgent: TARIFF.urgent, codRate: TARIFF.codRate, codMin: TARIFF.codMin, returnRate: TARIFF.returnRate });
function financeJson(fees) {
  let f = summarize(S.orders, fees, S.shift.trips, S.shippers.length);
  if (!isStaff()) {
    // Shipper chỉ thấy dòng đối soát của mình; khách hàng không thấy số liệu tài chính
    const mine = myShipperIndex();
    const own = { revenue: 0, expectedRevenue: 0, cost: 0, profit: 0, codCollected: 0, codOnRoute: 0, codPending: 0, delivered: 0, returned: 0, cancelled: 0, shippers: [] };
    for (const s of f.shippers)
      if (mine >= 0 && s.shipper === mine) {
        own.shippers.push(s);
        Object.assign(own, { revenue: s.revenue, cost: s.cost, profit: s.revenue - s.cost, codCollected: s.codCollected, codOnRoute: s.codOnRoute, delivered: s.delivered, returned: s.returned, expectedRevenue: s.revenue });
      }
    f = own;
  }
  return {
    revenue: f.revenue,
    expectedRevenue: f.expectedRevenue,
    cost: f.cost,
    profit: f.profit,
    codCollected: f.codCollected,
    codOnRoute: f.codOnRoute,
    codPending: f.codPending,
    delivered: f.delivered,
    returned: f.returned,
    cancelled: f.cancelled,
    shippers: f.shippers.map((s) => ({ shipper: s.shipper, name: s.shipper >= 0 ? S.shippers[s.shipper].name : "Một xe", delivered: s.delivered, failed: s.failed, returned: s.returned, onRoute: s.onRoute, codCollected: s.codCollected, codOnRoute: s.codOnRoute, revenue: s.revenue, km: s.km, cost: s.cost })),
    tariff: tariffJson()
  };
}
function tierJson(done) {
  const t = tierFor(done);
  const next = nextTier(done);
  return { name: t.name, pct: t.pct, done, next: next ? { name: next.name, pct: next.pct, remaining: next.minDone - done } : null };
}
function accountJson(a) {
  const j = {
    username: a.username,
    role: roleKey(a.role),
    roleName: roleName(a.role),
    displayName: a.displayName,
    link: a.link,
    status: statusKey(a.status),
    statusName: statusName(a.status),
    statusReason: a.statusReason,
    email: a.email,
    phone: a.phone,
    createdAt: a.createdAt,
    lastLogin: a.lastLogin
  };
  if (a.role === SHIPPER)
    Object.assign(j, { vehicle: a.vehicle, vehicleName: a.vehicle >= 0 ? vehicleName(vehicleFromInt(a.vehicle)) : null, capacity: a.capacity, plate: a.plate, ready: a.ready });
  if (a.role === CUSTOMER)
    Object.assign(j, { tier: tierJson(a.done), spent: a.spent });
  return j;
}
function meJson() {
  if (!S.authed)
    return null;
  return { ...accountJson(S.me), shipper: myShipperIndex(), csrf: S.csrf, unread: S.notes.unread(S.me.username) };
}
// Số liệu hiện trên menu (chấm đỏ): việc đang chờ từng vai trò xử lý
function badgesJson() {
  let created = 0, failed = 0, waiting = 0;
  for (const o of S.orders) {
    created += o.status === CREATED;
    failed += o.status === FAILED;
    waiting += o.status === PENDING;
  }
  if (isStaff()) {
    const pendingUsers = S.accounts.all().filter((a) => a.status === ACC_PENDING).length;
    const complaints = S.complaints.all().filter((c) => c.status !== "resolved").length;
    const codConfirm = S.cod.remittances().filter((r) => r.state === "submitted").length;
    return { newOrders: created, waiting, failed, pendingUsers, complaints, codConfirm };
  }
  if (isShipper())
    return { trips: S.shift.trips.filter((t) => !t.accepted && t.shipper === myShipperIndex()).length };
  if (isCustomer())
    return { complaints: S.complaints.all().filter((c) => c.owner === S.me.username && c.status !== "resolved").length };
  return {};
}
function configJson() {
  const c = CONFIG;
  return {
    tiers: c.tiers.map((t) => ({ name: t.name, minDone: t.minDone, pct: t.pct })),
    cancelDispatched: c.cancelDispatched,
    cancelOnRoute: c.cancelOnRoute,
    shipperShare: c.shipperShare,
    scoreAware: c.scoreAware,
    maxOpenOrders: c.maxOpenOrders,
    autoDeliver: c.autoDeliver,
    insRate: c.insRate,
    insThreshold: c.insThreshold,
    volDivisor: c.volDivisor,
    compMultiplier: c.compMultiplier,
    debtLimit: c.debtLimit,
    autoMatch: c.autoMatch,
    offerSeconds: c.offerSeconds,
    matchGiveUp: c.matchGiveUp,
    clockSpeed: c.clockSpeed,
    tariff: tariffJson()
  };
}
function stateJson() {
  const fees = orderFees();
  let notice = "";
  if (isStaff()) {
    notice = S.notice;
    S.notice = "";
  }
  const customers = [];
  if (isStaff())
    for (const a of S.accounts.all())
      if (a.role === CUSTOMER && a.status === ACC_ACTIVE)
        customers.push({ username: a.username, displayName: a.displayName });
  return {
    me: meJson(),
    customers,
    ok: true,
    notice,
    badges: badgesJson(),
    config: { autoDeliver: CONFIG.autoDeliver, scoreAware: CONFIG.scoreAware, maxOpenOrders: CONFIG.maxOpenOrders, autoMatch: CONFIG.autoMatch, offerSeconds: CONFIG.offerSeconds, clockSpeed: CONFIG.clockSpeed, tariff: tariffJson() },
    settings: { shiftStart: S.shiftStart, rush: rushJson() },
    shift: shiftJson(),
    undo: { can: isAdmin() && S.history.canUndo(), label: isAdmin() ? S.history.undoLabel() : "" },
    redo: { can: isAdmin() && S.history.canRedo(), label: isAdmin() ? S.history.redoLabel() : "" },
    dataset: S.dataset,
    datasets: datasetsJson(),
    depot: S.depot,
    graph: graphJson(),
    orders: ordersJson(fees),
    shippers: shippersJson(),
    finance: financeJson(fees)
  };
}
function estimateJson(e) {
  return {
    ok: e.hopLe,
    error: e.lyDo,
    km: e.quangDuongKm,
    cost: e.chiPhi,
    surcharge: e.phuPhi,
    minutes: e.thoiGianPhut,
    minutesBase: e.thoiGianGoc,
    depart: e.gioDi >= 0 ? e.gioDi : null,
    stops: e.soDiemGiao,
    legs: e.cacChang.map((c) => ({ from: c.tu, to: c.den, path: c.duongDi, km: c.km, minutes: c.phut, surcharge: c.phuPhi })),
    formula: { fixed: PHI_CO_DINH, perKm: GIA_MOI_KM, perStopMinutes: PHUT_MOI_DIEM }
  };
}
function planJson(p, orders, ships) {
  const ids = (idx) => idx.map((i) => orders[i].id);
  let finish = 0;
  for (const r of p.routes)
    if (r.orders.length)
      finish = Math.max(finish, r.startAt + r.minutes);
  return {
    finishAt: finish,
    key: p.key,
    name: p.name,
    description: p.description,
    routes: p.routes.map((r) => ({
      shipper: r.shipper,
      name: r.shipper >= 0 ? ships[r.shipper].name : "Một xe",
      vehicle: r.vehicle,
      vehicleName: vehicleName(r.vehicle),
      capacity: r.shipper >= 0 ? ships[r.shipper].capacity : 0,
      load: r.load,
      km: r.km,
      minutes: r.minutes,
      cost: r.costVnd,
      late: r.late,
      rushDelay: r.rushDelay,
      startAt: r.startAt,
      stops: r.orders.map((oi, i) => {
        const o = orders[oi];
        const at2 = r.arrival[i] + r.startAt;
        return { order: o.id, node: o.destination, name: nodeName(o.destination), arrival: at2, deadline: o.deadline, urgent: o.urgent, late: o.deadline >= 0 && at2 > o.deadline + 0.000000001 };
      }),
      path: r.path
    })),
    overweight: ids(p.overweight),
    unreachable: ids(p.unreachable),
    km: p.km,
    minutes: p.minutes,
    makespan: p.makespan,
    cost: p.costVnd,
    late: p.late,
    served: p.served,
    micros: p.micros,
    optimal: p.optimal,
    skipped: p.skipped,
    note: p.note
  };
}
// Map/Set -> đối tượng/mảng thường; số vô hạn -> null (như Json::dump của bản C++)
function toPlain(x) {
  return JSON.parse(JSON.stringify(x, (k, v) => {
    if (v instanceof Map)
      return Object.fromEntries(v);
    if (v instanceof Set)
      return [...v];
    if (typeof v === "number" && (!Number.isFinite(v) || Math.abs(v) >= 100000000000000000))
      return null;
    return v;
  }));
}
// Ca đang chạy mà giao thông đổi: tính lại tuyến các chuyến, ghi kết quả vào thông báo
function rerouteActive() {
  const out = { rerouted: 0, retimed: 0, dropped: [] };
  if (!S.shift.active())
    return out;
  const rep = S.shift.reroute(S.graph, S.depot, rushPtr(), S.shiftStart, S.orders);
  let msg = "";
  if (rep.rerouted)
    msg += `${rep.rerouted} chuyến đổi sang đường khác`;
  if (rep.retimed)
    msg += `${msg ? ", " : ""}${rep.retimed} chuyến cập nhật giờ tới`;
  if (rep.dropped.length)
    msg += `${msg ? ". " : ""}${rep.dropped.length} đơn không còn đường tới, đã trả về hàng chờ:${rep.dropped.map((id) => " " + id).join("")}`;
  if (Math.abs(rep.maxDelay) >= 0.5)
    msg += ` (giờ về ${rep.maxDelay > 0 ? "chậm thêm" : "sớm hơn"} ${Math.round(Math.abs(rep.maxDelay))} phút)`;
  if (msg) {
    S.notice = `Ca đang chạy: ${msg}.`;
    S.shift.log(S.shift.clock, "reroute", -1, -1, msg);
  }
  return { rerouted: rep.rerouted, retimed: rep.retimed, dropped: rep.dropped, maxDelay: rep.maxDelay };
}
// ------------------------------------------------------------- Lưu "file"
// Bản ghi đơn để xuất / lưu bản đồ: bỏ trạng thái vận hành và mã xác nhận giao
var exportRecords = () => S.orders.map((o) => ({ ...o, status: 0, eta: -1, deliveredAt: -1, attempts: 0, failReason: -1, cancelFee: 0, deliveryCode: "", proofNote: "", deliveredReal: 0, codRecorded: false, shipperName: "", returnFee: 0, closedAt: 0 }));
var liveOrdersText = () => ordersToText(S.orders.map((o) => ({ ...o, shipperName: o.shipper >= 0 && o.shipper < S.shippers.length ? S.shippers[o.shipper].name : "" })));
// Ghi các file đã thay đổi trong yêu cầu vừa xử lý
function flushDirty() {
  const d = S.dirty;
  S.dirty = 0;
  if (d & D_USERS)
    writeDataFile("users.txt", S.accounts.toText());
  if (d & D_PROMOS)
    writeDataFile("promos.txt", S.promos.toText());
  if (d & D_ADDR)
    writeDataFile("addresses.txt", S.addresses.toText());
  if (d & D_REVIEWS)
    writeDataFile("reviews.txt", S.reviews.toText());
  if (d & D_CREVIEWS)
    writeDataFile("customer_reviews.txt", S.custReviews.toText());
  if (d & D_STATS)
    writeDataFile("stats.txt", S.stats.toText());
  if (d & D_NOTES)
    writeDataFile("notifications.txt", S.notes.toText());
  if (d & D_AUDIT)
    writeDataFile("audit.txt", S.audit.toText());
  if (d & D_COMPL)
    writeDataFile("complaints.txt", S.complaints.toText());
  if (d & D_COD)
    writeDataFile("cod_ledger.txt", S.cod.toText());
  if (d & D_LEDGER)
    writeDataFile("customer_ledger.txt", S.ledger.toText());
  if (d & D_CONFIG)
    writeDataFile("config.txt", CONFIG.toText());
  if (d & D_FLEET)
    writeDataFile("shippers.txt", shippersToText(S.shippers));
  if (d & D_ORDERS && S.dataset === "hcm")
    writeDataFile("orders_live.txt", liveOrdersText());
}
// ================================= Bảng API =================================
// Mỗi API phải có quy tắc trong bảng phân quyền RULES (kiểm tra ở 09-main.js, như requireRule của bản C++)
var R = {};
var GET = (p, f) => {
  R["GET " + p] = f;
};
var POST = (p, f) => {
  R["POST " + p] = f;
};
var now4 = () => performance.now();
// ------------------------------------------------------------ Trạng thái
GET("state", () => stateJson());
POST("dataset", (r) => {
  const before = snapshot();
  if (S.shift.active())
    S.shift.reset(S.orders, true);
  try {
    loadDataset(str(r, "key"));
  } catch (e) {
    throw new BadRequest(e.message);
  }
  commitMap(before, "Mở bộ dữ liệu", true);
  return stateJson();
});
POST("graph/new", (r) => {
  const before = snapshot();
  S.graph = new Graph(integer(r, "directed", 0) === 1);
  S.orders = [];
  S.depot = -1;
  S.dataset = "";
  commitMap(before, "Tạo bản đồ mới", true);
  return stateJson();
});
POST("depot", (r) => {
  const id = requireNode(r, "id");
  const before = snapshot();
  S.depot = id;
  commitMap(before, "Đổi kho", true);
  return stateJson();
});
// ------------------------------------------------------- Hoàn tác / Làm lại
function restore(isUndo) {
  const e = isUndo ? S.history.undo(snapshot()) : S.history.redo(snapshot());
  if (!e)
    throw new BadRequest(isUndo ? "Không còn thao tác nào để hoàn tác" : "Không còn thao tác nào để làm lại");
  const st = e.state;
  S.graph = st.graph.clone();
  S.orders = cloneOrders(st.orders);
  S.depot = st.depot;
  S.dataset = st.dataset;
  if (S.shift.active())
    S.shift.reset(S.orders, true);
  else
    for (const o of S.orders)
      Object.assign(o, { status: PENDING, shipper: -1, eta: -1, deliveredAt: -1 });
  S.indexDirty = true;
  return { ...stateJson(), message: (isUndo ? "Đã hoàn tác: " : "Đã làm lại: ") + e.label };
}
POST("undo", () => restore(true));
POST("redo", () => restore(false));
// ------------------------------------------------------- Tình trạng giao thông
POST("traffic", (r) => {
  const u = requireNode(r, "u"), v = requireNode(r, "v");
  const jam = num(r, "jam", 1);
  if (jam < 1 || jam > 10)
    throw new BadRequest("Hệ số kẹt xe phải từ 1 đến 10");
  const closed = integer(r, "closed", 0) === 1;
  const before = snapshot();
  if (!S.graph.setTraffic(u, v, jam, closed))
    throw new BadRequest("Không có đoạn đường này");
  commitMap(before, closed ? "Đóng đường" : jam > 1 ? "Báo kẹt xe" : "Thông đường", false);
  rerouteActive();
  return stateJson();
});
POST("traffic/clear", () => {
  const before = snapshot();
  S.graph.clearTraffic();
  commitMap(before, "Xoá mọi sự cố giao thông", false);
  rerouteActive();
  return stateJson();
});
// ------------------------------------------------------- Tìm điểm (Trie)
GET("search", (r) => {
  if (S.indexDirty) {
    S.index.build(S.graph);
    S.indexDirty = false;
  }
  const items = S.index.search(str(r, "q"), clamp(integer(r, "limit", 8), 1, 30)).map((id) => ({ id, name: nodeName(id), degree: S.graph.neighbors(id).length }));
  return { ok: true, items };
});
// ------------------------------------------------------- Cài đặt
POST("settings", (r) => {
  const start = integer(r, "shiftStart", S.shiftStart);
  if (start < 0 || start >= 24 * 60)
    throw new BadRequest("Giờ bắt đầu ca không hợp lệ");
  S.shiftStart = start;
  if (has(r, "rush"))
    S.rush.enabled = integer(r, "rush") === 1;
  lsSet("dt08.shiftStart", String(start));
  lsSet("dt08.rush", S.rush.enabled ? "1" : "0");
  return stateJson();
});
GET("print", () => ({ ok: true, text: S.graph.print() }));
// ------------------------------------------------------------------ Nút
POST("node/add", (r) => {
  const name = str(r, "name");
  if (!name)
    throw new BadRequest("Tên điểm không được để trống");
  const id = integer(r, "id", S.graph.nextNodeId());
  const x = num(r, "x"), y = num(r, "y");
  const before = snapshot();
  if (!S.graph.addNode(id, name, x, y))
    throw new BadRequest(`Mã điểm #${id} đã tồn tại hoặc không hợp lệ`);
  fixDepot();
  commitMap(before, "Thêm điểm " + name, false);
  return { ...stateJson(), created: id };
});
POST("node/update", (r) => {
  const id = requireNode(r, "id");
  const n = S.graph.getNode(id);
  const name = str(r, "name", n.name);
  if (!name)
    throw new BadRequest("Tên điểm không được để trống");
  const x = num(r, "x", n.x), y = num(r, "y", n.y);
  const before = snapshot();
  S.graph.updateNode(id, name, x, y);
  commitMap(before, "Sửa điểm " + name, false);
  return stateJson();
});
POST("node/remove", (r) => {
  const id = requireNode(r, "id");
  const snap = snapshot();
  const label = "Xoá điểm " + nodeName(id);
  S.graph.removeNode(id);
  const n = S.orders.length;
  S.orders = S.orders.filter((o) => o.destination !== id);
  fixDepot();
  const removed = n - S.orders.length;
  commitMap(snap, label, true);
  return { ...stateJson(), removedOrders: removed };
});
// ----------------------------------------------------------------- Cạnh
POST("edge/add", (r) => {
  const u = requireNode(r, "u"), v = requireNode(r, "v");
  if (u === v)
    throw new BadRequest("Hai đầu đoạn đường phải là hai điểm khác nhau");
  const km = num(r, "km"), t = num(r, "time");
  if (km < 0 || t < 0)
    throw new BadRequest("Quãng đường và thời gian không được âm");
  const cost = num(r, "cost", 0);
  const allowed = integer(r, "allowed", MASK_ALL);
  const peak = num(r, "peak", DEFAULT_PEAK);
  if (peak < 1 || peak > 5)
    throw new BadRequest("Hệ số giờ cao điểm phải từ 1 đến 5");
  const before = snapshot();
  if (!S.graph.addEdge(u, v, km, t, cost, allowed, peak))
    throw new BadRequest(`Đoạn đường ${nodeName(u)} – ${nodeName(v)} đã có`);
  commitMap(before, `Nối đường ${nodeName(u)} – ${nodeName(v)}`, false);
  return stateJson();
});
POST("edge/update", (r) => {
  const u = requireNode(r, "u"), v = requireNode(r, "v");
  const km = num(r, "km"), t = num(r, "time"), cost = num(r, "cost", 0);
  const allowed = integer(r, "allowed", MASK_ALL);
  const old = S.graph.getEdge(u, v);
  const peak = num(r, "peak", old ? old.peak : DEFAULT_PEAK);
  if (peak < 1 || peak > 5)
    throw new BadRequest("Hệ số giờ cao điểm phải từ 1 đến 5");
  const before = snapshot();
  if (!S.graph.updateEdge(u, v, km, t, cost, allowed, peak))
    throw new BadRequest("Không sửa được: đoạn đường không tồn tại hoặc số liệu âm");
  commitMap(before, `Sửa đường ${nodeName(u)} – ${nodeName(v)}`, true);
  return stateJson();
});
POST("edge/remove", (r) => {
  const u = requireNode(r, "u"), v = requireNode(r, "v");
  const before = snapshot();
  if (!S.graph.removeEdge(u, v))
    throw new BadRequest("Không có đoạn đường này");
  commitMap(before, `Xoá đường ${nodeName(u)} – ${nodeName(v)}`, true);
  return stateJson();
});
// ------------------------------------------------------- Nhập / xuất file
// Tải về (GET export/*, audit/export) đi qua exportText ở 09-main.js; ở đây chỉ đăng ký để khớp bảng phân quyền
var DOWNLOADS = {
  "export/map": () => mapToText(S.graph),
  "export/orders": () => ordersToText(exportRecords()),
  "export/shippers": () => shippersToText(S.shippers)
};
for (const p of Object.keys(DOWNLOADS))
  GET(p, () => ({ ok: true, text: DOWNLOADS[p]() }));
POST("import/map", (r) => {
  let g;
  try {
    g = loadMapText(str(r, "body"));
  } catch (e) {
    throw new BadRequest("File bản đồ lỗi. " + e.message);
  }
  const before = snapshot();
  if (S.shift.active())
    S.shift.reset(S.orders, true);
  S.graph = g;
  S.orders = S.orders.filter((o) => g.hasNode(o.destination));
  S.dataset = "";
  fixDepot();
  commitMap(before, "Nhập map.txt", true);
  return stateJson();
});
POST("import/orders", (r) => {
  let recs;
  try {
    recs = loadOrdersText(str(r, "body"), S.graph);
  } catch (e) {
    throw new BadRequest("File đơn hàng lỗi. " + e.message);
  }
  if (S.shift.active())
    S.shift.reset(S.orders, true);
  S.orders = recs.map(orderFromRecord);
  ensureDeliveryCodes();
  mark(D_ORDERS);
  audit("import.orders", "orders", `${recs.length} đơn`);
  return stateJson();
});
POST("import/shippers", (r) => {
  let ships;
  try {
    ships = loadShippersText(str(r, "body"));
  } catch (e) {
    throw new BadRequest("File shipper lỗi. " + e.message);
  }
  S.shippers = ships;
  mark(D_FLEET);
  audit("import.shippers", "shippers", `${ships.length} shipper`);
  return stateJson();
});
POST("save", () => {
  const recs = exportRecords();
  if (!lsSet(LS_PREFIX + "my_map.txt", mapToText(S.graph)) || !lsSet(LS_PREFIX + "my_orders.txt", ordersToText(recs)))
    throw new BadRequest("Trình duyệt không cho lưu dữ liệu (chế độ ẩn danh?). Hãy dùng Tệp → Tải map.txt.");
  S.dataset = "saved";
  return { ...stateJson(), message: "Đã lưu bản đồ và đơn hàng vào trình duyệt này (mục “Bản đồ đã lưu”)" };
});
// --------------------------------------------------------- Duyệt đồ thị
GET("traverse", (r) => {
  const g = S.graph;
  const start = requireNode(r, "start");
  const algo = str(r, "algo", "bfs");
  const order = algo === "dfs" ? dfs(g, start) : algo === "dfsi" ? dfsIterative(g, start) : bfs(g, start);
  const tree = [];
  if (algo === "bfs") {
    const zone = deliveryZone(g, start, g.nodeCount());
    const parent = new Map;
    for (const u of order)
      for (const e of g.neighbors(u))
        if (!parent.has(e.to) && zone.has(e.to) && zone.get(e.to) === zone.get(u) + 1)
          parent.set(e.to, u);
    for (const v of order)
      if (v !== start && parent.has(v))
        tree.push([parent.get(v), v]);
    return { ok: true, order, tree, levels: zone };
  }
  const stack = [];
  for (const v of order) {
    while (stack.length && !g.hasEdge(stack[stack.length - 1], v))
      stack.pop();
    if (stack.length)
      tree.push([stack[stack.length - 1], v]);
    stack.push(v);
  }
  return { ok: true, order, tree };
});
GET("components", () => ({
  ok: true,
  components: connectedComponents(S.graph),
  strong: stronglyConnectedComponents(S.graph),
  connected: isConnected(S.graph),
  unreachableFromDepot: S.graph.hasNode(S.depot) ? unreachableFrom(S.graph, S.depot) : []
}));
GET("zone", (r) => {
  const depot = requireNode(r, "depot");
  const hops = integer(r, "hops", 2);
  if (hops < 0)
    throw new BadRequest("Số chặng phải >= 0");
  return { ok: true, zone: deliveryZone(S.graph, depot, hops) };
});
GET("zones", (r) => {
  const depots = intList(str(r, "depots"));
  if (!depots.length)
    throw new BadRequest("Chọn ít nhất một kho");
  const z = assignZones(S.graph, depots);
  return { ok: true, owner: z.owner, hops: z.hops, unassigned: z.unassigned };
});
// ------------------------------------------------------ Đường đi ngắn nhất
GET("path", (r) => {
  const src = requireNode(r, "src"), dst = requireNode(r, "dst");
  const algo = str(r, "algo", "heap");
  const veh = vehicleParam(r), crit = criterionParam(r);
  const depart = departParam(r);
  const rush = depart >= 0 ? rushPtr() : null;
  const compare = [];
  let chosen = {};
  const add = (key, name, path, weight, micros, work, warning, settle, settled = -1) => {
    const info = describePath(S.graph, path, veh, depart, rush);
    const row = { key, name, found: info.found, path, weight: info.found ? weight : null, km: info.km, minutes: info.minutes, minutesBase: info.minutesBase, costK: info.costK, hops: info.hops, micros, work, settled: settled >= 0 ? settled : null, warning };
    if (key === algo)
      chosen = { ...row, settleOrder: settle };
    compare.push(row);
  };
  for (const v of [ARRAY, STL_PQ, MIN_HEAP]) {
    const t = dijkstra(S.graph, src, v, { criterion: crit, vehicle: veh, departAt: depart, rush, target: dst });
    const key = v === ARRAY ? "array" : v === STL_PQ ? "stl" : "heap";
    add(key, versionName(v), getPath(t, dst), t.dist.get(dst), t.micros, t.heapOps, t.negativeEdge ? "Có cạnh trọng số âm: Dijkstra không đảm bảo kết quả đúng." : "", t.settleOrder, t.settleOrder.length);
  }
  {
    const t = astar(S.graph, src, dst, { criterion: crit, vehicle: veh, departAt: depart, rush });
    add("astar", "A* (đường chim bay)", getPath(t, dst), t.dist.get(dst), t.micros, t.heapOps, t.negativeEdge ? "Có cạnh trọng số âm: A* (cũng như Dijkstra) không đảm bảo kết quả đúng." : "", t.settleOrder, t.settleOrder.length);
  }
  const bf = bellmanFord(S.graph, src, crit, veh, depart, rush);
  const warn = bf.coChuTrinhAm ? "Phát hiện chu trình âm: " + bf.chuTrinhAm.map(nodeName).join(" → ") : "";
  add("bellman", "Bellman-Ford", bfGetPath(bf, src, dst), bf.khoangCach.get(dst), bf.micros, bf.soLanNoiLong, warn, []);
  if (algo === "bellman")
    chosen.cycle = bf.chuTrinhAm;
  const t0 = now4();
  const p = bfsPath(S.graph, src, dst);
  const us = (now4() - t0) * 1000;
  add("bfs", "BFS (ít chặng nhất)", p, p.length ? p.length - 1 : 0, us, 0, "BFS bỏ qua trọng số và loại xe, chỉ tìm đường ít chặng nhất.", []);
  return { ok: true, depart: depart >= 0 ? depart : null, rushLevel: rush ? rush.level(depart) : 0, criterion: criterionName(crit), vehicle: vehicleName(veh), result: chosen, compare };
});
GET("benchmark", (r) => {
  const sizes = intList(str(r, "sizes", "100,500,1000,2000,4000"));
  for (const n of sizes)
    if (n < 2 || n > 20000)
      throw new BadRequest("Số đỉnh mỗi lần đo phải trong khoảng 2..20000");
  if (sizes.length > 8)
    throw new BadRequest("Tối đa 8 kích thước mỗi lần đo");
  const deg = num(r, "degree", 4);
  if (deg < 1 || deg > 50)
    throw new BadRequest("Bậc trung bình phải trong khoảng 1..50");
  const reps = clamp(integer(r, "repeats", 3), 1, 10);
  const rows = benchmark(sizes, deg, reps).map((b) => ({ nodes: b.nodes, edges: b.edges, array: b.microsArray, stl: b.microsStl, heap: b.microsHeap, opsArray: b.opsArray, opsStl: b.opsStl, opsHeap: b.opsHeap, agree: b.agree }));
  return { ok: true, rows, degree: deg, repeats: reps };
});
// Truy vấn điểm - điểm trên bản đồ hiện tại: Dijkstra (dừng sớm) so với A*
GET("benchmark/p2p", (r) => {
  const pairs = clamp(integer(r, "pairs", 50), 1, 500);
  const crit = criterionParam(r);
  const ids = S.graph.nodeIds();
  if (ids.length < 2)
    throw new BadRequest("Bản đồ cần ít nhất 2 điểm");
  let seed = 7;
  const rnd = () => {
    seed = seed * 1103515245 + 12345 >>> 0;
    return seed / 4294967296;
  };
  let tD = 0, tA = 0, sD = 0, sA = 0, found = 0, agree = 0;
  for (let i = 0;i < pairs; i++) {
    const a = ids[Math.floor(rnd() * ids.length)], b = ids[Math.floor(rnd() * ids.length)];
    if (a === b) {
      i--;
      continue;
    }
    const d = dijkstra(S.graph, a, MIN_HEAP, { criterion: crit, target: b });
    const s = astar(S.graph, a, b, { criterion: crit });
    tD += d.micros;
    tA += s.micros;
    sD += d.settleOrder.length;
    sA += s.settleOrder.length;
    if (d.dist.get(b) !== INF) {
      found++;
      if (Math.abs(d.dist.get(b) - s.dist.get(b)) < 0.000001)
        agree++;
    } else if (s.dist.get(b) === INF)
      agree++;
  }
  return { ok: true, pairs, nodes: S.graph.nodeCount(), found, agree: agree === pairs, dijkstra: { settled: sD / pairs, micros: tD / pairs }, astar: { settled: sA / pairs, micros: tA / pairs } };
});
// --------------------------------------------------- Bellman-Ford & dự toán
GET("bellman", (r) => {
  const src = requireNode(r, "src");
  const crit = criterionFromString(str(r, "criterion", "cost"));
  const veh = vehicleParam(r);
  const bf = bellmanFord(S.graph, src, crit, veh);
  const dj = dijkstra(S.graph, src, MIN_HEAP, { criterion: crit, vehicle: veh });
  const rows = S.graph.nodeIds().map((id) => {
    const d = bf.khoangCach.get(id);
    return { id, name: nodeName(id), dist: d >= VO_CUC ? null : d, prev: bf.truoc.get(id), dijkstra: dj.dist.get(id), path: bfGetPath(bf, src, id) };
  });
  return { ok: true, criterion: criterionName(crit), negativeCycle: bf.coChuTrinhAm, cycle: bf.chuTrinhAm, anyCycle: findNegativeCycle(S.graph, crit, veh), iterations: bf.soVongLap, relaxations: bf.soLanNoiLong, micros: bf.micros, hasNegativeEdge: dj.negativeEdge, rows };
});
GET("estimate", (r) => {
  const depot = requireNode(r, "depot");
  const stops = intList(str(r, "stops"));
  const back = integer(r, "return", 0) === 1;
  const depart = departParam(r);
  return estimateJson(estimateMultiStop(S.graph, depot, stops, vehicleParam(r), back, depart, rushPtr()));
});
// -------------------------------------------------------------- Shipper (đội xe)
function readShipper(r, s) {
  s = { ...s };
  s.name = str(r, "name", s.name);
  if (!s.name)
    throw new BadRequest("Tên shipper không được để trống");
  s.capacity = num(r, "capacity", s.capacity);
  if (s.capacity <= 0)
    throw new BadRequest("Tải trọng phải lớn hơn 0");
  s.vehicle = vehicleFromInt(integer(r, "vehicle", s.vehicle));
  if (s.vehicle === ANY_VEHICLE)
    s.vehicle = MOTORBIKE;
  const self = has(r, "index") ? integer(r, "index") : -1;
  if (S.shippers.some((x, i) => i !== self && x.name === s.name))
    throw new BadRequest(`Đã có shipper tên '${s.name}'`);
  return s;
}
POST("shipper/add", (r) => {
  if (S.shippers.length >= 12)
    throw new BadRequest("Tối đa 12 shipper");
  S.shippers.push(readShipper(r, { name: "", capacity: 0, vehicle: MOTORBIKE }));
  mark(D_FLEET);
  audit("fleet.add", S.shippers[S.shippers.length - 1].name);
  return stateJson();
});
POST("shipper/update", (r) => {
  const i = integer(r, "index");
  if (i < 0 || i >= S.shippers.length)
    throw new BadRequest("Không có shipper này");
  const oldName = S.shippers[i].name;
  S.shippers[i] = readShipper(r, S.shippers[i]);
  if (S.shippers[i].name !== oldName) {
    S.accounts.renameLink(oldName, S.shippers[i].name);
    S.stats.rename(oldName, S.shippers[i].name);
    S.cod.renameShipper(oldName, S.shippers[i].name);
    mark(D_USERS | D_STATS | D_COD);
  }
  mark(D_FLEET | D_ORDERS);
  audit("fleet.update", S.shippers[i].name);
  return stateJson();
});
POST("shipper/remove", (r) => {
  const i = integer(r, "index");
  if (i < 0 || i >= S.shippers.length)
    throw new BadRequest("Không có shipper này");
  if (S.shift.trips.some((t) => t.shipper === i))
    throw new Conflict("Shipper đang có chuyến chưa xong, hãy thu hồi hoặc hoàn tất chuyến trước khi xoá");
  const name = S.shippers[i].name;
  S.shippers.splice(i, 1);
  S.shift.shipperRemoved(i);
  for (const o of S.orders) {
    if (o.shipper === i)
      o.shipper = -1;
    else if (o.shipper > i)
      o.shipper--;
    o.tried = o.tried.filter((x) => x !== i).map((x) => x > i ? x - 1 : x);
  }
  mark(D_FLEET | D_ORDERS);
  audit("fleet.remove", name);
  return stateJson();
});
POST("shift/available", (r) => {
  const i = integer(r, "index");
  if (i < 0 || i >= S.shippers.length)
    throw new BadRequest("Không có shipper này");
  S.shift.setAvailable(i);
  audit("shipper.available", S.shippers[i].name);
  matchPending();
  return { ...stateJson(), message: S.shippers[i].name + " có mặt trở lại" };
});
POST("shift/reroute", () => {
  if (!S.shift.active())
    throw new BadRequest("Chưa có ca giao đang chạy");
  const rep = rerouteActive();
  matchPending();
  // đơn mất đường đi quay về hàng chờ: mời shipper khác
  if (!S.notice)
    S.notice = "Các chuyến vẫn đi được như cũ, giờ tới không đổi.";
  return { ...stateJson(), reroute: rep };
});
// Đơn nặng hơn mọi xe: chia thành nhiều kiện bằng nhau, mỗi kiện vừa xe lớn nhất
POST("order/split", (r) => {
  const id = integer(r, "id");
  const pos = S.orders.findIndex((o) => o.id === id);
  if (pos < 0)
    throw new BadRequest(`Không có đơn ${id}`);
  const base = S.orders[pos];
  if (base.status !== PENDING)
    throw new Conflict("Chỉ chia được đơn đang chờ giao");
  let cap = 0;
  S.shippers.forEach((s, i) => {
    if (!S.shift.isAbsent(i))
      cap = Math.max(cap, s.capacity);
  });
  if (cap <= 0)
    throw new BadRequest("Chưa có shipper nào để chở");
  const parts = Math.max(integer(r, "parts", 0), Math.ceil(base.weight / cap - 0.000000001));
  if (parts < 2)
    throw new BadRequest(`Đơn ${id} nặng ${Math.ceil(base.weight)} kg, xe lớn nhất chở được nên không cần chia`);
  if (parts > 20)
    throw new BadRequest("Đơn quá nặng, cần hơn 20 kiện");
  let maxId = 100;
  for (const o of S.orders)
    maxId = Math.max(maxId, o.id);
  const each = Math.round(base.weight / parts * 100) / 100;
  const pieces = [];
  for (let k = 0;k < parts; k++)
    pieces.push({
      ...base,
      id: k === 0 ? base.id : ++maxId,
      weight: k === parts - 1 ? Math.round((base.weight - each * (parts - 1)) * 100) / 100 : each,
      note: `${base.note || "Kiện"} ${k + 1}/${parts} của đơn ${base.id}`,
      cod: k > 0 ? 0 : base.cod,
      declaredValue: k > 0 ? 0 : base.declaredValue,
      insuranceFee: k > 0 ? 0 : base.insuranceFee,
      dimL: 0,
      dimW: 0,
      dimH: 0,
      deliveryCode: newDeliveryCode(),
      gross: 0,
      loyaltyDiscount: 0,
      promoDiscount: 0,
      promo: ""
    });
  S.orders.splice(pos, 1, ...pieces);
  if (base.promo) {
    S.promos.giveBack(base.promo);
    mark(D_PROMOS);
  }
  mark(D_ORDERS);
  audit("order.split", String(id), `${parts} kiện`);
  return { ...stateJson(), message: `Đã chia đơn ${id} thành ${parts} kiện` };
});
// ------------------------------------------------------------ Phân tích mạng
GET("analysis", (r) => {
  const v = vehicleFromInt(integer(r, "vehicle", 0));
  const dest = S.orders.filter((o) => o.status !== CANCELLED && o.status !== RETURNED).map((o) => o.destination);
  const cr = criticalRoads(S.graph, S.depot, dest);
  const mstJson = (m) => ({ edges: m.edges.map((x) => ({ u: x.u, v: x.v, km: x.km })), km: m.km, trees: m.trees, micros: m.micros, work: m.work });
  const dr = suggestDepot(S.graph, S.depot, dest, v, 5);
  const scoreJson = (s) => ({ node: s.node, name: s.node >= 0 ? nodeName(s.node) : null, totalKm: s.totalKm, maxKm: s.maxKm, reachable: s.reachable, avgKm: s.reachable ? s.totalKm / s.reachable : 0 });
  return {
    ok: true,
    depot: S.depot,
    vehicle: vehicleName(v),
    critical: {
      bridges: cr.bridges.map((b) => ({ u: b.u, v: b.v, km: b.km, cutNodes: b.cutNodes, cutOrders: b.cutOrders })),
      articulation: cr.articulation.map((a) => ({ node: a.node, name: nodeName(a.node), parts: a.parts, cutNodes: a.cutNodes, cutOrders: a.cutOrders })),
      micros: cr.micros
    },
    mst: { kruskal: mstJson(kruskal(S.graph)), prim: mstJson(prim(S.graph)), totalKm: totalKm(S.graph) },
    depotSuggest: { ranking: dr.ranking.map(scoreJson), current: scoreJson(dr.current), center: dr.center, centerName: dr.center >= 0 ? nodeName(dr.center) : null, centerEccentricity: dr.centerEccentricity, orders: dr.orders, floyd: dr.floyd, micros: dr.micros }
  };
});
POST("shift/reset", () => {
  S.shift.reset(S.orders, true);
  mark(D_ORDERS);
  audit("shift.reset", "shift");
  for (const o of S.orders)
    if (o.status === PENDING)
      o.searchSince = nowSeconds();
  matchPending();
  return { ...stateJson(), message: "Đã đặt lại ca: các đơn chưa xong quay về chờ giao" };
});
// K tuyến ngắn nhất (Yen) — gợi ý tuyến thay thế
GET("kpaths", (r) => {
  const src = requireNode(r, "src"), dst = requireNode(r, "dst");
  const k = clamp(integer(r, "k", 3), 1, 6);
  const opt = { criterion: criterionParam(r), vehicle: vehicleParam(r), departAt: departParam(r) };
  opt.rush = opt.departAt >= 0 ? rushPtr() : null;
  const t0 = now4();
  const paths = kShortestPaths(S.graph, src, dst, k, opt);
  const us = (now4() - t0) * 1000;
  const best = new Set;
  if (paths.length)
    for (let i = 0;i + 1 < paths[0].nodes.length; i++)
      best.add(paths[0].nodes[i] + "," + paths[0].nodes[i + 1]);
  const arr = paths.map((p) => {
    const info = describePath(S.graph, p.nodes, opt.vehicle, opt.departAt, opt.rush);
    let shared = 0;
    for (let i = 0;i + 1 < p.nodes.length; i++)
      if (best.has(p.nodes[i] + "," + p.nodes[i + 1]))
        shared++;
    return { path: p.nodes, weight: p.weight, km: info.km, minutes: info.minutes, costK: info.costK, hops: info.hops, shared: p.nodes.length > 1 ? shared / (p.nodes.length - 1) : 1 };
  });
  return { ok: true, paths: arr, micros: us, criterion: criterionName(opt.criterion) };
});
// Mô phỏng từng bước một thuật toán (trang Mô phỏng)
GET("trace", (r) => {
  const algo = str(r, "algo", "dijkstra");
  if (!["dijkstra", "astar", "bfs", "dfs", "bellman"].includes(algo))
    throw new BadRequest("Thuật toán không hợp lệ: " + algo);
  const src = requireNode(r, "src");
  const dst = has(r, "dst") && str(r, "dst") !== "" ? requireNode(r, "dst") : -1;
  if (algo === "astar" && dst < 0)
    throw new BadRequest("A* cần điểm đến");
  const crit = criterionParam(r), veh = vehicleParam(r);
  const t = runTrace(S.graph, algo, src, dst, crit, veh, 4000);
  return {
    ok: true,
    algo: t.algo,
    container: t.containerKind,
    pseudo: t.pseudo,
    steps: t.steps.map((s) => ({ t: s.type, l: s.line, u: s.u, v: s.v, x: s.value, y: s.extra, c: s.container, n: s.size })),
    truncated: t.truncated,
    dist: t.dist,
    prev: t.prev,
    cycle: t.cycle,
    alpha: t.heuristicScale,
    criterion: criterionName(crit)
  };
});
// Thời gian đi theo giờ xuất phát trong ngày: tuyến nhanh nhất ở từng thời điểm so với tuyến của giờ vắng
GET("timeprofile", (r) => {
  const src = requireNode(r, "src"), dst = requireNode(r, "dst");
  const veh = vehicleParam(r);
  const step = clamp(integer(r, "step", 10), 5, 60);
  const prof = Object.assign(new RushProfile, S.rush, { enabled: true });
  const base = { criterion: TIME, vehicle: veh, target: dst };
  const usual = getPath(dijkstra(S.graph, src, MIN_HEAP, base), dst);
  if (!usual.length)
    throw new BadRequest("Không có đường đi giữa hai điểm này cho " + vehicleName(veh));
  const routes = [usual];
  const points = [];
  for (let t = 0;t < 24 * 60; t += step) {
    const tr = dijkstra(S.graph, src, MIN_HEAP, { ...base, departAt: t, rush: prof });
    const p = getPath(tr, dst);
    let idx = routes.findIndex((x) => x.join() === p.join());
    if (idx < 0) {
      routes.push(p);
      idx = routes.length - 1;
    }
    points.push({ t, minutes: tr.dist.get(dst), usual: describePath(S.graph, usual, veh, t, prof).minutes, level: prof.level(t), route: idx });
  }
  return { ok: true, points, routes, enabled: S.rush.enabled };
});
