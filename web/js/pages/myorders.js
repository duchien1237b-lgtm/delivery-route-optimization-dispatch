// Trang Đơn của tôi (vai trò khách hàng): tạo đơn từ sổ địa chỉ, nhập mã giảm giá, báo giá chi tiết ngay
// (báo giá = hoá đơn: cùng một hàm tính ở server), theo dõi trạng thái, mã nhận hàng 4 số, huỷ đơn (báo trước phí huỷ),
// đánh giá shipper và khiếu nại. Server chỉ trả về đơn của chính tài khoản đang đăng nhập.
// Kiểu Grab: đặt xong hệ thống tự tìm shipper gần nhất (khách chỉ thấy “đang tìm shipper”), có shipper nhận thì hiện thẻ tài xế
// (tên, xe, biển số, điểm, gọi điện) và vị trí xe chạy trên bản đồ; chưa có ai nhận thì bấm “Tìm lại”; huỷ đơn phải chọn lý do.
// Nghiệp vụ mở rộng: khai giá + bảo hiểm, kích thước (cân quy đổi), chọn người trả cước, tự sửa đơn khi chưa xác nhận,
// đặt lại đơn cũ, tự hẹn giao lại / yêu cầu hoàn hàng khi giao thất bại.
import { api } from '../api.js';
import { escapeHtml } from '../store.js';
import {
  $, fmt, money, when, guard, guardForm, toast, hhmm, getShiftStart, timeToMinutes, ROUTE_COLORS, tripPosition,
  pager, bindPager, debounce, normalizePhone, preserveFocus, statusChip, askReason, avatar, pickedUp, liveClock,
} from '../ui.js';
import { openOrder, redeliverDialog, returnDialog } from '../orders.js';

let ctx, root;
let showForm = false, dest = null, selected = null, group = 'all', q = '', sort = 'id:desc', page = 1;
let list = null, addresses = [], quoteSeq = 0, listSeq = 0;
let editing = null, prefill = null;   // đơn đang sửa (chỉ đơn 'Mới') / đơn mẫu khi bấm “Đặt lại”

const GROUPS = [
  { v: 'all', label: 'Tất cả', status: '' },
  { v: 'open', label: 'Đang xử lý', status: '6,0,7,1,3' },
  { v: 'done', label: 'Đã giao', status: '2' },
  { v: 'bad', label: 'Huỷ / hoàn', status: '4,5' },
];
const SORTS = [{ v: 'id:desc', label: 'Mới nhất' }, { v: 'id:asc', label: 'Cũ nhất' }, { v: 'net:desc', label: 'Cước cao nhất' }, { v: 'status:asc', label: 'Theo trạng thái' }];
const OPEN = [6, 0, 7, 1, 3];

