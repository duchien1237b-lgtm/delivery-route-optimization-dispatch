// Trang Theo dõi: mô phỏng ca giao theo thời gian. Shipper chạy trên bản đồ theo lộ trình đã áp dụng,
// đơn tự chuyển "Đã giao" khi shipper tới nơi (backend ghi nhận), có thể báo thất bại và in phiếu giao.
import { api } from '../api.js';
import { escapeHtml } from '../store.js';
import { $, fmt, liveClock, tripPosition, guard, segmented, bindSegmented, toast, hhmm, getShiftStart, statusChip, ROUTE_COLORS, trafficEdgeStyles, rushLevel, TRAFFIC_LEVELS, avatar, showModal, askReason } from '../ui.js';
import { printTrips } from '../print.js';

let ctx, root;
let t = 0;               // phút mô phỏng tính từ đầu ca
let playing = false;
let speed = '5';         // số phút mô phỏng trôi qua mỗi giây thật
let raf = null, lastFrame = 0, lastListRender = 0, sending = false;

const SPEEDS = [{ v: '1', label: '×60' }, { v: '5', label: '×300' }, { v: '15', label: '×900' }];

const trips = () => ctx.store.state.shift.trips;
const orderById = () => new Map(ctx.store.state.orders.map((o) => [o.id, o]));
const colorOf = (trip, i) => ROUTE_COLORS[(trip.shipper >= 0 ? trip.shipper : i) % ROUTE_COLORS.length];
const initial = (name) => (name.trim().split(/\s+/).pop() || '?')[0].toUpperCase();

function endTime() {
  let end = 0;
  for (const tr of trips()) end = Math.max(end, tr.pathTimes[tr.pathTimes.length - 1] || 0);
  return Math.ceil(end + 5);
}

// Vị trí của shipper ở thời điểm t: {lat, lon, index (nút cuối đã qua), state, stop}
function positionOf(trip, time) {
  // Ghép tự động: trước khi tới kho, shipper còn đang chạy từ chỗ đứng cũ tới lấy hàng
  if (trip.approach && trip.approach.length) {
    const ap = tripPosition(trip, time, ctx.store.nodesById);
    if (ap && ap.state === 'approach') return ap;
  }
  const P = trip.path, T = trip.pathTimes, nodes = ctx.store.nodesById;
  const serve = new Map();
  for (const s of trip.stops) serve.set(s.pathIndex, (serve.get(s.pathIndex) || 0) + trip.service);
  const depart = (i) => T[i] + (serve.get(i) || 0);
  const at = (i) => nodes.get(P[i]);
  if (time <= T[0]) return { ...ll(at(0)), index: 0, state: 'wait' };
  for (let i = 0; i < P.length; i++) {
    if (time < T[i]) {  // đang chạy giữa nút i-1 và i
      const a = at(i - 1), b = at(i), d0 = depart(i - 1);
      const f = T[i] > d0 ? Math.min(1, Math.max(0, (time - d0) / (T[i] - d0))) : 1;
      return { lat: a.x + (b.x - a.x) * f, lon: a.y + (b.y - a.y) * f, index: i - 1, state: 'drive', next: i };
    }
    if (time < depart(i)) return { ...ll(at(i)), index: i, state: 'serve' };
  }
  return { ...ll(at(P.length - 1)), index: P.length - 1, state: 'done' };
}
const ll = (n) => ({ lat: n ? n.x : 0, lon: n ? n.y : 0 });

// Báo backend khi đồng hồ vượt giờ dự kiến của một điểm còn đang giao
function syncProgress() {
  if (sending) return;
  const ob = orderById();
  const due = trips().some((tr) => tr.stops.some((s) => s.eta <= t && ob.get(s.order) && ob.get(s.order).status === 1));
  if (!due) return;
  sending = true;
  api.post('shift/progress', { t: t.toFixed(2) })
    .then((res) => { ctx.store.set(res); })
    .catch((e) => toast(e.message, 'error'))
    .finally(() => { sending = false; });
}

