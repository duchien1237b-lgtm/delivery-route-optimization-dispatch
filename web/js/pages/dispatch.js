// Trang Điều phối: quản lý đơn hàng, shipper, chạy và so sánh 8 phương án điều phối.
import { api } from '../api.js';
import { escapeHtml } from '../store.js';
import { $, fmt, guard, segmented, bindSegmented, toast, hhmm, timeToMinutes, getShiftStart, statusChip, STATUS, VEHICLES, ROUTE_COLORS, avatar, maxCapacity, askReason } from '../ui.js';

let ctx, root;
let tab = 'orders';
let group = 'multi';
let singleVeh = '0', back = true;
let report = null, stale = false, planKey = null;
let editOrder = null;   // id đơn đang sửa
let pickedDest = null;  // điểm giao chọn từ bản đồ cho form
let reportDataset = null;
let filter = 'all';     // lọc danh sách đơn theo trạng thái
let addOpen = false;    // biểu mẫu Thêm đơn đang mở (mặc định thu gọn cho đỡ rối)

const name = (id) => escapeHtml(ctx.store.name(id));

function setTab(t) {
  tab = t;
  root.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  ctx.map.setPicking(tab === 'orders');
  renderTabs();
  renderBody();
}

// Dòng tóm tắt thiết lập ca cạnh nút Điều phối (chi tiết nằm trong "Tuỳ chọn ca")
function sumLine() {
  const el = root && $('#d-sum', root);
  if (!el) return;
  const st = ctx.store.state;
  el.textContent = `${ctx.store.name(st.depot)} · ${hhmm(getShiftStart())} · ${(VEHICLES[Number(singleVeh)] || {}).label || ''}`;
}

function renderTabs() {
  const st = ctx.store.state;
  root.querySelector('[data-tab="orders"]').innerHTML = `Đơn hàng<span class="count">${st.orders.length}</span>`;
  root.querySelector('[data-tab="shippers"]').innerHTML = `Shipper<span class="count">${st.shippers.length}</span>`;
}

function renderBody() {
  const box = $('#d-body', root);
  if (!box) return;
  if (tab === 'orders') renderOrders(box);
  else if (tab === 'shippers') renderShippers(box);
  else renderResults(box);
  drawMap();
}

// ------------------------------------------------------------------ Đơn hàng
function orderForm(o) {
  const dest = pickedDest ?? (o ? o.destination : null);
  return `<details id="d-oacc" class="acc" ${o || addOpen || pickedDest != null ? 'open' : ''}><summary><span class="acc-t">${o ? `Sửa đơn ${o.id}` : 'Thêm đơn'}</span><span class="acc-meta">${o ? 'đang chỉnh sửa' : 'nhập tay hoặc bấm điểm trên bản đồ'}</span><svg class="acc-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></summary><div class="acc-body"><form id="d-oform">
    <label class="field"><span>Điểm giao (hoặc bấm trên bản đồ)</span><select name="destination" required>${ctx.store.nodeOptions(dest, { includeEmpty: true, emptyLabel: 'Chọn điểm giao' })}</select></label>
    <div class="row">
      <label class="field"><span>Khối lượng (kg)</span><input type="number" name="weight" step="0.1" min="0.1" value="${o ? o.weight : 2}" required></label>
      <label class="field"><span>Hạn giao</span><input type="time" name="deadline" value="${o && o.deadline >= 0 ? hhmm(getShiftStart() + o.deadline) : ''}"></label>
    </div>
    <div class="row">
      <label class="field"><span>Người nhận</span><input type="text" name="recipient" maxlength="60" value="${o ? escapeHtml(o.recipient || '') : ''}" placeholder="Chị Lan"></label>
      <label class="field"><span>Số điện thoại</span><input type="tel" name="phone" inputmode="numeric" pattern="0[0-9]{9}" maxlength="10" value="${o ? escapeHtml(o.phone || '') : ''}" placeholder="0909123456"></label>
    </div>
    <div class="row">
      <label class="field"><span>Thu hộ COD (đ)</span><input type="number" name="cod" min="0" max="50000000" step="1000" value="${o ? o.cod || 0 : 0}"></label>
      <div class="field"><span>Cước giao (khách trả)</span><output class="fee-out" id="d-fee">${o && o.fee ? fmt.vnd(o.fee.total) : '–'}</output></div>
    </div>
    <label class="field"><span>Khách hàng đặt đơn</span><select name="owner"><option value="">Đơn do quản trị viên tạo</option>${(ctx.store.state.customers || []).map((c) => `<option value="${escapeHtml(c.username)}" ${o && o.owner === c.username ? 'selected' : ''}>${escapeHtml(c.displayName)} (@${escapeHtml(c.username)})</option>`).join('')}</select></label>
    <label class="field"><span>Ghi chú</span><input type="text" name="note" maxlength="80" value="${o ? escapeHtml(o.note) : ''}" placeholder="Gọi trước khi giao"></label>
    <label class="check" style="margin-bottom:12px"><input type="checkbox" name="urgent" ${o && o.urgent ? 'checked' : ''}> Đơn gấp</label>
    <div class="actions"><button class="btn primary">${o ? 'Lưu đơn' : 'Thêm đơn'}</button>${o ? `${o.cancelFeeNow !== undefined ? `<button type="button" class="btn" id="d-oabort" title="Huỷ đơn (giữ lại trong danh sách với trạng thái Đã huỷ)">Huỷ đơn${o.cancelFeeNow ? ` (phí ${Math.round(o.cancelFeeNow).toLocaleString('vi-VN')} đ)` : ''}</button>` : ''}<button type="button" class="btn danger admin-only" id="d-odel">Xoá đơn</button><button type="button" class="btn ghost" id="d-ocancel">Đóng</button>` : ''}</div>
  </form></div></details>`;
}

