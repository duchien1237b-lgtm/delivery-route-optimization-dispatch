// Trang Đơn hàng (quản trị viên): hàng đợi xử lý đơn theo máy trạng thái. Đơn khách đặt được hệ thống tự mời cho shipper gần nhất;
// quản trị viên chỉ can thiệp khi cần (tìm lại shipper, thu hồi lời mời, phân công tay, huỷ, giao lại / hoàn kho).
// Mới -> xác nhận / từ chối; Thất bại -> giao lại / hoàn kho; huỷ kèm lý do (có phí nếu đã phân công).
// Danh sách tìm kiếm không dấu (Trie ở server), lọc, sắp xếp, phân trang qua /api/orders/list.
// Mục Chờ giao: chọn nhiều đơn rồi phân công tay cho một shipper (server vẫn xếp thứ tự giao bằng thuật toán, kiểm tra tải trọng).
import { api } from '../api.js';
import { escapeHtml } from '../store.js';
import { $, fmt, money, when, guard, toast, statusChip, askReason, pager, bindPager, debounce, preserveFocus } from '../ui.js';
import { openOrder } from '../orders.js';

let ctx, root;
let q = '', group = 'todo', sort = 'id:desc', page = 1, data = null, seq = 0;
const picked = new Set();   // đơn Chờ giao được chọn để phân công tay

const GROUPS = [
  { v: 'todo', label: 'Cần xử lý', status: '6,3' },
  { v: 'new', label: 'Mới', status: '6' },
  { v: 'wait', label: 'Chờ giao / đang tìm shipper', status: '0' },
  { v: 'disp', label: 'Đã mời shipper', status: '7' },
  { v: 'live', label: 'Đang giao', status: '1' },
  { v: 'fail', label: 'Thất bại', status: '3' },
  { v: 'done', label: 'Đã giao', status: '2' },
  { v: 'closed', label: 'Huỷ / hoàn kho', status: '4,5' },
  { v: 'all', label: 'Tất cả', status: '' },
];
const SORTS = [
  { v: 'id:desc', label: 'Mới nhất' }, { v: 'id:asc', label: 'Cũ nhất' }, { v: 'deadline:asc', label: 'Hạn giao gần nhất' },
  { v: 'net:desc', label: 'Cước cao nhất' }, { v: 'status:asc', label: 'Theo trạng thái' }, { v: 'destination:asc', label: 'Theo điểm giao (A–Z)' },
];

async function load() {
  const s = ++seq;
  const g = GROUPS.find((x) => x.v === group);
  const [key, dir] = sort.split(':');
  const res = await api.get('orders/list', { q, status: g.status, sort: key, dir, page, size: 12 });
  if (s !== seq || !root) return;
  data = res;
  page = res.page.page;
  for (const id of [...picked]) if (!res.orders.some((o) => o.id === id && o.status === 0)) picked.delete(id);
  render();
}
const reload = debounce(() => guard(load), 250);

function count(g) {
  if (!data) return '';
  if (!g.status) return Object.values(data.byStatus).reduce((a, b) => a + b, 0);
  return g.status.split(',').reduce((a, k) => a + (data.byStatus[k] || 0), 0);
}

