// ============================================================================
// BellmanFord.h — Bellman-Ford & phát hiện chu trình âm
// (Phần "Bellman-Ford + Dự toán")
//
// Khác Dijkstra, Bellman-Ford chạy đúng cả khi có cạnh trọng số ÂM (ví dụ
// tuyến được đối tác trợ giá) và phát hiện được CHU TRÌNH ÂM (vòng lặp mà
// mỗi lần đi qua lại "lời" thêm -> không tồn tại đường đi rẻ nhất).
//
//  - Nới lỏng toàn bộ cạnh tối đa V-1 vòng, dừng sớm nếu một vòng không đổi.
//  - Vòng thứ V còn nới được  => có chu trình âm đi tới được từ nguồn.
//  Độ phức tạp O(V * E).
// ============================================================================
#pragma once
#include "Graph.h"

#include <map>
#include <vector>

const double VO_CUC = 1e18;

struct BFResult {
    bool hopLe = false;                 // nguồn có tồn tại không
    std::map<int, double> khoangCach;   // id -> khoảng cách (VO_CUC nếu không tới)
    std::map<int, int> truoc;           // id -> đỉnh trước (-1 nếu không có)
    bool coChuTrinhAm = false;
    std::vector<int> chuTrinhAm;        // ví dụ {2, 3, 4, 2} nếu có
    int soVongLap = 0;                  // số vòng nới lỏng thực tế đã chạy
    long long soLanNoiLong = 0;         // số lần nới lỏng thành công
    double micros = 0;
};

// tieuChi mặc định là CHI PHÍ vì đó là trọng số có thể âm
// gioDi >= 0 và tieuChi = TIME: trọng số theo giờ cao điểm (nhãn = số phút đã đi).
BFResult bellmanFord(const Graph& g, int nguon,
                     Criterion tieuChi = Criterion::COST, Vehicle xe = ANY_VEHICLE,
                     double gioDi = -1, const RushProfile* caoDiem = nullptr);

// Đường đi nguon -> dich; rỗng nếu không tới được hoặc có chu trình âm.
std::vector<int> getPath(const BFResult& kq, int nguon, int dich);

// Tìm một chu trình âm BẤT KỲ trong đồ thị (dùng nguồn ảo nối tới mọi đỉnh).
// Rỗng nếu không có.
std::vector<int> findNegativeCycle(const Graph& g, Criterion tieuChi = Criterion::COST,
                                   Vehicle xe = ANY_VEHICLE);
