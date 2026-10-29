// Trang Khiếu nại: khách hàng gửi khiếu nại gắn với một đơn của mình và trao đổi với quản trị viên;
// nhân viên nhận xử lý (Mới -> Đang xử lý -> Đã giải quyết, có thể mở lại), trả lời trong phiếu.
// Danh sách có tìm kiếm không dấu, lọc trạng thái, phân trang. Khách chỉ thấy phiếu của mình (403 nếu mở phiếu người khác).
// Nhân viên bồi thường vào ví đối soát của khách (mỗi phiếu một lần, trần theo loại: trễ hạn <= cước, hư hỏng / thất lạc <= giá trị khai).
import { api } from '../api.js';
import { escapeHtml } from '../store.js';
import { $, when, guard, guardForm, toast, pager, bindPager, debounce, ROLE_LABEL, preserveFocus, money, showModal } from '../ui.js';
import { openOrder } from '../orders.js';

let ctx, root;
let data = null, open = null, q = '', status = '', page = 1, creating = null, seq = 0;
const ST = { new: ['Mới', 'violet'], processing: ['Đang xử lý', 'blue'], resolved: ['Đã giải quyết', 'ok'] };
const chip = (s) => `<span class="chip ${(ST[s] || ['', ''])[1]}">${(ST[s] || [s])[0]}</span>`;
const isCustomer = () => ctx.store.state.me.role === 'customer';
const COMP_KINDS = { late: 'Giao trễ hạn', damaged: 'Hàng hư hỏng', lost: 'Thất lạc hàng', other: 'Khác' };

async function load() {
  const s = ++seq;
  const res = await api.get('complaints', { q, status, page, size: 8 });
  if (s !== seq || !root) return;
  data = res;
  page = res.page.page;
  if (open) { const r = await api.get('complaints', { id: open.id }); open = r.complaint; }
  render();
}
const reload = debounce(() => guard(load), 250);

function createHtml() {
  const mine = ctx.store.state.orders.slice().sort((a, b) => b.id - a.id);
  return `<form id="k-new" class="block inset" novalidate><h2>Gửi khiếu nại</h2>
    <label class="field"><span>Về đơn</span><select name="order">${mine.map((o) => `<option value="${o.id}" ${creating === o.id ? 'selected' : ''}>Đơn ${o.id} · ${escapeHtml(o.recipient || o.destinationName)} · ${escapeHtml(o.statusName)}</option>`).join('')}</select></label>
    <label class="field"><span>Tiêu đề</span><input name="title" maxlength="80" placeholder="vd: Giao chậm hơn hẹn"></label>
    <label class="field"><span>Nội dung</span><textarea name="body" rows="4" maxlength="500" placeholder="Mô tả vấn đề bạn gặp (5–500 ký tự)"></textarea></label>
    <div class="actions"><button class="btn primary">Gửi khiếu nại</button><button type="button" class="btn ghost" id="k-new-close">Đóng</button></div></form>`;
}