const autoMatch = () => !ctx.store.state.config || ctx.store.state.config.autoMatch !== false;
function stepOf(o) {
  if (o.status === 2) return 4;
  if (o.status === 1 || o.status === 3) return 3;
  if (o.status === 0 || o.status === 7) return 2;
  return 1;
}
// Đơn đang được hệ thống tìm shipper: đang mời (7) hoặc vừa đặt / vừa tìm lại. Đơn nạp từ file (createdAt = 0) không tự ghép nên không hiện "đang tìm"
const searching = (o) => autoMatch() && !o.noShipper && (o.status === 7 || (o.status === 0 && (o.createdAt > 0 || o.attempts > 0)));
const tripOf = (o, st) => st.shift.trips.find((t) => t.stops.some((s) => s.order === o.id));
// Đã tới giờ shipper rời kho (lấy hàng xong) chưa? Chưa có thông tin chuyến thì coi như đã lấy
function onTheWay(o, st) {
  const tr = tripOf(o, st);
  return !tr || pickedUp(tr, liveClock(st));
}
function statusText(o) {
  const st = ctx.store.state;
  switch (o.status) {
    case 6: return 'Chờ quản trị viên xác nhận';
    case 0: case 7:
      if (o.noShipper) return 'Chưa có shipper nhận đơn';
      if (!searching(o)) return o.status === 0 && !o.attempts ? 'Đã xác nhận, chờ phân công shipper' : 'Đang chờ phân công shipper';
      return o.attempts ? `Đang tìm shipper giao lại (lần ${o.attempts + 1})` : 'Đang tìm shipper gần nhất…';
    case 1: return onTheWay(o, st) ? `Shipper ${o.carrier || ''} đang giao, dự kiến ${fmt.clock(o.eta)}` : `Shipper ${o.carrier || ''} đang tới kho lấy hàng`;
    case 2: return `Đã giao lúc ${fmt.clock(o.deliveredAt)}${o.late ? ' (trễ hạn)' : ''}`;
    case 3: return 'Giao chưa thành công, đang chờ xử lý';
    case 4: return o.cancelFee ? `Đã huỷ, phí huỷ ${money(o.cancelFee)}` : 'Đã huỷ';
    case 5: return 'Hoàn hàng về kho';
    default: return o.statusName;
  }
}
// Thẻ tài xế (kiểu Grab) sau khi shipper nhận đơn
function carrierCard(o) {
  const c = o.carrierInfo;
  if (!c || (o.status !== 1 && o.status !== 2)) return '';
  return `<div class="carrier-card"><span class="ava-wrap">${avatar(c.name, '#1a6fe0', c.vehicleName)}</span>
    <div><b>${escapeHtml(c.name)}</b><small>${escapeHtml(c.vehicleName)}${c.plate ? ` · <span class="plate">${escapeHtml(c.plate)}</span>` : ''}${c.rating ? ` · ★ ${fmt.num(c.rating)} (${c.ratings})` : ' · shipper mới'}</small></div>
    ${c.phone && o.status === 1 ? `<a class="btn small" href="tel:${escapeHtml(c.phone)}">Gọi</a>` : ''}</div>`;
}
const CANCEL_PRESETS = ['Đặt nhầm / sai địa chỉ', 'Chờ shipper quá lâu', 'Không còn nhu cầu gửi', 'Muốn đặt lại với thông tin khác'];
async function cancelDialog(o) {
  const fee = o.cancelFeeNow || 0;
  const note = fee ? `Shipper đã nhận đơn nên sẽ tính <b>phí huỷ ${money(fee)}</b>.` : 'Chưa có shipper nhận nên <b>không mất phí</b>. Mã giảm giá (nếu có) được hoàn lại.';
  const why = await askReason(`Huỷ đơn ${o.id}?`, { label: 'Lý do huỷ', presets: CANCEL_PRESETS, ok: 'Huỷ đơn', note });
  if (why) guard(async () => { const res = await ctx.store.mutate('order/cancel', { id: o.id, reason: why }); toast(res.message); });
}

async function loadList() {
  const s = ++listSeq;
  const g = GROUPS.find((x) => x.v === group);
  const [key, dir] = sort.split(':');
  const res = await api.get('orders/list', { q, status: g.status, sort: key, dir, page, size: 8 });
  if (s !== listSeq || !root) return;
  list = res;
  page = res.page.page;
  if (!showForm) render();
  else renderList();
}
const reloadList = debounce(() => guard(loadList), 250);

function tierHtml(me) {
  const t = me.tier;
  if (!t) return '';
  return `<div class="tier-card"><div><span>Hạng thành viên</span><b>${escapeHtml(t.name)}</b><small>giảm ${Math.round(t.pct * 100)}% cước vận chuyển · ${t.done} đơn đã giao</small></div>
    ${t.next ? `<div class="tier-next"><small>Còn ${t.next.remaining} đơn nữa lên <b>${escapeHtml(t.next.name)}</b> (giảm ${Math.round(t.next.pct * 100)}%)</small><div class="progress"><i style="width:${Math.min(100, Math.round((t.done / (t.done + t.next.remaining)) * 100))}%"></i></div></div>` : '<div class="tier-next"><small>Bạn đang ở hạng cao nhất. Cảm ơn bạn!</small></div>'}</div>`;
}

