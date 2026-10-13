
#include <iostream>
#include <vector>
#include <queue>
#include <string>
#include <algorithm>
#include <iomanip>
#include <limits>
using namespace std;

const double INF = numeric_limits<double>::infinity();

// ---------------- Loai xe ----------------
enum Vehicle { MOTORBIKE = 0, CAR = 1, TRUCK = 2 };

const string vehicleName[3]     = {"Xe may", "O to", "Xe tai"};
const int    vehicleMask[3]     = {1, 2, 4};     // moi loai xe la 1 bit
const int    vehicleMaxSpeed[3] = {40, 60, 50};  // toc do toi da cua xe (km/h)

const int MASK_MOTO = 1, MASK_CAR = 2, MASK_TRUCK = 4, MASK_ALL = 7;

// ---------------- Do thi ----------------
struct Road {
    int to;
    double length;     // do dai (km)
    int speedLimit;    // gioi han toc do (km/h)
    int allowedMask;   // cac loai xe duoc phep di (OR cac bit)
};
typedef vector<vector<Road>> Graph;

void addRoad(Graph& g, int u, int v, double length, int speedLimit,
             bool oneWay, int allowedMask) {
    g[u].push_back({v, length, speedLimit, allowedMask});
    if (!oneWay) g[v].push_back({u, length, speedLimit, allowedMask});
}

// Toc do thuc te = min(gioi han cua duong, toc do toi da cua xe)
double realSpeed(const Road& r, int vehicle) {
    return min<double>(r.speedLimit, vehicleMaxSpeed[vehicle]);
}

// Thoi gian di het doan duong (phut)
double travelMinutes(const Road& r, int vehicle) {
    return r.length / realSpeed(r, vehicle) * 60.0;
}

double roadCost(const Road& r, int vehicle, bool byTime) {
    return byTime ? travelMinutes(r, vehicle) : r.length;
}

// ---------------- Dijkstra ----------------
struct Result {
    bool found = false;
    double totalKm = 0;
    double totalMinutes = 0;
    vector<int> path;                  // danh sach dinh
    vector<pair<int, int>> segments;   // (u, chi so canh trong graph[u])
};

Result findPath(const Graph& g, int start, int end, int vehicle, bool byTime) {
    int n = g.size();
    vector<double> dist(n, INF);
    vector<int> prevNode(n, -1), prevIdx(n, -1);
    priority_queue<pair<double, int>,
                   vector<pair<double, int>>,
                   greater<pair<double, int>>> pq;

    dist[start] = 0;
    pq.push({0, start});

    while (!pq.empty()) {
        auto [d, u] = pq.top();
        pq.pop();
        if (d > dist[u]) continue;
        if (u == end) break;

        for (int i = 0; i < (int)g[u].size(); i++) {
            const Road& r = g[u][i];

            // Duong nay cam loai xe dang chon -> bo qua
            if (!(r.allowedMask & vehicleMask[vehicle])) continue;

            double nd = d + roadCost(r, vehicle, byTime);
            if (nd < dist[r.to]) {
                dist[r.to] = nd;
                prevNode[r.to] = u;
                prevIdx[r.to] = i;
                pq.push({nd, r.to});
            }
        }
    }

    Result res;
    if (dist[end] == INF) return res;
    res.found = true;

    // Dung lai duong di tu cuoi ve dau
    for (int v = end; v != -1; v = prevNode[v]) {
        res.path.push_back(v);
        if (prevNode[v] != -1) res.segments.push_back({prevNode[v], prevIdx[v]});
    }
    reverse(res.path.begin(), res.path.end());
    reverse(res.segments.begin(), res.segments.end());

    for (auto [u, idx] : res.segments) {
        const Road& r = g[u][idx];
        res.totalKm += r.length;
        res.totalMinutes += travelMinutes(r, vehicle);
    }
    return res;
}

// ---------------- Ban do mau ----------------
void buildSampleMap(Graph& g, vector<string>& names) {
    names = {"Cong vien", "Ben xe", "Cho", "Benh vien",
             "Truong hoc", "Sieu thi", "Khu cong nghiep"};
    g.assign(names.size(), {});

    //          u  v  km   km/h  1chieu? xe duoc phep
    addRoad(g, 0, 1, 2.0, 50, false, MASK_ALL);                // 2 chieu, ai cung di duoc
    addRoad(g, 0, 2, 1.5, 40, true,  MASK_ALL);                // 1 chieu: Cong vien -> Cho
    addRoad(g, 1, 2, 1.0, 30, false, MASK_ALL);                // 2 chieu, toc do thap
    addRoad(g, 1, 3, 3.0, 60, false, MASK_CAR | MASK_TRUCK);   // CAM xe may
    addRoad(g, 2, 4, 2.5, 40, false, MASK_MOTO | MASK_CAR);    // CAM xe tai
    addRoad(g, 3, 5, 2.0, 50, true,  MASK_ALL);                // 1 chieu: Benh vien -> Sieu thi
    addRoad(g, 4, 5, 1.5, 30, false, MASK_ALL);
    addRoad(g, 4, 6, 4.0, 40, false, MASK_ALL);
    addRoad(g, 5, 6, 2.0, 60, false, MASK_CAR | MASK_TRUCK);   // CAM xe may
}

