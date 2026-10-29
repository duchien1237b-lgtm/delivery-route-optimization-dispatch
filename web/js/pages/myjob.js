// Trang Chuyến của tôi (vai trò shipper), vận hành kiểu Grab: hệ thống tự gửi đơn mới cho shipper GẦN KHO NHẤT, hiện thẻ
// lời mời có đồng hồ đếm ngược; shipper nhận thì mới đi giao, bỏ qua / hết giờ thì đơn chuyển cho người gần nhất kế tiếp.
// Trên trang: bật / tắt sẵn sàng nhận đơn, đặt vị trí đang đứng (căn cứ để chọn người gần nhất), nhận / từ chối lời mời,
// danh sách điểm giao theo thứ tự, nhả đơn khi chưa lấy hàng, xác nhận đã giao bằng mã 4 số của người nhận (đơn thu hộ phải nhập
// đúng số tiền đã thu), báo giao thất bại kèm lý do, đánh giá khách sau khi giao, tiền thu hộ đang giữ phải nộp cuối ca.
// Dữ liệu do server lọc sẵn: shipper chỉ nhận được lời mời, chuyến và đơn của chính mình.
import { api } from '../api.js';
import { escapeHtml } from '../store.js';
import {
  fmt, money, guard, toast, statusChip, ROUTE_COLORS, tripPosition, pickFailReason, askReason, showModal, $, pathKm, pickedUp, liveClock,
} from '../ui.js';
import { deliverDialog, openOrder } from '../orders.js';

let ctx, root;
const deadlines = new Map();   // mã lời mời -> thời điểm hết hạn (ms, đồng hồ trình duyệt)
const refreshed = new Set();   // lời mời đã hết giờ và đã gọi tải lại state

function myStops(st) {
  const ob = new Map(st.orders.map((o) => [o.id, o]));
  const list = [];
  for (const tr of st.shift.trips.filter((t) => t.accepted))
    for (const s of tr.stops) {
      const o = ob.get(s.order);
      if (o) list.push({ trip: tr, stop: s, order: o });
    }
  list.sort((a, b) => a.stop.eta - b.stop.eta);
  return list;
}

function drawMap(st, list) {
  const map = ctx.map;
  const me = st.me;
  const color = ROUTE_COLORS[Math.max(0, me.shipper) % ROUTE_COLORS.length];
  const clock = liveClock(st);
  const paths = [], markers = [], styles = new Map();
  for (const tr of st.shift.trips) {
    if (tr.approach && tr.approach.length > 1) paths.push({ nodes: tr.approach, color, width: 4, opacity: 0.6, dash: '6 6', animate: false, arrows: true });
    paths.push({ nodes: tr.path, color, width: 5, opacity: tr.accepted ? 0.45 : 0.3, animate: false, arrows: true });
    if (!tr.accepted) {
      const dep = tr.path[0];
      if (dep != null) styles.set(dep, { badge: 'KHO', badgeColor: 'var(--road)', keep: true, tip: `Lấy hàng tại kho (lời mời #${tr.id})` });
      continue;
    }
    const pos = tripPosition(tr, clock, ctx.store.nodesById);
    if (pos && pos.state !== 'done' && pos.state !== 'wait') markers.push({ lat: pos.lat, lon: pos.lon, color, label: (me.displayName.trim().split(/\s+/).pop() || '?')[0].toUpperCase(), title: 'Vị trí của bạn' });
  }
  if (!markers.length && me.shipper >= 0) {
    const sh = st.shippers[me.shipper];
    const n = sh && ctx.store.nodesById.get(sh.node);
    if (n && !sh.busy) markers.push({ lat: n.x, lon: n.y, color, label: (me.displayName.trim().split(/\s+/).pop() || '?')[0].toUpperCase(), title: `Bạn đang ở ${n.name}` });
  }
  list.forEach(({ stop, order }, i) => {
    const badge = order.status === 2 ? '✓' : order.status === 3 ? '✕' : order.status === 5 ? '↩' : String(i + 1);
    const badgeColor = order.status === 2 ? 'var(--go)' : order.status === 3 ? 'var(--stop)' : order.status === 5 ? 'var(--jam)' : color;
    styles.set(stop.node, { badge, badgeColor, keep: true, tip: `Đơn ${order.id}: ${order.recipient || ''} ${order.statusName}` });
  });
  map.setPaths(paths, { animate: false });
  map.setNodeStyles(styles);
  map.setMarkers(markers);
  map.setDim(paths.length > 0);
  map.setLegend(paths.length ? [{ type: 'dash', color, label: 'Đường tới kho lấy hàng' }, { type: 'line', color, label: 'Lộ trình giao' }, { type: 'badge', color: 'var(--go)', label: '✓ đã giao  ✕ thất bại  ↩ hoàn kho' }] : []);
}

