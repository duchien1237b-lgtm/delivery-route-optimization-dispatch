#include "WebServer.h"

#include "Analysis.h"
#include "Auth.h"
#include "BellmanFord.h"
#include "Billing.h"
#include "Commerce.h"
#include "Dispatcher.h"
#include "Estimator.h"
#include "FileIO.h"
#include "Graph.h"
#include "History.h"
#include "Json.h"
#include "MinHeap.h"
#include "Operations.h"
#include "OrderFlow.h"
#include "Pricing.h"
#include "Support.h"
#include "TextUtil.h"
#include "Trie.h"
#include "Trace.h"
#include "ShortestPath.h"
#include "Traversal.h"

#include "httplib.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <chrono>
#include <fstream>
#include <iostream>
#include <mutex>
#include <random>
#include <set>
#include <sstream>
#include <stdexcept>

namespace {

// ============================== Trạng thái app ==============================

struct Dataset {
    std::string key, title, description, mapFile, ordersFile;
};

const std::vector<Dataset> DATASETS = {
    {"hcm", "Nội thành TP.HCM",
     "14 điểm, đường hai chiều. Có đường cấm xe tải, cao tốc cấm xe máy và cụm Cần Giờ chưa có tuyến nối.",
     "map.txt", "orders.txt"},
    {"oneway", "Quận 1: đường một chiều",
     "Đồ thị có hướng, một số tuyến đối tác trợ giá nên chi phí âm. Dijkstra sẽ cho kết quả sai, cần Bellman-Ford.",
     "map_oneway.txt", "orders_oneway.txt"},
    {"negcycle", "Dữ liệu lỗi: chu trình âm",
     "Ba tuyến khuyến mãi chồng nhau tạo vòng lặp có tổng chi phí âm. Dùng để kiểm tra Bellman-Ford.",
     "map_negcycle.txt", ""},
    {"city", "Đô thị mô phỏng (2.000 điểm)",
     "Lưới 2.000 giao lộ, sông phía đông chỉ qua được ở 5 cây cầu, vành đai cấm xe máy, trung tâm cấm xe tải. "
     "Dùng để thử thuật toán trên đồ thị lớn: so A* với Dijkstra, điều phối 24 đơn.",
     "map_city.txt", "orders_city.txt"},
    {"saved", "Bản đồ đã lưu", "Bản đồ và đơn hàng bạn đã lưu bằng nút Lưu trên server.",
     "my_map.txt", "my_orders.txt"},
};

// Trạng thái bản đồ được chụp lại để Hoàn tác / Làm lại
struct MapSnapshot {
    Graph graph;
    std::vector<Order> orders;
    int depot = 0;
    std::string dataset;
};

struct AppState {
    std::mutex mtx;
    Graph graph;
    std::vector<Order> orders;
    std::vector<Shipper> shippers;
    int depot = 0;
    std::string dataset;
    std::string dataDir;
    int shiftStart = 8 * 60;              // giờ bắt đầu ca (phút từ 0:00)
    RushProfile rush;                     // giờ cao điểm (bật mặc định)
    ShiftManager shift;                   // chuyến giao, trạng thái ca, lịch sử điều phối
    UndoRedo<MapSnapshot> history{30};    // hai ngăn xếp hoàn tác / làm lại
    PlaceIndex index;                     // cây Trie tìm điểm theo tên
    bool indexDirty = true;
    std::string notice;                   // thông báo gửi kèm lần trả state kế tiếp
    // Đăng nhập & phân quyền
    Auth::AccountStore accounts;
    Auth::SessionStore sessions;
    Auth::LoginGuard guard;
    std::string usersFile;
    Auth::Account me;                     // tài khoản của yêu cầu đang xử lý (đã khoá mutex)
    bool authed = false;
    std::string token;                    // mã phiên của yêu cầu đang xử lý
    std::string setCookie;                // header Set-Cookie trả kèm (đăng nhập / đăng xuất)
    std::string csrf;                     // mã CSRF của phiên đang xử lý
    std::string ip, device;               // địa chỉ và thiết bị của yêu cầu đang xử lý
    // Thương mại, hỗ trợ, sổ COD (mỗi thứ một file riêng trong data/, ghi nguyên tử)
    Commerce::PromoStore promos;
    Commerce::AddressBook addresses;
    Commerce::ReviewStore reviews;
    Commerce::ReviewStore custReviews;    // shipper đánh giá khách (đánh giá hai chiều)
    Commerce::StatsStore stats;
    Support::NotificationStore notes;
    Support::AuditLog audit;
    Support::Mailbox mailbox;
    Support::ComplaintStore complaints;
    Flow::CodLedger cod;
    Billing::CustomerLedger ledger;       // chi trả / thu bù / bồi thường của khách (ví đối soát)
    Auth::ResetStore resets;
    Auth::RateLimiter limiter;
    bool demo = true;                     // chế độ demo: hộp thư giả lập đọc được qua giao diện
    unsigned dirty = 0;                   // các file cần ghi lại sau yêu cầu này
    unsigned long long rev = 0;           // tăng mỗi khi dữ liệu đổi: giao diện hỏi nhẹ (api/me) rồi mới tải lại state
    long long lastTick = 0, lastMatch = 0;   // giây (đồng hồ thật) lần chạy đồng hồ ca / ghép đơn gần nhất
};

AppState S;

// Lỗi do người dùng nhập sai -> trả HTTP 400 kèm thông báo
struct BadRequest : std::runtime_error {
    using std::runtime_error::runtime_error;
};
// Không đủ quyền với dữ liệu cụ thể (vd khách xem đơn người khác) -> HTTP 403
struct Forbidden : std::runtime_error {
    using std::runtime_error::runtime_error;
};

// Mâu thuẫn với trạng thái hiện tại (vd chuyển trạng thái đơn không hợp lệ) -> HTTP 409
struct Conflict : std::runtime_error {
    using std::runtime_error::runtime_error;
};
// Đăng nhập sai -> HTTP 401 (thông báo chung, không nói sai tên hay sai mật khẩu)
struct Unauthorized : std::runtime_error {
    using std::runtime_error::runtime_error;
};
// Quá nhiều yêu cầu -> HTTP 429 kèm Retry-After
struct TooMany : std::runtime_error {
    int retryAfter;
    TooMany(const std::string& msg, int wait) : std::runtime_error(msg), retryAfter(wait) {}
};
// Dữ liệu nhập sai theo từng trường -> HTTP 400 kèm "fields": {tên_trường: lỗi}
struct Invalid : BadRequest {
    std::map<std::string, std::string> fields;
    Invalid(const std::string& msg, std::map<std::string, std::string> f) : BadRequest(msg), fields(std::move(f)) {}
};

const char* SESSION_COOKIE = "dt08_session";
const size_t MAX_BODY = 4 * 1024 * 1024;

// Các file cần ghi lại sau khi xử lý xong yêu cầu (xem flushDirty)
enum Dirty : unsigned {
    D_USERS = 1, D_PROMOS = 2, D_ADDR = 4, D_REVIEWS = 8, D_STATS = 16, D_NOTES = 32,
    D_AUDIT = 64, D_COMPL = 128, D_COD = 256, D_CONFIG = 512, D_ORDERS = 1024, D_FLEET = 2048, D_LEDGER = 4096, D_CREVIEWS = 8192
};
void mark(unsigned bits) {
    S.dirty |= bits;
    ++S.rev;
}

int64_t nowSeconds() {
    return std::chrono::duration_cast<std::chrono::seconds>(std::chrono::system_clock::now().time_since_epoch()).count();
}

// Mã phiên: header "Authorization: Bearer <mã>" (dùng cho script / curl) hoặc cookie HttpOnly dt08_session.
// viaCookie = true khi dùng cookie: lúc này trình duyệt tự gửi kèm nên yêu cầu thay đổi dữ liệu phải có mã CSRF.
std::string requestToken(const httplib::Request& req, bool& viaCookie) {
    viaCookie = false;
    std::string auth = req.get_header_value("Authorization");
    if (auth.rfind("Bearer ", 0) == 0) return auth.substr(7);
    std::string cookie = req.get_header_value("Cookie");
    std::string key = std::string(SESSION_COOKIE) + "=";
    size_t pos = 0;
    while ((pos = cookie.find(key, pos)) != std::string::npos) {
        if (pos == 0 || cookie[pos - 1] == ' ' || cookie[pos - 1] == ';') {
            size_t end = cookie.find(';', pos);
            viaCookie = true;
            return cookie.substr(pos + key.size(), end == std::string::npos ? std::string::npos : end - pos - key.size());
        }
        pos += key.size();
    }
    return "";
}

void jsonError(httplib::Response& res, int status, const std::string& msg, bool needLogin = false) {
    res.status = status;
    Json out = Json::object().set("ok", false).set("error", msg);
    if (needLogin) out.set("auth", true);
    res.set_content(out.dump(), "application/json; charset=utf-8");
}

// "Chrome trên Windows"... đủ để người dùng nhận ra thiết bị trong danh sách phiên
std::string deviceName(const std::string& ua) {
    std::string browser = ua.find("Edg/") != std::string::npos ? "Edge"
                        : ua.find("Firefox/") != std::string::npos ? "Firefox"
                        : ua.find("Chrome/") != std::string::npos ? "Chrome"
                        : ua.find("Safari/") != std::string::npos ? "Safari"
                        : ua.empty() ? "Ứng dụng dòng lệnh" : "Trình duyệt khác";
    std::string os = ua.find("Windows") != std::string::npos ? "Windows"
                   : ua.find("Android") != std::string::npos ? "Android"
                   : (ua.find("iPhone") != std::string::npos || ua.find("iPad") != std::string::npos) ? "iOS"
                   : ua.find("Mac OS") != std::string::npos ? "macOS"
                   : ua.find("Linux") != std::string::npos ? "Linux" : "";
    return os.empty() ? browser : browser + " trên " + os;
}

bool sameSecret(const std::string& a, const std::string& b) {
    if (a.size() != b.size()) return false;
    unsigned char d = 0;
    for (size_t i = 0; i < a.size(); ++i) d |= static_cast<unsigned char>(a[i] ^ b[i]);
    return d == 0;
}

// Yêu cầu thay đổi dữ liệu phải đến từ chính trang web này (Origin trùng Host nếu trình duyệt gửi Origin)
bool sameOrigin(const httplib::Request& req) {
    std::string origin = req.get_header_value("Origin");
    if (origin.empty()) return true;
    size_t p = origin.find("://");
    std::string authority = p == std::string::npos ? origin : origin.substr(p + 3);
    return authority == req.get_header_value("Host");
}

bool isCsrfExempt(const std::string& path) {
    return path == "login" || path == "register" || path == "password/forgot" || path == "password/reset";
}

// Xác định tài khoản của yêu cầu và kiểm tra quyền. Trả về false (đã ghi lỗi 401/403) nếu không được phép.
//   401: chưa đăng nhập / phiên hết hạn;  403: đăng nhập rồi nhưng vai trò không có quyền, sai Origin hoặc CSRF.
bool authorize(const httplib::Request& req, httplib::Response& res) {
    S.authed = false;
    S.me = Auth::Account{};
    S.setCookie.clear();
    S.csrf.clear();
    S.ip = req.remote_addr;
    S.device = deviceName(req.get_header_value("User-Agent"));
    bool viaCookie = false;
    S.token = requestToken(req, viaCookie);
    std::string path = req.path.rfind("/api/", 0) == 0 ? req.path.substr(5) : req.path;
    if (!S.token.empty()) {
        std::string user = S.sessions.resolve(S.token, nowSeconds());
        const Auth::Account* a = user.empty() ? nullptr : S.accounts.find(user);
        if (a && a->status == Auth::ACTIVE) {
            S.me = *a;
            S.authed = true;
            S.csrf = S.sessions.csrf(S.token);
        } else if (a) {
            S.sessions.remove(S.token);   // tài khoản bị khoá / vô hiệu hoá sau khi đăng nhập
        }
    }
    if (req.method != "GET" && !sameOrigin(req)) {
        jsonError(res, 403, "Yêu cầu bị từ chối vì không đến từ chính trang web này");
        return false;
    }
    if (!Auth::isPublic(req.method, path)) {
        if (!S.authed) {
            jsonError(res, 401, "Bạn cần đăng nhập để dùng chức năng này", true);
            return false;
        }
        if (!Auth::canAccess(S.me.role, req.method, path)) {
            jsonError(res, 403, std::string("Tài khoản ") + Auth::roleName(S.me.role) + " không có quyền dùng chức năng này");
            return false;
        }
    }
    if (req.method != "GET" && S.authed && viaCookie && !isCsrfExempt(path) &&
        !sameSecret(req.get_header_value("X-CSRF-Token"), S.csrf)) {
        jsonError(res, 403, "Thiếu hoặc sai mã CSRF, hãy tải lại trang");
        return false;
    }
    return true;
}

bool isAdmin() { return S.authed && S.me.role == Auth::ADMIN; }
bool isStaff() { return isAdmin(); }   // nhân viên vận hành = quản trị viên (đã bỏ vai trò điều phối viên)
bool isShipper() { return S.authed && S.me.role == Auth::SHIPPER; }
bool isCustomer() { return S.authed && S.me.role == Auth::CUSTOMER; }
unsigned actorBit() { return S.authed ? Auth::roleBit(S.me.role) : Auth::B_GUEST; }

// ----------------------------------------------------- Nhật ký kiểm toán & thông báo
std::string actorLabel() { return S.authed ? S.me.username : std::string("(khách)"); }
void audit(const std::string& action, const std::string& target, const std::string& detail = "") {
    S.audit.add(actorLabel(), S.authed ? Auth::roleKey(S.me.role) : "guest", action, target, detail, nowSeconds());
    mark(D_AUDIT);
}
void notify(const std::string& user, const std::string& kind, int order, const std::string& text) {
    if (user.empty() || !S.accounts.find(user)) return;
    S.notes.add(user, kind, order, text, nowSeconds());
    mark(D_NOTES);
}
void notifyStaff(const std::string& kind, int order, const std::string& text) {
    for (const Auth::Account& a : S.accounts.all())
        if (a.role == Auth::ADMIN && a.status == Auth::ACTIVE) notify(a.username, kind, order, text);
}

std::string dataPath(const std::string& file) { return S.dataDir + "/" + file; }

bool fileExists(const std::string& path) { return std::ifstream(path).good(); }

std::string nodeName(int id) {
    return S.graph.hasNode(id) ? S.graph.getNode(id).name : ("#" + std::to_string(id));
}

void fixDepot() {
    if (!S.graph.hasNode(S.depot)) {
        auto ids = S.graph.nodeIds();
        S.depot = ids.empty() ? -1 : ids.front();
    }
}

MapSnapshot snapshot() { return MapSnapshot{S.graph, S.orders, S.depot, S.dataset}; }

// Gọi SAU khi sửa bản đồ THÀNH CÔNG: đẩy trạng thái cũ (chụp trước khi sửa) vào ngăn hoàn tác.
void mapChanged(bool resetShift);
void commitMap(MapSnapshot before, const std::string& label, bool resetShift) {
    S.history.record(std::move(before), label);
    mapChanged(resetShift);
}

// Sau khi bản đồ thay đổi. Thay đổi làm sai lộ trình đã giao (xoá điểm/đường, đổi kho...)
// thì huỷ ca giao đang chạy, mọi đơn về Chờ giao.
void mapChanged(bool resetShift) {
    S.indexDirty = true;
    mark(D_ORDERS);
    if (resetShift && S.shift.active()) {
        S.shift.reset(S.orders, true);
        S.notice = "Bản đồ thay đổi nên ca giao đang chạy đã được huỷ. Các đơn quay về trạng thái chờ giao.";
    }
}

int shipperIndexByNameEarly(const std::string& name) {
    for (size_t i = 0; i < S.shippers.size(); ++i)
        if (S.shippers[i].name == name) return static_cast<int>(i);
    return -1;
}

// Đơn nạp từ file: mỗi đơn phải có mã xác nhận giao
void ensureDeliveryCodes() {
    for (Order& o : S.orders)
        if (o.deliveryCode.empty()) o.deliveryCode = Flow::newDeliveryCode();
}

bool loadDataset(const std::string& key, std::string& err) {
    for (const Dataset& d : DATASETS) {
        if (d.key != key) continue;
        Graph g;
        if (!FileIO::loadMap(dataPath(d.mapFile), g, err)) return false;
        std::vector<OrderRecord> recs;
        // Bộ "hcm" ưu tiên bản làm việc data/orders_live.txt (đơn khách đã đặt, kèm trạng thái) nếu có
        bool live = false;
        if (key == "hcm" && fileExists(dataPath("orders_live.txt"))) {
            std::string e2;
            live = FileIO::loadOrders(dataPath("orders_live.txt"), recs, e2, &g);
            if (!live) std::cerr << "[Canh bao] orders_live.txt loi (" << e2 << "), dung orders.txt\n";
        }
        if (!live && !d.ordersFile.empty() && fileExists(dataPath(d.ordersFile))) {
            recs.clear();
            if (!FileIO::loadOrders(dataPath(d.ordersFile), recs, err, &g)) return false;
        }
        S.graph = std::move(g);
        S.orders.assign(recs.begin(), recs.end());
        if (live)   // khởi động lại thì các chuyến đang chạy không còn: đơn đã phân công / đang giao về hàng chờ
            for (size_t i = 0; i < S.orders.size(); ++i) {
                Order& o = S.orders[i];
                o.shipper = shipperIndexByNameEarly(recs[i].shipperName);
                if (o.status == DISPATCHED || o.status == ASSIGNED) {
                    o.status = PENDING;
                    o.shipper = -1;
                    o.eta = -1;
                }
            }
        ensureDeliveryCodes();
        S.dataset = key;
        S.depot = 0;
        fixDepot();
        return true;
    }
    err = "Khong co bo du lieu '" + key + "'";
    return false;
}

// ============================ Đọc tham số request ===========================

bool has(const httplib::Request& r, const char* k) { return r.has_param(k); }

std::string str(const httplib::Request& r, const char* k, const std::string& def = "") {
    return r.has_param(k) ? r.get_param_value(k) : def;
}

double num(const httplib::Request& r, const char* k) {
    if (!r.has_param(k)) throw BadRequest(std::string("Thiếu tham số '") + k + "'");
    std::string v = r.get_param_value(k);
    try {
        size_t used = 0;
        double d = std::stod(v, &used);
        if (used != v.size() || !std::isfinite(d)) throw std::invalid_argument("x");
        return d;
    } catch (...) {
        throw BadRequest(std::string("Tham số '") + k + "' phải là số, nhận được \"" + v + "\"");
    }
}

double num(const httplib::Request& r, const char* k, double def) { return has(r, k) ? num(r, k) : def; }
int integer(const httplib::Request& r, const char* k) { return static_cast<int>(num(r, k)); }
int integer(const httplib::Request& r, const char* k, int def) { return has(r, k) ? integer(r, k) : def; }

std::vector<int> intList(const std::string& s) {
    std::vector<int> v;
    std::stringstream ss(s);
    std::string item;
    while (std::getline(ss, item, ',')) {
        if (item.empty()) continue;
        try {
            v.push_back(std::stoi(item));
        } catch (...) {
            throw BadRequest("Danh sách số không hợp lệ: \"" + s + "\"");
        }
    }
    return v;
}

int requireNode(const httplib::Request& r, const char* k) {
    int id = integer(r, k);
    if (!S.graph.hasNode(id)) throw BadRequest("Không có điểm #" + std::to_string(id) + " trên bản đồ");
    return id;
}

// Giờ xuất phát (phút trong ngày) cho tính giờ cao điểm; -1 nếu không gửi
double departParam(const httplib::Request& r) {
    if (!has(r, "depart") || str(r, "depart").empty()) return -1;
    double d = num(r, "depart");
    if (d < 0 || d >= 24 * 60) throw BadRequest("Giờ xuất phát không hợp lệ");
    return d;
}

const RushProfile* rushPtr() { return S.rush.enabled ? &S.rush : nullptr; }

Json rushJson() {
    Json w = Json::array();
    for (const RushWindow& x : S.rush.windows) w.push(Json::object().set("start", x.start).set("end", x.end));
    return Json::object()
        .set("enabled", S.rush.enabled)
        .set("windows", w)
        .set("ramp", S.rush.ramp)
        .set("sensitivity", Json(std::vector<double>(S.rush.sensitivity, S.rush.sensitivity + 3)));
}

Vehicle vehicleParam(const httplib::Request& r) { return vehicleFromInt(integer(r, "vehicle", 3)); }
Criterion criterionParam(const httplib::Request& r) { return criterionFromString(str(r, "criterion", "distance")); }

// ================================ JSON helpers ==============================

Json pathJson(const std::vector<int>& p) { return Json(p); }

Json graphJson() {
    const Graph& g = S.graph;
    Json nodes = Json::array();
    for (int id : g.nodeIds()) {
        const Node& n = g.getNode(id);
        nodes.push(Json::object()
                       .set("id", id)
                       .set("name", n.name)
                       .set("x", n.x)
                       .set("y", n.y)
                       .set("degree", static_cast<int>(g.neighbors(id).size())));
    }
    Json edges = Json::array();
    for (int u : g.nodeIds())
        for (const Edge& e : g.neighbors(u)) {
            if (!g.isDirected() && e.to < u) continue;
            edges.push(Json::object()
                           .set("u", u)
                           .set("v", e.to)
                           .set("km", e.distance)
                           .set("time", e.time)
                           .set("cost", e.cost)
                           .set("costK", edgeCostK(e))
                           .set("allowed", e.allowed)
                           .set("jam", e.jam)
                           .set("closed", e.closed)
                           .set("peak", e.peak));
        }
    auto comps = Traversal::connectedComponents(g);
    return Json::object()
        .set("directed", g.isDirected())
        .set("nodes", nodes)
        .set("edges", edges)
        .set("stats", Json::object()
                          .set("nodes", g.nodeCount())
                          .set("edges", g.edgeCount())
                          .set("components", static_cast<int>(comps.size()))
                          .set("negative", g.hasNegativeCost())
                          .set("traffic", g.trafficCount()));
}

// Khối lượng tính cước: max(khối lượng thật, quy đổi theo kích thước). Đơn không khai kích thước = khối lượng thật.
double chargedWeightOf(const Order& o) {
    return Billing::chargedWeight(o.weight, o.dimL, o.dimW, o.dimH, Commerce::config().volDivisor);
}

// Cước của từng đơn theo biểu phí (Pricing), song song với S.orders
std::vector<Pricing::Fee> orderFees() {
    std::vector<double> km = Pricing::feeDistances(S.graph, S.depot, S.orders);
    std::vector<Pricing::Fee> fees;
    for (size_t i = 0; i < S.orders.size(); ++i)
        fees.push_back(Pricing::shippingFee(km[i], chargedWeightOf(S.orders[i]), S.orders[i].urgent, S.orders[i].cod));
    return fees;
}

Json feeJson(const Pricing::Fee& f) {
    if (!f.valid) return Json();
    return Json::object().set("km", f.km).set("base", f.base).set("distance", f.distance).set("weight", f.weight)
        .set("urgent", f.urgent).set("cod", f.cod).set("total", f.total);
}

// ------------------------------------------------- Phạm vi dữ liệu theo vai trò
// Quản trị viên thấy mọi đơn; shipper chỉ thấy chuyến và đơn mình chở;
// khách hàng chỉ thấy đơn của mình. Mọi API đọc đơn đều đi qua View (chống truy cập chéo — IDOR).
int shipperIndexByName(const std::string& name) {
    for (size_t i = 0; i < S.shippers.size(); ++i)
        if (S.shippers[i].name == name) return static_cast<int>(i);
    return -1;
}
int myShipperIndex() { return isShipper() ? shipperIndexByName(S.me.link) : -1; }

struct View {
    bool all = true;
    int shipper = -1;
    std::set<int> orders;   // mã đơn được thấy (khi all = false)
};
bool shipperSees(const Order& o, int idx) {
    if (idx < 0) return false;
    if (o.shipper != idx) return false;
    return o.status == DISPATCHED || o.status == ASSIGNED || o.status == DELIVERED || o.status == FAILED || o.status == RETURNED;
}
View currentView() {
    View v;
    if (isStaff()) return v;
    v.all = false;
    if (isShipper()) {
        v.shipper = myShipperIndex();
        for (const Order& o : S.orders)
            if (shipperSees(o, v.shipper)) v.orders.insert(o.id);
        for (const Trip& t : S.shift.trips())
            if (v.shipper >= 0 && t.shipper == v.shipper)
                for (const TripStop& st : t.stops) v.orders.insert(st.orderId);
    } else {
        for (const Order& o : S.orders)
            if (o.owner == S.me.username) v.orders.insert(o.id);
    }
    return v;
}
bool tripVisible(const Trip& t, const View& v) {
    if (v.all) return true;
    if (v.shipper >= 0) return t.shipper == v.shipper;
    if (!t.accepted) return false;   // khách chưa biết shipper nào được mời, chỉ thấy chuyến sau khi có người nhận
    for (const TripStop& st : t.stops)
        if (v.orders.count(st.orderId)) return true;
    return false;
}
bool canSeeOrder(const Order& o) { return currentView().all || currentView().orders.count(o.id) > 0; }

Order* findOrderById(int id) {
    for (Order& o : S.orders)
        if (o.id == id) return &o;
    return nullptr;
}
// Tìm đơn theo mã và kiểm tra quyền xem: không có -> 400; có nhưng không phải của mình -> 403 (không tiết lộ thêm gì).
Order& orderForActor(int id) {
    Order* o = findOrderById(id);
    // Người không phải nhân viên nhận cùng một câu trả lời (403) cho đơn không tồn tại và đơn của người khác: không dò được mã đơn
    if (!o) {
        if (isStaff()) throw BadRequest("Không có đơn " + std::to_string(id));
        throw Forbidden("Đơn " + std::to_string(id) + " không thuộc quyền xem của bạn");
    }
    if (!canSeeOrder(*o)) throw Forbidden("Đơn " + std::to_string(id) + " không thuộc quyền xem của bạn");
    return *o;
}

// Số tiền khách phải trả (cước đã chốt lúc đặt trừ các khoản giảm; đơn cũ chưa chốt thì tính theo biểu phí hiện hành)
long long orderNet(const Order& o, const Pricing::Fee& fee) {
    long long gross = o.gross > 0 ? o.gross : (fee.valid ? static_cast<long long>(fee.total) : 0);
    return std::max(0LL, gross - o.loyaltyDiscount - o.promoDiscount);
}
// Tổng phải trả = cước sau giảm + phí bảo hiểm
long long orderTotal(const Order& o, const Pricing::Fee& fee) { return orderNet(o, fee) + o.insuranceFee; }
// Shipper thu của người nhận: tiền thu hộ, cộng tổng cước nếu người nhận trả cước
long long orderCollect(const Order& o, const Pricing::Fee& fee) { return o.cod + (o.receiverPays ? orderTotal(o, fee) : 0); }

std::string ownerDisplay(const std::string& user) {
    const Auth::Account* a = S.accounts.find(user);
    return a ? a->displayName : user;
}

double shipperScore(const std::string& name) {
    int count = 0;
    double avg = S.reviews.average(name, &count);
    return Commerce::performanceScore(S.stats.get(name), avg, count);
}

bool shipperReady(int idx) {
    if (idx < 0 || idx >= static_cast<int>(S.shippers.size())) return false;
    for (const Auth::Account& a : S.accounts.all())
        if (a.role == Auth::SHIPPER && a.link == S.shippers[idx].name) return a.ready && a.status == Auth::ACTIVE;
    return true;   // shipper không có tài khoản (dữ liệu mẫu cũ): coi như sẵn sàng
}

const Auth::Account* shipperAccountOf(int idx) {
    if (idx < 0 || idx >= static_cast<int>(S.shippers.size())) return nullptr;
    for (const Auth::Account& a : S.accounts.all())
        if (a.role == Auth::SHIPPER && a.link == S.shippers[idx].name) return &a;
    return nullptr;
}

// Nơi shipper đang đứng khi rảnh: chỗ giao đơn gần nhất (trong ca) > vị trí đã lưu trong tài khoản > rải đều theo thứ tự id điểm
int shipperNode(int idx) {
    int n = S.shift.standby(idx);
    if (n >= 0 && S.graph.hasNode(n)) return n;
    if (const Auth::Account* a = shipperAccountOf(idx))
        if (a->home >= 0 && S.graph.hasNode(a->home)) return a->home;
    std::vector<int> ids = S.graph.nodeIds();
    if (ids.empty()) return S.depot;
    std::sort(ids.begin(), ids.end());
    return ids[(static_cast<size_t>(idx) * ids.size()) / std::max<size_t>(1, S.shippers.size())];
}

// Thông tin shipper khách được xem sau khi shipper nhận đơn (kiểu Grab: tên, xe, biển số, SĐT, điểm đánh giá)
Json carrierInfoJson(int idx) {
    if (idx < 0 || idx >= static_cast<int>(S.shippers.size())) return Json();
    const Shipper& s = S.shippers[idx];
    const Auth::Account* a = shipperAccountOf(idx);
    int n = 0;
    double avg = S.reviews.average(s.name, &n);
    return Json::object().set("name", s.name).set("vehicleName", vehicleName(s.vehicle)).set("plate", a ? a->plate : std::string())
        .set("phone", a ? a->phone : std::string()).set("rating", n ? Json(avg) : Json()).set("ratings", n);
}

// Shipper đã lấy hàng tại kho chưa? Đơn Đang giao mà giờ ca chưa tới giờ rời kho thì khách còn huỷ được (phí thấp)
bool pickedUp(const Order& o) {
    if (o.status == FAILED) return true;
    if (o.status != ASSIGNED) return false;
    const Trip* t = S.shift.tripOfOrder(o.id);
    if (!t || t->pathTimes.empty()) return true;
    return S.shift.clock() >= t->pathTimes.front() - 1e-9;
}
// Trạng thái dùng để tính phí huỷ: shipper đã nhận nhưng chưa lấy hàng tính như "đã phân công".
// Ghép tự động: lời mời chưa ai nhận (DISPATCHED) chưa ràng buộc shipper nào nên huỷ miễn phí.
int cancelFeeStatus(const Order& o) {
    if (o.status == ASSIGNED && !pickedUp(o)) return static_cast<int>(DISPATCHED);
    if (o.status == DISPATCHED && Commerce::config().autoMatch) return static_cast<int>(PENDING);
    return o.status;
}
// Người xem hiện tại huỷ được đơn này ngay bây giờ không? (khách không huỷ được sau khi shipper đã lấy hàng)
bool cancelAllowedNow(const Order& o) {
    if (!Flow::check(o.status, "cancel", actorBit()).empty()) return false;
    return !(isCustomer() && o.status == ASSIGNED && pickedUp(o));
}

// Phần cước shipper nhận (cùng công thức với lúc ghi nhận đã giao)
long long shipperEarning(const Order& o, const Pricing::Fee& fee) {
    long long part = fee.valid ? Commerce::shippingPart(fee) : 0;
    long long shipping = std::max(0LL, part - o.loyaltyDiscount - o.promoDiscount);
    return Commerce::floor500(shipping * Commerce::config().shipperShare);
}

// Một đơn dưới dạng JSON, đã lọc theo vai trò của người xem
Json orderRow(const Order& o, size_t index, const Pricing::Fee& fee, const std::set<int>& unreachable,
              const std::map<int, std::string>& carrier) {
    bool late = o.deadline >= 0 && ((o.status == DELIVERED && o.deliveredAt > o.deadline + 1e-9) ||
                                    (o.status == ASSIGNED && o.eta > o.deadline + 1e-9));
    auto car = carrier.find(o.id);
    Json j = Json::object();
    j.set("status", o.status)
        .set("statusName", orderStatusName(o.status))
        .set("carrier", car != carrier.end() && !(isCustomer() && o.status == DISPATCHED) ? Json(car->second) : Json())
        .set("eta", o.eta >= 0 ? Json(o.eta) : Json())
        .set("deliveredAt", o.deliveredAt >= 0 ? Json(o.deliveredAt) : Json())
        .set("late", late)
        .set("index", static_cast<int>(index))
        .set("id", o.id)
        .set("destination", o.destination)
        .set("destinationName", nodeName(o.destination))
        .set("weight", o.weight)
        .set("urgent", o.urgent)
        .set("deadline", o.deadline)
        .set("note", o.note)
        .set("attempts", o.attempts)
        .set("failReason", o.failReason)
        .set("failReasonName", o.failReason >= 0 ? Json(failReasonName(o.failReason)) : Json())
        .set("cod", static_cast<double>(o.cod))
        .set("phone", o.phone)
        .set("recipient", o.recipient)
        .set("fee", feeJson(fee))
        .set("gross", static_cast<double>(o.gross > 0 ? o.gross : (fee.valid ? static_cast<long long>(fee.total) : 0)))
        .set("loyaltyDiscount", static_cast<double>(o.loyaltyDiscount))
        .set("promo", o.promo)
        .set("promoDiscount", static_cast<double>(o.promoDiscount))
        .set("net", static_cast<double>(orderNet(o, fee)))
        .set("value", static_cast<double>(o.declaredValue))
        .set("insurance", static_cast<double>(o.insuranceFee))
        .set("total", static_cast<double>(orderTotal(o, fee)))
        .set("dims", Billing::dimsText(o.dimL, o.dimW, o.dimH))
        .set("chargedWeight", chargedWeightOf(o))
        .set("receiverPays", o.receiverPays)
        .set("collect", static_cast<double>(orderCollect(o, fee)))
        .set("returnFee", static_cast<double>(o.returnFee))
        .set("cancelFee", static_cast<double>(o.cancelFee))
        .set("createdAt", static_cast<double>(o.createdAt))
        .set("deliveredReal", static_cast<double>(o.deliveredReal))
        .set("reachable", !unreachable.count(o.destination));
    if (!isShipper()) j.set("owner", o.owner).set("ownerName", o.owner.empty() ? Json() : Json(ownerDisplay(o.owner)));
    j.set("noShipper", o.status == PENDING && o.noShipperAt > 0).set("tried", static_cast<int>(o.tried.size()));
    if (isCustomer() || isStaff()) {
        bool known = o.shipper >= 0 && (o.status == ASSIGNED || o.status == DELIVERED || o.status == FAILED || o.status == RETURNED);
        j.set("carrierInfo", known ? carrierInfoJson(o.shipper) : Json());
        if (o.status == DISPATCHED && isStaff() && o.shipper >= 0 && o.shipper < static_cast<int>(S.shippers.size())) j.set("offeredTo", S.shippers[o.shipper].name);
    }
    if (isShipper() || isStaff()) {
        int cn = 0;
        double cavg = o.owner.empty() ? 0 : S.custReviews.averageOfCustomer(o.owner, &cn);
        j.set("earn", static_cast<double>(shipperEarning(o, fee)))
            .set("customerName", o.owner.empty() ? Json() : Json(ownerDisplay(o.owner)))
            .set("customerRating", cn ? Json(cavg) : Json()).set("customerRatings", cn)
            .set("ratedCustomer", S.custReviews.ofOrder(o.id) != nullptr);
    }
    if (isCustomer() || isStaff()) {
        j.set("proof", o.proofNote).set("rated", S.reviews.ofOrder(o.id) != nullptr);
        // Phí huỷ nếu huỷ ngay bây giờ (cùng công thức với order/cancel) -> giao diện báo trước cho người dùng
        if (cancelAllowedNow(o)) {
            long long part = fee.valid ? Commerce::shippingPart(fee) : 0;
            j.set("cancelFeeNow", static_cast<double>(Flow::cancelFee(cancelFeeStatus(o), std::max(0LL, part - o.loyaltyDiscount - o.promoDiscount), Commerce::config())));
        }
    }
    // Mã xác nhận giao: chỉ chủ đơn thấy (đọc cho shipper khi nhận hàng). Điều phối viên, quản trị viên và shipper không thấy.
    if (isCustomer() && o.owner == S.me.username) j.set("code", o.deliveryCode);
    return j;
}

std::set<int> unreachableSet() {
    std::set<int> unreachable;
    if (S.graph.hasNode(S.depot))
        for (int u : Traversal::unreachableFrom(S.graph, S.depot)) unreachable.insert(u);
    return unreachable;
}
std::map<int, std::string> carrierMap() {
    std::map<int, std::string> carrier;   // mã đơn -> tên shipper đang chở
    for (const Trip& t : S.shift.trips())
        for (const TripStop& s : t.stops) carrier[s.orderId] = t.shipperName;
    return carrier;
}

Json ordersJson(const std::vector<Pricing::Fee>& fees) {
    const View view = currentView();
    std::set<int> unreachable = unreachableSet();
    std::map<int, std::string> carrier = carrierMap();
    Json arr = Json::array();
    for (size_t i = 0; i < S.orders.size(); ++i) {
        const Order& o = S.orders[i];
        if (!view.all && !view.orders.count(o.id)) continue;
        arr.push(orderRow(o, i, fees[i], unreachable, carrier));
    }
    return arr;
}

Json shippersJson() {
    Json arr = Json::array();
    if (isCustomer()) return arr;
    const int mine = myShipperIndex();
    for (size_t i = 0; i < S.shippers.size(); ++i) {
        if (isShipper() && static_cast<int>(i) != mine) continue;
        const Shipper& s = S.shippers[i];
        arr.push(Json::object()
                     .set("index", static_cast<int>(i))
                     .set("name", s.name)
                     .set("capacity", s.capacity)
                     .set("vehicle", static_cast<int>(s.vehicle))
                     .set("vehicleName", vehicleName(s.vehicle))
                     .set("ready", shipperReady(static_cast<int>(i)))
                     .set("score", shipperScore(s.name))
                     .set("absent", S.shift.isAbsent(static_cast<int>(i)))
                     .set("busy", S.shift.busy(static_cast<int>(i), S.orders))
                     .set("node", shipperNode(static_cast<int>(i))));
    }
    return arr;
}

Json datasetsJson() {
    Json arr = Json::array();
    for (const Dataset& d : DATASETS) {
        bool available = fileExists(dataPath(d.mapFile));
        arr.push(Json::object()
                     .set("key", d.key)
                     .set("title", d.title)
                     .set("description", d.description)
                     .set("available", available));
    }
    return arr;
}

Json eventsJson() {
    const View view = currentView();
    Json ev = Json::array();
    for (const ShiftEvent& e : S.shift.events()) {
        if (!view.all) {
            bool mine = view.shipper >= 0 ? e.shipper == view.shipper && e.type != "absent" && e.type != "available"
                                          : e.order >= 0 && view.orders.count(e.order) > 0;
            if (!mine) continue;
        }
        ev.push(Json::object().set("t", e.t).set("type", e.type).set("order", e.order).set("shipper", e.shipper)
                    .set("who", e.shipper >= 0 && e.shipper < (int)S.shippers.size() ? Json(S.shippers[e.shipper].name) : Json())
                    .set("detail", e.detail));
    }
    return ev;
}

Json shiftJson() {
    Json reasons = Json::array();
    for (int k = 0; k < FAIL_REASON_COUNT; ++k)
        reasons.push(Json::object().set("id", k).set("name", failReasonName(k)).set("returns", failReasonReturns(k)));
    const View view = currentView();
    Json trips = Json::array();
    for (const Trip& t : S.shift.trips()) {
        if (!tripVisible(t, view)) continue;
        Json stops = Json::array();
        for (const TripStop& s : t.stops) {
            if (!view.all && view.shipper < 0 && !view.orders.count(s.orderId)) continue;   // khách: chỉ điểm giao của mình
            stops.push(Json::object()
                           .set("order", s.orderId)
                           .set("node", s.node)
                           .set("name", nodeName(s.node))
                           .set("pathIndex", s.pathIndex)
                           .set("eta", s.eta));
        }
        trips.push(Json::object()
                       .set("id", t.id)
                       .set("shipper", t.shipper)
                       .set("name", t.shipperName)
                       .set("accepted", t.accepted)
                       .set("vehicle", static_cast<int>(t.vehicle))
                       .set("vehicleName", vehicleName(t.vehicle))
                       .set("path", Json(t.path))
                       .set("pathTimes", Json(t.pathTimes))
                       .set("stops", stops)
                       .set("km", t.km)
                       .set("minutes", t.minutes)
                       .set("cost", t.cost)
                       .set("load", t.load)
                       .set("capacity", t.capacity)
                       .set("note", t.note)
                       .set("reroutes", t.reroutes)
                       .set("from", t.fromNode)
                       .set("approach", Json(t.approach))
                       .set("approachTimes", Json(t.approachTimes))
                       .set("offerLeft", !t.accepted && t.offerUntil > 0 && !isCustomer() ? Json(static_cast<double>(std::max<int64_t>(0, t.offerUntil - nowSeconds()))) : Json())
                       .set("service", PHUT_MOI_DIEM));
    }
    Json hist = Json::array();
    for (const DispatchRecord& h : S.shift.history())
        if (view.all) hist.push(Json::object()
                      .set("id", h.id)
                      .set("when", h.when)
                      .set("plan", h.plan)
                      .set("orders", h.orders)
                      .set("shippers", h.shippers)
                      .set("predictedLate", h.predictedLate)
                      .set("km", h.km)
                      .set("cost", h.cost)
                      .set("makespan", h.makespan));
    return Json::object()
        .set("maxAttempts", MAX_ATTEMPTS)
        .set("active", S.shift.active())
        .set("clock", S.shift.clock())
        .set("speed", Commerce::config().clockSpeed)
        .set("autoMatch", Commerce::config().autoMatch)
        .set("offerSeconds", Commerce::config().offerSeconds)
        .set("trips", trips)
        .set("history", hist)
        .set("events", eventsJson())
        .set("failReasons", reasons);
}

Json tariffJson() {
    const Pricing::Tariff& t = Pricing::tariff();
    return Json::object().set("firstKm", t.firstKm).set("firstFee", t.firstFee).set("perKm", t.perKm).set("freeKg", t.freeKg)
        .set("perKg", t.perKg).set("urgent", t.urgent).set("codRate", t.codRate).set("codMin", t.codMin)
        .set("returnRate", t.returnRate);
}

Json financeJson(const std::vector<Pricing::Fee>& fees) {
    Pricing::Finance f = Pricing::summarize(S.orders, fees, S.shift.trips(), static_cast<int>(S.shippers.size()));
    if (!isStaff()) {
        // Shipper chỉ thấy dòng đối soát của mình; khách hàng không thấy số liệu tài chính
        int mine = myShipperIndex();
        Pricing::Finance own;
        for (const auto& s : f.shippers)
            if (mine >= 0 && s.shipper == mine) {
                own.shippers.push_back(s);
                own.revenue = s.revenue;
                own.cost = s.cost;
                own.profit = s.revenue - s.cost;
                own.codCollected = s.codCollected;
                own.codOnRoute = s.codOnRoute;
                own.delivered = s.delivered;
                own.returned = s.returned;
                own.expectedRevenue = s.revenue;
            }
        f = own;
    }
    Json sh = Json::array();
    for (const auto& s : f.shippers)
        sh.push(Json::object().set("shipper", s.shipper)
                    .set("name", s.shipper >= 0 ? S.shippers[s.shipper].name : std::string("Một xe"))
                    .set("delivered", s.delivered).set("failed", s.failed).set("returned", s.returned).set("onRoute", s.onRoute)
                    .set("codCollected", s.codCollected).set("codOnRoute", s.codOnRoute)
                    .set("revenue", s.revenue).set("km", s.km).set("cost", s.cost));
    return Json::object()
        .set("revenue", f.revenue).set("expectedRevenue", f.expectedRevenue).set("cost", f.cost).set("profit", f.profit)
        .set("codCollected", f.codCollected).set("codOnRoute", f.codOnRoute).set("codPending", f.codPending)
        .set("delivered", f.delivered).set("returned", f.returned).set("cancelled", f.cancelled)
        .set("shippers", sh)
        .set("tariff", tariffJson());
}

Json tierJson(int done) {
    const Commerce::Tier& t = Commerce::tierFor(done);
    const Commerce::Tier* next = Commerce::nextTier(done);
    Json j = Json::object().set("name", t.name).set("pct", t.pct).set("done", done);
    if (next) j.set("next", Json::object().set("name", next->name).set("pct", next->pct).set("remaining", next->minDone - done));
    else j.set("next", Json());
    return j;
}

Json accountJson(const Auth::Account& a) {
    Json j = Json::object()
                 .set("username", a.username)
                 .set("role", Auth::roleKey(a.role))
                 .set("roleName", Auth::roleName(a.role))
                 .set("displayName", a.displayName)
                 .set("link", a.link)
                 .set("status", Auth::statusKey(a.status))
                 .set("statusName", Auth::statusName(a.status))
                 .set("statusReason", a.statusReason)
                 .set("email", a.email)
                 .set("phone", a.phone)
                 .set("createdAt", static_cast<double>(a.createdAt))
                 .set("lastLogin", static_cast<double>(a.lastLogin));
    if (a.role == Auth::SHIPPER)
        j.set("vehicle", a.vehicle).set("vehicleName", a.vehicle >= 0 ? Json(vehicleName(vehicleFromInt(a.vehicle))) : Json())
            .set("capacity", a.capacity).set("plate", a.plate).set("ready", a.ready);
    if (a.role == Auth::CUSTOMER) j.set("tier", tierJson(a.done)).set("spent", static_cast<double>(a.spent));
    return j;
}

Json meJson() {
    if (!S.authed) return Json();
    Json j = accountJson(S.me);
    j.set("shipper", myShipperIndex()).set("csrf", S.csrf).set("unread", S.notes.unread(S.me.username));
    return j;
}

// Số liệu hiện trên menu (chấm đỏ): việc đang chờ từng vai trò xử lý
Json badgesJson() {
    int created = 0, dispatched = 0, failed = 0, pendingUsers = 0, openComplaints = 0, codWait = 0, waiting = 0;
    for (const Order& o : S.orders) {
        created += o.status == CREATED;
        failed += o.status == FAILED;
        waiting += o.status == PENDING;
    }
    Json j = Json::object();
    if (isStaff()) {
        for (const Auth::Account& a : S.accounts.all()) pendingUsers += a.status == Auth::PENDING;
        for (const Support::Complaint& c : S.complaints.all()) openComplaints += c.status != "resolved";
        for (const Flow::Remittance& r : S.cod.remittances()) codWait += r.state == "submitted";
        j.set("newOrders", created).set("waiting", waiting).set("failed", failed).set("pendingUsers", pendingUsers)
            .set("complaints", openComplaints).set("codConfirm", codWait);
    } else if (isShipper()) {
        for (const Trip& t : S.shift.trips())
            if (!t.accepted && t.shipper == myShipperIndex()) ++dispatched;
        j.set("trips", dispatched);
    } else if (isCustomer()) {
        for (const Support::Complaint& c : S.complaints.all()) openComplaints += c.owner == S.me.username && c.status != "resolved";
        j.set("complaints", openComplaints);
    }
    return j;
}

Json configJson() {
    const Commerce::Config& c = Commerce::config();
    Json tiers = Json::array();
    for (const Commerce::Tier& t : c.tiers) tiers.push(Json::object().set("name", t.name).set("minDone", t.minDone).set("pct", t.pct));
    return Json::object()
        .set("tiers", tiers)
        .set("cancelDispatched", c.cancelDispatched)
        .set("cancelOnRoute", c.cancelOnRoute)
        .set("shipperShare", c.shipperShare)
        .set("scoreAware", c.scoreAware)
        .set("maxOpenOrders", c.maxOpenOrders)
        .set("autoDeliver", c.autoDeliver)
        .set("insRate", c.insRate)
        .set("insThreshold", static_cast<double>(c.insThreshold))
        .set("volDivisor", c.volDivisor)
        .set("compMultiplier", c.compMultiplier)
        .set("debtLimit", static_cast<double>(c.debtLimit))
        .set("autoMatch", c.autoMatch)
        .set("offerSeconds", c.offerSeconds)
        .set("matchGiveUp", c.matchGiveUp)
        .set("clockSpeed", c.clockSpeed)
        .set("tariff", tariffJson());
}

Json stateJson() {
    std::vector<Pricing::Fee> fees = orderFees();
    // Thông báo vận hành (đổi tuyến, ...) chỉ gửi cho nhân viên
    std::string notice;
    if (isStaff()) {
        notice = S.notice;
        S.notice.clear();
    }
    Json customers = Json::array();
    if (isStaff())
        for (const Auth::Account& a : S.accounts.all())
            if (a.role == Auth::CUSTOMER && a.status == Auth::ACTIVE)
                customers.push(Json::object().set("username", a.username).set("displayName", a.displayName));
    return Json::object()
        .set("me", meJson())
        .set("customers", customers)
        .set("ok", true)
        .set("notice", notice)
        .set("badges", badgesJson())
        .set("config", Json::object()
                           .set("autoDeliver", Commerce::config().autoDeliver)
                           .set("scoreAware", Commerce::config().scoreAware)
                           .set("maxOpenOrders", Commerce::config().maxOpenOrders)
                           .set("autoMatch", Commerce::config().autoMatch)
                           .set("offerSeconds", Commerce::config().offerSeconds)
                           .set("clockSpeed", Commerce::config().clockSpeed)
                           .set("tariff", tariffJson()))
        .set("settings", Json::object().set("shiftStart", S.shiftStart).set("rush", rushJson()))
        .set("shift", shiftJson())
        .set("undo", Json::object().set("can", isAdmin() && S.history.canUndo()).set("label", isAdmin() ? S.history.undoLabel() : ""))
        .set("redo", Json::object().set("can", isAdmin() && S.history.canRedo()).set("label", isAdmin() ? S.history.redoLabel() : ""))
        .set("dataset", S.dataset)
        .set("datasets", datasetsJson())
        .set("depot", S.depot)
        .set("graph", graphJson())
        .set("orders", ordersJson(fees))
        .set("shippers", shippersJson())
        .set("finance", financeJson(fees));
}

Json estimateJson(const Estimate& e) {
    Json legs = Json::array();
    for (const Chang& c : e.cacChang)
        legs.push(Json::object()
                      .set("from", c.tu)
                      .set("to", c.den)
                      .set("path", pathJson(c.duongDi))
                      .set("km", c.km)
                      .set("minutes", c.phut)
                      .set("surcharge", c.phuPhi));
    return Json::object()
        .set("ok", e.hopLe)
        .set("error", e.lyDo)
        .set("km", e.quangDuongKm)
        .set("cost", e.chiPhi)
        .set("surcharge", e.phuPhi)
        .set("minutes", e.thoiGianPhut)
        .set("minutesBase", e.thoiGianGoc)
        .set("depart", e.gioDi >= 0 ? Json(e.gioDi) : Json())
        .set("stops", e.soDiemGiao)
        .set("legs", legs)
        .set("formula", Json::object()
                            .set("fixed", PHI_CO_DINH)
                            .set("perKm", GIA_MOI_KM)
                            .set("perStopMinutes", PHUT_MOI_DIEM));
}

Json planJson(const Plan& p, const std::vector<Order>& orders, const std::vector<Shipper>& ships) {
    auto orderIds = [&](const std::vector<int>& idx) {
        Json a = Json::array();
        for (int i : idx) a.push(orders[i].id);
        return a;
    };
    Json routes = Json::array();
    for (const Route& r : p.routes) {
        Json stops = Json::array();
        for (size_t i = 0; i < r.orders.size(); ++i) {
            const Order& o = orders[r.orders[i]];
            double at = r.arrival[i] + r.startAt;  // giờ tới tính từ đầu ca
            bool late = o.deadline >= 0 && at > o.deadline + 1e-9;
            stops.push(Json::object()
                           .set("order", o.id)
                           .set("node", o.destination)
                           .set("name", nodeName(o.destination))
                           .set("arrival", at)
                           .set("deadline", o.deadline)
                           .set("urgent", o.urgent)
                           .set("late", late));
        }
        std::string who = r.shipper >= 0 ? ships[r.shipper].name : std::string("Một xe");
        double cap = r.shipper >= 0 ? ships[r.shipper].capacity : 0;
        routes.push(Json::object()
                        .set("shipper", r.shipper)
                        .set("name", who)
                        .set("vehicle", static_cast<int>(r.vehicle))
                        .set("vehicleName", vehicleName(r.vehicle))
                        .set("capacity", cap)
                        .set("load", r.load)
                        .set("km", r.km)
                        .set("minutes", r.minutes)
                        .set("cost", r.costVnd)
                        .set("late", r.late)
                        .set("rushDelay", r.rushDelay)
                        .set("startAt", r.startAt)
                        .set("stops", stops)
                        .set("path", pathJson(r.path)));
    }
    double finish = 0;
    for (const Route& r : p.routes)
        if (!r.orders.empty()) finish = std::max(finish, r.startAt + r.minutes);
    return Json::object()
        .set("finishAt", finish)
        .set("key", p.key)
        .set("name", p.name)
        .set("description", p.description)
        .set("routes", routes)
        .set("overweight", orderIds(p.overweight))
        .set("unreachable", orderIds(p.unreachable))
        .set("km", p.km)
        .set("minutes", p.minutes)
        .set("makespan", p.makespan)
        .set("cost", p.costVnd)
        .set("late", p.late)
        .set("served", p.served)
        .set("micros", p.micros)
        .set("optimal", p.optimal)
        .set("skipped", p.skipped)
        .set("note", p.note);
}

// Ca đang chạy mà giao thông đổi: tính lại tuyến các chuyến, ghi kết quả vào thông báo
Json rerouteActive() {
    Json out = Json::object().set("rerouted", 0).set("retimed", 0).set("dropped", Json::array());
    if (!S.shift.active()) return out;
    RerouteReport rep = S.shift.reroute(S.graph, S.depot, rushPtr(), S.shiftStart, S.orders);
    std::string msg;
    if (rep.rerouted) msg += std::to_string(rep.rerouted) + " chuyến đổi sang đường khác";
    if (rep.retimed) msg += (msg.empty() ? "" : ", ") + std::to_string(rep.retimed) + " chuyến cập nhật giờ tới";
    if (!rep.dropped.empty()) {
        msg += (msg.empty() ? "" : ". ") + std::to_string(rep.dropped.size()) + " đơn không còn đường tới, đã trả về hàng chờ:";
        for (int id : rep.dropped) msg += " " + std::to_string(id);
    }
    if (std::abs(rep.maxDelay) >= 0.5) {
        char buf[64];
        std::snprintf(buf, sizeof buf, " (giờ về %s %.0f phút)", rep.maxDelay > 0 ? "chậm thêm" : "sớm hơn", std::abs(rep.maxDelay));
        msg += buf;
    }
    if (!msg.empty()) {
        S.notice = "Ca đang chạy: " + msg + ".";
        S.shift.log(S.shift.clock(), "reroute", -1, -1, msg);
    }
    Json dropped = Json::array();
    for (int id : rep.dropped) dropped.push(id);
    return out.set("rerouted", rep.rerouted).set("retimed", rep.retimed).set("dropped", dropped).set("maxDelay", rep.maxDelay);
}

// ================================= Handlers =================================

using Handler = std::function<Json(const httplib::Request&)>;

// ------------------------------------------------------------- Lưu file
void writeDataFile(const std::string& file, const std::string& text) {
    std::string err;
    if (!TextUtil::writeAtomic(dataPath(file), text, err)) std::cerr << "[Canh bao] " << err << "\n";
}

// Bản ghi đơn để xuất / lưu bản đồ: bỏ trạng thái vận hành và mã xác nhận giao (không để lộ cho nhân viên qua file)
std::vector<OrderRecord> exportRecords() {
    std::vector<OrderRecord> recs;
    for (const Order& o : S.orders) {
        OrderRecord r = o.toRecord();
        r.status = 0; r.eta = -1; r.deliveredAt = -1; r.attempts = 0; r.failReason = -1; r.cancelFee = 0;
        r.deliveryCode.clear(); r.proofNote.clear(); r.deliveredReal = 0; r.codRecorded = false; r.shipperName.clear();
        r.returnFee = 0; r.closedAt = 0;
        recs.push_back(r);
    }
    return recs;
}

// Bản làm việc của bộ dữ liệu "hcm": đơn hàng kèm trạng thái, để khởi động lại server không mất đơn
std::string liveOrdersText() {
    std::vector<OrderRecord> recs;
    for (const Order& o : S.orders) {
        OrderRecord r = o.toRecord();
        r.shipperName = o.shipper >= 0 && o.shipper < static_cast<int>(S.shippers.size()) ? S.shippers[o.shipper].name : "";
        recs.push_back(r);
    }
    return FileIO::ordersToText(recs);
}

// Ghi các file đã thay đổi trong yêu cầu vừa xử lý (mỗi file ghi nguyên tử, dưới mutex nên không ghi chồng nhau)
void flushDirty() {
    unsigned d = S.dirty;
    S.dirty = 0;
    if (d & D_USERS) writeDataFile("users.txt", S.accounts.toText());
    if (d & D_PROMOS) writeDataFile("promos.txt", S.promos.toText());
    if (d & D_ADDR) writeDataFile("addresses.txt", S.addresses.toText());
    if (d & D_REVIEWS) writeDataFile("reviews.txt", S.reviews.toText());
    if (d & D_CREVIEWS) writeDataFile("customer_reviews.txt", S.custReviews.toText());
    if (d & D_STATS) writeDataFile("stats.txt", S.stats.toText());
    if (d & D_NOTES) writeDataFile("notifications.txt", S.notes.toText());
    if (d & D_AUDIT) writeDataFile("audit.txt", S.audit.toText());
    if (d & D_COMPL) writeDataFile("complaints.txt", S.complaints.toText());
    if (d & D_COD) writeDataFile("cod_ledger.txt", S.cod.toText());
    if (d & D_LEDGER) writeDataFile("customer_ledger.txt", S.ledger.toText());
    if (d & D_CONFIG) writeDataFile("config.txt", Commerce::config().toText());
    if (d & D_FLEET) writeDataFile("shippers.txt", shippersToText(S.shippers));
    if ((d & D_ORDERS) && S.dataset == "hcm") writeDataFile("orders_live.txt", liveOrdersText());
}

// ================================= Handlers =================================

using Handler = std::function<Json(const httplib::Request&)>;

void liveTick();   // WebOrders.inc: đồng hồ ca chạy theo giờ thật, lời mời hết hạn, ghép đơn

// Bọc handler: khoá mutex, kiểm tra quyền, bắt lỗi, trả JSON. Lỗi nội bộ không lộ chi tiết cho người dùng.
//   400 dữ liệu sai · 403 không đủ quyền · 409 trạng thái không cho phép · 429 quá nhiều yêu cầu · 500 lỗi máy chủ
httplib::Server::Handler wrap(Handler h) {
    return [h](const httplib::Request& req, httplib::Response& res) {
        std::lock_guard<std::mutex> lock(S.mtx);
        if (!authorize(req, res)) return;
        try { liveTick(); } catch (const std::exception& e) { std::cerr << "[Loi] liveTick: " << e.what() << "\n"; }
        auto fail = [&](int status, const std::string& msg, Json extra = Json()) {
            res.status = status;
            Json out = Json::object().set("ok", false).set("error", msg);
            if (extra.size()) out.set("fields", extra);
            res.set_content(out.dump(), "application/json; charset=utf-8");
        };
        try {
            Json out = h(req);
            if (!S.setCookie.empty()) res.set_header("Set-Cookie", S.setCookie);
            res.set_content(out.dump(), "application/json; charset=utf-8");
        } catch (const Invalid& e) {
            Json f = Json::object();
            for (const auto& kv : e.fields) f.set(kv.first, kv.second);
            fail(400, e.what(), f);
        } catch (const Forbidden& e) {
            fail(403, e.what());
        } catch (const Conflict& e) {
            fail(409, e.what());
        } catch (const Unauthorized& e) {
            fail(401, e.what());
        } catch (const TooMany& e) {
            res.set_header("Retry-After", std::to_string(e.retryAfter));
            fail(429, e.what());
        } catch (const BadRequest& e) {
            fail(400, e.what());
        } catch (const std::exception& e) {
            std::cerr << "[Loi] " << req.method << " " << req.path << ": " << e.what() << "\n";
            fail(500, "Có lỗi xảy ra phía máy chủ, vui lòng thử lại sau");
        }
        flushDirty();
    };
}

httplib::Server::Handler download(std::function<std::string()> make, std::string filename) {
    return [make, filename](const httplib::Request& req, httplib::Response& res) {
        std::lock_guard<std::mutex> lock(S.mtx);
        if (!authorize(req, res)) return;
        res.set_header("Content-Disposition", "attachment; filename=\"" + filename + "\"");
        res.set_content(make(), "text/plain; charset=utf-8");
    };
}

// Mỗi API đăng ký qua routeGet / routePost phải có quy tắc trong bảng phân quyền Auth::rules(); nếu không, server không khởi động.
std::set<std::string>& registeredRoutes() {
    static std::set<std::string> routes;
    return routes;
}
void requireRule(const char* method, const std::string& path) {
    std::string p = path.rfind("/api/", 0) == 0 ? path.substr(5) : path;
    if (!Auth::findRule(method, p)) throw std::logic_error(std::string("API chua co quy tac phan quyen: ") + method + " " + path);
    registeredRoutes().insert(std::string(method) + " " + p);
}
void routeGet(httplib::Server& svr, const std::string& path, httplib::Server::Handler h) {
    requireRule("GET", path);
    svr.Get(path, std::move(h));
}
void routePost(httplib::Server& svr, const std::string& path, httplib::Server::Handler h) {
    requireRule("POST", path);
    svr.Post(path, std::move(h));
}

#include "WebAccount.inc"
#include "WebOrders.inc"

void registerRoutes(httplib::Server& svr) {
    registerAccountRoutes(svr);
    registerOrderRoutes(svr);

    // ------------------------------------------------------------ Trạng thái
    routeGet(svr, "/api/state", wrap([](const httplib::Request&) { return stateJson(); }));

    routePost(svr, "/api/dataset", wrap([](const httplib::Request& r) {
        std::string err;
        MapSnapshot before = snapshot();
        if (S.shift.active()) S.shift.reset(S.orders, true);
        if (!loadDataset(str(r, "key"), err)) throw BadRequest(err);
        commitMap(std::move(before), "Mở bộ dữ liệu", true);
        return stateJson();
    }));

    routePost(svr, "/api/graph/new", wrap([](const httplib::Request& r) {
        MapSnapshot before = snapshot();
        S.graph = Graph(integer(r, "directed", 0) == 1);
        S.orders.clear();
        S.depot = -1;
        S.dataset = "";
        commitMap(std::move(before), "Tạo bản đồ mới", true);
        return stateJson();
    }));

    routePost(svr, "/api/depot", wrap([](const httplib::Request& r) {
        int id = requireNode(r, "id");
        MapSnapshot before = snapshot();
        S.depot = id;
        commitMap(std::move(before), "Đổi kho", true);
        return stateJson();
    }));

    // ------------------------------------------------------- Hoàn tác / Làm lại
    auto restore = [](bool isUndo) {
        MapSnapshot cur = snapshot();
        std::string label;
        bool ok = isUndo ? S.history.undo(cur, &label) : S.history.redo(cur, &label);
        if (!ok) throw BadRequest(isUndo ? "Không còn thao tác nào để hoàn tác" : "Không còn thao tác nào để làm lại");
        S.graph = std::move(cur.graph);
        S.orders = std::move(cur.orders);
        S.depot = cur.depot;
        S.dataset = cur.dataset;
        if (S.shift.active()) S.shift.reset(S.orders, true);
        else for (Order& o : S.orders) { o.status = PENDING; o.shipper = -1; o.eta = o.deliveredAt = -1; }
        S.indexDirty = true;
        return stateJson().set("message", std::string(isUndo ? "Đã hoàn tác: " : "Đã làm lại: ") + label);
    };
    routePost(svr, "/api/undo", wrap([restore](const httplib::Request&) { return restore(true); }));
    routePost(svr, "/api/redo", wrap([restore](const httplib::Request&) { return restore(false); }));

    // ------------------------------------------------------- Tình trạng giao thông
    routePost(svr, "/api/traffic", wrap([](const httplib::Request& r) {
        int u = requireNode(r, "u"), v = requireNode(r, "v");
        double jam = num(r, "jam", 1);
        if (jam < 1 || jam > 10) throw BadRequest("Hệ số kẹt xe phải từ 1 đến 10");
        bool closed = integer(r, "closed", 0) == 1;
        MapSnapshot before = snapshot();
        if (!S.graph.setTraffic(u, v, jam, closed)) throw BadRequest("Không có đoạn đường này");
        std::string label = closed ? "Đóng đường" : jam > 1 ? "Báo kẹt xe" : "Thông đường";
        commitMap(std::move(before), label, false);
        rerouteActive();   // ca đang chạy: chuyến bị ảnh hưởng tự tìm đường khác / cập nhật giờ tới
        return stateJson();
    }));

    routePost(svr, "/api/traffic/clear", wrap([](const httplib::Request&) {
        MapSnapshot before = snapshot();
        S.graph.clearTraffic();
        commitMap(std::move(before), "Xoá mọi sự cố giao thông", false);
        rerouteActive();
        return stateJson();
    }));

    // ------------------------------------------------------- Tìm điểm (Trie)
    routeGet(svr, "/api/search", wrap([](const httplib::Request& r) {
        if (S.indexDirty) {
            S.index.build(S.graph);
            S.indexDirty = false;
        }
        Json items = Json::array();
        for (int id : S.index.search(str(r, "q"), std::clamp(integer(r, "limit", 8), 1, 30)))
            items.push(Json::object().set("id", id).set("name", nodeName(id)).set("degree", static_cast<int>(S.graph.neighbors(id).size())));
        return Json::object().set("ok", true).set("items", items);
    }));

    // ------------------------------------------------------- Cài đặt
    routePost(svr, "/api/settings", wrap([](const httplib::Request& r) {
        int start = integer(r, "shiftStart", S.shiftStart);
        if (start < 0 || start >= 24 * 60) throw BadRequest("Giờ bắt đầu ca không hợp lệ");
        S.shiftStart = start;
        if (has(r, "rush")) S.rush.enabled = integer(r, "rush") == 1;
        return stateJson();
    }));

    routeGet(svr, "/api/print", wrap([](const httplib::Request&) {
        std::ostringstream os;
        S.graph.print(os);
        return Json::object().set("ok", true).set("text", os.str());
    }));

    // ------------------------------------------------------------------ Nút
    routePost(svr, "/api/node/add", wrap([](const httplib::Request& r) {
        std::string name = str(r, "name");
        if (name.empty()) throw BadRequest("Tên điểm không được để trống");
        int id = integer(r, "id", S.graph.nextNodeId());
        double x = num(r, "x"), y = num(r, "y");
        MapSnapshot before = snapshot();
        if (!S.graph.addNode(id, name, x, y))
            throw BadRequest("Mã điểm #" + std::to_string(id) + " đã tồn tại hoặc không hợp lệ");
        fixDepot();
        commitMap(std::move(before), "Thêm điểm " + name, false);
        return stateJson().set("created", id);
    }));

    routePost(svr, "/api/node/update", wrap([](const httplib::Request& r) {
        int id = requireNode(r, "id");
        const Node& n = S.graph.getNode(id);
        std::string name = str(r, "name", n.name);
        if (name.empty()) throw BadRequest("Tên điểm không được để trống");
        double x = num(r, "x", n.x), y = num(r, "y", n.y);
        MapSnapshot before = snapshot();
        S.graph.updateNode(id, name, x, y);
        commitMap(std::move(before), "Sửa điểm " + name, false);
        return stateJson();
    }));

    routePost(svr, "/api/node/remove", wrap([](const httplib::Request& r) {
        int id = requireNode(r, "id");
        MapSnapshot snap = snapshot();
        std::string label = "Xoá điểm " + nodeName(id);
        S.graph.removeNode(id);
        size_t before = S.orders.size();
        S.orders.erase(std::remove_if(S.orders.begin(), S.orders.end(),
                                      [id](const Order& o) { return o.destination == id; }),
                       S.orders.end());
        fixDepot();
        int removed = static_cast<int>(before - S.orders.size());
        commitMap(std::move(snap), label, true);
        return stateJson().set("removedOrders", removed);
    }));

    // ----------------------------------------------------------------- Cạnh
    routePost(svr, "/api/edge/add", wrap([](const httplib::Request& r) {
        int u = requireNode(r, "u"), v = requireNode(r, "v");
        if (u == v) throw BadRequest("Hai đầu đoạn đường phải là hai điểm khác nhau");
        double km = num(r, "km"), t = num(r, "time");
        if (km < 0 || t < 0) throw BadRequest("Quãng đường và thời gian không được âm");
        double cost = num(r, "cost", 0);
        int allowed = integer(r, "allowed", MASK_ALL);
        double peak = num(r, "peak", DEFAULT_PEAK);
        if (peak < 1 || peak > 5) throw BadRequest("Hệ số giờ cao điểm phải từ 1 đến 5");
        MapSnapshot before = snapshot();
        if (!S.graph.addEdge(u, v, km, t, cost, allowed, peak))
            throw BadRequest("Đoạn đường " + nodeName(u) + " – " + nodeName(v) + " đã có");
        commitMap(std::move(before), "Nối đường " + nodeName(u) + " – " + nodeName(v), false);
        return stateJson();
    }));

    routePost(svr, "/api/edge/update", wrap([](const httplib::Request& r) {
        int u = requireNode(r, "u"), v = requireNode(r, "v");
        double km = num(r, "km"), t = num(r, "time"), cost = num(r, "cost", 0);
        int allowed = integer(r, "allowed", MASK_ALL);
        const Edge* old = S.graph.getEdge(u, v);
        double peak = num(r, "peak", old ? old->peak : DEFAULT_PEAK);
        if (peak < 1 || peak > 5) throw BadRequest("Hệ số giờ cao điểm phải từ 1 đến 5");
        MapSnapshot before = snapshot();
        if (!S.graph.updateEdge(u, v, km, t, cost, allowed, peak))
            throw BadRequest("Không sửa được: đoạn đường không tồn tại hoặc số liệu âm");
        commitMap(std::move(before), "Sửa đường " + nodeName(u) + " – " + nodeName(v), true);
        return stateJson();
    }));

    routePost(svr, "/api/edge/remove", wrap([](const httplib::Request& r) {
        int u = requireNode(r, "u"), v = requireNode(r, "v");
        MapSnapshot before = snapshot();
        if (!S.graph.removeEdge(u, v)) throw BadRequest("Không có đoạn đường này");
        commitMap(std::move(before), "Xoá đường " + nodeName(u) + " – " + nodeName(v), true);
        return stateJson();
    }));

    // ------------------------------------------------------- Nhập / xuất file
    routeGet(svr, "/api/export/map", download([] { return FileIO::mapToText(S.graph); }, "map.txt"));
    routeGet(svr, "/api/export/orders", download([] { return FileIO::ordersToText(exportRecords()); }, "orders.txt"));
    routeGet(svr, "/api/export/shippers", download([] { return shippersToText(S.shippers); }, "shippers.txt"));

    routePost(svr, "/api/import/map", wrap([](const httplib::Request& r) {
        std::string err;
        Graph g;
        if (!FileIO::loadMapText(r.body, g, err)) throw BadRequest("File bản đồ lỗi. " + err);
        MapSnapshot before = snapshot();
        if (S.shift.active()) S.shift.reset(S.orders, true);
        S.graph = std::move(g);
        S.orders.erase(std::remove_if(S.orders.begin(), S.orders.end(),
                                      [](const Order& o) { return !S.graph.hasNode(o.destination); }),
                       S.orders.end());
        S.dataset = "";
        fixDepot();
        commitMap(std::move(before), "Nhập map.txt", true);
        return stateJson();
    }));

    routePost(svr, "/api/import/orders", wrap([](const httplib::Request& r) {
        std::string err;
        std::vector<OrderRecord> recs;
        if (!FileIO::loadOrdersText(r.body, recs, err, &S.graph)) throw BadRequest("File đơn hàng lỗi. " + err);
        if (S.shift.active()) S.shift.reset(S.orders, true);
        S.orders.assign(recs.begin(), recs.end());
        ensureDeliveryCodes();
        mark(D_ORDERS);
        audit("import.orders", "orders", std::to_string(recs.size()) + " đơn");
        return stateJson();
    }));

    routePost(svr, "/api/import/shippers", wrap([](const httplib::Request& r) {
        std::string err;
        std::vector<Shipper> ships;
        if (!loadShippersText(r.body, ships, err)) throw BadRequest("File shipper lỗi. " + err);
        S.shippers = ships;
        mark(D_FLEET);
        audit("import.shippers", "shippers", std::to_string(ships.size()) + " shipper");
        return stateJson();
    }));

    routePost(svr, "/api/save", wrap([](const httplib::Request&) {
        std::string err;
        std::vector<OrderRecord> recs = exportRecords();
        if (!FileIO::saveMap(dataPath("my_map.txt"), S.graph, err) ||
            !FileIO::saveOrders(dataPath("my_orders.txt"), recs, err))
            throw BadRequest(err);
        S.dataset = "saved";
        return stateJson().set("message", "Đã lưu vào data/my_map.txt và data/my_orders.txt");
    }));

    // --------------------------------------------------------- Duyệt đồ thị
    routeGet(svr, "/api/traverse", wrap([](const httplib::Request& r) {
        int start = requireNode(r, "start");
        std::string algo = str(r, "algo", "bfs");
        std::vector<int> order = algo == "dfs" ? Traversal::dfs(S.graph, start)
                               : algo == "dfsi" ? Traversal::dfsIterative(S.graph, start)
                                                : Traversal::bfs(S.graph, start);
        // Cây duyệt: cạnh (cha -> con) theo thứ tự phát hiện, để vẽ lên bản đồ
        Json tree = Json::array();
        std::set<int> seen;
        if (algo == "bfs") {
            // Cha của v = đỉnh được thăm sớm nhất ở lớp trước có cạnh tới v (đúng như BFS phát hiện)
            auto zone = Traversal::deliveryZone(S.graph, start, S.graph.nodeCount());
            std::map<int, int> parent;
            for (int u : order)
                for (const Edge& e : S.graph.neighbors(u))
                    if (!parent.count(e.to) && zone.count(e.to) && zone[e.to] == zone[u] + 1) parent[e.to] = u;
            for (int v : order)
                if (v != start && parent.count(v)) tree.push(Json::array().push(parent[v]).push(v));
            return Json::object().set("ok", true).set("order", Json(order)).set("tree", tree)
                .set("levels", Json(zone));
        }
        // DFS: cha của v là đỉnh gần nhất phía trước trong thứ tự có cạnh tới v và còn "mở"
        std::vector<int> stack;
        for (int v : order) {
            while (!stack.empty() && !S.graph.hasEdge(stack.back(), v)) stack.pop_back();
            if (!stack.empty()) tree.push(Json::array().push(stack.back()).push(v));
            stack.push_back(v);
        }
        return Json::object().set("ok", true).set("order", Json(order)).set("tree", tree);
    }));

    routeGet(svr, "/api/components", wrap([](const httplib::Request&) {
        auto cc = Traversal::connectedComponents(S.graph);
        auto scc = Traversal::stronglyConnectedComponents(S.graph);
        Json unreachable = Json::array();
        if (S.graph.hasNode(S.depot)) unreachable = Json(Traversal::unreachableFrom(S.graph, S.depot));
        return Json::object()
            .set("ok", true)
            .set("components", Json(cc))
            .set("strong", Json(scc))
            .set("connected", Traversal::isConnected(S.graph))
            .set("unreachableFromDepot", unreachable);
    }));

    routeGet(svr, "/api/zone", wrap([](const httplib::Request& r) {
        int depot = requireNode(r, "depot");
        int hops = integer(r, "hops", 2);
        if (hops < 0) throw BadRequest("Số chặng phải >= 0");
        return Json::object().set("ok", true).set("zone", Json(Traversal::deliveryZone(S.graph, depot, hops)));
    }));

    routeGet(svr, "/api/zones", wrap([](const httplib::Request& r) {
        std::vector<int> depots = intList(str(r, "depots"));
        if (depots.empty()) throw BadRequest("Chọn ít nhất một kho");
        auto z = Traversal::assignZones(S.graph, depots);
        return Json::object()
            .set("ok", true)
            .set("owner", Json(z.owner))
            .set("hops", Json(z.hops))
            .set("unassigned", Json(z.unassigned));
    }));

    // ------------------------------------------------------ Đường đi ngắn nhất
    routeGet(svr, "/api/path", wrap([](const httplib::Request& r) {
        int src = requireNode(r, "src"), dst = requireNode(r, "dst");
        std::string algo = str(r, "algo", "heap");
        Vehicle veh = vehicleParam(r);
        Criterion crit = criterionParam(r);
        double depart = departParam(r);
        const RushProfile* rush = depart >= 0 ? rushPtr() : nullptr;

        // Chạy mọi thuật toán để so sánh trên cùng truy vấn
        Json compare = Json::array();
        Json chosen = Json::object();
        auto add = [&](const std::string& key, const std::string& name, const std::vector<int>& path,
                       double weight, double micros, long long work, const std::string& warn,
                       const Json& settle, int settled = -1) {
            ShortestPath::PathInfo info = ShortestPath::describePath(S.graph, path, veh, depart, rush);
            Json row = Json::object()
                           .set("key", key)
                           .set("name", name)
                           .set("found", info.found)
                           .set("path", pathJson(path))
                           .set("weight", info.found ? Json(weight) : Json())
                           .set("km", info.km)
                           .set("minutes", info.minutes)
                           .set("minutesBase", info.minutesBase)
                           .set("costK", info.costK)
                           .set("hops", info.hops)
                           .set("micros", micros)
                           .set("work", work)
                           .set("settled", settled >= 0 ? Json(settled) : Json())
                           .set("warning", warn);
            if (key == algo) chosen = Json(row).set("settleOrder", settle);
            compare.push(row);
        };

        for (auto v : {ShortestPath::Version::ARRAY, ShortestPath::Version::STL_PQ, ShortestPath::Version::MIN_HEAP}) {
            ShortestPath::Options opt;
            opt.criterion = crit;
            opt.vehicle = veh;
            opt.departAt = depart;
            opt.rush = rush;
            opt.target = dst;   // dừng khi đã chốt điểm đến (so sánh công bằng với A*)
            ShortestPath::Tree t = ShortestPath::dijkstra(S.graph, src, v, opt);
            std::string key = v == ShortestPath::Version::ARRAY ? "array" : v == ShortestPath::Version::STL_PQ ? "stl" : "heap";
            std::string warn = t.negativeEdge ? "Có cạnh trọng số âm: Dijkstra không đảm bảo kết quả đúng." : "";
            add(key, ShortestPath::versionName(v), ShortestPath::getPath(t, dst), t.dist[dst], t.micros,
                t.heapOps, warn, Json(t.settleOrder), static_cast<int>(t.settleOrder.size()));
        }
        {
            ShortestPath::Options opt;
            opt.criterion = crit;
            opt.vehicle = veh;
            opt.departAt = depart;
            opt.rush = rush;
            ShortestPath::Tree t = ShortestPath::astar(S.graph, src, dst, opt);
            std::string warn = t.negativeEdge ? "Có cạnh trọng số âm: A* (cũng như Dijkstra) không đảm bảo kết quả đúng." : "";
            add("astar", "A* (đường chim bay)", ShortestPath::getPath(t, dst), t.dist[dst], t.micros, t.heapOps, warn,
                Json(t.settleOrder), static_cast<int>(t.settleOrder.size()));
        }
        {
            BFResult bf = bellmanFord(S.graph, src, crit, veh, depart, rush);
            std::string warn;
            if (bf.coChuTrinhAm) {
                warn = "Phát hiện chu trình âm: ";
                for (size_t i = 0; i < bf.chuTrinhAm.size(); ++i)
                    warn += (i ? " → " : "") + nodeName(bf.chuTrinhAm[i]);
            }
            add("bellman", "Bellman-Ford", getPath(bf, src, dst), bf.khoangCach[dst], bf.micros, bf.soLanNoiLong,
                warn, Json::array());
            if (algo == "bellman") chosen.set("cycle", Json(bf.chuTrinhAm));
        }
        {
            auto t0 = std::chrono::steady_clock::now();
            std::vector<int> p = Traversal::bfsPath(S.graph, src, dst);
            double us = std::chrono::duration<double, std::micro>(std::chrono::steady_clock::now() - t0).count();
            // BFS không xét loại xe/trọng số: chỉ ít chặng nhất
            add("bfs", "BFS (ít chặng nhất)", p, p.empty() ? 0 : (double)p.size() - 1, us, 0,
                "BFS bỏ qua trọng số và loại xe, chỉ tìm đường ít chặng nhất.", Json::array());
        }

        return Json::object()
            .set("ok", true)
            .set("depart", depart >= 0 ? Json(depart) : Json())
            .set("rushLevel", rush ? rush->level(depart) : 0.0)
            .set("criterion", criterionName(crit))
            .set("vehicle", vehicleName(veh))
            .set("result", chosen)
            .set("compare", compare);
    }));

    routeGet(svr, "/api/benchmark", wrap([](const httplib::Request& r) {
        std::vector<int> sizes = intList(str(r, "sizes", "100,500,1000,2000,4000"));
        for (int n : sizes)
            if (n < 2 || n > 20000) throw BadRequest("Số đỉnh mỗi lần đo phải trong khoảng 2..20000");
        if (sizes.size() > 8) throw BadRequest("Tối đa 8 kích thước mỗi lần đo");
        double deg = num(r, "degree", 4);
        if (deg < 1 || deg > 50) throw BadRequest("Bậc trung bình phải trong khoảng 1..50");
        int reps = std::clamp(integer(r, "repeats", 3), 1, 10);
        Json rows = Json::array();
        for (const auto& b : ShortestPath::benchmark(sizes, deg, reps))
            rows.push(Json::object()
                          .set("nodes", b.nodes)
                          .set("edges", b.edges)
                          .set("array", b.microsArray)
                          .set("stl", b.microsStl)
                          .set("heap", b.microsHeap)
                          .set("opsArray", b.opsArray)
                          .set("opsStl", b.opsStl)
                          .set("opsHeap", b.opsHeap)
                          .set("agree", b.agree));
        return Json::object().set("ok", true).set("rows", rows).set("degree", deg).set("repeats", reps);
    }));

    // Truy vấn điểm - điểm trên bản đồ hiện tại: Dijkstra (dừng sớm) so với A*
    routeGet(svr, "/api/benchmark/p2p", wrap([](const httplib::Request& r) {
        int pairs = std::clamp(integer(r, "pairs", 50), 1, 500);
        Criterion crit = criterionParam(r);
        std::vector<int> ids = S.graph.nodeIds();
        if (ids.size() < 2) throw BadRequest("Bản đồ cần ít nhất 2 điểm");
        std::mt19937 rng(7);
        std::uniform_int_distribution<size_t> pick(0, ids.size() - 1);
        double tD = 0, tA = 0;
        long long sD = 0, sA = 0;
        int found = 0, agree = 0;
        for (int i = 0; i < pairs; ++i) {
            int a = ids[pick(rng)], b = ids[pick(rng)];
            if (a == b) { --i; continue; }
            ShortestPath::Options opt;
            opt.criterion = crit;
            opt.target = b;
            ShortestPath::Tree d = ShortestPath::dijkstra(S.graph, a, ShortestPath::Version::MIN_HEAP, opt);
            ShortestPath::Tree s = ShortestPath::astar(S.graph, a, b, opt);
            tD += d.micros;
            tA += s.micros;
            sD += static_cast<long long>(d.settleOrder.size());
            sA += static_cast<long long>(s.settleOrder.size());
            if (d.dist[b] != ShortestPath::INF) {
                ++found;
                if (std::fabs(d.dist[b] - s.dist[b]) < 1e-6) ++agree;
            } else if (s.dist[b] == ShortestPath::INF) ++agree;
        }
        return Json::object()
            .set("ok", true)
            .set("pairs", pairs)
            .set("nodes", S.graph.nodeCount())
            .set("found", found)
            .set("agree", agree == pairs)
            .set("dijkstra", Json::object().set("settled", (double)sD / pairs).set("micros", tD / pairs))
            .set("astar", Json::object().set("settled", (double)sA / pairs).set("micros", tA / pairs));
    }));

    // --------------------------------------------------- Bellman-Ford & dự toán
    routeGet(svr, "/api/bellman", wrap([](const httplib::Request& r) {
        int src = requireNode(r, "src");
        Criterion crit = criterionFromString(str(r, "criterion", "cost"));
        Vehicle veh = vehicleParam(r);
        BFResult bf = bellmanFord(S.graph, src, crit, veh);
        ShortestPath::Options opt;
        opt.criterion = crit;
        opt.vehicle = veh;
        ShortestPath::Tree dj = ShortestPath::dijkstra(S.graph, src, ShortestPath::Version::MIN_HEAP, opt);
        Json rows = Json::array();
        for (int id : S.graph.nodeIds()) {
            double d = bf.khoangCach[id];
            rows.push(Json::object()
                          .set("id", id)
                          .set("name", nodeName(id))
                          .set("dist", d >= VO_CUC ? Json() : Json(d))
                          .set("prev", bf.truoc[id])
                          .set("dijkstra", dj.dist[id])
                          .set("path", pathJson(getPath(bf, src, id))));
        }
        return Json::object()
            .set("ok", true)
            .set("criterion", criterionName(crit))
            .set("negativeCycle", bf.coChuTrinhAm)
            .set("cycle", Json(bf.chuTrinhAm))
            .set("anyCycle", Json(findNegativeCycle(S.graph, crit, veh)))
            .set("iterations", bf.soVongLap)
            .set("relaxations", bf.soLanNoiLong)
            .set("micros", bf.micros)
            .set("hasNegativeEdge", dj.negativeEdge)
            .set("rows", rows);
    }));

    routeGet(svr, "/api/estimate", wrap([](const httplib::Request& r) {
        int depot = requireNode(r, "depot");
        std::vector<int> stops = intList(str(r, "stops"));
        bool back = integer(r, "return", 0) == 1;
        double depart = departParam(r);
        return estimateJson(estimateMultiStop(S.graph, depot, stops, vehicleParam(r), back, depart, rushPtr()));
    }));

    // -------------------------------------------------------------- Shipper
    auto readShipper = [](const httplib::Request& r, Shipper s) {
        s.name = str(r, "name", s.name);
        if (s.name.empty()) throw BadRequest("Tên shipper không được để trống");
        s.capacity = num(r, "capacity", s.capacity);
        if (s.capacity <= 0) throw BadRequest("Tải trọng phải lớn hơn 0");
        s.vehicle = vehicleFromInt(integer(r, "vehicle", static_cast<int>(s.vehicle)));
        if (s.vehicle == ANY_VEHICLE) s.vehicle = MOTORBIKE;
        int self = has(r, "index") ? integer(r, "index") : -1;
        for (size_t i = 0; i < S.shippers.size(); ++i)
            if ((int)i != self && S.shippers[i].name == s.name) throw BadRequest("Đã có shipper tên '" + s.name + "'");
        return s;
    };

    routePost(svr, "/api/shipper/add", wrap([readShipper](const httplib::Request& r) {
        if (S.shippers.size() >= 12) throw BadRequest("Tối đa 12 shipper");
        S.shippers.push_back(readShipper(r, Shipper{}));
        mark(D_FLEET);
        audit("fleet.add", S.shippers.back().name);
        return stateJson();
    }));

    routePost(svr, "/api/shipper/update", wrap([readShipper](const httplib::Request& r) {
        int i = integer(r, "index");
        if (i < 0 || i >= (int)S.shippers.size()) throw BadRequest("Không có shipper này");
        std::string oldName = S.shippers[i].name;
        S.shippers[i] = readShipper(r, S.shippers[i]);
        if (S.shippers[i].name != oldName) {   // tài khoản shipper gắn theo tên: đổi theo
            S.accounts.renameLink(oldName, S.shippers[i].name);
            S.stats.rename(oldName, S.shippers[i].name);
            S.cod.renameShipper(oldName, S.shippers[i].name);
            mark(D_USERS | D_STATS | D_COD);
        }
        mark(D_FLEET | D_ORDERS);
        audit("fleet.update", S.shippers[i].name);
        return stateJson();
    }));

    routePost(svr, "/api/shipper/remove", wrap([](const httplib::Request& r) {
        int i = integer(r, "index");
        if (i < 0 || i >= (int)S.shippers.size()) throw BadRequest("Không có shipper này");
        for (const Trip& t : S.shift.trips())
            if (t.shipper == i) throw Conflict("Shipper đang có chuyến chưa xong, hãy thu hồi hoặc hoàn tất chuyến trước khi xoá");
        std::string name = S.shippers[i].name;
        S.shippers.erase(S.shippers.begin() + i);
        S.shift.shipperRemoved(i);
        for (Order& o : S.orders) {   // chỉ số shipper phía sau dịch lên một vị trí
            if (o.shipper == i) o.shipper = -1;
            else if (o.shipper > i) --o.shipper;
            std::vector<int> tried;
            for (int x : o.tried)
                if (x != i) tried.push_back(x > i ? x - 1 : x);
            o.tried = tried;
        }
        mark(D_FLEET | D_ORDERS);
        audit("fleet.remove", name);
        return stateJson();
    }));

    routePost(svr, "/api/shift/available", wrap([](const httplib::Request& r) {
        int i = integer(r, "index");
        if (i < 0 || i >= (int)S.shippers.size()) throw BadRequest("Không có shipper này");
        S.shift.setAvailable(i);
        audit("shipper.available", S.shippers[i].name);
        matchPending();
        return stateJson().set("message", S.shippers[i].name + " có mặt trở lại");
    }));

    routePost(svr, "/api/shift/reroute", wrap([](const httplib::Request&) {
        if (!S.shift.active()) throw BadRequest("Chưa có ca giao đang chạy");
        Json rep = rerouteActive();
        matchPending();   // đơn mất đường đi quay về hàng chờ: mời shipper khác
        if (S.notice.empty()) S.notice = "Các chuyến vẫn đi được như cũ, giờ tới không đổi.";
        return stateJson().set("reroute", rep);
    }));

    // Đơn nặng hơn mọi xe: chia thành nhiều kiện bằng nhau, mỗi kiện vừa xe lớn nhất
    routePost(svr, "/api/order/split", wrap([](const httplib::Request& r) {
        int id = integer(r, "id");
        auto it = std::find_if(S.orders.begin(), S.orders.end(), [id](const Order& o) { return o.id == id; });
        if (it == S.orders.end()) throw BadRequest("Không có đơn " + std::to_string(id));
        if (it->status != PENDING) throw Conflict("Chỉ chia được đơn đang chờ giao");
        double cap = 0;
        for (size_t i = 0; i < S.shippers.size(); ++i)
            if (!S.shift.isAbsent(static_cast<int>(i))) cap = std::max(cap, S.shippers[i].capacity);
        if (cap <= 0) throw BadRequest("Chưa có shipper nào để chở");
        int parts = std::max(integer(r, "parts", 0), static_cast<int>(std::ceil(it->weight / cap - 1e-9)));
        if (parts < 2) throw BadRequest("Đơn " + std::to_string(id) + " nặng " + std::to_string((int)std::ceil(it->weight)) + " kg, xe lớn nhất chở được nên không cần chia");
        if (parts > 20) throw BadRequest("Đơn quá nặng, cần hơn 20 kiện");
        int maxId = 100;
        for (const Order& o : S.orders) maxId = std::max(maxId, o.id);
        Order base = *it;
        double each = std::round(base.weight / parts * 100) / 100;
        std::vector<Order> pieces;
        for (int k = 0; k < parts; ++k) {
            Order o = base;
            o.id = k == 0 ? base.id : ++maxId;
            o.weight = k == parts - 1 ? std::round((base.weight - each * (parts - 1)) * 100) / 100 : each;
            o.note = (base.note.empty() ? std::string("Kiện") : base.note) + " " + std::to_string(k + 1) + "/" + std::to_string(parts) + " của đơn " + std::to_string(base.id);
            if (k > 0) o.cod = 0;   // tiền thu hộ chỉ thu một lần, ở kiện đầu tiên
            if (k > 0) o.declaredValue = o.insuranceFee = 0;   // khai giá và phí bảo hiểm cũng gắn với kiện đầu
            o.dimL = o.dimW = o.dimH = 0;   // kích thước của cả kiện gốc không còn đúng với từng phần
            o.deliveryCode = Flow::newDeliveryCode();
            o.gross = 0;            // mỗi kiện tính cước lại theo biểu phí; khoản giảm của đơn gốc được trả lại
            o.loyaltyDiscount = 0;
            o.promoDiscount = 0;
            o.promo.clear();
            pieces.push_back(o);
        }
        size_t pos = it - S.orders.begin();
        S.orders.erase(S.orders.begin() + pos);
        S.orders.insert(S.orders.begin() + pos, pieces.begin(), pieces.end());
        if (!base.promo.empty()) { S.promos.giveBack(base.promo); mark(D_PROMOS); }
        mark(D_ORDERS);
        audit("order.split", std::to_string(id), std::to_string(parts) + " kiện");
        return stateJson().set("message", "Đã chia đơn " + std::to_string(id) + " thành " + std::to_string(parts) + " kiện");
    }));

    // ------------------------------------------------------------ Phân tích mạng
    routeGet(svr, "/api/analysis", wrap([](const httplib::Request& r) {
        Vehicle v = vehicleFromInt(integer(r, "vehicle", 0));
        std::vector<int> dest;
        for (const Order& o : S.orders)
            if (o.status != CANCELLED && o.status != RETURNED) dest.push_back(o.destination);
        Analysis::CriticalReport cr = Analysis::criticalRoads(S.graph, S.depot, dest);
        Json bridges = Json::array(), arts = Json::array();
        for (const auto& b : cr.bridges)
            bridges.push(Json::object().set("u", b.u).set("v", b.v).set("km", b.km)
                             .set("cutNodes", b.cutNodes).set("cutOrders", b.cutOrders));
        for (const auto& a : cr.articulation)
            arts.push(Json::object().set("node", a.node).set("name", nodeName(a.node)).set("parts", a.parts)
                          .set("cutNodes", a.cutNodes).set("cutOrders", a.cutOrders));
        auto mstJson = [](const Analysis::MstResult& m) {
            Json e = Json::array();
            for (const auto& x : m.edges) e.push(Json::object().set("u", x.u).set("v", x.v).set("km", x.km));
            return Json::object().set("edges", e).set("km", m.km).set("trees", m.trees).set("micros", m.micros).set("work", static_cast<double>(m.work));
        };
        Analysis::MstResult kr = Analysis::kruskal(S.graph), pr = Analysis::prim(S.graph);
        Analysis::DepotReport dr = Analysis::suggestDepot(S.graph, S.depot, dest, v, 5);
        auto scoreJson = [](const Analysis::DepotScore& s) {
            return Json::object().set("node", s.node).set("name", s.node >= 0 ? Json(nodeName(s.node)) : Json())
                .set("totalKm", s.totalKm).set("maxKm", s.maxKm).set("reachable", s.reachable)
                .set("avgKm", s.reachable ? s.totalKm / s.reachable : 0.0);
        };
        Json ranking = Json::array();
        for (const auto& s : dr.ranking) ranking.push(scoreJson(s));
        return Json::object()
            .set("ok", true)
            .set("depot", S.depot)
            .set("vehicle", vehicleName(v))
            .set("critical", Json::object().set("bridges", bridges).set("articulation", arts).set("micros", cr.micros))
            .set("mst", Json::object().set("kruskal", mstJson(kr)).set("prim", mstJson(pr)).set("totalKm", Analysis::totalKm(S.graph)))
            .set("depotSuggest", Json::object()
                                     .set("ranking", ranking)
                                     .set("current", scoreJson(dr.current))
                                     .set("center", dr.center)
                                     .set("centerName", dr.center >= 0 ? Json(nodeName(dr.center)) : Json())
                                     .set("centerEccentricity", dr.centerEccentricity)
                                     .set("orders", dr.orders)
                                     .set("floyd", dr.floyd)
                                     .set("micros", dr.micros));
    }));

    routePost(svr, "/api/shift/reset", wrap([](const httplib::Request&) {
        S.shift.reset(S.orders, true);
        mark(D_ORDERS);
        audit("shift.reset", "shift");
        for (Order& o : S.orders)
            if (o.status == PENDING) o.searchSince = nowSeconds();
        matchPending();
        return stateJson().set("message", "Đã đặt lại ca: các đơn chưa xong quay về chờ giao");
    }));

    // K tuyến ngắn nhất (Yen) — gợi ý tuyến thay thế
    routeGet(svr, "/api/kpaths", wrap([](const httplib::Request& r) {
        int src = requireNode(r, "src"), dst = requireNode(r, "dst");
        int k = std::clamp(integer(r, "k", 3), 1, 6);
        ShortestPath::Options opt;
        opt.criterion = criterionParam(r);
        opt.vehicle = vehicleParam(r);
        opt.departAt = departParam(r);
        opt.rush = opt.departAt >= 0 ? rushPtr() : nullptr;
        auto t0 = std::chrono::steady_clock::now();
        auto paths = ShortestPath::kShortestPaths(S.graph, src, dst, k, opt);
        double us = std::chrono::duration<double, std::micro>(std::chrono::steady_clock::now() - t0).count();
        Json arr = Json::array();
        std::set<std::pair<int, int>> bestEdges;
        if (!paths.empty())
            for (size_t i = 0; i + 1 < paths[0].nodes.size(); ++i) bestEdges.insert({paths[0].nodes[i], paths[0].nodes[i + 1]});
        for (const auto& p : paths) {
            ShortestPath::PathInfo info = ShortestPath::describePath(S.graph, p.nodes, opt.vehicle, opt.departAt, opt.rush);
            int shared = 0;
            for (size_t i = 0; i + 1 < p.nodes.size(); ++i) shared += bestEdges.count({p.nodes[i], p.nodes[i + 1]});
            arr.push(Json::object()
                         .set("path", Json(p.nodes))
                         .set("weight", p.weight)
                         .set("km", info.km)
                         .set("minutes", info.minutes)
                         .set("costK", info.costK)
                         .set("hops", info.hops)
                         .set("shared", p.nodes.size() > 1 ? static_cast<double>(shared) / (p.nodes.size() - 1) : 1.0));
        }
        return Json::object().set("ok", true).set("paths", arr).set("micros", us).set("criterion", criterionName(opt.criterion));
    }));

    // Mô phỏng từng bước một thuật toán (trang Mô phỏng)
    routeGet(svr, "/api/trace", wrap([](const httplib::Request& r) {
        std::string algo = str(r, "algo", "dijkstra");
        if (algo != "dijkstra" && algo != "astar" && algo != "bfs" && algo != "dfs" && algo != "bellman")
            throw BadRequest("Thuật toán không hợp lệ: " + algo);
        int src = requireNode(r, "src");
        int dst = has(r, "dst") && !str(r, "dst").empty() ? requireNode(r, "dst") : -1;
        if (algo == "astar" && dst < 0) throw BadRequest("A* cần điểm đến");
        Criterion crit = criterionParam(r);
        Vehicle veh = vehicleParam(r);
        Trace::Result t = Trace::run(S.graph, algo, src, dst, crit, veh, 4000);
        Json steps = Json::array();
        for (const Trace::Step& s : t.steps) {
            Json c = Json::array();
            for (const auto& [id, k] : s.container) c.push(Json::array().push(id).push(k));
            steps.push(Json::object()
                           .set("t", s.type)
                           .set("l", s.line)
                           .set("u", s.u)
                           .set("v", s.v)
                           .set("x", s.value)
                           .set("y", s.extra)
                           .set("c", c)
                           .set("n", s.size));
        }
        Json dist = Json::object(), prev = Json::object();
        for (const auto& [id, d] : t.dist) dist.set(std::to_string(id), d);
        for (const auto& [id, p] : t.prev) prev.set(std::to_string(id), p);
        return Json::object()
            .set("ok", true)
            .set("algo", t.algo)
            .set("container", t.containerKind)
            .set("pseudo", Json(t.pseudo))
            .set("steps", steps)
            .set("truncated", t.truncated)
            .set("dist", dist)
            .set("prev", prev)
            .set("cycle", Json(t.cycle))
            .set("alpha", t.heuristicScale)
            .set("criterion", criterionName(crit));
    }));

    // Thời gian đi theo giờ xuất phát trong ngày (mỗi 10 phút): tuyến nhanh nhất ở từng thời điểm
    // (Dijkstra phụ thuộc thời gian) so với cứ đi tuyến nhanh nhất của giờ vắng.
    routeGet(svr, "/api/timeprofile", wrap([](const httplib::Request& r) {
        int src = requireNode(r, "src"), dst = requireNode(r, "dst");
        Vehicle veh = vehicleParam(r);
        int step = std::clamp(integer(r, "step", 10), 5, 60);
        RushProfile prof = S.rush;
        prof.enabled = true;   // luôn tính để vẽ được biểu đồ, kể cả khi đang tắt
        ShortestPath::Options base;
        base.criterion = Criterion::TIME;
        base.vehicle = veh;
        base.target = dst;
        std::vector<int> usual = ShortestPath::getPath(ShortestPath::dijkstra(S.graph, src, ShortestPath::Version::MIN_HEAP, base), dst);
        if (usual.empty()) throw BadRequest("Không có đường đi giữa hai điểm này cho " + std::string(vehicleName(veh)));
        std::vector<std::vector<int>> routes{usual};
        Json pts = Json::array();
        for (int t = 0; t < 24 * 60; t += step) {
            ShortestPath::Options o = base;
            o.departAt = t;
            o.rush = &prof;
            ShortestPath::Tree tr = ShortestPath::dijkstra(S.graph, src, ShortestPath::Version::MIN_HEAP, o);
            std::vector<int> p = ShortestPath::getPath(tr, dst);
            int idx = static_cast<int>(std::find(routes.begin(), routes.end(), p) - routes.begin());
            if (idx == (int)routes.size()) routes.push_back(p);
            double fixed = ShortestPath::describePath(S.graph, usual, veh, t, &prof).minutes;
            pts.push(Json::object().set("t", t).set("minutes", tr.dist[dst]).set("usual", fixed)
                         .set("level", prof.level(t)).set("route", idx));
        }
        Json rs = Json::array();
        for (const auto& p : routes) rs.push(Json(p));
        return Json::object().set("ok", true).set("points", pts).set("routes", rs).set("enabled", S.rush.enabled);
    }));
}

// Nạp một file dữ liệu mới. File lỗi được đổi tên thành .bad (không bị ghi đè ở lần lưu sau) rồi bắt đầu lại từ rỗng.
template <class Loader>
void loadOptional(const std::string& file, Loader load) {
    std::string text;
    if (!TextUtil::readFile(dataPath(file), text)) return;
    std::string err;
    if (load(text, err)) return;
    std::cerr << "[Canh bao] " << file << " bi loi (" << err << "), da doi ten thanh " << file << ".bad va bat dau lai tu rong\n";
    std::rename(dataPath(file).c_str(), (dataPath(file) + ".bad").c_str());
}

}  // namespace

