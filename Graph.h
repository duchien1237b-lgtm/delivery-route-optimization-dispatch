// ============================================================================
// Graph.h — Lõi của hệ thống: đồ thị có trọng số biểu diễn bản đồ giao hàng
// (Phần "Core + Tích hợp")
//
//  - Nút  (Node): kho, ngã tư, địa chỉ khách hàng... có id, tên, toạ độ.
//  - Cạnh (Edge): đoạn đường nối 2 nút, mang 3 trọng số:
//        distance (km, >= 0), time (phút ở tốc độ giới hạn, >= 0),
//        cost (phụ phí nghìn đồng: cầu, phà, BOT... CHO PHÉP ÂM = trợ giá)
//    mặt nạ loại xe được phép đi (xe máy / ô tô / xe tải) và hệ số giờ cao điểm.
//  - Biểu diễn bằng DANH SÁCH KỀ: std::map<id, vector<Edge>>.
//    Đồ thị vô hướng lưu mỗi cạnh 2 lần (u->v và v->u).
//
// Ngoài ra file này định nghĩa mô hình "đường + loại xe + tiêu chí tối ưu"
// mà các module Dijkstra / Bellman-Ford / Estimator / Dispatcher dùng chung.
// ============================================================================
#pragma once
#include <map>
#include <ostream>
#include <string>
#include <vector>

// ------------------------------- Loại xe -----------------------------------
enum Vehicle { MOTORBIKE = 0, CAR = 1, TRUCK = 2, ANY_VEHICLE = 3 };

const int MASK_MOTO = 1, MASK_CAR = 2, MASK_TRUCK = 4, MASK_ALL = 7;

const char* vehicleName(Vehicle v);   // "Xe máy", "Ô tô", "Xe tải", "Mọi loại xe"
int vehicleMask(Vehicle v);           // bit tương ứng; ANY_VEHICLE -> MASK_ALL
double vehicleMaxSpeed(Vehicle v);    // km/h: xe máy 40, ô tô 60, xe tải 50
Vehicle vehicleFromInt(int v);        // 0..2, còn lại -> ANY_VEHICLE

// --------------------------- Tiêu chí tối ưu -------------------------------
enum class Criterion { DISTANCE = 0, TIME = 1, COST = 2 };

const char* criterionName(Criterion c);   // "Quãng đường (km)", ...
Criterion criterionFromString(const std::string& s);  // "distance" | "time" | "cost"

// Đơn giá dùng để quy đổi quãng đường ra tiền (nghìn đồng / km)
const double COST_PER_KM_K = 5.0;

// Hệ số giờ cao điểm mặc định của một đoạn đường (khi file map.txt không ghi)
const double DEFAULT_PEAK = 1.5;

// --------------------------------- Dữ liệu ---------------------------------
struct Node {
    int id = -1;
    std::string name;
    double x = 0.0;   // vĩ độ (lat)
    double y = 0.0;   // kinh độ (lon)
};

struct Edge {
    int to = -1;
    double distance = 0.0;  // km   (>= 0)
    double time = 0.0;      // phút (>= 0) khi chạy đúng tốc độ giới hạn
    double cost = 0.0;      // phụ phí nghìn đồng (CHO PHÉP ÂM)
    int allowed = MASK_ALL; // loại xe được phép đi qua
    // Giờ cao điểm: lúc đông nhất, ô tô đi đoạn này mất gấp `peak` lần bình thường
    // (1 = không bị ảnh hưởng, đường trung tâm thường 2 - 2,5). Xem RushProfile.
    double peak = DEFAULT_PEAK;
    // Tình trạng giao thông tạm thời (không lưu vào file):
    double jam = 1.0;       // hệ số kẹt xe: thời gian đi = thời gian bình thường × jam
    bool closed = false;    // đường bị đóng (sửa đường, ngập...) -> không xe nào đi được
};

// Xe v có được đi trên cạnh e không? (đường đang đóng thì không)
bool vehicleAllowed(const Edge& e, Vehicle v);

// Thời gian thực tế (phút) của xe v trên cạnh e:
// tốc độ thực = min(tốc độ giới hạn của đường, tốc độ tối đa của xe), nhân hệ số kẹt xe
double travelMinutes(const Edge& e, Vehicle v);

