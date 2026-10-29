#include "ShortestPath.h"
#include "MinHeap.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <functional>
#include <queue>
#include <random>
#include <unordered_map>

namespace ShortestPath {

const char* versionName(Version v) {
    switch (v) {
        case Version::ARRAY:  return "Dijkstra mảng O(V²)";
        case Version::STL_PQ: return "Dijkstra std::priority_queue";
        default:              return "Dijkstra Min-Heap tự cài";
    }
}

Version versionFromString(const std::string& s) {
    if (s == "array" || s == "0") return Version::ARRAY;
    if (s == "stl" || s == "1") return Version::STL_PQ;
    return Version::MIN_HEAP;
}

namespace {

// Đồ thị dạng chỉ số liên tiếp 0..n-1 (id của Graph có thể không liên tiếp).
// Chỉ giữ cạnh mà loại xe được phép đi, trọng số đã tính sẵn theo tiêu chí.
struct Arc {
    int to;              // chỉ số đỉnh kề
    double w;            // trọng số tĩnh theo tiêu chí
    const Edge* e;       // cạnh gốc (để tính trọng số theo giờ khi có cao điểm)
};

struct Compact {
    std::vector<int> ids;                      // idx -> id
    std::unordered_map<int, int> index;        // id -> idx
    std::vector<std::vector<Arc>> adj;         // idx -> các cạnh đi ra
    bool negative = false;
};

// Trọng số của cạnh khi đã đi được du phút (giờ cao điểm), hoặc trọng số tĩnh
struct Weigher {
    const Options& opt;
    bool td;
    double operator()(const Arc& a, double du) const {
        return td ? travelMinutesAt(*a.e, opt.vehicle, opt.departAt + du, opt.rush) : a.w;
    }
};

Compact compact(const Graph& g, const Options& opt) {
    Compact c;
    c.ids = g.nodeIds();
    const int n = static_cast<int>(c.ids.size());
    c.index.reserve(n * 2);
    for (int i = 0; i < n; ++i) c.index[c.ids[i]] = i;
    c.adj.assign(n, {});
    for (int i = 0; i < n; ++i) {
        if (opt.bannedNodes && opt.bannedNodes->count(c.ids[i])) continue;
        for (const Edge& e : g.neighbors(c.ids[i])) {
            if (!vehicleAllowed(e, opt.vehicle)) continue;  // đường cấm loại xe này / đang đóng
            if (opt.bannedNodes && opt.bannedNodes->count(e.to)) continue;
            if (opt.bannedEdges && opt.bannedEdges->count({c.ids[i], e.to})) continue;
            double w = edgeWeight(e, opt.criterion, opt.vehicle);
            if (w < 0) c.negative = true;
            c.adj[i].push_back({c.index[e.to], w, &e});
        }
    }
    return c;
}

using Clock = std::chrono::steady_clock;

// ------------------------- Phiên bản 1: mảng O(V^2) -------------------------
void runArray(const Compact& c, const Weigher& W, int s, int t, std::vector<double>& dist, std::vector<int>& prev,
              std::vector<int>& order, long long& relax, long long& ops) {
    const int n = static_cast<int>(c.ids.size());
    std::vector<char> done(n, 0);
    dist[s] = 0;
    for (int step = 0; step < n; ++step) {
        int u = -1;
        for (int i = 0; i < n; ++i) {  // quét toàn bộ mảng tìm đỉnh gần nhất chưa chốt
            ++ops;
            if (!done[i] && dist[i] < INF && (u == -1 || dist[i] < dist[u])) u = i;
        }
        if (u == -1) break;  // các đỉnh còn lại không tới được
        done[u] = 1;
        order.push_back(u);
        if (u == t) break;
        for (const Arc& a : c.adj[u]) {
            double w = W(a, dist[u]);
            if (!done[a.to] && dist[u] + w < dist[a.to]) {
                dist[a.to] = dist[u] + w;
                prev[a.to] = u;
                ++relax;
            }
        }
    }
}

// -------------------- Phiên bản 2: std::priority_queue ----------------------
void runStl(const Compact& c, const Weigher& W, int s, int t, std::vector<double>& dist, std::vector<int>& prev,
            std::vector<int>& order, long long& relax, long long& ops) {
    using Item = std::pair<double, int>;
    std::priority_queue<Item, std::vector<Item>, std::greater<Item>> pq;
    std::vector<char> done(c.ids.size(), 0);
    dist[s] = 0;
    pq.push({0, s});
    ++ops;
    while (!pq.empty()) {
        auto [d, u] = pq.top();
        pq.pop();
        ++ops;
        if (done[u] || d > dist[u]) continue;  // bản ghi cũ (lazy deletion)
        done[u] = 1;
        order.push_back(u);
        if (u == t) break;
        for (const Arc& a : c.adj[u]) {
            int v = a.to;
            double w = W(a, d);
            if (!done[v] && d + w < dist[v]) {
                dist[v] = d + w;
                prev[v] = u;
                pq.push({dist[v], v});
                ++relax;
                ++ops;
            }
        }
    }
}

// ---------------- Phiên bản 3: IndexedMinHeap tự cài (decreaseKey) ----------
void runHeap(const Compact& c, const Weigher& W, int s, int t, std::vector<double>& dist, std::vector<int>& prev,
             std::vector<int>& order, long long& relax, long long& ops) {
    IndexedMinHeap heap(static_cast<int>(c.ids.size()));
    std::vector<char> done(c.ids.size(), 0);
    dist[s] = 0;
    heap.pushOrDecrease(s, 0);
    ++ops;
    while (!heap.empty()) {
        auto [u, d] = heap.popMin();
        ++ops;
        done[u] = 1;
        order.push_back(u);
        if (u == t) break;
        for (const Arc& a : c.adj[u]) {
            int v = a.to;
            double w = W(a, d);
            if (!done[v] && d + w < dist[v]) {
                dist[v] = d + w;
                prev[v] = u;
                heap.pushOrDecrease(v, dist[v]);  // đã có trong heap -> giảm khoá
                ++relax;
                ++ops;
            }
        }
    }
}

}  // namespace

Tree dijkstra(const Graph& g, int source, Version version, const Options& opt) {
    Tree tree;
    tree.source = source;
    Compact c = compact(g, opt);
    tree.negativeEdge = c.negative;
    const int n = static_cast<int>(c.ids.size());
    for (int id : c.ids) {
        tree.dist[id] = INF;
        tree.prev[id] = -1;
    }
    if (!g.hasNode(source)) return tree;
    tree.valid = true;

    int s = c.index[source];
    int t = (opt.target >= 0 && c.index.count(opt.target)) ? c.index[opt.target] : -1;
    std::vector<double> dist(n, INF);
    std::vector<int> prev(n, -1), order;
    order.reserve(n);

    Weigher W{opt, opt.timeDependent()};
    auto start = Clock::now();
    switch (version) {
        case Version::ARRAY:  runArray(c, W, s, t, dist, prev, order, tree.relaxations, tree.heapOps); break;
        case Version::STL_PQ: runStl(c, W, s, t, dist, prev, order, tree.relaxations, tree.heapOps); break;
        default:              runHeap(c, W, s, t, dist, prev, order, tree.relaxations, tree.heapOps); break;
    }
    tree.micros = std::chrono::duration<double, std::micro>(Clock::now() - start).count();

    for (int i = 0; i < n; ++i) {
        tree.dist[c.ids[i]] = dist[i];
        tree.prev[c.ids[i]] = prev[i] < 0 ? -1 : c.ids[prev[i]];
    }
    for (int i : order) tree.settleOrder.push_back(c.ids[i]);
    return tree;
}

double straightLineKm(const Node& a, const Node& b) {
    const double R = 6371.0, rad = 3.14159265358979323846 / 180.0;
    double dLat = (b.x - a.x) * rad, dLon = (b.y - a.y) * rad;
    double h = std::sin(dLat / 2) * std::sin(dLat / 2) +
               std::cos(a.x * rad) * std::cos(b.x * rad) * std::sin(dLon / 2) * std::sin(dLon / 2);
    return 2 * R * std::asin(std::min(1.0, std::sqrt(h)));
}

Tree astar(const Graph& g, int source, int target, const Options& opt) {
    Tree tree;
    tree.source = source;
    Compact c = compact(g, opt);
    tree.negativeEdge = c.negative;
    const int n = static_cast<int>(c.ids.size());
    for (int id : c.ids) {
        tree.dist[id] = INF;
        tree.prev[id] = -1;
    }
    if (!g.hasNode(source) || !g.hasNode(target)) return tree;
    tree.valid = true;

    // α = min w(cạnh) / chim bay(cạnh): bảo đảm heuristic nhất quán
    std::vector<const Node*> node(n);
    for (int i = 0; i < n; ++i) node[i] = &g.getNode(c.ids[i]);
    double alpha = INF;
    for (int i = 0; i < n && alpha > 0; ++i)
        for (const Arc& a : c.adj[i]) {
            if (a.w < 0) { alpha = 0; break; }
            double km = straightLineKm(*node[i], *node[a.to]);
            if (km > 1e-9) alpha = std::min(alpha, a.w / km);
        }
    if (alpha == INF) alpha = 0;
    tree.heuristicScale = alpha;

    const int s = c.index[source], t = c.index[target];
    std::vector<double> h(n), dist(n, INF);
    for (int i = 0; i < n; ++i) h[i] = alpha * straightLineKm(*node[i], *node[t]);
    std::vector<int> prev(n, -1);
    std::vector<char> done(n, 0);
    Weigher W{opt, opt.timeDependent()};

    auto start = Clock::now();
    IndexedMinHeap heap(n);   // khoá = f = dist + h
    dist[s] = 0;
    heap.pushOrDecrease(s, h[s]);
    ++tree.heapOps;
    while (!heap.empty()) {
        int u = heap.popMin().first;
        ++tree.heapOps;
        done[u] = 1;
        tree.settleOrder.push_back(c.ids[u]);
        if (u == t) break;
        for (const Arc& a : c.adj[u]) {
            int v = a.to;
            double nd = dist[u] + W(a, dist[u]);
            if (!done[v] && nd < dist[v]) {
                dist[v] = nd;
                prev[v] = u;
                heap.pushOrDecrease(v, nd + h[v]);
                ++tree.relaxations;
                ++tree.heapOps;
            }
        }
    }
    tree.micros = std::chrono::duration<double, std::micro>(Clock::now() - start).count();
    for (int i = 0; i < n; ++i) {
        tree.dist[c.ids[i]] = dist[i];
        tree.prev[c.ids[i]] = prev[i] < 0 ? -1 : c.ids[prev[i]];
    }
    return tree;
}

std::vector<int> getPath(const Tree& t, int dst) {
    std::vector<int> path;
    auto it = t.dist.find(dst);
    if (!t.valid || it == t.dist.end() || it->second == INF) return path;
    for (int v = dst; v != -1; v = t.prev.at(v)) {
        path.push_back(v);
        if (path.size() > t.dist.size()) return {};  // phòng vòng lặp (khi có cạnh âm)
    }
    std::reverse(path.begin(), path.end());
    if (path.front() != t.source) path.clear();
    return path;
}

PathInfo describePath(const Graph& g, const std::vector<int>& path, Vehicle vehicle,
                      double departAt, const RushProfile* rush) {
    const RushProfile* r = departAt >= 0 ? rush : nullptr;
    PathInfo info;
    if (path.empty()) return info;
    info.nodes = path;
    info.found = true;
    for (size_t i = 0; i + 1 < path.size(); ++i) {
        const Edge* e = g.getEdge(path[i], path[i + 1]);
        if (!e) {  // đường đi không hợp lệ
            info.found = false;
            return info;
        }
        info.km += e->distance;
        info.minutes += travelMinutesAt(*e, vehicle, departAt + info.minutes, r);
        info.minutesBase += travelMinutes(*e, vehicle);
        info.costK += edgeCostK(*e);
    }
    info.hops = static_cast<int>(path.size()) - 1;
    return info;
}

// =============================== Yen K paths ================================

namespace {
double pathWeight(const Graph& g, const std::vector<int>& p, const Options& opt, size_t upto = std::string::npos) {
    double w = 0;
    bool td = opt.timeDependent();
    for (size_t i = 0; i + 1 < p.size() && i < upto; ++i) {
        const Edge* e = g.getEdge(p[i], p[i + 1]);
        if (!e) return INF;
        w += td ? travelMinutesAt(*e, opt.vehicle, opt.departAt + w, opt.rush) : edgeWeight(*e, opt.criterion, opt.vehicle);
    }
    return w;
}
struct ByWeight {
    bool operator()(const RankedPath& a, const RankedPath& b) const {
        if (a.weight != b.weight) return a.weight < b.weight;
        return a.nodes.size() < b.nodes.size();
    }
};
}  // namespace

std::vector<RankedPath> kShortestPaths(const Graph& g, int src, int dst, int K, const Options& base) {
    std::vector<RankedPath> A;
    if (K < 1 || !g.hasNode(src) || !g.hasNode(dst)) return A;
    Options opt = base;
    opt.target = dst;
    opt.bannedEdges = nullptr;
    opt.bannedNodes = nullptr;
    std::vector<int> first = getPath(dijkstra(g, src, Version::MIN_HEAP, opt), dst);
    if (first.empty()) return A;
    A.push_back({first, pathWeight(g, first, opt)});

    MinHeap<RankedPath, ByWeight> B;       // các ứng viên, lấy ra cái ngắn nhất
    std::set<std::vector<int>> seen{first};
    for (int k = 1; k < K; ++k) {
        const std::vector<int> prev = A.back().nodes;
        for (size_t i = 0; i + 1 < prev.size(); ++i) {
            int spur = prev[i];
            std::vector<int> root(prev.begin(), prev.begin() + i + 1);
            std::set<std::pair<int, int>> bannedE;
            for (const RankedPath& p : A)
                if (p.nodes.size() > i + 1 && std::equal(root.begin(), root.end(), p.nodes.begin()))
                    bannedE.insert({p.nodes[i], p.nodes[i + 1]});
            std::set<int> bannedN(root.begin(), root.end() - 1);
            Options o = opt;
            o.bannedEdges = &bannedE;
            o.bannedNodes = &bannedN;
            if (opt.timeDependent()) o.departAt = opt.departAt + pathWeight(g, prev, opt, i);  // tới điểm rẽ nhánh lúc nào
            std::vector<int> spurPath = getPath(dijkstra(g, spur, Version::MIN_HEAP, o), dst);
            if (spurPath.empty()) continue;
            std::vector<int> total = root;
            total.insert(total.end(), spurPath.begin() + 1, spurPath.end());
            if (seen.insert(total).second) B.push({total, pathWeight(g, total, opt)});
        }
        if (B.empty()) break;
        A.push_back(B.pop());
    }
    return A;
}

// ================================ Benchmark =================================

Graph randomGraph(int n, double avgDegree, unsigned seed) {
    std::mt19937 rng(seed);
    std::uniform_real_distribution<double> coord(0.0, 100.0);
    Graph g(false);
    std::vector<std::pair<double, double>> p(n);
    for (int i = 0; i < n; ++i) {
        p[i] = {coord(rng), coord(rng)};
        g.addNode(i, "N" + std::to_string(i), p[i].first, p[i].second);
    }
    auto d = [&](int a, int b) { return std::hypot(p[a].first - p[b].first, p[a].second - p[b].second); };
    // Cây khung ngẫu nhiên để chắc chắn liên thông
    for (int i = 1; i < n; ++i) {
        int j = std::uniform_int_distribution<int>(0, i - 1)(rng);
        g.addEdge(i, j, d(i, j), d(i, j), 0);
    }
    // Thêm cạnh ngẫu nhiên cho tới khi đạt bậc trung bình mong muốn
    long long target = static_cast<long long>(avgDegree * n / 2);
    std::uniform_int_distribution<int> pick(0, n - 1);
    for (long long tries = 0; g.edgeCount() < target && tries < target * 10; ++tries) {
        int a = pick(rng), b = pick(rng);
        if (a != b) g.addEdge(a, b, d(a, b), d(a, b), 0);
    }
    return g;
}

std::vector<BenchRow> benchmark(const std::vector<int>& sizes, double avgDegree, int repeats,
                                unsigned seed) {
    std::vector<BenchRow> rows;
    if (repeats < 1) repeats = 1;
    for (int n : sizes) {
        if (n < 2) continue;
        Graph g = randomGraph(n, avgDegree, seed + n);
        BenchRow row;
        row.nodes = n;
        row.edges = g.edgeCount();
        Options opt;  // toàn bộ cây đường đi từ đỉnh 0, theo km
        Tree ta, ts, th;
        // Chạy "khởi động" 1 lần (nạp cache, cấp phát bộ nhớ) để số đo đầu không bị lệch
        dijkstra(g, 0, Version::MIN_HEAP, opt);
        dijkstra(g, 0, Version::STL_PQ, opt);
        for (int r = 0; r < repeats; ++r) {
            ta = dijkstra(g, 0, Version::ARRAY, opt);
            ts = dijkstra(g, 0, Version::STL_PQ, opt);
            th = dijkstra(g, 0, Version::MIN_HEAP, opt);
            row.microsArray += ta.micros;
            row.microsStl += ts.micros;
            row.microsHeap += th.micros;
        }
        row.microsArray /= repeats;
        row.microsStl /= repeats;
        row.microsHeap /= repeats;
        row.opsArray = ta.heapOps;
        row.opsStl = ts.heapOps;
        row.opsHeap = th.heapOps;
        for (const auto& [id, dv] : ta.dist)
            if (std::fabs(dv - ts.dist[id]) > 1e-6 || std::fabs(dv - th.dist[id]) > 1e-6) row.agree = false;
        rows.push_back(row);
    }
    return rows;
}

}  // namespace ShortestPath
