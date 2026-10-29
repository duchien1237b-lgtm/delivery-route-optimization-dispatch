// Trang dành cho khách vãng lai (chưa đăng nhập): báo giá thử, tra cứu đơn bằng mã đơn + SĐT người nhận,
// đăng nhập (tên đăng nhập / email / SĐT, ghi nhớ, hiện mật khẩu), đăng ký khách hàng hoặc shipper,
// quên mật khẩu (mã 6 số qua email; bản demo có hộp thư giả lập) và đặt lại mật khẩu.
// Mọi kiểm tra ở đây chỉ để báo lỗi sớm, server kiểm tra lại toàn bộ.
import { api, setCsrf } from './api.js';
import { escapeHtml } from './store.js';
import {
  $, guard, toast, showModal, money, fmt, validate, normalizePhone, passwordInput, bindPasswordRules,
  setFieldError, clearFieldErrors, showFieldErrors, EVENT_LABEL,
} from './ui.js';

const DEMO = [
  { u: 'admin', p: 'admin123', role: 'Quản trị viên' },
  { u: 'tuan', p: 'shipper123', role: 'Shipper' },
  { u: 'anphat', p: 'khach123', role: 'Khách hàng' },
  { u: 'khachvip', p: 'HuongViet@2026', role: 'Khách VIP' },
  { u: 'cuahangmai', p: 'Mai@2026', role: 'Khách (chủ cửa hàng)' },
  { u: 'ctv_hung', p: 'Hung@2026', role: 'Shipper chờ duyệt' },
];
const BRAND_SVG = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M9 22.5 14 13l5 6 4.5-8.5" class="brand-route"/><circle cx="9" cy="22.5" r="2.6" class="brand-dot"/><circle cx="23.5" cy="10.5" r="2.6" class="brand-dot"/></svg>';

let el, onLogin, info = null, view = 'login', tool = 'quote', flash = null, resetEmail = '', lastUser = '';

export function initAuth(opts) {
  el = $('#login');
  onLogin = opts.onLogin;
}

export async function showAuth(message, kind = 'error') {
  flash = message ? { text: message, kind } : null;
  if (!['login', 'register', 'forgot', 'reset', 'done-register'].includes(view)) view = 'login';
  el.hidden = false;
  render();
  if (!info) {
    try { info = await api.get('public/info'); } catch { info = { nodes: [], tiers: [], demo: false }; }
    renderKeep();
  }
}

// Vẽ lại nhưng giữ chữ người dùng đã gõ và ô đang trỏ (thông tin công khai về muộn khi mạng chậm)
function renderKeep() {
  const vals = [...el.querySelectorAll('input[name], select[name], textarea[name]')]
    .map((i) => [i.form?.id || '', i.name, i.type === 'checkbox' || i.type === 'radio' ? i.checked : i.value]);
  const a = document.activeElement;
  const focused = a && el.contains(a) && a.name ? [a.form?.id || '', a.name, a.selectionStart, a.selectionEnd] : null;
  render();
  const find = (fid, name) => [...el.querySelectorAll(`[name="${name}"]`)].find((i) => (i.form?.id || '') === fid);
  for (const [fid, name, v] of vals) {
    const i = find(fid, name);
    if (!i) continue;
    if (typeof v === 'boolean') i.checked = v; else if (v !== '' && i.type !== 'file') i.value = v;
  }
  if (focused) { const i = find(focused[0], focused[1]); if (i) { i.focus(); try { i.setSelectionRange(focused[2], focused[3]); } catch { /* ô không hỗ trợ chọn */ } } }
}
export function hideAuth() { el.hidden = true; el.innerHTML = ''; }

function go(v, message, kind = 'info') {
  view = v;
  flash = message ? { text: message, kind } : null;
  render();
  const first = el.querySelector('.auth-card input:not([type=hidden]):not([tabindex="-1"])');
  // Chỉ tự trỏ vào ô đầu khi người dùng chưa bấm vào ô nào khác, tránh giật con trỏ khỏi ô đang gõ
  if (first) setTimeout(() => { const a = document.activeElement; if (!a || !el.contains(a) || !a.matches('input, select, textarea')) first.focus(); }, 30);
}

