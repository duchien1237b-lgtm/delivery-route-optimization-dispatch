// Trang Tìm đường: Dijkstra (3 phiên bản), Bellman-Ford, BFS — so sánh trên cùng truy vấn.
import { api } from '../api.js';
import { escapeHtml } from '../store.js';
import { $, fmt, guard, segmented, bindSegmented, segValue, VEHICLES, CRITERIA, hhmm, timeToMinutes, getShiftStart } from '../ui.js';

let ctx, root;
let src = null, dst = null, vehicle = '0', criterion = 'distance', algo = 'heap';
let result = null, estimate = null;
let alts = null, altPick = 0;   // các tuyến thay thế (thuật toán Yen) và tuyến đang xem
const ALT_COLORS = ['var(--road)', 'var(--s3)', '#b0359b', 'var(--s2)'];
let pickNext = 'src';
let depart = null;     // giờ xuất phát (phút trong ngày) dùng cho giờ cao điểm
let profile = null;    // thời gian đi theo giờ trong ngày (/api/timeprofile)
let timer = null;

const ALGOS = [
  { v: 'heap', label: 'Dijkstra, Min-Heap tự cài' },
  { v: 'astar', label: 'A*, đường chim bay' },
  { v: 'stl', label: 'Dijkstra, std::priority_queue' },
  { v: 'array', label: 'Dijkstra, mảng O(V²)' },
  { v: 'bellman', label: 'Bellman-Ford' },
  { v: 'bfs', label: 'BFS, ít chặng nhất' },
];
const UNIT = { distance: (v) => fmt.km(v), time: (v) => fmt.min(v), cost: (v) => fmt.k(v) };

function hint() {
  if (result && src != null && dst != null && pickNext === 'src') { ctx.map.setHint(null); return; }
  ctx.map.setHint(pickNext === 'src' ? 'Chọn điểm đi' : 'Chọn điểm đến');
}

function syncSelects() {
  const s = $('#r-src', root), d = $('#r-dst', root);
  if (!s) return;
  s.innerHTML = ctx.store.nodeOptions(src, { includeEmpty: true, emptyLabel: 'Chọn điểm đi' });
  d.innerHTML = ctx.store.nodeOptions(dst, { includeEmpty: true, emptyLabel: 'Chọn điểm đến' });
}

function drawMap() {
  stopPlayback();
  const styles = new Map();
  if (src != null) styles.set(src, { pin: 'start', keep: true, label: true, tip: 'Điểm đi' });
  if (dst != null) styles.set(dst, { pin: 'end', keep: true, label: true, tip: 'Điểm đến' });
  const r = result && result.result;
  const legend = [];
  if (r && r.found && alts && alts.paths.length > 1) {
    // Có tuyến thay thế: tuyến đang chọn vẽ đậm, các tuyến khác mảnh và đứt nét
    const paths = alts.paths.map((p, i) => (i === altPick ? null : { nodes: p.path, color: ALT_COLORS[i % 4], width: 4, dash: '7 6', opacity: 0.75, animate: false })).filter(Boolean);
    paths.push({ nodes: alts.paths[altPick].path, color: ALT_COLORS[altPick % 4], width: 7, arrows: true });
    ctx.map.setPaths(paths);
    ctx.map.setDim(true);
    alts.paths.forEach((p, i) => legend.push({ type: i === altPick ? 'line' : 'dash', color: ALT_COLORS[i % 4], label: `Tuyến ${i + 1}` }));
  } else if (r && r.found) {
    ctx.map.setPaths([{ nodes: r.path, color: 'var(--road)', width: 7, arrows: true }]);
    ctx.map.setDim(true);
    legend.push({ type: 'line', color: 'var(--road)', label: 'Đường đi', width: 5 });
    const bf = result.compare.find((c) => c.key === 'bellman');
    // Chỉ vẽ thêm đường của Bellman-Ford khi Dijkstra cho kết quả SAI (khác giá trị), không phải chỉ khác lối đi
    if (bf && bf.found && r.key !== 'bellman' && r.key !== 'bfs' && Math.abs(bf.weight - r.weight) > 1e-6) {
      ctx.map.setPaths([{ nodes: bf.path, color: 'var(--go)', width: 5, dash: '2 9', animate: false }, { nodes: r.path, color: 'var(--road)', width: 7, arrows: true }]);
      legend.push({ type: 'line', color: 'var(--go)', label: 'Đường đúng (Bellman-Ford)' });
    }
  } else if (r && r.cycle && r.cycle.length) {
    ctx.map.setPaths([{ nodes: r.cycle, color: 'var(--stop)', width: 7, arrows: true }]);
    ctx.map.setDim(true);
    legend.push({ type: 'line', color: 'var(--stop)', label: 'Chu trình âm' });
  } else {
    ctx.map.setPaths([]);
    ctx.map.setDim(false);
  }
  ctx.map.setNodeStyles(styles);
  ctx.map.setLegend(legend);
}

