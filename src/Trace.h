// ============================================================================
// Trace.h — Ghi lại TỪNG BƯỚC chạy của thuật toán để mô phỏng trên web
// (trang "Mô phỏng"). Dùng chung cấu trúc dữ liệu với bản chạy thật:
//   - Dijkstra, A*: IndexedMinHeap tự cài (MinHeap.h), ghi lại nội dung heap
//     theo đúng thứ tự mảng sau mỗi thao tác -> vẽ được cây heap.
//   - BFS: hàng đợi (std::queue), DFS: ngăn xếp (std::stack) — cùng thứ tự
//     thăm với Traversal::bfs / Traversal::dfsIterative.
//   - Bellman-Ford: từng vòng nới lỏng, phát hiện chu trình âm.
// Kết quả cuối (dist, prev) trùng với các hàm gốc — có kiểm tra trong
// tests/test_features.cpp.
// ============================================================================
#pragma once
#include "Graph.h"

#include <map>
#include <string>
#include <utility>
#include <vector>

namespace Trace {

struct Step {
    std::string type;   // init | pop | found | relax | skip | visit | round | stable | cycle | done
    int line = -1;      // dòng mã giả đang chạy (0-based)
    int u = -1, v = -1;
    double value = 0;   // dist mới (relax), khoá lấy ra (pop), số chặng (BFS)...
    double extra = 0;   // A*: h(v); Bellman-Ford: số vòng
    // Trạng thái hàng đợi sau bước này: heap (id, khoá) theo thứ tự mảng / queue / stack.
    // Chỉ giữ tối đa MAX_SNAPSHOT phần tử đầu để gói tin nhỏ; size = kích thước thật.
    std::vector<std::pair<int, double>> container;
    int size = 0;
};

struct Result {
    std::string algo;                 // dijkstra | astar | bfs | dfs | bellman
    std::string containerKind;        // heap | queue | stack | none
    std::vector<std::string> pseudo;  // mã giả, mỗi phần tử một dòng
    std::vector<Step> steps;
    bool truncated = false;           // vượt giới hạn số bước
    std::map<int, double> dist;       // kết quả cuối
    std::map<int, int> prev;
    std::vector<int> cycle;           // Bellman-Ford: chu trình âm (nếu có)
    double heuristicScale = 0;        // A*
};

const int MAX_SNAPSHOT = 63;          // cây heap 6 tầng

// algo: dijkstra | astar | bfs | dfs | bellman. dst < 0: chạy hết (Dijkstra) / không dùng.
// BFS, DFS duyệt theo cấu trúc đồ thị (bỏ qua loại xe, giống module Traversal).
Result run(const Graph& g, const std::string& algo, int src, int dst, Criterion crit, Vehicle veh,
           size_t maxSteps = 4000);

}  // namespace Trace
