// Graph.cpp — BẢN TẠM (STUB), chỉ để test. Xem ghi chú ở Graph.h.
#include "Graph.h"
#include <algorithm>
#include <stdexcept>

bool Graph::addNode(int id, const std::string& name, double x, double y) {
    if (nodes_.count(id)) return false;
    nodes_[id] = Node{id, name, x, y};
    adj_[id];  // tạo danh sách kề rỗng
    return true;
}

bool Graph::removeNode(int id) {
    if (!nodes_.count(id)) return false;
    nodes_.erase(id);
    adj_.erase(id);
    for (auto& [u, list] : adj_)
        list.erase(std::remove_if(list.begin(), list.end(),
                                  [id](const Edge& e) { return e.to == id; }),
                   list.end());
    return true;
}

bool Graph::addEdge(int u, int v, double distance, double time, double cost) {
    if (!hasNode(u) || !hasNode(v)) return false;
    adj_[u].push_back(Edge{v, distance, time, cost});
    if (!directed_ && u != v) adj_[v].push_back(Edge{u, distance, time, cost});
    return true;
}

bool Graph::removeEdge(int u, int v) {
    if (!hasNode(u) || !hasNode(v)) return false;
    auto erase = [this](int a, int b) {
        auto& l = adj_[a];
        auto old = l.size();
        l.erase(std::remove_if(l.begin(), l.end(), [b](const Edge& e) { return e.to == b; }), l.end());
        return l.size() != old;
    };
    bool ok = erase(u, v);
    if (!directed_) erase(v, u);
    return ok;
}

bool Graph::hasNode(int id) const { return nodes_.count(id) > 0; }

const Node& Graph::getNode(int id) const {
    auto it = nodes_.find(id);
    if (it == nodes_.end()) throw std::out_of_range("Khong co nut " + std::to_string(id));
    return it->second;
}

const std::vector<Edge>& Graph::neighbors(int id) const {
    static const std::vector<Edge> empty;
    auto it = adj_.find(id);
    return it == adj_.end() ? empty : it->second;
}

std::vector<int> Graph::nodeIds() const {
    std::vector<int> ids;
    ids.reserve(nodes_.size());
    for (const auto& [id, n] : nodes_) ids.push_back(id);
    return ids;
}

int Graph::nodeCount() const { return static_cast<int>(nodes_.size()); }

int Graph::edgeCount() const {
    int total = 0, selfLoops = 0;
    for (const auto& [u, list] : adj_) {
        total += static_cast<int>(list.size());
        for (const auto& e : list) if (e.to == u) ++selfLoops;
    }
    return directed_ ? total : (total - selfLoops) / 2 + selfLoops;
}

void Graph::clear() { nodes_.clear(); adj_.clear(); }
