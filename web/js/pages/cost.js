// Trang Chi phí: Bellman-Ford (cạnh âm, chu trình âm) và dự toán tuyến nhiều điểm.
import { api } from '../api.js';
import { escapeHtml } from '../store.js';
import { $, fmt, guard, segmented, bindSegmented, VEHICLES, CRITERIA, ROUTE_COLORS, hhmm, timeToMinutes, getShiftStart } from '../ui.js';

let ctx, root;
let tab = 'bellman';
let bfSrc = null, bfCrit = 'cost', bfVeh = '3', bfRes = null, bfPick = null;
let estDepot = null, stops = [], estVeh = '0', estBack = true, estRes = null, estDepart = null;

const name = (id) => escapeHtml(ctx.store.name(id));
const UNIT = { distance: fmt.km, time: fmt.min, cost: fmt.k };

function setTab(t) {
  tab = t;
  root.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  renderBody();
}

function renderBody() {
  const box = $('#c-body', root);
  const st = ctx.store.state;
  if (tab === 'bellman') {
    box.innerHTML = `<div class="block">
      <label class="field"><span>Điểm nguồn</span><select id="c-src">${ctx.store.nodeOptions(bfSrc)}</select></label>
      <div class="field"><span>Trọng số</span>${segmented('crit', CRITERIA, bfCrit)}</div>
      <div class="field"><span>Loại xe</span>${segmented('veh', VEHICLES, bfVeh)}</div>
      <button class="btn primary block-btn" id="c-run">Chạy Bellman-Ford</button>
    </div><div id="c-out"></div>`;
    $('#c-src', box).addEventListener('change', (e) => { bfSrc = Number(e.target.value); runBellman(); });
    bindSegmented(box, (n, v) => { if (n === 'crit') bfCrit = v; else bfVeh = v; if (bfRes) runBellman(); });
    $('#c-run', box).addEventListener('click', (e) => runBellman(e.currentTarget));
    ctx.map.setHint('Chọn điểm nguồn');
    renderBellman();
  } else {
    if (estDepot == null || !ctx.store.nodesById.has(estDepot)) estDepot = st.depot;
    if (estDepart == null) estDepart = getShiftStart();
    box.innerHTML = `<div class="block">
      <label class="field"><span>Kho</span><select id="c-depot">${ctx.store.nodeOptions(estDepot)}</select></label>
      <div class="field"><span>Các điểm giao, theo thứ tự</span><div class="chips" id="c-stops"></div></div>
      <div class="row"><div class="field" style="flex:2.2"><span>Loại xe</span>${segmented('eveh', VEHICLES.slice(0, 3), estVeh)}</div>
      <label class="field"><span>Giờ đi</span><input type="time" id="c-depart" value="${hhmm(estDepart)}" ${st.settings.rush.enabled ? '' : 'disabled title="Giờ cao điểm đang tắt"'}></label></div>
      <div class="run-row"><button class="btn primary block-btn" id="c-est">Dự toán</button><label class="check"><input type="checkbox" id="c-back" ${estBack ? 'checked' : ''}> Quay về kho</label></div>
    </div><div id="c-out"></div>`;
    $('#c-depot', box).addEventListener('change', (e) => { estDepot = Number(e.target.value); estRes = null; renderStops(); });
    bindSegmented(box, (n, v) => { estVeh = v; if (estRes) runEstimate(); });
    $('#c-back', box).addEventListener('change', (e) => { estBack = e.target.checked; if (estRes) runEstimate(); });
    $('#c-depart', box).addEventListener('change', (e) => { if (!e.target.value) return; estDepart = timeToMinutes(e.target.value); if (estRes) runEstimate(); });
    $('#c-est', box).addEventListener('click', (e) => runEstimate(e.currentTarget));
    ctx.map.setHint('Bấm các điểm giao theo thứ tự');
    renderStops();
  }
}

// ---------------------------------------------------------------- Bellman-Ford
async function runBellman(btn) {
  if (bfSrc == null) return;
  await guard(async () => {
    bfRes = await api.get('bellman', { src: bfSrc, criterion: bfCrit, vehicle: bfVeh });
    bfPick = null;
    renderBellman();
  }, btn);
}

