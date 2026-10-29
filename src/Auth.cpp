#include "Auth.h"

#include <algorithm>
#include <cstdio>
#include <fstream>
#include <random>
#include <set>
#include <sstream>

namespace Auth {

// ================================ Vai trò ===================================
const char* roleKey(Role r) {
    switch (r) {
        case ADMIN: return "admin";
        case SHIPPER: return "shipper";
        default: return "customer";
    }
}
const char* roleName(Role r) {
    switch (r) {
        case ADMIN: return "Quản trị viên";
        case SHIPPER: return "Shipper";
        default: return "Khách hàng";
    }
}
bool roleFromKey(const std::string& s, Role& out) {
    if (s == "admin") out = ADMIN;
    else if (s == "shipper") out = SHIPPER;
    else if (s == "customer") out = CUSTOMER;
    else return false;
    return true;
}

const char* statusKey(Status s) {
    switch (s) {
        case PENDING: return "pending";
        case LOCKED: return "locked";
        case DISABLED: return "disabled";
        default: return "active";
    }
}
const char* statusName(Status s) {
    switch (s) {
        case PENDING: return "Chờ duyệt";
        case LOCKED: return "Bị khoá";
        case DISABLED: return "Vô hiệu hoá";
        default: return "Hoạt động";
    }
}
bool statusFromKey(const std::string& s, Status& out) {
    if (s == "active") out = ACTIVE;
    else if (s == "pending") out = PENDING;
    else if (s == "locked") out = LOCKED;
    else if (s == "disabled") out = DISABLED;
    else return false;
    return true;
}
bool statusTransitionAllowed(Status from, Status to) {
    switch (from) {
        case PENDING: return to == ACTIVE || to == DISABLED;               // duyệt / từ chối
        case ACTIVE: return to == LOCKED || to == DISABLED;
        case LOCKED: return to == ACTIVE || to == DISABLED;
        case DISABLED: return to == ACTIVE;
    }
    return false;
}

// ================================ SHA-256 ===================================
// Theo FIPS 180-4: đệm thông điệp tới bội số 512 bit, 64 vòng nén mỗi khối.
namespace {
const uint32_t K[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2};
inline uint32_t rotr(uint32_t x, int n) { return (x >> n) | (x << (32 - n)); }
}  // namespace

std::string sha256(const std::string& data) {
    uint32_t h[8] = {0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};
    std::string msg = data;
    uint64_t bits = static_cast<uint64_t>(data.size()) * 8;
    msg.push_back(static_cast<char>(0x80));
    while (msg.size() % 64 != 56) msg.push_back('\0');
    for (int i = 7; i >= 0; --i) msg.push_back(static_cast<char>((bits >> (i * 8)) & 0xff));
    uint32_t w[64];
    for (size_t off = 0; off < msg.size(); off += 64) {
        for (int i = 0; i < 16; ++i) {
            const unsigned char* p = reinterpret_cast<const unsigned char*>(msg.data() + off + i * 4);
            w[i] = (uint32_t(p[0]) << 24) | (uint32_t(p[1]) << 16) | (uint32_t(p[2]) << 8) | uint32_t(p[3]);
        }
        for (int i = 16; i < 64; ++i) {
            uint32_t s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
            uint32_t s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16] + s0 + w[i - 7] + s1;
        }
        uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
        for (int i = 0; i < 64; ++i) {
            uint32_t S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            uint32_t ch = (e & f) ^ (~e & g);
            uint32_t t1 = hh + S1 + ch + K[i] + w[i];
            uint32_t S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
            uint32_t t2 = S0 + maj;
            hh = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
        }
        h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
    }
    char out[65];
    for (int i = 0; i < 8; ++i) std::snprintf(out + i * 8, 9, "%08x", h[i]);
    return std::string(out, 64);
}

std::string hashPassword(const std::string& salt, const std::string& password) {
    std::string h = sha256(salt + ":" + password);
    for (int i = 1; i < HASH_ROUNDS; ++i) h = sha256(h + salt);
    return h;
}

std::string randomHex(size_t bytes) {
    static std::random_device rd;
    static const char* hex = "0123456789abcdef";
    std::string s;
    for (size_t i = 0; i < bytes; ++i) {
        unsigned v = rd() & 0xff;
        s.push_back(hex[v >> 4]);
        s.push_back(hex[v & 15]);
    }
    return s;
}


std::string randomDigits(size_t n) {
    static std::random_device rd;
    std::string s;
    while (s.size() < n) {
        unsigned v = rd();
        if (v >= 4294967290u) continue;   // bỏ vùng cuối để không lệch khi lấy phần dư
        s.push_back(static_cast<char>('0' + v % 10));
    }
    return s;
}

namespace {
// So sánh không phụ thuộc vị trí ký tự khác đầu tiên (tránh đo thời gian để đoán băm)
bool sameText(const std::string& a, const std::string& b) {
    if (a.size() != b.size()) return false;
    unsigned char diff = 0;
    for (size_t i = 0; i < a.size(); ++i) diff |= static_cast<unsigned char>(a[i] ^ b[i]);
    return diff == 0;
}
std::string toField(const std::string& s) {
    if (s.empty()) return "-";
    std::string r = s;
    for (char& c : r) if (c == ' ' || c == '\t' || c == '#' || c == '\n' || c == '\r') c = '_';
    return r;
}
std::string fromField(const std::string& s) {
    if (s == "-") return "";
    std::string r = s;
    for (char& c : r) if (c == '_') c = ' ';
    return r;
}
size_t utf8Length(const std::string& s) {
    return std::count_if(s.begin(), s.end(), [](char c) { return (static_cast<unsigned char>(c) & 0xC0) != 0x80; });
}
std::string lower(std::string s) {
    for (char& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}
std::string trimCopy(const std::string& s) {
    size_t b = s.find_first_not_of(" \t\r\n");
    if (b == std::string::npos) return "";
    return s.substr(b, s.find_last_not_of(" \t\r\n") - b + 1);
}
}  // namespace

// ============================ Kiểm tra dữ liệu ==============================
namespace {
std::string usernameFormat(const std::string& u) {
    if (u.size() < 3 || u.size() > 20) return "Tên đăng nhập dài 3–20 ký tự";
    for (char c : u)
        if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '.'))
            return "Tên đăng nhập chỉ gồm chữ thường không dấu, số, '_' và '.'";
    return "";
}
}  // namespace
std::string checkUsername(const std::string& u) {
    std::string e = usernameFormat(u);
    if (!e.empty()) return e;
    if (validPhone(u)) return "Tên đăng nhập không được giống số điện thoại";
    return "";
}
std::string checkPassword(const std::string& p) {
    if (p.size() < MIN_PASSWORD) return "Mật khẩu cần ít nhất " + std::to_string(MIN_PASSWORD) + " ký tự";
    if (p.size() > 128) return "Mật khẩu quá dài";
    bool letter = false, digit = false;
    for (char c : p) {
        if (c >= '0' && c <= '9') digit = true;
        else if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) letter = true;
    }
    if (!letter || !digit) return "Mật khẩu cần có cả chữ và số";
    return "";
}