function renderOrders(box) {
  const st = ctx.store.state;
  const o = editOrder != null ? st.orders.find((x) => x.id === editOrder) : null;
  const shown = st.orders.filter((x) => filter === 'all' || String(x.status) === filter);
  const count = (s) => st.orders.filter((x) => x.status === s).length;
  const cap = maxCapacity(st);
  const heavy = (x) => x.status === 0 && cap > 0 && x.weight > cap + 1e-9;
  const rows = shown.map((x) => `<tr class="clickable ${x.id === editOrder ? 'active' : ''} ${x.status === 4 ? 'muted-row' : ''}" data-id="${x.id}">
      <td>${x.id}</td>
      <td>${escapeHtml(x.destinationName)}${x.urgent ? ' <span class="chip urgent">Gấp</span>' : ''}${x.note ? `<br><small class="muted">${escapeHtml(x.note)}</small>` : ''}${x.reachable ? '' : '<br><span class="chip late">Không tới được</span>'}${x.recipient || x.phone ? `<br><small class="muted">${escapeHtml(x.recipient || '')}${x.recipient && x.phone ? ' · ' : ''}${escapeHtml(x.phone || '')}</small>` : ''}${x.cod > 0 ? ` <span class="chip blue">COD ${fmt.vnd(x.cod)}</span>` : ''}${x.owner ? ` <span class="chip" title="Khách hàng đặt đơn">KH @${escapeHtml(x.owner)}</span>` : ''}${heavy(x) ? `<br><span class="chip late">Nặng hơn mọi xe</span> <button type="button" class="btn small" data-split="${x.id}">Chia kiện</button>` : ''}</td>
      <td class="num">${fmt.num(x.weight)} kg<br><small class="muted" title="Cước giao khách trả">${x.fee ? fmt.vnd(x.fee.total) : 'không giao được'}</small></td>
      <td class="num">${x.deadline >= 0 ? fmt.clock(x.deadline) : '–'}</td>
      <td>${statusChip(x)}${x.carrier ? `<br><small class="muted">${escapeHtml(x.carrier)}</small>` : ''}</td></tr>`).join('');
  const filters = [{ v: 'all', label: `Tất cả ${st.orders.length}` }, ...STATUS.map((s, i) => ({ v: String(i), label: `${s.label} ${count(i)}` }))];
  box.innerHTML = `${orderForm(o)}
    <div class="block"><div class="split"><h2>Danh sách đơn</h2><button class="btn small ghost admin-only" id="d-rand" type="button">Tạo ngẫu nhiên</button></div>
      <div class="filter-row">${segmented('ofilter', filters, filter)}</div>
      ${st.orders.length ? (shown.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Mã</th><th>Điểm giao</th><th class="num">Kg</th><th class="num">Hạn</th><th>Trạng thái</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">Không có đơn nào.</p>') : '<p class="empty">Chưa có đơn. Thêm ở trên hoặc nhập orders.txt từ menu Tệp.</p>'}
    </div>`;
  bindSegmented(box.querySelector('.filter-row'), (n, v) => { filter = v; renderBody(); });
  $('#d-oacc', box).addEventListener('toggle', (e) => { if (editOrder == null) addOpen = e.target.open; });
  const f = $('#d-oform', box);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    let deadline = -1;
    if (f.deadline.value) {
      deadline = timeToMinutes(f.deadline.value) - getShiftStart();
      if (deadline < 0) { toast(`Hạn giao phải sau giờ bắt đầu ca (${hhmm(getShiftStart())})`, 'error'); return; }
    }
    const params = {
      destination: f.destination.value, weight: f.weight.value,
      urgent: f.urgent.checked ? 1 : 0, deadline, note: f.note.value.trim(),
      recipient: f.recipient.value.trim(), phone: f.phone.value.trim(), cod: f.cod.value || 0, owner: f.owner.value,
    };
    guard(async () => {
      if (o) { await ctx.store.mutate('order/update', { id: o.id, ...params }); toast(`Đã lưu đơn ${o.id}`); }
      else { await ctx.store.mutate('order/add', params); toast('Đã thêm đơn hàng'); }
      editOrder = null; pickedDest = null;
      renderBody();
    }, e.submitter);
  });
  f.destination.addEventListener('change', () => { pickedDest = f.destination.value === '' ? null : Number(f.destination.value); drawMap(); });
  // Báo giá cước ngay khi nhập (theo biểu phí của backend)
  let quoteSeq = 0;
  const quote = async () => {
    const out = $('#d-fee', box);
    if (!out || f.destination.value === '' || !(Number(f.weight.value) > 0)) { if (out) out.textContent = '–'; return; }
    const seq = ++quoteSeq;
    try {
      const res = await api.get('quote', { destination: f.destination.value, weight: f.weight.value, urgent: f.urgent.checked ? 1 : 0, cod: f.cod.value || 0 });
      if (seq !== quoteSeq) return;
      const q = res.fee;
      out.textContent = q ? fmt.vnd(q.total) : 'Không có đường từ kho';
      out.title = q ? `${fmt.km(q.km)} theo đường ngắn nhất · cơ bản ${fmt.vnd(q.base)} + km ${fmt.vnd(q.distance)} + kg ${fmt.vnd(q.weight)}${q.urgent ? ` + hoả tốc ${fmt.vnd(q.urgent)}` : ''}${q.cod ? ` + thu hộ ${fmt.vnd(q.cod)}` : ''}` : '';
    } catch { if (seq === quoteSeq) out.textContent = '–'; }
  };
  for (const el of [f.destination, f.weight, f.urgent, f.cod]) el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', quote);
  quote();
  $('#d-odel', box)?.addEventListener('click', () => guard(async () => {
    await ctx.store.mutate('order/remove', { id: o.id });
    toast(`Đã xoá đơn ${o.id}`);
    editOrder = null; pickedDest = null; renderBody();
  }));
  $('#d-rand', box).addEventListener('click', (e) => {
    if (st.orders.length && !confirm(`Thay toàn bộ đơn hiện tại bằng 8 đơn ngẫu nhiên?${st.shift.active ? ' Ca giao đang chạy sẽ bị huỷ.' : ''}`)) return;
    guard(async () => { await ctx.store.mutate('orders/random', { count: 8 }); toast('Đã tạo 8 đơn ngẫu nhiên'); renderBody(); }, e.currentTarget);
  });
  $('#d-ocancel', box)?.addEventListener('click', () => { editOrder = null; pickedDest = null; renderBody(); });
  $('#d-oabort', box)?.addEventListener('click', (e) => {
    askReason(`Huỷ đơn ${o.id}`, { presets: ['Khách yêu cầu huỷ qua điện thoại', 'Không liên lạc được người gửi'], ok: 'Huỷ đơn' })
      .then((why) => why && guard(async () => { const res = await ctx.store.mutate('order/cancel', { id: o.id, reason: why }); toast(res.message); editOrder = null; renderBody(); }));
  });
  box.querySelectorAll('[data-split]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    guard(async () => { const res = await ctx.store.mutate('order/split', { id: b.dataset.split }); toast(res.message); renderBody(); }, b);
  }));
  box.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => {
    const ord = st.orders.find((x) => x.id === Number(tr.dataset.id));
    if (ord && ord.status !== 0 && ord.status !== 3) {
      const why = { 1: 'đang được giao. Xem ở trang Theo dõi.', 2: 'đã giao xong.', 4: 'đã bị huỷ.', 5: 'đã hoàn về kho sau 2 lần giao thất bại.' };
      toast(`Đơn ${ord.id} ${why[ord.status] || ''}`);
      return;
    }
    editOrder = Number(tr.dataset.id); pickedDest = null; renderBody();
    $('#d-oform', box)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

// ------------------------------------------------------------------ Shipper
function renderShippers(box) {
  const st = ctx.store.state;
  box.innerHTML = `<form id="d-sform" class="block inset"><h2>Thêm shipper</h2>
      <label class="field"><span>Tên</span><input type="text" name="name" required maxlength="40" placeholder="Anh Dũng"></label>
      <div class="row"><label class="field"><span>Tải trọng (kg)</span><input type="number" name="capacity" min="1" step="1" value="20" required></label>
      <label class="field"><span>Loại xe</span><select name="vehicle">${VEHICLES.slice(0, 3).map((v) => `<option value="${v.v}">${v.label}</option>`).join('')}</select></label></div>
      <button class="btn primary">Thêm shipper</button></form>
    <div class="block"><h2>Đội shipper</h2>
    ${st.shippers.length ? `<table class="data"><thead><tr><th></th><th>Tên</th><th>Xe</th><th>Trạng thái</th><th>Vị trí</th><th class="num">Tải trọng</th><th></th></tr></thead><tbody>${st.shippers.map((s, i) => `<tr class="${s.absent ? 'muted-row' : ''}"><td>${avatar(s.name, ROUTE_COLORS[i % ROUTE_COLORS.length], s.vehicleName, 'sm')}</td><td>${escapeHtml(s.name)}${s.absent ? ' <span class="chip warn">Nghỉ</span>' : ''}</td><td>${escapeHtml(s.vehicleName)}</td><td>${s.absent ? '<span class="chip warn">Nghỉ</span>' : s.busy ? '<span class="chip blue">Đang giao</span>' : s.ready ? '<span class="chip ok">Sẵn sàng</span>' : '<span class="chip muted">Tạm nghỉ</span>'}</td><td><small>${s.node >= 0 ? escapeHtml(ctx.store.name(s.node)) : '—'}</small></td><td class="num">${fmt.num(s.capacity)} kg</td><td class="num">${s.absent ? `<button class="btn small" data-back="${i}">Có mặt lại</button>` : `<button class="btn small ghost" data-absent="${i}" title="Shipper nghỉ đột xuất: đơn đang giao của người này quay về hàng chờ">Báo nghỉ</button>`} <button class="btn small danger admin-only" data-rm="${i}">Xoá</button></td></tr>`).join('')}</tbody></table>` : '<p class="empty">Chưa có shipper: chỉ chạy được phương án một xe.</p>'}</div>`;
  const f = $('#d-sform', box);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    guard(async () => {
      await ctx.store.mutate('shipper/add', { name: f.name.value.trim(), capacity: f.capacity.value, vehicle: f.vehicle.value });
      toast('Đã thêm shipper');
      renderBody();
    }, e.submitter);
  });
  box.querySelectorAll('[data-absent]').forEach((b) => b.addEventListener('click', () => {
    const s = st.shippers[Number(b.dataset.absent)];
    if (!confirm(`${s.name} nghỉ đột xuất? Đơn chưa giao của ${s.name} sẽ quay về hàng chờ và ${s.name} không được điều phối tới khi có mặt lại.`)) return;
    guard(async () => { const res = await ctx.store.mutate('shift/absent', { index: b.dataset.absent }); toast(res.message); report = null; renderBody(); }, b);
  }));
  box.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => guard(async () => {
    const res = await ctx.store.mutate('shift/available', { index: b.dataset.back }); toast(res.message); report = null; renderBody();
  }, b)));
  box.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => guard(async () => {
    await ctx.store.mutate('shipper/remove', { index: b.dataset.rm });
    renderBody();
  })));
}

