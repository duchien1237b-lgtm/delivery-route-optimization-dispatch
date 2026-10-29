#include "Dispatcher.h"
#include "Estimator.h"
#include "MinHeap.h"
#include "ShortestPath.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <fstream>
#include <map>
#include <numeric>
#include <set>
#include <sstream>

using ShortestPath::INF;

// ============================== Order / Shipper =============================

Order::Order(const OrderRecord& r)
    : id(r.id), destination(r.destination), weight(r.weight), urgent(r.urgent),
      deadline(r.deadline), note(r.note), cod(r.cod), phone(r.phone), recipient(r.recipient), owner(r.owner),
      promo(r.promo), promoDiscount(r.promoDiscount), loyaltyDiscount(r.loyaltyDiscount), gross(r.gross),
      createdAt(r.createdAt), createdBy(r.createdBy), deliveryCode(r.deliveryCode), status(r.status),
      eta(r.eta), deliveredAt(r.deliveredAt), attempts(r.attempts), failReason(r.failReason), cancelFee(r.cancelFee),
      proofNote(r.proofNote), deliveredReal(r.deliveredReal), codRecorded(r.codRecorded), address(r.address),
      declaredValue(r.declaredValue), insuranceFee(r.insuranceFee), dimL(r.dimL), dimW(r.dimW), dimH(r.dimH),
      receiverPays(r.receiverPays), returnFee(r.returnFee), closedAt(r.closedAt) {}

OrderRecord Order::toRecord() const {
    OrderRecord r;
    r.id = id;
    r.destination = destination;
    r.weight = weight;
    r.urgent = urgent;
    r.deadline = deadline;
    r.note = note;
    r.cod = cod;
    r.phone = phone;
    r.recipient = recipient;
    r.owner = owner;
    r.promo = promo;
    r.promoDiscount = promoDiscount;
    r.loyaltyDiscount = loyaltyDiscount;
    r.gross = gross;
    r.createdAt = createdAt;
    r.createdBy = createdBy;
    r.deliveryCode = deliveryCode;
    r.status = status;
    r.eta = eta;
    r.deliveredAt = deliveredAt;
    r.attempts = attempts;
    r.failReason = failReason;
    r.cancelFee = cancelFee;
    r.proofNote = proofNote;
    r.deliveredReal = deliveredReal;
    r.codRecorded = codRecorded;
    r.address = address;
    r.declaredValue = declaredValue;
    r.insuranceFee = insuranceFee;
    r.dimL = dimL;
    r.dimW = dimW;
    r.dimH = dimH;
    r.receiverPays = receiverPays;
    r.returnFee = returnFee;
    r.closedAt = closedAt;
    return r;
}

const char* failReasonName(int r) {
    switch (r) {
        case FAIL_ABSENT: return "Khách vắng nhà / không liên lạc được";
        case FAIL_ADDRESS: return "Sai hoặc thiếu địa chỉ";
        case FAIL_REFUSED: return "Khách từ chối nhận";
        case FAIL_DAMAGED: return "Hàng hư hỏng";
        case FAIL_RESCHEDULE: return "Khách hẹn giao lại";
        default: return "Lý do khác";
    }
}
bool failReasonReturns(int r) { return r == FAIL_REFUSED || r == FAIL_DAMAGED; }

double Dispatcher::startOf(int shipper) const {
    if (shipper >= 0 && shipper < static_cast<int>(freeAt_.size())) return std::max(startTime_, freeAt_[shipper]);
    return startTime_;
}

const char* orderStatusName(int s) {
    switch (s) {
        case ASSIGNED: return "Đang giao";
        case DELIVERED: return "Đã giao";
        case FAILED: return "Thất bại";
        case CANCELLED: return "Đã huỷ";
        case RETURNED: return "Hoàn kho";
        case CREATED: return "Mới";
        case DISPATCHED: return "Đã phân công";
        default: return "Chờ giao";
    }
}

bool higherPriority(const Order& a, const Order& b) {
    if (a.urgent != b.urgent) return a.urgent;           // gấp trước
    int da = a.deadline < 0 ? 1 << 30 : a.deadline;     // không hạn -> xếp cuối
    int db = b.deadline < 0 ? 1 << 30 : b.deadline;
    if (da != db) return da < db;                        // hạn sớm trước
    return a.id < b.id;
}

