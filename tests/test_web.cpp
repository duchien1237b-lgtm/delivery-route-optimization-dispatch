// Kiểm thử tích hợp qua HTTP thật: khởi động server (trên bản sao thư mục data), gọi API như trình duyệt / curl.
// Phủ: đăng ký (hợp lệ / trùng / sai định dạng / spam / honeypot), duyệt shipper, đăng nhập (3 kiểu, khoá luỹ tiến,
// thông báo tài khoản chờ duyệt / bị khoá), quên + đặt lại mật khẩu, ma trận quyền 3 vai trò + khách vãng lai x MỌI API,
// chống truy cập chéo (IDOR), máy trạng thái đơn (HTTP 409), mã giao hàng, sổ COD, mã giảm giá, phí huỷ, khiếu nại,
// thông báo, nhật ký kiểm toán, CSRF / Origin, tiêu đề bảo mật; khai giá & bảo hiểm, cân quy đổi, người nhận trả cước,
// khách tự sửa / giao lại / hoàn đơn, phân công tay, thu hồi chuyến, ví đối soát, bồi thường, cảnh báo và doanh thu theo ngày.
#include "Auth.h"
#include "WebServer.h"

#include "httplib.h"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <iostream>
#include <map>
#include <regex>
#include <set>
#include <string>
#include <thread>
#include <vector>

using namespace std;

static int passed = 0, failed = 0;
#define CHECK(cond)                                                                    \
    do {                                                                               \
        if (!(cond)) {                                                                 \
            ++failed;                                                                  \
            cerr << "  [FAIL] " << __FILE__ << ":" << __LINE__ << "  " #cond "\n";    \
        } else {                                                                       \
            ++passed;                                                                  \
        }                                                                              \
    } while (0)
#define CHECK_MSG(cond, msg)                                                           \
    do {                                                                               \
        if (!(cond)) {                                                                 \
            ++failed;                                                                  \
            cerr << "  [FAIL] " << __FILE__ << ":" << __LINE__ << "  " #cond "  => " << (msg) << "\n"; \
        } else {                                                                       \
            ++passed;                                                                  \
        }                                                                              \
    } while (0)

static const int PORT = 18931;
using Params = vector<pair<string, string>>;

struct Resp {
    int status = 0;
    string body;
    string setCookie;
    string retryAfter;
    map<string, string> headers;
    bool has(const string& s) const { return body.find(s) != string::npos; }
};
struct Who {
    string cookie, csrf, bearer;
    string user;
};

static Resp call(const string& method, const string& path, const Params& p = {}, const Who* w = nullptr,
                 bool sendCsrf = true, const map<string, string>& extra = {}) {
    httplib::Client cli("127.0.0.1", PORT);
    cli.set_read_timeout(20, 0);
    httplib::Headers h;
    if (w && !w->cookie.empty()) h.emplace("Cookie", "dt08_session=" + w->cookie);
    if (w && !w->bearer.empty()) h.emplace("Authorization", "Bearer " + w->bearer);
    if (w && sendCsrf && !w->csrf.empty() && method == "POST") h.emplace("X-CSRF-Token", w->csrf);
    for (const auto& kv : extra) h.emplace(kv.first, kv.second);
    httplib::Params params;
    for (const auto& kv : p) params.emplace(kv.first, kv.second);
    httplib::Result res(nullptr, httplib::Error::Unknown);
    if (method == "GET") {
        string q;
        for (const auto& kv : p) q += (q.empty() ? "?" : "&") + httplib::detail::encode_query_param(kv.first) + "=" + httplib::detail::encode_query_param(kv.second);
        res = cli.Get(path + q, h);
    } else {
        res = cli.Post(path, h, params);
    }
    Resp r;
    if (!res) return r;
    r.status = res->status;
    r.body = res->body;
    r.setCookie = res->get_header_value("Set-Cookie");
    r.retryAfter = res->get_header_value("Retry-After");
    for (const auto& kv : res->headers) r.headers[kv.first] = kv.second;
    return r;
}
static Resp GET(const string& path, const Params& p = {}, const Who* w = nullptr) { return call("GET", path, p, w); }
static Resp POST(const string& path, const Params& p = {}, const Who* w = nullptr) { return call("POST", path, p, w); }

// ---- JSON tối giản: lấy giá trị đầu tiên của một khoá
static string jstr(const string& body, const string& key, size_t from = 0) {
    size_t p = body.find("\"" + key + "\":", from);
    if (p == string::npos) return "";
    p += key.size() + 3;
    if (p < body.size() && body[p] == '"') {
        string out;
        for (size_t i = p + 1; i < body.size() && body[i] != '"'; ++i) {
            if (body[i] == '\\' && i + 1 < body.size()) ++i;
            out += body[i];
        }
        return out;
    }
    size_t e = body.find_first_of(",}]", p);
    return body.substr(p, e == string::npos ? string::npos : e - p);
}
static long long jnum(const string& body, const string& key, size_t from = 0) {
    string s = jstr(body, key, from);
    try { return s.empty() ? -999999 : (long long)stod(s); } catch (...) { return -999999; }
}
static long long jlast(const string& body, const string& key) {   // giá trị của lần xuất hiện CUỐI của khoá
    size_t p = body.rfind("\"" + key + "\":");
    return p == string::npos ? -999999 : jnum(body, key, p);
}
// Mã chuyến đang chờ shipper nhận (chuyến có "accepted":false)
static int pendingTrip(const string& state) {
    size_t p = state.find("\"accepted\":false");
    if (p == string::npos) return -1;
    size_t id = state.rfind("{\"id\":", p);
    return id == string::npos ? -1 : (int)jnum(state, "id", id);
}
// Mã chuyến chứa đơn `order`
static int tripOf(const string& state, int order) {
    size_t t = state.find("\"trips\":[");
    size_t p = state.find("{\"order\":" + to_string(order) + ",", t);
    if (t == string::npos || p == string::npos) return -1;
    size_t id = state.rfind("{\"id\":", p);
    return id == string::npos ? -1 : (int)jnum(state, "id", id);
}
static size_t countOf(const string& body, const string& needle) {
    size_t n = 0, p = 0;
    while ((p = body.find(needle, p)) != string::npos) { ++n; p += needle.size(); }
    return n;
}

static Who login(const string& user, const string& pass, bool remember = false) {
    Params p = {{"username", user}, {"password", pass}};
    if (remember) p.push_back({"remember", "1"});
    Resp r = POST("/api/login", p);
    Who w;
    w.user = user;
    if (r.status != 200) return w;
    size_t a = r.setCookie.find("dt08_session=");
    if (a != string::npos) w.cookie = r.setCookie.substr(a + 13, r.setCookie.find(';', a) - a - 13);
    w.csrf = jstr(r.body, "csrf");
    return w;
}

static string orderStatus(const Who& w, int id) {
    Resp r = GET("/api/order/get", {{"id", to_string(id)}}, &w);
    size_t p = r.body.find("\"order\":");
    return r.status == 200 ? to_string(jnum(r.body, "status", p)) : "?";
}

// Bản sao dữ liệu cho kiểm thử: thêm một quản trị viên thứ hai (vai trò "nhân viên vận hành" trong các kịch bản cũ), tắt ghép đơn tự động
// và đồng hồ ca chạy theo giờ thật để các kịch bản phân công tay chạy xác định. Các kiểm thử ghép tự động bật lại bằng /api/config/update.
static void prepareData(const string& dir) {
    Auth::AccountStore users;
    string err;
    if (!users.load(dir + "/users.txt", err)) { cerr << err << "\n"; exit(1); }
    Auth::NewAccount n;
    n.username = "quanly"; n.password = "Quanly@2026"; n.displayName = "Quản lý Lan"; n.role = Auth::ADMIN;
    n.email = "quanly@giaohang.vn"; n.phone = "0912000001";
    string e = users.create(n);
    if (!e.empty()) { cerr << e << "\n"; exit(1); }
    if (!users.save(dir + "/users.txt", err)) { cerr << err << "\n"; exit(1); }
    ofstream cfg(dir + "/config.txt", ios::app);
    cfg << "match.auto 0\nclock.speed 0\n";
}

static void waitForServer() {
    for (int i = 0; i < 100; ++i) {
        httplib::Client cli("127.0.0.1", PORT);
        if (auto r = cli.Get("/api/me")) return;
        this_thread::sleep_for(chrono::milliseconds(100));
    }
}

// ============================================================================
static void testRegister() {
    cout << "== Đăng ký\n";
    Params good = {{"role", "customer"}, {"username", "khachmoi"}, {"displayName", "Nguyễn Văn Mới"}, {"email", "Moi@Example.com"},
                   {"phone", "0977 123 456"}, {"password", "Bautroi@2026"}, {"confirm", "Bautroi@2026"}, {"terms", "1"}};
    auto with = [&](const string& k, const string& v) {
        Params p = good;
        for (auto& kv : p) if (kv.first == k) kv.second = v;
        return p;
    };
    Resp r = POST("/api/register", good);
    CHECK_MSG(r.status == 200 && jstr(r.body, "status") == "active", r.body);
    Who w = login("khachmoi", "Bautroi@2026");
    CHECK(!w.cookie.empty());
    CHECK(login("moi@example.com", "Bautroi@2026").cookie.size() > 10);   // đăng nhập bằng email (không phân biệt hoa thường)
    CHECK(login("0977123456", "Bautroi@2026").cookie.size() > 10);        // và bằng số điện thoại
    // Trùng
    r = POST("/api/register", with("username", "KHACHMOI"));
    CHECK(r.status == 400 && r.has("\"fields\"") && r.has("Tên đăng nhập đã được sử dụng"));
    r = POST("/api/register", with("username", "khachmoi2"));
    CHECK(r.status == 400 && r.has("Email này đã được sử dụng"));
    r = POST("/api/register", with("email", "khac@example.com"));
    CHECK(r.status == 400 && r.has("Số điện thoại này đã được sử dụng"));
    // Sai định dạng
    r = POST("/api/register", with("phone", "012345"));
    CHECK(r.status == 400 && r.has("\"phone\""));
    r = POST("/api/register", with("email", "khong-phai-email"));
    CHECK(r.status == 400 && r.has("\"email\""));
    r = POST("/api/register", with("password", "abc12345"));
    CHECK(r.status == 400 && r.has("\"password\""));
    r = POST("/api/register", with("confirm", "Khac@12345"));
    CHECK(r.status == 400 && r.has("\"confirm\""));
    r = POST("/api/register", with("terms", "0"));
    CHECK(r.status == 400 && r.has("\"terms\""));
    r = POST("/api/register", with("username", "a b"));
    CHECK(r.status == 400 && r.has("\"username\""));
    r = POST("/api/register", with("displayName", "<script>"));
    CHECK(r.status == 400 && r.has("\"displayName\""));
    r = POST("/api/register", with("password", "Password1"));   // mật khẩu phổ biến
    CHECK(r.status == 400);
    // Admin không tự đăng ký được; vai trò điều phối viên đã bỏ nên cũng không đăng ký được
    r = POST("/api/register", with("role", "admin"));
    CHECK(r.status == 403);
    r = POST("/api/register", with("role", "dispatcher"));
    CHECK(r.status == 403 || r.status == 400);
    CHECK(login("khachmoi2", "Bautroi@2026").cookie.empty());
    // Honeypot: bot điền ô ẩn -> trả về như thành công nhưng không tạo tài khoản
    Params bot = with("username", "botspam");
    bot = with("email", "bot@example.com");
    for (auto& kv : bot) if (kv.first == "username") kv.second = "botspam";
    bot.push_back({"website", "http://spam.example"});
    for (auto& kv : bot) if (kv.first == "phone") kv.second = "0966000111";
    r = POST("/api/register", bot);
    CHECK(r.status == 200);
    CHECK(login("botspam", "Bautroi@2026").cookie.empty());
    // Shipper: phải khai phương tiện, ở trạng thái chờ duyệt
    Params sp = {{"role", "shipper"}, {"username", "shipmoi"}, {"displayName", "Trần Shipper Mới"}, {"email", "shipmoi@example.com"},
                 {"phone", "0955000111"}, {"password", "Giaohang@123"}, {"confirm", "Giaohang@123"}, {"terms", "1"}};
    r = POST("/api/register", sp);
    CHECK(r.status == 400 && r.has("\"vehicle\"") && r.has("\"capacity\"") && r.has("\"plate\""));
    sp.push_back({"vehicle", "0"}); sp.push_back({"capacity", "25"}); sp.push_back({"plate", "59z9-999.99"});
    r = POST("/api/register", sp);
    CHECK_MSG(r.status == 200 && jstr(r.body, "status") == "pending", r.body);
    r = POST("/api/login", {{"username", "shipmoi"}, {"password", "Giaohang@123"}});
    CHECK(r.status == 403 && r.has("chờ duyệt"));
    r = POST("/api/login", {{"username", "shipmoi"}, {"password", "sai-mat-khau"}});
    CHECK(r.status == 401 && !r.has("chờ duyệt"));   // sai mật khẩu thì không tiết lộ tình trạng tài khoản
}

