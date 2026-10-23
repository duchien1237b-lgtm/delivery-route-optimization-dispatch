#include "io.h"

#include <fstream>
#include <iomanip>
#include <iostream>
#include <stdexcept>

Problem readProblem(const std::string& path) {
    std::ifstream in(path);
    if (!in) throw std::runtime_error("Không mở được file input: " + path);

    Problem p;
    int K, N;
    if (!(in >> p.depot.x >> p.depot.y)) throw std::runtime_error("Thiếu toạ độ kho");

    if (!(in >> K) || K <= 0) throw std::runtime_error("Số shipper không hợp lệ");
    for (int i = 0; i < K; ++i) {
        Shipper s;
        if (!(in >> s.name >> s.capacity) || s.capacity <= 0)
            throw std::runtime_error("Dòng shipper thứ " + std::to_string(i + 1) + " không hợp lệ");
        p.shippers.push_back(s);
    }

    if (!(in >> N) || N < 0) throw std::runtime_error("Số đơn hàng không hợp lệ");
    for (int i = 0; i < N; ++i) {
        Order o;
        if (!(in >> o.id >> o.loc.x >> o.loc.y >> o.demand) || o.demand <= 0)
            throw std::runtime_error("Dòng đơn hàng thứ " + std::to_string(i + 1) + " không hợp lệ");
        p.orders.push_back(o);
    }
    return p;
}

void writeResult(const std::string& path, const Problem& p, const DispatchResult& r) {
    std::ofstream out(path);
    if (!out) throw std::runtime_error("Không ghi được file output: " + path);
    out << std::fixed << std::setprecision(2);

    for (const Route& rt : r.routes) {
        const Shipper& s = p.shippers[rt.shipperIdx];
        out << "Shipper " << s.name << " (tải " << rt.load << "/" << s.capacity << ")\n";
        out << "  Lộ trình: Kho";
        for (int i : rt.stops) out << " -> #" << p.orders[i].id;
        out << " -> Kho\n";
        out << "  Quãng đường: " << rt.distance << "\n";
    }
    out << "\nĐơn chưa giao được: ";
    if (r.unassigned.empty()) out << "không có";
    for (int i : r.unassigned) out << "#" << p.orders[i].id << " ";
    out << "\nTổng quãng đường: " << r.totalDistance << "\n";
}
