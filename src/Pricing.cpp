#include "Pricing.h"

#include "ShortestPath.h"

#include <algorithm>
#include <cmath>

namespace Pricing {

namespace {
double roundUp500(double x) { return std::ceil(x / 500.0 - 1e-9) * 500.0; }
}  // namespace

Tariff& tariff() {
    static Tariff t;
    return t;
}

std::string checkTariff(const Tariff& t) {
    auto bad = [](double v, double lo, double hi) { return !std::isfinite(v) || v < lo || v > hi; };
    if (bad(t.firstKm, 0, 50)) return "Số km đầu tiên phải từ 0 đến 50";
    if (bad(t.firstFee, 0, 1000000)) return "Phí mở đầu phải từ 0 đến 1.000.000 đ";
    if (bad(t.perKm, 0, 100000)) return "Giá mỗi km phải từ 0 đến 100.000 đ";
    if (bad(t.freeKg, 0, 1000)) return "Khối lượng miễn phí phải từ 0 đến 1000 kg";
    if (bad(t.perKg, 0, 100000)) return "Phí mỗi kg vượt mức phải từ 0 đến 100.000 đ";
    if (bad(t.urgent, 0, 2)) return "Phụ thu hoả tốc phải từ 0% đến 200%";
    if (bad(t.codRate, 0, 0.2)) return "Phí thu hộ phải từ 0% đến 20%";
    if (bad(t.codMin, 0, 1000000)) return "Phí thu hộ tối thiểu phải từ 0 đến 1.000.000 đ";
    if (bad(t.returnRate, 0, 1)) return "Tỉ lệ phí hoàn kho phải từ 0% đến 100%";
    return "";
}

Fee shippingFee(double km, double weightKg, bool urgent, long long cod) {
    const Tariff& T = tariff();
    Fee f;
    if (!std::isfinite(km)) return f;
    f.valid = true;
    f.km = km;
    f.base = T.firstFee;
    f.distance = std::max(0.0, km - T.firstKm) * T.perKm;
    f.weight = std::max(0.0, weightKg - T.freeKg) * T.perKg;
    f.urgent = urgent ? (f.base + f.distance + f.weight) * T.urgent : 0;
    f.cod = cod > 0 ? std::max(T.codMin, cod * T.codRate) : 0;
    f.total = roundUp500(f.base + f.distance + f.weight + f.urgent + f.cod);
    return f;
}

std::vector<double> feeDistances(const Graph& g, int depot, const std::vector<Order>& orders) {
    std::vector<double> km(orders.size(), ShortestPath::INF);
    if (!g.hasNode(depot)) return km;
    // Báo giá không phụ thuộc sự cố giao thông tạm thời
    Graph plain = g;
    plain.clearTraffic();
    ShortestPath::Options moto;
    moto.vehicle = MOTORBIKE;
    ShortestPath::Options any;
    any.vehicle = ANY_VEHICLE;
    auto tm = ShortestPath::dijkstra(plain, depot, ShortestPath::Version::MIN_HEAP, moto);
    auto ta = ShortestPath::dijkstra(plain, depot, ShortestPath::Version::MIN_HEAP, any);
    for (size_t i = 0; i < orders.size(); ++i) {
        int d = orders[i].destination;
        if (!tm.dist.count(d)) continue;
        km[i] = std::isfinite(tm.dist[d]) ? tm.dist[d] : ta.dist[d];
    }
    return km;
}

Finance summarize(const std::vector<Order>& orders, const std::vector<Fee>& fees, const std::vector<Trip>& trips,
                  int shipperCount) {
    Finance f;
    f.shippers.resize(shipperCount + 1);   // ô cuối: chuyến "Một xe" (không gắn shipper)
    for (int i = 0; i < shipperCount; ++i) f.shippers[i].shipper = i;
    f.shippers[shipperCount].shipper = -1;
    auto slot = [&](int s) -> ShipperSettlement& { return f.shippers[s >= 0 && s < shipperCount ? s : shipperCount]; };
    for (size_t i = 0; i < orders.size(); ++i) {
        const Order& o = orders[i];
        const Fee& fee = fees[i];
        double cod = static_cast<double>(o.cod);
        switch (o.status) {
            case DELIVERED: {
                f.delivered++;
                f.revenue += fee.total;
                f.codCollected += cod;
                ShipperSettlement& s = slot(o.shipper);
                s.delivered++;
                s.codCollected += cod;
                s.revenue += fee.total;
                break;
            }
            case RETURNED: {
                f.returned++;
                double r = fee.valid ? roundUp500((fee.total - fee.cod) * tariff().returnRate) : 0;
                f.revenue += r;
                ShipperSettlement& s = slot(o.shipper);
                s.returned++;
                s.revenue += r;
                break;
            }
            case ASSIGNED: {
                f.expectedRevenue += fee.total;
                f.codOnRoute += cod;
                ShipperSettlement& s = slot(o.shipper);
                s.onRoute++;
                s.codOnRoute += cod;
                break;
            }
            case FAILED:
                slot(o.shipper).failed++;
                f.codPending += cod;
                break;
            case CANCELLED:
                f.cancelled++;
                break;
            default:
                f.codPending += cod;
        }
    }
    f.expectedRevenue += f.revenue;
    for (const Trip& t : trips) {
        f.cost += t.cost;
        ShipperSettlement& s = slot(t.shipper);
        s.cost += t.cost;
        s.km += t.km;
    }
    f.profit = f.revenue - f.cost;
    // Bỏ ô "Một xe" nếu không dùng
    const ShipperSettlement& last = f.shippers.back();
    if (last.delivered + last.failed + last.returned + last.onRoute == 0 && last.km == 0) f.shippers.pop_back();
    return f;
}

}  // namespace Pricing
