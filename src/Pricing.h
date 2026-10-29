// ============================================================================
// Pricing.h — Nghiệp vụ tài chính của một ca giao
//
// 1. BIỂU PHÍ GIAO HÀNG (khách trả), tính theo quãng đường NGẮN NHẤT từ kho tới
//    điểm giao (Dijkstra, xe máy; xe máy không tới được thì xét mọi loại xe):
//      cước = 15.000 đ cho 2 km đầu + 4.000 đ mỗi km tiếp theo
//           + 2.500 đ mỗi kg vượt 3 kg
//           + 30% nếu là đơn gấp (hoả tốc)
//           + phí thu hộ 0,8% giá trị COD (tối thiểu 5.000 đ) nếu có thu hộ
//      làm tròn lên 500 đ. Đơn hoàn kho thu 50% cước (không gồm phí thu hộ).
// 2. KẾT QUẢ CA: doanh thu, chi phí vận hành (km × đơn giá + phí cố định + phụ phí
//    đường của các chuyến), lợi nhuận, tiền thu hộ đã thu / đang giữ.
// 3. ĐỐI SOÁT COD cuối ca theo từng shipper: số đơn giao được, tiền thu hộ phải nộp,
//    số đơn hoàn kho / thất bại.
// ============================================================================
#pragma once
#include "Dispatcher.h"
#include "Operations.h"

#include <string>
#include <vector>

namespace Pricing {

const double PHI_MO_DAU = 15000;     // cho KM_MO_DAU km đầu
const double KM_MO_DAU = 2;
const double GIA_KM_TIEP = 4000;     // mỗi km tiếp theo
const double KG_MIEN_PHI = 3;
const double PHI_MOI_KG = 2500;      // mỗi kg vượt mức
const double HOA_TOC = 0.30;         // phụ thu đơn gấp
const double PHI_COD = 0.008;        // phí thu hộ
const double PHI_COD_TOI_THIEU = 5000;
const double TI_LE_PHI_HOAN = 0.5;   // đơn hoàn kho thu 50% cước

// Biểu phí đang áp dụng. Mặc định bằng các hằng số ở trên; quản trị viên chỉnh được (data/config.txt).
struct Tariff {
    double firstKm = KM_MO_DAU, firstFee = PHI_MO_DAU, perKm = GIA_KM_TIEP, freeKg = KG_MIEN_PHI, perKg = PHI_MOI_KG;
    double urgent = HOA_TOC, codRate = PHI_COD, codMin = PHI_COD_TOI_THIEU, returnRate = TI_LE_PHI_HOAN;
};
Tariff& tariff();          // biểu phí đang dùng cho shippingFee() và summarize()
std::string checkTariff(const Tariff& t);   // rỗng nếu hợp lệ

struct Fee {
    bool valid = false;       // false: không có đường từ kho
    double km = 0;
    double base = 0, distance = 0, weight = 0, urgent = 0, cod = 0;
    double total = 0;         // đã làm tròn lên 500 đ
};
Fee shippingFee(double km, double weightKg, bool urgent, long long cod);

// Khoảng cách ngắn nhất (km) từ kho tới mọi điểm, dùng cho biểu phí
std::vector<double> feeDistances(const Graph& g, int depot, const std::vector<Order>& orders);

struct ShipperSettlement {
    int shipper = -1;
    int delivered = 0, failed = 0, returned = 0, onRoute = 0;
    double codCollected = 0;  // phải nộp lại cuối ca
    double codOnRoute = 0;    // đang giữ / sắp thu
    double revenue = 0;       // cước của các đơn shipper này giao
    double km = 0, cost = 0;  // chi phí các chuyến của shipper
};
struct Finance {
    double revenue = 0;          // cước đơn đã giao + phí hoàn
    double expectedRevenue = 0;  // nếu mọi đơn đang giao đều giao được
    double cost = 0;             // chi phí vận hành các chuyến đã chạy
    double profit = 0;
    double codCollected = 0, codOnRoute = 0, codPending = 0;
    int delivered = 0, returned = 0, cancelled = 0;
    std::vector<ShipperSettlement> shippers;
};
Finance summarize(const std::vector<Order>& orders, const std::vector<Fee>& fees, const std::vector<Trip>& trips,
                  int shipperCount);

}  // namespace Pricing