static void testLogin() {
    cout << "== Đăng nhập\n";
    Resp a = POST("/api/login", {{"username", "khongtontai"}, {"password", "Sai@12345"}});
    Resp b = POST("/api/login", {{"username", "banhhoa"}, {"password", "Sai@12345"}});
    CHECK(a.status == 401 && b.status == 401);
    CHECK(jstr(a.body, "error") == jstr(b.body, "error"));   // thông báo chung, không lộ tài khoản có tồn tại hay không
    // Cookie HttpOnly + SameSite=Strict, "ghi nhớ" có Max-Age
    Resp r = POST("/api/login", {{"username", "anphat"}, {"password", "khach123"}});
    CHECK(r.status == 200 && r.setCookie.find("HttpOnly") != string::npos && r.setCookie.find("SameSite=Strict") != string::npos);
    CHECK(r.setCookie.find("Max-Age") == string::npos);
    CHECK(!r.has("\"token\""));   // trình duyệt không nhận mã phiên qua JSON
    CHECK(jstr(r.body, "home") == "myorders");
    r = POST("/api/login", {{"username", "anphat"}, {"password", "khach123"}, {"remember", "1"}});
    CHECK(r.setCookie.find("Max-Age=2592000") != string::npos);
    // Chuyển hướng theo vai trò
    CHECK(jstr(POST("/api/login", {{"username", "admin"}, {"password", "admin123"}}).body, "home") == "overview");
    CHECK(jstr(POST("/api/login", {{"username", "quanly"}, {"password", "Quanly@2026"}}).body, "home") == "overview");
    CHECK(jstr(POST("/api/login", {{"username", "tuan"}, {"password", "shipper123"}}).body, "home") == "myjob");
    // Tài khoản chờ duyệt (mẫu) báo rõ sau khi đúng mật khẩu
    r = POST("/api/login", {{"username", "ctv_hung"}, {"password", "Hung@2026"}});
    CHECK(r.status == 403 && r.has("chờ duyệt"));
    // Khoá luỹ tiến: sai 5 lần thì khoá, đăng nhập đúng cũng bị từ chối trong thời gian khoá
    for (int i = 0; i < Auth::LOCK_AFTER - 2; ++i) CHECK(POST("/api/login", {{"username", "banhhoa"}, {"password", "Sai@12345"}}).status == 401);   // đã sai 1 lần ở trên
    r = POST("/api/login", {{"username", "banhhoa"}, {"password", "Sai@12345"}});
    CHECK(r.status == 429 && !r.retryAfter.empty());
    r = POST("/api/login", {{"username", "banhhoa"}, {"password", "khach123"}});
    CHECK(r.status == 429);
    // Đăng xuất làm mất hiệu lực phiên
    Who w = login("anphat", "khach123");
    CHECK(GET("/api/me", {}, &w).has("anphat"));
    CHECK(POST("/api/logout", {}, &w).status == 200);
    CHECK(GET("/api/state", {}, &w).status == 401);
}

static void testPasswordReset() {
    cout << "== Quên / đặt lại mật khẩu\n";
    Who old = login("anphat", "khach123");
    CHECK(!old.cookie.empty());
    // Email không tồn tại trả lời giống hệt email có tồn tại
    Resp r1 = POST("/api/password/forgot", {{"email", "khongco@example.com"}});
    Resp r2 = POST("/api/password/forgot", {{"email", "anphat@example.com"}});
    CHECK(r1.status == 200 && r2.status == 200 && jstr(r1.body, "message") == jstr(r2.body, "message"));
    Resp box = GET("/api/mailbox", {{"email", "anphat@example.com"}});
    smatch m;
    string body = box.body;
    CHECK(regex_search(body, m, regex("Mã của bạn là ([0-9]{6})")));
    string otp = m.size() > 1 ? m[1].str() : "000000";
    CHECK(GET("/api/mailbox", {{"email", "khongco@example.com"}}).body.find("Mã của bạn") == string::npos);
    Params base = {{"email", "anphat@example.com"}, {"password", "Ngoisao@2026"}, {"confirm", "Ngoisao@2026"}};
    auto reset = [&](const string& code, const string& pw = "Ngoisao@2026") {
        Params p = base;
        p.push_back({"otp", code});
        for (auto& kv : p) if (kv.first == "password" || kv.first == "confirm") kv.second = pw;
        return POST("/api/password/reset", p);
    };
    string wrong = otp == "123456" ? "654321" : "123456";
    CHECK(reset(wrong).status == 400);
    CHECK(reset(otp, "yeu").status == 400);          // mật khẩu yếu: không tiêu mã
    Resp ok = reset(otp);
    CHECK_MSG(ok.status == 200, ok.body);
    Resp again = reset(otp, "Ngoisao@2027");           // mã dùng một lần
    CHECK(again.status == 400);
    CHECK(GET("/api/state", {}, &old).status == 401);  // đặt lại mật khẩu đăng xuất mọi thiết bị
    CHECK(login("anphat", "khach123").cookie.empty());
    CHECK(!login("anphat", "Ngoisao@2026").cookie.empty());
    CHECK(GET("/api/mailbox", {{"email", "anphat@example.com"}}).has("Mật khẩu đã được thay đổi"));
    // Dò mã: sai quá 5 lần thì mã bị huỷ
    POST("/api/password/forgot", {{"email", "banhhoa@example.com"}});
    box = GET("/api/mailbox", {{"email", "banhhoa@example.com"}});
    body = box.body;
    CHECK(regex_search(body, m, regex("Mã của bạn là ([0-9]{6})")));
    string good = m.size() > 1 ? m[1].str() : "000000";
    string bad = good == "111111" ? "222222" : "111111";
    for (int i = 0; i < 6; ++i) POST("/api/password/reset", {{"email", "banhhoa@example.com"}, {"otp", bad}, {"password", "Tiembanh@2026"}, {"confirm", "Tiembanh@2026"}});
    r1 = POST("/api/password/reset", {{"email", "banhhoa@example.com"}, {"otp", good}, {"password", "Tiembanh@2026"}, {"confirm", "Tiembanh@2026"}});
    CHECK(r1.status == 400);
}

// ============================================================================
static void testSecurityHeaders() {
    cout << "== Bảo mật HTTP: CSRF, Origin, tiêu đề\n";
    Who a = login("khachvip", "HuongViet@2026");
    CHECK(!a.cookie.empty());
    Params order = {{"destination", "5"}, {"weight", "1"}, {"recipient", "Chị Hoa"}, {"phone", "0988000111"}};
    // Cookie mà không có mã CSRF -> 403; mã sai -> 403; đúng -> chạy tiếp
    Resp r = call("POST", "/api/order/add", order, &a, false);
    CHECK(r.status == 403 && r.has("CSRF"));
    Who wrong = a;
    wrong.csrf = "0000";
    CHECK(call("POST", "/api/order/add", order, &wrong).status == 403);
    // Origin lạ -> 403 dù có CSRF
    CHECK(call("POST", "/api/profile/update", {}, &a, true, {{"Origin", "http://evil.example"}}).status == 403);
    CHECK(call("POST", "/api/profile/update", {}, &a, true, {{"Origin", "http://127.0.0.1:" + to_string(PORT)}}).status == 200);
    // Bearer (script / curl) không bị CSRF vì không có cookie tự gửi
    Resp bl = POST("/api/login", {{"username", "khachvip"}, {"password", "HuongViet@2026"}, {"bearer", "1"}});
    Who b;
    b.bearer = jstr(bl.body, "token");
    CHECK(b.bearer.size() == 32);
    CHECK(call("POST", "/api/profile/update", {}, &b).status == 200);
    // Tiêu đề bảo mật
    r = GET("/api/me");
    CHECK(r.headers.count("X-Content-Type-Options") && r.headers.count("X-Frame-Options") && r.headers.count("Content-Security-Policy"));
    CHECK(r.headers["Cache-Control"] == "no-store");
    CHECK(r.headers["Content-Security-Policy"].find("script-src 'self'") != string::npos);
    // API không có -> 404 dạng JSON
    r = GET("/api/khong-co");
    CHECK(r.status == 404 && r.has("\"ok\":false"));
    // Không rò rỉ nội bộ khi dữ liệu sai
    r = GET("/api/path", {{"src", "abc"}, {"dst", "1"}}, &a);
    CHECK(r.status == 400 && r.body.find("std::") == string::npos);
}

// ============================================================================
static void testUsersAndApproval() {
    cout << "== Quản lý tài khoản, duyệt shipper, nhật ký kiểm toán\n";
    Who admin = login("admin", "admin123"), disp = login("quanly", "Quanly@2026"), cust = login("khachvip", "HuongViet@2026");
    CHECK(!admin.cookie.empty() && !disp.cookie.empty());
    // Hàng chờ duyệt (Min-Heap): ctv_hung đăng ký lâu hơn nên đứng trước shipmoi
    Resp q = GET("/api/users/queue", {}, &disp);
    CHECK(q.status == 200 && q.has("ctv_hung") && q.has("shipmoi"));
    CHECK(q.body.find("ctv_hung") < q.body.find("shipmoi"));
    CHECK(GET("/api/users/queue", {}, &cust).status == 403);
    // Tìm không dấu + lọc + sắp xếp + phân trang
    Resp l = GET("/api/users", {{"q", "nha hang huong"}}, &admin);
    CHECK(l.status == 200 && l.has("khachvip") && !l.has("\"username\":\"tuan\""));
    l = GET("/api/users", {{"role", "shipper"}, {"status", "pending"}}, &admin);
    CHECK(l.has("ctv_hung") && !l.has("\"username\":\"tuan\""));
    l = GET("/api/users", {{"size", "3"}, {"page", "2"}, {"sort", "username"}, {"dir", "asc"}}, &admin);
    CHECK(jnum(l.body, "page", l.body.find("\"page\":{") + 7) == 2 && countOf(l.body, "\"username\"") == 3 && jnum(l.body, "pages") >= 3);
    // Khách hàng không xem danh sách tài khoản, không khoá được ai
    CHECK(GET("/api/users", {}, &cust).status == 403);
    CHECK(POST("/api/users/status", {{"username", "admin"}, {"status", "locked"}, {"reason", "thu"}}, &cust).status == 403);
    CHECK(POST("/api/users/status", {{"username", "quanly"}, {"status", "locked"}, {"reason", "thu"}}, &admin).status == 200);
    CHECK(login("quanly", "Quanly@2026").cookie.empty());
    CHECK(GET("/api/state", {}, &disp).status == 401);                         // khoá là đăng xuất ngay
    Resp locked = POST("/api/login", {{"username", "quanly"}, {"password", "Quanly@2026"}});
    CHECK(locked.status == 403 && locked.has("bị khoá") && locked.has("thu"));
    CHECK(POST("/api/users/status", {{"username", "quanly"}, {"status", "active"}}, &admin).status == 200);
    disp = login("quanly", "Quanly@2026");
    CHECK(!disp.cookie.empty());
    // Vòng đời hợp lệ: cần lý do, không tự khoá mình, không về "chờ duyệt"
    CHECK(POST("/api/users/status", {{"username", "banhhoa"}, {"status", "locked"}}, &admin).status == 400);
    CHECK(POST("/api/users/status", {{"username", "admin"}, {"status", "locked"}, {"reason", "tu khoa"}}, &admin).status == 409);
    CHECK(POST("/api/users/status", {{"username", "banhhoa"}, {"status", "pending"}}, &admin).status == 400);
    CHECK(POST("/api/users/status", {{"username", "banhhoa"}, {"status", "active"}}, &admin).status == 409);   // đã hoạt động
    // Duyệt shipper: vào đội xe, đăng nhập được, nhận đúng thông tin xe đã khai
    int before = (int)countOf(GET("/api/state", {}, &admin).body, "\"vehicleName\"");
    Resp ap = POST("/api/users/status", {{"username", "shipmoi"}, {"status", "active"}}, &disp);
    CHECK_MSG(ap.status == 200, ap.body);
    CHECK(!login("shipmoi", "Giaohang@123").cookie.empty());
    Resp st = GET("/api/state", {}, &admin);
    CHECK(st.has("Trần Shipper Mới") && (int)countOf(st.body, "\"vehicleName\"") > before);
    CHECK(POST("/api/users/status", {{"username", "ctv_hung"}, {"status", "disabled"}, {"reason", "Thiếu giấy tờ xe"}}, &disp).status == 200);
    CHECK(POST("/api/login", {{"username", "ctv_hung"}, {"password", "Hung@2026"}}).has("vô hiệu hoá"));
    CHECK(POST("/api/users/status", {{"username", "ctv_hung"}, {"status", "pending"}}, &admin).status == 400);
    // Nhật ký kiểm toán: ghi lại ai làm gì, chỉ quản trị viên xem được
    CHECK(GET("/api/audit", {}, &cust).status == 403);
    Resp au = GET("/api/audit", {{"action", "user.status"}}, &admin);
    CHECK(au.status == 200 && au.has("shipmoi") && au.has("ctv_hung") && au.has("\"actor\":\"quanly\""));
    au = GET("/api/audit", {{"actor", "quanly"}, {"action", "user."}}, &admin);
    CHECK(au.has("quanly") && !au.has("\"actor\":\"admin\""));
    Resp csv = GET("/api/audit/export", {{"action", "user.status"}}, &admin);
    CHECK(csv.status == 200 && csv.body.find("shipmoi") != string::npos && csv.body.rfind("\xEF\xBB\xBFid,", 0) == 0);
    CHECK(GET("/api/audit/export", {}, &cust).status == 403);
    // Admin tạo tài khoản: mật khẩu mạnh; vai trò điều phối viên đã bỏ nên không tạo được nữa
    CHECK(POST("/api/users/add", {{"username", "dp2"}, {"role", "admin"}, {"password", "yeu"}, {"displayName", "Quản lý 2"}}, &admin).status == 400);
    CHECK(POST("/api/users/add", {{"username", "dp2"}, {"role", "dispatcher"}, {"password", "Quanly@456"}, {"displayName", "Điều phối 2"}}, &admin).status == 400);
    CHECK(POST("/api/users/add", {{"username", "dp2"}, {"role", "admin"}, {"password", "Quanly@456"}, {"displayName", "Quản lý 2"}}, &admin).status == 200);
    CHECK(POST("/api/users/add", {{"username", "dp3"}, {"role", "admin"}, {"password", "Quanly@456"}}, &cust).status == 403);
}

