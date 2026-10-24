// ============================================================================
// Traversal.h — Duyệt đồ thị: BFS, DFS, liên thông, vùng giao hàng
// Mọi hàm nhận vào const Graph&, KHÔNG sửa đồ thị.
// Nút không tồn tại -> trả về kết quả rỗng (không ném ngoại lệ).
// ============================================================================
#pragma once
#include "Graph.h"
#include <map>
#include <vector>

namespace Traversal {

// ---------- Duyệt cơ bản ----------
// Thứ tự thăm theo chiều rộng bắt đầu từ start.
std::vector<int> bfs(const Graph& g, int start);

// Thứ tự thăm theo chiều sâu (đệ quy).
std::vector<int> dfs(const Graph& g, int start);

// DFS dùng stack tự quản lý — cùng thứ tự với dfs(), an toàn với đồ thị rất lớn
// (không lo tràn stack do đệ quy).
std::vector<int> dfsIterative(const Graph& g, int start);

// Đường đi ÍT CHẶNG nhất (không xét trọng số) từ src đến dst bằng BFS.
// Trả về dãy nút src -> ... -> dst; rỗng nếu không có đường.
std::vector<int> bfsPath(const Graph& g, int src, int dst);

// Có đường từ src đến dst không?
bool hasPath(const Graph& g, int src, int dst);

// ---------- Liên thông ----------
// Đồ thị vô hướng: các thành phần liên thông.
// Đồ thị có hướng : các thành phần liên thông YẾU (bỏ qua chiều cạnh).
// Mỗi thành phần được sắp tăng dần; các thành phần sắp theo nút nhỏ nhất.
std::vector<std::vector<int>> connectedComponents(const Graph& g);

// true nếu đồ thị (vô hướng) liên thông / (có hướng) liên thông yếu.
// Đồ thị rỗng được coi là liên thông.
bool isConnected(const Graph& g);

// Thành phần liên thông MẠNH (thuật toán Kosaraju).
// Với đồ thị vô hướng kết quả trùng connectedComponents().
std::vector<std::vector<int>> stronglyConnectedComponents(const Graph& g);

// Các nút mà kho depot KHÔNG thể đi tới (dùng để cảnh báo đơn không giao được).
std::vector<int> unreachableFrom(const Graph& g, int depot);

// ---------- Vùng giao hàng ----------
// Các nút nằm trong vòng tối đa maxHops chặng tính từ kho.
// Trả về map: id nút -> số chặng (kho = 0).
std::map<int, int> deliveryZone(const Graph& g, int depot, int maxHops);

struct ZoneAssignment {
    std::map<int, int> owner;     // nút -> kho phụ trách
    std::map<int, int> hops;      // nút -> số chặng tới kho phụ trách
    std::vector<int> unassigned;  // nút không kho nào tới được
};

// Chia vùng cho nhiều kho bằng BFS đa nguồn: mỗi nút thuộc về kho gần nhất
// (theo số chặng). Hoà nhau -> kho đứng trước trong danh sách depots.
// Kho không tồn tại trong đồ thị bị bỏ qua.
ZoneAssignment assignZones(const Graph& g, const std::vector<int>& depots);

}  // namespace Traversal
