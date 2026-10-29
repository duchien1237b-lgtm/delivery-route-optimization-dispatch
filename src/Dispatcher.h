// ============================================================================
// Dispatcher.h — Điều phối giao hàng
// (Phần "Điều phối giao hàng")
//
// Đầu vào: bản đồ (Graph), 1 kho, danh sách đơn hàng, danh sách shipper.
// Khoảng cách giữa kho và các điểm giao lấy từ Dijkstra (Min-Heap tự cài)
// trên bản đồ thật, tính riêng cho từng loại xe (vì có đường cấm xe tải...).
//
// Hai nhóm thuật toán được so sánh với nhau:
//
// A. Một xe, bỏ qua tải trọng (bài toán người giao hàng — TSP)
//    1. Nearest Neighbor        : luôn đi tới điểm gần nhất chưa giao.
//    2. Ưu tiên đơn gấp         : lấy đơn gấp từ hàng đợi ưu tiên (MinHeap)
//                                 theo hạn sớm nhất, sau đó NN cho đơn thường.
//    3. Nearest Neighbor + 2-opt: cải thiện lộ trình NN bằng cách đảo đoạn.
//    4. TSP bitmask (Held-Karp) : quy hoạch động O(2^n * n^2), TỐI ƯU tuyệt đối
//                                 (chỉ chạy khi số điểm <= MAX_TSP).
//
// B. Nhiều shipper, có tải trọng (Capacitated VRP)
//    1. Nearest Neighbor tuần tự: lần lượt từng shipper nhận đơn gần nhất còn vừa tải.
//    2. Hàng đợi ưu tiên        : lấy đơn theo thứ tự gấp -> hạn sớm, giao cho
//                                 shipper đang đứng gần nhất còn đủ tải.
//    3. Cheapest insertion + 2-opt (thuật toán gốc của phần điều phối).
//    4. Cheapest insertion + TSP bitmask cho từng xe.
//    5. Chèn theo hạn giao: lấy đơn theo thứ tự ưu tiên, chèn vào vị trí làm
//       ÍT ĐƠN TRỄ nhất (giờ tới tính theo giờ thực tế, kể cả giờ cao điểm),
//       hoà thì ít km nhất; sau đó 2-opt từng tuyến theo cùng tiêu chí.
// ============================================================================
#pragma once
#include "FileIO.h"
#include "Graph.h"

#include <string>
#include <vector>

// Vòng đời đơn hàng trong ca giao
// CANCELLED: khách huỷ; RETURNED: giao thất bại đủ MAX_ATTEMPTS lần -> hoàn hàng về kho
// CREATED: khách vừa tạo, chờ quản trị viên xác nhận (khi tắt ghép tự động); DISPATCHED: đã phân công vào một chuyến, chờ shipper nhận chuyến
// (ASSIGNED = shipper đã nhận chuyến và đang giao). Giá trị 0..5 giữ nguyên để tương thích dữ liệu cũ.
enum OrderStatus { PENDING = 0, ASSIGNED = 1, DELIVERED = 2, FAILED = 3, CANCELLED = 4, RETURNED = 5, CREATED = 6, DISPATCHED = 7 };
const int ORDER_STATUS_COUNT = 8;
// "Chờ giao", "Đang giao", "Đã giao", "Thất bại", "Đã huỷ", "Hoàn kho", "Mới", "Đã phân công"
const char* orderStatusName(int s);
const int MAX_ATTEMPTS = 2;          // số lần giao thử tối đa trước khi hoàn hàng

// Lý do giao thất bại. Khách từ chối / hàng hư hỏng thì hoàn kho ngay, không giao lại.
enum FailReason { FAIL_ABSENT = 0, FAIL_ADDRESS = 1, FAIL_REFUSED = 2, FAIL_DAMAGED = 3, FAIL_RESCHEDULE = 4, FAIL_OTHER = 5 };
const int FAIL_REASON_COUNT = 6;
const char* failReasonName(int r);     // "Khách vắng nhà / không liên lạc được", ...
bool failReasonReturns(int r);         // lý do này có hoàn kho ngay không