// ------------------------------------------------------------------ Khung trang
function render() {
  el.innerHTML = `<div class="guest">
    <header class="guest-top">
      <a class="guest-brand" href="#" aria-label="Trang chủ">${BRAND_SVG}<span><b>Giao Nhanh 08</b><small>Tìm đường &amp; điều phối giao hàng</small></span></a>
      <nav class="guest-nav" aria-label="Khách vãng lai">
        <button type="button" class="link" data-tool="quote">Báo giá</button>
        <button type="button" class="link" data-tool="track">Tra cứu đơn</button>
        <button type="button" class="btn small ghost" data-view="login">Đăng nhập</button>
        <button type="button" class="btn small primary" data-view="register">Đăng ký</button>
      </nav>
    </header>
    <div class="guest-grid">
      <section class="guest-hero" aria-labelledby="hero-title">
        <p class="eyebrow">Giao hàng nội thành trong ngày</p>
        <h1 id="hero-title">Đặt đơn một phút,<br>theo dõi tới tận cửa.</h1>
        <p class="lead">Cước tính theo đường ngắn nhất từ kho, shipper xác nhận giao bằng mã 4 số của người nhận, tiền thu hộ được đối soát minh bạch.</p>
        <div class="hero-stats">
          <span><b>${info ? info.nodes.length : '–'}</b> điểm giao</span>
          <span><b>${info ? info.shippers : '–'}</b> shipper</span>
          <span><b>${info ? info.delivered : '–'}</b> đơn đã giao</span>
        </div>
        <div class="guest-tool" id="guest-tool">
          <div class="tabs" role="tablist">
            <button role="tab" type="button" data-tool="quote" aria-selected="${tool === 'quote'}">Báo giá thử</button>
            <button role="tab" type="button" data-tool="track" aria-selected="${tool === 'track'}">Tra cứu đơn</button>
          </div>
          <div role="tabpanel">${tool === 'quote' ? quoteHtml() : trackHtml()}</div>
        </div>
        ${info && info.tiers && info.tiers.length ? `<div class="tier-strip" aria-label="Hạng thành viên">${info.tiers.map((t) => `<span><b>${escapeHtml(t.name)}</b><small>${t.minDone ? `từ ${t.minDone} đơn` : 'mặc định'} · giảm ${Math.round(t.pct * 100)}% cước</small></span>`).join('')}</div>` : ''}
      </section>
      <section class="auth-card" aria-live="polite">${cardHtml()}</section>
    </div>
  </div>`;
  bind();
}

