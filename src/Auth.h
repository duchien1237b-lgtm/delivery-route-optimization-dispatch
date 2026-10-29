// ============================================================================
// Auth.h — Tài khoản, đăng ký / đăng nhập, phiên, đặt lại mật khẩu và phân quyền
//          (3 vai trò: quản trị viên, shipper, khách hàng; khách vãng lai không có tài khoản)
//
// 1. MẬT KHẨU: không lưu mật khẩu gốc. Mỗi tài khoản có một chuỗi "muối" (salt) ngẫu nhiên;
//    lưu băm = SHA-256 lặp HASH_ROUNDS lần:  h = sha256(salt + ":" + matKhau),
//    rồi h = sha256(h + salt) thêm HASH_ROUNDS - 1 lần (làm chậm việc dò mật khẩu).
//    SHA-256 tự cài theo chuẩn FIPS 180-4, không cần thư viện ngoài. (Web thật nên dùng bcrypt / Argon2.)
//    Chính sách mật khẩu khi đặt mới: >= 8 ký tự, có chữ hoa, chữ thường, chữ số, không thuộc danh sách phổ biến.
// 2. VÒNG ĐỜI TÀI KHOẢN: Chờ duyệt -> Hoạt động <-> Bị khoá, Vô hiệu hoá (kèm lý do). Khách hàng đăng ký xong dùng ngay;
//    shipper đăng ký xong ở "Chờ duyệt" tới khi quản trị viên duyệt.
// 3. PHIÊN ĐĂNG NHẬP: mã phiên 128 bit ngẫu nhiên, lưu trong bảng băm mã phiên -> tài khoản; hết hạn sau
//    SESSION_MINUTES phút không dùng (hoặc REMEMBER_DAYS ngày nếu chọn "ghi nhớ đăng nhập"). Mỗi phiên có
//    mã CSRF riêng và thông tin thiết bị để người dùng xem / đăng xuất từng thiết bị.
// 4. CHỐNG DÒ MẬT KHẨU: sai LOCK_AFTER lần liên tiếp thì khoá LOCK_SECONDS giây; mỗi lần khoá liên tiếp sau đó gấp đôi
//    (tối đa MAX_LOCK_SECONDS). Bộ giới hạn tần suất (RateLimiter) chặn spam đăng ký / tra cứu theo IP.
// 5. ĐẶT LẠI MẬT KHẨU: mã OTP 6 số, hết hạn sau RESET_MINUTES phút, dùng một lần, chỉ lưu bản băm (có muối).
// 6. PHÂN QUYỀN: bảng quy tắc (vai trò x phương thức x đường dẫn API) — canAccess() và README đều lấy từ bảng này.
//
// users.txt: mỗi dòng "<ten_dang_nhap> <vai_tro> <salt> <bam> <lien_ket> [khoa=gia_tri ...] <ten_hien_thi>"
//   vai_tro = admin | dispatcher | shipper | customer; lien_ket = tên shipper (vai trò shipper) hoặc '-';
//   khoá tuỳ chọn: status ly_do email sdt tao dn xe tai bien sansang done chi (file cũ không có vẫn đọc được);
//   dấu '_' trong liên kết, lý do, tên hiển thị thay cho dấu cách.
// ============================================================================
#pragma once
#include <cstdint>
#include <map>
#include <string>
#include <unordered_map>
#include <vector>

bool validPhone(const std::string& s);   // FileIO.h: 10 chữ số, bắt đầu bằng 0