namespace {

std::string trimStr(const std::string& s) {
    const char* ws = " \t\r\n";
    size_t b = s.find_first_not_of(ws);
    if (b == std::string::npos) return "";
    return s.substr(b, s.find_last_not_of(ws) - b + 1);
}

bool parseShippers(std::istream& in, std::vector<Shipper>& out, std::string& error) {
    std::vector<Shipper> result;
    std::string raw;
    int no = 0;
    while (std::getline(in, raw)) {
        ++no;
        if (no == 1 && raw.size() >= 3 && raw.compare(0, 3, "\xEF\xBB\xBF") == 0) raw.erase(0, 3);
        size_t hash = raw.find('#');
        if (hash != std::string::npos) raw.erase(hash);
        std::string t = trimStr(raw);
        if (t.empty()) continue;
        std::istringstream ss(t);
        Shipper s;
        int v;
        if (!(ss >> s.capacity >> v) || s.capacity <= 0 || v < 0 || v > 2) {
            error = "Dong " + std::to_string(no) + ": shipper phai co dang '<tai trong kg > 0> <loai xe 0/1/2> <ten>'";
            return false;
        }
        std::getline(ss, s.name);
        s.name = trimStr(s.name);
        if (s.name.empty()) s.name = "Shipper " + std::to_string(result.size() + 1);
        s.vehicle = vehicleFromInt(v);
        result.push_back(s);
    }
    out = std::move(result);
    return true;
}

// Thứ tự ưu tiên trên chỉ số đơn — "Less" cho MinHeap tự cài
struct PriorityLess {
    const std::vector<Order>* orders;
    bool operator()(int a, int b) const { return higherPriority((*orders)[a], (*orders)[b]); }
};

using Clock = std::chrono::steady_clock;
double since(Clock::time_point t) {
    return std::chrono::duration<double, std::micro>(Clock::now() - t).count();
}

}  // namespace

bool loadShippers(const std::string& path, std::vector<Shipper>& out, std::string& error) {
    std::ifstream in(path);
    if (!in) {
        error = "Khong mo duoc file: " + path;
        return false;
    }
    return parseShippers(in, out, error);
}

bool loadShippersText(const std::string& text, std::vector<Shipper>& out, std::string& error) {
    std::istringstream in(text);
    return parseShippers(in, out, error);
}

std::string shippersToText(const std::vector<Shipper>& shippers) {
    std::ostringstream out;
    out << "# Danh sach shipper\n# tai_trong(kg)  loai_xe(0 xe may, 1 o to, 2 xe tai)  ten\n";
    for (const Shipper& s : shippers)
        out << s.capacity << ' ' << static_cast<int>(s.vehicle) << ' ' << s.name << '\n';
    return out.str();
}

// ================================ Dispatcher ================================

Dispatcher::Dispatcher(const Graph& g, int depot, std::vector<Order> orders,
                       std::vector<Shipper> shippers, bool returnToDepot)
    : g_(g), depot_(depot), orders_(std::move(orders)), shippers_(std::move(shippers)),
      returnToDepot_(returnToDepot) {}

std::vector<int> Dispatcher::priorityOrder() const {
    MinHeap<int, PriorityLess> heap(PriorityLess{&orders_});
    for (int i = 0; i < (int)orders_.size(); ++i) heap.push(i);
    std::vector<int> order;
    while (!heap.empty()) order.push_back(heap.pop());
    return order;
}

// Ma trận khoảng cách giữa kho và mọi điểm giao, theo loại xe v.
const Dispatcher::Matrix& Dispatcher::matrix(Vehicle v) {
    Matrix& m = mat_[v];
    if (m.built) return m;
    auto t0 = Clock::now();
    const int P = static_cast<int>(orders_.size()) + 1;
    std::vector<int> node(P);
    node[0] = depot_;
    for (int i = 0; i < (int)orders_.size(); ++i) node[i + 1] = orders_[i].destination;

    m.km.assign(P, std::vector<double>(P, INF));
    m.minutes.assign(P, std::vector<double>(P, INF));
    m.path.assign(P, std::vector<std::vector<int>>(P));

    std::map<int, ShortestPath::Tree> cache;  // mỗi nút chỉ chạy Dijkstra 1 lần
    ShortestPath::Options opt;
    opt.criterion = Criterion::DISTANCE;
    opt.vehicle = v;
    for (int a = 0; a < P; ++a) {
        if (!g_.hasNode(node[a])) continue;
        if (!cache.count(node[a]))
            cache[node[a]] = ShortestPath::dijkstra(g_, node[a], ShortestPath::Version::MIN_HEAP, opt);
        const ShortestPath::Tree& t = cache[node[a]];
        for (int b = 0; b < P; ++b) {
            if (!g_.hasNode(node[b])) continue;
            if (node[a] == node[b]) {
                m.km[a][b] = m.minutes[a][b] = 0;
                m.path[a][b] = {node[a]};
                continue;
            }
            std::vector<int> p = ShortestPath::getPath(t, node[b]);
            if (p.empty()) continue;
            ShortestPath::PathInfo info = ShortestPath::describePath(g_, p, v);
            m.km[a][b] = info.km;
            m.minutes[a][b] = info.minutes;
            m.path[a][b] = std::move(p);
        }
    }
    m.built = true;
    matrixMicros_ += since(t0);
    return m;
}

