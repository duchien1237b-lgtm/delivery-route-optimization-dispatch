#include "Operations.h"

#include "Estimator.h"
#include "ShortestPath.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <ctime>

namespace {
std::string nowString() {
    std::time_t t = std::time(nullptr);
    std::tm tmv{};
#ifdef _WIN32
    localtime_s(&tmv, &t);
#else
    localtime_r(&t, &tmv);
#endif
    char buf[32];
    std::strftime(buf, sizeof buf, "%H:%M %d/%m/%Y", &tmv);
    return buf;
}

std::string clockText(double minutes);
Order* findOrder(int id, std::vector<Order>& orders) {
    for (Order& o : orders)
        if (o.id == id) return &o;
    return nullptr;
}
}  // namespace

int ShiftManager::apply(const Plan& plan, const std::vector<int>& pendingIdx, std::vector<Order>& orders,
                        const std::vector<Shipper>& shippers, bool awaitAccept, bool quiet) {
    int assigned = 0;
    for (const Route& r : plan.routes) {
        if (r.orders.empty()) continue;
        // Điều phối giữa ca: chuyến mới xuất phát lúc shipper rảnh (về kho) và không sớm hơn giờ hiện tại
        const double startAt = std::max(clock_, r.startAt);
        Trip t;
        t.id = nextTrip_++;
        t.shipper = r.shipper;
        t.shipperName = r.shipper >= 0 && r.shipper < (int)shippers.size() ? shippers[r.shipper].name : "Một xe";
        t.vehicle = r.vehicle;
        t.path = r.path;
        t.pathTimes = r.pathTimes;
        for (double& x : t.pathTimes) x += startAt;
        t.km = r.km;
        t.minutes = r.minutes;
        t.cost = r.costVnd;
        t.load = r.load;
        t.capacity = r.shipper >= 0 && r.shipper < (int)shippers.size() ? shippers[r.shipper].capacity : 0;
        t.accepted = !awaitAccept;
        for (size_t i = 0; i < r.orders.size(); ++i) {
            Order& o = orders[pendingIdx[r.orders[i]]];
            o.status = awaitAccept ? DISPATCHED : ASSIGNED;
            o.shipper = r.shipper;
            o.eta = r.arrival[i] + startAt;
            o.deliveredAt = -1;
            TripStop s;
            s.orderId = o.id;
            s.node = o.destination;
            s.pathIndex = i < r.stopIndex.size() ? r.stopIndex[i] : 0;
            s.eta = r.arrival[i] + startAt;
            t.stops.push_back(s);
            ++assigned;
        }
        trips_.push_back(std::move(t));
    }
    if (quiet) return assigned;
    DispatchRecord rec;
    rec.id = static_cast<int>(history_.size()) + 1;
    rec.when = nowString();
    rec.plan = plan.name;
    rec.orders = assigned;
    rec.shippers = static_cast<int>(std::count_if(plan.routes.begin(), plan.routes.end(),
                                                  [](const Route& r) { return !r.orders.empty(); }));
    rec.predictedLate = plan.late;
    rec.km = plan.km;
    rec.cost = plan.costVnd;
    rec.makespan = plan.makespan;
    history_.push_back(rec);
    log(clock_, "apply", -1, -1, plan.name + " (" + std::to_string(assigned) + " đơn)");
    return assigned;
}

int ShiftManager::progress(double t, std::vector<Order>& orders) {
    clock_ = std::max(clock_, t);
    int delivered = 0;
    for (const Trip& trip : trips_)
        for (const TripStop& s : trip.stops) {
            if (s.eta > clock_ + 1e-9) continue;
            Order* o = findOrder(s.orderId, orders);
            if (o && o->status == ASSIGNED) {
                o->status = DELIVERED;
                o->deliveredAt = s.eta;
                setStandby(trip.shipper, o->destination);
                ++delivered;
                std::string late;
                if (o->deadline >= 0 && s.eta > o->deadline + 1e-9) late = "trễ " + clockText(s.eta - o->deadline);
                log(s.eta, "delivered", o->id, trip.shipper, late);
            }
        }
    return delivered;
}

int ShiftManager::fail(int orderId, std::vector<Order>& orders, int reason) {
    Order* o = findOrder(orderId, orders);
    if (!o || o->status != ASSIGNED) return -1;
    if (reason < 0 || reason >= FAIL_REASON_COUNT) reason = FAIL_OTHER;
    o->attempts++;
    o->failReason = reason;
    // Đủ số lần thử, hoặc khách từ chối / hàng hư: hàng mang về kho, không đưa lại hàng chờ nữa
    o->status = o->attempts >= MAX_ATTEMPTS || failReasonReturns(reason) ? RETURNED : FAILED;
    setStandby(o->shipper, o->destination);
    log(clock_, o->status == RETURNED ? "returned" : "failed", o->id, o->shipper, failReasonName(reason));
    return o->status;
}