// Đồng bộ đồng hồ ca lên backend trước các thao tác phụ thuộc thời điểm (báo nghỉ, tính lại tuyến)
async function syncClock() {
  if (!trips().length || t <= ctx.store.state.shift.clock + 1e-6) return;
  ctx.store.set(await api.post('shift/progress', { t: t.toFixed(2) }));
}

function frame(now) {
  raf = null;
  if (!root) return;
  if (playing) {
    const dt = lastFrame ? (now - lastFrame) / 1000 : 0;
    t = Math.min(endTime(), t + dt * Number(speed));
    if (t >= endTime()) { playing = false; updatePlayButton(); toast('Hết ca'); }
    syncProgress();
  }
  lastFrame = now;
  updateClock();
  drawMap();
  if (now - lastListRender > 600) { renderTrips(); lastListRender = now; }
  if (playing) raf = requestAnimationFrame(frame);
}

function play() {
  if (!trips().length) return;
  if (t >= endTime()) t = ctx.store.state.shift.clock;
  playing = true;
  lastFrame = 0;
  updatePlayButton();
  if (!raf) raf = requestAnimationFrame(frame);
}
function pause() { playing = false; updatePlayButton(); }
function updatePlayButton() {
  const b = $('#k-play', root);
  if (b) { b.textContent = playing ? 'Tạm dừng' : 'Chạy'; b.setAttribute('aria-pressed', String(playing)); }
}

function updateClock() {
  const c = $('#k-clock', root);
  if (!c) return;
  c.textContent = fmt.clock(t);
  $('#k-sub', root).textContent = `Ca ${hhmm(getShiftStart())}–${fmt.clock(endTime() - 5)}`;
  const sl = $('#k-slider', root);
  if (sl && document.activeElement !== sl) { sl.max = endTime(); sl.value = t; }
}

function drawMap() {
  const map = ctx.map;
  const ob = orderById();
  const paths = [], markers = [], styles = new Map(), legend = [];
  trips().forEach((tr, i) => {
    const color = colorOf(tr, i);
    const pos = positionOf(tr, t);
    if (tr.approach && tr.approach.length > 1) paths.push({ nodes: tr.approach, color, width: 3, opacity: 0.6, dash: '6 6', animate: false });
    paths.push({ nodes: tr.path, color, width: 4, opacity: tr.accepted === false ? 0.2 : 0.35, animate: false });
    if (pos.index > 0) paths.push({ nodes: tr.path.slice(0, pos.index + 1), color, width: 6, animate: false, arrows: true });
    markers.push({ lat: pos.lat, lon: pos.lon, color, label: initial(tr.name), title: tr.name });
    tr.stops.forEach((s, j) => {
      const o = ob.get(s.order) || {};
      const badge = o.status === 2 ? '✓' : o.status === 3 ? '✕' : o.status === 5 ? '↩' : String(j + 1);
      const badgeColor = o.status === 2 ? (o.late ? 'var(--jam)' : 'var(--go)') : o.status === 3 ? 'var(--stop)' : o.status === 5 ? 'var(--jam)' : color;
      styles.set(s.node, { badge, badgeColor, keep: true, tip: `Đơn ${s.order}: ${o.statusName || ''}, dự kiến ${fmt.clock(s.eta)}` });
    });
    if (!legend.some((l) => l.label === tr.name)) legend.push({ type: 'line', color, label: tr.name });  // nhiều chuyến cùng shipper: một dòng
  });
  legend.push({ type: 'badge', color: 'var(--go)', label: '✓ đã giao  ✕ thất bại  ↩ hoàn kho' });
  // Lớp giao thông theo đồng hồ ca (đổi mỗi 5 phút mô phỏng)
  const st = ctx.store.state;
  const bucket = Math.floor((getShiftStart() + t) / 5);
  if (bucket !== drawMap.trafficBucket) {
    drawMap.trafficBucket = bucket;
    map.setEdgeStyles(trafficEdgeStyles(st, bucket * 5, 1));   // chỉ tô đoạn rất đông / kẹt nặng
    drawMap.legendSet = false;
  }
  if (rushLevel(st.settings.rush, getShiftStart() + t) > 0) for (const lv of TRAFFIC_LEVELS.slice(1).reverse()) legend.push({ type: 'line', color: lv.color, label: lv.label });
  map.setPaths(paths, { animate: false });
  map.setNodeStyles(styles);
  map.setMarkers(markers);
  map.setDim(trips().length > 0);
  if (!playing || !drawMap.legendSet) { map.setLegend(legend); drawMap.legendSet = true; }
}

