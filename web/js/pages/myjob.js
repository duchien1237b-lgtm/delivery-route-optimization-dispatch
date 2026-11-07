// Trang Chuyến của tôi (vai trò shipper): ĐƠN CHỜ NHẬN là bảng chung cho mọi shipper đang sẵn sàng; shipper nào bấm "Nhận đơn"
// trước thì giao đơn đó (người bấm sau nhận thông báo "đã có người nhận"). Trên trang: bật / tắt sẵn sàng, đặt vị trí đang đứng,
// bảng đơn chờ nhận (cập nhật mỗi 5 giây), danh sách điểm giao, nhả đơn khi chưa lấy hàng, báo "Đã giao tới" (đơn thu hộ phải nhập
// đúng số tiền đã thu) rồi chờ người nhận xác nhận lần hai, báo giao thất bại kèm lý do, tiền thu hộ đang giữ phải nộp cuối ca.
// Dữ liệu do server lọc sẵn: shipper chỉ thấy đơn chờ (chưa lộ SĐT người nhận), chuyến và đơn của chính mình.
import { api } from '../api.js';
import { escapeHtml } from '../store.js';
import {
  fmt, money, guard, toast, statusChip, ROUTE_COLORS, tripPosition, pickFailReason, askReason, showModal, $, pathKm, pickedUp, liveClock,
} from '../ui.js';
import { deliverDialog, openOrder } from '../orders.js';
import { directionsUrl } from '../gmaps.js';
import { chatButton, bindGrabx } from '../grabx.js';

let ctx, root;
let boardTimer = 0;
let boardHtml = '';

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

// Liên kết dẫn đường bằng ứng dụng Google Maps (không cần khoá API): điểm xuất phát là vị trí hiện tại của điện thoại.
function navLink(label, ids, vehicle, cls = 'btn small ghost') {
  const url = directionsUrl(ids.map((id) => ctx.store.nodesById.get(id)), { vehicle, fromHere: true });
  return url ? `<a class="${cls}" href="${url}" target="_blank" rel="noopener noreferrer" title="Mở Google Maps để chỉ đường">${label}</a>` : '';
}