// ------------------------------------------------------------------ Báo giá thử & tra cứu
function quoteHtml() {
  const nodes = info ? info.nodes : [];
  return `<form id="g-quote" class="g-form" novalidate>
    <label class="field"><span>Giao tới</span><select name="destination" required><option value="">Chọn điểm giao</option>${nodes.map((n) => `<option value="${n.id}">${escapeHtml(n.name)}</option>`).join('')}</select></label>
    <div class="row">
      <label class="field"><span>Khối lượng (kg)</span><input name="weight" type="number" min="0.1" step="0.1" value="2" inputmode="decimal"></label>
      <label class="field"><span>Thu hộ (đ)</span><input name="cod" type="number" min="0" step="1000" value="0" inputmode="numeric"></label>
    </div>
    <label class="check"><input type="checkbox" name="urgent"> Giao hoả tốc</label>
    <div id="g-quote-out" class="g-out" aria-live="polite"><p class="muted">Chọn điểm giao để xem cước. Kho: ${escapeHtml(info ? info.depot : '')}</p></div>
  </form>`;
}
function trackHtml() {
  return `<form id="g-track" class="g-form" novalidate>
    <div class="row">
      <label class="field"><span>Mã đơn</span><input name="code" inputmode="numeric" maxlength="9" placeholder="vd: 101" required></label>
      <label class="field"><span>SĐT người nhận</span><input name="phone" type="tel" inputmode="numeric" maxlength="13" placeholder="09xxxxxxxx" required></label>
    </div>
    <button class="btn primary">Tra cứu</button>
    <div id="g-track-out" class="g-out" aria-live="polite"></div>
  </form>`;
}
function bindQuote() {
  const f = $('#g-quote', el);
  if (!f) return;
  const out = $('#g-quote-out', el);
  let seq = 0;
  const run = async () => {
    if (!f.destination.value) return;
    const s = ++seq;
    try {
      const q = await api.get('quote', { destination: f.destination.value, weight: f.weight.value || 1, urgent: f.urgent.checked ? 1 : 0, cod: f.cod.value || 0 });
      if (s !== seq) return;
      if (!q.fee) { out.innerHTML = '<p class="muted">Chưa giao tới điểm này.</p>'; return; }
      const fe = q.fee;
      out.innerHTML = `<div class="quote-box"><div class="qb-total"><span>Cước dự kiến</span><b>${money(q.net)}</b></div>
        <dl class="qb-lines"><dt>Quãng đường</dt><dd>${fmt.km(fe.km)}</dd><dt>Cước mở đầu</dt><dd>${money(fe.base)}</dd><dt>Theo km</dt><dd>${money(fe.distance)}</dd>
        ${fe.weight ? `<dt>Phụ phí khối lượng</dt><dd>${money(fe.weight)}</dd>` : ''}${fe.urgent ? `<dt>Hoả tốc</dt><dd>${money(fe.urgent)}</dd>` : ''}${fe.cod ? `<dt>Phí thu hộ</dt><dd>${money(fe.cod)}</dd>` : ''}</dl>
        <p class="muted small">Đăng nhập để dùng mã giảm giá và được giảm theo hạng thành viên.</p></div>`;
    } catch (e) { if (s === seq) out.innerHTML = `<p class="field-err">${escapeHtml(e.message)}</p>`; }
  };
  for (const x of [f.destination, f.urgent]) x.addEventListener('change', run);
  for (const x of [f.weight, f.cod]) x.addEventListener('input', run);
  f.addEventListener('submit', (e) => { e.preventDefault(); run(); });
}
function bindTrack() {
  const f = $('#g-track', el);
  if (!f) return;
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const out = $('#g-track-out', el);
    guard(async () => {
      try {
        const r = await api.get('track', { code: f.code.value.trim(), phone: normalizePhone(f.phone.value) });
        const o = r.order;
        out.innerHTML = `<div class="track-box"><header><b>Đơn ${o.id}</b><span class="chip ${o.status === 2 ? 'ok' : o.status === 4 || o.status === 5 ? 'warn' : 'blue'}">${escapeHtml(o.statusName)}</span></header>
          <p>Giao tới ${escapeHtml(o.destination)}${o.urgent ? ' · hoả tốc' : ''}${o.carrier ? ` · shipper ${escapeHtml(o.carrier)}` : ''}${o.cod ? ` · thu hộ ${money(o.cod)}` : ''}</p>
          <ol class="steps">${r.steps.map((s) => `<li>${escapeHtml(EVENT_LABEL[s.type] || s.type)}${s.t != null ? ` <small>phút ${Math.round(s.t)} của ca</small>` : ''}</li>`).join('')}</ol></div>`;
      } catch (err) { out.innerHTML = `<p class="field-err" role="alert">${escapeHtml(err.message)}</p>`; }
    }, f.querySelector('button'));
  });
}

// ------------------------------------------------------------------ Thẻ đăng nhập / đăng ký
function flashHtml() {
  return flash ? `<p class="login-error ${flash.kind === 'error' ? '' : 'info'}" role="alert">${escapeHtml(flash.text)}</p>` : '';
}
function cardHtml() {
  if (view === 'register') return registerHtml();
  if (view === 'forgot') return forgotHtml();
  if (view === 'reset') return resetHtml();
  if (view === 'done-register') return doneHtml();
  return loginHtml();
}

