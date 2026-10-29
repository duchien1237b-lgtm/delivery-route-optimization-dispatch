// Kiểm thử đơn vị cho phần nâng cấp "website thương mại": chính sách mật khẩu, khoá luỹ tiến, giới hạn tần suất,
// mã đặt lại mật khẩu (hết hạn, dùng một lần, giới hạn số lần thử), vòng đời tài khoản, bảng quyền 4 vai trò,
// máy trạng thái đơn (mọi cặp trạng thái x hành động x vai trò), phí huỷ, báo giá / mã giảm giá / hạng thân thiết,
// sổ COD, khiếu nại, thông báo, nhật ký kiểm toán (CSV chống chèn công thức), tìm kiếm không dấu (TextIndex),
// mã hoá file và đọc / ghi lại orders.txt với các cột mới (file cũ vẫn đọc được);
// nghiệp vụ tài chính phía khách (Billing): cân quy đổi, phí bảo hiểm, trần bồi thường, sổ giao dịch, sao kê ví.
#include "Auth.h"
#include "Billing.h"
#include "Commerce.h"
#include "FileIO.h"
#include "Operations.h"
#include "OrderFlow.h"
#include "Support.h"
#include "TextUtil.h"
#include "Trie.h"

#include <iostream>
#include <set>
#include <string>
#include <vector>

using namespace std;

static int passed = 0;
#define CHECK(cond)                                                              \
    do {                                                                         \
        if (!(cond)) {                                                           \
            cerr << "  [FAIL] " << __FILE__ << ":" << __LINE__ << "  " #cond "\n"; \
            return 1;                                                            \
        }                                                                        \
        ++passed;                                                                \
    } while (0)