function threadHtml(c) {
  const staff = !isCustomer();
  const me = ctx.store.state.me.username;
  return `<div class="block thread">
    <div class="split"><h2>#${c.id} · ${escapeHtml(c.title)}</h2>${chip(c.status)}</div>
    <p class="muted small">Đơn <button type="button" class="link" data-order="${c.order}">#${c.order}</button> · ${escapeHtml(c.ownerName)} · tạo ${when.full(c.created)}${c.assignee ? ` · phụ trách: ${escapeHtml(c.assignee)}` : ''}</p>
    ${c.compensation ? `<div class="notice ok">Đã bồi thường <b>${money(c.compensation.amount)}</b> vào ví đối soát · ${escapeHtml(c.compensation.note)} <small>(${escapeHtml(c.compensation.by)}, ${when.full(c.compensation.at)})</small>${isCustomer() ? ' · <a href="#wallet">Xem ví</a>' : ''}</div>` : ''}
    <ol class="chat">${c.messages.map((m) => `<li class="${m.author === me ? 'mine' : ''} ${m.role === 'customer' ? 'cust' : 'staff'}"><div class="bubble"><p>${escapeHtml(m.text)}</p><small>${escapeHtml(m.authorName)} · ${ROLE_LABEL[m.role] || ''} · ${when.full(m.at)}</small></div></li>`).join('')}</ol>
    ${c.status === 'resolved' && !staff ? '<p class="muted small">Phiếu đã giải quyết. Nếu vẫn chưa ổn, hãy gửi khiếu nại mới.</p>'
      : `<form id="k-reply" class="reply-row" novalidate><label class="sr-only" for="k-text">Trả lời</label><textarea id="k-text" name="text" rows="2" maxlength="500" placeholder="Nhập tin nhắn…"></textarea><button class="btn primary">Gửi</button></form>`}
    ${staff ? `<div class="actions">${c.status === 'new' ? '<button class="btn small primary" data-st="processing">Nhận xử lý</button>' : ''}${c.status === 'processing' ? '<button class="btn small primary" data-st="resolved">Đánh dấu đã giải quyết</button>' : ''}${c.status === 'resolved' ? '<button class="btn small" data-st="processing">Mở lại</button>' : ''}${c.compCaps && Object.values(c.compCaps).some((v) => v > 0) ? '<button class="btn small ghost" id="k-comp">Bồi thường…</button>' : ''}</div>` : ''}
  </div>`;
}

function render() { preserveFocus(root, draw); }
function draw() {
  root.innerHTML = `<div class="page-head"><h1>Khiếu nại</h1>${isCustomer() && !creating ? '<button class="btn small primary" id="k-add">Gửi khiếu nại</button>' : ''}</div>
    <div class="cmp-layout">
      <div>
        ${creating !== null ? createHtml() : ''}
        <div class="block">
          <div class="list-tools"><label class="search-box"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20 20"/></svg><input type="search" id="k-search" placeholder="Tìm theo mã, đơn, tiêu đề${isCustomer() ? '' : ', khách hàng'}" value="${escapeHtml(q)}" aria-label="Tìm khiếu nại"></label></div>
          <div class="chips filter-chips">${[['', 'Tất cả'], ['new', 'Mới'], ['processing', 'Đang xử lý'], ['resolved', 'Đã giải quyết']].map(([v, l]) => `<button type="button" class="chip ${status === v ? 'on' : ''}" data-status="${v}">${l}${data && v ? ` <em>${data.byStatus[v] || 0}</em>` : ''}</button>`).join('')}</div>
          ${!data ? '<p class="empty">Đang tải…</p>' : data.complaints.length ? `<ul class="cmp-list">${data.complaints.map((c) => `<li class="${open && open.id === c.id ? 'active' : ''}" data-id="${c.id}" tabindex="0"><div><b>#${c.id} · ${escapeHtml(c.title)}</b><small>Đơn #${c.order}${isCustomer() ? '' : ` · ${escapeHtml(c.ownerName)}`} · ${c.messageCount} tin · ${when.ago(c.updated)}</small></div>${chip(c.status)}</li>`).join('')}</ul>${pager(data.page)}`
    : `<p class="empty">${isCustomer() ? 'Bạn chưa gửi khiếu nại nào.' : 'Không có khiếu nại nào.'}</p>`}
        </div>
      </div>
      <div>${open ? threadHtml(open) : '<div class="block"><p class="empty">Chọn một phiếu để xem trao đổi.</p></div>'}</div>
    </div>`;
  bind();
}