function stepsHtml(path) {
  const g = ctx.store.state.graph;
  const items = path.map((id, i) => {
    let info = '';
    if (i > 0) {
      const a = path[i - 1];
      const e = g.edges.find((x) => (x.u === a && x.v === id) || (!g.directed && x.u === id && x.v === a));
      if (e) info = `${fmt.km(e.km)}, ${fmt.num(e.time)} phút${e.costK < 0 ? `, chi phí ${fmt.k(e.costK)}` : ''}`;
    }
    return `<li>${escapeHtml(ctx.store.name(id))}${info ? `<small>${info}</small>` : ''}</li>`;
  });
  // Đường dài nhiều điểm: rút gọn phần giữa cho dễ đọc
  if (items.length > 14) items.splice(6, items.length - 12, `<li class="muted">… ${items.length - 12} điểm trung gian …</li>`);
  return `<ol class="path-steps">${items.join('')}</ol>`;
}

function renderResult() {
  const box = $('#r-result', root);
  if (!box) return;
  if (!result) { box.innerHTML = ''; return; }
  const r = result.result;
  const warn = r.warning ? `<div class="notice ${r.cycle && r.cycle.length ? 'error' : 'warn'}">${escapeHtml(r.warning)}</div>` : '';
  let main;
  if (!r.found) {
    main = `<div class="block"><h2>Không có đường đi</h2>${warn}<p class="muted">${escapeHtml(ctx.store.name(src))} không tới được ${escapeHtml(ctx.store.name(dst))} bằng ${escapeHtml(result.vehicle.toLowerCase())}: khác cụm, ngược chiều hoặc đường cấm.</p></div>`;
  } else {
    main = `<div class="block">
      <div class="trip-hero">
        <div class="th-top"><b class="th-time">${fmt.min(r.minutes)}</b><span class="th-km">(${fmt.km(r.km)})</span><span class="chip ok th-tag">${criterion === 'distance' ? 'Ngắn nhất' : criterion === 'time' ? 'Nhanh nhất' : 'Rẻ nhất'}</span></div>
        <p class="th-sub">${escapeHtml(ctx.store.name(src))} → ${escapeHtml(ctx.store.name(dst))}</p>
        <div class="th-facts"><span>${r.hops} chặng</span><span>${fmt.k(r.costK)} chi phí đường</span><span>${escapeHtml(result.vehicle)}</span><span>${escapeHtml(r.name)}</span></div>
      </div>
      ${warn}${rushNote(r)}
      ${stepsHtml(r.path)}
      <div class="actions">${r.settleOrder && r.settleOrder.length && r.settleOrder.length <= 400 ? '<button class="btn small" id="b-play">Xem thứ tự chốt đỉnh</button>' : ''}</div>
    </div>`;
  }
  const bf = result.compare.find((c) => c.key === 'bellman');
  const rows = result.compare.map((c) => {
    const wrong = bf && bf.found && c.found && c.key !== 'bfs' && Math.abs(c.weight - bf.weight) > 1e-6;
    const val = c.key === 'bfs' ? (c.found ? `${c.hops} chặng` : '–') : c.found ? UNIT[criterion](c.weight) : '–';
    return `<tr class="${c.key === r.key ? 'active' : ''} ${wrong ? 'bad' : ''}"><td>${escapeHtml(c.name)}${wrong ? '<br><small>sai do cạnh âm</small>' : ''}</td><td class="num">${val}</td><td class="num">${c.settled != null ? c.settled : '–'}</td><td class="num" title="${c.work ? `${fmt.num(c.work, 0)} thao tác` : ''}">${fmt.us(c.micros)}</td></tr>`;
  }).join('');
  const est = estimate && estimate.ok
    ? `<div class="block"><h2>Cước dự toán</h2>
        <table class="data"><tbody>
          <tr><td>Phí cố định</td><td class="num">${fmt.vnd(estimate.formula.fixed)}</td></tr>
          <tr><td>${fmt.km(estimate.km)} × ${fmt.vnd(estimate.formula.perKm)}</td><td class="num">${fmt.vnd(estimate.km * estimate.formula.perKm)}</td></tr>
          <tr><td>Phụ phí, trợ giá</td><td class="num">${fmt.vnd(estimate.surcharge)}</td></tr>
          <tr><td><b>Tổng cước</b></td><td class="num"><b>${fmt.vnd(estimate.cost)}</b></td></tr>
          <tr><td>Thời gian, kể cả ${fmt.num(estimate.formula.perStopMinutes, 0)} phút giao</td><td class="num">${fmt.min(estimate.minutes)}</td></tr>
        </tbody></table></div>`
    : '';
  let altHtml = '';
  if (r.found && alts && alts.paths.length) {
    const best = alts.paths[0];
    const cards = alts.paths.map((p, i) => {
      const diff = p.weight - best.weight;
      const pct = best.weight > 0 ? (diff / best.weight) * 100 : 0;
      return `<button type="button" class="alt-card ${i === altPick ? 'active' : ''}" data-alt="${i}" style="--c:${ALT_COLORS[i % 4]}">
        <span class="alt-head">Tuyến ${i + 1}</span><span class="alt-diff">${i === 0 ? 'tốt nhất' : `+${UNIT[criterion](diff)} (+${fmt.num(pct, 0)}%)`}</span>
        <span class="alt-nums">${fmt.km(p.km)}, ${fmt.min(p.minutes)}, ${fmt.k(p.costK)}, ${p.hops} chặng${i ? `, trùng ${fmt.num(p.shared * 100, 0)}% với tuyến 1` : ''}</span></button>`;
    }).join('');
    altHtml = alts.paths.length > 1 ? `<div class="block"><div class="split"><h2>Tuyến thay thế</h2><span class="muted" style="font-size:12px">Yen, ${fmt.us(alts.micros)}</span></div><div class="alt-list">${cards}</div></div>` : '';
  }
  box.innerHTML = `${main}${profileHtml()}${altHtml}
    <div class="block"><h2>So sánh thuật toán</h2>
      <div class="table-wrap"><table class="data"><thead><tr><th>Thuật toán</th><th class="num">Kết quả</th><th class="num" title="Số đỉnh được chốt trước khi tới điểm đến">Đỉnh xét</th><th class="num">Thời gian</th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>${est}`;
  $('#b-play', box)?.addEventListener('click', () => playback(r.settleOrder));
  const tp = $('#r-tp', box);
  tp?.querySelector('[data-hit]').addEventListener('click', (e) => {
    const rect = tp.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * 390;
    const t = Math.round(((vx - 34) / (390 - 42)) * 1440 / 10) * 10;
    depart = Math.min(1430, Math.max(0, t));
    $('#r-depart', root).value = hhmm(depart);
    run();
  });
  box.querySelectorAll('[data-alt]').forEach((b) => b.addEventListener('click', () => {
    altPick = Number(b.dataset.alt);
    box.querySelectorAll('[data-alt]').forEach((x) => x.classList.toggle('active', x === b));
    drawMap();
  }));
}