bool isCommonPassword(const std::string& p) {
    static const std::set<std::string> common = {
        "password", "password1", "password12", "password123", "passw0rd", "p@ssw0rd", "qwerty123", "qwerty1234", "qwertyuiop1",
        "abc12345", "abcd1234", "abc123456", "abcdefg1", "admin123", "admin1234", "admin12345", "administrator1", "welcome1",
        "welcome123", "letmein123", "iloveyou1", "iloveyou123", "monkey123", "dragon123", "football1", "baseball1",
        "12345678a", "123456789a", "1234567890a", "a12345678", "a123456789", "aa123456", "aa12345678", "matkhau123",
        "matkhau1234", "dieuphoi123", "shipper123", "khach123", "khachhang123", "giaohang123", "vietnam123", "hanoi12345",
        "saigon12345", "hcm123456", "test1234", "test12345", "user1234", "login123", "master123", "changeme1", "changeme123",
        "zaq12wsx", "1q2w3e4r", "1qaz2wsx", "q1w2e3r4", "asdf1234", "asdfghjkl1", "zxcvbnm123", "trustno1", "sunshine1",
    };
    return common.count(lower(p)) > 0;
}

std::string checkPasswordStrong(const std::string& p, const std::string& username) {
    if (p.size() < MIN_PASSWORD_STRONG) return "Mật khẩu cần ít nhất " + std::to_string(MIN_PASSWORD_STRONG) + " ký tự";
    if (p.size() > 128) return "Mật khẩu quá dài (tối đa 128 ký tự)";
    bool up = false, lo = false, dg = false;
    for (unsigned char c : p) {
        if (c >= 'A' && c <= 'Z') up = true;
        else if (c >= 'a' && c <= 'z') lo = true;
        else if (c >= '0' && c <= '9') dg = true;
        else if (c < 0x20 || c == 0x7f) return "Mật khẩu chứa ký tự không hợp lệ";
    }
    if (!up || !lo || !dg) return "Mật khẩu cần có chữ hoa, chữ thường và chữ số";
    if (isCommonPassword(p)) return "Mật khẩu này quá phổ biến, hãy chọn mật khẩu khác";
    if (!username.empty() && lower(p).find(lower(username)) != std::string::npos && username.size() >= 3)
        return "Mật khẩu không được chứa tên đăng nhập";
    return "";
}

std::string normalizeEmail(const std::string& e) { return lower(trimCopy(e)); }
std::string normalizePhone(const std::string& p) {
    std::string r;
    for (char c : p) if (c != ' ' && c != '.' && c != '-') r.push_back(c);
    return r;
}

std::string checkEmail(const std::string& e) {
    if (e.empty() || e.size() > 80) return "Email không hợp lệ (tối đa 80 ký tự)";
    size_t at = e.find('@');
    if (at == std::string::npos || at == 0 || at != e.rfind('@') || at > 64) return "Email không hợp lệ";
    for (size_t i = 0; i < at; ++i) {
        char c = e[i];
        if (!(std::isalnum(static_cast<unsigned char>(c)) || c == '.' || c == '_' || c == '%' || c == '+' || c == '-')) return "Email không hợp lệ";
    }
    if (e[0] == '.' || e[at - 1] == '.' || e.find("..") != std::string::npos) return "Email không hợp lệ";
    std::string dom = e.substr(at + 1);
    size_t dot = dom.rfind('.');
    if (dom.empty() || dot == std::string::npos || dot == 0 || dot + 3 > dom.size()) return "Email không hợp lệ";
    for (char c : dom)
        if (!(std::isalnum(static_cast<unsigned char>(c)) || c == '.' || c == '-')) return "Email không hợp lệ";
    if (dom.front() == '-' || dom.front() == '.' || dom.back() == '.' || dom.find("..") != std::string::npos) return "Email không hợp lệ";
    for (size_t i = dot + 1; i < dom.size(); ++i)
        if (!std::isalpha(static_cast<unsigned char>(dom[i]))) return "Email không hợp lệ";
    return "";
}

std::string checkPhone(const std::string& p) {
    if (!validPhone(p)) return "Số điện thoại phải gồm 10 chữ số, bắt đầu bằng 0";
    return "";
}

std::string checkDisplayName(const std::string& n) {
    size_t len = utf8Length(n);
    if (len < 2) return "Họ tên / tên doanh nghiệp cần ít nhất 2 ký tự";
    if (len > 40) return "Họ tên / tên doanh nghiệp tối đa 40 ký tự";
    for (unsigned char c : n) {
        if (c < 0x20 || c == 0x7f || c == '<' || c == '>' || c == '=' || c == '#' || c == '_')
            return "Họ tên / tên doanh nghiệp không được chứa các ký tự < > = # _ hoặc ký tự điều khiển";
    }
    if (trimCopy(n) != n) return "Họ tên / tên doanh nghiệp không được bắt đầu hoặc kết thúc bằng khoảng trắng";
    return "";
}