function tripStatus(tr) {
  const pos = positionOf(tr, t);
  const nodes = ctx.store.nodesById;
  if (tr.accepted === false) return `Đang mời ${escapeHtml(tr.name)}${tr.offerLeft != null ? `, còn ${Math.round(tr.offerLeft)} giây để nhận` : ''}`;
  if (pos.state === 'approach') return `Đang chạy tới kho lấy hàng, tới nơi lúc ${fmt.clock(tr.approachTimes[tr.approachTimes.length - 1])}`;
  if (pos.state === 'wait') return `Xuất phát lúc ${fmt.clock(tr.pathTimes[0])}`;
  const stopped = tr.note && tr.note.includes('nghỉ');
  if (pos.state === 'done') return stopped ? `Dừng lúc ${fmt.clock(tr.pathTimes[tr.pathTimes.length - 1])} vì shipper nghỉ` : `Về kho lúc ${fmt.clock(tr.pathTimes[tr.pathTimes.length - 1])}`;
  if (stopped && !tr.stops.some((s) => (orderById().get(s.order) || {}).status === 1)) return `Đang dừng chuyến, tới ${escapeHtml((ctx.store.nodesById.get(tr.path[tr.path.length - 1]) || {}).name || '')} thì nghỉ`;
  const ob = orderById();
  const next = tr.stops.find((s) => s.pathIndex >= (pos.state === 'serve' ? pos.index : pos.next) && ob.get(s.order) && ob.get(s.order).status === 1);
  if (pos.state === 'serve') {
    const here = tr.stops.find((s) => s.pathIndex === pos.index);
    if (here) return `Đang giao tại ${escapeHtml(here.name)}`;
  }
  if (next) return `Tới ${escapeHtml(next.name)} lúc ${fmt.clock(next.eta)}`;
  const n = nodes.get(tr.path[pos.next ?? pos.index]);
  return `Đang về kho${n ? `, qua ${escapeHtml(n.name)}` : ''}`;
}

// Báo giao thất bại: chọn lý do (khách từ chối / hàng hư thì hoàn kho ngay)
function askFailReason(id) {
  const st = ctx.store.state;
  const o = st.orders.find((x) => x.id === id) || {};
  const left = st.shift.maxAttempts - (o.attempts || 0) - 1;
  showModal(`Giao thất bại: đơn ${id}`, `<p class="muted" style="margin-bottom:10px">${escapeHtml(o.destinationName || '')}${o.recipient ? ` · ${escapeHtml(o.recipient)}` : ''}${o.phone ? ` · ${escapeHtml(o.phone)}` : ''}${o.cod > 0 ? ` · thu hộ ${fmt.vnd(o.cod)}` : ''}</p>
    <div class="reason-list">${st.shift.failReasons.map((r) => `<button type="button" class="reason" data-reason="${r.id}"><b>${escapeHtml(r.name)}</b><small>${r.returns || left <= 0 ? 'Hoàn hàng về kho, không giao lại' : `Có thể giao lại (còn ${left} lần)`}</small></button>`).join('')}</div>`);
  document.querySelectorAll('#modal-body [data-reason]').forEach((btn) => btn.addEventListener('click', () => {
    document.getElementById('modal').close();
    guard(async () => {
      await syncClock();
      const res = await ctx.store.mutate('shift/fail', { id, reason: btn.dataset.reason });
      toast(res.message || `Đơn ${id}: giao thất bại`);
    });
  }));
}