// Thẻ lời mời nhận đơn (kiểu Grab): đồng hồ đếm ngược, quãng đường tới kho, quãng đường giao, thu nhập, thông tin khách
function offerCard(st, t, ob) {
  const orders = t.stops.map((s) => ob.get(s.order)).filter(Boolean);
  const total = Math.max(1, st.shift.offerSeconds || 45);
  if (!deadlines.has(t.id)) deadlines.set(t.id, st._rx + (t.offerLeft != null ? t.offerLeft : total) * 1000);
  const toDepot = t.approach && t.approach.length > 1 ? pathKm(st, t.approach) : 0;
  const mins = t.approachTimes && t.approachTimes.length ? t.approachTimes[t.approachTimes.length - 1] - t.approachTimes[0] : 0;
  const earn = orders.reduce((a, o) => a + (o.earn || 0), 0);
  const collect = orders.reduce((a, o) => a + (o.collect || o.cod || 0), 0);
  return `<article class="offer-card" data-offer="${t.id}" data-total="${total}">
      <header><b>Đơn mới gần bạn</b><span class="offer-left" aria-live="off"></span></header>
      <div class="offer-timer" role="progressbar" aria-label="Thời gian còn lại để nhận đơn"><i></i></div>
      <div class="offer-route">
        <div><span class="dotpin from"></span><div><small>Lấy hàng tại kho</small><b>${escapeHtml(ctx.store.name(t.path[0]))}</b><em>${t.from === t.path[0] ? 'bạn đang ở kho' : `cách bạn ${fmt.min(mins)} · ${fmt.km(toDepot)}`}</em></div></div>
        ${t.stops.map((s) => { const o = ob.get(s.order); return `<div><span class="dotpin to"></span><div><small>Giao tới</small><b>${escapeHtml(s.name)}</b><em>${o ? escapeHtml(o.recipient || '') : ''}${o && o.urgent ? ' · <span class="chip urgent">Gấp</span>' : ''}${o ? ` · ${fmt.num(o.weight)} kg` : ''}</em></div></div>`; }).join('')}
      </div>
      <div class="offer-sum">
        <span>Quãng đường giao <b>${fmt.km(t.km)}</b></span>
        <span>Thu nhập <b class="earn">+${money(earn)}</b></span>
        ${collect ? `<span>Thu của người nhận <b>${money(collect)}</b></span>` : ''}
        ${orders[0] && orders[0].customerName ? `<span>Khách <b>${escapeHtml(orders[0].customerName)}</b>${orders[0].customerRating ? ` · ★ ${fmt.num(orders[0].customerRating)} (${orders[0].customerRatings})` : ' · khách mới'}</span>` : ''}
      </div>
      <div class="actions"><button class="btn primary" data-accept="${t.id}">Nhận đơn</button><button class="btn ghost danger" data-decline="${t.id}">Bỏ qua</button></div>
    </article>`;
}

