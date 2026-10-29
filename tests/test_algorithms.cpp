// ============================================================================
// test_algorithms.cpp — Kiểm tra tự động: Dijkstra (3 bản), Bellman-Ford,
// Dự toán, Điều phối. Chạy từ thư mục gốc repo (đọc data/*.txt).
//   g++ -std=c++17 -Wall -Isrc src/*.cpp tests/test_algorithms.cpp -o test_algorithms
//   (bỏ src/main.cpp và src/WebServer.cpp nếu biên dịch tay)
// ============================================================================
#include "BellmanFord.h"
#include "Dispatcher.h"
#include "Estimator.h"
#include "FileIO.h"
#include "MinHeap.h"
#include "ShortestPath.h"
#include "Traversal.h"

#include <cmath>
#include <iostream>
#include <random>

using namespace std;

static int passed = 0;
#define CHECK(cond)                                                              \
    do {                                                                         \
        if (!(cond)) {                                                           \
            cerr << "  [FAIL] " << __FILE__ << ":" << __LINE__ << "  " #cond "\n"; \
            return 1;                                                            \
        }                                                                        \
        ++passed;                                                                \
    } while (0)

static bool near(double a, double b) { return fabs(a - b) < 1e-6; }

int main() {
    string err;

    // ------------------------------------------------------------- MinHeap
    {
        MinHeap<int> h;
        mt19937 rng(1);
        vector<int> v(200);
        for (int& x : v) { x = rng() % 1000; h.push(x); }
        sort(v.begin(), v.end());
        for (int x : v) CHECK(h.pop() == x);
        CHECK(h.empty());

        IndexedMinHeap ih(5);
        ih.pushOrDecrease(0, 9); ih.pushOrDecrease(1, 5); ih.pushOrDecrease(2, 7);
        ih.pushOrDecrease(0, 1);  // giảm khoá
        CHECK(ih.popMin().first == 0);
        CHECK(ih.popMin().first == 1);
        CHECK(ih.size() == 1 && ih.contains(2) && !ih.contains(0));
        cout << "MinHeap / IndexedMinHeap: OK\n";
    }

    Graph g;
    CHECK(FileIO::loadMap("data/map.txt", g, err));

    // ---------------------------------------------------- Dijkstra 3 phiên bản
    {
        using namespace ShortestPath;
        for (Criterion c : {Criterion::DISTANCE, Criterion::TIME, Criterion::COST}) {
            Options o;
            o.criterion = c;
            Tree a = dijkstra(g, 0, Version::ARRAY, o);
            Tree s = dijkstra(g, 0, Version::STL_PQ, o);
            Tree h = dijkstra(g, 0, Version::MIN_HEAP, o);
            for (int id : g.nodeIds()) {
                CHECK(a.dist[id] == s.dist[id] || near(a.dist[id], s.dist[id]));
                CHECK(a.dist[id] == h.dist[id] || near(a.dist[id], h.dist[id]));
            }
        }
        Tree t = dijkstra(g, 0, Version::MIN_HEAP);
        vector<int> p = getPath(t, 7);  // Kho -> Chợ Lớn
        CHECK(p.front() == 0 && p.back() == 7);
        PathInfo info = describePath(g, p, ANY_VEHICLE);
        CHECK(near(info.km, t.dist[7]));
        CHECK(getPath(t, 12).empty());  // Cần Giờ không tới được
        cout << "Dijkstra 0 -> 7: ";
        for (int v : p) cout << v << ' ';
        cout << "(" << info.km << " km)\n";

        // Xe tải bị cấm 1-2 và 1-5 -> phải vòng qua Chợ Lớn để tới Bến Thành
        Options truck;
        truck.vehicle = TRUCK;
        Tree tt = dijkstra(g, 0, Version::MIN_HEAP, truck);
        vector<int> pt = getPath(tt, 1);
        CHECK(pt.size() >= 3 && pt[pt.size() - 2] == 7);
        Options moto;
        moto.vehicle = MOTORBIKE;
        Tree tm = dijkstra(g, 0, Version::MIN_HEAP, moto);
        CHECK(tm.dist[1] < tt.dist[1]);
        cout << "Xe tai toi Ben Thanh: " << tt.dist[1] << " km, xe may: " << tm.dist[1] << " km\n";

        // Dừng sớm vẫn đúng
        Options early;
        early.target = 5;
        CHECK(near(dijkstra(g, 0, Version::ARRAY, early).dist[5], t.dist[5]));

        auto rows = benchmark({200, 800}, 4, 1);
        CHECK(rows.size() == 2 && rows[0].agree && rows[1].agree);
        cout << "Benchmark n=800: mang " << rows[1].microsArray << "us, stl " << rows[1].microsStl
             << "us, heap " << rows[1].microsHeap << "us\n";
    }

    // ---------------------------------------------------------- Bellman-Ford
    {
        // Trên trọng số không âm: BF phải trùng Dijkstra
        BFResult bf = bellmanFord(g, 0, Criterion::DISTANCE);
        auto t = ShortestPath::dijkstra(g, 0, ShortestPath::Version::MIN_HEAP);
        CHECK(!bf.coChuTrinhAm);
        for (int id : g.nodeIds()) {
            if (t.dist[id] == ShortestPath::INF) CHECK(bf.khoangCach[id] >= VO_CUC);
            else CHECK(near(bf.khoangCach[id], t.dist[id]));
        }
        CHECK(getPath(bf, 0, 7) == ShortestPath::getPath(t, 7));

        // Đường một chiều + trợ giá: có cạnh âm, không có chu trình âm
        Graph one;
        CHECK(FileIO::loadMap("data/map_oneway.txt", one, err));
        CHECK(one.isDirected() && one.hasNegativeCost());
        BFResult b2 = bellmanFord(one, 0, Criterion::COST);
        CHECK(!b2.coChuTrinhAm);
        CHECK(findNegativeCycle(one).empty());
        vector<int> p2 = getPath(b2, 0, 9);
        CHECK(!p2.empty() && p2.back() == 9);
        // Kiểm tra lại bằng cách cộng tay chi phí đường đi
        double sum = 0;
        for (size_t i = 0; i + 1 < p2.size(); ++i) sum += edgeCostK(*one.getEdge(p2[i], p2[i + 1]));
        CHECK(near(sum, b2.khoangCach[9]));
        auto dj = ShortestPath::dijkstra(one, 0, ShortestPath::Version::MIN_HEAP,
                                         ShortestPath::Options{Criterion::COST, ANY_VEHICLE, -1});
        CHECK(dj.negativeEdge);
        // Ca kinh điển: Ga Sài Gòn (6) được chốt sớm, sau đó mới phát hiện cạnh âm 8 -> 6
        // => Dijkstra cho kết quả SAI, Bellman-Ford đúng.
        CHECK(dj.dist[6] > b2.khoangCach[6] + 1e-9);
        cout << "Toi Ga Sai Gon (6): Dijkstra " << dj.dist[6] << "k (sai), Bellman-Ford "
             << b2.khoangCach[6] << "k (dung)\n";
        cout << "Bellman-Ford chi phi 0 -> 9 (co canh am): " << b2.khoangCach[9] << "k, Dijkstra cho: "
             << dj.dist[9] << "k\n";

        // Chu trình âm
        Graph neg;
        CHECK(FileIO::loadMap("data/map_negcycle.txt", neg, err));
        BFResult b3 = bellmanFord(neg, 0, Criterion::COST);
        CHECK(b3.coChuTrinhAm && b3.chuTrinhAm.size() >= 3);
        CHECK(b3.chuTrinhAm.front() == b3.chuTrinhAm.back());
        double cyc = 0;
        for (size_t i = 0; i + 1 < b3.chuTrinhAm.size(); ++i)
            cyc += edgeCostK(*neg.getEdge(b3.chuTrinhAm[i], b3.chuTrinhAm[i + 1]));
        CHECK(cyc < 0);
        CHECK(getPath(b3, 0, 5).empty());
        CHECK(!findNegativeCycle(neg).empty());
        cout << "Chu trinh am: ";
        for (int v : b3.chuTrinhAm) cout << v << ' ';
        cout << "(tong " << cyc << "k)\n";
    }

    // --------------------------------------------------------------- Dự toán
    {
        Estimate e = estimateRoute(g, 0, 7);
        CHECK(e.hopLe && e.cacChang.size() == 1);
        CHECK(near(e.chiPhi, PHI_CO_DINH + e.quangDuongKm * GIA_MOI_KM + e.phuPhi));
        Estimate m = estimateMultiStop(g, 0, {1, 7, 8}, ANY_VEHICLE, true);
        CHECK(m.hopLe && m.cacChang.size() == 4 && m.soDiemGiao == 3);
        CHECK(m.thoiGianPhut > 3 * PHUT_MOI_DIEM);
        CHECK(!estimateRoute(g, 0, 12).hopLe);  // Cần Giờ
        cout << "Du toan Kho -> 1 -> 7 -> 8 -> Kho: " << m.quangDuongKm << " km, " << (long long)m.chiPhi
             << " d, " << m.thoiGianPhut << " phut\n";
    }

    // ------------------------------------------------------------- Điều phối
    {
        vector<OrderRecord> recs;
        CHECK(FileIO::loadOrders("data/orders.txt", recs, err, &g));
        vector<Order> orders(recs.begin(), recs.end());
        vector<Shipper> ships;
        CHECK(loadShippers("data/shippers.txt", ships, err) && ships.size() == 3);

        Dispatcher d(g, 0, orders, ships, true);
        auto pq = d.priorityOrder();
        CHECK(orders[pq[0]].urgent && orders[pq[0]].deadline == 45);  // đơn gấp, hạn sớm nhất
        CHECK(orders[pq[1]].urgent && orders[pq[2]].urgent && !orders[pq[3]].urgent);

        DispatchReport rep = d.compareAll(MOTORBIKE);
        CHECK(rep.error.empty() && rep.single.size() == 4 && rep.multi.size() == 5);
        const Plan& nn = rep.single[0];
        const Plan& opt2 = rep.single[2];
        const Plan& tsp = rep.single[3];
        CHECK(tsp.optimal);
        CHECK(tsp.km <= nn.km + 1e-9 && tsp.km <= opt2.km + 1e-9 && opt2.km <= nn.km + 1e-9);
        CHECK(tsp.unreachable.size() == 1 && orders[tsp.unreachable[0]].id == 107);  // Cần Giờ
        CHECK(tsp.served == 7);
        cout << "1 xe: NN " << nn.km << " km, NN+2opt " << opt2.km << " km, TSP " << tsp.km << " km\n";

        for (const Plan& p : rep.multi) {
            for (const Route& r : p.routes) CHECK(r.load <= ships[r.shipper].capacity + 1e-9);
            CHECK(p.served + (int)p.unreachable.size() + (int)p.overweight.size() == (int)orders.size());
            cout << "  " << p.name << ": " << p.km << " km, tre " << p.late << ", chua giao "
                 << p.unreachable.size() + p.overweight.size() << "\n";
        }
        CHECK(rep.multi[3].km <= rep.multi[2].km + 1e-9);  // TSP từng xe không tệ hơn 2-opt
        // Lộ trình phải là đường đi liên tục trên bản đồ, bắt đầu & kết thúc ở kho
        for (const Route& r : rep.multi[2].routes) {
            if (r.orders.empty()) continue;
            CHECK(r.path.front() == 0 && r.path.back() == 0);
            for (size_t i = 0; i + 1 < r.path.size(); ++i) CHECK(g.hasEdge(r.path[i], r.path[i + 1]));
        }
    }

    cout << "\n>>> TAT CA " << passed << " KIEM TRA DEU DAT <<<\n";
    return 0;
}
