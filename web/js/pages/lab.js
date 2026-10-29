// Trang Mô phỏng: chạy từng bước Dijkstra (Min-Heap tự cài), A*, BFS, DFS, Bellman-Ford.
// Các bước do backend C++ ghi lại (module Trace); trang này chỉ phát lại: mã giả, nội dung
// heap / hàng đợi / ngăn xếp, bảng dist–prev và hình ảnh trên bản đồ.
import { api } from '../api.js';
import { escapeHtml } from '../store.js';
import { $, fmt, guard, segmented, bindSegmented, VEHICLES, CRITERIA } from '../ui.js';

let ctx, root;
let algo = 'dijkstra', src = null, dst = null, criterion = 'distance', vehicle = '3';
let trace = null;     // kết quả /api/trace
let idx = 0;          // đang ở bước idx (đã áp dụng các bước 0..idx)
let state = null;     // trạng thái sau bước idx
let timer = null, speed = '450';
let keyHandler = null;

const ALGOS = [
  { v: 'dijkstra', label: 'Dijkstra' },
  { v: 'astar', label: 'A*' },
  { v: 'bfs', label: 'BFS' },
  { v: 'dfs', label: 'DFS' },
  { v: 'bellman', label: 'Bellman-Ford' },
];
const SPEEDS = [{ v: '900', label: 'Chậm' }, { v: '450', label: 'Vừa' }, { v: '120', label: 'Nhanh' }];
const CONTAINER = { heap: 'Min-Heap', queue: 'Hàng đợi', stack: 'Ngăn xếp' };

const name = (id) => escapeHtml(ctx.store.name(id));
const weighted = () => algo === 'dijkstra' || algo === 'astar' || algo === 'bellman';
const needDst = () => algo === 'dijkstra' || algo === 'astar';
const num = (v) => (v == null || !Number.isFinite(v) ? '∞' : fmt.num(v, 2));

// ------------------------------------------------------------ Phát lại bước
function freshState() {
  const dist = new Map(), prev = new Map();
  for (const n of ctx.store.state.graph.nodes) { dist.set(n.id, Infinity); prev.set(n.id, -1); }
  return { dist, prev, settled: new Set(), order: [], round: 0, changed: null, cycle: false, found: false };
}

function apply(st, s) {
  st.changed = null;
  switch (s.t) {
    case 'init':
      if (trace.algo !== 'dfs') st.dist.set(s.u, 0);
      st.changed = s.u;
      break;
    case 'pop':
      if (trace.algo === 'dfs') { st.dist.set(s.u, s.x); st.prev.set(s.u, s.v); }
      st.settled.add(s.u);
      st.order.push(s.u);
      st.changed = s.u;
      break;
    case 'relax':
      if (trace.algo !== 'dfs') { st.dist.set(s.v, s.x); st.prev.set(s.v, s.u); }
      st.changed = s.v;
      break;
    case 'round': st.round = s.y; break;
    case 'found': st.found = true; break;
    case 'cycle': st.cycle = true; break;
    default: break;
  }
}

// Ghi lại giá trị cũ của dist[v] trước mỗi lần nới (để giải thích bước)
function annotate() {
  const st = freshState();
  for (const s of trace.steps) {
    s.old = s.v >= 0 ? st.dist.get(s.v) : undefined;
    s.du = s.u >= 0 ? st.dist.get(s.u) : undefined;
    apply(st, s);
  }
}

function goTo(i) {
  i = Math.max(0, Math.min(trace.steps.length - 1, i));
  if (!state || i < idx) { state = freshState(); idx = -1; }
  while (idx < i) { idx++; apply(state, trace.steps[idx]); }
  render();
}

function play() {
  stop();
  if (idx >= trace.steps.length - 1) goTo(0);
  timer = setInterval(() => {
    if (idx >= trace.steps.length - 1) { stop(); return; }
    goTo(idx + 1);
  }, Number(speed));
  syncPlay();
}
function stop() { if (timer) { clearInterval(timer); timer = null; } syncPlay(); }
function syncPlay() { const b = $('#l-play', root); if (b) b.textContent = timer ? 'Tạm dừng' : 'Chạy'; }