function render() {
  const st = ctx.store.state;
  const me = st.me;
  const ship = st.shippers[me.shipper];
  const list = myStops(st);
  const offers = st.shift.trips.filter((t) => !t.accepted);
  const ob = new Map(st.orders.map((o) => [o.id, o]));
  const fin = (st.finance && st.finance.shippers && st.finance.shippers[0]) || null;
  const nextIdx = list.findIndex((x) => x.order.status === 1);
  const done = list.filter((x) => x.order.status === 2).length;
  const earned = list.filter((x) => x.order.status === 2).reduce((a, x) => a + (x.order.earn || 0), 0);
  const codStops = list.filter((x) => x.order.status === 1 && (x.order.collect || x.order.cod) > 0);   // thu hộ + cước người nhận trả
  const events = st.shift.events.slice().reverse().slice(0, 8);
  const clock = liveClock(st);
  const where = ship ? ctx.store.name(ship.node) : '';
  for (const id of [...deadlines.keys()]) if (!offers.some((t) => t.id === id)) { deadlines.delete(id); refreshed.delete(id); }

  root.innerHTML = `<div class="page-head"><h1>Chuyến của tôi</h1><a class="btn small ghost" href="#cod">Sổ COD</a></div>
    ${offers.length ? offers.map((t) => offerCard(st, t, ob)).join('') : ''}
    <p class="hello">Xin chào <b>${escapeHtml(me.displayName)}</b>${ship ? ` · ${escapeHtml(ship.vehicleName)}, chở tối đa ${fmt.num(ship.capacity)} kg` : ''} · giờ ca <b data-clock>${fmt.clock(clock)}</b></p>
    ${me.shipper < 0 ? '<div class="notice warn">Tài khoản chưa gắn với shipper nào trong đội xe. Hãy báo quản trị viên.</div>' : ''}
    <label class="ready-toggle ${me.ready ? 'on' : ''}"><input type="checkbox" id="j-ready" ${me.ready ? 'checked' : ''}><span><b>${me.ready ? 'Đang bật nhận đơn' : 'Đang tạm nghỉ'}</b><small>${me.ready ? 'Hệ thống sẽ gửi đơn mới gần bạn nhất, bạn có vài chục giây để nhận' : 'Bạn sẽ không nhận được lời mời đơn mới'}</small></span></label>
    ${ship ? `<form class="loc-card" id="j-loc"><div><small>Vị trí của bạn (căn cứ để chọn người gần kho nhất)</small><b>${escapeHtml(where)}</b></div>
      <select name="node" aria-label="Chọn vị trí" ${ship.busy ? 'disabled' : ''}>${ctx.store.nodeOptions(ship.node)}</select>
      <button class="btn small" ${ship.busy ? 'disabled title="Đang có đơn: vị trí cập nhật theo hành trình"' : ''}>Cập nhật</button></form>` : ''}
    <div class="cod-card">
      <span>Tiền thu hộ đang giữ, nộp lại cuối ca</span>
      <b>${money(fin ? fin.codCollected : 0)}</b>
      <div class="row2"><span>Còn phải thu <b>${money(codStops.reduce((sum, x) => sum + (x.order.collect || x.order.cod || 0), 0))}</b></span><span>Đã giao <b>${done}/${list.length}</b></span><span>Thu nhập <b>${money(earned)}</b></span>${fin ? `<span>Quãng đường <b>${fmt.km(fin.km)}</b></span>` : ''}</div>
    </div>
    ${list.length || offers.length ? '' : `<p class="empty">${me.ready ? 'Chưa có đơn nào. Khi có đơn mới gần bạn, lời mời nhận đơn sẽ hiện ở đây kèm đồng hồ đếm ngược.' : 'Bạn đang tạm nghỉ. Bật “nhận đơn” để hệ thống gửi đơn gần bạn.'}</p>`}
    ${codStops.length ? `<p class="muted" style="font-size:13px;margin:0 0 10px">${codStops.length} điểm cần thu tiền, đếm kỹ trước khi giao hàng.</p>` : ''}
    <div id="j-stops">${list.map(({ trip, stop, order: o }, i) => {
      const before = o.status === 1 && !pickedUp(trip, clock);
      const leftMin = before ? Math.max(0, Math.ceil(trip.pathTimes[0] - clock)) : 0;
      return `<article class="stop-card ${i === nextIdx ? 'next' : ''}" data-node="${stop.node}">
        <header><span class="num">${i + 1}</span><span class="who"><b>${escapeHtml(o.recipient || o.destinationName)}</b><small>${escapeHtml(o.destinationName)} · đơn ${o.id}</small></span>${statusChip(o)}</header>
        ${o.status === 1 ? `<p class="phase ${before ? 'pickup' : 'drive'}" data-phase="${o.id}">${before ? `① Đang tới kho lấy hàng, còn khoảng <b>${leftMin} phút</b>` : '② Đã lấy hàng, đang trên đường giao'}</p>` : ''}
        <div class="meta">
          <span>Dự kiến <b>${fmt.clock(stop.eta)}</b></span>
          ${o.deadline >= 0 ? `<span>Hạn ${fmt.clock(o.deadline)}</span>` : ''}
          <span>${fmt.num(o.weight)} kg${o.urgent ? ' · <span class="chip urgent">Gấp</span>' : ''}</span>
          ${(o.collect || o.cod) ? `<span>Thu của người nhận <b>${money(o.collect || o.cod)}</b>${o.collect > o.cod ? ` <small class="muted">(${o.cod ? `thu hộ ${money(o.cod)} + ` : ''}cước ${money(o.collect - o.cod)})</small>` : ''}</span>` : '<span>Không thu tiền</span>'}
          ${o.earn ? `<span>Thu nhập <b class="earn">+${money(o.earn)}</b></span>` : ''}
          ${o.customerName ? `<span>Khách ${escapeHtml(o.customerName)}${o.customerRating ? ` · ★ ${fmt.num(o.customerRating)}` : ''}</span>` : ''}
          ${o.dims ? `<span>Kiện ${escapeHtml(o.dims)} cm</span>` : ''}${o.value ? `<span>Hàng giá trị ${money(o.value)}, giao cẩn thận</span>` : ''}
          ${o.phone ? `<a href="tel:${escapeHtml(o.phone)}">${escapeHtml(o.phone)}</a>` : ''}
          ${o.note ? `<span class="muted">${escapeHtml(o.note)}</span>` : ''}
          ${o.failReasonName && o.status !== 2 ? `<span style="color:var(--stop)">${escapeHtml(o.failReasonName)}</span>` : ''}
        </div>
        ${o.status === 1 ? `<div class="acts"><button class="btn small primary" data-deliver="${o.id}">Đã giao</button><button class="btn small ghost danger" data-fail="${o.id}">Giao thất bại</button>${before ? `<button class="btn small ghost" data-release="${o.id}" data-rel>Nhả đơn</button>` : ''}<button class="btn small ghost" data-open="${o.id}">Chi tiết</button></div>` : ''}
        ${o.status === 2 && o.customerName ? `<div class="acts">${o.ratedCustomer ? '<span class="muted small">Bạn đã đánh giá khách này</span>' : `<button class="btn small" data-rate="${o.id}">Đánh giá khách ★</button>`}</div>` : ''}
      </article>`;
    }).join('')}</div>
    ${events.length ? `<div class="block" style="margin-top:6px"><h2>Nhật ký của bạn</h2><ol class="log">${events.map((e) => `<li><span class="t">${fmt.clock(e.t)}</span><i class="dot ${e.type === 'delivered' ? 'ok' : e.type === 'failed' ? 'late' : e.type === 'returned' ? 'warn' : ''}"></i><span>${escapeHtml(eventText(e))}</span></li>`).join('')}</ol></div>` : ''}`;

  root.querySelector('#j-ready').addEventListener('change', (e) => guard(async () => {
    const res = await api.post('shipper/ready', { ready: e.target.checked ? 1 : 0 });
    toast(res.message);
    await ctx.store.refresh();
  }));
  const loc = root.querySelector('#j-loc');
  if (loc) loc.addEventListener('submit', (e) => {
    e.preventDefault();
    guard(async () => {
      const res = await api.post('shipper/location', { node: loc.node.value });
      toast(res.message);
      await ctx.store.refresh();
    }, loc.querySelector('button'));
  });
  for (const b of root.querySelectorAll('[data-accept]')) b.addEventListener('click', () => guard(async () => { const res = await ctx.store.mutate('trip/accept', { id: b.dataset.accept }); toast(res.message); }, b));
  for (const b of root.querySelectorAll('[data-decline]')) b.addEventListener('click', async () => {
    const why = await askReason('Bỏ qua đơn này?', { presets: ['Xe hỏng', 'Quá tải trọng', 'Đang bận việc đột xuất', 'Điểm giao quá xa'], ok: 'Bỏ qua đơn', note: 'Đơn sẽ chuyển cho shipper gần nhất kế tiếp và không gửi lại cho bạn. Bỏ qua nhiều sẽ ảnh hưởng điểm đánh giá của bạn.' });
    if (why) guard(async () => { const res = await ctx.store.mutate('trip/decline', { id: b.dataset.decline, reason: why }); toast(res.message); });
  });
  for (const b of root.querySelectorAll('[data-release]')) b.addEventListener('click', async () => {
    const why = await askReason(`Nhả đơn ${b.dataset.release}?`, { presets: ['Xe hỏng giữa đường', 'Không liên lạc được người gửi', 'Có việc đột xuất'], ok: 'Nhả đơn', note: 'Chỉ nhả được khi chưa lấy hàng ở kho. Đơn quay lại hàng chờ và được gửi cho shipper khác; việc nhả đơn được tính vào điểm đánh giá của bạn.' });
    if (why) guard(async () => { const res = await ctx.store.mutate('order/release', { id: b.dataset.release, reason: why }); toast(res.message); });
  });
  for (const b of root.querySelectorAll('[data-rate]')) b.addEventListener('click', (e) => { e.stopPropagation(); rateCustomerDialog(Number(b.dataset.rate)); });
  for (const b of root.querySelectorAll('[data-deliver]')) b.addEventListener('click', (e) => {
    e.stopPropagation();
    deliverDialog(st.orders.find((x) => x.id === Number(b.dataset.deliver)));
  });
  for (const b of root.querySelectorAll('[data-open]')) b.addEventListener('click', (e) => { e.stopPropagation(); openOrder(Number(b.dataset.open), { go: ctx.go }); });
  for (const b of root.querySelectorAll('[data-fail]')) {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const o = st.orders.find((x) => x.id === Number(b.dataset.fail));
      pickFailReason(st, o, (reason) => guard(async () => {
        const res = await ctx.store.mutate('shift/fail', { id: o.id, reason });
        toast(res.message || `Đã báo đơn ${o.id} thất bại`);
      }));
    });
  }
  for (const c of root.querySelectorAll('.stop-card')) c.addEventListener('click', () => ctx.map.focusNode(Number(c.dataset.node)));
  tickOffers();
  drawMap(st, list);
}