std::string checkPlate(const std::string& p) {
    if (p.size() < 4 || p.size() > 12) return "Biển số xe dài 4–12 ký tự (ví dụ 59A1-123.45)";
    for (char c : p)
        if (!((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '.'))
            return "Biển số xe chỉ gồm chữ in hoa, số, '-' và '.'";
    return "";
}

// ============================= Kho tài khoản ================================
void AccountStore::reindex() {
    index_.clear();
    for (size_t i = 0; i < accounts_.size(); ++i) index_[accounts_[i].username] = i;
}

Account* AccountStore::mut(const std::string& username) {
    auto it = index_.find(username);
    return it == index_.end() ? nullptr : &accounts_[it->second];
}

namespace {
const std::set<std::string>& accountKeys() {
    static const std::set<std::string> k = {"status", "ly_do", "email", "sdt", "tao", "dn", "xe", "tai", "bien", "sansang", "vitri", "done", "chi"};
    return k;
}
}  // namespace

bool AccountStore::loadText(const std::string& text, std::string& error) {
    std::vector<Account> out;
    std::set<std::string> seen;
    std::istringstream in(text);
    std::string line;
    int no = 0;
    while (std::getline(in, line)) {
        ++no;
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (no == 1 && line.rfind("\xEF\xBB\xBF", 0) == 0) line.erase(0, 3);
        size_t first = line.find_first_not_of(" \t");
        if (first == std::string::npos || line[first] == '#') continue;
        std::istringstream ss(line);
        Account a;
        std::string role, link, name;
        if (!(ss >> a.username >> role >> a.salt >> a.hash >> link)) {
            error = "Dong " + std::to_string(no) + ": can '<ten> <vai_tro> <salt> <bam> <lien_ket> [khoa=gia_tri] <ten_hien_thi>'";
            return false;
        }
        // Các trường mở rộng khoá=giá_trị (tuỳ chọn), phần còn lại của dòng là tên hiển thị
        std::string rest;
        std::getline(ss, rest);
        rest = trimCopy(rest);
        while (!rest.empty()) {
            size_t sp = rest.find(' ');
            std::string tok = rest.substr(0, sp);
            size_t eq = tok.find('=');
            if (eq == std::string::npos || !accountKeys().count(tok.substr(0, eq))) break;
            std::string key = tok.substr(0, eq), val = tok.substr(eq + 1);
            try {
                if (key == "status") {
                    if (!statusFromKey(val, a.status)) throw std::invalid_argument("status");
                } else if (key == "ly_do") a.statusReason = fromField(val);
                else if (key == "email") a.email = val;
                else if (key == "sdt") a.phone = val;
                else if (key == "tao") a.createdAt = std::stoll(val);
                else if (key == "dn") a.lastLogin = std::stoll(val);
                else if (key == "xe") a.vehicle = std::stoi(val);
                else if (key == "tai") a.capacity = std::stod(val);
                else if (key == "bien") a.plate = val;
                else if (key == "sansang") a.ready = val != "0";
                else if (key == "vitri") a.home = std::stoi(val);
                else if (key == "done") a.done = std::stoi(val);
                else if (key == "chi") a.spent = std::stoll(val);
            } catch (...) {
                error = "Dong " + std::to_string(no) + ": gia tri '" + tok + "' khong hop le";
                return false;
            }
            rest = sp == std::string::npos ? "" : trimCopy(rest.substr(sp + 1));
        }
        name = rest;
        size_t s = name.find_first_not_of(" \t");
        name = s == std::string::npos ? "" : name.substr(s);
        if (role == "dispatcher") {   // file cũ: vai trò điều phối viên đã bỏ -> giữ tài khoản nhưng khoá, quản trị viên quyết định đổi vai trò hay xoá
            a.role = ADMIN;
            a.status = LOCKED;
            if (a.statusReason.empty()) a.statusReason = "Vai trò điều phối viên đã bị bỏ, quản trị viên cần chọn lại vai trò";
        } else if (!roleFromKey(role, a.role)) {
            error = "Dong " + std::to_string(no) + ": vai tro '" + role + "' khong hop le (admin / shipper / customer)";
            return false;
        }
        if (!usernameFormat(a.username).empty()) {
            error = "Dong " + std::to_string(no) + ": ten dang nhap '" + a.username + "' khong hop le";
            return false;
        }
        if (a.hash.size() != 64 || a.hash.find_first_not_of("0123456789abcdef") != std::string::npos) {
            error = "Dong " + std::to_string(no) + ": ma bam phai la 64 ky tu hex";
            return false;
        }
        if (!seen.insert(a.username).second) {
            error = "Dong " + std::to_string(no) + ": trung ten dang nhap " + a.username;
            return false;
        }
        a.link = fromField(link);
        a.displayName = fromField(name);
        if (a.displayName.empty()) a.displayName = a.username;
        a.email = normalizeEmail(a.email);
        out.push_back(a);
    }
    accounts_ = std::move(out);
    reindex();
    return true;
}

std::string AccountStore::toText() const {
    std::ostringstream out;
    out << "# Tai khoan dang nhap (mat khau chi luu ban bam SHA-256 co muoi, " << HASH_ROUNDS << " vong)\n";
    out << "# ten_dang_nhap  vai_tro(admin/shipper/customer)  salt  bam  lien_ket(ten shipper, '-' neu khong)  [khoa=gia_tri ...]  ten_hien_thi\n";
    out << "# khoa tuy chon: status ly_do email sdt tao(giay) dn(giay) xe tai bien sansang vitri done chi\n";
    for (const Account& a : accounts_) {
        out << a.username << ' ' << roleKey(a.role) << ' ' << a.salt << ' ' << a.hash << ' ' << toField(a.link);
        if (a.status != ACTIVE) out << " status=" << statusKey(a.status);
        if (!a.statusReason.empty()) out << " ly_do=" << toField(a.statusReason);
        if (!a.email.empty()) out << " email=" << a.email;
        if (!a.phone.empty()) out << " sdt=" << a.phone;
        if (a.createdAt) out << " tao=" << a.createdAt;
        if (a.lastLogin) out << " dn=" << a.lastLogin;
        if (a.vehicle >= 0) out << " xe=" << a.vehicle;
        if (a.capacity > 0) out << " tai=" << a.capacity;
        if (!a.plate.empty()) out << " bien=" << a.plate;
        if (!a.ready) out << " sansang=0";
        if (a.home >= 0) out << " vitri=" << a.home;
        if (a.done) out << " done=" << a.done;
        if (a.spent) out << " chi=" << a.spent;
        std::string name = toField(a.displayName);
        for (char& c : name) if (c == '=') c = '-';
        out << ' ' << name << '\n';
    }
    return out.str();
}

bool AccountStore::load(const std::string& path, std::string& error) {
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        error = "Khong mo duoc file: " + path;
        return false;
    }
    std::ostringstream ss;
    ss << in.rdbuf();
    return loadText(ss.str(), error);
}

bool AccountStore::save(const std::string& path, std::string& error) const {
    std::string tmp = path + ".tmp";
    {
        std::ofstream out(tmp, std::ios::binary);
        if (!out) {
            error = "Khong ghi duoc file: " + tmp;
            return false;
        }
        out << toText();
        if (!out) {
            error = "Loi khi ghi file: " + tmp;
            return false;
        }
    }
    std::remove(path.c_str());
    if (std::rename(tmp.c_str(), path.c_str()) != 0) {
        error = "Khong doi ten duoc file: " + tmp;
        return false;
    }
    return true;
}

const Account* AccountStore::find(const std::string& username) const {
    auto it = index_.find(username);
    return it == index_.end() ? nullptr : &accounts_[it->second];
}
const Account* AccountStore::findByEmail(const std::string& email) const {
    std::string e = normalizeEmail(email);
    if (e.empty()) return nullptr;
    for (const Account& a : accounts_) if (a.email == e) return &a;
    return nullptr;
}
const Account* AccountStore::findByPhone(const std::string& phone) const {
    std::string p = normalizePhone(phone);
    if (p.empty()) return nullptr;
    for (const Account& a : accounts_) if (a.phone == p) return &a;
    return nullptr;
}
const Account* AccountStore::resolve(const std::string& identifier) const {
    std::string id = lower(trimCopy(identifier));
    if (id.empty()) return nullptr;
    if (const Account* a = find(id)) return a;
    if (id.find('@') != std::string::npos) return findByEmail(id);
    return findByPhone(id);
}
bool AccountStore::emailTaken(const std::string& email, const std::string& exceptUser) const {
    const Account* a = findByEmail(email);
    return a && a->username != exceptUser;
}
bool AccountStore::phoneTaken(const std::string& phone, const std::string& exceptUser) const {
    const Account* a = findByPhone(phone);
    return a && a->username != exceptUser;
}