const rushOn = () => ctx.store.state.settings.rush.enabled;

function rushNote(r) {
  if (!result || result.depart == null || !(result.rushLevel > 0)) return '';
  const extra = r.minutes - r.minutesBase;
  const usual = profile && profile.routes[0];
  const detour = criterion === 'time' && usual && usual.join() !== r.path.join();
  if (extra < 0.5 && !detour) return '';
  return `<div class="notice warn">Giờ cao điểm lúc ${hhmm(result.depart)}: ${detour ? 'đi tuyến khác để tránh kẹt, ' : ''}chậm hơn giờ vắng ${fmt.min(extra)}.</div>`;
}

// Biểu đồ thời gian đi theo giờ xuất phát: tuyến nhanh nhất từng lúc so với cứ đi tuyến giờ vắng
function profileHtml() {
  if (!profile || !rushOn()) return '';
  const pts = profile.points;
  const W = 390, H = 150, m = { l: 34, r: 8, t: 10, b: 22 };
  const yMax = Math.max(...pts.map((p) => p.usual), ...pts.map((p) => p.minutes)) * 1.08;
  const x = (t) => m.l + (t / 1440) * (W - m.l - m.r);
  const y = (v) => H - m.b - (v / yMax) * (H - m.t - m.b);
  const line = (key) => 'M' + pts.map((p) => `${x(p.t).toFixed(1)},${y(p[key]).toFixed(1)}`).join('L');
  const band = pts.map((p, i) => {
    if (!(p.level > 0)) return '';
    const w = x(pts[i + 1] ? pts[i + 1].t : 1440) - x(p.t);
    return `<rect x="${x(p.t).toFixed(1)}" y="${m.t}" width="${w.toFixed(1)}" height="${H - m.t - m.b}" fill="var(--signal)" opacity="${(0.08 + p.level * 0.17).toFixed(2)}"/>`;
  }).join('');
  const ticks = [0, 6, 12, 18, 24].map((h) => `<text x="${x(h * 60)}" y="${H - 6}" text-anchor="middle">${h}h</text>`).join('');
  const yt = [0, Math.round(yMax / 2), Math.round(yMax * 0.95)].map((v) => `<text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text><line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>`).join('');
  const differ = pts.some((p) => p.usual - p.minutes > 0.5);
  const dx = depart != null ? x(depart) : null;
  const best = pts.reduce((a, b) => (b.minutes < a.minutes ? b : a));
  const worst = pts.reduce((a, b) => (b.minutes > a.minutes ? b : a));
  return `<div class="block"><div class="split"><h2>Theo giờ đi</h2><span class="muted" style="font-size:12px">${fmt.min(best.minutes)} lúc vắng, ${fmt.min(worst.minutes)} lúc ${hhmm(worst.t)}</span></div>
    <svg class="tp-chart" id="r-tp" viewBox="0 0 ${W} ${H}" role="img" aria-label="Thời gian đi theo giờ xuất phát">
      ${band}<g class="axis">${yt}${ticks}</g>
      ${differ ? `<path d="${line('usual')}" class="tp-usual"/>` : ''}
      <path d="${line('minutes')}" class="tp-best"/>
      ${dx != null ? `<line x1="${dx}" x2="${dx}" y1="${m.t}" y2="${H - m.b}" class="tp-now"/>` : ''}
      <rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent" style="cursor:pointer" data-hit/>
    </svg>
    <div class="chart-legend" style="margin-top:4px"><span><i style="background:var(--road)"></i>Tuyến nhanh nhất</span>${differ ? '<span><i style="background:var(--muted)"></i>Giữ tuyến giờ vắng</span>' : ''}<span><i style="background:var(--signal);height:8px;opacity:.5"></i>Cao điểm</span></div>
    <p class="muted" style="font-size:12px;margin-top:2px">Bấm vào biểu đồ để chọn giờ đi.</p></div>`;
}

