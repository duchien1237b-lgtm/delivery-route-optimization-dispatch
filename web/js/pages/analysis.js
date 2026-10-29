// Trang Phân tích (phần mở rộng): đoạn đường / giao lộ trọng yếu (Tarjan), mạng đường tối thiểu
// (Kruskal so với Prim) và gợi ý vị trí đặt kho (Floyd–Warshall, tâm đồ thị). Mọi thuật toán chạy ở backend.
import { api } from '../api.js';
import { escapeHtml } from '../store.js';
import { $, fmt, guard, toast, segmented, bindSegmented, VEHICLES } from '../ui.js';

let ctx, root;
let tab = 'critical';
let vehicle = '0';
let data = null;        // kết quả /api/analysis gần nhất
let dataKey = '';       // bộ dữ liệu + kho + phiên bản đồ thị khi lấy kết quả
let pick = null;        // mục đang chọn trong danh sách

const TABS = [
  { v: 'critical', label: 'Đoạn trọng yếu' },
  { v: 'mst', label: 'Mạng tối thiểu' },
  { v: 'depot', label: 'Vị trí kho' },
];
const name = (id) => escapeHtml(ctx.store.name(id));
const keyOf = (st) => `${st.dataset}|${st.depot}|${st.graph.stats.nodes}|${st.graph.stats.edges}|${st.orders.length}|${vehicle}`;

async function load(btn) {
  await guard(async () => {
    data = await api.get('analysis', { vehicle });
    dataKey = keyOf(ctx.store.state);
    render();
  }, btn);
}

function setTab(t) {
  tab = t;
  pick = null;
  root.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  render();
}

// ------------------------------------------------------------------ Trọng yếu
function renderCritical(box) {
  const c = data.critical;
  const inDepot = c.bridges.filter((b) => b.cutOrders > 0 || b.cutNodes > 0);
  const bridges = c.bridges.slice(0, 40), arts = c.articulation.slice(0, 40);
  const impact = (x) => `<span class="an-num"><b>${x.cutOrders}</b>${x.cutOrders ? 'đơn mất đường' : `${x.cutNodes} điểm`}</span>`;
  box.innerHTML = `<div class="block">
      <p class="sub">Tarjan: một lần DFS từ kho, so <b>low</b> với <b>disc</b> của từng đỉnh, O(V + E) · ${fmt.us(c.micros)}</p>
      ${c.bridges.length + c.articulation.length === 0
        ? '<div class="notice ok">Mọi đoạn đường đều có đường vòng: đóng bất kỳ một đoạn hay một giao lộ nào cũng không làm mất kết nối.</div>'
        : `<div class="notice ${inDepot.some((b) => b.cutOrders) ? 'warn' : 'info'}">${c.bridges.length} đoạn đường là <b>cầu</b> (đóng là mất kết nối) và ${c.articulation.length} giao lộ là <b>khớp</b>. ${inDepot.some((b) => b.cutOrders) ? 'Có đơn hàng phụ thuộc vào các đoạn này.' : 'Không đơn nào phụ thuộc vào chúng.'}</div>`}
    </div>
    ${bridges.length ? `<div class="block"><div class="split"><h2>Đoạn đường trọng yếu <span class="count">${c.bridges.length}</span></h2></div>
      <ul class="an-list">${bridges.map((b, i) => `<li data-b="${i}" class="${pick && pick.b === i ? 'active' : ''}"><span class="an-rank">${i + 1}</span><span class="li-main"><b>${name(b.u)} ↔ ${name(b.v)}</b><small>${fmt.km(b.km)} · phía bên kia có ${b.cutNodes} điểm</small></span>${impact(b)}</li>`).join('')}</ul>
      ${pick && pick.b != null ? `<div class="actions" style="margin-top:10px"><button class="btn" id="a-close">Thử đóng đoạn này</button><span class="muted" style="font-size:12.5px">Hoàn tác được bằng Ctrl+Z</span></div>` : ''}
    </div>` : ''}
    ${arts.length ? `<div class="block"><div class="split"><h2>Giao lộ trọng yếu <span class="count">${c.articulation.length}</span></h2></div>
      <ul class="an-list">${arts.map((a, i) => `<li data-a="${i}" class="${pick && pick.a === i ? 'active' : ''}"><span class="an-rank">${i + 1}</span><span class="li-main"><b>${escapeHtml(a.name)}</b><small>bỏ đi thì cụm vỡ thành ${a.parts} phần, tách ${a.cutNodes} điểm</small></span>${impact(a)}</li>`).join('')}</ul>
    </div>` : ''}`;
  box.querySelectorAll('[data-b]').forEach((li) => li.addEventListener('click', () => { pick = { b: Number(li.dataset.b) }; render(); const b = c.bridges[pick.b]; ctx.map.ensureVisible([b.u, b.v]); }));
  box.querySelectorAll('[data-a]').forEach((li) => li.addEventListener('click', () => { pick = { a: Number(li.dataset.a) }; render(); ctx.map.focusNode(c.articulation[pick.a].node); }));
  $('#a-close', box)?.addEventListener('click', (e) => {
    const b = c.bridges[pick.b];
    guard(async () => {
      await ctx.store.mutate('traffic', { u: b.u, v: b.v, jam: 1, closed: 1 });
      toast(`Đã đóng ${ctx.store.name(b.u)} ↔ ${ctx.store.name(b.v)}: ${b.cutOrders} đơn không còn đường từ kho`);
    }, e.currentTarget);
  });
}