int AccountStore::adminCount() const {
    return static_cast<int>(std::count_if(accounts_.begin(), accounts_.end(), [](const Account& a) { return a.role == ADMIN; }));
}
int AccountStore::count(Role r) const {
    return static_cast<int>(std::count_if(accounts_.begin(), accounts_.end(), [r](const Account& a) { return a.role == r; }));
}

std::string AccountStore::add(const std::string& username, Role role, const std::string& password, const std::string& link,
                              const std::string& displayName) {
    std::string e = checkUsername(username);
    if (!e.empty()) return e;
    if (find(username)) return "Tên đăng nhập '" + username + "' đã có";
    e = checkPassword(password);
    if (!e.empty()) return e;
    if (role == SHIPPER && link.empty()) return "Tài khoản shipper phải gắn với một shipper trong đội xe";
    if (utf8Length(displayName) > 40) return "Tên hiển thị tối đa 40 ký tự";
    Account a;
    a.username = username;
    a.role = role;
    a.salt = randomHex(8);
    a.hash = hashPassword(a.salt, password);
    a.link = role == SHIPPER ? link : "";
    a.displayName = displayName.empty() ? username : displayName;
    accounts_.push_back(a);
    reindex();
    return "";
}

std::string AccountStore::create(const NewAccount& n) {
    std::string e = checkUsername(n.username);
    if (!e.empty()) return e;
    if (find(n.username)) return "Tên đăng nhập '" + n.username + "' đã có";
    e = checkPassword(n.password);
    if (!e.empty()) return e;
    e = checkDisplayName(n.displayName);
    if (!e.empty()) return e;
    std::string email = normalizeEmail(n.email), phone = normalizePhone(n.phone);
    if (!email.empty()) {
        e = checkEmail(email);
        if (!e.empty()) return e;
        if (emailTaken(email)) return "Email này đã được dùng cho tài khoản khác";
    }
    if (!phone.empty()) {
        e = checkPhone(phone);
        if (!e.empty()) return e;
        if (phoneTaken(phone)) return "Số điện thoại này đã được dùng cho tài khoản khác";
    }
    if (n.role == SHIPPER && n.status == ACTIVE && n.link.empty()) return "Tài khoản shipper phải gắn với một shipper trong đội xe";
    Account a;
    a.username = n.username;
    a.role = n.role;
    a.salt = randomHex(8);
    a.hash = hashPassword(a.salt, n.password);
    a.link = n.role == SHIPPER ? n.link : "";
    a.displayName = n.displayName;
    a.status = n.status;
    a.email = email;
    a.phone = phone;
    a.createdAt = n.createdAt;
    a.vehicle = n.role == SHIPPER ? n.vehicle : -1;
    a.capacity = n.role == SHIPPER ? n.capacity : 0;
    a.plate = n.role == SHIPPER ? n.plate : "";
    accounts_.push_back(a);
    reindex();
    return "";
}

std::string AccountStore::update(const std::string& username, Role role, const std::string& link,
                                 const std::string& displayName) {
    Account* a = mut(username);
    if (!a) return "Không có tài khoản '" + username + "'";
    if (a->role == ADMIN && role != ADMIN && adminCount() == 1) return "Phải còn ít nhất một quản trị viên";
    if (role == SHIPPER && link.empty() && a->status == ACTIVE) return "Tài khoản shipper phải gắn với một shipper trong đội xe";
    if (utf8Length(displayName) > 40) return "Tên hiển thị tối đa 40 ký tự";
    a->role = role;
    a->link = role == SHIPPER ? link : "";
    a->displayName = displayName.empty() ? username : displayName;
    return "";
}

std::string AccountStore::updateProfile(const std::string& username, const std::string& displayName, const std::string& email0,
                                        const std::string& phone0) {
    Account* a = mut(username);
    if (!a) return "Không có tài khoản '" + username + "'";
    std::string e = checkDisplayName(displayName);
    if (!e.empty()) return e;
    std::string email = normalizeEmail(email0), phone = normalizePhone(phone0);
    if (!email.empty()) {
        e = checkEmail(email);
        if (!e.empty()) return e;
        if (emailTaken(email, username)) return "Email này đã được dùng cho tài khoản khác";
    }
    if (!phone.empty()) {
        e = checkPhone(phone);
        if (!e.empty()) return e;
        if (phoneTaken(phone, username)) return "Số điện thoại này đã được dùng cho tài khoản khác";
    }
    a->displayName = displayName;
    a->email = email;
    a->phone = phone;
    return "";
}

std::string AccountStore::setShipperInfo(const std::string& username, int vehicle, double capacity, const std::string& plate) {
    Account* a = mut(username);
    if (!a || a->role != SHIPPER) return "Không có tài khoản shipper '" + username + "'";
    if (vehicle < 0 || vehicle > 2) return "Loại xe không hợp lệ";
    if (!(capacity > 0) || capacity > 5000) return "Tải trọng phải từ 0 đến 5000 kg";
    std::string e = checkPlate(plate);
    if (!e.empty()) return e;
    a->vehicle = vehicle;
    a->capacity = capacity;
    a->plate = plate;
    return "";
}

std::string AccountStore::setStatus(const std::string& username, Status st, const std::string& reason) {
    Account* a = mut(username);
    if (!a) return "Không có tài khoản '" + username + "'";
    if (a->status == st) return "Tài khoản đã ở trạng thái " + std::string(statusName(st));
    if (!statusTransitionAllowed(a->status, st))
        return std::string("Không thể chuyển từ '") + statusName(a->status) + "' sang '" + statusName(st) + "'";
    if ((st == LOCKED || st == DISABLED) && trimCopy(reason).empty()) return "Cần nhập lý do khi khoá / vô hiệu hoá / từ chối tài khoản";
    if (utf8Length(reason) > 120) return "Lý do tối đa 120 ký tự";
    if (a->role == ADMIN && st != ACTIVE && st != PENDING) {
        int active = 0;
        for (const Account& x : accounts_) if (x.role == ADMIN && x.status == ACTIVE) ++active;
        if (active <= 1) return "Phải còn ít nhất một quản trị viên đang hoạt động";
    }
    a->status = st;
    a->statusReason = (st == LOCKED || st == DISABLED) ? trimCopy(reason) : "";
    return "";
}

