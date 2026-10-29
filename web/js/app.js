// Điểm khởi động giao diện: điều hướng giữa các trang, thanh trên, công cụ bản đồ.
import { api, downloadText, setCsrf } from './api.js';
import { MapView } from './mapview.js';
import { store, escapeHtml } from './store.js';
import { $, $$, guard, toast, setShiftStart, showModal, initSegThumbs, avatar, ROUTE_COLORS, ROLE_COLOR, ROLE_LABEL, when, setViewer } from './ui.js';
import { initAuth, showAuth, hideAuth } from './auth.js';
import { openOrder } from './orders.js';

import overview from './pages/overview.js';
import network from './pages/network.js';
import route from './pages/route.js';
import explore from './pages/explore.js';
import lab from './pages/lab.js';
import cost from './pages/cost.js';
import dispatch from './pages/dispatch.js';
import tracking from './pages/tracking.js';
import reports from './pages/reports.js';
import bench from './pages/bench.js';
import analysis from './pages/analysis.js';
import accounts from './pages/accounts.js';
import myjob from './pages/myjob.js';
import myorders from './pages/myorders.js';
import queue from './pages/queue.js';
import profile from './pages/profile.js';
import cod from './pages/cod.js';
import complaints from './pages/complaints.js';
import audit from './pages/audit.js';
import settings from './pages/settings.js';
import summary from './pages/summary.js';
import wallet from './pages/wallet.js';

const ALL_PAGES = [overview, network, route, explore, lab, cost, dispatch, tracking, reports, bench, analysis, accounts, myjob, myorders,
  queue, profile, cod, complaints, audit, settings, summary, wallet];
// Trang mỗi vai trò được dùng (server cũng kiểm tra quyền ở từng API). Trang đầu tiên là trang chủ của vai trò.
// dock: hiện trên thanh chuyển trang (phím 1..0 theo thứ tự này); extra: chỉ mở từ menu tài khoản.
const ROLE_PAGES = {
  admin: { dock: ['overview', 'queue', 'dispatch', 'tracking', 'network', 'route', 'explore', 'analysis', 'lab', 'cost', 'reports', 'bench', 'accounts', 'cod', 'wallet', 'complaints'],
    extra: ['summary', 'settings', 'audit', 'profile'] },
  shipper: { dock: ['myjob', 'cod', 'summary', 'route', 'profile'], extra: [] },
  customer: { dock: ['myorders', 'wallet', 'complaints', 'summary', 'route', 'profile'], extra: [] },
};
let ALLOWED = [];
// Phím 1..0 chuyển tới 10 trang đầu của vai trò hiện tại
let PAGES = [];
let me = null;
const panel = $('#panel');

const map = new MapView($('#map'), { tooltip: $('#tooltip'), hint: $('#map-hint'), legend: $('#legend') });
initSegThumbs();

// Nhóm trên thanh chuyển trang: các nhóm cách nhau bằng vạch mảnh (vận hành | bản đồ & thuật toán | báo cáo | tiền & hỗ trợ)
const DOCK_GROUP = {
  overview: 'ops', queue: 'ops', dispatch: 'ops', tracking: 'ops', myjob: 'ops', myorders: 'ops',
  network: 'map', route: 'map', explore: 'map', analysis: 'map', lab: 'map', cost: 'map',
  reports: 'rep', bench: 'rep', accounts: 'rep', summary: 'rep',
  cod: 'money', wallet: 'money', complaints: 'money', profile: 'money',
};
const sheetEl = $('#sheet'), dockEl = $('.dock');
const isMobile = () => window.innerWidth <= 820;

// Thẻ nội dung nổi trên bản đồ: phần bản đồ còn thấy nằm bên phải thẻ (máy tính)
// hoặc phía trên khung kéo lên (điện thoại). Bản đồ căn khung trong phần đó.
function updateInset() {
  const wide = document.body.classList.contains('wide');
  let left = 0, bottom = 0;
  let top = 0;
  if (isMobile()) { bottom = wide ? 0 : sheetEl.offsetHeight + dockEl.offsetHeight; top = Math.round($('.topcard').getBoundingClientRect().bottom) + 12; }
  else if (!wide) left = Math.round(sheetEl.getBoundingClientRect().right);
  const root = document.documentElement.style;
  root.setProperty('--map-left', left + 'px');
  root.setProperty('--map-bottom', bottom + 'px');
  // Máy tính: chừa chỗ cho thanh chuyển trang nổi ở đáy khi căn khung bản đồ
  if (!isMobile() && !wide) bottom = dockEl.offsetHeight + 28;   // thanh dưới nổi cách đáy 14px: giữ thước tỉ lệ và nút bản đồ nằm trên nó
  const changed = left !== map.inset || Math.abs(bottom - map.insetB) > 2;
  map.setInset(left, bottom, top);
  return changed;
}

