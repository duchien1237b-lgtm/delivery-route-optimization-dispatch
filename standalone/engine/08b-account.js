// Bản JavaScript của src/WebAccount.inc: đăng ký, đăng nhập, quên mật khẩu, hồ sơ, thiết bị, sổ địa chỉ, quản lý tài khoản.
// Mọi API đều có quy tắc trong bảng RULES; ở đây chỉ còn kiểm tra quyền trên DỮ LIỆU CỤ THỂ (Forbidden = 403).
// ------------------------------------------------------------ Tiện ích dùng chung
var lowerCopy = (s) => asciiLower(String(s));
var trimmed = (s) => trimWs(String(s));
function flag(r, k) {
  const v = lowerCopy(str(r, k));
  return v === "1" || v === "true" || v === "on" || v === "yes";
}
var upperAscii = (s) => s.replace(/[a-z]/g, (c) => c.toUpperCase());
function sendMail(to, subject, body) {
  if (!to)
    return;
  S.mailbox.add(to, subject, body, nowSeconds());
  console.log(`[MAIL] den ${to} | ${subject} | ${body}`);
}
// Phân trang dùng chung cho mọi danh sách: ?page=1&size=10
function paginate(r, total, defSize = 10) {
  const p = { page: 1, size: clamp(integer(r, "size", defSize), 1, 100), total, pages: 1, begin: 0, end: 0 };
  p.pages = Math.max(1, Math.floor((p.total + p.size - 1) / p.size));
  p.page = clamp(integer(r, "page", 1), 1, p.pages);
  p.begin = (p.page - 1) * p.size;
  p.end = Math.min(total, p.begin + p.size);
  return p;
}
var pageJson = (p) => ({ page: p.page, size: p.size, total: p.total, pages: p.pages });
// sort=<khoá> và dir=asc|desc ; khoá lạ -> khoá mặc định
function sortKey(r, allowed, def) {
  const k = str(r, "sort", def);
  return allowed.includes(k) ? k : def;
}
var sortDesc = (r, defDesc = false) => lowerCopy(str(r, "dir", defDesc ? "desc" : "asc")) === "desc";
// Sắp xếp ổn định với hàm so sánh trả về số (âm / 0 / dương) như std::stable_sort(less = desc ? c > 0 : c < 0)
var stableSort = (arr, cmp, desc) => arr.sort((a, b) => {
  const c = cmp(a, b);
  return desc ? -Math.sign(c) : Math.sign(c);
});
var homeOf = (role) => role === ADMIN ? "overview" : role === SHIPPER ? "myjob" : "myorders";
// Mã phiên phía trình duyệt (thay cho cookie HttpOnly của bản C++)
var sessionCookie = (token, remember) => ({ token, remember });
var clearCookie = () => ({ token: "", remember: false });
var REGISTER_LIMIT = 20;
var REGISTER_WINDOW = 3600;
// ------------------------------------------------------------ Đăng ký
function registerAccount(r) {
  const now = nowSeconds();
  if (!S.limiter.allow("reg:" + S.ip, now, REGISTER_LIMIT, REGISTER_WINDOW)) {
    const wait = S.limiter.retryAfter("reg:" + S.ip, now, REGISTER_WINDOW);
    throw new TooMany(`Bạn đăng ký quá nhiều lần, hãy thử lại sau ${Math.floor((wait + 59) / 60)} phút`, wait);
  }
  // Ô ẩn "website": người thật không thấy nên không điền; bot điền -> giả vờ thành công nhưng không tạo gì
  if (trimmed(str(r, "website"))) {
    audit("auth.register_bot", S.ip, "honeypot");
    return { ok: true, status: "active", message: "Đăng ký thành công" };
  }
  const rk = lowerCopy(trimmed(str(r, "role", "customer")));
  const role = roleFromKey(rk);
  if (role == null)
    throw new Invalid("Vui lòng chọn loại tài khoản", { role: "Chọn khách hàng hoặc shipper" });
  if (role === ADMIN) {
    audit("auth.register_denied", rk, S.ip);
    throw new Forbidden("Không thể tự đăng ký tài khoản quản trị viên");
  }
  const errors = {};
  const n = {
    role,
    username: lowerCopy(trimmed(str(r, "username"))),
    displayName: trimmed(str(r, "displayName")),
    email: normalizeEmail(str(r, "email")),
    phone: normalizePhone(str(r, "phone")),
    password: str(r, "password"),
    createdAt: now,
    status: ACC_ACTIVE,
    link: "",
    vehicle: -1,
    capacity: 0,
    plate: ""
  };
  const check = (field, e) => {
    if (e && !(field in errors))
      errors[field] = e;
  };
  check("username", checkUsername(n.username));
  if (!("username" in errors) && S.accounts.find(n.username))
    errors.username = "Tên đăng nhập đã được sử dụng";
  check("displayName", checkDisplayName(n.displayName));
  check("email", !n.email ? "Vui lòng nhập email" : checkEmail(n.email));
  if (!("email" in errors) && S.accounts.emailTaken(n.email))
    errors.email = "Email này đã được sử dụng";
  check("phone", !n.phone ? "Vui lòng nhập số điện thoại" : checkPhone(n.phone));
  if (!("phone" in errors) && S.accounts.phoneTaken(n.phone))
    errors.phone = "Số điện thoại này đã được sử dụng";
  check("password", checkPasswordStrong(n.password, n.username));
  if (!("password" in errors) && n.password !== str(r, "confirm"))
    errors.confirm = "Mật khẩu nhập lại không khớp";
  if (!flag(r, "terms"))
    errors.terms = "Bạn cần đồng ý với điều khoản sử dụng";
  if (role === SHIPPER) {
    n.status = ACC_PENDING;
    const veh = has(r, "vehicle") && str(r, "vehicle") ? num(r, "vehicle", -1) : -1;
    if (veh < 0 || veh > 2 || Math.floor(veh) !== veh)
      errors.vehicle = "Chọn loại phương tiện";
    else
      n.vehicle = veh;
    const cap = trimmed(str(r, "capacity"));
    const c = FULL_NUMBER.test(cap) ? Number(cap) : 0;
    if (!(c > 0) || c > 5000)
      errors.capacity = "Tải trọng phải từ 1 đến 5000 kg";
    else
      n.capacity = c;
    n.plate = upperAscii(trimmed(str(r, "plate")));
    check("plate", checkPlate(n.plate));
  }
  if (Object.keys(errors).length)
    throw new Invalid("Vui lòng kiểm tra lại các thông tin đã nhập", errors);
  const e = S.accounts.create(n);
  if (e)
    throw new BadRequest(e);
  mark(D_USERS);
  audit("auth.register", n.username, `${roleKey(role)} ${n.email}`);
  if (role === SHIPPER) {
    notifyStaff("account", 0, `Shipper ${n.displayName} (${n.username}) vừa đăng ký, đang chờ duyệt`);
    sendMail(n.email, "Đã nhận hồ sơ shipper", `Chào ${n.displayName}, hồ sơ shipper của bạn đang chờ duyệt. Chúng tôi sẽ báo qua email khi có kết quả.`);
    return { ok: true, status: "pending", message: "Đã gửi hồ sơ. Tài khoản shipper sẽ dùng được sau khi quản trị viên duyệt." };
  }
  sendMail(n.email, "Chào mừng đến với hệ thống giao hàng", `Chào ${n.displayName}, tài khoản khách hàng của bạn đã sẵn sàng.`);
  notify(n.username, "account", 0, "Chào mừng bạn! Hãy thêm địa chỉ giao hàng trong Hồ sơ để đặt đơn nhanh hơn.");
  return { ok: true, status: "active", message: "Đăng ký thành công. Bạn có thể đăng nhập ngay." };
}
// ------------------------------------------------------------ Đăng nhập / đăng xuất
function loginAccount(r) {
  const now = nowSeconds();
  if (!S.limiter.allow("login:" + S.ip, now, 60, 300))
    throw new TooMany("Quá nhiều lần đăng nhập từ địa chỉ này, thử lại sau ít phút", S.limiter.retryAfter("login:" + S.ip, now, 300));
  const identifier = utf8Prefix(trimmed(str(r, "username", str(r, "identifier"))), 100);
  const password = str(r, "password");
  if (!identifier || !password)
    throw new BadRequest("Hãy nhập tên đăng nhập (hoặc email, số điện thoại) và mật khẩu");
  const acct = S.accounts.resolve(identifier);
  const key = acct ? acct.username : lowerCopy(identifier);
  let wait = S.guard.lockedFor(key, now);
  if (wait)
    throw new TooMany(`Đăng nhập sai quá nhiều lần. Hãy thử lại sau ${wait} giây`, wait);
  const ok = acct ? S.accounts.verify(acct.username, password) : (hashPassword("0000000000000000", password), false);
  if (!ok) {
    S.guard.failed(key, now);
    audit("auth.login_failed", key, S.ip);
    wait = S.guard.lockedFor(key, now);
    if (wait)
      throw new TooMany(`Đăng nhập sai quá nhiều lần. Tài khoản tạm khoá đăng nhập ${wait} giây`, wait);
    throw new Unauthorized("Thông tin đăng nhập không đúng");
  }
  S.guard.succeeded(key);
  // Mật khẩu đúng rồi mới nói rõ tình trạng tài khoản
  if (acct.status === ACC_PENDING)
    throw new Forbidden("Tài khoản của bạn đang chờ duyệt. Bạn sẽ nhận được thông báo qua email khi được duyệt.");
  if (acct.status === ACC_LOCKED)
    throw new Forbidden("Tài khoản đã bị khoá" + (acct.statusReason ? ": " + acct.statusReason : "") + ". Hãy liên hệ quản trị viên.");
  if (acct.status === ACC_DISABLED)
    throw new Forbidden("Tài khoản đã bị vô hiệu hoá" + (acct.statusReason ? ": " + acct.statusReason : "") + ".");
  if (S.token)
    S.sessions.remove(S.token);
  const meta = { remember: flag(r, "remember"), device: S.device, ip: S.ip };
  S.token = S.sessions.create(acct.username, now, meta);
  S.accounts.touchLogin(acct.username, now);
  mark(D_USERS);
  S.me = { ...S.accounts.find(acct.username) };
  S.authed = true;
  S.csrf = S.sessions.csrf(S.token);
  S.setCookie = sessionCookie(S.token, meta.remember);
  audit("auth.login", S.me.username, S.device);
  const out = { ok: true, user: meJson(), home: homeOf(S.me.role) };
  if (flag(r, "bearer"))
    out.token = S.token;
  return out;
}
// ------------------------------------------------------------ Quên / đặt lại mật khẩu
function forgotPassword(r) {
  const now = nowSeconds();
  const email = normalizeEmail(str(r, "email"));
  if (!S.limiter.allow("forgot:" + S.ip, now, 5, 900))
    throw new TooMany("Bạn yêu cầu mã quá nhiều lần, hãy thử lại sau ít phút", S.limiter.retryAfter("forgot:" + S.ip, now, 900));
  if (!S.limiter.allow("forgot-to:" + email, now, 3, 900))
    throw new TooMany("Email này vừa được gửi mã, hãy kiểm tra hộp thư hoặc thử lại sau ít phút", S.limiter.retryAfter("forgot-to:" + email, now, 900));
  const e = checkEmail(email);
  if (e)
    throw new Invalid(e, { email: e });
  const a = S.accounts.findByEmail(email);
  if (a && a.status === ACC_ACTIVE) {
    const otp = S.resets.issue(a.username, now);
    sendMail(a.email, "Mã đặt lại mật khẩu", `Mã của bạn là ${otp}. Mã có hiệu lực ${RESET_MINUTES} phút và chỉ dùng được một lần. Nếu không phải bạn yêu cầu, hãy bỏ qua email này.`);
    audit("auth.password_forgot", a.username, S.ip);
  }
  // Luôn trả lời giống nhau dù email có tồn tại hay không
  return { ok: true, demo: S.demo, message: `Nếu email này thuộc một tài khoản, mã đặt lại mật khẩu đã được gửi. Mã có hiệu lực ${RESET_MINUTES} phút.` };
}
function resetPassword(r) {
  const now = nowSeconds();
  if (!S.limiter.allow("reset:" + S.ip, now, 15, 900))
    throw new TooMany("Bạn thử quá nhiều lần, hãy thử lại sau ít phút", S.limiter.retryAfter("reset:" + S.ip, now, 900));
  const email = normalizeEmail(str(r, "email"));
  const otp = trimmed(str(r, "otp"));
  const pass = str(r, "password");
  const a = S.accounts.findByEmail(email);
  // Kiểm tra mật khẩu mới TRƯỚC khi tiêu mã
  let e = checkPasswordStrong(pass, a ? a.username : "");
  if (e)
    throw new Invalid(e, { password: e });
  if (pass !== str(r, "confirm"))
    throw new Invalid("Mật khẩu nhập lại không khớp", { confirm: "Mật khẩu nhập lại không khớp" });
  const generic = "Mã không đúng hoặc đã hết hạn";
  if (!a || a.status !== ACC_ACTIVE)
    throw new BadRequest(generic);
  switch (S.resets.verify(a.username, otp, now)) {
    case RESET_OK:
      break;
    case RESET_EXPIRED:
      throw new BadRequest("Mã đã hết hạn, hãy yêu cầu mã mới");
    case RESET_USED:
      throw new BadRequest("Mã này đã được sử dụng, hãy yêu cầu mã mới");
    case RESET_TOO_MANY:
      throw new BadRequest("Nhập sai quá nhiều lần, hãy yêu cầu mã mới");
    default:
      throw new BadRequest(generic);
  }
  e = S.accounts.setPassword(a.username, pass);
  if (e)
    throw new BadRequest(e);
  S.sessions.revokeUser(a.username);
  S.guard.succeeded(a.username);
  S.resets.invalidate(a.username);
  mark(D_USERS);
  audit("auth.password_reset", a.username, S.ip);
  notify(a.username, "account", 0, "Mật khẩu của bạn vừa được đặt lại. Nếu không phải bạn, hãy liên hệ quản trị viên.");
  sendMail(a.email, "Mật khẩu đã được thay đổi", `Mật khẩu tài khoản ${a.username} vừa được đặt lại. Mọi thiết bị đã bị đăng xuất.`);
  return { ok: true, message: "Đã đặt lại mật khẩu. Hãy đăng nhập bằng mật khẩu mới." };
}
function mailboxJson(r) {
  if (!S.demo)
    throw new Forbidden("Hộp thư giả lập chỉ có ở chế độ demo");
  const now = nowSeconds();
  if (!S.limiter.allow("mailbox:" + S.ip, now, 60, 60))
    throw new TooMany("Bạn tải hộp thư quá nhanh", 30);
  const email = normalizeEmail(str(r, "email"));
  const mails = S.mailbox.to(email).slice(0, 20).map((m) => ({ at: m.at, subject: m.subject, body: m.body }));
  return { ok: true, email, mails };
}
// ------------------------------------------------------------ Hồ sơ cá nhân
function profileJson() {
  const j = { ok: true, user: meJson(), sessions: S.sessions.list(S.me.username, S.token).length };
  if (isCustomer())
    j.addresses = S.addresses.of(S.me.username).length;
  return j;
}
function updateProfile(r) {
  const name = trimmed(str(r, "displayName", S.me.displayName));
  const email = normalizeEmail(str(r, "email", S.me.email));
  const phone = normalizePhone(str(r, "phone", S.me.phone));
  const errors = {};
  const put = (f, e) => {
    if (e)
      errors[f] = e;
  };
  put("displayName", checkDisplayName(name));
  put("email", !email ? "Vui lòng nhập email" : checkEmail(email));
  if (!("email" in errors) && S.accounts.emailTaken(email, S.me.username))
    errors.email = "Email này đã được sử dụng";
  put("phone", !phone ? "Vui lòng nhập số điện thoại" : checkPhone(phone));
  if (!("phone" in errors) && S.accounts.phoneTaken(phone, S.me.username))
    errors.phone = "Số điện thoại này đã được sử dụng";
  if (Object.keys(errors).length)
    throw new Invalid("Vui lòng kiểm tra lại thông tin", errors);
  const e = S.accounts.updateProfile(S.me.username, name, email, phone);
  if (e)
    throw new BadRequest(e);
  mark(D_USERS);
  audit("profile.update", S.me.username, (S.me.email !== email ? "đổi email " : "") + (S.me.phone !== phone ? "đổi SĐT" : ""));
  S.me = { ...S.accounts.find(S.me.username) };
  return { ok: true, user: meJson(), message: "Đã cập nhật hồ sơ" };
}
function changePassword(r) {
  if (!S.accounts.verify(S.me.username, str(r, "old")))
    throw new Invalid("Mật khẩu hiện tại không đúng", { old: "Mật khẩu hiện tại không đúng" });
  const pass = str(r, "new");
  let e = checkPasswordStrong(pass, S.me.username);
  if (e)
    throw new Invalid(e, { new: e });
  if (pass === str(r, "old"))
    throw new Invalid("Mật khẩu mới phải khác mật khẩu cũ", { new: "Mật khẩu mới phải khác mật khẩu cũ" });
  if (has(r, "confirm") && pass !== str(r, "confirm"))
    throw new Invalid("Mật khẩu nhập lại không khớp", { confirm: "Mật khẩu nhập lại không khớp" });
  e = S.accounts.setPassword(S.me.username, pass);
  if (e)
    throw new BadRequest(e);
  const out = S.sessions.revokeOthers(S.me.username, S.token);
  mark(D_USERS);
  audit("auth.password_change", S.me.username, `${out} phiên khác bị đăng xuất`);
  sendMail(S.me.email, "Mật khẩu đã được thay đổi", `Mật khẩu tài khoản ${S.me.username} vừa được đổi.`);
  return { ok: true, message: "Đã đổi mật khẩu" + (out ? `; ${out} thiết bị khác đã bị đăng xuất` : "") };
}
var sessionsJson = () => ({ ok: true, sessions: S.sessions.list(S.me.username, S.token).map((s) => ({ sid: s.sid, device: s.device, ip: s.ip, created: s.created, lastSeen: s.lastSeen, remember: s.remember, current: s.current })) });
// ------------------------------------------------------------ Sổ địa chỉ (khách hàng)
var addressJson = (a) => ({ id: a.id, label: a.label, recipient: a.recipient, phone: a.phone, detail: a.detail, node: a.node, nodeName: nodeName(a.node), isDefault: a.isDefault });
var addressesJson = () => ({ ok: true, addresses: S.addresses.of(S.me.username).map(addressJson), max: MAX_ADDRESSES });
function readAddress(r, a0) {
  const a = { ...a0 };
  a.owner = S.me.username;
  a.label = trimmed(str(r, "label", a.label));
  a.recipient = trimmed(str(r, "recipient", a.recipient));
  a.phone = normalizePhone(str(r, "phone", a.phone));
  a.detail = trimmed(str(r, "detail", a.detail));
  a.node = integer(r, "node", a.node);
  if (!S.graph.hasNode(a.node))
    throw new Invalid("Hãy chọn điểm giao trên bản đồ", { node: "Hãy chọn điểm giao trên bản đồ" });
  return a;
}
var newAddress = () => ({ id: 0, owner: "", label: "", recipient: "", phone: "", detail: "", node: -1, isDefault: false });
// Địa chỉ phải là của chính người gọi (anti-IDOR): không có -> 400, của người khác -> 403
function ownAddress(id) {
  const a = S.addresses.find(id);
  if (!a)
    throw new BadRequest("Không có địa chỉ này");
  if (a.owner !== S.me.username)
    throw new Forbidden("Địa chỉ này không thuộc về bạn");
  return a;
}
// ------------------------------------------------------------ Shipper tự quản lý
function shipperStatsJson(name) {
  const st = S.stats.get(name);
  const { avg, count } = S.reviews.average(name);
  return {
    ok: true,
    name,
    delivered: st.delivered,
    onTime: st.onTime,
    onTimeRate: st.delivered ? 100 * st.onTime / st.delivered : 100,
    failed: st.failed,
    accepted: st.accepted,
    declines: st.declines,
    income: st.income,
    rating: count ? avg : null,
    ratings: count,
    score: shipperScore(name),
    codHeld: S.cod.held(name),
    codAwaiting: S.cod.awaiting(name)
  };
}
// ------------------------------------------------------------ Quản lý tài khoản (nhân viên)
// Chỉ quản trị viên quản lý tài khoản (đã bỏ vai trò điều phối viên)
var staffMayManage = () => isAdmin();
function usersListJson(r) {
  let rows = S.accounts.all().filter(staffMayManage);
  const byStatus = new Map, byRole = new Map;
  for (const a of rows) {
    byStatus.set(statusKey(a.status), (byStatus.get(statusKey(a.status)) || 0) + 1);
    byRole.set(roleKey(a.role), (byRole.get(roleKey(a.role)) || 0) + 1);
  }
  const role = lowerCopy(str(r, "role")), status = lowerCopy(str(r, "status")), q = trimmed(str(r, "q"));
  if (role)
    rows = rows.filter((a) => roleKey(a.role) === role);
  if (status)
    rows = rows.filter((a) => statusKey(a.status) === status);
  if (q) {
    const idx = new TextIndex;
    rows.forEach((a, i) => idx.add(i, `${a.username} ${a.displayName} ${a.email} ${a.phone}`));
    const hit = new Set(idx.search(q));
    rows = rows.filter((_, i) => hit.has(i));
  }
  const key = sortKey(r, ["name", "username", "created", "login", "role", "status"], "created");
  const desc = sortDesc(r, key === "created" || key === "login");
  stableSort(rows, (a, b) => {
    if (key === "name")
      return byteCompare(normalizeVi(a.displayName), normalizeVi(b.displayName));
    if (key === "username")
      return byteCompare(a.username, b.username);
    if (key === "created")
      return a.createdAt - b.createdAt;
    if (key === "login")
      return a.lastLogin - b.lastLogin;
    if (key === "role")
      return a.role - b.role;
    return a.status - b.status;
  }, desc);
  const p = paginate(r, rows.length);
  const users = rows.slice(p.begin, p.end).map((a) => ({
    ...accountJson(a),
    orders: S.orders.filter((o) => o.owner === a.username).length,
    linkOk: a.role !== SHIPPER || shipperIndexByName(a.link) >= 0 || a.status === ACC_PENDING,
    self: a.username === S.me.username,
    manage: isAdmin() || a.role === CUSTOMER || a.role === SHIPPER
  }));
  const sorted = (m) => Object.fromEntries([...m.entries()].sort((x, y) => byteCompare(x[0], y[0])));
  return { ok: true, users, page: pageJson(p), byStatus: sorted(byStatus), byRole: sorted(byRole) };
}
// Hàng chờ duyệt shipper: Min-Heap theo thời điểm đăng ký (ai đăng ký trước được duyệt trước)
function approvalQueueJson() {
  const heap = new MinHeap((a, b) => a.created !== b.created ? a.created < b.created : byteCompare(a.username, b.username) < 0);
  for (const a of S.accounts.all())
    if (a.status === ACC_PENDING && staffMayManage(a))
      heap.push({ created: a.createdAt, username: a.username });
  const queue = [];
  let pos = 0;
  while (!heap.empty()) {
    const it = heap.pop();
    queue.push({ ...accountJson(S.accounts.find(it.username)), position: ++pos });
  }
  return { ok: true, queue };
}
// Thêm shipper đã được duyệt vào đội xe; trả về tên trong đội xe
function enrollShipper(a) {
  if (a.link && shipperIndexByName(a.link) >= 0)
    return a.link;
  if (S.shippers.length >= 12)
    throw new Conflict("Đội xe đã đủ 12 shipper, hãy xoá bớt shipper không dùng trước khi duyệt thêm");
  const sh = { name: a.displayName, capacity: a.capacity > 0 ? a.capacity : 20, vehicle: a.vehicle >= 0 ? vehicleFromInt(a.vehicle) : MOTORBIKE };
  if (shipperIndexByName(sh.name) >= 0)
    sh.name += ` (${a.username})`;
  if (sh.vehicle === ANY_VEHICLE)
    sh.vehicle = MOTORBIKE;
  S.shippers.push(sh);
  mark(D_FLEET);
  audit("fleet.add", sh.name, "duyệt hồ sơ " + a.username);
  return sh.name;
}
function changeStatus(r) {
  const user = lowerCopy(trimmed(str(r, "username")));
  const t = S.accounts.find(user);
  if (!t)
    throw new BadRequest(`Không có tài khoản '${user}'`);
  if (!staffMayManage(t))
    throw new Forbidden("Chỉ quản trị viên quản lý tài khoản");
  if (t.username === S.me.username)
    throw new Conflict("Bạn không thể tự đổi trạng thái tài khoản của chính mình");
  const to = statusFromKey(lowerCopy(str(r, "status")));
  if (to == null)
    throw new BadRequest("Trạng thái phải là active, locked hoặc disabled");
  if (to === ACC_PENDING)
    throw new BadRequest("Không đưa tài khoản về trạng thái chờ duyệt");
  const from = t.status;
  if (from === to)
    throw new Conflict("Tài khoản đã ở trạng thái " + statusName(to));
  if (!statusTransitionAllowed(from, to))
    throw new Conflict(`Không thể chuyển tài khoản từ '${statusName(from)}' sang '${statusName(to)}'`);
  const reason = trimmed(str(r, "reason"));
  const needReason = to === ACC_LOCKED || to === ACC_DISABLED;
  if (needReason && blen(reason) < 3)
    throw new Invalid("Hãy nhập lý do", { reason: "Hãy nhập lý do (ít nhất 3 ký tự)" });
  let link = t.link;
  if (from === ACC_PENDING && to === ACC_ACTIVE && t.role === SHIPPER)
    link = enrollShipper(t);
  const e = S.accounts.setStatus(user, to, reason);
  if (e)
    throw new Conflict(e);
  if (link !== t.link)
    S.accounts.setLink(user, link);
  if (to !== ACC_ACTIVE)
    S.sessions.revokeUser(user);
  mark(D_USERS);
  const after = S.accounts.find(user);
  const approve = from === ACC_PENDING && to === ACC_ACTIVE, reject = from === ACC_PENDING && to === ACC_DISABLED;
  const verb = approve ? "duyệt" : reject ? "từ chối" : to === ACC_LOCKED ? "khoá" : to === ACC_DISABLED ? "vô hiệu hoá" : "mở khoá";
  audit("user.status", user, `${statusKey(from)} -> ${statusKey(to)}` + (reason ? ": " + reason : ""));
  const msg = approve ? "Hồ sơ shipper của bạn đã được duyệt. Bạn có thể đăng nhập và nhận chuyến." : reject ? "Hồ sơ shipper của bạn chưa được duyệt: " + reason : to === ACC_LOCKED ? "Tài khoản của bạn đã bị khoá: " + reason : to === ACC_DISABLED ? "Tài khoản của bạn đã bị vô hiệu hoá: " + reason : "Tài khoản của bạn đã được mở khoá.";
  sendMail(after.email, approve ? "Hồ sơ shipper đã được duyệt" : "Thay đổi trạng thái tài khoản", msg);
  return { ok: true, user: accountJson(after), message: `Đã ${verb} tài khoản ${user}` };
}
function adminAddUser(r) {
  const n = {
    username: lowerCopy(trimmed(str(r, "username"))),
    password: str(r, "password"),
    displayName: trimmed(str(r, "displayName")),
    email: str(r, "email"),
    phone: str(r, "phone"),
    link: trimmed(str(r, "link")),
    createdAt: nowSeconds(),
    status: ACC_ACTIVE,
    vehicle: -1,
    capacity: 0,
    plate: "",
    role: roleFromKey(lowerCopy(str(r, "role")))
  };
  if (n.role == null)
    throw new Invalid("Vai trò phải là admin, shipper hoặc customer", { role: "Chọn vai trò" });
  if (!n.displayName)
    n.displayName = n.username;
  let e = checkPasswordStrong(n.password, n.username);
  if (e)
    throw new Invalid(e, { password: e });
  if (n.role === SHIPPER) {
    if (shipperIndexByName(n.link) < 0)
      throw new Invalid(`Không có shipper tên '${n.link}' trong đội xe`, { link: "Chọn một shipper trong đội xe" });
    if (S.accounts.all().some((a) => a.role === SHIPPER && a.link === n.link))
      throw new Invalid("Shipper này đã có tài khoản", { link: "Shipper này đã có tài khoản" });
  }
  e = S.accounts.create(n);
  if (e)
    throw new BadRequest(e);
  mark(D_USERS);
  audit("user.create", n.username, roleKey(n.role));
  return { ok: true, message: "Đã tạo tài khoản " + n.username };
}
function adminUpdateUser(r) {
  const user = lowerCopy(trimmed(str(r, "username")));
  const before = S.accounts.find(user);
  if (!before)
    throw new BadRequest(`Không có tài khoản '${user}'`);
  const oldRole = before.role;
  const old = { ...before };
  const role = roleFromKey(lowerCopy(str(r, "role", roleKey(oldRole))));
  if (role == null)
    throw new BadRequest("Vai trò không hợp lệ");
  const link = trimmed(str(r, "link", old.link));
  if (role === SHIPPER && shipperIndexByName(link) < 0)
    throw new BadRequest(`Không có shipper tên '${link}' trong đội xe`);
  if (user === S.me.username && role !== ADMIN)
    throw new Conflict("Không tự bỏ quyền quản trị của chính mình");
  const name = trimmed(str(r, "displayName", old.displayName));
  let e = S.accounts.update(user, role, link, name);
  if (e)
    throw new BadRequest(e);
  if (has(r, "email") || has(r, "phone")) {
    e = S.accounts.updateProfile(user, name, str(r, "email", old.email), str(r, "phone", old.phone));
    if (e)
      throw new BadRequest(e);
  }
  const pass = str(r, "password");
  if (pass) {
    e = checkPasswordStrong(pass, user);
    if (e)
      throw new Invalid(e, { password: e });
    S.accounts.setPassword(user, pass);
  }
  if ((role !== oldRole || pass) && user !== S.me.username)
    S.sessions.revokeUser(user);
  mark(D_USERS);
  audit("user.update", user, (role !== oldRole ? "đổi vai trò " : "") + (pass ? "đặt lại mật khẩu" : ""));
  return { ok: true, message: "Đã cập nhật tài khoản " + user };
}
function adminRemoveUser(r) {
  const user = lowerCopy(trimmed(str(r, "username")));
  if (user === S.me.username)
    throw new Conflict("Không tự xoá tài khoản đang đăng nhập");
  const e = S.accounts.remove(user);
  if (e)
    throw new BadRequest(e);
  S.sessions.revokeUser(user);
  S.addresses.removeOwner(user);
  mark(D_USERS | D_ADDR);
  audit("user.remove", user);
  return { ok: true, message: "Đã xoá tài khoản " + user };
}
// ------------------------------------------------------------ Đăng ký các tuyến
POST("login", (r) => loginAccount(r));
POST("logout", () => {
  if (S.authed)
    audit("auth.logout", S.me.username, S.device);
  if (S.token)
    S.sessions.remove(S.token);
  S.setCookie = clearCookie();
  return { ok: true };
});
GET("me", () => ({ ok: true, user: meJson(), rev: S.rev }));
// rev đổi khi dữ liệu đổi: giao diện chỉ tải lại state khi cần
POST("register", (r) => registerAccount(r));
POST("password/forgot", (r) => forgotPassword(r));
POST("password/reset", (r) => resetPassword(r));
GET("mailbox", (r) => mailboxJson(r));
POST("me/password", (r) => changePassword(r));
GET("profile", () => profileJson());
POST("profile/update", (r) => updateProfile(r));
GET("sessions", () => sessionsJson());
POST("sessions/revoke", (r) => {
  const sid = str(r, "sid");
  if (sid === SessionStore.sidOf(S.token)) {
    S.sessions.remove(S.token);
    S.setCookie = clearCookie();
    audit("auth.logout", S.me.username, "thiết bị hiện tại");
    return { ok: true, message: "Đã đăng xuất thiết bị này" };
  }
  if (!S.sessions.revokeSid(S.me.username, sid))
    throw new BadRequest("Không có thiết bị này");
  audit("auth.session_revoke", S.me.username, sid);
  return { ...sessionsJson(), message: "Đã đăng xuất thiết bị" };
});
POST("sessions/revoke-others", () => {
  const n = S.sessions.revokeOthers(S.me.username, S.token);
  audit("auth.session_revoke", S.me.username, `tất cả thiết bị khác (${n})`);
  return { ...sessionsJson(), message: `Đã đăng xuất ${n} thiết bị khác` };
});
// ---- Sổ địa chỉ
GET("addresses", () => addressesJson());
POST("addresses/add", (r) => {
  const a = readAddress(r, newAddress());
  const first = S.addresses.of(S.me.username).length === 0;
  const { error, id } = S.addresses.add(a);
  if (error)
    throw new BadRequest(error);
  if (first || flag(r, "default"))
    S.addresses.setDefault(id, S.me.username);
  mark(D_ADDR);
  return { ...addressesJson(), message: "Đã thêm địa chỉ", created: id };
});
POST("addresses/update", (r) => {
  const id = integer(r, "id");
  const a = readAddress(r, ownAddress(id));
  const e = S.addresses.update(id, S.me.username, a);
  if (e)
    throw new BadRequest(e);
  if (flag(r, "default"))
    S.addresses.setDefault(id, S.me.username);
  mark(D_ADDR);
  return { ...addressesJson(), message: "Đã cập nhật địa chỉ" };
});
POST("addresses/remove", (r) => {
  const id = integer(r, "id");
  ownAddress(id);
  const e = S.addresses.remove(id, S.me.username);
  if (e)
    throw new BadRequest(e);
  mark(D_ADDR);
  return { ...addressesJson(), message: "Đã xoá địa chỉ" };
});
POST("addresses/default", (r) => {
  const id = integer(r, "id");
  ownAddress(id);
  const e = S.addresses.setDefault(id, S.me.username);
  if (e)
    throw new BadRequest(e);
  mark(D_ADDR);
  return { ...addressesJson(), message: "Đã đặt địa chỉ mặc định" };
});
// ---- Shipper
POST("shipper/ready", (r) => {
  const ready = flag(r, "ready");
  S.accounts.setReady(S.me.username, ready);
  mark(D_USERS);
  audit("shipper.ready", S.me.username, ready ? "sẵn sàng" : "tạm nghỉ");
  S.me = { ...S.accounts.find(S.me.username) };
  const idx = myShipperIndex();
  if (!ready && idx >= 0)
    withdrawOffers(idx, "Shipper tắt sẵn sàng");
  matchPending();
  return { ok: true, user: meJson(), message: ready ? "Bạn đã sẵn sàng nhận đơn, hệ thống sẽ gửi đơn gần bạn nhất" : "Bạn đã tạm nghỉ, hệ thống sẽ không gửi đơn cho bạn" };
});
POST("shipper/vehicle", (r) => {
  const veh = integer(r, "vehicle", S.me.vehicle);
  const cap = num(r, "capacity", S.me.capacity);
  const plate = upperAscii(trimmed(str(r, "plate", S.me.plate)));
  const idx = myShipperIndex();
  if (idx >= 0 && S.shift.busy(idx, S.orders))
    throw new Conflict("Bạn đang có đơn chưa xong, hãy đổi thông tin xe sau khi giao xong");
  const e = S.accounts.setShipperInfo(S.me.username, veh, cap, plate);
  if (e)
    throw new Invalid(e, { vehicle: e });
  if (idx >= 0) {
    S.shippers[idx].capacity = cap;
    S.shippers[idx].vehicle = vehicleFromInt(veh);
    if (S.shippers[idx].vehicle === ANY_VEHICLE)
      S.shippers[idx].vehicle = MOTORBIKE;
  }
  mark(D_USERS);
  audit("shipper.vehicle", S.me.username, plate);
  S.me = { ...S.accounts.find(S.me.username) };
  return { ok: true, user: meJson(), message: "Đã cập nhật thông tin xe" };
});
// Vị trí shipper đang đứng khi rảnh: hệ thống dựa vào đây để chọn người gần kho nhất (như GPS trên app Grab)
POST("shipper/location", (r) => {
  const idx = myShipperIndex();
  if (idx < 0)
    throw new BadRequest("Tài khoản chưa gắn với shipper trong đội xe");
  const node = integer(r, "node", -1);
  if (!S.graph.hasNode(node))
    throw new Invalid("Hãy chọn một điểm trên bản đồ", { node: "Điểm không tồn tại" });
  if (S.shift.busy(idx, S.orders))
    throw new Conflict("Bạn đang có đơn chưa xong, vị trí được cập nhật theo hành trình");
  S.accounts.setHome(S.me.username, node);
  S.shift.setStandby(idx, node);
  mark(D_USERS);
  audit("shipper.location", S.me.username, nodeName(node));
  S.me = { ...S.accounts.find(S.me.username) };
  matchPending();
  return { ok: true, user: meJson(), node, message: "Đã cập nhật vị trí của bạn: " + nodeName(node) };
});
GET("shipper/stats", (r) => {
  const name = isShipper() ? S.me.link : trimmed(str(r, "name"));
  if (!name || shipperIndexByName(name) < 0)
    throw new BadRequest("Chọn một shipper trong đội xe");
  return shipperStatsJson(name);
});
// ---- Quản lý tài khoản
GET("users", (r) => usersListJson(r));
GET("users/queue", () => approvalQueueJson());
POST("users/add", (r) => adminAddUser(r));
POST("users/update", (r) => adminUpdateUser(r));
POST("users/remove", (r) => adminRemoveUser(r));
POST("users/status", (r) => changeStatus(r));
