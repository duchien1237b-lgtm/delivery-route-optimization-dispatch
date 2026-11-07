// Nghiệp vụ kiểu Grab (v12) dùng chung cho các trang: loại hàng, trò chuyện trong đơn, tiền tip, shipper yêu thích / bị chặn.
//   - Trò chuyện: khách (chủ đơn), shipper đang giữ đơn và quản trị viên (tổng đài). Gửi được khi shipper đã nhận đơn và đơn
//     chưa kết thúc; đơn xong thì chỉ còn đọc. Hộp thoại tự tải tin mới mỗi 4 giây khi đang mở.
//   - Tip: sau khi giao thành công, một lần mỗi đơn, trong 7 ngày; trừ vào ví đối soát của khách, shipper nhận 100%.
//   - Yêu thích / chặn: chỉ với shipper đã từng nhận đơn của khách. Yêu thích được mời trước, bị chặn không bao giờ được ghép lại.
import { api } from './api.js';
import { escapeHtml } from './store.js';
import { $, guard, toast, showModal, money, when, confirmBox } from './ui.js';

export const CATEGORIES = [
  { v: 'tailieu', label: 'Tài liệu' },
  { v: 'thucpham', label: 'Thực phẩm' },
  { v: 'quanao', label: 'Quần áo' },
  { v: 'dientu', label: 'Điện tử' },
  { v: 'devo', label: 'Hàng dễ vỡ' },
  { v: 'khac', label: 'Khác' },
];
export const PROHIBITED = 'vũ khí, chất cháy nổ, ma tuý, hoá chất độc hại, động vật sống, tiền mặt / vàng bạc, hàng giả, hàng không rõ nguồn gốc';

// Ô chọn loại hàng + ô cam kết cho form đặt đơn
export function categoryFields(current = '') {
  const cur = current || '';
  return `<div class="row">
      <label class="field"><span>Loại hàng</span><select name="category" required><option value="">Chọn loại hàng</option>${CATEGORIES.map((c) => `<option value="${c.v}" ${c.v === cur ? 'selected' : ''}>${c.label}</option>`).join('')}</select></label>
      <p class="muted small cat-hint" data-cat-hint style="align-self:end;margin:0 0 10px">${categoryHint(cur)}</p>
    </div>
    <label class="check" style="margin-bottom:10px"><input type="checkbox" name="pledge"> Tôi cam kết hàng gửi không thuộc danh mục cấm <small class="muted">(${PROHIBITED})</small></label>`;
}
export function categoryHint(v) {
  if (v === 'devo') return 'Hàng dễ vỡ: đóng gói chống sốc, nên khai giá để được bảo hiểm.';
  if (v === 'dientu') return 'Đồ điện tử: nên khai giá để được bồi thường theo giá trị.';
  if (v === 'thucpham') return 'Thực phẩm: nên chọn hạn giao sớm hoặc hoả tốc.';
  return '';
}
export function bindCategory(form) {
  const sel = form.category, hint = form.querySelector('[data-cat-hint]');
  if (sel && hint) sel.addEventListener('change', () => { hint.textContent = categoryHint(sel.value); });
}

