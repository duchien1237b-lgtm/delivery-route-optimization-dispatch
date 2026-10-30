#include "Analysis.h"

#include "MinHeap.h"

#include <algorithm>
#include <chrono>
#include <limits>
#include <map>
#include <numeric>
#include <set>

namespace Analysis {

namespace {

const double INF = std::numeric_limits<double>::infinity();

double nowMicros() {
    using namespace std::chrono;
    return static_cast<double>(duration_cast<nanoseconds>(steady_clock::now().time_since_epoch()).count()) / 1000.0;
}

// Đồ thị vô hướng gọn(chỉ số 0..n-1), mỗi cặp điểm một cạnh (km nhỏ nhất của hai chiều)
struct Undirected {
    std::vector<int> ids;                       // chỉ số -> id nút
    std::map<int, int> index;                   // id nút -> chỉ số
    std::vector<MstEdge> edges;                 // u, v là CHỈ SỐ
    std::vector<std::vector<std::pair<int, int>>> adj;  // (đỉnh kề, số hiệu cạnh)
};

Undirected undirected(const Graph& g) {
    Undirected U;
    U.ids = g.nodeIds();
    for (size_t i = 0; i < U.ids.size(); ++i) U.index[U.ids[i]] = static_cast<int>(i);
    std::map<std::pair<int, int>, int> seen;
    for (int u : U.ids)
        for (const Edge& e : g.neighbors(u)) {
            int a = U.index[u], b = U.index[e.to];
            if (a == b) continue;
            std::pair<int, int> key = {std::min(a, b), std::max(a, b)};
            auto it = seen.find(key);
            if (it != seen.end()) {
                U.edges[it->second].km = std::min(U.edges[it->second].km, e.distance);
                continue;
            }
            seen[key] = static_cast<int>(U.edges.size());
            U.edges.push_back({key.first, key.second, e.distance});
        }
    U.adj.assign(U.ids.size(), {});
    for (size_t k = 0; k < U.edges.size(); ++k) {
        U.adj[U.edges[k].u].push_back({U.edges[k].v, static_cast<int>(k)});
        U.adj[U.edges[k].v].push_back({U.edges[k].u, static_cast<int>(k)});
    }
    return U;
}

}  // namespace

// =============================== Tarjan =====================================
CriticalReport criticalRoads(const Graph& g, int root, const std::vector<int>& destinations) {
    double t0 = nowMicros();
    CriticalReport rep;
    Undirected U = undirected(g);
    const int n = static_cast<int>(U.ids.size());
    std::vector<int> disc(n, -1), low(n, 0), parentEdge(n, -1), parent(n, -1);
    std::vector<int> subNodes(n, 1), subOrders(n, 0), childCount(n, 0);
    for (int d : destinations)
        if (U.index.count(d)) subOrders[U.index[d]]++;

    // Với mỗi đỉnh: các con c thoả low[c] >= disc[u] (để tính khớp sau)
    std::vector<std::vector<int>> cutChildren(n);
    int timer = 0;

    auto runFrom = [&](int s) {
        // Khung stack: (đỉnh, vị trí duyệt tiếp trong danh sách kề)
        std::vector<std::pair<int, size_t>> st;
        disc[s] = low[s] = timer++;
        st.push_back({s, 0});
        while (!st.empty()) {
            int u = st.back().first;
            size_t& it = st.back().second;
            if (it < U.adj[u].size()) {
                auto [w, eid] = U.adj[u][it++];
                if (eid == parentEdge[u]) continue;           // không đi ngược đúng cạnh vừa xuống
                if (disc[w] == -1) {                          // cạnh cây
                    parent[w] = u;
                    parentEdge[w] = eid;
                    childCount[u]++;
                    disc[w] = low[w] = timer++;
                    st.push_back({w, 0});
                } else {
                    low[u] = std::min(low[u], disc[w]);       // cạnh ngược
                }
                continue;
            }
            // Xong u: cập nhật cha
            st.pop_back();
            int p = parent[u];
            if (p < 0) continue;
            low[p] = std::min(low[p], low[u]);
            subNodes[p] += subNodes[u];
            subOrders[p] += subOrders[u];
            if (low[u] > disc[p]) {
                const MstEdge& e = U.edges[parentEdge[u]];
                Bridge b;
                b.u = U.ids[p];
                b.v = U.ids[u];
                b.km = e.km;
                b.cutNodes = subNodes[u];
                b.cutOrders = subOrders[u];
                rep.bridges.push_back(b);
            }
            if (low[u] >= disc[p]) cutChildren[p].push_back(u);
        }
        // Khớp
        // (xử lý sau khi xong cả thành phần để subNodes đã đủ)
    };

    std::vector<int> roots;
    if (U.index.count(root)) {
        roots.push_back(U.index[root]);
        runFrom(U.index[root]);
    }
    for (int i = 0; i < n; ++i)
        if (disc[i] == -1) {
            roots.push_back(i);
            runFrom(i);
        }
    std::set<int> rootSet(roots.begin(), roots.end());
    for (int u = 0; u < n; ++u) {
        if (rootSet.count(u)) {
            if (childCount[u] < 2) continue;
            // Gốc: các nhánh con tách rời nhau; coi nhánh lớn nhất là phần "còn lại"
            std::vector<int> kids;
            for (int c = 0; c < n; ++c)
                if (parent[c] == u) kids.push_back(c);
            int biggest = *std::max_element(kids.begin(), kids.end(),
                                            [&](int a, int b) { return subNodes[a] < subNodes[b]; });
            Articulation a;
            a.node = U.ids[u];
            a.parts = static_cast<int>(kids.size());
            for (int c : kids)
                if (c != biggest) { a.cutNodes += subNodes[c]; a.cutOrders += subOrders[c]; }
            rep.articulation.push_back(a);
        } else if (!cutChildren[u].empty()) {
            Articulation a;
            a.node = U.ids[u];
            a.parts = static_cast<int>(cutChildren[u].size()) + 1;
            for (int c : cutChildren[u]) { a.cutNodes += subNodes[c]; a.cutOrders += subOrders[c]; }
            rep.articulation.push_back(a);
        }
    }
    auto byImpact = [](const auto& a, const auto& b) {
        if (a.cutOrders != b.cutOrders) return a.cutOrders > b.cutOrders;
        return a.cutNodes > b.cutNodes;
    };
    std::stable_sort(rep.bridges.begin(), rep.bridges.end(), byImpact);
    std::stable_sort(rep.articulation.begin(), rep.articulation.end(), byImpact);
    rep.root = root;
    rep.micros = nowMicros() - t0;
    return rep;
}

// ================================ MST =======================================
DisjointSet::DisjointSet(int n) : parent_(n), rank_(n, 0), sets_(n) {
    std::iota(parent_.begin(), parent_.end(), 0);
}
int DisjointSet::find(int x) {
    int r = x;
    while (parent_[r] != r) r = parent_[r];
    while (parent_[x] != r) {  // nén đường đi
        int next = parent_[x];
        parent_[x] = r;
        x = next;
    }
    return r;
}
bool DisjointSet::unite(int a, int b) {
    a = find(a);
    b = find(b);
    if (a == b) return false;
    if (rank_[a] < rank_[b]) std::swap(a, b);
    parent_[b] = a;
    if (rank_[a] == rank_[b]) rank_[a]++;
    --sets_;
    return true;
}

MstResult kruskal(const Graph& g) {
    Undirected U = undirected(g);
    double t0 = nowMicros();
    MstResult res;
    std::vector<int> order(U.edges.size());
    std::iota(order.begin(), order.end(), 0);
    std::stable_sort(order.begin(), order.end(), [&](int a, int b) { return U.edges[a].km < U.edges[b].km; });
    DisjointSet dsu(static_cast<int>(U.ids.size()));
    for (int k : order) {
        const MstEdge& e = U.edges[k];
        res.work += 2;
        if (dsu.unite(e.u, e.v)) {
            res.edges.push_back({U.ids[e.u], U.ids[e.v], e.km});
            res.km += e.km;
            if (dsu.sets() == 1) break;
        }
    }
    res.trees = dsu.sets();
    res.micros = nowMicros() - t0;
    return res;
}

MstResult prim(const Graph& g) {
    Undirected U = undirected(g);
    double t0 = nowMicros();
    MstResult res;
    const int n = static_cast<int>(U.ids.size());
    std::vector<char> in(n, 0);
    std::vector<int> via(n, -1);   // cạnh rẻ nhất nối đỉnh vào cây
    for (int s = 0; s < n; ++s) {
        if (in[s]) continue;
        ++res.trees;
        IndexedMinHeap heap(n);
        heap.pushOrDecrease(s, 0);
        ++res.work;
        via[s] = -1;
        while (!heap.empty()) {
            auto [u, key] = heap.popMin();
            ++res.work;
            in[u] = 1;
            if (via[u] >= 0) {
                const MstEdge& e = U.edges[via[u]];
                res.edges.push_back({U.ids[e.u], U.ids[e.v], e.km});
                res.km += e.km;
            }
            for (auto [w, eid] : U.adj[u]) {
                if (in[w]) continue;
                double k = U.edges[eid].km;
                if (!heap.contains(w) || k < heap.keyOf(w)) {
                    heap.pushOrDecrease(w, k);
                    via[w] = eid;
                    ++res.work;
                }
            }
        }
    }
    res.micros = nowMicros() - t0;
    return res;
}

double totalKm(const Graph& g) {
    double s = 0;
    for (const MstEdge& e : undirected(g).edges) s += e.km;
    return s;
}

// ============================= Vị trí kho ===================================
std::vector<std::vector<double>> floydWarshall(const Graph& g, const std::vector<int>& ids, Vehicle v) {
    const int n = static_cast<int>(ids.size());
    std::map<int, int> index;
    for (int i = 0; i < n; ++i) index[ids[i]] = i;
    std::vector<std::vector<double>> d(n, std::vector<double>(n, INF));
    for (int i = 0; i < n; ++i) {
        d[i][i] = 0;
        for (const Edge& e : g.neighbors(ids[i])) {
            if (!vehicleAllowed(e, v) || !index.count(e.to)) continue;
            int j = index[e.to];
            d[i][j] = std::min(d[i][j], e.distance);
        }
    }
    for (int k = 0; k < n; ++k)
        for (int i = 0; i < n; ++i) {
            if (d[i][k] == INF) continue;
            const double dik = d[i][k];
            for (int j = 0; j < n; ++j)
                if (dik + d[k][j] < d[i][j]) d[i][j] = dik + d[k][j];
        }
    return d;
}

DepotReport suggestDepot(const Graph& g, int currentDepot, const std::vector<int>& destinations, Vehicle v, int top) {
    double t0 = nowMicros();
    DepotReport rep;
    rep.orders = static_cast<int>(destinations.size());
    std::vector<int> ids = g.nodeIds();
    const int n = static_cast<int>(ids.size());
    std::map<int, int> index;
    for (int i = 0; i < n; ++i) index[ids[i]] = i;

    // toDest[k][c] = km từ điểm c tới điểm giao thứ k (riêng biệt)
    std::vector<int> uniq;
    for (int d : destinations)
        if (index.count(d) && std::find(uniq.begin(), uniq.end(), d) == uniq.end()) uniq.push_back(d);
    std::vector<std::vector<double>> toDest(uniq.size(), std::vector<double>(n, INF));
    std::vector<std::vector<double>> all;
    if (n <= FLOYD_MAX) {
        rep.floyd = true;
        all = floydWarshall(g, ids, v);
        for (size_t k = 0; k < uniq.size(); ++k)
            for (int c = 0; c < n; ++c) toDest[k][c] = all[c][index[uniq[k]]];
    } else {
        // Dijkstra trên đồ thị ĐẢO CHIỀU từ mỗi điểm giao: dist(c -> d) = khoảng cách ngược d -> c
        std::vector<std::vector<std::pair<int, double>>> radj(n);
        for (int i = 0; i < n; ++i)
            for (const Edge& e : g.neighbors(ids[i]))
                if (vehicleAllowed(e, v) && index.count(e.to)) radj[index[e.to]].push_back({i, e.distance});
        for (size_t k = 0; k < uniq.size(); ++k) {
            std::vector<double>& dist = toDest[k];
            IndexedMinHeap heap(n);
            int s = index[uniq[k]];
            dist[s] = 0;
            heap.pushOrDecrease(s, 0);
            while (!heap.empty()) {
                auto [u, du] = heap.popMin();
                for (auto [w, km] : radj[u])
                    if (du + km < dist[w]) {
                        dist[w] = du + km;
                        heap.pushOrDecrease(w, dist[w]);
                    }
            }
        }
    }
    std::map<int, int> countAt;
    for (int d : destinations)
        if (index.count(d)) countAt[d]++;
    auto score = [&](int c) {
        DepotScore s;
        s.node = ids[c];
        for (size_t k = 0; k < uniq.size(); ++k) {
            double km = toDest[k][c];
            if (km == INF) continue;
            int cnt = countAt[uniq[k]];
            s.reachable += cnt;
            s.totalKm += km * cnt;
            s.maxKm = std::max(s.maxKm, km);
        }
        return s;
    };
    std::vector<DepotScore> scores;
    for (int c = 0; c < n; ++c) scores.push_back(score(c));
    std::stable_sort(scores.begin(), scores.end(), [](const DepotScore& a, const DepotScore& b) {
        if (a.reachable != b.reachable) return a.reachable > b.reachable;
        if (std::abs(a.totalKm - b.totalKm) > 1e-9) return a.totalKm < b.totalKm;
        return a.maxKm < b.maxKm;
    });
    if (static_cast<int>(scores.size()) > top) scores.resize(top);
    rep.ranking = scores;
    if (index.count(currentDepot)) rep.current = score(index[currentDepot]);

    // Tâm đồ thị: trong các điểm cùng cụm với kho (đi được hai chiều với kho), điểm có độ lệch tâm nhỏ nhất
    if (rep.floyd && index.count(currentDepot)) {
        int dep = index[currentDepot];
        std::vector<int> comp;
        for (int c = 0; c < n; ++c)
            if (all[dep][c] < INF && all[c][dep] < INF) comp.push_back(c);
        double best = INF;
        for (int c : comp) {
            double ecc = 0;
            for (int w : comp) ecc = std::max(ecc, all[c][w]);
            if (ecc < best - 1e-12) { best = ecc; rep.center = ids[c]; }
        }
        rep.centerEccentricity = best == INF ? 0 : best;
    }
    rep.micros = nowMicros() - t0;
    return rep;
}

}  // namespace Analysis