static int testAccounts() {
    using namespace Auth;
    // Chính sách mật khẩu: >= 8 ký tự, hoa + thường + số, không phổ biến, không chứa tên đăng nhập
    CHECK(checkPasswordStrong("Giaohang@2026").empty());
    CHECK(checkPasswordStrong("Abcdef12").empty());
    CHECK(!checkPasswordStrong("Abc12").empty());         // ngắn
    CHECK(!checkPasswordStrong("abcdefg1").empty());      // thiếu chữ hoa
    CHECK(!checkPasswordStrong("ABCDEFG1").empty());      // thiếu chữ thường
    CHECK(!checkPasswordStrong("Abcdefgh").empty());      // thiếu số
    CHECK(!checkPasswordStrong("Password1").empty());     // phổ biến
    CHECK(isCommonPassword("password123") && isCommonPassword("Admin123") && !isCommonPassword("Giaohang@2026"));
    CHECK(!checkPasswordStrong("Khachmoi@1", "khachmoi").empty());   // chứa tên đăng nhập
    // Định dạng
    CHECK(checkEmail("a.b@example.com").empty() && !checkEmail("a@b").empty() && !checkEmail("khong co").empty());
    CHECK(normalizeEmail("  Moi@Example.COM ") == "moi@example.com");
    CHECK(checkPhone("0901234567").empty() && !checkPhone("901234567").empty() && !checkPhone("1901234567").empty());
    CHECK(normalizePhone("090 123.45-67") == "0901234567");
    CHECK(!checkUsername("0901234567").empty());           // tên đăng nhập không được giống số điện thoại
    CHECK(checkDisplayName("Nguyễn Văn A").empty() && !checkDisplayName("<b>x</b>").empty() && !checkDisplayName("a").empty());
    CHECK(checkPlate("59A1-123.45").empty() && !checkPlate("59a1 123").empty());
    // Vòng đời tài khoản
    CHECK(statusTransitionAllowed(Auth::PENDING, ACTIVE) && statusTransitionAllowed(Auth::PENDING, DISABLED));
    CHECK(statusTransitionAllowed(ACTIVE, LOCKED) && statusTransitionAllowed(LOCKED, ACTIVE) && statusTransitionAllowed(ACTIVE, DISABLED));
    CHECK(!statusTransitionAllowed(ACTIVE, Auth::PENDING) && !statusTransitionAllowed(LOCKED, Auth::PENDING));
    AccountStore store;
    NewAccount n;
    n.username = "shipmoi"; n.password = "Giaohang@2026"; n.displayName = "Shipper Mới"; n.role = SHIPPER; n.status = Auth::PENDING;
    n.email = "Ship@Example.com"; n.phone = "0955000111"; n.vehicle = 0; n.capacity = 20; n.plate = "59A1-111.11";
    CHECK(store.create(n).empty());
    n.username = "shipmoi2";
    CHECK(!store.create(n).empty());                       // trùng email
    n.email = "khac@example.com";
    CHECK(!store.create(n).empty());                       // trùng SĐT
    CHECK(store.resolve("SHIP@example.com") && store.resolve("0955000111") && store.resolve("shipmoi"));
    CHECK(!store.setStatus("shipmoi", LOCKED, "Spam").empty());     // đang chờ duyệt thì không khoá được, chỉ duyệt hoặc từ chối
    CHECK(!store.setStatus("shipmoi", DISABLED, "").empty());   // cần lý do
    CHECK(store.setStatus("shipmoi", ACTIVE, "").empty());
    CHECK(!store.setStatus("shipmoi", Auth::PENDING, "").empty());
    CHECK(store.setStatus("shipmoi", LOCKED, "Vi phạm").empty() && store.find("shipmoi")->statusReason == "Vi phạm");
    {
        AccountStore back;
        string err;
        CHECK(back.loadText(store.toText(), err));
        const Account* a = back.find("shipmoi");
        CHECK(a && a->status == LOCKED && a->statusReason == "Vi phạm" && a->email == "ship@example.com" && a->plate == "59A1-111.11");
        CHECK(a->vehicle == 0 && a->capacity == 20);
    }
    // File users.txt cũ (không có cột mới) vẫn đọc được, mặc định Hoạt động
    {
        AccountStore old;
        string err, h(64, 'a');
        CHECK(old.loadText("admin admin s " + h + " - Quản_trị\n", err));
        CHECK(old.find("admin")->status == ACTIVE && old.find("admin")->email.empty());
    }
    // Khoá luỹ tiến: 60 s, rồi 120 s, 240 s...
    LoginGuard g;
    int64_t t = 1000;
    for (int i = 0; i < LOCK_AFTER; ++i) g.failed("u", t);
    CHECK(g.lockedFor("u", t) == LOCK_SECONDS);
    t += LOCK_SECONDS + 1;
    CHECK(g.lockedFor("u", t) == 0);
    for (int i = 0; i < LOCK_AFTER; ++i) g.failed("u", t);
    CHECK(g.lockedFor("u", t) == 2 * LOCK_SECONDS);
    g.succeeded("u");
    CHECK(g.lockedFor("u", t) == 0 && g.failures("u") == 0);
    // Giới hạn tần suất (cửa sổ trượt)
    RateLimiter rl;
    for (int i = 0; i < 3; ++i) CHECK(rl.allow("ip", 100 + i, 3, 60));
    CHECK(!rl.allow("ip", 110, 3, 60));
    CHECK(rl.retryAfter("ip", 110, 60) > 0);
    CHECK(rl.allow("ip", 170, 3, 60));                      // các lần cũ đã ra khỏi cửa sổ
    CHECK(rl.allow("ip2", 110, 3, 60));
    // Mã đặt lại mật khẩu: 6 số, hết hạn sau 10 phút, dùng một lần, tối đa 5 lần sai
    ResetStore rs;
    string otp = rs.issue("an", 0);
    CHECK(otp.size() == 6 && otp.find_first_not_of("0123456789") == string::npos);
    CHECK(rs.verify("an", otp, RESET_MINUTES * 60 + 1) == ResetStore::EXPIRED);
    otp = rs.issue("an", 0);
    string bad = otp == "000000" ? "111111" : "000000";
    CHECK(rs.verify("an", bad, 10) == ResetStore::BAD);
    CHECK(rs.verify("an", otp, 20) == ResetStore::OK);
    CHECK(rs.verify("an", otp, 30) == ResetStore::USED);
    otp = rs.issue("an", 100);
    for (int i = 0; i < RESET_MAX_TRIES; ++i) rs.verify("an", bad, 101);
    CHECK(rs.verify("an", otp, 102) == ResetStore::TOO_MANY);
    CHECK(rs.verify("khongco", "123456", 0) == ResetStore::NONE);
    // Phiên: CSRF riêng, danh sách thiết bị, đăng xuất từng thiết bị, ghi nhớ 30 ngày
    SessionStore ss;
    SessionMeta m1; m1.device = "Chrome"; m1.remember = true;
    string t1 = ss.create("an", 0, m1), t2 = ss.create("an", 0);
    CHECK(ss.csrf(t1).size() == 32 && ss.csrf(t1) != ss.csrf(t2));
    CHECK(ss.list("an", t1).size() == 2);
    CHECK(ss.resolve(t2, int64_t(SESSION_MINUTES) * 60 + 5).empty());           // phiên thường hết hạn
    CHECK(ss.resolve(t1, int64_t(SESSION_MINUTES) * 60 + 5) == "an");           // phiên "ghi nhớ" còn
    string t3 = ss.create("an", 0);
    CHECK(ss.revokeSid("an", SessionStore::sidOf(t3)) && ss.resolve(t3, 1).empty());
    CHECK(!ss.revokeSid("khac", SessionStore::sidOf(t1)));                       // không đăng xuất thiết bị người khác
    return 0;
}