function stopPlayback() { if (timer) { clearInterval(timer); timer = null; } }

// Hiện lần lượt thứ tự Dijkstra "chốt" từng đỉnh
function playback(order) {
  stopPlayback();
  ctx.map.setDim(false);
  ctx.map.setPaths([]);
  let i = 0;
  const styles = new Map();
  timer = setInterval(() => {
    if (i >= order.length) { stopPlayback(); setTimeout(drawMap, 1200); return; }
    styles.set(order[i], { badge: i + 1, badgeColor: 'var(--road)', fill: 'var(--road-soft)' });
    ctx.map.setNodeStyles(new Map(styles));
    i++;
  }, 380);
  ctx.map.setLegend([{ type: 'badge', color: 'var(--road)', label: 'Thứ tự chốt đỉnh' }]);
}

async function run(btn) {
  if (src == null || dst == null) return;
  await guard(async () => {
    const dep = rushOn() ? depart : undefined;
    const params = { src, dst, algo, vehicle, criterion, depart: dep };
    result = await api.get('path', params);
    profile = null;
    if (rushOn() && result.result && result.result.found) {
      try { profile = await api.get('timeprofile', { src, dst, vehicle }); } catch { profile = null; }
    }
    if (result.result && result.result.found) ctx.map.ensureVisible(result.result.path);
    alts = null;
    altPick = 0;
    if (result.result && result.result.found && !result.compare.some((c) => c.warning && c.key === 'heap')) {
      try { alts = await api.get('kpaths', { src, dst, k: 3, vehicle, criterion, depart: dep }); } catch { alts = null; }
    }
    estimate = null;
    try { estimate = await api.get('estimate', { depot: src, stops: String(dst), vehicle, depart: dep }); } catch { /* không có đường */ }
    renderResult();
    drawMap();
    hint();
  }, btn);
}