const EVENT_TEXT = {
  apply: (e) => `Áp dụng phương án ${e.detail}`,
  delivered: (e) => `Giao xong đơn ${e.order}${e.who ? ` (${e.who})` : ''}${e.detail ? `, ${e.detail}` : ''}`,
  failed: (e) => `Đơn ${e.order} giao thất bại: ${e.detail}`,
  returned: (e) => `Đơn ${e.order} hoàn kho: ${e.detail}`,
  cancelled: (e) => `Khách huỷ đơn ${e.order}`,
  requeue: (e) => `Đơn ${e.order} về hàng chờ để giao lại`,
  recalled: (e) => `Thu hồi đơn ${e.order} khỏi chuyến chưa nhận${e.detail ? `: ${e.detail}` : ''}`,
  declined: (e) => `${e.who || 'Shipper'} từ chối chuyến có đơn ${e.order}${e.detail ? `: ${e.detail}` : ''}`,
  absent: (e) => `${e.who || 'Shipper'} nghỉ đột xuất, ${e.detail}`,
  available: (e) => `${e.who || 'Shipper'} có mặt trở lại`,
  reroute: (e) => `Tính lại tuyến: ${e.detail}`,
};
const EVENT_CLS = { delivered: 'ok', failed: 'late', returned: 'warn', cancelled: 'muted', absent: 'urgent', reroute: 'blue', recalled: 'warn', declined: 'warn' };

function renderLog() {
  const box = $('#k-log', root);
  if (!box) return;
  // Chỉ hiện sự kiện đã xảy ra theo đồng hồ đang xem (giao hàng được ghi trước theo giờ dự kiến)
  const ev = ctx.store.state.shift.events.filter((e) => e.t <= t + 1e-6).reverse().sort((a, b) => b.t - a.t).slice(0, 40);
  const html = ev.length ? `<ol class="log">${ev.map((e) => `<li><span class="t">${fmt.clock(e.t)}</span><i class="dot ${EVENT_CLS[e.type] || ''}"></i><span>${escapeHtml((EVENT_TEXT[e.type] || ((x) => x.type))(e))}</span></li>`).join('')}</ol>` : '<p class="empty">Chưa có sự kiện.</p>';
  if (box._last !== html) { box._last = html; box.innerHTML = html; }
}

