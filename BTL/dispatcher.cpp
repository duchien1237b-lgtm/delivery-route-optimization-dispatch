#include "dispatcher.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <numeric>

Dispatcher::Dispatcher(Point depot, std::vector<Shipper> shippers, std::vector<Order> orders)
    : depot_(depot), shippers_(std::move(shippers)), orders_(std::move(orders)) {}

double Dispatcher::dist(const Point& a, const Point& b) const {
    return std::hypot(a.x - b.x, a.y - b.y);
}

double Dispatcher::routeDistance(const std::vector<int>& stops) const {
    if (stops.empty()) return 0;
    double d = dist(depot_, orders_[stops.front()].loc);
    for (size_t i = 1; i < stops.size(); ++i)
        d += dist(orders_[stops[i - 1]].loc, orders_[stops[i]].loc);
    return d + dist(orders_[stops.back()].loc, depot_);
}


// 2-opt: đảo ngược một đoạn của lộ trình nếu làm quãng đường ngắn hơn
void Dispatcher::twoOpt(std::vector<int>& stops) const {
    const int n = static_cast<int>(stops.size());
    if (n < 2) return;
    bool improved = true;
    while (improved) {
        improved = false;
        for (int i = 0; i < n - 1; ++i) {
            for (int j = i + 1; j < n; ++j) {
                const Point& before = (i == 0) ? depot_ : orders_[stops[i - 1]].loc;
                const Point& after = (j == n - 1) ? depot_ : orders_[stops[j + 1]].loc;
                const Point& a = orders_[stops[i]].loc;
                const Point& b = orders_[stops[j]].loc;
                double delta = dist(before, b) + dist(a, after)
                             - dist(before, a) - dist(b, after);
                if (delta < -1e-9) {
                    std::reverse(stops.begin() + i, stops.begin() + j + 1);
                    improved = true;
                }
            }
        }
    }
}


DispatchResult Dispatcher::run() {
    const int K = static_cast<int>(shippers_.size());
    DispatchResult res;
    res.routes.resize(K);
    for (int k = 0; k < K; ++k) res.routes[k].shipperIdx = k;

    // Xử lý đơn nặng trước để tránh bị "kẹt" tải trọng ở cuối
    std::vector<int> idx(orders_.size());
    std::iota(idx.begin(), idx.end(), 0);
    std::stable_sort(idx.begin(), idx.end(),
                     [&](int a, int b) { return orders_[a].demand > orders_[b].demand; });

    for (int o : idx) {
        double bestCost = std::numeric_limits<double>::max();
        int bestK = -1, bestPos = -1;
        for (int k = 0; k < K; ++k) {
            Route& r = res.routes[k];
            if (r.load + orders_[o].demand > shippers_[k].capacity) continue;
            for (size_t p = 0; p <= r.stops.size(); ++p) {
                const Point& prev = (p == 0) ? depot_ : orders_[r.stops[p - 1]].loc;
                const Point& next = (p == r.stops.size()) ? depot_ : orders_[r.stops[p]].loc;
                const Point& cur = orders_[o].loc;
                double cost = dist(prev, cur) + dist(cur, next) - dist(prev, next);
                if (cost < bestCost) {
                    bestCost = cost;
                    bestK = k;
                    bestPos = static_cast<int>(p);
                }
            }
        }
        if (bestK < 0) {
            res.unassigned.push_back(o);
        } else {
            Route& r = res.routes[bestK];
            r.stops.insert(r.stops.begin() + bestPos, o);
            r.load += orders_[o].demand;
        }
    }

    for (Route& r : res.routes) {
        twoOpt(r.stops);
        r.distance = routeDistance(r.stops);
        res.totalDistance += r.distance;
    }
    std::sort(res.unassigned.begin(), res.unassigned.end());
    return res;
}
