// Bản đồ mạng lưới vẽ bằng SVG thuần (không cần thư viện bản đồ, chạy offline).
//
// Toạ độ nút: x = vĩ độ, y = kinh độ. Phép chiếu Mercator (giữ đúng góc và tỉ lệ cục bộ):
//     X = kinh độ (độ),   Y = −mercator(vĩ độ) (đổi ra đơn vị độ)
//     màn hình = (X, Y) · scale + (tx, ty)
// Bản đồ lớn (hàng trăm điểm trở lên) vẽ đoạn đường bằng canvas cho mượt.
import { escapeHtml } from './store.js';
import { fmt, vehicleMaskText } from './ui.js';

// Ghim kiểu app bản đồ: mũi nhọn ở đúng toạ độ điểm, đầu tròn phía trên
const PIN = 'M0 0C-2.2-5.6-12-11.6-12-21a12 12 0 1 1 24 0C12-11.6 2.2-5.6 0 0z';
const SCALE_KM = [0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
const LARGE = 300;   // từ bao nhiêu điểm thì chuyển sang chế độ vẽ nhanh

const RAD = Math.PI / 180;
const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2)) / RAD;   // độ -> "độ Mercator"
const invMerc = (m) => (2 * Math.atan(Math.exp(m * RAD)) - Math.PI / 2) / RAD;

export class MapView {
  constructor(svg, { tooltip, hint, legend }) {
    this.svg = svg;
    this.tooltipEl = tooltip;
    this.hintEl = hint;
    this.legendEl = legend;
    this.graph = { nodes: [], edges: [], directed: false };
    this.byId = new Map();
    this.depot = -1;
    this.view = null;            // { scale, tx, ty }
    this.paths = [];
    this.nodeStyles = new Map();
    this.edgeStyles = new Map(); // "u-v" -> {color,width}
    this.dim = false;
    this.selection = null;
    this.showKm = false;
    this.layers = { routes: true, restricted: true, zone: false };   // lớp dữ liệu bật / tắt từ thanh công cụ nổi
    this.tripLayer = [];         // lộ trình các chuyến đang chạy {nodes, color}: vẽ mờ khi trang không tự vẽ lộ trình
    this.picking = false;
    this.animatePending = false;
    this.handlers = { nodeclick: [], edgeclick: [], mapclick: [] };
    this.graphKey = '';
    this.screen = new Map();     // id -> [x, y] lần vẽ gần nhất (để chọn điểm gần con trỏ)
    this.markers = [];           // biểu tượng di động (shipper đang chạy): {lat, lon, color, label, title}
    this.pulse = null;           // điểm đang được làm nổi (sau khi tìm kiếm)
    this.userMoved = false;      // người dùng đã kéo/phóng to -> không tự căn khung lại
    this.inset = 0;              // phần bên trái bị bảng điều khiển che (px)
    this.insetB = 0;             // phần dưới bị khung kéo lên (điện thoại) che (px)
    this._anim = null;           // chuyển động khung nhìn đang chạy
    this._lastSize = null;

    // Canvas vẽ nhanh hàng nghìn đoạn đường / điểm (chế độ đồ thị lớn)
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'bulk-canvas';
    svg.parentNode.insertBefore(this.canvas, svg);

    this._bindEvents();
    new ResizeObserver(() => {
      const { w, h } = this._size();
      const changed = this._lastSize && (Math.abs(this._lastSize.w - w) > 40 || Math.abs(this._lastSize.h - h) > 40);
      this._lastSize = { w, h };
      if (changed && !this.userMoved) this.fitMain();
      else this.render();
    }).observe(svg);
  }

  on(evt, fn) { this.handlers[evt].push(fn); }
  off(evt, fn) { this.handlers[evt] = this.handlers[evt].filter((f) => f !== fn); }
  emit(evt, ...args) { for (const fn of this.handlers[evt]) fn(...args); }

  get large() { return this.graph.nodes.length > LARGE; }

  // ------------------------------------------------------------ Dữ liệu
  setGraph(graph, depot, { refit = false } = {}) {
    this.graph = graph;
    this.depot = depot;
    this.byId = new Map(graph.nodes.map((n) => [n.id, n]));
    this.edgeSet = new Set(graph.edges.map((e) => `${e.u}-${e.v}`));
    const key = graph.nodes.length + ':' + (graph.nodes[0]?.id ?? '') + ':' + (graph.nodes.at(-1)?.x ?? '');
    if (refit || !this.view || (this.graphKey === '' && graph.nodes.length)) {
      this.graphKey = key;
      this.fitMain();
    }
    this.graphKey = key;
    this.render();
  }

  clear() {
    this.paths = [];
    this.nodeStyles = new Map();
    this.edgeStyles = new Map();
    this.dim = false;
    this.selection = null;
    this.markers = [];
    this.setLegend([]);
    this.render();
  }

  setPaths(paths, { animate = true } = {}) {
    this.paths = paths.filter((p) => p.nodes && p.nodes.length > 1);
    this.animatePending = animate;
    this.render();
  }
  setNodeStyles(map) { this.nodeStyles = map instanceof Map ? map : new Map(Object.entries(map).map(([k, v]) => [Number(k), v])); this.render(); }
  setEdgeStyles(map) { this.edgeStyles = map; this.render(); }
  setDim(on) { this.dim = on; this.render(); }
  setSelection(sel) { this.selection = sel; this.render(); }
  setLayers(patch) { Object.assign(this.layers, patch); this.setLegend(this._lastLegend || []); this.render(); }
  setTripLayer(list) { this.tripLayer = list || []; this.render(); }
  setShowKm(on) { this.showKm = on; this.render(); }
  setMarkers(list) { this.markers = list || []; this.render(); }

