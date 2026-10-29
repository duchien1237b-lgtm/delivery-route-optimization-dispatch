// ============================================================================
// make_demo_data.cpp — Sinh dữ liệu mẫu cho hệ thống tài khoản mới (chạy một lần, kết quả đã nằm sẵn trong data/).
//   g++ -std=c++17 -Isrc tools/make_demo_data.cpp build/obj/{Auth,Commerce,Support,OrderFlow,Pricing,...}.o -o make_demo_data
//   ->  ghi đè data/users.txt, promos.txt, config.txt, stats.txt, addresses.txt, ...
// Sáu tài khoản gốc của đồ án (admin, tuan, binh, cuong, anphat, banhhoa) giữ nguyên mật khẩu cũ; thêm email / SĐT cho họ
// và ba tài khoản mới: khách hàng Cửa hàng Mai Anh, shipper chờ duyệt, khách hàng thân thiết hạng Kim cương.
// Ba shipper được đặt sẵn vị trí đứng (vitri) ở ba nơi khác nhau để thấy việc ghép đơn theo khoảng cách.
// ============================================================================
#include "Auth.h"
#include "Commerce.h"
#include "Support.h"
#include "TextUtil.h"

#include <ctime>
#include <iostream>

using namespace std;

static void must(const string& e, const char* what) {
    if (!e.empty()) {
        cerr << "Loi (" << what << "): " << e << "\n";
        exit(1);
    }
}
static void write(const string& dir, const string& file, const string& text) {
    string err;
    if (!TextUtil::writeAtomic(dir + "/" + file, text, err)) {
        cerr << err << "\n";
        exit(1);
    }
}