function loginHtml() {
  return `<form id="f-login" class="auth-form" novalidate>
    <div class="login-brand">${BRAND_SVG}</div>
    <h2>Đăng nhập</h2>
    <p class="login-sub">Dùng tên đăng nhập, email hoặc số điện thoại.</p>
    ${flashHtml()}
    <label class="field"><span>Tài khoản</span><input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" value="${escapeHtml(lastUser)}" placeholder="tên đăng nhập, email hoặc SĐT" required></label>
    <div class="field"><span class="field-row"><label for="login-pass">Mật khẩu</label><button type="button" class="link" data-view="forgot">Quên mật khẩu?</button></span>${passwordInput('password', { id: 'login-pass' })}</div>
    <label class="check"><input type="checkbox" name="remember"> Ghi nhớ đăng nhập trên máy này (30 ngày)</label>
    <button class="btn primary block-btn" id="login-btn">Đăng nhập</button>
    <p class="auth-switch">Chưa có tài khoản? <button type="button" class="link" data-view="register">Đăng ký ngay</button></p>
    ${info && info.demo ? `<div class="login-demo"><span>Tài khoản dùng thử</span><div class="demo-list">${DEMO.map((d) => `<button type="button" data-demo="${d.u}" data-pass="${escapeHtml(d.p)}"><b>${d.role}</b><small>${d.u}</small></button>`).join('')}</div></div>` : ''}
  </form>`;
}

function registerHtml() {
  return `<form id="f-reg" class="auth-form" novalidate>
    <h2>Tạo tài khoản</h2>
    <p class="login-sub">Miễn phí. Khách hàng dùng được ngay; shipper cần được duyệt hồ sơ.</p>
    ${flashHtml()}
    <fieldset class="role-pick"><legend class="sr-only">Loại tài khoản</legend>
      <label><input type="radio" name="role" value="customer" checked><span><b>Khách hàng</b><small>Gửi hàng, theo dõi đơn</small></span></label>
      <label><input type="radio" name="role" value="shipper"><span><b>Shipper</b><small>Nhận chuyến, cần duyệt</small></span></label>
    </fieldset>
    <label class="field"><span>Họ tên hoặc tên cửa hàng</span><input name="displayName" autocomplete="name" maxlength="40" placeholder="Nguyễn Văn An" required></label>
    <label class="field"><span>Tên đăng nhập</span><input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="20" placeholder="vd: nguyenvanan" required><small class="hint">3–20 ký tự: chữ thường không dấu, số, dấu _ hoặc .</small></label>
    <div class="row">
      <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" maxlength="80" placeholder="ban@example.com" required></label>
      <label class="field"><span>Số điện thoại</span><input name="phone" type="tel" inputmode="numeric" autocomplete="tel" maxlength="13" placeholder="09xxxxxxxx" required></label>
    </div>
    <div class="field"><span><label for="reg-pass">Mật khẩu</label></span>${passwordInput('password', { id: 'reg-pass', autocomplete: 'new-password' })}<ul class="pw-rules" id="reg-rules" aria-label="Điều kiện mật khẩu"></ul></div>
    <div class="field"><span><label for="reg-confirm">Nhập lại mật khẩu</label></span>${passwordInput('confirm', { id: 'reg-confirm', autocomplete: 'new-password' })}</div>
    <div id="reg-shipper" class="ship-box" hidden>
      <p class="ship-note">Thông tin phương tiện (bắt buộc với shipper)</p>
      <div class="row">
        <label class="field"><span>Loại xe</span><select name="vehicle"><option value="">Chọn loại xe</option><option value="0">Xe máy</option><option value="1">Ô tô</option><option value="2">Xe tải</option></select></label>
        <label class="field"><span>Tải trọng (kg)</span><input name="capacity" type="number" min="1" max="5000" step="1" inputmode="numeric" placeholder="20"></label>
      </div>
      <label class="field"><span>Biển số xe</span><input name="plate" maxlength="12" autocapitalize="characters" placeholder="59A1-123.45"></label>
    </div>
    <div class="hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
    <label class="check"><input type="checkbox" name="terms"> <span>Tôi đồng ý với <button type="button" class="link" id="reg-terms">điều khoản sử dụng</button></span></label>
    <button class="btn primary block-btn">Tạo tài khoản</button>
    <p class="auth-switch">Đã có tài khoản? <button type="button" class="link" data-view="login">Đăng nhập</button></p>
  </form>`;
}