static int testMatrix() {
    using namespace Auth;
    // Mỗi quy tắc có mô tả, không trùng; khách vãng lai chỉ có các API công khai
    set<string> seen;
    for (const Rule& r : rules()) {
        CHECK(seen.insert(string(r.method) + " " + r.path).second);
        CHECK(r.roles != 0 && string(r.what).size() > 3);
    }
    CHECK(seen.size() >= 100);
    CHECK(isPublic("POST", "register") && isPublic("GET", "track") && isPublic("GET", "quote") && !isPublic("GET", "state"));
    CHECK(!canAccess(CUSTOMER, "GET", "khong-co"));         // không có quy tắc = từ chối
    // Đã bỏ vai trò điều phối viên: quản trị viên làm mọi việc vận hành, không vai trò nào khác động tới bản đồ / cấu hình / kiểm toán
    CHECK(canAccess(ADMIN, "POST", "order/confirm") && canAccess(ADMIN, "POST", "users/status") && canAccess(ADMIN, "POST", "cod/confirm"));
    CHECK(canAccess(ADMIN, "POST", "node/add") && canAccess(ADMIN, "POST", "config/update") && canAccess(ADMIN, "GET", "audit"));
    CHECK(!canAccess(SHIPPER, "POST", "node/add") && !canAccess(SHIPPER, "POST", "config/update") && !canAccess(CUSTOMER, "GET", "audit"));
    Role gone = ADMIN;
    CHECK(!roleFromKey("dispatcher", gone) && ROLE_COUNT == 3);
    // Shipper / khách hàng
    CHECK(canAccess(SHIPPER, "POST", "trip/accept") && canAccess(SHIPPER, "POST", "cod/remit") && !canAccess(SHIPPER, "POST", "cod/confirm"));
    CHECK(canAccess(SHIPPER, "POST", "order/release") && canAccess(SHIPPER, "POST", "order/rate-customer") && canAccess(SHIPPER, "POST", "shipper/location"));
    CHECK(!canAccess(CUSTOMER, "POST", "order/release") && !canAccess(CUSTOMER, "POST", "order/rate-customer") && !canAccess(CUSTOMER, "POST", "shipper/location"));
    CHECK(canAccess(CUSTOMER, "POST", "order/retry") && canAccess(ADMIN, "POST", "order/retry") && !canAccess(SHIPPER, "POST", "order/retry"));
    CHECK(!canAccess(SHIPPER, "POST", "dispatch/apply") && !canAccess(CUSTOMER, "POST", "dispatch/assign"));
    CHECK(!canAccess(SHIPPER, "POST", "order/cancel") && !canAccess(SHIPPER, "GET", "users"));
    CHECK(canAccess(CUSTOMER, "POST", "order/cancel") && canAccess(CUSTOMER, "POST", "complaint/add") && !canAccess(CUSTOMER, "POST", "complaint/status"));
    CHECK(!canAccess(CUSTOMER, "GET", "dispatch") && !canAccess(CUSTOMER, "GET", "cod"));
    CHECK(matrixMarkdown().find("| Quản trị |") != string::npos && matrixMarkdown().find("Điều phối viên |") == string::npos);
    return 0;
}

static int testOrderFlow() {
    using namespace Flow;
    const unsigned CUS = Auth::B_CUSTOMER, SHP = Auth::B_SHIPPER, ADM = Auth::B_ADMIN, SYS = Flow::B_SYSTEM;
    int to = -9;
    CHECK(check(CREATED, "confirm", ADM, &to).empty() && to == PENDING);
    CHECK(!check(CREATED, "confirm", CUS).empty());
    CHECK(!check(PENDING, "confirm", ADM).empty());
    CHECK(check(PENDING, "dispatch", ADM, &to).empty() && to == DISPATCHED);
    CHECK(check(DISPATCHED, "accept", SHP, &to).empty() && to == ASSIGNED);
    CHECK(!check(DISPATCHED, "accept", ADM).empty());
    // Ghép tự động: hệ thống mời / thu hồi lời mời hết hạn / tự huỷ khi không tìm được shipper; shipper nhả đơn khi chưa lấy hàng
    CHECK(check(PENDING, "dispatch", SYS, &to).empty() && to == DISPATCHED);
    CHECK(check(DISPATCHED, "expire", SYS, &to).empty() && to == PENDING && !check(DISPATCHED, "expire", SHP).empty());
    CHECK(check(PENDING, "cancel", SYS, &to).empty() && to == CANCELLED);
    CHECK(check(DISPATCHED, "decline", SHP, &to).empty() && to == PENDING);
    CHECK(check(ASSIGNED, "release", SHP, &to).empty() && to == PENDING && !check(ASSIGNED, "release", CUS).empty());
    CHECK(check(ASSIGNED, "deliver", SHP, &to).empty() && to == DELIVERED);
    CHECK(!check(DISPATCHED, "deliver", SHP).empty());
    CHECK(check(FAILED, "requeue", ADM, &to).empty() && to == PENDING);
    CHECK(check(FAILED, "return", ADM, &to).empty() && to == RETURNED);
    // Khách huỷ được khi Mới / Chờ giao / Đã phân công / Đang giao (nhưng API chặn khi shipper đã lấy hàng); giao thất bại thì phải nhờ quản trị viên
    for (int st : {CREATED, PENDING, DISPATCHED, ASSIGNED}) CHECK(check(st, "cancel", CUS).empty());
    CHECK(!check(FAILED, "cancel", CUS).empty() && check(FAILED, "cancel", CUS).find("quản trị viên") != string::npos);
    CHECK(check(ASSIGNED, "cancel", ADM).empty());
    // Trạng thái cuối: mọi hành động đều bị từ chối
    const vector<string> actions = {"confirm", "reject", "cancel", "dispatch", "accept", "decline", "deliver", "fail", "requeue", "return", "unassign", "release", "expire"};
    for (int st : {DELIVERED, RETURNED, CANCELLED})
        for (const string& a : actions)
            for (unsigned who : {CUS, SHP, ADM, SYS}) CHECK(!check(st, a, who).empty());
    // Toàn bộ bảng: hành động hợp lệ <=> có dòng trong transitions()
    int allowed = 0, denied = 0;
    for (int st = 0; st < ORDER_STATUS_COUNT; ++st)
        for (const string& a : actions)
            for (unsigned who : {CUS, SHP, ADM, SYS}) {
                bool inTable = false;
                for (const Transition& t : transitions()) inTable = inTable || (t.from == st && a == t.action && (t.actors & who));
                CHECK(check(st, a, who).empty() == inTable);
                (inTable ? allowed : denied)++;
            }
    CHECK(allowed > 20 && denied > 200);
    CHECK(transitionsMermaid().find("stateDiagram-v2") == 0 && transitionsMermaid().find("Đã phân công") != string::npos);
    // Phí huỷ
    Commerce::Config cfg;
    CHECK(cancelFee(PENDING, 30000, cfg) == 0 && cancelFee(CREATED, 30000, cfg) == 0);
    CHECK(cancelFee(DISPATCHED, 30000, cfg) == 6000);
    CHECK(cancelFee(ASSIGNED, 30000, cfg) == 15000);
    CHECK(cancelFee(DISPATCHED, 31000, cfg) == 6500);      // làm tròn lên 500 đ
    CHECK(newDeliveryCode().size() == 4);
    // Sổ COD: giữ -> nộp -> đối soát (chênh lệch) -> chốt ca
    CodLedger led;
    CHECK(led.record(101, "Tuấn", 500000, 10) > 0);
    CHECK(led.record(102, "Tuấn", 200000, 11) > 0);
    CHECK(led.record(103, "Bình", 0, 12) == 0);              // không thu hộ thì không ghi
    CHECK(led.held("Tuấn") == 700000);
    string err;
    int rid = 0, cid = 0;
    CHECK(!led.close("Tuấn", "dp", 20, cid).empty());        // chưa nộp thì chưa chốt
    CHECK(!led.remit("Bình", 0, 20, rid).empty());
    CHECK(led.remit("Tuấn", 690000, 20, rid).empty() && rid > 0);
    CHECK(led.held("Tuấn") == 0 && led.awaiting("Tuấn") == 700000);
    CHECK(led.findRemit(rid)->diff() == -10000);
    CHECK(led.confirm(rid, 695000, "dp", "đếm lại", 30).empty());
    CHECK(led.findRemit(rid)->diff() == -5000 && !led.confirm(rid, 1, "dp", "", 31).empty());
    CHECK(led.close("Tuấn", "dp", 40, cid).empty() && led.closes().back().diff() == -5000 && led.closes().back().orders == 2);
    CHECK(!led.close("Tuấn", "dp", 41, cid).empty());
    CodLedger back;
    CHECK(back.loadText(led.toText(), err) && back.toText() == led.toText());
    led.renameShipper("Tuấn", "Anh Tuấn");
    CHECK(led.entries()[0].shipper == "Anh Tuấn");
    return 0;
}