// Shipper đánh giá khách sau khi giao (đánh giá hai chiều)
function rateCustomerDialog(id) {
  const st = ctx.store.state;
  const o = st.orders.find((x) => x.id === id);
  if (!o) return;
  showModal(`Đánh giá khách của đơn ${id}`, `<form id="rc-form" class="rate-form"><p class="muted" style="margin:-4px 0 10px">${escapeHtml(o.customerName || 'Khách hàng')} · ${escapeHtml(o.destinationName)}</p>
    <fieldset class="stars"><legend>Mức độ hợp tác của khách</legend>
    ${[5, 4, 3, 2, 1].map((n) => `<input type="radio" name="stars" value="${n}" id="rc${n}"><label for="rc${n}" title="${n} sao">★</label>`).join('')}</fieldset>
    <input name="comment" maxlength="200" placeholder="Nhận xét (không bắt buộc), vd: nghe máy ngay, địa chỉ rõ ràng">
    <div class="actions"><button class="btn primary">Gửi đánh giá</button></div></form>`);
  const f = $('#rc-form');
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const stars = (f.querySelector('[name=stars]:checked') || {}).value;
    if (!stars) { toast('Hãy chọn số sao', 'error'); return; }
    guard(async () => {
      const res = await api.post('order/rate-customer', { id, stars, comment: f.comment.value.trim() });
      $('#modal').close();
      toast(res.message);
      await ctx.store.refresh();
    }, f.querySelector('button'));
  });
}

