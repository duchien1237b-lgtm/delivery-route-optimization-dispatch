// Trang Hồ sơ (mọi vai trò đã đăng nhập): sửa họ tên / email / SĐT (ảnh đại diện là chữ cái đầu của họ tên),
// đổi mật khẩu, xem và đăng xuất từng thiết bị. Khách hàng: sổ địa chỉ (gắn với điểm trên bản đồ, có địa chỉ mặc định)
// và hạng thành viên. Shipper: bật / tắt sẵn sàng, thông tin xe, thống kê cá nhân.
import { api } from '../api.js';
import { escapeHtml } from '../store.js';
import {
  $, fmt, money, when, guard, guardForm, toast, avatar, confirmBox, passwordInput, bindPasswordRules, normalizePhone,
  ROLE_COLOR, ROLE_LABEL,
} from '../ui.js';

let ctx, root;
let sessions = null, addresses = null, stats = null, editAddr = null, pickFor = null;

async function load() {
  const me = ctx.store.state.me;
  const jobs = [api.get('sessions').then((r) => { sessions = r.sessions; })];
  if (me.role === 'customer') jobs.push(api.get('addresses').then((r) => { addresses = r; }));
  if (me.role === 'shipper' && me.link) jobs.push(api.get('shipper/stats').then((r) => { stats = r; }).catch(() => { stats = null; }));
  await Promise.all(jobs);
  if (root) render();
}

function infoBlock(me) {
  return `<div class="block"><h2>Thông tin cá nhân</h2>
    <div class="profile-head">${avatar(me.displayName, ROLE_COLOR[me.role], null, 'lg')}<div><b>${escapeHtml(me.displayName)}</b><small>@${escapeHtml(me.username)} · <span class="role-badge ${me.role}">${ROLE_LABEL[me.role]}</span></small><small>Tham gia ${when.date(me.createdAt)} · đăng nhập gần nhất ${when.ago(me.lastLogin)}</small></div></div>
    <form id="p-info" novalidate>
      <label class="field"><span>Họ tên / tên cửa hàng</span><input name="displayName" value="${escapeHtml(me.displayName)}" maxlength="40" autocomplete="name"><small class="hint">Ảnh đại diện là chữ cái đầu của tên gọi.</small></label>
      <div class="row">
        <label class="field"><span>Email</span><input name="email" type="email" value="${escapeHtml(me.email)}" maxlength="80" autocomplete="email"></label>
        <label class="field"><span>Số điện thoại</span><input name="phone" type="tel" inputmode="numeric" value="${escapeHtml(me.phone)}" maxlength="13" autocomplete="tel"></label>
      </div>
      <div class="actions"><button class="btn primary">Lưu thay đổi</button></div>
    </form></div>`;
}

function passwordBlock() {
  return `<div class="block" id="password"><h2>Đổi mật khẩu</h2>
    <form id="p-pass" novalidate>
      <div class="field"><span><label for="pp-old">Mật khẩu hiện tại</label></span>${passwordInput('old', { id: 'pp-old' })}</div>
      <div class="field"><span><label for="pp-new">Mật khẩu mới</label></span>${passwordInput('new', { id: 'pp-new', autocomplete: 'new-password' })}<ul class="pw-rules" id="pp-rules"></ul></div>
      <div class="field"><span><label for="pp-confirm">Nhập lại mật khẩu mới</label></span>${passwordInput('confirm', { id: 'pp-confirm', autocomplete: 'new-password' })}</div>
      <p class="muted small">Sau khi đổi, các thiết bị khác đang đăng nhập tài khoản này sẽ bị đăng xuất.</p>
      <div class="actions"><button class="btn primary">Đổi mật khẩu</button></div>
    </form></div>`;
}