static void testProfile() {
    cout << "== Hồ sơ, thiết bị, sổ địa chỉ\n";
    Who a = login("khachvip", "HuongViet@2026");
    Resp r = POST("/api/profile/update", {{"displayName", "Hương Việt"}, {"email", "huongviet@example.com"}, {"phone", "0902000009"}}, &a);
    CHECK(r.status == 200 && r.has("huongviet@example.com"));
    CHECK(POST("/api/profile/update", {{"email", "anphat@example.com"}}, &a).status == 400);      // trùng email người khác
    CHECK(POST("/api/profile/update", {{"phone", "0901000001"}}, &a).status == 400);              // trùng SĐT
    CHECK(POST("/api/profile/update", {{"phone", "123"}}, &a).status == 400);
    // Đổi mật khẩu: phải đúng mật khẩu cũ, mật khẩu mới mạnh, các thiết bị khác bị đăng xuất
    Who other = login("khachvip", "HuongViet@2026");
    CHECK(GET("/api/sessions", {}, &a).status == 200 && countOf(GET("/api/sessions", {}, &a).body, "\"sid\"") >= 2);
    CHECK(POST("/api/me/password", {{"old", "sai"}, {"new", "Huongviet@456"}}, &a).status == 400);
    CHECK(POST("/api/me/password", {{"old", "HuongViet@2026"}, {"new", "abcdefgh"}}, &a).status == 400);
    CHECK(POST("/api/me/password", {{"old", "HuongViet@2026"}, {"new", "HuongViet@2026"}}, &a).status == 400);
    CHECK(POST("/api/me/password", {{"old", "HuongViet@2026"}, {"new", "Huongviet@456"}}, &a).status == 200);
    CHECK(GET("/api/me", {}, &a).has("khachvip"));            // thiết bị đang đổi mật khẩu vẫn đăng nhập
    CHECK(GET("/api/state", {}, &other).status == 401);       // thiết bị khác bị đăng xuất
    CHECK(login("khachvip", "HuongViet@2026").cookie.empty() && !login("khachvip", "Huongviet@456").cookie.empty());
    // Đăng xuất từng thiết bị
    a = login("khachvip", "Huongviet@456");
    Who second = login("khachvip", "Huongviet@456");
    Resp ss = GET("/api/sessions", {}, &a);
    size_t p = 0;
    string sidOther;
    while ((p = ss.body.find("\"sid\":\"", p)) != string::npos) {
        string sid = jstr(ss.body, "sid", p);
        size_t cur = ss.body.find("\"current\":", p);
        if (ss.body.compare(cur, 18, "\"current\":false") == 0 || ss.body.substr(cur, 16).find("false") != string::npos) sidOther = sid;
        p += 8;
    }
    CHECK(!sidOther.empty());
    CHECK(POST("/api/sessions/revoke", {{"sid", sidOther}}, &a).status == 200);
    CHECK(POST("/api/sessions/revoke", {{"sid", "khongco"}}, &a).status == 400);
    CHECK(POST("/api/sessions/revoke-others", {}, &a).status == 200);
    CHECK(GET("/api/state", {}, &second).status == 401);
    // Sổ địa chỉ
    CHECK(GET("/api/addresses", {}, &a).has("Nhà hàng"));
    r = POST("/api/addresses/add", {{"label", "Chi nhánh 2"}, {"recipient", "Chị Mai"}, {"phone", "0933111222"}, {"detail", "12 Lê Lợi"}, {"node", "8"}}, &a);
    CHECK(r.status == 200 && r.has("Chi nhánh 2"));
    int newId = (int)jnum(r.body, "created");
    CHECK(POST("/api/addresses/add", {{"label", "X"}, {"recipient", "Chị Mai"}, {"phone", "0933111222"}, {"node", "9999"}}, &a).status == 400);
    CHECK(POST("/api/addresses/default", {{"id", to_string(newId)}}, &a).status == 200);
    // Địa chỉ của người khác: 403
    Who an = login("anphat", "Ngoisao@2026");
    CHECK(POST("/api/addresses/remove", {{"id", to_string(newId)}}, &an).status == 403);
    CHECK(POST("/api/addresses/update", {{"id", to_string(newId)}, {"label", "Hack"}}, &an).status == 403);
    CHECK(POST("/api/addresses/remove", {{"id", to_string(newId)}}, &a).status == 200);
    // Chỉ khách hàng có sổ địa chỉ
    Who ship = login("tuan", "shipper123");
    CHECK(GET("/api/addresses", {}, &ship).status == 403);
    // Shipper: bật / tắt sẵn sàng, thông tin xe, thống kê
    CHECK(POST("/api/shipper/ready", {{"ready", "0"}}, &ship).has("tạm nghỉ"));
    CHECK(GET("/api/state", {}, &ship).has("\"ready\":false"));
    CHECK(POST("/api/shipper/ready", {{"ready", "1"}}, &ship).status == 200);
    CHECK(POST("/api/shipper/vehicle", {{"vehicle", "0"}, {"capacity", "22"}, {"plate", "59A1-111.11"}}, &ship).status == 200);
    CHECK(POST("/api/shipper/vehicle", {{"vehicle", "7"}, {"capacity", "22"}, {"plate", "59A1-111.11"}}, &ship).status == 400);
    Resp stt = GET("/api/shipper/stats", {}, &ship);
    CHECK(stt.status == 200 && jnum(stt.body, "delivered") >= 42);
    CHECK(GET("/api/shipper/stats", {}, &a).status == 403);
}

// ============================================================================
struct Flow1 {
    Who admin, disp, tuan, binh, vip, an;
    int orderA = 0;
};

static string firstPlanKeys(const string& body, vector<string>& keys) {
    size_t p = body.find("\"multi\":[");
    while ((p = body.find("\"key\":\"", p)) != string::npos) {
        p += 7;
        keys.push_back(body.substr(p, body.find('"', p) - p));
    }
    return "";
}

static bool dispatchApply(const Who& w) {
    Resp d = GET("/api/dispatch", {{"vehicle", "0"}, {"return", "1"}}, &w);
    if (d.status != 200) return false;
    vector<string> keys;
    firstPlanKeys(d.body, keys);
    for (const string& k : keys) {
        Resp r = POST("/api/dispatch/apply", {{"plan", k}, {"vehicle", "0"}, {"return", "1"}}, &w);
        if (r.status == 200) return true;
    }
    return false;
}