// ------------------------------------------------------------------ Kết quả
async function runDispatch(btn) {
  await guard(async () => {
    report = await api.get('dispatch', { vehicle: singleVeh, return: back ? 1 : 0 });
    reportDataset = ctx.store.state.dataset;
    stale = false;
    const plans = report[group].length ? report[group] : report.single;
    if (!report[group].length) group = 'single';
    // Mặc định chọn phương án có quãng đường ngắn nhất trong số phương án ít trễ nhất
    planKey = pickDefault(plans).key;
    setTab('result');
  }, btn);
}

function pickDefault(plans) {
  const run = plans.filter((p) => !p.skipped);
  return run.reduce((a, b) => (b.served > a.served || (b.served === a.served && (b.late < a.late || (b.late === a.late && b.km < a.km))) ? b : a), run[0]);
}

function renderResults(box) {
  if (!report) {
    box.innerHTML = '<p class="empty">Bấm Điều phối để so sánh 8 phương án.</p>';
    return;
  }
  const plans = report[group];
  const run = plans.filter((p) => !p.skipped);
  const minKm = Math.min(...run.map((p) => p.km));
  const minLate = Math.min(...run.map((p) => p.late));
  const plan = plans.find((p) => p.key === planKey) || run[0];
  planKey = plan.key;

  const rows = plans.map((p) => `<tr class="clickable ${p.key === planKey ? 'active' : ''}" data-key="${p.key}">
      <td>${escapeHtml(p.name)}${p.optimal ? ' <span class="chip ok">Tối ưu</span>' : ''}</td>
      <td class="num ${!p.skipped && p.km === minKm ? 'best' : ''}">${p.skipped ? '–' : fmt.km(p.km)}</td>
      <td class="num ${!p.skipped && p.late === minLate ? 'best' : ''}">${p.skipped ? '–' : p.late}</td>
      <td class="num">${p.skipped ? '–' : p.unreachable.length + p.overweight.length}</td>
      <td class="num">${p.skipped ? '–' : fmt.us(p.micros)}</td></tr>`).join('');

  // Nhận xét tự động: phương án ngắn nhất có trễ nhiều hơn không?
  const shortest = run.reduce((a, b) => (b.km < a.km ? b : a), run[0]);
  const punctual = run.reduce((a, b) => (b.late < a.late || (b.late === a.late && b.km < a.km) ? b : a), run[0]);
  let insight = '';
  if (shortest && punctual && shortest.key !== punctual.key && shortest.late > punctual.late) {
    const extra = punctual.km - shortest.km;
    insight = `<div class="notice info">${escapeHtml(shortest.name)} ngắn nhất nhưng trễ ${shortest.late} đơn. ${escapeHtml(punctual.name)} chỉ trễ ${punctual.late}${extra >= 0.05 ? `, đi thêm ${fmt.km(extra)}` : ' với cùng quãng đường'}.</div>`;
  }

  const routeCards = plan.routes.map((r, i) => {
    const color = ROUTE_COLORS[(r.shipper >= 0 ? r.shipper : i) % ROUTE_COLORS.length];
    if (!r.stops.length) return `<div class="route-card"><header>${avatar(r.name, color, r.vehicleName, 'sm')}<b>${escapeHtml(r.name)}</b><span class="muted">không nhận đơn</span></header></div>`;
    return `<div class="route-card"><header>${avatar(r.name, color, r.vehicleName, 'sm')}<b>${escapeHtml(r.name)}</b><span class="muted">${escapeHtml(r.vehicleName)}${r.capacity ? `, ${fmt.num(r.load)}/${fmt.num(r.capacity)} kg` : ''}</span></header>
      ${r.startAt > report.clock + 0.5 ? `<div class="notice info" style="margin:4px 0 6px">Đang chạy chuyến trước, về kho lúc ${fmt.clock(r.startAt)} mới xuất phát chuyến này</div>` : ''}
      <div class="meta">Xuất phát ${fmt.clock(r.startAt)} · ${fmt.km(r.km)}, ${fmt.min(r.minutes)}, ${fmt.vnd(r.cost)}${r.rushDelay >= 1 ? `, <span style="color:var(--signal-ink)">kẹt cao điểm +${fmt.min(r.rushDelay)}</span>` : ''}${r.late ? `, <span style="color:var(--stop)">trễ ${r.late} đơn</span>` : ''}</div>
      ${r.stops.map((s) => `<div class="stop-line ${s.late ? 'late' : ''}"><span class="t">${fmt.clock(s.arrival)}</span><span class="n">${escapeHtml(s.name)} <small class="muted">đơn ${s.order}</small>${s.urgent ? ' <span class="chip urgent">Gấp</span>' : ''}${s.deadline >= 0 ? ` <small class="muted">hạn ${fmt.clock(s.deadline)}</small>` : ''}${s.late ? ' <span class="chip late">Trễ</span>' : ''}</span></div>`).join('')}
      ${back ? `<div class="stop-line"><span class="t">${fmt.clock(r.startAt + r.minutes)}</span><span class="n muted">Về kho</span></div>` : ''}
    </div>`;
  }).join('');

  const missing = [];
  if (plan.unreachable.length) missing.push(`<div class="notice warn">Không có đường tới đơn ${plan.unreachable.join(', ')}</div>`);
  if (plan.overweight.length) {
    const st = ctx.store.state, cap = maxCapacity(st);
    const tooHeavy = plan.overweight.filter((id) => { const o = st.orders.find((x) => x.id === id); return o && o.weight > cap + 1e-9; });
    const full = plan.overweight.filter((id) => !tooHeavy.includes(id));
    if (tooHeavy.length) missing.push(`<div class="notice warn">Đơn ${tooHeavy.join(', ')} nặng hơn xe lớn nhất (${fmt.num(cap)} kg). ${tooHeavy.map((id) => `<button type="button" class="btn small" data-split="${id}">Chia kiện đơn ${id}</button>`).join(' ')}</div>`);
    if (full.length) missing.push(`<div class="notice warn">Hết tải trọng: đơn ${full.join(', ')} chưa giao. Áp dụng xong, điều phối tiếp cho chuyến sau.</div>`);
  }
  const absent = ctx.store.state.shippers.filter((s) => s.absent);
  if (absent.length) missing.unshift(`<div class="notice info">Không điều phối cho ${absent.map((s) => escapeHtml(s.name)).join(', ')} (đang nghỉ).</div>`);

  const canApply = !plan.skipped && plan.served > 0 && !stale;
  box.innerHTML = `${stale ? '<div class="notice warn">Dữ liệu vừa đổi. Bấm Điều phối để tính lại.</div>' : ''}
    ${report.clock > 0 ? `<div class="notice info">Giữa ca: ${report.pending} đơn chờ, xe xuất phát lúc ${fmt.clock(report.clock)}.</div>` : ''}
    ${segmented('group', [{ v: 'multi', label: report.multi.length ? 'Cả đội, có tải trọng' : 'Cả đội (chưa có shipper)' }, { v: 'single', label: `Một ${report.vehicle.toLowerCase()} (TSP)` }], group)}
    <div class="block" style="margin-top:6px">
      <div class="table-wrap"><table class="data"><thead><tr><th>Phương án</th><th class="num">Km</th><th class="num">Trễ</th><th class="num">Chưa giao</th><th class="num">Chạy</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${insight}
    </div>
    <div class="block"><div class="split"><h2>${escapeHtml(plan.name)}</h2>${canApply ? '<button class="btn primary small" id="d-apply">Áp dụng</button>' : ''}</div>
      <p class="sub">${escapeHtml(plan.description)}</p>
      ${plan.skipped ? `<div class="notice warn">${escapeHtml(plan.note)}</div>` : `
      <div class="kpis"><div class="kpi"><b>${fmt.km(plan.km)}</b><span>tổng quãng đường</span></div><div class="kpi"><b>${fmt.clock(plan.finishAt || report.clock + plan.makespan)}</b><span>xong việc</span></div><div class="kpi"><b>${fmt.vnd(plan.cost)}</b><span>chi phí</span></div>${(() => { const d = plan.routes.reduce((a, r) => a + (r.rushDelay || 0), 0); return d >= 1 ? `<div class="kpi"><b style="color:var(--signal-ink)">+${fmt.min(d)}</b><span>kẹt cao điểm</span></div>` : ''; })()}</div>
      ${plan.note ? `<p class="muted" style="font-size:12.5px">${escapeHtml(plan.note)}</p>` : ''}
      ${missing.join('')}${routeCards}`}
    </div>
    <div class="block"><div class="split"><h2>Hàng đợi ưu tiên</h2><span class="muted" style="font-size:12px">gấp, hạn sớm, mã đơn</span></div><ol class="order-list">${report.priorityOrder.map((id) => `<li>${id}</li>`).join('')}</ol></div>`;
  bindSegmented(box, (n, v) => { group = v; planKey = pickDefault(report[group].length ? report[group] : report.single).key; renderBody(); });
  box.querySelectorAll('[data-split]').forEach((b) => b.addEventListener('click', () => guard(async () => {
    const res = await ctx.store.mutate('order/split', { id: b.dataset.split });
    toast(res.message);
    await runDispatch();
  }, b)));
  $('#d-apply', box)?.addEventListener('click', (e) => {
    // Chọn phương án có đơn trễ trong khi có phương án khác không trễ (giao đủ bằng): hỏi lại
    const better = plan.late > 0 && report[group].find((p) => !p.skipped && p.late === 0 && p.served >= plan.served);
    if (better && !confirm(`“${plan.name}” làm trễ ${plan.late} đơn, trong khi “${better.name}” không trễ đơn nào (${fmt.km(better.km)}). Vẫn áp dụng?`)) return;
    applyPlan(e.currentTarget);
  });
  const applyPlan = (btn) => guard(async () => {
    const res = await ctx.store.mutate('dispatch/apply', { plan: plan.key, vehicle: singleVeh, return: back ? 1 : 0 });
    toast(res.message);
    report = null;
    tab = 'orders';
    ctx.go('tracking');
  }, btn);
  box.querySelectorAll('tr[data-key]').forEach((tr) => tr.addEventListener('click', () => { planKey = tr.dataset.key; renderBody(); }));
}