function sessionsBlock() {
  if (!sessions) return '<div class="block"><h2>Thiết bị đang đăng nhập</h2><p class="empty">Đang tải…</p></div>';
  return `<div class="block"><h2>Thiết bị đang đăng nhập <span class="count">${sessions.length}</span></h2>
    <ul class="device-list">${sessions.map((s) => `<li><div><b>${escapeHtml(s.device || 'Trình duyệt')}</b>${s.current ? ' <span class="chip ok">Thiết bị này</span>' : ''}<small>IP ${escapeHtml(s.ip || '?')} · đăng nhập ${when.full(s.created)} · hoạt động ${when.ago(s.lastSeen)}${s.remember ? ' · ghi nhớ 30 ngày' : ''}</small></div>
      <button class="btn small ghost ${s.current ? '' : 'danger'}" data-revoke="${escapeHtml(s.sid)}" data-current="${s.current ? 1 : 0}">${s.current ? 'Đăng xuất' : 'Đăng xuất thiết bị'}</button></li>`).join('')}</ul>
    ${sessions.length > 1 ? '<div class="actions"><button class="btn small" id="p-revoke-others">Đăng xuất mọi thiết bị khác</button></div>' : ''}</div>`;
}

function addressForm(a) {
  return `<form id="p-addr" class="block inset" novalidate>
    <h2>${a ? 'Sửa địa chỉ' : 'Thêm địa chỉ'}</h2>
    <div class="row">
      <label class="field"><span>Tên gợi nhớ</span><input name="label" maxlength="30" value="${escapeHtml(a ? a.label : '')}" placeholder="Nhà, Văn phòng, Kho…"></label>
      <label class="field"><span>Điểm trên bản đồ</span><select name="node">${ctx.store.nodeOptions(a ? a.node : pickFor, { includeEmpty: true, emptyLabel: 'Chọn hoặc bấm trên bản đồ' })}</select></label>
    </div>
    <div class="row">
      <label class="field"><span>Người nhận</span><input name="recipient" maxlength="60" value="${escapeHtml(a ? a.recipient : '')}"></label>
      <label class="field"><span>Số điện thoại</span><input name="phone" type="tel" inputmode="numeric" maxlength="13" value="${escapeHtml(a ? a.phone : '')}"></label>
    </div>
    <label class="field"><span>Địa chỉ chi tiết</span><input name="detail" maxlength="120" value="${escapeHtml(a ? a.detail : '')}" placeholder="Số nhà, tầng, toà nhà…"></label>
    <label class="check"><input type="checkbox" name="default" ${a && a.isDefault ? 'checked' : ''}> Đặt làm địa chỉ mặc định</label>
    <div class="actions"><button class="btn primary">${a ? 'Lưu' : 'Thêm địa chỉ'}</button><button type="button" class="btn ghost" id="p-addr-close">Đóng</button></div>
  </form>`;
}

function addressBlock() {
  if (!addresses) return '<div class="block"><h2>Sổ địa chỉ</h2><p class="empty">Đang tải…</p></div>';
  const list = addresses.addresses;
  const a = editAddr && editAddr !== 'new' ? list.find((x) => x.id === editAddr) : null;
  return `<div class="block"><div class="split"><h2>Sổ địa chỉ <span class="count">${list.length}/${addresses.max}</span></h2>${editAddr || list.length >= addresses.max ? '' : '<button class="btn small" id="p-addr-new">Thêm địa chỉ</button>'}</div>
    ${editAddr ? addressForm(a) : ''}
    ${list.length ? `<ul class="addr-list">${list.map((x) => `<li class="${x.isDefault ? 'def' : ''}" data-node="${x.node}"><div><b>${escapeHtml(x.label)}</b>${x.isDefault ? ' <span class="chip ok">Mặc định</span>' : ''}<small>${escapeHtml(x.recipient)} · ${escapeHtml(x.phone)} · ${escapeHtml(x.nodeName)}${x.detail ? ` · ${escapeHtml(x.detail)}` : ''}</small></div>
      <div class="nowrap">${x.isDefault ? '' : `<button class="btn small ghost" data-def="${x.id}">Mặc định</button>`}<button class="btn small ghost" data-edit="${x.id}">Sửa</button><button class="btn small ghost danger" data-del="${x.id}">Xoá</button></div></li>`).join('')}</ul>` : '<p class="empty">Chưa có địa chỉ nào. Thêm địa chỉ hay giao để đặt đơn nhanh hơn.</p>'}
  </div>`;
}