static void testOrderLifecycle() {
    cout << "== Vòng đời đơn: tạo → xác nhận → phân công → nhận chuyến → giao (mã) → COD → đánh giá\n";
    Flow1 f;
    f.admin = login("admin", "admin123");
    f.disp = login("quanly", "Quanly@2026");
    f.tuan = login("tuan", "shipper123");
    f.binh = login("binh", "shipper123");
    f.vip = login("khachvip", "Huongviet@456");
    f.an = login("anphat", "Ngoisao@2026");
    // Dọn các đơn mẫu để kết quả điều phối xác định; chỉ Anh Tuấn có mặt
    for (int id = 101; id <= 108; ++id) CHECK(POST("/api/order/remove", {{"id", to_string(id)}}, &f.admin).status == 200);
    CHECK(POST("/api/shift/absent", {{"index", "1"}}, &f.disp).status == 200);
    CHECK(POST("/api/shift/absent", {{"index", "2"}}, &f.disp).status == 200);
    // Báo giá = hoá đơn
    Params qp = {{"destination", "5"}, {"weight", "4"}, {"cod", "500000"}, {"promo", "GIAM10"}};
    Resp quote = GET("/api/quote", qp, &f.vip);
    CHECK_MSG(quote.status == 200 && jstr(quote.body, "promoError").empty(), quote.body);
    long long quoteNet = jnum(quote.body, "net");
    CHECK(jnum(quote.body, "loyaltyDiscount") > 0 && jnum(quote.body, "promoDiscount") > 0 && quoteNet % 500 == 0);
    CHECK(jnum(quote.body, "gross") - jnum(quote.body, "loyaltyDiscount") - jnum(quote.body, "promoDiscount") == quoteNet);
    Resp guestQuote = GET("/api/quote", {{"destination", "5"}, {"weight", "4"}, {"promo", "GIAM10"}});
    CHECK(guestQuote.status == 200 && jnum(guestQuote.body, "loyaltyDiscount") == 0 && guestQuote.has("đăng nhập"));
    // Tạo đơn
    long long used0 = 0;
    {
        Resp pr = GET("/api/promos", {}, &f.admin);
        size_t at = pr.body.find("\"code\":\"GIAM10\"");
        used0 = jnum(pr.body, "used", at);
    }
    Params op = {{"destination", "5"}, {"weight", "4"}, {"cod", "500000"}, {"promo", "GIAM10"}, {"recipient", "Anh Nam"}, {"phone", "0988111222"}, {"note", "Hàng dễ vỡ"}};
    Resp created = POST("/api/order/add", op, &f.vip);
    CHECK_MSG(created.status == 200 && jnum(created.body, "net") == quoteNet, created.body);
    f.orderA = (int)jnum(created.body, "created");
    string A = to_string(f.orderA);
    CHECK(orderStatus(f.vip, f.orderA) == "6");   // Mới
    Resp inv = GET("/api/order/invoice", {{"id", A}}, &f.vip);
    CHECK(inv.status == 200 && jnum(inv.body, "net") == quoteNet && jnum(inv.body, "payable") == quoteNet);
    {
        Resp pr = GET("/api/promos", {}, &f.admin);
        size_t at = pr.body.find("\"code\":\"GIAM10\"");
        CHECK(jnum(pr.body, "used", at) == used0 + 1);
    }
    // Chống truy cập chéo (IDOR): khách khác không xem / huỷ / khiếu nại đơn này
    CHECK(GET("/api/order/get", {{"id", A}}, &f.an).status == 403);
    CHECK(GET("/api/order/invoice", {{"id", A}}, &f.an).status == 403);
    CHECK(POST("/api/order/cancel", {{"id", A}}, &f.an).status == 403);
    CHECK(POST("/api/complaint/add", {{"order", A}, {"title", "Thử khiếu nại"}, {"body", "Nội dung thử khiếu nại"}}, &f.an).status == 403);
    CHECK(GET("/api/order/get", {{"id", "999999"}}, &f.an).status == 403);   // không phân biệt "không có" với "của người khác"
    CHECK(!GET("/api/orders/list", {}, &f.an).has("\"id\":" + A));
    CHECK(!GET("/api/state", {}, &f.an).has("Anh Nam"));
    CHECK(POST("/api/order/rate", {{"id", A}, {"stars", "5"}}, &f.an).status == 403);
    // Tra cứu công khai: cần đúng mã + SĐT người nhận; sai thì cùng một thông báo
    CHECK(GET("/api/track", {{"code", A}, {"phone", "0988111222"}}).status == 200);
    Resp t1 = GET("/api/track", {{"code", A}, {"phone", "0988000000"}}), t2 = GET("/api/track", {{"code", "999999"}, {"phone", "0988111222"}});
    CHECK(t1.status == 400 && t2.status == 400 && jstr(t1.body, "error") == jstr(t2.body, "error"));
    CHECK(!GET("/api/track", {{"code", A}, {"phone", "0988111222"}}).has("deliveryCode") && !GET("/api/track", {{"code", A}, {"phone", "0988111222"}}).has("\"code\""));
    // Máy trạng thái: chỉ điều phối viên / admin xác nhận; xác nhận hai lần -> 409
    CHECK(POST("/api/order/confirm", {{"id", A}}, &f.vip).status == 403);
    CHECK(POST("/api/order/deliver", {{"id", A}, {"code", "0000"}}, &f.disp).status == 409);   // chưa phân công mà đòi giao
    CHECK(POST("/api/trip/accept", {{"id", "1"}}, &f.tuan).status == 400);                     // chưa có chuyến
    CHECK(POST("/api/order/confirm", {{"id", A}}, &f.disp).status == 200);
    CHECK(POST("/api/order/confirm", {{"id", A}}, &f.disp).status == 409);
    CHECK(POST("/api/order/reject", {{"id", A}, {"reason", "Không nhận"}}, &f.disp).status == 409);
    CHECK(orderStatus(f.vip, f.orderA) == "0");
    // Điều phối: chỉ nhân viên; đơn sang "Đã phân công", chưa giao được
    CHECK(GET("/api/dispatch", {}, &f.tuan).status == 403);
    CHECK(dispatchApply(f.disp));
    CHECK(orderStatus(f.vip, f.orderA) == "7");
    CHECK(POST("/api/order/deliver", {{"id", A}, {"code", "0000"}}, &f.tuan).status == 409);    // chưa nhận chuyến
    CHECK(POST("/api/order/update", {{"id", A}, {"weight", "5"}}, &f.disp).status == 409);       // đã phân công thì không sửa
    CHECK(POST("/api/order/remove", {{"id", A}}, &f.admin).status == 409);
    // Shipper khác không nhận / giao được chuyến này
    Resp st = GET("/api/state", {}, &f.tuan);
    int tripId = pendingTrip(st.body);
    CHECK(tripId > 0);
    CHECK(POST("/api/trip/accept", {{"id", to_string(tripId)}}, &f.binh).status == 403);
    CHECK(POST("/api/order/deliver", {{"id", A}, {"code", "0000"}}, &f.binh).status == 403);
    CHECK(!GET("/api/state", {}, &f.binh).has("Anh Nam"));
    CHECK(POST("/api/trip/accept", {{"id", to_string(tripId)}}, &f.tuan).status == 200);
    CHECK(POST("/api/trip/accept", {{"id", to_string(tripId)}}, &f.tuan).status == 409);
    CHECK(orderStatus(f.vip, f.orderA) == "1");
    // Shipper không thấy mã xác nhận; chủ đơn thấy
    string code = jstr(GET("/api/order/get", {{"id", A}}, &f.vip).body, "code");
    CHECK(code.size() == 4);
    CHECK(GET("/api/order/get", {{"id", A}}, &f.tuan).status == 200 && !GET("/api/order/get", {{"id", A}}, &f.tuan).has("\"code\":\"" + code + "\""));
    CHECK(!GET("/api/state", {}, &f.admin).has("\"code\":\"" + code + "\""));
    // Giao hàng: sai mã → 400; thiếu tiền thu hộ → 400; đủ → 200; giao lại → 409
    string wrongCode = code == "1234" ? "4321" : "1234";
    CHECK(POST("/api/order/deliver", {{"id", A}, {"code", wrongCode}, {"cash", "500000"}}, &f.tuan).status == 400);
    CHECK(POST("/api/order/deliver", {{"id", A}, {"code", code}}, &f.tuan).status == 400);
    CHECK(POST("/api/order/deliver", {{"id", A}, {"code", code}, {"cash", "400000"}}, &f.tuan).status == 400);
    CHECK(orderStatus(f.vip, f.orderA) == "1");
    Resp dv = POST("/api/order/deliver", {{"id", A}, {"code", code}, {"cash", "500000"}, {"note", "Gửi bảo vệ"}}, &f.tuan);
    CHECK_MSG(dv.status == 200, dv.body);
    CHECK(orderStatus(f.vip, f.orderA) == "2");
    CHECK(POST("/api/order/deliver", {{"id", A}, {"code", code}, {"cash", "500000"}}, &f.tuan).status == 409);
    CHECK(POST("/api/order/cancel", {{"id", A}}, &f.vip).status == 409);       // đơn đã giao là trạng thái cuối
    CHECK(POST("/api/shift/fail", {{"id", A}}, &f.tuan).status == 409);
    // Khách tích luỹ: +1 đơn và cước đã chi
    Resp me = GET("/api/me", {}, &f.vip);
    CHECK(jnum(me.body, "done") == 33);
    // Sổ COD: shipper giữ 500.000; nộp thiếu 10.000; điều phối viên đếm và ghi chênh lệch; chốt ca
    Resp cod = GET("/api/cod", {}, &f.tuan);
    CHECK(cod.status == 200 && jnum(cod.body, "held") == 500000);
    CHECK(GET("/api/cod", {}, &f.vip).status == 403);
    CHECK(POST("/api/cod/close", {{"shipper", "Anh Tuấn"}}, &f.disp).status == 409);   // còn tiền chưa nộp
    CHECK(POST("/api/cod/remit", {{"handed", "490000"}}, &f.binh).status == 409);       // Chị Bình không có khoản nào đang giữ
    Resp rm = POST("/api/cod/remit", {{"handed", "490000"}}, &f.tuan);
    CHECK_MSG(rm.status == 200, rm.body);
    CHECK(POST("/api/cod/close", {{"shipper", "Anh Tuấn"}}, &f.disp).status == 409);   // chờ đối soát
    int remit = (int)jnum(GET("/api/cod", {}, &f.disp).body, "id", GET("/api/cod", {}, &f.disp).body.find("\"remittances\":["));
    CHECK(remit > 0);
    CHECK(POST("/api/cod/confirm", {{"remit", to_string(remit)}, {"counted", "490000"}}, &f.tuan).status == 403);
    Resp cf = POST("/api/cod/confirm", {{"remit", to_string(remit)}, {"counted", "490000"}, {"note", "Thiếu 10k tiền lẻ"}}, &f.disp);
    CHECK(cf.status == 200 && cf.has("-10.000"));
    CHECK(POST("/api/cod/confirm", {{"remit", to_string(remit)}, {"counted", "500000"}}, &f.disp).status == 409);   // đã đối soát
    CHECK(GET("/api/cod", {}, &f.tuan).has("\"diff\":-10000"));
    CHECK(POST("/api/cod/close", {{"shipper", "Anh Tuấn"}}, &f.disp).status == 200);
    CHECK(POST("/api/cod/close", {{"shipper", "Anh Tuấn"}}, &f.disp).status == 409);   // không còn gì để chốt
    // Đánh giá
    CHECK(POST("/api/order/rate", {{"id", A}, {"stars", "9"}}, &f.vip).status == 400);
    CHECK(POST("/api/order/rate", {{"id", A}, {"stars", "5"}, {"comment", "Giao nhanh"}}, &f.vip).status == 200);
    CHECK(POST("/api/order/rate", {{"id", A}, {"stars", "4"}}, &f.vip).status == 409);
    // Thông báo: khách nhận được các bước, đánh dấu đã đọc
    Resp nt = GET("/api/notifications", {}, &f.vip);
    CHECK(nt.status == 200 && nt.has("đã giao thành công") && nt.has("được phân công") && jnum(nt.body, "unread") > 0);
    int nid = (int)jnum(nt.body, "id");
    CHECK(POST("/api/notifications/read", {{"id", to_string(nid)}}, &f.vip).status == 200);
    CHECK(POST("/api/notifications/read", {{"id", to_string(nid)}}, &f.an).status == 400);   // không đánh dấu thông báo của người khác
    CHECK(POST("/api/notifications/read-all", {}, &f.vip).status == 200 && jnum(GET("/api/notifications", {}, &f.vip).body, "unread") == 0);
    // Khiếu nại: Mới → Đang xử lý → Đã giải quyết, có trao đổi; sau khi giải quyết khách không nhắn tiếp
    Resp cp = POST("/api/complaint/add", {{"order", A}, {"title", "Thiếu một kiện"}, {"body", "Thùng hàng giao thiếu một kiện nhỏ."}}, &f.vip);
    CHECK_MSG(cp.status == 200, cp.body);
    string cid = to_string(jnum(cp.body, "id"));
    CHECK(GET("/api/complaints", {{"id", cid}}, &f.an).status == 403);
    CHECK(POST("/api/complaint/message", {{"id", cid}, {"text", "chen ngang"}}, &f.an).status == 403);
    CHECK(POST("/api/complaint/status", {{"id", cid}, {"status", "processing"}}, &f.vip).status == 403);
    CHECK(POST("/api/complaint/status", {{"id", cid}, {"status", "resolved"}}, &f.disp).status == 409);   // phải qua "Đang xử lý"
    CHECK(POST("/api/complaint/status", {{"id", cid}, {"status", "processing"}}, &f.disp).status == 200);
    CHECK(POST("/api/complaint/message", {{"id", cid}, {"text", "Chúng tôi đang kiểm tra với shipper."}}, &f.disp).status == 200);
    CHECK(POST("/api/complaint/status", {{"id", cid}, {"status", "resolved"}}, &f.disp).status == 200);
    CHECK(POST("/api/complaint/message", {{"id", cid}, {"text", "Cảm ơn"}}, &f.vip).status == 409);
    CHECK(GET("/api/complaints", {{"id", cid}}, &f.vip).has("Chúng tôi đang kiểm tra"));
    CHECK(GET("/api/complaints", {{"status", "resolved"}}, &f.disp).has("Thiếu một kiện"));
    // Báo cáo theo vai trò
    CHECK(GET("/api/reports/summary", {}, &f.admin).has("\"revenue\""));
    CHECK(!GET("/api/reports/summary", {}, &f.tuan).has("\"revenue\""));
    CHECK(GET("/api/reports/summary", {}, &f.tuan).has("\"stats\""));
    CHECK(GET("/api/reports/summary", {}, &f.vip).has("\"saved\""));
}

// Phiên dùng chung giữa các nhóm kiểm thử liên tiếp (đăng nhập bị giới hạn 60 lần / 5 phút cho mỗi IP)
static map<string, Who> gShared;
static Who sharedLogin(const string& user, const string& pass) {
    auto it = gShared.find(user);
    if (it != gShared.end()) return it->second;
    return gShared[user] = login(user, pass);
}