double Dispatcher::dist(Vehicle v, int a, int b) { return matrix(v).km[a][b]; }

double Dispatcher::closeLeg(Vehicle v, int lastPoint) {
    return returnToDepot_ ? dist(v, lastPoint, 0) : 0.0;
}

bool Dispatcher::reachable(Vehicle v, int o) {
    if (dist(v, 0, o + 1) == INF) return false;
    return !returnToDepot_ || dist(v, o + 1, 0) != INF;
}

double Dispatcher::tourKm(Vehicle v, const std::vector<int>& tour) {
    if (tour.empty()) return 0;
    double d = dist(v, 0, tour.front() + 1);
    for (size_t i = 1; i < tour.size(); ++i) d += dist(v, tour[i - 1] + 1, tour[i] + 1);
    return d + closeLeg(v, tour.back() + 1);
}

// 2-opt: đảo ngược một đoạn nếu tổng quãng đường giảm.
// Tính lại toàn tuyến (thay vì công thức delta) để đúng cả với đường một chiều.
void Dispatcher::twoOpt(Vehicle v, std::vector<int>& tour) {
    const int n = static_cast<int>(tour.size());
    if (n < 2) return;
    double best = tourKm(v, tour);
    bool improved = true;
    while (improved) {
        improved = false;
        for (int i = 0; i < n - 1; ++i) {
            for (int j = i + 1; j < n; ++j) {
                std::reverse(tour.begin() + i, tour.begin() + j + 1);
                double d = tourKm(v, tour);
                if (d < best - 1e-9) {
                    best = d;
                    improved = true;
                } else {
                    std::reverse(tour.begin() + i, tour.begin() + j + 1);  // hoàn tác
                }
            }
        }
    }
}

std::vector<int> Dispatcher::nearestNeighborTour(Vehicle v, std::vector<int> candidates, int startPoint) {
    std::vector<int> tour;
    int cur = startPoint;
    while (!candidates.empty()) {
        int bestIdx = -1;
        double bestD = INF;
        for (int i = 0; i < (int)candidates.size(); ++i) {
            double d = dist(v, cur, candidates[i] + 1);
            if (d < bestD) {
                bestD = d;
                bestIdx = i;
            }
        }
        if (bestIdx < 0) break;  // các điểm còn lại không đi tới được từ vị trí hiện tại
        cur = candidates[bestIdx] + 1;
        tour.push_back(candidates[bestIdx]);
        candidates.erase(candidates.begin() + bestIdx);
    }
    return tour;
}

// TSP bằng quy hoạch động trên tập con (Held-Karp).
// dp[mask][j] = quãng đường ngắn nhất xuất phát từ kho, đi qua đúng tập mask, kết thúc tại j.
std::vector<int> Dispatcher::tspTour(Vehicle v, const std::vector<int>& orders) {
    const int k = static_cast<int>(orders.size());
    if (k == 0 || k > MAX_TSP) return {};
    const int FULL = (1 << k) - 1;
    std::vector<double> dp((size_t)(FULL + 1) * k, INF);
    std::vector<signed char> parent((size_t)(FULL + 1) * k, -1);
    auto at = [k](int mask, int j) { return (size_t)mask * k + j; };

    for (int j = 0; j < k; ++j) dp[at(1 << j, j)] = dist(v, 0, orders[j] + 1);
    for (int mask = 1; mask <= FULL; ++mask) {
        for (int j = 0; j < k; ++j) {
            if (!(mask & (1 << j))) continue;
            double cur = dp[at(mask, j)];
            if (cur == INF) continue;
            for (int nx = 0; nx < k; ++nx) {
                if (mask & (1 << nx)) continue;
                double nd = cur + dist(v, orders[j] + 1, orders[nx] + 1);
                int nm = mask | (1 << nx);
                if (nd < dp[at(nm, nx)]) {
                    dp[at(nm, nx)] = nd;
                    parent[at(nm, nx)] = static_cast<signed char>(j);
                }
            }
        }
    }
    double best = INF;
    int last = -1;
    for (int j = 0; j < k; ++j) {
        double d = dp[at(FULL, j)] + closeLeg(v, orders[j] + 1);
        if (d < best) {
            best = d;
            last = j;
        }
    }
    if (last < 0) return {};
    std::vector<int> tour;
    for (int mask = FULL, j = last; j != -1;) {
        tour.push_back(orders[j]);
        int pj = parent[at(mask, j)];
        mask ^= (1 << j);
        j = pj;
    }
    std::reverse(tour.begin(), tour.end());
    return tour;
}

