// Trang Báo cáo: tài chính ca, đối soát COD, lý do thất bại, theo shipper, lịch sử điều phối, xuất CSV.
import { escapeHtml } from '../store.js';
import { $, fmt, segmented, bindSegmented, toast, statusChip, hhmm, getShiftStart, STATUS, ROUTE_COLORS, avatar, downloadCsv } from '../ui.js';
import { printTrips } from '../print.js';

let ctx, root;
let filter = 'all';
let rtab = 'shipper', moreCols = false;   // mục chi tiết đang xem; có hiện thêm cột trong bảng đơn không

// Nhóm trạng thái dùng cho biểu đồ (màu trạng thái luôn đi kèm nhãn chữ)
const GROUPS = [
  { key: 'ontime', label: 'Đúng hạn', color: 'var(--go)', test: (o) => o.status === 2 && !o.late },
  { key: 'late', label: 'Trễ', color: 'var(--jam)', test: (o) => o.status === 2 && o.late },
  { key: 'live', label: 'Đang giao', color: 'var(--road)', test: (o) => o.status === 1 },
  { key: 'failed', label: 'Thất bại', color: 'var(--stop)', test: (o) => o.status === 3 },
  { key: 'pending', label: 'Chờ giao', color: 'var(--line)', test: (o) => o.status === 0 },
  { key: 'returned', label: 'Hoàn kho', color: 'var(--violet)', test: (o) => o.status === 5 },
  { key: 'cancelled', label: 'Khách huỷ', color: 'var(--surface-3)', test: (o) => o.status === 4 },
];

function exportCsv() {
  const st = ctx.store.state;
  const head = ['Mã đơn', 'Người nhận', 'Số điện thoại', 'Điểm giao', 'Khối lượng (kg)', 'Gấp', 'Hạn giao', 'Trạng thái', 'Lý do thất bại', 'Shipper', 'Giờ dự kiến', 'Giờ giao', 'Trễ hạn', 'Thu hộ COD (đ)', 'Cước (đ)', 'Khai giá (đ)', 'Bảo hiểm (đ)', 'Tổng phải trả (đ)', 'Người trả cước', 'Phải thu khi giao (đ)', 'Phí hoàn (đ)', 'Số lần giao', 'Ghi chú'];
  const rows = st.orders.map((o) => [o.id, o.recipient || '', o.phone ? `'${o.phone}` : '', o.destinationName, o.weight, o.urgent ? 'Có' : '', o.deadline >= 0 ? fmt.clock(o.deadline) : '', o.statusName, o.failReasonName || '', o.carrier || '', o.eta != null ? fmt.clock(o.eta) : '', o.deliveredAt != null ? fmt.clock(o.deliveredAt) : '', o.late ? 'Có' : '', o.cod || 0, o.fee ? o.fee.total : '', o.value || 0, o.insurance || 0, o.total ?? '', o.receiverPays ? 'Người nhận' : 'Người gửi', o.collect ?? (o.cod || 0), o.returnFee || 0, o.attempts || 0, o.note]);
  downloadCsv(`bao-cao-don-hang-${new Date().toISOString().slice(0, 10)}.csv`, head, rows);
  toast(`Đã xuất ${rows.length} đơn ra file CSV`);
}

