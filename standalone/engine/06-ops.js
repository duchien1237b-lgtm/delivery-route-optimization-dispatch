var clockText = (m) => `${Math.sign(m) * Math.round(Math.abs(m))} phút`;
function nowString() {
  const d = new Date;
  const p = (x) => String(x).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

class ShiftManager {
  constructor() {
    this.trips = [];
    this.history = [];
    this.clock = 0;
    this.nextTrip = 1;
    this.absent = new Set;
    this.standby = new Map;
    this.events = [];
  }
  active() {
    return this.trips.length > 0;
  }
  apply(plan, pendingIdx, orders, shippers, awaitAccept = false, quiet = false) {
    let assigned = 0;
    for (const r of plan.routes) {
      if (!r.orders.length)
        continue;
      const startAt = Math.max(this.clock, r.startAt || 0);
      const own = r.shipper >= 0 && r.shipper < shippers.length;
      const t = {
        id: this.nextTrip++,
        shipper: r.shipper,
        shipperName: own ? shippers[r.shipper].name : "Một xe",
        vehicle: r.vehicle,
        path: [...r.path],
        pathTimes: r.pathTimes.map((x) => x + startAt),
        stops: [],
        km: r.km,
        minutes: r.minutes,
        cost: r.costVnd,
        load: r.load,
        capacity: own ? shippers[r.shipper].capacity : 0,
        note: "",
        reroutes: 0,
        accepted: !awaitAccept,
        offerUntil: 0,
        offerClock: 0,
        fromNode: -1,
        approach: [],
        approachTimes: []
      };
      r.orders.forEach((oi, i) => {
        const o = orders[pendingIdx[oi]];
        o.status = awaitAccept ? DISPATCHED : ASSIGNED;
        o.shipper = r.shipper;
        o.eta = r.arrival[i] + startAt;
        o.deliveredAt = -1;
        t.stops.push({ orderId: o.id, node: o.destination, pathIndex: i < r.stopIndex.length ? r.stopIndex[i] : 0, eta: r.arrival[i] + startAt });
        assigned++;
      });
      this.trips.push(t);
    }
    if (quiet)
      return assigned;
    this.history.push({
      id: this.history.length + 1,
      when: nowString(),
      plan: plan.name,
      orders: assigned,
      shippers: plan.routes.filter((r) => r.orders.length).length,
      predictedLate: plan.late,
      km: plan.km,
      cost: plan.costVnd,
      makespan: plan.makespan
    });
    this.log(this.clock, "apply", -1, -1, `${plan.name} (${assigned} đơn)`);
    return assigned;
  }
  progress(t, orders) {
    this.clock = Math.max(this.clock, t);
    let delivered = 0;
    for (const trip of this.trips)
      for (const s of trip.stops) {
        if (s.eta > this.clock + 0.000000001)
          continue;
        const o = orders.find((x) => x.id === s.orderId);
        if (o && o.status === ASSIGNED) {
          o.status = DELIVERED;
          o.deliveredAt = s.eta;
          this.setStandby(trip.shipper, o.destination);
          delivered++;
          this.log(s.eta, "delivered", o.id, trip.shipper, o.deadline >= 0 && s.eta > o.deadline + 0.000000001 ? `trễ ${clockText(s.eta - o.deadline)}` : "");
        }
      }
    return delivered;
  }
  fail(id, orders, reason = FAIL_ABSENT) {
    const o = orders.find((x) => x.id === id);
    if (!o || o.status !== ASSIGNED)
      return -1;
    if (!(reason >= 0 && reason < FAIL_REASON_COUNT))
      reason = FAIL_OTHER;
    o.attempts = (o.attempts || 0) + 1;
    o.failReason = reason;
    o.status = o.attempts >= MAX_ATTEMPTS || failReasonReturns(reason) ? RETURNED : FAILED;
    this.setStandby(o.shipper, o.destination);
    this.log(this.clock, o.status === RETURNED ? "returned" : "failed", o.id, o.shipper, failReasonName(reason));
    return o.status;
  }
  requeue(id, orders) {
    const o = orders.find((x) => x.id === id);
    if (!o || o.status !== FAILED)
      return false;
    Object.assign(o, { status: PENDING, shipper: -1, eta: -1, deliveredAt: -1 });
    this._dropStop(id);
    this.log(this.clock, "requeue", id, -1, "");
    return true;
  }
  _dropStop(id) {
    for (const t of this.trips)
      t.stops = t.stops.filter((s) => s.orderId !== id);
  }
  cancel(id, orders) {
    const o = orders.find((x) => x.id === id);
    if (!o || o.status !== PENDING && o.status !== ASSIGNED && o.status !== FAILED && o.status !== DISPATCHED && o.status !== CREATED)
      return false;
    if (o.shipper >= 0) {
      const t = this.tripOfOrder(id);
      if (t && t.accepted && t.fromNode >= 0)
        this.setStandby(o.shipper, this.nodeReached(t));
    }
    Object.assign(o, { status: CANCELLED, eta: -1, deliveredAt: -1 });
    this._dropStop(id);
    this.log(this.clock, "cancelled", id, o.shipper, "");
    return true;
  }
  isAbsent(i) {
    return this.absent.has(i);
  }
  setAvailable(i) {
    if (this.absent.delete(i))
      this.log(this.clock, "available", -1, i, "");
  }
  shipperAbsent(shipper, name, orders) {
    this.progress(this.clock, orders);
    this.absent.add(shipper);
    let back = 0;
    for (const t of this.trips) {
      if (t.shipper !== shipper)
        continue;
      for (const s of t.stops) {
        const o = orders.find((x) => x.id === s.orderId);
        if (o && (o.status === ASSIGNED || o.status === DISPATCHED)) {
          Object.assign(o, { status: PENDING, shipper: -1, eta: -1 });
          back++;
        }
      }
      t.stops = t.stops.filter((s) => {
        const o = orders.find((x) => x.id === s.orderId);
        return o && o.status !== PENDING;
      });
      const k = resumeIndex(t, this.clock);
      if (k >= 0) {
        t.path = t.path.slice(0, k + 1);
        t.pathTimes = t.pathTimes.slice(0, k + 1);
      }
      t.note = `${name} nghỉ đột xuất, chuyến dừng giữa chừng`;
    }
    this.log(this.clock, "absent", -1, shipper, `${back} đơn về hàng chờ`);
    return back;
  }
  shipperRemoved(shipper) {
    this.absent = new Set([...this.absent].filter((a) => a !== shipper).map((a) => a > shipper ? a - 1 : a));
    const pos = new Map;
    for (const [k, v] of this.standby)
      if (k < shipper)
        pos.set(k, v);
      else if (k > shipper)
        pos.set(k - 1, v);
    this.standby = pos;
    for (const t of this.trips) {
      if (t.shipper === shipper)
        t.shipper = -1;
      else if (t.shipper > shipper)
        t.shipper--;
    }
  }
  reroute(g, depot, rush, dayStart, orders) {
    this.progress(this.clock, orders);
    const rep = { rerouted: 0, retimed: 0, dropped: [], maxDelay: 0 };
    const find = (id) => orders.find((x) => x.id === id);
    for (const t of this.trips) {
      if (!t.path.length)
        continue;
      const remaining = t.stops.filter((s) => {
        const o = find(s.orderId);
        return o && (o.status === ASSIGNED || o.status === DISPATCHED);
      });
      let s0 = resumeIndex(t, this.clock);
      if (!remaining.length)
        continue;
      let t0 = -1;
      for (const s of remaining)
        if (s0 < 0 || s.pathIndex < s0) {
          s0 = s.pathIndex;
          t0 = s.eta;
        }
      if (s0 < 0)
        continue;
      const tStart = t0 >= 0 ? t0 : t.pathTimes[s0];
      const veh = t.vehicle;
      const oldEnd = t.pathTimes[t.pathTimes.length - 1];
      const backToDepot = t.path.length > 1 && t.path[t.path.length - 1] === depot && t.path[0] === depot;
      let blocked = false;
      for (let i = s0 + 1;i < t.path.length; i++) {
        const e = g.getEdge(t.path[i - 1], t.path[i]);
        if (!e || !vehicleAllowed(e, veh)) {
          blocked = true;
          break;
        }
      }
      const tail = [t.path[s0]];
      const stopsAt = [[]];
      const dropped = [];
      if (!blocked) {
        for (let i = s0 + 1;i < t.path.length; i++) {
          tail.push(t.path[i]);
          stopsAt.push([]);
        }
        for (const s of remaining)
          stopsAt[s.pathIndex - s0].push(s.orderId);
      } else {
        let tm = tStart;
        const leg = (target) => {
          const opt = { criterion: TIME, vehicle: veh, target, rush, departAt: rush ? dayStart + tm : -1 };
          const p = getPath(dijkstra(g, tail[tail.length - 1], MIN_HEAP, opt), target);
          if (!p.length)
            return false;
          for (let i = 1;i < p.length; i++) {
            tm += travelMinutesAt(g.getEdge(p[i - 1], p[i]), veh, dayStart + tm, rush);
            tail.push(p[i]);
            stopsAt.push([]);
          }
          return true;
        };
        for (const s of remaining) {
          if (leg(s.node)) {
            stopsAt[stopsAt.length - 1].push(s.orderId);
            tm += PHUT_MOI_DIEM;
          } else
            dropped.push(s.orderId);
        }
        if (backToDepot)
          leg(depot);
        rep.rerouted++;
        t.reroutes = (t.reroutes || 0) + 1;
      }
      const path = t.path.slice(0, s0), times = t.pathTimes.slice(0, s0);
      let tm = tStart;
      const stops = t.stops.filter((s) => {
        const o = find(s.orderId);
        return o && o.status !== ASSIGNED && o.status !== DISPATCHED;
      });
      for (let i = 0;i < tail.length; i++) {
        if (i > 0)
          tm += travelMinutesAt(g.getEdge(tail[i - 1], tail[i]), veh, dayStart + tm, rush);
        path.push(tail[i]);
        times.push(tm);
        for (const id of stopsAt[i]) {
          const o = find(id);
          stops.push({ orderId: id, node: tail[i], pathIndex: path.length - 1, eta: tm });
          if (o)
            o.eta = tm;
          tm += PHUT_MOI_DIEM;
        }
      }
      for (const id of dropped) {
        const o = find(id);
        if (!o)
          continue;
        Object.assign(o, { status: PENDING, shipper: -1, eta: -1 });
        rep.dropped.push(id);
      }
      t.path = path;
      t.pathTimes = times;
      for (const st of stops)
        st.pathIndex = Math.min(st.pathIndex, t.path.length - 1);
      t.stops = stops;
      let km = 0, phuPhi = 0;
      for (let i = 0;i + 1 < t.path.length; i++) {
        const e = g.getEdge(t.path[i], t.path[i + 1]);
        if (e) {
          km += e.distance;
          phuPhi += e.cost * 1000;
        }
      }
      t.km = km;
      t.cost = PHI_CO_DINH + km * GIA_MOI_KM + phuPhi;
      t.minutes = t.pathTimes[t.pathTimes.length - 1] - t.pathTimes[0];
      const delay = t.pathTimes[t.pathTimes.length - 1] - oldEnd;
      if (!blocked && Math.abs(delay) > 0.1)
        rep.retimed++;
      if (Math.abs(delay) > Math.abs(rep.maxDelay))
        rep.maxDelay = delay;
      if (blocked)
        t.note = `Đổi đường vì đoạn phía trước bị đóng (${delay >= 0 ? "+" : ""}${clockText(delay)})`;
    }
    return rep;
  }
  freeAt(shipper) {
    let t = 0;
    for (const tr of this.trips)
      if (tr.shipper === shipper && tr.pathTimes.length)
        t = Math.max(t, tr.pathTimes[tr.pathTimes.length - 1]);
    return t;
  }
  freeTimes(n) {
    return Array.from({ length: n }, (_, i) => this.freeAt(i));
  }
  log(t, type, order, shipper, detail) {
    this.events.push({ t, type, order, shipper, detail });
    if (this.events.length > 500)
      this.events.shift();
  }
  returnToDepot(id, orders) {
    const o = orders.find((x) => x.id === id);
    if (!o || o.status !== FAILED)
      return false;
    Object.assign(o, { status: RETURNED, eta: -1, deliveredAt: -1 });
    this._dropStop(id);
    this.log(this.clock, "returned", id, o.shipper, "Quản trị viên cho hoàn kho");
    return true;
  }
  // keepFinal: giữ nguyên đơn đã giao / đã huỷ / hoàn kho / mới tạo
  reset(orders, keepFinal = false) {
    this.absent = new Set;
    this.standby = new Map;
    this.events = [];
    for (const o of orders) {
      if (keepFinal && (o.status === DELIVERED || o.status === CANCELLED || o.status === RETURNED || o.status === CREATED))
        continue;
      Object.assign(o, { status: PENDING, shipper: -1, eta: -1, deliveredAt: -1, attempts: 0, failReason: -1, tried: [], noShipperAt: 0 });
    }
    this.trips = [];
    this.clock = 0;
  }
  findTrip(id) {
    return this.trips.find((t) => t.id === id) || null;
  }
  dropEmptyPendingTrips() {
    const before = this.trips.length;
    this.trips = this.trips.filter((t) => !(!t.accepted && !t.stops.length));
    return before - this.trips.length;
  }
  tripOfOrder(orderId) {
    return this.trips.find((t) => t.stops.some((s) => s.orderId === orderId)) || null;
  }
  accept(tripId, orders) {
    const t = this.findTrip(tripId);
    if (!t || t.accepted)
      return -1;
    t.accepted = true;
    t.offerUntil = 0;
    const late = this.clock - t.offerClock;
    if (t.fromNode >= 0 && late > 0.000000001) {
      t.pathTimes = t.pathTimes.map((x) => x + late);
      t.approachTimes = t.approachTimes.map((x) => x + late);
      for (const s of t.stops) {
        s.eta += late;
        const o = orders.find((x) => x.id === s.orderId);
        if (o)
          o.eta = s.eta;
      }
    }
    let n = 0;
    for (const s of t.stops) {
      const o = orders.find((x) => x.id === s.orderId);
      if (o && o.status === DISPATCHED) {
        o.status = ASSIGNED;
        ++n;
      }
    }
    this.log(this.clock, "accepted", -1, t.shipper, `${n} đơn`);
    if (t.fromNode >= 0) {
      let predictedLate = 0;
      for (const s of t.stops) {
        const o = orders.find((x) => x.id === s.orderId);
        if (o && o.deadline >= 0 && s.eta > o.deadline + 0.000000001)
          ++predictedLate;
      }
      this.history.push({
        id: this.history.length + 1,
        when: nowString(),
        plan: "Ghép tự động (shipper gần nhất)",
        orders: n,
        shippers: 1,
        predictedLate,
        km: t.km,
        cost: t.cost,
        makespan: t.minutes
      });
    }
    return n;
  }
  decline(tripId, orders, reason) {
    const i = this.trips.findIndex((t) => t.id === tripId);
    if (i < 0 || this.trips[i].accepted)
      return -1;
    const t = this.trips[i];
    let n = 0;
    for (const s of t.stops) {
      const o = orders.find((x) => x.id === s.orderId);
      if (o && o.status === DISPATCHED) {
        Object.assign(o, { status: PENDING, shipper: -1, eta: -1 });
        ++n;
      }
    }
    this.log(this.clock, "declined", -1, t.shipper, reason);
    this.trips.splice(i, 1);
    return n;
  }
  deliver(orderId, orders, at) {
    const o = orders.find((x) => x.id === orderId);
    if (!o || o.status !== ASSIGNED)
      return false;
    o.status = DELIVERED;
    o.deliveredAt = at;
    this.setStandby(o.shipper, o.destination);
    this.log(at, "delivered", o.id, o.shipper, o.deadline >= 0 && at > o.deadline + 0.000000001 ? `trễ ${clockText(at - o.deadline)}` : "");
    return true;
  }
  advance(t) {
    this.clock = Math.max(this.clock, t);
  }
  findTripMutable(id) {
    return this.findTrip(id);
  }
  // Nơi shipper đang đứng khi rảnh (-1 = chưa biết): đơn cuối cùng giao / báo thất bại ở đâu thì shipper đứng ở đó
  standbyOf(shipper) {
    const v = this.standby.get(shipper);
    return v === undefined ? -1 : v;
  }
  setStandby(shipper, node) {
    if (shipper >= 0)
      this.standby.set(shipper, node);
  }
  // Shipper còn đơn chưa xong (Đã phân công / Đang giao) hoặc đang chờ trả lời lời mời?
  busy(shipper, orders) {
    for (const t of this.trips) {
      if (t.shipper !== shipper)
        continue;
      for (const s of t.stops)
        for (const o of orders)
          if (o.id === s.orderId && (o.status === ASSIGNED || o.status === DISPATCHED))
            return true;
    }
    return false;
  }
  // Nút cuối cùng chuyến đã đi qua tại giờ ca hiện tại (đoạn tới kho rồi lộ trình giao)
  nodeReached(t) {
    let node = t.fromNode;
    for (let i = 0;i < t.approach.length && i < t.approachTimes.length; i++)
      if (t.approachTimes[i] <= this.clock + 0.000000001)
        node = t.approach[i];
    for (let i = 0;i < t.path.length && i < t.pathTimes.length; i++)
      if (t.pathTimes[i] <= this.clock + 0.000000001)
        node = t.path[i];
    return node;
  }
  dropEmptyAutoTrips() {
    const before = this.trips.length;
    this.trips = this.trips.filter((t) => !(t.fromNode >= 0 && !t.stops.length));
    return before - this.trips.length;
  }
  // Shipper nhả đơn đã nhận nhưng chưa lấy hàng: đơn về Chờ giao, bỏ khỏi chuyến, shipper đứng ở chỗ đã chạy tới
  release(id, orders) {
    const o = orders.find((x) => x.id === id);
    if (!o || o.status !== ASSIGNED)
      return false;
    const t = this.tripOfOrder(id);
    if (t && t.fromNode >= 0)
      this.setStandby(o.shipper, this.nodeReached(t));
    const ship = o.shipper;
    Object.assign(o, { status: PENDING, shipper: -1, eta: -1, deliveredAt: -1 });
    this._dropStop(id);
    this.log(this.clock, "released", id, ship, "");
    return true;
  }
}
function resumeIndex(t, clock) {
  for (let i = 0;i < t.pathTimes.length; i++)
    if (t.pathTimes[i] > clock + 0.000000001)
      return i;
  return -1;
}

class UndoRedo {
  constructor(cap = 30) {
    this.cap = cap;
    this.undoS = [];
    this.redoS = [];
  }
  record(before, label) {
    this.undoS.push({ state: before, label });
    if (this.undoS.length > this.cap)
      this.undoS.shift();
    this.redoS = [];
  }
  undo(current) {
    const e = this.undoS.pop();
    if (!e)
      return null;
    this.redoS.push({ state: current, label: e.label });
    return e;
  }
  redo(current) {
    const e = this.redoS.pop();
    if (!e)
      return null;
    this.undoS.push({ state: current, label: e.label });
    return e;
  }
  canUndo() {
    return this.undoS.length > 0;
  }
  canRedo() {
    return this.redoS.length > 0;
  }
  undoLabel() {
    return this.undoS.length ? this.undoS[this.undoS.length - 1].label : "";
  }
  redoLabel() {
    return this.redoS.length ? this.redoS[this.redoS.length - 1].label : "";
  }
  clear() {
    this.undoS = [];
    this.redoS = [];
  }
}
function normalizeVi(s) {
  return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐ]/g, "d").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
