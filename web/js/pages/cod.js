// Trang Sổ COD (tiền thu hộ): mỗi khoản đi qua 3 bước  đang giữ (shipper đã thu) -> đã nộp (chờ đối soát) -> đã đối soát.
// Shipper: xem khoản đang giữ, nộp tiền (ghi rõ số tiền thực nộp). Điều phối viên / quản trị viên: đếm tiền, xác nhận phiếu nộp
// (chênh lệch được ghi lại), chốt ca từng shipper. Server chỉ trả về sổ của chính shipper khi shipper xem.
import { api } from '../api.js';
import { escapeHtml } from '../store.js';
import { $, money, when, guard, guardForm, toast, confirmBox, showModal } from '../ui.js';

let ctx, root, data = null, filter = '';
const STATE = { held: ['Đang giữ', 'warn'], submitted: ['Đã nộp, chờ đối soát', 'blue'], settled: ['Đã đối soát', 'ok'] };
const chip = (s) => `<span class="chip ${(STATE[s] || ['', ''])[1]}">${escapeHtml((STATE[s] || [s])[0])}</span>`;
const isShipper = () => ctx.store.state.me.role === 'shipper';

async function load() {
  data = await api.get('cod', filter ? { shipper: filter } : {});
  if (root) render();
}

function shipperView(row) {
  const held = row.entries.filter((e) => e.state === 'held');
  return `<div class="cod-card"><span>Tiền thu hộ đang giữ</span><b>${money(row.held)}</b>
      <div class="row2"><span>${held.length} đơn</span><span>Chờ đối soát <b>${money(row.awaiting)}</b></span></div></div>
    ${row.held > 0 ? `<form id="c-remit" class="block inset" novalidate><h2>Nộp tiền thu hộ</h2>
      <p class="muted small" style="margin:-6px 0 10px">Nhập đúng số tiền bạn thực nộp. Nếu khác số đang giữ, chênh lệch sẽ được ghi lại để đối soát.</p>
      <label class="field"><span>Số tiền nộp (đ)</span><input name="handed" type="number" min="0" step="1000" value="${row.held}" inputmode="numeric"></label>
      <div class="actions"><button class="btn primary">Nộp ${money(row.held)}</button></div></form>` : ''}
    ${entriesTable(row)}${remitTable(row, false)}${closesTable(row)}`;
}

