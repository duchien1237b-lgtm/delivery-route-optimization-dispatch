// Trang Ví đối soát: sổ tiền giữa công ty và từng khách hàng.
// Cộng: tiền thu hộ đã giao (chờ shipper nộp & đối soát thì chưa rút được), bồi thường khiếu nại, khách nộp bù.
// Trừ: cước do người gửi trả, phí huỷ, phí hoàn hàng, các lần chi trả cho khách.
// Khách hàng xem sao kê của mình. Điều phối viên xem số dư mọi khách; chỉ quản trị viên được chi trả / ghi nhận nộp bù.
// Sao kê lọc được theo loại (tiền vào / ra / chờ đối soát) và khoảng ngày, phân trang, xuất CSV; danh sách khách tìm được không dấu.
import { api } from '../api.js';
import { escapeHtml } from '../store.js';
import { $, money, when, guard, guardForm, toast, showModal, pager, bindPager, fold, downloadCsv, preserveFocus } from '../ui.js';

let ctx, root, list = null, wallet = null, pick = '';
let flt = 'all', from = '', to = '', page = 1, q = '', only = '';
const PAGE = 15;
const FILTERS = [['all', 'Tất cả'], ['in', 'Tiền vào'], ['out', 'Tiền ra'], ['pending', 'Chờ đối soát']];
const ONLY = [['', 'Mọi khách'], ['owed', 'Có tiền rút được'], ['debt', 'Đang nợ'], ['pending', 'Có thu hộ chờ đối soát']];
const role = () => ctx.store.state.me.role;
const KIND = { cod: 'Thu hộ', fee: 'Cước', cancel: 'Phí huỷ', return: 'Phí hoàn', comp: 'Bồi thường', payout: 'Chi trả', collect: 'Nộp bù' };
const signed = (v) => `<span class="${v < 0 ? 'neg' : v > 0 ? 'pos' : ''}">${v > 0 ? '+' : v < 0 ? '−' : ''}${money(Math.abs(v))}</span>`;

async function load() {
  if (role() === 'customer') wallet = await api.get('wallet');
  else {
    list = await api.get('wallets');
    wallet = pick ? await api.get('wallet', { customer: pick }) : null;
  }
  if (root) render();
}

function summaryTiles(w) {
  return `<div class="tiles">
      <div class="tile"><b class="${w.balance < 0 ? 'neg' : ''}">${w.balance < 0 ? '−' : ''}${money(Math.abs(w.balance))}</b><span>số dư đối soát${w.balance < 0 ? ' (khách nợ)' : ''}</span></div>
      <div class="tile"><b>${money(Math.max(0, w.available))}</b><span>có thể rút ngay</span></div>
      <div class="tile"><b>${money(w.pending)}</b><span>thu hộ chờ đối soát</span></div>
      <div class="tile"><b>${money(w.paidOut)}</b><span>đã chi trả</span></div>
    </div>
    <p class="muted small" style="margin:-4px 0 12px">Thu hộ ${money(w.codTotal)} · cước &amp; phí ${money(w.fees)} · bồi thường ${money(w.comps)}${w.collected ? ` · đã nộp bù ${money(w.collected)}` : ''}</p>`;
}

// Ngày (yyyy-mm-dd, giờ máy người xem) -> giây Unix đầu / cuối ngày
const dayStart = (d) => (d ? new Date(`${d}T00:00:00`).getTime() / 1000 : -Infinity);
const dayEnd = (d) => (d ? new Date(`${d}T23:59:59`).getTime() / 1000 : Infinity);

// Các dòng sao kê kèm số dư luỹ kế (tính trên toàn bộ sổ), mới nhất trước, đã lọc
function statementRows(w) {
  let run = 0;
  const all = w.lines.map((l) => { run += l.amount; return { ...l, run }; }).reverse();
  const a = dayStart(from), b = dayEnd(to);
  return all.filter((l) => l.at >= a && l.at <= b
    && (flt === 'all' || (flt === 'in' && l.amount > 0) || (flt === 'out' && l.amount < 0) || (flt === 'pending' && l.pending)));
}

function exportStatement(w) {
  const rows = statementRows(w);
  downloadCsv(`sao-ke-${w.customer}-${new Date().toISOString().slice(0, 10)}.csv`,
    ['Thời điểm', 'Loại', 'Diễn giải', 'Mã đơn', 'Mã tham chiếu', 'Số tiền (đ)', 'Số dư (đ)', 'Chờ đối soát'],
    rows.map((l) => [when.full(l.at), KIND[l.kind] || l.kind, l.text, l.order || '', l.ref || '', l.amount, l.run, l.pending ? 'Có' : '']));
  toast(`Đã xuất ${rows.length} dòng sao kê ra file CSV`);
}