std::string AccountStore::setPassword(const std::string& username, const std::string& password) {
    Account* a = mut(username);
    if (!a) return "Không có tài khoản '" + username + "'";
    std::string e = checkPassword(password);
    if (!e.empty()) return e;
    a->salt = randomHex(8);
    a->hash = hashPassword(a->salt, password);
    return "";
}

std::string AccountStore::setLink(const std::string& username, const std::string& link) {
    Account* a = mut(username);
    if (!a) return "Không có tài khoản '" + username + "'";
    a->link = link;
    return "";
}

void AccountStore::setReady(const std::string& username, bool ready) {
    if (Account* a = mut(username)) a->ready = ready;
}
void AccountStore::setHome(const std::string& username, int node) {
    if (Account* a = mut(username)) a->home = node;
}
void AccountStore::touchLogin(const std::string& username, int64_t now) {
    if (Account* a = mut(username)) a->lastLogin = now;
}
void AccountStore::addDelivered(const std::string& username, long long fee) {
    if (Account* a = mut(username)) {
        a->done += 1;
        a->spent += fee;
    }
}

std::string AccountStore::remove(const std::string& username) {
    auto it = index_.find(username);
    if (it == index_.end()) return "Không có tài khoản '" + username + "'";
    if (accounts_[it->second].role == ADMIN && adminCount() == 1) return "Không xoá được quản trị viên cuối cùng";
    accounts_.erase(accounts_.begin() + it->second);
    reindex();
    return "";
}

bool AccountStore::verify(const std::string& username, const std::string& password) const {
    const Account* a = find(username);
    if (!a) {
        hashPassword("00000000", password);   // tốn thời gian như nhau dù tài khoản không tồn tại
        return false;
    }
    return sameText(hashPassword(a->salt, password), a->hash);
}

void AccountStore::renameLink(const std::string& oldName, const std::string& newName) {
    for (Account& a : accounts_)
        if (a.role == SHIPPER && a.link == oldName) a.link = newName;
}

// ================================ Phiên =====================================
std::string SessionStore::sidOf(const std::string& token) { return sha256("sid:" + token).substr(0, 12); }

std::string SessionStore::create(const std::string& username, int64_t now, const SessionMeta& meta) {
    // Dọn phiên hết hạn
    for (auto it = sessions_.begin(); it != sessions_.end();)
        it = it->second.expires <= now ? sessions_.erase(it) : std::next(it);
    std::string token = randomHex(16);
    Session s;
    s.username = username;
    s.csrf = randomHex(16);
    s.expires = now + ttl(meta);
    s.created = s.lastSeen = now;
    s.meta = meta;
    sessions_[token] = s;
    return token;
}

std::string SessionStore::resolve(const std::string& token, int64_t now) {
    auto it = sessions_.find(token);
    if (it == sessions_.end()) return "";
    if (it->second.expires <= now) {
        sessions_.erase(it);
        return "";
    }
    it->second.expires = now + ttl(it->second.meta);
    it->second.lastSeen = now;
    return it->second.username;
}

std::string SessionStore::csrf(const std::string& token) const {
    auto it = sessions_.find(token);
    return it == sessions_.end() ? "" : it->second.csrf;
}

void SessionStore::remove(const std::string& token) { sessions_.erase(token); }

void SessionStore::revokeUser(const std::string& username) {
    for (auto it = sessions_.begin(); it != sessions_.end();)
        it = it->second.username == username ? sessions_.erase(it) : std::next(it);
}

int SessionStore::revokeOthers(const std::string& username, const std::string& keepToken) {
    int n = 0;
    for (auto it = sessions_.begin(); it != sessions_.end();) {
        if (it->second.username == username && it->first != keepToken) { it = sessions_.erase(it); ++n; }
        else ++it;
    }
    return n;
}

bool SessionStore::revokeSid(const std::string& username, const std::string& sid) {
    for (auto it = sessions_.begin(); it != sessions_.end(); ++it)
        if (it->second.username == username && sidOf(it->first) == sid) {
            sessions_.erase(it);
            return true;
        }
    return false;
}

std::vector<SessionInfo> SessionStore::list(const std::string& username, const std::string& currentToken) const {
    std::vector<SessionInfo> out;
    for (const auto& kv : sessions_) {
        if (kv.second.username != username) continue;
        SessionInfo i;
        i.sid = sidOf(kv.first);
        i.device = kv.second.meta.device;
        i.ip = kv.second.meta.ip;
        i.created = kv.second.created;
        i.lastSeen = kv.second.lastSeen;
        i.remember = kv.second.meta.remember;
        i.current = kv.first == currentToken;
        out.push_back(i);
    }
    std::sort(out.begin(), out.end(), [](const SessionInfo& a, const SessionInfo& b) {
        if (a.current != b.current) return a.current;
        if (a.lastSeen != b.lastSeen) return a.lastSeen > b.lastSeen;
        return a.sid < b.sid;
    });
    return out;
}

void SessionStore::renameUser(const std::string& oldName, const std::string& newName) {
    for (auto& kv : sessions_)
        if (kv.second.username == oldName) kv.second.username = newName;
}

// ============================ Chống dò mật khẩu =============================
int LoginGuard::lockedFor(const std::string& username, int64_t now) const {
    auto it = entries_.find(username);
    if (it == entries_.end() || it->second.until <= now) return 0;
    return static_cast<int>(it->second.until - now);
}
void LoginGuard::failed(const std::string& username, int64_t now) {
    Entry& e = entries_[username];
    if (e.last && now - e.last > 3600) e = Entry{};          // một giờ yên tĩnh: bắt đầu lại từ đầu
    if (e.until && e.until <= now) { e.fails = 0; e.until = 0; }   // hết khoá: đếm lại số lần, nhớ mức khoá
    e.last = now;
    if (++e.fails >= LOCK_AFTER) {
        int64_t secs = int64_t(LOCK_SECONDS) << std::min(e.level, 4);   // 60, 120, 240, 480, 900 (tối đa)
        e.until = now + std::min<int64_t>(secs, MAX_LOCK_SECONDS);
        ++e.level;
    }
}
void LoginGuard::succeeded(const std::string& username) { entries_.erase(username); }
int LoginGuard::failures(const std::string& username) const {
    auto it = entries_.find(username);
    return it == entries_.end() ? 0 : it->second.fails;
}

