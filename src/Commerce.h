// ============================================================================
// Commerce.h — Nghiệp vụ thương mại: cấu hình, mã giảm giá, hạng thân thiết, báo giá, sổ địa chỉ,
//              đánh giá shipper và điểm hiệu suất.
//
// 1. BÁO GIÁ = hoá đơn. Cước gốc theo biểu phí (Pricing, quãng đường Dijkstra từ kho) rồi:
//      - giảm theo hạng thân thiết (% của phần cước vận chuyển, không tính phí thu hộ),
//      - trừ mã giảm giá (phần trăm có trần, hoặc số tiền; hạn dùng, lượt dùng, đơn tối thiểu),
//    mọi khoản giảm làm tròn xuống 500 đ nên số tiền phải trả luôn là bội số của 500 đ.
//    Đơn lưu lại cước gốc và hai khoản giảm lúc đặt (gia=, ck=, tv=) nên hoá đơn luôn khớp báo giá.
// 2. HẠNG THÂN THIẾT theo số đơn đã giao thành công (Đồng / Bạc / Vàng / Kim cương, chỉnh được).
// 3. ĐIỂM SHIPPER (0–100) = 50% tỉ lệ đúng hạn + 30% điểm đánh giá sao + 20% (1 − tỉ lệ từ chối chuyến × 2).
//    Điều phối có thể (bật / tắt) ưu tiên shipper điểm cao.
// 4. config.txt: các dòng "khoá giá_trị" — xem Config::toText().
// ============================================================================
#pragma once
#include "Pricing.h"

#include <cstdint>
#include <map>
#include <string>
#include <vector>

