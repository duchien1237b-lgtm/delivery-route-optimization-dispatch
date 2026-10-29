// Trang Duyệt mạng: BFS, DFS, thành phần liên thông, vùng giao hàng, chia vùng nhiều kho.
import { api } from '../api.js';
import { escapeHtml } from '../store.js';
import { $, guard, segmented, bindSegmented, ROUTE_COLORS } from '../ui.js';

let ctx, root;
let tab = 'traverse';
let start = null, algo = 'bfs', hops = 2, zoneDepot = null;
let depots = null;
let last = null;  // kết quả gần nhất của tab hiện tại

const TABS = [
  { v: 'traverse', label: 'BFS / DFS' },
  { v: 'components', label: 'Liên thông' },
  { v: 'zone', label: 'Vùng giao' },
  { v: 'zones', label: 'Chia vùng' },
];
const HOP_COLORS = ['#1b2633', '#1a4fa3', '#4a74bd', '#7f9dd2', '#b3c5e6', '#d9e3f3', '#eef3fa'];
const name = (id) => escapeHtml(ctx.store.name(id));
// Danh sách tên rút gọn khi bản đồ lớn
const names = (ids, max = 12) => ids.slice(0, max).map(name).join(', ') + (ids.length > max ? ` và ${ids.length - max} điểm khác` : '');

function setTab(t) {
  tab = t;
  last = null;
  root.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  renderBody();
  if (tab === 'components') runComponents();
  else if (tab === 'zones') runZones();
  else draw();
}

function renderBody() {
  const box = $('#x-body', root);
  const st = ctx.store.state;
  if (tab === 'traverse') {
    box.innerHTML = `<div class="block">
      <label class="field"><span>Bắt đầu từ</span><select id="x-start">${ctx.store.nodeOptions(start)}</select></label>
      <div class="field"><span>Cách duyệt</span>${segmented('algo', [{ v: 'bfs', label: 'BFS' }, { v: 'dfs', label: 'DFS đệ quy' }, { v: 'dfsi', label: 'DFS dùng stack' }], algo)}</div>
      <button class="btn primary block-btn" id="x-run">Duyệt</button></div><div id="x-out"></div>`;
    $('#x-start', box).addEventListener('change', (e) => { start = Number(e.target.value); });
    bindSegmented(box, (n, v) => { algo = v; if (last) runTraverse(); });
    $('#x-run', box).addEventListener('click', (e) => runTraverse(e.currentTarget));
    ctx.map.setHint('Chọn điểm bắt đầu');
  } else if (tab === 'components') {
    box.innerHTML = '<div id="x-out"></div>';
    ctx.map.setHint(null);
  } else if (tab === 'zone') {
    box.innerHTML = `<div class="block">
      <label class="field"><span>Kho</span><select id="x-depot">${ctx.store.nodeOptions(zoneDepot ?? st.depot)}</select></label>
      <label class="field"><span>Tối đa <b id="x-hops-v">${hops}</b> chặng</span><input type="range" id="x-hops" min="0" max="8" value="${hops}"></label></div><div id="x-out"></div>`;
    $('#x-depot', box).addEventListener('change', (e) => { zoneDepot = Number(e.target.value); runZone(); });
    $('#x-hops', box).addEventListener('input', (e) => { hops = Number(e.target.value); $('#x-hops-v', box).textContent = hops; runZone(); });
    ctx.map.setHint('Chọn kho');
    runZone();
  } else {
    box.innerHTML = `<div class="block"><h2>Các kho</h2><div class="chips" id="x-depots"></div></div><div id="x-out"></div>`;
    ctx.map.setHint('Bấm điểm để thêm hoặc bỏ kho');
  }
}

async function runTraverse(btn) {
  if (start == null) return;
  await guard(async () => {
    last = await api.get('traverse', { start, algo });
    const out = $('#x-out', root);
    const label = { bfs: 'BFS', dfs: 'DFS đệ quy', dfsi: 'DFS dùng stack' }[algo];
    const total = ctx.store.state.graph.nodes.length;
    out.innerHTML = `<div class="block"><div class="split"><h2>Thứ tự thăm (${label})</h2><span class="muted">${last.order.length}/${total} điểm</span></div>
      <ol class="order-list">${last.order.slice(0, 120).map((id) => `<li>${name(id)}</li>`).join('')}</ol>${last.order.length > 120 ? `<p class="muted" style="font-size:12.5px;margin-top:6px">và ${last.order.length - 120} điểm nữa</p>` : ''}
      ${last.order.length < total ? `<div class="notice warn">${total - last.order.length} điểm không tới được.</div>` : ''}</div>`;
    draw();
  }, btn);
}

