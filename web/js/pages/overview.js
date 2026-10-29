// Trang Tổng quan: tình hình hiện tại của bản đồ, hàng đơn chờ giao và đội shipper.
import { escapeHtml } from '../store.js';
import { fmt, ROUTE_COLORS, avatar, liveClock } from '../ui.js';
import { api } from '../api.js';
import { openOrder } from '../orders.js';

const SVG = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const I_BOX = '<path d="M3.5 7.5 12 3.2l8.5 4.3v9L12 20.8l-8.5-4.3z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v8.8M7.7 5.3l8.6 4.4"/>';
const I_RIDER = '<circle cx="5.5" cy="16.5" r="2.6"/><circle cx="18.5" cy="16.5" r="2.6"/><path d="M8.1 16.5h7.4l1.8-6.2h-3.1M14.3 6h2.4l.9 4.3M8.1 16.5 6.6 12h4.6l2.2 4.5"/>';
const I_PIN = '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>';
const I_ROAD = '<path d="M8 3.5 4.5 20.5M16 3.5l3.5 17M12 4.5v2.5M12 10.5v3M12 17v2.5"/>';

let root = null;

// Mục nào đang mở được nhớ lại (kể cả khi tải lại trang) để bảng không bật ra bật vào mỗi lần dữ liệu đổi
const ACC_DEFAULT = { alerts: true, queue: true, crew: false };
const accState = { ...ACC_DEFAULT };
try { Object.assign(accState, JSON.parse(localStorage.getItem('ov.acc') || '{}')); } catch (e) { /* không có localStorage thì dùng mặc định */ }
const isOpen = (k) => accState[k] !== false;
function setOpen(k, v) {
  accState[k] = v;
  try { localStorage.setItem('ov.acc', JSON.stringify(accState)); } catch (e) { /* bỏ qua */ }
}
let ctxRef = null;