// Chạy mỗi giây: đồng hồ đếm ngược của lời mời, giờ ca, xe di chuyển trên bản đồ
function tickOffers() {
  if (!root) return;
  const now = Date.now();
  for (const el of root.querySelectorAll('.offer-card')) {
    const id = Number(el.dataset.offer), total = Number(el.dataset.total);
    const left = Math.max(0, Math.ceil(((deadlines.get(id) || now) - now) / 1000));
    el.querySelector('.offer-left').textContent = left > 0 ? `${left}s` : 'Hết giờ';
    el.querySelector('.offer-timer i').style.width = `${Math.min(100, (left / total) * 100)}%`;
    el.classList.toggle('urgent', left <= 10);
    if (left <= 0 && !refreshed.has(id)) {
      refreshed.add(id);
      ctx.store.refresh().catch(() => {});
    }
  }
}
function tick(st) {
  if (!root) return;
  tickOffers();
  const clock = liveClock(st);
  const c = root.querySelector('[data-clock]');
  if (c) c.textContent = fmt.clock(clock);
  const list = myStops(st);
  for (const { trip, order: o } of list) {
    const ph = root.querySelector(`[data-phase="${o.id}"]`);
    if (!ph || o.status !== 1) continue;
    if (!pickedUp(trip, clock)) ph.innerHTML = `① Đang tới kho lấy hàng, còn khoảng <b>${Math.max(0, Math.ceil(trip.pathTimes[0] - clock))} phút</b>`;
    else if (ph.classList.contains('pickup')) { ph.className = 'phase drive'; ph.innerHTML = '② Đã lấy hàng, đang trên đường giao'; root.querySelector(`[data-release="${o.id}"]`)?.remove(); }
  }
  drawMap(st, list);
}