// ------------------------------------------------------------------ Bản đồ
function drawMap() {
  const map = ctx.map;
  const st = ctx.store.state;
  const styles = new Map();
  if (tab === 'result' && report) {
    const plan = report[group].find((p) => p.key === planKey);
    if (plan && !plan.skipped) {
      const paths = [];
      plan.routes.forEach((r, i) => {
        if (r.path.length < 2) return;
        const idx = r.shipper >= 0 ? r.shipper : i;
        const color = ROUTE_COLORS[idx % ROUTE_COLORS.length];
        paths.push({ nodes: r.path, color, width: 5, arrows: true, offset: (idx - (plan.routes.length - 1) / 2) * 5 });
        r.stops.forEach((s, j) => styles.set(s.node, { badge: j + 1, badgeColor: color, ring: s.late ? 'var(--stop)' : s.urgent ? 'var(--signal)' : null, keep: true, tip: `Đơn ${s.order}, tới lúc ${fmt.clock(s.arrival)}${s.late ? ' (trễ)' : ''}` }));
      });
      const missing = new Set([...plan.unreachable, ...plan.overweight]);
      for (const o of st.orders) if (missing.has(o.id)) styles.set(o.destination, { ring: 'var(--stop)', badge: '!', badgeColor: 'var(--stop)', keep: true, tip: `Đơn ${o.id} chưa giao được` });
      map.setPaths(paths);
      map.setDim(true);
      const legend = plan.routes.filter((r) => r.stops.length).map((r, i) => ({ type: 'line', color: ROUTE_COLORS[(r.shipper >= 0 ? r.shipper : i) % ROUTE_COLORS.length], label: r.name }));
      if (plan.late) legend.push({ type: 'dot', color: 'var(--stop-soft)', label: 'Viền đỏ: trễ hạn' });
      map.setLegend(legend);
      map.setNodeStyles(styles);
      return;
    }
  }
  // Chưa có kết quả: đánh dấu nơi có đơn hàng
  map.setPaths([]);
  map.setDim(false);
  for (const o of st.orders) {
    if (o.status !== 0) continue;   // chỉ hiện đơn đang chờ giao
    const prev = styles.get(o.destination);
    const ids = prev ? `${prev.badge},${o.id}` : String(o.id);
    styles.set(o.destination, { badge: ids, badgeColor: o.urgent || (prev && prev.urgentAny) ? 'var(--signal)' : 'var(--road)', badgeText: o.urgent || (prev && prev.urgentAny) ? '#3a2a00' : undefined, urgentAny: o.urgent || (prev && prev.urgentAny), ring: o.reachable ? null : 'var(--stop)' });
  }
  if (pickedDest != null) styles.set(pickedDest, { ...(styles.get(pickedDest) || {}), ring: 'var(--go)' });
  map.setNodeStyles(styles);
  map.setLegend(st.orders.some((o) => o.status === 0) ? [{ type: 'badge', color: 'var(--road)', label: 'Mã đơn chờ' }, { type: 'badge', color: 'var(--signal)', label: 'Có đơn gấp' }] : []);
}

