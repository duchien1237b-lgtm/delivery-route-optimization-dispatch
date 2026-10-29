#include "BellmanFord.h"

#include <chrono>
#include <unordered_map>

using namespace std;

namespace {

void daoNguoc(vector<int>& a) {
    for (int i = 0, j = (int)a.size() - 1; i < j; i++, j--) {
        int tam = a[i];
        a[i] = a[j];
        a[j] = tam;
    }
}

// Danh sách cạnh đã lọc theo loại xe, đánh chỉ số 0..n-1
struct CanhBF {
    int u, v;
    double w;
    const Edge* e;
};

struct DoThiBF {
    vector<int> ids;                     // chỉ số -> id
    unordered_map<int, int> chiSo;       // id -> chỉ số
    vector<CanhBF> canh;
};

DoThiBF chuanBi(const Graph& g, Criterion tieuChi, Vehicle xe) {
    DoThiBF d;
    d.ids = g.nodeIds();
    for (int i = 0; i < (int)d.ids.size(); i++) d.chiSo[d.ids[i]] = i;
    for (int i = 0; i < (int)d.ids.size(); i++)
        for (const Edge& e : g.neighbors(d.ids[i]))
            if (vehicleAllowed(e, xe))
                d.canh.push_back({i, d.chiSo[e.to], edgeWeight(e, tieuChi, xe), &e});
    return d;
}

// Từ một đỉnh x vừa được nới ở vòng thứ V: lùi V lần để chắc chắn đứng TRONG chu trình,
// rồi đi theo truoc[] cho tới khi quay lại chính nó.
vector<int> layChuTrinh(int x, const vector<int>& truoc, int soDinh) {
    for (int i = 0; i < soDinh; i++) x = truoc[x];
    vector<int> chuTrinh;
    int hienTai = x;
    do {
        chuTrinh.push_back(hienTai);
        hienTai = truoc[hienTai];
    } while (hienTai != x && hienTai != -1);
    chuTrinh.push_back(x);
    daoNguoc(chuTrinh);
    return chuTrinh;
}

}  // namespace

BFResult bellmanFord(const Graph& g, int nguon, Criterion tieuChi, Vehicle xe, double gioDi,
                     const RushProfile* caoDiem) {
    bool theoGio = tieuChi == Criterion::TIME && caoDiem && caoDiem->enabled && gioDi >= 0;
    auto trongSo = [&](const CanhBF& c, double daDi) {
        return theoGio ? travelMinutesAt(*c.e, xe, gioDi + daDi, caoDiem) : c.w;
    };
    auto batDau = chrono::steady_clock::now();
    BFResult kq;
    DoThiBF d = chuanBi(g, tieuChi, xe);
    int soDinh = (int)d.ids.size();
    for (int id : d.ids) {
        kq.khoangCach[id] = VO_CUC;
        kq.truoc[id] = -1;
    }
    if (!g.hasNode(nguon)) return kq;
    kq.hopLe = true;

    vector<double> khoangCach(soDinh, VO_CUC);
    vector<int> truoc(soDinh, -1);
    khoangCach[d.chiSo[nguon]] = 0;

    for (int vong = 1; vong <= soDinh - 1; vong++) {
        bool coThayDoi = false;
        kq.soVongLap = vong;
        for (const CanhBF& c : d.canh) {
            if (khoangCach[c.u] == VO_CUC) continue;
            double khoangCachMoi = khoangCach[c.u] + trongSo(c, khoangCach[c.u]);
            if (khoangCachMoi < khoangCach[c.v]) {
                khoangCach[c.v] = khoangCachMoi;
                truoc[c.v] = c.u;
                coThayDoi = true;
                kq.soLanNoiLong++;
            }
        }
        if (!coThayDoi) break;
    }

    // Vòng thứ V: còn nới được nghĩa là có chu trình âm
    for (const CanhBF& c : d.canh) {
        if (khoangCach[c.u] == VO_CUC) continue;
        if (khoangCach[c.u] + trongSo(c, khoangCach[c.u]) < khoangCach[c.v] - 1e-9) {
            kq.coChuTrinhAm = true;
            truoc[c.v] = c.u;
            for (int i : layChuTrinh(c.v, truoc, soDinh)) kq.chuTrinhAm.push_back(d.ids[i]);
            break;
        }
    }

    for (int i = 0; i < soDinh; i++) {
        kq.khoangCach[d.ids[i]] = khoangCach[i];
        kq.truoc[d.ids[i]] = truoc[i] < 0 ? -1 : d.ids[truoc[i]];
    }
    kq.micros = chrono::duration<double, micro>(chrono::steady_clock::now() - batDau).count();
    return kq;
}

vector<int> getPath(const BFResult& kq, int nguon, int dich) {
    vector<int> duongDi;
    if (!kq.hopLe || kq.coChuTrinhAm || !kq.khoangCach.count(dich) || kq.khoangCach.at(dich) >= VO_CUC)
        return duongDi;
    for (int v = dich; v != -1; v = kq.truoc.at(v)) {
        duongDi.push_back(v);
        if (duongDi.size() > kq.khoangCach.size()) return {};
    }
    daoNguoc(duongDi);
    if (duongDi[0] != nguon) duongDi.clear();
    return duongDi;
}

vector<int> findNegativeCycle(const Graph& g, Criterion tieuChi, Vehicle xe) {
    DoThiBF d = chuanBi(g, tieuChi, xe);
    int soDinh = (int)d.ids.size();
    vector<double> khoangCach(soDinh, 0);  // nguồn ảo: mọi đỉnh bắt đầu = 0
    vector<int> truoc(soDinh, -1);
    int x = -1;
    for (int vong = 0; vong < soDinh; vong++) {
        x = -1;
        for (const CanhBF& c : d.canh) {
            if (khoangCach[c.u] + c.w < khoangCach[c.v] - 1e-9) {
                khoangCach[c.v] = khoangCach[c.u] + c.w;
                truoc[c.v] = c.u;
                x = c.v;
            }
        }
    }
    if (x == -1) return {};
    vector<int> ketQua;
    for (int i : layChuTrinh(x, truoc, soDinh)) ketQua.push_back(d.ids[i]);
    return ketQua;
}