export default {
  id: 'route',
  title: 'Tìm đường',
  mount(panel, c) {
    ctx = c;
    const st = ctx.store.state;
    if (src == null && st.graph.nodes.length) src = st.depot >= 0 ? st.depot : st.graph.nodes[0].id;
    if (depart == null) depart = getShiftStart();
    root = document.createElement('div');
    root.innerHTML = `
      <div class="page-head"><h1>Tìm đường</h1></div>
      <div class="block">
        <div class="od-box">
          <div class="od-rail" aria-hidden="true"><i class="od-start"></i><i class="od-dots"></i><i class="od-end"></i></div>
          <div class="od-fields">
            <label class="od-field"><span class="sr-only">Điểm đi</span><select id="r-src"></select></label>
            <label class="od-field"><span class="sr-only">Điểm đến</span><select id="r-dst"></select></label>
          </div>
          <button class="od-swap" id="r-swap" title="Đổi chiều" aria-label="Đổi điểm đi và điểm đến"><svg viewBox="0 0 24 24"><path d="M8 4v16M4.5 7.5 8 4l3.5 3.5M16 20V4M12.5 16.5 16 20l3.5-3.5"/></svg></button>
        </div>
        <div class="field"><span>Phương tiện</span>${segmented('vehicle', VEHICLES, vehicle)}</div>
        <div class="field"><span>Tiêu chí</span>${segmented('criterion', CRITERIA, criterion)}</div>
        <div class="row">
          <label class="field" style="flex:2.2"><span>Thuật toán</span><select id="r-algo">${ALGOS.map((a) => `<option value="${a.v}" ${a.v === algo ? 'selected' : ''}>${a.label}</option>`).join('')}</select></label>
          <label class="field"><span>Giờ đi</span><input type="time" id="r-depart" value="${hhmm(depart)}" ${rushOn() ? '' : 'disabled'}></label>
        </div>
        <div class="run-row"><button class="btn primary block-btn" id="r-run">Tìm đường</button><label class="check" title="Thời gian đi mỗi đoạn tăng vào 7:00–8:30 và 17:00–18:30"><input type="checkbox" id="r-rush" ${rushOn() ? 'checked' : ''}> Tính giờ cao điểm</label></div>
      </div>
      <div id="r-result"></div>`;
    panel.append(root);
    syncSelects();
    bindSegmented(root, (name, v) => { if (name === 'vehicle') vehicle = v; else criterion = v; if (result) run(); });
    $('#r-src', root).addEventListener('change', (e) => { src = e.target.value === '' ? null : Number(e.target.value); pickNext = 'dst'; hint(); drawMap(); });
    $('#r-dst', root).addEventListener('change', (e) => { dst = e.target.value === '' ? null : Number(e.target.value); pickNext = 'src'; hint(); drawMap(); });
    $('#r-algo', root).addEventListener('change', (e) => { algo = e.target.value; if (result) run(); });
    $('#r-depart', root).addEventListener('change', (e) => { if (!e.target.value) return; depart = timeToMinutes(e.target.value); if (result) run(); });
    $('#r-rush', root).addEventListener('change', (e) => guard(async () => {
      const had = !!result;
      await ctx.store.mutate('settings', { rush: e.target.checked ? 1 : 0 });
      $('#r-depart', root).disabled = !e.target.checked;
      if (had) run();
    }));
    $('#r-swap', root).addEventListener('click', () => { [src, dst] = [dst, src]; syncSelects(); if (result) run(); else drawMap(); });
    $('#r-run', root).addEventListener('click', (e) => {
      if (src == null || dst == null) { ctx.map.setHint(src == null ? 'Chọn điểm đi' : 'Chọn điểm đến'); return; }
      run(e.currentTarget);
    });
    ctx.onMap('nodeclick', (id) => {
      if (pickNext === 'src') { src = id; pickNext = 'dst'; }
      else { dst = id; pickNext = 'src'; }
      syncSelects(); hint();
      if (src != null && dst != null && pickNext === 'src') run();
      else drawMap();
    });
    ctx.map.setPicking(true);
    pickNext = dst == null ? (src == null ? 'src' : 'dst') : 'src';
    hint();
    renderResult();
    drawMap();
  },
  unmount() { stopPlayback(); root = null; },
  onState(state) {
    if (src != null && !ctx.store.nodesById.has(src)) src = null;
    if (dst != null && !ctx.store.nodesById.has(dst)) dst = null;
    if (src == null && state.graph.nodes.length) src = state.depot;
    result = null; estimate = null; alts = null; profile = null;
    const rc = $('#r-rush', root);
    if (rc) { rc.checked = rushOn(); $('#r-depart', root).disabled = !rushOn(); }
    syncSelects(); renderResult(); drawMap();
  },
};
