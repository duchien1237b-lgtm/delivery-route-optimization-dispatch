// Trang Thống kê: báo cáo theo vai trò từ /api/reports/summary (server tự lọc dữ liệu theo người xem).
// Khách hàng: hạng thành viên, chi tiêu, tiết kiệm. Shipper: đơn đã giao, đúng hạn, đánh giá, thu nhập, tiền thu hộ.
// Điều phối viên: hàng chờ, đội shipper (điểm tin cậy), bảng cảnh báo cần xử lý. Quản trị viên: thêm doanh thu 14 ngày, giảm giá,
// phí huỷ / hoàn, bảo hiểm, tài khoản, mã giảm giá. Khách hàng thấy thêm số dư ví đối soát.
import { api } from '../api.js';
import { escapeHtml } from '../store.js';
import { fmt, money, guard, ROLE_LABEL, when } from '../ui.js';

let ctx, root, rep = null;
const COLORS = { 'Đã giao': 'var(--go)', 'Đang giao': 'var(--road)', 'Đã phân công': 'var(--s3)', 'Chờ giao': 'var(--signal)', 'Mới': 'var(--violet)', 'Thất bại': 'var(--stop)', 'Hoàn kho': 'var(--jam)', 'Đã huỷ': 'var(--surface-3)' };

function bars(by) {
  const rows = Object.entries(by);
  const max = Math.max(1, ...rows.map(([, n]) => n));
  if (!rows.length) return '<p class="empty">Chưa có đơn nào.</p>';
  return `<ul class="hbars">${rows.sort((a, b) => b[1] - a[1]).map(([k, n]) => `<li><span>${escapeHtml(k)}</span><div class="hbar"><i style="width:${(100 * n) / max}%;background:${COLORS[k] || 'var(--muted)'}"></i></div><b>${n}</b></li>`).join('')}</ul>`;
}
const tile = (v, label) => `<div class="tile"><b>${v}</b><span>${label}</span></div>`;

// Bảng cảnh báo: mỗi dòng là một việc cần xử lý, bấm để mở trang tương ứng
function alertsHtml(list) {
  if (!list || !list.length) return '<div class="block"><h2>Cần xử lý</h2><p class="muted">Không có cảnh báo nào. Mọi thứ đang ổn.</p></div>';
  return `<div class="block"><h2>Cần xử lý</h2><ul class="alerts">${list.map((a) => `<li class="al-${a.level}"><a href="#${escapeHtml(a.view)}"><b>${a.count}</b><span>${escapeHtml(a.text)}${a.ids && a.ids.length ? ` <small class="muted">${a.ids.map((i) => '#' + i).join(', ')}${a.count > a.ids.length ? '…' : ''}</small>` : ''}</span><i aria-hidden="true">›</i></a></li>`).join('')}</ul></div>`;
}
function dailyHtml(days) {
  if (!days || !days.length) return '';
  const max = Math.max(1, ...days.map((d) => d.revenue));
  const total = days.reduce((a, d) => a + d.revenue, 0), n = days.reduce((a, d) => a + d.delivered, 0);
  return `<div class="block"><h2>Doanh thu 14 ngày</h2><p class="muted small" style="margin-top:-6px">${n} đơn giao xong · ${money(total)} cước</p>
    <div class="daybars" role="img" aria-label="Doanh thu theo ngày">${days.map((d) => `<div title="${when.date(d.day)} · ${d.delivered} đơn · ${money(d.revenue)}"><i style="height:${Math.round((100 * d.revenue) / max)}%"></i><span>${new Date(d.day * 1000).getDate()}</span></div>`).join('')}</div></div>`;
}