// Điện thoại: khung nội dung kéo lên / xuống, dừng ở 3 nấc
const SNAPS = [0.3, 0.46, 0.88];
let snap = 1;
function sheetMax() { return window.innerHeight - dockEl.offsetHeight; }
function setSheet(px, animate = true) {
  const h = Math.max(120, Math.min(sheetMax() - 8, px));
  sheetEl.classList.toggle('no-anim', !animate);
  document.documentElement.style.setProperty('--sheet-h', h + 'px');
}
function snapSheet(i) { snap = Math.max(0, Math.min(SNAPS.length - 1, i)); setSheet(SNAPS[snap] * sheetMax()); setTimeout(updateInset, 280); }
(() => {
  const grab = $('#grabber');
  let drag = null;
  grab.addEventListener('pointerdown', (e) => {
    if (!isMobile()) return;
    drag = { y: e.clientY, h: sheetEl.offsetHeight, moved: false };
    grab.setPointerCapture(e.pointerId);
  });
  grab.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dy = drag.y - e.clientY;
    if (Math.abs(dy) > 4) drag.moved = true;
    if (drag.moved) setSheet(drag.h + dy, false);
  });
  const end = () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.moved) { snapSheet(snap === SNAPS.length - 1 ? 0 : snap + 1); return; }
    const frac = sheetEl.offsetHeight / sheetMax();
    let best = 0;
    SNAPS.forEach((f, i) => { if (Math.abs(f - frac) < Math.abs(SNAPS[best] - frac)) best = i; });
    snapSheet(best);
  };
  grab.addEventListener('pointerup', end);
  grab.addEventListener('pointercancel', end);
})();

let resizeT;
window.addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => { if (isMobile()) setSheet(SNAPS[snap] * sheetMax()); if (updateInset()) map.fitMain(true); map.render(); }, 120);
});
if (isMobile()) setSheet(SNAPS[snap] * sheetMax(), false);
updateInset();

// Mỗi trang đăng ký sự kiện bản đồ qua ctx.onMap -> tự gỡ khi rời trang
let pageHandlers = [];
let current = null;
const ctx = {
  map,
  store,
  onMap(evt, fn) { map.on(evt, fn); pageHandlers.push([evt, fn]); },
  // Chuyển trang, kèm "ý định" cho trang đích (vd. mở form khiếu nại cho một đơn)
  go(id, intent) { if (intent !== undefined) ctx.intent = intent; if (location.hash === '#' + id) navigate(); else location.hash = id; },
  refreshUser(user) { if (user) applyRole(user); },
};

function leave() {
  for (const [evt, fn] of pageHandlers) map.off(evt, fn);
  pageHandlers = [];
  if (current && current.unmount) current.unmount();
  map.setHint(null);
  map.setPicking(false);
  map.clear();
}

