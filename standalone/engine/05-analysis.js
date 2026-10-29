var INF2 = Infinity;
var FLOYD_MAX = 400;
var now3 = () => performance.now();
function undirected(g) {
  const ids = g.nodeIds();
  const index = new Map(ids.map((id, i) => [id, i]));
  const edges = [], seen = new Map;
  for (const u of ids)
    for (const e of g.neighbors(u)) {
      const a = index.get(u), b = index.get(e.to);
      if (a === b)
        continue;
      const lo = Math.min(a, b), hi = Math.max(a, b), key = lo * 1e6 + hi;
      if (seen.has(key)) {
        const k = seen.get(key);
        edges[k].km = Math.min(edges[k].km, e.distance);
        continue;
      }
      seen.set(key, edges.length);
      edges.push({ u: lo, v: hi, km: e.distance });
    }
  const adj = ids.map(() => []);
  edges.forEach((e, k) => {
    adj[e.u].push([e.v, k]);
    adj[e.v].push([e.u, k]);
  });
  return { ids, index, edges, adj };
}
var byImpact = (a, b) => a.cutOrders !== b.cutOrders ? b.cutOrders - a.cutOrders : b.cutNodes - a.cutNodes;
function criticalRoads(g, root, destinations) {
  const t0 = now3();
  const U = undirected(g);
  const n = U.ids.length;
  const disc = new Int32Array(n).fill(-1), low = new Int32Array(n), parentEdge = new Int32Array(n).fill(-1), parent = new Int32Array(n).fill(-1);
  const subNodes = new Int32Array(n).fill(1), subOrders = new Int32Array(n), childCount = new Int32Array(n);
  for (const d of destinations)
    if (U.index.has(d))
      subOrders[U.index.get(d)]++;
  const cutChildren = U.ids.map(() => []);
  const rep = { bridges: [], articulation: [], root, micros: 0 };
  let timer = 0;
  const runFrom = (s) => {
    const st = [[s, 0]];
    disc[s] = low[s] = timer++;
    while (st.length) {
      const top = st[st.length - 1];
      const u = top[0];
      if (top[1] < U.adj[u].length) {
        const [w, eid] = U.adj[u][top[1]++];
        if (eid === parentEdge[u])
          continue;
        if (disc[w] === -1) {
          parent[w] = u;
          parentEdge[w] = eid;
          childCount[u]++;
          disc[w] = low[w] = timer++;
          st.push([w, 0]);
        } else
          low[u] = Math.min(low[u], disc[w]);
        continue;
      }
      st.pop();
      const p = parent[u];
      if (p < 0)
        continue;
      low[p] = Math.min(low[p], low[u]);
      subNodes[p] += subNodes[u];
      subOrders[p] += subOrders[u];
      if (low[u] > disc[p]) {
        const e = U.edges[parentEdge[u]];
        rep.bridges.push({ u: U.ids[p], v: U.ids[u], km: e.km, cutNodes: subNodes[u], cutOrders: subOrders[u] });
      }
      if (low[u] >= disc[p])
        cutChildren[p].push(u);
    }
  };
  const roots = [];
  if (U.index.has(root)) {
    roots.push(U.index.get(root));
    runFrom(U.index.get(root));
  }
  for (let i = 0;i < n; i++)
    if (disc[i] === -1) {
      roots.push(i);
      runFrom(i);
    }
  const rootSet = new Set(roots);
  for (let u = 0;u < n; u++) {
    if (rootSet.has(u)) {
      if (childCount[u] < 2)
        continue;
      const kids = [];
      for (let c = 0;c < n; c++)
        if (parent[c] === u)
          kids.push(c);
      let biggest = kids[0];
      for (const c of kids)
        if (subNodes[biggest] < subNodes[c])
          biggest = c;
      const a = { node: U.ids[u], parts: kids.length, cutNodes: 0, cutOrders: 0 };
      for (const c of kids)
        if (c !== biggest) {
          a.cutNodes += subNodes[c];
          a.cutOrders += subOrders[c];
        }
      rep.articulation.push(a);
    } else if (cutChildren[u].length) {
      const a = { node: U.ids[u], parts: cutChildren[u].length + 1, cutNodes: 0, cutOrders: 0 };
      for (const c of cutChildren[u]) {
        a.cutNodes += subNodes[c];
        a.cutOrders += subOrders[c];
      }
      rep.articulation.push(a);
    }
  }
  rep.bridges.sort(byImpact);
  rep.articulation.sort(byImpact);
  rep.micros = (now3() - t0) * 1000;
  return rep;
}

