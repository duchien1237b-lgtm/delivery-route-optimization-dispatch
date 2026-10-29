// Trang Hiệu năng: đo 3 phiên bản Dijkstra trên đồ thị ngẫu nhiên (benchmark chạy ở C++).
import { api } from '../api.js';
import { $, fmt, guard } from '../ui.js';

let root;
let sizes = '100, 500, 1000, 2000, 4000, 8000', degree = 4, repeats = 3, logScale = false;
let rows = null;

const SERIES = [
  { key: 'array', label: 'Mảng O(V²)', color: 'var(--s2)' },
  { key: 'stl', label: 'std::priority_queue', color: 'var(--s3)' },
  { key: 'heap', label: 'Min-Heap tự cài', color: 'var(--s1)' },
];

function niceTicks(max, count = 5) {
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

function drawChart() {
  const wrap = $('#b-chart', root);
  if (!wrap || !rows) return;
  const svg = wrap.querySelector('svg');
  const W = svg.clientWidth || 700, H = 340;
  const m = { l: 64, r: 150, t: 14, b: 40 };
  const xs = rows.map((r) => r.nodes);
  const xMax = Math.max(...xs);
  const yVals = rows.flatMap((r) => SERIES.map((s) => r[s.key]));
  const yMaxRaw = Math.max(...yVals, 1);
  let yTicks, y;
  if (logScale) {
    const lo = Math.floor(Math.log10(Math.max(Math.min(...yVals), 0.1)));
    const hi = Math.ceil(Math.log10(yMaxRaw));
    yTicks = [];
    for (let e = lo; e <= hi; e++) yTicks.push(10 ** e);
    y = (v) => H - m.b - ((Math.log10(Math.max(v, 10 ** lo)) - lo) / (hi - lo || 1)) * (H - m.t - m.b);
  } else {
    yTicks = niceTicks(yMaxRaw);
    const top = yTicks[yTicks.length - 1];
    y = (v) => H - m.b - (v / top) * (H - m.t - m.b);
  }
  const x = (v) => m.l + (v / xMax) * (W - m.l - m.r);

  let s = '<g class="grid">';
  for (const t of yTicks) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/>`;
  s += '</g><g class="axis">';
  for (const t of yTicks) s += `<text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${fmt.us(t)}</text>`;
  // Nhãn trục x: bỏ bớt nhãn quá sát nhau
  let lastX = -1e9;
  for (const r of rows) {
    const px = x(r.nodes);
    if (px - lastX < 34) continue;
    lastX = px;
    s += `<text x="${px}" y="${H - m.b + 18}" text-anchor="middle">${fmt.num(r.nodes, 0)}</text>`;
  }
  s += `<line x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>`;
  s += `<text x="${(m.l + W - m.r) / 2}" y="${H - 4}" text-anchor="middle">Số đỉnh của đồ thị</text></g>`;

  // Nhãn cuối đường: tránh chồng nhau
  const ends = SERIES.map((ser) => ({ ser, yy: y(rows[rows.length - 1][ser.key]) })).sort((a, b) => a.yy - b.yy);
  const GAP = 32;  // mỗi nhãn 2 dòng: tên + giá trị
  for (let i = 1; i < ends.length; i++) if (ends[i].yy - ends[i - 1].yy < GAP) ends[i].yy = ends[i - 1].yy + GAP;
  const overflow = ends[ends.length - 1].yy - (H - m.b - 14);
  if (overflow > 0) for (const e of ends) e.yy -= overflow;

  for (const ser of SERIES) {
    const pts = rows.map((r) => [x(r.nodes), y(r[ser.key])]);
    s += `<path class="series" d="M${pts.map((p) => p.join(',')).join('L')}" style="stroke:${ser.color}"/>`;
    for (const p of pts) s += `<circle class="dot" cx="${p[0]}" cy="${p[1]}" r="4.5" style="fill:${ser.color}"/>`;
    const end = ends.find((e) => e.ser === ser);
    const last = rows[rows.length - 1][ser.key];
    s += `<text class="series-label" x="${W - m.r + 16}" y="${end.yy + 4}" style="fill:var(--ink)">${ser.label}</text>`;
    s += `<text x="${W - m.r + 16}" y="${end.yy + 18}" style="fill:var(--muted);font-size:11px">${fmt.us(last)}</text>`;
  }
  s += `<line class="cross" id="b-cross" y1="${m.t}" y2="${H - m.b}" x1="-10" x2="-10"/>`;
  s += `<rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent" id="b-hit"/>`;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = s;

  const tip = wrap.querySelector('.chart-tip');
  const hit = svg.querySelector('#b-hit'), cross = svg.querySelector('#b-cross');
  hit.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = rows[0];
    for (const row of rows) if (Math.abs(x(row.nodes) - px) < Math.abs(x(best.nodes) - px)) best = row;
    cross.setAttribute('x1', x(best.nodes)); cross.setAttribute('x2', x(best.nodes));
    tip.hidden = false;
    tip.innerHTML = `<b>${fmt.num(best.nodes, 0)} đỉnh, ${fmt.num(best.edges, 0)} cạnh</b>${SERIES.map((ser) => `<div class="r"><i class="swatch" style="background:${ser.color};width:10px;height:10px"></i><span>${ser.label}</span><span>${fmt.us(best[ser.key])}</span></div>`).join('')}`;
    let left = (x(best.nodes) / W) * r.width + 14;
    if (left + tip.offsetWidth > r.width) left -= tip.offsetWidth + 28;
    tip.style.left = `${left}px`;
    tip.style.top = '20px';
  });
  hit.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('x1', -10); cross.setAttribute('x2', -10); });
}

