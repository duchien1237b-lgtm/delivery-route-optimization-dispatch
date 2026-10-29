// ============================================================================
// WebAccount.inc — API tài khoản: đăng ký, đăng nhập, quên mật khẩu, hồ sơ, thiết bị, sổ địa chỉ, quản lý tài khoản.
// File này được #include vào WebServer.cpp (trong namespace ẩn danh) để dùng chung trạng thái S và các hàm bọc wrap().
//
// Nguyên tắc: mọi API đều có quy tắc trong bảng Auth::rules(); ở đây chỉ còn kiểm tra quyền trên DỮ LIỆU CỤ THỂ
// (đúng chủ sở hữu, đúng phạm vi vai trò) và ném Forbidden (403) khi vi phạm.
// ============================================================================

int matchPending();                                           // WebOrders.inc: ghép đơn tự động
void withdrawOffers(int shipperIdx, const std::string& why);   // WebOrders.inc: gỡ lời mời chưa trả lời

// ------------------------------------------------------------ Tiện ích dùng chung
std::string lowerCopy(std::string s) {
    for (char& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}
std::string trimmed(const std::string& s) { return TextUtil::trim(s); }
bool flag(const httplib::Request& r, const char* k) {
    std::string v = lowerCopy(str(r, k));
    return v == "1" || v == "true" || v == "on" || v == "yes";
}

void sendMail(const std::string& to, const std::string& subject, const std::string& body) {
    if (to.empty()) return;
    S.mailbox.add(to, subject, body, nowSeconds());
    std::cout << "[MAIL] den " << to << " | " << subject << " | " << body << std::endl;
}

// Phân trang dùng chung cho mọi danh sách: ?page=1&size=10
struct PageInfo {
    int page = 1, size = 10, total = 0, pages = 1;
    size_t begin = 0, end = 0;
};
PageInfo paginate(const httplib::Request& r, size_t total, int defSize = 10) {
    PageInfo p;
    p.size = std::clamp(integer(r, "size", defSize), 1, 100);
    p.total = static_cast<int>(total);
    p.pages = std::max(1, (p.total + p.size - 1) / p.size);
    p.page = std::clamp(integer(r, "page", 1), 1, p.pages);
    p.begin = static_cast<size_t>(p.page - 1) * p.size;
    p.end = std::min(total, p.begin + p.size);
    return p;
}
Json pageJson(const PageInfo& p) {
    return Json::object().set("page", p.page).set("size", p.size).set("total", p.total).set("pages", p.pages);
}
// sort=<khoá> và dir=asc|desc ; khoá lạ -> khoá mặc định
std::string sortKey(const httplib::Request& r, std::initializer_list<const char*> allowed, const char* def) {
    std::string k = str(r, "sort", def);
    for (const char* a : allowed)
        if (k == a) return k;
    return def;
}
bool sortDesc(const httplib::Request& r, bool defDesc = false) {
    std::string d = lowerCopy(str(r, "dir", defDesc ? "desc" : "asc"));
    return d == "desc";
}

const char* homeOf(Auth::Role role) {
    switch (role) {
        case Auth::ADMIN: return "overview";
        case Auth::SHIPPER: return "myjob";
        default: return "myorders";
    }
}

std::string sessionCookie(const std::string& token, bool remember) {
    std::string c = std::string(SESSION_COOKIE) + "=" + token + "; Path=/; HttpOnly; SameSite=Strict";
    if (remember) c += "; Max-Age=" + std::to_string(Auth::REMEMBER_DAYS * 86400);
    return c;
}
std::string clearCookie() { return std::string(SESSION_COOKIE) + "=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"; }

// Đăng ký không được quá 20 lần mỗi giờ từ một địa chỉ IP (kể cả lần nhập sai) — chống spam
const int REGISTER_LIMIT = 20;
const int REGISTER_WINDOW = 3600;

// ------------------------------------------------------------ Đăng ký
Json registerAccount(const httplib::Request& r) {
    int64_t now = nowSeconds();
    if (!S.limiter.allow("reg:" + S.ip, now, REGISTER_LIMIT, REGISTER_WINDOW))
        throw TooMany("Bạn đăng ký quá nhiều lần, hãy thử lại sau " + std::to_string((S.limiter.retryAfter("reg:" + S.ip, now, REGISTER_WINDOW) + 59) / 60) + " phút",
                      S.limiter.retryAfter("reg:" + S.ip, now, REGISTER_WINDOW));
    // Ô ẩn "website": người thật không thấy nên không điền; bot điền -> giả vờ thành công nhưng không tạo gì
    if (!trimmed(str(r, "website")).empty()) {
        audit("auth.register_bot", S.ip, "honeypot");
        return Json::object().set("ok", true).set("status", "active").set("message", "Đăng ký thành công");
    }
    std::string roleKey = lowerCopy(trimmed(str(r, "role", "customer")));
    Auth::Role role;
    if (!Auth::roleFromKey(roleKey, role)) throw Invalid("Vui lòng chọn loại tài khoản", {{"role", "Chọn khách hàng hoặc shipper"}});
    if (role == Auth::ADMIN) {
        audit("auth.register_denied", roleKey, S.ip);
        throw Forbidden("Không thể tự đăng ký tài khoản quản trị viên");
    }
    std::map<std::string, std::string> errors;
    Auth::NewAccount n;
    n.role = role;
    n.username = lowerCopy(trimmed(str(r, "username")));
    n.displayName = trimmed(str(r, "displayName"));
    n.email = Auth::normalizeEmail(str(r, "email"));
    n.phone = Auth::normalizePhone(str(r, "phone"));
    n.password = str(r, "password");
    n.createdAt = now;
    auto check = [&](const char* field, const std::string& e) {
        if (!e.empty() && !errors.count(field)) errors[field] = e;
    };
    check("username", Auth::checkUsername(n.username));
    if (!errors.count("username") && S.accounts.find(n.username)) errors["username"] = "Tên đăng nhập đã được sử dụng";
    check("displayName", Auth::checkDisplayName(n.displayName));
    check("email", n.email.empty() ? "Vui lòng nhập email" : Auth::checkEmail(n.email));
    if (!errors.count("email") && S.accounts.emailTaken(n.email)) errors["email"] = "Email này đã được sử dụng";
    check("phone", n.phone.empty() ? "Vui lòng nhập số điện thoại" : Auth::checkPhone(n.phone));
    if (!errors.count("phone") && S.accounts.phoneTaken(n.phone)) errors["phone"] = "Số điện thoại này đã được sử dụng";
    check("password", Auth::checkPasswordStrong(n.password, n.username));
    if (!errors.count("password") && n.password != str(r, "confirm")) errors["confirm"] = "Mật khẩu nhập lại không khớp";
    if (!flag(r, "terms")) errors["terms"] = "Bạn cần đồng ý với điều khoản sử dụng";
    if (role == Auth::SHIPPER) {
        n.status = Auth::PENDING;
        double veh = has(r, "vehicle") && !str(r, "vehicle").empty() ? num(r, "vehicle", -1) : -1;
        if (veh < 0 || veh > 2 || std::floor(veh) != veh) errors["vehicle"] = "Chọn loại phương tiện";
        else n.vehicle = static_cast<int>(veh);
        std::string cap = trimmed(str(r, "capacity"));
        double c = 0;
        try { size_t used = 0; c = std::stod(cap, &used); if (used != cap.size()) c = 0; } catch (...) { c = 0; }
        if (!(c > 0) || c > 5000) errors["capacity"] = "Tải trọng phải từ 1 đến 5000 kg";
        else n.capacity = c;
        n.plate = trimmed(str(r, "plate"));
        for (char& ch : n.plate) ch = static_cast<char>(std::toupper(static_cast<unsigned char>(ch)));
        check("plate", Auth::checkPlate(n.plate));
    }
    if (!errors.empty()) throw Invalid("Vui lòng kiểm tra lại các thông tin đã nhập", errors);
    std::string e = S.accounts.create(n);
    if (!e.empty()) throw BadRequest(e);   // chỉ xảy ra khi hai người đăng ký trùng nhau cùng lúc
    mark(D_USERS);
    audit("auth.register", n.username, std::string(Auth::roleKey(role)) + " " + n.email);
    if (role == Auth::SHIPPER) {
        notifyStaff("account", 0, "Shipper " + n.displayName + " (" + n.username + ") vừa đăng ký, đang chờ duyệt");
        sendMail(n.email, "Đã nhận hồ sơ shipper", "Chào " + n.displayName + ", hồ sơ shipper của bạn đang chờ duyệt. Chúng tôi sẽ báo qua email khi có kết quả.");
        return Json::object().set("ok", true).set("status", "pending")
            .set("message", "Đã gửi hồ sơ. Tài khoản shipper sẽ dùng được sau khi quản trị viên duyệt.");
    }
    sendMail(n.email, "Chào mừng đến với hệ thống giao hàng", "Chào " + n.displayName + ", tài khoản khách hàng của bạn đã sẵn sàng.");
    notify(n.username, "account", 0, "Chào mừng bạn! Hãy thêm địa chỉ giao hàng trong Hồ sơ để đặt đơn nhanh hơn.");
    return Json::object().set("ok", true).set("status", "active").set("message", "Đăng ký thành công. Bạn có thể đăng nhập ngay.");
}

// ------------------------------------------------------------ Đăng nhập / đăng xuất
Json loginAccount(const httplib::Request& r) {
    int64_t now = nowSeconds();
    if (!S.limiter.allow("login:" + S.ip, now, 60, 300))
        throw TooMany("Quá nhiều lần đăng nhập từ địa chỉ này, thử lại sau ít phút", S.limiter.retryAfter("login:" + S.ip, now, 300));
    std::string identifier = trimmed(str(r, "username", str(r, "identifier")));
    if (identifier.size() > 100) identifier.resize(100);
    std::string password = str(r, "password");
    if (identifier.empty() || password.empty()) throw BadRequest("Hãy nhập tên đăng nhập (hoặc email, số điện thoại) và mật khẩu");
    const Auth::Account* acct = S.accounts.resolve(identifier);
    const std::string key = acct ? acct->username : lowerCopy(identifier);
    if (int wait = S.guard.lockedFor(key, now))
        throw TooMany("Đăng nhập sai quá nhiều lần. Hãy thử lại sau " + std::to_string(wait) + " giây", wait);
    bool ok = acct ? S.accounts.verify(acct->username, password) : (Auth::hashPassword("0000000000000000", password), false);
    if (!ok) {
        S.guard.failed(key, now);
        audit("auth.login_failed", key, S.ip);
        if (int wait = S.guard.lockedFor(key, now))
            throw TooMany("Đăng nhập sai quá nhiều lần. Tài khoản tạm khoá đăng nhập " + std::to_string(wait) + " giây", wait);
        throw Unauthorized("Thông tin đăng nhập không đúng");   // cố ý không nói sai tên hay sai mật khẩu
    }
    S.guard.succeeded(key);
    // Mật khẩu đúng rồi mới nói rõ tình trạng tài khoản (không giúp kẻ lạ dò tên đăng nhập)
    if (acct->status == Auth::PENDING)
        throw Forbidden("Tài khoản của bạn đang chờ duyệt. Bạn sẽ nhận được thông báo qua email khi được duyệt.");
    if (acct->status == Auth::LOCKED)
        throw Forbidden("Tài khoản đã bị khoá" + (acct->statusReason.empty() ? std::string() : ": " + acct->statusReason) + ". Hãy liên hệ quản trị viên.");
    if (acct->status == Auth::DISABLED)
        throw Forbidden("Tài khoản đã bị vô hiệu hoá" + (acct->statusReason.empty() ? std::string() : ": " + acct->statusReason) + ".");
    if (!S.token.empty()) S.sessions.remove(S.token);   // đăng nhập lại: bỏ phiên cũ (chống cố định phiên)
    Auth::SessionMeta meta;
    meta.remember = flag(r, "remember");
    meta.device = S.device;
    meta.ip = S.ip;
    S.token = S.sessions.create(acct->username, now, meta);
    S.accounts.touchLogin(acct->username, now);
    mark(D_USERS);
    S.me = *S.accounts.find(acct->username);
    S.authed = true;
    S.csrf = S.sessions.csrf(S.token);
    S.setCookie = sessionCookie(S.token, meta.remember);
    audit("auth.login", S.me.username, S.device);
    Json out = Json::object().set("ok", true).set("user", meJson()).set("home", homeOf(S.me.role));
    if (flag(r, "bearer")) out.set("token", S.token);   // cho script / curl; trình duyệt dùng cookie HttpOnly
    return out;
}

// ------------------------------------------------------------ Quên / đặt lại mật khẩu
Json forgotPassword(const httplib::Request& r) {
    int64_t now = nowSeconds();
    std::string email = Auth::normalizeEmail(str(r, "email"));
    if (!S.limiter.allow("forgot:" + S.ip, now, 5, 900))
        throw TooMany("Bạn yêu cầu mã quá nhiều lần, hãy thử lại sau ít phút", S.limiter.retryAfter("forgot:" + S.ip, now, 900));
    if (!S.limiter.allow("forgot-to:" + email, now, 3, 900))
        throw TooMany("Email này vừa được gửi mã, hãy kiểm tra hộp thư hoặc thử lại sau ít phút", S.limiter.retryAfter("forgot-to:" + email, now, 900));
    std::string e = Auth::checkEmail(email);
    if (!e.empty()) throw Invalid(e, {{"email", e}});
    const Auth::Account* a = S.accounts.findByEmail(email);
    if (a && a->status == Auth::ACTIVE) {
        std::string otp = S.resets.issue(a->username, now);
        sendMail(a->email, "Mã đặt lại mật khẩu",
                 "Mã của bạn là " + otp + ". Mã có hiệu lực " + std::to_string(Auth::RESET_MINUTES) + " phút và chỉ dùng được một lần. Nếu không phải bạn yêu cầu, hãy bỏ qua email này.");
        audit("auth.password_forgot", a->username, S.ip);
    }
    // Luôn trả lời giống nhau dù email có tồn tại hay không (không cho dò tài khoản)
    return Json::object().set("ok", true).set("demo", S.demo)
        .set("message", "Nếu email này thuộc một tài khoản, mã đặt lại mật khẩu đã được gửi. Mã có hiệu lực " + std::to_string(Auth::RESET_MINUTES) + " phút.");
}

Json resetPassword(const httplib::Request& r) {
    int64_t now = nowSeconds();
    if (!S.limiter.allow("reset:" + S.ip, now, 15, 900))
        throw TooMany("Bạn thử quá nhiều lần, hãy thử lại sau ít phút", S.limiter.retryAfter("reset:" + S.ip, now, 900));
    std::string email = Auth::normalizeEmail(str(r, "email"));
    std::string otp = trimmed(str(r, "otp"));
    std::string pass = str(r, "password");
    const Auth::Account* a = S.accounts.findByEmail(email);
    // Kiểm tra mật khẩu mới TRƯỚC khi tiêu mã, để người dùng nhập lại được nếu mật khẩu yếu
    std::string e = Auth::checkPasswordStrong(pass, a ? a->username : "");
    if (!e.empty()) throw Invalid(e, {{"password", e}});
    if (pass != str(r, "confirm")) throw Invalid("Mật khẩu nhập lại không khớp", {{"confirm", "Mật khẩu nhập lại không khớp"}});
    const std::string generic = "Mã không đúng hoặc đã hết hạn";
    if (!a || a->status != Auth::ACTIVE) throw BadRequest(generic);
    switch (S.resets.verify(a->username, otp, now)) {
        case Auth::ResetStore::OK: break;
        case Auth::ResetStore::EXPIRED: throw BadRequest("Mã đã hết hạn, hãy yêu cầu mã mới");
        case Auth::ResetStore::USED: throw BadRequest("Mã này đã được sử dụng, hãy yêu cầu mã mới");
        case Auth::ResetStore::TOO_MANY: throw BadRequest("Nhập sai quá nhiều lần, hãy yêu cầu mã mới");
        default: throw BadRequest(generic);
    }
    e = S.accounts.setPassword(a->username, pass);
    if (!e.empty()) throw BadRequest(e);
    S.sessions.revokeUser(a->username);   // mọi thiết bị phải đăng nhập lại
    S.guard.succeeded(a->username);
    S.resets.invalidate(a->username);
    mark(D_USERS);
    audit("auth.password_reset", a->username, S.ip);
    notify(a->username, "account", 0, "Mật khẩu của bạn vừa được đặt lại. Nếu không phải bạn, hãy liên hệ quản trị viên.");
    sendMail(a->email, "Mật khẩu đã được thay đổi", "Mật khẩu tài khoản " + a->username + " vừa được đặt lại. Mọi thiết bị đã bị đăng xuất.");
    return Json::object().set("ok", true).set("message", "Đã đặt lại mật khẩu. Hãy đăng nhập bằng mật khẩu mới.");
}

Json mailboxJson(const httplib::Request& r) {
    if (!S.demo) throw Forbidden("Hộp thư giả lập chỉ có ở chế độ demo");
    int64_t now = nowSeconds();
    if (!S.limiter.allow("mailbox:" + S.ip, now, 60, 60)) throw TooMany("Bạn tải hộp thư quá nhanh", 30);
    std::string email = Auth::normalizeEmail(str(r, "email"));
    Json arr = Json::array();
    int n = 0;
    for (const Support::Mail* m : S.mailbox.to(email)) {
        if (++n > 20) break;
        arr.push(Json::object().set("at", static_cast<double>(m->at)).set("subject", m->subject).set("body", m->body));
    }
    return Json::object().set("ok", true).set("email", email).set("mails", arr);
}

// ------------------------------------------------------------ Hồ sơ cá nhân
Json profileJson() {
    Json j = Json::object().set("ok", true).set("user", meJson());
    j.set("sessions", static_cast<int>(S.sessions.list(S.me.username, S.token).size()));
    if (isCustomer()) j.set("addresses", static_cast<int>(S.addresses.of(S.me.username).size()));
    return j;
}

Json updateProfile(const httplib::Request& r) {
    std::string name = trimmed(str(r, "displayName", S.me.displayName));
    std::string email = Auth::normalizeEmail(str(r, "email", S.me.email));
    std::string phone = Auth::normalizePhone(str(r, "phone", S.me.phone));
    std::map<std::string, std::string> errors;
    auto put = [&](const char* f, const std::string& e) { if (!e.empty()) errors[f] = e; };
    put("displayName", Auth::checkDisplayName(name));
    put("email", email.empty() ? "Vui lòng nhập email" : Auth::checkEmail(email));
    if (!errors.count("email") && S.accounts.emailTaken(email, S.me.username)) errors["email"] = "Email này đã được sử dụng";
    put("phone", phone.empty() ? "Vui lòng nhập số điện thoại" : Auth::checkPhone(phone));
    if (!errors.count("phone") && S.accounts.phoneTaken(phone, S.me.username)) errors["phone"] = "Số điện thoại này đã được sử dụng";
    if (!errors.empty()) throw Invalid("Vui lòng kiểm tra lại thông tin", errors);
    std::string e = S.accounts.updateProfile(S.me.username, name, email, phone);
    if (!e.empty()) throw BadRequest(e);
    mark(D_USERS);
    audit("profile.update", S.me.username, (S.me.email != email ? "đổi email " : "") + std::string(S.me.phone != phone ? "đổi SĐT" : ""));
    S.me = *S.accounts.find(S.me.username);
    return Json::object().set("ok", true).set("user", meJson()).set("message", "Đã cập nhật hồ sơ");
}

Json changePassword(const httplib::Request& r) {
    if (!S.accounts.verify(S.me.username, str(r, "old"))) throw Invalid("Mật khẩu hiện tại không đúng", {{"old", "Mật khẩu hiện tại không đúng"}});
    std::string pass = str(r, "new");
    std::string e = Auth::checkPasswordStrong(pass, S.me.username);
    if (!e.empty()) throw Invalid(e, {{"new", e}});
    if (pass == str(r, "old")) throw Invalid("Mật khẩu mới phải khác mật khẩu cũ", {{"new", "Mật khẩu mới phải khác mật khẩu cũ"}});
    if (has(r, "confirm") && pass != str(r, "confirm")) throw Invalid("Mật khẩu nhập lại không khớp", {{"confirm", "Mật khẩu nhập lại không khớp"}});
    e = S.accounts.setPassword(S.me.username, pass);
    if (!e.empty()) throw BadRequest(e);
    int out = S.sessions.revokeOthers(S.me.username, S.token);   // các thiết bị khác phải đăng nhập lại
    mark(D_USERS);
    audit("auth.password_change", S.me.username, std::to_string(out) + " phiên khác bị đăng xuất");
    sendMail(S.me.email, "Mật khẩu đã được thay đổi", "Mật khẩu tài khoản " + S.me.username + " vừa được đổi.");
    return Json::object().set("ok", true).set("message", "Đã đổi mật khẩu" + (out ? "; " + std::to_string(out) + " thiết bị khác đã bị đăng xuất" : std::string()));
}

Json sessionsJson() {
    Json arr = Json::array();
    for (const Auth::SessionInfo& s : S.sessions.list(S.me.username, S.token))
        arr.push(Json::object().set("sid", s.sid).set("device", s.device).set("ip", s.ip).set("created", static_cast<double>(s.created))
                     .set("lastSeen", static_cast<double>(s.lastSeen)).set("remember", s.remember).set("current", s.current));
    return Json::object().set("ok", true).set("sessions", arr);
}

// ------------------------------------------------------------ Sổ địa chỉ (khách hàng)
Json addressJson(const Commerce::Address& a) {
    return Json::object().set("id", a.id).set("label", a.label).set("recipient", a.recipient).set("phone", a.phone)
        .set("detail", a.detail).set("node", a.node).set("nodeName", nodeName(a.node)).set("isDefault", a.isDefault);
}
Json addressesJson() {
    Json arr = Json::array();
    for (const Commerce::Address* a : S.addresses.of(S.me.username)) arr.push(addressJson(*a));
    return Json::object().set("ok", true).set("addresses", arr).set("max", static_cast<int>(Commerce::MAX_ADDRESSES));
}
Commerce::Address readAddress(const httplib::Request& r, Commerce::Address a) {
    a.owner = S.me.username;
    a.label = trimmed(str(r, "label", a.label));
    a.recipient = trimmed(str(r, "recipient", a.recipient));
    a.phone = Auth::normalizePhone(str(r, "phone", a.phone));
    a.detail = trimmed(str(r, "detail", a.detail));
    a.node = integer(r, "node", a.node);
    if (!S.graph.hasNode(a.node)) throw Invalid("Hãy chọn điểm giao trên bản đồ", {{"node", "Hãy chọn điểm giao trên bản đồ"}});
    return a;
}
// Địa chỉ phải là của chính người gọi (anti-IDOR): không có -> 400, của người khác -> 403
const Commerce::Address& ownAddress(int id) {
    const Commerce::Address* a = S.addresses.find(id);
    if (!a) throw BadRequest("Không có địa chỉ này");
    if (a->owner != S.me.username) throw Forbidden("Địa chỉ này không thuộc về bạn");
    return *a;
}

// ------------------------------------------------------------ Shipper tự quản lý
Json shipperStatsJson(const std::string& name) {
    Commerce::ShipperStat st = S.stats.get(name);
    int count = 0;
    double avg = S.reviews.average(name, &count);
    return Json::object().set("ok", true).set("name", name)
        .set("delivered", st.delivered).set("onTime", st.onTime)
        .set("onTimeRate", st.delivered ? 100.0 * st.onTime / st.delivered : 100.0)
        .set("failed", st.failed).set("accepted", st.accepted).set("declines", st.declines)
        .set("income", static_cast<double>(st.income)).set("rating", count ? Json(avg) : Json()).set("ratings", count)
        .set("score", shipperScore(name)).set("codHeld", static_cast<double>(S.cod.held(name)))
        .set("codAwaiting", static_cast<double>(S.cod.awaiting(name)));
}

// ------------------------------------------------------------ Quản lý tài khoản (nhân viên)
// Chỉ quản trị viên quản lý tài khoản (đã bỏ vai trò điều phối viên)
bool staffMayManage(const Auth::Account&) { return isAdmin(); }

struct QueueItem {
    int64_t created;
    std::string username;
};
struct QueueLess {
    bool operator()(const QueueItem& a, const QueueItem& b) const {
        return a.created != b.created ? a.created < b.created : a.username < b.username;
    }
};

Json usersListJson(const httplib::Request& r) {
    std::vector<const Auth::Account*> rows;
    for (const Auth::Account& a : S.accounts.all())
        if (staffMayManage(a)) rows.push_back(&a);
    // Đếm theo trạng thái (trước khi lọc) để hiển thị trên bộ lọc
    std::map<std::string, int> byStatus, byRole;
    for (const Auth::Account* a : rows) {
        ++byStatus[Auth::statusKey(a->status)];
        ++byRole[Auth::roleKey(a->role)];
    }
    std::string role = lowerCopy(str(r, "role")), status = lowerCopy(str(r, "status")), q = trimmed(str(r, "q"));
    if (!role.empty()) rows.erase(std::remove_if(rows.begin(), rows.end(), [&](const Auth::Account* a) { return role != Auth::roleKey(a->role); }), rows.end());
    if (!status.empty()) rows.erase(std::remove_if(rows.begin(), rows.end(), [&](const Auth::Account* a) { return status != Auth::statusKey(a->status); }), rows.end());
    if (!q.empty()) {
        TextIndex idx;   // tìm không dấu bằng Trie: tên đăng nhập, họ tên, email, SĐT
        for (size_t i = 0; i < rows.size(); ++i)
            idx.add(static_cast<int>(i), rows[i]->username + " " + rows[i]->displayName + " " + rows[i]->email + " " + rows[i]->phone);
        std::set<int> hit;
        for (int i : idx.search(q)) hit.insert(i);
        std::vector<const Auth::Account*> kept;
        for (size_t i = 0; i < rows.size(); ++i)
            if (hit.count(static_cast<int>(i))) kept.push_back(rows[i]);
        rows = kept;
    }
    std::string key = sortKey(r, {"name", "username", "created", "login", "role", "status"}, "created");
    bool desc = sortDesc(r, key == "created" || key == "login");
    std::stable_sort(rows.begin(), rows.end(), [&](const Auth::Account* a, const Auth::Account* b) {
        int c = 0;
        if (key == "name") c = normalizeVi(a->displayName).compare(normalizeVi(b->displayName));
        else if (key == "username") c = a->username.compare(b->username);
        else if (key == "created") c = a->createdAt < b->createdAt ? -1 : a->createdAt > b->createdAt ? 1 : 0;
        else if (key == "login") c = a->lastLogin < b->lastLogin ? -1 : a->lastLogin > b->lastLogin ? 1 : 0;
        else if (key == "role") c = static_cast<int>(a->role) - static_cast<int>(b->role);
        else c = static_cast<int>(a->status) - static_cast<int>(b->status);
        return desc ? c > 0 : c < 0;
    });
    PageInfo p = paginate(r, rows.size());
    Json arr = Json::array();
    for (size_t i = p.begin; i < p.end; ++i) {
        const Auth::Account& a = *rows[i];
        int orders = 0;
        for (const Order& o : S.orders) orders += o.owner == a.username;
        bool linked = a.role != Auth::SHIPPER || shipperIndexByName(a.link) >= 0 || a.status == Auth::PENDING;
        arr.push(accountJson(a).set("orders", orders).set("linkOk", linked).set("self", a.username == S.me.username)
                     .set("manage", isAdmin() || a.role == Auth::CUSTOMER || a.role == Auth::SHIPPER));
    }
    Json bs = Json::object(), br = Json::object();
    for (const auto& kv : byStatus) bs.set(kv.first, kv.second);
    for (const auto& kv : byRole) br.set(kv.first, kv.second);
    return Json::object().set("ok", true).set("users", arr).set("page", pageJson(p)).set("byStatus", bs).set("byRole", br);
}

// Hàng chờ duyệt shipper: Min-Heap theo thời điểm đăng ký (ai đăng ký trước được duyệt trước)
Json approvalQueueJson() {
    MinHeap<QueueItem, QueueLess> heap;
    for (const Auth::Account& a : S.accounts.all())
        if (a.status == Auth::PENDING && staffMayManage(a)) heap.push({a.createdAt, a.username});
    Json arr = Json::array();
    int pos = 0;
    while (!heap.empty()) {
        QueueItem it = heap.pop();
        const Auth::Account* a = S.accounts.find(it.username);
        arr.push(accountJson(*a).set("position", ++pos));
    }
    return Json::object().set("ok", true).set("queue", arr);
}

// Thêm shipper đã được duyệt vào đội xe; trả về tên trong đội xe
std::string enrollShipper(const Auth::Account& a) {
    if (!a.link.empty() && shipperIndexByName(a.link) >= 0) return a.link;
    if (S.shippers.size() >= 12) throw Conflict("Đội xe đã đủ 12 shipper, hãy xoá bớt shipper không dùng trước khi duyệt thêm");
    Shipper sh;
    sh.name = a.displayName;
    if (shipperIndexByName(sh.name) >= 0) sh.name += " (" + a.username + ")";
    sh.capacity = a.capacity > 0 ? a.capacity : 20;
    sh.vehicle = a.vehicle >= 0 ? vehicleFromInt(a.vehicle) : MOTORBIKE;
    if (sh.vehicle == ANY_VEHICLE) sh.vehicle = MOTORBIKE;
    S.shippers.push_back(sh);
    mark(D_FLEET);
    audit("fleet.add", sh.name, "duyệt hồ sơ " + a.username);
    return sh.name;
}

Json changeStatus(const httplib::Request& r) {
    std::string user = lowerCopy(trimmed(str(r, "username")));
    const Auth::Account* t = S.accounts.find(user);
    if (!t) throw BadRequest("Không có tài khoản '" + user + "'");
    if (!staffMayManage(*t)) throw Forbidden("Chỉ quản trị viên quản lý tài khoản");
    if (t->username == S.me.username) throw Conflict("Bạn không thể tự đổi trạng thái tài khoản của chính mình");
    Auth::Status to;
    if (!Auth::statusFromKey(lowerCopy(str(r, "status")), to)) throw BadRequest("Trạng thái phải là active, locked hoặc disabled");
    if (to == Auth::PENDING) throw BadRequest("Không đưa tài khoản về trạng thái chờ duyệt");
    Auth::Status from = t->status;
    if (from == to) throw Conflict(std::string("Tài khoản đã ở trạng thái ") + Auth::statusName(to));
    if (!Auth::statusTransitionAllowed(from, to))
        throw Conflict(std::string("Không thể chuyển tài khoản từ '") + Auth::statusName(from) + "' sang '" + Auth::statusName(to) + "'");
    std::string reason = trimmed(str(r, "reason"));
    bool needReason = to == Auth::LOCKED || to == Auth::DISABLED;
    if (needReason && reason.size() < 3) throw Invalid("Hãy nhập lý do", {{"reason", "Hãy nhập lý do (ít nhất 3 ký tự)"}});
    std::string link = t->link;
    if (from == Auth::PENDING && to == Auth::ACTIVE && t->role == Auth::SHIPPER) link = enrollShipper(*t);
    std::string e = S.accounts.setStatus(user, to, reason);
    if (!e.empty()) throw Conflict(e);
    if (link != t->link) S.accounts.setLink(user, link);
    if (to != Auth::ACTIVE) S.sessions.revokeUser(user);   // bị khoá thì đăng xuất mọi thiết bị
    mark(D_USERS);
    const Auth::Account* after = S.accounts.find(user);
    bool approve = from == Auth::PENDING && to == Auth::ACTIVE, reject = from == Auth::PENDING && to == Auth::DISABLED;
    std::string verb = approve ? "duyệt" : reject ? "từ chối" : to == Auth::LOCKED ? "khoá" : to == Auth::DISABLED ? "vô hiệu hoá" : "mở khoá";
    audit("user.status", user, std::string(Auth::statusKey(from)) + " -> " + Auth::statusKey(to) + (reason.empty() ? "" : ": " + reason));
    std::string msg = approve ? "Hồ sơ shipper của bạn đã được duyệt. Bạn có thể đăng nhập và nhận chuyến."
                    : reject ? "Hồ sơ shipper của bạn chưa được duyệt: " + reason
                    : to == Auth::LOCKED ? "Tài khoản của bạn đã bị khoá: " + reason
                    : to == Auth::DISABLED ? "Tài khoản của bạn đã bị vô hiệu hoá: " + reason
                    : "Tài khoản của bạn đã được mở khoá.";
    sendMail(after->email, approve ? "Hồ sơ shipper đã được duyệt" : "Thay đổi trạng thái tài khoản", msg);
    return Json::object().set("ok", true).set("user", accountJson(*after)).set("message", "Đã " + verb + " tài khoản " + user);
}

Json adminAddUser(const httplib::Request& r) {
    Auth::NewAccount n;
    n.username = lowerCopy(trimmed(str(r, "username")));
    n.password = str(r, "password");
    n.displayName = trimmed(str(r, "displayName"));
    n.email = str(r, "email");
    n.phone = str(r, "phone");
    n.link = trimmed(str(r, "link"));
    n.createdAt = nowSeconds();
    if (!Auth::roleFromKey(lowerCopy(str(r, "role")), n.role)) throw Invalid("Vai trò phải là admin, shipper hoặc customer", {{"role", "Chọn vai trò"}});
    if (n.displayName.empty()) n.displayName = n.username;
    std::string e = Auth::checkPasswordStrong(n.password, n.username);
    if (!e.empty()) throw Invalid(e, {{"password", e}});
    if (n.role == Auth::SHIPPER) {
        if (shipperIndexByName(n.link) < 0) throw Invalid("Không có shipper tên '" + n.link + "' trong đội xe", {{"link", "Chọn một shipper trong đội xe"}});
        for (const Auth::Account& a : S.accounts.all())
            if (a.role == Auth::SHIPPER && a.link == n.link) throw Invalid("Shipper này đã có tài khoản", {{"link", "Shipper này đã có tài khoản"}});
    }
    e = S.accounts.create(n);
    if (!e.empty()) throw BadRequest(e);
    mark(D_USERS);
    audit("user.create", n.username, Auth::roleKey(n.role));
    return Json::object().set("ok", true).set("message", "Đã tạo tài khoản " + n.username);
}

Json adminUpdateUser(const httplib::Request& r) {
    std::string user = lowerCopy(trimmed(str(r, "username")));
    const Auth::Account* before = S.accounts.find(user);
    if (!before) throw BadRequest("Không có tài khoản '" + user + "'");
    Auth::Role oldRole = before->role, role;
    if (!Auth::roleFromKey(lowerCopy(str(r, "role", Auth::roleKey(oldRole))), role)) throw BadRequest("Vai trò không hợp lệ");
    std::string link = trimmed(str(r, "link", before->link));
    if (role == Auth::SHIPPER && shipperIndexByName(link) < 0) throw BadRequest("Không có shipper tên '" + link + "' trong đội xe");
    if (user == S.me.username && role != Auth::ADMIN) throw Conflict("Không tự bỏ quyền quản trị của chính mình");
    std::string name = trimmed(str(r, "displayName", before->displayName));
    std::string e = S.accounts.update(user, role, link, name);
    if (!e.empty()) throw BadRequest(e);
    if (has(r, "email") || has(r, "phone")) {
        e = S.accounts.updateProfile(user, name, str(r, "email", before->email), str(r, "phone", before->phone));
        if (!e.empty()) throw BadRequest(e);
    }
    std::string pass = str(r, "password");
    if (!pass.empty()) {
        e = Auth::checkPasswordStrong(pass, user);
        if (!e.empty()) throw Invalid(e, {{"password", e}});
        S.accounts.setPassword(user, pass);
    }
    if ((role != oldRole || !pass.empty()) && user != S.me.username) S.sessions.revokeUser(user);
    mark(D_USERS);
    audit("user.update", user, std::string(role != oldRole ? "đổi vai trò " : "") + (!pass.empty() ? "đặt lại mật khẩu" : ""));
    return Json::object().set("ok", true).set("message", "Đã cập nhật tài khoản " + user);
}

Json adminRemoveUser(const httplib::Request& r) {
    std::string user = lowerCopy(trimmed(str(r, "username")));
    if (user == S.me.username) throw Conflict("Không tự xoá tài khoản đang đăng nhập");
    std::string e = S.accounts.remove(user);
    if (!e.empty()) throw BadRequest(e);
    S.sessions.revokeUser(user);
    S.addresses.removeOwner(user);
    mark(D_USERS | D_ADDR);
    audit("user.remove", user);
    return Json::object().set("ok", true).set("message", "Đã xoá tài khoản " + user);
}

void registerAccountRoutes(httplib::Server& svr) {
    routePost(svr, "/api/login", wrap([](const httplib::Request& r) { return loginAccount(r); }));
    routePost(svr, "/api/logout", wrap([](const httplib::Request&) {
        if (S.authed) audit("auth.logout", S.me.username, S.device);
        if (!S.token.empty()) S.sessions.remove(S.token);
        S.setCookie = clearCookie();
        return Json::object().set("ok", true);
    }));
    routeGet(svr, "/api/me", wrap([](const httplib::Request&) {
        return Json::object().set("ok", true).set("user", meJson()).set("rev", static_cast<double>(S.rev));   // rev đổi khi dữ liệu đổi: giao diện chỉ tải lại state khi cần
    }));
    routePost(svr, "/api/register", wrap([](const httplib::Request& r) { return registerAccount(r); }));
    routePost(svr, "/api/password/forgot", wrap([](const httplib::Request& r) { return forgotPassword(r); }));
    routePost(svr, "/api/password/reset", wrap([](const httplib::Request& r) { return resetPassword(r); }));
    routeGet(svr, "/api/mailbox", wrap([](const httplib::Request& r) { return mailboxJson(r); }));
    routePost(svr, "/api/me/password", wrap([](const httplib::Request& r) { return changePassword(r); }));

    routeGet(svr, "/api/profile", wrap([](const httplib::Request&) { return profileJson(); }));
    routePost(svr, "/api/profile/update", wrap([](const httplib::Request& r) { return updateProfile(r); }));
    routeGet(svr, "/api/sessions", wrap([](const httplib::Request&) { return sessionsJson(); }));
    routePost(svr, "/api/sessions/revoke", wrap([](const httplib::Request& r) {
        std::string sid = str(r, "sid");
        if (sid == Auth::SessionStore::sidOf(S.token)) {   // đăng xuất chính thiết bị này
            S.sessions.remove(S.token);
            S.setCookie = clearCookie();
            audit("auth.logout", S.me.username, "thiết bị hiện tại");
            return Json::object().set("ok", true).set("message", "Đã đăng xuất thiết bị này");
        }
        if (!S.sessions.revokeSid(S.me.username, sid)) throw BadRequest("Không có thiết bị này");
        audit("auth.session_revoke", S.me.username, sid);
        return sessionsJson().set("message", "Đã đăng xuất thiết bị");
    }));
    routePost(svr, "/api/sessions/revoke-others", wrap([](const httplib::Request&) {
        int n = S.sessions.revokeOthers(S.me.username, S.token);
        audit("auth.session_revoke", S.me.username, "tất cả thiết bị khác (" + std::to_string(n) + ")");
        return sessionsJson().set("message", "Đã đăng xuất " + std::to_string(n) + " thiết bị khác");
    }));

    // ---- Sổ địa chỉ
    routeGet(svr, "/api/addresses", wrap([](const httplib::Request&) { return addressesJson(); }));
    routePost(svr, "/api/addresses/add", wrap([](const httplib::Request& r) {
        Commerce::Address a = readAddress(r, Commerce::Address{});
        bool first = S.addresses.of(S.me.username).empty();
        int id = 0;
        std::string e = S.addresses.add(a, id);
        if (!e.empty()) throw BadRequest(e);
        if (first || flag(r, "default")) S.addresses.setDefault(id, S.me.username);
        mark(D_ADDR);
        return addressesJson().set("message", "Đã thêm địa chỉ").set("created", id);
    }));
    routePost(svr, "/api/addresses/update", wrap([](const httplib::Request& r) {
        int id = integer(r, "id");
        Commerce::Address a = readAddress(r, ownAddress(id));
        std::string e = S.addresses.update(id, S.me.username, a);
        if (!e.empty()) throw BadRequest(e);
        if (flag(r, "default")) S.addresses.setDefault(id, S.me.username);
        mark(D_ADDR);
        return addressesJson().set("message", "Đã cập nhật địa chỉ");
    }));
    routePost(svr, "/api/addresses/remove", wrap([](const httplib::Request& r) {
        int id = integer(r, "id");
        ownAddress(id);
        std::string e = S.addresses.remove(id, S.me.username);
        if (!e.empty()) throw BadRequest(e);
        mark(D_ADDR);
        return addressesJson().set("message", "Đã xoá địa chỉ");
    }));
    routePost(svr, "/api/addresses/default", wrap([](const httplib::Request& r) {
        int id = integer(r, "id");
        ownAddress(id);
        std::string e = S.addresses.setDefault(id, S.me.username);
        if (!e.empty()) throw BadRequest(e);
        mark(D_ADDR);
        return addressesJson().set("message", "Đã đặt địa chỉ mặc định");
    }));

    // ---- Shipper
    routePost(svr, "/api/shipper/ready", wrap([](const httplib::Request& r) {
        bool ready = flag(r, "ready");
        S.accounts.setReady(S.me.username, ready);
        mark(D_USERS);
        audit("shipper.ready", S.me.username, ready ? "sẵn sàng" : "tạm nghỉ");
        S.me = *S.accounts.find(S.me.username);
        const int idx = myShipperIndex();
        if (!ready && idx >= 0) withdrawOffers(idx, "Shipper tắt sẵn sàng");
        matchPending();
        return Json::object().set("ok", true).set("user", meJson())
            .set("message", ready ? "Bạn đã sẵn sàng nhận đơn, hệ thống sẽ gửi đơn gần bạn nhất" : "Bạn đã tạm nghỉ, hệ thống sẽ không gửi đơn cho bạn");
    }));
    routePost(svr, "/api/shipper/vehicle", wrap([](const httplib::Request& r) {
        int veh = integer(r, "vehicle", S.me.vehicle);
        double cap = num(r, "capacity", S.me.capacity);
        std::string plate = trimmed(str(r, "plate", S.me.plate));
        for (char& ch : plate) ch = static_cast<char>(std::toupper(static_cast<unsigned char>(ch)));
        int idx = myShipperIndex();
        if (idx >= 0 && S.shift.busy(idx, S.orders)) throw Conflict("Bạn đang có đơn chưa xong, hãy đổi thông tin xe sau khi giao xong");
        std::string e = S.accounts.setShipperInfo(S.me.username, veh, cap, plate);
        if (!e.empty()) throw Invalid(e, {{"vehicle", e}});
        if (idx >= 0) {
            S.shippers[idx].capacity = cap;
            S.shippers[idx].vehicle = vehicleFromInt(veh);
            if (S.shippers[idx].vehicle == ANY_VEHICLE) S.shippers[idx].vehicle = MOTORBIKE;
        }
        mark(D_USERS);
        audit("shipper.vehicle", S.me.username, plate);
        S.me = *S.accounts.find(S.me.username);
        return Json::object().set("ok", true).set("user", meJson()).set("message", "Đã cập nhật thông tin xe");
    }));
    // Vị trí shipper đang đứng khi rảnh: hệ thống dựa vào đây để chọn người gần kho nhất (như GPS trên app Grab)
    routePost(svr, "/api/shipper/location", wrap([](const httplib::Request& r) {
        int idx = myShipperIndex();
        if (idx < 0) throw BadRequest("Tài khoản chưa gắn với shipper trong đội xe");
        int node = integer(r, "node", -1);
        if (!S.graph.hasNode(node)) throw Invalid("Hãy chọn một điểm trên bản đồ", {{"node", "Điểm không tồn tại"}});
        if (S.shift.busy(idx, S.orders)) throw Conflict("Bạn đang có đơn chưa xong, vị trí được cập nhật theo hành trình");
        S.accounts.setHome(S.me.username, node);
        S.shift.setStandby(idx, node);
        mark(D_USERS);
        audit("shipper.location", S.me.username, nodeName(node));
        S.me = *S.accounts.find(S.me.username);
        matchPending();
        return Json::object().set("ok", true).set("user", meJson()).set("node", node)
            .set("message", "Đã cập nhật vị trí của bạn: " + nodeName(node));
    }));
    routeGet(svr, "/api/shipper/stats", wrap([](const httplib::Request& r) {
        std::string name = isShipper() ? S.me.link : trimmed(str(r, "name"));
        if (name.empty() || shipperIndexByName(name) < 0) throw BadRequest("Chọn một shipper trong đội xe");
        return shipperStatsJson(name);
    }));

    // ---- Quản lý tài khoản
    routeGet(svr, "/api/users", wrap([](const httplib::Request& r) { return usersListJson(r); }));
    routeGet(svr, "/api/users/queue", wrap([](const httplib::Request&) { return approvalQueueJson(); }));
    routePost(svr, "/api/users/add", wrap([](const httplib::Request& r) { return adminAddUser(r); }));
    routePost(svr, "/api/users/update", wrap([](const httplib::Request& r) { return adminUpdateUser(r); }));
    routePost(svr, "/api/users/remove", wrap([](const httplib::Request& r) { return adminRemoveUser(r); }));
    routePost(svr, "/api/users/status", wrap([](const httplib::Request& r) { return changeStatus(r); }));
}