function bind() {
  $('#k-add', root)?.addEventListener('click', () => { creating = 0; render(); });
  const s = $('#k-search', root);
  s.addEventListener('input', () => { q = s.value.trim(); page = 1; reload(); });
  for (const b of root.querySelectorAll('[data-status]')) b.addEventListener('click', () => { status = b.dataset.status; page = 1; guard(load); });
  bindPager(root, (p) => { page = p; guard(load); });
  for (const li of root.querySelectorAll('.cmp-list li')) {
    const go = () => guard(async () => { open = (await api.get('complaints', { id: li.dataset.id })).complaint; render(); });
    li.addEventListener('click', go);
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }
  for (const b of root.querySelectorAll('[data-order]')) b.addEventListener('click', () => openOrder(Number(b.dataset.order), { go: ctx.go }));
  const fn = $('#k-new', root);
  if (fn) {
    $('#k-new-close', root).addEventListener('click', () => { creating = null; render(); });
    fn.addEventListener('submit', (e) => {
      e.preventDefault();
      guardForm(fn, async () => {
        const res = await api.post('complaint/add', { order: fn.order.value, title: fn.title.value.trim(), body: fn.body.value.trim() });
        open = res.complaint;
        creating = null;
        toast(res.message);
        await load();
        ctx.store.refresh();
      }, fn.querySelector('button.primary'));
    });
  }
  const fr = $('#k-reply', root);
  if (fr) fr.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!fr.text.value.trim()) return;
    guardForm(fr, async () => { open = (await api.post('complaint/message', { id: open.id, text: fr.text.value.trim() })).complaint; await load(); $('#k-text', root)?.focus(); }, fr.querySelector('button'));
  });
  for (const b of root.querySelectorAll('[data-st]')) b.addEventListener('click', () => guard(async () => {
    open = (await api.post('complaint/status', { id: open.id, status: b.dataset.st })).complaint;
    toast(`Phiếu #${open.id}: ${ST[open.status][0]}`);
    await load();
    ctx.store.refresh();
  }, b));
  $('#k-comp', root)?.addEventListener('click', () => compDialog(open));
  const chat = root.querySelector('.chat');
  if (chat) chat.scrollTop = chat.scrollHeight;
}

function compDialog(c) {
  const kinds = Object.entries(c.compCaps).filter(([, v]) => v > 0);
  showModal(`Bồi thường khiếu nại #${c.id}`, `<form id="k-cf" novalidate>
    <p class="muted" style="margin:-4px 0 12px">Tiền được cộng vào ví đối soát của ${escapeHtml(c.ownerName)} (đơn #${c.order}${c.orderValue ? `, khai giá ${money(c.orderValue)}` : ', không khai giá'}). Mỗi phiếu chỉ bồi thường một lần.</p>
    <label class="field"><span>Loại</span><select name="kind">${kinds.map(([k, v]) => `<option value="${k}" data-cap="${v}">${COMP_KINDS[k]} (tối đa ${money(v)})</option>`).join('')}</select></label>
    <label class="field"><span>Số tiền (đ)</span><input name="amount" type="number" min="1000" step="1000" inputmode="numeric"></label>
    <label class="field"><span>Ghi chú</span><input name="note" maxlength="150" placeholder="vd: vỡ 1 món, đối chiếu ảnh khách gửi"></label>
    <div class="actions"><button class="btn primary">Xác nhận bồi thường</button></div></form>`);
  const f = $('#k-cf');
  const cap = () => Number(f.kind.selectedOptions[0].dataset.cap);
  const sync = () => { f.amount.max = cap(); f.amount.value = cap(); };
  f.kind.addEventListener('change', sync);
  sync();
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    guardForm(f, async () => {
      const res = await api.post('complaint/compensate', { id: c.id, kind: f.kind.value, amount: f.amount.value, note: f.note.value.trim() });
      $('#modal').close();
      open = res.complaint;
      toast(res.message);
      await load();
    }, f.querySelector('button'));
  });
}

export default {
  id: 'complaints',
  title: 'Khiếu nại',
  wide: true,
  mount(panel, c) {
    ctx = c;
    root = document.createElement('div');
    panel.append(root);
    data = null; open = null; creating = null;
    if (ctx.intent && ctx.intent.order && isCustomer()) creating = ctx.intent.order;
    render();
    guard(load);
  },
  unmount() { root = null; },
  onState() {},
};