Route Dispatcher::buildRoute(int shipper, Vehicle v, const std::vector<int>& tour) {
    const Matrix& m = matrix(v);
    Route r;
    r.shipper = shipper;
    r.vehicle = v;
    r.orders = tour;
    const double st = startOf(shipper);
    r.startAt = st;
    if (tour.empty()) return r;

    r.path.push_back(depot_);
    r.pathTimes.push_back(0);
    int cur = 0;
    double base = 0;  // tổng phút chạy nếu không có giờ cao điểm
    auto addLeg = [&](int to) {
        const std::vector<int>& p = m.path[cur][to];
        double t = r.minutes;
        for (size_t i = 1; i < p.size(); ++i) {
            if (const Edge* e = g_.getEdge(p[i - 1], p[i])) {
                t += travelMinutesAt(*e, v, dayStart_ + st + t, rush_);
                base += travelMinutes(*e, v);
            }
            r.path.push_back(p[i]);
            r.pathTimes.push_back(t);
        }
        r.km += m.km[cur][to];
        r.minutes = t;
        cur = to;
    };
    for (int o : tour) {
        addLeg(o + 1);
        r.stopIndex.push_back(static_cast<int>(r.path.size()) - 1);
        r.arrival.push_back(r.minutes);
        const Order& od = orders_[o];
        if (od.deadline >= 0 && st + r.minutes > od.deadline + 1e-9) ++r.late;
        r.minutes += PHUT_MOI_DIEM;  // dừng giao hàng
        r.load += od.weight;
    }
    if (returnToDepot_) addLeg(0);
    r.rushDelay = std::max(0.0, r.minutes - tour.size() * PHUT_MOI_DIEM - base);

    double phuPhi = 0;
    for (size_t i = 0; i + 1 < r.path.size(); ++i)
        if (const Edge* e = g_.getEdge(r.path[i], r.path[i + 1])) phuPhi += e->cost * 1000;
    r.costVnd = PHI_CO_DINH + r.km * GIA_MOI_KM + phuPhi;
    return r;
}

void Dispatcher::finalize(Plan& plan) {
    plan.km = plan.minutes = plan.makespan = plan.costVnd = 0;
    plan.late = plan.served = 0;
    for (const Route& r : plan.routes) {
        plan.km += r.km;
        plan.minutes += r.minutes;
        plan.makespan = std::max(plan.makespan, r.minutes);
        plan.costVnd += r.costVnd;
        plan.late += r.late;
        plan.served += static_cast<int>(r.orders.size());
    }
    std::sort(plan.overweight.begin(), plan.overweight.end());
    std::sort(plan.unreachable.begin(), plan.unreachable.end());
}

// Đơn mà xe v tới được (và quay về được); đơn còn lại vào plan.unreachable
std::vector<int> Dispatcher::candidatesFor(Vehicle v, Plan& plan) {
    std::vector<int> c;
    for (int o = 0; o < (int)orders_.size(); ++o) {
        if (reachable(v, o)) c.push_back(o);
        else plan.unreachable.push_back(o);
    }
    return c;
}

// ============================ Nhóm A — một xe ===============================

Plan Dispatcher::singleNearestNeighbor(Vehicle v) {
    Plan p;
    p.key = "nn";
    p.name = "Nearest Neighbor";
    p.description = "Từ vị trí hiện tại luôn đi tới điểm giao gần nhất chưa giao.";
    std::vector<int> cand = candidatesFor(v, p);
    auto t0 = Clock::now();
    std::vector<int> tour = nearestNeighborTour(v, cand);
    p.micros = since(t0);
    for (int o : cand)
        if (std::find(tour.begin(), tour.end(), o) == tour.end()) p.unreachable.push_back(o);
    p.routes.push_back(buildRoute(-1, v, tour));
    finalize(p);
    return p;
}

Plan Dispatcher::singleUrgentFirst(Vehicle v) {
    Plan p;
    p.key = "urgent";
    p.name = "Ưu tiên đơn gấp";
    p.description = "Lấy đơn gấp từ hàng đợi ưu tiên (Min-Heap, hạn sớm trước), sau đó giao đơn thường theo Nearest Neighbor.";
    std::vector<int> cand = candidatesFor(v, p);
    auto t0 = Clock::now();
    MinHeap<int, PriorityLess> heap(PriorityLess{&orders_});
    std::vector<int> normal, tour;
    for (int o : cand) {
        if (orders_[o].urgent) heap.push(o);
        else normal.push_back(o);
    }
    while (!heap.empty()) tour.push_back(heap.pop());
    int last = tour.empty() ? 0 : tour.back() + 1;
    for (int o : nearestNeighborTour(v, normal, last)) tour.push_back(o);
    p.micros = since(t0);
    for (int o : cand)
        if (std::find(tour.begin(), tour.end(), o) == tour.end()) p.unreachable.push_back(o);
    p.routes.push_back(buildRoute(-1, v, tour));
    finalize(p);
    return p;
}