bool RateLimiter::allow(const std::string& key, int64_t now, int limit, int windowSeconds) {
    auto& v = hits_[key];
    v.erase(std::remove_if(v.begin(), v.end(), [&](int64_t t) { return t <= now - windowSeconds; }), v.end());
    if (static_cast<int>(v.size()) >= limit) return false;
    v.push_back(now);
    if (hits_.size() > 5000) {   // dọn khoá cũ để bộ nhớ không phình mãi
        for (auto it = hits_.begin(); it != hits_.end();)
            it = (it->second.empty() || it->second.back() <= now - 7200) && it->first != key ? hits_.erase(it) : std::next(it);
    }
    return true;
}
int RateLimiter::used(const std::string& key, int64_t now, int windowSeconds) const {
    auto it = hits_.find(key);
    if (it == hits_.end()) return 0;
    return static_cast<int>(std::count_if(it->second.begin(), it->second.end(), [&](int64_t t) { return t > now - windowSeconds; }));
}
int RateLimiter::retryAfter(const std::string& key, int64_t now, int windowSeconds) const {
    auto it = hits_.find(key);
    if (it == hits_.end()) return 0;
    int64_t oldest = 0;
    for (int64_t t : it->second) if (t > now - windowSeconds && (oldest == 0 || t < oldest)) oldest = t;
    return oldest ? static_cast<int>(oldest + windowSeconds - now) : 0;
}

// ============================ Đặt lại mật khẩu ==============================
std::string ResetStore::issue(const std::string& username, int64_t now) {
    Entry e;
    std::string otp = randomDigits(6);
    e.salt = randomHex(8);
    e.hash = hashPassword(e.salt, otp);
    e.expires = now + RESET_MINUTES * 60;
    entries_[username] = e;
    return otp;
}
ResetStore::Result ResetStore::verify(const std::string& username, const std::string& otp, int64_t now) {
    auto it = entries_.find(username);
    if (it == entries_.end()) {
        hashPassword("00000000", otp);   // tốn thời gian như nhau dù chưa có mã
        return NONE;
    }
    Entry& e = it->second;
    if (e.used) return USED;
    if (e.expires <= now) return EXPIRED;
    if (e.tries >= RESET_MAX_TRIES) return TOO_MANY;
    ++e.tries;
    if (!sameText(hashPassword(e.salt, otp), e.hash)) return BAD;
    e.used = true;
    return OK;
}
void ResetStore::invalidate(const std::string& username) { entries_.erase(username); }
bool ResetStore::pending(const std::string& username, int64_t now) const {
    auto it = entries_.find(username);
    return it != entries_.end() && !it->second.used && it->second.expires > now;
}