function shipperBlock(me) {
  return `<div class="block"><h2>Phương tiện &amp; nhận chuyến</h2>
    <label class="ready-toggle ${me.ready ? 'on' : ''}"><input type="checkbox" id="p-ready" ${me.ready ? 'checked' : ''}><span><b>${me.ready ? 'Sẵn sàng nhận chuyến' : 'Đang tạm nghỉ'}</b><small>Tắt khi bạn không thể nhận chuyến mới</small></span></label>
    <form id="p-veh" novalidate>
      <div class="row">
        <label class="field"><span>Loại xe</span><select name="vehicle">${['Xe máy', 'Ô tô', 'Xe tải'].map((l, i) => `<option value="${i}" ${me.vehicle === i ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span>Tải trọng (kg)</span><input name="capacity" type="number" min="1" max="5000" value="${me.capacity || ''}"></label>
      </div>
      <label class="field"><span>Biển số</span><input name="plate" maxlength="12" value="${escapeHtml(me.plate || '')}"></label>
      <div class="actions"><button class="btn primary">Lưu thông tin xe</button></div>
    </form></div>
    ${stats ? `<div class="block"><h2>Thống kê của bạn</h2><div class="tiles">
      <div class="tile"><b>${stats.delivered}</b><span>đơn đã giao</span></div>
      <div class="tile"><b>${fmt.num(stats.onTimeRate, 0)}%</b><span>đúng hạn</span></div>
      <div class="tile"><b>${stats.rating != null ? `${fmt.num(stats.rating, 1)}★` : '–'}</b><span>${stats.ratings} lượt đánh giá</span></div>
      <div class="tile"><b>${money(stats.income)}</b><span>thu nhập ước tính</span></div></div>
      <p class="muted small" style="margin-top:10px">Điểm tin cậy ${fmt.num(stats.score, 0)}/100 · nhận ${stats.accepted} chuyến · từ chối ${stats.declines} · thất bại ${stats.failed} · đang giữ thu hộ ${money(stats.codHeld)}</p></div>` : ''}`;
}

function render() {
  const me = ctx.store.state.me;
  root.innerHTML = `<div class="page-head"><h1>Hồ sơ</h1></div>
    <div>
      ${infoBlock(me)}
      ${passwordBlock()}
      ${me.role === 'customer' ? `<div class="block">${tierLine(me)}</div>${addressBlock()}` : ''}
      ${me.role === 'shipper' ? shipperBlock(me) : ''}
      ${sessionsBlock()}
    </div>`;
  accordionize(me);
  bind(me);
  drawMap();
}

// Mỗi khối trong hồ sơ thành một mục thu gọn được; chỉ khối chính mở sẵn (nhớ lựa chọn khi vẽ lại)
const openTitles = new Map();
function accordionize(me) {
  const defaultOpen = new Set(['Thông tin cá nhân', 'Phương tiện & nhận chuyến', 'Thống kê của bạn', 'Hạng thành viên']);
  const wantPw = ctx.intent && ctx.intent.focus === 'password';
  for (const blk of [...root.querySelectorAll(':scope > div > .block')]) {
    const h2 = [...blk.children].find((c) => c.tagName === 'H2');
    if (!h2 || blk.classList.contains('inset')) continue;
    const count = h2.querySelector('.count');
    const title = h2.firstChild.textContent.trim();
    const isOpen = openTitles.has(title) ? openTitles.get(title) : defaultOpen.has(title) || (wantPw && blk.id === 'password');
    const d = document.createElement('details');
    d.className = 'acc pr-acc';
    if (isOpen) d.open = true;
    if (blk.id) d.id = blk.id;
    const sum = document.createElement('summary');
    sum.innerHTML = `<span class="acc-t"></span>${count ? `<span class="acc-count">${count.textContent}</span>` : ''}<svg class="acc-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>`;
    sum.querySelector('.acc-t').textContent = title.replace(/&amp;/g, '&');
    h2.remove();
    const body = document.createElement('div');
    body.className = 'acc-body';
    blk.removeAttribute('id');
    while (blk.firstChild) body.append(blk.firstChild);
    d.append(sum, body);
    d.addEventListener('toggle', () => openTitles.set(title, d.open));
    blk.replaceWith(d);
  }
}
function tierLine(me) {
  const t = me.tier;
  return `<h2>Hạng thành viên</h2><div class="tier-card"><div><span>Hạng hiện tại</span><b>${escapeHtml(t.name)}</b><small>giảm ${Math.round(t.pct * 100)}% cước vận chuyển · đã giao ${t.done} đơn · tổng chi ${money(me.spent)}</small></div>
    ${t.next ? `<div class="tier-next"><small>Còn <b>${t.next.remaining}</b> đơn để lên <b>${escapeHtml(t.next.name)}</b> (giảm ${Math.round(t.next.pct * 100)}%)</small><div class="progress"><i style="width:${Math.min(100, Math.round((t.done / (t.done + t.next.remaining)) * 100))}%"></i></div></div>` : ''}</div>`;
}