  // Đưa một điểm vào giữa khung nhìn và nhấp nháy vòng sáng vài giây
  focusNode(id) {
    const n = this.byId.get(id);
    if (!n || !this.view) return;
    this.centerOn(n.x, n.y, true);
    this.pulse = id;
    clearTimeout(this._pulseTimer);
    this._pulseTimer = setTimeout(() => { this.pulse = null; this.render(); }, 2600);
  }

  setHint(text) {
    this.hintEl.hidden = !text;
    this.hintEl.textContent = text || '';
  }
  setPicking(on) { this.picking = on; this.svg.classList.toggle('picking', on); }

  setLegend(items) {
    this._lastLegend = items;
    const base = [];
    if (this.graph.nodes.length) {
      if (this.layers.restricted && this.graph.edges.some((e) => e.allowed !== 7)) base.push({ type: 'road', fill: 'var(--map-restricted)', edge: 'var(--map-restricted-edge)', label: 'Cấm một số loại xe' });
      if (this.graph.edges.some((e) => e.costK < 0)) base.push({ type: 'road', fill: 'var(--map-negative)', edge: 'var(--stop)', label: 'Được trợ giá' });
      if (this.graph.edges.some((e) => e.jam > 1 && !e.closed)) base.push({ type: 'dots', color: 'var(--jam)', label: 'Kẹt xe' });
      if (this.graph.edges.some((e) => e.closed)) base.push({ type: 'dash', color: 'var(--stop)', label: 'Đang đóng' });
    }
    const all = [...items, ...base];
    this.legendEl.innerHTML = all.map((it) => `<div class="legend-row">${legendIcon(it)}<span>${escapeHtml(it.label)}</span></div>`).join('');
  }

  // ------------------------------------------------------------ Khung nhìn
  _size() {
    const r = this.svg.getBoundingClientRect();
    return { w: Math.max(r.width, 50), h: Math.max(r.height, 50) };
  }

  // Phần bản đồ còn nhìn thấy nằm bên phải bảng điều khiển
  setInset(px, bottom = 0, top = 0) { this.inset = Math.max(0, px || 0); this.insetB = Math.max(0, bottom || 0); this.insetT = Math.max(0, top || 0); }

  _fit(nodes, animate = false) {
    const r = this.svg.getBoundingClientRect();
    if (r.width < 100 || r.height - this.insetB < 100 || r.width - this.inset < 100) {
      // Bản đồ đang ẩn (trang rộng) -> căn khung khi hiện lại
      this._pendingFit = true;
      if (!this.view) this.view = { scale: 9000, tx: 0, ty: 0 };
      return;
    }
    this._pendingFit = false;
    const { w, h } = this._size();
    if (!nodes.length) {  // bản đồ trống: mặc định nhìn vào trung tâm TP.HCM
      if (!this.view) this.view = { scale: 9000, tx: 0, ty: 0 };
      this.centerOn(10.7769, 106.7009, animate);
      return;
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const X = n.y, Y = -merc(n.x);
      minX = Math.min(minX, X); maxX = Math.max(maxX, X);
      minY = Math.min(minY, Y); maxY = Math.max(maxY, Y);
    }
    // Chừa lề: phải rộng hơn cho nhãn tên, trên cho công cụ, dưới cho chú giải
    const big = this.large;
    const pad = w < 600 ? { l: 24, r: big ? 24 : 90, t: 64, b: 50 } : { l: 50, r: big ? 50 : 170, t: 70, b: big ? 60 : 110 };
    pad.l += this.inset;
    pad.b += this.insetB;
    pad.t = Math.max(pad.t, this.insetT || 0);
    const spanX = Math.max(maxX - minX, 0.004), spanY = Math.max(maxY - minY, 0.004);
    const scale = Math.min((w - pad.l - pad.r) / spanX, (h - pad.t - pad.b) / spanY);
    const cx = pad.l + (w - pad.l - pad.r) / 2, cy = pad.t + (h - pad.t - pad.b) / 2;
    const target = { scale, tx: cx - ((minX + maxX) / 2) * scale, ty: cy - ((minY + maxY) / 2) * scale };
    this.userMoved = false;
    if (animate && this.view) this._animateTo(target, 420);
    else { this._stopAnim(); this.view = target; }
  }