class DisjointSet {
  constructor(n) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Int32Array(n);
    this.sets = n;
  }
  find(x) {
    let r = x;
    while (this.parent[r] !== r)
      r = this.parent[r];
    while (this.parent[x] !== r) {
      const nx = this.parent[x];
      this.parent[x] = r;
      x = nx;
    }
    return r;
  }
  unite(a, b) {
    a = this.find(a);
    b = this.find(b);
    if (a === b)
      return false;
    if (this.rank[a] < this.rank[b])
      [a, b] = [b, a];
    this.parent[b] = a;
    if (this.rank[a] === this.rank[b])
      this.rank[a]++;
    this.sets--;
    return true;
  }
}
function kruskal(g) {
  const U = undirected(g);
  const t0 = now3();
  const res = { edges: [], km: 0, trees: 0, micros: 0, work: 0 };
  const order = U.edges.map((_, i) => i).sort((a, b) => U.edges[a].km - U.edges[b].km);
  const dsu = new DisjointSet(U.ids.length);
  for (const k of order) {
    const e = U.edges[k];
    res.work += 2;
    if (dsu.unite(e.u, e.v)) {
      res.edges.push({ u: U.ids[e.u], v: U.ids[e.v], km: e.km });
      res.km += e.km;
      if (dsu.sets === 1)
        break;
    }
  }
  res.trees = dsu.sets;
  res.micros = (now3() - t0) * 1000;
  return res;
}
function prim(g) {
  const U = undirected(g);
  const t0 = now3();
  const res = { edges: [], km: 0, trees: 0, micros: 0, work: 0 };
  const n = U.ids.length;
  const inT = new Uint8Array(n), via = new Int32Array(n).fill(-1);
  for (let s = 0;s < n; s++) {
    if (inT[s])
      continue;
    res.trees++;
    const heap = new IndexedMinHeap(n);
    heap.pushOrDecrease(s, 0);
    res.work++;
    via[s] = -1;
    while (!heap.empty()) {
      const [u] = heap.popMin();
      res.work++;
      inT[u] = 1;
      if (via[u] >= 0) {
        const e = U.edges[via[u]];
        res.edges.push({ u: U.ids[e.u], v: U.ids[e.v], km: e.km });
        res.km += e.km;
      }
      for (const [w, eid] of U.adj[u]) {
        if (inT[w])
          continue;
        const k = U.edges[eid].km;
        if (!heap.contains(w) || k < heap.key[w]) {
          heap.pushOrDecrease(w, k);
          via[w] = eid;
          res.work++;
        }
      }
    }
  }
  res.micros = (now3() - t0) * 1000;
  return res;
}
var totalKm = (g) => undirected(g).edges.reduce((s, e) => s + e.km, 0);
function floydWarshall(g, ids, v) {
  const n = ids.length;
  const index = new Map(ids.map((id, i) => [id, i]));
  const d = ids.map(() => new Float64Array(n).fill(INF2));
  for (let i = 0;i < n; i++) {
    d[i][i] = 0;
    for (const e of g.neighbors(ids[i])) {
      if (!vehicleAllowed(e, v) || !index.has(e.to))
        continue;
      const j = index.get(e.to);
      d[i][j] = Math.min(d[i][j], e.distance);
    }
  }
  for (let k = 0;k < n; k++)
    for (let i = 0;i < n; i++) {
      const dik = d[i][k];
      if (dik === INF2)
        continue;
      const di = d[i], dk = d[k];
      for (let j = 0;j < n; j++)
        if (dik + dk[j] < di[j])
          di[j] = dik + dk[j];
    }
  return d;
}
function suggestDepot(g, currentDepot, destinations, v = MOTORBIKE, top = 5) {
  const t0 = now3();
  const rep = { ranking: [], current: { node: -1, totalKm: 0, maxKm: 0, reachable: 0 }, center: -1, centerEccentricity: 0, orders: destinations.length, floyd: false, micros: 0 };
  const ids = g.nodeIds();
  const n = ids.length;
  const index = new Map(ids.map((id, i) => [id, i]));
  const uniq = [];
  for (const d of destinations)
    if (index.has(d) && !uniq.includes(d))
      uniq.push(d);
  const toDest = uniq.map(() => new Float64Array(n).fill(INF2));
  let all = null;
  if (n <= FLOYD_MAX) {
    rep.floyd = true;
    all = floydWarshall(g, ids, v);
    uniq.forEach((d, k) => {
      const j = index.get(d);
      for (let c = 0;c < n; c++)
        toDest[k][c] = all[c][j];
    });
  } else {
    const radj = ids.map(() => []);
    for (let i = 0;i < n; i++)
      for (const e of g.neighbors(ids[i]))
        if (vehicleAllowed(e, v) && index.has(e.to))
          radj[index.get(e.to)].push([i, e.distance]);
    uniq.forEach((d, k) => {
      const dist = toDest[k];
      const heap = new IndexedMinHeap(n);
      const s = index.get(d);
      dist[s] = 0;
      heap.pushOrDecrease(s, 0);
      while (!heap.empty()) {
        const [u, du] = heap.popMin();
        for (const [w, km] of radj[u])
          if (du + km < dist[w]) {
            dist[w] = du + km;
            heap.pushOrDecrease(w, dist[w]);
          }
      }
    });
  }
  const countAt = new Map;
  for (const d of destinations)
    if (index.has(d))
      countAt.set(d, (countAt.get(d) || 0) + 1);
  const score = (c) => {
    const s = { node: ids[c], totalKm: 0, maxKm: 0, reachable: 0 };
    uniq.forEach((d, k) => {
      const km = toDest[k][c];
      if (km === INF2)
        return;
      const cnt = countAt.get(d);
      s.reachable += cnt;
      s.totalKm += km * cnt;
      s.maxKm = Math.max(s.maxKm, km);
    });
    return s;
  };
  const scores = [];
  for (let c = 0;c < n; c++)
    scores.push(score(c));
  scores.sort((a, b) => {
    if (a.reachable !== b.reachable)
      return b.reachable - a.reachable;
    if (Math.abs(a.totalKm - b.totalKm) > 0.000000001)
      return a.totalKm - b.totalKm;
    return a.maxKm - b.maxKm;
  });
  rep.ranking = scores.slice(0, top);
  if (index.has(currentDepot))
    rep.current = score(index.get(currentDepot));
  if (rep.floyd && index.has(currentDepot)) {
    const dep = index.get(currentDepot);
    const comp = [];
    for (let c = 0;c < n; c++)
      if (all[dep][c] < INF2 && all[c][dep] < INF2)
        comp.push(c);
    let best = INF2;
    for (const c of comp) {
      let ecc = 0;
      for (const w of comp)
        ecc = Math.max(ecc, all[c][w]);
      if (ecc < best - 0.000000000001) {
        best = ecc;
        rep.center = ids[c];
      }
    }
    rep.centerEccentricity = best === INF2 ? 0 : best;
  }
  rep.micros = (now3() - t0) * 1000;
  return rep;
}