function entriesTable(row) {
  if (!row.entries.length) return '<p class="empty">Chưa có khoản thu hộ nào.</p>';
  return `<div class="block"><h2>Các khoản thu hộ</h2><div class="table-wrap"><table class="data"><thead><tr><th>Đơn</th><th class="num">Số tiền</th><th>Trạng thái</th><th>Thu lúc</th><th>Phiếu nộp</th></tr></thead><tbody>
    ${row.entries.slice().reverse().map((e) => `<tr><td>#${e.order}</td><td class="num">${money(e.amount)}</td><td>${chip(e.state)}</td><td><small>${when.full(e.at)}</small></td><td>${e.remittance ? `#${e.remittance}` : '–'}</td></tr>`).join('')}
  </tbody></table></div></div>`;
}
function remitTable(row, staff) {
  if (!row.remittances.length) return '';
  return `<div class="block"><h2>Phiếu nộp tiền</h2><div class="table-wrap"><table class="data"><thead><tr><th>Phiếu</th><th class="num">Phải nộp</th><th class="num">Đã nộp</th><th class="num">Đếm được</th><th class="num">Chênh lệch</th><th>Trạng thái</th><th></th></tr></thead><tbody>
    ${row.remittances.slice().reverse().map((m) => `<tr><td>#${m.id}<br><small>${when.full(m.at)} · ${m.orders} đơn</small></td><td class="num">${money(m.expected)}</td><td class="num">${money(m.handed)}</td>
      <td class="num">${m.state === 'settled' ? money(m.counted) : '–'}</td><td class="num ${m.diff ? 'bad' : ''}">${m.state === 'settled' ? (m.diff ? money(m.diff) : 'khớp') : '–'}</td>
      <td>${chip(m.state)}${m.confirmedBy ? `<br><small>bởi ${escapeHtml(m.confirmedBy)}${m.note ? ` · ${escapeHtml(m.note)}` : ''}</small>` : ''}</td>
      <td class="num">${staff && m.state === 'submitted' ? `<button class="btn small primary" data-confirm="${m.id}" data-handed="${m.handed}" data-expected="${m.expected}" data-shipper="${escapeHtml(row.shipper)}">Đối soát</button>` : ''}</td></tr>`).join('')}
  </tbody></table></div></div>`;
}
function closesTable(row) {
  if (!row.closes.length) return '';
  return `<div class="block"><h2>Các ca đã chốt</h2><table class="data"><thead><tr><th>Ca</th><th class="num">Đơn</th><th class="num">Đã thu</th><th class="num">Đếm được</th><th class="num">Chênh lệch</th><th>Người chốt</th></tr></thead><tbody>
    ${row.closes.slice().reverse().map((c) => `<tr><td>#${c.id}<br><small>${when.full(c.at)}</small></td><td class="num">${c.orders}</td><td class="num">${money(c.collected)}</td><td class="num">${money(c.counted)}</td><td class="num ${c.diff ? 'bad' : ''}">${c.diff ? money(c.diff) : 'khớp'}</td><td>${escapeHtml(c.by)}</td></tr>`).join('')}
  </tbody></table></div>`;
}

function staffView() {
  const rows = data.shippers;
  const waiting = rows.reduce((n, r) => n + r.remittances.filter((m) => m.state === 'submitted').length, 0);
  return `<div class="tiles" style="margin-bottom:14px">
      <div class="tile"><b>${money(data.held)}</b><span>shipper đang giữ</span></div>
      <div class="tile"><b>${money(data.awaiting)}</b><span>đã nộp, chờ đối soát</span></div>
      <div class="tile"><b>${waiting}</b><span>phiếu chờ đối soát</span></div>
    </div>
    <div class="block"><h2>Theo shipper</h2><div class="table-wrap"><table class="data"><thead><tr><th>Shipper</th><th class="num">Đang giữ</th><th class="num">Chờ đối soát</th><th class="num">Đã đối soát</th><th></th></tr></thead><tbody>
      ${rows.map((r) => `<tr class="clickable ${filter === r.shipper ? 'active' : ''}" data-pick="${escapeHtml(r.shipper)}"><td><b>${escapeHtml(r.shipper)}</b></td><td class="num">${money(r.held)}</td><td class="num">${money(r.awaiting)}</td>
        <td class="num">${money(r.entries.filter((e) => e.state === 'settled').reduce((s, e) => s + e.amount, 0))}</td>
        <td class="num nowrap"><button class="btn small ghost" data-close="${escapeHtml(r.shipper)}" ${r.held || r.awaiting ? 'title="Còn tiền chưa đối soát"' : ''}>Chốt ca</button></td></tr>`).join('')}
    </tbody></table></div></div>
    ${rows.filter((r) => r.remittances.length || (filter && r.shipper === filter)).map((r) => `<h3 class="sub-head">${escapeHtml(r.shipper)}</h3>${remitTable(r, true)}${filter === r.shipper ? entriesTable(r) + closesTable(r) : ''}`).join('')}`;
}

function render() {
  root.innerHTML = `<div class="page-head"><h1>Sổ COD</h1>${!isShipper() && filter ? '<button class="btn small ghost" id="c-all">Mọi shipper</button>' : ''}</div>
    ${!data ? '<p class="empty">Đang tải…</p>' : isShipper() ? (data.shippers[0] ? shipperView(data.shippers[0]) : '<p class="empty">Tài khoản chưa gắn với shipper nào.</p>') : staffView()}`;
  bind();
}

function bind() {
  $('#c-all', root)?.addEventListener('click', () => { filter = ''; guard(load); });
  const f = $('#c-remit', root);
  if (f) f.addEventListener('submit', (e) => {
    e.preventDefault();
    guardForm(f, async () => { data = await api.post('cod/remit', { handed: f.handed.value }); toast(data.message); render(); ctx.store.refresh(); }, f.querySelector('button'));
  });
  for (const tr of root.querySelectorAll('[data-pick]')) tr.addEventListener('click', (e) => { if (e.target.closest('button')) return; filter = tr.dataset.pick; guard(load); });
  for (const b of root.querySelectorAll('[data-close]')) b.addEventListener('click', async () => {
    if (!(await confirmBox(`Chốt ca của ${b.dataset.close}?`, 'Chỉ chốt được khi mọi khoản thu hộ của shipper này đã được nộp và đối soát.', { ok: 'Chốt ca' }))) return;
    guard(async () => { data = await api.post('cod/close', { shipper: b.dataset.close }); toast(data.message); render(); });
  });
  for (const b of root.querySelectorAll('[data-confirm]')) b.addEventListener('click', () => confirmRemit(b));
}

function confirmRemit(b) {
  showModal(`Đối soát phiếu #${b.dataset.confirm}`, `<form id="c-conf" novalidate>
    <p class="muted" style="margin:-4px 0 12px">${escapeHtml(b.dataset.shipper)} nộp <b>${money(Number(b.dataset.handed))}</b> (phải nộp ${money(Number(b.dataset.expected))}). Hãy đếm tiền mặt và nhập số thực nhận.</p>
    <label class="field"><span>Số tiền đếm được (đ)</span><input name="counted" type="number" min="0" step="1000" value="${b.dataset.handed}"></label>
    <label class="field"><span>Ghi chú (bắt buộc nếu chênh lệch)</span><input name="note" maxlength="120"></label>
    <div class="actions"><button class="btn primary">Xác nhận đã nhận tiền</button></div></form>`);
  const f = $('#c-conf');
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    guardForm(f, async () => {
      data = await api.post('cod/confirm', { remit: b.dataset.confirm, counted: f.counted.value, note: f.note.value.trim() });
      $('#modal').close();
      toast(data.message);
      render();
      ctx.store.refresh();
    }, f.querySelector('button'));
  });
}

export default {
  id: 'cod',
  title: 'Sổ COD',
  wide: true,
  mount(panel, c) {
    ctx = c;
    root = document.createElement('div');
    panel.append(root);
    data = null;
    render();
    guard(load);
  },
  unmount() { root = null; },
  onState() { if (root) guard(load); },
};