static void testCancelAndPromo() {
    cout << "== Huỷ đơn, phí huỷ, mã giảm giá\n";
    Who admin = sharedLogin("admin", "admin123"), disp = sharedLogin("quanly", "Quanly@2026"), tuan = sharedLogin("tuan", "shipper123"), vip = sharedLogin("khachvip", "Huongviet@456");
    Params base = {{"destination", "5"}, {"weight", "2"}, {"recipient", "Anh Bình"}, {"phone", "0988222333"}};
    auto withPromo = [&](const string& code) { Params p = base; p.push_back({"promo", code}); return p; };
    // Mã sai / hết hạn / hết lượt / chưa đủ điều kiện
    Resp r = POST("/api/order/add", withPromo("KHONGCO"), &vip);
    CHECK(r.status == 400 && r.has("\"promo\""));
    CHECK(POST("/api/order/add", withPromo("CHAOBAN"), &vip).has("hết hạn"));
    CHECK(POST("/api/order/add", withPromo("HETLUOT"), &vip).has("hết lượt"));
    CHECK(POST("/api/order/add", withPromo("FREESHIP20"), &vip).has("chỉ áp dụng cho đơn có cước từ"));
    // Mã dùng một lần cho mỗi khách (FREESHIP20 với đơn đủ lớn)
    Params big = {{"destination", "9"}, {"weight", "9"}, {"urgent", "1"}, {"recipient", "Anh Bình"}, {"phone", "0988222333"}, {"promo", "FREESHIP20"}};
    Resp o1 = POST("/api/order/add", big, &vip);
    CHECK_MSG(o1.status == 200, o1.body);
    int idBig = (int)jnum(o1.body, "created");
    CHECK(POST("/api/order/add", big, &vip).status == 400);   // quá lượt mỗi khách
    // Huỷ khi còn "Mới": miễn phí và trả lại lượt dùng mã
    Resp pr = GET("/api/promos", {}, &admin);
    size_t at = pr.body.find("\"code\":\"FREESHIP20\"");
    long long used = jnum(pr.body, "used", at);
    Resp cn = POST("/api/order/cancel", {{"id", to_string(idBig)}}, &vip);
    CHECK(cn.status == 200 && jlast(cn.body, "cancelFee") == 0);
    pr = GET("/api/promos", {}, &admin);
    CHECK(jnum(pr.body, "used", pr.body.find("\"code\":\"FREESHIP20\"")) == used - 1);
    CHECK(POST("/api/order/cancel", {{"id", to_string(idBig)}}, &vip).status == 409);   // đã huỷ
    CHECK(POST("/api/order/add", big, &vip).status == 200);   // dùng lại mã được
    // Huỷ sau khi phân công (Đã phân công) có phí 20% cước vận chuyển còn phải trả
    Resp o2 = POST("/api/order/add", base, &vip);
    int idB = (int)jnum(o2.body, "created");
    // đơn FREESHIP20 vừa tạo đang chờ; xoá để điều phối chỉ còn đơn B
    Resp ol = GET("/api/orders/list", {{"status", "6"}, {"size", "50"}}, &disp);
    CHECK(ol.status == 200);
    size_t pos = 0;
    while ((pos = ol.body.find("\"id\":", pos)) != string::npos) {
        int id = (int)jnum(ol.body, "id", pos);
        pos += 5;
        if (id == idB) continue;
        POST("/api/order/cancel", {{"id", to_string(id)}, {"reason", "Dọn dẹp kiểm thử"}}, &disp);
    }
    CHECK(POST("/api/order/confirm", {{"id", to_string(idB)}}, &disp).status == 200);
    CHECK(dispatchApply(disp));
    CHECK(orderStatus(vip, idB) == "7");
    Resp feeInv = GET("/api/order/invoice", {{"id", to_string(idB)}}, &vip);
    long long net = jnum(feeInv.body, "net");
    CHECK(POST("/api/order/cancel", {{"id", to_string(idB)}}, &vip).status == 400);                  // đã có shipper được phân công: phải nêu lý do
    Resp cn2 = POST("/api/order/cancel", {{"id", to_string(idB)}, {"reason", "Đổi ý, không gửi nữa"}}, &vip);
    CHECK_MSG(cn2.status == 200 && jlast(cn2.body, "cancelFee") > 0, cn2.body);
    CHECK(jlast(cn2.body, "cancelFee") <= net && jlast(cn2.body, "cancelFee") % 500 == 0);
    CHECK(GET("/api/order/invoice", {{"id", to_string(idB)}}, &vip).has("\"payable\":" + to_string(jlast(cn2.body, "cancelFee"))));
    // Đã có shipper nhận: huỷ phải nêu lý do (khách chỉ tự huỷ được khi shipper chưa lấy hàng), quản trị viên huỷ giúp
    Resp o3 = POST("/api/order/add", base, &vip);
    int idC = (int)jnum(o3.body, "created");
    POST("/api/order/confirm", {{"id", to_string(idC)}}, &disp);
    CHECK(dispatchApply(disp));
    Resp st = GET("/api/state", {}, &tuan);
    int trip = tripOf(st.body, idC);
    CHECK(POST("/api/trip/accept", {{"id", to_string(trip)}}, &tuan).status == 200);
    CHECK(orderStatus(vip, idC) == "1");
    CHECK(POST("/api/order/cancel", {{"id", to_string(idC)}}, &vip).status == 400);                   // khách huỷ đơn đã có shipper nhận cũng phải nêu lý do
    CHECK(POST("/api/order/cancel", {{"id", to_string(idC)}}, &disp).status == 400);                  // phải ghi lý do
    Resp cn3 = POST("/api/order/cancel", {{"id", to_string(idC)}, {"reason", "Khách gọi tổng đài"}}, &disp);
    CHECK(cn3.status == 200 && jlast(cn3.body, "cancelFee") > 0);
    // Shipper từ chối chuyến: đơn về hàng chờ
    Resp o4 = POST("/api/order/add", base, &vip);
    int idD = (int)jnum(o4.body, "created");
    POST("/api/order/confirm", {{"id", to_string(idD)}}, &disp);
    CHECK(dispatchApply(disp));
    st = GET("/api/state", {}, &tuan);
    trip = tripOf(st.body, idD);
    CHECK(POST("/api/trip/decline", {{"id", to_string(trip)}}, &tuan).status == 400);   // thiếu lý do
    CHECK(POST("/api/trip/decline", {{"id", to_string(trip)}, {"reason", "Xe hỏng"}}, &tuan).status == 200);
    CHECK(orderStatus(vip, idD) == "0");
    // Giao thất bại → giao lại / hoàn kho
    CHECK(dispatchApply(disp));
    st = GET("/api/state", {}, &tuan);
    trip = tripOf(st.body, idD);
    CHECK(POST("/api/trip/accept", {{"id", to_string(trip)}}, &tuan).status == 200);
    CHECK(POST("/api/shift/fail", {{"id", to_string(idD)}, {"reason", "0"}}, &tuan).status == 200);
    CHECK(orderStatus(vip, idD) == "3");
    CHECK(POST("/api/shift/requeue", {{"id", to_string(idD)}}, &tuan).status == 403);
    CHECK(POST("/api/shift/requeue", {{"id", to_string(idD)}}, &disp).status == 200);
    CHECK(POST("/api/shift/requeue", {{"id", to_string(idD)}}, &disp).status == 409);
    CHECK(POST("/api/shift/return", {{"id", to_string(idD)}}, &disp).status == 409);   // chỉ đơn thất bại mới hoàn kho
    // Cấu hình: chỉ admin sửa; đổi biểu phí ảnh hưởng báo giá
    CHECK(GET("/api/config", {}, &vip).status == 403);
    CHECK(POST("/api/config/update", {{"perKm", "5000"}}, &vip).status == 403);
    CHECK(POST("/api/config/update", {{"perKm", "-1"}}, &admin).status == 400);
    long long g0 = jnum(GET("/api/quote", {{"destination", "9"}, {"weight", "1"}}).body, "gross");
    CHECK(POST("/api/config/update", {{"perKm", "5000"}}, &admin).status == 200);
    long long g1 = jnum(GET("/api/quote", {{"destination", "9"}, {"weight", "1"}}).body, "gross");
    CHECK(g1 > g0);
    CHECK(POST("/api/config/update", {{"perKm", "4000"}}, &admin).status == 200);
    CHECK(jnum(GET("/api/quote", {{"destination", "9"}, {"weight", "1"}}).body, "gross") == g0);
    // Mã giảm giá: kiểm tra dữ liệu
    CHECK(POST("/api/promos/save", {{"code", "ab"}, {"type", "pct"}, {"value", "10"}}, &admin).status == 400);
    CHECK(POST("/api/promos/save", {{"code", "TEST20"}, {"type", "pct"}, {"value", "150"}}, &admin).status == 400);
    CHECK(POST("/api/promos/save", {{"code", "TEST20"}, {"type", "pct"}, {"value", "20"}, {"maxDiscount", "15000"}}, &admin).status == 200);
    CHECK(POST("/api/promos/save", {{"code", "TEST21"}, {"type", "amt"}, {"value", "1000"}}, &vip).status == 403);
    CHECK(GET("/api/promos", {}, &disp).status == 200 && GET("/api/promos", {}, &vip).status == 403);
    CHECK(POST("/api/promos/remove", {{"code", "TEST20"}}, &admin).status == 200);
    // Tìm kiếm / lọc / sắp xếp / phân trang danh sách đơn
    Resp lst = GET("/api/orders/list", {{"q", "binh"}, {"sort", "id"}, {"dir", "asc"}, {"size", "2"}}, &vip);
    CHECK(lst.status == 200 && jnum(lst.body, "pages") >= 1);
    lst = GET("/api/orders/list", {{"status", "4"}}, &vip);
    CHECK(lst.has("\"statusName\":\"Đã huỷ\"") && !lst.has("\"statusName\":\"Mới\""));
    CHECK(GET("/api/orders/list", {{"q", "huong viet"}}, &disp).status == 200);
}