namespace Commerce {

struct Tier {
    std::string name;
    int minDone = 0;       // số đơn đã giao tối thiểu
    double pct = 0;        // phần trăm giảm cước vận chuyển (0.05 = 5%)
};

struct Config {
    std::vector<Tier> tiers;
    double cancelDispatched = 0.20;   // phí huỷ (tỉ lệ cước vận chuyển) khi đơn đã có shipper nhận nhưng chưa lấy hàng
    double cancelOnRoute = 0.50;      // khi shipper đã lấy hàng / giao thất bại (chỉ quản trị viên huỷ giúp khách)
    double shipperShare = 0.70;       // phần cước vận chuyển shipper nhận được
    bool scoreAware = false;          // điều phối ưu tiên shipper điểm cao
    int maxOpenOrders = 20;           // số đơn chờ tối đa của một khách
    bool autoDeliver = false;         // chế độ mô phỏng: đồng hồ ca tự giao đơn (không cần mã xác nhận)
    // Khai giá, cân quy đổi, bồi thường (Billing.h)
    double insRate = 0.005;           // phí bảo hiểm = tỉ lệ × giá trị khai
    long long insThreshold = 1000000; // khai giá tới mức này thì miễn phí bảo hiểm
    int volDivisor = 6000;            // khối lượng quy đổi = D×R×C (cm) / hệ số
    double compMultiplier = 4;        // không khai giá: bồi thường hư hỏng / thất lạc tối đa N lần cước
    long long debtLimit = 500000;     // khách nợ phí (số dư ví âm) quá mức này thì không đặt đơn mới; 0 = không chặn
    // Ghép đơn tự động kiểu Grab (đã bỏ điều phối viên): đơn mới được mời tới shipper gần kho nhất, shipper có hạn để nhận
    bool autoMatch = true;            // tắt: đơn nằm ở hàng chờ cho quản trị viên phân công tay
    int offerSeconds = 45;            // hạn trả lời một lời mời (giây thật); quá hạn thì mời shipper kế tiếp
    int matchGiveUp = 10;             // hết shipper để mời quá số phút này thì tự huỷ đơn không mất phí; 0 = không tự huỷ
    double clockSpeed = 0;            // giờ ca chạy theo giờ thật: số phút ca trôi mỗi phút thật (0 = chỉ chạy khi giao đơn / mô phỏng)
    // Nghiệp vụ kiểu Grab bổ sung (v12)
    int missLimit = 3;                // bỏ qua / bỏ lỡ liên tiếp số lời mời này thì shipper tự chuyển sang Tạm nghỉ; 0 = tắt
    long long codHoldLimit = 5000000; // shipper đang giữ tiền mặt thu hộ quá mức này thì không được mời đơn thu tiền; 0 = không chặn
    long long tipMax = 200000;        // tiền tip tối đa cho một đơn (bội số 1.000 đ); 0 = tắt tính năng tip
    // Xác nhận hai bước (v15): shipper bấm "Đã giao tới", người nhận bấm "Đã nhận hàng"
    int autoConfirmMinutes = 30;      // người nhận không phản hồi quá số phút thật này thì đơn tự hoàn tất; 0 = không tự hoàn tất
    Config();
    std::string toText() const;
    bool loadText(const std::string& text, std::string& error);   // cũng nạp biểu phí vào Pricing::tariff()
    std::string check() const;
};
Config& config();                 // cấu hình đang dùng
const Tier& tierFor(int done);    // hạng của khách đã giao `done` đơn
const Tier* nextTier(int done);   // hạng kế tiếp (nullptr nếu đã cao nhất)

// ------------------------------------------------------------- Mã giảm giá
struct Promo {
    std::string code;           // CHU HOA, 3–16 ký tự A-Z 0-9
    std::string type = "pct";   // "pct": giảm % ; "amt": giảm số tiền
    long long value = 0;        // % (1–100) hoặc VND
    long long maxDiscount = 0;  // trần giảm khi theo % (0 = không trần)
    long long minFee = 0;       // cước gốc tối thiểu để dùng mã
    int maxUses = 0;            // tổng lượt (0 = không giới hạn)
    int used = 0;
    int perUser = 1;            // lượt tối đa mỗi khách (0 = không giới hạn)
    int64_t expires = 0;        // giây; 0 = không hết hạn
    bool active = true;
    std::string description;
};
std::string normalizeCode(const std::string& code);
std::string checkPromo(const Promo& p);   // rỗng nếu hợp lệ

class PromoStore {
public:
    bool loadText(const std::string& text, std::string& error);
    std::string toText() const;
    const std::vector<Promo>& all() const { return promos_; }
    const Promo* find(const std::string& code) const;
    std::string upsert(const Promo& p);          // thêm mới hoặc ghi đè theo mã
    std::string remove(const std::string& code);
    void consume(const std::string& code) ;      // +1 lượt đã dùng
    void giveBack(const std::string& code);      // -1 (đơn bị huỷ khi chưa xuất phát)
    // Mã có dùng được cho đơn có cước gốc `gross` không? usedByUser = số lần khách này đã dùng. Trả về lỗi, rỗng nếu được.
    std::string validate(const std::string& code, long long gross, int64_t now, int usedByUser) const;

private:
    std::vector<Promo> promos_;
};

// ------------------------------------------------------------- Báo giá
struct Quote {
    Pricing::Fee fee;              // cước gốc theo biểu phí (đã gồm phí thu hộ)
    long long gross = 0;           // fee.total
    long long loyaltyDiscount = 0, promoDiscount = 0;
    long long net = 0;             // số tiền phải trả = gross − hai khoản giảm
    std::string tier;              // tên hạng ("" nếu không phải khách hàng đăng nhập)
    double tierPct = 0;
    std::string promo;             // mã được áp dụng ("" nếu không có / không hợp lệ)
    std::string promoError;        // lý do mã không dùng được
    // Do nơi gọi điền (Billing.h): bảo hiểm và tổng phải trả; khối lượng tính cước
    long long insurance = 0, total = 0;   // total = net + insurance
    double chargedWeight = 0, volWeight = 0;
};
// loyaltyPct < 0: khách vãng lai / không có hạng. usedByUser: số lần khách đã dùng mã này.
Quote computeQuote(const Pricing::Fee& fee, const std::string& tier, double loyaltyPct, const std::string& promoCode,
                   const PromoStore& promos, int64_t now, int usedByUser);
// Phần cước vận chuyển (không gồm phí thu hộ), làm tròn xuống 500 đ — cơ sở tính giảm giá và phí huỷ
long long shippingPart(const Pricing::Fee& fee);
long long floor500(double v);
long long ceil500(double v);

// ------------------------------------------------------------- Sổ địa chỉ
struct Address {
    int id = 0;
    std::string owner, label, recipient, phone, detail;
    int node = -1;              // điểm trên bản đồ
    bool isDefault = false;
};
const size_t MAX_ADDRESSES = 10;

class AddressBook {
public:
    bool loadText(const std::string& text, std::string& error);
    std::string toText() const;
    std::vector<const Address*> of(const std::string& owner) const;
    const Address* find(int id) const;
    // Kiểm tra: nhãn 1–30 ký tự, người nhận 2–60 ký tự, SĐT hợp lệ, chi tiết <= 80 ký tự. Điểm do nơi gọi kiểm tra.
    std::string add(const Address& a, int& newId);
    std::string update(int id, const std::string& owner, const Address& a);
    std::string remove(int id, const std::string& owner);
    std::string setDefault(int id, const std::string& owner);
    void removeOwner(const std::string& owner);

private:
    std::vector<Address> items_;
    int next_ = 1;
    static std::string checkFields(const Address& a);
};

// ------------------------------------------------------------- Đánh giá & điểm shipper
struct Review {
    int order = 0;
    std::string customer, shipper;
    int stars = 5;
    std::string comment;
    int64_t at = 0;
};
class ReviewStore {
public:
    bool loadText(const std::string& text, std::string& error);
    std::string toText() const;
    std::string add(const Review& r);          // mỗi đơn đánh giá một lần; 1–5 sao; nhận xét <= 200 ký tự
    const Review* ofOrder(int order) const;
    std::vector<const Review*> ofShipper(const std::string& shipper) const;
    double average(const std::string& shipper, int* count = nullptr) const;
    // Đánh giá hai chiều: shipper đánh giá khách (lưu ở file riêng, cùng định dạng; shipper = người đánh giá, customer = người được đánh giá)
    double averageOfCustomer(const std::string& customer, int* count = nullptr) const;
    const std::vector<Review>& all() const { return items_; }

private:
    std::vector<Review> items_;
};

struct ShipperStat {
    int delivered = 0;      // đơn giao thành công
    int onTime = 0;         // trong đó đúng hạn (hoặc không có hạn)
    int failed = 0;         // lần giao thất bại
    int accepted = 0;       // chuyến đã nhận
    int declines = 0;       // chuyến đã từ chối
    long long income = 0;   // thu nhập (phần cước shipper nhận)
};
class StatsStore {
public:
    bool loadText(const std::string& text, std::string& error);
    std::string toText() const;
    ShipperStat get(const std::string& shipper) const;
    ShipperStat& at(const std::string& shipper) { return stats_[shipper]; }
    void rename(const std::string& oldName, const std::string& newName);
    const std::map<std::string, ShipperStat>& all() const { return stats_; }

private:
    std::map<std::string, ShipperStat> stats_;
};
// ------------------------------------------------------------- Loại hàng (khai khi đặt đơn, như GrabExpress)
// Mã: tailieu, thucpham, quanao, dientu, devo, khac. Rỗng = đơn cũ / nhân viên không khai.
const char* categoryName(const std::string& code);   // "" nếu mã không hợp lệ
bool validCategory(const std::string& code);
const std::vector<std::string>& categoryCodes();

// ------------------------------------------------------------- Trò chuyện trong đơn (khách <-> shipper)
// data/order_chat.txt: "M id don thoi_diem nguoi_gui vai_tro(C|S|A) noi_dung"
struct ChatMessage {
    int id = 0, order = 0;
    int64_t at = 0;
    std::string from;     // tên đăng nhập người gửi
    char role = 'C';      // C khách, S shipper, A quản trị viên (tổng đài)
    std::string text;
};
const size_t MAX_CHAT_TEXT = 300;   // ký tự (UTF-8) mỗi tin
const size_t MAX_CHAT_PER_ORDER = 200;
class ChatStore {
public:
    bool loadText(const std::string& text, std::string& error);
    std::string toText() const;
    // Kiểm tra nội dung (1–300 ký tự, gộp xuống dòng thành dấu cách), tối đa 200 tin mỗi đơn. Trả về lỗi, rỗng nếu được.
    std::string add(ChatMessage m, int& id);
    std::vector<const ChatMessage*> of(int order) const;
    int count(int order) const;
    void removeOrder(int order);

private:
    std::vector<ChatMessage> items_;
    int next_ = 1;
};

// ------------------------------------------------------------- Shipper yêu thích / bị chặn của từng khách
// data/customer_prefs.txt: "F khach ten_shipper" (yêu thích) | "B khach ten_shipper" (chặn)
const size_t MAX_PREFS = 10;   // tối đa 10 shipper yêu thích và 10 shipper bị chặn mỗi khách
class PrefStore {
public:
    bool loadText(const std::string& text, std::string& error);
    std::string toText() const;
    bool isBlocked(const std::string& customer, const std::string& shipper) const;
    bool isFavorite(const std::string& customer, const std::string& shipper) const;
    std::vector<std::string> blocked(const std::string& customer) const;
    std::vector<std::string> favorites(const std::string& customer) const;
    // action: block | unblock | fav | unfav. Chặn thì bỏ khỏi yêu thích và ngược lại. Trả về lỗi, rỗng nếu được.
    std::string apply(const std::string& customer, const std::string& shipper, const std::string& action);
    void renameShipper(const std::string& oldName, const std::string& newName);
    void removeCustomer(const std::string& customer);

private:
    struct Pref { char kind; std::string customer, shipper; };
    std::vector<Pref> items_;
    size_t countOf(const std::string& customer, char kind) const;
};

// Điểm hiệu suất 0–100. Chưa có dữ liệu thì dùng giá trị trung tính (đúng hạn 100%, 4 sao).
double performanceScore(const ShipperStat& s, double avgStars, int ratingCount);

}  // namespace Commerce