function drawMap() {
  const styles = new Map();
  if (addresses) for (const a of addresses.addresses) styles.set(a.node, { badge: a.isDefault ? '★' : '•', badgeColor: 'var(--brand)', keep: true, tip: `${a.label}: ${a.recipient}` });
  if (pickFor != null) styles.set(Number(pickFor), { badge: '+', badgeColor: 'var(--road)', keep: true });
  ctx.map.setPaths([], { animate: false });
  ctx.map.setMarkers([]);
  ctx.map.setDim(false);
  ctx.map.setNodeStyles(styles);
  ctx.map.setLegend(addresses && addresses.addresses.length ? [{ type: 'badge', color: 'var(--brand)', label: '★ địa chỉ mặc định' }] : []);
}

function bind(me) {
  const fi = $('#p-info', root);
  fi.addEventListener('submit', (e) => {
    e.preventDefault();
    guardForm(fi, async () => {
      const res = await api.post('profile/update', { displayName: fi.displayName.value.trim(), email: fi.email.value.trim(), phone: normalizePhone(fi.phone.value) });
      toast(res.message);
      await ctx.store.refresh();
      ctx.refreshUser && ctx.refreshUser(ctx.store.state.me);
    }, fi.querySelector('button'));
  });
  const fp = $('#p-pass', root);
  bindPasswordRules(fp.new, $('#pp-rules', root), () => me.username);
  fp.addEventListener('submit', (e) => {
    e.preventDefault();
    guardForm(fp, async () => {
      if (fp.new.value !== fp.confirm.value) { const err = new Error('Mật khẩu nhập lại không khớp'); err.fields = { confirm: err.message }; throw err; }
      const res = await api.post('me/password', { old: fp.old.value, new: fp.new.value, confirm: fp.confirm.value });
      fp.reset();
      toast(res.message);
      await load();
    }, fp.querySelector('button'));
  });
  for (const b of root.querySelectorAll('[data-revoke]')) b.addEventListener('click', async () => {
    if (b.dataset.current === '1') { document.querySelector('#btn-logout').click(); return; }
    guard(async () => { const res = await api.post('sessions/revoke', { sid: b.dataset.revoke }); sessions = res.sessions; toast(res.message); render(); }, b);
  });
  $('#p-revoke-others', root)?.addEventListener('click', (e) => guard(async () => { const res = await api.post('sessions/revoke-others'); sessions = res.sessions; toast(res.message); render(); }, e.currentTarget));
  if (me.role === 'customer') bindAddresses();
  if (me.role === 'shipper') {
    $('#p-ready', root).addEventListener('change', (e) => guard(async () => { const res = await api.post('shipper/ready', { ready: e.target.checked ? 1 : 0 }); toast(res.message); await ctx.store.refresh(); }));
    const fv = $('#p-veh', root);
    fv.addEventListener('submit', (e) => {
      e.preventDefault();
      guardForm(fv, async () => {
        const res = await api.post('shipper/vehicle', { vehicle: fv.vehicle.value, capacity: fv.capacity.value, plate: fv.plate.value.trim().toUpperCase() });
        toast(res.message);
        await ctx.store.refresh();
      }, fv.querySelector('button'));
    });
  }
  if (location.hash === '#profile' && ctx.intent && ctx.intent.focus === 'password') setTimeout(() => { $('#password', root).scrollIntoView({ behavior: 'smooth' }); $('#pp-old', root).focus(); }, 60);
}