async function runComponents() {
  await guard(async () => {
    last = await api.get('components');
    const st = ctx.store.state;
    const out = $('#x-out', root);
    const list = (comps) => comps.slice(0, 30).map((c, i) => `<tr><td><span class="swatch" style="display:inline-block;background:${ROUTE_COLORS[i % ROUTE_COLORS.length]}"></span></td><td>${names(c)}</td><td class="num">${c.length}</td></tr>`).join('') + (comps.length > 30 ? `<tr><td></td><td class="muted">và ${comps.length - 30} thành phần nhỏ khác</td><td></td></tr>` : '');
    out.innerHTML = `<div class="block"><h2>${last.connected ? 'Bản đồ liên thông' : `${last.components.length} thành phần liên thông`}</h2>
      ${st.graph.directed ? '<p class="sub">Liên thông yếu (bỏ qua chiều đường)</p>' : ''}
      <table class="data"><tbody>${list(last.components)}</tbody></table>
      ${last.unreachableFromDepot.length ? `<div class="notice warn">Kho không tới được: ${names(last.unreachableFromDepot)}</div>` : '<div class="notice ok">Kho tới được mọi điểm.</div>'}
    </div>
    ${st.graph.directed ? `<div class="block"><div class="split"><h2>${last.strong.length} thành phần liên thông mạnh</h2><span class="muted" style="font-size:12px">Kosaraju</span></div><table class="data"><tbody>${list(last.strong)}</tbody></table></div>` : ''}`;
    draw();
  });
}

async function runZone() {
  const depot = zoneDepot ?? ctx.store.state.depot;
  if (depot == null || depot < 0) return;
  await guard(async () => {
    last = await api.get('zone', { depot, hops });
    const out = $('#x-out', root);
    const entries = Object.entries(last.zone).map(([id, h]) => [Number(id), h]).sort((a, b) => a[1] - b[1]);
    const total = ctx.store.state.graph.nodes.length;
    out.innerHTML = `<div class="block"><div class="split"><h2>Trong ${hops} chặng</h2><span class="muted">${entries.length}/${total} điểm</span></div>
      <table class="data"><thead><tr><th>Điểm</th><th class="num">Số chặng</th></tr></thead><tbody>${entries.slice(0, 150).map(([id, h]) => `<tr><td>${name(id)}</td><td class="num">${h}</td></tr>`).join('')}</tbody></table></div>`;
    draw();
  });
}

async function runZones() {
  const st = ctx.store.state;
  if (!depots) {
    depots = [st.depot];
    // Gợi ý kho thứ hai: điểm xa kho chính nhất (đường chim bay) trong số điểm có từ 2 đường
    const d0 = ctx.store.nodesById.get(st.depot);
    let far = null, best = -1;
    for (const n of st.graph.nodes) {
      if (!d0 || n.id === st.depot || n.degree < 2) continue;
      const dd = (n.x - d0.x) ** 2 + (n.y - d0.y) ** 2;
      if (dd > best) { best = dd; far = n; }
    }
    if (far) depots.push(far.id);
  }
  depots = depots.filter((d) => ctx.store.nodesById.has(d));
  $('#x-depots', root).innerHTML = depots.length
    ? depots.map((d, i) => `<span class="chip" style="border-color:${ROUTE_COLORS[i % ROUTE_COLORS.length]}"><span class="swatch" style="background:${ROUTE_COLORS[i % ROUTE_COLORS.length]}"></span>${name(d)}<button data-rm="${d}" aria-label="Bỏ kho ${name(d)}">×</button></span>`).join('')
    : '<span class="muted">Bấm điểm trên bản đồ để thêm kho.</span>';
  root.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { depots = depots.filter((x) => x !== Number(b.dataset.rm)); runZones(); }));
  if (!depots.length) { last = null; $('#x-out', root).innerHTML = ''; draw(); return; }
  await guard(async () => {
    last = await api.get('zones', { depots: depots.join(',') });
    const out = $('#x-out', root);
    out.innerHTML = `<div class="block"><table class="data"><tbody>${depots.map((d, i) => {
      const members = Object.entries(last.owner).filter(([, o]) => o === d).map(([id]) => Number(id));
      return `<tr><td><span class="swatch" style="display:inline-block;background:${ROUTE_COLORS[i % ROUTE_COLORS.length]}"></span></td><td><b>${name(d)}</b><br><small class="muted">${names(members.filter((m) => m !== d)) || 'chỉ có kho'}</small></td><td class="num">${members.length}</td></tr>`;
    }).join('')}</tbody></table>
    ${last.unassigned.length ? `<div class="notice warn">Không kho nào tới được: ${names(last.unassigned)}</div>` : ''}</div>`;
    draw();
  });
}