function financeBlock(st) {
  const f = st.finance;
  if (!f) return '';
  const t = f.tariff;
  const expProfit = f.expectedRevenue - f.cost;
  const running = st.shift.active && f.expectedRevenue > f.revenue;
  return `<div class="block span-2">
    <div class="split"><h2>Tài chính ca</h2></div>
    <div class="money">
      <div class="pos"><b>${fmt.vnd(f.revenue)}</b><span>doanh thu cước đã ghi nhận (${f.delivered} giao, ${f.returned} hoàn)</span></div>
      <div><b>${fmt.vnd(f.cost)}</b><span>chi phí vận hành các chuyến</span></div>
      <div class="${(running ? expProfit : f.profit) >= 0 ? 'pos' : 'neg'}"><b>${fmt.vnd(running ? expProfit : f.profit)}</b><span>${running ? `lợi nhuận dự kiến cuối ca (doanh thu dự kiến ${fmt.vnd(f.expectedRevenue)}; hiện tại ${fmt.vnd(f.profit)})` : `lợi nhuận${f.revenue > 0 ? ` (biên ${Math.round((f.profit / f.revenue) * 100)}%)` : ''}`}</span></div>
      <div><b>${fmt.vnd(f.codCollected)}</b><span>COD đã thu, shipper phải nộp</span></div>
      <div><b>${fmt.vnd(f.codOnRoute)}</b><span>COD đang trên xe</span></div>
      <div><b>${fmt.vnd(f.codPending)}</b><span>COD chưa giao / chờ giao lại</span></div>
    </div>
    <details class="sub-note"><summary>Biểu phí đang áp dụng</summary><p class="muted small">Cước: ${fmt.vnd(t.firstFee)} cho ${t.firstKm} km đầu, +${fmt.vnd(t.perKm)}/km, +${fmt.vnd(t.perKg)}/kg vượt ${t.freeKg} kg, gấp +${Math.round(t.urgent * 100)}%, thu hộ ${(t.codRate * 100).toLocaleString('vi-VN')}% (tối thiểu ${fmt.vnd(t.codMin)}), hoàn kho thu ${Math.round(t.returnRate * 100)}%</p></details>
  </div>`;
}

const RTABS = [['shipper', 'Theo shipper'], ['cod', 'Đối soát COD'], ['fail', 'Lý do thất bại'], ['history', 'Lịch sử điều phối']];

function settleTable(st) {
  const f = st.finance;
  const rows = (f?.shippers || []).filter((s) => s.delivered + s.failed + s.returned + s.onRoute > 0 || s.km > 0);
  if (!rows.length) return '<p class="empty">Chưa có chuyến nào để đối soát.</p>';
  const sum = (k) => rows.reduce((a, s) => a + s[k], 0);
  return `<div class="table-wrap"><table class="data settle"><thead><tr><th>Shipper</th><th class="num">Giao / hoàn / lỗi</th><th class="num">Phải nộp</th><th class="num">Đang giữ</th><th class="num">Lãi gộp</th></tr></thead><tbody>
    ${rows.map((s) => `<tr><td>${escapeHtml(s.name)}<br><small>${fmt.km(s.km)}, cước ${fmt.vnd(s.revenue)}</small></td>
      <td class="num">${s.delivered} / ${s.returned} / ${s.failed}</td><td class="num"><b>${fmt.vnd(s.codCollected)}</b></td>
      <td class="num">${s.codOnRoute ? fmt.vnd(s.codOnRoute) : '–'}</td><td class="num">${fmt.vnd(s.revenue - s.cost)}</td></tr>`).join('')}
    <tr class="total"><td><b>Tổng</b></td><td class="num">${sum('delivered')} / ${sum('returned')} / ${sum('failed')}</td><td class="num"><b>${fmt.vnd(sum('codCollected'))}</b></td><td class="num">${fmt.vnd(sum('codOnRoute'))}</td><td class="num">${fmt.vnd(sum('revenue') - sum('cost'))}</td></tr>
  </tbody></table></div>`;
}

function reasonTable(st) {
  const reasons = st.shift.failReasons || [];
  const hit = st.orders.filter((o) => o.failReason != null && o.failReason >= 0 && (o.status === 3 || o.status === 5 || o.status === 0 || o.status === 1));
  if (!hit.length) return '<p class="empty">Chưa có đơn giao thất bại.</p>';
  const max = Math.max(1, ...reasons.map((r) => hit.filter((o) => o.failReason === r.id).length));
  return `<table class="data"><tbody>${reasons.map((r) => {
    const os = hit.filter((o) => o.failReason === r.id);
    if (!os.length) return '';
    return `<tr><td>${escapeHtml(r.name)}${r.returns ? ' <span class="chip warn">hoàn kho</span>' : ''}<br><small>Đơn ${os.map((o) => o.id).join(', ')}</small></td>
      <td style="min-width:120px"><div class="hbar"><i style="width:${(os.length / max) * 100}%;background:var(--stop)"></i></div></td><td class="num"><b>${os.length}</b></td></tr>`;
  }).join('')}</tbody></table>`;
}

