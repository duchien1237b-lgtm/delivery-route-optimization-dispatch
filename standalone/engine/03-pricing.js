var PHI_MO_DAU = 15000;
var KM_MO_DAU = 2;
var GIA_KM_TIEP = 4000;
var KG_MIEN_PHI = 3;
var PHI_MOI_KG = 2500;
var HOA_TOC = 0.3;
var PHI_COD = 0.008;
var PHI_COD_TOI_THIEU = 5000;
var TI_LE_PHI_HOAN = 0.5;
var roundUp500 = (x) => Math.ceil(x / 500 - 0.000000001) * 500;
// Biểu phí đang áp dụng (Pricing::tariff()); quản trị viên chỉnh được qua trang Cấu hình
var TARIFF = { firstKm: KM_MO_DAU, firstFee: PHI_MO_DAU, perKm: GIA_KM_TIEP, freeKg: KG_MIEN_PHI, perKg: PHI_MOI_KG, urgent: HOA_TOC, codRate: PHI_COD, codMin: PHI_COD_TOI_THIEU, returnRate: TI_LE_PHI_HOAN };
function checkTariff(t) {
  const bad = (v, lo, hi) => !Number.isFinite(v) || v < lo || v > hi;
  if (bad(t.firstKm, 0, 50))
    return "Số km đầu tiên phải từ 0 đến 50";
  if (bad(t.firstFee, 0, 1e6))
    return "Phí mở đầu phải từ 0 đến 1.000.000 đ";
  if (bad(t.perKm, 0, 1e5))
    return "Giá mỗi km phải từ 0 đến 100.000 đ";
  if (bad(t.freeKg, 0, 1000))
    return "Khối lượng miễn phí phải từ 0 đến 1000 kg";
  if (bad(t.perKg, 0, 1e5))
    return "Phí mỗi kg vượt mức phải từ 0 đến 100.000 đ";
  if (bad(t.urgent, 0, 2))
    return "Phụ thu hoả tốc phải từ 0% đến 200%";
  if (bad(t.codRate, 0, 0.2))
    return "Phí thu hộ phải từ 0% đến 20%";
  if (bad(t.codMin, 0, 1e6))
    return "Phí thu hộ tối thiểu phải từ 0 đến 1.000.000 đ";
  if (bad(t.returnRate, 0, 1))
    return "Tỉ lệ phí hoàn kho phải từ 0% đến 100%";
  return "";
}
function shippingFee(km, weight, urgent, cod) {
  const T = TARIFF;
  const f = { valid: false, km: 0, base: 0, distance: 0, weight: 0, urgent: 0, cod: 0, total: 0 };
  if (!Number.isFinite(km))
    return f;
  f.valid = true;
  f.km = km;
  f.base = T.firstFee;
  f.distance = Math.max(0, km - T.firstKm) * T.perKm;
  f.weight = Math.max(0, weight - T.freeKg) * T.perKg;
  f.urgent = urgent ? (f.base + f.distance + f.weight) * T.urgent : 0;
  f.cod = cod > 0 ? Math.max(T.codMin, cod * T.codRate) : 0;
  f.total = roundUp500(f.base + f.distance + f.weight + f.urgent + f.cod);
  return f;
}
function feeDistances(g, depot, orders) {
  const km = orders.map(() => Infinity);
  if (!g.hasNode(depot))
    return km;
  const plain = g.clone();
  plain.clearTraffic();
  const tm = dijkstra(plain, depot, MIN_HEAP, { vehicle: MOTORBIKE });
  const ta = dijkstra(plain, depot, MIN_HEAP, { vehicle: ANY_VEHICLE });
  orders.forEach((o, i) => {
    if (!tm.dist.has(o.destination))
      return;
    const a = tm.dist.get(o.destination);
    km[i] = Number.isFinite(a) ? a : ta.dist.get(o.destination);
  });
  return km;
}
function summarize(orders, fees, trips, shipperCount) {
  const f = { revenue: 0, expectedRevenue: 0, cost: 0, profit: 0, codCollected: 0, codOnRoute: 0, codPending: 0, delivered: 0, returned: 0, cancelled: 0, shippers: [] };
  for (let i = 0;i <= shipperCount; i++)
    f.shippers.push({ shipper: i < shipperCount ? i : -1, delivered: 0, failed: 0, returned: 0, onRoute: 0, codCollected: 0, codOnRoute: 0, revenue: 0, km: 0, cost: 0 });
  const slot = (s) => f.shippers[s >= 0 && s < shipperCount ? s : shipperCount];
  orders.forEach((o, i) => {
    const fee = fees[i];
    const cod = o.cod || 0;
    switch (o.status) {
      case DELIVERED: {
        f.delivered++;
        f.revenue += fee.total;
        f.codCollected += cod;
        const s = slot(o.shipper);
        s.delivered++;
        s.codCollected += cod;
        s.revenue += fee.total;
        break;
      }
      case RETURNED: {
        f.returned++;
        const r = fee.valid ? roundUp500((fee.total - fee.cod) * TARIFF.returnRate) : 0;
        f.revenue += r;
        const s = slot(o.shipper);
        s.returned++;
        s.revenue += r;
        break;
      }
      case ASSIGNED: {
        f.expectedRevenue += fee.total;
        f.codOnRoute += cod;
        const s = slot(o.shipper);
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
  });
  f.expectedRevenue += f.revenue;
  for (const t of trips) {
    f.cost += t.cost;
    const s = slot(t.shipper);
    s.cost += t.cost;
    s.km += t.km;
  }
  f.profit = f.revenue - f.cost;
  const last = f.shippers[f.shippers.length - 1];
  if (last.delivered + last.failed + last.returned + last.onRoute === 0 && last.km === 0)
    f.shippers.pop();
  return f;
}
