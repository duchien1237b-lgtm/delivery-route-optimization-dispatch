var GIA_MOI_KM = 5000;
var PHI_CO_DINH = 15000;
var TOC_DO_KMH = 30;
var PHUT_MOI_DIEM = 5;
var phutTrenCanh = (e, xe, luc = -1, caoDiem = null) => {
  let t = travelMinutes(e, xe);
  if (t <= 0)
    t = e.distance / TOC_DO_KMH * 60;
  if (caoDiem && luc >= 0)
    t *= caoDiem.multiplier(e, xe, luc);
  return t;
};
var khongHopLe = (lyDo) => ({ hopLe: false, lyDo, quangDuongKm: 0, chiPhi: 0, phuPhi: 0, thoiGianPhut: 0, thoiGianGoc: 0, gioDi: -1, soDiemGiao: 0, cacChang: [] });
function tinhChang(g, duongDi, xe, batDau = -1, caoDiem = null) {
  const c = { tu: duongDi[0], den: duongDi[duongDi.length - 1], duongDi, km: 0, phut: 0, phutGoc: 0, phuPhi: 0 };
  for (let i = 0;i + 1 < duongDi.length; i++) {
    const e = g.getEdge(duongDi[i], duongDi[i + 1]);
    if (!e || !vehicleAllowed(e, xe))
      return null;
    c.km += e.distance;
    c.phut += phutTrenCanh(e, xe, batDau >= 0 ? batDau + c.phut : -1, caoDiem);
    c.phutGoc += phutTrenCanh(e, xe);
    c.phuPhi += e.cost * 1000;
  }
  return c;
}
function tongHop(kq) {
  kq.hopLe = true;
  kq.quangDuongKm = kq.phuPhi = kq.thoiGianPhut = kq.thoiGianGoc = 0;
  for (const c of kq.cacChang) {
    kq.quangDuongKm += c.km;
    kq.phuPhi += c.phuPhi;
    kq.thoiGianPhut += c.phut;
    kq.thoiGianGoc += c.phutGoc;
  }
  kq.chiPhi = PHI_CO_DINH + kq.quangDuongKm * GIA_MOI_KM + kq.phuPhi;
  kq.thoiGianPhut += kq.soDiemGiao * PHUT_MOI_DIEM;
  kq.thoiGianGoc += kq.soDiemGiao * PHUT_MOI_DIEM;
  return kq;
}
var ten = (g, id) => g.hasNode(id) ? g.getNode(id).name : "#" + id;
function estimateMultiStop(g, kho, cacDiemGiao, xe = ANY_VEHICLE, quayVeKho = false, gioDi = -1, caoDiem = null) {
  if (gioDi < 0)
    caoDiem = null;
  if (!g.hasNode(kho))
    return khongHopLe("Kho không tồn tại");
  if (!cacDiemGiao.length)
    return khongHopLe("Chưa chọn điểm giao nào");
  const diem = quayVeKho ? [...cacDiemGiao, kho] : cacDiemGiao;
  const kq = { ...khongHopLe(""), soDiemGiao: cacDiemGiao.length, cacChang: [], gioDi: caoDiem ? gioDi : -1 };
  let daDi = 0;
  let xp = kho;
  for (const den of diem) {
    if (!g.hasNode(den))
      return khongHopLe(`Điểm ${den} không tồn tại`);
    if (den === xp)
      continue;
    const duongDi = bfGetPath(bellmanFord(g, xp, DISTANCE, xe), xp, den);
    if (!duongDi.length)
      return khongHopLe(`Không có đường từ ${ten(g, xp)} tới ${ten(g, den)} cho ${vehicleName(xe)}`);
    const c = tinhChang(g, duongDi, xe, caoDiem ? gioDi + daDi : -1, caoDiem);
    kq.cacChang.push(c);
    daDi += c.phut + PHUT_MOI_DIEM;
    xp = den;
  }
  return tongHop(kq);
}
var PENDING = 0;
var ASSIGNED = 1;
var DELIVERED = 2;
var FAILED = 3;
var CANCELLED = 4;
var RETURNED = 5;
var CREATED = 6;
var DISPATCHED = 7;
var ORDER_STATUS_COUNT = 8;
var MAX_ATTEMPTS = 2;
var FAIL_ABSENT = 0;
var FAIL_REFUSED = 2;
var FAIL_DAMAGED = 3;
var FAIL_OTHER = 5;
var FAIL_REASON_COUNT = 6;
var FAIL_NAMES = ["Khách vắng nhà / không liên lạc được", "Sai hoặc thiếu địa chỉ", "Khách từ chối nhận", "Hàng hư hỏng", "Khách hẹn giao lại", "Lý do khác"];
var failReasonName = (r) => FAIL_NAMES[r] ?? "";
var failReasonReturns = (r) => r === FAIL_REFUSED || r === FAIL_DAMAGED;
function orderStatusName(s) {
  return ["Chờ giao", "Đang giao", "Đã giao", "Thất bại", "Đã huỷ", "Hoàn kho", "Mới", "Đã phân công"][s] || "Chờ giao";
}
function higherPriority(a, b) {
  if (a.urgent !== b.urgent)
    return a.urgent;
  const da = a.deadline < 0 ? 1 << 30 : a.deadline;
  const db = b.deadline < 0 ? 1 << 30 : b.deadline;
  if (da !== db)
    return da < db;
  return a.id < b.id;
}
var now2 = () => typeof performance !== "undefined" ? performance.now() : Date.now();
var since = (t0) => (now2() - t0) * 1000;
var MAX_TSP = 15;

