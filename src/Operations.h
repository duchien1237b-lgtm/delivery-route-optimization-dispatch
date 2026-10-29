// ============================================================================
// Operations.h — Vận hành ca giao hàng
// (Phần "Điều phối giao hàng")
//
// Sau khi so sánh, người điều phối chọn một phương án và "áp dụng":
//   - mỗi tuyến của shipper thành một CHUYẾN (Trip) với lộ trình và giờ dự kiến,
//   - đơn chuyển trạng thái Chờ giao -> Đang giao.
// Khi đồng hồ ca chạy (mô phỏng), đơn nào tới giờ dự kiến thì chuyển Đã giao
// (trễ nếu giờ giao > hạn). Có thể báo giao thất bại, đưa đơn thất bại về hàng chờ,
// hoặc kết thúc/đặt lại ca. Mỗi lần áp dụng được ghi vào lịch sử để làm báo cáo.
// ============================================================================
#pragma once
#include "Dispatcher.h"

#include <algorithm>
#include <map>
#include <set>
#include <string>
#include <vector>

struct TripStop {
    int orderId = -1;
    int node = -1;
    int pathIndex = 0;   // vị trí điểm giao trong lộ trình
    double eta = 0;      // phút dự kiến tới (tính từ đầu ca)
};

struct Trip {
    int id = 0;
    int shipper = -1;
    std::string shipperName;
    Vehicle vehicle = MOTORBIKE;
    std::vector<int> path;          // dãy nút kho -> ... -> kho
    std::vector<double> pathTimes;  // phút tới từng nút
    std::vector<TripStop> stops;
    double km = 0, minutes = 0, cost = 0, load = 0, capacity = 0;
    std::string note;               // vd "Shipper nghỉ lúc 07:40", "Đổi tuyến vì đóng đường"
    int reroutes = 0;               // số lần tính lại tuyến giữa ca
    bool accepted = true;           // false: đã phân công nhưng shipper chưa nhận chuyến (đơn ở trạng thái Đã phân công)
    // Ghép đơn tự động (kiểu Grab): lời mời có hạn trả lời, và đoạn shipper chạy từ chỗ đang đứng tới kho lấy hàng
    long long offerUntil = 0;       // giây (đồng hồ thật) hết hạn lời mời; 0 = không có hạn (phân công tay / đã nhận)
    double offerClock = 0;          // giờ ca lúc gửi lời mời (shipper nhận muộn thì lùi giờ xuất phát tương ứng)
    int fromNode = -1;              // nơi shipper đang đứng lúc nhận lời mời (-1 = không có đoạn tới kho)
    std::vector<int> approach;      // dãy nút từ fromNode tới kho
    std::vector<double> approachTimes;   // phút (từ đầu ca) tới từng nút của approach; nút cuối = giờ tới kho = pathTimes[0]
};

// Một dòng nhật ký ca (để truy vết: ai làm gì, lúc nào)
struct ShiftEvent {
    double t = 0;          // phút tính từ đầu ca
    std::string type;      // apply, delivered, failed, returned, cancelled, requeue, absent, available, reroute
    int order = -1;        // mã đơn liên quan (-1 nếu không có)
    int shipper = -1;      // chỉ số shipper liên quan (-1 nếu không có)
    std::string detail;    // tên phương án, lý do thất bại, "trễ 12 phút"...
};

// Kết quả tính lại tuyến khi giao thông thay đổi giữa ca
struct RerouteReport {
    int rerouted = 0;               // chuyến phải đổi đường (đoạn phía trước bị đóng)
    int retimed = 0;                // chuyến giữ đường nhưng giờ tới thay đổi (kẹt xe / thông đường)
    std::vector<int> dropped;       // đơn không còn đường tới -> trả về hàng chờ
    double maxDelay = 0;            // phút trễ thêm lớn nhất của giờ về (âm = sớm hơn)
};

struct DispatchRecord {             // một dòng lịch sử điều phối
    int id = 0;
    std::string when;               // giờ thực "23:41 24/10/2026"
    std::string plan;               // tên phương án
    int orders = 0, shippers = 0, predictedLate = 0;
    double km = 0, cost = 0, makespan = 0;
};