static int testCommerce() {
    using namespace Commerce;
    // Hạng thân thiết
    CHECK(tierFor(0).name == "Đồng" && tierFor(5).name == "Bạc" && tierFor(30).name == "Kim cương");
    CHECK(nextTier(4) && nextTier(4)->name == "Bạc" && !nextTier(99));
    // Mã giảm giá
    PromoStore ps;
    Promo p;
    p.code = "giam10"; p.type = "pct"; p.value = 10; p.maxDiscount = 5000; p.minFee = 20000; p.maxUses = 2; p.perUser = 1; p.expires = 1000;
    CHECK(ps.upsert(p).empty() && ps.find("GIAM10"));
    p.code = "X"; CHECK(!checkPromo(p).empty());
    p.code = "BAD"; p.value = 0; CHECK(!checkPromo(p).empty());
    CHECK(ps.validate("GIAM10", 30000, 10, 0).empty());
    CHECK(!ps.validate("GIAM10", 10000, 10, 0).empty());     // dưới mức tối thiểu
    CHECK(!ps.validate("GIAM10", 30000, 2000, 0).empty());   // hết hạn
    CHECK(!ps.validate("GIAM10", 30000, 10, 1).empty());     // quá lượt mỗi khách
    CHECK(!ps.validate("KHONGCO", 30000, 10, 0).empty());
    ps.consume("GIAM10"); ps.consume("GIAM10");
    CHECK(!ps.validate("GIAM10", 30000, 10, 0).empty());     // hết lượt
    ps.giveBack("GIAM10");
    CHECK(ps.validate("GIAM10", 30000, 10, 0).empty());
    // Báo giá: giảm theo hạng rồi mới tới mã; tròn 500 đ; không giảm phí thu hộ
    Pricing::Fee fee = Pricing::shippingFee(7.3, 4, false, 500000);
    CHECK(fee.valid && fee.total == 44000 && shippingPart(fee) == 39000);
    Quote q = computeQuote(fee, "Kim cương", 0.08, "GIAM10", ps, 10, 0);
    CHECK(q.loyaltyDiscount == 3000 && q.promoDiscount == 3500 && q.net == 37500 && q.promo == "GIAM10");
    CHECK(q.net == q.gross - q.loyaltyDiscount - q.promoDiscount && q.net % 500 == 0);
    q = computeQuote(fee, "", -1, "KHONGCO", ps, 10, 0);
    CHECK(q.net == 44000 && !q.promoError.empty() && q.promo.empty());
    CHECK(floor500(1499) == 1000 && ceil500(1001) == 1500);
    // Cấu hình: đọc / ghi, kiểm tra
    Config c;
    string err;
    Config c2;
    CHECK(c2.loadText(c.toText(), err) && c2.toText() == c.toText());
    c.cancelDispatched = 2;
    CHECK(!c.check().empty());
    Pricing::tariff() = Pricing::Tariff();
    // Hạn mức nợ phí: mặc định 500.000 đ, đọc / ghi lại, file cũ thiếu khoá vẫn đọc được, ngoài miền giá trị bị từ chối
    Config d;
    CHECK(d.debtLimit == 500000 && d.toText().find("debt.limit 500000") != string::npos);
    d.debtLimit = 0;
    Config d2;
    CHECK(d2.loadText(d.toText(), err) && d2.debtLimit == 0);
    Config d3;
    CHECK(d3.loadText("maxOpenOrders 20\n", err) && d3.debtLimit == 500000);
    d.debtLimit = -1;
    CHECK(!d.check().empty());
    d.debtLimit = 200000000;
    CHECK(!d.check().empty());
    Pricing::tariff() = Pricing::Tariff();
    // Sổ địa chỉ
    AddressBook book;
    Address a;
    a.owner = "an"; a.label = "Nhà"; a.recipient = "Anh An"; a.phone = "0901234567"; a.node = 3;
    int id = 0;
    CHECK(book.add(a, id).empty() && id > 0);
    CHECK(!book.remove(id, "khac").empty());                 // không xoá được địa chỉ người khác
    a.phone = "123";
    CHECK(!book.add(a, id).empty());
    // Đánh giá & điểm shipper
    ReviewStore rv;
    Review r1; r1.order = 1; r1.customer = "an"; r1.shipper = "Tuấn"; r1.stars = 5;
    CHECK(rv.add(r1).empty() && !rv.add(r1).empty());
    r1.order = 2; r1.stars = 0;
    CHECK(!rv.add(r1).empty());
    ShipperStat good{40, 40, 0, 40, 0, 0}, bad{40, 20, 10, 30, 10, 0};
    CHECK(performanceScore(good, 5, 10) > performanceScore(bad, 3, 10));
    CHECK(performanceScore(ShipperStat{}, 0, 0) > 50);       // chưa có dữ liệu: điểm trung tính
    return 0;
}