function formHtml(st) {
  const pre = editing || prefill;
  const def = addresses.find((a) => a.isDefault) || addresses[0];
  const useBook = addresses.length > 0 && !pre;
  const val = (k, d = '') => escapeHtml(pre && pre[k] != null ? String(pre[k]) : d);
  const dims = pre && pre.dims ? pre.dims.split('x') : ['', '', ''];
  const dl = editing && editing.deadline >= 0 ? hhmm(getShiftStart() + editing.deadline) : '';   // đặt lại thì không chép hạn giao cũ
  if (pre) dest = pre.destination;
  const maxKg = Math.max(0, ...((ctx.store.state && ctx.store.state.shippers) || []).map((sh) => Number(sh.capacity) || 0));   // xe lớn nhất của đội
  return `<form id="m-form" class="block inset" novalidate>
    <h2>${editing ? `Sửa đơn ${editing.id}` : prefill ? `Đặt lại theo đơn ${prefill.id}` : 'Tạo đơn mới'}</h2>
    ${editing ? '<p class="muted small" style="margin:-4px 0 10px">Đơn chưa có shipper nhận nên bạn tự sửa được. Cước tính lại theo thông tin mới; hệ thống sẽ tìm shipper lại từ đầu.</p>' : ''}
    ${useBook ? `<label class="field"><span>Giao tới</span><select name="address">${addresses.map((a) => `<option value="${a.id}" ${def && a.id === def.id ? 'selected' : ''}>${escapeHtml(a.label)} · ${escapeHtml(a.recipient)} · ${escapeHtml(a.nodeName)}</option>`).join('')}<option value="0">Địa chỉ khác…</option></select></label>` : '<p class="muted small" style="margin:-4px 0 10px">Mẹo: thêm địa chỉ hay giao trong <a href="#profile">Hồ sơ</a> để đặt đơn nhanh hơn.</p>'}
    <div id="m-manual" ${useBook ? 'hidden' : ''}>
      <label class="field"><span>Điểm giao (hoặc bấm trên bản đồ)</span><select name="destination">${ctx.store.nodeOptions(dest, { includeEmpty: true, emptyLabel: 'Chọn điểm giao' })}</select></label>
      <div class="row">
        <label class="field"><span>Người nhận</span><input name="recipient" maxlength="60" placeholder="Chị Lan" autocomplete="off" value="${val('recipient')}"></label>
        <label class="field"><span>Số điện thoại</span><input name="phone" type="tel" inputmode="numeric" maxlength="13" placeholder="0909123456" autocomplete="off" value="${val('phone')}"></label>
      </div>
    </div>
    <div class="row">
      <label class="field"><span>Khối lượng (kg)${maxKg ? ` <small class="muted">tối đa ${maxKg}</small>` : ''}</span><input name="weight" type="number" step="0.1" min="0.1"${maxKg ? ` max="${maxKg}"` : ''} value="${val('weight', '1')}" inputmode="decimal" required></label>
      <label class="field"><span>Giao trước (không bắt buộc)</span><input name="deadline" type="time" value="${dl}"></label>
    </div>
    <fieldset class="dims-row"><legend>Kích thước kiện, cm <small class="muted">(không bắt buộc; hàng cồng kềnh tính theo cân quy đổi)</small></legend>
      <input name="length" type="number" min="1" max="300" step="1" inputmode="numeric" placeholder="Dài" aria-label="Dài (cm)" value="${escapeHtml(dims[0] || '')}">
      <span>×</span><input name="width" type="number" min="1" max="300" step="1" inputmode="numeric" placeholder="Rộng" aria-label="Rộng (cm)" value="${escapeHtml(dims[1] || '')}">
      <span>×</span><input name="height" type="number" min="1" max="300" step="1" inputmode="numeric" placeholder="Cao" aria-label="Cao (cm)" value="${escapeHtml(dims[2] || '')}">
    </fieldset>
    <div class="row">
      <label class="field"><span>Thu hộ COD (đ)</span><input name="cod" type="number" min="0" max="50000000" step="1000" value="${val('cod', '0')}" inputmode="numeric"></label>
      <label class="field"><span>Giá trị hàng khai báo (đ)</span><input name="value" type="number" min="0" max="100000000" step="1000" value="${val('value', '0')}" inputmode="numeric" title="Dùng để tính bảo hiểm và mức bồi thường khi hư hỏng / thất lạc"></label>
    </div>
    <div class="row">
      <label class="field"><span>Ai trả cước</span><select name="payer"><option value="sender">Tôi (người gửi) trả</option><option value="receiver" ${pre && pre.receiverPays ? 'selected' : ''}>Người nhận trả khi nhận hàng</option></select></label>
      <label class="field"><span>Mã giảm giá</span><input name="promo" maxlength="20" autocapitalize="characters" placeholder="vd: GIAM10" autocomplete="off" ${editing ? `disabled value="${val('promo')}" title="Mã đã áp dụng được giữ nguyên khi sửa đơn"` : ''}></label>
    </div>
    <label class="field"><span>Ghi chú cho shipper</span><input name="note" maxlength="80" placeholder="Gọi trước khi giao" value="${val('note')}"></label>
    <label class="check" style="margin-bottom:12px"><input type="checkbox" name="urgent" ${pre && pre.urgent ? 'checked' : ''}> Giao hoả tốc (+${Math.round(st.config ? st.config.tariff.urgent * 100 : 30)}% cước)</label>
    <div class="quote-box" id="m-quote" aria-live="polite"><p class="muted">Chọn điểm giao để xem cước.</p></div>
    <div class="actions"><button class="btn primary">${editing ? 'Lưu thay đổi' : 'Đặt đơn'}</button><button type="button" class="btn ghost" id="m-cancel">Đóng</button></div>
  </form>`;
}

