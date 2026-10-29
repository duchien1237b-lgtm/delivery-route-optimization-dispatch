var INF3 = Infinity;
var MAX_SNAPSHOT = 63;
function mk(t, line, u = -1, v = -1, value = 0, extra = 0) {
  return { type: t, line, u, v, value, extra, container: [], size: 0 };
}
function clip(arr, s) {
  s.size = arr.length;
  s.container = arr.length > MAX_SNAPSHOT ? arr.slice(0, MAX_SNAPSHOT) : arr;
  return s;
}
function heapSearch(g, astar, src, dst, crit, veh, res, rec) {
  const ids = g.nodeIds();
  const n = ids.length;
  const idx = new Map(ids.map((id, i) => [id, i]));
  const h = new Array(n).fill(0);
  if (astar && g.hasNode(dst)) {
    let alpha = INF3;
    outer:
      for (let i = 0;i < n; i++)
        for (const e of g.neighbors(ids[i])) {
          if (!vehicleAllowed(e, veh))
            continue;
          const w = edgeWeight(e, crit, veh);
          if (w < 0) {
            alpha = 0;
            break outer;
          }
          const km = straightLineKm(g.getNode(ids[i]), g.getNode(e.to));
          if (km > 0.000000001)
            alpha = Math.min(alpha, w / km);
        }
    if (alpha === INF3)
      alpha = 0;
    res.heuristicScale = alpha;
    for (let i = 0;i < n; i++)
      h[i] = alpha * straightLineKm(g.getNode(ids[i]), g.getNode(dst));
  }
  const dist = new Array(n).fill(INF3);
  const prev = new Array(n).fill(-1);
  const done = new Uint8Array(n);
  const heap = new IndexedMinHeap(n);
  const snap = (s) => {
    if (rec.full()) {
      rec.add(s);
      return;
    }
    rec.add(clip(heap.snapshot().map(([i, k]) => [ids[i], k]), s));
  };
  const s = idx.get(src);
  const t = g.hasNode(dst) ? idx.get(dst) : -1;
  dist[s] = 0;
  heap.pushOrDecrease(s, h[s]);
  snap(mk("init", 0, src, -1, 0, h[s]));
  while (!heap.empty()) {
    const [u, key] = heap.popMin();
    done[u] = 1;
    snap(mk("pop", 2, ids[u], -1, dist[u], key));
    if (u === t) {
      snap(mk("found", 3, ids[u], -1, dist[u]));
      break;
    }
    for (const e of g.neighbors(ids[u])) {
      if (!vehicleAllowed(e, veh))
        continue;
      const v = idx.get(e.to);
      if (done[v])
        continue;
      const nd = dist[u] + edgeWeight(e, crit, veh);
      if (nd < dist[v]) {
        dist[v] = nd;
        prev[v] = u;
        heap.pushOrDecrease(v, nd + h[v]);
        snap(mk("relax", 6, ids[u], e.to, nd, h[v]));
      } else
        snap(mk("skip", 5, ids[u], e.to, nd, dist[v]));
    }
  }
  snap(mk("done", 1));
  for (let i = 0;i < n; i++) {
    res.dist.set(ids[i], dist[i]);
    res.prev.set(ids[i], prev[i] < 0 ? -1 : ids[prev[i]]);
  }
}
function bfs2(g, src, res, rec) {
  const visited = new Set([src]);
  const q = [src];
  for (const id of g.nodeIds()) {
    res.dist.set(id, INF3);
    res.prev.set(id, -1);
  }
  res.dist.set(src, 0);
  const snap = (s) => rec.add(clip(q.map((x) => [x, res.dist.get(x)]), s));
  snap(mk("init", 0, src));
  while (q.length) {
    const u = q.shift();
    snap(mk("pop", 2, u, -1, res.dist.get(u)));
    for (const e of g.neighbors(u)) {
      if (!visited.has(e.to)) {
        visited.add(e.to);
        res.dist.set(e.to, res.dist.get(u) + 1);
        res.prev.set(e.to, u);
        q.push(e.to);
        snap(mk("relax", 4, u, e.to, res.dist.get(e.to)));
      } else
        snap(mk("skip", 3, u, e.to, res.dist.get(u) + 1, res.dist.get(e.to)));
    }
  }
  snap(mk("done", 1));
}
function dfs2(g, src, res, rec) {
  const visited = new Set;
  const st = [[src, -1]];
  for (const id of g.nodeIds()) {
    res.dist.set(id, INF3);
    res.prev.set(id, -1);
  }
  let order = 0;
  const snap = (s) => rec.add(clip(st.slice().reverse().map(([x]) => [x, 0]), s));
  snap(mk("init", 0, src));
  while (st.length) {
    const [u, from] = st.pop();
    if (visited.has(u)) {
      snap(mk("skip", 3, from, u));
      continue;
    }
    visited.add(u);
    res.dist.set(u, order++);
    res.prev.set(u, from);
    snap(mk("pop", 4, u, from, res.dist.get(u)));
    const nb = g.neighbors(u);
    for (let i = nb.length - 1;i >= 0; i--)
      if (!visited.has(nb[i].to)) {
        st.push([nb[i].to, u]);
        snap(mk("relax", 5, u, nb[i].to));
      }
  }
  snap(mk("done", 1));
}
function bellman(g, src, crit, veh, res, rec) {
  const edges = [];
  for (const u of g.nodeIds())
    for (const e of g.neighbors(u))
      if (vehicleAllowed(e, veh))
        edges.push([u, e.to, edgeWeight(e, crit, veh)]);
  for (const id of g.nodeIds()) {
    res.dist.set(id, INF3);
    res.prev.set(id, -1);
  }
  res.dist.set(src, 0);
  rec.add(mk("init", 0, src));
  const n = g.nodeCount();
  for (let round = 1;round <= n - 1; round++) {
    rec.add(mk("round", 1, -1, -1, 0, round));
    let changed = false;
    for (const [u, v, w] of edges) {
      if (res.dist.get(u) === INF3)
        continue;
      const nd = res.dist.get(u) + w;
      if (nd < res.dist.get(v)) {
        res.dist.set(v, nd);
        res.prev.set(v, u);
        changed = true;
        rec.add(mk("relax", 4, u, v, nd, round));
      }
    }
    if (!changed) {
      rec.add(mk("stable", 5, -1, -1, 0, round));
      break;
    }
  }
  for (const [u, v, w] of edges) {
    if (res.dist.get(u) === INF3)
      continue;
    if (res.dist.get(u) + w < res.dist.get(v) - 0.000000001) {
      rec.add(mk("cycle", 6, u, v, res.dist.get(u) + w));
      res.prev.set(v, u);
      let x = v;
      for (let i = 0;i < n; i++)
        x = res.prev.get(x) ?? -1;
      let cur = x;
      do {
        res.cycle.push(cur);
        cur = res.prev.get(cur) ?? -1;
      } while (cur !== x && cur !== -1);
      res.cycle.push(x);
      res.cycle.reverse();
      break;
    }
  }
  rec.add(mk("done", 6));
}
function runTrace(g, algo, src, dst, crit, veh, maxSteps = 4000) {
  const res = { algo, containerKind: "", pseudo: [], steps: [], truncated: false, dist: new Map, prev: new Map, cycle: [], heuristicScale: 0 };
  const rec = {
    add(s) {
      if (res.steps.length >= maxSteps) {
        res.truncated = true;
        return;
      }
      res.steps.push(s);
    },
    full() {
      return res.steps.length >= maxSteps;
    }
  };
  if (!g.hasNode(src))
    return res;
  if (algo === "bfs") {
    res.containerKind = "queue";
    res.pseudo = [
      "visited[s] ← đúng; queue.push(s)",
      "while queue chưa rỗng:",
      "    u ← queue.pop()",
      "    for mỗi v kề u:  nếu đã thăm v thì bỏ qua",
      "        visited[v] ← đúng; prev[v] ← u",
      "        queue.push(v)"
    ];
    bfs2(g, src, res, rec);
  } else if (algo === "dfs") {
    res.containerKind = "stack";
    res.pseudo = [
      "stack.push(s)",
      "while stack chưa rỗng:",
      "    u ← stack.pop()",
      "    if đã thăm u: bỏ qua",
      "    thăm u",
      "    for v kề u (đảo thứ tự): if chưa thăm v: stack.push(v)"
    ];
    dfs2(g, src, res, rec);
  } else if (algo === "bellman") {
    res.containerKind = "none";
    res.pseudo = [
      "dist[s] ← 0, mọi đỉnh khác ← ∞",
      "for vòng ← 1 .. V−1:",
      "    for mỗi cạnh (u, v, w):",
      "        if dist[u] + w < dist[v]:",
      "            dist[v] ← dist[u] + w; prev[v] ← u",
      "    if vòng này không đổi gì: dừng sớm",
      "for mỗi cạnh: nếu còn nới được → có chu trình âm"
    ];
    bellman(g, src, crit, veh, res, rec);
  } else {
    const a = algo === "astar";
    res.algo = a ? "astar" : "dijkstra";
    res.containerKind = "heap";
    res.pseudo = [
      a ? "dist[s] ← 0; heap.push(s, h(s))" : "dist[s] ← 0; heap.push(s, 0)",
      "while heap chưa rỗng:",
      a ? "    u ← heap.popMin()   // f = dist + h nhỏ nhất" : "    u ← heap.popMin()   // chốt dist[u]",
      "    if u = đích: dừng",
      "    for mỗi cạnh (u, v, w), v chưa chốt:",
      "        if dist[u] + w ≥ dist[v]: bỏ qua",
      "        dist[v] ← dist[u] + w; prev[v] ← u",
      a ? "        heap.pushOrDecrease(v, dist[v] + h(v))" : "        heap.pushOrDecrease(v, dist[v])"
    ];
    heapSearch(g, a, src, dst, crit, veh, res, rec);
  }
  return res;
}