class ShiftManager {
public:
    // Áp dụng phương án (chuyến mới xuất phát tại thời điểm hiện tại của ca). pendingIdx[i] = chỉ số trong `orders` của đơn thứ i đã đưa vào Dispatcher.
    // Trả về số đơn được phân công.
    // awaitAccept = true: đơn chuyển sang "Đã phân công" (DISPATCHED) và chuyến chờ shipper nhận (accept / decline);
    // false (mặc định): đơn vào thẳng "Đang giao" (ASSIGNED) như bản gốc.
    // quiet = true (lời mời ghép tự động): không ghi lịch sử điều phối / nhật ký ca, lịch sử được ghi khi shipper nhận.
    int apply(const Plan& plan, const std::vector<int>& pendingIdx, std::vector<Order>& orders,
              const std::vector<Shipper>& shippers, bool awaitAccept = false, bool quiet = false);
    // Shipper nhận chuyến: mọi đơn Đã phân công của chuyến -> Đang giao. Trả về số đơn, -1 nếu chuyến không tồn tại / đã nhận.
    // Chuyến gửi lời mời trước, shipper nhận sau: giờ ca đã trôi bao nhiêu thì lùi giờ xuất phát / giờ tới từng điểm bấy nhiêu.
    int accept(int tripId, std::vector<Order>& orders);
    Trip* findTripMutable(int tripId);
    // Shipper nhả đơn đã nhận nhưng chưa lấy hàng: đơn về Chờ giao, bỏ khỏi chuyến, shipper đứng ở chỗ đã chạy tới. false nếu không hợp lệ.
    bool release(int orderId, std::vector<Order>& orders);
    // Shipper từ chối chuyến chưa nhận: đơn về Chờ giao, chuyến bị gỡ. Trả về số đơn trả lại, -1 nếu không hợp lệ.
    int decline(int tripId, std::vector<Order>& orders, const std::string& reason);
    const Trip* findTrip(int tripId) const;
    // Bỏ các chuyến chưa nhận mà không còn điểm giao nào (mọi đơn trong chuyến đã bị huỷ). Trả về số chuyến bị bỏ.
    int dropEmptyPendingTrips();
    // Bỏ các chuyến ghép tự động không còn điểm giao (đơn duy nhất đã huỷ), kể cả chuyến đã nhận
    int dropEmptyAutoTrips();
    // Nút cuối cùng chuyến đã đi qua tại giờ ca hiện tại (đoạn tới kho rồi lộ trình giao)
    int nodeReached(const Trip& t) const;
    const Trip* tripOfOrder(int orderId) const;
    // Giao xong một đơn Đang giao tại phút `at` (shipper xác nhận bằng mã). false nếu đơn không ở trạng thái Đang giao.
    bool deliver(int orderId, std::vector<Order>& orders, double at);
    // Chỉ chạy đồng hồ ca tới phút t, KHÔNG tự động giao (shipper phải xác nhận từng đơn)
    void advance(double t) { clock_ = std::max(clock_, t); }

    // Đồng hồ ca chạy tới phút t: đơn đang giao có eta <= t thành Đã giao. Trả về số đơn vừa giao.
    int progress(double t, std::vector<Order>& orders);

    // Đang giao -> Thất bại (lần thứ MAX_ATTEMPTS thì thành Hoàn kho). Trả về trạng thái mới, -1 nếu không hợp lệ.
    // reason: FailReason. Khách từ chối / hàng hư hỏng -> Hoàn kho ngay.
    int fail(int orderId, std::vector<Order>& orders, int reason = FAIL_ABSENT);
    bool requeue(int orderId, std::vector<Order>& orders);  // Thất bại -> Chờ giao (để điều phối lại)
    bool returnToDepot(int orderId, std::vector<Order>& orders);  // Thất bại -> Hoàn kho (quản trị viên quyết định không giao lại)
    // Khách huỷ đơn: Chờ giao / Đang giao / Thất bại -> Đã huỷ, bỏ khỏi chuyến
    bool cancel(int orderId, std::vector<Order>& orders);
    // Shipper nghỉ đột xuất: chuyến dừng ở vị trí hiện tại, đơn chưa giao về hàng chờ,
    // shipper bị loại khỏi các lần điều phối sau (tới khi có mặt lại hoặc đặt lại ca). Trả về số đơn trả lại.
    int shipperAbsent(int shipper, const std::string& name, std::vector<Order>& orders);
    void setAvailable(int shipper) {
        if (absent_.erase(shipper)) log(clock_, "available", -1, shipper, "");
    }
    bool isAbsent(int shipper) const { return absent_.count(shipper) > 0; }
    // Nơi shipper đang đứng khi rảnh (-1 = chưa biết): đơn cuối cùng giao / báo thất bại ở đâu thì shipper đứng ở đó.
    int standby(int shipper) const { auto it = standby_.find(shipper); return it == standby_.end() ? -1 : it->second; }
    void setStandby(int shipper, int node) { if (shipper >= 0) standby_[shipper] = node; }
    // Shipper còn đơn chưa xong (Đã phân công / Đang giao) hoặc đang chờ trả lời lời mời?
    bool busy(int shipper, const std::vector<Order>& orders) const;
    const std::set<int>& absent() const { return absent_; }
    void shipperRemoved(int shipper);   // xoá shipper khỏi danh sách: dời chỉ số
    // Giao thông vừa đổi: chuyến nào có đoạn phía trước bị đóng thì tìm đường khác (Dijkstra theo thời gian,
    // giữ thứ tự giao), còn lại chỉ tính lại giờ tới theo mức kẹt mới.
    RerouteReport reroute(const Graph& g, int depot, const RushProfile* rush, double dayStart, std::vector<Order>& orders);
    // Huỷ ca: xoá chuyến, đơn chưa xong về Chờ giao. keepFinal = false (bản gốc): MỌI đơn về Chờ giao;
    // keepFinal = true: giữ nguyên đơn đã giao / đã huỷ / hoàn kho / mới tạo (dùng khi chạy thật).
    void reset(std::vector<Order>& orders, bool keepFinal = false);

    // Giờ (phút từ đầu ca) shipper về tới kho sau chuyến cuối cùng; 0 nếu chưa chạy chuyến nào
    double freeAt(int shipper) const;
    std::vector<double> freeTimes(int shipperCount) const;
    void log(double t, const std::string& type, int order, int shipper, const std::string& detail);
    const std::vector<ShiftEvent>& events() const { return events_; }

    const std::vector<Trip>& trips() const { return trips_; }
    const std::vector<DispatchRecord>& history() const { return history_; }
    double clock() const { return clock_; }
    bool active() const { return !trips_.empty(); }

private:
    std::vector<Trip> trips_;
    std::vector<DispatchRecord> history_;
    double clock_ = 0;
    int nextTrip_ = 1;
    std::set<int> absent_;
    std::map<int, int> standby_;
    std::vector<ShiftEvent> events_;
};