static void testBillingFlow() {
    cout << "== Khai giá, cân quy đổi, người nhận trả cước, phân công tay, thu hồi chuyến, giao lại / hoàn, ví đối soát, bồi thường\n";
    Who admin = sharedLogin("admin", "admin123"), disp = sharedLogin("quanly", "Quanly@2026"), tuan = sharedLogin("tuan", "shipper123");
    Who an = login("anphat", "Ngoisao@2026"), vip = sharedLogin("khachvip", "Huongviet@456");
    POST("/api/shipper/ready", {{"ready", "1"}}, &tuan);
    POST("/api/shift/available", {{"index", "0"}}, &disp);
    // Báo giá: kích thước làm tăng khối lượng tính cước, khai giá trên 1 triệu có phí bảo hiểm, người nhận trả thì phải thu = COD + tổng cước
    Resp q0 = GET("/api/quote", {{"destination", "5"}, {"weight", "1"}}, &an);
    Params big = {{"destination", "5"}, {"weight", "1"}, {"length", "60"}, {"width", "40"}, {"height", "40"}, {"value", "3000000"}, {"payer", "receiver"}, {"cod", "100000"}};
    Resp q1 = GET("/api/quote", big, &an);
    CHECK_MSG(q1.status == 200 && jnum(q1.body, "chargedWeight") == 16 && jnum(q1.body, "insurance") == 15000, q1.body);
    CHECK(jlast(q1.body, "total") == jnum(q1.body, "net") + 15000 && jnum(q1.body, "collect") == 100000 + jlast(q1.body, "total"));
    CHECK(jnum(q1.body, "gross") > jnum(q0.body, "gross"));
    CHECK(GET("/api/quote", {{"destination", "5"}, {"weight", "1"}, {"length", "60"}}, &an).status == 400);
    CHECK(GET("/api/quote", {{"destination", "5"}, {"weight", "1"}, {"value", "200000000"}}, &an).status == 400);
    // Tạo đơn: hạn giao tối đa 1440 phút; người nhận trả cước cần SĐT
    Params p1 = big;
    p1.push_back({"recipient", "Cô Mai"});
    p1.push_back({"phone", "0966666666"});
    Resp c1 = POST("/api/order/add", p1, &an);
    CHECK_MSG(c1.status == 200 && jlast(c1.body, "total") == jlast(q1.body, "total"), c1.body);
    int P1 = (int)jnum(c1.body, "created");
    CHECK(POST("/api/order/add", {{"destination", "5"}, {"weight", "1"}, {"recipient", "Cô Mai"}, {"phone", "0966666666"}, {"deadline", "2000"}}, &an).status == 400);
    CHECK(POST("/api/order/add", {{"destination", "5"}, {"weight", "1"}, {"payer", "receiver"}}, &disp).status == 400);
    int P2 = (int)jnum(POST("/api/order/add", {{"destination", "7"}, {"weight", "2"}, {"recipient", "Anh Tư"}, {"phone", "0977777777"}, {"cod", "200000"}}, &an).body, "created");
    int P3 = (int)jnum(POST("/api/order/add", {{"destination", "8"}, {"weight", "1"}, {"recipient", "Bà Năm"}, {"phone", "0988888888"}}, &an).body, "created");
    int P4 = (int)jnum(POST("/api/order/add", {{"destination", "6"}, {"weight", "1"}, {"recipient", "Chú Sáu"}, {"phone", "0912121212"}}, &an).body, "created");
    CHECK(P1 > 0 && P2 > 0 && P3 > 0 && P4 > 0);
    Resp inv = GET("/api/order/invoice", {{"id", to_string(P1)}}, &an);
    CHECK(jstr(inv.body, "payer") == "receiver" && jnum(inv.body, "insurance") == 15000 && jnum(inv.body, "payable") == jnum(inv.body, "total"));
    // Khách tự sửa đơn Mới của mình; không sửa được đơn người khác, không dùng API của nhân viên
    CHECK(POST("/api/order/edit", {{"id", to_string(P3)}, {"weight", "2"}, {"note", "Dễ vỡ"}}, &an).status == 200);
    CHECK(POST("/api/order/edit", {{"id", to_string(P3)}, {"weight", "2"}}, &vip).status == 403);
    CHECK(POST("/api/order/update", {{"id", to_string(P3)}, {"weight", "2"}}, &an).status == 403);
    Resp wallet0 = GET("/api/wallet", {}, &an);
    long long bal0 = jnum(wallet0.body, "balance"), pend0 = jnum(wallet0.body, "pending");
    for (int id : {P1, P2, P3, P4}) CHECK(POST("/api/order/confirm", {{"id", to_string(id)}}, &disp).status == 200);
    // Phân công tay + thu hồi chuyến chưa nhận
    CHECK(POST("/api/dispatch/assign", {{"orders", to_string(P3)}}, &disp).status == 400);
    CHECK(POST("/api/dispatch/assign", {{"orders", to_string(P3)}, {"shipper", "0"}}, &an).status == 403);
    Resp a1 = POST("/api/dispatch/assign", {{"orders", to_string(P3)}, {"shipper", "0"}}, &disp);
    CHECK_MSG(a1.status == 200 && jnum(a1.body, "assigned") == 1, a1.body);
    int tripA = tripOf(GET("/api/state", {}, &disp).body, P3);
    CHECK(tripA > 0 && POST("/api/trip/recall", {{"id", to_string(tripA)}}, &disp).status == 400);
    CHECK(POST("/api/trip/recall", {{"id", to_string(tripA)}, {"reason", "Shipper không phản hồi"}}, &disp).status == 200);
    CHECK(orderStatus(an, P3) == "0");
    CHECK(POST("/api/dispatch/assign", {{"orders", to_string(P3)}, {"shipper", "0"}}, &disp).status == 200);
    CHECK(POST("/api/dispatch/assign", {{"orders", to_string(P3)}, {"shipper", "0"}}, &disp).status == 409);   // không còn ở Chờ giao
    POST("/api/trip/recall", {{"id", to_string(tripOf(GET("/api/state", {}, &disp).body, P3))}, {"reason", "Gộp chuyến"}}, &disp);
    Resp a2 = POST("/api/dispatch/assign", {{"orders", to_string(P1) + "," + to_string(P2) + "," + to_string(P3) + "," + to_string(P4)}, {"shipper", "0"}}, &disp);
    CHECK_MSG(a2.status == 200 && jnum(a2.body, "assigned") == 4, a2.body);
    CHECK(POST("/api/order/edit", {{"id", to_string(P1)}, {"weight", "2"}}, &an).status == 409);   // đã có shipper nhận: không tự sửa nữa
    int tripB = tripOf(GET("/api/state", {}, &disp).body, P1);
    CHECK(POST("/api/trip/accept", {{"id", to_string(tripB)}}, &tuan).status == 200);
    CHECK(POST("/api/trip/recall", {{"id", to_string(tripB)}, {"reason", "Thử thu hồi"}}, &disp).status == 409);   // đã nhận
    // Giao: người nhận trả cước -> thu đủ COD + tổng cước; sổ COD ghi số đã thu
    auto codeOf = [&](int id) { return jstr(GET("/api/order/get", {{"id", to_string(id)}}, &an).body, "code"); };
    long long collect1 = jnum(GET("/api/order/get", {{"id", to_string(P1)}}, &an).body, "collect");
    CHECK(collect1 == 100000 + jlast(q1.body, "total"));
    CHECK(POST("/api/order/deliver", {{"id", to_string(P1)}, {"code", codeOf(P1)}, {"cash", "100000"}}, &tuan).status == 400);
    CHECK(POST("/api/order/deliver", {{"id", to_string(P1)}, {"code", codeOf(P1)}, {"cash", to_string(collect1)}}, &tuan).status == 200);
    CHECK(POST("/api/order/deliver", {{"id", to_string(P2)}, {"code", codeOf(P2)}, {"cash", "200000"}}, &tuan).status == 200);
    long long total2 = jnum(GET("/api/order/invoice", {{"id", to_string(P2)}}, &an).body, "total");
    Resp w1 = GET("/api/wallet", {}, &an);
    CHECK_MSG(jnum(w1.body, "pending") - pend0 == 300000 && jnum(w1.body, "balance") - bal0 == 300000 - total2, w1.body);
    // Shipper nộp, điều phối đối soát -> tiền thu hộ hết "đang chờ"
    Resp held = GET("/api/cod", {}, &tuan);
    CHECK(POST("/api/cod/remit", {{"handed", to_string(jnum(held.body, "held"))}}, &tuan).status == 200);
    Resp cod = GET("/api/cod", {}, &disp);
    size_t sub = cod.body.find("\"state\":\"submitted\"");
    size_t rid = cod.body.rfind("{\"id\":", sub);
    CHECK(sub != string::npos && POST("/api/cod/confirm", {{"remit", to_string(jnum(cod.body, "id", rid))}, {"counted", to_string(jnum(cod.body, "expected", rid))}}, &disp).status == 200);
    Resp w2 = GET("/api/wallet", {}, &an);
    CHECK(jnum(w2.body, "pending") == pend0 && jnum(w2.body, "available") == jnum(w2.body, "balance") - pend0);
    // Thất bại: khách tự hẹn giao lại (đổi SĐT); lần thất bại thứ hai tự hoàn kho và tính phí hoàn; khách tự yêu cầu hoàn
    CHECK(POST("/api/shift/fail", {{"id", to_string(P3)}, {"reason", "0"}}, &tuan).status == 200);
    CHECK(POST("/api/shift/fail", {{"id", to_string(P4)}, {"reason", "0"}}, &tuan).status == 200);
    CHECK(POST("/api/order/redeliver", {{"id", to_string(P1)}}, &an).status == 409);
    CHECK(POST("/api/order/redeliver", {{"id", to_string(P3)}}, &vip).status == 403);
    CHECK(POST("/api/order/redeliver", {{"id", to_string(P3)}, {"phone", "123"}}, &an).status == 400);
    CHECK(POST("/api/order/redeliver", {{"id", to_string(P3)}, {"phone", "0988888999"}, {"note", "Giao sau 17h"}}, &an).status == 200);
    CHECK(orderStatus(an, P3) == "0" && GET("/api/order/get", {{"id", to_string(P3)}}, &an).has("0988888999"));
    CHECK(POST("/api/order/return", {{"id", to_string(P4)}}, &vip).status == 403);
    Resp ret = POST("/api/order/return", {{"id", to_string(P4)}}, &an);
    CHECK_MSG(ret.status == 200 && ret.has("phí hoàn"), ret.body);
    CHECK(orderStatus(an, P4) == "5" && jnum(GET("/api/order/invoice", {{"id", to_string(P4)}}, &an).body, "payable") > 0);
    CHECK(POST("/api/dispatch/assign", {{"orders", to_string(P3)}, {"shipper", "0"}}, &disp).status == 200);
    CHECK(POST("/api/trip/accept", {{"id", to_string(tripOf(GET("/api/state", {}, &disp).body, P3))}}, &tuan).status == 200);
    CHECK(POST("/api/shift/fail", {{"id", to_string(P3)}, {"reason", "0"}}, &tuan).status == 200);
    CHECK(orderStatus(an, P3) == "5" && jnum(GET("/api/order/get", {{"id", to_string(P3)}}, &an).body, "returnFee") > 0);
    // Bồi thường khiếu nại: đúng loại, có trần theo giá trị khai, mỗi khiếu nại một lần
    Resp cp = POST("/api/complaint/add", {{"order", to_string(P1)}, {"title", "Hàng vỡ"}, {"body", "Hộp bị móp, hàng bên trong vỡ"}}, &an);
    string C = to_string(jnum(cp.body, "id"));
    CHECK(GET("/api/complaints", {{"id", C}}, &disp).has("\"compCaps\""));
    CHECK(POST("/api/complaint/compensate", {{"id", C}, {"kind", "late"}, {"amount", "10000"}}, &disp).status == 400);
    CHECK(POST("/api/complaint/compensate", {{"id", C}, {"kind", "damaged"}, {"amount", "3000001"}}, &disp).status == 400);
    CHECK(POST("/api/complaint/compensate", {{"id", C}, {"kind", "damaged"}, {"amount", "500000"}}, &an).status == 403);
    CHECK(POST("/api/complaint/compensate", {{"id", C}, {"kind", "damaged"}, {"amount", "500000"}, {"note", "Theo giá trị khai"}}, &disp).status == 200);
    CHECK(POST("/api/complaint/compensate", {{"id", C}, {"kind", "damaged"}, {"amount", "1000"}}, &disp).status == 409);
    CHECK(GET("/api/complaints", {{"id", C}}, &an).has("\"compensation\":{\"amount\":500000"));
    // Chi trả: chỉ quản trị viên, không vượt "có thể rút", chuyển khoản cần mã giao dịch
    Resp w3 = GET("/api/wallet", {}, &an);
    long long avail = jnum(w3.body, "available");
    CHECK(avail > 500000);
    CHECK(POST("/api/wallet/payout", {{"customer", "anphat"}, {"amount", "1000"}, {"method", "cash"}}, &vip).status == 403);
    CHECK(POST("/api/wallet/payout", {{"customer", "anphat"}, {"amount", to_string(avail + 1)}, {"method", "cash"}}, &admin).status == 409);
    CHECK(POST("/api/wallet/payout", {{"customer", "anphat"}, {"amount", "100000"}, {"method", "bank"}}, &admin).status == 400);
    CHECK(POST("/api/wallet/payout", {{"customer", "anphat"}, {"kind", "collect"}, {"amount", "1000"}, {"method", "cash"}}, &admin).status == 409);
    CHECK(POST("/api/wallet/payout", {{"customer", "anphat"}, {"amount", "100000"}, {"method", "bank"}, {"ref", "VCB123456"}}, &admin).status == 200);
    CHECK(jnum(GET("/api/wallet", {}, &an).body, "available") == avail - 100000);
    CHECK(GET("/api/wallet", {{"customer", "khachvip"}}, &an).has("\"customer\":\"anphat\""));   // khách chỉ xem ví của mình
    CHECK(GET("/api/wallets", {}, &an).status == 403 && GET("/api/wallets", {}, &disp).has("\"customer\":\"anphat\""));
    // Báo cáo: cảnh báo cho nhân viên, doanh thu 14 ngày cho quản trị viên, ví cho khách
    CHECK(GET("/api/reports/summary", {}, &disp).has("\"alerts\":") && countOf(GET("/api/reports/summary", {}, &admin).body, "\"day\":") == 14);
    CHECK(GET("/api/reports/summary", {}, &an).has("\"wallet\":{"));
    // Hạn mức nợ phí: khách nợ quá hạn mức không đặt được đơn mới, nộp bù xong thì đặt lại được
    Who moi = login("khachmoi", "Bautroi@2026");
    CHECK_MSG(!moi.cookie.empty(), "khachmoi không đăng nhập được");
    int D1 = (int)jnum(POST("/api/order/add", {{"destination", "5"}, {"weight", "1"}, {"recipient", "Cô Ba"}, {"phone", "0933333333"}}, &moi).body, "created");
    CHECK(D1 > 0 && POST("/api/order/confirm", {{"id", to_string(D1)}}, &disp).status == 200);
    CHECK(POST("/api/dispatch/assign", {{"orders", to_string(D1)}, {"shipper", "0"}}, &disp).status == 200);
    Resp dc = POST("/api/order/cancel", {{"id", to_string(D1)}, {"reason", "Khách đổi kế hoạch"}}, &moi);   // đã phân công: mất phí huỷ
    long long debt = -jnum(GET("/api/wallet", {}, &moi).body, "balance");
    CHECK_MSG(dc.status == 200 && debt > 1000, dc.body);
    CHECK(POST("/api/config/update", {{"debtLimit", "-5"}}, &admin).status == 400);
    CHECK(POST("/api/config/update", {{"debtLimit", "1000"}}, &vip).status == 403);
    CHECK(POST("/api/config/update", {{"debtLimit", "1000"}}, &admin).status == 200);
    CHECK(jnum(GET("/api/wallet", {}, &moi).body, "debtLimit") == 1000);   // khách thấy hạn mức trong ví
    Params again = {{"destination", "5"}, {"weight", "1"}, {"recipient", "Cô Ba"}, {"phone", "0933333333"}};
    Resp blocked = POST("/api/order/add", again, &moi);
    CHECK_MSG(blocked.status == 409 && blocked.has("đang nợ"), blocked.body);
    CHECK(POST("/api/order/add", {{"destination", "5"}, {"weight", "1"}, {"owner", "khachmoi"}}, &disp).status == 200);   // nhân viên vẫn tạo hộ được
    CHECK(POST("/api/wallet/payout", {{"customer", "khachmoi"}, {"kind", "collect"}, {"amount", to_string(debt)}, {"method", "cash"}}, &admin).status == 200);
    CHECK(POST("/api/order/add", again, &moi).status == 200);
    CHECK(POST("/api/config/update", {{"debtLimit", "500000"}}, &admin).status == 200);
    // Cấu hình mới: kiểm tra miền giá trị
    CHECK(POST("/api/config/update", {{"volDivisor", "10"}}, &admin).status == 400);
    CHECK(POST("/api/config/update", {{"insRate", "0.5"}}, &admin).status == 400);
}