struct Order {
    int id = -1;
    int destination = -1;  // id nút trên bản đồ
    double weight = 0;     // kg
    bool urgent = false;
    int deadline = -1;     // phút tính từ đầu ca, -1 = không có hạn
    std::string note;
    long long cod = 0;
    std::string phone, recipient;
    std::string owner;         // tài khoản khách hàng đặt đơn
    // Nghiệp vụ thương mại (xem FileIO.h để biết ý nghĩa từng trường)
    std::string promo;
    long long promoDiscount = 0, loyaltyDiscount = 0, gross = 0;
    long long createdAt = 0;
    std::string createdBy, deliveryCode;
    // Trạng thái vận hành (chỉ trong bộ nhớ, không lưu vào orders.txt)
    int status = PENDING;
    int shipper = -1;          // chỉ số shipper được giao
    double eta = -1;           // phút dự kiến tới nơi (tính từ đầu ca)
    double deliveredAt = -1;   // phút giao xong
    int attempts = 0;          // số lần giao thất bại
    int failReason = -1;       // lý do thất bại gần nhất (FailReason), -1 = chưa
    long long cancelFee = 0;   // phí huỷ đã tính
    std::string proofNote;     // ghi chú / ảnh bằng chứng khi giao
    long long deliveredReal = 0;   // giây (đồng hồ thật) lúc giao xong
    bool codRecorded = false;  // tiền thu hộ đã vào sổ COD
    int address = 0;           // mã địa chỉ trong sổ địa chỉ (0 = nhập tay)
    // Khai giá, kích thước, người trả cước, phí hoàn (xem Billing.h)
    long long declaredValue = 0, insuranceFee = 0;
    int dimL = 0, dimW = 0, dimH = 0;   // cm, 0 = không khai
    bool receiverPays = false;
    long long returnFee = 0;
    long long closedAt = 0;    // giây (đồng hồ thật) lúc đơn hoàn kho / bị huỷ
    // Ghép đơn tự động (chỉ trong bộ nhớ, không lưu vào orders.txt)
    std::vector<int> tried;    // chỉ số shipper đã từ chối / bỏ lỡ lời mời của đơn này (không mời lại)
    long long searchSince = 0; // giây (đồng hồ thật) đơn bắt đầu chờ ghép shipper
    long long noShipperAt = 0; // > 0: giây lúc hệ thống hết shipper để mời (khách đã được báo)

    Order() = default;
    Order(const OrderRecord& r);  // chuyển từ bản ghi đọc file (FileIO)
    OrderRecord toRecord() const;
};

struct Shipper {
    std::string name;
    double capacity = 0;  // kg
    Vehicle vehicle = MOTORBIKE;
};

// shippers.txt: mỗi dòng "<tải trọng kg> <loại xe 0/1/2> <tên có thể có dấu cách>"
bool loadShippers(const std::string& path, std::vector<Shipper>& out, std::string& error);
bool loadShippersText(const std::string& text, std::vector<Shipper>& out, std::string& error);
std::string shippersToText(const std::vector<Shipper>& shippers);

// Thứ tự ưu tiên: đơn gấp trước, rồi hạn giao sớm hơn (không hạn xếp sau), rồi mã đơn.
// Trả về true nếu đơn a được ưu tiên HƠN đơn b (dùng làm "Less" cho MinHeap).
bool higherPriority(const Order& a, const Order& b);

struct Route {
    int shipper = -1;             // -1: chế độ một xe
    Vehicle vehicle = ANY_VEHICLE;
    std::vector<int> orders;      // chỉ số đơn theo thứ tự giao
    std::vector<int> path;        // dãy nút đầy đủ trên bản đồ: kho -> ... (-> kho)
    std::vector<double> arrival;  // phút tới từng điểm giao (song song với orders)
    std::vector<double> pathTimes;// phút tới từng nút của path (đã cộng thời gian dừng giao ở các điểm trước)
    std::vector<int> stopIndex;   // vị trí trong path của từng điểm giao
    double load = 0, km = 0, minutes = 0, costVnd = 0;
    double rushDelay = 0;         // số phút chạy thêm vì giờ cao điểm
    int late = 0;
    double startAt = 0;           // phút xuất phát tính từ đầu ca (shipper đang chạy chuyến khác thì chờ về kho)
};

struct Plan {
    std::string key;          // mã ngắn: "nn", "urgent", "nn2opt", "tsp", ...
    std::string name;
    std::string description;
    std::vector<Route> routes;
    std::vector<int> overweight;   // đơn không shipper nào chở nổi / hết tải
    std::vector<int> unreachable;  // đơn không có đường (Traversal::unreachableFrom)
    double km = 0, minutes = 0, makespan = 0, costVnd = 0;
    int late = 0, served = 0;
    double micros = 0;
    bool optimal = false;      // TSP bitmask: lời giải tối ưu
    bool skipped = false;      // không chạy (vd TSP quá nhiều điểm)
    std::string note;
};