Plan Dispatcher::singleNearestNeighbor2Opt(Vehicle v) {
    Plan p;
    p.key = "nn2opt";
    p.name = "Nearest Neighbor + 2-opt";
    p.description = "Lộ trình Nearest Neighbor được cải thiện bằng 2-opt: đảo ngược một đoạn nếu làm quãng đường ngắn hơn.";
    std::vector<int> cand = candidatesFor(v, p);
    auto t0 = Clock::now();
    std::vector<int> tour = nearestNeighborTour(v, cand);
    twoOpt(v, tour);
    p.micros = since(t0);
    for (int o : cand)
        if (std::find(tour.begin(), tour.end(), o) == tour.end()) p.unreachable.push_back(o);
    p.routes.push_back(buildRoute(-1, v, tour));
    finalize(p);
    return p;
}

Plan Dispatcher::singleTspBitmask(Vehicle v) {
    Plan p;
    p.key = "tsp";
    p.name = "TSP bitmask (tối ưu)";
    p.description = "Quy hoạch động trên tập con (Held-Karp), O(2ⁿ·n²): cho lộ trình ngắn nhất tuyệt đối.";
    std::vector<int> cand = candidatesFor(v, p);
    if ((int)cand.size() > MAX_TSP) {
        p.skipped = true;
        p.note = "Có " + std::to_string(cand.size()) + " điểm, vượt giới hạn " + std::to_string(MAX_TSP) +
                 " điểm của TSP bitmask.";
        finalize(p);
        return p;
    }
    auto t0 = Clock::now();
    std::vector<int> tour = tspTour(v, cand);
    p.micros = since(t0);
    if (tour.empty() && !cand.empty()) {
        p.note = "Không có lộ trình đi qua đủ mọi điểm (đường một chiều không khép kín).";
        p.unreachable.insert(p.unreachable.end(), cand.begin(), cand.end());
    } else {
        p.optimal = true;
    }
    p.routes.push_back(buildRoute(-1, v, tour));
    finalize(p);
    return p;
}

// ========================== Nhóm B — nhiều shipper ==========================

namespace {
// Đơn không ai nhận: phân loại "không có đường" hay "quá tải"
template <class Reach>
void classify(int o, Plan& p, const std::vector<Shipper>& ships, Reach reach) {
    for (const Shipper& s : ships)
        if (reach(s.vehicle, o)) {
            p.overweight.push_back(o);
            return;
        }
    p.unreachable.push_back(o);
}
}  // namespace

Plan Dispatcher::multiNearestNeighbor() {
    Plan p;
    p.key = "mnn";
    p.name = "Nearest Neighbor tuần tự";
    p.description = "Lần lượt từng shipper: luôn nhận đơn gần vị trí hiện tại nhất mà còn vừa tải trọng.";
    for (int k = 0; k < (int)shippers_.size(); ++k) matrix(shippers_[k].vehicle);
    auto t0 = Clock::now();
    std::vector<char> served(orders_.size(), 0);
    std::vector<std::vector<int>> tours(shippers_.size());
    for (int k = 0; k < (int)shippers_.size(); ++k) {
        Vehicle v = shippers_[k].vehicle;
        double load = 0;
        int cur = 0;
        while (true) {
            int best = -1;
            double bestD = INF;
            for (int o = 0; o < (int)orders_.size(); ++o) {
                if (served[o] || !reachable(v, o) || load + orders_[o].weight > shippers_[k].capacity) continue;
                double d = dist(v, cur, o + 1);
                if (d < bestD) {
                    bestD = d;
                    best = o;
                }
            }
            if (best < 0) break;
            served[best] = 1;
            load += orders_[best].weight;
            tours[k].push_back(best);
            cur = best + 1;
        }
    }
    p.micros = since(t0);
    auto reach = [this](Vehicle v, int o) { return reachable(v, o); };
    for (int o = 0; o < (int)orders_.size(); ++o)
        if (!served[o]) classify(o, p, shippers_, reach);
    for (int k = 0; k < (int)shippers_.size(); ++k) p.routes.push_back(buildRoute(k, shippers_[k].vehicle, tours[k]));
    finalize(p);
    return p;
}