// ------------------------------------------------------------ Giải thích bước
function explain(s) {
  const A = trace.algo;
  const u = s.u >= 0 ? `<b>${name(s.u)}</b>` : '', v = s.v >= 0 ? `<b>${name(s.v)}</b>` : '';
  if (A === 'bfs') {
    if (s.t === 'init') return `Đánh dấu ${u} đã thăm, đưa vào hàng đợi.`;
    if (s.t === 'pop') return `Lấy ${u} ở đầu hàng đợi (cách nguồn ${num(s.x)} chặng).`;
    if (s.t === 'relax') return `${v} chưa thăm: đánh dấu, prev = ${u}, đưa vào cuối hàng đợi (${num(s.x)} chặng).`;
    if (s.t === 'skip') return `${v} đã thăm rồi: bỏ qua.`;
    return 'Hàng đợi rỗng: duyệt xong.';
  }
  if (A === 'dfs') {
    if (s.t === 'init') return `Đẩy ${u} vào ngăn xếp.`;
    if (s.t === 'pop') return `Lấy ${u} ở đỉnh ngăn xếp và thăm (thứ ${num(s.x + 1)}).`;
    if (s.t === 'relax') return `${v} chưa thăm: đẩy vào ngăn xếp.`;
    if (s.t === 'skip') return `Lấy ${v} ra nhưng đã thăm: bỏ qua.`;
    return 'Ngăn xếp rỗng: duyệt xong.';
  }
  if (A === 'bellman') {
    if (s.t === 'init') return `dist[${u}] = 0, mọi điểm khác = ∞.`;
    if (s.t === 'round') return `Vòng ${s.y}: duyệt lần lượt mọi cạnh.`;
    if (s.t === 'relax') return `Nới cạnh ${u} → ${v}: ${num(s.du)} + ${num(s.x - s.du)} = ${num(s.x)} &lt; ${num(s.old)}, cập nhật dist[${v}].`;
    if (s.t === 'stable') return `Vòng ${s.y} không đổi gì: dừng sớm.`;
    if (s.t === 'cycle') return `Sau V−1 vòng vẫn nới được cạnh ${u} → ${v}: <b style="color:var(--stop)">có chu trình âm</b>.`;
    return 'Xong.';
  }
  const astar = A === 'astar';
  if (s.t === 'init') return `dist[${u}] = 0, đưa ${u} vào heap${astar ? ` với khoá h = ${num(s.y)}` : ''}.`;
  if (s.t === 'pop') return `Lấy ${u} khỏi gốc heap (khoá ${num(s.y)}${astar ? ` = g ${num(s.x)} + h ${num(s.y - s.x)}` : ''}). Chốt dist[${u}] = ${num(s.x)}.`;
  if (s.t === 'found') return `Đã chốt điểm đến ${u}: dừng, khoảng cách ${num(s.x)}.`;
  if (s.t === 'relax') return `Cạnh ${u} → ${v}: ${num(s.du)} + ${num(s.x - s.du)} = ${num(s.x)} &lt; ${num(s.old)} → cập nhật dist[${v}], ${Number.isFinite(s.old) ? 'giảm khoá' : 'đưa vào heap'}${astar ? ` (khoá ${num(s.x + s.y)})` : ''}.`;
  if (s.t === 'skip') return `Cạnh ${u} → ${v}: ${num(s.x)} ≥ ${num(s.y)}: bỏ qua.`;
  return state.found ? 'Đã tới điểm đến: xong.' : 'Heap rỗng: xong.';
}

// ------------------------------------------------------------ Vẽ phần chứa
function heapSvg(items, total) {
  if (!items.length) return '<p class="empty">Heap rỗng.</p>';
  const levels = Math.floor(Math.log2(items.length)) + 1;
  const W = 390, LH = 46, H = levels * LH + 8;
  const pos = (i) => {
    const lv = Math.floor(Math.log2(i + 1)), k = i + 1 - 2 ** lv;
    return [((k + 0.5) / 2 ** lv) * W, lv * LH + 18];
  };
  let lines = '', nodes = '';
  items.forEach(([id, key], i) => {
    const [x, y] = pos(i);
    if (i > 0) { const [px, py] = pos(Math.floor((i - 1) / 2)); lines += `<line x1="${px}" y1="${py}" x2="${x}" y2="${y}"/>`; }
    const r = levels > 5 ? 9 : 12;
    nodes += `<g class="${i === 0 ? 'root' : ''}"><title>${escapeHtml(ctx.store.name(id))}: ${num(key)}</title><circle cx="${x}" cy="${y}" r="${r}"/><text x="${x}" y="${y + 4}">${id}</text>${levels <= 5 ? `<text class="k" x="${x}" y="${y + r + 11}">${num(key)}</text>` : ''}</g>`;
  });
  return `<svg class="heap-tree" viewBox="0 0 ${W} ${H}">${lines}${nodes}</svg>
    <div class="heap-array">${items.map(([id, key], i) => `<span title="${escapeHtml(ctx.store.name(id))}"><i>${i}</i>${id}<small>${num(key)}</small></span>`).join('')}${total > items.length ? `<span class="more">+${total - items.length}</span>` : ''}</div>`;
}