namespace {
void dropStop2(std::vector<Trip>& trips, int orderId) {
    for (Trip& t : trips)
        t.stops.erase(std::remove_if(t.stops.begin(), t.stops.end(), [&](const TripStop& s) { return s.orderId == orderId; }),
                      t.stops.end());
}
std::string clockText(double minutes) {
    long m = std::lround(minutes);
    char buf[16];
    std::snprintf(buf, sizeof buf, "%ld phút", m);
    return buf;
}
}  // namespace

bool ShiftManager::cancel(int orderId, std::vector<Order>& orders) {
    Order* o = findOrder(orderId, orders);
    if (!o || (o->status != PENDING && o->status != ASSIGNED && o->status != FAILED && o->status != DISPATCHED && o->status != CREATED))
        return false;
    // Shipper đã chạy tới đâu thì đứng ở đó (chuyến ghép tự động)
    if (o->shipper >= 0)
        if (const Trip* t = tripOfOrder(orderId))
            if (t->accepted && t->fromNode >= 0) setStandby(o->shipper, nodeReached(*t));
    o->status = CANCELLED;
    o->eta = -1;
    o->deliveredAt = -1;
    dropStop2(trips_, orderId);
    log(clock_, "cancelled", orderId, o->shipper, "");
    return true;
}

// Vị trí trong lộ trình mà chuyến sẽ tiếp tục từ đó: đỉnh kế tiếp (đang chạy dở cạnh nào thì chạy nốt).
// Trả về -1 nếu chuyến đã chạy hết lộ trình.
static int resumeIndex(const Trip& t, double clock) {
    for (size_t i = 0; i < t.pathTimes.size(); ++i)
        if (t.pathTimes[i] > clock + 1e-9) return static_cast<int>(i);
    return -1;
}

int ShiftManager::shipperAbsent(int shipper, const std::string& name, std::vector<Order>& orders) {
    progress(clock_, orders);
    absent_.insert(shipper);
    int back = 0;
    for (Trip& t : trips_) {
        if (t.shipper != shipper) continue;
        // Đơn chưa giao quay về hàng chờ
        for (const TripStop& s : t.stops) {
            Order* o = findOrder(s.orderId, orders);
            if (o && (o->status == ASSIGNED || o->status == DISPATCHED)) {
                o->status = PENDING;
                o->shipper = -1;
                o->eta = -1;
                ++back;
            }
        }
        t.stops.erase(std::remove_if(t.stops.begin(), t.stops.end(),
                                     [&](const TripStop& s) {
                                         Order* o = findOrder(s.orderId, orders);
                                         return !o || o->status == PENDING;
                                     }),
                      t.stops.end());
        // Chuyến dừng tại đỉnh kế tiếp (chạy nốt đoạn đang đi)
        int k = resumeIndex(t, clock_);
        if (k >= 0) {
            t.path.resize(k + 1);
            t.pathTimes.resize(k + 1);
        }
        t.note = name + " nghỉ đột xuất, chuyến dừng giữa chừng";
    }
    log(clock_, "absent", -1, shipper, std::to_string(back) + " đơn về hàng chờ");
    return back;
}

void ShiftManager::shipperRemoved(int shipper) {
    std::set<int> next;
    for (int a : absent_)
        if (a < shipper) next.insert(a);
        else if (a > shipper) next.insert(a - 1);
    absent_ = next;
    std::map<int, int> pos;
    for (const auto& kv : standby_)
        if (kv.first < shipper) pos[kv.first] = kv.second;
        else if (kv.first > shipper) pos[kv.first - 1] = kv.second;
    standby_ = pos;
    for (Trip& t : trips_)
        if (t.shipper == shipper) t.shipper = -1;
        else if (t.shipper > shipper) t.shipper--;
}