  // ---- Chuyển động mượt của khung nhìn
  // Nội suy toạ độ thế giới của một điểm neo trên màn hình và log(tỉ lệ) -> phóng to "bám" đúng điểm neo.
  _animateTo(target, ms = 300, anchor = null) {
    this._stopAnim();
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!this.view || reduce || ms <= 0) { this.view = target; this.render(); return; }
    const { w, h } = this._size();
    const [ax, ay] = anchor || [(this.inset + w) / 2, (h - this.insetB) / 2];
    const from = { ...this.view };
    if (!(from.scale > 0) || !(target.scale > 0) || !Number.isFinite(from.tx + from.ty + target.tx + target.ty)) { this.view = target; this.render(); return; }
    const wx0 = (ax - from.tx) / from.scale, wy0 = (ay - from.ty) / from.scale;
    const wx1 = (ax - target.tx) / target.scale, wy1 = (ay - target.ty) / target.scale;
    const ls0 = Math.log(from.scale), ls1 = Math.log(target.scale);
    const t0 = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    this._anim = { target };
    const step = (now) => {
      if (!this._anim) return;
      const k = ease(Math.min(1, (now - t0) / ms));
      const sc = Math.exp(ls0 + (ls1 - ls0) * k);
      const wx = wx0 + (wx1 - wx0) * k, wy = wy0 + (wy1 - wy0) * k;
      this.view = { scale: sc, tx: ax - wx * sc, ty: ay - wy * sc };
      this._draw();
      if (k < 1) this._anim.raf = requestAnimationFrame(step);
      else { this._anim = null; this.view = target; this.setLegend(this._lastLegend || []); }
    };
    this._anim.raf = requestAnimationFrame(step);
  }
  _stopAnim() {
    if (this._anim && this._anim.raf) cancelAnimationFrame(this._anim.raf);
    this._anim = null;
    if (this._inertia) { cancelAnimationFrame(this._inertia); this._inertia = null; }
  }

  centerOn(lat, lon, animate = false) {
    const { w, h } = this._size();
    const v = this.view;
    const target = { scale: v.scale, tx: (this.inset + w) / 2 - lon * v.scale, ty: (h - this.insetB) / 2 + merc(lat) * v.scale };
    if (animate) this._animateTo(target, 380);
    else { this._stopAnim(); this.view = target; this.render(); }
  }

  // Khung nhìn hiện tại theo vĩ/kinh độ: {south, west, north, east}
  bounds(inset = 0) {
    const { w, h } = this._size();
    const tl = this.unproject(inset, inset), br = this.unproject(w - inset, h - inset);
    return { south: br.lat, west: tl.lon, north: tl.lat, east: br.lon };
  }

  fitAll(animate = true) { this._fit(this.graph.nodes, animate); this.render(); }

  // Vừa khung theo thành phần liên thông lớn nhất (cụm điểm xa như Cần Giờ không làm nhỏ bản đồ)
  fitMain(animate = false) {
    const comps = components(this.graph);
    comps.sort((a, b) => b.length - a.length);
    const main = comps[0] || [];
    const nodes = main.length >= 2 ? main.map((id) => this.byId.get(id)) : this.graph.nodes;
    this._fit(nodes, animate);
    this.render();
  }

  zoom(factor, cx, cy, ms = 220) {
    if (!this.view) return;
    const { w, h } = this._size();
    cx = cx ?? (this.inset + w) / 2; cy = cy ?? (h - this.insetB) / 2;
    // Cộng dồn với đích của chuyển động đang chạy (lăn chuột liên tục vẫn mượt)
    const base = this._anim ? this._anim.target : this.view;
    const ns = Math.min(Math.max(base.scale * factor, 20), 2e7);
    const f = ns / base.scale;
    const target = { scale: ns, tx: cx - (cx - base.tx) * f, ty: cy - (cy - base.ty) * f };
    this.userMoved = true;
    this._animateTo(target, ms, [cx, cy]);
  }

  project(n) {
    const v = this.view;
    return [n.y * v.scale + v.tx, -merc(n.x) * v.scale + v.ty];
  }
  unproject(sx, sy) {
    const v = this.view;
    return { lat: invMerc(-(sy - v.ty) / v.scale), lon: (sx - v.tx) / v.scale };
  }

  _offscreenCount() {
    if (!this.view) return 0;
    const { w, h } = this._size();
    let c = 0;
    for (const n of this.graph.nodes) {
      const [x, y] = this.project(n);
      if (x < this.inset - 10 || y < -10 || x > w + 10 || y > h - this.insetB + 10) c++;
    }
    return c;
  }

  // Điểm gần toạ độ màn hình nhất trong bán kính r (px)
  nearestNode(sx, sy, r = 12) {
    let best = null, bd = r * r;
    for (const [id, [x, y]] of this.screen) {
      const d = (x - sx) ** 2 + (y - sy) ** 2;
      if (d < bd) { bd = d; best = id; }
    }
    return best;
  }

  nearestEdge(sx, sy, r = 7) {
    let best = null, bd = r;
    for (const e of this.graph.edges) {
      const a = this.screen.get(e.u), b = this.screen.get(e.v);
      if (!a || !b) continue;
      const d = segDist(sx, sy, a[0], a[1], b[0], b[1]);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // ------------------------------------------------------------ Vẽ
  render() {
    if (this._pendingFit) {
      const r = this.svg.getBoundingClientRect();
      if (r.width - this.inset >= 100 && r.height - this.insetB >= 100) { this._pendingFit = false; this.fitMain(); return; }
    }
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = null; this._draw(); });
  }

  _draw() {
    if (!this.view) this.fitMain();
    const { w, h } = this._size();
    const large = this.large;
    const parts = [];

    // Toạ độ màn hình của mọi nút (dùng chung cho vẽ và chọn điểm)
    this.screen = new Map();
    for (const n of this.graph.nodes) this.screen.set(n.id, this.project(n));
    const inView = (x, y, m = 40) => x > -m && y > -m && x < w + m && y < h + m;

    const highlighted = new Set();
    for (const p of this.paths) for (const id of p.nodes) highlighted.add(id);

    // --- Vùng nội thành: bao lồi quanh cụm điểm kho đi tới được (nét bo tròn như một vùng phủ)
    if (this.layers.zone && !large) {
      const pts = this._zoneNodes().map((id) => this.screen.get(id)).filter(Boolean);
      const hull = convexHull(pts);
      if (hull.length >= 2) parts.push(`<path class="zone-hull" d="M${hull.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join('L')}${hull.length > 2 ? 'Z' : ''}"/>`);
    }

    // --- Cạnh
    const caseParts = [], edgeParts = [], trafficParts = [], arrowParts = [], labelParts = [], hitParts = [];
    const bulk = { normal: [], restricted: [], negative: [], dim: [], jam: [], closed: [] };
    const bulkArrows = [];
    for (const e of this.graph.edges) {
      const pa = this.screen.get(e.u), pb = this.screen.get(e.v);
      if (!pa || !pb) continue;
      let [x1, y1] = pa, [x2, y2] = pb;
      if (!inView(x1, y1) && !inView(x2, y2) && !segCrossesView(x1, y1, x2, y2, w, h)) continue;
      const twoWay = this.graph.directed && this.edgeSet.has(`${e.v}-${e.u}`);
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const sel = this.selection && this.selection.edge && this.selection.edge[0] === e.u && this.selection.edge[1] === e.v;
      const style = this.edgeStyles.get(`${e.u}-${e.v}`) || (!this.graph.directed && this.edgeStyles.get(`${e.v}-${e.u}`));
      const dimmed = this.dim && !(highlighted.has(e.u) && highlighted.has(e.v)) && !style;

      if (large && !sel && !style) {
        // Chế độ vẽ nhanh: gộp mọi cạnh cùng kiểu vào một <path>; đường hai chiều chỉ vẽ một lần
        if (twoWay && e.u > e.v) continue;
        const seg = [x1, y1, x2, y2];
        if (e.closed) bulk.closed.push(seg);
        else if (e.jam > 1) bulk.jam.push(seg);
        else if (dimmed) bulk.dim.push(seg);
        else if (e.costK < 0) bulk.negative.push(seg);
        else if (e.allowed !== 7 && this.layers.restricted) bulk.restricted.push(seg);
        else bulk.normal.push(seg);
        if (this.graph.directed && !twoWay && len > 44 && !dimmed) bulkArrows.push([x1, y1, dx, dy, len, nx, ny]);
        continue;
      }
      if (twoWay) {  // hai chiều riêng: tách nhẹ để thấy cả hai
        x1 += nx * 3.5; y1 += ny * 3.5; x2 += nx * 3.5; y2 += ny * 3.5;
      }
      const traffic = e.closed ? 'closed' : e.jam > 1 ? (e.jam >= 2.5 ? 'jam heavy' : 'jam') : '';
      const kind = e.costK < 0 ? 'negative' : e.allowed !== 7 && this.layers.restricted ? 'restricted' : '';
      const cls = [kind, dimmed && !traffic ? 'dim' : '', sel ? 'selected' : ''].join(' ');
      const extra = style ? ` style="stroke:${style.color};stroke-width:${style.width || 4}"` : '';
      const seg = `x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"`;
      // Một chiều: lòng đường hẹp hơn để thấy được hai làn tách nhau
      const thin = twoWay ? ' style="stroke-width:3"' : '';
      caseParts.push(`<line class="edge-case ${cls}" ${seg}${twoWay ? ' style="stroke-width:5"' : ''}/>`);
      edgeParts.push(`<line class="edge ${cls}" ${seg}${extra || thin}/>`);
      if (traffic) trafficParts.push(`<line class="edge ${traffic}" ${seg}/>`);
      if (!large) hitParts.push(`<line class="edge-hit" data-edge="${e.u}-${e.v}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`);
      if (e.closed && len > 24) labelParts.push(`<g class="closed-mark" transform="translate(${(x1 + x2) / 2},${(y1 + y2) / 2})"><circle r="8"/><path d="M-3.5-3.5L3.5 3.5M3.5-3.5L-3.5 3.5"/></g>`);
      else if (e.jam > 1 && len > 40) labelParts.push(`<text class="jam-label" x="${(x1 + x2) / 2 - nx * 11}" y="${(y1 + y2) / 2 - ny * 11 + 4}" text-anchor="middle">×${fmt.num(e.jam)}</text>`);
      if (this.graph.directed && len > 26) arrowParts.push(arrowSvg(x1, y1, dx, dy, len, nx, ny, e.costK < 0, dimmed));
      if (this.showKm && len > 34) {
        labelParts.push(`<text class="edge-label" x="${(x1 + x2) / 2 + nx * 9}" y="${(y1 + y2) / 2 + ny * 9 + 3}" text-anchor="middle">${fmt.num(e.km)}</text>`);
      }
    }
    parts.push(`<g>${caseParts.join('')}</g><g>${edgeParts.join('')}</g><g>${trafficParts.join('')}${arrowParts.join('')}</g>`);

    // --- Lộ trình phủ lên
    const overlay = [];
    this.paths.forEach((p, i) => {
      const pts = offsetPolyline(p.nodes.map((id) => this.screen.get(id)).filter(Boolean), p.offset || 0);
      if (pts.length < 2) return;
      let total = 0;
      for (let j = 1; j < pts.length; j++) total += Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]);
      const d = `M${pts.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join('L')}`;
      const width = p.width || 6;
      const anim = this.animatePending && p.animate !== false;
      const dash = p.dash ? `stroke-dasharray:${p.dash};` : anim ? `stroke-dasharray:${total};--len:${total};` : '';
      // Tuyến chính kiểu app bản đồ: lòng màu, viền sẫm hơn cùng tông
      if (!p.dash && width >= 5 && (p.opacity ?? 1) > 0.6) overlay.push(`<path class="overlay-case ${anim ? 'draw' : ''}" d="${d}" style="stroke:color-mix(in srgb, ${p.color} 62%, #04122e);stroke-width:${width + 3.5};${dash}animation-delay:${Math.min(i * 90, 700)}ms"/>`);
      overlay.push(`<path class="overlay-path ${anim && !p.dash ? 'draw' : ''}" d="${d}" style="stroke:${p.color};stroke-width:${width};opacity:${p.opacity ?? 0.95};${dash}animation-delay:${Math.min(i * 90, 700)}ms"/>`);
      if (p.arrows) {  // mũi tên chỉ hướng đi dọc lộ trình
        let since = 0;
        for (let j = 1; j < pts.length; j++) {
          const [ax, ay] = pts[j - 1], [bx, by] = pts[j];
          const L = Math.hypot(bx - ax, by - ay);
          since += L;
          if (L < 14 || since < 60) continue;
          since = 0;
          const ux = (bx - ax) / L, uy = (by - ay) / L, mx = (ax + bx) / 2, my = (ay + by) / 2, s = 4.5;
          overlay.push(`<polygon points="${mx + ux * s},${my + uy * s} ${mx - ux * s - uy * s},${my - uy * s + ux * s} ${mx - ux * s + uy * s},${my - uy * s - ux * s}" fill="#fff" opacity=".95" pointer-events="none"/>`);
        }
      }
    });
    // Lớp "Lộ trình shipper": các chuyến đang chạy, vẽ mờ phía dưới khi trang không tự vẽ lộ trình
    if (this.layers.routes && !this.paths.length) {
      for (const tp of this.tripLayer) {
        const pts = tp.nodes.map((id) => this.screen.get(id)).filter(Boolean);
        if (pts.length < 2) continue;
        overlay.push(`<path class="trip-layer" d="M${pts.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join('L')}" style="stroke:${tp.color}"/>`);
      }
    }
    this.animatePending = false;
    parts.push(`<g>${overlay.join('')}</g>`);
    parts.push(`<g>${hitParts.join('')}</g>`);
    parts.push(`<g>${labelParts.join('')}</g>`);

    // --- Nút
    const nodeParts = [], labelNodes = [], badgeParts = [];
    const dots = [], dimDots = [];
    const showLabels = this.graph.nodes.length <= 80;
    const dotR = this.view.scale > 30000 ? 2.6 : 1.8;
    for (const n of this.graph.nodes) {
      const [x, y] = this.screen.get(n.id);
      if (!inView(x, y, large ? 20 : 200)) continue;
      const st = this.nodeStyles.get(n.id);
      const isDepot = n.id === this.depot;
      const sel = this.selection && this.selection.node === n.id;
      const dimmed = (this.dim && !highlighted.has(n.id) && !(st && st.keep)) || (st && st.dim);
      if (large && !st && !isDepot && !sel) {  // điểm thường: chấm nhỏ gộp chung một path
        (dimmed ? dimDots : dots).push(x, y);
        continue;
      }
      const s = st || {};
      if (large && s.dim && !sel) { dimDots.push(x, y); continue; }
      let g = `<g class="node ${isDepot ? 'depot' : ''} ${dimmed ? 'dim' : ''}" data-node="${n.id}" transform="translate(${x},${y})">`;
      if ((sel || s.ring) && !s.pin) g += `<circle class="ring" r="${isDepot ? 13 : 12}" style="${s.ring ? `stroke:${s.ring}` : ''}"/>`;
      if (s.pin === 'end') {
        g += `<circle class="hit" r="12"/><ellipse class="pin-shadow" cx="0" cy="0" rx="6" ry="2.4"/><path class="pin end" d="${PIN}"/><circle class="pin-eye" cy="-21" r="5"/>`;
      } else if (isDepot) {
        g += `<circle class="hit" r="12"/><ellipse class="pin-shadow" cx="0" cy="0" rx="6" ry="2.4"/><path class="pin depot ${s.pin === 'start' ? 'is-start' : ''}" d="${PIN}" ${s.fill ? `style="fill:${s.fill}"` : ''}/><path class="pin-glyph" d="M-5.5-19.5 0-24l5.5 4.5v5.5h-11z" transform="translate(0,-1.5)"/>`;
      } else if (s.pin === 'start') {
        g += `<circle class="start-halo" r="15"/><circle class="start-dot" r="8.5"/><circle class="start-core" r="3.2"/>`;
      } else {
        g += `<circle class="body" r="${s.r || (large ? 5 : 6.5)}" style="${s.fill ? `fill:${s.fill};` : ''}${s.stroke ? `stroke:${s.stroke}` : ''}"/>`;
      }
      g += '</g>';
      nodeParts.push(g);
      const pinned = isDepot || s.pin === 'end';
      if (showLabels || sel || (large && (s.label || isDepot))) labelNodes.push(`<text class="node-label ${dimmed ? 'dim' : ''} ${pinned || s.pin ? 'strong' : ''}" x="${x + (pinned ? 16 : 12)}" y="${y + (pinned ? -17 : 4)}">${escapeHtml(n.name)}</text>`);
      if (s.badge != null) {
        const text = String(s.badge);
        const bw = Math.max(18, text.length * 6.6 + 8);
        badgeParts.push(`<g class="badge" transform="translate(${x - bw / 2},${y - (pinned ? 54 : 27)})"><rect width="${bw}" height="17" rx="8.5" style="fill:${s.badgeColor || 'var(--road)'}"/><text x="${bw / 2}" y="8.8" style="fill:${s.badgeText || (!s.badgeColor || s.badgeColor === 'var(--road)' ? 'var(--road-ink)' : s.badgeColor === 'var(--ink)' ? 'var(--bg)' : '#fff')}">${escapeHtml(text)}</text></g>`);
      }
    }
    this._drawCanvas(w, h, large ? { bulk, arrows: bulkArrows, dots, dimDots, dotR } : null);
    parts.push(`<g>${nodeParts.join('')}</g><g>${labelNodes.join('')}</g><g>${badgeParts.join('')}</g>`);
    if (this.pulse != null && this.screen.has(this.pulse)) {
      const [px, py] = this.screen.get(this.pulse);
      parts.push(`<circle class="pulse" cx="${px}" cy="${py}" r="14"/>`);
    }
    // Biểu tượng shipper đang di chuyển
    const mk = [];
    for (const m of this.markers) {
      const [mx, my] = this.project({ x: m.lat, y: m.lon });
      mk.push(`<g class="marker" transform="translate(${mx.toFixed(1)},${my.toFixed(1)})" style="--c:${m.color}"><title>${escapeHtml(m.title || '')}</title><circle class="halo" r="22"/><path class="tail" d="M-6 9 0 19 6 9z"/><circle class="face" r="14"/><text>${escapeHtml(m.label || '')}</text></g>`);
    }
    parts.push(`<g>${mk.join('')}</g>`);
    parts.push(this._scaleBarSvg(w, h));
    this.svg.innerHTML = parts.join('');
    // Nút "Tất cả" cho biết còn bao nhiêu điểm nằm ngoài khung nhìn
    const allCount = document.getElementById('all-count');
    if (allCount) {
      const hidden = large ? 0 : this._offscreenCount();
      const label = hidden > 0 ? `+${hidden}` : '';
      if (allCount.textContent !== label) { allCount.textContent = label; allCount.hidden = !label; }
    }
  }

  // Vẽ các đoạn đường và điểm thường lên canvas (nhanh hơn SVG rất nhiều khi có hàng nghìn phần tử)
  _drawCanvas(w, h, data) {
    const c = this.canvas, dpr = devicePixelRatio || 1;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (!data) return;
    const css = getComputedStyle(this.svg);
    const edgeColor = css.getPropertyValue('--map-edge').trim() || '#8d9ab0';
    const stop = css.getPropertyValue('--stop').trim() || '#c9362a';
    const ink = css.getPropertyValue('--ink').trim() || '#15233b';
    const width = 1.7;
    g.lineCap = 'round';
    const stroke = (segs, color, alpha, dash) => {
      if (!segs.length) return;
      g.beginPath();
      for (const [x1, y1, x2, y2] of segs) { g.moveTo(x1, y1); g.lineTo(x2, y2); }
      g.strokeStyle = color;
      g.globalAlpha = alpha;
      g.lineWidth = width;
      g.setLineDash(dash || []);
      g.stroke();
    };
    const base = 0.9;
    stroke(data.bulk.dim, edgeColor, 0.18);
    stroke(data.bulk.normal, edgeColor, base);
    stroke(data.bulk.restricted, edgeColor, base, [6, 5]);
    stroke(data.bulk.negative, stop, 0.85);
    const jamColor = css.getPropertyValue('--jam').trim() || '#e07b00';
    g.lineWidth = 5;
    g.setLineDash([0.1, 7]);
    g.beginPath();
    for (const [x1, y1, x2, y2] of data.bulk.jam) { g.moveTo(x1, y1); g.lineTo(x2, y2); }
    g.strokeStyle = jamColor;
    g.globalAlpha = 0.95;
    g.stroke();
    stroke(data.bulk.closed, stop, 0.95, [3, 5]);
    g.setLineDash([]);
    if (data.arrows.length) {
      g.beginPath();
      for (const [x1, y1, dx, dy, len, nx, ny] of data.arrows) {
        const t = 0.58, ax = x1 + dx * t, ay = y1 + dy * t, ux = dx / len, uy = dy / len, s = 5;
        g.moveTo(ax + ux * s, ay + uy * s);
        g.lineTo(ax - ux * s + nx * s * 0.75, ay - uy * s + ny * s * 0.75);
        g.lineTo(ax - ux * s - nx * s * 0.75, ay - uy * s - ny * s * 0.75);
        g.closePath();
      }
      g.fillStyle = edgeColor;
      g.globalAlpha = 0.9;
      g.fill();
    }
    const dotsAt = (arr, alpha) => {
      if (!arr.length) return;
      g.beginPath();
      for (let i = 0; i < arr.length; i += 2) { g.moveTo(arr[i] + data.dotR, arr[i + 1]); g.arc(arr[i], arr[i + 1], data.dotR, 0, Math.PI * 2); }
      g.fillStyle = ink;
      g.globalAlpha = alpha;
      g.fill();
    };
    dotsAt(data.dimDots, 0.15);
    dotsAt(data.dots, 0.6);
    g.globalAlpha = 1;
  }

  // Nếu có điểm nào trong danh sách nằm ngoài khung nhìn thì căn lại khung cho thấy hết
  ensureVisible(ids) {
    if (!this.view || !ids.length) return;
    const { w, h } = this._size();
    const pts = ids.map((id) => this.byId.get(id)).filter(Boolean);
    const out = pts.some((n) => { const [x, y] = this.project(n); return x < this.inset + 20 || y < 60 || x > w - 20 || y > h - this.insetB - 40; });
    if (out) { this._fit(pts, true); this.userMoved = true; }
  }

  // Các điểm nằm cùng cụm với kho (đi qua cạnh theo cả hai chiều): "vùng nội thành"
  _zoneNodes() {
    const key = `${this.graph.nodes.length}/${this.graph.edges.length}/${this.depot}`;
    if (this._zoneKey === key) return this._zone;
    const adj = new Map();
    for (const e of this.graph.edges) {
      if (!adj.has(e.u)) adj.set(e.u, []);
      if (!adj.has(e.v)) adj.set(e.v, []);
      adj.get(e.u).push(e.v); adj.get(e.v).push(e.u);
    }
    const seen = new Set([this.depot]), q = [this.depot];
    while (q.length) for (const v of adj.get(q.pop()) || []) if (!seen.has(v)) { seen.add(v); q.push(v); }
    this._zoneKey = key; this._zone = [...seen];
    return this._zone;
  }

  _scaleBarSvg(w, h) {
    const lat = this.unproject(w / 2, h / 2).lat;
    const pxPerKm = this.view.scale / (111.32 * Math.cos(lat * RAD));
    let km = SCALE_KM[0];
    for (const s of SCALE_KM) if (s * pxPerKm <= 140) km = s;
    const len = km * pxPerKm;
    const x = this.inset + 18, y = h - this.insetB - 20;
    const label = km < 1 ? `${Math.round(km * 1000)} m` : `${fmt.num(km, 2)} km`;
    return `<g class="scale-bar"><line x1="${x}" x2="${x + len}" y1="${y}" y2="${y}"/><line x1="${x}" x2="${x}" y1="${y - 5}" y2="${y + 1}"/><line x1="${x + len}" x2="${x + len}" y1="${y - 5}" y2="${y + 1}"/><text x="${x}" y="${y - 8}">${label}</text></g>`;
  }

  // ------------------------------------------------------------ Sự kiện
  _bindEvents() {
    const svg = this.svg;
    let down = null;
    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this._stopAnim();
      down = { x: e.clientX, y: e.clientY, tx: this.view?.tx, ty: this.view?.ty, moved: false, target: e.target, track: [] };
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', (e) => {
      if (down) {
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (!down.moved && Math.hypot(dx, dy) > 4) { down.moved = true; svg.classList.add('dragging'); this._hideTip(); }
        if (down.moved) {
          this.view.tx = down.tx + dx; this.view.ty = down.ty + dy; this.userMoved = true; this.render();
          down.track.push([performance.now(), e.clientX, e.clientY]);
          if (down.track.length > 6) down.track.shift();
        }
        return;
      }
      if (this._hoverRaf) return;
      const ev = e;
      this._hoverRaf = requestAnimationFrame(() => { this._hoverRaf = null; this._hover(ev); });
    });
    const finish = (e) => {
      if (!down) return;
      const d = down;
      down = null;
      svg.classList.remove('dragging');
      if (d.moved) { this._fling(d.track); this.setLegend(this._lastLegend || []); return; }
      const nodeEl = d.target.closest && d.target.closest('[data-node]');
      const edgeEl = d.target.closest && d.target.closest('[data-edge]');
      const r = svg.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      if (nodeEl) return this.emit('nodeclick', Number(nodeEl.dataset.node), e);
      if (edgeEl) { const [u, v] = edgeEl.dataset.edge.split('-').map(Number); return this.emit('edgeclick', u, v, e); }
      // Bấm gần một điểm (dễ chọn trên điện thoại và khi bản đồ có hàng nghìn điểm)
      const near = this.nearestNode(sx, sy, this.large ? 12 : 10);
      if (near != null) return this.emit('nodeclick', near, e);
      if (this.large) {
        const ed = this.nearestEdge(sx, sy);
        if (ed) return this.emit('edgeclick', ed.u, ed.v, e);
      }
      this.emit('mapclick', this.unproject(sx, sy), e);
    };
    svg.addEventListener('pointerup', finish);
    svg.addEventListener('pointercancel', () => { down = null; svg.classList.remove('dragging'); });
    svg.addEventListener('pointerleave', () => this._hideTip());
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      // Bàn rê (trackpad) gửi deltaY nhỏ liên tục: phóng theo tỉ lệ deltaY cho mượt
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const factor = Math.exp(-Math.max(-120, Math.min(120, dy)) * 0.0018);
      this.zoom(factor, e.clientX - r.left, e.clientY - r.top, 160);
    }, { passive: false });
    svg.addEventListener('dblclick', (e) => {
      const r = svg.getBoundingClientRect();
      this.zoom(e.shiftKey ? 1 / 1.8 : 1.8, e.clientX - r.left, e.clientY - r.top, 320);
    });
  }

  // Thả tay khi đang kéo nhanh: bản đồ trôi tiếp rồi dừng dần
  _fling(track) {
    if (track.length < 2) return;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const [t1, x1, y1] = track[0], [t2, x2, y2] = track[track.length - 1];
    if (reduce || performance.now() - t2 > 80 || t2 - t1 < 1) return;
    let vx = (x2 - x1) / (t2 - t1), vy = (y2 - y1) / (t2 - t1);   // px / ms
    if (Math.hypot(vx, vy) < 0.25) return;
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(32, now - last);
      last = now;
      this.view.tx += vx * dt;
      this.view.ty += vy * dt;
      const decay = Math.pow(0.94, dt / 16);
      vx *= decay; vy *= decay;
      this._draw();
      if (Math.hypot(vx, vy) > 0.02) this._inertia = requestAnimationFrame(step);
      else { this._inertia = null; this.setLegend(this._lastLegend || []); }
    };
    this._inertia = requestAnimationFrame(step);
  }

  _hover(e) {
    const r = this.svg.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    let nodeId = null, edge = null;
    const nodeEl = e.target.closest && e.target.closest('[data-node]');
    const edgeEl = e.target.closest && e.target.closest('[data-edge]');
    if (nodeEl) nodeId = Number(nodeEl.dataset.node);
    else if (edgeEl) { const [u, v] = edgeEl.dataset.edge.split('-').map(Number); edge = this.graph.edges.find((x) => x.u === u && x.v === v); }
    else if (this.large) {
      nodeId = this.nearestNode(sx, sy, 9);
      if (nodeId == null) edge = this.nearestEdge(sx, sy, 5);
    }
    let html = '';
    if (nodeId != null) {
      const n = this.byId.get(nodeId);
      if (n) {
        const st = this.nodeStyles.get(n.id);
        html = `<b>${escapeHtml(n.name)}</b>Mã điểm ${n.id}${n.id === this.depot ? ' (kho)' : ''}, ${n.degree} đoạn đường${st && st.tip ? `<br>${st.tip}` : ''}`;
      }
    } else if (edge) {
      const ed = edge;
      html = `<b>${escapeHtml(this.byId.get(ed.u).name)} ${this.graph.directed && !this.edgeSet.has(`${ed.v}-${ed.u}`) ? '→' : '↔'} ${escapeHtml(this.byId.get(ed.v).name)}</b>${fmt.km(ed.km)}, ${fmt.num(ed.time)} phút<br>Phụ phí ${fmt.k(ed.cost)}, chi phí cạnh ${fmt.k(ed.costK)}<br>${vehicleMaskText(ed.allowed)}${ed.peak > 1 ? `, cao điểm ×${fmt.num(ed.peak)}` : ''}`;
    }
    this.svg.style.cursor = this.large && (nodeId != null || edge) ? 'pointer' : '';
    if (!html) return this._hideTip();
    const tip = this.tooltipEl;
    tip.innerHTML = html;
    tip.hidden = false;
    let x = sx + 14, y = sy + 14;
    if (x + tip.offsetWidth > r.width - 8) x = sx - tip.offsetWidth - 14;
    if (y + tip.offsetHeight > r.height - 8) y = sy - tip.offsetHeight - 14;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }
  _hideTip() { this.tooltipEl.hidden = true; }
}