// ------------------------------------------------------------------ Trò chuyện trong đơn
let chatTimer = 0;
function messagesHtml(res) {
  if (!res.messages.length) return '<p class="empty">Chưa có tin nhắn nào.</p>';
  return res.messages.map((m) => `<div class="chat-msg ${m.mine ? 'mine' : ''} role-${m.role}"><small>${escapeHtml(m.who)} · ${when.full(m.at)}</small><p>${escapeHtml(m.text)}</p></div>`).join('');
}
export async function chatDialog(id, store) {
  let res = await guard(() => api.get('order/chat', { id }));
  if (!res) return;
  const draw = () => {
    const box = $('#chat-list');
    if (!box) return;
    const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    box.innerHTML = messagesHtml(res);
    if (atEnd) box.scrollTop = box.scrollHeight;
  };
  const who = [res.customer ? `Khách: ${escapeHtml(res.customer)}` : '', res.shipper ? `Shipper: ${escapeHtml(res.shipper)}` : ''].filter(Boolean).join(' · ');
  showModal(`Trò chuyện · đơn ${id}`, `<p class="muted small" style="margin:-4px 0 8px">${who}${res.open ? '' : ' · <b>chỉ xem</b> (đơn chưa có shipper nhận hoặc đã kết thúc)'}</p>
    <div class="chat-list" id="chat-list" aria-live="polite">${messagesHtml(res)}</div>
    ${res.open ? `${res.quick.length ? `<div class="chips chat-quick">${res.quick.map((q) => `<button type="button" class="chip" data-quick="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join('')}</div>` : ''}
    <form class="chat-form" id="chat-form"><input name="text" maxlength="300" placeholder="Nhập tin nhắn…" autocomplete="off" aria-label="Tin nhắn"><button class="btn small primary">Gửi</button></form>
    <p class="muted small" style="margin:6px 0 0">Không chia sẻ mật khẩu hay mã OTP qua tin nhắn. Tin nhắn được lưu để xử lý khiếu nại.</p>` : ''}`);
  const box = $('#chat-list');
  box.scrollTop = box.scrollHeight;
  const send = (text, btn) => guard(async () => {
    const out = await api.post('order/chat/send', { id, text });
    res = out;
    draw();
    const f = $('#chat-form');
    if (f) f.text.value = '';
    $('#chat-list').scrollTop = $('#chat-list').scrollHeight;
  }, btn);
  for (const b of document.querySelectorAll('#modal-body [data-quick]')) b.addEventListener('click', () => send(b.dataset.quick, b));
  const f = $('#chat-form');
  if (f) {
    f.addEventListener('submit', (e) => { e.preventDefault(); const t = f.text.value.trim(); if (t) send(t, f.querySelector('button')); });
    setTimeout(() => f.text.focus(), 30);
  }
  clearInterval(chatTimer);
  chatTimer = setInterval(async () => {
    if (!$('#chat-list')) { clearInterval(chatTimer); return; }
    try { res = await api.get('order/chat', { id }); draw(); } catch { /* bỏ qua: thử lại lần sau */ }
  }, 4000);
  $('#modal').addEventListener('close', () => { clearInterval(chatTimer); if (store) store.refresh().catch(() => {}); }, { once: true });
}
export function chatButton(o, cls = 'btn small ghost') {
  if (!o.chatOpen && !o.chatCount) return '';
  return `<button type="button" class="${cls}" data-chat="${o.id}">${o.chatOpen ? 'Nhắn tin' : 'Xem tin nhắn'}${o.chatCount ? ` (${o.chatCount})` : ''}</button>`;
}

// ------------------------------------------------------------------ Gửi liên kết theo dõi cho người nhận
// Người gửi đặt hộ người khác: gửi liên kết cho người nhận. Người nhận mở liên kết, nhập SĐT của mình để xem đơn và bấm “Đã nhận hàng” (không cần tài khoản).
export function shareCodeButton(o, cls = 'btn small ghost') {
  return o.phone && [0, 6, 7, 1, 8].includes(o.status) ? `<button type="button" class="${cls}" data-sharecode="${o.id}">Gửi liên kết cho người nhận</button>` : '';
}
export function trackLink(id) {
  return `${location.origin}${location.pathname}?don=${encodeURIComponent(id)}`;
}
export function shareCodeDialog(o) {
  const link = trackLink(o.id);
  const who = o.recipient ? `Chào ${o.recipient}, ` : 'Chào bạn, ';
  const text = `${who}đơn hàng ${o.id} đang được giao tới ${o.destinationName || 'bạn'}. Theo dõi đơn và bấm “Đã nhận hàng” khi nhận được hàng: ${link}${o.phone ? ' (nhập SĐT ' + o.phone + ')' : ''}`;
  const phone = o.phone || '';
  showModal(`Gửi liên kết theo dõi · đơn ${o.id}`, `<p class="muted" style="margin:-4px 0 10px;font-size:13.5px">Bạn đặt hộ người khác? Gửi tin nhắn này cho người nhận để họ theo dõi đơn và xác nhận khi nhận hàng.${phone ? ` Người nhận nhập SĐT <b>${escapeHtml(phone)}</b> để xem đơn.` : ''}</p>
    <label class="field"><span>Tin nhắn</span><textarea id="sc-text" rows="5" readonly>${escapeHtml(text)}</textarea></label>
    <div class="actions">
      <button type="button" class="btn primary" id="sc-copy">Sao chép</button>
      ${phone ? `<a class="btn" href="sms:${encodeURIComponent(phone)}?body=${encodeURIComponent(text)}">Gửi SMS</a>` : ''}
      ${navigator.share ? '<button type="button" class="btn" id="sc-share">Chia sẻ…</button>' : ''}
    </div>`);
  $('#sc-copy').addEventListener('click', async () => {
    const ta = $('#sc-text');
    try { await navigator.clipboard.writeText(ta.value); }
    catch { ta.select(); try { document.execCommand('copy'); } catch { /* trình duyệt chặn */ } }
    toast('Đã sao chép, dán vào Zalo / SMS để gửi người nhận');
  });
  const sh = $('#sc-share');
  if (sh) sh.addEventListener('click', () => { navigator.share({ title: `Theo dõi đơn ${o.id}`, text }).catch(() => {}); });
}

// ------------------------------------------------------------------ Tiền tip
const TIP_PRESETS = [5000, 10000, 20000, 50000];
export function tipDialog(o, store, carrierName = '') {
  return new Promise((resolve) => {
    const max = (store.state.config && store.state.config.tipMax) || 200000;
    showModal(`Tip cho shipper · đơn ${o.id}`, `<p class="muted" style="margin:-4px 0 10px;font-size:13.5px">${carrierName ? `<b>${escapeHtml(carrierName)}</b> nhận 100% tiền tip. ` : ''}Khoản tip được trừ vào ví của bạn (như cước), mỗi đơn tip một lần trong 7 ngày sau khi giao.</p>
      <div class="chips" style="margin-bottom:10px">${TIP_PRESETS.filter((v) => v <= max).map((v) => `<button type="button" class="chip" data-tip="${v}">${money(v)}</button>`).join('')}</div>
      <label class="field"><span>Số tiền (1.000 đ – ${money(max)}, bội số 1.000 đ)</span><input id="tip-amount" type="number" min="1000" max="${max}" step="1000" inputmode="numeric" value="10000"></label>
      <label class="field"><span>Lời nhắn (không bắt buộc)</span><input id="tip-note" maxlength="100" placeholder="Cảm ơn bạn giao nhanh!"></label>
      <div class="actions"><button type="button" class="btn primary" id="tip-ok">Tip</button></div>`);
    for (const b of document.querySelectorAll('#modal-body [data-tip]')) b.addEventListener('click', () => { $('#tip-amount').value = b.dataset.tip; });
    $('#tip-ok').addEventListener('click', (e) => guard(async () => {
      const out = await api.post('order/tip', { id: o.id, amount: $('#tip-amount').value, note: $('#tip-note').value.trim() });
      toast(out.message);
      $('#modal').close();
      await store.refresh();
      resolve(true);
    }, e.currentTarget));
  });
}

// ------------------------------------------------------------------ Shipper yêu thích / bị chặn
const PREF_TEXT = {
  fav: 'Shipper yêu thích được hệ thống mời trước cho các đơn sau của bạn (khi họ đang rảnh và đủ điều kiện).',
  block: 'Shipper bị chặn sẽ không bao giờ được ghép cho đơn của bạn nữa. Họ cũng không thấy đơn của bạn trên bảng đơn chờ nhận.',
};
export async function setPref(name, action, store) {
  if (action === 'block' && !(await confirmBox(`Chặn ${name}?`, PREF_TEXT.block, { ok: 'Chặn', danger: true }))) return null;
  return guard(async () => {
    const out = await api.post('customer/shipper-pref', { shipper: name, action });
    toast(out.message);
    if (store) await store.refresh();
    return out;
  });
}
export function prefButtons(o) {
  if (!o.carrierInfo || o.carrierPref === undefined) return '';
  const n = escapeHtml(o.carrierInfo.name);
  const fav = o.carrierPref === 'fav', blk = o.carrierPref === 'block';
  return `<button type="button" class="btn small ghost" data-pref="${fav ? 'unfav' : 'fav'}" data-name="${n}">${fav ? '♥ Bỏ yêu thích' : '♡ Yêu thích shipper'}</button>
    <button type="button" class="btn small ghost ${blk ? '' : 'danger'}" data-pref="${blk ? 'unblock' : 'block'}" data-name="${n}">${blk ? 'Bỏ chặn shipper' : 'Chặn shipper'}</button>`;
}
// Danh sách trong Hồ sơ của khách
export async function prefsSection(el, store) {
  const res = await guard(() => api.get('customer/shippers'));
  if (!res || !el.isConnected) return;
  const row = (s) => `<li><span><b>${escapeHtml(s.name)}</b><small>${s.vehicle ? escapeHtml(s.vehicle) : 'đã rời đội xe'}${s.rating ? ` · ★ ${Number(s.rating).toFixed(1)} (${s.ratings})` : ''}</small></span>
    <span class="acts">${s.favorite ? `<button type="button" class="btn small ghost" data-pref="unfav" data-name="${escapeHtml(s.name)}">Bỏ yêu thích</button>`
      : s.blocked ? `<button type="button" class="btn small ghost" data-pref="unblock" data-name="${escapeHtml(s.name)}">Bỏ chặn</button>`
        : `<button type="button" class="btn small ghost" data-pref="fav" data-name="${escapeHtml(s.name)}">♡ Yêu thích</button><button type="button" class="btn small ghost danger" data-pref="block" data-name="${escapeHtml(s.name)}">Chặn</button>`}</span></li>`;
  const others = res.served.filter((s) => !s.favorite && !s.blocked);
  el.innerHTML = `<p class="muted small" style="margin:0 0 8px">${escapeHtml(PREF_TEXT.fav)} Tối đa ${res.max} shipper mỗi danh sách.</p>
    <h3 class="pref-h">Yêu thích (${res.favorites.length})</h3><ul class="pref-list">${res.favorites.map(row).join('') || '<li class="muted">Chưa có</li>'}</ul>
    <h3 class="pref-h">Đã chặn (${res.blocked.length})</h3><ul class="pref-list">${res.blocked.map(row).join('') || '<li class="muted">Chưa có</li>'}</ul>
    <h3 class="pref-h">Đã từng giao cho bạn</h3><ul class="pref-list">${others.map(row).join('') || '<li class="muted">Chưa có shipper nào khác</li>'}</ul>`;
  for (const b of el.querySelectorAll('[data-pref]')) b.addEventListener('click', async () => {
    const out = await setPref(b.dataset.name, b.dataset.pref, store);
    if (out) prefsSection(el, store);
  });
}
// Gắn sự kiện cho các nút data-chat / data-pref / data-tip trong một vùng
export function bindGrabx(root, store, findOrder) {
  for (const b of root.querySelectorAll('[data-sharecode]')) b.addEventListener('click', (e) => {
    e.stopPropagation();
    const o = findOrder(Number(b.dataset.sharecode));
    if (o) shareCodeDialog(o);
  });
  for (const b of root.querySelectorAll('[data-chat]')) b.addEventListener('click', (e) => { e.stopPropagation(); chatDialog(Number(b.dataset.chat), store); });
  for (const b of root.querySelectorAll('[data-pref]')) b.addEventListener('click', (e) => { e.stopPropagation(); setPref(b.dataset.name, b.dataset.pref, store); });
  for (const b of root.querySelectorAll('[data-tipo]')) b.addEventListener('click', (e) => {
    e.stopPropagation();
    const o = findOrder(Number(b.dataset.tipo));
    if (o) tipDialog(o, store, o.carrierInfo ? o.carrierInfo.name : '');
  });
}
