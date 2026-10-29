// Kiểm thử đăng nhập & phân quyền: SHA-256 theo vector chuẩn, băm mật khẩu có muối,
// đọc / ghi users.txt, thêm / sửa / xoá tài khoản, phiên đăng nhập, khoá khi sai nhiều lần,
// bảng phân quyền 3 vai trò, trường kh= (khách hàng đặt đơn) trong orders.txt.
#include "Auth.h"
#include "FileIO.h"

#include <cstdio>
#include <iostream>
#include <set>
#include <string>
#include <vector>

using namespace std;
using namespace Auth;

static int passed = 0;
#define CHECK(cond)                                                              \
    do {                                                                         \
        if (!(cond)) {                                                           \
            cerr << "  [FAIL] " << __FILE__ << ":" << __LINE__ << "  " #cond "\n"; \
            return 1;                                                            \
        }                                                                        \
        ++passed;                                                                \
    } while (0)

int main() {
    // ----------------------------------------------- SHA-256 (FIPS 180-4)
    CHECK(sha256("") == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    CHECK(sha256("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    CHECK(sha256("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq") ==
          "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
    CHECK(sha256(string(1000000, 'a')) == "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
    // Độ dài sát biên khối 55 / 56 / 64 byte
    set<string> seen;
    for (int n : {55, 56, 63, 64, 65}) seen.insert(sha256(string(n, 'x')));
    CHECK(seen.size() == 5);
    CHECK(sha256("Tiếng Việt").size() == 64);

    // ----------------------------------------------- Băm mật khẩu
    {
        string h1 = hashPassword("muoi1", "matkhau1");
        CHECK(h1 == hashPassword("muoi1", "matkhau1"));
        CHECK(h1 != hashPassword("muoi2", "matkhau1"));   // khác muối -> khác băm
        CHECK(h1 != hashPassword("muoi1", "matkhau2"));
        // Đúng định nghĩa: sha256(salt:pw) rồi lặp sha256(h + salt)
        string h = sha256("muoi1:matkhau1");
        for (int i = 1; i < HASH_ROUNDS; ++i) h = sha256(h + "muoi1");
        CHECK(h == h1);
        string r1 = randomHex(16), r2 = randomHex(16);
        CHECK(r1.size() == 32 && r1 != r2);
    }

    // ----------------------------------------------- Kiểm tra dữ liệu nhập
    CHECK(checkUsername("admin").empty());
    CHECK(checkUsername("an.phat_2").empty());
    CHECK(!checkUsername("ab").empty());
    CHECK(!checkUsername("Admin").empty());
    CHECK(!checkUsername("nguyễn").empty());
    CHECK(!checkUsername("a b").empty());
    CHECK(!checkUsername(string(21, 'a')).empty());
    CHECK(checkPassword("abc123").empty());
    CHECK(!checkPassword("ab12").empty());
    CHECK(!checkPassword("abcdefgh").empty());   // thiếu số
    CHECK(!checkPassword("12345678").empty());   // thiếu chữ

    // ----------------------------------------------- File users.txt mẫu
    AccountStore store;
    string err;
    CHECK(store.load("data/users.txt", err));
    // 6 tài khoản gốc của đồ án + 3 tài khoản mẫu thêm ở phiên bản mới (điều phối viên, shipper chờ duyệt, khách thân thiết)
    CHECK(store.all().size() == 9);
    CHECK(store.adminCount() == 1);
    CHECK(store.verify("admin", "admin123"));
    CHECK(!store.verify("admin", "admin124"));
    CHECK(!store.verify("khongco", "admin123"));
    CHECK(store.verify("tuan", "shipper123") && store.verify("binh", "shipper123") && store.verify("cuong", "shipper123"));
    CHECK(store.verify("anphat", "khach123") && store.verify("banhhoa", "khach123"));
    CHECK(store.find("tuan")->role == SHIPPER && store.find("tuan")->link == "Anh Tuấn");
    CHECK(store.find("anphat")->role == CUSTOMER && store.find("anphat")->displayName == "Công ty An Phát");
    CHECK(store.find("admin")->displayName == "Quản trị viên");
    // Không file nào lưu mật khẩu gốc
    CHECK(store.toText().find("admin123") == string::npos);

    // Ghi rồi đọc lại giữ nguyên
    {
        AccountStore back;
        CHECK(back.loadText(store.toText(), err));
        CHECK(back.all().size() == store.all().size());
        for (size_t i = 0; i < back.all().size(); ++i) {
            const Account& a = back.all()[i];
            const Account& b = store.all()[i];
            CHECK(a.username == b.username && a.role == b.role && a.salt == b.salt && a.hash == b.hash);
            CHECK(a.link == b.link && a.displayName == b.displayName);
        }
        CHECK(back.verify("binh", "shipper123"));
    }
    // Bắt lỗi file
    {
        AccountStore bad;
        string h(64, 'a');
        CHECK(!bad.loadText("admin boss s " + h + " - X\n", err));                    // vai trò sai
        CHECK(!bad.loadText("admin admin s abc - X\n", err));                         // băm sai
        CHECK(!bad.loadText("ad admin s " + h + " - X\n", err));                       // tên quá ngắn
        CHECK(!bad.loadText("admin admin s " + h + " - X\nadmin admin s " + h + " - Y\n", err));   // trùng
        CHECK(!bad.loadText("admin admin\n", err));
        CHECK(bad.loadText("\xEF\xBB\xBF# chu thich\r\nadmin admin s " + h + " -\r\n", err));   // BOM, CRLF, thiếu tên
        CHECK(bad.all().size() == 1 && bad.all()[0].displayName == "admin");
    }

    // ----------------------------------------------- Thêm / sửa / xoá
    {
        AccountStore s;
        CHECK(s.add("quanly", ADMIN, "quanly1", "", "Quản lý").empty());
        CHECK(!s.add("quanly", CUSTOMER, "abc123", "", "").empty());          // trùng tên
        CHECK(!s.add("Hoa", CUSTOMER, "abc123", "", "").empty());             // chữ hoa
        CHECK(!s.add("hoa", CUSTOMER, "abc", "", "").empty());                // mật khẩu yếu
        CHECK(!s.add("shipx", SHIPPER, "abc123", "", "").empty());            // shipper thiếu liên kết
        CHECK(s.add("shipx", SHIPPER, "abc123", "Anh Tuấn", "").empty());
        CHECK(s.find("shipx")->displayName == "shipx");
        CHECK(s.add("hoa", CUSTOMER, "abc123", "Anh Tuấn", "Chị Hoa").empty());
        CHECK(s.find("hoa")->link.empty());                                   // khách không gắn shipper
        CHECK(s.verify("hoa", "abc123"));
        string salt = s.find("hoa")->salt;
        CHECK(s.setPassword("hoa", "moi12345").empty());
        CHECK(s.find("hoa")->salt != salt);                                   // đổi mật khẩu thì đổi muối
        CHECK(!s.verify("hoa", "abc123") && s.verify("hoa", "moi12345"));
        CHECK(!s.setPassword("hoa", "123").empty());
        // Quản trị viên cuối cùng
        CHECK(!s.update("quanly", CUSTOMER, "", "").empty());
        CHECK(!s.remove("quanly").empty());
        CHECK(s.update("hoa", ADMIN, "", "Chị Hoa").empty());
        CHECK(s.adminCount() == 2);
        CHECK(s.update("quanly", CUSTOMER, "", "").empty());
        CHECK(s.remove("hoa").empty() == false);   // hoa giờ là admin cuối cùng
        CHECK(s.update("quanly", ADMIN, "", "Quản lý").empty());
        CHECK(s.remove("hoa").empty());
        CHECK(s.find("hoa") == nullptr && s.find("shipx") != nullptr);
        CHECK(!s.remove("khongco").empty());
        // Đổi tên shipper: liên kết đi theo
        s.renameLink("Anh Tuấn", "Anh Tuấn (ca sáng)");
        CHECK(s.find("shipx")->link == "Anh Tuấn (ca sáng)");
        // Ghi file thật rồi đọc lại
        CHECK(s.save("out_users.txt", err));
        AccountStore back;
        CHECK(back.load("out_users.txt", err));
        CHECK(back.verify("quanly", "quanly1") && back.find("shipx")->link == "Anh Tuấn (ca sáng)");
        std::remove("out_users.txt");
    }

    // ----------------------------------------------- Phiên đăng nhập
    {
        SessionStore ss;
        string t1 = ss.create("admin", 1000);
        string t2 = ss.create("admin", 1000);
        string t3 = ss.create("tuan", 1000);
        CHECK(t1.size() == 32 && t1 != t2);
        CHECK(ss.resolve(t1, 1001) == "admin");
        CHECK(ss.resolve("sai", 1001).empty());
        CHECK(ss.resolve(t3, 1000 + SESSION_MINUTES * 60 - 1) == "tuan");     // dùng thì được gia hạn
        CHECK(ss.resolve(t3, 1000 + SESSION_MINUTES * 60 + 100) == "tuan");
        CHECK(ss.resolve(t2, 1000 + SESSION_MINUTES * 60 + 1).empty());        // không dùng -> hết hạn
        ss.remove(t1);
        CHECK(ss.resolve(t1, 1002).empty());
        string t4 = ss.create("admin", 5000);
        string t5 = ss.create("admin", 5000);
        ss.revokeUser("admin");
        CHECK(ss.resolve(t4, 5001).empty() && ss.resolve(t5, 5001).empty());
        CHECK(!ss.resolve(t3, 5001).empty());
        ss.renameUser("tuan", "tuan2");
        CHECK(ss.resolve(t3, 5002) == "tuan2");
    }

    // ----------------------------------------------- Khoá khi sai nhiều lần
    {
        LoginGuard g;
        for (int i = 0; i < LOCK_AFTER - 1; ++i) g.failed("admin", 100);
        CHECK(g.lockedFor("admin", 100) == 0);
        g.failed("admin", 100);
        CHECK(g.lockedFor("admin", 100) == LOCK_SECONDS);
        CHECK(g.lockedFor("admin", 100 + LOCK_SECONDS - 1) == 1);
        CHECK(g.lockedFor("admin", 100 + LOCK_SECONDS) == 0);
        CHECK(g.lockedFor("tuan", 100) == 0);                          // tài khoản khác không ảnh hưởng
        g.failed("admin", 100 + LOCK_SECONDS + 1);                      // hết khoá thì đếm lại từ đầu
        CHECK(g.failures("admin") == 1 && g.lockedFor("admin", 100 + LOCK_SECONDS + 1) == 0);
        g.succeeded("admin");
        CHECK(g.failures("admin") == 0);
    }

    // ----------------------------------------------- Phân quyền
    {
        CHECK(isPublic("POST", "login") && isPublic("POST", "logout") && isPublic("GET", "me"));
        CHECK(!isPublic("GET", "state"));
        const vector<string> adminOnly = {"POST dispatch/apply", "GET dispatch", "POST node/add", "POST edge/remove",
                                          "POST traffic", "POST order/update", "POST order/remove", "POST shipper/add",
                                          "POST shift/reset", "POST shift/absent", "POST shift/requeue", "POST import/map",
                                          "GET export/orders", "GET users", "POST users/add", "POST users/remove",
                                          "POST undo", "POST dataset", "POST save", "GET benchmark", "POST order/split"};
        for (const string& k : adminOnly) {
            string m = k.substr(0, k.find(' ')), p = k.substr(k.find(' ') + 1);
            CHECK(canAccess(ADMIN, m, p));
            CHECK(!canAccess(SHIPPER, m, p));
            CHECK(!canAccess(CUSTOMER, m, p));
        }
        for (const string& p : {"state", "path", "kpaths", "quote", "search", "trace", "analysis"}) {
            CHECK(canAccess(SHIPPER, "GET", p) && canAccess(CUSTOMER, "GET", p));
            CHECK(!canAccess(SHIPPER, "POST", p));
        }
        CHECK(canAccess(SHIPPER, "POST", "shift/fail") && canAccess(SHIPPER, "POST", "shift/progress"));
        CHECK(!canAccess(CUSTOMER, "POST", "shift/fail") && !canAccess(CUSTOMER, "POST", "shift/progress"));
        CHECK(canAccess(CUSTOMER, "POST", "order/add") && canAccess(CUSTOMER, "POST", "shift/cancel"));
        CHECK(!canAccess(SHIPPER, "POST", "order/add") && !canAccess(SHIPPER, "POST", "shift/cancel"));
        CHECK(canAccess(SHIPPER, "POST", "me/password") && canAccess(CUSTOMER, "POST", "me/password"));
    }

    // ----------------------------------------------- Đơn hàng có tài khoản khách đặt
    {
        vector<OrderRecord> recs;
        CHECK(FileIO::loadOrders("data/orders.txt", recs, err, nullptr));
        int anphat = 0, banhhoa = 0, none = 0;
        for (const OrderRecord& o : recs) {
            if (o.owner == "anphat") ++anphat;
            else if (o.owner == "banhhoa") ++banhhoa;
            else if (o.owner.empty()) ++none;
        }
        CHECK(anphat == 3 && banhhoa == 3 && none == 2);
        CHECK(recs[0].owner == "anphat" && recs[0].note == "Tài liệu hợp đồng" && recs[0].recipient == "Cong ty An Phat");
        vector<OrderRecord> back;
        CHECK(FileIO::loadOrdersText(FileIO::ordersToText(recs), back, err, nullptr));
        for (size_t i = 0; i < recs.size(); ++i) CHECK(back[i].owner == recs[i].owner && back[i].note == recs[i].note);
        OrderRecord odd;
        odd.id = 1; odd.destination = 1; odd.weight = 1; odd.note = "kh=ghi chu";
        CHECK(FileIO::loadOrdersText(FileIO::ordersToText({odd}), back, err, nullptr));
        CHECK(back[0].owner.empty() && back[0].note == "-kh=ghi chu");
        CHECK(!FileIO::loadOrdersText("1 1 1 0 -1 kh= x\n", back, err, nullptr));
    }

    cout << "Tai khoan mau: admin / admin123, tuan / shipper123, anphat / khach123\n";
    cout << "\n>>> TAT CA " << passed << " KIEM TRA DEU DAT <<<\n";
    return 0;
}