static int testSupport() {
    using namespace Support;
    NotificationStore ns;
    for (int i = 0; i < 105; ++i) ns.add("an", "order", i, "Đơn " + to_string(i), i);
    CHECK(ns.of("an").size() == MAX_PER_USER && ns.unread("an") == (int)MAX_PER_USER);
    int first = ns.of("an").front()->id;
    CHECK(ns.markRead("an", first) && !ns.markRead("khac", first));
    CHECK(ns.unread("an") == (int)MAX_PER_USER - 1 && ns.markAllRead("an") > 0 && ns.unread("an") == 0);
    // Nhật ký kiểm toán: lọc, CSV chống "CSV injection"
    AuditLog log;
    log.add("admin", "admin", "user.status", "an", "=HYPERLINK(\"x\")", 100);
    log.add("dp", "dispatcher", "order.confirm", "101", "", 200);
    CHECK(log.filter("admin", "", "", 0, 0).size() == 1 && log.filter("", "user.", "", 0, 0).size() == 1);
    CHECK(log.filter("", "", "", 150, 0).size() == 1);
    string csv = AuditLog::csv(log.filter("", "", "", 0, 0));
    CHECK(csv.find("\"'=HYPERLINK(\"\"x\"\")\"") != string::npos);
    string err;
    AuditLog back;
    CHECK(back.loadText(log.toText(), err) && back.all().size() == 2 && back.all()[0].detail == "=HYPERLINK(\"x\")");
    // Khiếu nại
    ComplaintStore cs;
    int id = 0;
    CHECK(!cs.create("an", 101, "x", "nội dung", 1, id).empty());     // tiêu đề quá ngắn
    CHECK(cs.create("an", 101, "Giao chậm", "Đơn tới trễ một giờ", 1, id).empty());
    CHECK(!cs.setStatus(id, "resolved", "dp", 2).empty());
    CHECK(cs.setStatus(id, "processing", "dp", 2).empty() && cs.find(id)->assignee == "dp");
    CHECK(cs.addMessage(id, "dp", "dispatcher", "Đang kiểm tra", 3).empty());
    CHECK(cs.setStatus(id, "resolved", "dp", 4).empty());
    CHECK(!cs.addMessage(id, "an", "customer", "Cảm ơn", 5).empty());
    CHECK(cs.setStatus(id, "processing", "dp", 6).empty());           // mở lại
    ComplaintStore cb;
    CHECK(cb.loadText(cs.toText(), err));
    const Complaint* back1 = cb.find(id);
    CHECK(back1 && back1->title == "Giao chậm" && back1->status == "processing" && back1->assignee == "dp");
    CHECK(back1->msgs.size() == 2 && back1->msgs[0].text == "Đơn tới trễ một giờ" && back1->msgs[1].role == "dispatcher");
    for (int k = 0; k < 2; ++k) cs.create("an", 101, "Thêm phiếu", "Nội dung thêm", 7, id);
    CHECK(!cs.create("an", 101, "Phiếu thứ tư", "Quá số phiếu mở", 8, id).empty());
    return 0;
}

