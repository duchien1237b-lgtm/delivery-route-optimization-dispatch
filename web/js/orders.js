// Chi tiết một đơn (dùng chung cho khách hàng, shipper, quản trị viên):
// diễn biến, hoá đơn (báo giá = hoá đơn), mã nhận hàng, đánh giá, và các thao tác hợp lệ theo vai trò + trạng thái.
// Server vẫn kiểm tra lại mọi thao tác (máy trạng thái trả 409 nếu không hợp lệ, 403 nếu không phải đơn của bạn).
import { api } from './api.js';
import { store, escapeHtml } from './store.js';
import {
  $, fmt, money, when, guard, guardForm, toast, showModal, statusChip, askReason, confirmBox, pickFailReason, EVENT_LABEL,
} from './ui.js';

const role = () => (store.state && store.state.me ? store.state.me.role : '');
const isStaff = () => role() === 'admin';

export function eventLine(e) {
  const label = EVENT_LABEL[e.type] || e.type;
  const time = e.at ? when.full(e.at) : e.t != null ? `${fmt.clock(e.t)} · giờ ca` : '';
  const extra = [e.who, e.detail].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(' · ');
  return `<li><span class="t">${escapeHtml(time)}</span><i class="dot ${e.type === 'delivered' ? 'ok' : e.type === 'failed' || e.type === 'rejected' || e.type === 'cancelled' ? 'late' : e.type === 'returned' ? 'warn' : ''}"></i><span><b>${escapeHtml(label)}</b>${extra ? ` <small class="muted">${escapeHtml(extra)}</small>` : ''}</span></li>`;
}

export function invoiceHtml(inv) {
  return `<table class="data invoice"><tbody>
    ${inv.lines.map((l) => `<tr><td>${escapeHtml(l.label)}</td><td class="num">${money(l.amount)}</td></tr>`).join('')}
    <tr class="total"><td>Tổng cước</td><td class="num">${money(inv.gross)}</td></tr>
    ${inv.loyaltyDiscount ? `<tr><td>Giảm theo hạng thành viên</td><td class="num neg">−${money(inv.loyaltyDiscount)}</td></tr>` : ''}
    ${inv.promoDiscount ? `<tr><td>Mã giảm giá <b>${escapeHtml(inv.promo)}</b></td><td class="num neg">−${money(inv.promoDiscount)}</td></tr>` : ''}
    <tr class="${inv.insurance ? '' : 'total'}"><td>${inv.insurance ? 'Cước sau giảm' : '<b>Cước phải trả</b>'}</td><td class="num">${inv.insurance ? money(inv.net) : `<b>${money(inv.net)}</b>`}</td></tr>
    ${inv.insurance ? `<tr><td>Bảo hiểm hàng hoá (khai giá ${money(inv.value)})</td><td class="num">${money(inv.insurance)}</td></tr>
    <tr class="total"><td><b>Cước phải trả</b></td><td class="num"><b>${money(inv.total)}</b></td></tr>` : ''}
    ${inv.chargedWeight > inv.weight ? `<tr><td colspan="2" class="muted small">Tính cước theo cân quy đổi ${fmt.num(inv.chargedWeight)} kg (kiện ${escapeHtml(inv.dims)} cm, nặng thực ${fmt.num(inv.weight)} kg)</td></tr>` : ''}
    ${inv.payer === 'receiver' ? '<tr><td colspan="2" class="muted small">Người nhận trả cước khi nhận hàng</td></tr>' : ''}
    ${inv.cancelFee ? `<tr><td>Phí huỷ đơn (thay cho cước)</td><td class="num">${money(inv.cancelFee)}</td></tr>` : ''}
    ${inv.returnFee ? `<tr><td>Phí hoàn hàng về kho (thay cho cước)</td><td class="num">${money(inv.returnFee)}</td></tr>` : ''}
    ${inv.cod ? `<tr><td>Tiền thu hộ (shipper thu của người nhận, hoàn lại cho bạn)</td><td class="num">${money(inv.cod)}</td></tr>` : ''}
    ${inv.collect > inv.cod ? `<tr><td>Shipper thu của người nhận (thu hộ + cước)</td><td class="num">${money(inv.collect)}</td></tr>` : ''}
  </tbody></table>`;
}