function cardHtml(o) {
  const step = stepOf(o);
  const bad = o.status === 4 || o.status === 5;
  const active = o.status === 7 || o.status === 1;
  const finding = searching(o);
  return `<article class="order-card ${o.id === selected ? 'sel' : ''}" data-id="${o.id}" data-node="${o.destination}">
    <header><b>Đơn ${o.id} · ${escapeHtml(o.recipient || o.destinationName)}</b>${statusChip(o)}</header>
    <p>${escapeHtml(o.destinationName)} · ${fmt.num(o.weight)} kg${o.urgent ? ' · hoả tốc' : ''} · cước <b>${money(o.total)}</b>${o.insurance ? ' <small class="muted">(gồm bảo hiểm)</small>' : ''}${o.receiverPays ? ' <small class="chip">người nhận trả</small>' : ''}${o.promo ? ` <small class="chip ok">${escapeHtml(o.promo)}</small>` : ''}${o.cod ? ` · thu hộ ${money(o.cod)}` : ''}${o.returnFee ? ` · phí hoàn ${money(o.returnFee)}` : ''}</p>
    <p><b data-status-text="${o.id}">${escapeHtml(statusText(o))}</b>${o.failReasonName && o.status !== 2 ? ` · <span class="bad">${escapeHtml(o.failReasonName)}</span>` : ''}</p>
    ${finding ? '<div class="finding"><span class="radar" aria-hidden="true"><i></i><i></i><i></i></span><div><b>Đang tìm shipper gần bạn nhất</b><small>Hệ thống gửi đơn cho shipper gần kho nhất. Họ không nhận thì chuyển người kế tiếp.</small></div></div>' : ''}
    ${o.status === 0 && o.noShipper ? '<div class="finding none"><div><b>Chưa có shipper nhận đơn</b><small>Tất cả shipper phù hợp đang bận hoặc đã bỏ qua. Bạn có thể tìm lại hoặc huỷ đơn (không mất phí).</small></div></div>' : ''}
    ${carrierCard(o)}
    ${active && o.code ? `<div class="code-inline">Mã nhận hàng <b>${escapeHtml(o.code)}</b> <small>đọc cho shipper khi nhận hàng</small></div>` : ''}
    <div class="timeline">${[1, 2, 3, 4].map((k) => `<i class="${bad ? (k === 1 ? 'on' : 'bad') : k <= step ? 'on' : ''}"></i>`).join('')}</div>
    <div class="timeline-labels"><span>Đặt đơn</span><span>${autoMatch() ? 'Tìm shipper' : 'Xác nhận'}</span><span>Đang giao</span><span>${bad ? escapeHtml(o.statusName) : 'Đã giao'}</span></div>
    <div class="actions card-acts">
      <button class="btn small ghost" data-open="${o.id}">Chi tiết &amp; hoá đơn</button>
      ${o.status === 0 && o.noShipper ? `<button class="btn small primary" data-retry="${o.id}">Tìm lại shipper</button>` : ''}
      ${o.cancelFeeNow !== undefined ? `<button class="btn small ghost danger" data-cancel="${o.id}">Huỷ${o.cancelFeeNow ? ` (phí ${money(o.cancelFeeNow)})` : ''}</button>` : ''}
      ${o.status === 6 || (o.status === 0 && autoMatch()) ? `<button class="btn small ghost" data-edit="${o.id}">Sửa đơn</button>` : ''}
      ${o.status === 3 ? `<button class="btn small" data-redeliver="${o.id}">Hẹn giao lại</button><button class="btn small ghost" data-return="${o.id}">Hoàn hàng</button>` : ''}
      ${o.status === 2 && !o.rated ? `<button class="btn small" data-open="${o.id}">Đánh giá ★</button>` : ''}
      ${o.status === 2 || o.status === 4 || o.status === 5 ? `<button class="btn small ghost" data-again="${o.id}">Đặt lại</button>` : ''}
    </div>
  </article>`;
}

