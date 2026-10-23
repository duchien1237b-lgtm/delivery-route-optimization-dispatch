#pragma once
#include <vector>
#include "types.h"

class Dispatcher {
public:
    Dispatcher(Point depot, std::vector<Shipper> shippers, std::vector<Order> orders);

    // 1) Phân đơn: cheapest insertion có ràng buộc tải trọng
    // 2) Tối ưu từng lộ trình bằng 2-opt
    DispatchResult run();

    const std::vector<Order>& orders() const { return orders_; }
    const std::vector<Shipper>& shippers() const { return shippers_; }

private:
    Point depot_;
    std::vector<Shipper> shippers_;
    std::vector<Order> orders_;

    double dist(const Point& a, const Point& b) const;
    double routeDistance(const std::vector<int>& stops) const;
    void twoOpt(std::vector<int>& stops) const;
};
