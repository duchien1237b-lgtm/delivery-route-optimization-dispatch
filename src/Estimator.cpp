#include "Estimator.h"
#include "BellmanFord.h"

#include <iostream>

using namespace std;

namespace {

// Thời gian trên cạnh khi xe vào cạnh lúc `luc` (phút trong ngày); caoDiem = nullptr: giờ thường
double phutTrenCanh(const Edge& e, Vehicle xe, double luc = -1, const RushProfile* caoDiem = nullptr) {
    double t = travelMinutes(e, xe);
    if (t <= 0) t = e.distance / TOC_DO_KMH * 60;  // thiếu dữ liệu thời gian
    if (caoDiem && luc >= 0) t *= caoDiem->multiplier(e, xe, luc);
    return t;
}

Estimate ketQuaKhongHopLe(const string& lyDo) {
    Estimate kq;
    kq.hopLe = false;
    kq.lyDo = lyDo;
    return kq;
}

// Tính 1 chặng theo đường đi cho trước. false nếu 2 đỉnh liên tiếp không có cạnh.
bool tinhChang(const Graph& g, const vector<int>& duongDi, Vehicle xe, Chang& c,
               double batDau = -1, const RushProfile* caoDiem = nullptr) {
    c.duongDi = duongDi;
    c.tu = duongDi.front();
    c.den = duongDi.back();
    for (size_t i = 0; i + 1 < duongDi.size(); i++) {
        const Edge* canh = g.getEdge(duongDi[i], duongDi[i + 1]);
        if (!canh || !vehicleAllowed(*canh, xe)) return false;
        c.km += canh->distance;
        c.phut += phutTrenCanh(*canh, xe, batDau >= 0 ? batDau + c.phut : -1, caoDiem);
        c.phutGoc += phutTrenCanh(*canh, xe);
        c.phuPhi += canh->cost * 1000;
    }
    return true;
}

void tongHop(Estimate& kq) {
    kq.hopLe = true;
    kq.quangDuongKm = kq.phuPhi = kq.thoiGianPhut = kq.thoiGianGoc = 0;
    for (const Chang& c : kq.cacChang) {
        kq.quangDuongKm += c.km;
        kq.phuPhi += c.phuPhi;
        kq.thoiGianPhut += c.phut;
        kq.thoiGianGoc += c.phutGoc;
    }
    kq.chiPhi = PHI_CO_DINH + kq.quangDuongKm * GIA_MOI_KM + kq.phuPhi;
    kq.thoiGianPhut += kq.soDiemGiao * PHUT_MOI_DIEM;
    kq.thoiGianGoc += kq.soDiemGiao * PHUT_MOI_DIEM;
}

string ten(const Graph& g, int id) {
    return g.hasNode(id) ? g.getNode(id).name : ("#" + to_string(id));
}

}  // namespace

Estimate estimatePath(const Graph& g, const vector<int>& duongDi, int soDiemGiao, Vehicle xe) {
    if (duongDi.empty()) return ketQuaKhongHopLe("Đường đi rỗng");
    Estimate kq;
    kq.soDiemGiao = soDiemGiao;
    Chang c;
    if (!tinhChang(g, duongDi, xe, c)) return ketQuaKhongHopLe("Đường đi có đoạn không tồn tại hoặc cấm loại xe này");
    kq.cacChang.push_back(c);
    tongHop(kq);
    return kq;
}

Estimate estimateRoute(const Graph& g, int nguon, int dich, Vehicle xe) {
    return estimateMultiStop(g, nguon, {dich}, xe, false);
}

Estimate estimateMultiStop(const Graph& g, int kho, const vector<int>& cacDiemGiao, Vehicle xe,
                           bool quayVeKho, double gioDi, const RushProfile* caoDiem) {
    if (gioDi < 0) caoDiem = nullptr;
    if (!g.hasNode(kho)) return ketQuaKhongHopLe("Kho không tồn tại");
    if (cacDiemGiao.empty()) return ketQuaKhongHopLe("Chưa chọn điểm giao nào");

    vector<int> diem = cacDiemGiao;
    if (quayVeKho) diem.push_back(kho);

    Estimate kq;
    kq.soDiemGiao = (int)cacDiemGiao.size();
    kq.gioDi = caoDiem ? gioDi : -1;
    double daDi = 0;  // số phút đã trôi qua kể từ lúc xuất phát (chạy + dừng giao)
    int diemXuatPhat = kho;
    for (int diemDen : diem) {
        if (!g.hasNode(diemDen)) return ketQuaKhongHopLe("Điểm " + to_string(diemDen) + " không tồn tại");
        if (diemDen == diemXuatPhat) continue;  // hai điểm liên tiếp trùng nhau
        // Tìm đường theo quãng đường (luôn >= 0 nên không có chu trình âm)
        BFResult bf = bellmanFord(g, diemXuatPhat, Criterion::DISTANCE, xe);
        vector<int> duongDi = getPath(bf, diemXuatPhat, diemDen);
        if (duongDi.empty())
            return ketQuaKhongHopLe("Không có đường từ " + ten(g, diemXuatPhat) + " tới " + ten(g, diemDen) +
                                    " cho " + vehicleName(xe));
        Chang c;
        tinhChang(g, duongDi, xe, c, caoDiem ? gioDi + daDi : -1, caoDiem);
        kq.cacChang.push_back(c);
        daDi += c.phut + PHUT_MOI_DIEM;   // dừng giao ở điểm vừa tới
        diemXuatPhat = diemDen;
    }
    tongHop(kq);
    return kq;
}

void printEstimate(const Estimate& ketQua) {
    if (!ketQua.hopLe) {
        cout << "Khong tinh duoc: " << ketQua.lyDo << "\n";
        return;
    }
    cout << "Quang duong: " << ketQua.quangDuongKm << " km\n";
    cout << "Phu phi    : " << (long long)ketQua.phuPhi << " VND\n";
    cout << "Chi phi    : " << (long long)ketQua.chiPhi << " VND\n";
    cout << "Thoi gian  : " << ketQua.thoiGianPhut << " phut (gom " << ketQua.soDiemGiao
         << " diem giao x " << PHUT_MOI_DIEM << " phut)\n";
}
