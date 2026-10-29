var timeDependent = (opt) => opt.criterion === TIME && opt.rush && opt.rush.enabled && opt.departAt >= 0;
var weigher = (opt) => {
  if (!timeDependent(opt))
    return (a) => a[1];
  return (a, du) => travelMinutesAt(a[2], opt.vehicle, opt.departAt + du, opt.rush);
};
var INF = Infinity;
var ARRAY = 0;
var STL_PQ = 1;
var MIN_HEAP = 2;
function versionName(v) {
  return ["Dijkstra mảng O(V²)", "Dijkstra hàng đợi ưu tiên", "Dijkstra Min-Heap tự cài"][v];
}
var now = () => typeof performance !== "undefined" ? performance.now() : Date.now();
function compact(g, opt) {
  const ids = g.nodeIds();
  const n = ids.length;
  const index = new Map;
  ids.forEach((id, i) => index.set(id, i));
  const adj = new Array(n);
  let negative = false;
  const { bannedNodes: bN, bannedEdges: bE } = opt;
  for (let i = 0;i < n; i++) {
    adj[i] = [];
    if (bN && bN.has(ids[i]))
      continue;
    for (const e of g.neighbors(ids[i])) {
      if (!vehicleAllowed(e, opt.vehicle))
        continue;
      if (bN && bN.has(e.to))
        continue;
      if (bE && bE.has(ids[i] + "," + e.to))
        continue;
      const w = edgeWeight(e, opt.criterion, opt.vehicle);
      if (w < 0)
        negative = true;
      adj[i].push([index.get(e.to), w, e]);
    }
  }
  return { ids, index, adj, negative };
}
function runArray(c, W, s, t, dist, prev, order, st) {
  const n = c.ids.length;
  const done = new Uint8Array(n);
  dist[s] = 0;
  for (let step = 0;step < n; step++) {
    let u = -1;
    for (let i = 0;i < n; i++) {
      st.ops++;
      if (!done[i] && dist[i] < INF && (u === -1 || dist[i] < dist[u]))
        u = i;
    }
    if (u === -1)
      break;
    done[u] = 1;
    order.push(u);
    if (u === t)
      break;
    for (const a of c.adj[u]) {
      const v = a[0], w = W(a, dist[u]);
      if (!done[v] && dist[u] + w < dist[v]) {
        dist[v] = dist[u] + w;
        prev[v] = u;
        st.relax++;
      }
    }
  }
}
function runStl(c, W, s, t, dist, prev, order, st) {
  const pq = new MinHeap((a, b) => a[0] < b[0] || a[0] === b[0] && a[1] < b[1]);
  const done = new Uint8Array(c.ids.length);
  dist[s] = 0;
  pq.push([0, s]);
  st.ops++;
  while (!pq.empty()) {
    const [d, u] = pq.pop();
    st.ops++;
    if (done[u] || d > dist[u])
      continue;
    done[u] = 1;
    order.push(u);
    if (u === t)
      break;
    for (const a of c.adj[u]) {
      const v = a[0], w = W(a, d);
      if (!done[v] && d + w < dist[v]) {
        dist[v] = d + w;
        prev[v] = u;
        pq.push([dist[v], v]);
        st.relax++;
        st.ops++;
      }
    }
  }
}
function runHeap(c, W, s, t, dist, prev, order, st) {
  const heap = new IndexedMinHeap(c.ids.length);
  const done = new Uint8Array(c.ids.length);
  dist[s] = 0;
  heap.pushOrDecrease(s, 0);
  st.ops++;
  while (!heap.empty()) {
    const [u, d] = heap.popMin();
    st.ops++;
    done[u] = 1;
    order.push(u);
    if (u === t)
      break;
    for (const a of c.adj[u]) {
      const v = a[0], w = W(a, d);
      if (!done[v] && d + w < dist[v]) {
        dist[v] = d + w;
        prev[v] = u;
        heap.pushOrDecrease(v, dist[v]);
        st.relax++;
        st.ops++;
      }
    }
  }
}
function dijkstra(g, source, version, opt = {}) {
  opt = { criterion: DISTANCE, vehicle: ANY_VEHICLE, target: -1, departAt: -1, rush: null, ...opt };
  const tree = { source, dist: new Map, prev: new Map, settleOrder: [], relaxations: 0, heapOps: 0, micros: 0, negativeEdge: false, valid: false, heuristicScale: 0 };
  const c = compact(g, opt);
  tree.negativeEdge = c.negative;
  const n = c.ids.length;
  for (const id of c.ids) {
    tree.dist.set(id, INF);
    tree.prev.set(id, -1);
  }
  if (!g.hasNode(source))
    return tree;
  tree.valid = true;
  const s = c.index.get(source);
  const t = opt.target >= 0 && c.index.has(opt.target) ? c.index.get(opt.target) : -1;
  const dist = new Float64Array(n).fill(INF);
  const prev = new Int32Array(n).fill(-1);
  const order = [];
  const st = { relax: 0, ops: 0 };
  const W = weigher(opt);
  const start = now();
  if (version === ARRAY)
    runArray(c, W, s, t, dist, prev, order, st);
  else if (version === STL_PQ)
    runStl(c, W, s, t, dist, prev, order, st);
  else
    runHeap(c, W, s, t, dist, prev, order, st);
  tree.micros = (now() - start) * 1000;
  tree.relaxations = st.relax;
  tree.heapOps = st.ops;
  for (let i = 0;i < n; i++) {
    tree.dist.set(c.ids[i], dist[i]);
    tree.prev.set(c.ids[i], prev[i] < 0 ? -1 : c.ids[prev[i]]);
  }
  for (const i of order)
    tree.settleOrder.push(c.ids[i]);
  return tree;
}
function straightLineKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.x - a.x) * rad, dLon = (b.y - a.y) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.x * rad) * Math.cos(b.x * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
function astar(g, source, target, opt = {}) {
  opt = { criterion: DISTANCE, vehicle: ANY_VEHICLE, departAt: -1, rush: null, ...opt };
  const tree = { source, dist: new Map, prev: new Map, settleOrder: [], relaxations: 0, heapOps: 0, micros: 0, negativeEdge: false, valid: false, heuristicScale: 0 };
  const c = compact(g, opt);
  tree.negativeEdge = c.negative;
  const n = c.ids.length;
  for (const id of c.ids) {
    tree.dist.set(id, INF);
    tree.prev.set(id, -1);
  }
  if (!g.hasNode(source) || !g.hasNode(target))
    return tree;
  tree.valid = true;
  const node = c.ids.map((id) => g.getNode(id));
  let alpha = INF;
  outer:
    for (let i = 0;i < n; i++)
      for (const a of c.adj[i]) {
        if (a[1] < 0) {
          alpha = 0;
          break outer;
        }
        const km = straightLineKm(node[i], node[a[0]]);
        if (km > 0.000000001)
          alpha = Math.min(alpha, a[1] / km);
      }
  if (alpha === INF)
    alpha = 0;
  tree.heuristicScale = alpha;
  const s = c.index.get(source), t = c.index.get(target);
  const h = node.map((nd) => alpha * straightLineKm(nd, node[t]));
  const dist = new Float64Array(n).fill(INF);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const W = weigher(opt);
  const start = now();
  const heap = new IndexedMinHeap(n);
  dist[s] = 0;
  heap.pushOrDecrease(s, h[s]);
  tree.heapOps++;
  while (!heap.empty()) {
    const [u] = heap.popMin();
    tree.heapOps++;
    done[u] = 1;
    tree.settleOrder.push(c.ids[u]);
    if (u === t)
      break;
    for (const a of c.adj[u]) {
      const v = a[0];
      const nd = dist[u] + W(a, dist[u]);
      if (!done[v] && nd < dist[v]) {
        dist[v] = nd;
        prev[v] = u;
        heap.pushOrDecrease(v, nd + h[v]);
        tree.relaxations++;
        tree.heapOps++;
      }
    }
  }
  tree.micros = (now() - start) * 1000;
  for (let i = 0;i < n; i++) {
    tree.dist.set(c.ids[i], dist[i]);
    tree.prev.set(c.ids[i], prev[i] < 0 ? -1 : c.ids[prev[i]]);
  }
  return tree;
}
function getPath(t, dst) {
  if (!t.valid || !t.dist.has(dst) || t.dist.get(dst) === INF)
    return [];
  const path = [];
  for (let v = dst;v !== -1; v = t.prev.get(v)) {
    path.push(v);
    if (path.length > t.dist.size)
      return [];
  }
  path.reverse();
  return path[0] === t.source ? path : [];
}
function describePath(g, path, vehicle, departAt = -1, rush = null) {
  const r = departAt >= 0 ? rush : null;
  const info = { found: false, nodes: [], km: 0, minutes: 0, minutesBase: 0, costK: 0, hops: 0 };
  if (!path.length)
    return info;
  info.nodes = path;
  info.found = true;
  for (let i = 0;i + 1 < path.length; i++) {
    const e = g.getEdge(path[i], path[i + 1]);
    if (!e) {
      info.found = false;
      return info;
    }
    info.km += e.distance;
    info.minutes += travelMinutesAt(e, vehicle, departAt + info.minutes, r);
    info.minutesBase += travelMinutes(e, vehicle);
    info.costK += edgeCostK(e);
  }
  info.hops = path.length - 1;
  return info;
}
function pathWeight(g, p, opt, upto = Infinity) {
  let w = 0;
  const td = timeDependent(opt);
  for (let i = 0;i + 1 < p.length && i < upto; i++) {
    const e = g.getEdge(p[i], p[i + 1]);
    if (!e)
      return INF;
    w += td ? travelMinutesAt(e, opt.vehicle, opt.departAt + w, opt.rush) : edgeWeight(e, opt.criterion, opt.vehicle);
  }
  return w;
}
function kShortestPaths(g, src, dst, K, base = {}) {
  const A = [];
  if (K < 1 || !g.hasNode(src) || !g.hasNode(dst))
    return A;
  const opt = { criterion: DISTANCE, vehicle: ANY_VEHICLE, departAt: -1, rush: null, ...base, target: dst, bannedEdges: null, bannedNodes: null };
  const first = getPath(dijkstra(g, src, MIN_HEAP, opt), dst);
  if (!first.length)
    return A;
  A.push({ nodes: first, weight: pathWeight(g, first, opt) });
  const B = new MinHeap((a, b) => a.weight !== b.weight ? a.weight < b.weight : a.nodes.length < b.nodes.length);
  const seen = new Set([first.join(",")]);
  for (let k = 1;k < K; k++) {
    const prev = A[A.length - 1].nodes;
    for (let i = 0;i + 1 < prev.length; i++) {
      const spur = prev[i];
      const root = prev.slice(0, i + 1);
      const bannedE = new Set;
      for (const p of A)
        if (p.nodes.length > i + 1 && root.every((x, j) => p.nodes[j] === x))
          bannedE.add(p.nodes[i] + "," + p.nodes[i + 1]);
      const bannedN = new Set(root.slice(0, -1));
      const o = { ...opt, bannedEdges: bannedE, bannedNodes: bannedN };
      if (timeDependent(opt))
        o.departAt = opt.departAt + pathWeight(g, prev, opt, i);
      const spurPath = getPath(dijkstra(g, spur, MIN_HEAP, o), dst);
      if (!spurPath.length)
        continue;
      const total = root.concat(spurPath.slice(1));
      const key = total.join(",");
      if (!seen.has(key)) {
        seen.add(key);
        B.push({ nodes: total, weight: pathWeight(g, total, opt) });
      }
    }
    if (B.empty())
      break;
    A.push(B.pop());
  }
  return A;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function randomGraph(n, avgDegree, seed) {
  const rnd = mulberry32(seed);
  const g = new Graph(false);
  const p = [];
  for (let i = 0;i < n; i++) {
    p.push([rnd() * 100, rnd() * 100]);
    g.addNode(i, "N" + i, p[i][0], p[i][1]);
  }
  const d = (a, b) => Math.hypot(p[a][0] - p[b][0], p[a][1] - p[b][1]);
  const has = new Set;
  let edges = 0;
  const add = (a, b) => {
    const k = a < b ? a * n + b : b * n + a;
    if (a === b || has.has(k))
      return;
    has.add(k);
    const w = d(a, b);
    g.adj.get(a).push({ to: b, distance: w, time: w, cost: 0, allowed: 7, jam: 1, closed: false });
    g.adj.get(b).push({ to: a, distance: w, time: w, cost: 0, allowed: 7, jam: 1, closed: false });
    edges++;
  };
  for (let i = 1;i < n; i++)
    add(i, Math.floor(rnd() * i));
  const target = Math.floor(avgDegree * n / 2);
  for (let tries = 0;edges < target && tries < target * 10; tries++)
    add(Math.floor(rnd() * n), Math.floor(rnd() * n));
  return g;
}
function benchmark(sizes, avgDegree, repeats, seed = 2024) {
  const rows = [];
  if (repeats < 1)
    repeats = 1;
  for (const n of sizes) {
    if (n < 2)
      continue;
    const g = randomGraph(n, avgDegree, seed + n);
    const row = { nodes: n, edges: g.edgeCount(), microsArray: 0, microsStl: 0, microsHeap: 0, opsArray: 0, opsStl: 0, opsHeap: 0, agree: true };
    dijkstra(g, 0, MIN_HEAP);
    dijkstra(g, 0, STL_PQ);
    let ta, ts, th;
    for (let r = 0;r < repeats; r++) {
      ta = dijkstra(g, 0, ARRAY);
      ts = dijkstra(g, 0, STL_PQ);
      th = dijkstra(g, 0, MIN_HEAP);
      row.microsArray += ta.micros;
      row.microsStl += ts.micros;
      row.microsHeap += th.micros;
    }
    row.microsArray /= repeats;
    row.microsStl /= repeats;
    row.microsHeap /= repeats;
    row.opsArray = ta.heapOps;
    row.opsStl = ts.heapOps;
    row.opsHeap = th.heapOps;
    for (const [id, dv] of ta.dist)
      if (Math.abs(dv - ts.dist.get(id)) > 0.000001 || Math.abs(dv - th.dist.get(id)) > 0.000001)
        row.agree = false;
    rows.push(row);
  }
  return rows;
}
var VO_CUC = 1000000000000000000;
function chuanBi(g, tieuChi, xe) {
  const ids = g.nodeIds();
  const chiSo = new Map(ids.map((id, i) => [id, i]));
  const canh = [];
  ids.forEach((id, i) => {
    for (const e of g.neighbors(id))
      if (vehicleAllowed(e, xe))
        canh.push([i, chiSo.get(e.to), edgeWeight(e, tieuChi, xe), e]);
  });
  return { ids, chiSo, canh };
}
function layChuTrinh(x, truoc, soDinh) {
  for (let i = 0;i < soDinh; i++)
    x = truoc[x];
  const ct = [];
  let h = x;
  do {
    ct.push(h);
    h = truoc[h];
  } while (h !== x && h !== -1);
  ct.push(x);
  return ct.reverse();
}
function bellmanFord(g, nguon, tieuChi = 2, xe = ANY_VEHICLE, gioDi = -1, caoDiem = null) {
  const theoGio = tieuChi === TIME && caoDiem && caoDiem.enabled && gioDi >= 0;
  const trongSo = (c, daDi) => theoGio ? travelMinutesAt(c[3], xe, gioDi + daDi, caoDiem) : c[2];
  const t0 = now();
  const kq = { hopLe: false, khoangCach: new Map, truoc: new Map, coChuTrinhAm: false, chuTrinhAm: [], soVongLap: 0, soLanNoiLong: 0, micros: 0 };
  const d = chuanBi(g, tieuChi, xe);
  const n = d.ids.length;
  for (const id of d.ids) {
    kq.khoangCach.set(id, VO_CUC);
    kq.truoc.set(id, -1);
  }
  if (!g.hasNode(nguon))
    return kq;
  kq.hopLe = true;
  const kc = new Array(n).fill(VO_CUC);
  const truoc = new Array(n).fill(-1);
  kc[d.chiSo.get(nguon)] = 0;
  for (let vong = 1;vong <= n - 1; vong++) {
    let doi = false;
    kq.soVongLap = vong;
    for (const c of d.canh) {
      const [u, v] = c;
      if (kc[u] === VO_CUC)
        continue;
      const nd = kc[u] + trongSo(c, kc[u]);
      if (nd < kc[v]) {
        kc[v] = nd;
        truoc[v] = u;
        doi = true;
        kq.soLanNoiLong++;
      }
    }
    if (!doi)
      break;
  }
  for (const c of d.canh) {
    const [u, v] = c;
    if (kc[u] === VO_CUC)
      continue;
    if (kc[u] + trongSo(c, kc[u]) < kc[v] - 0.000000001) {
      kq.coChuTrinhAm = true;
      truoc[v] = u;
      for (const i of layChuTrinh(v, truoc, n))
        kq.chuTrinhAm.push(d.ids[i]);
      break;
    }
  }
  for (let i = 0;i < n; i++) {
    kq.khoangCach.set(d.ids[i], kc[i]);
    kq.truoc.set(d.ids[i], truoc[i] < 0 ? -1 : d.ids[truoc[i]]);
  }
  kq.micros = (now() - t0) * 1000;
  return kq;
}
function bfGetPath(kq, nguon, dich) {
  if (!kq.hopLe || kq.coChuTrinhAm || !kq.khoangCach.has(dich) || kq.khoangCach.get(dich) >= VO_CUC)
    return [];
  const p = [];
  for (let v = dich;v !== -1; v = kq.truoc.get(v)) {
    p.push(v);
    if (p.length > kq.khoangCach.size)
      return [];
  }
  p.reverse();
  return p[0] === nguon ? p : [];
}
function findNegativeCycle(g, tieuChi = 2, xe = ANY_VEHICLE) {
  const d = chuanBi(g, tieuChi, xe);
  const n = d.ids.length;
  const kc = new Array(n).fill(0);
  const truoc = new Array(n).fill(-1);
  let x = -1;
  for (let vong = 0;vong < n; vong++) {
    x = -1;
    for (const [u, v, w] of d.canh) {
      if (kc[u] + w < kc[v] - 0.000000001) {
        kc[v] = kc[u] + w;
        truoc[v] = u;
        x = v;
      }
    }
  }
  if (x === -1)
    return [];
  return layChuTrinh(x, truoc, n).map((i) => d.ids[i]);
}
