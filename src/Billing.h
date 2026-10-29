// ============================================================================
// Billing.h — Nghiệp vụ tài chính phía khách hàng: khai giá & bảo hiểm, cân quy đổi theo kích thước,
//             phí hoàn hàng, ví đối soát (sao kê) của khách và bồi thường khiếu nại.
//
// 1. CÂN QUY ĐỔI: hàng cồng kềnh tính cước theo khối lượng quy đổi = dài × rộng × cao (cm) / hệ số (mặc định 6000),
//    làm tròn lên 0,1 kg. Khối lượng tính cước = max(khối lượng thật, khối lượng quy đổi). Đơn không khai kích thước
//    tính như cũ (kết quả biểu phí không đổi). Điều phối (tải trọng xe) vẫn dùng khối lượng thật.
// 2. KHAI GIÁ & BẢO HIỂM: khai giá trị hàng (0–100 triệu). Phần vượt ngưỡng miễn phí (mặc định 1 triệu) thì thu phí
//    bảo hiểm = tỉ lệ (mặc định 0,5%) × giá trị khai, làm tròn lên 500 đ. Khi mất / hư hỏng, mức bồi thường tối đa
//    = giá trị khai (không khai giá: tối đa N lần cước, mặc định 4).
// 3. NGƯỜI NHẬN TRẢ CƯỚC: shipper thu của người nhận tiền thu hộ + tổng cước; người gửi không bị trừ cước.
// 4. VÍ / SAO KÊ KHÁCH HÀNG (đối soát COD với người gửi):
//      + tiền thu hộ của đơn đã giao (đang chờ cho tới khi phiếu nộp COD của shipper được đối soát)
//      − tổng cước của đơn đã giao do người gửi trả     − phí hoàn của đơn hoàn kho     − phí huỷ của đơn đã huỷ
//      + bồi thường khiếu nại      − chi trả cho khách (chuyển khoản / tiền mặt)      + khách nộp bù khi số dư âm
//    Số dư = tổng các dòng; Có thể rút = số dư − phần đang chờ. Chi trả không vượt quá "có thể rút".
// data/customer_ledger.txt (ghi nguyên tử): "T id loại khách số_tiền lúc người_ghi đơn khiếu_nại kênh mã_tham_chiếu ghi_chú".
// ============================================================================
#pragma once
#include <cstdint>
#include <string>
#include <vector>

namespace Billing {

const long long MAX_DECLARED = 100000000;   // khai giá tối đa 100 triệu đồng
const int MAX_DIM = 300;                    // mỗi cạnh tối đa 300 cm

// Khối lượng quy đổi (kg, làm tròn lên 0,1 kg); 0 nếu thiếu một cạnh
double volumetricWeight(int l, int w, int h, int divisor);
// Khối lượng tính cước = max(khối lượng thật, quy đổi)
double chargedWeight(double weight, int l, int w, int h, int divisor);
// Phí bảo hiểm theo giá trị khai
long long insuranceFee(long long declared, double rate, long long threshold);
// Kiểm tra kích thước: hoặc cả ba bằng 0 (không khai), hoặc cả ba trong 1..300. Trả về lỗi, rỗng nếu hợp lệ.
std::string checkDims(int l, int w, int h);
// "40x30x20" <-> (40, 30, 20). parseDims trả về false nếu sai định dạng.
bool parseDims(const std::string& s, int& l, int& w, int& h);
std::string dimsText(int l, int w, int h);
// Mức bồi thường tối đa của một khiếu nại: hư hỏng / thất lạc theo giá trị khai (không khai: multiplier × cước),
// trễ hạn / khác: tối đa bằng số tiền khách đã trả cho đơn
long long compensationCap(const std::string& kind, long long declared, long long orderTotal, double multiplier);
const char* compensationKindName(const std::string& kind);

// ------------------------------------------------------------ Sổ giao dịch của khách
struct Tx {
    int id = 0;
    std::string kind;        // payout | collect | comp
    std::string customer;
    long long amount = 0;    // > 0
    int64_t at = 0;
    std::string by;          // nhân viên ghi
    int order = 0, complaint = 0;
    std::string method;      // bank | cash | wallet (bồi thường vào ví)
    std::string ref, note;   // mã giao dịch ngân hàng, ghi chú / loại bồi thường
};

class CustomerLedger {
public:
    bool loadText(const std::string& text, std::string& error);
    std::string toText() const;
    // Kiểm tra (loại, số tiền > 0, kênh, tham chiếu <= 40 ký tự, ghi chú <= 200) rồi ghi; trả về lỗi, rỗng nếu được
    std::string add(Tx tx, int& id);
    std::vector<const Tx*> of(const std::string& customer) const;
    const Tx* ofComplaint(int complaint) const;
    const std::vector<Tx>& all() const { return items_; }

private:
    std::vector<Tx> items_;
    int next_ = 1;
};

// Dữ kiện của một đơn cần cho sao kê (WebServer điền từ Order + bảng phí)
struct OrderFacts {
    int id = 0;
    int status = 0;          // OrderStatus
    long long cod = 0;
    long long total = 0;     // tổng cước phải trả (sau giảm giá, gồm bảo hiểm)
    long long returnFee = 0, cancelFee = 0;
    bool receiverPays = false;
    int64_t at = 0;          // lúc giao xong / hoàn / huỷ (giây)
    bool codSettled = false; // tiền thu hộ của đơn đã được đối soát với shipper
};
struct Line {
    int64_t at = 0;
    std::string kind;        // cod | fee | return | cancel | comp | payout | collect
    int order = 0;
    long long amount = 0;    // + khách được nhận, − khách phải trả
    bool pending = false;
    std::string text, ref;
    int tx = 0;
};
struct Statement {
    std::vector<Line> lines;          // theo thời gian tăng dần
    long long balance = 0, pending = 0, available = 0;
    long long codTotal = 0, fees = 0, comps = 0, paidOut = 0, collected = 0;
};
Statement statement(const std::vector<OrderFacts>& orders, const std::vector<const Tx*>& txs);

}  // namespace Billing
