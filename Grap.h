#pragma once
#include <vector>
struct Edge {
    int to;
    double weight;
};
class Graph {
private:
    int n;
    std::vector<std::vector<Edge>> adj;
public:
    Graph(int numNodes) : n(numNodes), adj(numNodes) {}
    void addEdge(int u, int v, double w) {
        adj[u].push_back({v, w});
    }
    int numNodes() const {
        return n;
    }
    const std::vector<Edge>& neighbors(int u) const {
        return adj[u];
    }
};