static int testTextAndFiles() {
    // Mã hoá cột / dòng
    for (string s : {string(""), string("a b"), string("100%"), string("-"), string("dòng\nhai"), string("Tiếng Việt có dấu")}) {
        CHECK(TextUtil::decodeToken(TextUtil::encodeToken(s)) == s);
        CHECK(TextUtil::encodeToken(s).find(' ') == string::npos);
        CHECK(TextUtil::decodeLine(TextUtil::encodeLine(s)) == s);
    }
    // Tìm kiếm không dấu dựng trên Trie
    TextIndex idx;
    idx.add(1, "Nhà hàng Hương Việt khachvip vip@example.com");
    idx.add(2, "Công ty An Phát anphat 0901000001");
    idx.add(3, "Tiệm bánh Hoa");
    CHECK(idx.search("nha hang") == vector<int>{1});
    CHECK(idx.search("HUONG viet") == vector<int>{1});
    CHECK(idx.search("an") == (vector<int>{2}));
    CHECK(idx.search("0901") == vector<int>{2});
    CHECK(idx.search("banh hoa") == vector<int>{3});
    CHECK(idx.search("pho").empty() && idx.search("").empty());
    // orders.txt: cột mới đọc / ghi lại khớp; ghi chú bắt đầu bằng "ma=" được thêm "-" nên không bị hiểu nhầm là cột
    OrderRecord r;
    r.id = 201; r.destination = 3; r.weight = 2.5; r.note = "ma=ABC là ghi chú"; r.owner = "an"; r.promo = "GIAM10";
    r.promoDiscount = 3500; r.loyaltyDiscount = 3000; r.gross = 44000; r.createdAt = 1700000000; r.createdBy = "an";
    r.deliveryCode = "0421"; r.status = 2; r.shipperName = "Anh Tuấn"; r.eta = 17.5; r.deliveredAt = 18; r.cancelFee = 0;
    r.proofNote = "Gửi bảo vệ"; r.codRecorded = true; r.address = 4; r.cod = 500000; r.phone = "0988111222"; r.recipient = "Anh Nam";
    vector<OrderRecord> out;
    string err;
    CHECK(FileIO::loadOrdersText(FileIO::ordersToText({r}), out, err) && out.size() == 1);
    const OrderRecord& b = out[0];
    CHECK(b.note == "-" + r.note && b.promo == "GIAM10" && b.promoDiscount == 3500 && b.gross == 44000 && b.deliveryCode == "0421");
    CHECK(b.status == 2 && b.shipperName == "Anh Tuấn" && b.eta == 17.5 && b.proofNote == "Gửi bảo vệ" && b.codRecorded && b.address == 4);
    // Trường khai giá / kích thước / người trả cước / phí hoàn đọc ghi lại khớp; ghi chú bắt đầu bằng "kt=" không bị hiểu nhầm
    r.declaredValue = 3000000; r.insuranceFee = 15000; r.dimL = 60; r.dimW = 40; r.dimH = 40; r.receiverPays = true; r.returnFee = 9000;
    r.closedAt = 1700000500; r.note = "kt=to";
    CHECK(FileIO::loadOrdersText(FileIO::ordersToText({r}), out, err) && out.size() == 1);
    CHECK(out[0].declaredValue == 3000000 && out[0].insuranceFee == 15000 && out[0].dimL == 60 && out[0].dimH == 40 && out[0].receiverPays);
    CHECK(out[0].returnFee == 9000 && out[0].closedAt == 1700000500 && out[0].note == "-kt=to");
    CHECK(!FileIO::loadOrdersText("101 1 2.5 1 45 kt=60x40 Tài liệu\n", out, err));
    CHECK(!FileIO::loadOrdersText("101 1 2.5 1 45 gtri=100000001 Tài liệu\n", out, err));
    // File cũ không có cột mới vẫn đọc được
    CHECK(FileIO::loadOrdersText("101 1 2.5 1 45 sdt=0909101101 nhan=Cong_ty kh=anphat Tài liệu\n", out, err));
    CHECK(out[0].status == 0 && out[0].gross == 0 && out[0].owner == "anphat" && out[0].note == "Tài liệu");
    return 0;
}

