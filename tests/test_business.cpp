// ============================================================================
// test_business.cpp — Kiểm tra nghiệp vụ: trường đơn hàng (thu hộ, người nhận,
// số điện thoại) đọc / ghi file, biểu phí giao hàng, lý do giao thất bại,
// shipper chỉ nhận chuyến mới khi đã về kho, nhật ký ca, đối soát COD và lợi nhuận.
// Chạy từ thư mục gốc repo (đọc data/*.txt).
// ============================================================================
#include "Dispatcher.h"
#include "Estimator.h"
#include "FileIO.h"
#include "Operations.h"
#include "Pricing.h"
#include "ShortestPath.h"

#include <cmath>
#include <iostream>

using namespace std;

static int passed = 0;
#define CHECK(cond)                                                              \
    do {                                                                         \
        if (!(cond)) {                                                           \
            cerr << "  [FAIL] " << __FILE__ << ":" << __LINE__ << "  " #cond "\n"; \
            return 1;                                                            \
        }                                                                        \
        ++passed;                                                                \
    } while (0)

static bool near(double a, double b, double eps = 1e-6) { return fabs(a - b) < eps; }

int main() {
    string err;
    Graph g;
    CHECK(FileIO::loadMap("data/map.txt", g, err));
    vector<OrderRecord> recs;
    CHECK(FileIO::loadOrders("data/orders.txt", recs, err, &g));
    vector<Shipper> ships;
    CHECK(loadShippers("data/shippers.txt", ships, err));

    // ------------------------------------------------ File: trường nghiệp vụ
    {
        CHECK(recs.size() == 8);
        CHECK(recs[2].cod == 4500000 && recs[2].phone == "0909103103" && recs[2].recipient == "Anh Khoa");
        CHECK(recs[2].note == "Linh kiện điện tử");
        CHECK(recs[0].cod == 0 && recs[0].recipient == "Cong ty An Phat");
        // Ghi rồi đọc lại giữ nguyên
        vector<OrderRecord> back;
        CHECK(FileIO::loadOrdersText(FileIO::ordersToText(recs), back, err, &g));
        CHECK(back.size() == recs.size());
        for (size_t i = 0; i < recs.size(); ++i) {
            CHECK(back[i].cod == recs[i].cod && back[i].phone == recs[i].phone);
            CHECK(back[i].recipient == recs[i].recipient && back[i].note == recs[i].note);
        }
        // Ghi chú trùng dạng khoá=giá_trị vẫn đọc lại đúng là ghi chú (có dấu '-' phía trước)
        OrderRecord odd;
        odd.id = 1; odd.destination = 1; odd.weight = 1; odd.note = "cod=xin goi truoc";
        CHECK(FileIO::loadOrdersText(FileIO::ordersToText({odd}), back, err, &g));
        CHECK(back[0].cod == 0 && back[0].note == "-cod=xin goi truoc");
        // Dòng không có trường nghiệp vụ (định dạng cũ) vẫn đọc được
        CHECK(FileIO::loadOrdersText("201 1 2 0 -1 Ghi chu cu\n", back, err, &g));
        CHECK(back[0].cod == 0 && back[0].phone.empty() && back[0].note == "Ghi chu cu");
        // Lỗi
        CHECK(!FileIO::loadOrdersText("201 1 2 0 -1 cod=-5 x\n", back, err, &g));
        CHECK(!FileIO::loadOrdersText("201 1 2 0 -1 cod=60000000 x\n", back, err, &g));
        CHECK(!FileIO::loadOrdersText("201 1 2 0 -1 sdt=12345 x\n", back, err, &g));
        CHECK(!FileIO::loadOrdersText("201 1 2 0 -1 sdt=1909103103 x\n", back, err, &g));
        CHECK(validPhone("0909103103") && !validPhone("090910310") && !validPhone("09091031a3"));
    }

    // ------------------------------------------------ Biểu phí
    {
        Pricing::Fee f = Pricing::shippingFee(1.5, 2, false, 0);
        CHECK(f.valid && near(f.total, 15000));
        // 5,2 km, 12 kg, gấp, thu hộ 1,2 triệu:
        // 15.000 + 3,2 × 4.000 + 9 × 2.500 = 50.300; ×1,3 = 65.390; + 9.600 phí COD = 74.990 -> 75.000
        f = Pricing::shippingFee(5.2, 12, true, 1200000);
        CHECK(near(f.distance, 12800) && near(f.weight, 22500) && near(f.urgent, 15090) && near(f.cod, 9600));
        CHECK(near(f.total, 75000));
        // Phí thu hộ tối thiểu 5.000 đ
        CHECK(near(Pricing::shippingFee(1, 1, false, 100000).cod, 5000));
        CHECK(fmod(Pricing::shippingFee(7.33, 4.4, true, 333333).total, 500) == 0);
        CHECK(!Pricing::shippingFee(ShortestPath::INF, 1, false, 0).valid);
        // Cước tăng theo km, theo kg
        CHECK(Pricing::shippingFee(10, 2, false, 0).total > Pricing::shippingFee(5, 2, false, 0).total);
        CHECK(Pricing::shippingFee(5, 10, false, 0).total > Pricing::shippingFee(5, 2, false, 0).total);
        // Khoảng cách báo giá không đổi khi đóng đường tạm thời
        vector<Order> orders(recs.begin(), recs.end());
        auto km0 = Pricing::feeDistances(g, 0, orders);
        Graph closed = g;
        for (const Edge& e : vector<Edge>(closed.neighbors(0))) closed.setTraffic(0, e.to, 1, true);
        auto km1 = Pricing::feeDistances(closed, 0, orders);
        for (size_t i = 0; i < km0.size(); ++i) CHECK(km0[i] == km1[i] || (std::isinf(km0[i]) && std::isinf(km1[i])));
        CHECK(std::isinf(km0[6]));   // Cần Giờ không có đường
        // = Dijkstra xe máy
        ShortestPath::Options moto;
        moto.vehicle = MOTORBIKE;
        auto t = ShortestPath::dijkstra(g, 0, ShortestPath::Version::MIN_HEAP, moto);
        CHECK(near(km0[0], t.dist[1]));
    }

    // ------------------------------------------------ Lý do thất bại
    RushProfile rush;
    auto apply = [&](vector<Order>& orders, ShiftManager& shift, const string& key) {
        vector<Order> pend;
        vector<int> idx;
        for (size_t i = 0; i < orders.size(); ++i)
            if (orders[i].status == PENDING) { pend.push_back(orders[i]); idx.push_back(static_cast<int>(i)); }
        Dispatcher d(g, 0, pend, ships, true);
        d.setStartTime(shift.clock());
        d.setRush(&rush, 8 * 60);
        d.setShipperFreeAt(shift.freeTimes(static_cast<int>(ships.size())));
        DispatchReport rep = d.compareAll(MOTORBIKE);
        for (const Plan& p : rep.multi)
            if (p.key == key) return std::make_pair(p, shift.apply(p, idx, orders, ships));
        return std::make_pair(Plan(), 0);
    };
    {
        vector<Order> orders(recs.begin(), recs.end());
        ShiftManager shift;
        CHECK(apply(orders, shift, "deadline").second > 0);
        vector<int> live;
        for (auto& o : orders) if (o.status == ASSIGNED) live.push_back(o.id);
        CHECK(live.size() >= 3);
        CHECK(shift.fail(live[0], orders, FAIL_ABSENT) == FAILED);
        CHECK(shift.fail(live[1], orders, FAIL_REFUSED) == RETURNED);   // từ chối nhận: hoàn kho ngay
        CHECK(shift.fail(live[2], orders, FAIL_DAMAGED) == RETURNED);
        for (auto& o : orders) if (o.id == live[1]) CHECK(o.failReason == FAIL_REFUSED && o.attempts == 1);
        CHECK(!shift.requeue(live[1], orders));
        CHECK(shift.requeue(live[0], orders));
        CHECK(failReasonReturns(FAIL_REFUSED) && !failReasonReturns(FAIL_RESCHEDULE));
        // Nhật ký: áp dụng, 2 thất bại kiểu hoàn kho, 1 thất bại, 1 đưa về hàng chờ
        int nApply = 0, nRet = 0, nFail = 0, nReq = 0;
        for (auto& e : shift.events()) {
            nApply += e.type == "apply";
            nRet += e.type == "returned";
            nFail += e.type == "failed";
            nReq += e.type == "requeue";
        }
        CHECK(nApply == 1 && nRet == 2 && nFail == 1 && nReq == 1);
        shift.reset(orders);
        CHECK(shift.events().empty());
        for (auto& o : orders) CHECK(o.failReason == -1);
    }

    // ------------------------------------------------ Shipper chỉ nhận chuyến mới khi đã về kho
    {
        vector<Order> orders(recs.begin(), recs.end());
        ShiftManager shift;
        auto first = apply(orders, shift, "deadline");
        CHECK(first.second > 0);
        vector<double> free = shift.freeTimes(static_cast<int>(ships.size()));
        // Đơn thứ hai cùng điểm, điều phối lúc 10 phút: shipper đang chạy chuyến đầu
        shift.progress(10, orders);
        for (auto& o : orders) if (o.status == ASSIGNED) { shift.fail(o.id, orders, FAIL_RESCHEDULE); shift.requeue(o.id, orders); break; }
        auto second = apply(orders, shift, "mnn");
        CHECK(second.second > 0);
        for (const Route& r : second.first.routes) {
            if (r.orders.empty()) continue;
            CHECK(r.startAt >= 10 - 1e-9);
            if (r.shipper >= 0) CHECK(r.startAt >= free[r.shipper] - 1e-9);
        }
        // Chuyến mới của shipper bận bắt đầu đúng lúc người đó về kho
        for (const Trip& t : shift.trips()) CHECK(t.pathTimes.front() >= 0);
        int busy = -1;
        for (int i = 0; i < (int)free.size(); ++i) if (free[i] > 10) busy = i;
        if (busy >= 0) {
            int trips = 0;
            for (const Trip& t : shift.trips()) if (t.shipper == busy) ++trips;
            if (trips == 2) {
                const Trip& last = shift.trips().back().shipper == busy ? shift.trips().back() : shift.trips()[shift.trips().size() - 2];
                CHECK(last.pathTimes.front() >= free[busy] - 1e-9);
            }
        }
        // Giờ tới của từng đơn không sớm hơn lúc xe xuất phát
        for (const Trip& t : shift.trips())
            for (const TripStop& s : t.stops) CHECK(s.eta >= t.pathTimes.front() - 1e-9);
        // Hai chuyến của cùng một shipper không chồng giờ
        for (size_t i = 0; i < shift.trips().size(); ++i)
            for (size_t j = i + 1; j < shift.trips().size(); ++j) {
                const Trip& a = shift.trips()[i];
                const Trip& b = shift.trips()[j];
                if (a.shipper < 0 || a.shipper != b.shipper) continue;
                CHECK(b.pathTimes.front() >= a.pathTimes.back() - 1e-9);
            }
    }

    // ------------------------------------------------ Đối soát COD, doanh thu, lợi nhuận
    {
        vector<Order> orders(recs.begin(), recs.end());
        ShiftManager shift;
        CHECK(apply(orders, shift, "deadline").second > 0);
        auto km = Pricing::feeDistances(g, 0, orders);
        vector<Pricing::Fee> fees;
        for (size_t i = 0; i < orders.size(); ++i) fees.push_back(Pricing::shippingFee(km[i], orders[i].weight, orders[i].urgent, orders[i].cod));
        Pricing::Finance f0 = Pricing::summarize(orders, fees, shift.trips(), static_cast<int>(ships.size()));
        CHECK(f0.revenue == 0 && f0.delivered == 0 && f0.codCollected == 0);
        CHECK(f0.cost > 0 && near(f0.profit, -f0.cost));
        CHECK(f0.expectedRevenue > 0);
        shift.progress(1000, orders);
        Pricing::Finance f = Pricing::summarize(orders, fees, shift.trips(), static_cast<int>(ships.size()));
        double rev = 0, cod = 0;
        int delivered = 0;
        for (size_t i = 0; i < orders.size(); ++i)
            if (orders[i].status == DELIVERED) { rev += fees[i].total; cod += orders[i].cod; ++delivered; }
        CHECK(delivered == 7 && f.delivered == 7);
        CHECK(near(f.revenue, rev) && near(f.codCollected, cod));
        CHECK(near(f.profit, f.revenue - f.cost));
        CHECK(near(f.expectedRevenue, f.revenue));
        double sumCod = 0, sumRev = 0, sumCost = 0;
        int sumDel = 0;
        for (auto& s : f.shippers) { sumCod += s.codCollected; sumRev += s.revenue; sumCost += s.cost; sumDel += s.delivered; }
        CHECK(near(sumCod, f.codCollected) && near(sumRev, f.revenue) && near(sumCost, f.cost) && sumDel == f.delivered);
        CHECK(near(f.codPending, 650000));   // đơn Cần Giờ vẫn chờ
        // Đơn hoàn kho thu 50% cước (không gồm phí thu hộ), tiền thu hộ không thu được
        vector<Order> o2(recs.begin(), recs.end());
        ShiftManager s2;
        apply(o2, s2, "deadline");
        int victim = -1;
        size_t vi = 0;
        for (size_t i = 0; i < o2.size(); ++i) if (o2[i].status == ASSIGNED && o2[i].cod > 0) { victim = o2[i].id; vi = i; break; }
        CHECK(victim > 0 && s2.fail(victim, o2, FAIL_REFUSED) == RETURNED);
        Pricing::Finance f2 = Pricing::summarize(o2, fees, s2.trips(), static_cast<int>(ships.size()));
        CHECK(f2.returned == 1);
        double expect = std::ceil((fees[vi].total - fees[vi].cod) * 0.5 / 500 - 1e-9) * 500;
        CHECK(near(f2.revenue, expect) && f2.codCollected == 0);
        // Huỷ không tính tiền
        o2[0].status = CANCELLED;
        CHECK(Pricing::summarize(o2, fees, s2.trips(), static_cast<int>(ships.size())).cancelled == 1);
        // Nhật ký giao: mỗi đơn đã giao đúng một dòng
        int nDel = 0;
        for (auto& e : shift.events()) nDel += e.type == "delivered";
        CHECK(nDel == 7);
        cout << "Ket qua ca: doanh thu " << f.revenue << " d, chi phi " << f.cost << " d, loi nhuan " << f.profit
             << " d, thu ho " << f.codCollected << " d\n";
    }

    // ---------------------- Đổi tuyến khi shipper đang giao đơn thứ hai ở cùng một điểm
    {
        vector<Order> orders;
        for (int k = 0; k < 2; ++k) {
            OrderRecord r;
            r.id = 300 + k; r.destination = 7; r.weight = 1;
            orders.emplace_back(r);
        }
        ShiftManager shift;
        CHECK(apply(orders, shift, "deadline").second == 2);
        const Trip& tr = shift.trips()[0];
        CHECK(tr.stops.size() == 2 && tr.stops[0].pathIndex == tr.stops[1].pathIndex);
        double eta2 = tr.stops[1].eta;
        int at = tr.stops[0].pathIndex;
        Order* first = orders[0].id == tr.stops[0].orderId ? &orders[0] : &orders[1];
        Order* second = first == &orders[0] ? &orders[1] : &orders[0];
        shift.progress(tr.stops[0].eta + 1, orders);
        CHECK(first->status == DELIVERED && second->status == ASSIGNED);
        // Không đổi giao thông: giờ giao đơn thứ hai giữ nguyên
        RerouteReport rep = shift.reroute(g, 0, nullptr, 8 * 60, orders);
        CHECK(near(second->eta, eta2) && rep.dropped.empty());
        // Đóng đoạn đường rời khỏi điểm giao: tìm đường khác nhưng đơn thứ hai vẫn giao tại chỗ, đúng giờ cũ
        Graph g2 = g;
        g2.setTraffic(shift.trips()[0].path[at], shift.trips()[0].path[at + 1], 1, true);
        rep = shift.reroute(g2, 0, nullptr, 8 * 60, orders);
        CHECK(rep.rerouted == 1 && rep.dropped.empty());
        CHECK(second->status == ASSIGNED && near(second->eta, eta2));
        CHECK(shift.trips()[0].path.back() == 0);
    }

    cout << "\n>>> TAT CA " << passed << " KIEM TRA DEU DAT <<<\n";
    return 0;
}