function bindAddresses() {
  $('#p-addr-new', root)?.addEventListener('click', () => { editAddr = 'new'; pickFor = null; render(); ctx.map.setHint('Bấm một điểm trên bản đồ để chọn địa chỉ'); });
  for (const b of root.querySelectorAll('[data-edit]')) b.addEventListener('click', () => { editAddr = Number(b.dataset.edit); render(); });
  for (const b of root.querySelectorAll('[data-def]')) b.addEventListener('click', () => guard(async () => { addresses = await api.post('addresses/default', { id: b.dataset.def }); toast(addresses.message); render(); }, b));
  for (const b of root.querySelectorAll('[data-del]')) b.addEventListener('click', async () => {
    if (!(await confirmBox('Xoá địa chỉ?', 'Các đơn đã đặt không bị ảnh hưởng.', { ok: 'Xoá', danger: true }))) return;
    guard(async () => { addresses = await api.post('addresses/remove', { id: b.dataset.del }); toast(addresses.message); render(); });
  });
  for (const li of root.querySelectorAll('.addr-list li')) li.addEventListener('click', (e) => { if (!e.target.closest('button')) ctx.map.focusNode(Number(li.dataset.node)); });
  const f = $('#p-addr', root);
  if (!f) return;
  $('#p-addr-close', root).addEventListener('click', () => { editAddr = null; pickFor = null; ctx.map.setHint(null); render(); });
  f.node.addEventListener('change', () => { pickFor = f.node.value === '' ? null : Number(f.node.value); drawMap(); });
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const params = { label: f.label.value.trim(), node: f.node.value, recipient: f.recipient.value.trim(), phone: normalizePhone(f.phone.value), detail: f.detail.value.trim(), default: f.default.checked ? 1 : 0 };
    if (editAddr !== 'new') params.id = editAddr;
    guardForm(f, async () => {
      addresses = await api.post(editAddr === 'new' ? 'addresses/add' : 'addresses/update', params);
      toast(addresses.message);
      editAddr = null; pickFor = null;
      ctx.map.setHint(null);
      render();
    }, f.querySelector('button.primary'));
  });
}

export default {
  id: 'profile',
  title: 'Hồ sơ',
  mount(panel, c) {
    ctx = c;
    root = document.createElement('div');
    panel.append(root);
    sessions = null; addresses = null; stats = null; editAddr = null; pickFor = null;
    render();
    guard(load);
    ctx.onMap('nodeclick', (id) => {
      const f = $('#p-addr', root);
      if (f) { f.node.value = String(id); f.node.dispatchEvent(new Event('change')); }
    });
  },
  unmount() { root = null; ctx.map.setHint(null); },
  onState() { /* hồ sơ không phụ thuộc trạng thái ca giao */ },
};
