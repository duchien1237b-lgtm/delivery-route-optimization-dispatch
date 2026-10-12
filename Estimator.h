#pragma once
#include <vector>
#include "Graph.h"
const double GIA_MOI_KM   = 5000;   
const double PHI_CO_DINH  = 15000;  
const double TOC_DO_KMH   = 30;   
const double PHUT_MOI_DIEM = 5;  
struct Estimate {
    bool hopLe;          
    double quangDuongKm;
    double chiPhi;     
    double thoiGianPhut;
};
// Dự toán cho 1 đường đi đã biết (danh sách đỉnh liên tiếp), soDiemGiao = số điểm giao
Estimate estimatePath(const Graph& g, const std::vector<int>& duongDi, int soDiemGiao);
// Tìm đường nguon -> dich bằng Bellman-Ford rồi dự toán
Estimate estimateRoute(const Graph& g, int nguon, int dich);
// Tuyến nhiều điểm: kho -> cacDiemGiao[0] -> cacDiemGiao[1] -> ...
Estimate estimateMultiStop(const Graph& g, int kho, const std::vector<int>& cacDiemGiao);
void printEstimate(const Estimate& ketQua);
 
