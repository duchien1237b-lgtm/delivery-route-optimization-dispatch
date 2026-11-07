// ============================================================================
// main.cpp — Chương trình chính (Phần "Core + Tích hợp")
//
//   delivery                 -> chạy web server tại http://localhost:8080
//   delivery --port 9000     -> đổi cổng
//   delivery --host 0.0.0.0  -> cho máy khác trong mạng LAN truy cập
//   delivery --console       -> menu dòng lệnh (không cần trình duyệt)
//   delivery --data DIR --web DIR  -> chỉ định thư mục dữ liệu / giao diện
// ============================================================================
#include "BellmanFord.h"
#include "Dispatcher.h"
#include "Estimator.h"
#include "FileIO.h"
#include "Graph.h"
#include "ShortestPath.h"
#include "Traversal.h"
#include "Trie.h"
#include "WebServer.h"

#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <sstream>
#include <string>
#include <vector>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX  // tránh macro min/max của windows.h phá std::numeric_limits<>::max()
#endif
#include <windows.h>
#endif

using namespace std;

namespace {

// ------------------------------- Tiện ích nhập -----------------------------
int readInt(const string& prompt) {
    while (true) {
        cout << prompt;
        int x;
        if (cin >> x) return x;
        if (cin.eof()) exit(0);
        cin.clear();
        cin.ignore(numeric_limits<streamsize>::max(), '\n');
        cout << "  Vui long nhap mot so nguyen.\n";
    }
}

double readDouble(const string& prompt) {
    while (true) {
        cout << prompt;
        double x;
        if (cin >> x) return x;
        if (cin.eof()) exit(0);
        cin.clear();
        cin.ignore(numeric_limits<streamsize>::max(), '\n');
        cout << "  Vui long nhap mot so.\n";
    }
}

string readLine(const string& prompt) {
    cout << prompt;
    string s;
    cin.ignore(numeric_limits<streamsize>::max(), '\n');
    getline(cin, s);
    return s;
}

void printPath(const Graph& g, const vector<int>& p) {
    if (p.empty()) {
        cout << "(khong co duong)\n";
        return;
    }
    for (size_t i = 0; i < p.size(); ++i) cout << (i ? " -> " : "") << g.getNode(p[i]).name;
    cout << "\n";
}

Vehicle askVehicle() {
    return vehicleFromInt(readInt("Loai xe (0 xe may, 1 o to, 2 xe tai, 3 bo qua): "));
}

Criterion askCriterion() {
    int c = readInt("Tieu chi (0 km, 1 phut, 2 chi phi): ");
    return c == 1 ? Criterion::TIME : c == 2 ? Criterion::COST : Criterion::DISTANCE;
}

// --------------------------------- Menu ------------------------------------
int runConsole(const string& dataDir) {
    Graph g;
    vector<Order> orders;
    vector<Shipper> shippers;
    string err;
    if (FileIO::loadMap(dataDir + "/map.txt", g, err)) {
        vector<OrderRecord> recs;
        if (FileIO::loadOrders(dataDir + "/orders.txt", recs, err, &g)) orders.assign(recs.begin(), recs.end());
        loadShippers(dataDir + "/shippers.txt", shippers, err);
        cout << "Da nap " << dataDir << "/map.txt: " << g.nodeCount() << " nut, " << g.edgeCount() << " canh, "
             << orders.size() << " don, " << shippers.size() << " shipper\n";
    } else {
        cout << "Khong nap duoc ban do mau (" << err << "). Bat dau voi ban do rong.\n";
    }

    cout << fixed << setprecision(2);
    while (true) {
        cout << "\n========== HE THONG TIM DUONG & DIEU PHOI GIAO HANG ==========\n"
             << " 1. Nap ban do tu file          2. Luu ban do ra file\n"
             << " 3. In do thi                   4. Them diem\n"
             << " 5. Sua diem                    6. Xoa diem\n"
             << " 7. Them doan duong             8. Sua doan duong\n"
             << " 9. Xoa doan duong             10. Duyet BFS / DFS\n"
             << "11. Thanh phan lien thong      12. Vung giao hang (k chang)\n"
             << "13. Duong di ngan nhat (Dijkstra 3 phien ban)\n"
             << "14. Bellman-Ford & chu trinh am\n"
             << "15. Du toan chi phi tuyen nhieu diem\n"
             << "16. Dieu phoi don hang (so sanh thuat toan)\n"
             << "17. Benchmark Dijkstra\n"
             << "18. Tim diem theo ten (Trie, go khong dau)\n"
             << "19. Tuyen thay the (K duong ngan nhat - Yen)\n"
             << "20. Bao ket xe / dong duong\n"
             << " 0. Thoat\n";
        int choice = readInt("Chon: ");
        if (choice == 0) return 0;

        switch (choice) {
            case 1: {
                cout << "Duong dan file (vd data/map.txt): ";
                string path;
                cin >> path;
                if (FileIO::loadMap(path, g, err)) {
                    cout << "Da nap: " << g.nodeCount() << " nut, " << g.edgeCount() << " canh\n";
                    orders.clear();
                } else {
                    cout << "Loi: " << err << "\n";
                }
                break;
            }
            case 2: {
                cout << "Luu vao file: ";
                string path;
                cin >> path;
                cout << (FileIO::saveMap(path, g, err) ? "Da luu.\n" : "Loi: " + err + "\n");
                break;
            }
            case 3: g.print(cout); break;
            case 4: {
                int id = g.nextNodeId();
                double x = readDouble("Vi do: "), y = readDouble("Kinh do: ");
                string name = readLine("Ten diem: ");
                cout << (g.addNode(id, name, x, y) ? "Da them diem #" + to_string(id) + "\n" : "Khong them duoc.\n");
                break;
            }
            case 5: {
                int id = readInt("Ma diem can sua: ");
                if (!g.hasNode(id)) { cout << "Khong co diem nay.\n"; break; }
                double x = readDouble("Vi do moi: "), y = readDouble("Kinh do moi: ");
                string name = readLine("Ten moi: ");
                g.updateNode(id, name, x, y);
                cout << "Da sua.\n";
                break;
            }
            case 6: {
                int id = readInt("Ma diem can xoa: ");
                cout << (g.removeNode(id) ? "Da xoa (kem cac doan duong noi toi).\n" : "Khong co diem nay.\n");
                break;
            }
            case 7:
            case 8: {
                int u = readInt("Diem dau: "), v = readInt("Diem cuoi: ");
                double km = readDouble("Quang duong (km): "), t = readDouble("Thoi gian (phut): ");
                double c = readDouble("Phu phi (nghin dong, co the am): ");
                int mask = readInt("Loai xe duoc di (1 xe may + 2 o to + 4 xe tai, 7 = tat ca): ");
                bool ok = choice == 7 ? g.addEdge(u, v, km, t, c, mask) : g.updateEdge(u, v, km, t, c, mask);
                cout << (ok ? "Thanh cong.\n" : "That bai (diem khong ton tai, trung canh hoac so am).\n");
                break;
            }
            case 9: {
                int u = readInt("Diem dau: "), v = readInt("Diem cuoi: ");
                cout << (g.removeEdge(u, v) ? "Da xoa.\n" : "Khong co doan duong nay.\n");
                break;
            }
            case 10: {
                int s = readInt("Bat dau tu diem: ");
                cout << "BFS: ";
                printPath(g, Traversal::bfs(g, s));
                cout << "DFS: ";
                printPath(g, Traversal::dfs(g, s));
                break;
            }
            case 11: {
                auto comps = Traversal::connectedComponents(g);
                cout << comps.size() << " thanh phan lien thong:\n";
                for (const auto& c : comps) {
                    cout << "  {";
                    for (size_t i = 0; i < c.size(); ++i) cout << (i ? ", " : "") << c[i];
                    cout << "}\n";
                }
                break;
            }
            case 12: {
                int d = readInt("Kho: "), k = readInt("So chang toi da: ");
                for (auto [u, h] : Traversal::deliveryZone(g, d, k))
                    cout << "  " << g.getNode(u).name << " (" << h << " chang)\n";
                break;
            }
            case 13: {
                int s = readInt("Tu diem: "), t = readInt("Den diem: ");
                ShortestPath::Options opt;
                opt.vehicle = askVehicle();
                opt.criterion = askCriterion();
                for (auto ver : {ShortestPath::Version::ARRAY, ShortestPath::Version::STL_PQ,
                                 ShortestPath::Version::MIN_HEAP}) {
                    auto tree = ShortestPath::dijkstra(g, s, ver, opt);
                    auto p = ShortestPath::getPath(tree, t);
                    cout << "\n[" << ShortestPath::versionName(ver) << "] " << tree.micros << " us\n  ";
                    printPath(g, p);
                    if (!p.empty()) {
                        auto info = ShortestPath::describePath(g, p, opt.vehicle);
                        cout << "  " << info.km << " km, " << info.minutes << " phut, " << info.costK << "k dong\n";
                    }
                    if (tree.negativeEdge) cout << "  Canh bao: co canh am, hay dung Bellman-Ford.\n";
                }
                break;
            }
            case 14: {
                int s = readInt("Nguon: ");
                BFResult bf = bellmanFord(g, s, Criterion::COST);
                if (bf.coChuTrinhAm) {
                    cout << "Co CHU TRINH AM: ";
                    printPath(g, bf.chuTrinhAm);
                    break;
                }
                for (int id : g.nodeIds()) {
                    cout << "  " << setw(28) << left << g.getNode(id).name << right << "  ";
                    if (bf.khoangCach[id] >= VO_CUC) cout << "khong toi duoc\n";
                    else cout << bf.khoangCach[id] << "k\n";
                }
                break;
            }
            case 15: {
                int kho = readInt("Kho: ");
                int n = readInt("So diem giao: ");
                vector<int> stops;
                for (int i = 0; i < n; ++i) stops.push_back(readInt("  Diem " + to_string(i + 1) + ": "));
                printEstimate(estimateMultiStop(g, kho, stops, askVehicle(), true));
                break;
            }
            case 16: {
                int kho = readInt("Kho: ");
                Dispatcher d(g, kho, orders, shippers, true);
                DispatchReport rep = d.compareAll(MOTORBIKE);
                if (!rep.error.empty()) { cout << rep.error << "\n"; break; }
                cout << "\n-- 1 xe may, bo qua tai trong --\n";
                for (const Plan& p : rep.single)
                    cout << "  " << setw(30) << left << p.name << right << "  " << p.km << " km, tre " << p.late
                         << (p.skipped ? "  (bo qua: " + p.note + ")" : "") << "\n";
                cout << "-- " << shippers.size() << " shipper, co tai trong --\n";
                for (const Plan& p : rep.multi) {
                    cout << "  " << setw(34) << left << p.name << right << "  " << p.km << " km, tre " << p.late
                         << ", chua giao " << p.overweight.size() + p.unreachable.size() << "\n";
                    for (const Route& r : p.routes) {
                        cout << "      " << shippers[r.shipper].name << " (" << r.load << "/"
                             << shippers[r.shipper].capacity << " kg): Kho";
                        for (int o : r.orders) cout << " -> #" << orders[o].id;
                        cout << "\n";
                    }
                }
                break;
            }
            case 17: {
                for (const auto& b : ShortestPath::benchmark({200, 500, 1000, 2000, 4000}, 4, 3))
                    cout << "  n=" << setw(5) << b.nodes << "  mang " << setw(10) << b.microsArray << " us   stl "
                         << setw(9) << b.microsStl << " us   heap " << setw(9) << b.microsHeap << " us"
                         << (b.agree ? "" : "  (KHONG KHOP!)") << "\n";
                break;
            }
            case 18: {
                PlaceIndex idx;
                idx.build(g);
                string q = readLine("Nhap ten (vd: ben thanh): ");
                auto found = idx.search(q, 10);
                if (found.empty()) cout << "Khong tim thay.\n";
                for (int id : found) cout << "  [" << id << "] " << g.getNode(id).name << "\n";
                break;
            }
            case 19: {
                int s = readInt("Tu diem: "), t = readInt("Den diem: ");
                int k = readInt("So tuyen (1-6): ");
                ShortestPath::Options opt;
                opt.vehicle = askVehicle();
                opt.criterion = askCriterion();
                auto paths = ShortestPath::kShortestPaths(g, s, t, max(1, min(k, 6)), opt);
                if (paths.empty()) cout << "Khong co duong.\n";
                for (size_t i = 0; i < paths.size(); ++i) {
                    cout << "Tuyen " << i + 1 << " (" << paths[i].weight << "): ";
                    printPath(g, paths[i].nodes);
                }
                break;
            }
            case 20: {
                int u = readInt("Diem dau: "), v = readInt("Diem cuoi: ");
                int c = readInt("0 thong duong, 1 ket xe, 2 dong duong: ");
                double jam = c == 1 ? readDouble("He so ket xe (vd 2): ") : 1;
                cout << (g.setTraffic(u, v, jam, c == 2) ? "Da cap nhat. Cac thuat toan se tinh lai theo tinh trang moi.\n"
                                                        : "Khong co doan duong nay.\n");
                break;
            }
            default: cout << "Lua chon khong hop le.\n";
        }
    }
}

bool dirHasFile(const string& dir, const string& file) { return ifstream(dir + "/" + file).good(); }

// Tìm thư mục web/ và data/ dù chạy từ gốc repo hay từ build/
string findDir(const string& given, const string& name, const string& probe, const string& exeDir) {
    if (!given.empty()) return given;
    vector<string> cands = {name, "../" + name, "../../" + name};
    if (!exeDir.empty()) {
        cands.push_back(exeDir + "/" + name);
        cands.push_back(exeDir + "/../" + name);
        cands.push_back(exeDir + "/../../" + name);
    }
    for (const string& c : cands)
        if (dirHasFile(c, probe)) return c;
    return name;
}

}  // namespace