// ---------------------------------------------------------------- Phụ trợ
function arrowSvg(x1, y1, dx, dy, len, nx, ny, negative, dimmed) {
  const t = 0.58, ax = x1 + dx * t, ay = y1 + dy * t, ux = dx / len, uy = dy / len, s = 6;
  const pts = [[ax + ux * s, ay + uy * s], [ax - ux * s + nx * s * 0.75, ay - uy * s + ny * s * 0.75], [ax - ux * s - nx * s * 0.75, ay - uy * s - ny * s * 0.75]];
  return `<polygon class="edge-arrow ${negative ? 'negative' : ''} ${dimmed ? 'dim' : ''}" points="${pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}"/>`;
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Đoạn thẳng có cắt qua khung nhìn không (khi cả 2 đầu đều ở ngoài)
function segCrossesView(x1, y1, x2, y2, w, h) {
  if (Math.max(x1, x2) < 0 || Math.min(x1, x2) > w || Math.max(y1, y2) < 0 || Math.min(y1, y2) > h) return false;
  return true;
}

function legendIcon(it) {
  switch (it.type) {
    case 'road': return `<svg viewBox="0 0 26 12"><line x1="2" x2="24" y1="6" y2="6" stroke="${it.edge}" stroke-width="7" stroke-linecap="round"/><line x1="2" x2="24" y1="6" y2="6" stroke="${it.fill}" stroke-width="4.5" stroke-linecap="round"/></svg>`;
    case 'depot': return '<svg viewBox="0 0 26 12"><circle cx="13" cy="6" r="5.5" fill="var(--brand)"/></svg>';
    case 'dot': return `<svg viewBox="0 0 26 12"><circle cx="13" cy="6" r="5" fill="${it.color}" stroke="var(--ink)" stroke-width="1.2"/></svg>`;
    case 'dash': return `<svg viewBox="0 0 26 12"><line x1="1" x2="25" y1="6" y2="6" stroke="${it.color}" stroke-width="2.4" stroke-dasharray="5 4"/></svg>`;
    case 'arrow': return `<svg viewBox="0 0 26 12"><line x1="1" x2="25" y1="6" y2="6" stroke="${it.color}" stroke-width="2"/><polygon points="17,6 11,2.5 11,9.5" fill="${it.color}"/></svg>`;
    case 'dots': return `<svg viewBox="0 0 26 12"><line x1="3" x2="24" y1="6" y2="6" stroke="${it.color}" stroke-width="5" stroke-dasharray="0.1 7" stroke-linecap="round"/></svg>`;
    case 'badge': return `<svg viewBox="0 0 26 12"><rect x="4" y="0" width="18" height="12" rx="6" fill="${it.color}"/></svg>`;
    default: return `<svg viewBox="0 0 26 12"><line x1="1" x2="25" y1="6" y2="6" stroke="${it.color}" stroke-width="${it.width || 4}" stroke-linecap="round"/></svg>`;
  }
}

// Dời đường gấp khúc sang ngang một khoảng (để nhiều lộ trình trùng đoạn không đè nhau)
function offsetPolyline(pts, off) {
  if (!off || pts.length < 2) return pts;
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    return [p[0] - (dy / L) * off, p[1] + (dx / L) * off];
  });
}

// Thành phần liên thông (bỏ qua chiều) bằng Union-Find, chỉ để căn khung nhìn
function components(graph) {
  const parent = new Map(graph.nodes.map((n) => [n.id, n.id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const e of graph.edges) if (parent.has(e.u) && parent.has(e.v)) parent.set(find(e.u), find(e.v));
  const groups = new Map();
  for (const n of graph.nodes) { const r = find(n.id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(n.id); }
  return [...groups.values()];
}

// Bao lồi (Andrew monotone chain) của các điểm màn hình
function convexHull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of [...p].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
