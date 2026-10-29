// ============================================================================
// ShortestPath.h — Đường đi ngắn nhất bằng Dijkstra (3 phiên bản) + benchmark
// (Phần "Đường đi ngắn nhất")
//
//   ARRAY    : mỗi bước quét mảng tìm đỉnh có dist nhỏ nhất       O(V^2)
//   STL_PQ   : std::priority_queue, "lazy deletion"                O((V+E) log E)
//   MIN_HEAP : IndexedMinHeap tự cài (MinHeap.h) có decreaseKey    O((V+E) log V)
//
// Cả 3 phiên bản cho CÙNG kết quả; khác nhau ở tốc độ (xem benchmark()).
// Hỗ trợ: chọn tiêu chí (km / phút / chi phí) và loại xe (đường cấm xe nào thì
// bỏ qua cạnh đó; tốc độ thực = min(giới hạn đường, tốc độ tối đa của xe)).
//
// Lưu ý: Dijkstra chỉ đúng khi mọi trọng số >= 0. Nếu đồ thị có cạnh chi phí
// âm, Tree::negativeEdge = true để giao diện cảnh báo và gợi ý Bellman-Ford.
// ============================================================================
#pragma once
#include "Graph.h"

#include <limits>
#include <map>
#include <set>
#include <string>
#include <utility>
#include <vector>

namespace ShortestPath {

const double INF = std::numeric_limits<double>::infinity();

enum class Version { ARRAY = 0, STL_PQ = 1, MIN_HEAP = 2 };

const char* versionName(Version v);
Version versionFromString(const std::string& s);  // "array" | "stl" | "heap"

struct Options {
    Criterion criterion = Criterion::DISTANCE;
    Vehicle vehicle = ANY_VEHICLE;
    int target = -1;  // >= 0: dừng sớm khi đã chốt được đỉnh đích
    // Dùng cho thuật toán Yen: tạm "cấm" một số cạnh / đỉnh
    const std::set<std::pair<int, int>>* bannedEdges = nullptr;
    const std::set<int>* bannedNodes = nullptr;
    // Giờ cao điểm: departAt = phút trong ngày lúc xuất phát (-1 = bỏ qua giờ).
    // Với tiêu chí TIME, trọng số cạnh phụ thuộc thời điểm xe đi tới cạnh đó:
    // nhãn dist[u] = số phút đã đi, cạnh (u,v) lúc departAt + dist[u].
    double departAt = -1;
    const RushProfile* rush = nullptr;
    bool timeDependent() const { return criterion == Criterion::TIME && rush && rush->enabled && departAt >= 0; }
};

// Cây đường đi ngắn nhất xuất phát từ source
struct Tree {
    int source = -1;
    std::map<int, double> dist;     // id -> khoảng cách (INF nếu không tới được)
    std::map<int, int> prev;        // id -> đỉnh đứng trước (-1 nếu không có)
    std::vector<int> settleOrder;   // thứ tự các đỉnh được "chốt" (minh hoạ thuật toán)
    long long relaxations = 0;      // số lần nới lỏng thành công
    long long heapOps = 0;          // số thao tác push/pop/decrease (hoặc số lần quét mảng)
    double micros = 0;              // thời gian chạy phần thuật toán (micro giây)
    double heuristicScale = 0;      // A*: hệ số α của heuristic (0 = không dùng heuristic)
    bool negativeEdge = false;      // có cạnh trọng số âm -> kết quả có thể sai
    bool valid = false;             // source có tồn tại không
};

Tree dijkstra(const Graph& g, int source, Version version, const Options& opt = Options());

// ------------------------------------ A* -------------------------------------
// Tìm đường source -> target. Giống Dijkstra (Min-Heap tự cài) nhưng lấy ra đỉnh có
// f(v) = dist[v] + h(v) nhỏ nhất, với h(v) = α × khoảng cách đường chim bay v -> target.
// α = min trên mọi cạnh của (trọng số cạnh / đường chim bay giữa 2 đầu cạnh), nên
// h(u) <= w(u,v) + h(v) (heuristic NHẤT QUÁN) với mọi tiêu chí và mọi dữ liệu:
// A* luôn cho kết quả đúng như Dijkstra nhưng thường xét ít đỉnh hơn.
// Cạnh âm -> α = 0 (A* thành Dijkstra). Giờ cao điểm chỉ làm cạnh chậm thêm nên h vẫn đúng.
Tree astar(const Graph& g, int source, int target, const Options& opt = Options());

// Khoảng cách đường chim bay (km) giữa 2 điểm theo vĩ độ / kinh độ (công thức haversine)
double straightLineKm(const Node& a, const Node& b);

// Dựng lại đường đi source -> dst từ mảng prev. Rỗng nếu không tới được.
std::vector<int> getPath(const Tree& t, int dst);

// Tổng hợp một đường đi cụ thể: km, phút (theo loại xe), chi phí (nghìn đồng).
struct PathInfo {
    bool found = false;
    std::vector<int> nodes;
    double km = 0, minutes = 0, costK = 0;
    double minutesBase = 0;   // thời gian nếu không có giờ cao điểm
    int hops = 0;
};
// departAt >= 0 và rush != nullptr: số phút tính theo giờ đi (có cao điểm); minutesBase luôn là giờ thường.
PathInfo describePath(const Graph& g, const std::vector<int>& path, Vehicle vehicle,
                      double departAt = -1, const RushProfile* rush = nullptr);

// ------------------------- K tuyến ngắn nhất (Yen) --------------------------
// Tìm tối đa K đường đi KHÔNG LẶP ĐỈNH ngắn nhất từ src tới dst, xếp tăng dần.
// Thuật toán Yen (1971): từ đường thứ k-1, với mỗi đỉnh "rẽ nhánh" i:
//   - giữ đoạn gốc src..i, cấm các cạnh mà những đường đã tìm cùng gốc đã đi tiếp,
//   - cấm các đỉnh của đoạn gốc (trừ i) để không lặp,
//   - chạy Dijkstra từ i tới dst -> ghép thành ứng viên.
// Ứng viên tốt nhất (lấy từ Min-Heap) trở thành đường thứ k.
// Độ phức tạp O(K · V · (V + E) log V).
struct RankedPath {
    std::vector<int> nodes;
    double weight = 0;
};
std::vector<RankedPath> kShortestPaths(const Graph& g, int src, int dst, int K, const Options& opt = Options());

// ------------------------------ Benchmark ---------------------------------
struct BenchRow {
    int nodes = 0;
    int edges = 0;
    double microsArray = 0, microsStl = 0, microsHeap = 0;  // trung bình mỗi lần chạy
    long long opsArray = 0, opsStl = 0, opsHeap = 0;
    bool agree = true;  // 3 phiên bản cho cùng khoảng cách?
};

// Đồ thị ngẫu nhiên liên thông n đỉnh, bậc trung bình ~avgDegree, trọng số = khoảng cách Euclid.
Graph randomGraph(int n, double avgDegree, unsigned seed);

std::vector<BenchRow> benchmark(const std::vector<int>& sizes, double avgDegree, int repeats,
                                unsigned seed = 2024);

}  // namespace ShortestPath