// ============================================================================
// Ghép đơn tự động kiểu Grab: không còn điều phối viên, hệ thống mời shipper gần nhất
static void waitSeconds(double sec) { this_thread::sleep_for(chrono::milliseconds((int)(sec * 1000))); }

static void cancelOpenOrders(const Who& admin) {
    for (const char* st : {"0", "1", "3", "6", "7"}) {
        Resp ol = GET("/api/orders/list", {{"status", st}, {"size", "100"}}, &admin);
        size_t pos = 0;
        while ((pos = ol.body.find("\"id\":", pos)) != string::npos) {
            int id = (int)jnum(ol.body, "id", pos);
            pos += 5;
            POST("/api/order/cancel", {{"id", to_string(id)}, {"reason", "Dọn dẹp kiểm thử"}}, &admin);
        }
    }
}

static void testAutoMatch() {
    cout << "== Ghép đơn tự động: shipper gần nhất, lời mời, từ chối / hết hạn → người kế, hết người → báo khách, nhả đơn, đánh giá hai chiều\n";
    Who admin = sharedLogin("admin", "admin123"), tuan = sharedLogin("tuan", "shipper123"), binh = sharedLogin("binh", "shipper123"),
        cuong = sharedLogin("cuong", "shipper123"), vip = sharedLogin("khachvip", "Huongviet@456"), an = login("anphat", "Ngoisao@2026");
    // Bước chuẩn bị: dọn đơn đang mở, mọi shipper có mặt và sẵn sàng, đặt vị trí đứng
    cancelOpenOrders(admin);
    for (const char* i : {"0", "1", "2"}) POST("/api/shift/available", {{"index", i}}, &admin);
    CHECK(POST("/api/shift/absent", {{"index", "3"}}, &admin).status == 200);   // shipper mới duyệt ở bước trước: cho nghỉ để kịch bản chỉ có ba người
    for (const Who* w : {&tuan, &binh, &cuong}) POST("/api/shipper/ready", {{"ready", "1"}}, w);
    CHECK(POST("/api/shipper/location", {{"node", "11"}}, &tuan).status == 200);    // Bến xe Miền Đông: cách kho 2 phút
    CHECK(POST("/api/shipper/location", {{"node", "1"}}, &binh).status == 200);     // Chợ Bến Thành
    CHECK(POST("/api/shipper/location", {{"node", "7"}}, &cuong).status == 200);    // Chợ Lớn
    CHECK(POST("/api/shipper/location", {{"node", "9999"}}, &tuan).status == 400);
    CHECK(POST("/api/shipper/location", {{"node", "3"}}, &vip).status == 403);
    CHECK(POST("/api/config/update", {{"autoMatch", "1"}, {"offerSeconds", "60"}, {"matchGiveUp", "0"}, {"clockSpeed", "0"}}, &admin).status == 200);
    CHECK(POST("/api/config/update", {{"offerSeconds", "0"}}, &admin).status == 400);
    CHECK(POST("/api/config/update", {{"clockSpeed", "999"}}, &admin).status == 400);
    CHECK(GET("/api/config", {}, &admin).has("\"autoMatch\":true"));
    Params oneKg = {{"destination", "9"}, {"weight", "1"}, {"recipient", "Chị Hoa"}, {"phone", "0988777666"}};
    auto offerHolder = [&](int order) -> string {   // shipper đang giữ lời mời của đơn (hoặc "")
        for (const auto& pr : vector<pair<const char*, const Who*>>{{"tuan", &tuan}, {"binh", &binh}, {"cuong", &cuong}}) {
            Resp st = GET("/api/state", {}, pr.second);
            size_t t = st.body.find("\"trips\":[");
            size_t p = st.body.find("{\"order\":" + to_string(order) + ",", t);
            if (t != string::npos && p != string::npos) return pr.first;
        }
        return "";
    };
    // Biên: hàng nặng hơn xe lớn nhất, giao về chính kho -> báo lỗi ngay thay vì treo đơn
    Resp hv = POST("/api/order/add", Params{{"destination", "9"}, {"weight", "500"}, {"recipient", "Chị Hoa"}, {"phone", "0988777666"}}, &vip);
    CHECK_MSG(hv.status >= 400 && hv.has("\"weight\""), hv.body);
    Resp dp = POST("/api/order/add", Params{{"destination", "0"}, {"weight", "1"}, {"recipient", "Chị Hoa"}, {"phone", "0988777666"}}, &vip);
    CHECK_MSG(dp.status >= 400 && dp.has("\"destination\""), dp.body);
    // 1. Khách đặt đơn: không còn bước chờ xác nhận, hệ thống mời đúng shipper gần kho nhất (tuan)
    Resp c1 = POST("/api/order/add", oneKg, &vip);
    CHECK_MSG(c1.status == 200 && c1.has("tìm shipper"), c1.body);
    int O1 = (int)jnum(c1.body, "created");
    CHECK(orderStatus(vip, O1) == "7" && offerHolder(O1) == "tuan");
    Resp ts = GET("/api/state", {}, &tuan);
    CHECK(ts.has("\"accepted\":false") && ts.has("\"offerLeft\":") && ts.has("Ghép tự động"));
    CHECK(!GET("/api/state", {}, &binh).has("\"order\":" + to_string(O1) + ","));      // shipper khác không thấy lời mời
    CHECK(GET("/api/notifications", {}, &tuan).has("gần bạn"));
    // Khách chưa biết ai được mời; không sửa được đơn đang chờ shipper trả lời
    CHECK(!GET("/api/order/get", {{"id", to_string(O1)}}, &vip).has("Anh Tuấn"));
    CHECK(GET("/api/order/get", {{"id", to_string(O1)}}, &vip).has("\"cancelFeeNow\":0"));   // lời mời chưa ai nhận: huỷ miễn phí
    CHECK(POST("/api/order/edit", {{"id", to_string(O1)}, {"weight", "2"}}, &vip).status == 409);
    // 2. Shipper từ chối (bắt buộc lý do) → đơn chuyển cho người gần kế tiếp (binh), không mời lại tuan
    int tripT = pendingTrip(ts.body);
    CHECK(tripT > 0 && POST("/api/trip/decline", {{"id", to_string(tripT)}}, &tuan).status == 400);
    CHECK(POST("/api/trip/decline", {{"id", to_string(tripT)}, {"reason", "Đang ăn trưa"}}, &tuan).status == 200);
    CHECK(offerHolder(O1) == "binh" && orderStatus(vip, O1) == "7");
    // 3. Shipper tắt "sẵn sàng" khi đang giữ lời mời: lời mời bị gỡ, đơn sang người kế (cuong, xe tải chở được 1kg)
    CHECK(POST("/api/shipper/ready", {{"ready", "0"}}, &binh).status == 200);
    CHECK(offerHolder(O1) == "cuong");
    CHECK(POST("/api/shipper/ready", {{"ready", "1"}}, &binh).status == 200);
    // 4. Nhận lời mời: đơn "Đang giao", khách thấy thông tin shipper (tên, xe, biển số), không đổi vị trí khi đang bận
    int tripC = pendingTrip(GET("/api/state", {}, &cuong).body);
    CHECK(tripC > 0 && POST("/api/trip/accept", {{"id", to_string(tripC)}}, &binh).status == 403);
    CHECK(POST("/api/trip/accept", {{"id", to_string(tripC)}}, &cuong).status == 200);
    Resp od = GET("/api/order/get", {{"id", to_string(O1)}}, &vip);
    CHECK(orderStatus(vip, O1) == "1" && od.has("Anh Cường") && od.has("51C-333.33") && od.has("\"cancelFeeNow\":"));
    CHECK(POST("/api/shipper/location", {{"node", "3"}}, &cuong).status == 409);
    CHECK(POST("/api/shipper/vehicle", {{"vehicle", "2"}, {"capacity", "60"}, {"plate", "51C-333.33"}}, &cuong).status == 409);
    // 5. Huỷ khi shipper đã nhận mà chưa lấy hàng: bắt buộc lý do; có phí huỷ; shipper nhận thông báo kèm lý do; shipper rảnh lại
    Resp o2 = POST("/api/order/add", oneKg, &an);
    int O2 = (int)jnum(o2.body, "created");
    string h2 = offerHolder(O2);
    CHECK(h2 == "tuan");
    CHECK(POST("/api/trip/accept", {{"id", to_string(pendingTrip(GET("/api/state", {}, &tuan).body))}}, &tuan).status == 200);
    CHECK(POST("/api/order/cancel", {{"id", to_string(O2)}}, &an).status == 400);
    Resp cn = POST("/api/order/cancel", {{"id", to_string(O2)}, {"reason", "Đặt nhầm địa chỉ"}}, &an);
    CHECK_MSG(cn.status == 200 && jlast(cn.body, "cancelFee") > 0, cn.body);
    CHECK(GET("/api/notifications", {}, &tuan).has("Đặt nhầm địa chỉ"));
    CHECK(GET("/api/order/get", {{"id", to_string(O2)}}, &an).has("Đặt nhầm địa chỉ"));
    // 6. Giao hàng bằng mã; shipper đánh giá khách (hai chiều); khách đánh giá shipper
    string code = jstr(GET("/api/order/get", {{"id", to_string(O1)}}, &vip).body, "code");
    CHECK(POST("/api/order/deliver", {{"id", to_string(O1)}, {"code", code}}, &cuong).status == 200);
    CHECK(orderStatus(vip, O1) == "2");
    CHECK(POST("/api/order/rate-customer", {{"id", to_string(O1)}, {"stars", "4"}}, &vip).status == 403);
    CHECK(POST("/api/order/rate-customer", {{"id", to_string(O1)}, {"stars", "4"}}, &tuan).status == 403);   // không phải đơn tuan giao
    CHECK(POST("/api/order/rate-customer", {{"id", to_string(O1)}, {"stars", "9"}}, &cuong).status == 400);
    CHECK(POST("/api/order/rate-customer", {{"id", to_string(O1)}, {"stars", "5"}, {"comment", "Khách thân thiện"}}, &cuong).status == 200);
    CHECK(POST("/api/order/rate-customer", {{"id", to_string(O1)}, {"stars", "5"}}, &cuong).status == 409);
    CHECK(GET("/api/notifications", {}, &vip).has("đánh giá bạn 5 sao"));
    CHECK(POST("/api/order/rate", {{"id", to_string(O1)}, {"stars", "5"}}, &vip).status == 200);
    // 7. Nhả đơn (như tài xế Grab huỷ chuyến): cần lý do, đơn đi tìm người khác, không mời lại người vừa nhả
    Resp o3 = POST("/api/order/add", oneKg, &vip);
    int O3 = (int)jnum(o3.body, "created");
    string h3 = offerHolder(O3);
    CHECK(h3 == "tuan");   // tuan đã rảnh (đơn O2 bị huỷ), vẫn gần kho nhất
    CHECK(POST("/api/trip/accept", {{"id", to_string(pendingTrip(GET("/api/state", {}, &tuan).body))}}, &tuan).status == 200);
    CHECK(POST("/api/order/release", {{"id", to_string(O3)}}, &tuan).status == 400);
    CHECK(POST("/api/order/release", {{"id", to_string(O3)}}, &binh).status == 403);
    CHECK(POST("/api/order/release", {{"id", to_string(O3)}, {"reason", "Xe hết xăng"}}, &tuan).status == 200);
    string h3b = offerHolder(O3);
    CHECK(h3b == "binh" && orderStatus(vip, O3) == "7");   // binh ở Bến Thành (14 phút tới kho giờ cao điểm), gần hơn cuong vừa giao xong ở Sân bay
    // 8. Quản trị viên cho shipper đang giữ đơn nghỉ đột xuất: đơn chuyển người khác
    CHECK(POST("/api/trip/accept", {{"id", to_string(pendingTrip(GET("/api/state", {}, &binh).body))}}, &binh).status == 200);
    CHECK(POST("/api/shift/absent", {{"index", "1"}}, &vip).status == 403);
    CHECK(POST("/api/shift/absent", {{"index", "1"}}, &admin).status == 200);
    string h3c = offerHolder(O3);
    CHECK_MSG(h3c == "cuong", h3c);   // tuan đã nhả đơn này, binh nghỉ: chỉ còn cuong
    CHECK(POST("/api/shift/available", {{"index", "1"}}, &admin).status == 200);
    // 9. Hết hạn trả lời: offerSeconds = 1; không ai nhận thì lần lượt mời hết cả đội, rồi báo khách "chưa có shipper"
    cancelOpenOrders(admin);
    CHECK(POST("/api/config/update", {{"offerSeconds", "1"}}, &admin).status == 200);
    Resp o4 = POST("/api/order/add", oneKg, &an);
    int O4 = (int)jnum(o4.body, "created");
    CHECK(orderStatus(an, O4) == "7");
    string firstHolder = offerHolder(O4);
    CHECK(!firstHolder.empty());
    bool exhausted = false;
    for (int i = 0; i < 8 && !exhausted; ++i) {
        waitSeconds(2.2);
        GET("/api/me", {}, &an);   // mỗi yêu cầu chạy một nhịp kiểm tra hết hạn
        exhausted = GET("/api/order/get", {{"id", to_string(O4)}}, &an).has("\"noShipper\":true");
    }
    CHECK(exhausted && orderStatus(an, O4) == "0");
    CHECK(GET("/api/notifications", {}, &an).has("Chưa có shipper nhận đơn"));
    CHECK(GET("/api/notifications", {}, &tuan).has("bỏ lỡ lời mời"));
    // 10. Khách bấm "Tìm lại": mời lại từ đầu; người khác không tìm lại hộ được
    CHECK(POST("/api/order/retry", {{"id", to_string(O4)}}, &vip).status == 403);
    CHECK(POST("/api/order/retry", {{"id", to_string(O4)}}, &an).status == 200);
    CHECK(orderStatus(an, O4) == "7" && !offerHolder(O4).empty());
    CHECK(POST("/api/order/retry", {{"id", to_string(O4)}}, &an).status == 409);   // đang có lời mời, không còn ở Chờ giao
    CHECK(POST("/api/config/update", {{"offerSeconds", "60"}}, &admin).status == 200);
    // 11. Đơn nặng: chỉ xe tải (cuong) chở nổi → tuan, binh bị bỏ qua dù gần hơn
    cancelOpenOrders(admin);
    Params heavy = oneKg;
    for (auto& kv : heavy) if (kv.first == "weight") kv.second = "30";
    int O5 = (int)jnum(POST("/api/order/add", heavy, &vip).body, "created");
    CHECK(O5 > 0 && offerHolder(O5) == "cuong");
    // 12. Quản trị viên vẫn thu hồi lời mời được; lời mời bị thu hồi chuyển tiếp ngay
    int tripH = pendingTrip(GET("/api/state", {}, &cuong).body);
    CHECK(POST("/api/trip/recall", {{"id", to_string(tripH)}, {"reason", "Xe tải bận việc khác"}}, &admin).status == 200);
    CHECK(orderStatus(vip, O5) == "0" || orderStatus(vip, O5) == "7");
    // 13. Tắt ghép tự động: đơn của khách quay lại luồng cũ (chờ xác nhận), không ai được mời
    cancelOpenOrders(admin);
    CHECK(POST("/api/config/update", {{"autoMatch", "0"}}, &admin).status == 200);
    int O6 = (int)jnum(POST("/api/order/add", oneKg, &vip).body, "created");
    CHECK(orderStatus(vip, O6) == "6" && offerHolder(O6).empty());
    // Bật lại: đơn Chờ giao (đã xác nhận) được mời ngay
    CHECK(POST("/api/order/confirm", {{"id", to_string(O6)}}, &admin).status == 200);
    CHECK(orderStatus(vip, O6) == "0");
    CHECK(POST("/api/config/update", {{"autoMatch", "1"}}, &admin).status == 200);
    CHECK(orderStatus(vip, O6) == "7");
    // 14. Vai trò điều phối viên đã bỏ: không còn trong API, tài khoản cũ được khoá chờ quản trị viên chọn lại
    CHECK(POST("/api/users/add", {{"username", "dpcu"}, {"role", "dispatcher"}, {"password", "Quanly@456"}, {"displayName", "Điều phối cũ"}}, &admin).status == 400);
    CHECK(!GET("/api/state", {}, &admin).has("\"role\":\"dispatcher\""));
    cancelOpenOrders(admin);
}