function navigate() {
  if (!me) return;
  const id = (location.hash || '').slice(1);
  const page = ALLOWED.find((p) => p.id === id) || ALLOWED[0];
  if (page.id !== id) history.replaceState(null, '', '#' + page.id);
  leave();
  current = page;
  document.body.classList.toggle('wide', !!page.wide);
  for (const a of $$('.dock a')) {
    if (a.dataset.page === page.id) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  document.title = `${page.title} – Điều phối giao hàng`;
  panel.innerHTML = '';
  panel.scrollTop = 0;
  const insetChanged = updateInset();
  if (insetChanged && map.view && !map.userMoved && !page.wide) map.fitMain(true);
  page.mount(panel, ctx);
  if (ctx.intent && typeof ctx.intent === 'object') ctx.intent = null;   // ý định một lần (chuỗi cũ do trang Điều phối tự xoá)
  panel.classList.remove('enter');
  void panel.offsetWidth;          // khởi động lại hiệu ứng xuất hiện
  panel.classList.add('enter');
  if (!page.wide) map.render();
}

// ------------------------------------------------------------- Thanh trên
function renderTopbar(state) {
  const sel = $('#dataset-select');
  const opts = state.datasets
    .filter((d) => d.available || d.key === state.dataset)
    .map((d) => `<option value="${d.key}" ${d.key === state.dataset ? 'selected' : ''}>${escapeHtml(d.title)}</option>`);
  if (!state.dataset) opts.unshift('<option value="" selected>Bản đồ đang chỉnh sửa</option>');
  sel.innerHTML = opts.join('');
  const g = state.graph;
  const pending = state.orders.filter((o) => o.status === 0).length;
  const live = state.orders.filter((o) => o.status === 1).length;
  const created = state.orders.filter((o) => o.status === 6).length;
  const role = state.me ? state.me.role : '';
  const home = role === 'admin' ? ['#tracking', '#dispatch'] : role === 'shipper' ? ['#myjob', '#myjob'] : ['#myorders', '#myorders'];
  const pill = (cls, href, text, title) => `<a class="spill ${cls}" href="${href}" title="${title}">${text}</a>`;
  $('#graph-summary').innerHTML = [
    pill(state.shift.active ? 'live' : '', home[0], state.shift.active ? 'Ca đang chạy' : 'Chưa chạy ca', 'Trạng thái ca giao hàng'),
    pill(pending ? 'warn' : '', home[1], `${pending} chờ`, 'Đơn đang chờ giao'),
    live ? pill('go', home[0], `${live} giao`, 'Đơn đang trên đường') : '',
    g.stats.traffic ? pill('bad', '#network', `${g.stats.traffic} sự cố`, 'Đoạn đường đang kẹt hoặc đóng') : '',
    `<span class="sys-dot ${sysOnline ? 'ok' : 'bad'}" id="sys-dot" role="status" title="${sysOnline ? 'Hệ thống trực tuyến' : 'Mất kết nối tới máy chủ, đang thử lại'}"></span>`,
  ].join('');
  const badge = $('#dock-pending');
  badge.hidden = !pending;
  badge.textContent = pending > 99 ? '99+' : String(pending);
  // Shipper: chuyến mới chờ nhận + điểm còn phải giao
  const b = state.badges || {};
  const setBadge = (id, n) => { const el = $(id); el.hidden = !n; el.textContent = n > 99 ? '99+' : String(n || ''); };
  setBadge('#dock-myjob', state.me && state.me.role === 'shipper' ? (b.trips || 0) + live : 0);
  setBadge('#dock-queue', (b.newOrders || 0) + (b.failed || 0));
  setBadge('#dock-accounts', b.pendingUsers || 0);
  setBadge('#dock-complaints', b.complaints || 0);
  setBadge('#dock-cod', b.codConfirm || 0);
  if (state.me) setBell(state.me.unread || 0);

  // Đội shipper ở góc trên: ảnh đại diện chồng lên nhau, chấm xanh khi đang chạy chuyến
  // Đang giao = còn đơn chưa giao xong trên chuyến
  const liveIds = new Set(state.orders.filter((o) => o.status === 1).map((o) => o.id));
  const busy = new Set((state.shift.trips || []).filter((t) => (t.stops || []).some((s) => liveIds.has(s.order))).map((t) => t.shipper));
  const shown = state.shippers.slice(0, 4);
  $('#crew-stack').href = state.me && state.me.role === 'admin' ? '#dispatch' : '#myjob';
  $('#crew-stack').style.display = state.me && state.me.role !== 'customer' ? '' : 'none';
  $('#crew-stack').innerHTML = shown.length
    ? shown.map((sh, i) => `<span class="crew-ava ${busy.has(i) ? 'busy' : ''}" title="${escapeHtml(sh.name)}: ${escapeHtml(sh.vehicleName)}, ${sh.capacity} kg${busy.has(i) ? ', đang giao' : ''}">${avatar(sh.name, ROUTE_COLORS[i % ROUTE_COLORS.length], sh.vehicleName)}</span>`).join('')
      + (state.shippers.length > 4 ? `<span class="crew-more">+${state.shippers.length - 4}</span>` : '')
      + `<span class="crew-label"><b>${state.shippers.length} shipper</b><small>${busy.size ? `${busy.size} đang giao` : 'sẵn sàng'}</small></span>`
    : '<span class="crew-label"><b>Chưa có shipper</b><small>Thêm ở Điều phối</small></span>';

  const undo = $('#btn-undo'), redo = $('#btn-redo');
  undo.disabled = !state.undo.can;
  redo.disabled = !state.redo.can;
  undo.title = state.undo.can ? `Hoàn tác: ${state.undo.label} (Ctrl+Z)` : 'Không có gì để hoàn tác';
  redo.title = state.redo.can ? `Làm lại: ${state.redo.label} (Ctrl+Y)` : 'Không có gì để làm lại';
  const live2 = $('.dock a[data-page="tracking"]');
  live2.classList.toggle('live', state.shift.active);
}

let sysOnline = true;
function setSys(on) {
  if (on === sysOnline) return;
  sysOnline = on;
  const d = $('#sys-dot');
  if (d) { d.className = `sys-dot ${on ? 'ok' : 'bad'}`; d.title = on ? 'Hệ thống trực tuyến' : 'Mất kết nối tới máy chủ, đang thử lại'; }
  if (!on) toast('Mất kết nối tới máy chủ, đang thử lại…', 'error'); else toast('Đã kết nối lại');
}
let lastDataset = null;
store.subscribe((state) => {
  setShiftStart(state.settings.shiftStart);
  renderTopbar(state);
  if (state.notice) toast(state.notice);
  const refit = lastDataset !== null && state.dataset !== lastDataset;
  lastDataset = state.dataset;
  map.setGraph(state.graph, state.depot, { refit });
  map.setTripLayer((state.shift.trips || []).filter((t) => t.path && t.path.length > 1 && t.accepted !== false)
    .map((t, i) => ({ nodes: t.path, color: ROUTE_COLORS[(t.shipper >= 0 ? t.shipper : i) % ROUTE_COLORS.length] })));
  if (current && current.onState) current.onState(state);
  map.setLegend(map._lastLegend || []);
});

$('#dataset-select').addEventListener('change', (e) => {
  if (!e.target.value) return;
  if (store.state.shift.active && !confirm('Đổi bộ dữ liệu sẽ huỷ ca giao đang chạy. Tiếp tục?')) { renderTopbar(store.state); return; }
  guard(async () => {
    await store.mutate('dataset', { key: e.target.value });
    map.fitMain();
    toast(`Đã mở “${e.target.selectedOptions[0].textContent}”`);
    navigate();  // vẽ lại trang hiện tại với dữ liệu mới
  });
});

$('#btn-save').addEventListener('click', (e) => guard(async () => {
  const res = await store.mutate('save');
  toast(res.message || 'Đã lưu');
}, e.currentTarget));

// ------------------------------------------------------- Hoàn tác / làm lại
async function undoRedo(kind) {
  const s = store.state;
  if (!s || !me || me.role !== 'admin') return;
  if (!(kind === 'undo' ? s.undo.can : s.redo.can)) return;
  if (s.shift.active && !confirm('Hoàn tác thay đổi bản đồ sẽ huỷ ca giao đang chạy. Tiếp tục?')) return;
  await guard(async () => {
    const res = await store.mutate(kind);
    toast(res.message);
  });
}
$('#btn-undo').addEventListener('click', () => undoRedo('undo'));
$('#btn-redo').addEventListener('click', () => undoRedo('redo'));
document.addEventListener('keydown', (e) => {
  const typing = e.target.closest('input, textarea, select, [contenteditable]');
  if (typing || !(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); undoRedo('undo'); }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); undoRedo('redo'); }
});