Plan Dispatcher::multiPriorityQueue() {
    Plan p;
    p.key = "mpq";
    p.name = "Hàng đợi ưu tiên";
    p.description = "Lấy đơn từ hàng đợi ưu tiên (gấp → hạn sớm), giao cho shipper đang đứng gần đơn nhất mà còn đủ tải.";
    for (int k = 0; k < (int)shippers_.size(); ++k) matrix(shippers_[k].vehicle);
    auto t0 = Clock::now();
    MinHeap<int, PriorityLess> heap(PriorityLess{&orders_});
    for (int o = 0; o < (int)orders_.size(); ++o) heap.push(o);
    std::vector<std::vector<int>> tours(shippers_.size());
    std::vector<double> load(shippers_.size(), 0);
    std::vector<int> pending;
    while (!heap.empty()) {
        int o = heap.pop();
        int bestK = -1;
        double bestD = INF;
        for (int k = 0; k < (int)shippers_.size(); ++k) {
            Vehicle v = shippers_[k].vehicle;
            if (!reachable(v, o) || load[k] + orders_[o].weight > shippers_[k].capacity) continue;
            int cur = tours[k].empty() ? 0 : tours[k].back() + 1;
            double d = dist(v, cur, o + 1);
            if (d < bestD) {
                bestD = d;
                bestK = k;
            }
        }
        if (bestK < 0) {
            pending.push_back(o);
            continue;
        }
        tours[bestK].push_back(o);
        load[bestK] += orders_[o].weight;
    }
    p.micros = since(t0);
    auto reach = [this](Vehicle v, int o) { return reachable(v, o); };
    for (int o : pending) classify(o, p, shippers_, reach);
    for (int k = 0; k < (int)shippers_.size(); ++k) p.routes.push_back(buildRoute(k, shippers_[k].vehicle, tours[k]));
    finalize(p);
    return p;
}

// Cheapest insertion có ràng buộc tải trọng (thuật toán gốc của phần điều phối):
// xét đơn nặng trước, chèn mỗi đơn vào vị trí làm tăng quãng đường ít nhất.
void Dispatcher::insertionAssign(Plan& p, std::vector<std::vector<int>>& tours) {
    const int K = static_cast<int>(shippers_.size());
    tours.assign(K, {});
    std::vector<double> load(K, 0);
    std::vector<int> idx(orders_.size());
    std::iota(idx.begin(), idx.end(), 0);
    std::stable_sort(idx.begin(), idx.end(),
                     [&](int a, int b) { return orders_[a].weight > orders_[b].weight; });

    auto reach = [this](Vehicle v, int o) { return reachable(v, o); };
    for (int o : idx) {
        double bestCost = INF;
        int bestK = -1, bestPos = -1;
        for (int k = 0; k < K; ++k) {
            Vehicle v = shippers_[k].vehicle;
            if (!reachable(v, o) || load[k] + orders_[o].weight > shippers_[k].capacity) continue;
            std::vector<int>& r = tours[k];
            for (size_t pos = 0; pos <= r.size(); ++pos) {
                int prev = (pos == 0) ? 0 : r[pos - 1] + 1;
                int cur = o + 1;
                double cost;
                if (pos == r.size())  // chèn cuối: thay chặng prev -> kho bằng prev -> cur -> kho
                    cost = dist(v, prev, cur) + closeLeg(v, cur) - (r.empty() ? 0 : closeLeg(v, prev));
                else {
                    int next = r[pos] + 1;
                    cost = dist(v, prev, cur) + dist(v, cur, next) - dist(v, prev, next);
                }
                if (cost < bestCost) {
                    bestCost = cost;
                    bestK = k;
                    bestPos = static_cast<int>(pos);
                }
            }
        }
        if (bestK < 0) {
            classify(o, p, shippers_, reach);
        } else {
            tours[bestK].insert(tours[bestK].begin() + bestPos, o);
            load[bestK] += orders_[o].weight;
        }
    }
}

Plan Dispatcher::multiInsertion2Opt() {
    Plan p;
    p.key = "ins2opt";
    p.name = "Cheapest Insertion + 2-opt";
    p.description = "Xét đơn nặng trước, chèn vào vị trí làm tăng quãng đường ít nhất trong các shipper còn đủ tải; sau đó tối ưu từng tuyến bằng 2-opt.";
    for (int k = 0; k < (int)shippers_.size(); ++k) matrix(shippers_[k].vehicle);
    auto t0 = Clock::now();
    std::vector<std::vector<int>> tours;
    insertionAssign(p, tours);
    for (int k = 0; k < (int)tours.size(); ++k) twoOpt(shippers_[k].vehicle, tours[k]);
    p.micros = since(t0);
    for (int k = 0; k < (int)tours.size(); ++k) p.routes.push_back(buildRoute(k, shippers_[k].vehicle, tours[k]));
    finalize(p);
    return p;
}