struct DispatchReport {
    std::vector<Plan> single;       // nhóm A
    std::vector<Plan> multi;        // nhóm B
    std::vector<int> priorityOrder; // thứ tự đơn lấy ra từ hàng đợi ưu tiên
    double matrixMicros = 0;        // thời gian dựng ma trận khoảng cách
    std::string error;
};

class Dispatcher {
public:
    static const int MAX_TSP = 15;

    Dispatcher(const Graph& g, int depot, std::vector<Order> orders, std::vector<Shipper> shippers,
               bool returnToDepot = true);

    // Nhóm A — một xe
    Plan singleNearestNeighbor(Vehicle v);
    Plan singleUrgentFirst(Vehicle v);
    Plan singleNearestNeighbor2Opt(Vehicle v);
    Plan singleTspBitmask(Vehicle v);

    // Nhóm B — nhiều shipper
    Plan multiNearestNeighbor();
    Plan multiPriorityQueue();
    Plan multiInsertion2Opt();
    Plan multiInsertionTsp();
    Plan multiDeadlineInsertion();

    DispatchReport compareAll(Vehicle singleVehicle);

    std::vector<int> priorityOrder() const;  // chỉ số đơn theo thứ tự hàng đợi ưu tiên
    // Điều phối giữa ca: xe xuất phát ở phút t (để so với hạn giao cho đúng). Giờ tới trong Route vẫn tính từ lúc xuất phát.
    void setStartTime(double t) { startTime_ = t; }
    // Shipper i chỉ nhận chuyến mới khi đã về kho: giờ rảnh (phút từ đầu ca) theo từng shipper
    void setShipperFreeAt(std::vector<double> t) { freeAt_ = std::move(t); }
    double startOf(int shipper) const;
    // Giờ cao điểm: ca bắt đầu lúc shiftStartOfDay (phút trong ngày). Thứ tự giao vẫn tối ưu theo km,
    // nhưng giờ tới từng điểm (và số đơn trễ hạn) được tính theo giờ thực tế xe đi qua từng đoạn.
    void setRush(const RushProfile* rush, double shiftStartOfDay) { rush_ = rush; dayStart_ = shiftStartOfDay; }
    const std::vector<Order>& orders() const { return orders_; }
    const std::vector<Shipper>& shippers() const { return shippers_; }

private:
    const Graph& g_;
    int depot_;
    std::vector<Order> orders_;
    std::vector<Shipper> shippers_;
    bool returnToDepot_;
    double startTime_ = 0;
    std::vector<double> freeAt_;
    const RushProfile* rush_ = nullptr;
    double dayStart_ = 0;

    // Điểm số 0 = kho, điểm i+1 = nơi giao của đơn i
    struct Matrix {
        bool built = false;
        std::vector<std::vector<double>> km, minutes;
        std::vector<std::vector<std::vector<int>>> path;
    };
    Matrix mat_[4];  // theo loại xe
    double matrixMicros_ = 0;

    const Matrix& matrix(Vehicle v);
    double dist(Vehicle v, int a, int b);           // a, b là chỉ số điểm
    double closeLeg(Vehicle v, int lastPoint);      // về kho (hoặc 0 nếu không quay về)
    bool reachable(Vehicle v, int order);
    double tourKm(Vehicle v, const std::vector<int>& orders);
    void twoOpt(Vehicle v, std::vector<int>& orders);
    // (số đơn trễ, km) của một tuyến — dùng cho phương án theo hạn giao
    std::pair<int, double> lateAndKm(int shipper, Vehicle v, const std::vector<int>& orders);
    std::vector<int> nearestNeighborTour(Vehicle v, std::vector<int> candidates, int startPoint = 0);
    std::vector<int> tspTour(Vehicle v, const std::vector<int>& orders);
    void insertionAssign(Plan& plan, std::vector<std::vector<int>>& routes);
    Route buildRoute(int shipper, Vehicle v, const std::vector<int>& orders);
    void finalize(Plan& plan);
    std::vector<int> candidatesFor(Vehicle v, Plan& plan);
};