function renderResult() {
  const out = $('#b-out', root);
  if (!rows) {
    out.innerHTML = '<p class="empty">Mỗi kích thước sinh một đồ thị ngẫu nhiên liên thông, chạy 3 bản Dijkstra từ đỉnh 0.</p>';
    return;
  }
  const last = rows[rows.length - 1];
  const ratio = last.heap > 0 ? last.array / last.heap : 0;
  out.innerHTML = `<div class="block">
      <div class="split"><h2>Min-Heap nhanh hơn mảng ${fmt.num(ratio, 0)} lần ở ${fmt.num(last.nodes, 0)} đỉnh</h2><label class="check"><input type="checkbox" id="b-log" ${logScale ? 'checked' : ''}> Thang log</label></div>
      ${rows.every((r) => r.agree) ? '<p class="sub">Ba bản cho cùng khoảng cách tới mọi đỉnh.</p>' : '<div class="notice error">Có kết quả không khớp giữa các bản.</div>'}
      <div class="chart-legend">${SERIES.map((s) => `<span><i style="background:${s.color}"></i>${s.label}</span>`).join('')}</div>
      <div class="chart-wrap" id="b-chart"><svg class="chart" role="img" aria-label="Biểu đồ thời gian chạy của 3 phiên bản Dijkstra theo số đỉnh"></svg><div class="chart-tip" hidden></div></div>
    </div>
    <div class="block">
      <div class="table-wrap"><table class="data"><thead><tr><th class="num">Đỉnh</th><th class="num">Cạnh</th><th class="num">Mảng O(V²)</th><th class="num">priority_queue</th><th class="num">Min-Heap</th><th class="num">Thao tác mảng</th><th class="num">Thao tác heap</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td class="num">${fmt.num(r.nodes, 0)}</td><td class="num">${fmt.num(r.edges, 0)}</td><td class="num">${fmt.us(r.array)}</td><td class="num">${fmt.us(r.stl)}</td><td class="num">${fmt.us(r.heap)}</td><td class="num">${fmt.num(r.opsArray, 0)}</td><td class="num">${fmt.num(r.opsHeap, 0)}</td></tr>`).join('')}</tbody></table></div>
    </div>`;
  $('#b-log', out).addEventListener('change', (e) => { logScale = e.target.checked; drawChart(); });
  requestAnimationFrame(drawChart);
}

async function run(btn) {
  const f = $('#b-form', root);
  sizes = f.sizes.value;
  degree = Number(f.degree.value);
  repeats = Number(f.repeats.value);
  await guard(async () => {
    const res = await api.get('benchmark', { sizes: sizes.replace(/\s+/g, ''), degree, repeats });
    rows = res.rows;
    renderResult();
  }, btn);
}

let onResize;
export default {
  id: 'bench',
  title: 'Hiệu năng',
  wide: true,
  mount(panel) {
    root = document.createElement('div');
    root.innerHTML = `<div class="page-head"><h1>Hiệu năng Dijkstra</h1></div>
      <div class="bench-grid">
        <div>
          <form class="block" id="b-form">
            <label class="field"><span>Số đỉnh</span><input type="text" name="sizes" value="${sizes}"></label>
            <label class="field"><span>Bậc trung bình: <b id="b-deg">${degree}</b></span><input type="range" name="degree" min="2" max="16" value="${degree}"></label>
            <label class="field"><span>Số lần lặp</span><select name="repeats">${[1, 3, 5].map((v) => `<option ${v === repeats ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
            <button class="btn primary block-btn">Đo</button>
          </form>
          <div class="block"><h2>Độ phức tạp</h2>
            <table class="data complexity"><tbody>
              <tr><td>Mảng</td><td class="num">O(V²)</td></tr>
              <tr><td>priority_queue, xoá lười</td><td class="num">O((V+E) log E)</td></tr>
              <tr><td>Min-Heap, decreaseKey</td><td class="num">O((V+E) log V)</td></tr>
            </tbody></table>
          </div>
        </div>
        <div><div id="b-out"></div>
          <div class="block" id="b-p2p">
            <div class="split"><h2>Dijkstra hay A* trên bản đồ đang mở</h2><button class="btn small" id="b-p2p-run">Đo 100 cặp điểm</button></div>
            <div id="b-p2p-out"><p class="empty">Chọn ngẫu nhiên 100 cặp điểm đi, điểm đến; mỗi cặp chạy Dijkstra (dừng khi tới đích) và A*.</p></div>
          </div>
        </div>
      </div>`;
    panel.append(root);
    const f = $('#b-form', root);
    f.degree.addEventListener('input', () => { $('#b-deg', root).textContent = f.degree.value; });
    f.addEventListener('submit', (e) => { e.preventDefault(); run(e.submitter); });
    $('#b-p2p-run', root).addEventListener('click', (e) => guard(async () => {
      const r = await api.get('benchmark/p2p', { pairs: 100 });
      const bar = (v, max, color) => `<div class="hbar" style="height:10px"><i style="width:${(v / max) * 100}%;background:${color}"></i></div>`;
      const maxS = Math.max(r.dijkstra.settled, r.astar.settled, 1);
      $('#b-p2p-out', root).innerHTML = `<p class="sub">${fmt.num(r.nodes, 0)} điểm, ${r.found}/${r.pairs} cặp có đường. ${r.agree ? 'Hai thuật toán cho cùng khoảng cách ở mọi cặp.' : '<b style="color:var(--stop)">Có cặp không khớp!</b>'}</p>
        <table class="data"><thead><tr><th>Thuật toán</th><th>Số đỉnh phải chốt (trung bình)</th><th class="num">Thời gian</th></tr></thead><tbody>
          <tr><td>Dijkstra, Min-Heap</td><td style="min-width:200px">${bar(r.dijkstra.settled, maxS, 'var(--s2)')}<small>${fmt.num(r.dijkstra.settled, 0)} đỉnh</small></td><td class="num">${fmt.us(r.dijkstra.micros)}</td></tr>
          <tr><td>A*, đường chim bay</td><td>${bar(r.astar.settled, maxS, 'var(--s1)')}<small>${fmt.num(r.astar.settled, 0)} đỉnh, ít hơn ${fmt.num((1 - r.astar.settled / Math.max(r.dijkstra.settled, 1e-9)) * 100, 0)}%</small></td><td class="num">${fmt.us(r.astar.micros)}</td></tr>
        </tbody></table>
        <p class="muted" style="font-size:12px;margin-top:6px">Bản đồ nhỏ thì khác biệt ít; mở bộ dữ liệu “Đô thị mô phỏng” để thấy rõ.</p>`;
    }, e.currentTarget));
    onResize = () => drawChart();
    window.addEventListener('resize', onResize);
    renderResult();
  },
  unmount() { window.removeEventListener('resize', onResize); root = null; },
};