// ------------------------------------------------------- Giao diện sáng / tối
const THEMES = ['auto', 'light', 'dark'];
const THEME_LABEL = { auto: 'theo máy', light: 'sáng', dark: 'tối' };
const THEME_ICON = {
  light: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  dark: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  auto: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" stroke="none"/>',
};
function applyTheme(t) {
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  const b = $('#btn-theme');
  b.title = `Giao diện: ${THEME_LABEL[t]}`;
  b.querySelector('svg').innerHTML = THEME_ICON[t];
  map.render();
}
let theme = 'auto';
try { theme = localStorage.getItem('theme') || 'auto'; } catch { /* trình duyệt chặn lưu trữ */ }
applyTheme(THEMES.includes(theme) ? theme : 'auto');
$('#btn-theme').addEventListener('click', () => {
  theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  try { localStorage.setItem('theme', theme); } catch { /* bỏ qua */ }
  applyTheme(theme);
  toast(`Giao diện ${THEME_LABEL[theme]}`);
});

// ------------------------------------------------------- Tìm địa điểm (Trie ở backend)
const sInput = $('#search-input'), sList = $('#search-list');
if (/Mac|iPhone|iPad/.test(navigator.platform || '')) $('#search-kbd').textContent = '⌘K';
let sItems = [], sActive = -1, sTimer = null, sSeq = 0;
const normQ = (t) => String(t == null ? '' : t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
const SEARCH_GROUPS = { order: 'Đơn hàng', shipper: 'Shipper', place: 'Địa điểm', page: 'Trang' };
const SEARCH_ICON = {
  order: '<path d="M3.5 7.5 12 3.2l8.5 4.3v9L12 20.8l-8.5-4.3z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v8.8"/>',
  shipper: '<circle cx="5.5" cy="16.5" r="2.6"/><circle cx="18.5" cy="16.5" r="2.6"/><path d="M8.1 16.5h7.4l1.8-6.2h-3.1M8.1 16.5 6.6 12h4.6l2.2 4.5"/>',
  place: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  page: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};
function closeSearch() { sList.hidden = true; sInput.setAttribute('aria-expanded', 'false'); sActive = -1; }
function renderSearch() {
  if (!sItems.length) {
    sList.innerHTML = `<li class="empty-item">Không tìm thấy “${escapeHtml(sInput.value)}”</li>`;
  } else {
    let last = '';
    sList.innerHTML = sItems.map((it, i) => {
      const head = it.type !== last ? `<li class="grp" role="presentation">${SEARCH_GROUPS[it.type]}</li>` : '';
      last = it.type;
      return `${head}<li role="option" data-i="${i}" aria-selected="${i === sActive}"><svg viewBox="0 0 24 24" aria-hidden="true">${SEARCH_ICON[it.type]}</svg><span class="s-main"><b>${escapeHtml(it.title)}</b><small>${escapeHtml(it.sub || '')}</small></span></li>`;
    }).join('');
    sList.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }
  sList.hidden = false;
  sInput.setAttribute('aria-expanded', 'true');
}
function pageItems(q) {
  return ALLOWED.filter((p) => p.id !== (current && current.id) && (!q || normQ(p.title).includes(q)))
    .slice(0, q ? 3 : 6).map((p) => ({ type: 'page', page: p.id, title: p.title, sub: 'Mở trang' }));
}
// Tìm toàn cục: đơn, shipper và trang tìm ngay trên dữ liệu đã tải; địa điểm hỏi Trie ở backend
function localItems(raw) {
  const q = normQ(raw), num = raw.replace(/^(don|đơn|#)\s*/i, '').trim();
  const st = store.state, out = [];
  if (me && (raw.length >= 2 || /^\d+$/.test(num))) {
    const orders = st.orders.filter((o) => String(o.id) === num || String(o.id).startsWith(num) && /^\d+$/.test(num)
      || normQ(o.recipient).includes(q) || normQ(o.destinationName).includes(q) || (o.phone && o.phone.includes(raw)));
    for (const o of orders.slice(0, 4)) out.push({ type: 'order', order: o.id, title: `Đơn ${o.id} · ${o.recipient || o.destinationName}`, sub: `${o.destinationName} · ${o.statusName || ''}` });
  }
  if (me && me.role !== 'customer' && raw.length >= 2) {
    for (const sh of st.shippers.filter((x) => normQ(x.name).includes(q) || normQ(x.plate).includes(q)).slice(0, 3)) out.push({ type: 'shipper', title: sh.name, sub: `${sh.vehicleName} · ${sh.capacity} kg` });
  }
  return out;
}
function pick(it) {
  closeSearch();
  sInput.value = '';
  sInput.blur();
  if (it.type === 'order') { openOrder(it.order, { go: ctx.go }); return; }
  if (it.type === 'page') { ctx.go(it.page); return; }
  if (it.type === 'shipper') { ctx.go(me.role === 'admin' ? 'dispatch' : 'myjob', me.role === 'admin' ? 'shippers' : undefined); return; }
  const id = it.id;
  if (current && current.wide) ctx.go(me.role === 'admin' ? 'network' : 'route');
  setTimeout(() => {
    map.focusNode(id);
    map.emit('nodeclick', id);   // mỗi trang xử lý như khi bấm điểm trên bản đồ
  }, current && current.wide ? 80 : 0);
}
function showSuggestions() {
  sItems = pageItems('');
  sActive = -1;
  if (sItems.length) renderSearch();
}
sInput.addEventListener('focus', () => { if (!sInput.value.trim()) showSuggestions(); });
sInput.addEventListener('input', () => {
  clearTimeout(sTimer);
  const raw = sInput.value.trim();
  if (!raw) { showSuggestions(); return; }
  sTimer = setTimeout(async () => {
    const seq = ++sSeq;
    const local = localItems(raw);
    let places = [];
    try {
      const res = await api.get('search', { q: raw, limit: 6 });
      places = res.items.map((it) => ({ type: 'place', id: it.id, title: it.name, sub: `${it.id === store.state.depot ? 'kho, ' : ''}#${it.id}` }));
    } catch (e) { toast(e.message, 'error'); }
    if (seq !== sSeq) return;   // đã có truy vấn mới hơn
    sItems = [...local.filter((x) => x.type === 'order'), ...local.filter((x) => x.type === 'shipper'), ...places, ...pageItems(normQ(raw))];
    sActive = sItems.length ? 0 : -1;
    renderSearch();
  }, 120);
});
sInput.addEventListener('keydown', (e) => {
  if (sList.hidden) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); sActive = Math.min(sItems.length - 1, sActive + 1); renderSearch(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); sActive = Math.max(0, sActive - 1); renderSearch(); }
  else if (e.key === 'Enter' && sItems[sActive]) { e.preventDefault(); pick(sItems[sActive]); }
  else if (e.key === 'Escape') closeSearch();
});
sList.addEventListener('mousedown', (e) => {
  const li = e.target.closest('li[data-i]');
  if (li) { e.preventDefault(); pick(sItems[Number(li.dataset.i)]); }
});
sInput.addEventListener('blur', () => setTimeout(closeSearch, 150));
// Phím tắt: / tìm, 1–9 chuyển trang, F vừa khung, K hiện km, +/− phóng to, ? xem danh sách
const KEYS = [
  ['Ctrl K', 'Tìm đơn, shipper, địa điểm, trang (⌘K trên Mac)'], ['/', 'Tìm nhanh'], ['1 … 0', 'Chuyển trang theo thanh dưới'], ['F', 'Vừa khung bản đồ'], ['A', 'Xem mọi điểm'],
  ['K', 'Hiện / ẩn số km'], ['+  −', 'Phóng to, thu nhỏ'], ['Ctrl Z', 'Hoàn tác'], ['Ctrl Y', 'Làm lại'], ['?', 'Danh sách phím tắt'],
];
function showKeys() {
  showModal('Phím tắt', `<table class="keys"><tbody>${KEYS.map(([k, d]) => `<tr><td>${d}</td><td>${k.split(' ').filter(Boolean).map((x) => (x === '…' ? '…' : `<kbd class="k">${x}</kbd>`)).join(' ')}</td></tr>`).join('')}</tbody></table>`);
}
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k' && me) {
    e.preventDefault();
    sInput.focus();
    sInput.select();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input, textarea, select, [contenteditable], dialog')) return;
  const k = e.key;
  if (k === '/') { e.preventDefault(); sInput.focus(); }
  else if (k === '?') { e.preventDefault(); showKeys(); }
  else if (/^[0-9]$/.test(k) && me) { const p = PAGES[k === '0' ? 9 : Number(k) - 1]; if (p) { e.preventDefault(); ctx.go(p.id); } }
  else if (current && current.wide) return;   // các phím dưới đây chỉ dành cho bản đồ
  else if (k === 'f' || k === 'F') { map.fitMain(true); map.setLegend(map._lastLegend || []); }
  else if (k === 'a' || k === 'A') { map.fitAll(); map.setLegend(map._lastLegend || []); }
  else if (k === 'k' || k === 'K') $('#toggle-km').click();
  else if (k === '+' || k === '=') map.zoom(1.3);
  else if (k === '-' || k === '_') map.zoom(1 / 1.3);
});