// =============================== Phân quyền =================================
namespace {
const unsigned ALL5 = B_USERS | B_GUEST;          // kể cả khách vãng lai
const unsigned A = B_ADMIN, S = B_SHIPPER, C = B_CUSTOMER, ST = B_STAFF;

// Mỗi dòng: phương thức, đường dẫn sau /api/, tập vai trò, nhóm, mô tả.
// Muốn thêm API mới: thêm một dòng ở đây (server từ chối khởi động nếu có API chưa có quy tắc).
const std::vector<Rule> RULES = {
    // --- Tài khoản & phiên
    {"POST", "login", ALL5, "Tài khoản & phiên", "Đăng nhập (tên đăng nhập, email hoặc SĐT)"},
    {"POST", "logout", ALL5, "Tài khoản & phiên", "Đăng xuất"},
    {"GET", "me", ALL5, "Tài khoản & phiên", "Xem tài khoản đang đăng nhập"},
    {"POST", "register", ALL5, "Tài khoản & phiên", "Đăng ký khách hàng / shipper"},
    {"POST", "password/forgot", ALL5, "Tài khoản & phiên", "Yêu cầu mã đặt lại mật khẩu"},
    {"POST", "password/reset", ALL5, "Tài khoản & phiên", "Đặt lại mật khẩu bằng mã OTP"},
    {"GET", "mailbox", ALL5, "Tài khoản & phiên", "Hộp thư giả lập (chỉ khi bật chế độ demo)"},
    {"POST", "me/password", B_USERS, "Tài khoản & phiên", "Đổi mật khẩu"},
    {"GET", "profile", B_USERS, "Hồ sơ", "Xem hồ sơ cá nhân"},
    {"POST", "profile/update", B_USERS, "Hồ sơ", "Sửa tên, email, SĐT"},
    {"GET", "sessions", B_USERS, "Hồ sơ", "Xem các thiết bị đang đăng nhập"},
    {"POST", "sessions/revoke", B_USERS, "Hồ sơ", "Đăng xuất một thiết bị"},
    {"POST", "sessions/revoke-others", B_USERS, "Hồ sơ", "Đăng xuất mọi thiết bị khác"},
    {"GET", "addresses", C, "Hồ sơ", "Xem sổ địa chỉ"},
    {"POST", "addresses/add", C, "Hồ sơ", "Thêm địa chỉ"},
    {"POST", "addresses/update", C, "Hồ sơ", "Sửa địa chỉ"},
    {"POST", "addresses/remove", C, "Hồ sơ", "Xoá địa chỉ"},
    {"POST", "addresses/default", C, "Hồ sơ", "Đặt địa chỉ mặc định"},
    {"POST", "shipper/ready", S, "Hồ sơ", "Bật / tắt sẵn sàng nhận chuyến"},
    {"POST", "shipper/vehicle", S, "Hồ sơ", "Cập nhật thông tin xe"},
    {"POST", "shipper/location", S, "Hồ sơ", "Cập nhật vị trí đang đứng (để hệ thống chọn shipper gần nhất)"},
    {"GET", "shipper/stats", S | ST, "Hồ sơ", "Thống kê shipper (đúng hạn, đánh giá, thu nhập)"},
    // --- Quản lý tài khoản
    {"GET", "users", ST, "Quản lý tài khoản", "Danh sách tài khoản (tìm kiếm, lọc, phân trang)"},
    {"GET", "users/queue", ST, "Quản lý tài khoản", "Hàng chờ duyệt shipper (Min-Heap)"},
    {"POST", "users/add", A, "Quản lý tài khoản", "Tạo tài khoản"},
    {"POST", "users/update", A, "Quản lý tài khoản", "Sửa tài khoản, vai trò, đặt lại mật khẩu"},
    {"POST", "users/remove", A, "Quản lý tài khoản", "Xoá tài khoản"},
    {"POST", "users/status", ST, "Quản lý tài khoản", "Duyệt / từ chối / khoá / mở khoá tài khoản"},
    // --- Bản đồ & dữ liệu
    {"GET", "state", B_USERS, "Bản đồ & dữ liệu", "Trạng thái hệ thống (đã lọc theo vai trò)"},
    {"POST", "dataset", A, "Bản đồ & dữ liệu", "Mở bộ dữ liệu"},
    {"POST", "graph/new", A, "Bản đồ & dữ liệu", "Tạo bản đồ mới"},
    {"POST", "depot", A, "Bản đồ & dữ liệu", "Đổi kho"},
    {"POST", "undo", A, "Bản đồ & dữ liệu", "Hoàn tác (Undo)"},
    {"POST", "redo", A, "Bản đồ & dữ liệu", "Làm lại (Redo)"},
    {"POST", "traffic", ST, "Bản đồ & dữ liệu", "Báo kẹt xe / đóng đường"},
    {"POST", "traffic/clear", ST, "Bản đồ & dữ liệu", "Xoá mọi sự cố giao thông"},
    {"GET", "search", B_USERS, "Bản đồ & dữ liệu", "Tìm địa điểm (Trie)"},
    {"POST", "settings", ST, "Bản đồ & dữ liệu", "Giờ bắt đầu ca, bật / tắt giờ cao điểm"},
    {"GET", "print", A, "Bản đồ & dữ liệu", "In bản đồ dạng văn bản"},
    {"POST", "node/add", A, "Bản đồ & dữ liệu", "Thêm điểm"},
    {"POST", "node/update", A, "Bản đồ & dữ liệu", "Sửa điểm"},
    {"POST", "node/remove", A, "Bản đồ & dữ liệu", "Xoá điểm"},
    {"POST", "edge/add", A, "Bản đồ & dữ liệu", "Thêm đường"},
    {"POST", "edge/update", A, "Bản đồ & dữ liệu", "Sửa đường"},
    {"POST", "edge/remove", A, "Bản đồ & dữ liệu", "Xoá đường"},
    {"GET", "export/map", A, "Bản đồ & dữ liệu", "Tải map.txt"},
    {"GET", "export/orders", ST, "Bản đồ & dữ liệu", "Tải orders.txt"},
    {"GET", "export/shippers", ST, "Bản đồ & dữ liệu", "Tải shippers.txt"},
    {"POST", "import/map", A, "Bản đồ & dữ liệu", "Nhập map.txt"},
    {"POST", "import/orders", A, "Bản đồ & dữ liệu", "Nhập orders.txt"},
    {"POST", "import/shippers", A, "Bản đồ & dữ liệu", "Nhập shippers.txt"},
    {"POST", "save", A, "Bản đồ & dữ liệu", "Lưu bản đồ và đơn hàng"},
    {"GET", "benchmark", A, "Bản đồ & dữ liệu", "Đo hiệu năng thuật toán"},
    {"GET", "benchmark/p2p", A, "Bản đồ & dữ liệu", "Đo hiệu năng A* và Dijkstra"},
    // --- Tìm đường & phân tích (chỉ đọc)
    {"GET", "path", B_USERS, "Tìm đường (chỉ đọc)", "Đường đi ngắn nhất (Dijkstra, A*, Bellman-Ford, BFS)"},
    {"GET", "kpaths", B_USERS, "Tìm đường (chỉ đọc)", "K tuyến ngắn nhất (Yen)"},
    {"GET", "estimate", B_USERS, "Tìm đường (chỉ đọc)", "Dự toán chuyến nhiều điểm"},
    {"GET", "timeprofile", B_USERS, "Tìm đường (chỉ đọc)", "Thời gian đi theo giờ xuất phát"},
    {"GET", "trace", B_USERS, "Tìm đường (chỉ đọc)", "Mô phỏng thuật toán từng bước"},
    {"GET", "traverse", B_USERS, "Tìm đường (chỉ đọc)", "Duyệt đồ thị BFS / DFS"},
    {"GET", "components", B_USERS, "Tìm đường (chỉ đọc)", "Thành phần liên thông"},
    {"GET", "zone", B_USERS, "Tìm đường (chỉ đọc)", "Vùng giao hàng quanh kho"},
    {"GET", "zones", B_USERS, "Tìm đường (chỉ đọc)", "Chia vùng nhiều kho"},
    {"GET", "bellman", B_USERS, "Tìm đường (chỉ đọc)", "Bellman-Ford"},
    {"GET", "analysis", B_USERS, "Tìm đường (chỉ đọc)", "Phân tích mạng (cầu, khớp, MST, vị trí kho)"},
    {"GET", "quote", ALL5, "Tìm đường (chỉ đọc)", "Báo giá cước (Dijkstra) — khách vãng lai dùng thử được"},
    {"GET", "public/info", ALL5, "Tìm đường (chỉ đọc)", "Thông tin công khai: điểm giao, biểu phí"},
    {"GET", "track", ALL5, "Tìm đường (chỉ đọc)", "Tra cứu đơn bằng mã đơn + SĐT người nhận"},
    // --- Đơn hàng
    {"POST", "order/add", A | C, "Đơn hàng", "Tạo đơn"},
    {"POST", "orders/random", A, "Đơn hàng", "Tạo đơn mẫu ngẫu nhiên"},
    {"POST", "order/update", ST, "Đơn hàng", "Sửa đơn (khi chưa phân công)"},
    {"POST", "order/edit", C, "Đơn hàng", "Khách tự sửa đơn của mình khi còn ở trạng thái Mới"},
    {"POST", "order/redeliver", C, "Đơn hàng", "Khách hẹn giao lại đơn thất bại (đổi được SĐT / ghi chú)"},
    {"POST", "order/return", C, "Đơn hàng", "Khách yêu cầu hoàn đơn thất bại về kho (tính phí hoàn)"},
    {"POST", "order/remove", A, "Đơn hàng", "Xoá đơn"},
    {"POST", "order/split", ST, "Đơn hàng", "Chia đơn nặng thành nhiều kiện"},
    {"POST", "order/confirm", ST, "Đơn hàng", "Xác nhận đơn mới (Mới → Chờ giao)"},
    {"POST", "order/reject", ST, "Đơn hàng", "Từ chối đơn mới (kèm lý do)"},
    {"POST", "order/cancel", C | ST, "Đơn hàng", "Huỷ đơn (theo quy tắc và phí huỷ)"},
    {"POST", "order/deliver", S | ST, "Đơn hàng", "Xác nhận đã giao bằng mã 4 số"},
    {"POST", "order/rate", C, "Đơn hàng", "Đánh giá shipper (1–5 sao)"},
    {"POST", "order/rate-customer", S, "Đơn hàng", "Shipper đánh giá khách hàng (1–5 sao)"},
    {"POST", "order/retry", C | ST, "Đơn hàng", "Tìm lại shipper cho đơn chưa có ai nhận"},
    {"POST", "order/release", S, "Đơn hàng", "Shipper nhả đơn đã nhận khi chưa lấy hàng (kèm lý do)"},
    {"GET", "orders/list", B_USERS, "Đơn hàng", "Danh sách đơn (tìm kiếm, lọc, sắp xếp, phân trang)"},
    {"GET", "order/get", B_USERS, "Đơn hàng", "Chi tiết đơn"},
    {"GET", "order/invoice", C | ST, "Đơn hàng", "Hoá đơn của đơn"},
    {"GET", "promos", ST, "Đơn hàng", "Danh sách mã giảm giá"},
    {"POST", "promos/save", A, "Đơn hàng", "Thêm / sửa mã giảm giá"},
    {"POST", "promos/remove", A, "Đơn hàng", "Xoá mã giảm giá"},
    // --- Điều phối
    {"GET", "dispatch", ST, "Điều phối", "Chạy các phương án điều phối (phân công tay)"},
    {"POST", "dispatch/apply", ST, "Điều phối", "Áp dụng phương án"},
    {"POST", "shift/progress", ST | S, "Điều phối", "Chạy đồng hồ ca (mô phỏng; shipper chỉ dùng được khi bật chế độ mô phỏng)"},
    {"POST", "shift/fail", ST | S, "Điều phối", "Báo giao thất bại"},
    {"POST", "shift/cancel", C | ST, "Điều phối", "Huỷ đơn (tên cũ của order/cancel)"},
    {"POST", "shift/absent", ST, "Điều phối", "Shipper nghỉ đột xuất"},
    {"POST", "shift/available", ST, "Điều phối", "Shipper có mặt trở lại"},
    {"POST", "shift/reroute", ST, "Điều phối", "Tính lại tuyến khi giao thông đổi"},
    {"POST", "shift/requeue", ST, "Điều phối", "Đưa đơn thất bại về hàng chờ (giao lại)"},
    {"POST", "shift/return", ST, "Điều phối", "Hoàn kho đơn thất bại (tính phí hoàn)"},
    {"POST", "shift/reset", A, "Điều phối", "Huỷ ca đang chạy"},
    {"POST", "trip/accept", S, "Điều phối", "Shipper nhận lời mời / chuyến"},
    {"POST", "trip/decline", S, "Điều phối", "Shipper từ chối chuyến (kèm lý do)"},
    {"POST", "trip/recall", ST, "Điều phối", "Thu hồi chuyến shipper chưa nhận (đơn về hàng chờ)"},
    {"POST", "dispatch/assign", ST, "Điều phối", "Phân công tay các đơn đã chọn cho một shipper"},
    {"POST", "shipper/add", ST, "Điều phối", "Thêm shipper vào đội xe"},
    {"POST", "shipper/update", ST, "Điều phối", "Sửa shipper"},
    {"POST", "shipper/remove", A, "Điều phối", "Xoá shipper khỏi đội xe"},
    // --- Sổ COD
    {"GET", "cod", S | ST, "Sổ COD", "Xem sổ COD (shipper chỉ thấy của mình)"},
    {"POST", "cod/remit", S, "Sổ COD", "Shipper nộp tiền thu hộ"},
    {"POST", "cod/confirm", ST, "Sổ COD", "Xác nhận đã nhận tiền, ghi chênh lệch"},
    {"POST", "cod/close", ST, "Sổ COD", "Chốt ca của shipper"},
    {"GET", "wallet", C | ST, "Sổ COD", "Ví / sao kê đối soát của khách (khách chỉ xem của mình)"},
    {"GET", "wallets", ST, "Sổ COD", "Số dư đối soát của mọi khách hàng"},
    {"POST", "wallet/payout", A, "Sổ COD", "Chi trả tiền cho khách / ghi nhận khách nộp bù"},
    // --- Khiếu nại, thông báo
    {"GET", "complaints", C | ST, "Khiếu nại & thông báo", "Danh sách khiếu nại (khách chỉ thấy của mình)"},
    {"POST", "complaint/add", C, "Khiếu nại & thông báo", "Gửi khiếu nại gắn với đơn"},
    {"POST", "complaint/message", C | ST, "Khiếu nại & thông báo", "Trao đổi trong khiếu nại"},
    {"POST", "complaint/status", ST, "Khiếu nại & thông báo", "Chuyển trạng thái khiếu nại"},
    {"POST", "complaint/compensate", ST, "Khiếu nại & thông báo", "Bồi thường cho khách (theo giá trị khai, có trần)"},
    {"GET", "notifications", B_USERS, "Khiếu nại & thông báo", "Thông báo của tôi"},
    {"POST", "notifications/read", B_USERS, "Khiếu nại & thông báo", "Đánh dấu đã đọc"},
    {"POST", "notifications/read-all", B_USERS, "Khiếu nại & thông báo", "Đánh dấu đã đọc tất cả"},
    // --- Cấu hình, kiểm toán, báo cáo
    {"GET", "config", ST, "Cấu hình & báo cáo", "Xem biểu phí, hạng thân thiết, quy tắc"},
    {"POST", "config/update", A, "Cấu hình & báo cáo", "Sửa biểu phí, hạng thân thiết, quy tắc"},
    {"GET", "audit", A, "Cấu hình & báo cáo", "Nhật ký kiểm toán"},
    {"GET", "audit/export", A, "Cấu hình & báo cáo", "Xuất nhật ký kiểm toán CSV"},
    {"GET", "reports/summary", B_USERS, "Cấu hình & báo cáo", "Báo cáo theo vai trò"},
};
}  // namespace