RerouteReport ShiftManager::reroute(const Graph& g, int depot, const RushProfile* rush, double dayStart,
                                    std::vector<Order>& orders) {
    progress(clock_, orders);
    RerouteReport rep;
    for (Trip& t : trips_) {
        if (t.path.empty()) continue;
        // Đơn còn phải giao, theo thứ tự cũ
        std::vector<TripStop> remaining;
        for (const TripStop& s : t.stops) {
            Order* o = findOrder(s.orderId, orders);
            if (o && (o->status == ASSIGNED || o->status == DISPATCHED)) remaining.push_back(s);
        }
        int s0 = resumeIndex(t, clock_);
        if (remaining.empty()) continue;
        // Nhiều đơn cùng một điểm: shipper còn đang giao đơn sau ở điểm vừa tới -> tiếp tục từ chính điểm đó
        double t0 = -1;
        for (const TripStop& s : remaining)
            if (s0 < 0 || s.pathIndex < s0) { s0 = s.pathIndex; t0 = s.eta; }
        if (s0 < 0) continue;
        const double tStart = t0 >= 0 ? t0 : t.pathTimes[s0];
        const Vehicle veh = t.vehicle;
        const double oldEnd = t.pathTimes.back();
        const bool backToDepot = t.path.size() > 1 && t.path.back() == depot && t.path.front() == depot;

        // Đoạn phía trước (từ s0) còn đi được không?
        bool blocked = false;
        for (size_t i = s0 + 1; i < t.path.size(); ++i) {
            const Edge* e = g.getEdge(t.path[i - 1], t.path[i]);
            if (!e || !vehicleAllowed(*e, veh)) { blocked = true; break; }
        }

        // Dựng phần đuôi mới: dãy nút bắt đầu ở path[s0] + các điểm dừng giao trên đó
        std::vector<int> tail{t.path[s0]};
        std::vector<std::vector<int>> stopsAt(1);   // stopsAt[i] = mã đơn giao tại tail[i]
        std::vector<int> dropped;
        if (!blocked) {
            for (size_t i = s0 + 1; i < t.path.size(); ++i) {
                tail.push_back(t.path[i]);
                stopsAt.push_back({});
            }
            for (const TripStop& s : remaining) stopsAt[s.pathIndex - s0].push_back(s.orderId);
        } else {
            double tm = tStart;
            auto leg = [&](int target) -> bool {
                ShortestPath::Options opt;
                opt.criterion = Criterion::TIME;
                opt.vehicle = veh;
                opt.target = target;
                opt.rush = rush;
                opt.departAt = rush ? dayStart + tm : -1;
                auto tree = ShortestPath::dijkstra(g, tail.back(), ShortestPath::Version::MIN_HEAP, opt);
                std::vector<int> p = ShortestPath::getPath(tree, target);
                if (p.empty()) return false;
                for (size_t i = 1; i < p.size(); ++i) {
                    tm += travelMinutesAt(*g.getEdge(p[i - 1], p[i]), veh, dayStart + tm, rush);
                    tail.push_back(p[i]);
                    stopsAt.push_back({});
                }
                return true;
            };
            for (const TripStop& s : remaining) {
                if (leg(s.node)) {
                    stopsAt.back().push_back(s.orderId);
                    tm += PHUT_MOI_DIEM;
                } else {
                    dropped.push_back(s.orderId);
                }
            }
            if (backToDepot) leg(depot);
            ++rep.rerouted;
            t.reroutes++;
        }

        // Tính giờ cho phần đuôi và ghép vào lộ trình
        std::vector<int> path(t.path.begin(), t.path.begin() + s0);
        std::vector<double> times(t.pathTimes.begin(), t.pathTimes.begin() + s0);
        double tm = tStart;
        std::vector<TripStop> stops;
        for (const TripStop& s : t.stops) {   // điểm đã giao giữ nguyên
            Order* o = findOrder(s.orderId, orders);
            if (o && o->status != ASSIGNED && o->status != DISPATCHED) stops.push_back(s);
        }
        for (size_t i = 0; i < tail.size(); ++i) {
            if (i > 0) tm += travelMinutesAt(*g.getEdge(tail[i - 1], tail[i]), veh, dayStart + tm, rush);
            path.push_back(tail[i]);
            times.push_back(tm);
            for (int id : stopsAt[i]) {
                Order* o = findOrder(id, orders);
                TripStop st;
                st.orderId = id;
                st.node = tail[i];
                st.pathIndex = static_cast<int>(path.size()) - 1;
                st.eta = tm;
                stops.push_back(st);
                if (o) o->eta = tm;
                tm += PHUT_MOI_DIEM;
            }
        }
        for (int id : dropped) {
            Order* o = findOrder(id, orders);
            if (!o) continue;
            o->status = PENDING;
            o->shipper = -1;
            o->eta = -1;
            rep.dropped.push_back(id);
        }
        t.path = path;
        t.pathTimes = times;
        for (TripStop& st : stops)   // điểm giao thất bại của lộ trình cũ: giữ trong giới hạn lộ trình mới
            st.pathIndex = std::min(st.pathIndex, static_cast<int>(t.path.size()) - 1);
        t.stops = stops;
        double km = 0, phuPhi = 0;
        for (size_t i = 0; i + 1 < t.path.size(); ++i)
            if (const Edge* e = g.getEdge(t.path[i], t.path[i + 1])) { km += e->distance; phuPhi += e->cost * 1000; }
        t.km = km;
        t.cost = PHI_CO_DINH + km * GIA_MOI_KM + phuPhi;
        t.minutes = t.pathTimes.back() - t.pathTimes.front();
        double delay = t.pathTimes.back() - oldEnd;
        if (!blocked && std::abs(delay) > 0.1) rep.retimed++;
        if (std::abs(delay) > std::abs(rep.maxDelay)) rep.maxDelay = delay;
        if (blocked) t.note = std::string("Đổi đường vì đoạn phía trước bị đóng (") + (delay >= 0 ? "+" : "") + clockText(delay) + ")";
    }
    return rep;
}

