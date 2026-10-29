#include "Trace.h"
#include "MinHeap.h"
#include "ShortestPath.h"

#include <algorithm>
#include <deque>
#include <limits>
#include <set>
#include <unordered_map>

namespace Trace {

namespace {

const double INF = std::numeric_limits<double>::infinity();

// Ghi bước, dừng ghi khi vượt giới hạn (thuật toán vẫn chạy tiếp để kết quả cuối đúng)
struct Recorder {
    Result& r;
    size_t max;
    void add(Step s) {
        if (r.steps.size() >= max) { r.truncated = true; return; }
        r.steps.push_back(std::move(s));
    }
    bool full() const { return r.steps.size() >= max; }
};

std::vector<std::pair<int, double>> clip(std::vector<std::pair<int, double>> v, int& size) {
    size = static_cast<int>(v.size());
    if (v.size() > static_cast<size_t>(MAX_SNAPSHOT)) v.resize(MAX_SNAPSHOT);
    return v;
}

Step mk(const char* type, int line, int u = -1, int v = -1, double value = 0, double extra = 0) {
    Step s;
    s.type = type;
    s.line = line;
    s.u = u;
    s.v = v;
    s.value = value;
    s.extra = extra;
    return s;
}

// ------------------------------------------------ Dijkstra / A* (Min-Heap)
void heapSearch(const Graph& g, bool astar, int src, int dst, Criterion crit, Vehicle veh, Result& res, Recorder& rec) {
    const std::vector<int> ids = g.nodeIds();
    const int n = static_cast<int>(ids.size());
    std::unordered_map<int, int> idx;
    for (int i = 0; i < n; ++i) idx[ids[i]] = i;

    // h(v) giống ShortestPath::astar: α × đường chim bay
    std::vector<double> h(n, 0);
    if (astar && g.hasNode(dst)) {
        double alpha = INF;
        for (int i = 0; i < n && alpha > 0; ++i)
            for (const Edge& e : g.neighbors(ids[i])) {
                if (!vehicleAllowed(e, veh)) continue;
                double w = edgeWeight(e, crit, veh);
                if (w < 0) { alpha = 0; break; }
                double km = ShortestPath::straightLineKm(g.getNode(ids[i]), g.getNode(e.to));
                if (km > 1e-9) alpha = std::min(alpha, w / km);
            }
        if (alpha == INF) alpha = 0;
        res.heuristicScale = alpha;
        for (int i = 0; i < n; ++i) h[i] = alpha * ShortestPath::straightLineKm(g.getNode(ids[i]), g.getNode(dst));
    }

    std::vector<double> dist(n, INF);
    std::vector<int> prev(n, -1);
    std::vector<char> done(n, 0);
    IndexedMinHeap heap(n);
    auto snap = [&](Step s) {
        if (rec.full()) { rec.add(s); return; }
        std::vector<std::pair<int, double>> v = heap.snapshot();
        for (auto& p : v) p.first = ids[p.first];
        s.container = clip(std::move(v), s.size);
        rec.add(std::move(s));
    };

    const int s = idx[src];
    const int t = g.hasNode(dst) ? idx[dst] : -1;
    dist[s] = 0;
    heap.pushOrDecrease(s, h[s]);
    snap(mk("init", 0, src, -1, 0, h[s]));
    while (!heap.empty()) {
        auto [u, key] = heap.popMin();
        done[u] = 1;
        snap(mk("pop", 2, ids[u], -1, dist[u], key));
        if (u == t) {
            snap(mk("found", 3, ids[u], -1, dist[u]));
            break;
        }
        for (const Edge& e : g.neighbors(ids[u])) {
            if (!vehicleAllowed(e, veh)) continue;
            int v = idx[e.to];
            if (done[v]) continue;
            double nd = dist[u] + edgeWeight(e, crit, veh);
            if (nd < dist[v]) {
                dist[v] = nd;
                prev[v] = u;
                heap.pushOrDecrease(v, nd + h[v]);
                snap(mk("relax", 6, ids[u], e.to, nd, h[v]));
            } else {
                snap(mk("skip", 5, ids[u], e.to, nd, dist[v]));
            }
        }
    }
    snap(mk("done", 1));
    for (int i = 0; i < n; ++i) {
        res.dist[ids[i]] = dist[i];
        res.prev[ids[i]] = prev[i] < 0 ? -1 : ids[prev[i]];
    }
}

// ------------------------------------------------------------------- BFS
void bfs(const Graph& g, int src, Result& res, Recorder& rec) {
    std::set<int> visited{src};
    std::deque<int> q{src};   // deque để chụp được nội dung hàng đợi
    for (int id : g.nodeIds()) { res.dist[id] = INF; res.prev[id] = -1; }
    res.dist[src] = 0;
    auto snap = [&](Step s) {
        std::vector<std::pair<int, double>> v;
        for (int x : q) v.push_back({x, res.dist[x]});
        s.container = clip(std::move(v), s.size);
        rec.add(std::move(s));
    };
    snap(mk("init", 0, src));
    while (!q.empty()) {
        int u = q.front();
        q.pop_front();
        snap(mk("pop", 2, u, -1, res.dist[u]));
        for (const Edge& e : g.neighbors(u)) {
            if (!visited.count(e.to)) {
                visited.insert(e.to);
                res.dist[e.to] = res.dist[u] + 1;
                res.prev[e.to] = u;
                q.push_back(e.to);
                snap(mk("relax", 4, u, e.to, res.dist[e.to]));
            } else {
                snap(mk("skip", 3, u, e.to, res.dist[u] + 1, res.dist[e.to]));
            }
        }
    }
    snap(mk("done", 1));
}

// ------------------------------------------------------- DFS dùng ngăn xếp
void dfs(const Graph& g, int src, Result& res, Recorder& rec) {
    std::set<int> visited;
    std::vector<std::pair<int, int>> st{{src, -1}};   // (đỉnh, đỉnh đã đẩy nó vào)
    for (int id : g.nodeIds()) { res.dist[id] = INF; res.prev[id] = -1; }
    int order = 0;
    auto snap = [&](Step s) {
        std::vector<std::pair<int, double>> v;
        for (auto it = st.rbegin(); it != st.rend(); ++it) v.push_back({it->first, 0});  // đỉnh ngăn xếp trước
        s.container = clip(std::move(v), s.size);
        rec.add(std::move(s));
    };
    snap(mk("init", 0, src));
    while (!st.empty()) {
        auto [u, from] = st.back();
        st.pop_back();
        if (visited.count(u)) {
            snap(mk("skip", 3, from, u));
            continue;
        }
        visited.insert(u);
        res.dist[u] = order++;      // thứ tự thăm
        res.prev[u] = from;
        snap(mk("pop", 4, u, from, res.dist[u]));
        const auto& nb = g.neighbors(u);
        for (auto it = nb.rbegin(); it != nb.rend(); ++it)
            if (!visited.count(it->to)) {
                st.push_back({it->to, u});
                snap(mk("relax", 5, u, it->to));
            }
    }
    snap(mk("done", 1));
}

// ----------------------------------------------------------- Bellman-Ford
void bellman(const Graph& g, int src, Criterion crit, Vehicle veh, Result& res, Recorder& rec) {
    struct E { int u, v; double w; };
    std::vector<E> edges;
    for (int u : g.nodeIds())
        for (const Edge& e : g.neighbors(u))
            if (vehicleAllowed(e, veh)) edges.push_back({u, e.to, edgeWeight(e, crit, veh)});
    for (int id : g.nodeIds()) { res.dist[id] = INF; res.prev[id] = -1; }
    res.dist[src] = 0;
    rec.add(mk("init", 0, src));
    const int n = g.nodeCount();
    for (int round = 1; round <= n - 1; ++round) {
        rec.add(mk("round", 1, -1, -1, 0, round));
        bool changed = false;
        for (const E& e : edges) {
            if (res.dist[e.u] == INF) continue;
            double nd = res.dist[e.u] + e.w;
            if (nd < res.dist[e.v]) {
                res.dist[e.v] = nd;
                res.prev[e.v] = e.u;
                changed = true;
                rec.add(mk("relax", 4, e.u, e.v, nd, round));
            }
        }
        if (!changed) {
            rec.add(mk("stable", 5, -1, -1, 0, round));
            break;
        }
    }
    for (const E& e : edges) {
        if (res.dist[e.u] == INF) continue;
        if (res.dist[e.u] + e.w < res.dist[e.v] - 1e-9) {
            rec.add(mk("cycle", 6, e.u, e.v, res.dist[e.u] + e.w));
            // Dò ngược prev để lấy chu trình (giống BellmanFord.cpp)
            res.prev[e.v] = e.u;
            int x = e.v;
            for (int i = 0; i < n; ++i) x = res.prev[x];
            int cur = x;
            do {
                res.cycle.push_back(cur);
                cur = res.prev[cur];
            } while (cur != x && cur != -1);
            res.cycle.push_back(x);
            std::reverse(res.cycle.begin(), res.cycle.end());
            break;
        }
    }
    rec.add(mk("done", 6));
}

}  // namespace

Result run(const Graph& g, const std::string& algo, int src, int dst, Criterion crit, Vehicle veh, size_t maxSteps) {
    Result res;
    res.algo = algo;
    Recorder rec{res, maxSteps};
    if (!g.hasNode(src)) return res;
    if (algo == "bfs") {
        res.containerKind = "queue";
        res.pseudo = {"visited[s] ← đúng; queue.push(s)",
                      "while queue chưa rỗng:",
                      "    u ← queue.pop()",
                      "    for mỗi v kề u:  nếu đã thăm v thì bỏ qua",
                      "        visited[v] ← đúng; prev[v] ← u",
                      "        queue.push(v)"};
        bfs(g, src, res, rec);
    } else if (algo == "dfs") {
        res.containerKind = "stack";
        res.pseudo = {"stack.push(s)",
                      "while stack chưa rỗng:",
                      "    u ← stack.pop()",
                      "    if đã thăm u: bỏ qua",
                      "    thăm u",
                      "    for v kề u (đảo thứ tự): if chưa thăm v: stack.push(v)"};
        dfs(g, src, res, rec);
    } else if (algo == "bellman") {
        res.containerKind = "none";
        res.pseudo = {"dist[s] ← 0, mọi đỉnh khác ← ∞",
                      "for vòng ← 1 .. V−1:",
                      "    for mỗi cạnh (u, v, w):",
                      "        if dist[u] + w < dist[v]:",
                      "            dist[v] ← dist[u] + w; prev[v] ← u",
                      "    if vòng này không đổi gì: dừng sớm",
                      "for mỗi cạnh: nếu còn nới được → có chu trình âm"};
        bellman(g, src, crit, veh, res, rec);
    } else {
        bool a = algo == "astar";
        res.algo = a ? "astar" : "dijkstra";
        res.containerKind = "heap";
        res.pseudo = {a ? "dist[s] ← 0; heap.push(s, h(s))" : "dist[s] ← 0; heap.push(s, 0)",
                      "while heap chưa rỗng:",
                      a ? "    u ← heap.popMin()   // f = dist + h nhỏ nhất" : "    u ← heap.popMin()   // chốt dist[u]",
                      "    if u = đích: dừng",
                      "    for mỗi cạnh (u, v, w), v chưa chốt:",
                      "        if dist[u] + w ≥ dist[v]: bỏ qua",
                      "        dist[v] ← dist[u] + w; prev[v] ← u",
                      a ? "        heap.pushOrDecrease(v, dist[v] + h(v))" : "        heap.pushOrDecrease(v, dist[v])"};
        heapSearch(g, a, src, dst, crit, veh, res, rec);
    }
    return res;
}

}  // namespace Trace
