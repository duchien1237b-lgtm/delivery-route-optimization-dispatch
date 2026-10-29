// In phiếu giao hàng cho shipper (mỗi chuyến một trang A4).
import { escapeHtml } from './store.js';
import { fmt, hhmm, getShiftStart } from './ui.js';

export function printTrips(trips, state) {
  if (!trips.length) return false;
  const byId = new Map(state.orders.map((o) => [o.id, o]));
  const today = new Date().toLocaleDateString('vi-VN');
  const depot = state.graph.nodes.find((n) => n.id === state.depot);
  const sheets = trips.map((t) => {
    const rows = t.stops.map((s, i) => {
      const o = byId.get(s.order) || {};
      return `<tr><td>${i + 1}</td><td>${s.order}</td><td>${escapeHtml(s.name)}</td><td>${fmt.clock(s.eta)}</td><td>${o.deadline >= 0 ? fmt.clock(o.deadline) : ''}</td><td>${o.weight != null ? fmt.num(o.weight) + ' kg' : ''}</td><td>${o.urgent ? 'Gấp. ' : ''}${escapeHtml(o.note || '')}</td><td class="sign"></td></tr>`;
    }).join('');
    return `<section class="sheet">
      <h1>Phiếu giao hàng</h1>
      <div>Chuyến số ${t.id}, ngày ${today}</div>
      <div class="meta">
        <div>Shipper: <b>${escapeHtml(t.name)}</b></div><div>Phương tiện: ${escapeHtml(t.vehicleName)}</div>
        <div>Xuất phát: ${escapeHtml(depot ? depot.name : '')}, lúc ${fmt.clock(t.pathTimes[0])}</div><div>Dự kiến xong: ${fmt.clock(t.pathTimes[t.pathTimes.length - 1])}</div>
        <div>Quãng đường: ${fmt.km(t.km)}</div><div>Hàng: ${fmt.num(t.load)}${t.capacity ? ` / ${fmt.num(t.capacity)}` : ''} kg, ${t.stops.length} điểm</div>
      </div>
      <table><thead><tr><th>STT</th><th>Mã đơn</th><th>Điểm giao</th><th>Giờ dự kiến</th><th>Hạn</th><th>Khối lượng</th><th>Ghi chú</th><th>Ký nhận</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="foot"><span>Ca bắt đầu ${hhmm(getShiftStart())}.</span><span>Người điều phối ký: ................................</span></div>
    </section>`;
  }).join('');
  const area = document.getElementById('print-area');
  area.innerHTML = sheets;
  window.print();
  return true;
}