static void testPersistence(const string& dir) {
    cout << "== Lưu file: mỗi loại dữ liệu một file riêng trong data/, ghi nguyên tử\n";
    auto read = [&](const string& f) {
        ifstream in(dir + "/" + f);
        stringstream ss;
        ss << in.rdbuf();
        return ss.str();
    };
    CHECK(read("users.txt").find("khachmoi") != string::npos && read("users.txt").find("Bautroi@2026") == string::npos);
    CHECK(read("orders_live.txt").find("kh=khachvip") != string::npos && read("orders_live.txt").find("tt=2") != string::npos);
    CHECK(read("audit.txt").find("order.deliver") != string::npos);
    CHECK(read("cod_ledger.txt").find("Anh") != string::npos);
    CHECK(read("complaints.txt").find("Thiếu") != string::npos);
    CHECK(read("notifications.txt").find("khachvip") != string::npos);
    CHECK(read("reviews.txt").find("Giao") != string::npos);
    CHECK(read("shippers.txt").find("Trần Shipper Mới") != string::npos);
    CHECK(read("addresses.txt").find("Nhà%20hàng") != string::npos && read("addresses.txt").find("Chi%20nhánh") == string::npos);
    CHECK(!filesystem::exists(dir + "/users.txt.tmp"));
    // File gốc của đồ án không bị ghi đè bởi đơn của khách
    CHECK(read("orders.txt").find("kh=khachvip") == string::npos);
    CHECK(read("customer_ledger.txt").find(" comp anphat 500000 ") != string::npos && read("customer_ledger.txt").find(" payout anphat 100000 ") != string::npos);
    CHECK(read("orders_live.txt").find("gtri=3000000 bh=15000 kt=60x40x40 tra=1") != string::npos && read("orders_live.txt").find(" hoan=") != string::npos);
}

static void testPermissionMatrix() {
    cout << "== Ma trận quyền: 4 chủ thể (khách vãng lai, quản trị viên, shipper, khách hàng) x MỌI API\n";
    struct Role { const char* user; const char* pass; unsigned bit; };
    vector<Role> roles = {{"admin", "admin123", Auth::B_ADMIN}, {"tuan", "shipper123", Auth::B_SHIPPER}, {"khachvip", "Huongviet@456", Auth::B_CUSTOMER}};
    vector<Who> who;
    for (const Role& r : roles) {
        Who w = login(r.user, r.pass);
        CHECK(!w.cookie.empty());
        who.push_back(w);
    }
    int cells = 0;
    for (const Auth::Rule& rule : Auth::rules()) {
        string path = string("/api/") + rule.path;
        if (string(rule.path) == "logout") continue;   // kiểm riêng ở cuối vì làm mất phiên
        // Khách vãng lai
        {
            Resp r = call(rule.method, path, {});
            bool allowed = rule.roles & Auth::B_GUEST;
            bool denied = r.status == 401 && r.has("\"auth\":true");
            CHECK_MSG(allowed ? !denied : denied, string(rule.method) + " " + rule.path + " khách vãng lai -> " + to_string(r.status));
            ++cells;
        }
        for (size_t i = 0; i < roles.size(); ++i) {
            Resp r = call(rule.method, path, {}, &who[i]);
            bool allowed = rule.roles & roles[i].bit;
            bool roleDenied = r.status == 403 && r.has("không có quyền dùng chức năng này");
            CHECK_MSG(allowed ? (!roleDenied && r.status != 401) : roleDenied,
                      string(rule.method) + " " + rule.path + " vai trò " + roles[i].user + " -> " + to_string(r.status) + " " + r.body.substr(0, 80));
            ++cells;
        }
    }
    cout << "   (" << cells << " ô ma trận)\n";
    // API không có trong bảng: bị từ chối (không có quy tắc = không cho phép)
    CHECK(GET("/api/khong-co-quy-tac", {}, &who[0]).status == 404);
    CHECK(POST("/api/admin/secret", {}, &who[0]).status == 404);
    CHECK(POST("/api/logout", {}, &who[0]).status == 200);
}

int main() {
    namespace fs = std::filesystem;
    fs::path dir = fs::temp_directory_path() / ("dt08_web_test_" + to_string(chrono::steady_clock::now().time_since_epoch().count()));
    fs::create_directories(dir);
    fs::copy("data", dir, fs::copy_options::recursive);
    prepareData(dir.string());
    ServerConfig cfg;
    cfg.port = PORT;
    cfg.dataDir = dir.string();
    cfg.webDir = "web";
    cfg.demo = true;
    thread server([cfg] { runWebServer(cfg); });
    waitForServer();
    // Thứ tự có chủ đích: các bước sau dùng trạng thái do bước trước tạo ra; ma trận quyền chạy cuối vì có API làm thay đổi dữ liệu
    testRegister();
    testLogin();
    testPasswordReset();
    testSecurityHeaders();
    testUsersAndApproval();
    testProfile();
    testOrderLifecycle();
    testCancelAndPromo();
    testBillingFlow();
    testAutoMatch();
    testPersistence(dir.string());
    testPermissionMatrix();
    stopWebServerForTests();
    server.join();
    error_code ec;
    fs::remove_all(dir, ec);
    if (failed) {
        cerr << "\n>>> " << failed << " KIEM TRA THAT BAI (" << passed << " dat) <<<\n";
        return 1;
    }
    cout << "\n>>> TAT CA " << passed << " KIEM TRA DEU DAT <<<\n";
    return 0;
}