var splitWords = (s) => s ? s.split(" ") : [];

class Trie {
  constructor() {
    this.clear();
  }
  clear() {
    this.nodes = [{ next: new Map, ids: [] }];
  }
  insert(word, id) {
    let cur = 0;
    for (const c of word) {
      let nx = this.nodes[cur].next.get(c);
      if (nx === undefined) {
        nx = this.nodes.length;
        this.nodes[cur].next.set(c, nx);
        this.nodes.push({ next: new Map, ids: [] });
      }
      cur = nx;
    }
    const ids = this.nodes[cur].ids;
    if (!ids.includes(id))
      ids.push(id);
  }
  withPrefix(prefix, limit = 1000) {
    let cur = 0;
    for (const c of prefix) {
      const nx = this.nodes[cur].next.get(c);
      if (nx === undefined)
        return [];
      cur = nx;
    }
    const result = [], seen = new Set, stack = [cur];
    while (stack.length && result.length < limit) {
      const u = stack.pop();
      for (const id of this.nodes[u].ids)
        if (!seen.has(id)) {
          seen.add(id);
          result.push(id);
        }
      const kids = [...this.nodes[u].next.entries()].sort((a, b) => a[0] < b[0] ? 1 : -1);
      for (const [, idx] of kids)
        stack.push(idx);
    }
    return result;
  }
  nodeCount() {
    return this.nodes.length;
  }
}

