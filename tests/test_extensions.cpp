// ============================================================================
// test_extensions.cpp — Kiểm tra phần mở rộng và các tình huống đặc biệt:
//   Tarjan (cầu, khớp) so với cách vét cạn "bỏ thử rồi đếm thành phần",
//   cây khung nhỏ nhất Kruskal = Prim, Floyd–Warshall = Dijkstra, gợi ý vị trí kho,
//   huỷ đơn, giao thất bại 2 lần -> hoàn kho, shipper nghỉ đột xuất,
//   tính lại tuyến khi đóng đường / kẹt xe giữa ca.
// Chạy từ thư mục gốc repo (đọc data/*.txt).
// ============================================================================
#include "Analysis.h"
#include "Dispatcher.h"
#include "Estimator.h"
#include "FileIO.h"
#include "Operations.h"
#include "ShortestPath.h"
#include "Traversal.h"

#include <algorithm>
#include <cmath>
#include <iostream>
#include <set>

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

static bool near(double a, double b, double eps = 1e-6) { return fabs(a - b) < eps; }

// Số thành phần liên thông (bỏ chiều) sau khi bỏ một cạnh / một đỉnh
static int componentsWithout(const Graph& g, int eu, int ev, int node) {
    Graph h(false);
    for (int id : g.nodeIds())
        if (id != node) h.addNode(id, "");
    for (int u : g.nodeIds())
        for (const Edge& e : g.neighbors(u)) {
            if (u == node || e.to == node) continue;
            if ((u == eu && e.to == ev) || (u == ev && e.to == eu)) continue;
            if (!h.hasEdge(u, e.to)) h.addEdge(u, e.to, e.distance, 1, 0);
        }
    return static_cast<int>(Traversal::connectedComponents(h).size());
}

static int checkTarjan(const Graph& g, int root) {
    Analysis::CriticalReport rep = Analysis::criticalRoads(g, root, {});
    int base = componentsWithout(g, -1, -1, -999);
    set<pair<int, int>> bridges;
    for (const auto& b : rep.bridges) bridges.insert({min(b.u, b.v), max(b.u, b.v)});
    set<pair<int, int>> pairs;
    for (int u : g.nodeIds())
        for (const Edge& e : g.neighbors(u)) pairs.insert({min(u, e.to), max(u, e.to)});
    for (auto [u, v] : pairs) {
        bool isBridge = componentsWithout(g, u, v, -999) > base;
        CHECK(isBridge == (bridges.count({u, v}) > 0));
    }
    set<int> arts;
    for (const auto& a : rep.articulation) arts.insert(a.node);
    for (int x : g.nodeIds()) {
        // bỏ đỉnh x: số thành phần của phần còn lại tăng so với (base - [x đứng riêng])
        bool alone = true;
        for (auto [u, v] : pairs)
            if (u == x || v == x) alone = false;
        int after = componentsWithout(g, -1, -1, x);
        bool isArt = after > base - (alone ? 1 : 0);
        CHECK(isArt == (arts.count(x) > 0));
    }
    return 0;
}