function renderTrips() {
  renderLog();
  const box = $('#k-trips', root);
  if (!box) return;
  const ob = orderById();
  const st = ctx.store.state;
  const all = st.orders.filter((o) => o.status !== 0 || trips().some((tr) => tr.stops.some((s) => s.order === o.id)));
  const done = st.orders.filter((o) => o.status === 2).length;
  const live = st.orders.filter((o) => o.status === 1).length;
  const failed = st.orders.filter((o) => o.status === 3).length;
  const late = st.orders.filter((o) => o.status === 2 && o.late).length;
  const pending = st.orders.filter((o) => o.status === 0).length;
  const returned = st.orders.filter((o) => o.status === 5).length;
  const cancelled = st.orders.filter((o) => o.status === 4).length;
  const absent = st.shippers.map((s, i) => ({ ...s, i })).filter((s) => s.absent);
  const counted = all.filter((o) => o.status !== 4);
  $('#k-summary', root).innerHTML = `<div class="kpis"><div class="kpi"><b>${done}/${counted.length}</b><span>đã giao</span></div><div class="kpi"><b>${live}</b><span>đang giao</span></div><div class="kpi"><b style="${late ? 'color:var(--jam)' : ''}">${late}</b><span>trễ</span></div><div class="kpi"><b style="${failed + returned ? 'color:var(--stop)' : ''}">${failed + returned}</b><span>thất bại</span></div></div>
    ${returned || cancelled ? `<p class="muted" style="font-size:12.5px;margin:-6px 0 8px">${returned ? `${returned} đơn hoàn kho sau ${st.shift.maxAttempts} lần giao thất bại` : ''}${returned && cancelled ? ' · ' : ''}${cancelled ? `${cancelled} đơn khách huỷ` : ''}</p>` : ''}
    ${absent.length ? `<div class="notice info staff-only">Đang nghỉ: ${absent.map((s) => `${escapeHtml(s.name)} <button type="button" class="btn small" data-back="${s.i}">Có mặt lại</button>`).join(' ')}</div>` : ''}
    ${pending ? `<div class="notice warn staff-only">${pending} đơn chưa có chuyến. <a href="#dispatch">Điều phối tiếp</a></div>` : ''}`;
  $('#k-summary', root).querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => guard(async () => {
    const res = await ctx.store.mutate('shift/available', { index: b.dataset.back });
    toast(res.message);
  }, b)));
  const html = trips().map((tr, i) => {
    const color = colorOf(tr, i);
    const n = tr.stops.length;
    const d = tr.stops.filter((s) => ob.get(s.order) && ob.get(s.order).status === 2).length;
    const stops = tr.stops.map((s) => {
      const o = ob.get(s.order) || {};
      const cancel = `<button class="btn small ghost staff-only" data-cancel="${s.order}" title="Khách huỷ đơn">Huỷ</button>`;
      const act = o.status === 1 ? `<button class="btn small ghost danger" data-fail="${s.order}" title="Báo giao thất bại (lần ${(o.attempts || 0) + 1}/${ctx.store.state.shift.maxAttempts})">Thất bại</button>${cancel}`
        : o.status === 3 ? `<button class="btn small ghost staff-only" data-requeue="${s.order}" title="Đưa về hàng chờ để giao lần ${(o.attempts || 0) + 1}">Giao lại</button>${cancel}` : '';
      return `<div class="stop-line ${o.late ? 'late' : ''}"><span class="t">${fmt.clock(o.deliveredAt ?? s.eta)}</span><span class="n">${escapeHtml(s.name)} <small class="muted">đơn ${s.order}${o.deadline >= 0 ? `, hạn ${fmt.clock(o.deadline)}` : ''}</small><br>${statusChip(o)}</span><span class="act">${act}</span></div>`;
    }).join('');
    return `<div class="route-card trip">
      <header>${avatar(tr.name, color, tr.vehicleName, 'sm')}<b>${escapeHtml(tr.name)}</b>${tr.shipper >= 0 && !(st.shippers[tr.shipper] || {}).absent && positionOf(tr, t).state !== 'done' ? `<button class="btn small ghost staff-only" data-absent="${tr.shipper}" title="Shipper nghỉ đột xuất: dừng chuyến, đơn chưa giao về hàng chờ">Báo nghỉ</button>` : ''}${tr.accepted === false ? `<button class="btn small ghost staff-only" data-recall="${tr.id}" title="Shipper chưa nhận chuyến: thu hồi để phân công lại">Thu hồi</button>` : ''}<button class="btn small ghost" data-print="${tr.id}" title="In phiếu giao">In phiếu</button></header>
      ${tr.accepted === false ? '<div class="notice warn" style="margin:4px 0 8px">Chờ shipper nhận chuyến</div>' : ''}
      ${tr.note ? `<div class="notice ${tr.reroutes ? 'info' : 'warn'}" style="margin:4px 0 8px">${escapeHtml(tr.note)}</div>` : ''}
      <div class="meta">${escapeHtml(tr.vehicleName)}, ${fmt.num(tr.load)}${tr.capacity ? `/${fmt.num(tr.capacity)}` : ''} kg, ${fmt.km(tr.km)}, ${fmt.vnd(tr.cost)}</div>
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${d}"><i style="width:${n ? (d / n) * 100 : 0}%;background:${color}"></i></div>
      <div class="trip-status split"><span>${tripStatus(tr)}</span><span class="muted" style="font-weight:400;font-size:12px">${d}/${n} điểm</span></div>
      ${stops}
    </div>`;
  }).join('');
  if (html === box._last) return;   // không đổi gì: giữ nguyên DOM để nút bấm không bị dựng lại
  box._last = html;
  box.innerHTML = html;
  box.querySelectorAll('[data-fail]').forEach((b) => b.addEventListener('click', () => askFailReason(Number(b.dataset.fail))));
  box.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm(`Khách huỷ đơn ${b.dataset.cancel}?`)) return;
    askReason(`Huỷ đơn ${b.dataset.cancel}`, { presets: ['Khách yêu cầu huỷ qua điện thoại', 'Không liên lạc được người gửi'], ok: 'Huỷ đơn', note: 'Đơn đã phân công cho shipper sẽ tính phí huỷ theo biểu phí.' })
      .then((why) => why && guard(async () => { const res = await ctx.store.mutate('order/cancel', { id: b.dataset.cancel, reason: why }); toast(res.message); }));
  }));
  box.querySelectorAll('[data-absent]').forEach((b) => b.addEventListener('click', () => {
    const s = ctx.store.state.shippers[Number(b.dataset.absent)];
    if (!confirm(`${s.name} nghỉ đột xuất lúc ${fmt.clock(t)}? Chuyến dừng ở điểm kế tiếp, đơn chưa giao quay về hàng chờ.`)) return;
    guard(async () => {
      await syncClock();
      const res = await ctx.store.mutate('shift/absent', { index: b.dataset.absent });
      toast(res.message);
    });
  }));
  box.querySelectorAll('[data-recall]').forEach((b) => b.addEventListener('click', () => {
    askReason(`Thu hồi chuyến ${b.dataset.recall}`, { presets: ['Shipper không phản hồi', 'Cần đổi shipper gần hơn', 'Xe gặp sự cố'], ok: 'Thu hồi', note: 'Các đơn trong chuyến trở về hàng chờ; không tính là shipper từ chối.' })
      .then((why) => why && guard(async () => { const res = await ctx.store.mutate('trip/recall', { id: b.dataset.recall, reason: why }); toast(res.message); }));
  }));
  box.querySelectorAll('[data-requeue]').forEach((b) => b.addEventListener('click', () => guard(async () => {
    await ctx.store.mutate('shift/requeue', { id: b.dataset.requeue });
    toast(`Đơn ${b.dataset.requeue} đã về hàng chờ, có thể điều phối lại`);
  })));
  box.querySelectorAll('[data-print]').forEach((b) => b.addEventListener('click', () => {
    printTrips(trips().filter((tr) => String(tr.id) === b.dataset.print), ctx.store.state);
  }));
}