namespace Auth {

// Vai trò điều phối viên đã bỏ: đơn mới được hệ thống tự ghép cho shipper gần nhất, quyền còn lại thuộc quản trị viên.
enum Role { ADMIN = 0, SHIPPER = 1, CUSTOMER = 2 };
const int ROLE_COUNT = 3;
const char* roleKey(Role r);    // "admin", "shipper", "customer"
const char* roleName(Role r);   // "Quản trị viên", "Shipper", "Khách hàng"
bool roleFromKey(const std::string& s, Role& out);

// Chờ duyệt -> Hoạt động -> Bị khoá / Vô hiệu hoá
enum Status { ACTIVE = 0, PENDING = 1, LOCKED = 2, DISABLED = 3 };
const char* statusKey(Status s);    // "active", "pending", "locked", "disabled"
const char* statusName(Status s);   // "Hoạt động", "Chờ duyệt", "Bị khoá", "Vô hiệu hoá"
bool statusFromKey(const std::string& s, Status& out);
// Chuyển trạng thái hợp lệ (from -> to)? Lý do bắt buộc với Bị khoá / Vô hiệu hoá / từ chối.
bool statusTransitionAllowed(Status from, Status to);

const int HASH_ROUNDS = 10000;
const int SESSION_MINUTES = 12 * 60;
const int REMEMBER_DAYS = 30;
const int LOCK_AFTER = 5;
const int LOCK_SECONDS = 60;
const int MAX_LOCK_SECONDS = 15 * 60;
const size_t MIN_PASSWORD = 6;          // mức tối thiểu của lớp dữ liệu (AccountStore); chính sách đầy đủ: checkPasswordStrong
const size_t MIN_PASSWORD_STRONG = 8;
const int RESET_MINUTES = 10;
const int RESET_MAX_TRIES = 5;

std::string sha256(const std::string& data);   // chuỗi hex 64 ký tự
std::string hashPassword(const std::string& salt, const std::string& password);
std::string randomHex(size_t bytes);           // dùng std::random_device
std::string randomDigits(size_t n);            // chuỗi n chữ số (OTP, mã xác nhận giao)

struct Account {
    std::string username;
    Role role = CUSTOMER;
    std::string salt, hash;
    std::string link;          // vai trò shipper: tên shipper trong danh sách đội xe
    std::string displayName;
    // Hồ sơ (tuỳ chọn trong file cũ)
    Status status = ACTIVE;
    std::string statusReason;
    std::string email, phone;
    int64_t createdAt = 0, lastLogin = 0;
    // Shipper
    int vehicle = -1;          // 0 xe máy, 1 ô tô, 2 xe tải; -1 chưa khai
    double capacity = 0;       // kg
    std::string plate;
    bool ready = true;         // sẵn sàng nhận chuyến
    int home = -1;             // vị trí cuối cùng của shipper trên bản đồ (id nút); -1 chưa có
    // Khách hàng thân thiết: số đơn đã giao thành công và tổng cước đã chi
    int done = 0;
    long long spent = 0;
};

// Kiểm tra dữ liệu nhập. Trả về chuỗi lỗi (rỗng nếu hợp lệ).
std::string checkUsername(const std::string& u);    // 3–20 ký tự a-z 0-9 _ . ; không giống số điện thoại
std::string checkPassword(const std::string& p);    // mức tối thiểu: >= MIN_PASSWORD ký tự, có cả chữ và số
std::string checkPasswordStrong(const std::string& p, const std::string& username = "");   // chính sách đầy đủ
bool isCommonPassword(const std::string& p);
std::string checkEmail(const std::string& e);       // định dạng cơ bản, <= 80 ký tự
std::string checkPhone(const std::string& p);       // 10 chữ số, bắt đầu bằng 0
std::string checkDisplayName(const std::string& n); // 2–40 ký tự, không có < > = hoặc ký tự điều khiển
std::string checkPlate(const std::string& p);       // biển số: chữ in hoa, số, '-', '.', 4–12 ký tự
std::string normalizeEmail(const std::string& e);   // chữ thường, bỏ khoảng trắng hai đầu
std::string normalizePhone(const std::string& p);   // bỏ khoảng trắng, '.', '-'

struct NewAccount {            // dữ liệu để tạo tài khoản (đăng ký hoặc quản trị viên tạo)
    std::string username, password, displayName, email, phone, link;
    Role role = CUSTOMER;
    Status status = ACTIVE;
    int vehicle = -1;
    double capacity = 0;
    std::string plate;
    int64_t createdAt = 0;
};

class AccountStore {
public:
    bool loadText(const std::string& text, std::string& error);
    std::string toText() const;
    bool load(const std::string& path, std::string& error);
    bool save(const std::string& path, std::string& error) const;   // ghi file tạm rồi đổi tên

    const std::vector<Account>& all() const { return accounts_; }
    const Account* find(const std::string& username) const;
    const Account* findByEmail(const std::string& email) const;
    const Account* findByPhone(const std::string& phone) const;
    // Tên đăng nhập, email hoặc số điện thoại -> tài khoản (thử theo thứ tự đó)
    const Account* resolve(const std::string& identifier) const;
    bool emailTaken(const std::string& email, const std::string& exceptUser = "") const;
    bool phoneTaken(const std::string& phone, const std::string& exceptUser = "") const;