function drawMap(st, list) {
  const map = ctx.map;
  const me = st.me;
  const color = ROUTE_COLORS[Math.max(0, me.shipper) % ROUTE_COLORS.length];
  const clock = liveClock(st);
  const paths = [], markers = [], styles = new Map();
  for (const tr of st.shift.trips) {
    if (tr.approach && tr.approach.length > 1) paths.push({ nodes: tr.approach, color, width: 4, opacity: 0.6, dash: '6 6', animate: false, arrows: true, geo: true, vehicle: tr.vehicleName });
    paths.push({ nodes: tr.path, color, width: 5, opacity: tr.accepted ? 0.45 : 0.3, animate: false, arrows: true, geo: true, vehicle: tr.vehicleName });
    if (!tr.accepted) {
      const dep = tr.path[0];
      if (dep != null) styles.set(dep, { badge: 'KHO', badgeColor: 'var(--road)', keep: true, tip: `Lấy hàng tại kho (chuyến #${tr.id})` });
      continue;
    }
    const pos = tripPosition(tr, clock, ctx.store.nodesById);
    if (pos && pos.state !== 'done' && pos.state !== 'wait') markers.push({ lat: pos.lat, lon: pos.lon, along: pos.along, color, label: (me.displayName.trim().split(/\s+/).pop() || '?')[0].toUpperCase(), title: 'Vị trí của bạn' });
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

// Thẻ chuyến do quản trị viên phân công tay: shipper bấm Nhận chuyến hoặc Bỏ qua
function offerCard(st, t, ob) {
  const orders = t.stops.map((s) => ob.get(s.order)).filter(Boolean);
  const toDepot = t.approach && t.approach.length > 1 ? pathKm(st, t.approach) : 0;
  const mins = t.approachTimes && t.approachTimes.length ? t.approachTimes[t.approachTimes.length - 1] - t.approachTimes[0] : 0;
  const earn = orders.reduce((a, o) => a + (o.earn || 0), 0);
  const collect = orders.reduce((a, o) => a + (o.collect || o.cod || 0), 0);
  return `<article class="offer-card" data-offer="${t.id}">
      <header><b>Chuyến được phân công cho bạn</b></header>
      <div class="offer-route">
        <div><span class="dotpin from"></span><div><small>Lấy hàng tại kho</small><b>${escapeHtml(ctx.store.name(t.path[0]))}</b><em>${t.from === t.path[0] ? 'bạn đang ở kho' : `cách bạn ${fmt.min(mins)} · ${fmt.km(toDepot)}`}</em></div></div>
        ${t.stops.map((s) => { const o = ob.get(s.order); return `<div><span class="dotpin to"></span><div><small>Giao tới</small><b>${escapeHtml(s.name)}</b><em>${o ? escapeHtml(o.recipient || '') : ''}${o && o.urgent ? ' · <span class="chip urgent">Hoả tốc</span>' : ''}</em></div></div>`; }).join('')}
      </div>
      <div class="offer-sum">
        <span>Quãng đường giao <b>${fmt.km(t.km)}</b></span>
        <span>Thu nhập <b class="earn">+${money(earn)}</b></span>
        ${collect ? `<span>Thu của người nhận <b>${money(collect)}</b></span>` : ''}
      </div>
      <div class="actions"><button class="btn primary" data-accept="${t.id}">Nhận chuyến</button><button class="btn ghost danger" data-decline="${t.id}">Bỏ qua</button></div>
    </article>`;
}

// Bảng đơn chờ nhận: mọi shipper sẵn sàng đều thấy; ai bấm "Nhận đơn" trước thì được đơn
function boardCard(o) {
  const wait = Math.floor((o.waitSeconds || 0) / 60);
  return `<article class="offer-card board-card ${o.urgent ? 'urgent' : ''}" data-board="${o.id}">
      <header><b>Đơn ${o.id}${o.categoryName ? ` · ${escapeHtml(o.categoryName)}` : ''}</b><span class="offer-left">${o.favorite ? '★ khách yêu thích bạn · ' : ''}chờ ${wait} phút</span></header>
      <div class="offer-route">
        <div><span class="dotpin to"></span><div><small>Giao tới</small><b>${escapeHtml(o.destinationName)}</b><em>${fmt.num(o.weight)} kg${o.urgent ? ' · <span class="chip urgent">Hoả tốc</span>' : ''}${o.deadline >= 0 ? ` · hạn ${fmt.clock(o.deadline)}` : ''}</em></div></div>
      </div>
      <div class="offer-sum">
        <span>Thu nhập <b class="earn">+${money(o.earn || 0)}</b></span>
        ${o.approachMinutes != null ? `<span>Tới kho lấy hàng <b>${fmt.min(o.approachMinutes)}</b></span>` : ''}
        ${o.collect ? `<span>Thu của người nhận <b>${money(o.collect)}</b></span>` : ''}
      </div>
      ${o.canClaim ? '' : `<p class="muted small" style="margin:6px 0 0">${escapeHtml(o.blockReason || 'Chưa nhận được đơn này')}</p>`}
      <div class="actions"><button class="btn primary" data-claim="${o.id}" ${o.canClaim ? '' : 'disabled'}>Nhận đơn</button></div>
    </article>`;
}
async function loadBoard() {
  if (!root) return;
  let r;
  try { r = await api.get('orders/open'); } catch { return; }
  const el = root && root.querySelector('#j-board');
  if (!el) return;
  let html = '';
  if (!r.enabled) html = '<div class="notice">Quản trị viên đang phân công đơn thủ công nên bảng đơn chờ nhận đang tắt.</div>';
  else if (!r.orders.length) html = `<p class="empty small">Chưa có đơn nào đang chờ. Khi khách đặt đơn mới, đơn sẽ hiện ở đây cho mọi shipper.${r.ready ? '' : ' Bạn đang tạm nghỉ nên chưa nhận được đơn.'}</p>`;
  else html = `<h2 class="board-title">Đơn chờ nhận (${r.orders.length})</h2><p class="muted small" style="margin:0 0 8px">Ai bấm “Nhận đơn” trước sẽ giao đơn đó.${r.busy ? ' Bạn cần giao xong đơn đang cầm trước khi nhận đơn mới.' : ''}</p>${r.orders.map(boardCard).join('')}`;
  if (html === boardHtml) return;
  boardHtml = html;
  el.innerHTML = html;
  for (const b of el.querySelectorAll('[data-claim]')) b.addEventListener('click', () => guard(async () => {
    try {
      const res = await ctx.store.mutate('order/claim', { id: b.dataset.claim });
      toast(res.message);
    } catch (e) {
      if (e.status === 409) { toast(e.message, 'error'); boardHtml = ''; await ctx.store.refresh(); loadBoard(); return; }
      throw e;
    }
  }, b));
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
  const done = list.filter((x) => x.order.status === 2 || x.order.status === 8).length;
  const earned = list.filter((x) => x.order.status === 2).reduce((a, x) => a + (x.order.earn || 0), 0);
  const codStops = list.filter((x) => x.order.status === 1 && (x.order.collect || x.order.cod) > 0);   // thu hộ + cước người nhận trả
  const events = st.shift.events.slice().reverse().slice(0, 8);
  const clock = liveClock(st);
  const where = ship ? ctx.store.name(ship.node) : '';

  root.innerHTML = `<div class="page-head"><h1>Chuyến của tôi</h1><a class="btn small ghost" href="#cod">Sổ COD</a></div>
    ${offers.length ? offers.map((t) => offerCard(st, t, ob)).join('') : ''}
    <div id="j-board"></div>
    <p class="hello">Xin chào <b>${escapeHtml(me.displayName)}</b>${ship ? ` · ${escapeHtml(ship.vehicleName)}, chở tối đa ${fmt.num(ship.capacity)} kg` : ''} · giờ ca <b data-clock>${fmt.clock(clock)}</b></p>
    ${me.shipper < 0 ? '<div class="notice warn">Tài khoản chưa gắn với shipper nào trong đội xe. Hãy báo quản trị viên.</div>' : ''}
    <div class="j-flow ${nextIdx >= 0 ? 'busy' : ''}"><div class="j-status">
    <label class="ready-toggle ${me.ready ? 'on' : ''}"><input type="checkbox" id="j-ready" ${me.ready ? 'checked' : ''}><span><b>${me.ready ? 'Đang bật nhận đơn' : 'Đang tạm nghỉ'}</b><small>${me.ready ? 'Đơn mới hiện trên bảng đơn chờ, bạn bấm nhận trước người khác thì được đơn' : 'Bạn sẽ không nhận được đơn mới'}</small></span></label>
    ${ship && ship.busy ? `<p class="loc-line muted small">Vị trí: <b>${escapeHtml(where)}</b> · tự cập nhật theo hành trình khi đang giao</p>` : ''}
    ${ship && !ship.busy ? `<form class="loc-card" id="j-loc"><div><small>Vị trí của bạn (để tính thời gian tới kho lấy hàng)</small><b>${escapeHtml(where)}</b></div>
      <select name="node" aria-label="Chọn vị trí" ${ship.busy ? 'disabled' : ''}>${ctx.store.nodeOptions(ship.node)}</select>
      <button class="btn small" ${ship.busy ? 'disabled title="Đang có đơn: vị trí cập nhật theo hành trình"' : ''}>Cập nhật</button></form>` : ''}
    <div class="cod-card">
      <span>Tiền thu hộ đang giữ, nộp lại cuối ca</span>
      <b>${money(fin ? fin.codCollected : 0)}</b>
      <div class="row2"><span>Còn phải thu <b>${money(codStops.reduce((sum, x) => sum + (x.order.collect || x.order.cod || 0), 0))}</b></span><span>Đã giao <b>${done}/${list.length}</b></span><span>Thu nhập <b>${money(earned)}</b></span>${fin ? `<span>Quãng đường <b>${fmt.km(fin.km)}</b></span>` : ''}</div>
    </div>
    <div id="j-extra"></div>
    </div><div class="j-work">
    ${list.length || offers.length ? '' : `<p class="empty">${me.ready ? 'Bạn chưa nhận đơn nào. Đơn khách mới đặt sẽ hiện ở mục “Đơn chờ nhận” phía trên.' : 'Bạn đang tạm nghỉ. Bật “nhận đơn” để hệ thống gửi đơn gần bạn.'}</p>`}
    ${codStops.length ? `<p class="muted" style="font-size:13px;margin:0 0 10px">${codStops.length} điểm cần thu tiền, đếm kỹ trước khi giao hàng.</p>` : ''}
    ${(() => {
      const pend = list.filter((x) => x.order.status === 1);
      if (pend.length < 2) return '';
      const t0 = pend[0].trip;
      const ids = [...(pickedUp(t0, clock) ? [] : [t0.path[0]]), ...pend.map((x) => x.stop.node)];
      return `<p class="nav-all">${navLink(`Dẫn đường cả chuyến (${pend.length} điểm)`, ids, t0.vehicleName)}</p>`;
    })()}
    <div id="j-stops">${list.map(({ trip, stop, order: o }, i) => {
      const before = o.status === 1 && !pickedUp(trip, clock);
      const leftMin = before ? Math.max(0, Math.ceil(trip.pathTimes[0] - clock)) : 0;
      return `<article class="stop-card ${i === nextIdx ? 'next' : ''}" data-node="${stop.node}">
        <header><span class="num">${i + 1}</span><span class="who"><b>${escapeHtml(o.recipient || o.destinationName)}</b><small>${escapeHtml(o.destinationName)} · đơn ${o.id}</small></span>${statusChip(o)}</header>
        ${o.status === 1 ? `<p class="phase ${before ? 'pickup' : 'drive'}" data-phase="${o.id}">${before ? `① Đang tới kho lấy hàng, còn khoảng <b>${leftMin} phút</b>` : '② Đã lấy hàng, đang trên đường giao'}</p>` : ''}
        <div class="meta">
          <span>Dự kiến <b>${fmt.clock(stop.eta)}</b></span>
          ${o.deadline >= 0 ? `<span>Hạn ${fmt.clock(o.deadline)}</span>` : ''}
          <span>${o.categoryName ? `${escapeHtml(o.categoryName)} · ` : ''}${fmt.num(o.weight)} kg${o.urgent ? ' · <span class="chip urgent">Gấp</span>' : ''}${o.category === 'devo' ? ' · <b>dễ vỡ, nhẹ tay</b>' : ''}</span>
          ${(o.collect || o.cod) ? `<span>Thu của người nhận <b>${money(o.collect || o.cod)}</b>${o.collect > o.cod ? ` <small class="muted">(${o.cod ? `thu hộ ${money(o.cod)} + ` : ''}cước ${money(o.collect - o.cod)})</small>` : ''}</span>` : '<span>Không thu tiền</span>'}
          ${o.earn ? `<span>Thu nhập <b class="earn">+${money(o.earn)}</b>${o.tip ? ` <small class="chip ok">tip ${money(o.tip)}</small>` : ''}</span>` : ''}
          ${o.customerName ? `<span>Khách ${escapeHtml(o.customerName)}</span>` : ''}
          ${o.dims ? `<span>Kiện ${escapeHtml(o.dims)} cm</span>` : ''}${o.value ? `<span>Hàng giá trị ${money(o.value)}, giao cẩn thận</span>` : ''}
          ${o.phone ? `<a href="tel:${escapeHtml(o.phone)}">${escapeHtml(o.phone)}</a>` : ''}
          ${o.note ? `<span class="muted">${escapeHtml(o.note)}</span>` : ''}
          ${o.failReasonName && o.status !== 2 ? `<span style="color:var(--stop)">${escapeHtml(o.failReasonName)}</span>` : ''}
        </div>
        ${o.status === 1 ? `<div class="acts"><button class="btn small primary" data-deliver="${o.id}">Đã giao tới</button><button class="btn small ghost danger" data-fail="${o.id}">Giao thất bại</button>${before ? `<button class="btn small ghost" data-release="${o.id}" data-rel>Nhả đơn</button>` : ''}<button class="btn small ghost" data-open="${o.id}">Chi tiết</button>${chatButton(o)}${navLink(before ? 'Chỉ đường tới kho' : 'Dẫn đường', [before ? trip.path[0] : stop.node], trip.vehicleName)}</div>` : ''}
        ${o.status === 8 ? '<p class="phase drive">③ Đã giao tới, chờ người nhận bấm xác nhận “Đã nhận hàng”</p>' : ''}
      </article>`;
    }).join('')}</div>
    </div></div>
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
    const why = await askReason('Bỏ qua đơn này?', { presets: ['Xe hỏng', 'Quá tải trọng', 'Đang bận việc đột xuất', 'Điểm giao quá xa'], ok: 'Bỏ qua đơn', note: 'Chuyến sẽ quay lại hàng chờ để quản trị viên phân công lại.' });
    if (why) guard(async () => { const res = await ctx.store.mutate('trip/decline', { id: b.dataset.decline, reason: why }); toast(res.message); });
  });
  for (const b of root.querySelectorAll('[data-release]')) b.addEventListener('click', async () => {
    const why = await askReason(`Nhả đơn ${b.dataset.release}?`, { presets: ['Xe hỏng giữa đường', 'Không liên lạc được người gửi', 'Có việc đột xuất'], ok: 'Nhả đơn', note: 'Chỉ nhả được khi chưa lấy hàng ở kho. Đơn quay lại bảng đơn chờ nhận cho shipper khác; nhả nhiều đơn liên tiếp thì bạn tự chuyển sang Tạm nghỉ.' });
    if (why) guard(async () => { const res = await ctx.store.mutate('order/release', { id: b.dataset.release, reason: why }); toast(res.message); });
  });
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
  bindGrabx(root, ctx.store, (id) => st.orders.find((x) => x.id === id));
  loadExtra();
  boardHtml = '';
  loadBoard();
  drawMap(st, list);
}

// Tiền tip, hạn mức tiền mặt đang giữ, số đơn nhả liên tiếp (nghiệp vụ kiểu Grab)
let extraSeq = 0;
async function loadExtra() {
  const seq = ++extraSeq;
  let s;
  try { s = await api.get('shipper/stats'); } catch { return; }
  const el = root && root.querySelector('#j-extra');
  if (!el || seq !== extraSeq) return;
  const parts = [];
  if (s.tips) parts.push(`<span>Tiền tip khách tặng <b class="earn">${money(s.tips)}</b></span>`);
  if (s.codHoldLimit > 0) {
    const pct = Math.min(100, Math.round((s.codHeld / s.codHoldLimit) * 100));
    parts.push(`<span>Tiền mặt đang giữ <b>${money(s.codHeld)}</b> / hạn mức ${money(s.codHoldLimit)}</span>`);
    if (pct >= 80) parts.push(`<span class="bad">${pct >= 100 ? 'Đã chạm' : 'Sắp chạm'} hạn mức: hệ thống ${pct >= 100 ? 'không gửi' : 'sẽ ngừng gửi'} đơn thu tiền cho bạn tới khi bạn nộp tiền ở <a href="#cod">Sổ COD</a>.</span>`);
  }
  if (s.missLimit > 0 && s.missStreak > 0) parts.push(`<span class="${s.missStreak + 1 >= s.missLimit ? 'bad' : 'muted'}">Đã nhả ${s.missStreak} đơn liên tiếp. Đủ ${s.missLimit} lần bạn sẽ tự chuyển sang Tạm nghỉ.</span>`);
  el.innerHTML = parts.length ? `<div class="notice extra-card">${parts.join('')}</div>` : '';
}

// Chạy mỗi giây: giờ ca, xe di chuyển trên bản đồ
function tick(st) {
  if (!root) return;
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
    case 'claimed': return `Bạn nhận đơn ${e.order}`;
    case 'arrived': return `Bạn báo đã giao tới đơn ${e.order}, chờ người nhận xác nhận`;
    case 'received': case 'auto_received': return `Đơn ${e.order} hoàn tất${e.detail ? ` (${e.detail})` : ''}`;
    case 'disputed': return `Người nhận báo chưa nhận được đơn ${e.order}${e.detail ? `: ${e.detail}` : ''}`;
    case 'declined': return `Bạn bỏ qua đơn ${e.order}: ${e.detail}`;
    case 'released': return `Bạn nhả đơn ${e.order}: ${e.detail}`;
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
    boardHtml = '';
    render();
    clearInterval(boardTimer);
    boardTimer = setInterval(loadBoard, 5000);
    ctx.onMap('nodeclick', (id) => {
      const card = root.querySelector(`.stop-card[data-node="${id}"]`);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  },
  unmount() { clearInterval(boardTimer); root = null; },
  onState() { if (root) render(); },
  onTick(st) { tick(st); },
};