export function printInvoice(inv) {
  const area = $('#print-area');
  area.innerHTML = `<div class="sheet"><h1>Hoá đơn dịch vụ giao hàng</h1><div>Giao Nhanh 08 · Đơn #${inv.order}</div>
    <div class="meta"><span>Người nhận: ${escapeHtml(inv.recipient)}</span><span>Điểm giao: ${escapeHtml(inv.destination)}</span>
    <span>Quãng đường: ${fmt.km(inv.km)}</span><span>Ngày đặt: ${when.full(inv.createdAt)}</span><span>Trạng thái: ${escapeHtml(inv.status)}</span></div>
    <table><tbody>${inv.lines.map((l) => `<tr><td>${escapeHtml(l.label)}</td><td>${money(l.amount)}</td></tr>`).join('')}
    <tr><th>Tổng cước</th><th>${money(inv.gross)}</th></tr>
    ${inv.loyaltyDiscount ? `<tr><td>Giảm theo hạng</td><td>−${money(inv.loyaltyDiscount)}</td></tr>` : ''}
    ${inv.promoDiscount ? `<tr><td>Mã ${escapeHtml(inv.promo)}</td><td>−${money(inv.promoDiscount)}</td></tr>` : ''}
    ${inv.insurance ? `<tr><td>Bảo hiểm (khai giá ${money(inv.value)})</td><td>${money(inv.insurance)}</td></tr>` : ''}
    ${inv.cancelFee ? `<tr><td>Phí huỷ</td><td>${money(inv.cancelFee)}</td></tr>` : ''}
    ${inv.returnFee ? `<tr><td>Phí hoàn hàng</td><td>${money(inv.returnFee)}</td></tr>` : ''}
    ${inv.payer === 'receiver' ? '<tr><td colspan="2">Người nhận trả cước</td></tr>' : ''}
    <tr><th>Phải trả</th><th>${money(inv.payable)}</th></tr></tbody></table>
    <div class="foot"><span>In lúc ${when.full(Date.now() / 1000)}</span></div></div>`;
  window.print();
}

// Số tiền shipper phải thu của người nhận: thu hộ + cước nếu người nhận trả (bản cũ của server chỉ có cod)
const collectOf = (o) => (o.collect != null ? o.collect : o.cod || 0);

// Ước tính phí hoàn (cùng công thức server: tỉ lệ hoàn x cước vận chuyển không gồm phí thu hộ, làm tròn lên 500 đ)
export function returnFeeEstimate(o) {
  const t = store.state && store.state.config ? store.state.config.tariff : null;
  if (!t || !o.fee) return null;
  return Math.ceil(((o.fee.total - (o.fee.cod || 0)) * t.returnRate) / 500 - 1e-9) * 500;
}

// Khách tự hẹn giao lại đơn giao thất bại: có thể cập nhật SĐT người nhận và lời nhắn cho shipper
export function redeliverDialog(o, st = store) {
  return new Promise((resolve) => {
    const dlg = $('#modal');
    let done = false;
    showModal(`Hẹn giao lại đơn ${o.id}`, `<form id="rd-form" novalidate>
      <p class="muted" style="margin:-4px 0 12px">Lần trước: <b>${escapeHtml(o.failReasonName || 'giao không thành công')}</b>. Đơn sẽ về hàng chờ để hệ thống tìm shipper cho lần giao mới (tối đa ${(store.state && store.state.shift && store.state.shift.maxAttempts) || 2} lần giao).</p>
      <label class="field"><span>Số điện thoại người nhận</span><input name="phone" type="tel" inputmode="numeric" maxlength="13" value="${escapeHtml(o.phone || '')}"></label>
      <label class="field"><span>Lời nhắn cho shipper</span><input name="note" maxlength="200" value="${escapeHtml(o.note || '')}" placeholder="vd: giao sau 17h, gọi trước 15 phút"></label>
      <div class="actions"><button class="btn primary">Gửi yêu cầu giao lại</button></div></form>`);
    const f = $('#rd-form');
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      guardForm(f, async () => {
        const res = await st.mutate('order/redeliver', { id: o.id, phone: f.phone.value.replace(/\D/g, ''), note: f.note.value.trim() });
        done = true;
        dlg.close();
        toast(res.message);
        resolve(true);
      }, f.querySelector('button'));
    });
    dlg.addEventListener('close', () => { if (!done) resolve(false); }, { once: true });
  });
}