// Menu Tệp
const filesBtn = $('#btn-files'), filesMenu = $('#files-menu');
filesBtn.addEventListener('click', () => {
  filesMenu.hidden = !filesMenu.hidden;
  filesBtn.setAttribute('aria-expanded', String(!filesMenu.hidden));
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu')) { filesMenu.hidden = true; filesBtn.setAttribute('aria-expanded', 'false'); }
});
$('#btn-keys').addEventListener('click', () => { filesMenu.hidden = true; showKeys(); });
for (const b of $$('[data-export]')) {
  b.addEventListener('click', () => { filesMenu.hidden = true; downloadText(b.dataset.export); });
}
let importKind = null;
for (const b of $$('[data-import]')) {
  b.addEventListener('click', () => { importKind = b.dataset.import; filesMenu.hidden = true; $('#file-input').click(); });
}
$('#file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const text = await file.text();
  guard(async () => {
    store.set(await api.postText(`import/${importKind}`, text));
    if (importKind === 'map') map.fitMain();
    toast(`Đã nhập ${file.name}`);
    navigate();
  });
});

// Công cụ bản đồ
// Lớp dữ liệu trên bản đồ (nhớ lựa chọn của người dùng)
{
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('map.layers') || '{}'); } catch { /* bỏ qua */ }
  const layers = { routes: true, restricted: true, zone: false, ...saved };
  const apply = () => {
    map.setLayers(layers);
    for (const b of $$('[data-layer]')) b.setAttribute('aria-pressed', String(!!layers[b.dataset.layer]));
    try { localStorage.setItem('map.layers', JSON.stringify(layers)); } catch { /* bỏ qua */ }
  };
  for (const b of $$('[data-layer]')) b.addEventListener('click', () => { layers[b.dataset.layer] = !layers[b.dataset.layer]; apply(); });
  apply();
}
$('#zoom-in').addEventListener('click', () => map.zoom(1.3));
$('#zoom-out').addEventListener('click', () => map.zoom(1 / 1.3));
$('#zoom-fit').addEventListener('click', () => { map.fitMain(true); map.setLegend(map._lastLegend || []); });
$('#zoom-all').addEventListener('click', () => { map.fitAll(); map.setLegend(map._lastLegend || []); });
$('#toggle-km').addEventListener('click', (e) => {
  const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', String(on));
  map.setShowKm(on);
});