// Doanh thu / đơn giao / COD 14 ngày từ báo cáo (chỉ quản trị viên có): làm đường sparkline và % so với hôm qua
let daily = null, dailyAt = 0, dailyBusy = false;
async function loadDaily() {
  if (dailyBusy || Date.now() - dailyAt < 30000) return;
  dailyBusy = true;
  try {
    const r = await api.get('reports/summary');
    daily = r.daily || null;
    dailyAt = Date.now();
    if (root && ctxRef) render(ctxRef.store.state, ctxRef);
  } catch (e) { dailyAt = Date.now(); } finally { dailyBusy = false; }
}
function spark(values, { bars = false } = {}) {
  const W = 120, H = 34, n = values.length, max = Math.max(1, ...values);
  if (!n) return '';
  if (bars) {
    const bw = W / n;
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${values.map((v, i) => `<rect x="${(i * bw + 1).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" y="${(H - 2 - (v / max) * (H - 6)).toFixed(1)}" height="${Math.max(2, (v / max) * (H - 6)).toFixed(1)}" rx="1.5" ${i === n - 1 ? 'class="now"' : ''}/>`).join('')}</svg>`;
  }
  const pts = values.map((v, i) => [(i / (n - 1 || 1)) * W, H - 3 - (v / max) * (H - 8)]);
  const line = pts.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join('');
  const last = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path class="area" d="${line}L${W},${H}L0,${H}Z"/><path class="line" d="${line}"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.6"/></svg>`;
}
function delta(today, yest) {
  if (!(yest > 0)) return today > 0 ? '<i class="delta up">mới hôm nay</i>' : '<i class="delta flat">chưa có số liệu</i>';
  const pct = Math.round(((today - yest) / yest) * 100);
  return `<i class="delta ${pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat'}">${pct > 0 ? '▲' : pct < 0 ? '▼' : '='} ${Math.abs(pct)}% so với hôm qua</i>`;
}

// Đơn chờ giao xếp như hàng đợi ưu tiên của Dispatcher: gấp trước, hạn sớm trước, rồi mã đơn
function byPriority(a, b) {
  if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
  const da = a.deadline < 0 ? Infinity : a.deadline, db = b.deadline < 0 ? Infinity : b.deadline;
  if (da !== db) return da - db;
  return a.id - b.id;
}

function render(state, ctx) {
  if (!root) return;
  const g = state.graph;
  const orders = state.orders;
  const pending = orders.filter((o) => o.status === 0).sort(byPriority);
  const urgent = pending.filter((o) => o.urgent).length;
  const unreachable = orders.filter((o) => !o.reachable && o.status === 0).length;
  const ds = state.datasets.find((d) => d.key === state.dataset);
  const live = orders.filter((o) => o.status === 1).length;
  const done = orders.filter((o) => o.status === 2).length;
  const assigned = live + done + orders.filter((o) => o.status === 3).length;

  const warn = [];
  if (g.stats.components > 1) warn.push(`<div class="notice warn">${g.stats.components} cụm đường không nối với nhau${unreachable ? `, ${unreachable} đơn kho không tới được` : ''}. <a href="#explore">Xem</a></div>`);
  if (g.stats.negative) warn.push('<div class="notice info">Có đoạn được trợ giá (chi phí âm): tối ưu theo chi phí cần Bellman-Ford. <a href="#cost">Mở</a></div>');

  const queue = pending.slice(0, 8).map((o) => `<li data-node="${o.destination}" class="${o.urgent ? 'urgent' : ''}">
      <span class="li-ic">${SVG(I_BOX)}</span>
      <span class="li-main"><b>${escapeHtml(o.destinationName)}</b><small>Đơn ${o.id} · ${fmt.num(o.weight)} kg${o.cod ? ` · COD ${fmt.vnd(o.cod)}` : ''}${o.urgent ? ' · <em>Gấp</em>' : ''}</small></span>
      <span class="li-end">${o.deadline >= 0 ? `<span class="chip ${o.urgent ? 'late' : ''}">trước ${fmt.clock(o.deadline)}</span>` : '<span class="chip">không hạn</span>'}</span></li>`).join('');
  const liveIds = new Set(orders.filter((o) => o.status === 1).map((o) => o.id));
  const onTrip = new Set((state.shift.trips || []).filter((t) => (t.stops || []).some((s) => liveIds.has(s.order))).map((t) => t.shipper));

  const has = (k) => !!daily && daily.some((d) => d[k] > 0);
  const dToday = daily && daily.length ? daily[daily.length - 1] : null, dYest = daily && daily.length > 1 ? daily[daily.length - 2] : null;
  const absent = state.shippers.filter((x) => x.absent).length;
  const ready = state.shippers.length - absent - onTrip.size;
  const noCrew = !state.shippers.length || absent === state.shippers.length;
  const alerts = warn.length + (noCrew ? 1 : 0);
  if (noCrew) warn.push('<div class="notice error">Không có shipper nào sẵn sàng nhận đơn. <a href="#dispatch" data-tab-go="shippers">Kiểm tra đội xe</a></div>');
  const SHOW = 5;
  const clock = liveClock(state);
  const isLate = (o) => state.shift.active && o.deadline >= 0 && clock > o.deadline;
  const lateN = pending.filter(isLate).length;
  const queue5 = pending.slice(0, SHOW).map((o) => `<li class="oc ${isLate(o) ? 'is-late' : o.urgent ? 'urgent' : ''}" data-node="${o.destination}">
      <div class="oc-top"><b>${escapeHtml(o.destinationName)}</b><span class="oc-badges">${isLate(o) ? '<span class="badge late">Quá hạn</span>' : ''}${o.urgent ? '<span class="badge urgent">Gấp</span>' : ''}${!o.urgent && !isLate(o) ? '<span class="badge normal">Thường</span>' : ''}</span></div>
      <div class="oc-meta">Đơn ${o.id} · ${fmt.num(o.weight)} kg${o.cod ? ` · COD ${fmt.vnd(o.cod)}` : ''}<span class="oc-due">${o.deadline >= 0 ? `trước ${fmt.clock(o.deadline)}` : 'không hạn'}</span></div>
      <div class="oc-act"><a class="btn small primary" href="#dispatch">Điều phối ngay</a><button type="button" class="btn small" data-detail="${o.id}">Xem chi tiết</button></div></li>`).join('');
  const sec = (key, title, meta, body, { action = '', tone = '' } = {}) => `<details class="acc ${tone}" data-acc="${key}" ${isOpen(key) ? 'open' : ''}>
      <summary><span class="acc-t">${title}</span>${meta}<span class="acc-act">${action}</span><svg class="acc-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></summary>
      <div class="acc-body">${body}</div></details>`;

  root.innerHTML = `
    <div class="page-head ov-head">
      <div><p class="eyebrow">Bộ dữ liệu</p><h1 class="ov-title">${escapeHtml(ds ? ds.title : 'Bản đồ đang chỉnh sửa')}</h1>${ds ? `<p class="ov-desc" title="${escapeHtml(ds.description)}">${escapeHtml(ds.description)}</p>` : ''}</div>
    </div>
    <p class="ov-meta">${SVG(I_PIN)}${g.stats.nodes} điểm <i></i>${SVG(I_ROAD)}${g.stats.edges} đoạn đường${g.stats.traffic ? ` <i></i><a href="#network" class="bad">${g.stats.traffic} sự cố</a>` : ''}</p>
    <div class="bento">
      <a class="bc hero" href="#reports"><span class="bc-k">Doanh thu hôm nay</span><b class="bc-v">${dToday ? fmt.vnd(dToday.revenue) : '–'}</b>${dToday ? delta(dToday.revenue, dYest ? dYest.revenue : 0) : '<i class="delta flat">đang tải…</i>'}${has('revenue') ? spark(daily.map((d) => d.revenue)) : ''}<small class="bc-s">${has('revenue') ? '14 ngày gần nhất' : 'chưa có đơn giao xong'}</small></a>
      <a class="bc ${urgent || lateN ? 'red' : 'amber'}" href="#dispatch">${SVG(I_BOX)}<span class="bc-k">Đơn chờ</span><b class="bc-v">${pending.length}</b><small class="bc-s">${urgent ? `${urgent} gấp` : 'không có đơn gấp'}${lateN ? ` · ${lateN} quá hạn` : ''}</small>${urgent || lateN ? '<em class="pulse-dot"></em>' : ''}</a>
      <a class="bc ${noCrew ? 'red' : 'green'}" href="#dispatch" data-tab-go="shippers">${SVG(I_RIDER)}<span class="bc-k">Shipper</span><b class="bc-v">${state.shippers.length}</b><small class="bc-s">${noCrew ? 'không có ai sẵn sàng' : `${Math.max(0, ready)} rảnh · ${onTrip.size} đang giao`}</small>${noCrew ? '<em class="pulse-dot"></em>' : ''}</a>
      <a class="bc" href="#reports"><span class="bc-k">Đã giao hôm nay</span><b class="bc-v">${dToday ? dToday.delivered : '–'}</b>${dToday ? delta(dToday.delivered, dYest ? dYest.delivered : 0) : ''}${has('delivered') ? spark(daily.map((d) => d.delivered), { bars: true }) : ''}</a>
      <a class="bc" href="#cod"><span class="bc-k">COD hôm nay</span><b class="bc-v">${dToday ? fmt.vnd(dToday.cod) : '–'}</b>${dToday ? delta(dToday.cod, dYest ? dYest.cod : 0) : ''}${has('cod') ? spark(daily.map((d) => d.cod)) : ''}</a>
    </div>

    ${state.shift.active ? `<a class="shift-card" href="#tracking">
      <span class="sc-head"><span class="live-dot"></span><b>Ca đang chạy</b><span class="sc-pct">${assigned ? Math.round((done / assigned) * 100) : 0}%</span></span>
      <span class="progress"><i style="width:${assigned ? (done / assigned) * 100 : 0}%"></i></span>
      <span class="sc-grid">
        <span><small>Hoàn thành</small><b>${done}/${assigned}</b></span>
        <span><small>Đang trên đường</small><b>${live}</b></span>
        <span><small>Doanh thu</small><b>${state.finance ? fmt.vnd(state.finance.revenue) : '–'}</b></span>
        <span><small>COD đã thu</small><b>${state.finance ? fmt.vnd(state.finance.codCollected) : '–'}</b></span>
      </span></a>`
    : `<div class="shift-card idle"><span class="sc-head"><b>Chưa bắt đầu ca</b></span><span class="sc-note">${pending.length ? `${pending.length} đơn đang chờ phân công.` : 'Chưa có đơn nào chờ.'}</span>${pending.length ? '<a class="btn small primary" href="#dispatch">Điều phối ngay</a>' : ''}</div>`}

    ${alerts ? sec('alerts', 'Cảnh báo', `<span class="acc-count warn">${alerts}</span>`, warn.join(''), { tone: 'warn' }) : ''}
    ${sec('queue', 'Hàng chờ giao', `<span class="acc-count">${pending.length}</span>`,
      pending.length ? `<ul class="queue list">${queue5}</ul>${pending.length > SHOW ? `<a class="more-line" href="#queue">Xem thêm ${pending.length - SHOW} đơn khác ›</a>` : ''}`
        : `<p class="empty">${orders.length ? 'Mọi đơn đã được phân công.' : 'Chưa có đơn.'} <a href="#dispatch">Thêm đơn</a></p>`,
      { action: pending.length ? '<a class="btn small primary" href="#dispatch">Điều phối</a>' : '' })}
    ${sec('crew', 'Đội shipper', `<span class="acc-meta">${state.shippers.length ? `${Math.max(0, ready)} rảnh · ${onTrip.size} đang giao${absent ? ` · ${absent} nghỉ` : ''}` : ''}</span>`,
      state.shippers.length ? `<ul class="crew list">${state.shippers.map((s, i) => `<li>${avatar(s.name, ROUTE_COLORS[i % ROUTE_COLORS.length], s.vehicleName)}<span class="li-main"><b>${escapeHtml(s.name)}</b><small>${escapeHtml(s.vehicleName)} · chở tối đa ${fmt.num(s.capacity)} kg</small></span><span class="li-end">${s.absent ? '<span class="chip warn">Nghỉ</span>' : onTrip.has(i) ? '<span class="chip blue">Đang giao</span>' : '<span class="chip ok">Sẵn sàng</span>'}</span></li>`).join('')}</ul>` : '<p class="empty">Chưa có shipper.</p>',
      { action: '<a class="btn small" href="#dispatch" data-tab-go="shippers">Sửa</a>' })}`;
  root.querySelectorAll('details.acc').forEach((d) => d.addEventListener('toggle', () => setOpen(d.dataset.acc, d.open)));

  root.querySelectorAll('.queue li').forEach((li) => {
    li.addEventListener('click', (e) => { if (!e.target.closest('a, button')) ctx.map.focusNode(Number(li.dataset.node)); });
  });
  root.querySelectorAll('[data-detail]').forEach((b) => b.addEventListener('click', () => openOrder(Number(b.dataset.detail), { go: ctx.go })));
  root.querySelectorAll('[data-tab-go]').forEach((el) => el.addEventListener('click', (e) => { ctx.intent = e.currentTarget.dataset.tabGo; }));

  // Bản đồ: số đơn chờ tại từng điểm
  const count = new Map();
  for (const o of pending) {
    const c = count.get(o.destination) || { n: 0, urgent: false };
    c.n++; c.urgent = c.urgent || o.urgent;
    count.set(o.destination, c);
  }
  const styles = new Map();
  for (const [id, c] of count) {
    styles.set(id, {
      ring: c.urgent ? 'var(--signal)' : undefined, badge: c.n, badgeColor: c.urgent ? 'var(--signal)' : 'var(--road)', badgeText: c.urgent ? '#3a2a00' : undefined,
      tip: `${c.n} đơn chờ${c.urgent ? ', có đơn gấp' : ''}`,
    });
  }
  ctx.map.setNodeStyles(styles);
  ctx.map.setLegend(count.size ? [
    { type: 'badge', color: 'var(--road)', label: 'Số đơn chờ' },
    { type: "badge", color: "var(--signal)", label: "Có đơn gấp" },
  ] : []);
}

export default {
  id: 'overview',
  title: 'Tổng quan',
  mount(panel, ctx) {
    ctxRef = ctx;
    root = document.createElement('div');
    panel.append(root);
    render(ctx.store.state, ctx);
    loadDaily();
  },
  unmount() { root = null; },
  onState(state) { render(state, ctxRef); loadDaily(); },
};