function renderBellman() {
  const out = $('#c-out', root);
  if (!out) return;
  if (!bfRes) { out.innerHTML = ''; drawBellman(); return; }
  const r = bfRes;
  const unit = UNIT[bfCrit];
  let head;
  if (r.negativeCycle) {
    head = `<div class="notice error"><b>Chu trình âm:</b> ${r.cycle.map(name).join(' → ')}. Không có đường rẻ nhất tới các điểm bị ảnh hưởng.</div>`;
  } else if (r.anyCycle && r.anyCycle.length) {
    head = `<div class="notice warn">Đồ thị có chu trình âm ${r.anyCycle.map(name).join(' → ')}, nhưng không tới được từ điểm nguồn.</div>`;
  } else if (r.hasNegativeEdge) {
    head = '<div class="notice info">Có cạnh âm, không có chu trình âm. Dòng đỏ là chỗ Dijkstra sai.</div>';
  } else {
    head = '';
  }
  // Bản đồ lớn: chỉ liệt kê các điểm có kết quả khác Dijkstra trước, rồi tới các điểm còn lại (tối đa 200 dòng)
  const isDiff = (row) => row.dist != null && row.dijkstra != null && Math.abs(row.dist - row.dijkstra) > 1e-6;
  const ordered = r.rows.length > 200 ? [...r.rows.filter(isDiff), ...r.rows.filter((x) => !isDiff(x))].slice(0, 200) : r.rows;
  const rows = ordered.map((row) => {
    const diff = row.dist != null && row.dijkstra != null && Math.abs(row.dist - row.dijkstra) > 1e-6;
    return `<tr class="clickable ${bfPick === row.id ? 'active' : ''} ${diff ? 'bad' : ''}" data-id="${row.id}"><td>${escapeHtml(row.name)}</td><td class="num">${row.id === bfSrc ? 'nguồn' : row.dist == null ? (r.negativeCycle ? '–' : 'không tới') : unit(row.dist)}</td><td class="num">${row.dijkstra == null ? '–' : unit(row.dijkstra)}${diff ? ' ✕' : ''}</td></tr>`;
  }).join('');
  out.innerHTML = `<div class="block"><div class="split"><h2>Từ ${name(bfSrc)}</h2><span class="muted" style="font-size:12px">${r.iterations} vòng, ${fmt.num(r.relaxations, 0)} lần nới, ${fmt.us(r.micros)}</span></div>
    ${r.rows.length > 200 ? `<p class="sub">200/${r.rows.length} điểm</p>` : ''}${head}
    <div class="table-wrap"><table class="data"><thead><tr><th>Điểm</th><th class="num">Bellman-Ford</th><th class="num">Dijkstra</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  out.querySelectorAll('[data-id]').forEach((tr) => tr.addEventListener('click', () => { bfPick = Number(tr.dataset.id); renderBellman(); }));
  drawBellman();
}

function drawBellman() {
  const map = ctx.map;
  const styles = new Map();
  if (bfSrc != null) styles.set(bfSrc, { ring: 'var(--go)', badge: 'Nguồn', badgeColor: 'var(--go)', keep: true });
  const legend = [];
  if (bfRes) {
    if (bfRes.negativeCycle || (bfRes.anyCycle && bfRes.anyCycle.length)) {
      const cyc = bfRes.negativeCycle ? bfRes.cycle : bfRes.anyCycle;
      map.setPaths([{ nodes: cyc, color: 'var(--stop)', width: 7, arrows: true }]);
      cyc.forEach((id) => styles.set(id, { ...(styles.get(id) || {}), ring: 'var(--stop)' }));
      legend.push({ type: 'line', color: 'var(--stop)', label: 'Chu trình âm' });
    } else {
      // Cây đường đi ngắn nhất: cạnh (truoc[v], v)
      const tree = bfRes.rows.filter((r) => r.prev >= 0).map((r) => ({ nodes: [r.prev, r.id], color: 'var(--road)', width: 4, opacity: 0.45, animate: false }));
      const pick = bfRes.rows.find((r) => r.id === bfPick);
      if (pick && pick.path.length > 1) tree.push({ nodes: pick.path, color: 'var(--road)', width: 7, arrows: true });
      map.setPaths(tree, { animate: !!pick });
      for (const r of bfRes.rows) {
        if (r.dist != null && r.id !== bfSrc && bfRes.rows.length <= 300) styles.set(r.id, { ...(styles.get(r.id) || {}), badge: fmt.num(r.dist), badgeColor: r.dist < 0 ? 'var(--stop)' : 'var(--road)' });
        if (r.dist == null && r.id !== bfSrc) styles.set(r.id, { dim: true });
      }
      legend.push({ type: 'line', color: 'var(--road)', label: 'Cây đường đi ngắn nhất' }, { type: 'badge', color: 'var(--road)', label: 'Khoảng cách' });
    }
  } else map.setPaths([]);
  map.setNodeStyles(styles);
  map.setDim(false);
  map.setLegend(legend);
}

// ---------------------------------------------------------------- Dự toán
function renderStops() {
  const box = $('#c-stops', root);
  if (!box) return;
  box.innerHTML = stops.length
    ? stops.map((id, i) => `<span class="chip blue">${i + 1}. ${name(id)}<button data-rm="${i}" aria-label="Bỏ điểm">×</button></span>`).join('')
    : '<span class="muted" style="font-size:13px">Bấm các điểm trên bản đồ.</span>';
  box.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { stops.splice(Number(b.dataset.rm), 1); estRes = null; renderStops(); }));
  renderEstimate();
}

async function runEstimate(btn) {
  if (!stops.length) { ctx.map.setHint('Bấm ít nhất một điểm giao'); return; }
  await guard(async () => {
    estRes = await api.get('estimate', { depot: estDepot, stops: stops.join(','), vehicle: estVeh, return: estBack ? 1 : 0, depart: ctx.store.state.settings.rush.enabled ? estDepart : undefined });
    renderEstimate();
  }, btn);
}

function renderEstimate() {
  const out = $('#c-out', root);
  if (!out) return;
  const map = ctx.map;
  const styles = new Map();
  if (estDepot != null) styles.set(estDepot, { ring: 'var(--ink)', keep: true });
  stops.forEach((id, i) => styles.set(id, { badge: i + 1, badgeColor: 'var(--road)', keep: true }));
  if (!estRes) {
    out.innerHTML = '';
    map.setPaths([]);
    map.setNodeStyles(styles);
    map.setDim(false);
    map.setLegend([{ type: 'badge', color: 'var(--road)', label: 'Thứ tự điểm giao' }]);
    return;
  }
  const e = estRes;
  if (!e.ok) {
    out.innerHTML = `<div class="notice error">${escapeHtml(e.error)}</div>`;
    map.setPaths([]);
  } else {
    out.innerHTML = `<div class="block">
      <div class="kpis"><div class="kpi"><b>${fmt.vnd(e.cost)}</b><span>tổng chi phí</span></div><div class="kpi"><b>${fmt.km(e.km)}</b><span>quãng đường</span></div><div class="kpi"><b>${fmt.min(e.minutes)}</b><span>thời gian</span></div></div>
      <table class="data"><tbody>
        <tr><td>Phí cố định</td><td class="num">${fmt.vnd(e.formula.fixed)}</td></tr>
        <tr><td>${fmt.km(e.km)} × ${fmt.vnd(e.formula.perKm)}/km</td><td class="num">${fmt.vnd(e.km * e.formula.perKm)}</td></tr>
        <tr><td>Phụ phí và trợ giá</td><td class="num">${fmt.vnd(e.surcharge)}</td></tr>
        <tr><td>Dừng giao ${e.stops} điểm × ${e.formula.perStopMinutes} phút</td><td class="num">${fmt.min(e.stops * e.formula.perStopMinutes)}</td></tr>
        ${e.minutes - e.minutesBase >= 0.5 ? `<tr><td>Kẹt giờ cao điểm (đi lúc ${hhmm(e.depart)})</td><td class="num" style="color:var(--signal-ink)">+${fmt.min(e.minutes - e.minutesBase)}</td></tr>` : ''}
      </tbody></table>
      <h3 style="font-size:12px;font-weight:500;color:var(--muted);margin:16px 0 2px">Từng chặng</h3>
      <table class="data"><thead><tr><th>Chặng</th><th class="num">Km</th><th class="num">Phút</th></tr></thead><tbody>${e.legs.map((l, i) => `<tr><td><span class="swatch" style="display:inline-block;background:${ROUTE_COLORS[i % ROUTE_COLORS.length]}"></span> ${name(l.from)} → ${name(l.to)}${l.path.length > 2 ? `<br><small>qua ${l.path.length - 2} điểm</small>` : ''}</td><td class="num">${fmt.num(l.km)}</td><td class="num">${fmt.num(l.minutes, 0)}</td></tr>`).join('')}</tbody></table></div>`;
    map.setPaths(e.legs.map((l, i) => ({ nodes: l.path, color: ROUTE_COLORS[i % ROUTE_COLORS.length], width: 6, arrows: true, offset: (i % 2 ? 3 : -3) })));
  }
  map.setNodeStyles(styles);
  map.setDim(!!(e && e.ok));
  map.setLegend([{ type: 'badge', color: 'var(--road)', label: 'Thứ tự điểm giao' }]);
}

export default {
  id: 'cost',
  title: 'Chi phí và Bellman-Ford',
  mount(panel, c) {
    ctx = c;
    const st = ctx.store.state;
    if (bfSrc == null || !ctx.store.nodesById.has(bfSrc)) bfSrc = st.depot;
    root = document.createElement('div');
    root.innerHTML = `<div class="page-head"><h1>Chi phí</h1></div>
      <div class="tabs" role="tablist"><button role="tab" data-tab="bellman" aria-selected="${tab === 'bellman'}">Bellman-Ford</button><button role="tab" data-tab="estimate" aria-selected="${tab === 'estimate'}">Dự toán chuyến</button></div>
      <div id="c-body"></div>`;
    panel.append(root);
    root.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
    ctx.onMap('nodeclick', (id) => {
      if (tab === 'bellman') { bfSrc = id; $('#c-src', root).value = id; runBellman(); }
      else if (id !== estDepot) { stops.push(id); estRes = null; renderStops(); }
    });
    ctx.map.setPicking(true);
    setTab(tab);
    if (tab === 'bellman' && !bfRes && ctx.store.state.graph.stats.negative) runBellman();
  },
  unmount() { root = null; },
  onState() {
    bfRes = null; estRes = null;
    if (!ctx.store.nodesById.has(bfSrc)) bfSrc = ctx.store.state.depot;
    stops = stops.filter((s) => ctx.store.nodesById.has(s));
    setTab(tab);
    if (tab === 'bellman' && ctx.store.state.graph.stats.negative) runBellman();
  },
};
