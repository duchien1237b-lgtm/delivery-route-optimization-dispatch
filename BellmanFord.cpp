#include "BellmanFord.h"
using namespace std;
static void daoNguoc(vector<int>& a) {
    for (int i = 0, j = (int)a.size() - 1; i < j; i++, j--) {
        int tam = a[i];
        a[i] = a[j];
        a[j] = tam;
    }
}
BFResult bellmanFord(const Graph& g, int nguon) {
    int soDinh = g.numNodes();
    BFResult kq;
    kq.khoangCach.assign(soDinh, VO_CUC);
    kq.truoc.assign(soDinh, -1);
    kq.coChuTrinhAm = false;
    kq.khoangCach[nguon] = 0;
    for (int vong = 1; vong <= soDinh - 1; vong++) {
        bool coThayDoi = false;
        for (int u = 0; u < soDinh; u++) {
            if (kq.khoangCach[u] == VO_CUC) continue;
            for (const Edge& canh : g.neighbors(u)) {
                double khoangCachMoi = kq.khoangCach[u] + canh.weight;
                if (khoangCachMoi < kq.khoangCach[canh.to]) {
                    kq.khoangCach[canh.to] = khoangCachMoi;
                    kq.truoc[canh.to] = u;
                    coThayDoi = true;
                }
            }
        }
        if (!coThayDoi) 
		break; 
    }
    for (int u = 0; u < soDinh; u++) {
        if (kq.khoangCach[u] == VO_CUC) continue;
        for (const Edge& canh : g.neighbors(u)) {
            if (kq.khoangCach[u] + canh.weight < kq.khoangCach[canh.to]) {
                kq.coChuTrinhAm = true;
                return kq;
            }
        }
    }
    return kq;
}
vector<int> getPath(const BFResult& kq, int nguon, int dich) {
    vector<int> duongDi;
    if (kq.coChuTrinhAm || kq.khoangCach[dich] == VO_CUC) 
	return duongDi;
    for (int v = dich; v != -1; v = kq.truoc[v]) 
	duongDi.push_back(v);
    daoNguoc(duongDi);
    if (duongDi[0] != nguon) 
	duongDi.clear();
    return duongDi;
}
vector<int> findNegativeCycle(const Graph& g) {
    int soDinh = g.numNodes();
    vector<double> khoangCach(soDinh, 0);
    vector<int> truoc(soDinh, -1);
    int x = -1;
    for (int vong = 0; vong < soDinh; vong++) {
        x = -1;
        for (int u = 0; u < soDinh; u++) {
            for (const Edge& canh : g.neighbors(u)) {
                if (khoangCach[u] + canh.weight < khoangCach[canh.to]) {
                    khoangCach[canh.to] = khoangCach[u] + canh.weight;
                    truoc[canh.to] = u;
                    x = canh.to;
                }
            }
        }
    }
    if (x == -1) 
	return {}; 
 
    for (int i = 0; i < soDinh; i++) 
	x = truoc[x]; 
    vector<int> chuTrinh;
    int hienTai = x;
    do {
        chuTrinh.push_back(hienTai);
        hienTai = truoc[hienTai];
    } while (hienTai != x);
    chuTrinh.push_back(x);
    daoNguoc(chuTrinh);
    return chuTrinh;
}
 