const std::vector<Rule>& rules() { return RULES; }

const Rule* findRule(const std::string& method, const std::string& path) {
    static std::map<std::string, const Rule*> index;
    if (index.empty())
        for (const Rule& r : RULES) index[std::string(r.method) + " " + r.path] = &r;
    auto it = index.find(method + " " + path);
    return it == index.end() ? nullptr : it->second;
}

unsigned roleBit(Role r) {
    switch (r) {
        case ADMIN: return B_ADMIN;
        case SHIPPER: return B_SHIPPER;
        default: return B_CUSTOMER;
    }
}

bool isPublic(const std::string& method, const std::string& path) {
    const Rule* r = findRule(method, path);
    return r && (r->roles & B_GUEST);
}

bool canAccess(Role role, const std::string& method, const std::string& path) {
    const Rule* r = findRule(method, path);
    return r && (r->roles & roleBit(role));
}

std::string matrixMarkdown() {
    std::ostringstream out;
    std::string group;
    out << "| Chức năng | API | Khách | Khách hàng | Shipper | Quản trị |\n|---|---|:-:|:-:|:-:|:-:|\n";
    for (const Rule& r : RULES) {
        if (group != r.group) {
            group = r.group;
            out << "| **" << group << "** | | | | | |\n";
        }
        auto cell = [&](unsigned b) { return (r.roles & b) ? "✓" : "–"; };
        out << "| " << r.what << " | `" << r.method << " /api/" << r.path << "` | " << cell(B_GUEST) << " | " << cell(B_CUSTOMER) << " | "
            << cell(B_SHIPPER) << " | " << cell(B_ADMIN) << " |\n";
    }
    return out.str();
}

}  // namespace Auth