function customerView(r) {
  const t = r.tier;
  return `<div class="tier-card"><div><span>Hạng thành viên</span><b>${escapeHtml(t.name)}</b><small>giảm ${Math.round(t.pct * 100)}% cước · ${t.done} đơn đã giao</small></div>
      ${t.next ? `<div class="tier-next"><small>Còn ${t.next.remaining} đơn để lên ${escapeHtml(t.next.name)}</small><div class="progress"><i style="width:${Math.round((t.done / (t.done + t.next.remaining)) * 100)}%"></i></div></div>` : ''}</div>
    <div class="tiles">${tile(r.orders, 'đơn đã đặt')}${tile(r.delivered, 'đơn đã giao')}${tile(money(r.spent), 'tổng cước đã trả')}${tile(money(r.saved), 'đã tiết kiệm nhờ ưu đãi')}</div>
    ${r.wallet ? `<div class="tiles">${tile(money(r.wallet.balance), 'số dư ví đối soát')}${tile(money(r.wallet.available), 'có thể rút')}${tile(money(r.wallet.pending), 'thu hộ chờ đối soát')}${tile(money(r.wallet.comps), 'đã được bồi thường')}</div>
    <div class="actions" style="margin:-4px 0 12px"><a class="btn small ghost" href="#wallet">Xem sao kê chi tiết</a></div>` : ''}
    <div class="block"><h2>Đơn theo trạng thái</h2>${bars(r.byStatus)}<p class="muted small">Tỉ lệ giao đúng hạn: <b>${fmt.num(r.onTimeRate, 0)}%</b></p></div>`;
}
function shipperView(r) {
  const s = r.stats;
  return `<div class="tiles">${tile(s.delivered, 'đơn đã giao (tích luỹ)')}${tile(`${fmt.num(s.onTimeRate, 0)}%`, 'đúng hạn')}${tile(s.rating != null ? `${fmt.num(s.rating, 1)}★` : '–', `${s.ratings} lượt đánh giá`)}${tile(money(s.income), 'thu nhập ước tính')}</div>
    <div class="tiles">${tile(`${fmt.num(s.score, 0)}/100`, 'điểm tin cậy')}${tile(s.accepted, 'chuyến đã nhận')}${tile(s.declines, 'lần từ chối')}${tile(money(s.codHeld), 'thu hộ đang giữ')}</div>
    <div class="block"><h2>Đơn trong ca hiện tại</h2>${bars(r.byStatus)}</div>`;
}
function staffView(r) {
  const admin = r.role === 'admin';
  return `<div class="tiles">${tile(r.open, 'đơn đang mở')}${tile(r.delivered, 'đã giao')}${tile(`${fmt.num(r.onTimeRate, 0)}%`, 'đúng hạn')}${tile(r.complaintsOpen, 'khiếu nại đang mở')}</div>
    <div class="tiles">${tile(money(r.codHeld), 'tiền shipper đang giữ (thu hộ + cước người nhận trả)')}${tile(money(r.codAwaiting), 'thu hộ chờ đối soát')}${admin ? tile(money(r.revenue), 'doanh thu cước (đã giao)') + tile(money(r.cancelFees + (r.returnFees || 0)), 'phí huỷ + phí hoàn') : ''}</div>
    ${admin && r.insurance ? `<p class="muted small" style="margin:-4px 0 12px">Trong doanh thu có <b>${money(r.insurance)}</b> phí bảo hiểm hàng hoá. Phí hoàn hàng: <b>${money(r.returnFees || 0)}</b>.</p>` : ''}
    <div class="report-grid">
      ${alertsHtml(r.alerts)}
      ${admin ? dailyHtml(r.daily) : ''}
      <div class="block"><h2>Đơn theo trạng thái</h2>${bars(r.byStatus)}</div>
      <div class="block"><h2>Đội shipper</h2><div class="table-wrap"><table class="data"><thead><tr><th>Shipper</th><th class="num">Đã giao</th><th class="num">Thất bại</th><th class="num">Từ chối</th><th class="num">Điểm</th>${admin ? '<th class="num">Thu nhập</th>' : ''}</tr></thead><tbody>
        ${r.shippers.map((s) => `<tr><td>${escapeHtml(s.name)}${s.ready ? '' : ' <span class="chip muted">tạm nghỉ</span>'}</td><td class="num">${s.delivered}</td><td class="num">${s.failed}</td><td class="num">${s.declines}</td><td class="num"><b>${fmt.num(s.score, 0)}</b></td>${admin ? `<td class="num">${money(s.income)}</td>` : ''}</tr>`).join('')}
      </tbody></table></div></div>
      ${admin ? `<div class="block"><h2>Khách hàng chi nhiều nhất</h2>${r.topCustomers.length ? `<ol class="rank">${r.topCustomers.map((c) => `<li><span>${escapeHtml(c.name)}</span><b>${money(c.spent)}</b></li>`).join('')}</ol>` : '<p class="empty">Chưa có.</p>'}
        <p class="muted small">Tổng giảm giá đã áp dụng: <b>${money(r.discounts)}</b> · tổng thu hộ đã giao: <b>${money(r.codTotal)}</b></p></div>
      <div class="block"><h2>Tài khoản &amp; mã giảm giá</h2>
        <p>${Object.entries(r.users.byRole).map(([k, n]) => `<span class="chip">${ROLE_LABEL[k] || k}: ${n}</span>`).join(' ')}</p>
        <p>${Object.entries(r.users.byStatus).map(([k, n]) => `<span class="chip">${{ active: 'Hoạt động', pending: 'Chờ duyệt', locked: 'Bị khoá', disabled: 'Vô hiệu hoá' }[k] || k}: ${n}</span>`).join(' ')}</p>
        <table class="data"><tbody>${r.promos.map((p) => `<tr><td>${escapeHtml(p.code)}</td><td class="num">${p.used}${p.maxUses ? ` / ${p.maxUses}` : ''} lượt</td></tr>`).join('')}</tbody></table></div>` : ''}
    </div>`;
}

function render() {
  root.innerHTML = `<div class="page-head"><h1>Thống kê</h1>${rep && rep.role === 'admin' ? '<a class="btn small ghost" href="#reports">Báo cáo vận hành chi tiết</a>' : ''}</div>
    ${!rep ? '<p class="empty">Đang tải…</p>' : rep.role === 'customer' ? customerView(rep) : rep.role === 'shipper' ? shipperView(rep) : staffView(rep)}`;
}

export default {
  id: 'summary',
  title: 'Thống kê',
  wide: true,
  mount(panel, c) {
    ctx = c;
    root = document.createElement('div');
    panel.append(root);
    rep = null;
    render();
    guard(async () => { rep = await api.get('reports/summary'); if (root) render(); });
  },
  unmount() { root = null; },
  onState() {},
};