function listHtml() {
  if (!list) return '<p class="empty">Đang tải…</p>';
  const total = Object.values(list.byStatus).reduce((a, b) => a + b, 0);
  const cnt = (g) => (!g.status ? total : g.status.split(',').reduce((a, k) => a + (list.byStatus[k] || 0), 0));
  return `<div class="list-tools">
      <label class="search-box"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20 20"/></svg><input type="search" id="m-search" placeholder="Tìm mã đơn, người nhận, điểm giao" value="${escapeHtml(q)}" aria-label="Tìm đơn"></label>
      <label class="sort-box"><span class="sr-only">Sắp xếp</span><select id="m-sort">${SORTS.map((s) => `<option value="${s.v}" ${s.v === sort ? 'selected' : ''}>${s.label}</option>`).join('')}</select></label>
    </div>
    <div class="chips filter-chips" role="tablist">${GROUPS.map((g) => `<button type="button" role="tab" class="chip ${g.v === group ? 'on' : ''}" aria-selected="${g.v === group}" data-group="${g.v}">${g.label} <em>${cnt(g)}</em></button>`).join('')}</div>
    <div id="m-list">${list.orders.length ? list.orders.map(cardHtml).join('') : `<p class="empty">${total ? 'Không có đơn nào khớp.' : 'Bạn chưa có đơn nào. Bấm “Tạo đơn” để gửi hàng.'}</p>`}</div>
    ${pager(list.page)}`;
}

function render() { preserveFocus(root, draw); }
function draw() {
  const st = ctx.store.state;
  const mine = st.orders;
  const codBack = mine.filter((o) => o.status === 2).reduce((s, o) => s + (o.cod || 0), 0);
  root.innerHTML = `<div class="page-head"><h1>Đơn của tôi</h1>${showForm ? '' : '<button class="btn small primary" id="m-new">Tạo đơn</button>'}</div>
    <p class="hello">Xin chào <b>${escapeHtml(st.me.displayName)}</b>.</p>
    ${tierHtml(st.me)}
    <div class="tiles" style="margin-bottom:14px">
      <div class="tile"><b>${mine.filter((o) => [6, 0, 7, 3].includes(o.status)).length}</b><span>${autoMatch() ? 'đang tìm shipper / chờ xử lý' : 'chờ xử lý'}</span></div>
      <div class="tile"><b>${mine.filter((o) => o.status === 1).length}</b><span>đang giao</span></div>
      <div class="tile"><b>${mine.filter((o) => o.status === 2).length}</b><span>đã giao</span></div>
      <div class="tile"><b>${money(codBack)}</b><span>thu hộ đã thu cho bạn</span></div>
    </div>
    ${showForm ? formHtml(st) : ''}
    <div id="m-listwrap">${listHtml()}</div>`;
  $('#m-new', root)?.addEventListener('click', () => openForm(null, null));
  bindList();
  if (showForm) bindForm();
  drawMap(st);
}
async function openForm(edit, again) {
  await guard(async () => { addresses = (await api.get('addresses')).addresses; });
  editing = edit; prefill = again;
  showForm = true;
  render();
  root.querySelector('#m-form')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  ctx.map.setHint('Bấm một điểm trên bản đồ để chọn nơi giao');
}
const findListed = (id) => (list ? list.orders.find((o) => o.id === id) : null) || ctx.store.state.orders.find((o) => o.id === id);