Plan Dispatcher::multiInsertionTsp() {
    Plan p;
    p.key = "instsp";
    p.name = "Cheapest Insertion + TSP từng xe";
    p.description = "Phân đơn như Cheapest Insertion, sau đó sắp thứ tự giao tối ưu cho từng shipper bằng TSP bitmask.";
    for (int k = 0; k < (int)shippers_.size(); ++k) matrix(shippers_[k].vehicle);
    auto t0 = Clock::now();
    std::vector<std::vector<int>> tours;
    insertionAssign(p, tours);
    bool allOptimal = true;
    for (int k = 0; k < (int)tours.size(); ++k) {
        Vehicle v = shippers_[k].vehicle;
        std::vector<int> best = tspTour(v, tours[k]);
        if (!best.empty()) tours[k] = best;
        else if ((int)tours[k].size() > MAX_TSP) {
            twoOpt(v, tours[k]);
            allOptimal = false;
        }
    }
    p.micros = since(t0);
    p.optimal = allOptimal;
    if (!allOptimal) p.note = "Tuyến nào quá " + std::to_string(MAX_TSP) + " điểm được tối ưu bằng 2-opt.";
    for (int k = 0; k < (int)tours.size(); ++k) p.routes.push_back(buildRoute(k, shippers_[k].vehicle, tours[k]));
    finalize(p);
    return p;
}

std::pair<int, double> Dispatcher::lateAndKm(int shipper, Vehicle v, const std::vector<int>& tour) {
    if (tour.empty()) return {0, 0.0};
    Route r = buildRoute(shipper, v, tour);
    return {r.late, r.km};
}

