// Trang Tài khoản (quản trị viên): hàng chờ duyệt shipper (Min-Heap: ai đăng ký trước duyệt trước),
// danh sách tài khoản có tìm kiếm không dấu, lọc theo vai trò / trạng thái, sắp xếp, phân trang.
// Vòng đời: Chờ duyệt -> Hoạt động -> Bị khoá / Vô hiệu hoá (khoá, vô hiệu hoá, từ chối đều cần lý do; mọi thao tác ghi nhật ký).
// Chỉ quản trị viên quản lý tài khoản (tạo / sửa / xoá, duyệt shipper, khoá / mở khoá).
import { api } from '../api.js';
import { escapeHtml } from '../store.js';
import {
  $, when, money, guard, guardForm, toast, avatar, askReason, confirmBox, pager, bindPager, debounce, passwordInput, bindPasswordRules,
  normalizePhone, ROLE_COLOR, ROLE_LABEL, preserveFocus,
} from '../ui.js';

let ctx, root;
let data = null, queue = [], editing = null, q = '', role = '', status = '', sort = 'created:desc', page = 1, seq = 0;

const ROLES = ['admin', 'shipper', 'customer'];
const STATUSES = [{ v: 'active', label: 'Hoạt động' }, { v: 'pending', label: 'Chờ duyệt' }, { v: 'locked', label: 'Bị khoá' }, { v: 'disabled', label: 'Vô hiệu hoá' }];
const SORTS = [{ v: 'created:desc', label: 'Mới đăng ký' }, { v: 'login:desc', label: 'Đăng nhập gần đây' }, { v: 'name:asc', label: 'Tên A–Z' }, { v: 'username:asc', label: 'Tên đăng nhập' }, { v: 'role:asc', label: 'Vai trò' }, { v: 'status:asc', label: 'Trạng thái' }];
const ROLE_NOTE = {
  admin: 'Toàn quyền: bản đồ, đơn, đội xe, ghép đơn, cấu hình, tài khoản, sổ COD, khiếu nại, nhật ký kiểm toán',
  shipper: 'Bật sẵn sàng, nhận / bỏ qua lời mời, giao bằng mã xác nhận, báo thất bại, nộp tiền thu hộ, đánh giá khách',
  customer: 'Đặt đơn có báo giá, theo dõi shipper trực tiếp, huỷ có lý do, đánh giá shipper, khiếu nại',
};
const isAdmin = () => ctx.store.state.me.role === 'admin';

async function load() {
  const s = ++seq;
  const [key, dir] = sort.split(':');
  const [list, qu] = await Promise.all([api.get('users', { q, role, status, sort: key, dir, page, size: 10 }), api.get('users/queue')]);
  if (s !== seq || !root) return;
  data = list;
  queue = qu.queue;
  page = list.page.page;
  render();
}
const reload = debounce(() => guard(load), 250);

