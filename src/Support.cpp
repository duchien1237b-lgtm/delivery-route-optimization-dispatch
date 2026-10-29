#include "Support.h"

#include "TextUtil.h"

#include <algorithm>
#include <ctime>
#include <sstream>

namespace Support {

using TextUtil::decodeLine;
using TextUtil::decodeToken;
using TextUtil::encodeLine;
using TextUtil::encodeToken;

namespace {
size_t utf8Len(const std::string& s) {
    return std::count_if(s.begin(), s.end(), [](char c) { return (static_cast<unsigned char>(c) & 0xC0) != 0x80; });
}
bool badChars(const std::string& s) {
    // ký tự điều khiển (trừ xuống dòng) không được có
    return std::any_of(s.begin(), s.end(), [](unsigned char c) { return (c < 0x20 && c != '\n') || c == 0x7f; });
}
std::string utcText(int64_t t) {
    std::time_t tt = static_cast<std::time_t>(t);
    std::tm tmv{};
#ifdef _WIN32
    gmtime_s(&tmv, &tt);
#else
    gmtime_r(&tt, &tmv);
#endif
    char buf[24];
    std::strftime(buf, sizeof buf, "%Y-%m-%d %H:%M:%S", &tmv);
    return buf;
}
}  // namespace

// ==================================== Thông báo ====================================
bool NotificationStore::loadText(const std::string& text, std::string& error) {
    std::vector<Notification> out;
    int maxId = 0, no = 0;
    for (const std::string& raw : TextUtil::meaningfulLines(text)) {
        ++no;
        std::vector<std::string> c;
        std::string rest;
        if (!TextUtil::splitColumns(raw, 6, c, rest)) {
            error = "Thong bao dong " + std::to_string(no) + ": thieu cot";
            return false;
        }
        Notification n;
        try {
            n.id = std::stoi(c[0]);
            n.user = decodeToken(c[1]);
            n.at = std::stoll(c[2]);
            n.read = c[3] == "1";
            n.kind = c[4];
            n.order = std::stoi(c[5]);
        } catch (...) {
            error = "Thong bao dong " + std::to_string(no) + ": gia tri khong hop le";
            return false;
        }
        n.text = decodeLine(rest);
        maxId = std::max(maxId, n.id);
        out.push_back(n);
    }
    items_ = std::move(out);
    next_ = maxId + 1;
    return true;
}

std::string NotificationStore::toText() const {
    std::ostringstream o;
    o << "# Thong bao: id nguoi_nhan thoi_diem(giay) da_doc(1/0) loai ma_don noi_dung\n";
    for (const Notification& n : items_)
        o << n.id << ' ' << encodeToken(n.user) << ' ' << n.at << ' ' << (n.read ? 1 : 0) << ' ' << n.kind << ' ' << n.order << ' ' << encodeLine(n.text) << '\n';
    return o.str();
}

int NotificationStore::add(const std::string& user, const std::string& kind, int order, const std::string& text, int64_t now) {
    Notification n;
    n.id = next_++;
    n.user = user;
    n.at = now;
    n.kind = kind;
    n.order = order;
    n.text = TextUtil::utf8Prefix(text, 300);
    items_.push_back(n);
    // Mỗi người tối đa MAX_PER_USER thông báo: bỏ cái cũ nhất
    size_t count = std::count_if(items_.begin(), items_.end(), [&](const Notification& x) { return x.user == user; });
    if (count > MAX_PER_USER) {
        for (size_t i = 0; i < items_.size(); ++i)
            if (items_[i].user == user) { items_.erase(items_.begin() + i); break; }
    }
    return n.id;
}

std::vector<const Notification*> NotificationStore::of(const std::string& user, bool unreadOnly) const {
    std::vector<const Notification*> v;
    for (auto it = items_.rbegin(); it != items_.rend(); ++it)
        if (it->user == user && (!unreadOnly || !it->read)) v.push_back(&*it);
    return v;
}

int NotificationStore::unread(const std::string& user) const {
    return static_cast<int>(std::count_if(items_.begin(), items_.end(), [&](const Notification& n) { return n.user == user && !n.read; }));
}

bool NotificationStore::markRead(const std::string& user, int id) {
    for (Notification& n : items_)
        if (n.id == id && n.user == user) {
            n.read = true;
            return true;
        }
    return false;
}

int NotificationStore::markAllRead(const std::string& user) {
    int c = 0;
    for (Notification& n : items_)
        if (n.user == user && !n.read) { n.read = true; ++c; }
    return c;
}

// ================================= Nhật ký kiểm toán =================================
bool AuditLog::loadText(const std::string& text, std::string& error) {
    std::vector<AuditEntry> out;
    int maxId = 0, no = 0;
    for (const std::string& raw : TextUtil::meaningfulLines(text)) {
        ++no;
        std::vector<std::string> c;
        std::string rest;
        if (!TextUtil::splitColumns(raw, 6, c, rest)) {
            error = "Nhat ky dong " + std::to_string(no) + ": thieu cot";
            return false;
        }
        AuditEntry e;
        try {
            e.id = std::stoi(c[0]);
            e.at = std::stoll(c[1]);
        } catch (...) {
            error = "Nhat ky dong " + std::to_string(no) + ": gia tri khong hop le";
            return false;
        }
        e.actor = decodeToken(c[2]);
        e.role = c[3];
        e.action = c[4];
        e.target = decodeToken(c[5]);
        e.detail = decodeLine(rest);
        maxId = std::max(maxId, e.id);
        out.push_back(e);
    }
    items_ = std::move(out);
    next_ = maxId + 1;
    return true;
}

std::string AuditLog::toText() const {
    std::ostringstream o;
    o << "# Nhat ky kiem toan: id thoi_diem(giay) nguoi_lam vai_tro hanh_dong doi_tuong chi_tiet\n";
    for (const AuditEntry& e : items_)
        o << e.id << ' ' << e.at << ' ' << encodeToken(e.actor) << ' ' << (e.role.empty() ? "-" : e.role) << ' ' << e.action << ' '
          << encodeToken(e.target) << ' ' << encodeLine(e.detail) << '\n';
    return o.str();
}

void AuditLog::add(const std::string& actor, const std::string& role, const std::string& action, const std::string& target,
                   const std::string& detail, int64_t now) {
    AuditEntry e;
    e.id = next_++;
    e.at = now;
    e.actor = actor.empty() ? "(khach)" : actor;
    e.role = role.empty() ? "guest" : role;
    e.action = action;
    e.target = target;
    e.detail = TextUtil::utf8Prefix(detail, 300);
    items_.push_back(e);
    if (items_.size() > MAX_AUDIT) items_.erase(items_.begin(), items_.begin() + (items_.size() - MAX_AUDIT));
}

std::vector<const AuditEntry*> AuditLog::filter(const std::string& actor, const std::string& action, const std::string& target,
                                                int64_t from, int64_t to) const {
    std::vector<const AuditEntry*> v;
    for (auto it = items_.rbegin(); it != items_.rend(); ++it) {
        if (!actor.empty() && it->actor != actor) continue;
        if (!action.empty() && it->action.compare(0, action.size(), action) != 0) continue;
        if (!target.empty() && it->target != target) continue;
        if (from > 0 && it->at < from) continue;
        if (to > 0 && it->at > to) continue;
        v.push_back(&*it);
    }
    return v;
}

std::string AuditLog::csv(const std::vector<const AuditEntry*>& rows) {
    auto cell = [](std::string s) {
        // chống "CSV injection": ô bắt đầu bằng = + - @ bị Excel hiểu là công thức
        if (!s.empty() && (s[0] == '=' || s[0] == '+' || s[0] == '-' || s[0] == '@')) s = "'" + s;
        std::string out = "\"";
        for (char c : s) {
            if (c == '"') out += "\"\"";
            else if (c == '\n' || c == '\r') out += ' ';
            else out += c;
        }
        return out + "\"";
    };
    std::ostringstream o;
    o << "\xEF\xBB\xBF" << "id,thoi_diem_utc,nguoi_lam,vai_tro,hanh_dong,doi_tuong,chi_tiet\n";
    for (const AuditEntry* e : rows)
        o << e->id << ',' << cell(utcText(e->at)) << ',' << cell(e->actor) << ',' << cell(e->role) << ',' << cell(e->action) << ','
          << cell(e->target) << ',' << cell(e->detail) << '\n';
    return o.str();
}

// ================================== Hộp thư giả lập ==================================
void Mailbox::add(const std::string& to, const std::string& subject, const std::string& body, int64_t now) {
    items_.push_back(Mail{now, to, subject, body});
    if (items_.size() > 200) items_.erase(items_.begin());
}

std::vector<const Mail*> Mailbox::to(const std::string& address) const {
    std::vector<const Mail*> v;
    for (auto it = items_.rbegin(); it != items_.rend(); ++it)
        if (address.empty() || it->to == address) v.push_back(&*it);
    return v;
}

// ===================================== Khiếu nại =====================================
const char* complaintStatusName(const std::string& s) {
    if (s == "processing") return "Đang xử lý";
    if (s == "resolved") return "Đã giải quyết";
    return "Mới";
}

bool ComplaintStore::loadText(const std::string& text, std::string& error) {
    std::vector<Complaint> out;
    int maxId = 0, no = 0;
    for (const std::string& raw : TextUtil::meaningfulLines(text)) {
        ++no;
        if (raw.size() < 2 || raw[1] != ' ') {
            error = "Khieu nai dong " + std::to_string(no) + ": dinh dang sai";
            return false;
        }
        if (raw[0] == 'C') {
            std::vector<std::string> c;
            std::string rest;
            if (!TextUtil::splitColumns(raw.substr(2), 7, c, rest)) {
                error = "Khieu nai dong " + std::to_string(no) + ": thieu cot";
                return false;
            }
            Complaint x;
            try {
                x.id = std::stoi(c[0]);
                x.owner = decodeToken(c[1]);
                x.order = std::stoi(c[2]);
                x.status = c[3];
                x.created = std::stoll(c[4]);
                x.updated = std::stoll(c[5]);
            } catch (...) {
                error = "Khieu nai dong " + std::to_string(no) + ": gia tri khong hop le";
                return false;
            }
            x.assignee = decodeToken(c[6]);
            x.title = decodeLine(rest);
            maxId = std::max(maxId, x.id);
            out.push_back(x);
        } else if (raw[0] == 'M') {
            std::vector<std::string> c;
            std::string rest;
            if (!TextUtil::splitColumns(raw.substr(2), 4, c, rest)) {
                error = "Khieu nai dong " + std::to_string(no) + ": thieu cot";
                return false;
            }
            int cid = 0;
            ComplaintMsg m;
            try {
                cid = std::stoi(c[0]);
                m.at = std::stoll(c[1]);
            } catch (...) {
                error = "Khieu nai dong " + std::to_string(no) + ": gia tri khong hop le";
                return false;
            }
            m.author = decodeToken(c[2]);
            m.role = c[3];
            m.text = decodeLine(rest);
            auto it = std::find_if(out.begin(), out.end(), [&](const Complaint& x) { return x.id == cid; });
            if (it == out.end()) {
                error = "Khieu nai dong " + std::to_string(no) + ": phieu " + std::to_string(cid) + " khong ton tai";
                return false;
            }
            it->msgs.push_back(m);
        } else {
            error = "Khieu nai dong " + std::to_string(no) + ": dong phai bat dau bang C hoac M";
            return false;
        }
    }
    items_ = std::move(out);
    next_ = maxId + 1;
    return true;
}

std::string ComplaintStore::toText() const {
    std::ostringstream o;
    o << "# Khieu nai: 'C id khach ma_don trang_thai tao cap_nhat nguoi_xu_ly tieu_de' va 'M id thoi_diem tac_gia vai_tro noi_dung'\n";
    for (const Complaint& x : items_) {
        o << "C " << x.id << ' ' << encodeToken(x.owner) << ' ' << x.order << ' ' << x.status << ' ' << x.created << ' ' << x.updated << ' '
          << encodeToken(x.assignee) << ' ' << encodeLine(x.title) << '\n';
        for (const ComplaintMsg& m : x.msgs)
            o << "M " << x.id << ' ' << m.at << ' ' << encodeToken(m.author) << ' ' << m.role << ' ' << encodeLine(m.text) << '\n';
    }
    return o.str();
}

std::string ComplaintStore::create(const std::string& owner, int order, const std::string& title, const std::string& body, int64_t now,
                                   int& newId) {
    std::string t = TextUtil::trim(title), b = TextUtil::trim(body);
    if (utf8Len(t) < 3 || utf8Len(t) > 80 || badChars(t) || t.find('\n') != std::string::npos) return "Tiêu đề khiếu nại dài 3–80 ký tự";
    if (utf8Len(b) < 5 || utf8Len(b) > 500 || badChars(b)) return "Nội dung khiếu nại dài 5–500 ký tự";
    int open = 0;
    for (const Complaint& x : items_)
        if (x.owner == owner && x.order == order && x.status != "resolved") ++open;
    if (open >= 3) return "Đơn này đã có 3 khiếu nại chưa giải quyết, hãy trao đổi thêm trong các phiếu đang mở";
    Complaint c;
    c.id = next_++;
    c.owner = owner;
    c.order = order;
    c.title = t;
    c.created = c.updated = now;
    c.msgs.push_back(ComplaintMsg{now, owner, "customer", b});
    items_.push_back(c);
    newId = c.id;
    return "";
}

std::string ComplaintStore::addMessage(int id, const std::string& author, const std::string& role, const std::string& text, int64_t now) {
    for (Complaint& x : items_) {
        if (x.id != id) continue;
        std::string t = TextUtil::trim(text);
        if (utf8Len(t) < 1 || utf8Len(t) > 500 || badChars(t)) return "Tin nhắn dài 1–500 ký tự";
        if (x.status == "resolved" && role == "customer") return "Phiếu đã được giải quyết. Hãy tạo phiếu mới nếu cần thêm hỗ trợ";
        if (x.msgs.size() >= 200) return "Phiếu có quá nhiều tin nhắn";
        x.msgs.push_back(ComplaintMsg{now, author, role, t});
        x.updated = now;
        return "";
    }
    return "Không có khiếu nại này";
}

std::string ComplaintStore::setStatus(int id, const std::string& status, const std::string& by, int64_t now) {
    for (Complaint& x : items_) {
        if (x.id != id) continue;
        bool ok = (x.status == "new" && status == "processing") || (x.status == "processing" && status == "resolved") ||
                  (x.status == "resolved" && status == "processing");
        if (status != "new" && status != "processing" && status != "resolved") return "Trạng thái không hợp lệ";
        if (!ok)
            return std::string("Không thể chuyển khiếu nại từ '") + complaintStatusName(x.status) + "' sang '" + complaintStatusName(status) + "'";
        x.status = status;
        x.updated = now;
        if (status == "processing" && x.assignee.empty()) x.assignee = by;
        return "";
    }
    return "Không có khiếu nại này";
}

const Complaint* ComplaintStore::find(int id) const {
    for (const Complaint& x : items_) if (x.id == id) return &x;
    return nullptr;
}

}  // namespace Support
