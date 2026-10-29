// Khởi động (runWebServer của bản C++) và điểm vào handle() mà standalone/api.js gọi thay cho fetch.
// Mọi API trong bảng R phải có quy tắc phân quyền và ngược lại (như requireRule + vòng kiểm tra lúc khởi động của C++)
(function checkRoutes() {
  for (const k of Object.keys(R)) {
    const [m, p] = k.split(" ");
    if (!findRule(m, p))
      throw new Error("API chua co quy tac phan quyen: " + k);
  }
  for (const rule of RULES)
    if (!R[rule.method + " " + rule.path])
      throw new Error(`Quy tac phan quyen khong co API: ${rule.method} ${rule.path}`);
})();
// ----------------------------------------------------- Bảng phiên & mã phiên phía trình duyệt
function saveSessions() {
  lsSet(LS_SESSIONS, JSON.stringify([...S.sessions.sessions.entries()]));
}
function loadSessions() {
  try {
    const arr = JSON.parse(lsGet(LS_SESSIONS) || "[]");
    const now = nowSeconds();
    for (const [k, v] of arr)
      if (v && v.expires > now && S.accounts.find(v.username))
        S.sessions.sessions.set(k, v);
  } catch {}
  // Ghi nhớ đăng nhập -> localStorage (còn sau khi đóng trình duyệt); không thì sessionStorage (mất khi đóng tab)
  S.clientToken = ssGet(TOKEN_KEY) || lsGet(TOKEN_KEY) || "";
}
function applyCookie(c) {
  if (!c)
    return;
  S.clientToken = c.token;
  lsSet(TOKEN_KEY, c.token && c.remember ? c.token : null);
  ssSet(TOKEN_KEY, c.token && !c.remember ? c.token : null);
}
// Nạp một file dữ liệu tuỳ chọn. File lỗi được đổi tên thành .bad rồi bắt đầu lại từ rỗng.
function loadOptional(file, load) {
  const text = fileText(file);
  if (text == null)
    return;
  try {
    load(text);
  } catch (e) {
    console.warn(`[Canh bao] ${file} bi loi (${e.message}), da doi ten thanh ${file}.bad va bat dau lai tu rong`);
    lsSet(LS_PREFIX + file + ".bad", text);
    lsSet(LS_PREFIX + file, "");
  }
}
function init() {
  try {
    const t = fileText("users.txt");
    if (t == null)
      throw new Error("Khong mo duoc file users.txt");
    S.accounts.loadText(t);
  } catch (e) {
    console.warn(`[Canh bao] ${e.message} -> tao tai khoan quan tri mac dinh admin / Admin@12345 (hay doi mat khau)`);
    S.accounts = new AccountStore;
    S.accounts.create({ username: "admin", password: "Admin@12345", displayName: "Quản trị viên", role: ADMIN, createdAt: nowSeconds() });
    writeDataFile("users.txt", S.accounts.toText());
  }
  loadOptional("config.txt", (t) => CONFIG.loadText(t));
  loadOptional("promos.txt", (t) => S.promos.loadText(t));
  loadOptional("addresses.txt", (t) => S.addresses.loadText(t));
  loadOptional("reviews.txt", (t) => S.reviews.loadText(t));
  loadOptional("customer_reviews.txt", (t) => S.custReviews.loadText(t));
  loadOptional("stats.txt", (t) => S.stats.loadText(t));
  loadOptional("notifications.txt", (t) => S.notes.loadText(t));
  loadOptional("audit.txt", (t) => S.audit.loadText(t));
  loadOptional("complaints.txt", (t) => S.complaints.loadText(t));
  loadOptional("cod_ledger.txt", (t) => S.cod.loadText(t));
  loadOptional("customer_ledger.txt", (t) => S.ledger.loadText(t));
  try {
    const t = fileText("shippers.txt");
    if (t == null)
      throw new Error("Khong mo duoc file shippers.txt");
    S.shippers = loadShippersText(t);
  } catch (e) {
    console.warn(`[Canh bao] ${e.message} -> dung 2 shipper mac dinh`);
    S.shippers = [{ name: "Shipper 1", capacity: 20, vehicle: MOTORBIKE }, { name: "Shipper 2", capacity: 50, vehicle: CAR }];
  }
  try {
    loadDataset("hcm");
  } catch (e) {
    console.warn("[Canh bao] Khong nap duoc du lieu mau:", e.message);
  }
  if (lsGet("dt08.rush") === "0")
    S.rush.enabled = false;
  const ss = Number(lsGet("dt08.shiftStart"));
  if (Number.isInteger(ss) && ss > 0 && ss < 24 * 60)
    S.shiftStart = ss;
  loadSessions();
}
init();
// Lỗi nội bộ không lộ chi tiết cho người dùng (như bản C++: 500 + thông báo chung)
function internalError(e) {
  console.error(e);
  return new HttpError("Có lỗi xảy ra phía máy chủ, vui lòng thử lại sau", 500);
}
// Đồng hồ ca, lời mời hết hạn, ghép đơn chạy trước mỗi yêu cầu (như liveTick trong wrap của bản C++); lỗi không làm hỏng yêu cầu
function tickSafe() {
  try {
    liveTick();
  } catch (e) {
    console.error("[Loi] liveTick:", e);
  }
}
// Gọi một API: handle("POST", "order/add", {destination: "3", ...}) -> đối tượng JSON, hoặc ném HttpError
function handle(method, path, params = {}) {
  const f = R[method + " " + path];
  if (!f)
    throw new HttpError("Không có API /api/" + path, 404);
  try {
    authorize(method, path);
    tickSafe();
    try {
      const out = f(params);
      applyCookie(S.setCookie);
      return toPlain(out);
    } catch (e) {
      throw e instanceof HttpError ? e : internalError(e);
    } finally {
      flushDirty();
    }
  } finally {
    saveSessions();
  }
}
// Tải tệp (export/map|orders|shippers, audit/export): kiểm tra quyền như API thường, trả về nội dung văn bản
function exportText(path, params = {}) {
  const make = DOWNLOADS[path];
  if (!make)
    throw new HttpError("Không có API /api/" + path, 404);
  try {
    authorize("GET", path);
    tickSafe();
    try {
      return make(params);
    } catch (e) {
      throw e instanceof HttpError ? e : internalError(e);
    } finally {
      flushDirty();
    }
  } finally {
    saveSessions();
  }
}