bool ShiftManager::requeue(int orderId, std::vector<Order>& orders) {
    Order* o = findOrder(orderId, orders);
    if (!o || o->status != FAILED) return false;
    o->status = PENDING;
    o->shipper = -1;
    o->eta = -1;
    o->deliveredAt = -1;
    // Bỏ điểm này khỏi chuyến cũ để lần điều phối sau không bị tính hai lần
    dropStop2(trips_, orderId);
    log(clock_, "requeue", orderId, -1, "");
    return true;
}

double ShiftManager::freeAt(int shipper) const {
    double t = 0;
    for (const Trip& tr : trips_)
        if (tr.shipper == shipper && !tr.pathTimes.empty()) t = std::max(t, tr.pathTimes.back());
    return t;
}
std::vector<double> ShiftManager::freeTimes(int shipperCount) const {
    std::vector<double> v(shipperCount, 0);
    for (int i = 0; i < shipperCount; ++i) v[i] = freeAt(i);
    return v;
}
void ShiftManager::log(double t, const std::string& type, int order, int shipper, const std::string& detail) {
    events_.push_back(ShiftEvent{t, type, order, shipper, detail});
    if (events_.size() > 500) events_.erase(events_.begin());
}

bool ShiftManager::release(int orderId, std::vector<Order>& orders) {
    Order* o = findOrder(orderId, orders);
    if (!o || o->status != ASSIGNED) return false;
    const Trip* t = tripOfOrder(orderId);
    if (t && t->fromNode >= 0) setStandby(o->shipper, nodeReached(*t));
    int ship = o->shipper;
    o->status = PENDING;
    o->shipper = -1;
    o->eta = -1;
    o->deliveredAt = -1;
    dropStop2(trips_, orderId);
    log(clock_, "released", orderId, ship, "");
    return true;
}

bool ShiftManager::returnToDepot(int orderId, std::vector<Order>& orders) {
    Order* o = findOrder(orderId, orders);
    if (!o || o->status != FAILED) return false;
    o->status = RETURNED;
    o->eta = -1;
    o->deliveredAt = -1;
    dropStop2(trips_, orderId);
    log(clock_, "returned", orderId, o->shipper, "Quản trị viên cho hoàn kho");
    return true;
}

void ShiftManager::reset(std::vector<Order>& orders, bool keepFinal) {
    absent_.clear();
    standby_.clear();
    events_.clear();
    for (Order& o : orders) {
        if (keepFinal && (o.status == DELIVERED || o.status == CANCELLED || o.status == RETURNED || o.status == CREATED)) continue;
        o.attempts = 0;
        o.failReason = -1;
        o.status = PENDING;
        o.shipper = -1;
        o.eta = -1;
        o.deliveredAt = -1;
        o.tried.clear();
        o.noShipperAt = 0;
    }
    trips_.clear();
    clock_ = 0;
}

// ============================ Nhận / từ chối chuyến, giao có xác nhận ============================
const Trip* ShiftManager::findTrip(int tripId) const {
    for (const Trip& t : trips_)
        if (t.id == tripId) return &t;
    return nullptr;
}

int ShiftManager::dropEmptyPendingTrips() {
    size_t before = trips_.size();
    trips_.erase(std::remove_if(trips_.begin(), trips_.end(), [](const Trip& t) { return !t.accepted && t.stops.empty(); }), trips_.end());
    return static_cast<int>(before - trips_.size());
}

const Trip* ShiftManager::tripOfOrder(int orderId) const {
    for (const Trip& t : trips_)
        for (const TripStop& s : t.stops)
            if (s.orderId == orderId) return &t;
    return nullptr;
}

