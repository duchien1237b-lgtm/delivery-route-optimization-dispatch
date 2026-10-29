#include "Graph.h"

#include <algorithm>
#include <cmath>
#include <iomanip>
#include <stdexcept>

// ============================ Loại xe & tiêu chí ============================

const char* vehicleName(Vehicle v) {
    switch (v) {
        case MOTORBIKE: return "Xe máy";
        case CAR:       return "Ô tô";
        case TRUCK:     return "Xe tải";
        default:        return "Mọi loại xe";
    }
}

int vehicleMask(Vehicle v) {
    switch (v) {
        case MOTORBIKE: return MASK_MOTO;
        case CAR:       return MASK_CAR;
        case TRUCK:     return MASK_TRUCK;
        default:        return MASK_ALL;
    }
}

double vehicleMaxSpeed(Vehicle v) {
    switch (v) {
        case MOTORBIKE: return 40;
        case CAR:       return 60;
        case TRUCK:     return 50;
        default:        return 1e9;  // không giới hạn -> dùng đúng thời gian của đường
    }
}

Vehicle vehicleFromInt(int v) {
    if (v >= 0 && v <= 2) return static_cast<Vehicle>(v);
    return ANY_VEHICLE;
}

const char* criterionName(Criterion c) {
    switch (c) {
        case Criterion::DISTANCE: return "Quãng đường (km)";
        case Criterion::TIME:     return "Thời gian (phút)";
        default:                  return "Chi phí (nghìn đồng)";
    }
}

Criterion criterionFromString(const std::string& s) {
    if (s == "time" || s == "1") return Criterion::TIME;
    if (s == "cost" || s == "2") return Criterion::COST;
    return Criterion::DISTANCE;
}

bool vehicleAllowed(const Edge& e, Vehicle v) {
    return !e.closed && (e.allowed & vehicleMask(v)) != 0;
}

double travelMinutes(const Edge& e, Vehicle v) {
    // e.time là thời gian khi chạy đúng tốc độ giới hạn; xe chậm hơn thì lâu hơn
    double bySpeed = e.distance / vehicleMaxSpeed(v) * 60.0;
    return std::max(e.time, bySpeed) * e.jam;
}

// ============================== Giờ cao điểm ================================

double RushProfile::level(double minuteOfDay) const {
    if (!enabled) return 0;
    double t = std::fmod(minuteOfDay, 1440.0);
    if (t < 0) t += 1440;
    double best = 0;
    for (const RushWindow& w : windows) {
        // Xét cả ngày hôm trước / hôm sau để khung gần nửa đêm vẫn đúng
        for (double shift : {-1440.0, 0.0, 1440.0}) {
            double s = w.start + shift, e = w.end + shift, lv = 0;
            if (t >= s && t <= e) lv = 1;
            else if (ramp > 0 && t >= s - ramp && t < s) lv = (t - (s - ramp)) / ramp;
            else if (ramp > 0 && t > e && t <= e + ramp) lv = 1 - (t - e) / ramp;
            best = std::max(best, lv);
        }
    }
    return best;
}

double RushProfile::multiplier(const Edge& e, Vehicle v, double minuteOfDay) const {
    double lv = level(minuteOfDay);
    if (lv <= 0 || e.peak <= 1) return 1;
    double sens = v >= MOTORBIKE && v <= TRUCK ? sensitivity[v] : 1.0;
    return 1 + lv * (e.peak - 1) * sens;
}

double travelMinutesAt(const Edge& e, Vehicle v, double minuteOfDay, const RushProfile* rush) {
    double t = travelMinutes(e, v);
    return rush ? t * rush->multiplier(e, v, minuteOfDay) : t;
}

double edgeCostK(const Edge& e) {
    return e.distance * COST_PER_KM_K + e.cost;
}

double edgeWeight(const Edge& e, Criterion c, Vehicle v) {
    switch (c) {
        case Criterion::DISTANCE: return e.distance;
        case Criterion::TIME:     return travelMinutes(e, v);
        default:                  return edgeCostK(e);
    }
}

// ================================== Nút =====================================

bool Graph::addNode(int id, const std::string& name, double x, double y) {
    if (id < 0 || nodes_.count(id)) return false;
    nodes_[id] = Node{id, name, x, y};
    adj_[id];  // tạo danh sách kề rỗng
    return true;
}

bool Graph::updateNode(int id, const std::string& name, double x, double y) {
    auto it = nodes_.find(id);
    if (it == nodes_.end()) return false;
    it->second.name = name;
    it->second.x = x;
    it->second.y = y;
    return true;
}

bool Graph::removeNode(int id) {
    if (!nodes_.count(id)) return false;
    nodes_.erase(id);
    adj_.erase(id);
    for (auto& [u, list] : adj_)
        list.erase(std::remove_if(list.begin(), list.end(),
                                  [id](const Edge& e) { return e.to == id; }),
                   list.end());
    return true;
}

bool Graph::hasNode(int id) const { return nodes_.count(id) > 0; }

const Node& Graph::getNode(int id) const {
    auto it = nodes_.find(id);
    if (it == nodes_.end()) throw std::out_of_range("Khong co nut " + std::to_string(id));
    return it->second;
}

std::vector<int> Graph::nodeIds() const {
    std::vector<int> ids;
    ids.reserve(nodes_.size());
    for (const auto& [id, n] : nodes_) ids.push_back(id);
    return ids;
}