export default {
  id: 'dispatch',
  title: 'Điều phối',
  mount(panel, c) {
    ctx = c;
    const st = ctx.store.state;
    root = document.createElement('div');
    root.innerHTML = `<div class="page-head"><h1>Điều phối</h1>${st.shift.active ? `<a class="btn small ghost" href="#tracking">Ca đang chạy: ${st.orders.filter((o) => o.status === 1).length} đơn</a>` : ''}</div>
      <div class="block run-card">
        <div class="run-row"><button class="btn primary block-btn" id="d-run">Điều phối</button><span class="run-sum" id="d-sum"></span></div>
        <details class="sub-note opts"><summary>Tuỳ chọn ca (kho, giờ bắt đầu, loại xe)</summary>
          <div class="row">
            <label class="field" style="flex:2"><span>Kho</span><select id="d-depot">${ctx.store.nodeOptions(st.depot)}</select></label>
            <label class="field"><span>Bắt đầu ca</span><input type="time" id="d-start" value="${hhmm(getShiftStart())}"></label>
          </div>
          <div class="field"><span>Xe cho phương án một xe</span>${segmented('sveh', VEHICLES.slice(0, 3), singleVeh)}</div>
          <div class="run-row"><label class="check"><input type="checkbox" id="d-back" ${back ? 'checked' : ''}> Quay về kho</label><label class="check" title="Thời gian đi mỗi đoạn tăng vào 7:00–8:30 và 17:00–18:30"><input type="checkbox" id="d-rush" ${st.settings.rush.enabled ? 'checked' : ''}> Giờ cao điểm</label></div>
        </details>
      </div>
      <div class="tabs" role="tablist"><button role="tab" data-tab="orders"></button><button role="tab" data-tab="shippers"></button><button role="tab" data-tab="result">Phương án</button></div>
      <div id="d-body"></div>`;
    panel.append(root);
    bindSegmented(root.querySelector('.run-card'), (n, v) => { singleVeh = v; sumLine(); if (report) runDispatch(); });
    sumLine();
    $('#d-depot', root).addEventListener('change', (e) => guard(async () => {
      if (ctx.store.state.shift.active && !confirm('Đổi kho sẽ huỷ ca giao đang chạy. Tiếp tục?')) { e.target.value = ctx.store.state.depot; return; }
      await ctx.store.mutate('depot', { id: e.target.value });
      toast(`Kho: ${ctx.store.name(e.target.value)}`);
    }));
    $('#d-start', root).addEventListener('change', (e) => {
      if (!e.target.value) return;
      guard(async () => {
        await ctx.store.mutate('settings', { shiftStart: timeToMinutes(e.target.value) });
        toast(`Ca bắt đầu lúc ${e.target.value}`);
      });
    });
    $('#d-back', root).addEventListener('change', (e) => { back = e.target.checked; if (report) runDispatch(); });
    $('#d-rush', root).addEventListener('change', (e) => guard(async () => {
      const had = !!report;
      await ctx.store.mutate('settings', { rush: e.target.checked ? 1 : 0 });
      toast(e.target.checked ? 'Đã bật giờ cao điểm' : 'Đã tắt giờ cao điểm');
      if (had) runDispatch();
    }));
    $('#d-run', root).addEventListener('click', (e) => runDispatch(e.currentTarget));
    root.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
    ctx.onMap('nodeclick', (id) => {
      if (tab !== 'orders') return;
      pickedDest = id;
      const f = $('#d-oform', root);
      if (f) f.destination.value = id;
      drawMap();
    });
    ctx.map.setPicking(false);
    ctx.map.setHint(null);
    if (ctx.intent) { tab = ctx.intent; ctx.intent = null; setTab(tab); } else setTab(report ? 'result' : tab);
  },
  unmount() { root = null; },
  onState(state) {
    if (!root) return;
    if (report) stale = true;
    if (report && (report.depot !== state.depot || reportDataset !== state.dataset)) { report = null; stale = false; if (tab === 'result') tab = 'orders'; }
    $('#d-depot', root).innerHTML = ctx.store.nodeOptions(state.depot);
    $('#d-start', root).value = hhmm(getShiftStart());
    $('#d-rush', root).checked = state.settings.rush.enabled;
    sumLine();
    renderTabs();
    renderBody();
  },
};