function render() {
  const st = ctx.store.state;
  if (!trips().length) {
    pause();
    root.innerHTML = `<div class="page-head"><h1>Theo dõi</h1></div>
      <p class="empty" style="margin-bottom:12px">${st.me && st.me.role !== 'admin' ? 'Bạn chưa có chuyến nào trong ca này. Bật "Sẵn sàng nhận đơn" ở trang Chuyến của tôi, lời mời sẽ hiện ngay khi có đơn gần bạn.' : 'Chưa có chuyến nào. Khi khách đặt đơn, hệ thống tự mời shipper gần nhất; hoặc áp dụng một phương án ở trang Điều phối.'}</p>
      <div class="actions staff-only"><a class="btn primary" href="#dispatch">Điều phối</a>${st.shift.history.length ? '<a class="btn" href="#reports">Báo cáo</a>' : ''}</div>`;
    ctx.map.setMarkers([]);
    ctx.map.setEdgeStyles(new Map());
    drawMap.trafficBucket = null;
    ctx.map.setPaths([]);
    ctx.map.setNodeStyles(new Map());
    ctx.map.setLegend([]);
    return;
  }
  if (!$('#k-clock', root)) {
    root.innerHTML = `<div class="page-head"><h1>Theo dõi</h1><button class="btn small ghost danger admin-only" id="k-reset" title="Xoá các chuyến, mọi đơn về chờ giao">Đặt lại ca</button></div>
      <div class="block clock-block">
        <div class="split" style="align-items:flex-end"><div><div class="clock" id="k-clock" aria-live="off"></div><p class="muted" id="k-sub" style="font-size:12.5px"></p></div>
        <div style="width:150px">${segmented('speed', SPEEDS, speed)}</div></div>
        <input type="range" id="k-slider" min="0" step="0.5" aria-label="Thời điểm trong ca">
        <div class="actions" style="margin-top:8px"><button class="btn primary" id="k-play" aria-pressed="false" style="min-width:96px">Chạy</button><button class="btn" id="k-end">Tới cuối ca</button><button class="btn ghost staff-only" id="k-reroute" title="Tính lại tuyến các chuyến theo tình trạng giao thông hiện tại (đường đóng, kẹt xe)">Tính lại tuyến</button></div>
      </div>
      <div class="block" style="padding-bottom:4px"><div id="k-summary"></div></div>
      <div class="block" style="padding-bottom:0"><div class="split"><h2>Các chuyến</h2><button class="btn small ghost" id="k-print-all">In tất cả phiếu</button></div></div>
      <div id="k-trips"></div>
      <div class="block"><h2>Nhật ký ca</h2><div id="k-log"></div></div>`;
    $('#k-play', root).addEventListener('click', () => (playing ? pause() : play()));
    $('#k-end', root).addEventListener('click', () => { t = endTime(); pause(); syncProgress(); frame(performance.now()); });
    $('#k-slider', root).addEventListener('input', (e) => { t = Number(e.target.value); syncProgress(); frame(performance.now()); });
    bindSegmented(root, (n, v) => { speed = v; });
    $('#k-print-all', root).addEventListener('click', () => printTrips(trips(), ctx.store.state));
    $('#k-reroute', root).addEventListener('click', (e) => guard(async () => {
      await syncClock();
      await ctx.store.mutate('shift/reroute');
    }, e.currentTarget));
    $('#k-reset', root).addEventListener('click', (e) => {
      if (!confirm('Đặt lại ca? Mọi chuyến sẽ bị xoá, các đơn quay về chờ giao.')) return;
      guard(async () => { const res = await ctx.store.mutate('shift/reset'); pause(); t = 0; toast(res.message); }, e.currentTarget);
    });
  }
  updatePlayButton();
  updateClock();
  renderTrips();
  drawMap();
}