$('#crew-stack').addEventListener('click', () => { ctx.intent = 'shippers'; });
window.addEventListener('hashchange', navigate);

// ------------------------------------------------------- Đăng nhập / phân quyền
function applyRole(user) {
  me = user;
  document.body.classList.remove('role-admin', 'role-shipper', 'role-customer', 'logged-out');
  setViewer(user ? user.role : '');
  if (!user) { document.body.classList.add('logged-out'); PAGES = []; ALLOWED = []; return; }
  document.body.classList.add(`role-${user.role}`);
  const cfg = ROLE_PAGES[user.role] || { dock: [], extra: [] };
  const byId = (id) => ALL_PAGES.find((p) => p.id === id);
  PAGES = cfg.dock.map(byId).filter(Boolean);
  ALLOWED = [...cfg.dock, ...cfg.extra].map(byId).filter(Boolean);
  for (const a of $$('.dock a[data-page]')) a.classList.toggle('role-hidden', !cfg.dock.includes(a.dataset.page));
  // Sắp xếp thanh dưới theo thứ tự trang của vai trò
  const dock = $('.dock');
  dock.querySelectorAll('.dock-sep').forEach((x) => x.remove());
  let lastGroup = '';
  for (const id of cfg.dock) {
    const a = dock.querySelector(`a[data-page="${id}"]`);
    if (!a) continue;
    const grp = DOCK_GROUP[id] || '';
    if (lastGroup && grp !== lastGroup) { const sep = document.createElement('i'); sep.className = 'dock-sep'; sep.setAttribute('aria-hidden', 'true'); dock.append(sep); }
    lastGroup = grp;
    dock.append(a);
    const label = a.querySelector('span');
    if (label) a.title = label.textContent;   // thanh gọn chỉ hiện biểu tượng: tên trang nằm ở chú thích khi rê chuột
  }
  $('.brand').href = '#' + PAGES[0].id;
  const color = ROLE_COLOR[user.role];
  $('#btn-user').innerHTML = `${avatar(user.displayName, color, null, 'sm')}<span class="uc-text"><b>${escapeHtml(user.displayName)}</b><small>${ROLE_LABEL[user.role]}</small></span>`;
  $('#btn-user').setAttribute('aria-label', `Tài khoản: ${user.displayName} (${ROLE_LABEL[user.role]})`);
  $('#um-head').innerHTML = `<b>${escapeHtml(user.displayName)}</b><small>@${escapeHtml(user.username)}${user.email ? ` · ${escapeHtml(user.email)}` : ''}</small><span><span class="role-badge ${user.role}">${ROLE_LABEL[user.role]}</span>${user.tier ? ` <span class="role-badge">Hạng ${escapeHtml(user.tier.name)}</span>` : ''}${user.role === 'shipper' && user.shipper < 0 ? ' <span class="warn-text">chưa gắn với shipper nào trong đội xe</span>' : ''}</span>`;
}