// Khách yêu cầu hoàn hàng về kho (thay vì giao lại): báo trước phí hoàn
export async function returnDialog(o, st = store) {
  const fee = returnFeeEstimate(o);
  const ok = await confirmBox(`Hoàn đơn ${o.id} về kho?`, `Đơn sẽ không giao nữa. Bạn trả <b>phí hoàn hàng${fee != null ? ` khoảng ${money(fee)}` : ''}</b> thay cho cước; bảo hiểm (nếu có) không tính.${o.cod ? ' Tiền thu hộ không phát sinh.' : ''}`, { ok: 'Hoàn hàng', danger: true });
  if (!ok) return false;
  return guard(async () => { const res = await st.mutate('order/return', { id: o.id }); toast(res.message); return true; });
}

// Shipper (hoặc nhân viên giao thay) xác nhận đã giao: mã 4 số người nhận đọc + số tiền thu hộ
export function deliverDialog(o, { staff = false } = {}) {
  return new Promise((resolve) => {
    const dlg = $('#modal');
    let done = false;
    showModal(`Xác nhận giao đơn ${o.id}`, `<form id="dv-form" class="dv-form" novalidate>
      <p class="muted" style="margin:-4px 0 12px">${escapeHtml([o.recipient, o.destinationName, o.phone].filter(Boolean).join(' · '))}</p>
      ${staff ? '<label class="check"><input type="checkbox" name="force"> Giao thay (người nhận không đọc được mã) — bắt buộc ghi lý do</label>' : ''}
      <label class="field"><span>Mã nhận hàng (người nhận đọc cho bạn)</span><input name="code" class="otp" inputmode="numeric" autocomplete="off" maxlength="4" pattern="[0-9]{4}" placeholder="4 chữ số"></label>
      ${collectOf(o) ? `<label class="field"><span>Tiền mặt đã thu (phải đúng ${money(collectOf(o))}${collectOf(o) > (o.cod || 0) ? ', gồm cước người nhận trả' : ''})</span><input name="cash" type="number" min="0" step="1000" inputmode="numeric" placeholder="${collectOf(o)}"></label>` : ''}
      <label class="field"><span>Ghi chú giao hàng</span><input name="note" maxlength="150" placeholder="vd: gửi bảo vệ toà nhà"></label>
      <div class="actions"><button class="btn primary">Xác nhận đã giao</button></div></form>`);
    const f = $('#dv-form');
    setTimeout(() => f.code.focus(), 30);
    f.code.addEventListener('input', () => { f.code.value = f.code.value.replace(/\D/g, '').slice(0, 4); });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const params = { id: o.id, code: f.code.value, note: f.note.value.trim() };
      if (collectOf(o)) params.cash = f.cash.value;
      if (staff && f.force.checked) params.force = 1;
      guardForm(f, async () => {
        const res = await store.mutate('order/deliver', params);
        done = true;
        dlg.close();
        toast(res.message);
        resolve(true);
      }, f.querySelector('button'));
    });
    dlg.addEventListener('close', () => { if (!done) resolve(false); }, { once: true });
  });
}