class PlaceIndex {
  constructor() {
    this.trie = new Trie;
    this.words = new Map;
  }
  build(g) {
    this.trie.clear();
    this.words.clear();
    for (const id of g.nodeIds()) {
      const w = splitWords(normalizeVi(g.getNode(id).name));
      for (const x of w)
        this.trie.insert(x, id);
      this.trie.insert(String(id), id);
      this.words.set(id, w);
    }
  }
  search(query, limit = 8) {
    const q = splitWords(normalizeVi(query));
    if (!q.length)
      return [];
    const hits = [];
    for (const id of this.trie.withPrefix(q[0], 1e5)) {
      const w = this.words.get(id);
      if (!w)
        continue;
      const idMatch = q.length === 1 && String(id) === q[0];
      const ok = q.every((part) => w.some((x) => x.startsWith(part)));
      if (!ok && !idMatch)
        continue;
      const rank = idMatch ? 0 : w.length && w[0].startsWith(q[0]) ? 1 : 2;
      hits.push({ id, rank, len: w.reduce((s, x) => s + x.length, 0) });
    }
    hits.sort((a, b) => a.rank - b.rank || a.len - b.len || a.id - b.id);
    return hits.slice(0, limit).map((h) => h.id);
  }
}

// Chỉ mục tìm kiếm không dấu cho văn bản bất kỳ (src/Trie.h: TextIndex): mọi từ truy vấn phải là tiền tố của một từ
class TextIndex {
  constructor() {
    this.trie = new Trie;
    this.words = new Map;
  }
  clear() {
    this.trie.clear();
    this.words.clear();
  }
  add(id, text) {
    const w = splitWords(normalizeVi(text));
    for (const x of w)
      this.trie.insert(x, id);
    if (!this.words.has(id))
      this.words.set(id, []);
    this.words.get(id).push(...w);
  }
  search(query, limit = 1e5) {
    const q = splitWords(normalizeVi(query));
    if (!q.length)
      return [];
    const out = [];
    for (const id of this.trie.withPrefix(q[0], 1e6)) {
      const w = this.words.get(id);
      if (w && q.every((part) => w.some((x) => x.startsWith(part))))
        out.push(id);
    }
    out.sort((a, b) => a - b);
    return out.slice(0, limit);
  }
  size() {
    return this.words.size;
  }
}
