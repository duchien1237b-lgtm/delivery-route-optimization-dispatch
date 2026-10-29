#include "Traversal.h"

#include <algorithm>
#include <queue>
#include <set>
#include <stack>

namespace Traversal {

namespace {

// Đệ quy cho dfs()
void dfsVisit(const Graph& g, int u, std::set<int>& visited, std::vector<int>& order) {
    visited.insert(u);
    order.push_back(u);
    for (const Edge& e : g.neighbors(u))
        if (!visited.count(e.to)) dfsVisit(g, e.to, visited, order);
}

// Danh sách kề "bỏ chiều": dùng cho liên thông yếu của đồ thị có hướng.
std::map<int, std::vector<int>> undirectedView(const Graph& g) {
    std::map<int, std::vector<int>> adj;
    for (int u : g.nodeIds()) {
        adj[u];
        for (const Edge& e : g.neighbors(u)) {
            adj[u].push_back(e.to);
            adj[e.to].push_back(u);
        }
    }
    return adj;
}

// Danh sách kề đảo chiều: dùng cho Kosaraju.
std::map<int, std::vector<int>> reversedView(const Graph& g) {
    std::map<int, std::vector<int>> rev;
    for (int u : g.nodeIds()) {
        rev[u];
        for (const Edge& e : g.neighbors(u)) rev[e.to].push_back(u);
    }
    return rev;
}

// Kosaraju lượt 1: ghi nhận thứ tự HOÀN THÀNH (post-order).
void fillFinishOrder(const Graph& g, int u, std::set<int>& visited, std::vector<int>& finish) {
    visited.insert(u);
    for (const Edge& e : g.neighbors(u))
        if (!visited.count(e.to)) fillFinishOrder(g, e.to, visited, finish);
    finish.push_back(u);
}

// Kosaraju lượt 2: duyệt trên đồ thị đảo.
void collectReversed(const std::map<int, std::vector<int>>& rev, int u,
                     std::set<int>& visited, std::vector<int>& comp) {
    visited.insert(u);
    comp.push_back(u);
    for (int v : rev.at(u))
        if (!visited.count(v)) collectReversed(rev, v, visited, comp);
}

void sortComponents(std::vector<std::vector<int>>& comps) {
    for (auto& c : comps) std::sort(c.begin(), c.end());
    std::sort(comps.begin(), comps.end(),
              [](const std::vector<int>& a, const std::vector<int>& b) { return a.front() < b.front(); });
}

}  // namespace

// ============================== Duyệt cơ bản ===============================

std::vector<int> bfs(const Graph& g, int start) {
    std::vector<int> order;
    if (!g.hasNode(start)) return order;

    std::set<int> visited{start};
    std::queue<int> q;
    q.push(start);
    while (!q.empty()) {
        int u = q.front();
        q.pop();
        order.push_back(u);
        for (const Edge& e : g.neighbors(u)) {
            if (!visited.count(e.to)) {
                visited.insert(e.to);  // đánh dấu khi ĐƯA VÀO hàng đợi -> không bị trùng
                q.push(e.to);
            }
        }
    }
    return order;
}

std::vector<int> dfs(const Graph& g, int start) {
    std::vector<int> order;
    if (!g.hasNode(start)) return order;
    std::set<int> visited;
    dfsVisit(g, start, visited, order);
    return order;
}

std::vector<int> dfsIterative(const Graph& g, int start) {
    std::vector<int> order;
    if (!g.hasNode(start)) return order;

    std::set<int> visited;
    std::stack<int> st;
    st.push(start);
    while (!st.empty()) {
        int u = st.top();
        st.pop();
        if (visited.count(u)) continue;  // một nút có thể bị đẩy nhiều lần
        visited.insert(u);
        order.push_back(u);
        // Đẩy ngược để láng giềng đầu tiên được lấy ra trước -> giống bản đệ quy
        const auto& nb = g.neighbors(u);
        for (auto it = nb.rbegin(); it != nb.rend(); ++it)
            if (!visited.count(it->to)) st.push(it->to);
    }
    return order;
}

std::vector<int> bfsPath(const Graph& g, int src, int dst) {
    if (!g.hasNode(src) || !g.hasNode(dst)) return {};
    if (src == dst) return {src};

    std::map<int, int> parent{{src, src}};
    std::queue<int> q;
    q.push(src);
    while (!q.empty()) {
        int u = q.front();
        q.pop();
        for (const Edge& e : g.neighbors(u)) {
            if (parent.count(e.to)) continue;
            parent[e.to] = u;
            if (e.to == dst) {  // dừng sớm khi chạm đích
                std::vector<int> path;
                for (int v = dst; v != src; v = parent[v]) path.push_back(v);
                path.push_back(src);
                std::reverse(path.begin(), path.end());
                return path;
            }
            q.push(e.to);
        }
    }
    return {};
}

bool hasPath(const Graph& g, int src, int dst) {
    return !bfsPath(g, src, dst).empty();
}

// ================================ Liên thông ================================

std::vector<std::vector<int>> connectedComponents(const Graph& g) {
    auto adj = undirectedView(g);
    std::set<int> visited;
    std::vector<std::vector<int>> comps;

    for (int s : g.nodeIds()) {
        if (visited.count(s)) continue;
        std::vector<int> comp;
        std::queue<int> q;
        q.push(s);
        visited.insert(s);
        while (!q.empty()) {
            int u = q.front();
            q.pop();
            comp.push_back(u);
            for (int v : adj[u])
                if (!visited.count(v)) { visited.insert(v); q.push(v); }
        }
        comps.push_back(comp);
    }
    sortComponents(comps);
    return comps;
}

bool isConnected(const Graph& g) {
    return connectedComponents(g).size() <= 1;
}

std::vector<std::vector<int>> stronglyConnectedComponents(const Graph& g) {
    if (!g.isDirected()) return connectedComponents(g);

    // Lượt 1: thứ tự hoàn thành trên đồ thị gốc
    std::set<int> visited;
    std::vector<int> finish;
    for (int u : g.nodeIds())
        if (!visited.count(u)) fillFinishOrder(g, u, visited, finish);

    // Lượt 2: duyệt đồ thị đảo theo thứ tự hoàn thành giảm dần
    auto rev = reversedView(g);
    visited.clear();
    std::vector<std::vector<int>> comps;
    for (auto it = finish.rbegin(); it != finish.rend(); ++it) {
        if (visited.count(*it)) continue;
        std::vector<int> comp;
        collectReversed(rev, *it, visited, comp);
        comps.push_back(comp);
    }
    sortComponents(comps);
    return comps;
}

std::vector<int> unreachableFrom(const Graph& g, int depot) {
    std::vector<int> result;
    if (!g.hasNode(depot)) return g.nodeIds();
    auto reach = bfs(g, depot);
    std::set<int> reached(reach.begin(), reach.end());
    for (int u : g.nodeIds())
        if (!reached.count(u)) result.push_back(u);
    return result;
}

// ============================== Vùng giao hàng ==============================

std::map<int, int> deliveryZone(const Graph& g, int depot, int maxHops) {
    std::map<int, int> dist;
    if (!g.hasNode(depot) || maxHops < 0) return dist;

    dist[depot] = 0;
    std::queue<int> q;
    q.push(depot);
    while (!q.empty()) {
        int u = q.front();
        q.pop();
        if (dist[u] == maxHops) continue;  // không mở rộng quá giới hạn
        for (const Edge& e : g.neighbors(u)) {
            if (dist.count(e.to)) continue;
            dist[e.to] = dist[u] + 1;
            q.push(e.to);
        }
    }
    return dist;
}

ZoneAssignment assignZones(const Graph& g, const std::vector<int>& depots) {
    ZoneAssignment z;
    std::queue<int> q;

    // BFS đa nguồn: mọi kho vào hàng đợi cùng lúc với khoảng cách 0
    for (int d : depots) {
        if (!g.hasNode(d) || z.owner.count(d)) continue;
        z.owner[d] = d;
        z.hops[d] = 0;
        q.push(d);
    }
    while (!q.empty()) {
        int u = q.front();
        q.pop();
        for (const Edge& e : g.neighbors(u)) {
            if (z.owner.count(e.to)) continue;
            z.owner[e.to] = z.owner[u];
            z.hops[e.to] = z.hops[u] + 1;
            q.push(e.to);
        }
    }
    for (int u : g.nodeIds())
        if (!z.owner.count(u)) z.unassigned.push_back(u);
    return z;
}

}  // namespace Traversal