function starsHtml() {
  return `<form id="rate-form" class="rate-form"><fieldset class="stars"><legend>Đánh giá shipper</legend>
    ${[5, 4, 3, 2, 1].map((n) => `<input type="radio" name="stars" value="${n}" id="st${n}"><label for="st${n}" title="${n} sao">★</label>`).join('')}</fieldset>
    <input name="comment" maxlength="200" placeholder="Nhận xét (không bắt buộc)">
    <button class="btn small primary">Gửi đánh giá</button></form>`;
}

// Mở hộp thoại chi tiết đơn. go(hash) để chuyển trang (vd. sang Khiếu nại).
export async function openOrder(id, { go } = {}) {
  const res = await guard(() => api.get('order/get', { id }));
  if (!res) return;
  const o = res.order, inv = res.invoice;
  const r = role();
  const acts = [];
  if (r === 'customer') {
    if (o.status === 0 && o.noShipper) acts.push('<button type="button" class="btn small primary" data-act="retry">Tìm lại shipper</button>');
    if (o.cancelFeeNow !== undefined) acts.push(`<button type="button" class="btn small ghost danger" data-act="cancel">Huỷ đơn${o.cancelFeeNow ? ` (phí ${money(o.cancelFeeNow)})` : ''}</button>`);
    if (o.status === 3) acts.push('<button type="button" class="btn small primary" data-act="redeliver">Hẹn giao lại</button><button type="button" class="btn small ghost" data-act="creturn">Hoàn hàng về kho</button>');
    acts.push('<button type="button" class="btn small ghost" data-act="complain">Khiếu nại</button>');
  }
  if (isStaff()) {
    if (o.status === 6) acts.push('<button type="button" class="btn small primary" data-act="confirm">Xác nhận</button><button type="button" class="btn small ghost danger" data-act="reject">Từ chối</button>');
    if (o.status === 0) acts.push('<button type="button" class="btn small primary" data-act="retry">Tìm shipper ngay</button>');
    if (o.status === 7 && res.order.trip) acts.push('<button type="button" class="btn small ghost danger" data-act="recall">Thu hồi lời mời</button>');
    if (o.status === 3) acts.push('<button type="button" class="btn small" data-act="requeue">Giao lại</button><button type="button" class="btn small ghost" data-act="return">Hoàn kho</button>');
    if (o.status === 1) acts.push('<button type="button" class="btn small" data-act="deliver">Xác nhận giao thay</button>');
    if (o.cancelFeeNow !== undefined) acts.push(`<button type="button" class="btn small ghost danger" data-act="cancel">Huỷ đơn${o.cancelFeeNow ? ` (phí ${money(o.cancelFeeNow)})` : ''}</button>`);
  }
  if (r === 'shipper' && o.status === 1) acts.push('<button type="button" class="btn small primary" data-act="deliver">Đã giao</button><button type="button" class="btn small ghost danger" data-act="fail">Giao thất bại</button>');
  acts.push('<button type="button" class="btn small ghost" data-act="print">In hoá đơn</button>');

  const showCode = r === 'customer' && o.code && [6, 0, 7, 1, 3].includes(o.status);
  showModal(`Đơn ${o.id}`, `<div class="od">
    <div class="od-head">${statusChip(o)}${o.urgent ? ' <span class="chip urgent">Hoả tốc</span>' : ''}<span class="muted small">Đặt ${when.full(o.createdAt)}</span></div>
    ${showCode ? `<div class="code-box"><span>Mã nhận hàng</span><b>${escapeHtml(o.code)}</b><small>Đọc mã này cho shipper khi nhận hàng. Không chia sẻ trước.</small></div>` : ''}
    <dl class="od-grid">
      <dt>Giao tới</dt><dd>${escapeHtml(o.destinationName)}</dd>
      <dt>Người nhận</dt><dd>${escapeHtml(o.recipient || '–')}${o.phone ? ` · <a href="tel:${escapeHtml(o.phone)}">${escapeHtml(o.phone)}</a>` : ''}</dd>
      <dt>Hàng</dt><dd>${fmt.num(o.weight)} kg${o.dims ? ` · ${escapeHtml(o.dims)} cm` : ''}${o.chargedWeight > o.weight ? ` <small class="muted">(tính cước ${fmt.num(o.chargedWeight)} kg)</small>` : ''}${o.note ? ` · ${escapeHtml(o.note)}` : ''}</dd>
      ${o.value ? `<dt>Khai giá</dt><dd>${money(o.value)}${o.insurance ? ` · bảo hiểm ${money(o.insurance)}` : ' <small class="muted">(miễn phí bảo hiểm)</small>'}</dd>` : ''}
      ${o.receiverPays ? `<dt>Trả cước</dt><dd>Người nhận trả ${money(o.total)} khi nhận</dd>` : ''}
      ${o.deadline >= 0 ? `<dt>Hạn giao</dt><dd>${fmt.clock(o.deadline)}</dd>` : ''}
      ${o.cod ? `<dt>Thu hộ</dt><dd>${money(o.cod)}</dd>` : ''}
      ${collectOf(o) > (o.cod || 0) && r !== 'customer' ? `<dt>Phải thu khi giao</dt><dd><b>${money(collectOf(o))}</b></dd>` : ''}
      ${o.ownerName ? `<dt>Khách hàng</dt><dd>${escapeHtml(o.ownerName)} <small class="muted">@${escapeHtml(o.owner)}</small></dd>` : ''}
      ${o.carrierInfo ? `<dt>Shipper</dt><dd>${escapeHtml(o.carrierInfo.name)} · ${escapeHtml(o.carrierInfo.vehicleName)}${o.carrierInfo.plate ? ` · ${escapeHtml(o.carrierInfo.plate)}` : ''}${o.carrierInfo.rating ? ` · ★ ${fmt.num(o.carrierInfo.rating)} (${o.carrierInfo.ratings})` : ''}${o.carrierPhone ? ` · <a href="tel:${escapeHtml(o.carrierPhone)}">${escapeHtml(o.carrierPhone)}</a>` : ''}</dd>`
        : o.carrier ? `<dt>Shipper</dt><dd>${escapeHtml(o.carrier)}${o.carrierPhone ? ` · <a href="tel:${escapeHtml(o.carrierPhone)}">${escapeHtml(o.carrierPhone)}</a>` : ''}${o.trip && !o.trip.accepted ? ' <small class="muted">(chờ shipper nhận)</small>' : ''}</dd>` : ''}
      ${o.offeredTo ? `<dt>Đang mời</dt><dd>${escapeHtml(o.offeredTo)} <small class="muted">(chờ trả lời)</small></dd>` : ''}
      ${o.tried && r !== 'customer' ? `<dt>Đã từ chối / bỏ lỡ</dt><dd>${o.tried} shipper</dd>` : ''}
      ${o.earn && r !== 'customer' ? `<dt>Thu nhập shipper</dt><dd>${money(o.earn)}</dd>` : ''}
      ${o.customerRating && r !== 'customer' ? `<dt>Điểm khách</dt><dd>★ ${fmt.num(o.customerRating)} (${o.customerRatings} lượt)</dd>` : ''}
      ${o.eta != null && (o.status === 1 || o.status === 7) ? `<dt>Dự kiến tới</dt><dd>${fmt.clock(o.eta)}</dd>` : ''}
      ${o.failReasonName && o.status !== 2 ? `<dt>Lý do thất bại</dt><dd class="bad">${escapeHtml(o.failReasonName)}</dd>` : ''}
      ${o.proof ? `<dt>Ghi chú xử lý</dt><dd>${escapeHtml(o.proof)}</dd>` : ''}
    </dl>
    <div class="actions od-acts">${acts.join('')}</div>
    ${r === 'customer' && o.status === 2 && !o.review ? `<div class="block flat">${starsHtml()}</div>` : ''}
    ${o.review ? `<p class="review-line">Bạn đã đánh giá <b>${'★'.repeat(o.review.stars)}${'☆'.repeat(5 - o.review.stars)}</b>${o.review.comment ? ` · “${escapeHtml(o.review.comment)}”` : ''}</p>` : ''}
    <div class="od-cols">
      <section><h3>Diễn biến</h3><ol class="log od-log">${res.timeline.map(eventLine).join('') || '<li class="muted">Chưa có diễn biến</li>'}</ol></section>
      ${r === 'shipper' ? '' : `<section><h3>Hoá đơn</h3>${invoiceHtml(inv)}</section>`}
    </div></div>`);

  const body = $('#modal-body');
  const close = () => $('#modal').close();
  const run = (fn, btn) => guard(async () => { const out = await fn(); if (out && out.message) toast(out.message); close(); }, btn);
  for (const b of body.querySelectorAll('[data-act]')) {
    b.addEventListener('click', async () => {
      const a = b.dataset.act;
      if (a === 'print') { printInvoice(inv); return; }
      if (a === 'complain') { close(); if (go) go('complaints', { order: o.id }); return; }
      if (a === 'confirm') return run(() => store.mutate('order/confirm', { id: o.id }), b);
      if (a === 'retry') return run(() => store.mutate('order/retry', { id: o.id }), b);
      if (a === 'recall') {
        const why = await askReason(`Thu hồi lời mời đơn ${o.id}`, { presets: ['Shipper không phản hồi', 'Cần đổi shipper'], ok: 'Thu hồi', note: 'Đơn về hàng chờ và được gửi cho shipper gần nhất kế tiếp (shipper này không bị tính là từ chối).' });
        if (why) run(() => store.mutate('trip/recall', { id: res.order.trip.id, reason: why }));
        return;
      }
      if (a === 'requeue') return run(() => store.mutate('shift/requeue', { id: o.id }), b);
      if (a === 'return') return run(() => store.mutate('shift/return', { id: o.id }), b);
      if (a === 'redeliver') { close(); redeliverDialog(o); return; }
      if (a === 'creturn') { close(); returnDialog(o); return; }
      if (a === 'reject') {
        const why = await askReason(`Từ chối đơn ${o.id}`, { presets: ['Ngoài vùng phục vụ', 'Hàng cấm gửi', 'Thông tin người nhận không đúng'], ok: 'Từ chối đơn' });
        if (why) run(() => store.mutate('order/reject', { id: o.id, reason: why }));
        return;
      }
      if (a === 'cancel') {
        const feeText = o.cancelFeeNow ? `Phí huỷ <b>${money(o.cancelFeeNow)}</b> theo quy định (shipper đã nhận đơn).` : 'Chưa có shipper nhận nên không mất phí.';
        const why = await askReason(`Huỷ đơn ${o.id}`, { note: feeText, label: 'Lý do huỷ', ok: 'Huỷ đơn',
          presets: r === 'customer' ? ['Đặt nhầm / sai địa chỉ', 'Chờ shipper quá lâu', 'Không còn nhu cầu gửi', 'Muốn đặt lại với thông tin khác'] : ['Khách yêu cầu huỷ qua điện thoại', 'Không liên lạc được người gửi'] });
        if (why) run(() => store.mutate('order/cancel', { id: o.id, reason: why }));
        return;
      }
      if (a === 'deliver') { close(); deliverDialog(o, { staff: isStaff() }); return; }
      if (a === 'fail') { close(); pickFailReason(store.state, o, (reason) => guard(async () => { const x = await store.mutate('shift/fail', { id: o.id, reason }); toast(x.message); })); }
    });
  }
  const rf = $('#rate-form', body);
  if (rf) rf.addEventListener('submit', (e) => {
    e.preventDefault();
    const stars = (rf.querySelector('[name=stars]:checked') || {}).value;
    if (!stars) { toast('Hãy chọn số sao', 'error'); return; }
    guard(async () => {
      const x = await api.post('order/rate', { id: o.id, stars, comment: rf.comment.value.trim() });
      toast(x.message);
      await store.refresh();
      close();
    }, rf.querySelector('button'));
  });
}