static int testBilling() {
    using namespace Billing;
    // Cân quy đổi: 60x40x40 / 6000 = 16 kg; làm tròn lên 0,1 kg; thiếu cạnh = không khai
    CHECK(volumetricWeight(60, 40, 40, 6000) == 16);
    CHECK(volumetricWeight(10, 10, 11, 6000) == 0.2);   // 0,1833 -> 0,2
    CHECK(volumetricWeight(0, 40, 40, 6000) == 0);
    CHECK(chargedWeight(20, 60, 40, 40, 6000) == 20 && chargedWeight(1, 60, 40, 40, 6000) == 16 && chargedWeight(2.5, 0, 0, 0, 6000) == 2.5);
    // Đơn không khai kích thước: cước như cũ (kết quả biểu phí không đổi)
    Pricing::Fee plain = Pricing::shippingFee(7.3, 2.5, false, 0), same = Pricing::shippingFee(7.3, chargedWeight(2.5, 0, 0, 0, 6000), false, 0);
    CHECK(plain.total == same.total);
    // Bảo hiểm: miễn phí tới ngưỡng, vượt ngưỡng thu tỉ lệ x giá trị khai, làm tròn lên 500 đ
    CHECK(insuranceFee(0, 0.005, 1000000) == 0 && insuranceFee(1000000, 0.005, 1000000) == 0);
    CHECK(insuranceFee(3000000, 0.005, 1000000) == 15000 && insuranceFee(1100000, 0.005, 1000000) == 5500);
    // Kích thước
    CHECK(checkDims(0, 0, 0).empty() && checkDims(30, 20, 10).empty() && !checkDims(30, 0, 10).empty() && !checkDims(301, 1, 1).empty());
    int l = 0, w = 0, h = 0;
    CHECK(parseDims("40x30x20", l, w, h) && l == 40 && w == 30 && h == 20 && dimsText(l, w, h) == "40x30x20");
    CHECK(!parseDims("40x30", l, w, h) && !parseDims("40x30x400", l, w, h) && !parseDims("axbxc", l, w, h) && !parseDims("40x0x20", l, w, h));
    // Trần bồi thường: hư hỏng / thất lạc theo giá trị khai, không khai thì N lần cước; trễ hạn tối đa bằng tiền đã trả
    CHECK(compensationCap("damaged", 3000000, 50000, 4) == 3000000 && compensationCap("lost", 0, 50000, 4) == 200000);
    CHECK(compensationCap("late", 3000000, 50000, 4) == 50000 && compensationCap("other", 0, 42000, 4) == 42000);
    // Sổ giao dịch: kiểm tra dữ liệu, mỗi khiếu nại tìm được khoản bồi thường, đọc / ghi lại file
    CustomerLedger led;
    int id = 0;
    Tx t;
    t.kind = "payout"; t.customer = "an"; t.amount = 0; t.method = "cash";
    CHECK(!led.add(t, id).empty());                      // số tiền 0
    t.amount = 100000; t.method = "bank"; t.ref = "";
    CHECK(!led.add(t, id).empty());                      // chuyển khoản thiếu mã giao dịch
    t.kind = "gift";
    CHECK(!led.add(t, id).empty());
    Tx comp;
    comp.kind = "comp"; comp.customer = "an"; comp.amount = 50000; comp.at = 200; comp.order = 7; comp.complaint = 3; comp.note = "Hàng hư hỏng";
    CHECK(led.add(comp, id).empty() && id == 1 && led.ofComplaint(3) && led.ofComplaint(3)->method == "wallet" && !led.ofComplaint(4));
    Tx pay;
    pay.kind = "payout"; pay.customer = "an"; pay.amount = 30000; pay.at = 300; pay.method = "bank"; pay.ref = "VCB 123"; pay.note = "Tuần 1";
    CHECK(led.add(pay, id).empty() && id == 2);
    CustomerLedger back;
    string err;
    CHECK(back.loadText(led.toText(), err) && back.all().size() == 2 && back.all()[1].ref == "VCB 123" && back.all()[1].note == "Tuần 1");
    CHECK(!back.loadText("T 1 gift an 5 0 - 0 0 - - x\n", err) && !back.loadText("T 1 comp\n", err));
    // Sao kê: + thu hộ (chờ tới khi đối soát), − cước nếu người gửi trả, − phí hoàn, − phí huỷ, + bồi thường, − chi trả
    vector<OrderFacts> facts(5);
    facts[0].id = 1; facts[0].status = DELIVERED; facts[0].cod = 200000; facts[0].total = 30000; facts[0].at = 100; facts[0].codSettled = true;
    facts[1].id = 2; facts[1].status = DELIVERED; facts[1].cod = 100000; facts[1].total = 40000; facts[1].receiverPays = true; facts[1].at = 110;
    facts[2].id = 3; facts[2].status = RETURNED; facts[2].returnFee = 12000; facts[2].at = 120;
    facts[3].id = 4; facts[3].status = CANCELLED; facts[3].cancelFee = 5000; facts[3].at = 130;
    facts[4].id = 5; facts[4].status = PENDING; facts[4].cod = 999; facts[4].total = 999;
    Statement st = statement(facts, back.of("an"));
    // 200000 - 30000 + 100000 (chờ) - 12000 - 5000 + 50000 - 30000
    CHECK(st.balance == 273000 && st.pending == 100000 && st.available == 173000);
    CHECK(st.codTotal == 300000 && st.fees == 47000 && st.comps == 50000 && st.paidOut == 30000);
    CHECK(st.lines.size() == 7 && st.lines.front().at == 100 && st.lines.back().kind == "payout" && st.lines.back().amount == -30000);
    CHECK(statement({}, {}).balance == 0 && statement({}, {}).lines.empty());
    return 0;
}