function showLogin(message, kind) {
  leave();
  current = null;
  panel.innerHTML = '';
  store.state = null;
  setCsrf('');
  applyRole(null);
  closeBell();
  showAuth(message, kind);
}

async function enter(user, home) {
  setCsrf(user.csrf);
  applyRole(user);
  hideAuth();
  await store.refresh();
  // Vào trang chủ của vai trò nếu địa chỉ hiện tại không thuộc vai trò này
  const id = (location.hash || '').slice(1);
  if (!ALLOWED.some((p) => p.id === id)) history.replaceState(null, '', '#' + (home && ALLOWED.some((p) => p.id === home) ? home : PAGES[0].id));
  navigate();
  map.fitMain();
}

initAuth({
  async onLogin(user, home) {
    history.replaceState(null, '', location.pathname);
    await enter(user, home);
    toast(`Xin chào ${user.displayName}`);
  },
});
window.addEventListener('auth-required', () => { if (me) showLogin('Phiên đăng nhập đã hết hạn hoặc bị đăng xuất từ thiết bị khác. Hãy đăng nhập lại.'); });

const userBtn = $('#btn-user'), userMenu = $('#user-menu');
userBtn.addEventListener('click', () => {
  userMenu.hidden = !userMenu.hidden;
  userBtn.setAttribute('aria-expanded', String(!userMenu.hidden));
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.user-menu')) { userMenu.hidden = true; userBtn.setAttribute('aria-expanded', 'false'); }
});
userMenu.addEventListener('click', (e) => { if (e.target.closest('a')) userMenu.hidden = true; });
$('#btn-logout').addEventListener('click', async () => {
  userMenu.hidden = true;
  try { await api.post('logout'); } catch { /* vẫn đăng xuất phía giao diện */ }
  history.replaceState(null, '', location.pathname);
  showLogin('Bạn đã đăng xuất.', 'info');
});
$('#btn-password').addEventListener('click', () => {
  userMenu.hidden = true;
  ctx.go('profile', { focus: 'password' });
});

