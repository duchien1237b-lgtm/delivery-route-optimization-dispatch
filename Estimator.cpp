#include "Estimator.h"
#include "BellmanFord.h"
#include <iostream>
using namespace std;
static Estimate taoKetQua(double km, int soDiemGiao) {
    Estimate kq;
    kq.hopLe = true;
    kq.quangDuongKm = km;
    kq.chiPhi = PHI_CO_DINH + km * GIA_MOI_KM;
    kq.thoiGianPhut = km / TOC_DO_KMH * 60 + soDiemGiao * PHUT_MOI_DIEM;
    return kq;
}
static Estimate ketQuaKhongHopLe() {
    Estimate kq;
    kq.hopLe = false;
    kq.quangDuongKm = 0;
    kq.chiPhi = 0;
    kq.thoiGianPhut = 0;
    return kq;
}
Estimate estimatePath(const Graph& g, const vector<int>& duongDi, int soDiemGiao) {
    if (duongDi.empty()) return ketQuaKhongHopLe();
    double tongKm = 0;
    for (size_t i = 0; i + 1 < duongDi.size(); i++) {
        int u = duongDi[i], v = duongDi[i + 1];
        bool timThay = false;
        double trongSoNhoNhat = 0;
        for (const Edge& canh : g.neighbors(u)) {
            if (canh.to == v && (!timThay || canh.weight < trongSoNhoNhat)) {
                trongSoNhoNhat = canh.weight;
                timThay = true;
            }
        }
        if (!timThay) 
		return ketQuaKhongHopLe();
        tongKm += trongSoNhoNhat;
    }
    return taoKetQua(tongKm, soDiemGiao);
}
Estimate estimateRoute(const Graph& g, int nguon, int dich) {
    BFResult kq = bellmanFord(g, nguon);
    if (kq.coChuTrinhAm || kq.khoangCach[dich] == VO_CUC) return ketQuaKhongHopLe();
    return taoKetQua(kq.khoangCach[dich], 1);
}
Estimate estimateMultiStop(const Graph& g, int kho, const vector<int>& cacDiemGiao) {
    double tongKm = 0;
    int diemXuatPhat = kho;
    for (size_t i = 0; i < cacDiemGiao.size(); i++) {
        BFResult kq = bellmanFord(g, diemXuatPhat);
        int diemDen = cacDiemGiao[i];
        if (kq.coChuTrinhAm || kq.khoangCach[diemDen] == VO_CUC) return ketQuaKhongHopLe();
        tongKm += kq.khoangCach[diemDen];
        diemXuatPhat = diemDen;
    }
    return taoKetQua(tongKm, (int)cacDiemGiao.size());
}
void printEstimate(const Estimate& ketQua) {
    if (!ketQua.hopLe) {
        cout << "Khong tinh duoc (khong co duong hoac co chu trinh am)\n";
        return;
    }
    cout << "Quang duong: " << ketQua.quangDuongKm << " km\n";
    cout << "Chi phi    : " << (long long)ketQua.chiPhi << " VND\n";
    cout << "Thoi gian  : " << ketQua.thoiGianPhut << " phut\n";
}
 
