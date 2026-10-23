#pragma once
#include <string>
#include <vector>

struct Point {
    double x = 0, y = 0;
};

struct Order {
    int id = 0;
    Point loc;
    int demand = 0;  // khối lượng đơn hàng
};

struct Shipper {
    std::string name;
    int capacity = 0;  // tải trọng tối đa
};

struct Route {
    int shipperIdx = 0;
    std::vector<int> stops;  // chỉ số đơn hàng theo thứ tự giao
    int load = 0;
    double distance = 0;     // kho -> các điểm giao -> kho
};

struct DispatchResult {
    std::vector<Route> routes;
    std::vector<int> unassigned;  // đơn không shipper nào nhận được
    double totalDistance = 0;
};