function renderList() {
  const w = $('#m-listwrap', root);
  if (!w) return;
  preserveFocus(w, () => { w.innerHTML = listHtml(); bindList(); });
}

function bindList() {
  const s = $('#m-search', root);
  if (!s) return;
  s.addEventListener('input', () => { q = s.value.trim(); page = 1; reloadList(); });
  $('#m-sort', root).addEventListener('change', (e) => { sort = e.target.value; page = 1; guard(loadList); });
  for (const b of root.querySelectorAll('#m-listwrap [data-group]')) b.addEventListener('click', () => { group = b.dataset.group; page = 1; guard(loadList); });
  bindPager($('#m-listwrap', root), (p) => { page = p; guard(loadList); });
  for (const c of root.querySelectorAll('.order-card')) {
    c.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      selected = Number(c.dataset.id);
      ctx.map.focusNode(Number(c.dataset.node));
      for (const x of root.querySelectorAll('.order-card')) x.classList.toggle('sel', x === c);
      drawMap(ctx.store.state);
    });
  }
  for (const b of root.querySelectorAll('[data-open]')) b.addEventListener('click', () => openOrder(Number(b.dataset.open), { go: ctx.go }));
  for (const b of root.querySelectorAll('[data-edit]')) b.addEventListener('click', () => { const o = findListed(Number(b.dataset.edit)); if (o) openForm(o, null); });
  for (const b of root.querySelectorAll('[data-again]')) b.addEventListener('click', () => { const o = findListed(Number(b.dataset.again)); if (o) openForm(null, o); });
  for (const b of root.querySelectorAll('[data-redeliver]')) b.addEventListener('click', () => { const o = findListed(Number(b.dataset.redeliver)); if (o) redeliverDialog(o, ctx.store); });
  for (const b of root.querySelectorAll('[data-return]')) b.addEventListener('click', () => { const o = findListed(Number(b.dataset.return)); if (o) returnDialog(o, ctx.store); });
  for (const b of root.querySelectorAll('[data-cancel]')) b.addEventListener('click', () => { const o = findListed(Number(b.dataset.cancel)); if (o) cancelDialog(o); });
  for (const b of root.querySelectorAll('[data-retry]')) b.addEventListener('click', () => guard(async () => {
    try { const res = await ctx.store.mutate('order/retry', { id: b.dataset.retry }); toast(res.message); }
    catch (e) { if (e.status !== 409) throw e; await ctx.store.refresh(); toast('Đơn của bạn đã được hệ thống gửi cho shipper'); }   // đơn vừa được ghép trong lúc trang chưa kịp cập nhật
  }, b));
}

function drawMap(st) {
  const map = ctx.map;
  const mine = st.orders;
  const styles = new Map(), paths = [], markers = [];
  for (const o of mine) {
    if (o.status === 4) continue;
    const badge = o.status === 2 ? '✓' : o.status === 5 ? '↩' : String(o.id).slice(-2);
    const color = o.status === 2 ? 'var(--go)' : o.status === 5 ? 'var(--jam)' : o.status === 1 ? 'var(--road)' : 'var(--signal)';
    styles.set(o.destination, { badge, badgeColor: color, keep: true, tip: `Đơn ${o.id}: ${statusText(o)}` });
  }
  if (dest != null && showForm) styles.set(Number(dest), { badge: '+', badgeColor: 'var(--brand)', keep: true, tip: 'Điểm giao đơn mới' });
  const focus = mine.find((o) => o.id === selected) || mine.find((o) => o.status === 1) || mine.find((o) => o.status === 0 || o.status === 7);
  if (focus && focus.status === 1) {
    const tr = tripOf(focus, st);
    if (tr) {
      const color = ROUTE_COLORS[Math.max(0, tr.shipper) % ROUTE_COLORS.length];
      if (tr.approach && tr.approach.length > 1) paths.push({ nodes: tr.approach, color, width: 4, opacity: 0.6, dash: '6 6', animate: false, arrows: true });
      paths.push({ nodes: tr.path, color, width: 5, opacity: 0.5, animate: false, arrows: true });
      const pos = tripPosition(tr, liveClock(st), ctx.store.nodesById);
      if (pos) markers.push({ lat: pos.lat, lon: pos.lon, color, label: (tr.name.trim().split(/\s+/).pop() || '?')[0].toUpperCase(), title: `Shipper ${tr.name}` });
    }
  } else if (focus && (focus.status === 0 || focus.status === 7) && !focus.noShipper) {
    const dep = ctx.store.nodesById.get(st.depot);
    if (dep) markers.push({ lat: dep.x, lon: dep.y, color: 'var(--signal)', label: '…', title: 'Đang tìm shipper cho đơn ' + focus.id });
  }
  map.setPaths(paths, { animate: false });
  map.setNodeStyles(styles);
  map.setMarkers(markers);
  map.setDim(paths.length > 0);
  map.setLegend([{ type: 'badge', color: 'var(--signal)', label: 'Đang tìm shipper / chờ xử lý' }, { type: 'badge', color: 'var(--road)', label: 'Đang giao' }, { type: 'badge', color: 'var(--go)', label: '✓ Đã giao' }].concat(paths.length ? [{ type: 'dash', color: 'var(--road)', label: 'Shipper đang tới kho' }] : []));
}