export default {
  id: 'tracking',
  title: 'Theo dõi ca giao',
  mount(panel, c) {
    ctx = c;
    root = document.createElement('div');
    panel.append(root);
    t = Math.max(t, ctx.store.state.shift.clock);
    if (!trips().length) t = 0;
    drawMap.legendSet = false;
    drawMap.trafficBucket = null;
    ctx.map.setHint(null);
    render();
    if (trips().length) ctx.map.ensureVisible(trips().flatMap((tr) => tr.path));
  },
  unmount() {
    pause();
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    root = null;
    // Rời trang khi ca đang chạy: báo giờ hiện tại để sự cố giao thông báo sau đó tính đúng vị trí xe
    if (trips().length && t > ctx.store.state.shift.clock + 1e-6) api.post('shift/progress', { t: t.toFixed(2) }).then((res) => ctx.store.set(res)).catch(() => {});
  },
  // Ca đang tự chạy (ghép đơn tự động): đồng hồ và xe bám theo giờ ca thật, không cần bấm Chạy
  onTick(state) {
    if (!root || playing || !state.shift.trips.length || !(state.shift.speed > 0) || !$('#k-clock', root)) return;
    const c = liveClock(state);
    if (c <= t) return;
    t = c;
    updateClock();
    drawMap();
  },
  onState(state) {
    if (!root) return;
    if (!state.shift.trips.length) { t = 0; root.innerHTML = ''; }
    t = Math.max(t, state.shift.clock);
    render();
  },
};