int main() {
    string err;
    Graph hcm, oneway, city;
    CHECK(FileIO::loadMap("data/map.txt", hcm, err));
    CHECK(FileIO::loadMap("data/map_oneway.txt", oneway, err));
    CHECK(FileIO::loadMap("data/map_city.txt", city, err));

    // ------------------------------------------------ Tarjan: ví dụ tự dựng
    {
        // 0 - 1 - 2, tam giác 2-3-4, lá 5 treo vào 4, cụm rời 6-7
        Graph g;
        for (int i = 0; i < 8; ++i) g.addNode(i, "n" + to_string(i));
        g.addEdge(0, 1, 1, 1, 0); g.addEdge(1, 2, 1, 1, 0);
        g.addEdge(2, 3, 1, 1, 0); g.addEdge(3, 4, 1, 1, 0); g.addEdge(4, 2, 1, 1, 0);
        g.addEdge(4, 5, 1, 1, 0); g.addEdge(6, 7, 1, 1, 0);
        // Đơn ở 5, 5, 3 và 0
        Analysis::CriticalReport rep = Analysis::criticalRoads(g, 0, {5, 5, 3, 0});
        CHECK(rep.bridges.size() == 4);   // 0-1, 1-2, 4-5, 6-7
        // Cạnh 0-1 cắt cả phía 1..5 khỏi kho: 5 điểm, 3 đơn
        CHECK(rep.bridges[0].u == 0 && rep.bridges[0].v == 1 && rep.bridges[0].cutNodes == 5 && rep.bridges[0].cutOrders == 3);
        set<int> arts;
        for (auto& a : rep.articulation) arts.insert(a.node);
        CHECK(arts == (set<int>{1, 2, 4}));
        if (checkTarjan(g, 0)) return 1;
    }
    // Tarjan khớp với cách vét cạn trên các bản đồ thật và đồ thị ngẫu nhiên
    if (checkTarjan(hcm, 0)) return 1;
    if (checkTarjan(oneway, 0)) return 1;
    for (unsigned seed = 1; seed <= 6; ++seed) {
        Graph r = ShortestPath::randomGraph(40, 1.6 + seed * 0.2, seed);
        if (checkTarjan(r, 0)) return 1;
    }
    {
        // Bản đồ HCM: cụm chính không có đoạn trọng yếu, chỉ có đoạn nối 2 điểm Cần Giờ
        Analysis::CriticalReport rep = Analysis::criticalRoads(hcm, 0, {});
        CHECK(rep.bridges.size() == 1 && rep.articulation.empty());
        // Đóng đoạn 0-11 (Kho - Bến xe Miền Đông) KHÔNG làm mất kết nối: cụm vẫn 2-liên thông
        // Bản đồ một chiều: đoạn 0-1 là cầu, phía bên kia có 6 đơn
        vector<OrderRecord> recs;
        CHECK(FileIO::loadOrders("data/orders_oneway.txt", recs, err, &oneway));
        vector<int> dest;
        for (auto& r : recs) dest.push_back(r.destination);
        Analysis::CriticalReport r2 = Analysis::criticalRoads(oneway, 0, dest);
        CHECK(!r2.bridges.empty() && r2.bridges[0].cutOrders == static_cast<int>(dest.size()));
        // Đồ thị lớn (2000 điểm) — stack tự quản lý, không tràn
        Analysis::CriticalReport r3 = Analysis::criticalRoads(city, 0, {});
        CHECK(!r3.bridges.empty());
        cout << "Tarjan: do thi lon " << r3.bridges.size() << " cau, " << r3.articulation.size() << " khop, "
             << r3.micros << " us\n";
    }

    // ------------------------------------------------ Kruskal = Prim
    {
        for (const Graph* g : {&hcm, &oneway, &city}) {
            Analysis::MstResult k = Analysis::kruskal(*g), p = Analysis::prim(*g);
            CHECK(near(k.km, p.km, 1e-6));
            CHECK(k.trees == p.trees);
            CHECK(static_cast<int>(k.edges.size()) == g->nodeCount() - k.trees);
            CHECK(p.edges.size() == k.edges.size());
            CHECK(k.trees == static_cast<int>(Traversal::connectedComponents(*g).size()));
            CHECK(k.km <= Analysis::totalKm(*g) + 1e-9);
            // Các cạnh MST tạo thành rừng: DSU không gặp chu trình
            Analysis::DisjointSet dsu(g->nextNodeId() + 1);
            for (auto& e : k.edges) CHECK(dsu.unite(e.u, e.v));
        }
        for (unsigned seed = 1; seed <= 20; ++seed) {
            Graph r = ShortestPath::randomGraph(60, 3, seed);
            CHECK(near(Analysis::kruskal(r).km, Analysis::prim(r).km, 1e-6));
        }
        Analysis::MstResult k = Analysis::kruskal(hcm);
        CHECK(k.trees == 2);   // cụm chính + cụm Cần Giờ
        cout << "MST HCM: " << k.km << " km / tong " << Analysis::totalKm(hcm) << " km\n";
    }

    // ------------------------------------------------ Floyd–Warshall và vị trí kho
    {
        for (const Graph* g : {&hcm, &oneway})
            for (Vehicle v : {MOTORBIKE, TRUCK, ANY_VEHICLE}) {
                vector<int> ids = g->nodeIds();
                auto all = Analysis::floydWarshall(*g, ids, v);
                for (size_t i = 0; i < ids.size(); ++i) {
                    ShortestPath::Options o;
                    o.vehicle = v;
                    auto t = ShortestPath::dijkstra(*g, ids[i], ShortestPath::Version::MIN_HEAP, o);
                    for (size_t j = 0; j < ids.size(); ++j) {
                        double d = t.dist[ids[j]];
                        CHECK((std::isinf(d) && std::isinf(all[i][j])) || near(d, all[i][j], 1e-9));
                    }
                }
            }
        vector<OrderRecord> recs;
        CHECK(FileIO::loadOrders("data/orders.txt", recs, err, &hcm));
        vector<int> dest;
        for (auto& r : recs) dest.push_back(r.destination);
        Analysis::DepotReport rep = Analysis::suggestDepot(hcm, 0, dest, MOTORBIKE, 5);
        CHECK(rep.floyd && rep.ranking.size() == 5);
        CHECK(rep.ranking[0].reachable >= rep.current.reachable);
        CHECK(rep.ranking[0].totalKm <= rep.current.totalKm + 1e-9);
        // Tổng km của ứng viên tốt nhất = cộng Dijkstra từ điểm đó tới từng điểm giao
        ShortestPath::Options o;
        o.vehicle = MOTORBIKE;
        auto t = ShortestPath::dijkstra(hcm, rep.ranking[0].node, ShortestPath::Version::MIN_HEAP, o);
        double sum = 0;
        int reach = 0;
        for (int d : dest)
            if (!std::isinf(t.dist[d])) { sum += t.dist[d]; ++reach; }
        CHECK(near(sum, rep.ranking[0].totalKm, 1e-6) && reach == rep.ranking[0].reachable);
        CHECK(rep.center >= 0);
        // Đồ thị lớn: Dijkstra ngược từ từng điểm giao, cùng kết quả với Dijkstra xuôi
        vector<OrderRecord> crecs;
        CHECK(FileIO::loadOrders("data/orders_city.txt", crecs, err, &city));
        vector<int> cdest;
        for (auto& r : crecs) cdest.push_back(r.destination);
        Analysis::DepotReport big = Analysis::suggestDepot(city, 0, cdest, MOTORBIKE, 3);
        CHECK(!big.floyd && big.ranking.size() == 3);
        auto tc = ShortestPath::dijkstra(city, big.ranking[0].node, ShortestPath::Version::MIN_HEAP, o);
        double csum = 0;
        for (int d : cdest)
            if (!std::isinf(tc.dist[d])) csum += tc.dist[d];
        CHECK(near(csum, big.ranking[0].totalKm, 1e-6));
        cout << "Vi tri kho goi y (HCM): diem " << rep.ranking[0].node << ", tong " << rep.ranking[0].totalKm
             << " km (kho hien tai " << rep.current.totalKm << " km)\n";
    }

    // ------------------------------------------------ Tình huống đặc biệt trong ca
    vector<OrderRecord> recs;
    CHECK(FileIO::loadOrders("data/orders.txt", recs, err, &hcm));
    vector<Shipper> ships;
    CHECK(loadShippers("data/shippers.txt", ships, err));
    RushProfile rush;
    auto startShift = [&](Graph& g, vector<Order>& orders, ShiftManager& shift) {
        vector<Order> pend;
        vector<int> idx;
        for (size_t i = 0; i < orders.size(); ++i)
            if (orders[i].status == PENDING) { pend.push_back(orders[i]); idx.push_back(static_cast<int>(i)); }
        Dispatcher d(g, 0, pend, ships, true);
        d.setRush(&rush, 8 * 60);
        Plan p = d.multiDeadlineInsertion();
        return shift.apply(p, idx, orders, ships);
    };
    {
        // Huỷ đơn + thất bại 2 lần -> hoàn kho
        Graph g = hcm;
        vector<Order> orders(recs.begin(), recs.end());
        ShiftManager shift;
        int n = startShift(g, orders, shift);
        CHECK(n > 0);
        int a = -1, b = -1;
        for (auto& o : orders)
            if (o.status == ASSIGNED) { if (a < 0) a = o.id; else if (b < 0) b = o.id; }
        CHECK(shift.cancel(a, orders));
        for (auto& o : orders) if (o.id == a) CHECK(o.status == CANCELLED);
        for (auto& t : shift.trips()) for (auto& s : t.stops) CHECK(s.orderId != a);
        CHECK(!shift.cancel(a, orders));
        CHECK(shift.fail(b, orders) == FAILED);
        CHECK(shift.requeue(b, orders));
        CHECK(startShift(g, orders, shift) > 0);           // điều phối lại đơn vừa đưa về hàng chờ
        CHECK(shift.fail(b, orders) == RETURNED);          // lần thứ 2: hoàn kho
        CHECK(!shift.requeue(b, orders));
        for (auto& o : orders) if (o.id == b) CHECK(o.attempts == 2);
        shift.reset(orders);
        for (auto& o : orders) CHECK(o.status == PENDING && o.attempts == 0);
    }
    {
        // Shipper nghỉ đột xuất giữa ca
        Graph g = hcm;
        vector<Order> orders(recs.begin(), recs.end());
        ShiftManager shift;
        startShift(g, orders, shift);
        shift.progress(20, orders);
        int who = -1;
        for (auto& t : shift.trips())
            for (auto& s : t.stops)
                for (auto& o : orders)
                    if (o.id == s.orderId && o.status == ASSIGNED && who < 0) who = t.shipper;
        CHECK(who >= 0);
        int pendingBefore = 0;
        for (auto& o : orders) pendingBefore += o.status == PENDING;
        int back = shift.shipperAbsent(who, ships[who].name, orders);
        CHECK(back > 0);
        int pendingAfter = 0;
        for (auto& o : orders) pendingAfter += o.status == PENDING;
        CHECK(pendingAfter == pendingBefore + back);
        CHECK(shift.isAbsent(who));
        for (auto& t : shift.trips())
            if (t.shipper == who) {
                CHECK(t.pathTimes.back() >= 20 - 1e-9);          // dừng ở đỉnh kế tiếp
                for (size_t i = 0; i + 1 < t.pathTimes.size(); ++i) CHECK(t.pathTimes[i] <= 20 + 1e-9);
                for (auto& s : t.stops)
                    for (auto& o : orders) if (o.id == s.orderId) CHECK(o.status != PENDING);
            }
        shift.setAvailable(who);
        CHECK(!shift.isAbsent(who));
    }
    {
        // Đóng đường giữa ca: chuyến tránh đoạn bị đóng, giờ tới không sớm hơn
        Graph g = hcm;
        vector<Order> orders(recs.begin(), recs.end());
        ShiftManager shift;
        startShift(g, orders, shift);
        shift.progress(20, orders);
        // Tìm một đoạn phía trước của chuyến có đơn chưa giao
        int cu = -1, cv = -1;
        double oldEnd = 0;
        for (auto& t : shift.trips()) {
            for (size_t i = 1; i < t.path.size(); ++i)
                if (t.pathTimes[i - 1] > 20 + 1e-9) { cu = t.path[i - 1]; cv = t.path[i]; oldEnd = t.pathTimes.back(); break; }
            if (cu >= 0) break;
        }
        CHECK(cu >= 0);
        CHECK(g.setTraffic(cu, cv, 1, true));
        RerouteReport rep = shift.reroute(g, 0, &rush, 8 * 60, orders);
        CHECK(rep.rerouted >= 1);
        for (auto& t : shift.trips()) {
            for (size_t i = 1; i < t.path.size(); ++i) {
                CHECK(g.hasEdge(t.path[i - 1], t.path[i]));
                if (t.pathTimes[i - 1] > 20 + 1e-9) CHECK(vehicleAllowed(*g.getEdge(t.path[i - 1], t.path[i]), t.vehicle));
                CHECK(t.pathTimes[i] >= t.pathTimes[i - 1] - 1e-9);
            }
            for (auto& s : t.stops) {
                CHECK(s.pathIndex >= 0 && s.pathIndex < (int)t.path.size());
                for (auto& o : orders)
                    if (o.id == s.orderId && o.status == ASSIGNED) {
                        CHECK(t.path[s.pathIndex] == o.destination);
                        CHECK(near(o.eta, s.eta) && near(t.pathTimes[s.pathIndex], s.eta));
                    }
            }
        }
        CHECK(rep.maxDelay >= -1e-6);
        (void)oldEnd;
        // Kẹt xe x3 trên đoạn còn phía trước: giữ đường, giờ tới muộn hơn
        Graph g2 = hcm;
        vector<Order> o2(recs.begin(), recs.end());
        ShiftManager s2;
        startShift(g2, o2, s2);
        s2.progress(20, o2);
        double end0 = 0;
        int ju = -1, jv = -1;
        for (auto& t : s2.trips()) {
            for (size_t i = 1; i < t.path.size(); ++i)
                if (t.pathTimes[i - 1] > 20 + 1e-9) { ju = t.path[i - 1]; jv = t.path[i]; end0 = t.pathTimes.back(); break; }
            if (ju >= 0) break;
        }
        vector<int> pathBefore;
        for (auto& t : s2.trips()) if (t.pathTimes.back() == end0) pathBefore = t.path;
        CHECK(g2.setTraffic(ju, jv, 3, false));
        RerouteReport r2 = s2.reroute(g2, 0, &rush, 8 * 60, o2);
        CHECK(r2.rerouted == 0 && r2.retimed >= 1 && r2.maxDelay > 0);
        bool samePath = false;
        for (auto& t : s2.trips()) if (t.path == pathBefore) samePath = true;
        CHECK(samePath);
        // Đóng mọi đường vào một điểm giao còn chờ: đơn đó trả về hàng chờ
        Graph g3 = hcm;
        vector<Order> o3(recs.begin(), recs.end());
        ShiftManager s3;
        startShift(g3, o3, s3);
        s3.progress(1, o3);
        int target = -1, targetOrder = -1;
        for (auto& t : s3.trips())
            for (auto& s : t.stops)
                if (target < 0 && s.eta > 30) { target = s.node; targetOrder = s.orderId; }
        CHECK(target >= 0);
        for (const Edge& e : vector<Edge>(g3.neighbors(target))) g3.setTraffic(target, e.to, 1, true);
        RerouteReport r3 = s3.reroute(g3, 0, &rush, 8 * 60, o3);
        CHECK(std::find(r3.dropped.begin(), r3.dropped.end(), targetOrder) != r3.dropped.end());
        for (auto& o : o3) if (o.id == targetOrder) CHECK(o.status == PENDING);
        cout << "Tinh lai tuyen: doi " << rep.rerouted << " chuyen, tre them " << rep.maxDelay << " phut; ket x3: +"
             << r2.maxDelay << " phut\n";
    }

    cout << "\n>>> TAT CA " << passed << " KIEM TRA DEU DAT <<<\n";
    return 0;
}