function quoteBox(res) {
  const fe = res.fee;
  if (!fe) return '<p class="field-err">Kho chưa có đường tới điểm này.</p>';
  const payer = res.collect > (res.cod || 0);
  return `<div class="qb-total"><span>${payer ? 'Người nhận trả khi nhận hàng' : 'Cước phải trả'}</span><b>${money(res.total)}</b></div>
    <dl class="qb-lines"><dt>Quãng đường</dt><dd>${fmt.km(fe.km)}</dd><dt>Cước mở đầu</dt><dd>${money(fe.base)}</dd><dt>Theo km</dt><dd>${money(fe.distance)}</dd>
    ${fe.weight ? `<dt>Phụ phí khối lượng</dt><dd>${money(fe.weight)}</dd>` : ''}${fe.urgent ? `<dt>Hoả tốc</dt><dd>${money(fe.urgent)}</dd>` : ''}${fe.cod ? `<dt>Phí thu hộ</dt><dd>${money(fe.cod)}</dd>` : ''}
    <dt>Tổng cước</dt><dd>${money(res.gross)}</dd>
    ${res.loyaltyDiscount ? `<dt>Hạng ${escapeHtml(res.tier)} (−${Math.round(res.tierPct * 100)}%)</dt><dd class="neg">−${money(res.loyaltyDiscount)}</dd>` : ''}
    ${res.promoDiscount ? `<dt>Mã ${escapeHtml(res.promo)}</dt><dd class="neg">−${money(res.promoDiscount)}</dd>` : ''}
    ${res.insurance ? `<dt>Cước sau giảm</dt><dd>${money(res.net)}</dd><dt>Bảo hiểm hàng hoá</dt><dd>${money(res.insurance)}</dd>` : ''}
    ${res.volWeight > 0 ? `<dt>Cân tính cước</dt><dd>${fmt.num(res.chargedWeight)} kg <small class="muted">(quy đổi ${fmt.num(res.volWeight)} kg)</small></dd>` : ''}
    ${res.collect ? `<dt>Shipper thu của người nhận</dt><dd>${money(res.collect)}</dd>` : ''}</dl>
    ${res.promoError ? `<p class="field-err" role="alert">${escapeHtml(res.promoError)}</p>` : ''}`;
}