function listHtml(items, total, kind) {
  if (!items.length) return `<p class="empty">${kind === 'queue' ? 'Hàng đợi' : 'Ngăn xếp'} rỗng.</p>`;
  return `<div class="seq ${kind}">${kind === 'queue' ? '<em>đầu</em>' : '<em>đỉnh</em>'}${items.map(([id]) => `<span>${name(id)}</span>`).join('')}${total > items.length ? `<span class="more">+${total - items.length}</span>` : ''}${kind === 'queue' ? '<em>cuối</em>' : ''}</div>`;
}

// ------------------------------------------------------------ Hiển thị
function render() {
  if (!root || !trace) return;
  const s = trace.steps[idx];
  $('#l-step', root).textContent = `Bước ${idx + 1}/${trace.steps.length}${trace.truncated ? '+' : ''}`;
  $('#l-msg', root).innerHTML = explain(s);
  const sl = $('#l-slider', root);
  sl.max = trace.steps.length - 1;
  sl.value = idx;
  $('#l-code', root).innerHTML = trace.pseudo.map((line, i) => `<div class="${i === s.l ? 'on' : ''}"><i>${i + 1}</i>${escapeHtml(line)}</div>`).join('');

  // Phần chứa: heap / hàng đợi / ngăn xếp / vòng lặp Bellman-Ford
  const box = $('#l-container', root);
  if (trace.container === 'heap') box.innerHTML = heapSvg(s.c, s.n);
  else if (trace.container === 'queue' || trace.container === 'stack') box.innerHTML = listHtml(s.c, s.n, trace.container);
  else box.innerHTML = `<p class="muted">Vòng <b>${state.round || 0}</b> / ${ctx.store.state.graph.nodes.length - 1}${state.cycle ? ', <b style="color:var(--stop)">phát hiện chu trình âm</b>' : ''}</p>`;

  // Bảng dist / prev
  const nodes = ctx.store.state.graph.nodes;
  const inBox = new Set(s.c.map(([id]) => id));
  const rows = (nodes.length > 60 ? nodes.filter((n) => Number.isFinite(state.dist.get(n.id)) || state.settled.has(n.id)).slice(0, 120) : nodes).map((n) => {
    const d = state.dist.get(n.id), p = state.prev.get(n.id);
    const status = state.settled.has(n.id) ? (trace.algo === 'bfs' || trace.algo === 'dfs' ? 'đã thăm' : 'đã chốt') : inBox.has(n.id) ? (trace.container === 'heap' ? 'trong heap' : trace.container === 'queue' ? 'đang đợi' : 'trong stack') : '';
    const label = trace.algo === 'dfs' ? (Number.isFinite(d) ? `#${d + 1}` : '–') : num(d);
    return `<tr class="${state.changed === n.id ? 'active' : ''}"><td>${escapeHtml(n.name)}</td><td class="num">${label}</td><td>${p >= 0 ? name(p) : '–'}</td><td class="muted" style="white-space:nowrap">${status}</td></tr>`;
  }).join('');
  const head = trace.algo === 'bfs' ? 'Số chặng' : trace.algo === 'dfs' ? 'Thứ tự' : 'dist';
  $('#l-table', root).innerHTML = `<table class="data"><thead><tr><th>Điểm</th><th class="num">${head}</th><th>prev</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
  drawMap(s, inBox);
}

function drawMap(s, inBox) {
  const map = ctx.map;
  const styles = new Map();
  const paths = [];
  const big = ctx.store.state.graph.nodes.length > 300;   // bản đồ lớn: bỏ nhãn số cho đỡ rối
  for (const [v, u] of state.prev) if (u >= 0) paths.push({ nodes: [u, v], color: 'var(--road)', width: 4, opacity: 0.55, animate: false });
  for (const id of state.settled) {
    const d = state.dist.get(id);
    styles.set(id, { fill: 'var(--road)', stroke: 'var(--map-bg)', r: big ? 3.5 : undefined, badge: big ? null : trace.algo === 'dfs' ? d + 1 : Number.isFinite(d) ? fmt.num(d) : null, badgeColor: 'var(--road)' });
  }
  for (const id of inBox) if (!state.settled.has(id)) styles.set(id, { ...(styles.get(id) || {}), fill: big ? 'var(--signal)' : undefined, r: big ? 3.5 : undefined, ring: big ? null : 'var(--signal)', badge: big || trace.algo === 'dfs' ? null : num(state.dist.get(id)), badgeColor: 'var(--ink)' });
  if (s.u >= 0) styles.set(s.u, { ...(styles.get(s.u) || {}), ring: 'var(--ink)', keep: true, label: true });
  if (s.v >= 0) styles.set(s.v, { ...(styles.get(s.v) || {}), ring: s.t === 'skip' ? 'var(--stop)' : 'var(--go)', keep: true, label: true });
  if (src != null) styles.set(src, { ...(styles.get(src) || {}), keep: true, label: true });
  if (s.u >= 0 && s.v >= 0) paths.push({ nodes: trace.algo === 'dfs' && s.t === 'pop' ? [s.v, s.u] : [s.u, s.v], color: s.t === 'skip' ? 'var(--stop)' : 'var(--go)', width: 7, animate: false, arrows: true });
  // Kết thúc: tô đường tới điểm đến
  if (idx === trace.steps.length - 1 && dst != null && trace.algo !== 'dfs') {
    const p = [];
    for (let v = dst, guardN = 0; v >= 0 && guardN < 5000; v = state.prev.get(v), guardN++) p.unshift(v);
    if (p[0] === src && p.length > 1) paths.push({ nodes: p, color: 'var(--signal)', width: 8, animate: false, arrows: true });
  }
  if (state.cycle && trace.cycle.length) paths.push({ nodes: trace.cycle, color: 'var(--stop)', width: 8, animate: false, arrows: true });
  map.setPaths(paths, { animate: false });
  map.setNodeStyles(styles);
  map.setDim(false);
  map.setLegend([
    { type: 'dot', color: 'var(--road)', label: trace.algo === 'bfs' || trace.algo === 'dfs' ? 'Đã thăm' : 'Đã chốt' },
    { type: 'dot', color: 'var(--signal-soft)', label: `Trong ${(CONTAINER[trace.container] || 'hàng chờ').toLowerCase()}` },
    { type: 'line', color: 'var(--go)', label: 'Cạnh vừa xét' },
    { type: 'line', color: 'var(--road)', label: 'Cây prev' },
  ]);
}

// ------------------------------------------------------------ Điều khiển
function syncForm() {
  const d = $('#l-dst-wrap', root), c = $('#l-crit-wrap', root);
  if (d) d.hidden = !needDst();
  if (c) c.hidden = !weighted();
  const sel = $('#l-dst', root);
  if (sel) sel.innerHTML = ctx.store.nodeOptions(dst, { includeEmpty: algo === 'dijkstra', emptyLabel: 'Không dừng sớm' });
}

async function load(btn) {
  if (src == null) return;
  if (algo === 'astar' && dst == null) { ctx.map.setHint('Chọn điểm đến cho A*'); return; }
  stop();
  await guard(async () => {
    trace = await api.get('trace', { algo, src, dst: needDst() ? dst : undefined, criterion, vehicle });
    annotate();
    state = null;
    $('#l-player', root).hidden = false;
    $('#l-container-title', root).textContent = CONTAINER[trace.container] || 'Vòng lặp';
    $('#l-alpha', root).textContent = trace.algo === 'astar' ? `h = ${fmt.num(trace.alpha, 3)} × đường chim bay` : '';
    goTo(0);
    ctx.map.setHint(null);
  }, btn);
}

export default {
  id: 'lab',
  title: 'Mô phỏng thuật toán',
  mount(panel, c) {
    ctx = c;
    const st = ctx.store.state;
    if (src == null || !ctx.store.nodesById.has(src)) src = st.depot >= 0 ? st.depot : st.graph.nodes[0]?.id ?? null;
    if (dst != null && !ctx.store.nodesById.has(dst)) dst = null;
    trace = null; state = null;
    root = document.createElement('div');
    root.innerHTML = `
      <div class="page-head"><h1>Mô phỏng thuật toán</h1></div>
      <div class="block">
        <div class="field"><span>Thuật toán</span>${segmented('algo', ALGOS, algo)}</div>
        <div class="row">
          <label class="field"><span>Điểm đầu</span><select id="l-src">${ctx.store.nodeOptions(src)}</select></label>
          <label class="field" id="l-dst-wrap"><span>Điểm đến</span><select id="l-dst"></select></label>
        </div>
        <div id="l-crit-wrap">
          <div class="field"><span>Trọng số</span>${segmented('crit', CRITERIA, criterion)}</div>
          <div class="field"><span>Loại xe</span>${segmented('veh', VEHICLES, vehicle)}</div>
        </div>
        <button class="btn primary block-btn" id="l-run">Bắt đầu</button>
      </div>
      <div id="l-player" hidden>
        <div class="block lab-player">
          <div class="split"><b id="l-step"></b><div style="width:170px">${segmented('speed', SPEEDS, speed)}</div></div>
          <p id="l-msg" class="lab-msg"></p>
          <p class="muted" id="l-alpha" style="font-size:12px"></p>
          <input type="range" id="l-slider" min="0" value="0" aria-label="Bước">
          <div class="actions" style="margin-top:6px"><button class="btn small" id="l-first" title="Về đầu">⏮</button><button class="btn small" id="l-prev" title="Lùi (←)">◀</button><button class="btn primary small" id="l-play" style="min-width:76px">Chạy</button><button class="btn small" id="l-next" title="Tiếp (→)">▶</button><button class="btn small" id="l-last" title="Tới cuối">⏭</button></div>
        </div>
        <div class="block"><h2>Mã giả</h2><div class="lab-code" id="l-code"></div></div>
        <div class="block"><h2 id="l-container-title"></h2><div id="l-container"></div></div>
        <div class="block"><h2>Bảng khoảng cách</h2><div class="table-wrap" id="l-table"></div></div>
      </div>`;
    panel.append(root);
    syncForm();
    bindSegmented(root, (n, v) => {
      if (n === 'algo') { algo = v; syncForm(); if (trace) load(); }
      else if (n === 'crit') { criterion = v; if (trace) load(); }
      else if (n === 'veh') { vehicle = v; if (trace) load(); }
      else if (n === 'speed') { speed = v; if (timer) play(); }
    });
    $('#l-src', root).addEventListener('change', (e) => { src = Number(e.target.value); if (trace) load(); });
    $('#l-dst', root).addEventListener('change', (e) => { dst = e.target.value === '' ? null : Number(e.target.value); if (trace) load(); });
    $('#l-run', root).addEventListener('click', (e) => load(e.currentTarget));
    $('#l-play', root).addEventListener('click', () => (timer ? stop() : play()));
    $('#l-prev', root).addEventListener('click', () => { stop(); goTo(idx - 1); });
    $('#l-next', root).addEventListener('click', () => { stop(); goTo(idx + 1); });
    $('#l-first', root).addEventListener('click', () => { stop(); goTo(0); });
    $('#l-last', root).addEventListener('click', () => { stop(); goTo(trace.steps.length - 1); });
    $('#l-slider', root).addEventListener('input', (e) => { stop(); goTo(Number(e.target.value)); });
    keyHandler = (e) => {
      if (!trace || e.target.closest('input, select, textarea')) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); stop(); goTo(idx + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); stop(); goTo(idx - 1); }
    };
    document.addEventListener('keydown', keyHandler);
    // Bấm bản đồ: lần 1 chọn điểm đầu, lần 2 chọn điểm đến (nếu thuật toán cần)
    let pickDst = false;
    ctx.onMap('nodeclick', (id) => {
      if (needDst() && pickDst) { dst = id; pickDst = false; syncForm(); }
      else { src = id; $('#l-src', root).value = id; pickDst = needDst(); }
      ctx.map.setHint(pickDst ? 'Chọn điểm đến' : null);
      if (!pickDst) load();
      else { trace = null; $('#l-player', root).hidden = true; ctx.map.setNodeStyles(new Map([[src, { ring: 'var(--go)', keep: true, label: true }]])); ctx.map.setPaths([]); }
    });
    ctx.map.setPicking(true);
    ctx.map.setHint('Chọn điểm đầu trên bản đồ');
  },
  unmount() {
    stop();
    document.removeEventListener('keydown', keyHandler);
    root = null;
  },
  onState() {
    stop();
    trace = null; state = null;
    if (!root) return;
    if (!ctx.store.nodesById.has(src)) src = ctx.store.state.depot;
    if (dst != null && !ctx.store.nodesById.has(dst)) dst = null;
    $('#l-src', root).innerHTML = ctx.store.nodeOptions(src);
    syncForm();
    $('#l-player', root).hidden = true;
    ctx.map.setPaths([]);
    ctx.map.setNodeStyles(new Map());
    ctx.map.setLegend([]);
  },
};