// ------------------------------------------------------------------ MST
function renderMst(box) {
  const { kruskal: k, prim: p, totalKm } = data.mst;
  const faster = k.micros <= p.micros ? 'k' : 'p';
  box.innerHTML = `<div class="block">
      <p class="sub">Cây khung nhỏ nhất theo km: nối mọi điểm với tổng đường ngắn nhất (vd. tuyến xe thu gom, ưu tiên bảo trì).</p>
      <div class="an-compare">
        <div class="${faster === 'k' ? 'win' : ''}"><b>${fmt.us(k.micros)}</b><span>Kruskal · sắp xếp cạnh + DSU, ${fmt.num(k.work, 0)} lần find</span></div>
        <div class="${faster === 'p' ? 'win' : ''}"><b>${fmt.us(p.micros)}</b><span>Prim · Min-Heap tự cài, ${fmt.num(p.work, 0)} thao tác heap</span></div>
      </div>
      <div class="kpis"><div class="kpi"><b>${fmt.km(k.km)}</b><span>mạng tối thiểu</span></div><div class="kpi"><b>${fmt.km(totalKm)}</b><span>toàn bộ đường</span></div><div class="kpi"><b>${fmt.num(totalKm > 0 ? (k.km / totalKm) * 100 : 0, 0)}%</b><span>tỉ lệ</span></div></div>
      ${Math.abs(k.km - p.km) < 1e-6 ? '<div class="notice ok">Hai thuật toán cho cùng tổng km, đúng như lý thuyết.</div>' : `<div class="notice error">Kruskal ${fmt.km(k.km)} khác Prim ${fmt.km(p.km)}</div>`}
      ${k.trees > 1 ? `<div class="notice info">Bản đồ có ${k.trees} cụm không nối nhau nên kết quả là <b>rừng</b> ${k.trees} cây.</div>` : ''}
    </div>
    ${k.edges.length <= 60 ? `<div class="block"><h2>Các đoạn được chọn <span class="count">${k.edges.length}</span></h2>
      <table class="data"><tbody>${k.edges.map((e) => `<tr><td>${name(e.u)} – ${name(e.v)}</td><td class="num">${fmt.km(e.km)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
}

// ------------------------------------------------------------------ Vị trí kho
function renderDepot(box) {
  const d = data.depotSuggest;
  const cur = d.current;
  const best = d.ranking[0];
  const st = ctx.store.state;
  const gain = best && cur && best.reachable === cur.reachable ? cur.totalKm - best.totalKm : 0;
  box.innerHTML = `<div class="block">
      <div class="field"><span>Tính khoảng cách cho</span>${segmented('veh', VEHICLES.slice(0, 3), vehicle)}</div>
      <p class="sub">${d.floyd ? 'Floyd–Warshall O(V³) tính khoảng cách mọi cặp điểm' : 'Đồ thị lớn: Dijkstra ngược từ từng điểm giao'}, chấm mỗi điểm theo tổng km tới ${d.orders} đơn · ${fmt.us(d.micros)}</p>
      <div class="an-compare">
        <div><b>${fmt.km(cur.avgKm)}</b><span>kho hiện tại (${name(st.depot)}) · trung bình mỗi đơn, ${cur.reachable}/${d.orders} đơn tới được</span></div>
        <div class="${gain > 1e-6 ? 'win' : ''}"><b>${best ? fmt.km(best.avgKm) : '–'}</b><span>tốt nhất: ${best ? name(best.node) : '–'}${gain > 1e-6 ? ` · ít hơn ${fmt.km(gain)} tổng` : ''}</span></div>
      </div>
      ${best && best.node === st.depot ? '<div class="notice ok">Kho hiện tại đã là vị trí tốt nhất.</div>' : ''}
      ${d.center != null && d.center >= 0 ? `<p class="muted" style="font-size:12.5px">Tâm đồ thị (điểm có khoảng cách xa nhất nhỏ nhất): <b>${escapeHtml(d.centerName)}</b>, xa nhất ${fmt.km(d.centerEccentricity)}.</p>` : ''}
    </div>
    <div class="block"><h2>Xếp hạng vị trí</h2>
      <ul class="an-list">${d.ranking.map((r, i) => `<li data-n="${r.node}" class="${i === 0 ? 'best' : ''}"><span class="an-rank">${i + 1}</span><span class="li-main"><b>${escapeHtml(r.name)}</b><small>xa nhất ${fmt.km(r.maxKm)} · ${r.reachable}/${d.orders} đơn${r.node === st.depot ? ' · kho hiện tại' : ''}</small></span><span class="an-num"><b>${fmt.km(r.avgKm)}</b>/ đơn</span>${r.node === st.depot ? '' : `<button class="btn small" data-set="${r.node}">Đặt làm kho</button>`}</li>`).join('')}</ul>
    </div>`;
  bindSegmented(box, (n, v) => { vehicle = v; load(); });
  box.querySelectorAll('li[data-n]').forEach((li) => li.addEventListener('click', (e) => { if (!e.target.closest('button')) ctx.map.focusNode(Number(li.dataset.n)); }));
  box.querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', () => guard(async () => {
    if (ctx.store.state.shift.active && !confirm('Đổi kho sẽ huỷ ca giao đang chạy. Tiếp tục?')) return;
    await ctx.store.mutate('depot', { id: b.dataset.set });
    toast(`Kho mới: ${ctx.store.name(Number(b.dataset.set))}`);
    await load();
  }, b)));
}

// ------------------------------------------------------------------ Bản đồ
// Kết quả phân tích bỏ chiều đường: tô cả hai chiều (bản đồ một chiều chỉ có một trong hai)
const both = (m, e, style) => { m.set(`${e.u}-${e.v}`, style); m.set(`${e.v}-${e.u}`, style); };

function drawMap() {
  const map = ctx.map;
  const styles = new Map(), edges = new Map(), legend = [];
  map.setPaths([]);
  if (!data) { map.setNodeStyles(styles); map.setEdgeStyles(edges); map.setDim(false); map.setLegend([]); return; }
  if (tab === 'critical') {
    const c = data.critical;
    c.bridges.forEach((b, i) => both(edges, b, { color: pick && pick.b === i ? 'var(--signal)' : 'var(--stop)', width: pick && pick.b === i ? 8 : 5 }));
    c.articulation.forEach((a, i) => styles.set(a.node, { ring: pick && pick.a === i ? 'var(--signal)' : 'var(--stop)', keep: true, badge: a.cutOrders ? a.cutOrders : null, badgeColor: 'var(--stop)', tip: `Giao lộ trọng yếu: bỏ đi thì tách ${a.cutNodes} điểm, ${a.cutOrders} đơn` }));
    if (c.bridges.length) legend.push({ type: 'line', color: 'var(--stop)', label: 'Đoạn trọng yếu (cầu)' });
    if (c.articulation.length) legend.push({ type: 'dot', color: 'var(--stop)', label: 'Giao lộ trọng yếu (khớp)' });
    map.setDim(c.bridges.length > 0);
  } else if (tab === 'mst') {
    for (const e of data.mst.kruskal.edges) both(edges, e, { color: 'var(--brand)', width: 5 });
    legend.push({ type: 'line', color: 'var(--brand)', label: `Mạng tối thiểu ${fmt.km(data.mst.kruskal.km)}` });
    map.setDim(true);
  } else {
    const d = data.depotSuggest;
    d.ranking.forEach((r, i) => styles.set(r.node, { badge: i + 1, badgeColor: i === 0 ? 'var(--brand)' : 'var(--road)', keep: true, label: true, tip: `Hạng ${i + 1}: trung bình ${fmt.km(r.avgKm)} mỗi đơn` }));
    if (d.center != null && d.center >= 0) styles.set(d.center, { ...(styles.get(d.center) || {}), ring: 'var(--violet)', keep: true, label: true });
    legend.push({ type: 'badge', color: 'var(--brand)', label: 'Vị trí kho gợi ý' });
    if (d.center >= 0) legend.push({ type: 'dot', color: 'var(--violet)', label: 'Tâm đồ thị' });
    map.setDim(false);
  }
  map.setEdgeStyles(edges);
  map.setNodeStyles(styles);
  map.setLegend(legend);
}

function render() {
  const box = $('#a-body', root);
  if (!box) return;
  if (!data) { box.innerHTML = '<p class="empty">Đang phân tích…</p>'; drawMap(); return; }
  if (tab === 'critical') renderCritical(box);
  else if (tab === 'mst') renderMst(box);
  else renderDepot(box);
  drawMap();
}

export default {
  id: 'analysis',
  title: 'Phân tích mạng',
  mount(panel, c) {
    ctx = c;
    root = document.createElement('div');
    root.innerHTML = `<div class="page-head"><h1>Phân tích</h1><button class="btn small ghost" id="a-refresh">Tính lại</button></div>
      <div class="tabs" role="tablist">${TABS.map((t) => `<button role="tab" data-tab="${t.v}" aria-selected="${t.v === tab}">${t.label}</button>`).join('')}</div>
      <div id="a-body"></div>`;
    panel.append(root);
    root.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
    $('#a-refresh', root).addEventListener('click', (e) => load(e.currentTarget));
    ctx.map.setHint(null);
    if (data && dataKey === keyOf(ctx.store.state)) render();
    else { data = null; render(); load(); }
  },
  unmount() { root = null; ctx.map.setEdgeStyles(new Map()); },
  onState(state) {
    if (!root) return;
    if (keyOf(state) !== dataKey) load();
  },
};