function statusChip(u) {
  const cls = { active: 'ok', pending: 'violet', locked: 'late', disabled: 'muted' }[u.status] || '';
  return `<span class="chip ${cls}">${escapeHtml(u.statusName)}</span>${u.statusReason ? `<br><small class="muted">${escapeHtml(u.statusReason)}</small>` : ''}`;
}
function actions(u) {
  if (u.self) return '<small class="muted">(bạn)</small>';
  if (!u.manage) return '';
  const main = [], more = [];
  const st = (to, label, cls = 'ghost') => `<button class="btn small ${cls}" data-st="${to}" data-u="${u.username}">${label}</button>`;
  if (u.status === 'pending') main.push(st('active', 'Duyệt', 'primary'), st('disabled', 'Từ chối', 'ghost danger'));
  if (u.status === 'locked') main.push(st('active', 'Mở khoá', ''));
  if (u.status === 'disabled') main.push(st('active', 'Kích hoạt lại', ''));
  if (isAdmin()) main.push(`<button class="btn small ghost" data-edit="${u.username}">Sửa</button>`);
  // thao tác ít dùng / nguy hiểm gom vào menu "…"
  if (u.status === 'active') more.push(st('locked', 'Khoá', 'ghost danger'));
  if (u.status === 'active' || u.status === 'locked') more.push(st('disabled', 'Vô hiệu hoá'));
  if (isAdmin()) more.push(`<button class="btn small ghost danger" data-del="${u.username}">Xoá</button>`);
  const menu = more.length ? `<details class="kebab"><summary aria-label="Thêm thao tác cho @${u.username}" title="Thêm thao tác">⋯</summary><div class="kebab-menu">${more.join('')}</div></details>` : '';
  return `<div class="acts">${main.join(' ')}${menu}</div>`;
}
function infoCell(u) {
  if (u.role === 'shipper') {
    const veh = u.vehicleName ? `${escapeHtml(u.vehicleName)}${u.capacity ? `, ${u.capacity} kg` : ''}${u.plate ? ` · ${escapeHtml(u.plate)}` : ''}` : '';
    const link = u.status === 'pending' ? '<small class="muted">sẽ vào đội xe khi được duyệt</small>' : u.linkOk ? `<small>đội xe: ${escapeHtml(u.link)}${u.ready === false ? ' · tạm nghỉ' : ''}</small>` : `<span class="warn-text">${escapeHtml(u.link || 'chưa gắn')} (không có trong đội xe)</span>`;
    return `${veh}<br>${link}`;
  }
  if (u.role === 'customer') return `${u.tier ? `Hạng <b>${escapeHtml(u.tier.name)}</b> · ` : ''}${u.orders} đơn${u.spent ? `<br><small>đã chi ${money(u.spent)}</small>` : ''}`;
  return '<span class="muted">–</span>';
}

function formHtml(st) {
  const u = editing === 'new' ? null : data.users.find((x) => x.username === editing);
  const r = u ? u.role : 'customer';
  return `<form id="a-form" class="block inset acc-form" autocomplete="off" novalidate>
    <h2>${u ? `Sửa tài khoản @${escapeHtml(u.username)}` : 'Thêm tài khoản'}</h2>
    <div class="row">
      <label class="field"><span>Tên đăng nhập</span><input name="username" value="${u ? escapeHtml(u.username) : ''}" ${u ? 'readonly' : ''} maxlength="20" placeholder="vd: nguyenvana" autocapitalize="none" spellcheck="false"></label>
      <label class="field"><span>Họ tên</span><input name="displayName" value="${u ? escapeHtml(u.displayName) : ''}" maxlength="40" placeholder="Nguyễn Văn A"></label>
    </div>
    <div class="row">
      <label class="field"><span>Email</span><input name="email" type="email" value="${u ? escapeHtml(u.email) : ''}" maxlength="80"></label>
      <label class="field"><span>Số điện thoại</span><input name="phone" type="tel" value="${u ? escapeHtml(u.phone) : ''}" maxlength="13"></label>
    </div>
    <div class="row">
      <label class="field"><span>Vai trò</span><select name="role">${ROLES.map((x) => `<option value="${x}" ${x === r ? 'selected' : ''}>${ROLE_LABEL[x]}</option>`).join('')}</select></label>
      <label class="field" id="a-link-field"><span>Gắn với shipper trong đội xe</span><select name="link">${st.shippers.map((s) => `<option value="${escapeHtml(s.name)}" ${u && u.link === s.name ? 'selected' : ''}>${escapeHtml(s.name)} (${escapeHtml(s.vehicleName)})</option>`).join('') || '<option value="">Đội xe chưa có shipper</option>'}</select></label>
    </div>
    <p class="muted small" id="a-role-note" style="margin:-4px 0 10px"></p>
    <div class="field"><span><label for="a-pass">${u ? 'Đặt lại mật khẩu (để trống nếu giữ nguyên)' : 'Mật khẩu'}</label></span>${passwordInput('password', { id: 'a-pass', autocomplete: 'new-password' })}<ul class="pw-rules" id="a-rules"></ul></div>
    <div class="actions"><button class="btn primary">${u ? 'Lưu' : 'Tạo tài khoản'}</button><button type="button" class="btn ghost" id="a-close">Đóng</button></div>
  </form>`;
}

