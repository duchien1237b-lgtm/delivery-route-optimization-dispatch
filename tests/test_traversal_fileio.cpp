// ============================================================================
// test_traversal_fileio.cpp — Chạy thử + kiểm tra tự động phần Duyệt đồ thị & File IO
// Biên dịch (từ thư mục gốc repo):
//   g++ -std=c++17 -Wall -Isrc src/Graph.cpp src/Traversal.cpp src/FileIO.cpp tests/test_traversal_fileio.cpp -o test_traversal
// Chạy    :  ./test_traversal   (đọc data/map.txt và data/orders.txt)
// KHÔNG phải main.cpp của project — chỉ để tự test trước khi tạo PR.
// ============================================================================
#include "FileIO.h"
#include "Traversal.h"

#include <cassert>
#include <fstream>
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

static void printList(const Graph& g, const string& title, const vector<int>& v) {
    cout << title;
    for (size_t i = 0; i < v.size(); ++i)
        cout << (i ? " -> " : "") << v[i] << "(" << g.getNode(v[i]).name << ")";
    cout << (v.empty() ? "(rong)" : "") << "\n";
}

static void writeFile(const string& path, const string& content) {
    ofstream(path) << content;
}

int main() {
    string err;

    // ---------------------------------------------------------------- Đọc map
    Graph g;
    if (!FileIO::loadMap("data/map.txt", g, err)) {
        cerr << "Loi doc map: " << err << "\n";
        return 1;
    }
    cout << "== Doc data/map.txt: " << g.nodeCount() << " nut, " << g.edgeCount()
         << " canh, " << (g.isDirected() ? "co huong" : "vo huong") << "\n";
    CHECK(g.nodeCount() == 14 && g.edgeCount() == 17 && !g.isDirected());

    // ---------------------------------------------------------------- BFS/DFS
    cout << "\n== Duyet tu Kho Binh Thanh (0)\n";
    auto b = Traversal::bfs(g, 0);
    auto d = Traversal::dfs(g, 0);
    auto di = Traversal::dfsIterative(g, 0);
    printList(g, "BFS: ", b);
    printList(g, "DFS: ", d);
    CHECK(b.size() == 12 && d.size() == 12);   // 12 nút đất liền, không tới Cần Giờ
    CHECK(b.front() == 0 && d.front() == 0);
    CHECK(d == di);                            // 2 bản DFS phải cùng thứ tự
    CHECK(Traversal::bfs(g, 999).empty());     // nút không tồn tại

    auto p = Traversal::bfsPath(g, 7, 11);
    printList(g, "Duong it chang nhat 7 -> 11: ", p);
    CHECK(p.front() == 7 && p.back() == 11 && p.size() == 5);  // 7-1-2-0-11 (4 chặng)
    CHECK(Traversal::bfsPath(g, 3, 3) == vector<int>{3});
    CHECK(!Traversal::hasPath(g, 0, 13));

    // ------------------------------------------------------------- Liên thông
    cout << "\n== Lien thong\n";
    auto comps = Traversal::connectedComponents(g);
    for (size_t i = 0; i < comps.size(); ++i) {
        cout << "Thanh phan " << i + 1 << " (" << comps[i].size() << " nut):";
        for (int u : comps[i]) cout << ' ' << u;
        cout << "\n";
    }
    CHECK(comps.size() == 2 && comps[1] == (vector<int>{12, 13}));
    CHECK(!Traversal::isConnected(g));
    CHECK(Traversal::unreachableFrom(g, 0) == (vector<int>{12, 13}));

    // ---------------------------------------------------------- Vùng giao hàng
    cout << "\n== Vung giao hang trong 2 chang tu kho 0:";
    auto zone = Traversal::deliveryZone(g, 0, 2);
    for (auto [u, h] : zone) cout << ' ' << u << "(" << h << ")";
    cout << "\n";
    CHECK(zone.size() == 9 && zone.count(1) && !zone.count(7) && zone.at(0) == 0);
    CHECK(Traversal::deliveryZone(g, 0, 0).size() == 1);

    cout << "== Chia vung cho 2 kho {0, 7}:\n";
    auto za = Traversal::assignZones(g, {0, 7});
    for (int depot : {0, 7}) {
        cout << "  Kho " << depot << ":";
        for (auto [u, owner] : za.owner) if (owner == depot) cout << ' ' << u;
        cout << "\n";
    }
    cout << "  Khong kho nao toi:";
    for (int u : za.unassigned) cout << ' ' << u;
    cout << "\n";
    CHECK(za.owner.at(8) == 7 && za.owner.at(11) == 0);
    CHECK(za.unassigned == (vector<int>{12, 13}));

    // ------------------------------------------------- Đồ thị có hướng (SCC)
    Graph dg(true);
    for (int i = 0; i < 6; ++i) dg.addNode(i, "N" + to_string(i));
    dg.addEdge(0, 1, 1, 1, 1); dg.addEdge(1, 2, 1, 1, 1); dg.addEdge(2, 0, 1, 1, 1);  // chu trình 0-1-2
    dg.addEdge(2, 3, 1, 1, 1); dg.addEdge(3, 4, 1, 1, 1); dg.addEdge(4, 3, 1, 1, -5); // chu trình 3-4
    // nút 5 cô lập
    auto scc = Traversal::stronglyConnectedComponents(dg);
    CHECK(scc == (vector<vector<int>>{{0, 1, 2}, {3, 4}, {5}}));
    CHECK(Traversal::connectedComponents(dg).size() == 2);  // liên thông yếu
    CHECK(Traversal::hasPath(dg, 0, 4) && !Traversal::hasPath(dg, 4, 0));
    cout << "\n== Do thi co huong: " << scc.size() << " thanh phan lien thong manh (OK)\n";

    // ------------------------------------------------------------- Đơn hàng
    vector<OrderRecord> orders;
    if (!FileIO::loadOrders("data/orders.txt", orders, err, &g)) {
        cerr << "Loi doc orders: " << err << "\n";
        return 1;
    }
    cout << "\n== Doc data/orders.txt: " << orders.size() << " don\n";
    CHECK(orders.size() == 8 && orders[0].urgent && orders[0].note == "Tài liệu hợp đồng");
    for (const auto& o : orders)
        if (!za.owner.count(o.destination))
            cout << "  [Canh bao] Don " << o.id << " -> " << g.getNode(o.destination).name
                 << ": khong kho nao toi duoc!\n";

    // ------------------------------------------------ Ghi rồi đọc lại (round-trip)
    CHECK(FileIO::saveMap("out_map.txt", g, err));
    CHECK(FileIO::saveOrders("out_orders.txt", orders, err));
    Graph g2;
    vector<OrderRecord> o2;
    CHECK(FileIO::loadMap("out_map.txt", g2, err));
    CHECK(FileIO::loadOrders("out_orders.txt", o2, err, &g2));
    CHECK(g2.nodeCount() == g.nodeCount() && g2.edgeCount() == g.edgeCount());
    CHECK(g2.getNode(9).name == "Sân bay Tân Sơn Nhất");
    CHECK(Traversal::bfs(g2, 0) == b);
    CHECK(o2.size() == orders.size() && o2[3].deadline == 60);

    Graph dg2;
    CHECK(FileIO::saveMap("out_directed.txt", dg, err) && FileIO::loadMap("out_directed.txt", dg2, err));
    CHECK(dg2.isDirected() && dg2.edgeCount() == 6);
    cout << "== Ghi/doc lai map & orders: khop (OK)\n";

    // ----------------------------------------------------- File lỗi phải bị bắt
    cout << "\n== Kiem tra bat loi:\n";
    struct Bad { string content; string name; };
    vector<Bad> bads = {
        {"NODES 2\n0 1 1 A\n0 2 2 B\nEDGES 0\n", "trung id nut"},
        {"NODES 1\n0 1 1 A\nEDGES 1\n0 5 1 1 1\n", "canh toi nut khong ton tai"},
        {"NODES 2\n0 1 1 A\n1 2 2 B\nEDGES 1\n0 1 -3 1 1\n", "km am"},
        {"NODES 3\n0 1 1 A\n", "thieu nut"},
        {"NODES 1\n0 1 1\nEDGES 0\n", "nut thieu ten"},
        {"NODES 1\n0 1 1 A\nEDGES 0\n1 2 3 4 5\n", "du dong"},
    };
    Graph keep = g;  // load lỗi thì g phải giữ nguyên
    for (const auto& bad : bads) {
        writeFile("bad.txt", bad.content);
        bool ok = FileIO::loadMap("bad.txt", keep, err);
        cout << "  " << bad.name << " -> " << err << "\n";
        CHECK(!ok && keep.nodeCount() == 14);
    }
    vector<OrderRecord> keepOrders = orders;
    writeFile("bad.txt", "1 3 2 0 -1\n1 4 2 0 -1\n");
    CHECK(!FileIO::loadOrders("bad.txt", keepOrders, err));
    cout << "  trung ma don -> " << err << "\n";
    writeFile("bad.txt", "1 99 2 0 -1\n");
    CHECK(!FileIO::loadOrders("bad.txt", keepOrders, err, &g));
    cout << "  nut dich khong ton tai -> " << err << "\n";
    writeFile("bad.txt", "1 3 0 0 -1\n");
    CHECK(!FileIO::loadOrders("bad.txt", keepOrders, err));
    cout << "  khoi luong 0 -> " << err << "\n";
    CHECK(keepOrders.size() == 8);
    CHECK(!FileIO::loadMap("khong_co_file.txt", keep, err));

    // Windows: CRLF + BOM vẫn đọc được
    writeFile("crlf.txt", "\xEF\xBB\xBFNODES 2\r\n0 1 1 Kho A\r\n1 2 2 B\r\nEDGES 1\r\n0 1 1 2 3\r\n");
    Graph w;
    CHECK(FileIO::loadMap("crlf.txt", w, err) && w.getNode(0).name == "Kho A");

    remove("bad.txt"); remove("crlf.txt"); remove("out_directed.txt");
    cout << "\n>>> TAT CA " << passed << " KIEM TRA DEU DAT <<<\n";
    return 0;
}
