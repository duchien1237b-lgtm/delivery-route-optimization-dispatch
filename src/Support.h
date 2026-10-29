// ============================================================================
// Support.h — Thông báo trong app, nhật ký kiểm toán, hộp thư giả lập, khiếu nại / hỗ trợ
//
// - Thông báo: mỗi người dùng một hộp (tối đa MAX_PER_USER, cũ nhất bị bỏ), đánh dấu đã đọc.
// - Nhật ký kiểm toán: ai, lúc nào, làm gì, trên đối tượng nào. Chỉ ghi thêm; lọc và xuất CSV.
// - Hộp thư giả lập: thay cho SMTP — nội dung email (mã đặt lại mật khẩu...) được giữ trong bộ nhớ,
//   hiện trong giao diện và in ra nhật ký của server.
// - Khiếu nại: khách tạo phiếu gắn với một đơn; quản trị viên xử lý: Mới -> Đang xử lý -> Đã giải quyết,
//   có lịch sử trao đổi giữa hai bên.
// Các file data/notifications.txt, audit.txt, complaints.txt ghi nguyên tử (file tạm rồi đổi tên).
// ============================================================================
#pragma once
#include <cstdint>
#include <string>
#include <vector>

namespace Support {

// ------------------------------------------------------------------ Thông báo
struct Notification {
    int id = 0;
    std::string user;
    int64_t at = 0;
    bool read = false;
    std::string kind;     // order, account, trip, complaint, cod, system
    int order = 0;        // mã đơn liên quan (0 = không)
    std::string text;
};
const size_t MAX_PER_USER = 100;

class NotificationStore {
public:
    bool loadText(const std::string& text, std::string& error);
    std::string toText() const;
    int add(const std::string& user, const std::string& kind, int order, const std::string& text, int64_t now);
    std::vector<const Notification*> of(const std::string& user, bool unreadOnly = false) const;   // mới nhất trước
    int unread(const std::string& user) const;
    bool markRead(const std::string& user, int id);
    int markAllRead(const std::string& user);

private:
    std::vector<Notification> items_;
    int next_ = 1;
};

// ------------------------------------------------------------ Nhật ký kiểm toán
struct AuditEntry {
    int id = 0;
    int64_t at = 0;
    std::string actor, role, action, target, detail;
};
const size_t MAX_AUDIT = 5000;

class AuditLog {
public:
    bool loadText(const std::string& text, std::string& error);
    std::string toText() const;
    void add(const std::string& actor, const std::string& role, const std::string& action, const std::string& target,
             const std::string& detail, int64_t now);
    const std::vector<AuditEntry>& all() const { return items_; }
    // Lọc theo người làm, hành động (khớp tiền tố), đối tượng, khoảng thời gian; mới nhất trước
    std::vector<const AuditEntry*> filter(const std::string& actor, const std::string& action, const std::string& target,
                                          int64_t from, int64_t to) const;
    static std::string csv(const std::vector<const AuditEntry*>& rows);

private:
    std::vector<AuditEntry> items_;
    int next_ = 1;
};

// ------------------------------------------------------------ Hộp thư giả lập
struct Mail {
    int64_t at = 0;
    std::string to, subject, body;
};
class Mailbox {
public:
    void add(const std::string& to, const std::string& subject, const std::string& body, int64_t now);
    std::vector<const Mail*> to(const std::string& address) const;   // mới nhất trước
    const std::vector<Mail>& all() const { return items_; }

private:
    std::vector<Mail> items_;
};

// ----------------------------------------------------------------- Khiếu nại
struct ComplaintMsg {
    int64_t at = 0;
    std::string author, role, text;
};
struct Complaint {
    int id = 0;
    std::string owner;
    int order = 0;
    std::string title;
    std::string status = "new";      // new | processing | resolved
    int64_t created = 0, updated = 0;
    std::string assignee;            // quản trị viên nhận xử lý
    std::vector<ComplaintMsg> msgs;
};
const char* complaintStatusName(const std::string& s);   // "Mới", "Đang xử lý", "Đã giải quyết"

class ComplaintStore {
public:
    bool loadText(const std::string& text, std::string& error);
    std::string toText() const;
    // Tạo phiếu: tiêu đề 3–80 ký tự, nội dung 5–500 ký tự. Mỗi đơn tối đa 3 phiếu chưa giải quyết.
    std::string create(const std::string& owner, int order, const std::string& title, const std::string& body, int64_t now, int& newId);
    std::string addMessage(int id, const std::string& author, const std::string& role, const std::string& text, int64_t now);
    // new -> processing -> resolved ; resolved -> processing (mở lại)
    std::string setStatus(int id, const std::string& status, const std::string& by, int64_t now);
    const Complaint* find(int id) const;
    const std::vector<Complaint>& all() const { return items_; }

private:
    std::vector<Complaint> items_;
    int next_ = 1;
};

}  // namespace Support