function eventText(e) {
  switch (e.type) {
    case 'delivered': return `Giao xong đơn ${e.order}${e.detail ? ` (${e.detail})` : ''}`;
    case 'failed': return `Đơn ${e.order} thất bại: ${e.detail}`;
    case 'returned': return `Đơn ${e.order} hoàn kho: ${e.detail}`;
    case 'cancelled': return `Đơn ${e.order} đã bị huỷ`;
    case 'accepted': return `Bạn nhận đơn ${e.order}`;
    case 'declined': return `Bạn bỏ qua đơn ${e.order}: ${e.detail}`;
    case 'expired': return `Bỏ lỡ lời mời đơn ${e.order} (hết giờ)`;
    case 'released': return `Bạn nhả đơn ${e.order}: ${e.detail}`;
    case 'offered': return `Nhận lời mời đơn ${e.order} (${e.detail})`;
    case 'assigned': return `Được phân công đơn ${e.order}`;
    case 'recalled': return `Quản trị viên thu hồi đơn ${e.order}`;
    case 'reroute': return `Đổi tuyến: ${e.detail}`;
    default: return e.detail || e.type;
  }
}

export default {
  id: 'myjob',
  title: 'Chuyến của tôi',
  mount(panel, c) {
    ctx = c;
    root = document.createElement('div');
    panel.append(root);
    deadlines.clear();
    refreshed.clear();
    render();
    ctx.onMap('nodeclick', (id) => {
      const card = root.querySelector(`.stop-card[data-node="${id}"]`);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  },
  unmount() { root = null; },
  onState() { if (root) render(); },
  onTick(st) { tick(st); },
};
