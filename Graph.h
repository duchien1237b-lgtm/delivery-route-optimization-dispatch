// ============================================================================
// Graph.h  —  BẢN TẠM (STUB) để phần Traversal/FileIO biên dịch & test độc lập.
// File chính thức do bạn phụ trách "Core + Tích hợp" viết. Khi merge, chỉ cần
// Graph thật có ĐỦ các hàm được đánh dấu [CẦN] bên dưới (cùng tên, cùng kiểu).
// ============================================================================
#pragma once
#include <map>
#include <string>
#include <vector>

struct Node {
    int id = -1;
    std::string name;
    double x = 0.0;   // vĩ độ / toạ độ X
    double y = 0.0;   // kinh độ / toạ độ Y
};

struct Edge {
    int to = -1;
    double distance = 0.0;  // km   (>= 0)
    double time = 0.0;      // phút (>= 0)
    double cost = 0.0;      // nghìn đồng (CHO PHÉP ÂM, để test Bellman-Ford)
};

class Graph {
public:
    explicit Graph(bool directed = false) : directed_(directed) {}

    bool addNode(int id, const std::string& name, double x = 0, double y = 0); // [CẦN]
    bool removeNode(int id);
    bool addEdge(int u, int v, double distance, double time, double cost);     // [CẦN]
    bool removeEdge(int u, int v);

    bool hasNode(int id) const;                          // [CẦN]
    const Node& getNode(int id) const;                   // [CẦN]
    const std::vector<Edge>& neighbors(int id) const;    // [CẦN] cạnh đi ra từ id
    std::vector<int> nodeIds() const;                    // [CẦN] id tăng dần
    int nodeCount() const;                               // [CẦN]
    int edgeCount() const;                               // [CẦN] vô hướng: mỗi cạnh tính 1 lần
    bool isDirected() const { return directed_; }        // [CẦN]
    void clear();

private:
    bool directed_;
    std::map<int, Node> nodes_;
    std::map<int, std::vector<Edge>> adj_;
};