class Dispatcher {
  constructor(g, depot, orders, shippers, returnToDepot = true) {
    this.g = g;
    this.depot = depot;
    this.orders = orders;
    this.shippers = shippers;
    this.returnToDepot = returnToDepot;
    this.startTime = 0;
    this.freeAt = [];
    this.rush = null;
    this.dayStart = 0;
    this.mat = [null, null, null, null];
    this.matrixMicros = 0;
    this.prioLess = (a, b) => higherPriority(this.orders[a], this.orders[b]);
  }
  setStartTime(t) {
    this.startTime = t;
  }
  setShipperFreeAt(t) {
    this.freeAt = t;
  }
  startOf(shipper) {
    return shipper >= 0 && shipper < this.freeAt.length ? Math.max(this.startTime, this.freeAt[shipper]) : this.startTime;
  }
  setRush(rush, shiftStartOfDay) {
    this.rush = rush;
    this.dayStart = shiftStartOfDay;
  }
  priorityOrder() {
    const heap = new MinHeap(this.prioLess);
    this.orders.forEach((_, i) => heap.push(i));
    const out = [];
    while (!heap.empty())
      out.push(heap.pop());
    return out;
  }
  matrix(v) {
    if (this.mat[v])
      return this.mat[v];
    const t0 = now2();
    const g = this.g;
    const P = this.orders.length + 1;
    const node = [this.depot, ...this.orders.map((o) => o.destination)];
    const km = Array.from({ length: P }, () => new Array(P).fill(INF));
    const minutes = Array.from({ length: P }, () => new Array(P).fill(INF));
    const path = Array.from({ length: P }, () => new Array(P).fill(null).map(() => []));
    const cache = new Map;
    for (let a = 0;a < P; a++) {
      if (!g.hasNode(node[a]))
        continue;
      if (!cache.has(node[a]))
        cache.set(node[a], dijkstra(g, node[a], MIN_HEAP, { criterion: DISTANCE, vehicle: v }));
      const t = cache.get(node[a]);
      for (let b = 0;b < P; b++) {
        if (!g.hasNode(node[b]))
          continue;
        if (node[a] === node[b]) {
          km[a][b] = minutes[a][b] = 0;
          path[a][b] = [node[a]];
          continue;
        }
        const p = getPath(t, node[b]);
        if (!p.length)
          continue;
        const info = describePath(g, p, v);
        km[a][b] = info.km;
        minutes[a][b] = info.minutes;
        path[a][b] = p;
      }
    }
    this.mat[v] = { km, minutes, path };
    this.matrixMicros += since(t0);
    return this.mat[v];
  }
  dist(v, a, b) {
    return this.matrix(v).km[a][b];
  }
  closeLeg(v, last) {
    return this.returnToDepot ? this.dist(v, last, 0) : 0;
  }
  reachable(v, o) {
    if (this.dist(v, 0, o + 1) === INF)
      return false;
    return !this.returnToDepot || this.dist(v, o + 1, 0) !== INF;
  }
  tourKm(v, tour) {
    if (!tour.length)
      return 0;
    let d = this.dist(v, 0, tour[0] + 1);
    for (let i = 1;i < tour.length; i++)
      d += this.dist(v, tour[i - 1] + 1, tour[i] + 1);
    return d + this.closeLeg(v, tour[tour.length - 1] + 1);
  }
  twoOpt(v, tour) {
    const n = tour.length;
    if (n < 2)
      return;
    const rev = (i, j) => {
      for (;i < j; i++, j--)
        [tour[i], tour[j]] = [tour[j], tour[i]];
    };
    let best = this.tourKm(v, tour);
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0;i < n - 1; i++)
        for (let j = i + 1;j < n; j++) {
          rev(i, j);
          const d = this.tourKm(v, tour);
          if (d < best - 0.000000001) {
            best = d;
            improved = true;
          } else
            rev(i, j);
        }
    }
  }
  nearestNeighborTour(v, candidates, startPoint = 0) {
    candidates = [...candidates];
    const tour = [];
    let cur = startPoint;
    while (candidates.length) {
      let bi = -1, bd = INF;
      candidates.forEach((c, i) => {
        const d = this.dist(v, cur, c + 1);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      });
      if (bi < 0)
        break;
      cur = candidates[bi] + 1;
      tour.push(candidates[bi]);
      candidates.splice(bi, 1);
    }
    return tour;
  }
  tspTour(v, orders) {
    const k = orders.length;
    if (k === 0 || k > MAX_TSP)
      return [];
    const FULL = (1 << k) - 1;
    const dp = new Float64Array((FULL + 1) * k).fill(INF);
    const parent = new Int8Array((FULL + 1) * k).fill(-1);
    const D = Array.from({ length: k }, (_, a) => orders.map((ob) => this.dist(v, orders[a] + 1, ob + 1)));
    for (let j = 0;j < k; j++)
      dp[(1 << j) * k + j] = this.dist(v, 0, orders[j] + 1);
    for (let mask = 1;mask <= FULL; mask++)
      for (let j = 0;j < k; j++) {
        if (!(mask & 1 << j))
          continue;
        const cur = dp[mask * k + j];
        if (cur === INF)
          continue;
        for (let nx = 0;nx < k; nx++) {
          if (mask & 1 << nx)
            continue;
          const nd = cur + D[j][nx];
          const at = (mask | 1 << nx) * k + nx;
          if (nd < dp[at]) {
            dp[at] = nd;
            parent[at] = j;
          }
        }
      }
    let best = INF, last = -1;
    for (let j = 0;j < k; j++) {
      const d = dp[FULL * k + j] + this.closeLeg(v, orders[j] + 1);
      if (d < best) {
        best = d;
        last = j;
      }
    }
    if (last < 0)
      return [];
    const tour = [];
    for (let mask = FULL, j = last;j !== -1; ) {
      tour.push(orders[j]);
      const pj = parent[mask * k + j];
      mask ^= 1 << j;
      j = pj;
    }
    return tour.reverse();
  }
  buildRoute(shipper, v, tour) {
    const m = this.matrix(v);
    const st = this.startOf(shipper);
    const r = { shipper, vehicle: v, orders: tour, path: [], arrival: [], pathTimes: [], stopIndex: [], load: 0, km: 0, minutes: 0, costVnd: 0, rushDelay: 0, late: 0, startAt: st };
    if (!tour.length)
      return r;
    r.path.push(this.depot);
    r.pathTimes.push(0);
    let cur = 0, base = 0;
    const addLeg = (to) => {
      const p = m.path[cur][to];
      let t = r.minutes;
      for (let i = 1;i < p.length; i++) {
        const e = this.g.getEdge(p[i - 1], p[i]);
        if (e) {
          t += travelMinutesAt(e, v, this.dayStart + st + t, this.rush);
          base += travelMinutes(e, v);
        }
        r.path.push(p[i]);
        r.pathTimes.push(t);
      }
      r.km += m.km[cur][to];
      r.minutes = t;
      cur = to;
    };
    for (const o of tour) {
      addLeg(o + 1);
      r.stopIndex.push(r.path.length - 1);
      r.arrival.push(r.minutes);
      const od = this.orders[o];
      if (od.deadline >= 0 && st + r.minutes > od.deadline + 0.000000001)
        r.late++;
      r.minutes += PHUT_MOI_DIEM;
      r.load += od.weight;
    }
    if (this.returnToDepot)
      addLeg(0);
    r.rushDelay = Math.max(0, r.minutes - tour.length * PHUT_MOI_DIEM - base);
    let phuPhi = 0;
    for (let i = 0;i + 1 < r.path.length; i++) {
      const e = this.g.getEdge(r.path[i], r.path[i + 1]);
      if (e)
        phuPhi += e.cost * 1000;
    }
    r.costVnd = PHI_CO_DINH + r.km * GIA_MOI_KM + phuPhi;
    return r;
  }
  newPlan(key, name, description) {
    return { key, name, description, routes: [], overweight: [], unreachable: [], km: 0, minutes: 0, makespan: 0, costVnd: 0, late: 0, served: 0, micros: 0, optimal: false, skipped: false, note: "" };
  }
  finalize(p) {
    p.km = p.minutes = p.makespan = p.costVnd = 0;
    p.late = p.served = 0;
    for (const r of p.routes) {
      p.km += r.km;
      p.minutes += r.minutes;
      p.makespan = Math.max(p.makespan, r.minutes);
      p.costVnd += r.costVnd;
      p.late += r.late;
      p.served += r.orders.length;
    }
    p.overweight.sort((a, b) => a - b);
    p.unreachable.sort((a, b) => a - b);
    return p;
  }
  candidatesFor(v, p) {
    const c = [];
    this.orders.forEach((_, o) => this.reachable(v, o) ? c.push(o) : p.unreachable.push(o));
    return c;
  }
  missing(p, cand, tour) {
    const s = new Set(tour);
    for (const o of cand)
      if (!s.has(o))
        p.unreachable.push(o);
  }
  classify(o, p) {
    for (const s of this.shippers)
      if (this.reachable(s.vehicle, o)) {
        p.overweight.push(o);
        return;
      }
    p.unreachable.push(o);
  }
  singleNearestNeighbor(v) {
    const p = this.newPlan("nn", "Nearest Neighbor", "Từ vị trí hiện tại luôn đi tới điểm giao gần nhất chưa giao.");
    const cand = this.candidatesFor(v, p);
    const t0 = now2();
    const tour = this.nearestNeighborTour(v, cand);
    p.micros = since(t0);
    this.missing(p, cand, tour);
    p.routes.push(this.buildRoute(-1, v, tour));
    return this.finalize(p);
  }
  singleUrgentFirst(v) {
    const p = this.newPlan("urgent", "Ưu tiên đơn gấp", "Lấy đơn gấp từ hàng đợi ưu tiên (Min-Heap, hạn sớm trước), sau đó giao đơn thường theo Nearest Neighbor.");
    const cand = this.candidatesFor(v, p);
    const t0 = now2();
    const heap = new MinHeap(this.prioLess);
    const normal = [], tour = [];
    for (const o of cand)
      this.orders[o].urgent ? heap.push(o) : normal.push(o);
    while (!heap.empty())
      tour.push(heap.pop());
    const last = tour.length ? tour[tour.length - 1] + 1 : 0;
    tour.push(...this.nearestNeighborTour(v, normal, last));
    p.micros = since(t0);
    this.missing(p, cand, tour);
    p.routes.push(this.buildRoute(-1, v, tour));
    return this.finalize(p);
  }
  singleNearestNeighbor2Opt(v) {
    const p = this.newPlan("nn2opt", "Nearest Neighbor + 2-opt", "Lộ trình Nearest Neighbor được cải thiện bằng 2-opt: đảo ngược một đoạn nếu làm quãng đường ngắn hơn.");
    const cand = this.candidatesFor(v, p);
    const t0 = now2();
    const tour = this.nearestNeighborTour(v, cand);
    this.twoOpt(v, tour);
    p.micros = since(t0);
    this.missing(p, cand, tour);
    p.routes.push(this.buildRoute(-1, v, tour));
    return this.finalize(p);
  }
  singleTspBitmask(v) {
    const p = this.newPlan("tsp", "TSP bitmask (tối ưu)", "Quy hoạch động trên tập con (Held-Karp), O(2ⁿ·n²): cho lộ trình ngắn nhất tuyệt đối.");
    const cand = this.candidatesFor(v, p);
    if (cand.length > MAX_TSP) {
      p.skipped = true;
      p.note = `Có ${cand.length} điểm, vượt giới hạn ${MAX_TSP} điểm của TSP bitmask.`;
      return this.finalize(p);
    }
    const t0 = now2();
    const tour = this.tspTour(v, cand);
    p.micros = since(t0);
    if (!tour.length && cand.length) {
      p.note = "Không có lộ trình đi qua đủ mọi điểm (đường một chiều không khép kín).";
      p.unreachable.push(...cand);
    } else
      p.optimal = true;
    p.routes.push(this.buildRoute(-1, v, tour));
    return this.finalize(p);
  }
  warm() {
    for (const s of this.shippers)
      this.matrix(s.vehicle);
  }
  multiNearestNeighbor() {
    const p = this.newPlan("mnn", "Nearest Neighbor tuần tự", "Lần lượt từng shipper: luôn nhận đơn gần vị trí hiện tại nhất mà còn vừa tải trọng.");
    this.warm();
    const t0 = now2();
    const served = new Uint8Array(this.orders.length);
    const tours = this.shippers.map(() => []);
    this.shippers.forEach((s, k) => {
      const v = s.vehicle;
      let load = 0, cur = 0;
      for (;; ) {
        let best = -1, bd = INF;
        this.orders.forEach((od, o) => {
          if (served[o] || !this.reachable(v, o) || load + od.weight > s.capacity)
            return;
          const d = this.dist(v, cur, o + 1);
          if (d < bd) {
            bd = d;
            best = o;
          }
        });
        if (best < 0)
          break;
        served[best] = 1;
        load += this.orders[best].weight;
        tours[k].push(best);
        cur = best + 1;
      }
    });
    p.micros = since(t0);
    this.orders.forEach((_, o) => {
      if (!served[o])
        this.classify(o, p);
    });
    this.shippers.forEach((s, k) => p.routes.push(this.buildRoute(k, s.vehicle, tours[k])));
    return this.finalize(p);
  }
  multiPriorityQueue() {
    const p = this.newPlan("mpq", "Hàng đợi ưu tiên", "Lấy đơn từ hàng đợi ưu tiên (gấp → hạn sớm), giao cho shipper đang đứng gần đơn nhất mà còn đủ tải.");
    this.warm();
    const t0 = now2();
    const heap = new MinHeap(this.prioLess);
    this.orders.forEach((_, o) => heap.push(o));
    const tours = this.shippers.map(() => []);
    const load = this.shippers.map(() => 0);
    const pending = [];
    while (!heap.empty()) {
      const o = heap.pop();
      let bk = -1, bd = INF;
      this.shippers.forEach((s, k) => {
        const v = s.vehicle;
        if (!this.reachable(v, o) || load[k] + this.orders[o].weight > s.capacity)
          return;
        const cur = tours[k].length ? tours[k][tours[k].length - 1] + 1 : 0;
        const d = this.dist(v, cur, o + 1);
        if (d < bd) {
          bd = d;
          bk = k;
        }
      });
      if (bk < 0) {
        pending.push(o);
        continue;
      }
      tours[bk].push(o);
      load[bk] += this.orders[o].weight;
    }
    p.micros = since(t0);
    for (const o of pending)
      this.classify(o, p);
    this.shippers.forEach((s, k) => p.routes.push(this.buildRoute(k, s.vehicle, tours[k])));
    return this.finalize(p);
  }
  insertionAssign(p) {
    const K = this.shippers.length;
    const tours = this.shippers.map(() => []);
    const load = new Array(K).fill(0);
    const idx = this.orders.map((_, i) => i).sort((a, b) => this.orders[b].weight - this.orders[a].weight);
    for (const o of idx) {
      let bc = INF, bk = -1, bp = -1;
      for (let k = 0;k < K; k++) {
        const v = this.shippers[k].vehicle;
        if (!this.reachable(v, o) || load[k] + this.orders[o].weight > this.shippers[k].capacity)
          continue;
        const r = tours[k];
        for (let pos = 0;pos <= r.length; pos++) {
          const prev = pos === 0 ? 0 : r[pos - 1] + 1;
          const cur = o + 1;
          let cost;
          if (pos === r.length)
            cost = this.dist(v, prev, cur) + this.closeLeg(v, cur) - (r.length ? this.closeLeg(v, prev) : 0);
          else {
            const next = r[pos] + 1;
            cost = this.dist(v, prev, cur) + this.dist(v, cur, next) - this.dist(v, prev, next);
          }
          if (cost < bc) {
            bc = cost;
            bk = k;
            bp = pos;
          }
        }
      }
      if (bk < 0)
        this.classify(o, p);
      else {
        tours[bk].splice(bp, 0, o);
        load[bk] += this.orders[o].weight;
      }
    }
    return tours;
  }
  multiInsertion2Opt() {
    const p = this.newPlan("ins2opt", "Cheapest Insertion + 2-opt", "Xét đơn nặng trước, chèn vào vị trí làm tăng quãng đường ít nhất trong các shipper còn đủ tải; sau đó tối ưu từng tuyến bằng 2-opt.");
    this.warm();
    const t0 = now2();
    const tours = this.insertionAssign(p);
    tours.forEach((t, k) => this.twoOpt(this.shippers[k].vehicle, t));
    p.micros = since(t0);
    this.shippers.forEach((s, k) => p.routes.push(this.buildRoute(k, s.vehicle, tours[k])));
    return this.finalize(p);
  }
  multiInsertionTsp() {
    const p = this.newPlan("instsp", "Cheapest Insertion + TSP từng xe", "Phân đơn như Cheapest Insertion, sau đó sắp thứ tự giao tối ưu cho từng shipper bằng TSP bitmask.");
    this.warm();
    const t0 = now2();
    const tours = this.insertionAssign(p);
    let allOptimal = true;
    tours.forEach((t, k) => {
      const v = this.shippers[k].vehicle;
      const best = this.tspTour(v, t);
      if (best.length)
        tours[k] = best;
      else if (t.length > MAX_TSP) {
        this.twoOpt(v, t);
        allOptimal = false;
      }
    });
    p.micros = since(t0);
    p.optimal = allOptimal;
    if (!allOptimal)
      p.note = `Tuyến nào quá ${MAX_TSP} điểm được tối ưu bằng 2-opt.`;
    this.shippers.forEach((s, k) => p.routes.push(this.buildRoute(k, s.vehicle, tours[k])));
    return this.finalize(p);
  }
  lateAndKm(shipper, v, tour) {
    if (!tour.length)
      return [0, 0];
    const r = this.buildRoute(shipper, v, tour);
    return [r.late, r.km];
  }
  multiDeadlineInsertion() {
    const p = this.newPlan("deadline", "Theo hạn giao + tìm kiếm cục bộ", "Hai lời giải khởi đầu (chèn theo thứ tự ưu tiên gấp/hạn sớm, và chèn rẻ nhất) được cải thiện bằng tìm kiếm cục bộ: chuyển một đơn sang vị trí hoặc shipper khác (relocate) và 2-opt. Mục tiêu: ít đơn trễ nhất, hoà thì ít km nhất; giờ tới tính theo giờ thực tế (kể cả giờ cao điểm).");
    this.warm();
    const t0 = now2();
    const K = this.shippers.length;
    const better = (a, b) => a[0] < b[0] || a[0] === b[0] && a[1] < b[1] - 0.000000001;
    const loadOf = (t) => t.reduce((s, o) => s + this.orders[o].weight, 0);
    const improve = (tours) => {
      const ev = tours.map((t, k) => this.lateAndKm(k, this.shippers[k].vehicle, t));
      let improved = true, guard = 0;
      while (improved && guard++ < 200) {
        improved = false;
        for (let a = 0;a < K && !improved; a++)
          for (let i = 0;i < tours[a].length && !improved; i++) {
            const o = tours[a][i];
            const ta = tours[a].slice();
            ta.splice(i, 1);
            const ea = this.lateAndKm(a, this.shippers[a].vehicle, ta);
            for (let b = 0;b < K && !improved; b++) {
              const vb = this.shippers[b].vehicle;
              if (b !== a && (!this.reachable(vb, o) || loadOf(tours[b]) + this.orders[o].weight > this.shippers[b].capacity))
                continue;
              const base = b === a ? ta : tours[b];
              for (let j = 0;j <= base.length; j++) {
                if (b === a && j === i)
                  continue;
                const tb = base.slice();
                tb.splice(j, 0, o);
                const eb = this.lateAndKm(b, vb, tb);
                const before = b === a ? ev[a] : [ev[a][0] + ev[b][0], ev[a][1] + ev[b][1]];
                const after = b === a ? eb : [ea[0] + eb[0], ea[1] + eb[1]];
                if (better(after, before)) {
                  if (b === a) {
                    tours[a] = tb;
                    ev[a] = eb;
                  } else {
                    tours[a] = ta;
                    tours[b] = tb;
                    ev[a] = ea;
                    ev[b] = eb;
                  }
                  improved = true;
                  break;
                }
              }
            }
          }
        for (let k = 0;k < K && !improved; k++) {
          const t = tours[k];
          const rev = (i, j) => {
            for (;i < j; i++, j--)
              [t[i], t[j]] = [t[j], t[i]];
          };
          for (let i = 0;i + 1 < t.length && !improved; i++)
            for (let j = i + 1;j < t.length && !improved; j++) {
              rev(i, j);
              const e = this.lateAndKm(k, this.shippers[k].vehicle, t);
              if (better(e, ev[k])) {
                ev[k] = e;
                improved = true;
              } else
                rev(i, j);
            }
        }
      }
      return ev.reduce((s, e) => [s[0] + e[0], s[1] + e[1]], [0, 0]);
    };
    const a = this.shippers.map(() => []);
    const load = new Array(K).fill(0);
    const cur = this.shippers.map(() => [0, 0]);
    for (const o of this.priorityOrder()) {
      let bc = INF, bk = -1, bp = -1, be = null;
      for (let k = 0;k < K; k++) {
        const v = this.shippers[k].vehicle;
        if (!this.reachable(v, o) || load[k] + this.orders[o].weight > this.shippers[k].capacity)
          continue;
        for (let pos = 0;pos <= a[k].length; pos++) {
          const t = a[k].slice();
          t.splice(pos, 0, o);
          const ev = this.lateAndKm(k, v, t);
          const cost = (ev[0] - cur[k][0]) * 1e6 + (ev[1] - cur[k][1]);
          if (cost < bc - 0.000000001) {
            bc = cost;
            bk = k;
            bp = pos;
            be = ev;
          }
        }
      }
      if (bk < 0)
        continue;
      a[bk].splice(bp, 0, o);
      load[bk] += this.orders[o].weight;
      cur[bk] = be;
    }
    const starts = [a, this.insertionAssign(this.newPlan("", "", ""))];
    for (const q of [this.multiNearestNeighbor(), this.multiPriorityQueue(), this.multiInsertion2Opt()]) {
      const t = this.shippers.map(() => []);
      for (const r of q.routes)
        if (r.shipper >= 0)
          t[r.shipper] = r.orders.slice();
      starts.push(t);
    }
    const served = (t) => t.reduce((s, x) => s + x.length, 0);
    let best = null, bestEval = null;
    for (const t of starts) {
      const e = improve(t);
      if (!best || served(t) > served(best) || served(t) === served(best) && better(e, bestEval)) {
        best = t;
        bestEval = e;
      }
    }
    const inPlan = new Set(best.flat());
    this.orders.forEach((_, o) => {
      if (!inPlan.has(o))
        this.classify(o, p);
    });
    p.micros = since(t0);
    this.shippers.forEach((s, k) => p.routes.push(this.buildRoute(k, s.vehicle, best[k])));
    return this.finalize(p);
  }
  compareAll(singleVehicle) {
    const rep = { single: [], multi: [], priorityOrder: [], matrixMicros: 0, error: "" };
    if (!this.g.hasNode(this.depot)) {
      rep.error = "Kho không tồn tại trên bản đồ";
      return rep;
    }
    rep.priorityOrder = this.priorityOrder();
    if (!this.orders.length) {
      rep.error = "Chưa có đơn hàng nào để điều phối";
      return rep;
    }
    this.matrix(singleVehicle);
    this.warm();
    rep.matrixMicros = this.matrixMicros;
    rep.single.push(this.singleNearestNeighbor(singleVehicle), this.singleUrgentFirst(singleVehicle), this.singleNearestNeighbor2Opt(singleVehicle), this.singleTspBitmask(singleVehicle));
    if (this.shippers.length)
      rep.multi.push(this.multiNearestNeighbor(), this.multiPriorityQueue(), this.multiInsertion2Opt(), this.multiInsertionTsp(), this.multiDeadlineInsertion());
    return rep;
  }
}