Plan Dispatcher::multiDeadlineInsertion() {
    Plan p;
    p.key = "deadline";
    p.name = "Theo hạn giao + tìm kiếm cục bộ";
    p.description = "Hai lời giải khởi đầu (chèn theo thứ tự ưu tiên gấp/hạn sớm, và chèn rẻ nhất) được cải thiện bằng "
                    "tìm kiếm cục bộ: chuyển một đơn sang vị trí hoặc shipper khác (relocate) và 2-opt. Mục tiêu: ít đơn "
                    "trễ nhất, hoà thì ít km nhất; giờ tới tính theo giờ thực tế (kể cả giờ cao điểm).";
    for (int k = 0; k < (int)shippers_.size(); ++k) matrix(shippers_[k].vehicle);
    auto t0 = Clock::now();
    const int K = static_cast<int>(shippers_.size());
    using Eval = std::pair<int, double>;   // (số đơn trễ, km)
    auto better = [](const Eval& a, const Eval& b) {
        return a.first < b.first || (a.first == b.first && a.second < b.second - 1e-9);
    };
    auto sum = [](const std::vector<Eval>& e) {
        Eval t{0, 0.0};
        for (const Eval& x : e) { t.first += x.first; t.second += x.second; }
        return t;
    };
    auto loadOf = [this](const std::vector<int>& t) {
        double l = 0;
        for (int o : t) l += orders_[o].weight;
        return l;
    };

    // Tìm kiếm cục bộ: relocate (kể cả trong cùng tuyến) + 2-opt, tới khi không cải thiện được
    auto improve = [&](std::vector<std::vector<int>>& tours) {
        std::vector<Eval> ev(K);
        for (int k = 0; k < K; ++k) ev[k] = lateAndKm(k, shippers_[k].vehicle, tours[k]);
        bool improved = true;
        int guard = 0;
        while (improved && guard++ < 200) {
            improved = false;
            for (int a = 0; a < K && !improved; ++a)
                for (size_t i = 0; i < tours[a].size() && !improved; ++i) {
                    int o = tours[a][i];
                    std::vector<int> ta = tours[a];
                    ta.erase(ta.begin() + i);
                    Eval ea = lateAndKm(a, shippers_[a].vehicle, ta);
                    for (int b = 0; b < K && !improved; ++b) {
                        Vehicle vb = shippers_[b].vehicle;
                        if (b != a && (!reachable(vb, o) || loadOf(tours[b]) + orders_[o].weight > shippers_[b].capacity)) continue;
                        const std::vector<int>& base = b == a ? ta : tours[b];
                        for (size_t j = 0; j <= base.size(); ++j) {
                            if (b == a && j == i) continue;
                            std::vector<int> tb = base;
                            tb.insert(tb.begin() + j, o);
                            Eval eb = lateAndKm(b, vb, tb);
                            Eval before = b == a ? ev[a] : Eval{ev[a].first + ev[b].first, ev[a].second + ev[b].second};
                            Eval after = b == a ? eb : Eval{ea.first + eb.first, ea.second + eb.second};
                            if (better(after, before)) {
                                if (b == a) { tours[a] = tb; ev[a] = eb; }
                                else { tours[a] = ta; tours[b] = tb; ev[a] = ea; ev[b] = eb; }
                                improved = true;
                                break;
                            }
                        }
                    }
                }
            for (int k = 0; k < K && !improved; ++k) {   // 2-opt trong từng tuyến
                std::vector<int>& t = tours[k];
                for (int i = 0; i + 1 < (int)t.size() && !improved; ++i)
                    for (int j = i + 1; j < (int)t.size() && !improved; ++j) {
                        std::reverse(t.begin() + i, t.begin() + j + 1);
                        Eval e = lateAndKm(k, shippers_[k].vehicle, t);
                        if (better(e, ev[k])) { ev[k] = e; improved = true; }
                        else std::reverse(t.begin() + i, t.begin() + j + 1);
                    }
            }
        }
        return sum(ev);
    };

    // Khởi đầu 1: lấy đơn theo hàng đợi ưu tiên, chèn vào chỗ ít trễ nhất rồi ít km nhất
    Plan scratch;
    std::vector<std::vector<int>> a(K);
    std::vector<double> load(K, 0);
    std::vector<Eval> cur(K, {0, 0.0});
    std::vector<int> skipped;
    for (int o : priorityOrder()) {
        double bestCost = INF;
        int bestK = -1, bestPos = -1;
        Eval bestEval;
        for (int k = 0; k < K; ++k) {
            Vehicle v = shippers_[k].vehicle;
            if (!reachable(v, o) || load[k] + orders_[o].weight > shippers_[k].capacity) continue;
            for (size_t pos = 0; pos <= a[k].size(); ++pos) {
                std::vector<int> t = a[k];
                t.insert(t.begin() + pos, o);
                Eval ev = lateAndKm(k, v, t);
                double cost = (ev.first - cur[k].first) * 1e6 + (ev.second - cur[k].second);
                if (cost < bestCost - 1e-9) { bestCost = cost; bestK = k; bestPos = static_cast<int>(pos); bestEval = ev; }
            }
        }
        if (bestK < 0) { skipped.push_back(o); continue; }
        a[bestK].insert(a[bestK].begin() + bestPos, o);
        load[bestK] += orders_[o].weight;
        cur[bestK] = bestEval;
    }
    // Các lời giải khởi đầu khác: chèn rẻ nhất, và kết quả của các phương án nhiều shipper còn lại.
    // Tìm kiếm cục bộ từ mỗi lời giải rồi giữ lời giải tốt nhất (multi-start) -> không bao giờ kém hơn chúng.
    std::vector<std::vector<std::vector<int>>> starts{a};
    std::vector<std::vector<int>> b;
    insertionAssign(scratch, b);
    starts.push_back(b);
    for (Plan q : {multiNearestNeighbor(), multiPriorityQueue(), multiInsertion2Opt()}) {
        std::vector<std::vector<int>> t(K);
        for (const Route& r : q.routes) if (r.shipper >= 0) t[r.shipper] = r.orders;
        starts.push_back(t);
    }
    auto served = [](const std::vector<std::vector<int>>& t) { size_t n = 0; for (const auto& x : t) n += x.size(); return n; };
    std::vector<std::vector<int>> best;
    Eval bestEval{0, 0.0};
    for (auto& t : starts) {
        Eval e = improve(t);
        if (best.empty() || served(t) > served(best) || (served(t) == served(best) && better(e, bestEval))) {
            best = t;
            bestEval = e;
        }
    }
    skipped.clear();
    std::vector<char> in(orders_.size(), 0);
    for (const auto& t : best) for (int o : t) in[o] = 1;
    for (int o = 0; o < (int)orders_.size(); ++o) if (!in[o]) skipped.push_back(o);
    auto reach = [this](Vehicle v, int o) { return reachable(v, o); };
    for (int o : skipped) classify(o, p, shippers_, reach);
    p.micros = since(t0);
    for (int k = 0; k < K; ++k) p.routes.push_back(buildRoute(k, shippers_[k].vehicle, best[k]));
    finalize(p);
    return p;
}

DispatchReport Dispatcher::compareAll(Vehicle singleVehicle) {
    DispatchReport rep;
    if (!g_.hasNode(depot_)) {
        rep.error = "Kho không tồn tại trên bản đồ";
        return rep;
    }
    rep.priorityOrder = priorityOrder();
    if (orders_.empty()) {
        rep.error = "Chưa có đơn hàng nào để điều phối";
        return rep;
    }
    matrix(singleVehicle);
    for (const Shipper& s : shippers_) matrix(s.vehicle);
    rep.matrixMicros = matrixMicros_;

    rep.single.push_back(singleNearestNeighbor(singleVehicle));
    rep.single.push_back(singleUrgentFirst(singleVehicle));
    rep.single.push_back(singleNearestNeighbor2Opt(singleVehicle));
    rep.single.push_back(singleTspBitmask(singleVehicle));
    if (!shippers_.empty()) {
        rep.multi.push_back(multiNearestNeighbor());
        rep.multi.push_back(multiPriorityQueue());
        rep.multi.push_back(multiInsertion2Opt());
        rep.multi.push_back(multiInsertionTsp());
        rep.multi.push_back(multiDeadlineInsertion());
    }
    return rep;
}