function forgotHtml() {
  return `<form id="f-forgot" class="auth-form" novalidate>
    <h2>Quên mật khẩu</h2>
    <p class="login-sub">Nhập email đã đăng ký. Chúng tôi gửi mã 6 số, có hiệu lực 10 phút và chỉ dùng được một lần.</p>
    ${flashHtml()}
    <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" value="${escapeHtml(resetEmail)}" required></label>
    <button class="btn primary block-btn">Gửi mã</button>
    <p class="auth-switch"><button type="button" class="link" data-view="reset">Tôi đã có mã</button> · <button type="button" class="link" data-view="login">Quay lại đăng nhập</button></p>
  </form>`;
}

function resetHtml() {
  return `<form id="f-reset" class="auth-form" novalidate>
    <h2>Đặt lại mật khẩu</h2>
    <p class="login-sub">Nhập mã 6 số trong email và mật khẩu mới. Mọi thiết bị đang đăng nhập sẽ bị đăng xuất.</p>
    ${flashHtml()}
    <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" value="${escapeHtml(resetEmail)}" required></label>
    <label class="field"><span>Mã xác nhận</span><input name="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="6 chữ số" class="otp" required></label>
    <div class="field"><span><label for="rs-pass">Mật khẩu mới</label></span>${passwordInput('password', { id: 'rs-pass', autocomplete: 'new-password' })}<ul class="pw-rules" id="rs-rules"></ul></div>
    <div class="field"><span><label for="rs-confirm">Nhập lại mật khẩu mới</label></span>${passwordInput('confirm', { id: 'rs-confirm', autocomplete: 'new-password' })}</div>
    <button class="btn primary block-btn">Đặt lại mật khẩu</button>
    ${info && info.demo ? '<div class="mailbox" id="mailbox"><button type="button" class="btn small ghost" id="mb-open">Mở hộp thư giả lập</button><p class="muted small">Bản demo không gửi email thật: thư được lưu trong hộp thư giả lập và in ra cửa sổ dòng lệnh của server.</p><div id="mb-list"></div></div>' : ''}
    <p class="auth-switch"><button type="button" class="link" data-view="forgot">Gửi lại mã</button> · <button type="button" class="link" data-view="login">Quay lại đăng nhập</button></p>
  </form>`;
}

function doneHtml() {
  const pending = flash && flash.kind === 'pending';
  return `<div class="auth-form done">
    <div class="done-ic ${pending ? 'wait' : ''}" aria-hidden="true">${pending ? '⏳' : '✓'}</div>
    <h2>${pending ? 'Đã gửi hồ sơ shipper' : 'Đăng ký thành công'}</h2>
    <p class="login-sub">${escapeHtml(flash ? flash.text : '')}</p>
    <button type="button" class="btn primary block-btn" data-view="login">${pending ? 'Về trang đăng nhập' : 'Đăng nhập ngay'}</button>
  </div>`;
}

// ------------------------------------------------------------------ Gắn sự kiện
function bind() {
  for (const b of el.querySelectorAll('[data-view]')) b.addEventListener('click', () => go(b.dataset.view));
  for (const b of el.querySelectorAll('[data-tool]')) b.addEventListener('click', () => { tool = b.dataset.tool; render(); $('#guest-tool', el).scrollIntoView({ block: 'nearest', behavior: 'smooth' }); });
  el.querySelector('.guest-brand').addEventListener('click', (e) => { e.preventDefault(); go('login'); });
  bindQuote();
  bindTrack();
  if (view === 'login') bindLogin();
  if (view === 'register') bindRegister();
  if (view === 'forgot') bindForgot();
  if (view === 'reset') bindReset();
}