    // Thêm / sửa / xoá. Trả về chuỗi lỗi, rỗng nếu thành công.
    std::string add(const std::string& username, Role role, const std::string& password, const std::string& link,
                    const std::string& displayName);
    std::string create(const NewAccount& n);   // đủ hồ sơ; kiểm tra trùng email / SĐT
    std::string update(const std::string& username, Role role, const std::string& link, const std::string& displayName);
    std::string updateProfile(const std::string& username, const std::string& displayName, const std::string& email,
                              const std::string& phone);
    std::string setShipperInfo(const std::string& username, int vehicle, double capacity, const std::string& plate);
    std::string setStatus(const std::string& username, Status st, const std::string& reason);
    std::string setPassword(const std::string& username, const std::string& password);
    std::string setLink(const std::string& username, const std::string& link);
    void setReady(const std::string& username, bool ready);
    void setHome(const std::string& username, int node);
    void touchLogin(const std::string& username, int64_t now);
    void addDelivered(const std::string& username, long long fee);   // khách: +1 đơn đã giao, +cước
    std::string remove(const std::string& username);   // không cho xoá quản trị viên cuối cùng
    bool verify(const std::string& username, const std::string& password) const;
    int adminCount() const;
    int count(Role r) const;
    // Tên shipper đổi / shipper bị xoá: cập nhật liên kết của các tài khoản shipper
    void renameLink(const std::string& oldName, const std::string& newName);

private:
    std::vector<Account> accounts_;
    std::unordered_map<std::string, size_t> index_;   // tên đăng nhập -> vị trí
    void reindex();
    Account* mut(const std::string& username);
};

struct SessionMeta {
    bool remember = false;
    std::string device, ip;
};
struct SessionInfo {
    std::string sid, device, ip;
    int64_t created = 0, lastSeen = 0;
    bool remember = false, current = false;
};

class SessionStore {
public:
    // now: số giây (đồng hồ hệ thống) — truyền vào để kiểm thử được
    std::string create(const std::string& username, int64_t now, const SessionMeta& meta = SessionMeta());
    // Trả về tên đăng nhập, rỗng nếu mã phiên sai / hết hạn. Gia hạn phiên khi dùng.
    std::string resolve(const std::string& token, int64_t now);
    std::string csrf(const std::string& token) const;              // mã CSRF của phiên ("" nếu không có)
    void remove(const std::string& token);
    void revokeUser(const std::string& username);   // đăng xuất mọi phiên của tài khoản
    int revokeOthers(const std::string& username, const std::string& keepToken);
    bool revokeSid(const std::string& username, const std::string& sid);   // đăng xuất một thiết bị
    std::vector<SessionInfo> list(const std::string& username, const std::string& currentToken) const;
    void renameUser(const std::string& oldName, const std::string& newName);
    static std::string sidOf(const std::string& token);
    size_t size() const { return sessions_.size(); }

private:
    struct Session { std::string username, csrf; int64_t expires, created, lastSeen; SessionMeta meta; };
    std::unordered_map<std::string, Session> sessions_;
    static int64_t ttl(const SessionMeta& m) { return m.remember ? int64_t(REMEMBER_DAYS) * 86400 : int64_t(SESSION_MINUTES) * 60; }
};

class LoginGuard {
public:
    // Còn bị khoá thì trả về số giây phải chờ (> 0)
    int lockedFor(const std::string& username, int64_t now) const;
    void failed(const std::string& username, int64_t now);
    void succeeded(const std::string& username);
    int failures(const std::string& username) const;

private:
    struct Entry { int fails = 0; int64_t until = 0; int level = 0; int64_t last = 0; };
    std::map<std::string, Entry> entries_;
};

// Giới hạn số lần trong một khoảng thời gian theo khoá (IP, tài khoản...)
class RateLimiter {
public:
    // Ghi nhận một lần và trả về true nếu chưa vượt giới hạn (tối đa `limit` lần trong `windowSeconds` giây)
    bool allow(const std::string& key, int64_t now, int limit, int windowSeconds);
    int used(const std::string& key, int64_t now, int windowSeconds) const;
    int retryAfter(const std::string& key, int64_t now, int windowSeconds) const;   // giây còn phải chờ
private:
    std::map<std::string, std::vector<int64_t>> hits_;
};

// Mã đặt lại mật khẩu: chỉ lưu băm; một lần dùng; hết hạn; giới hạn số lần thử
class ResetStore {
public:
    enum Result { OK, BAD, EXPIRED, USED, TOO_MANY, NONE };
    std::string issue(const std::string& username, int64_t now);            // trả về OTP 6 số (gửi qua email giả lập)
    Result verify(const std::string& username, const std::string& otp, int64_t now);   // đúng thì đánh dấu đã dùng
    void invalidate(const std::string& username);
    bool pending(const std::string& username, int64_t now) const;

private:
    struct Entry { std::string salt, hash; int64_t expires = 0; int tries = 0; bool used = false; };
    std::map<std::string, Entry> entries_;
};

// ============================== Bảng phân quyền API ==============================
// path là đường dẫn sau "/api/" (vd "dispatch/apply"). Mỗi API PHẢI có đúng một quy tắc; không có quy tắc = từ chối.
enum RoleBit : unsigned { B_ADMIN = 1, B_SHIPPER = 2, B_CUSTOMER = 4, B_GUEST = 16 };
const unsigned B_STAFF = B_ADMIN;   // nhân viên vận hành = quản trị viên
const unsigned B_USERS = B_ADMIN | B_SHIPPER | B_CUSTOMER;   // mọi người đã đăng nhập
struct Rule {
    const char* method;
    const char* path;
    unsigned roles;           // tập RoleBit được gọi
    const char* group;        // nhóm chức năng (để lập bảng ma trận)
    const char* what;         // mô tả ngắn
};
const std::vector<Rule>& rules();
const Rule* findRule(const std::string& method, const std::string& path);
unsigned roleBit(Role r);
// Trả về true nếu không cần đăng nhập (khách vãng lai gọi được).
bool isPublic(const std::string& method, const std::string& path);
bool canAccess(Role role, const std::string& method, const std::string& path);
std::string matrixMarkdown();   // bảng ma trận quyền dạng Markdown (đưa vào README)

}  // namespace Auth