// ----------------------------- Giờ cao điểm --------------------------------
// Mức đông đúc theo giờ trong ngày, từ 0 (vắng) tới 1 (đông nhất).
// Mỗi khung cao điểm [start, end] đông nhất; trước và sau đó tăng / giảm dần
// trong `ramp` phút (hình thang). Thời gian đi một cạnh lúc t:
//     travelMinutes(e, v) × (1 + mức(t) × (e.peak − 1) × độNhạy(v))
// Xe máy len lỏi được nên độ nhạy chỉ 0,5; ô tô và xe tải 1.
//
// Tính FIFO (đi sớm thì không tới muộn hơn): đạo hàm thời gian đi theo giờ xuất phát
// = phút × (peak − 1) / ramp, luôn < 1 với dữ liệu thực tế (cạnh < 60 phút, ramp 60),
// nên Dijkstra theo giờ xuất phát vẫn cho kết quả đúng (Dreyfus, 1969).
struct RushWindow {
    int start = 0, end = 0;   // phút trong ngày, khoảng đông nhất
};

struct RushProfile {
    bool enabled = true;
    std::vector<RushWindow> windows{{7 * 60, 8 * 60 + 30}, {17 * 60, 18 * 60 + 30}};
    int ramp = 60;                               // phút tăng / giảm dần
    double sensitivity[3] = {0.5, 1.0, 1.0};     // xe máy, ô tô, xe tải

    double level(double minuteOfDay) const;      // 0..1 (0 nếu tắt)
    double multiplier(const Edge& e, Vehicle v, double minuteOfDay) const;
};

// Thời gian đi cạnh e khi bắt đầu vào đoạn đó lúc minuteOfDay. rush = nullptr: như travelMinutes.
double travelMinutesAt(const Edge& e, Vehicle v, double minuteOfDay, const RushProfile* rush);

// Chi phí đi qua cạnh (nghìn đồng) = km * đơn giá + phụ phí (có thể âm)
double edgeCostK(const Edge& e);

// Trọng số của cạnh theo tiêu chí tối ưu.
double edgeWeight(const Edge& e, Criterion c, Vehicle v);

// ---------------------------------- Graph ----------------------------------
class Graph {
public:
    explicit Graph(bool directed = false) : directed_(directed) {}

    // ---- Nút ----
    bool addNode(int id, const std::string& name, double x = 0, double y = 0);
    bool updateNode(int id, const std::string& name, double x, double y);
    bool removeNode(int id);           // xoá luôn mọi cạnh nối tới nút
    bool hasNode(int id) const;
    const Node& getNode(int id) const; // ném std::out_of_range nếu không có
    std::vector<int> nodeIds() const;  // id tăng dần
    int nodeCount() const;
    int nextNodeId() const;            // id nhỏ nhất chưa dùng (>= 0)

    // ---- Cạnh ----
    // false nếu: nút không tồn tại, u == v, cạnh u->v đã có, km/phút âm.
    bool addEdge(int u, int v, double distance, double time, double cost,
                 int allowed = MASK_ALL, double peak = DEFAULT_PEAK);
    bool updateEdge(int u, int v, double distance, double time, double cost,
                    int allowed = MASK_ALL, double peak = DEFAULT_PEAK);
    bool removeEdge(int u, int v);
    bool hasEdge(int u, int v) const;
    const Edge* getEdge(int u, int v) const;  // nullptr nếu không có
    const std::vector<Edge>& neighbors(int id) const;  // cạnh đi ra từ id
    int edgeCount() const;             // vô hướng: mỗi cạnh tính 1 lần
    bool hasNegativeCost() const;      // có cạnh nào chi phí (edgeCostK) < 0?

    // ---- Tình trạng giao thông ----
    // jam >= 1 (1 = bình thường). Đồ thị vô hướng: áp dụng cả hai chiều.
    bool setTraffic(int u, int v, double jam, bool closed);
    void clearTraffic();
    int trafficCount() const;          // số đoạn đường đang kẹt hoặc đóng

    bool isDirected() const { return directed_; }
    void clear();

    // In đồ thị dạng danh sách kề (dùng cho menu console)
    void print(std::ostream& os) const;

private:
    bool directed_;
    std::map<int, Node> nodes_;
    std::map<int, std::vector<Edge>> adj_;

    Edge* findEdge(int u, int v);
};