function bindLogin() {
  const f = $('#f-login', el);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    clearFieldErrors(f);
    const u = f.username.value.trim();
    lastUser = u;
    if (!u) { setFieldError(f, 'username', 'Hãy nhập tên đăng nhập, email hoặc số điện thoại'); f.username.focus(); return; }
    if (!f.password.value) { setFieldError(f, 'password', 'Hãy nhập mật khẩu'); f.password.focus(); return; }
    guard(async () => {
      try {
        const res = await api.post('login', { username: u, password: f.password.value, remember: f.remember.checked ? 1 : 0 });
        setCsrf(res.user.csrf);
        flash = null;
        lastUser = '';
        await onLogin(res.user, res.home);
      } catch (err) {
        // 403 = mật khẩu đúng nhưng tài khoản chờ duyệt / bị khoá: báo rõ, không phải lỗi gõ sai
        flash = { text: err.message, kind: err.status === 403 ? 'info' : 'error' };
        render();
        const p = $('#login-pass', el);
        if (p) p.focus();
      }
    }, $('#login-btn', el));
  });
  for (const b of f.querySelectorAll('[data-demo]')) {
    b.addEventListener('click', () => { f.username.value = b.dataset.demo; f.password.value = b.dataset.pass; f.requestSubmit(); });
  }
}

function checkRegister(f, only) {
  const role = f.role.value;
  const v = {
    displayName: () => validate.displayName(f.displayName.value.trim()),
    username: () => validate.username(f.username.value.trim().toLowerCase()),
    email: () => validate.email(f.email.value.trim()),
    phone: () => validate.phone(normalizePhone(f.phone.value)),
    password: () => validate.password(f.password.value, f.username.value.trim()),
    confirm: () => (f.confirm.value && f.confirm.value === f.password.value ? '' : 'Mật khẩu nhập lại không khớp'),
    vehicle: () => (role !== 'shipper' || f.vehicle.value !== '' ? '' : 'Chọn loại phương tiện'),
    capacity: () => (role !== 'shipper' || (Number(f.capacity.value) > 0 && Number(f.capacity.value) <= 5000) ? '' : 'Tải trọng phải từ 1 đến 5000 kg'),
    plate: () => (role !== 'shipper' ? '' : validate.plate(f.plate.value.trim().toUpperCase())),
    terms: () => (f.terms.checked ? '' : 'Bạn cần đồng ý với điều khoản sử dụng'),
  };
  let firstBad = null;
  for (const [k, fn] of Object.entries(v)) {
    if (only && k !== only) continue;
    const msg = fn();
    const input = f.querySelector(`[name="${k}"]`);
    const old = f.querySelector(`.field-err[data-for="${k}"]`);
    if (old) old.remove();
    input.removeAttribute('aria-invalid');
    if (msg) { setFieldError(f, k, msg); if (!firstBad) firstBad = input; }
  }
  return firstBad;
}

function bindRegister() {
  const f = $('#f-reg', el);
  const ship = $('#reg-shipper', el);
  const syncRole = () => { ship.hidden = f.role.value !== 'shipper'; };
  for (const r of f.querySelectorAll('[name=role]')) r.addEventListener('change', syncRole);
  syncRole();
  bindPasswordRules(f.password, $('#reg-rules', el), () => f.username.value.trim());
  // Báo lỗi khi rời ô (không làm phiền lúc đang gõ)
  for (const name of ['displayName', 'username', 'email', 'phone', 'confirm', 'capacity', 'plate']) {
    f[name].addEventListener('blur', () => { if (f[name].value) checkRegister(f, name); });
  }
  $('#reg-terms', el).addEventListener('click', () => showModal('Điều khoản sử dụng', `<ol class="terms">
    <li>Bạn chịu trách nhiệm về thông tin hàng hoá, người nhận và tiền thu hộ khai báo trên đơn.</li>
    <li>Không gửi hàng cấm, hàng nguy hiểm theo quy định của pháp luật.</li>
    <li>Đơn đã phân công cho shipper bị huỷ sẽ tính phí huỷ theo biểu phí công bố (20% cước khi đã phân công, 50% khi đang giao).</li>
    <li>Shipper phải nhập đúng mã 4 số của người nhận khi giao và nộp đủ tiền thu hộ cuối ca.</li>
    <li>Thông tin cá nhân chỉ dùng để giao hàng và liên hệ; mật khẩu được lưu dưới dạng băm có muối.</li></ol>`));
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    clearFieldErrors(f);
    const bad = checkRegister(f);
    if (bad) { bad.focus(); return; }
    const role = f.role.value;
    const params = {
      role, displayName: f.displayName.value.trim(), username: f.username.value.trim().toLowerCase(), email: f.email.value.trim(),
      phone: normalizePhone(f.phone.value), password: f.password.value, confirm: f.confirm.value, terms: 1, website: f.website.value,
    };
    if (role === 'shipper') Object.assign(params, { vehicle: f.vehicle.value, capacity: f.capacity.value, plate: f.plate.value.trim().toUpperCase() });
    guard(async () => {
      try {
        const res = await api.post('register', params);
        lastUser = params.username;
        view = 'done-register';
        flash = { text: res.message, kind: res.status === 'pending' ? 'pending' : 'info' };
        render();
      } catch (err) {
        if (!showFieldErrors(f, err)) throw err;
        toast(err.message, 'error');
      }
    }, f.querySelector('button.primary'));
  });
}