function draw() {
  const map = ctx.map;
  const styles = new Map();
  map.setDim(false);
  map.setPaths([]);
  if (tab === 'traverse') {
    if (start != null) styles.set(start, { ring: 'var(--go)', keep: true });
    if (last && last.order) {
      const big = ctx.store.state.graph.nodes.length > 300;
      last.order.slice(0, big ? 40 : Infinity).forEach((id, i) => styles.set(id, { ...(styles.get(id) || {}), badge: i + 1, badgeColor: 'var(--road)' }));
      const seen = new Set(last.order);
      for (const n of ctx.store.state.graph.nodes) if (!seen.has(n.id)) styles.set(n.id, { dim: true });
      map.setPaths(last.tree.map(([u, v]) => ({ nodes: [u, v], color: 'var(--road)', width: 5, opacity: 0.75 })));
      map.setLegend([{ type: 'badge', color: 'var(--road)', label: 'Thứ tự thăm' }, { type: 'line', color: 'var(--road)', label: 'Cây duyệt' }]);
    } else map.setLegend([]);
  } else if (tab === 'components' && last) {
    const comps = ctx.store.state.graph.directed ? last.strong : last.components;
    const big = ctx.store.state.graph.nodes.length > 300;
    comps.forEach((c, i) => c.forEach((id) => styles.set(id, { fill: ROUTE_COLORS[i % ROUTE_COLORS.length], stroke: 'var(--map-bg)', r: big ? 4 : 8 })));
    map.setLegend([{ type: 'dot', color: ROUTE_COLORS[0], label: 'Mỗi màu một thành phần' }]);
  } else if (tab === 'zone' && last) {
    for (const n of ctx.store.state.graph.nodes) {
      const h = last.zone[n.id];
      if (h == null) styles.set(n.id, { dim: true });
      else styles.set(n.id, { fill: HOP_COLORS[Math.min(h, HOP_COLORS.length - 1)], stroke: 'var(--ink)', badge: ctx.store.state.graph.nodes.length > 300 ? null : h, badgeColor: 'var(--ink)', r: ctx.store.state.graph.nodes.length > 300 ? 4 : 8 });
    }
    map.setLegend([{ type: 'badge', color: 'var(--ink)', label: 'Số chặng từ kho' }]);
  } else if (tab === 'zones' && last) {
    for (const n of ctx.store.state.graph.nodes) {
      const o = last.owner[n.id];
      if (o == null) { styles.set(n.id, { dim: true }); continue; }
      const i = depots.indexOf(o);
      const big = ctx.store.state.graph.nodes.length > 300;
      styles.set(n.id, { fill: ROUTE_COLORS[i % ROUTE_COLORS.length], stroke: 'var(--map-bg)', r: depots.includes(n.id) ? 10 : big ? 4 : 7, ring: depots.includes(n.id) ? ROUTE_COLORS[i % ROUTE_COLORS.length] : null, badge: depots.includes(n.id) ? 'Kho' : big ? null : last.hops[n.id], badgeColor: 'var(--ink)', keep: depots.includes(n.id) });
    }
    map.setLegend([{ type: 'badge', color: 'var(--ink)', label: 'Số chặng tới kho' }]);
  } else map.setLegend([]);
  map.setNodeStyles(styles);
}

export default {
  id: 'explore',
  title: 'Duyệt mạng lưới',
  mount(panel, c) {
    ctx = c;
    const st = ctx.store.state;
    if (start == null || !ctx.store.nodesById.has(start)) start = st.depot >= 0 ? st.depot : st.graph.nodes[0]?.id ?? null;
    root = document.createElement('div');
    root.innerHTML = `<div class="page-head"><h1>Duyệt mạng lưới</h1></div>
      <div class="tabs" role="tablist">${TABS.map((t) => `<button role="tab" data-tab="${t.v}" aria-selected="${t.v === tab}">${t.label}</button>`).join('')}</div>
      <div id="x-body"></div>`;
    panel.append(root);
    root.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
    ctx.onMap('nodeclick', (id) => {
      if (tab === 'traverse') { start = id; $('#x-start', root).value = id; runTraverse(); }
      else if (tab === 'zone') { zoneDepot = id; $('#x-depot', root).value = id; runZone(); }
      else if (tab === 'zones') { depots = depots.includes(id) ? depots.filter((d) => d !== id) : [...depots, id]; runZones(); }
    });
    ctx.map.setPicking(true);
    setTab(tab);
  },
  unmount() { root = null; },
  onState() {
    if (start != null && !ctx.store.nodesById.has(start)) start = ctx.store.state.depot;
    if (zoneDepot != null && !ctx.store.nodesById.has(zoneDepot)) zoneDepot = null;
    depots = null;
    setTab(tab);
  },
};