function bindForm() {
  const f = $('#m-form', root);
  const out = $('#m-quote', root);
  const manual = $('#m-manual', root);
  const destOf = () => {
    if (f.address && f.address.value !== '0') { const a = addresses.find((x) => String(x.id) === f.address.value); return a ? a.node : ''; }
    return f.destination.value;
  };
  const billingParams = () => ({ value: f.value.value || 0, length: f.length.value, width: f.width.value, height: f.height.value, payer: f.payer.value });
  const quote = async () => {
    const d = destOf();
    if (d === '' || !(Number(f.weight.value) > 0)) { out.innerHTML = '<p class="muted">Chọn điểm giao để xem cước.</p>'; return; }
    const seq = ++quoteSeq;
    try {
      const res = await api.get('quote', { destination: d, weight: f.weight.value, urgent: f.urgent.checked ? 1 : 0, cod: f.cod.value || 0, promo: f.promo.value.trim(), ...billingParams() });
      res.cod = Number(f.cod.value) || 0;
      if (seq === quoteSeq) out.innerHTML = quoteBox(res);
    } catch (e) { if (seq === quoteSeq) out.innerHTML = `<p class="field-err">${escapeHtml(e.message)}</p>`; }
  };
  const debQuote = debounce(quote, 200);
  if (f.address) f.address.addEventListener('change', () => { manual.hidden = f.address.value !== '0'; dest = Number(destOf()) || null; drawMap(ctx.store.state); quote(); });
  for (const el of [f.destination, f.urgent, f.payer]) el.addEventListener('change', quote);
  for (const el of [f.weight, f.cod, f.promo, f.value, f.length, f.width, f.height]) el.addEventListener('input', debQuote);
  f.destination.addEventListener('change', () => { dest = f.destination.value === '' ? null : Number(f.destination.value); drawMap(ctx.store.state); });
  dest = Number(destOf()) || null;
  quote();
  $('#m-cancel', root).addEventListener('click', () => { showForm = false; dest = null; editing = prefill = null; ctx.map.setHint(null); render(); });
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    let deadline = '';
    if (f.deadline.value) {
      deadline = timeToMinutes(f.deadline.value) - getShiftStart();
      if (deadline < 0) { toast(`Giờ giao phải sau giờ bắt đầu ca (${hhmm(getShiftStart())})`, 'error'); return; }
    }
    const params = { weight: f.weight.value, urgent: f.urgent.checked ? 1 : 0, deadline, cod: f.cod.value || 0, note: f.note.value.trim(), ...billingParams() };
    if (!editing) params.promo = f.promo.value.trim();
    if (f.address && f.address.value !== '0') params.address = f.address.value;
    else Object.assign(params, { destination: f.destination.value, recipient: f.recipient.value.trim(), phone: normalizePhone(f.phone.value) });
    const wasEdit = editing;
    if (wasEdit) params.id = wasEdit.id;
    guardForm(f, async () => {
      const res = await ctx.store.mutate(wasEdit ? 'order/edit' : 'order/add', params);
      showForm = false; dest = null; editing = prefill = null;
      if (!wasEdit) { group = 'all'; page = 1; sort = 'id:desc'; q = ''; }
      ctx.map.setHint(null);
      selected = wasEdit ? wasEdit.id : res.created;
      toast(res.message || 'Đã tạo đơn');
      await loadList();
      const pn = document.getElementById('panel'); if (pn) pn.scrollTop = 0;   // đơn vừa tạo nằm đầu danh sách
    }, f.querySelector('button.primary'));
  });
}

export default {
  id: 'myorders',
  title: 'Đơn của tôi',
  mount(panel, c) {
    ctx = c;
    root = document.createElement('div');
    panel.append(root);
    list = null;
    render();
    guard(loadList);
    ctx.onMap('nodeclick', (id) => {
      if (showForm) {
        const f = $('#m-form', root);
        if (f.address) { f.address.value = '0'; f.address.dispatchEvent(new Event('change')); }
        f.destination.value = String(id);
        f.destination.dispatchEvent(new Event('change'));
        return;
      }
      const o = ctx.store.state.orders.find((x) => x.destination === id && OPEN.includes(x.status)) || ctx.store.state.orders.find((x) => x.destination === id);
      if (o) { selected = o.id; openOrder(o.id, { go: ctx.go }); }
    });
  },
  unmount() { root = null; showForm = false; editing = prefill = null; ctx.map.setHint(null); },
  onState() { if (root && !showForm) { drawMap(ctx.store.state); reloadList(); } },
  // Mỗi giây: xe của shipper chạy trên bản đồ và dòng trạng thái “đang tới kho / đang giao” cập nhật theo giờ ca đang chạy
  onTick(st) {
    if (!root || showForm) return;
    for (const o of st.orders) {
      if (o.status !== 1) continue;
      const el = root.querySelector(`[data-status-text="${o.id}"]`);
      if (el) el.textContent = statusText(o);
    }
    if (st.orders.some((o) => o.status === 1)) drawMap(st);
  },
};
