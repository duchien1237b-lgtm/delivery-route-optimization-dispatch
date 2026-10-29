// ============================================================================
// Estimator.h — Dự toán chi phí & thời gian của một tuyến giao hàng
// (Phần "Bellman-Ford + Dự toán")
//
// Công thức:
//   Chi phí  = PHI_CO_DINH + quãng đường(km) * GIA_MOI_KM + tổng phụ phí các cạnh
//              (phụ phí có thể âm = được trợ giá)
//   Thời gian = tổng thời gian chạy trên từng cạnh (theo loại xe)
//              + số điểm giao * PHUT_MOI_DIEM (thời gian dừng giao hàng)
// Đường đi giữa các điểm được tìm bằng Bellman-Ford theo quãng đường.
// ============================================================================
#pragma once
#include "Graph.h"

#include <string>
#include <vector>

const double GIA_MOI_KM    = 5000;   // VND / km
const double PHI_CO_DINH   = 15000;  // VND / chuyến
const double TOC_DO_KMH    = 30;     // dùng khi cạnh không có dữ liệu thời gian
const double PHUT_MOI_DIEM = 5;      // phút dừng ở mỗi điểm giao

struct Chang {             // một chặng: điểm này -> điểm kế tiếp
    int tu = -1, den = -1;
    std::vector<int> duongDi;
    double km = 0, phut = 0, phuPhi = 0;  // phuPhi tính bằng VND
    double phutGoc = 0;                   // thời gian nếu không có giờ cao điểm
};

struct Estimate {
    bool hopLe = false;
    std::string lyDo;      // vì sao không hợp lệ (để hiển thị)
    double quangDuongKm = 0;
    double chiPhi = 0;     // VND
    double phuPhi = 0;     // VND (đã nằm trong chiPhi)
    double thoiGianPhut = 0;
    double thoiGianGoc = 0;   // như thoiGianPhut nhưng không tính giờ cao điểm
    double gioDi = -1;        // phút trong ngày lúc xuất phát (-1 = không xét giờ)
    int soDiemGiao = 0;
    std::vector<Chang> cacChang;
};

// Dự toán cho 1 đường đi đã biết (danh sách đỉnh liên tiếp), soDiemGiao = số điểm giao
Estimate estimatePath(const Graph& g, const std::vector<int>& duongDi, int soDiemGiao,
                      Vehicle xe = ANY_VEHICLE);

// Tìm đường nguon -> dich bằng Bellman-Ford rồi dự toán
Estimate estimateRoute(const Graph& g, int nguon, int dich, Vehicle xe = ANY_VEHICLE);

// Tuyến nhiều điểm: kho -> cacDiemGiao[0] -> cacDiemGiao[1] -> ... (-> kho nếu quayVeKho)
// gioDi >= 0 và caoDiem != nullptr: thời gian từng chặng tính theo giờ thực tế xe đi qua
// (đã cộng thời gian dừng giao ở các điểm trước), nên chuyến đi vào giờ cao điểm lâu hơn.
Estimate estimateMultiStop(const Graph& g, int kho, const std::vector<int>& cacDiemGiao,
                           Vehicle xe = ANY_VEHICLE, bool quayVeKho = false,
                           double gioDi = -1, const RushProfile* caoDiem = nullptr);

void printEstimate(const Estimate& ketQua);