function render() { preserveFocus(root, draw); }
function draw() {
  const st = ctx.store.state;
  const b = st.badges || {};
  const rows = data ? data.orders : [];
  root.innerHTML = `<div class="page-head"><h1>Đơn hàng</h1><a class="btn small primary" href="#dispatch">Điều phối</a></div>
    <div class="report-grid">
      <div class="block span-2"><div class="tiles">
        <button class="tile as-btn" data-group="new"><b>${b.newOrders || 0}</b><span>đơn mới chờ xác nhận${st.config && st.config.autoMatch ? ' (ghép tự động đang bật)' : ''}</span></button>
        <button class="tile as-btn" data-group="wait"><b>${b.waiting || 0}</b><span>đang tìm shipper</span></button>
        <button class="tile as-btn" data-group="fail"><b>${b.failed || 0}</b><span>thất bại cần quyết định</span></button>
        <a class="tile as-btn" href="#complaints"><b>${b.complaints || 0}</b><span>khiếu nại đang mở</span></a>
      </div></div>
      <div class="block span-2">
        <div class="list-tools">
          <label class="search-box"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20 20"/></svg><input type="search" id="q-search" placeholder="Tìm mã đơn, người nhận, SĐT, điểm giao, khách hàng (gõ không dấu được)" value="${escapeHtml(q)}" aria-label="Tìm đơn"></label>
          <label class="sort-box"><span class="sr-only">Sắp xếp</span><select id="q-sort">${SORTS.map((s) => `<option value="${s.v}" ${s.v === sort ? 'selected' : ''}>${s.label}</option>`).join('')}</select></label>
        </div>
        <div class="chips filter-chips" role="tablist" aria-label="Lọc theo trạng thái">${GROUPS.map((g) => `<button type="button" role="tab" class="chip ${g.v === group ? 'on' : ''}" aria-selected="${g.v === group}" data-group="${g.v}">${g.label} <em>${count(g)}</em></button>`).join('')}</div>
        ${group === 'new' && rows.length ? '<div class="actions" style="margin:4px 0 10px"><button class="btn small" id="q-confirm-all">Xác nhận tất cả đơn mới trên trang</button></div>' : ''}
        ${group === 'wait' && rows.length ? assignBar(st) : ''}
        ${!data ? '<p class="empty">Đang tải…</p>' : rows.length ? `<div class="table-wrap"><table class="data"><thead><tr>
          ${group === 'wait' ? '<th class="pick"><span class="sr-only">Chọn</span></th>' : ''}<th>Đơn</th><th>Khách hàng</th><th>Giao tới</th><th>Người nhận</th><th class="num">Cước</th><th>Trạng thái</th><th></th></tr></thead><tbody>
          ${rows.map((o) => `<tr class="clickable" data-id="${o.id}">
            ${group === 'wait' ? `<td class="pick">${o.status === 0 ? `<input type="checkbox" data-pick="${o.id}" ${picked.has(o.id) ? 'checked' : ''} aria-label="Chọn đơn ${o.id}">` : ''}</td>` : ''}
            <td><b>#${o.id}</b>${o.urgent ? ' <span class="chip urgent">Gấp</span>' : ''}<br><small>${when.ago(o.createdAt)}</small></td>
            <td>${o.ownerName ? escapeHtml(o.ownerName) : '<span class="muted">Nội bộ</span>'}</td>
            <td>${escapeHtml(o.destinationName)}${o.deadline >= 0 ? `<br><small>hạn ${fmt.clock(o.deadline)}</small>` : ''}</td>
            <td>${escapeHtml(o.recipient || '–')}<br><small>${escapeHtml(o.phone || '')}</small></td>
            <td class="num">${money(o.total != null ? o.total : o.net)}${o.cod ? `<br><small>thu hộ ${money(o.cod)}</small>` : ''}${o.receiverPays ? '<br><small>người nhận trả</small>' : ''}<br><small>${fmt.num(o.chargedWeight || o.weight)} kg</small></td>
            <td>${statusChip(o)}${o.offeredTo ? `<br><small>mời ${escapeHtml(o.offeredTo)}</small>` : o.carrier ? `<br><small>${escapeHtml(o.carrier)}</small>` : ''}${o.status === 0 && o.tried ? `<br><small>${o.tried} shipper đã bỏ qua</small>` : ''}</td>
            <td class="num nowrap">${o.status === 6 ? `<button class="btn small primary" data-confirm="${o.id}">Xác nhận</button> <button class="btn small ghost danger" data-reject="${o.id}">Từ chối</button>`
              : o.status === 0 ? `<button class="btn small" data-retry="${o.id}">Tìm shipper</button>`
              : o.status === 3 ? `<button class="btn small" data-requeue="${o.id}">Giao lại</button> <button class="btn small ghost" data-return="${o.id}">Hoàn kho</button>` : ''}</td>
          </tr>`).join('')}</tbody></table></div>${pager(data.page)}`
    : `<p class="empty">${q ? `Không có đơn nào khớp “${escapeHtml(q)}”.` : 'Không có đơn nào ở mục này.'}</p>`}
      </div>
    </div>`;
  bind();
}

