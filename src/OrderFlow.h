// ============================================================================
// OrderFlow.h — Máy trạng thái đơn hàng và sổ COD
//
// 1. MÁY TRẠNG THÁI: bảng chuyển trạng thái hợp lệ (trạng thái đầu, hành động, trạng thái sau, ai được làm).
//    Server từ chối mọi chuyển trạng thái sai bằng HTTP 409 kèm lý do. Xem README (sơ đồ Mermaid) hoặc transitions().
//      (khách đặt đơn là vào thẳng Chờ giao) Chờ giao --hệ thống mời shipper gần nhất--> Đã phân công --shipper nhận--> Đang giao --mã xác nhận--> Đã giao
//      Đã phân công --shipper từ chối / hết hạn--> Chờ giao (mời người kế tiếp)
//      Đang giao --thất bại--> Thất bại --giao lại--> Chờ giao   |   --hoàn kho--> Hoàn kho
//      Huỷ: Chờ giao (miễn phí), Đã phân công và Đang giao khi shipper chưa lấy hàng (có phí) với khách hàng; quản trị viên huỷ giúp được cả khi
//      đang giao / thất bại (phí cao hơn). Đã giao, Hoàn kho, Đã huỷ là trạng thái cuối.
// 2. SỔ COD: mỗi đơn có thu hộ khi giao xong tạo một bút toán "Đang giữ" (shipper giữ tiền) -> shipper nộp
//    (phiếu nộp, ghi số tiền đã đưa) -> quản trị viên xác nhận số tiền đếm được ("Đã đối soát", ghi chênh lệch)
//    -> chốt ca của shipper. Mọi chênh lệch được ghi lại và hiển thị.
// data/cod_ledger.txt (ghi nguyên tử): các dòng E (bút toán), R (phiếu nộp), C (chốt ca).
// ============================================================================
#pragma once
#include "Auth.h"
#include "Commerce.h"
#include "Dispatcher.h"

#include <cstdint>
#include <string>
#include <vector>

namespace Flow {

const unsigned B_SYSTEM = 32;   // hành động do hệ thống tự thực hiện (đồng hồ mô phỏng, shipper nghỉ...)

struct Transition {
    int from;
    const char* action;
    int to;                  // -1: tuỳ ngữ cảnh (vd thất bại có thể thành Hoàn kho)
    unsigned actors;         // Auth::RoleBit | B_SYSTEM
    const char* label;       // mô tả tiếng Việt
};
const std::vector<Transition>& transitions();
// Hành động `action` có hợp lệ với đơn đang ở trạng thái `from` khi do `actor` thực hiện không?
// Trả về "" nếu được (và ghi trạng thái sau vào *to nếu to != nullptr), ngược lại là lý do (dùng cho HTTP 409 / 403).
std::string check(int from, const std::string& action, unsigned actor, int* to = nullptr);
// Tỉ lệ phí huỷ theo trạng thái đơn lúc huỷ (0 nếu miễn phí)
double cancelRate(int status, const Commerce::Config& cfg);
// Phí huỷ = tỉ lệ x phần cước vận chuyển còn phải trả (làm tròn lên 500 đ)
long long cancelFee(int status, long long shippingPartNet, const Commerce::Config& cfg);
// Mã xác nhận giao: 4 chữ số
std::string newDeliveryCode();
std::string transitionsMermaid();

// ------------------------------------------------------------------ Sổ COD
struct CodEntry {
    int id = 0;
    int order = 0;
    std::string shipper;
    long long amount = 0;
    std::string state = "held";    // held | remitted | settled
    int64_t collectedAt = 0;
    int remittance = 0;            // mã phiếu nộp (0 = chưa nộp)
    int closeId = 0;               // mã lần chốt ca (0 = chưa chốt)
};
struct Remittance {
    int id = 0;
    std::string shipper;
    int64_t at = 0;
    long long expected = 0;        // tổng tiền theo bút toán
    long long handed = 0;          // shipper khai đã nộp
    std::string state = "submitted";   // submitted | settled
    int64_t settledAt = 0;
    long long counted = 0;         // quản trị viên đếm được
    std::string confirmedBy, note;
    std::vector<int> entries;
    long long diff() const { return state == "settled" ? counted - expected : handed - expected; }   // < 0: thiếu tiền
};
struct ShiftClose {
    int id = 0;
    std::string shipper;
    int64_t at = 0;
    int orders = 0;
    long long collected = 0, counted = 0;
    std::string by;
    long long diff() const { return counted - collected; }
};

class CodLedger {
public:
    bool loadText(const std::string& text, std::string& error);
    std::string toText() const;
    // Ghi nhận tiền thu hộ khi giao xong (mỗi đơn một lần). Trả về mã bút toán, 0 nếu đã có / số tiền = 0.
    int record(int order, const std::string& shipper, long long amount, int64_t now);
    // Shipper nộp toàn bộ tiền đang giữ. handed: số tiền thực đưa. Trả về lỗi, rỗng nếu thành công.
    std::string remit(const std::string& shipper, long long handed, int64_t now, int& remitId);
    std::string confirm(int remitId, long long counted, const std::string& by, const std::string& note, int64_t now);
    std::string close(const std::string& shipper, const std::string& by, int64_t now, int& closeId);
    long long held(const std::string& shipper) const;         // tiền đang giữ (chưa nộp)
    long long awaiting(const std::string& shipper) const;     // đã nộp, chờ xác nhận
    const std::vector<CodEntry>& entries() const { return entries_; }
    const std::vector<Remittance>& remittances() const { return remits_; }
    const std::vector<ShiftClose>& closes() const { return closes_; }
    const Remittance* findRemit(int id) const;
    void renameShipper(const std::string& oldName, const std::string& newName);

private:
    std::vector<CodEntry> entries_;
    std::vector<Remittance> remits_;
    std::vector<ShiftClose> closes_;
    int nextEntry_ = 1, nextRemit_ = 1, nextClose_ = 1;
};

}  // namespace Flow