int ShiftManager::accept(int tripId, std::vector<Order>& orders) {
    for (Trip& t : trips_) {
        if (t.id != tripId) continue;
        if (t.accepted) return -1;
        t.accepted = true;
        t.offerUntil = 0;
        // Shipper nhận muộn hơn lúc gửi lời mời: họ chỉ bắt đầu chạy từ bây giờ
        const double late = clock_ - t.offerClock;
        if (t.fromNode >= 0) {   // chuyến do hệ thống ghép tự động
            if (late > 1e-9) {
                for (double& x : t.pathTimes) x += late;
                for (double& x : t.approachTimes) x += late;
                for (TripStop& s : t.stops) {
                    s.eta += late;
                    if (Order* o = findOrder(s.orderId, orders)) o->eta = s.eta;
                }
            }
        }
        int n = 0;
        for (const TripStop& s : t.stops) {
            Order* o = findOrder(s.orderId, orders);
            if (o && o->status == DISPATCHED) {
                o->status = ASSIGNED;
                ++n;
            }
        }
        log(clock_, "accepted", -1, t.shipper, std::to_string(n) + " đơn");
        if (t.fromNode >= 0) {   // chuyến ghép tự động: ghi lịch sử điều phối lúc shipper nhận
            DispatchRecord rec;
            rec.id = static_cast<int>(history_.size()) + 1;
            rec.when = nowString();
            rec.plan = "Ghép tự động (shipper gần nhất)";
            rec.orders = n;
            rec.shippers = 1;
            for (const TripStop& s : t.stops) {
                Order* o = findOrder(s.orderId, orders);
                if (o && o->deadline >= 0 && s.eta > o->deadline + 1e-9) ++rec.predictedLate;
            }
            rec.km = t.km;
            rec.cost = t.cost;
            rec.makespan = t.minutes;
            history_.push_back(rec);
        }
        return n;
    }
    return -1;
}

int ShiftManager::decline(int tripId, std::vector<Order>& orders, const std::string& reason) {
    for (size_t i = 0; i < trips_.size(); ++i) {
        Trip& t = trips_[i];
        if (t.id != tripId) continue;
        if (t.accepted) return -1;
        int n = 0;
        for (const TripStop& s : t.stops) {
            Order* o = findOrder(s.orderId, orders);
            if (o && o->status == DISPATCHED) {
                o->status = PENDING;
                o->shipper = -1;
                o->eta = -1;
                ++n;
            }
        }
        log(clock_, "declined", -1, t.shipper, reason);
        trips_.erase(trips_.begin() + i);
        return n;
    }
    return -1;
}

bool ShiftManager::deliver(int orderId, std::vector<Order>& orders, double at) {
    Order* o = findOrder(orderId, orders);
    if (!o || o->status != ASSIGNED) return false;
    o->status = DELIVERED;
    o->deliveredAt = at;
    setStandby(o->shipper, o->destination);
    std::string late;
    if (o->deadline >= 0 && at > o->deadline + 1e-9) late = "trễ " + clockText(at - o->deadline);
    log(at, "delivered", o->id, o->shipper, late);
    return true;
}

Trip* ShiftManager::findTripMutable(int tripId) {
    for (Trip& t : trips_)
        if (t.id == tripId) return &t;
    return nullptr;
}

bool ShiftManager::busy(int shipper, const std::vector<Order>& orders) const {
    for (const Trip& t : trips_) {
        if (t.shipper != shipper) continue;
        for (const TripStop& s : t.stops)
            for (const Order& o : orders)
                if (o.id == s.orderId && (o.status == ASSIGNED || o.status == DISPATCHED)) return true;
    }
    return false;
}

int ShiftManager::nodeReached(const Trip& t) const {
    int node = t.fromNode;
    for (size_t i = 0; i < t.approach.size() && i < t.approachTimes.size(); ++i)
        if (t.approachTimes[i] <= clock_ + 1e-9) node = t.approach[i];
    for (size_t i = 0; i < t.path.size() && i < t.pathTimes.size(); ++i)
        if (t.pathTimes[i] <= clock_ + 1e-9) node = t.path[i];
    return node;
}

int ShiftManager::dropEmptyAutoTrips() {
    size_t before = trips_.size();
    trips_.erase(std::remove_if(trips_.begin(), trips_.end(), [](const Trip& t) { return t.fromNode >= 0 && t.stops.empty(); }), trips_.end());
    return static_cast<int>(before - trips_.size());
}
