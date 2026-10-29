// ============================================================================
// Analysis.h — Phân tích mạng lưới đường (phần mở rộng)
//
// 1. Đoạn đường / giao lộ TRỌNG YẾU — thuật toán Tarjan (1973), O(V + E)
//    DFS một lần, mỗi đỉnh có disc[u] (thứ tự thăm) và low[u] (đỉnh thăm sớm nhất
//    với tới được từ cây con của u qua tối đa một cạnh ngược).
//      - Cạnh cây (u, c) là CẦU nếu low[c] > disc[u]: bỏ đoạn này thì cây con của c
//        bị cắt khỏi phần còn lại.
//      - u (không phải gốc) là KHỚP nếu có con c với low[c] >= disc[u];
//        gốc là khớp nếu có từ 2 con trở lên trong cây DFS.
//    Gốc DFS đặt ở KHO nên "cây con bị cắt" chính là phần không còn đường từ kho:
//    đếm luôn số đơn hàng nằm trong đó (mức độ ảnh hưởng khi đường bị đóng).
//    Cài bằng stack tự quản lý (không đệ quy) để chạy được đồ thị hàng nghìn đỉnh.
//    Đồ thị có hướng: xét như vô hướng (bỏ chiều) — phân tích cấu trúc mạng đường.
//
// 2. Mạng đường TỐI THIỂU (cây khung nhỏ nhất theo km) — nối mọi điểm với tổng
//    km nhỏ nhất, vd. để lên kế hoạch tuyến xe thu gom / bảo trì đường ưu tiên.
//      - Kruskal: sắp xếp cạnh tăng dần + Disjoint Set Union (nén đường, hợp theo hạng)
//        O(E log E)
//      - Prim   : IndexedMinHeap tự cài (cùng cấu trúc với Dijkstra), O(E log V)
//    Đồ thị không liên thông -> rừng khung (mỗi thành phần một cây).
//
// 3. Gợi ý VỊ TRÍ KHO — ma trận khoảng cách mọi cặp điểm (Floyd–Warshall O(V³)
//    khi V <= FLOYD_MAX; đồ thị lớn hơn thì chạy Dijkstra ngược từ từng điểm giao).
//    Mỗi điểm ứng viên được chấm: tổng km tới mọi điểm giao (bài toán 1-median),
//    km xa nhất (1-center), số đơn tới được. Xếp hạng: tới được nhiều đơn hơn, rồi
//    tổng km nhỏ hơn. Kèm TÂM đồ thị (độ lệch tâm nhỏ nhất) của cụm chứa kho.
// ============================================================================
#pragma once
#include "Graph.h"

#include <utility>
#include <vector>

namespace Analysis {

// ------------------------------- Tarjan ------------------------------------
struct Bridge {
    int u = -1, v = -1;      // u là đỉnh cha trong cây DFS
    double km = 0;
    int cutNodes = 0;        // số điểm bị tách khỏi phía có gốc (kho)
    int cutOrders = 0;       // số đơn nằm ở phía bị tách
};
struct Articulation {
    int node = -1;
    int parts = 0;           // bỏ giao lộ này thì cụm chứa nó vỡ thành mấy phần
    int cutNodes = 0;
    int cutOrders = 0;
};
struct CriticalReport {
    std::vector<Bridge> bridges;           // xếp theo số đơn bị ảnh hưởng giảm dần
    std::vector<Articulation> articulation;
    int root = -1;
    double micros = 0;
};
// destinations: điểm giao của các đơn cần tính (mỗi phần tử một đơn, có thể trùng điểm)
CriticalReport criticalRoads(const Graph& g, int root, const std::vector<int>& destinations);

// -------------------------------- MST --------------------------------------
class DisjointSet {
public:
    explicit DisjointSet(int n);
    int find(int x);                 // nén đường đi
    bool unite(int a, int b);        // hợp theo hạng; false nếu đã cùng tập
    int sets() const { return sets_; }
private:
    std::vector<int> parent_, rank_;
    int sets_;
};

struct MstEdge { int u = -1, v = -1; double km = 0; };
struct MstResult {
    std::vector<MstEdge> edges;
    double km = 0;
    int trees = 0;            // số cây (= số thành phần liên thông)
    double micros = 0;
    long long work = 0;       // Kruskal: số lần find; Prim: số thao tác heap
};
MstResult kruskal(const Graph& g);
MstResult prim(const Graph& g);
double totalKm(const Graph& g);   // tổng km mọi đoạn đường (để so với MST)

// --------------------------- Vị trí kho -------------------------------------
const int FLOYD_MAX = 400;

struct DepotScore {
    int node = -1;
    double totalKm = 0;       // tổng km từ điểm này tới mọi điểm giao tới được
    double maxKm = 0;         // điểm giao xa nhất
    int reachable = 0;        // số đơn tới được
};
struct DepotReport {
    std::vector<DepotScore> ranking;   // tốt nhất trước
    DepotScore current;                // kho hiện tại
    int center = -1;                   // tâm đồ thị của cụm chứa kho
    double centerEccentricity = 0;
    int orders = 0;
    bool floyd = false;                // true: dùng Floyd–Warshall
    double micros = 0;
};
// Khoảng cách theo km cho xe v (đường cấm / đóng bị bỏ qua)
DepotReport suggestDepot(const Graph& g, int currentDepot, const std::vector<int>& destinations,
                         Vehicle v = MOTORBIKE, int top = 5);

// Floyd–Warshall thuần (dùng chung + kiểm thử): dist[i][j] theo thứ tự ids
std::vector<std::vector<double>> floydWarshall(const Graph& g, const std::vector<int>& ids, Vehicle v);

}  // namespace Analysis