// ------------------------------------------------------- Thông báo trong ứng dụng
const bellBtn = $('#btn-bell'), bellMenu = $('#bell-menu');
let lastUnread = -1;
function setBell(n) {
  const el = $('#bell-count');
  el.hidden = !n;
  el.textContent = n > 99 ? '99+' : String(n);
  bellBtn.setAttribute('aria-label', n ? `Thông báo: ${n} chưa đọc` : 'Thông báo');
  lastUnread = n;
}
function closeBell() { bellMenu.hidden = true; bellBtn.setAttribute('aria-expanded', 'false'); }
const KIND_ICON = { order: '📦', trip: '🛵', account: '👤', cod: '💵', complaint: '💬', wallet: '👛' };
// Phân loại để lọc: không có trường mức độ ở backend nên suy ra từ nội dung (xem Giả định 56)
const NOTIF_TABS = [['all', 'Tất cả'], ['error', 'Khẩn'], ['success', 'Thành công'], ['info', 'Thông tin']];
function notifSeverity(n) {
  const t = String(n.text || '').toLowerCase();
  if (n.kind === 'complaint' || /huỷ|hủy|thất bại|từ chối|hết hạn|không |trễ|quá hạn|khoá|khóa|lỗi|chưa có shipper|bỏ qua/.test(t)) return 'error';
  if (/đã giao|thành công|hoàn thành|đã nhận|được duyệt|đã duyệt|xác nhận|đã nhận được|chi trả|cảm ơn|chào mừng/.test(t)) return 'success';
  return 'info';
}
let notifTab = 'all', notifData = null;
function drawBell() {
  const list = notifData.notifications.map((n) => ({ ...n, sev: notifSeverity(n) }));
  const count = (k) => (k === 'all' ? list.length : list.filter((n) => n.sev === k).length);
  const shown = notifTab === 'all' ? list : list.filter((n) => n.sev === notifTab);
  bellMenu.innerHTML = `<div class="nl-head"><b>Trung tâm thông báo</b>${notifData.unread ? '<button type="button" class="link" id="nl-all">Đọc hết</button>' : ''}</div>
    <div class="nl-tabs" role="tablist">${NOTIF_TABS.map(([k, l]) => `<button type="button" role="tab" class="${k === notifTab ? 'on' : ''} t-${k}" data-tab="${k}" aria-selected="${k === notifTab}">${l}<i>${count(k)}</i></button>`).join('')}</div>
    ${shown.length ? `<ul>${shown.map((n) => `<li><button type="button" class="${n.read ? '' : 'unread'} sev-${n.sev}" data-nid="${n.id}" data-order="${n.order}" data-kind="${n.kind}"><span class="nl-ic" aria-hidden="true">${KIND_ICON[n.kind] || '🔔'}</span><span><span class="nl-text">${escapeHtml(n.text)}</span><small>${when.ago(n.at)}</small></span></button></li>`).join('')}</ul>` : `<p class="empty">${notifData.notifications.length ? 'Không có thông báo nào trong mục này.' : 'Chưa có thông báo nào.'}</p>`}`;
  for (const t of bellMenu.querySelectorAll('[data-tab]')) t.addEventListener('click', () => { notifTab = t.dataset.tab; drawBell(); });
  $('#nl-all')?.addEventListener('click', () => guard(async () => { const r = await api.post('notifications/read-all'); setBell(r.unread); closeBell(); }));
  for (const b of bellMenu.querySelectorAll('[data-nid]')) b.addEventListener('click', () => guard(async () => {
    if (b.classList.contains('unread')) { const r = await api.post('notifications/read', { id: b.dataset.nid }); setBell(r.unread); }
    closeBell();
    const kind = b.dataset.kind, order = Number(b.dataset.order);
    const role = me.role;
    if (kind === 'complaint') ctx.go('complaints');
    else if (kind === 'cod') ctx.go('cod');
    else if (kind === 'wallet') ctx.go('wallet');
    else if (kind === 'trip') ctx.go(role === 'shipper' ? 'myjob' : 'dispatch');
    else if (kind === 'account') ctx.go(role === 'admin' ? 'accounts' : 'profile');
    else if (order > 0) openOrder(order, { go: ctx.go });
  }));
}
async function openBell() {
  bellMenu.hidden = false;
  bellBtn.setAttribute('aria-expanded', 'true');
  bellMenu.innerHTML = '<p class="empty">Đang tải…</p>';
  const res = await guard(() => api.get('notifications', { limit: 40 }));
  if (!res) { closeBell(); return; }
  setBell(res.unread);
  notifData = res;
  drawBell();
}
bellBtn.addEventListener('click', () => { if (bellMenu.hidden) openBell(); else closeBell(); });
document.addEventListener('click', (e) => { if (!e.target.closest('.bell-menu')) closeBell(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !bellMenu.hidden) { closeBell(); bellBtn.focus(); } });
// Hỏi nhẹ (api/me) mỗi 3 giây khi tab đang mở: `rev` đổi nghĩa là dữ liệu vừa thay đổi (lời mời mới, shipper nhận đơn, hết hạn...)
// thì mới tải lại state đầy đủ. Mỗi lần hỏi cũng kích hoạt đồng hồ ca / lời mời hết hạn / ghép đơn phía server.
let lastRev = -1, polling = false;
async function poll() {
  if (!me || document.hidden || polling) return;
  polling = true;
  try {
    const r = await api.get('me');
    setSys(true);
    if (!r.user) return;
    const changed = r.rev !== undefined && r.rev !== lastRev;
    const unreadUp = r.user.unread > lastUnread && lastUnread >= 0;
    if (changed || r.user.unread !== lastUnread) {
      lastRev = r.rev;
      if (lastRev !== undefined) await store.refresh();
      if (unreadUp) toast('Bạn có thông báo mới');
      setBell(r.user.unread);
    }
  } catch { setSys(false); /* mất kết nối tạm thời: thử lại lần sau */ } finally { polling = false; }
}
setInterval(poll, 3000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
// Mỗi giây báo cho trang đang mở (nếu có onTick) để xe di chuyển và đồng hồ đếm ngược chạy mượt giữa hai lần tải state
setInterval(() => { if (me && !document.hidden && current && current.onTick && store.state) current.onTick(store.state); }, 1000);

// Khởi động: đã đăng nhập (cookie còn hạn) thì vào thẳng, không thì hiện trang khách
(async () => {
  let res;
  try {
    res = await api.get('me');
  } catch (e) {
    applyRole(null);
    document.body.classList.remove('logged-out');
    panel.innerHTML = `<div class="notice error"><b>Không kết nối được backend C++.</b><br>${escapeHtml(e.message)}<br>Hãy chạy chương trình <code>delivery</code> rồi mở lại trang http://localhost:8080.</div>`;
    return;
  }
  lastRev = res.rev !== undefined ? res.rev : -1;
  if (res.user) await enter(res.user);
  else showLogin();
})();