function statementHtml(w) {
  if (!w.lines.length) return '<p class="empty">Chưa có giao dịch nào.</p>';
  const rows = statementRows(w);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  page = Math.min(Math.max(1, page), pages);
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const sumIn = rows.reduce((a, l) => a + Math.max(0, l.amount), 0), sumOut = rows.reduce((a, l) => a + Math.min(0, l.amount), 0);
  return `<div class="block"><div class="split"><h2>Sao kê</h2><button class="btn small ghost" id="w-csv" ${rows.length ? '' : 'disabled'}>Xuất CSV</button></div>
    <div class="list-tools w-tools">
      <div class="chips filter-chips">${FILTERS.map(([v, l]) => `<button type="button" class="chip ${flt === v ? 'on' : ''}" data-flt="${v}">${l}</button>`).join('')}</div>
      <label class="w-date"><span>Từ</span><input type="date" id="w-from" value="${from}" max="${to || ''}"></label>
      <label class="w-date"><span>Đến</span><input type="date" id="w-to" value="${to}" min="${from || ''}"></label>
      ${from || to || flt !== 'all' ? '<button type="button" class="link" id="w-clear">Bỏ lọc</button>' : ''}
    </div>
    ${rows.length ? `<p class="muted small" style="margin:0 0 8px">${rows.length} dòng · vào ${money(sumIn)} · ra ${money(-sumOut)}</p>` : ''}
    ${shown.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Ngày</th><th>Loại</th><th>Diễn giải</th><th class="num">Số tiền</th><th class="num">Số dư</th></tr></thead><tbody>
    ${shown.map((l) => `<tr class="${l.pending ? 'muted-row' : ''}"><td><small>${when.full(l.at)}</small></td><td><span class="chip ${l.amount > 0 ? 'ok' : ''}">${KIND[l.kind] || escapeHtml(l.kind)}</span></td>
      <td>${escapeHtml(l.text)}${l.ref ? ` <small class="muted">· mã ${escapeHtml(l.ref)}</small>` : ''}</td><td class="num">${signed(l.amount)}</td><td class="num">${money(l.run)}</td></tr>`).join('')}
  </tbody></table></div>${pager({ page, pages, total: rows.length })}` : '<p class="empty">Không có dòng nào khớp bộ lọc.</p>'}</div>`;
}

function customerView() {
  const w = wallet;
  const note = w.balance < 0
    ? `<div class="notice warn">Bạn đang nợ <b>${money(-w.balance)}</b> (cước / phí lớn hơn tiền thu hộ). Hãy chuyển khoản hoặc nộp tiền mặt tại kho, kế toán sẽ ghi nhận.${w.debtLimit > 0 ? (-w.balance > w.debtLimit ? ` <b>Đã vượt hạn mức nợ ${money(w.debtLimit)} nên tạm thời chưa đặt được đơn mới.</b>` : ` Nợ quá ${money(w.debtLimit)} sẽ tạm khoá đặt đơn mới.`) : ''}</div>`
    : w.available > 0 ? `<div class="notice">Bạn có <b>${money(w.available)}</b> có thể rút. Kế toán chi trả theo lịch; liên hệ quản trị viên nếu cần rút sớm.</div>` : '';
  return `${summaryTiles(w)}${note}${statementHtml(w)}`;
}

function staffView() {
  const admin = role() === 'admin';
  const qq = fold(q);
  const rows = list.customers.filter((r) => (!qq || fold(r.name).includes(qq) || r.customer.includes(qq))
    && (!only || (only === 'owed' && r.available > 0) || (only === 'debt' && r.balance < 0) || (only === 'pending' && r.pending > 0)));
  return `<div class="tiles">
      <div class="tile"><b>${money(list.owed)}</b><span>phải trả khách (đã đối soát)</span></div>
      <div class="tile"><b>${money(list.pending)}</b><span>thu hộ chờ đối soát</span></div>
      <div class="tile"><b>${money(list.debt)}</b><span>khách đang nợ</span></div>
    </div>
    <div class="block"><h2>Theo khách hàng</h2>
      <div class="list-tools"><label class="search-box"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20 20"/></svg><input type="search" id="w-q" placeholder="Tìm tên hoặc tên đăng nhập (gõ không dấu được)" value="${escapeHtml(q)}" aria-label="Tìm khách hàng"></label>
        <label class="sort-box"><span class="sr-only">Lọc</span><select id="w-only">${ONLY.map(([v, l]) => `<option value="${v}" ${only === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      ${rows.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Khách hàng</th><th class="num">Số dư</th><th class="num">Có thể rút</th><th class="num">Chờ đối soát</th><th class="num">Bồi thường</th><th class="num">Đã chi trả</th></tr></thead><tbody>
      ${rows.map((r) => `<tr class="clickable ${pick === r.customer ? 'active' : ''}" data-pick="${escapeHtml(r.customer)}"><td><b>${escapeHtml(r.name)}</b> <small class="muted">@${escapeHtml(r.customer)}</small></td>
        <td class="num">${signed(r.balance)}</td><td class="num">${money(Math.max(0, r.available))}</td><td class="num">${money(r.pending)}</td><td class="num">${money(r.comps)}</td><td class="num">${money(r.paidOut)}</td></tr>`).join('')}
    </tbody></table></div>` : `<p class="empty">${list.customers.length ? 'Không có khách nào khớp.' : 'Chưa khách hàng nào phát sinh giao dịch.'}</p>`}</div>
    ${wallet ? `<div class="page-head sub"><h2>${escapeHtml(wallet.name)} <small class="muted">@${escapeHtml(wallet.customer)}</small></h2>
        <div class="actions">${admin && wallet.available > 0 ? '<button class="btn small primary" data-pay="payout">Chi trả cho khách</button>' : ''}${admin && wallet.balance < 0 ? '<button class="btn small" data-pay="collect">Ghi nhận khách nộp bù</button>' : ''}</div></div>
      ${!admin ? '<p class="muted small">Chỉ quản trị viên được chi trả tiền cho khách.</p>' : ''}
      ${summaryTiles(wallet)}${statementHtml(wallet)}` : '<p class="muted">Chọn một khách hàng để xem sao kê.</p>'}`;
}

function render() { preserveFocus(root, draw); }
function draw() {
  const staff = role() !== 'customer';
  root.innerHTML = `<div class="page-head"><h1>${staff ? 'Ví đối soát khách hàng' : 'Ví đối soát'}</h1></div>
    ${staff ? (list ? staffView() : '<p class="empty">Đang tải…</p>') : wallet ? customerView() : '<p class="empty">Đang tải…</p>'}`;
  for (const tr of root.querySelectorAll('[data-pick]')) tr.addEventListener('click', () => { pick = tr.dataset.pick; page = 1; guard(load); });
  $('#w-q', root)?.addEventListener('input', (e) => { q = e.target.value.trim(); render(); });
  $('#w-only', root)?.addEventListener('change', (e) => { only = e.target.value; render(); });
  for (const b of root.querySelectorAll('[data-flt]')) b.addEventListener('click', () => { flt = b.dataset.flt; page = 1; render(); });
  $('#w-from', root)?.addEventListener('change', (e) => { from = e.target.value; page = 1; render(); });
  $('#w-to', root)?.addEventListener('change', (e) => { to = e.target.value; page = 1; render(); });
  $('#w-clear', root)?.addEventListener('click', () => { flt = 'all'; from = to = ''; page = 1; render(); });
  $('#w-csv', root)?.addEventListener('click', () => exportStatement(wallet));
  bindPager(root, (p) => { page = p; render(); });
  for (const b of root.querySelectorAll('[data-pay]')) b.addEventListener('click', () => payDialog(b.dataset.pay));
}

function payDialog(kind) {
  const w = wallet;
  const max = kind === 'payout' ? w.available : -w.balance;
  showModal(kind === 'payout' ? `Chi trả cho ${w.name}` : `${w.name} nộp bù`, `<form id="w-pay" novalidate>
    <p class="muted" style="margin:-4px 0 12px">${kind === 'payout' ? `Tối đa <b>${money(max)}</b> (phần thu hộ đã đối soát, trừ cước &amp; phí).` : `Khách đang nợ <b>${money(max)}</b>.`}</p>
    <label class="field"><span>Số tiền (đ)</span><input name="amount" type="number" min="1000" step="1000" max="${max}" value="${max}" inputmode="numeric"></label>
    <label class="field"><span>Hình thức</span><select name="method"><option value="bank">Chuyển khoản</option><option value="cash">Tiền mặt</option></select></label>
    <label class="field"><span>Mã giao dịch ngân hàng</span><input name="ref" maxlength="40" placeholder="vd: FT2410271234"></label>
    <label class="field"><span>Ghi chú</span><input name="note" maxlength="200"></label>
    <div class="actions"><button class="btn primary">${kind === 'payout' ? 'Xác nhận đã chi trả' : 'Xác nhận đã nhận tiền'}</button></div></form>`);
  const f = $('#w-pay');
  const sync = () => { f.ref.closest('.field').hidden = f.method.value !== 'bank'; };
  f.method.addEventListener('change', sync);
  sync();
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    guardForm(f, async () => {
      const res = await api.post('wallet/payout', { customer: w.customer, kind, amount: f.amount.value, method: f.method.value, ref: f.method.value === 'bank' ? f.ref.value.trim() : '', note: f.note.value.trim() });
      $('#modal').close();
      toast(res.message);
      await load();
    }, f.querySelector('button'));
  });
}

export default {
  id: 'wallet',
  title: 'Ví đối soát',
  wide: true,
  mount(panel, c) {
    ctx = c;
    root = document.createElement('div');
    panel.append(root);
    list = wallet = null;
    page = 1;
    if (ctx.intent && ctx.intent.customer) pick = ctx.intent.customer;
    render();
    guard(load);
  },
  unmount() { root = null; },
  onState() { if (root) guard(load); },
};