function render() { preserveFocus(root, draw); }
function draw() {
  const st = ctx.store.state;
  if (!data) { root.innerHTML = '<div class="page-head"><h1>Tài khoản</h1></div><p class="empty">Đang tải…</p>'; return; }
  const br = data.byRole, bs = data.byStatus;
  root.innerHTML = `<div class="page-head"><h1>Tài khoản</h1>${isAdmin() ? '<button class="btn small primary" id="a-new">Thêm tài khoản</button>' : ''}</div>
    <div class="report-grid">
      <div class="block span-2"><div class="tiles">
        ${['customer', 'shipper', 'admin'].filter((x) => br[x] !== undefined || isAdmin()).map((x) => `<button class="tile as-btn" data-role-tile="${x}"><b>${br[x] || 0}</b><span>${ROLE_LABEL[x].toLowerCase()}</span></button>`).join('')}
        <button class="tile as-btn" data-status-tile="pending"><b>${bs.pending || 0}</b><span>chờ duyệt</span></button>
        <button class="tile as-btn" data-status-tile="locked"><b>${bs.locked || 0}</b><span>bị khoá</span></button>
      </div></div>
      ${editing ? `<div class="block span-2">${formHtml(st)}</div>` : ''}
      ${queue.length ? `<div class="block span-2">
        <h2>Hàng chờ duyệt shipper <span class="count">${queue.length}</span></h2>
        <div class="table-wrap"><table class="data"><thead><tr><th>#</th><th>Người đăng ký</th><th>Liên hệ</th><th>Phương tiện</th><th>Đăng ký lúc</th><th></th></tr></thead><tbody>
          ${queue.map((u) => `<tr><td>${u.position}</td><td><div class="who">${avatar(u.displayName, ROLE_COLOR.shipper, null, 'sm')}<span>${escapeHtml(u.displayName)}<br><small>@${escapeHtml(u.username)}</small></span></div></td>
            <td>${escapeHtml(u.email)}<br><small>${escapeHtml(u.phone)}</small></td><td>${escapeHtml(u.vehicleName || '–')}, ${u.capacity || '?'} kg<br><small>${escapeHtml(u.plate || '')}</small></td>
            <td>${when.full(u.createdAt)}<br><small>${when.ago(u.createdAt)}</small></td>
            <td class="num nowrap"><button class="btn small primary" data-st="active" data-u="${u.username}">Duyệt</button> <button class="btn small ghost danger" data-st="disabled" data-u="${u.username}">Từ chối</button></td></tr>`).join('')}
        </tbody></table></div>
      </div>` : ''}
      <div class="block span-2">
        <div class="list-tools">
          <label class="search-box"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20 20"/></svg><input type="search" id="a-search" placeholder="Tìm tên, tên đăng nhập, email, SĐT (không dấu được)" value="${escapeHtml(q)}" aria-label="Tìm tài khoản"></label>
          <label class="sort-box"><span class="sr-only">Trạng thái</span><select id="a-status"><option value="">Mọi trạng thái</option>${STATUSES.map((x) => `<option value="${x.v}" ${x.v === status ? 'selected' : ''}>${x.label}${bs[x.v] ? ` (${bs[x.v]})` : ''}</option>`).join('')}</select></label>
          <label class="sort-box"><span class="sr-only">Sắp xếp</span><select id="a-sort">${SORTS.map((s) => `<option value="${s.v}" ${s.v === sort ? 'selected' : ''}>${s.label}</option>`).join('')}</select></label>
        </div>
        <div class="chips filter-chips" aria-label="Lọc vai trò"><button type="button" class="chip ${role === '' ? 'on' : ''}" data-role="">Mọi vai trò</button>${Object.keys(br).map((x) => `<button type="button" class="chip ${role === x ? 'on' : ''}" data-role="${x}">${ROLE_LABEL[x]} <em>${br[x]}</em></button>`).join('')}</div>
        ${data.users.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Tài khoản</th><th>Vai trò</th><th>Trạng thái</th><th>Liên hệ</th><th>Thông tin</th><th></th></tr></thead><tbody>
          ${data.users.map((u) => `<tr>
            <td><div class="who">${avatar(u.displayName, ROLE_COLOR[u.role], null, 'sm')}<span>${escapeHtml(u.displayName)}<br><small>@${escapeHtml(u.username)} · ${u.lastLogin ? when.ago(u.lastLogin) : 'chưa đăng nhập'}</small></span></div></td>
            <td><span class="role-badge ${u.role}">${escapeHtml(u.roleName)}</span></td>
            <td>${statusChip(u)}</td>
            <td>${escapeHtml(u.email || '–')}<br><small>${escapeHtml(u.phone || '')}</small></td>
            <td>${infoCell(u)}</td>
            <td class="num acts-cell">${actions(u)}</td></tr>`).join('')}
        </tbody></table></div>${pager(data.page)}` : `<p class="empty">${q ? `Không có tài khoản nào khớp “${escapeHtml(q)}”.` : 'Không có tài khoản nào.'}</p>`}
      </div>
    </div>`;
  bind();
}

function bind() {
  $('#a-new', root)?.addEventListener('click', () => { editing = 'new'; render(); $('#a-form input[name=username]', root).focus(); });
  const s = $('#a-search', root);
  s.addEventListener('input', () => { q = s.value.trim(); page = 1; reload(); });
  $('#a-sort', root).addEventListener('change', (e) => { sort = e.target.value; page = 1; guard(load); });
  for (const b of root.querySelectorAll('[data-role]')) b.addEventListener('click', () => { role = b.dataset.role; page = 1; guard(load); });
  $('#a-status', root).addEventListener('change', (e) => { status = e.target.value; page = 1; guard(load); });
  for (const b of root.querySelectorAll('[data-role-tile]')) b.addEventListener('click', () => { role = b.dataset.roleTile; status = ''; page = 1; guard(load); });
  for (const b of root.querySelectorAll('[data-status-tile]')) b.addEventListener('click', () => { status = b.dataset.statusTile; role = ''; page = 1; guard(load); });
  bindPager(root, (p) => { page = p; guard(load); });
  for (const b of root.querySelectorAll('[data-st]')) b.addEventListener('click', () => changeStatus(b));
  for (const b of root.querySelectorAll('[data-edit]')) b.addEventListener('click', () => { editing = b.dataset.edit; render(); root.querySelector('#a-form').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  for (const b of root.querySelectorAll('[data-del]')) b.addEventListener('click', async () => {
    if (!(await confirmBox(`Xoá tài khoản @${b.dataset.del}?`, 'Đơn hàng của tài khoản này vẫn được giữ lại. Nên dùng “Vô hiệu hoá” nếu chỉ muốn chặn đăng nhập.', { ok: 'Xoá vĩnh viễn', danger: true }))) return;
    guard(async () => { const res = await api.post('users/remove', { username: b.dataset.del }); if (editing === b.dataset.del) editing = null; toast(res.message); await load(); });
  });
  bindKebabs();
  if (editing) bindForm();
}

async function changeStatus(b) {
  const to = b.dataset.st, user = b.dataset.u;
  const row = (data.users.find((x) => x.username === user) || queue.find((x) => x.username === user));
  const from = row ? row.status : '';
  let reason = '';
  if (to === 'locked' || to === 'disabled') {
    const title = from === 'pending' ? `Từ chối hồ sơ @${user}` : to === 'locked' ? `Khoá tài khoản @${user}` : `Vô hiệu hoá @${user}`;
    const presets = from === 'pending' ? ['Thiếu giấy tờ xe', 'Thông tin liên hệ không xác minh được', 'Đội xe đã đủ người'] : to === 'locked' ? ['Nghi ngờ gian lận', 'Nhiều khiếu nại chưa giải quyết', 'Chưa nộp tiền thu hộ'] : ['Theo yêu cầu của người dùng', 'Ngừng hợp tác'];
    reason = await askReason(title, { presets, note: 'Lý do được gửi tới người dùng qua email và ghi vào nhật ký kiểm toán. Tài khoản sẽ bị đăng xuất khỏi mọi thiết bị.', ok: from === 'pending' ? 'Từ chối' : 'Xác nhận' });
    if (!reason) return;
  }
  guard(async () => {
    const res = await api.post('users/status', { username: user, status: to, reason });
    toast(res.message);
    await Promise.all([load(), ctx.store.refresh()]);
  }, b);
}

// Menu ⋯ nằm trong .table-wrap (overflow) nên đặt fixed theo toạ độ nút để không bị cắt.
function closeKebabs(except) {
  for (const d of root ? root.querySelectorAll('details.kebab[open]') : []) if (d !== except) d.open = false;
}
const kebabOutside = (e) => { if (!e.target.closest?.('details.kebab')) closeKebabs(null); };
let kebabAt = 0;
const kebabScroll = () => { if (Date.now() - kebabAt > 250) closeKebabs(null); };

function bindKebabs() {
  for (const d of root.querySelectorAll('details.kebab')) {
    d.addEventListener('toggle', () => {
      if (!d.open) return;
      closeKebabs(d);
      kebabAt = Date.now();
      const menu = d.querySelector('.kebab-menu');
      const r = d.querySelector('summary').getBoundingClientRect();
      const h = menu.offsetHeight;
      const limit = Math.min(window.innerHeight, root.parentElement.getBoundingClientRect().bottom);
      const up = r.bottom + h + 12 > limit && r.top > h + 12;
      menu.style.position = 'fixed';
      menu.style.left = 'auto';
      menu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
      menu.style.top = `${up ? r.top - h - 4 : r.bottom + 4}px`;
      // Tổ tiên có backdrop-filter làm gốc toạ độ cho fixed → bù phần lệch.
      const m = menu.getBoundingClientRect();
      const want = { x: r.right - m.width, y: up ? r.top - h - 4 : r.bottom + 4 };
      menu.style.top = `${parseFloat(menu.style.top) + (want.y - m.top)}px`;
      menu.style.right = `${parseFloat(menu.style.right) - (want.x - m.left)}px`;
    });
  }
}

function bindForm() {
  const f = $('#a-form', root);
  const sync = () => {
    $('#a-link-field', root).hidden = f.role.value !== 'shipper';
    $('#a-role-note', root).textContent = ROLE_NOTE[f.role.value];
  };
  f.role.addEventListener('change', sync);
  sync();
  bindPasswordRules(f.password, $('#a-rules', root), () => f.username.value.trim());
  $('#a-close', root).addEventListener('click', () => { editing = null; render(); });
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const params = {
      username: f.username.value.trim().toLowerCase(), displayName: f.displayName.value.trim(), role: f.role.value,
      link: f.role.value === 'shipper' ? f.link.value : '', password: f.password.value, email: f.email.value.trim(), phone: normalizePhone(f.phone.value),
    };
    guardForm(f, async () => {
      const res = await api.post(editing === 'new' ? 'users/add' : 'users/update', params);
      editing = null;
      toast(res.message);
      await Promise.all([load(), ctx.store.refresh()]);
    }, f.querySelector('button.primary'));
  });
}

export default {
  id: 'accounts',
  title: 'Tài khoản',
  wide: true,
  mount(panel, c) {
    ctx = c;
    root = document.createElement('div');
    panel.append(root);
    data = null;
    document.addEventListener('click', kebabOutside);
    addEventListener('scroll', kebabScroll, { capture: true, passive: true });
    render();
    guard(load);
  },
  unmount() {
    document.removeEventListener('click', kebabOutside);
    removeEventListener('scroll', kebabScroll, { capture: true });
    root = null; editing = null;
  },
  onState() { if (root && !editing) reload(); },
};