void stopWebServerForTests();
namespace {
httplib::Server* gServer = nullptr;
}
void stopWebServerForTests() {
    if (gServer) gServer->stop();
}

int runWebServer(const ServerConfig& cfg) {
    S.dataDir = cfg.dataDir;
    S.demo = cfg.demo;
    std::string err;
    S.usersFile = dataPath("users.txt");
    if (!S.accounts.load(S.usersFile, err)) {
        std::cerr << "[Canh bao] " << err << " -> tao tai khoan quan tri mac dinh admin / Admin@12345 (hay doi mat khau)\n";
        Auth::NewAccount n;
        n.username = "admin"; n.password = "Admin@12345"; n.displayName = "Quản trị viên"; n.role = Auth::ADMIN; n.createdAt = nowSeconds();
        S.accounts.create(n);
        if (!S.accounts.save(S.usersFile, err)) std::cerr << "[Canh bao] " << err << "\n";
    }
    loadOptional("config.txt", [](const std::string& t, std::string& e) { return Commerce::config().loadText(t, e); });
    loadOptional("promos.txt", [](const std::string& t, std::string& e) { return S.promos.loadText(t, e); });
    loadOptional("addresses.txt", [](const std::string& t, std::string& e) { return S.addresses.loadText(t, e); });
    loadOptional("reviews.txt", [](const std::string& t, std::string& e) { return S.reviews.loadText(t, e); });
    loadOptional("customer_reviews.txt", [](const std::string& t, std::string& e) { return S.custReviews.loadText(t, e); });
    loadOptional("stats.txt", [](const std::string& t, std::string& e) { return S.stats.loadText(t, e); });
    loadOptional("notifications.txt", [](const std::string& t, std::string& e) { return S.notes.loadText(t, e); });
    loadOptional("audit.txt", [](const std::string& t, std::string& e) { return S.audit.loadText(t, e); });
    loadOptional("complaints.txt", [](const std::string& t, std::string& e) { return S.complaints.loadText(t, e); });
    loadOptional("cod_ledger.txt", [](const std::string& t, std::string& e) { return S.cod.loadText(t, e); });
    loadOptional("customer_ledger.txt", [](const std::string& t, std::string& e) { return S.ledger.loadText(t, e); });
    if (!loadShippers(dataPath("shippers.txt"), S.shippers, err)) {
        std::cerr << "[Canh bao] " << err << " -> dung 2 shipper mac dinh\n";
        S.shippers = {{"Shipper 1", 20, MOTORBIKE}, {"Shipper 2", 50, CAR}};
    }
    if (!loadDataset("hcm", err)) std::cerr << "[Canh bao] Khong nap duoc du lieu mau: " << err << "\n";

    httplib::Server svr;
    gServer = &svr;
    if (!svr.set_mount_point("/", cfg.webDir)) {
        std::cerr << "Khong tim thay thu muc giao dien: " << cfg.webDir << "\n";
        return 1;
    }
    svr.set_payload_max_length(MAX_BODY);
    try {
        registerRoutes(svr);
        // Mọi quy tắc trong bảng phân quyền đều phải có API tương ứng (và ngược lại: routeGet / routePost đã kiểm tra)
        for (const Auth::Rule& rule : Auth::rules())
            if (!registeredRoutes().count(std::string(rule.method) + " " + rule.path))
                throw std::logic_error(std::string("Quy tac phan quyen khong co API: ") + rule.method + " " + rule.path);
    } catch (const std::logic_error& e) {
        std::cerr << "[Loi cau hinh] " << e.what() << "\n";
        return 1;
    }
    // Tiêu đề bảo mật cho mọi phản hồi; API không bao giờ được lưu đệm
    svr.set_post_routing_handler([](const httplib::Request& req, httplib::Response& res) {
        res.set_header("X-Content-Type-Options", "nosniff");
        res.set_header("X-Frame-Options", "DENY");
        res.set_header("Referrer-Policy", "same-origin");
        res.set_header("Content-Security-Policy",
                       "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data:; "
                       "font-src 'self' https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
        if (req.path.rfind("/api/", 0) == 0) res.set_header("Cache-Control", "no-store");
    });
    svr.set_error_handler([](const httplib::Request& req, httplib::Response& res) {
        if (req.path.rfind("/api/", 0) == 0 && res.status >= 400 && res.body.empty())
            res.set_content(Json::object().set("ok", false).set("error", res.status == 404 ? "Không có API " + req.path : "Yêu cầu không hợp lệ").dump(),
                            "application/json; charset=utf-8");
    });
    svr.set_exception_handler([](const httplib::Request&, httplib::Response& res, std::exception_ptr) {
        res.status = 500;
        res.set_content(Json::object().set("ok", false).set("error", "Có lỗi xảy ra phía máy chủ, vui lòng thử lại sau").dump(), "application/json; charset=utf-8");
    });

    std::cout << "==================================================\n"
              << "  He thong Tim duong & Dieu phoi Giao hang (DT08)\n"
              << "  Mo trinh duyet: http://" << (cfg.host == "0.0.0.0" ? "localhost" : cfg.host) << ":"
              << cfg.port << "\n"
              << "  Giao dien: " << cfg.webDir << "   Du lieu: " << cfg.dataDir << "\n"
              << "  Che do demo (hop thu gia lap): " << (S.demo ? "BAT" : "TAT") << "\n"
              << "  Nhan Ctrl+C de dung server.\n"
              << "==================================================\n";
    bool ok = svr.listen(cfg.host, cfg.port);
    gServer = nullptr;
    if (!ok) {
        std::cerr << "Khong mo duoc cong " << cfg.port << " (co the dang bi chuong trinh khac dung). "
                  << "Thu: --port 8081\n";
        return 1;
    }
    return 0;
}