function assignBar(st) {
  const ready = st.shippers.filter((s) => s.ready && !s.absent);
  const kg = data.orders.filter((o) => picked.has(o.id)).reduce((a, o) => a + (o.chargedWeight || o.weight), 0);
  return `<div class="assign-bar">
    <label class="check"><input type="checkbox" id="q-pick-all" ${picked.size && data.orders.filter((o) => o.status === 0).every((o) => picked.has(o.id)) ? 'checked' : ''}> Chọn cả trang</label>
    <span class="muted small">${picked.size ? `Đã chọn <b>${picked.size}</b> đơn · ${fmt.num(kg)} kg` : 'Chọn đơn để phân công tay'}</span>
    <select id="q-shipper" aria-label="Shipper">${ready.length ? ready.map((s) => `<option value="${s.index}">${escapeHtml(s.name)} · ${escapeHtml(s.vehicleName)} ${fmt.num(s.capacity)} kg</option>`).join('') : '<option value="">Không có shipper sẵn sàng</option>'}</select>
    <button class="btn small primary" id="q-assign" ${picked.size && ready.length ? '' : 'disabled'}>Phân công</button>
  </div>`;
}

function bind() {
  const search = $('#q-search', root);
  search.addEventListener('input', () => { q = search.value.trim(); page = 1; reload(); });
  $('#q-sort', root).addEventListener('change', (e) => { sort = e.target.value; page = 1; guard(load); });
  for (const b of root.querySelectorAll('[data-group]')) b.addEventListener('click', () => { group = b.dataset.group; page = 1; guard(load); });
  bindPager(root, (p) => { page = p; guard(load); });
  for (const tr of root.querySelectorAll('tr[data-id]')) {
    tr.addEventListener('click', (e) => { if (!e.target.closest('button')) openOrder(Number(tr.dataset.id), { go: ctx.go }); });
  }
  const act = (attr, path, msg) => {
    for (const b of root.querySelectorAll(`[${attr}]`)) b.addEventListener('click', () => guard(async () => {
      const res = await ctx.store.mutate(path, { id: b.getAttribute(attr) });
      toast(res.message || msg);
    }, b));
  };
  act('data-confirm', 'order/confirm');
  act('data-retry', 'order/retry');
  act('data-requeue', 'shift/requeue');
  act('data-return', 'shift/return');
  for (const b of root.querySelectorAll('[data-reject]')) b.addEventListener('click', async () => {
    const why = await askReason(`Từ chối đơn ${b.dataset.reject}`, { presets: ['Ngoài vùng phục vụ', 'Hàng cấm gửi', 'Thông tin người nhận không đúng'], ok: 'Từ chối đơn' });
    if (why) guard(async () => { const res = await ctx.store.mutate('order/reject', { id: b.dataset.reject, reason: why }); toast(res.message); });
  });
  for (const c of root.querySelectorAll('[data-pick]')) {
    c.addEventListener('click', (e) => e.stopPropagation());
    c.addEventListener('change', () => { const id = Number(c.dataset.pick); if (c.checked) picked.add(id); else picked.delete(id); render(); });
  }
  $('#q-pick-all', root)?.addEventListener('change', (e) => {
    for (const o of data.orders.filter((x) => x.status === 0)) { if (e.target.checked) picked.add(o.id); else picked.delete(o.id); }
    render();
  });
  $('#q-assign', root)?.addEventListener('click', (e) => guard(async () => {
    const res = await ctx.store.mutate('dispatch/assign', { orders: [...picked].join(','), shipper: $('#q-shipper', root).value });
    picked.clear();
    toast(res.message);
  }, e.currentTarget));
  const all = $('#q-confirm-all', root);
  if (all) all.addEventListener('click', () => guard(async () => {
    let n = 0;
    for (const o of data.orders.filter((x) => x.status === 6)) { await ctx.store.mutate('order/confirm', { id: o.id }); n++; }
    toast(`Đã xác nhận ${n} đơn`);
  }, all));
}

export default {
  id: 'queue',
  title: 'Đơn hàng',
  wide: true,
  mount(panel, c) {
    ctx = c;
    root = document.createElement('div');
    panel.append(root);
    if (ctx.intent && ctx.intent.group) { group = ctx.intent.group; page = 1; }
    data = null;
    render();
    guard(load);
  },
  unmount() { root = null; },
  onState() { if (root) reload(); },
};