function render() {
  const st = ctx.store.state;
  const orders = st.orders;
  const total = orders.length;
  const counts = GROUPS.map((g) => ({ ...g, n: orders.filter(g.test).length }));
  const delivered = counts[0].n + counts[1].n;
  const onTimeRate = delivered ? Math.round((counts[0].n / delivered) * 100) : null;
  const trips = st.shift.trips;
  const history = st.shift.history;

  // Theo shipper (gộp các chuyến cùng tên)
  const byShipper = new Map();
  trips.forEach((tr, i) => {
    const key = tr.name;
    const s = byShipper.get(key) || { name: tr.name, vehicle: tr.vehicleName, color: ROUTE_COLORS[(tr.shipper >= 0 ? tr.shipper : i) % ROUTE_COLORS.length], trips: 0, km: 0, cost: 0, stops: 0, done: 0, late: 0, failed: 0 };
    s.trips++; s.km += tr.km; s.cost += tr.cost; s.stops += tr.stops.length;
    for (const stop of tr.stops) {
      const o = orders.find((x) => x.id === stop.order);
      if (!o) continue;
      if (o.status === 2) { s.done++; if (o.late) s.late++; }
      if (o.status === 3 || o.status === 5) s.failed++;
    }
    byShipper.set(key, s);
  });
  const shippers = [...byShipper.values()];
  const maxKm = Math.max(1, ...shippers.map((s) => s.km));
  const totalKm = shippers.reduce((a, s) => a + s.km, 0);
  const totalCost = shippers.reduce((a, s) => a + s.cost, 0);

  const shown = orders.filter((o) => filter === 'all' || String(o.status) === filter);
  const filters = [{ v: 'all', label: `Tất cả ${total}` }, ...STATUS.map((s, i) => ({ v: String(i), label: `${s.label} ${orders.filter((o) => o.status === i).length}` }))];

  const tabBody = rtab === 'cod' ? settleTable(st) : rtab === 'fail' ? reasonTable(st) : rtab === 'history' ? (history.length ? `<table class="data"><thead><tr><th>Lúc</th><th>Phương án</th><th class="num">Đơn</th><th class="num">Km</th><th class="num">Dự kiến trễ</th></tr></thead><tbody>
          ${history.slice().reverse().map((h) => `<tr><td>${escapeHtml(h.when)}</td><td>${escapeHtml(h.plan)}<br><small>${h.shippers} shipper, ${fmt.vnd(h.cost)}</small></td><td class="num">${h.orders}</td><td class="num">${fmt.num(h.km)}</td><td class="num">${h.predictedLate}</td></tr>`).join('')}
        </tbody></table>` : '<p class="empty">Chưa áp dụng phương án nào.</p>') : (shippers.length ? `<table class="data"><thead><tr><th>Shipper</th><th>Quãng đường</th><th class="num">Đã giao</th><th class="num">Trễ</th><th class="num">Chi phí</th></tr></thead><tbody>
          ${shippers.map((s) => `<tr><td><div class="who">${avatar(s.name, s.color, s.vehicle, 'sm')}<span>${escapeHtml(s.name)}<br><small>${escapeHtml(s.vehicle)}, ${s.trips} chuyến</small></span></div></td>
            <td style="min-width:140px"><div class="hbar" title="${fmt.km(s.km)}"><i style="width:${(s.km / maxKm) * 100}%;background:${s.color}"></i></div><small>${fmt.km(s.km)}</small></td>
            <td class="num">${s.done}/${s.stops}</td><td class="num">${s.late}</td><td class="num">${fmt.vnd(s.cost)}</td></tr>`).join('')}
        </tbody></table>` : '<p class="empty">Chưa có chuyến nào.</p>');

  root.innerHTML = `<div class="page-head"><h1>Báo cáo ca ${hhmm(getShiftStart())}</h1>${trips.length ? '<button class="btn small ghost" id="r-print">In phiếu giao</button>' : ''}</div>
    <div class="report-grid">
      <div class="block span-2">
        <div class="tiles">
          <div class="tile"><b>${delivered}/${total}</b><span>đơn đã giao</span></div>
          <div class="tile"><b>${onTimeRate == null ? '–' : onTimeRate + '%'}</b><span>đúng hạn</span></div>
          <div class="tile"><b>${fmt.km(totalKm)}</b><span>quãng đường</span></div>
          <div class="tile"><b>${fmt.vnd(totalCost)}</b><span>chi phí</span></div>
        </div>
        ${total ? `<div class="stack" role="img" aria-label="Phân bố trạng thái đơn hàng" style="margin-top:14px">${counts.filter((c) => c.n).map((c) => `<div style="flex:${c.n};background:${c.color}" title="${c.label}: ${c.n} đơn (${Math.round((c.n / total) * 100)}%)"></div>`).join('')}</div>
        <div class="stack-legend">${counts.map((c) => `<span><i style="background:${c.color}"></i>${c.label} <b>${c.n}</b></span>`).join('')}</div>` : '<p class="empty">Chưa có đơn hàng.</p>'}
      </div>

      ${financeBlock(st)}
      <div class="block span-2">
        <div class="tabs" role="tablist">${RTABS.map(([k, l]) => `<button type="button" role="tab" data-rtab="${k}" aria-selected="${k === rtab}">${l}</button>`).join('')}</div>
        ${tabBody}
      </div>

      <div class="block span-2">
        <div class="split"><h2>Đơn hàng</h2><span class="split-acts"><button type="button" class="btn small ghost" id="r-cols" aria-pressed="${moreCols}">${moreCols ? 'Ẩn bớt cột' : 'Hiện thêm cột'}</button> <button class="btn small" id="r-csv" ${total ? '' : 'disabled'}>Xuất CSV</button></span></div>
        <div class="filter-row">${segmented('rfilter', filters, filter)}</div>
        ${shown.length ? `<div class="table-wrap"><table class="data ${moreCols ? 'show-x' : 'hide-x'}"><thead><tr><th>Mã</th><th>Điểm giao</th><th>Người nhận</th><th class="num">Kg</th><th class="num">COD</th><th class="num">Cước</th><th class="num">Hạn</th><th>Trạng thái</th><th class="xcol">Shipper</th><th class="num xcol">Dự kiến</th><th class="num xcol">Giao lúc</th></tr></thead><tbody>
          ${shown.map((o) => `<tr><td>${o.id}</td><td>${escapeHtml(o.destinationName)}${o.urgent ? ' <span class="chip urgent">Gấp</span>' : ''}</td><td>${escapeHtml(o.recipient || '–')}${o.phone ? `<br><small>${escapeHtml(o.phone)}</small>` : ''}</td><td class="num">${fmt.num(o.weight)} kg</td><td class="num">${o.cod ? fmt.vnd(o.cod) : '–'}</td><td class="num">${o.fee ? fmt.vnd(o.fee.total) : '–'}</td><td class="num">${o.deadline >= 0 ? fmt.clock(o.deadline) : '–'}</td><td>${statusChip(o)}${o.failReasonName && o.status !== 2 ? `<br><small>${escapeHtml(o.failReasonName)}</small>` : ''}</td><td class="xcol">${escapeHtml(o.carrier || '–')}</td><td class="num xcol">${o.eta != null ? fmt.clock(o.eta) : '–'}</td><td class="num xcol">${o.deliveredAt != null ? fmt.clock(o.deliveredAt) : '–'}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="empty">Không có đơn nào.</p>'}
      </div>
    </div>`;
  bindSegmented(root.querySelector('.filter-row'), (n, v) => { filter = v; render(); });
  $('#r-csv', root).addEventListener('click', exportCsv);
  $('#r-cols', root).addEventListener('click', () => { moreCols = !moreCols; render(); });
  for (const b of root.querySelectorAll('[data-rtab]')) b.addEventListener('click', () => { rtab = b.dataset.rtab; render(); });
  $('#r-print', root)?.addEventListener('click', () => printTrips(trips, st));
}

export default {
  id: 'reports',
  title: 'Báo cáo',
  wide: true,
  mount(panel, c) {
    ctx = c;
    root = document.createElement('div');
    panel.append(root);
    render();
  },
  unmount() { root = null; },
  onState() { if (root) render(); },
};