int Graph::nodeCount() const { return static_cast<int>(nodes_.size()); }

int Graph::nextNodeId() const {
    int id = 0;
    for (const auto& [k, n] : nodes_) {  // map đã sắp tăng dần
        if (k != id) break;
        ++id;
    }
    return id;
}

// ================================== Cạnh ====================================

Edge* Graph::findEdge(int u, int v) {
    auto it = adj_.find(u);
    if (it == adj_.end()) return nullptr;
    for (Edge& e : it->second)
        if (e.to == v) return &e;
    return nullptr;
}

const Edge* Graph::getEdge(int u, int v) const {
    return const_cast<Graph*>(this)->findEdge(u, v);
}

bool Graph::hasEdge(int u, int v) const { return getEdge(u, v) != nullptr; }

bool Graph::addEdge(int u, int v, double distance, double time, double cost, int allowed, double peak) {
    if (!hasNode(u) || !hasNode(v) || u == v) return false;
    if (distance < 0 || time < 0 || peak < 1) return false;
    if (hasEdge(u, v)) return false;
    if (!directed_ && hasEdge(v, u)) return false;
    allowed &= MASK_ALL;
    if (allowed == 0) allowed = MASK_ALL;
    adj_[u].push_back(Edge{v, distance, time, cost, allowed, peak});
    if (!directed_) adj_[v].push_back(Edge{u, distance, time, cost, allowed, peak});
    return true;
}

bool Graph::updateEdge(int u, int v, double distance, double time, double cost, int allowed, double peak) {
    if (distance < 0 || time < 0 || peak < 1) return false;
    allowed &= MASK_ALL;
    if (allowed == 0) allowed = MASK_ALL;
    Edge* e = findEdge(u, v);
    if (!e) return false;
    *e = Edge{v, distance, time, cost, allowed, peak, e->jam, e->closed};  // giữ nguyên tình trạng giao thông
    if (!directed_) {
        Edge* back = findEdge(v, u);
        if (back) *back = Edge{u, distance, time, cost, allowed, peak, back->jam, back->closed};
    }
    return true;
}

bool Graph::setTraffic(int u, int v, double jam, bool closed) {
    if (jam < 1) jam = 1;
    Edge* e = findEdge(u, v);
    if (!e) return false;
    e->jam = jam;
    e->closed = closed;
    if (!directed_) {
        Edge* back = findEdge(v, u);
        if (back) { back->jam = jam; back->closed = closed; }
    }
    return true;
}

void Graph::clearTraffic() {
    for (auto& [u, list] : adj_)
        for (Edge& e : list) { e.jam = 1; e.closed = false; }
}

int Graph::trafficCount() const {
    int c = 0;
    for (const auto& [u, list] : adj_)
        for (const Edge& e : list)
            if (e.closed || e.jam > 1) ++c;
    return directed_ ? c : c / 2;
}

bool Graph::removeEdge(int u, int v) {
    if (!hasNode(u) || !hasNode(v)) return false;
    auto erase = [this](int a, int b) {
        auto& l = adj_[a];
        auto old = l.size();
        l.erase(std::remove_if(l.begin(), l.end(), [b](const Edge& e) { return e.to == b; }), l.end());
        return l.size() != old;
    };
    bool ok = erase(u, v);
    if (!directed_) ok = erase(v, u) || ok;
    return ok;
}

const std::vector<Edge>& Graph::neighbors(int id) const {
    static const std::vector<Edge> empty;
    auto it = adj_.find(id);
    return it == adj_.end() ? empty : it->second;
}

int Graph::edgeCount() const {
    int total = 0;
    for (const auto& [u, list] : adj_) total += static_cast<int>(list.size());
    return directed_ ? total : total / 2;
}

bool Graph::hasNegativeCost() const {
    for (const auto& [u, list] : adj_)
        for (const Edge& e : list)
            if (edgeCostK(e) < 0) return true;
    return false;
}

void Graph::clear() {
    nodes_.clear();
    adj_.clear();
}

void Graph::print(std::ostream& os) const {
    os << "Do thi " << (directed_ ? "CO HUONG" : "VO HUONG") << ": " << nodeCount()
       << " nut, " << edgeCount() << " canh\n";
    os << std::fixed << std::setprecision(1);
    for (const auto& [id, nd] : nodes_) {
        os << "  [" << id << "] " << nd.name << "\n";
        for (const Edge& e : neighbors(id)) {
            if (!directed_ && e.to < id) continue;  // vô hướng: in mỗi cạnh 1 lần
            os << "      " << (directed_ ? "-> " : "-- ") << "[" << e.to << "] "
               << nodes_.at(e.to).name << "  (" << e.distance << " km, " << e.time
               << " phut, phu phi " << e.cost << "k";
            if (e.peak != DEFAULT_PEAK) os << ", cao diem x" << e.peak;
            if (e.closed) os << ", DANG DONG";
            else if (e.jam > 1) os << ", ket xe x" << e.jam;
            if (e.allowed != MASK_ALL) {
                os << ", chi cho:";
                if (e.allowed & MASK_MOTO) os << " xe may";
                if (e.allowed & MASK_CAR) os << " o to";
                if (e.allowed & MASK_TRUCK) os << " xe tai";
            }
            os << ")\n";
        }
    }
}
