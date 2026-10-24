// ============================================================================
// FileIO.h — Đọc/ghi bản đồ (map.txt) và danh sách đơn hàng (orders.txt)
//
// Mọi hàm trả về true nếu thành công; nếu lỗi trả về false và ghi lý do
// (kèm số dòng) vào tham số `error`. Khi load thất bại, dữ liệu đích
// (Graph / vector đơn hàng) được GIỮ NGUYÊN như trước khi gọi.
//
// ---------------------------- Định dạng map.txt -----------------------------
//   # dòng chú thích (từ dấu # đến hết dòng đều bị bỏ qua)
//   DIRECTED 0                      <- 0: vô hướng, 1: có hướng (tuỳ chọn, mặc định 0)
//   NODES <n>
//   <id> <x> <y> <tên có thể có dấu cách>     (n dòng)
//   EDGES <m>
//   <u> <v> <km> <phút> <chi phí>             (m dòng)
//   - km, phút phải >= 0; chi phí được phép âm.
//   - Đồ thị vô hướng: mỗi cạnh chỉ ghi MỘT lần.
//
// --------------------------- Định dạng orders.txt ---------------------------
//   # id  nút_đích  kg  gấp(0/1)  hạn(phút, -1 = không có)  ghi chú
//   101 3 2.5 1 45 Tai lieu gap
// ============================================================================
#pragma once
#include "Graph.h"
#include <string>
#include <vector>

// Bản ghi đơn hàng thô đọc từ file. Phần Dispatcher chuyển sang struct Order
// của mình (Order có thể kế thừa hoặc có constructor nhận OrderRecord).
struct OrderRecord {
    int id = -1;
    int destination = -1;  // id nút khách hàng trên bản đồ
    double weight = 0.0;   // kg, > 0
    bool urgent = false;   // đơn gấp -> ưu tiên trong hàng đợi
    int deadline = -1;     // phút tính từ đầu ca; -1 = không có hạn
    std::string note;      // ghi chú, có thể rỗng
};

namespace FileIO {

bool loadMap(const std::string& path, Graph& g, std::string& error);
bool saveMap(const std::string& path, const Graph& g, std::string& error);

// Nếu truyền g != nullptr: kiểm tra thêm nút đích có tồn tại trên bản đồ.
bool loadOrders(const std::string& path, std::vector<OrderRecord>& orders,
                std::string& error, const Graph* g = nullptr);
bool saveOrders(const std::string& path, const std::vector<OrderRecord>& orders,
                std::string& error);

}  // namespace FileIO