function bindForgot() {
  const f = $('#f-forgot', el);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    clearFieldErrors(f);
    const email = f.email.value.trim();
    const bad = validate.email(email);
    if (bad) { setFieldError(f, 'email', bad); f.email.focus(); return; }
    guard(async () => {
      try {
        const res = await api.post('password/forgot', { email });
        resetEmail = email;
        go('reset', res.message, 'info');
      } catch (err) {
        if (!showFieldErrors(f, err)) throw err;
      }
    }, f.querySelector('button.primary'));
  });
}

function bindReset() {
  const f = $('#f-reset', el);
  bindPasswordRules(f.password, $('#rs-rules', el));
  f.otp.addEventListener('input', () => { f.otp.value = f.otp.value.replace(/\D/g, '').slice(0, 6); });
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    clearFieldErrors(f);
    let bad = null;
    const put = (k, m) => { if (m) { setFieldError(f, k, m); bad = bad || f[k]; } };
    put('email', validate.email(f.email.value.trim()));
    put('otp', /^[0-9]{6}$/.test(f.otp.value) ? '' : 'Mã gồm 6 chữ số');
    put('password', validate.password(f.password.value));
    put('confirm', f.confirm.value === f.password.value ? '' : 'Mật khẩu nhập lại không khớp');
    if (bad) { bad.focus(); return; }
    guard(async () => {
      try {
        const res = await api.post('password/reset', { email: f.email.value.trim(), otp: f.otp.value, password: f.password.value, confirm: f.confirm.value });
        resetEmail = '';
        go('login', res.message, 'info');
      } catch (err) {
        if (!showFieldErrors(f, err)) { flash = { text: err.message, kind: 'error' }; const keep = { email: f.email.value, otp: f.otp.value }; render(); const g = $('#f-reset', el); g.email.value = keep.email; g.otp.value = keep.otp; g.otp.focus(); g.otp.select(); }
      }
    }, f.querySelector('button.primary'));
  });
  const open = $('#mb-open', el);
  if (open) open.addEventListener('click', () => guard(async () => {
    const email = f.email.value.trim();
    if (validate.email(email)) { setFieldError(f, 'email', 'Nhập email để mở hộp thư'); f.email.focus(); return; }
    const res = await api.get('mailbox', { email });
    const list = $('#mb-list', el);
    list.innerHTML = res.mails.length ? res.mails.slice().reverse().map((m) => {
      const code = (m.body.match(/\b\d{6}\b/) || [])[0];
      return `<article class="mail"><header><b>${escapeHtml(m.subject)}</b><small>${new Date(m.at * 1000).toLocaleTimeString('vi-VN')}</small></header><p>${escapeHtml(m.body)}</p>${code ? `<button type="button" class="btn small" data-otp="${code}">Dùng mã ${code}</button>` : ''}</article>`;
    }).join('') : '<p class="muted small">Hộp thư trống.</p>';
    for (const b of list.querySelectorAll('[data-otp]')) b.addEventListener('click', () => { f.otp.value = b.dataset.otp; f.password.focus(); });
  }, open));
}