// ---------------- Nhap ban do tu ban phim ----------------
void inputMap(Graph& g, vector<string>& names) {
    int n, m;
    cout << "Hay nhap so dinh (nga tu/dia diem) n: ";
    cin >> n;
    cout << "Hay nhap so doan duong m: ";
    cin >> m;

    names.clear();
    for (int i = 0; i < n; i++) names.push_back("Dinh " + to_string(i));
    g.assign(n, {});

    cout << "\n--- Nhap cac doan duong (dinh danh so tu 0 den " << n - 1 << ") ---\n";
    for (int i = 0; i < m; i++) {
        int u, v, speed, oneWay, moto, car, truck;
        double length;
        cout << "Doan duong thu " << i + 1 << "/" << m << "\n";
        cout << "  Dinh bat dau u: ";               cin >> u;
        cout << "  Dinh ket thuc v: ";              cin >> v;
        cout << "  Do dai (km): ";                  cin >> length;
        cout << "  Gioi han toc do (km/h): ";       cin >> speed;
        cout << "  Duong 1 chieu? (1 = co, 0 = 2 chieu): ";  cin >> oneWay;
        cout << "  Xe may duoc di? (1 = duoc, 0 = cam): ";   cin >> moto;
        cout << "  O to duoc di? (1 = duoc, 0 = cam): ";     cin >> car;
        cout << "  Xe tai duoc di? (1 = duoc, 0 = cam): ";   cin >> truck;

        int mask = (moto ? MASK_MOTO : 0) | (car ? MASK_CAR : 0) | (truck ? MASK_TRUCK : 0);
        addRoad(g, u, v, length, speed, oneWay == 1, mask);
    }
}

// ---------------- Hien thi ket qua ----------------
void printResult(const Graph& g, const vector<string>& names,
                 const Result& res, int vehicle) {
    if (!res.found) {
        cout << "\nKhong co duong di nao cho " << vehicleName[vehicle]
             << " (do duong 1 chieu hoac bi cam).\n";
        return;
    }

    cout << fixed << setprecision(1);
    cout << "\n===== KET QUA (" << vehicleName[vehicle] << ") =====\n";
    for (auto [u, idx] : res.segments) {
        const Road& r = g[u][idx];
        cout << "  " << names[u] << " -> " << names[r.to]
             << "  (" << r.length << " km, toc do "
             << realSpeed(r, vehicle) << " km/h, ~"
             << travelMinutes(r, vehicle) << " phut)\n";
    }
    cout << "-----------------------------------\n";
    cout << "Tong quang duong: " << res.totalKm << " km\n";
    cout << "Tong thoi gian:   " << res.totalMinutes << " phut\n";
}

// ---------------- main ----------------
int main() {
    Graph g;
    vector<string> names;

    int mapChoice;
    cout << "=== TIM DUONG DI TREN BAN DO GIAO THONG ===\n";
    cout << "1. Dung ban do mau\n";
    cout << "2. Tu nhap ban do\n";
    cout << "Hay chon (1 hoac 2): ";
    cin >> mapChoice;

    if (mapChoice == 2) inputMap(g, names);
    else buildSampleMap(g, names);

    cout << "\nDanh sach dia diem:\n";
    for (int i = 0; i < (int)names.size(); i++)
        cout << "  " << i << ". " << names[i] << "\n";

    int vehicle;
    cout << "\nHay chon loai xe (0 = Xe may, 1 = O to, 2 = Xe tai): ";
    cin >> vehicle;

    int mode;
    cout << "Hay chon tieu chi toi uu (1 = nhanh nhat, 2 = ngan nhat theo km): ";
    cin >> mode;

    int start, end;
    cout << "Hay nhap dia diem xuat phat: ";
    cin >> start;
    cout << "Hay nhap dia diem dich: ";
    cin >> end;

    Result res = findPath(g, start, end, vehicle, mode == 1);
    printResult(g, names, res, vehicle);
    return 0;
}