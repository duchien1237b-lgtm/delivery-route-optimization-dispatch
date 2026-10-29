// ============================================================================
// test_features.cpp — Kiểm tra các chức năng bổ sung:
//   kẹt xe / đóng đường, Hoàn tác–Làm lại (2 ngăn xếp), Trie tìm điểm,
//   K tuyến ngắn nhất (Yen), vận hành ca giao (áp dụng, giao, thất bại, giao lại),
//   giờ cao điểm (Dijkstra / Bellman-Ford phụ thuộc thời gian, dự toán, điều phối),
//   A*, mô phỏng từng bước (Trace), phương án điều phối theo hạn giao, bản đồ đô thị lớn.
// Chạy từ thư mục gốc repo (đọc data/*.txt).
// ============================================================================
#include "BellmanFord.h"
#include "Dispatcher.h"
#include "Estimator.h"
#include "FileIO.h"
#include "History.h"
#include "Operations.h"
#include "ShortestPath.h"
#include "Trie.h"
#include "Trace.h"
#include "Traversal.h"

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

static bool near(double a, double b) { return fabs(a - b) < 1e-6; }

int main() {
    string err;
    Graph g;
    CHECK(FileIO::loadMap("data/map.txt", g, err));
    using namespace ShortestPath;

    // ------------------------------------------------- Kẹt xe / đóng đường
    {
        Graph t = g;
        Options byTime;
        byTime.criterion = Criterion::TIME;
        double before = dijkstra(t, 0, Version::MIN_HEAP, byTime).dist[7];
        vector<int> p0 = getPath(dijkstra(t, 0, Version::MIN_HEAP, byTime), 7);
        CHECK(p0.size() >= 3);
        // Kẹt xe x3 trên đoạn đầu tiên của tuyến -> thời gian tăng hoặc đổi tuyến
        CHECK(t.setTraffic(p0[0], p0[1], 3, false));
        CHECK(t.getEdge(p0[1], p0[0])->jam == 3);  // vô hướng: cả hai chiều
        CHECK(near(travelMinutes(*t.getEdge(p0[0], p0[1]), ANY_VEHICLE), g.getEdge(p0[0], p0[1])->time * 3));
        double jammed = dijkstra(t, 0, Version::MIN_HEAP, byTime).dist[7];
        CHECK(jammed > before);
        CHECK(t.trafficCount() == 1);
        // Đóng đường: tuyến mới không được đi qua đoạn đó
        CHECK(t.setTraffic(p0[0], p0[1], 1, true));
        vector<int> p1 = getPath(dijkstra(t, 0, Version::MIN_HEAP, byTime), 7);
        CHECK(!p1.empty());
        for (size_t i = 0; i + 1 < p1.size(); ++i) CHECK(!(p1[i] == p0[0] && p1[i + 1] == p0[1]));
        CHECK(!vehicleAllowed(*t.getEdge(p0[0], p0[1]), MOTORBIKE));
        // Sửa thông số đường không làm mất tình trạng giao thông
        const Edge* e = t.getEdge(p0[0], p0[1]);
        CHECK(t.updateEdge(p0[0], p0[1], e->distance, e->time, e->cost, e->allowed));
        CHECK(t.getEdge(p0[0], p0[1])->closed);
        t.clearTraffic();
        CHECK(t.trafficCount() == 0 && near(dijkstra(t, 0, Version::MIN_HEAP, byTime).dist[7], before));
        cout << "Ket xe: 0 -> 7 tu " << before << " len " << jammed << " phut\n";
    }

    // ------------------------------------------------- Hoàn tác / Làm lại
    {
        UndoRedo<int> h(3);
        int cur = 0;
        for (int v = 1; v <= 4; ++v) { h.record(cur, "dat " + to_string(v)); cur = v; }
        CHECK(h.undoSize() == 3);                 // giới hạn 3 bước: bỏ bước cũ nhất
        string label;
        CHECK(h.undo(cur, &label) && cur == 3 && label == "dat 4");
        CHECK(h.undo(cur) && cur == 2);
        CHECK(h.redo(cur) && cur == 3);
        CHECK(h.canUndo() && h.canRedo() && h.redoLabel() == "dat 4");
        h.record(cur, "nhanh moi");               // thao tác mới xoá ngăn làm lại
        cur = 99;
        CHECK(!h.canRedo());
        CHECK(h.undo(cur) && cur == 3);
        CHECK(h.undo(cur) && cur == 2 && h.undo(cur) && cur == 1);
        CHECK(!h.undo(cur) && cur == 1);          // hết bước
        cout << "UndoRedo: OK\n";
    }

    // ------------------------------------------------- Trie tìm điểm
    {
        CHECK(normalizeVi("Chợ Bến Thành") == "cho ben thanh");
        CHECK(normalizeVi("  ĐẦM   Sen!! ") == "dam sen");
        CHECK(normalizeVi("Sân bay Tân Sơn Nhất") == "san bay tan son nhat");
        Trie tr;
        tr.insert("ben", 1); tr.insert("benh", 2); tr.insert("ba", 3); tr.insert("ben", 1);
        auto r = tr.withPrefix("ben");
        CHECK(set<int>(r.begin(), r.end()) == (set<int>{1, 2}));
        CHECK(tr.withPrefix("x").empty());
        CHECK(tr.withPrefix("").size() == 3);

        PlaceIndex idx;
        idx.build(g);
        auto s1 = idx.search("ben thanh");
        CHECK(!s1.empty() && g.getNode(s1[0]).name == "Chợ Bến Thành");
        auto s2 = idx.search("cho");                 // Chợ Bến Thành, Chợ Lớn, Cần Giờ - Chợ Cần Thạnh
        CHECK(s2.size() == 3);
        CHECK(g.getNode(s2[2]).name == "Cần Giờ - Chợ Cần Thạnh");  // khớp từ đầu tên xếp trước
        auto s3 = idx.search("SAN BAY");
        CHECK(s3.size() == 1 && s3[0] == 9);
        CHECK(idx.search("7").size() >= 1 && idx.search("7")[0] == 7);  // tìm theo mã điểm
        CHECK(idx.search("khong co").empty());
        CHECK(idx.search("c gio").size() == 2);       // "Cần Giờ - ..." x2
        cout << "Trie: \"ben thanh\" -> " << g.getNode(s1[0]).name << "\n";
    }

    // ------------------------------------------------- K tuyến ngắn nhất (Yen)
    {
        // Đồ thị nhỏ có hướng, biết trước đáp án
        Graph h(true);
        for (int i = 0; i < 6; ++i) h.addNode(i, "N" + to_string(i));
        // C=0 D=1 E=2 F=3 G=4 H=5 (ví dụ kinh điển của Yen)
        h.addEdge(0, 1, 3, 1, 0); h.addEdge(0, 2, 2, 1, 0); h.addEdge(1, 3, 4, 1, 0);
        h.addEdge(2, 1, 1, 1, 0); h.addEdge(2, 3, 2, 1, 0); h.addEdge(2, 4, 3, 1, 0);
        h.addEdge(3, 4, 2, 1, 0); h.addEdge(3, 5, 1, 1, 0); h.addEdge(4, 5, 2, 1, 0);
        auto k = kShortestPaths(h, 0, 5, 3);
        CHECK(k.size() == 3);
        CHECK(near(k[0].weight, 5) && k[0].nodes == (vector<int>{0, 2, 3, 5}));
        CHECK(near(k[1].weight, 7) && near(k[2].weight, 8));
        // Trên bản đồ thật: tăng dần, không lặp đỉnh, khác nhau, tuyến 1 = Dijkstra
        auto kp = kShortestPaths(g, 0, 7, 4);
        CHECK(kp.size() >= 2);
        CHECK(near(kp[0].weight, dijkstra(g, 0, Version::MIN_HEAP).dist[7]));
        set<vector<int>> uniq;
        for (size_t i = 0; i < kp.size(); ++i) {
            if (i) CHECK(kp[i].weight >= kp[i - 1].weight - 1e-9);
            CHECK(set<int>(kp[i].nodes.begin(), kp[i].nodes.end()).size() == kp[i].nodes.size());
            CHECK(kp[i].nodes.front() == 0 && kp[i].nodes.back() == 7);
            uniq.insert(kp[i].nodes);
        }
        CHECK(uniq.size() == kp.size());
        CHECK(kShortestPaths(g, 0, 12, 3).empty());   // Cần Giờ: không có đường
        cout << "Yen: " << kp.size() << " tuyen 0 -> 7, ngan nhat " << kp[0].weight << " km, tuyen " << kp.size()
             << ": " << kp.back().weight << " km\n";
    }

    // ------------------------------------------------- Vận hành ca giao
    {
        vector<OrderRecord> recs;
        CHECK(FileIO::loadOrders("data/orders.txt", recs, err, &g));
        vector<Order> orders(recs.begin(), recs.end());
        vector<Shipper> ships;
        CHECK(loadShippers("data/shippers.txt", ships, err));
        vector<int> idx;
        for (size_t i = 0; i < orders.size(); ++i) idx.push_back(static_cast<int>(i));

        Dispatcher d(g, 0, orders, ships, true);
        Plan plan = d.multiInsertionTsp();
        // Mốc thời gian dọc lộ trình: tăng dần, khớp giờ tới từng điểm giao
        for (const Route& r : plan.routes) {
            CHECK(r.pathTimes.size() == r.path.size());
            for (size_t i = 1; i < r.pathTimes.size(); ++i) CHECK(r.pathTimes[i] >= r.pathTimes[i - 1] - 1e-9);
            for (size_t i = 0; i < r.orders.size(); ++i) {
                CHECK(r.path[r.stopIndex[i]] == orders[r.orders[i]].destination);
                CHECK(near(r.pathTimes[r.stopIndex[i]], r.arrival[i]));
            }
            if (!r.orders.empty()) CHECK(near(r.pathTimes.back(), r.minutes - r.orders.size() * 5) || r.pathTimes.back() <= r.minutes);
        }

        ShiftManager shift;
        int n = shift.apply(plan, idx, orders, ships);
        CHECK(n == plan.served && n == 7);
        CHECK(shift.active() && shift.history().size() == 1);
        int assigned = 0;
        for (const Order& o : orders) assigned += o.status == ASSIGNED;
        CHECK(assigned == 7);                       // đơn Cần Giờ vẫn chờ
        double firstEta = 1e9, lastEta = 0;
        for (const Trip& t : shift.trips())
            for (const TripStop& s : t.stops) { firstEta = min(firstEta, s.eta); lastEta = max(lastEta, s.eta); }
        CHECK(shift.progress(firstEta - 0.01, orders) == 0);
        CHECK(shift.progress(firstEta, orders) >= 1);
        // Báo thất bại một đơn còn đang giao, rồi đưa lại hàng chờ
        int victim = -1;
        for (const Order& o : orders) if (o.status == ASSIGNED) { victim = o.id; break; }
        CHECK(victim > 0 && shift.fail(victim, orders) == FAILED);
        CHECK(shift.fail(victim, orders) < 0);      // đã thất bại rồi
        CHECK(shift.progress(lastEta + 1, orders) >= 1);
        int delivered = 0, failed = 0;
        for (const Order& o : orders) { delivered += o.status == DELIVERED; failed += o.status == FAILED; }
        CHECK(delivered == 6 && failed == 1);
        for (const Order& o : orders) if (o.status == DELIVERED) CHECK(o.deliveredAt >= 0);
        CHECK(shift.requeue(victim, orders));
        for (const Trip& t : shift.trips()) for (const TripStop& s : t.stops) CHECK(s.orderId != victim);

        // Điều phối lại giữa ca: chuyến mới xuất phát từ thời điểm hiện tại
        vector<Order> pend;
        vector<int> pidx;
        for (size_t i = 0; i < orders.size(); ++i)
            if (orders[i].status == PENDING && orders[i].destination != 12) { pend.push_back(orders[i]); pidx.push_back((int)i); }
        CHECK(pend.size() == 1);
        Dispatcher d2(g, 0, pend, ships, true);
        d2.setStartTime(shift.clock());
        Plan p2 = d2.multiNearestNeighbor();
        CHECK(shift.apply(p2, pidx, orders, ships) == 1);
        CHECK(shift.trips().back().pathTimes.front() >= shift.clock() - 1e-9);
        CHECK(shift.history().size() == 2);

        shift.reset(orders);
        CHECK(!shift.active() && shift.clock() == 0);
        for (const Order& o : orders) CHECK(o.status == PENDING);
        CHECK(string(orderStatusName(DELIVERED)) == "Đã giao");
        cout << "Ca giao: " << n << " don phan cong, giao xong luc " << lastEta << " phut\n";
    }

    // ------------------------------------------------- Giờ cao điểm
    {
        RushProfile rush;   // 7:00-8:30 và 17:00-18:30, tăng/giảm dần 60 phút
        CHECK(near(rush.level(3 * 60), 0));
        CHECK(near(rush.level(7 * 60 + 30), 1));
        CHECK(near(rush.level(6 * 60 + 30), 0.5));   // đang tăng dần
        CHECK(near(rush.level(9 * 60), 0.5));        // đang giảm dần
        CHECK(near(rush.level(17 * 60 + 30 + 1440), 1));  // ngày hôm sau vẫn đúng
        RushProfile off = rush;
        off.enabled = false;
        CHECK(near(off.level(7 * 60 + 30), 0));

        const Edge* central = g.getEdge(0, 2);   // hệ số 2,2 trong data/map.txt
        CHECK(central && near(central->peak, 2.2));
        CHECK(near(rush.multiplier(*central, CAR, 7 * 60 + 30), 2.2));
        CHECK(near(rush.multiplier(*central, MOTORBIKE, 7 * 60 + 30), 1.6));  // xe máy độ nhạy 0,5
        CHECK(near(rush.multiplier(*central, CAR, 12 * 60), 1));

        // Ngoài giờ cao điểm: Dijkstra theo giờ trùng Dijkstra thường
        Options base;
        base.criterion = Criterion::TIME;
        base.vehicle = CAR;
        Tree plain = dijkstra(g, 0, Version::MIN_HEAP, base);
        Options noon = base;
        noon.departAt = 12 * 60;
        noon.rush = &rush;
        Tree tdNoon = dijkstra(g, 0, Version::MIN_HEAP, noon);
        for (int id : g.nodeIds()) CHECK(plain.dist[id] == tdNoon.dist[id] || near(plain.dist[id], tdNoon.dist[id]));

        // 7:30: tuyến qua trung tâm kẹt nặng -> Kho -> Đầm Sen đi vòng qua sân bay
        Options peak = base;
        peak.departAt = 7 * 60 + 30;
        peak.rush = &rush;
        vector<int> offPath = getPath(plain, 8);
        CHECK((offPath == vector<int>{0, 2, 1, 7, 8}));
        Tree tdPeak = dijkstra(g, 0, Version::MIN_HEAP, peak);
        vector<int> peakPath = getPath(tdPeak, 8);
        CHECK((peakPath == vector<int>{0, 11, 9, 6, 8}));
        PathInfo viaCenter = describePath(g, offPath, CAR, peak.departAt, &rush);
        PathInfo detour = describePath(g, peakPath, CAR, peak.departAt, &rush);
        CHECK(near(detour.minutes, tdPeak.dist[8]));
        CHECK(detour.minutes < viaCenter.minutes);
        CHECK(viaCenter.minutes > viaCenter.minutesBase * 1.5);
        // Cả 3 phiên bản Dijkstra và Bellman-Ford cho cùng kết quả theo giờ
        for (Version v : {Version::ARRAY, Version::STL_PQ}) {
            Tree t = dijkstra(g, 0, v, peak);
            for (int id : g.nodeIds()) CHECK(near(t.dist[id], tdPeak.dist[id]) || (std::isinf(t.dist[id]) && std::isinf(tdPeak.dist[id])));
        }
        BFResult bf = bellmanFord(g, 0, Criterion::TIME, CAR, peak.departAt, &rush);
        CHECK(near(bf.khoangCach[8], tdPeak.dist[8]));

        // Tính FIFO: xuất phát muộn hơn thì không tới sớm hơn
        double lastArrival = -1;
        for (int t = 5 * 60; t <= 10 * 60; t += 5) {
            Options o = base;
            o.departAt = t;
            o.rush = &rush;
            double arrive = t + dijkstra(g, 0, Version::MIN_HEAP, o).dist[8];
            CHECK(arrive >= lastArrival - 1e-9);
            lastArrival = arrive;
        }

        // Yen theo giờ: tuyến đầu tiên chính là tuyến nhanh nhất lúc 7:30
        auto kp = kShortestPaths(g, 0, 8, 3, peak);
        CHECK(kp.size() >= 2 && kp[0].nodes == peakPath && near(kp[0].weight, tdPeak.dist[8]));
        CHECK(kp[1].weight >= kp[0].weight - 1e-9);

        // Dự toán: cùng tuyến, đi lúc 7:30 lâu hơn đi lúc 12:00
        Estimate e1 = estimateMultiStop(g, 0, {1, 7}, CAR, true, 12 * 60, &rush);
        Estimate e2 = estimateMultiStop(g, 0, {1, 7}, CAR, true, 7 * 60 + 30, &rush);
        CHECK(e1.hopLe && e2.hopLe && near(e1.quangDuongKm, e2.quangDuongKm));
        CHECK(near(e1.thoiGianPhut, e1.thoiGianGoc));
        CHECK(e2.thoiGianPhut > e1.thoiGianPhut + 5 && near(e2.thoiGianGoc, e1.thoiGianGoc));

        // Điều phối: ca 7:00 chạy lâu hơn ca 10:00 (cùng thứ tự giao vì tối ưu theo km)
        vector<OrderRecord> recs;
        CHECK(FileIO::loadOrders("data/orders.txt", recs, err, &g));
        vector<Order> ords(recs.begin(), recs.end());
        vector<Shipper> ships{{"A", 20, MOTORBIKE}, {"B", 50, CAR}};
        Dispatcher dEarly(g, 0, ords, ships, true), dLate(g, 0, ords, ships, true), dNone(g, 0, ords, ships, true);
        dEarly.setRush(&rush, 7 * 60);
        dLate.setRush(&rush, 10 * 60);
        Plan pe = dEarly.multiInsertion2Opt(), pl = dLate.multiInsertion2Opt(), pn = dNone.multiInsertion2Opt();
        CHECK(near(pe.km, pl.km) && near(pl.km, pn.km));
        CHECK(near(pl.minutes, pn.minutes));
        CHECK(pe.minutes > pl.minutes + 5);
        double delay = 0;
        for (const Route& r : pe.routes) delay += r.rushDelay;
        CHECK(delay > 5);
        for (const Route& r : pl.routes) CHECK(r.rushDelay < 1e-6);
        CHECK(pe.late >= pl.late);
        cout << "Gio cao diem: Kho -> Dam Sen luc 7:30 di vong " << detour.minutes << " phut (qua trung tam "
             << viaCenter.minutes << "), ca 7:00 cham them " << delay << " phut\n";
    }

    // ------------------------------------------------- A*
    {
        Graph city;
        CHECK(FileIO::loadMap("data/map_city.txt", city, err));
        CHECK(city.nodeCount() == 2000 && Traversal::isConnected(city));
        long long settledD = 0, settledA = 0;
        for (const Graph* gp : {&g, &city})
            for (Criterion crit : {Criterion::DISTANCE, Criterion::TIME, Criterion::COST})
                for (Vehicle v : {MOTORBIKE, CAR, TRUCK, ANY_VEHICLE}) {
                    vector<int> ids = gp->nodeIds();
                    for (size_t k = 0; k < 12; ++k) {
                        int a = ids[(k * 7919) % ids.size()], b = ids[(k * 104729 + 13) % ids.size()];
                        Options o;
                        o.criterion = crit;
                        o.vehicle = v;
                        o.target = b;
                        Tree d = dijkstra(*gp, a, Version::MIN_HEAP, o);
                        Tree s = astar(*gp, a, b, o);
                        CHECK(d.dist[b] == s.dist[b] || near(d.dist[b], s.dist[b]));
                        if (s.dist[b] != INF) {
                            vector<int> p = getPath(s, b);
                            CHECK(!p.empty() && p.front() == a && p.back() == b);
                            PathInfo pi = describePath(*gp, p, v);
                            double w = crit == Criterion::DISTANCE ? pi.km : crit == Criterion::TIME ? pi.minutes : pi.costK;
                            CHECK(near(w, s.dist[b]));
                        }
                        CHECK(s.settleOrder.size() <= d.settleOrder.size());
                        if (gp == &city) { settledD += (long long)d.settleOrder.size(); settledA += (long long)s.settleOrder.size(); }
                    }
                }
        CHECK(settledA * 2 < settledD);   // trên bản đồ lớn A* xét ít hơn một nửa số đỉnh
        // Giờ cao điểm: A* theo giờ trùng Dijkstra theo giờ
        RushProfile rush;
        Options o;
        o.criterion = Criterion::TIME;
        o.vehicle = CAR;
        o.departAt = 7 * 60 + 30;
        o.rush = &rush;
        o.target = 8;
        CHECK(near(astar(g, 0, 8, o).dist[8], dijkstra(g, 0, Version::MIN_HEAP, o).dist[8]));
        CHECK(near(straightLineKm(g.getNode(0), g.getNode(0)), 0));
        cout << "A*: tren do thi 2000 diem xet " << settledA << " dinh, Dijkstra xet " << settledD << " dinh\n";
    }

    // ------------------------------------------------- Mô phỏng từng bước (Trace)
    {
        for (Criterion crit : {Criterion::DISTANCE, Criterion::TIME, Criterion::COST}) {
            Options o;
            o.criterion = crit;
            Tree full = dijkstra(g, 0, Version::MIN_HEAP, o);
            Trace::Result t = Trace::run(g, "dijkstra", 0, -1, crit, ANY_VEHICLE);
            CHECK(!t.truncated && t.containerKind == "heap" && t.steps.front().type == "init" && t.steps.back().type == "done");
            for (int id : g.nodeIds()) CHECK(t.dist[id] == full.dist[id] || near(t.dist[id], full.dist[id]));
            // Mỗi lần lấy ra là đúng khoá nhỏ nhất của heap trước đó (thuộc tính Min-Heap)
            for (size_t i = 1; i < t.steps.size(); ++i)
                if (t.steps[i].type == "pop") {
                    double mn = INF;
                    for (const auto& [id, k] : t.steps[i - 1].container) mn = std::min(mn, k);
                    CHECK(near(t.steps[i].extra, mn));
                    CHECK(t.steps[i - 1].container.front().first == t.steps[i].u);   // gốc heap
                }
            Trace::Result ta = Trace::run(g, "astar", 0, 8, crit, ANY_VEHICLE);
            CHECK(ta.steps.back().type == "done" && near(ta.dist[8], full.dist[8]));
            Trace::Result tb = Trace::run(g, "bellman", 0, -1, crit, ANY_VEHICLE);
            BFResult bf = bellmanFord(g, 0, crit, ANY_VEHICLE);
            for (int id : g.nodeIds()) CHECK(tb.dist[id] == (bf.khoangCach[id] >= VO_CUC ? INF : bf.khoangCach[id]) || near(tb.dist[id], bf.khoangCach[id]));
        }
        // BFS / DFS: cùng thứ tự thăm với module Traversal
        Trace::Result tq = Trace::run(g, "bfs", 0, -1, Criterion::DISTANCE, ANY_VEHICLE);
        vector<int> order;
        for (const auto& s : tq.steps) if (s.type == "pop") order.push_back(s.u);
        CHECK(order == Traversal::bfs(g, 0));
        Trace::Result ts = Trace::run(g, "dfs", 0, -1, Criterion::DISTANCE, ANY_VEHICLE);
        order.clear();
        for (const auto& s : ts.steps) if (s.type == "pop") order.push_back(s.u);
        CHECK(order == Traversal::dfsIterative(g, 0));
        // Chu trình âm được phát hiện trong mô phỏng Bellman-Ford
        Graph neg;
        CHECK(FileIO::loadMap("data/map_negcycle.txt", neg, err));
        Trace::Result tn = Trace::run(neg, "bellman", 0, -1, Criterion::COST, ANY_VEHICLE);
        bool cyc = false;
        for (const auto& s : tn.steps) cyc = cyc || s.type == "cycle";
        CHECK(cyc && tn.cycle.size() >= 3 && tn.cycle.front() == tn.cycle.back());
        // Giới hạn số bước
        Trace::Result small = Trace::run(g, "dijkstra", 0, -1, Criterion::DISTANCE, ANY_VEHICLE, 5);
        CHECK(small.truncated && small.steps.size() == 5);
    }

    // ------------------------------------------------- Phương án theo hạn giao
    {
        vector<OrderRecord> recs;
        CHECK(FileIO::loadOrders("data/orders.txt", recs, err, &g));
        vector<Order> ords(recs.begin(), recs.end());
        vector<Shipper> ships;
        CHECK(loadShippers("data/shippers.txt", ships, err));
        RushProfile rush;
        for (int start : {7 * 60, 8 * 60, 10 * 60}) {
            Dispatcher d(g, 0, ords, ships, true);
            d.setRush(&rush, start);
            DispatchReport rep = d.compareAll(MOTORBIKE);
            const Plan* best = nullptr;
            for (const Plan& p : rep.multi) if (p.key == "deadline") best = &p;
            CHECK(best != nullptr);
            for (const Plan& p : rep.multi) {
                if (p.key == "deadline") continue;
                // không phục vụ ít đơn hơn; nếu bằng thì không trễ nhiều hơn; nếu bằng nữa thì không đi xa hơn
                CHECK(best->served >= p.served);
                if (best->served == p.served) {
                    CHECK(best->late <= p.late);
                    if (best->late == p.late) CHECK(best->km <= p.km + 1e-6);
                }
            }
            for (const Route& r : best->routes) {
                CHECK(r.shipper < 0 || r.load <= ships[r.shipper].capacity + 1e-9);
                for (size_t i = 0; i + 1 < r.path.size(); ++i) CHECK(g.hasEdge(r.path[i], r.path[i + 1]));
            }
        }
        // Bản đồ lớn: điều phối 24 đơn vẫn chạy, mọi đơn đều có mặt đúng một lần
        Graph city;
        CHECK(FileIO::loadMap("data/map_city.txt", city, err));
        vector<OrderRecord> crecs;
        CHECK(FileIO::loadOrders("data/orders_city.txt", crecs, err, &city));
        vector<Order> cords(crecs.begin(), crecs.end());
        Dispatcher dc(city, 0, cords, ships, true);
        Plan pc = dc.multiDeadlineInsertion();
        std::multiset<int> seen;
        for (const Route& r : pc.routes) for (int o : r.orders) seen.insert(o);
        for (int o : pc.overweight) seen.insert(o);
        for (int o : pc.unreachable) seen.insert(o);
        CHECK(seen.size() == cords.size());
        for (int o = 0; o < (int)cords.size(); ++o) CHECK(seen.count(o) == 1);
        cout << "Theo han giao: do thi lon giao " << pc.served << "/" << cords.size() << " don, tre " << pc.late << "\n";
    }

    cout << "\n>>> TAT CA " << passed << " KIEM TRA DEU DAT <<<\n";
    return 0;
}