int main(int argc, char** argv) {
    string dir = argc > 1 ? argv[1] : "data";
    int64_t now = time(nullptr);
    Auth::AccountStore users;
    string err;
    if (!users.load(dir + "/users.txt", err)) {
        cerr << err << "\n";
        return 1;
    }
    struct P { const char* user; const char* email; const char* phone; };
    for (P p : {P{"admin", "admin@giaohang.vn", "0900000001"}, P{"tuan", "tuan@giaohang.vn", "0911000001"},
                P{"binh", "binh@giaohang.vn", "0911000002"}, P{"cuong", "cuong@giaohang.vn", "0911000003"},
                P{"anphat", "anphat@example.com", "0901000001"}, P{"banhhoa", "banhhoa@example.com", "0901000002"}}) {
        const Auth::Account* a = users.find(p.user);
        if (!a) continue;
        must(users.updateProfile(p.user, a->displayName, p.email, p.phone), "profile");
    }
    must(users.setShipperInfo("tuan", 0, 20, "59A1-111.11"), "tuan");
    must(users.setShipperInfo("binh", 0, 15, "59A1-222.22"), "binh");
    must(users.setShipperInfo("cuong", 2, 60, "51C-333.33"), "cuong");
    Auth::NewAccount n;
    users.setHome("tuan", 11);    // Bến xe Miền Đông: sát kho nhất
    users.setHome("binh", 1);     // Chợ Bến Thành
    users.setHome("cuong", 7);    // Chợ Lớn (xe tải)
    n.username = "cuahangmai"; n.password = "Mai@2026"; n.displayName = "Cửa hàng Mai Anh"; n.role = Auth::CUSTOMER;
    n.email = "maianh@example.com"; n.phone = "0903000001"; n.createdAt = now - 45 * 86400;
    must(users.create(n), "cuahangmai");
    n = Auth::NewAccount();
    n.username = "ctv_hung"; n.password = "Hung@2026"; n.displayName = "Anh Hùng"; n.role = Auth::SHIPPER; n.status = Auth::PENDING;
    n.email = "hung@example.com"; n.phone = "0913000001"; n.vehicle = 0; n.capacity = 18; n.plate = "59B2-222.22"; n.createdAt = now - 2 * 86400;
    must(users.create(n), "ctv_hung");
    n = Auth::NewAccount();
    n.username = "khachvip"; n.password = "HuongViet@2026"; n.displayName = "Nhà hàng Hương Việt"; n.role = Auth::CUSTOMER;
    n.email = "vip@example.com"; n.phone = "0902000001"; n.createdAt = now - 200 * 86400;
    must(users.create(n), "khachvip");
    for (int i = 0; i < 32; ++i) users.addDelivered("khachvip", 150000 + 500 * i);   // 32 đơn đã giao -> hạng Kim cương
    for (int i = 0; i < 2; ++i) users.addDelivered("cuahangmai", 95000);
    for (int i = 0; i < 6; ++i) users.addDelivered("anphat", 120000);                  // 6 đơn -> hạng Bạc
    if (!users.save(dir + "/users.txt", err)) { cerr << err << "\n"; return 1; }

    Commerce::PromoStore promos;
    Commerce::Promo p;
    p.code = "GIAM10"; p.type = "pct"; p.value = 10; p.maxDiscount = 20000; p.minFee = 30000; p.maxUses = 200; p.perUser = 2;
    p.expires = now + 400 * 86400; p.description = "Giảm 10% cước, tối đa 20.000đ, cho đơn từ 30.000đ";
    must(promos.upsert(p), "p1");
    p = Commerce::Promo(); p.code = "FREESHIP20"; p.type = "amt"; p.value = 20000; p.minFee = 50000; p.maxUses = 50; p.perUser = 1;
    p.expires = now + 120 * 86400; p.description = "Giảm 20.000đ cho đơn từ 50.000đ";
    must(promos.upsert(p), "p2");
    p = Commerce::Promo(); p.code = "CHAOBAN"; p.type = "pct"; p.value = 15; p.maxDiscount = 30000; p.maxUses = 100; p.perUser = 1;
    p.expires = now - 30 * 86400; p.description = "Mã chào bạn mới (đã hết hạn — dùng để thử báo lỗi)";
    must(promos.upsert(p), "p3");
    p = Commerce::Promo(); p.code = "HETLUOT"; p.type = "amt"; p.value = 10000; p.maxUses = 1; p.used = 1; p.perUser = 1;
    p.expires = now + 120 * 86400; p.description = "Mã đã hết lượt dùng (dùng để thử báo lỗi)";
    must(promos.upsert(p), "p4");
    promos.consume("HETLUOT");
    write(dir, "promos.txt", promos.toText());

    write(dir, "config.txt", Commerce::Config().toText());

    Commerce::StatsStore stats;
    stats.at("Anh Tuấn") = {42, 39, 3, 44, 1, 1260000};
    stats.at("Chị Bình") = {30, 24, 6, 33, 3, 840000};
    stats.at("Anh Cường") = {55, 53, 2, 56, 0, 2310000};
    write(dir, "stats.txt", stats.toText());

    Commerce::AddressBook book;
    int id = 0;
    Commerce::Address a;
    a.owner = "anphat"; a.label = "Văn phòng"; a.recipient = "Công ty An Phát"; a.phone = "0901000001"; a.detail = "Tầng 5, toà nhà Sunrise"; a.node = 1;
    must(book.add(a, id), "addr1");
    must(book.setDefault(id, "anphat"), "def");
    a.label = "Kho hàng"; a.recipient = "Anh Khoa"; a.phone = "0909103103"; a.detail = "Kho số 2"; a.node = 10;
    must(book.add(a, id), "addr2");
    a = Commerce::Address();
    a.owner = "khachvip"; a.label = "Nhà hàng"; a.recipient = "Nhà hàng Hương Việt"; a.phone = "0902000001"; a.detail = "Mặt tiền đường chính"; a.node = 5;
    must(book.add(a, id), "addr3");
    must(book.setDefault(id, "khachvip"), "def3");
    write(dir, "addresses.txt", book.toText());

    Support::NotificationStore notes;
    notes.add("anphat", "account", 0, "Chào mừng bạn trở lại! Bạn đang ở hạng Bạc, đã giảm 3% cước vận chuyển.", now - 86400);
    notes.add("khachvip", "account", 0, "Bạn đang ở hạng Kim cương, giảm 8% cước vận chuyển cho mọi đơn.", now - 86400);
    notes.add("admin", "account", 0, "Có 1 hồ sơ shipper đang chờ duyệt (ctv_hung).", now - 3600);
    write(dir, "notifications.txt", notes.toText());

    Support::AuditLog audit;
    audit.add("admin", "admin", "auth.login", "admin", "Chrome trên Windows", now - 7200);
    audit.add("admin", "admin", "user.create", "cuahangmai", "customer", now - 7000);
    audit.add("ctv_hung", "guest", "auth.register", "ctv_hung", "shipper hung@example.com", now - 2 * 86400);
    write(dir, "audit.txt", audit.toText());

    Support::ComplaintStore complaints;
    int cid = 0;
    must(complaints.create("anphat", 103, "Hàng giao chậm hơn dự kiến", "Đơn linh kiện điện tử giao trễ gần một giờ so với hạn đã hẹn, nhờ bên mình kiểm tra lại giúp.", now - 3600, cid), "c1");
    write(dir, "complaints.txt", complaints.toText());
    cout << "Da sinh du lieu mau trong " << dir << "\n";
    return 0;
}