// Vòng 4: bỏ điều phối viên, ghép đơn tự động kiểu Grab
static int testAutoMatchUnits() {
    // Tài khoản điều phối viên trong file cũ: giữ lại nhưng khoá, quản trị viên phải chọn vai trò mới
    Auth::AccountStore st;
    string err;
    CHECK(st.loadText("dpcu dispatcher 0123456789abcdef 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef - Điều_phối_cũ\nadm1 admin 0123456789abcdef 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef - Admin\n", err));
    const Auth::Account* dp = st.find("dpcu");
    CHECK(dp && dp->role == Auth::ADMIN && dp->status == Auth::LOCKED && dp->statusReason.find("điều phối viên") != string::npos);
    CHECK(st.find("adm1")->status == Auth::ACTIVE);
    CHECK(!st.loadText("x boss 0123456789abcdef 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef - X\n", err) && err.find("admin / shipper / customer") != string::npos);
    // Vị trí đứng của shipper lưu trong tài khoản (khoá vitri), file cũ không có vẫn đọc được
    CHECK(st.loadText("ship1 shipper 0123456789abcdef 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef Anh_A vitri=7 xe=0 tai=20 bien=59A1-111.11 Anh_A\nship2 shipper 0123456789abcdef 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef Anh_B Anh_B\n", err));
    CHECK(st.find("ship1")->home == 7 && st.find("ship2")->home == -1);
    Auth::AccountStore st2;
    CHECK(st2.loadText(st.toText(), err) && st2.find("ship1")->home == 7);
    // Cấu hình ghép: lưu / đọc lại, kiểm tra miền giá trị
    Commerce::Config cfg;
    CHECK(cfg.autoMatch && cfg.offerSeconds == 45 && cfg.matchGiveUp == 10 && cfg.clockSpeed == 0 && cfg.check().empty());
    cfg.offerSeconds = 20; cfg.matchGiveUp = 0; cfg.clockSpeed = 6; cfg.autoMatch = false;
    Commerce::Config back;
    CHECK(back.loadText(cfg.toText(), err) && !back.autoMatch && back.offerSeconds == 20 && back.matchGiveUp == 0 && back.clockSpeed == 6);
    Commerce::Config bad;
    bad.offerSeconds = 0; CHECK(!bad.check().empty());
    bad = Commerce::Config(); bad.offerSeconds = 601; CHECK(!bad.check().empty());
    bad = Commerce::Config(); bad.matchGiveUp = 241; CHECK(!bad.check().empty());
    bad = Commerce::Config(); bad.clockSpeed = 121; CHECK(!bad.check().empty());
    // Đánh giá hai chiều: điểm trung bình của khách do các shipper chấm
    Commerce::ReviewStore cr;
    Commerce::Review r;
    r.order = 1; r.customer = "kh1"; r.shipper = "Anh A"; r.stars = 5; r.at = 1;
    CHECK(cr.add(r).empty());
    r.order = 2; r.stars = 3;
    CHECK(cr.add(r).empty());
    r.order = 3; r.customer = "kh2"; r.stars = 1;
    CHECK(cr.add(r).empty());
    int n = 0;
    CHECK(cr.averageOfCustomer("kh1", &n) == 4.0 && n == 2 && cr.averageOfCustomer("kh3", &n) == 0 && n == 0);
    // ShiftManager: lời mời im lặng (không ghi lịch sử), nhận muộn thì lùi giờ, nhả đơn trước khi lấy hàng
    ShiftManager sm;
    vector<Order> orders(2);
    orders[0].id = 1; orders[0].destination = 5; orders[0].status = PENDING;
    orders[1].id = 2; orders[1].destination = 6; orders[1].status = PENDING;
    vector<Shipper> ships = {{"Anh A", 20, MOTORBIKE}, {"Anh B", 20, MOTORBIKE}};
    Plan plan;
    plan.name = "Ghép tự động";
    Route rt;
    rt.shipper = 0; rt.vehicle = MOTORBIKE; rt.orders = {0}; rt.path = {0, 5}; rt.pathTimes = {0, 8}; rt.arrival = {8}; rt.stopIndex = {1};
    plan.routes.push_back(rt);
    CHECK(sm.apply(plan, {0}, orders, ships, true, true) == 1);
    CHECK(sm.history().empty() && orders[0].status == DISPATCHED && sm.busy(0, orders) && !sm.busy(1, orders));
    Trip* t = sm.findTripMutable(1);
    CHECK(t && !t->accepted);
    t->fromNode = 3; t->offerClock = 0; t->approach = {3, 0}; t->approachTimes = {0, 4};
    for (double& x : t->pathTimes) x += 4;
    t->stops[0].eta += 4; orders[0].eta += 4;
    sm.advance(2);   // 2 phút trôi qua trước khi shipper nhận
    CHECK(sm.accept(1, orders) == 1 && orders[0].status == ASSIGNED);
    CHECK(sm.history().size() == 1 && sm.history()[0].plan.find("tự động") != string::npos);
    CHECK(sm.findTrip(1)->pathTimes[0] == 6 && sm.findTrip(1)->stops[0].eta == 14 && orders[0].eta == 14);   // lùi giờ theo 2 phút nhận muộn
    CHECK(sm.nodeReached(*sm.findTrip(1)) == 3);   // mới chạy được một nửa đoạn tới kho: chưa tới kho
    CHECK(sm.release(1, orders) && orders[0].status == PENDING && orders[0].shipper == -1 && !sm.busy(0, orders));
    CHECK(sm.standby(0) == 3 && !sm.release(1, orders) && !sm.release(2, orders));
    CHECK(sm.dropEmptyAutoTrips() == 1 && sm.trips().empty());
    // Đặt lại ca xoá luôn danh sách shipper đã từ chối
    orders[1].tried = {0, 1};
    orders[1].noShipperAt = 99;
    sm.reset(orders, false);
    CHECK(orders[1].tried.empty() && orders[1].noShipperAt == 0 && sm.standby(0) == -1);
    return 0;
}

int main() {
    if (testAccounts() || testMatrix() || testOrderFlow() || testCommerce() || testSupport() || testTextAndFiles() || testBilling() || testAutoMatchUnits()) return 1;
    cout << "\n>>> TAT CA " << passed << " KIEM TRA DEU DAT <<<\n";
    return 0;
}
