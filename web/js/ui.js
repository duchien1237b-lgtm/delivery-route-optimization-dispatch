// Tiện ích giao diện: định dạng số, toast, modal, nút chọn phân đoạn.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Giờ bắt đầu ca (phút từ 0:00). Mọi mốc thời gian trong ca được hiển thị thành giờ thật.
let shiftStart = 8 * 60;
export function setShiftStart(m) { shiftStart = m; }
export function getShiftStart() { return shiftStart; }
export function hhmm(absMinutes) {
  const m = ((Math.round(absMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
export function timeToMinutes(str) {
  const [h, m] = String(str).split(':').map(Number);
  return h * 60 + (m || 0);
}

const nf1 = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });

export const fmt = {
  km: (v) => (v == null ? '–' : `${nf1.format(v)} km`),
  min: (v) => (v == null ? '–' : `${nf0.format(Math.round(v))} phút`),
  clock: (v) => (v == null ? '–' : hhmm(shiftStart + v)),   // phút từ đầu ca -> "08:35"
  dur: (v) => {                                              // khoảng thời gian -> "1 giờ 05 phút"
    if (v == null) return '–';
    const m = Math.round(v);
    return m >= 60 ? `${Math.floor(m / 60)} giờ ${String(m % 60).padStart(2, '0')} phút` : `${m} phút`;
  },
  vnd: (v) => (v == null ? '–' : `${nf0.format(Math.round(v / 100) * 100)} đ`),
  k: (v) => (v == null ? '–' : `${nf1.format(v)}k`),
  num: (v, d = 1) => (v == null ? '–' : (d === 2 ? nf2 : d === 0 ? nf0 : nf1).format(v)),
  us: (v) => {
    if (v == null) return '–';
    if (v >= 1000) return `${nf2.format(v / 1000)} ms`;
    return `${nf1.format(v)} µs`;
  },
};

export const VEHICLES = [
  { v: 0, label: 'Xe máy' },
  { v: 1, label: 'Ô tô' },
  { v: 2, label: 'Xe tải' },
  { v: 3, label: 'Bỏ qua' },
];
export const CRITERIA = [
  { v: 'distance', label: 'Ngắn nhất' },
  { v: 'time', label: 'Nhanh nhất' },
  { v: 'cost', label: 'Rẻ nhất' },
];
export const ROUTE_COLORS = ['#1a6fe0', '#ef7300', '#009e8f', '#c2389f', '#6a5be0', '#9a7400', '#d93025', '#188038'];

// Biểu tượng nét (24×24) dùng trong nút chọn và thẻ
export const ICONS = {
  'Xe máy': '<circle cx="5.5" cy="16.5" r="2.6"/><circle cx="18.5" cy="16.5" r="2.6"/><path d="M8.1 16.5h7.4l1.8-6.2h-3.1M14.3 6h2.4l.9 4.3M8.1 16.5 6.6 12h4.6l2.2 4.5"/>',
  'Ô tô': '<path d="M3.8 16.2v-3.9l1.9-4.5A2 2 0 0 1 7.5 6.6h9a2 2 0 0 1 1.8 1.2l1.9 4.5v3.9z"/><circle cx="7.6" cy="16.4" r="1.9"/><circle cx="16.4" cy="16.4" r="1.9"/><path d="M4.4 12.2h15.2"/>',
  'Xe tải': '<path d="M2.8 6.2h10.8v10.3H2.8zM13.6 9.6h4.2l3.2 3.4v3.5h-7.4z"/><circle cx="6.8" cy="17.4" r="1.9"/><circle cx="17.1" cy="17.4" r="1.9"/>',
  'Bỏ qua': '<circle cx="12" cy="12" r="8.3"/><path d="m6.2 6.2 11.6 11.6"/>',
  'Ngắn nhất': '<path d="M3.6 15.6 15.6 3.6l4.8 4.8-12 12z"/><path d="m7.4 11.8 1.9 1.9M10.4 8.8l1.9 1.9M13.4 5.8l1.9 1.9"/>',
  'Nhanh nhất': '<path d="M13.2 2.8 5 13.4h6.2l-1.4 7.8 8.2-10.6h-6.2z"/>',
  'Rẻ nhất': '<circle cx="12" cy="12" r="8.3"/><path d="M14.6 9.3c-.5-.9-1.5-1.4-2.6-1.4-1.5 0-2.6.8-2.6 2s1.1 1.6 2.7 2 2.8.9 2.8 2.2-1.2 2.1-2.8 2.1c-1.2 0-2.3-.6-2.7-1.5M12 6.4v1.4M12 16.5v1.2"/>',
};
export const icon = (key, cls = '') => (ICONS[key] ? `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[key]}</svg>` : '');

// Ảnh đại diện shipper: chữ cái đầu của tên gọi (từ cuối) trên nền màu tuyến, kèm biểu tượng xe
export const initialOf = (name) => ((name || '').trim().split(/\s+/).pop() || '?')[0].toUpperCase();
export function avatar(name, color, vehicleName, size = '') {
  const veh = vehicleName && ICONS[vehicleName] ? `<i class="ava-veh"><svg viewBox="0 0 24 24">${ICONS[vehicleName]}</svg></i>` : '';
  return `<span class="ava ${size}" style="--c:${color}" aria-hidden="true">${escapeAva(initialOf(name))}${veh}</span>`;
}
function escapeAva(t) { return t.replace(/[<>&"]/g, ''); }

// Trạng thái đơn hàng (khớp OrderStatus trong Dispatcher.h)
export const STATUS = [
  { label: 'Chờ giao', cls: '' },
  { label: 'Đang giao', cls: 'blue' },
  { label: 'Đã giao', cls: 'ok' },
  { label: 'Thất bại', cls: 'late' },
  { label: 'Đã huỷ', cls: 'muted' },
  { label: 'Hoàn kho', cls: 'warn' },
  { label: 'Mới', cls: 'violet' },
  { label: 'Đã phân công', cls: 'blue' },
];
// Vai trò người đang xem (do app.js đặt): khách không biết đơn đang được mời cho shipper nào, chỉ thấy “đang tìm shipper”
let viewer = '';
export function setViewer(role) { viewer = role || ''; }
// Tên và màu trạng thái của đơn theo người xem
export function statusLabel(o) {
  if (o.status === 0 && o.noShipper) return { label: 'Chưa có shipper', cls: 'urgent' };
  if (viewer === 'customer' && (o.status === 0 || o.status === 7)) return o.createdAt > 0 || o.status === 7 ? { label: 'Đang tìm shipper', cls: 'violet searching' } : STATUS[0];
  if (viewer === 'shipper' && o.status === 7) return { label: 'Lời mời mới', cls: 'violet' };
  if (viewer === 'admin' && o.status === 7) return { label: 'Đã mời shipper', cls: 'blue' };
  return STATUS[o.status] || STATUS[0];
}
export function statusChip(o) {
  const s = statusLabel(o);
  let html = `<span class="chip ${s.cls}">${s.label}</span>`;
  if (o.late) html += ' <span class="chip late">Trễ</span>';
  if (o.attempts > 0 && (o.status === 0 || o.status === 1 || o.status === 7)) html += ` <span class="chip urgent">Giao lại lần ${o.attempts + 1}</span>`;
  return html;
}
// Tải trọng lớn nhất trong các shipper đang có mặt (0 nếu không có ai)
export function maxCapacity(state) {
  return state.shippers.filter((s) => !s.absent).reduce((m, s) => Math.max(m, s.capacity), 0);
}

export function toast(message, kind = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${kind === 'error' ? 'error' : ''}`;
  el.textContent = message;
  $('#toasts').append(el);
  const life = kind === 'error' ? 6000 : 3200;
  setTimeout(() => el.classList.add('leaving'), life - 220);
  setTimeout(() => el.remove(), life);
}

export function showModal(title, html) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  $('#modal').showModal();
}

// Chạy một hàm async, báo lỗi bằng toast. Trả về kết quả hoặc undefined.
export async function guard(fn, button) {
  let slow;
  if (button) {
    button.disabled = true;
    // Chỉ hiện vòng xoay nếu thao tác kéo dài, tránh nháy với tác vụ tức thời
    slow = setTimeout(() => button.classList.add('busy'), 160);
  }
  try {
    return await fn();
  } catch (e) {
    toast(e.message, 'error');
    return undefined;
  } finally {
    if (button) { clearTimeout(slow); button.classList.remove('busy'); button.disabled = false; }
  }
}

// Nhóm nút chọn 1 trong nhiều: <div class="seg" data-seg="name">
export function segmented(name, options, value) {
  return `<div class="seg" role="group" data-seg="${name}">${options
    .map((o) => `<button type="button" data-value="${o.v}" aria-pressed="${String(o.v) === String(value)}">${icon(o.label)}<span>${o.label}</span></button>`)
    .join('')}</div>`;
}

export function bindSegmented(root, onChange) {
  for (const seg of $$('.seg', root)) {
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      for (const x of $$('button', seg)) x.setAttribute('aria-pressed', String(x === b));
      onChange(seg.dataset.seg, b.dataset.value);
    });
  }
}

export function segValue(root, name) {
  const b = $(`.seg[data-seg="${name}"] button[aria-pressed="true"]`, root);
  return b ? b.dataset.value : undefined;
}

export function haversineKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.x - a.x) * rad, dLon = (b.y - a.y) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.x * rad) * Math.cos(b.x * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function vehicleMaskText(mask) {
  if (mask === 7) return 'Mọi loại xe';
  const names = [];
  if (mask & 1) names.push('xe máy');
  if (mask & 2) names.push('ô tô');
  if (mask & 4) names.push('xe tải');
  return `Chỉ ${names.join(', ')}`;
}

// ---------------------------------------------------- Giờ cao điểm (hiển thị)
// Cùng công thức với RushProfile trong Graph.cpp: mức đông 0..1 theo giờ trong ngày.
export function rushLevel(rush, minuteOfDay) {
  if (!rush || !rush.enabled) return 0;
  const t = ((minuteOfDay % 1440) + 1440) % 1440;
  let best = 0;
  for (const w of rush.windows)
    for (const shift of [-1440, 0, 1440]) {
      const s = w.start + shift, e = w.end + shift;
      let lv = 0;
      if (t >= s && t <= e) lv = 1;
      else if (rush.ramp > 0 && t >= s - rush.ramp && t < s) lv = (t - (s - rush.ramp)) / rush.ramp;
      else if (rush.ramp > 0 && t > e && t <= e + rush.ramp) lv = 1 - (t - e) / rush.ramp;
      best = Math.max(best, lv);
    }
  return best;
}

export const TRAFFIC_LEVELS = [
  { min: 1.3, color: '#f2c94c', label: 'Đông', width: 3 },
  { min: 1.7, color: '#e07b00', label: 'Rất đông', width: 4 },
  { min: 2.1, color: '#c4441c', label: 'Kẹt nặng', width: 5 },
];

// Tô màu từng đoạn đường theo mức kẹt của ô tô lúc minuteOfDay (kể cả kẹt xe báo tay)
// minLevel: bỏ qua các mức nhẹ hơn (vd. 1 = chỉ tô "Rất đông" trở lên)
export function trafficEdgeStyles(state, minuteOfDay, minLevel = 0) {
  const styles = new Map();
  const lv = rushLevel(state.settings.rush, minuteOfDay);
  for (const e of state.graph.edges) {
    if (e.closed) continue;
    const m = (1 + lv * ((e.peak ?? 1.5) - 1)) * (e.jam || 1);
    let pick = null;
    TRAFFIC_LEVELS.forEach((t, i) => { if (m >= t.min && i >= minLevel) pick = t; });
    if (pick) styles.set(`${e.u}-${e.v}`, { color: pick.color, width: pick.width });
  }
  return styles;
}

// ---- Thanh trượt dưới nút đang chọn của mọi nhóm .seg (tự gắn cho cả nội dung vẽ sau)
function placeThumb(seg, instant) {
  let th = seg.querySelector(':scope > .seg-thumb');
  const on = seg.querySelector(':scope > button[aria-pressed="true"]');
  if (!th) { th = document.createElement('span'); th.className = 'seg-thumb'; th.setAttribute('aria-hidden', 'true'); seg.prepend(th); instant = true; }
  if (!on || !on.offsetWidth) { th.style.opacity = '0'; return; }
  if (instant) th.classList.add('no-anim');
  th.style.opacity = '1';
  th.style.width = on.offsetWidth + 'px';
  th.style.height = on.offsetHeight + 'px';
  th.style.transform = `translate(${on.offsetLeft}px, ${on.offsetTop}px)`;
  if (instant) requestAnimationFrame(() => th.classList.remove('no-anim'));
}
const segRO = typeof ResizeObserver === 'function' ? new ResizeObserver((list) => { for (const e of list) placeThumb(e.target, true); }) : null;
function watchSeg(seg) {
  if (seg._thumbed) return;
  seg._thumbed = true;
  segRO && segRO.observe(seg);
  placeThumb(seg, true);
}
export function initSegThumbs(root = document.body) {
  for (const s of root.querySelectorAll('.seg')) watchSeg(s);
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'attributes') {
        const seg = m.target.parentElement;
        if (seg && seg.classList.contains('seg')) { watchSeg(seg); placeThumb(seg, false); }
        continue;
      }
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.classList.contains('seg')) watchSeg(n);
        for (const s of n.querySelectorAll ? n.querySelectorAll('.seg') : []) watchSeg(s);
      }
    }
  }).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-pressed'] });
}

// Vị trí của xe trên chuyến tại phút `time` của ca: {lat, lon, index, state}
// state: wait (chưa xuất phát), drive, serve (đang giao tại điểm), done (đã về)
export function tripPosition(trip, time, nodesById) {
  const P = trip.path, T = trip.pathTimes;
  const serve = new Map();
  for (const s of trip.stops) serve.set(s.pathIndex, (serve.get(s.pathIndex) || 0) + (trip.service || 0));
  const depart = (i) => T[i] + (serve.get(i) || 0);
  const at = (i) => nodesById.get(P[i]) || { x: 0, y: 0 };
  if (!P.length) return null;
  // Đoạn shipper chạy từ chỗ đang đứng tới kho lấy hàng (ghép tự động)
  const A = trip.approach || [], AT = trip.approachTimes || [];
  if (A.length && AT.length === A.length && time < AT[AT.length - 1]) {
    const an = (i) => nodesById.get(A[i]) || { x: 0, y: 0 };
    if (time <= AT[0]) return { lat: an(0).x, lon: an(0).y, index: 0, state: 'wait' };
    for (let i = 1; i < A.length; i++) {
      if (time < AT[i]) {
        const a = an(i - 1), b = an(i);
        const f = AT[i] > AT[i - 1] ? Math.min(1, Math.max(0, (time - AT[i - 1]) / (AT[i] - AT[i - 1]))) : 1;
        return { lat: a.x + (b.x - a.x) * f, lon: a.y + (b.y - a.y) * f, index: -1, state: 'approach' };
      }
    }
  }
  if (time <= T[0]) return { lat: at(0).x, lon: at(0).y, index: 0, state: 'wait' };
  for (let i = 0; i < P.length; i++) {
    if (time < T[i]) {
      const a = at(i - 1), b = at(i), d0 = depart(i - 1);
      const f = T[i] > d0 ? Math.min(1, Math.max(0, (time - d0) / (T[i] - d0))) : 1;
      return { lat: a.x + (b.x - a.x) * f, lon: a.y + (b.y - a.y) * f, index: i - 1, state: 'drive' };
    }
    if (time < depart(i)) return { lat: at(i).x, lon: at(i).y, index: i, state: 'serve' };
  }
  return { lat: at(P.length - 1).x, lon: at(P.length - 1).y, index: P.length - 1, state: 'done' };
}

// Độ dài (km) của một lộ trình theo danh sách điểm, dựa trên các đoạn đường trong state
export function pathKm(state, nodes) {
  if (!state._edgeKm) {
    const m = new Map();
    for (const e of state.graph.edges) { m.set(`${e.u},${e.v}`, e.km); if (!state.graph.directed) m.set(`${e.v},${e.u}`, e.km); }
    state._edgeKm = m;
  }
  let km = 0;
  for (let i = 1; i < nodes.length; i++) km += state._edgeKm.get(`${nodes[i - 1]},${nodes[i]}`) || 0;
  return km;
}
// Shipper đã lấy hàng ở kho chưa? (đến giờ rời kho của chuyến) — trước đó còn huỷ / nhả đơn được
export function pickedUp(trip, clock) { return !trip || !trip.pathTimes.length || clock >= trip.pathTimes[0] - 1e-9; }
// Giờ ca “đang chạy”: giờ ca server trả về + thời gian đã trôi qua kể từ lúc nhận state (nhân tốc độ mô phỏng), để xe di chuyển mượt giữa hai lần tải lại
export function liveClock(state) {
  const sh = state.shift;
  if (!sh.active || !(sh.speed > 0) || !state._rx) return sh.clock;
  return sh.clock + Math.min(600, (Date.now() - state._rx) / 1000) * sh.speed / 60;
}

// Hộp chọn lý do giao thất bại (dùng ở trang Theo dõi và Chuyến của tôi). onPick(reasonId)
export function pickFailReason(state, order, onPick) {
  const left = state.shift.maxAttempts - (order.attempts || 0) - 1;
  showModal(`Giao thất bại: đơn ${order.id}`, `<p class="muted" style="margin:-4px 0 12px">${[order.destinationName, order.recipient, order.phone].filter(Boolean).map((x) => String(x).replace(/[<>&"]/g, '')).join(' · ')}</p>
    <div class="reason-list">${state.shift.failReasons.map((r) => `<button type="button" class="reason" data-reason="${r.id}"><b>${r.name}</b><small>${r.returns || left <= 0 ? 'Hoàn hàng về kho, không giao lại' : `Có thể giao lại (còn ${left} lần)`}</small></button>`).join('')}</div>`);
  document.querySelectorAll('#modal-body [data-reason]').forEach((btn) => btn.addEventListener('click', () => {
    $('#modal').close();
    onPick(Number(btn.dataset.reason));
  }));
}

// ------------------------------------------------------------------ Hộp thoại hỏi / xác nhận
// Hỏi lý do (huỷ, từ chối, khoá...). Trả về chuỗi lý do hoặc null nếu người dùng đóng hộp thoại.
export function askReason(title, { label = 'Lý do', placeholder = '', min = 3, ok = 'Xác nhận', danger = true, note = '', presets = [] } = {}) {
  return new Promise((resolve) => {
    const dlg = $('#modal');
    let done = false;
    showModal(title, `${note ? `<p class="muted" style="margin:-4px 0 12px;font-size:13.5px">${note}</p>` : ''}
      ${presets.length ? `<div class="chips" style="margin-bottom:10px">${presets.map((p) => `<button type="button" class="chip" data-preset="${escapeAttr(p)}">${escapeAttr(p)}</button>`).join('')}</div>` : ''}
      <label class="field"><span>${label}</span><textarea id="ask-text" rows="3" maxlength="150" placeholder="${escapeAttr(placeholder)}"></textarea></label>
      <p class="field-err" id="ask-err" hidden></p>
      <div class="actions"><button type="button" class="btn ${danger ? 'danger' : 'primary'}" id="ask-ok">${ok}</button></div>`);
    const ta = $('#ask-text');
    for (const b of document.querySelectorAll('#modal-body [data-preset]')) b.addEventListener('click', () => { ta.value = b.dataset.preset; ta.focus(); });
    setTimeout(() => ta.focus(), 30);
    $('#ask-ok').addEventListener('click', () => {
      const v = ta.value.trim();
      if (v.length < min) { const e = $('#ask-err'); e.textContent = `Hãy nhập ít nhất ${min} ký tự`; e.hidden = false; ta.focus(); return; }
      done = true;
      dlg.close();
      resolve(v);
    });
    dlg.addEventListener('close', () => { if (!done) resolve(null); }, { once: true });
  });
}
export function confirmBox(title, html, { ok = 'Đồng ý', danger = false } = {}) {
  return new Promise((resolve) => {
    const dlg = $('#modal');
    let done = false;
    showModal(title, `<div style="font-size:14px;line-height:1.6">${html}</div><div class="actions" style="margin-top:14px"><button type="button" class="btn ${danger ? 'danger' : 'primary'}" id="cf-ok">${ok}</button></div>`);
    $('#cf-ok').addEventListener('click', () => { done = true; dlg.close(); resolve(true); });
    dlg.addEventListener('close', () => { if (!done) resolve(false); }, { once: true });
  });
}
function escapeAttr(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ------------------------------------------------------------------ Lỗi theo từng ô nhập
// Server trả "fields": {tên_ô: lỗi}. Hiện lỗi ngay dưới ô (aria-invalid + aria-describedby cho trình đọc màn hình).
export function clearFieldErrors(form) {
  for (const el of form.querySelectorAll('[aria-invalid="true"]')) { el.removeAttribute('aria-invalid'); el.removeAttribute('aria-describedby'); }
  for (const el of form.querySelectorAll('.field-err[data-for]')) el.remove();
}
export function setFieldError(form, name, message) {
  const input = form.querySelector(`[name="${name}"]`);
  if (!input) return false;
  input.setAttribute('aria-invalid', 'true');
  const id = `err-${form.id || 'f'}-${name}`;
  input.setAttribute('aria-describedby', id);
  let p = form.querySelector(`#${CSS.escape(id)}`);
  if (!p) {
    // Trong .field: gắn ngay dưới ô (bên trong nhãn, để không phá bố cục hàng 2 cột); ô tick: gắn sau nhãn
    const field = input.closest('.field');
    p = document.createElement(field ? 'span' : 'p');
    p.className = field ? 'field-err in' : 'field-err';
    p.id = id;
    p.dataset.for = name;
    p.setAttribute('role', 'alert');
    if (field) field.append(p);
    else (input.closest('.check') || input).after(p);
  }
  p.textContent = message;
  return true;
}
// Hiện lỗi từ server: lỗi theo ô (nếu có) và toast. Trả về true nếu đã gắn được ít nhất một lỗi vào ô.
export function showFieldErrors(form, err) {
  clearFieldErrors(form);
  let first = null;
  if (err && err.fields) {
    for (const [k, v] of Object.entries(err.fields)) if (setFieldError(form, k, v) && !first) first = form.querySelector(`[name="${k}"]`);
  }
  if (first) first.focus();
  return !!first;
}
// Như guard() nhưng lỗi theo ô được gắn vào form thay vì chỉ hiện toast
export async function guardForm(form, fn, button) {
  clearFieldErrors(form);
  return guard(async () => {
    try { return await fn(); } catch (e) {
      // Lỗi không thuộc ô nào (vd. 409 sai mã) trong hộp thoại: hiện ngay trong form vì toast nằm dưới lớp phủ của hộp thoại
      if (!showFieldErrors(form, e) && form.closest('dialog[open]') && e && e.message) {
        const p = document.createElement('p');
        p.className = 'field-err form-err';
        p.dataset.for = '_form';
        p.setAttribute('role', 'alert');
        p.textContent = e.message;
        const actions = form.querySelector('.actions');
        if (actions) actions.before(p); else form.append(p);
      }
      throw e;
    }
  }, button);
}

// ------------------------------------------------------------------ Phân trang
export function pager(page) {
  if (!page || page.pages <= 1) return page && page.total ? `<p class="pager-info">${page.total} kết quả</p>` : '';
  const btn = (p, label, aria, on = false) => `<button type="button" class="pg ${on ? 'on' : ''}" data-page="${p}" ${on ? 'aria-current="page"' : ''} aria-label="${aria}">${label}</button>`;
  const items = [];
  const from = Math.max(1, page.page - 2), to = Math.min(page.pages, page.page + 2);
  if (from > 1) items.push(btn(1, '1', 'Trang 1'), from > 2 ? '<span class="pg-gap">…</span>' : '');
  for (let p = from; p <= to; p++) items.push(btn(p, String(p), `Trang ${p}`, p === page.page));
  if (to < page.pages) items.push(to < page.pages - 1 ? '<span class="pg-gap">…</span>' : '', btn(page.pages, String(page.pages), `Trang ${page.pages}`));
  return `<nav class="pager" aria-label="Phân trang">
    <button type="button" class="pg" data-page="${page.page - 1}" ${page.page <= 1 ? 'disabled' : ''} aria-label="Trang trước">‹</button>
    ${items.join('')}
    <button type="button" class="pg" data-page="${page.page + 1}" ${page.page >= page.pages ? 'disabled' : ''} aria-label="Trang sau">›</button>
    <span class="pager-info">${page.total} kết quả</span></nav>`;
}
export function bindPager(root, onGo) {
  for (const b of root.querySelectorAll('.pager [data-page]')) b.addEventListener('click', () => onGo(Number(b.dataset.page)));
}
// Bỏ dấu tiếng Việt để tìm kiếm phía trình duyệt (danh sách nhỏ đã tải về)
export const fold = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

// Xuất CSV (mở được bằng Excel: BOM UTF-8, CRLF). Ô chữ bắt đầu bằng = + - @ bị thêm dấu ' để Excel không chạy như công thức;
// số (kể cả số âm) giữ nguyên để còn cộng trừ được.
export function csvCell(v) {
  let s = String(v ?? '');
  if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function downloadCsv(filename, head, rows) {
  const csv = '\ufeff' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Ô tìm kiếm có độ trễ (gõ xong 250 ms mới gọi server)
export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ------------------------------------------------------------------ Thời gian thật (giây Unix)
const dtf = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const df = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
export const when = {
  full: (sec) => (sec > 0 ? dtf.format(new Date(sec * 1000)) : '–'),
  date: (sec) => (sec > 0 ? df.format(new Date(sec * 1000)) : '–'),
  ago(sec) {
    if (!(sec > 0)) return '–';
    const d = Math.max(0, Date.now() / 1000 - sec);
    if (d < 60) return 'vừa xong';
    if (d < 3600) return `${Math.floor(d / 60)} phút trước`;
    if (d < 86400) return `${Math.floor(d / 3600)} giờ trước`;
    if (d < 86400 * 7) return `${Math.floor(d / 86400)} ngày trước`;
    return df.format(new Date(sec * 1000));
  },
};
const nfMoney = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
export const money = (v) => (v == null ? '–' : `${nfMoney.format(Math.round(v))} đ`);

// ------------------------------------------------------------------ Kiểm tra dữ liệu phía trình duyệt
// Cùng quy tắc với Auth.cpp (server vẫn kiểm tra lại; đây chỉ để báo lỗi sớm).
const COMMON_PASSWORDS = new Set(['password', 'password1', 'password12', 'password123', 'passw0rd', 'p@ssw0rd', 'qwerty123', 'qwerty1234', 'qwertyuiop1',
  'abc12345', 'abcd1234', 'abc123456', 'abcdefg1', 'admin123', 'admin1234', 'admin12345', 'administrator1', 'welcome1',
  'welcome123', 'letmein123', 'iloveyou1', 'iloveyou123', 'monkey123', 'dragon123', 'football1', 'baseball1',
  '12345678a', '123456789a', '1234567890a', 'a12345678', 'a123456789', 'aa123456', 'aa12345678', 'matkhau123',
  'matkhau1234', 'dieuphoi123', 'shipper123', 'khach123', 'khachhang123', 'giaohang123', 'vietnam123', 'hanoi12345',
  'saigon12345', 'hcm123456', 'test1234', 'test12345', 'user1234', 'login123', 'master123', 'changeme1', 'changeme123',
  'zaq12wsx', '1q2w3e4r', '1qaz2wsx', 'q1w2e3r4', 'asdf1234', 'asdfghjkl1', 'zxcvbnm123', 'trustno1', 'sunshine1']);
export function passwordRules(p, username = '') {
  const u = (username || '').toLowerCase();
  return [
    { ok: p.length >= 8, label: 'Ít nhất 8 ký tự' },
    { ok: /[A-Z]/.test(p) && /[a-z]/.test(p), label: 'Có chữ hoa và chữ thường' },
    { ok: /[0-9]/.test(p), label: 'Có chữ số' },
    { ok: p.length > 0 && !COMMON_PASSWORDS.has(p.toLowerCase()) && !(u.length >= 3 && p.toLowerCase().includes(u)), label: 'Không phổ biến, không chứa tên đăng nhập' },
  ];
}
export const validate = {
  username(u) {
    if (u.length < 3 || u.length > 20) return 'Tên đăng nhập dài 3–20 ký tự';
    if (!/^[a-z0-9_.]+$/.test(u)) return "Tên đăng nhập chỉ gồm chữ thường không dấu, số, '_' và '.'";
    if (/^0[0-9]{9}$/.test(u)) return 'Tên đăng nhập không được giống số điện thoại';
    return '';
  },
  displayName(n) {
    const len = [...n].length;
    if (len < 2) return 'Họ tên / tên doanh nghiệp cần ít nhất 2 ký tự';
    if (len > 40) return 'Họ tên / tên doanh nghiệp tối đa 40 ký tự';
    if (/[<>=#_\u0000-\u001f\u007f]/.test(n)) return 'Họ tên / tên doanh nghiệp không được chứa các ký tự < > = # _ hoặc ký tự điều khiển';
    if (n.trim() !== n) return 'Họ tên / tên doanh nghiệp không được bắt đầu hoặc kết thúc bằng khoảng trắng';
    return '';
  },
  email(e) {
    return /^[A-Za-z0-9_%+-]+(\.[A-Za-z0-9_%+-]+)*@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(e) && e.length <= 80 ? '' : 'Email không hợp lệ';
  },
  phone(p) { return /^0[0-9]{9}$/.test(p) ? '' : 'Số điện thoại phải gồm 10 chữ số, bắt đầu bằng 0'; },
  plate(p) {
    if (p.length < 4 || p.length > 12) return 'Biển số xe dài 4–12 ký tự (ví dụ 59A1-123.45)';
    return /^[A-Z0-9.-]+$/.test(p) ? '' : "Biển số xe chỉ gồm chữ in hoa, số, '-' và '.'";
  },
  password(p, username) {
    if (p.length < 8) return 'Mật khẩu cần ít nhất 8 ký tự';
    if (!/[A-Z]/.test(p) || !/[a-z]/.test(p) || !/[0-9]/.test(p)) return 'Mật khẩu cần có chữ hoa, chữ thường và chữ số';
    if (COMMON_PASSWORDS.has(p.toLowerCase())) return 'Mật khẩu này quá phổ biến, hãy chọn mật khẩu khác';
    if (username && username.length >= 3 && p.toLowerCase().includes(username.toLowerCase())) return 'Mật khẩu không được chứa tên đăng nhập';
    return '';
  },
};
export const normalizePhone = (p) => String(p || '').replace(/[\s.\-()]/g, '');

// Ô mật khẩu có nút hiện / ẩn: <div class="pw-wrap"><input type=password><button class="pw-eye"></button></div>
export function passwordInput(name, { autocomplete = 'current-password', placeholder = '', id = '' } = {}) {
  return `<div class="pw-wrap"><input type="password" name="${name}" ${id ? `id="${id}"` : ''} autocomplete="${autocomplete}" placeholder="${placeholder}" spellcheck="false" autocapitalize="none">
    <button type="button" class="pw-eye" aria-label="Hiện mật khẩu" aria-pressed="false" title="Hiện mật khẩu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg></button></div>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('.pw-eye');
  if (!b) return;
  const input = b.parentElement.querySelector('input');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  b.setAttribute('aria-pressed', String(show));
  b.setAttribute('aria-label', show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
  b.title = show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu';
  b.classList.toggle('on', show);
});
// Danh sách điều kiện mật khẩu, cập nhật khi gõ
export function bindPasswordRules(input, list, getUser = () => '') {
  const draw = () => {
    list.innerHTML = passwordRules(input.value, getUser()).map((r) => `<li class="${r.ok ? 'ok' : ''}">${r.label}</li>`).join('');
  };
  input.addEventListener('input', draw);
  draw();
}

// ------------------------------------------------------------------ Diễn biến của đơn
export const EVENT_LABEL = {
  created: 'Đặt đơn', confirmed: 'Đã xác nhận', rejected: 'Bị từ chối', assigned: 'Đã phân công shipper', accepted: 'Shipper nhận chuyến',
  declined: 'Shipper từ chối chuyến', delivered: 'Giao thành công', failed: 'Giao thất bại', returned: 'Hoàn hàng về kho',
  cancelled: 'Đã huỷ', requeue: 'Đưa lại hàng chờ', recalled: 'Quản trị viên thu hồi lời mời', reroute: 'Đổi tuyến', absent: 'Shipper nghỉ đột xuất', apply: 'Áp dụng phương án',
  offered: 'Gửi lời mời cho shipper gần nhất', expired: 'Shipper bỏ lỡ lời mời', offer_withdrawn: 'Rút lời mời (shipper tạm nghỉ)', released: 'Shipper nhả đơn',
  retry: 'Tìm lại shipper', no_shipper: 'Chưa có shipper nhận đơn', gave_up: 'Hệ thống tự huỷ (không có shipper)', reason: 'Lý do huỷ', available: 'Shipper có mặt trở lại',
};
export const ROLE_COLOR = { admin: '#6a5be0', shipper: '#1a6fe0', customer: '#00a862' };
export const ROLE_LABEL = { admin: 'Quản trị viên', shipper: 'Shipper', customer: 'Khách hàng' };

// Vẽ lại một vùng mà không làm mất con trỏ trong ô đang gõ (ô tìm kiếm của danh sách)
export function preserveFocus(root, draw) {
  const a = document.activeElement;
  const id = a && root && root.contains(a) && a.id ? a.id : null;
  const sel = id && typeof a.selectionStart === 'number' ? [a.selectionStart, a.selectionEnd] : null;
  draw();
  if (!id) return;
  const b = root.querySelector(`#${CSS.escape(id)}`);
  if (!b) return;
  b.focus();
  if (sel && b.setSelectionRange) { try { b.setSelectionRange(sel[0], sel[1]); } catch { /* ô không hỗ trợ chọn */ } }
}