int main(int argc, char* argv[]) {
#ifdef _WIN32
    SetConsoleOutputCP(CP_UTF8);  // in tiếng Việt đúng trên cmd/PowerShell
#endif
    ServerConfig cfg;
    bool console = false;
    string webDir, dataDir;
    for (int i = 1; i < argc; ++i) {
        string a = argv[i];
        auto next = [&]() -> string {
            if (i + 1 >= argc) {
                cerr << "Thieu gia tri sau " << a << "\n";
                exit(1);
            }
            return argv[++i];
        };
        if (a == "--console" || a == "-c") console = true;
        else if (a == "--port" || a == "-p") cfg.port = stoi(next());
        else if (a == "--host") cfg.host = next();
        else if (a == "--web") webDir = next();
        else if (a == "--data") dataDir = next();
        else if (a == "--no-demo") cfg.demo = false;
        else if (a == "--help" || a == "-h") {
            cout << "Cach dung: " << argv[0] << " [--console] [--port 8080] [--host 127.0.0.1] "
                 << "[--web thu_muc_web] [--data thu_muc_du_lieu] [--no-demo]\n";
            return 0;
        } else {
            cerr << "Tham so khong hop le: " << a << " (xem --help)\n";
            return 1;
        }
    }
    string exe = argv[0];
    size_t slash = exe.find_last_of("/\\");
    string exeDir = slash == string::npos ? "" : exe.substr(0, slash);
    cfg.dataDir = findDir(dataDir, "data", "map.txt", exeDir);
    cfg.webDir = findDir(webDir, "web", "index.html", exeDir);

    if (console) return runConsole(cfg.dataDir);
    return runWebServer(cfg);
}
