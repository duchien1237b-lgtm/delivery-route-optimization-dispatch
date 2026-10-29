// So sánh từng phản hồi API giữa server C++ (HTTP) và engine JavaScript của bản một file trên cùng một kịch bản
// (khách vãng lai, quản trị, khách hàng, shipper, ghép đơn tự động kiểu Grab; COD, khiếu nại, hoàn tác, nhập dữ liệu, chia đơn...).
// Cách chạy: make && node tools/diff_standalone.mjs   (cần file chạy ./delivery đã build)
// Mỗi phản hồi được chuẩn hoá (bỏ thời gian, mã phiên, CSRF, mã giao 4 số ngẫu nhiên...) rồi so khớp từng trường;
// cuối cùng so các file dữ liệu hai bên đã ghi ra. Thoát với mã 1 nếu có khác biệt.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dt08-diff-'));
const PORT = 8097;
const dataDir = `${TMP}/data`;
fs.mkdirSync(dataDir);
const keep = (f) => f.endsWith('.txt') && !/^(my_|out_|orders_live)/.test(f);
for (const f of fs.readdirSync(`${ROOT}/data`)) if (keep(f)) fs.copyFileSync(`${ROOT}/data/${f}`, `${dataDir}/${f}`);

// ---- ghép engine như tools/build_standalone.mjs, thay localStorage/sessionStorage bằng Map để chạy trong Node
{
  const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
  const data = Object.fromEntries(fs.readdirSync(path.join(ROOT, 'data')).filter(keep).sort().map((f) => [f, read('data', f)]));
  const frags = fs.readdirSync(path.join(ROOT, 'standalone', 'engine')).filter((f) => f.endsWith('.js')).sort();
  const stub = `const __mk = () => { const m = new Map(); return { getItem: (k) => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; };
globalThis.localStorage = globalThis.localStorage || __mk();
globalThis.sessionStorage = globalThis.sessionStorage || __mk();`;
  const engine = frags.map((f) => `// ---- ${f}\n${read('standalone', 'engine', f)}`).join('\n');
  fs.writeFileSync(`${TMP}/engine_node.mjs`, `${stub}\nvar DATA = ${JSON.stringify(data)};\n${engine}\nexport { handle, exportText, S };\n`);
}

const srv = spawn(`${ROOT}/delivery`, ['--port', String(PORT), '--data', dataDir, '--web', `${ROOT}/web`], { stdio: ['ignore', 'ignore', 'ignore'] });
const BASE = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 50; i++) {
  try { await fetch(BASE + '/api/public/info'); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
}
const realLog = console.log;
console.log = (...a) => { if (!String(a[0]).startsWith('[MAIL]')) realLog(...a); };
const eng = await import(`${TMP}/engine_node.mjs`);

// ---- client C++: một trình duyệt (cookie + CSRF)
const C = { cookie: '', csrf: '', vars: {} };
async function cpp(method, path, params = {}) {
  const q = new URLSearchParams(params).toString();
  const headers = {};
  if (C.cookie) headers.Cookie = C.cookie;
  let res;
  if (method === 'GET') res = await fetch(`${BASE}/api/${path}${q ? '?' + q : ''}`, { headers });
  else if (params.body !== undefined && Object.keys(params).length === 1) {
    headers['Content-Type'] = 'text/plain; charset=utf-8';
    headers['X-CSRF-Token'] = C.csrf;
    res = await fetch(`${BASE}/api/${path}`, { method, headers, body: params.body });
  } else {
    headers['X-CSRF-Token'] = C.csrf;
    res = await fetch(`${BASE}/api/${path}`, { method, headers, body: new URLSearchParams(params) });
  }
  const sc = res.headers.get('set-cookie');
  if (sc) {
    const m = sc.match(/dt08_session=([^;]*)/);
    C.cookie = m && m[1] ? `dt08_session=${m[1]}` : '';
  }
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 50) }; }
  if (body && body.user && body.user.csrf) C.csrf = body.user.csrf;
  if (method === 'GET' && path === 'me' && !body.user) C.csrf = '';
  return { status: res.status, body };
}
// ---- client JS
const J = { vars: {} };
function js(method, path, params = {}) {
  try {
    const body = eng.handle(method, path, Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])));
    return { status: 200, body };
  } catch (e) {
    const body = { ok: false, error: e.message };
    if (e.fields) body.fields = e.fields;
    if (e.auth) body.auth = true;
    return { status: e.status || 500, body };
  }
}

const VOLATILE = new Set(['createdAt', 'lastLogin', 'at', 'created', 'updated', 'lastSeen', 'deliveredReal', 'settledAt', 'csrf', 'token', 'sid', 'micros', 'matrixMicros', 'when', 'device', 'ip', 'expires', 'offerLeft']);
function norm(x, key = '') {
  // Sao kê ví sắp theo giờ thật (giây): hai bên có thể lệch một giây nên chỉ so tập các dòng, không so thứ tự
  if (Array.isArray(x) && key === 'lines' && x.length && x[0] && 'tx' in x[0]) return x.map((v) => norm(v)).sort((p, q) => JSON.stringify(p).localeCompare(JSON.stringify(q)));
  if (Array.isArray(x)) return x.map((v) => norm(v));
  if (x && typeof x === 'object') {
    const o = {};
    for (const k of Object.keys(x).sort()) o[k] = (k === 'description' && /nút Lưu/.test(x[k])) || (k === 'name' && /^Dijkstra (std::priority_queue|hàng đợi ưu tiên)$/.test(x[k])) ? '~known' : VOLATILE.has(k) ? '~' : k === 'code' && /^\d{4}$/.test(x[k]) ? '~code' : norm(x[k], k);
    return o;
  }
  if (typeof x === 'string') return x.replace(/127\.0\.0\.1/g, 'local').replace(/\b\d{4}\b(?= cho| \(| hiển)/g, '~');
  return x;
}
function same(a, b, path, diffs) {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a))) return;
    diffs.push(`${path}: ${a} != ${b}`);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) diffs.push(`${path}: length ${a.length} != ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) same(a[i], b[i], `${path}[${i}]`, diffs);
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in a)) diffs.push(`${path}.${k}: missing in C++ (JS=${JSON.stringify(b[k]).slice(0, 80)})`);
      else if (!(k in b)) diffs.push(`${path}.${k}: missing in JS (C++=${JSON.stringify(a[k]).slice(0, 80)})`);
      else same(a[k], b[k], `${path}.${k}`, diffs);
    }
    return;
  }
  if (a !== b) diffs.push(`${path}: ${JSON.stringify(a)?.slice(0, 120)} != ${JSON.stringify(b)?.slice(0, 120)}`);
}

let steps = 0, bad = 0;
const statusCount = {};
async function step(label, method, path, params = {}, capture) {
  const p = typeof params === 'function' ? null : params;
  const a = await cpp(method, path, p || params(C.vars));
  const b = js(method, path, p || params(J.vars));
  steps++;
  statusCount[a.status] = (statusCount[a.status] || 0) + 1;
  const diffs = [];
  if (a.status !== b.status) diffs.push(`status ${a.status} != ${b.status}`);
  same(norm(a.body), norm(b.body), '', diffs);
  if (diffs.length) {
    bad++;
    console.log(`✗ ${label} ${method} ${path} [${a.status}]`);
    for (const d of diffs.slice(0, 12)) console.log('    ' + d);
    if (diffs.length > 12) console.log(`    ... ${diffs.length - 12} khác biệt nữa`);
  } else if (process.env.V) console.log(`✓ ${label} ${method} ${path} [${a.status}]` + (process.env.V === '2' && a.status >= 400 ? ' ' + a.body.error : ''));
  if (process.env.DUMP && label.includes(process.env.DUMP)) console.log(JSON.stringify(a.body, null, 1).slice(0, 4000));
  if (capture) { capture(a.body, C.vars); capture(b.body, J.vars); }
  return [a, b];
}
const login = (u, p, extra = {}) => step(`đăng nhập ${u}`, 'POST', 'login', { username: u, password: p, ...extra });
const logout = () => step('đăng xuất', 'POST', 'logout');

try {
  // ---------- Khách vãng lai
  await step('khách', 'GET', 'public/info');
  await step('khách', 'GET', 'state');
  await step('khách báo giá', 'GET', 'quote', { destination: 4, weight: 3, urgent: 1, cod: 200000 });
  await step('khách báo giá + mã', 'GET', 'quote', { destination: 4, weight: 3, promo: 'GIAM10' });
  await step('khách tra cứu sai', 'GET', 'track', { code: '101', phone: '0900000000' });
  await step('khách tra cứu đúng', 'GET', 'track', { code: '101', phone: '0909101101' });
  await step('khách xem đơn', 'GET', 'orders/list');
  await step('khách tạo đơn', 'POST', 'order/add', { destination: 3 });
  await step('đăng ký admin', 'POST', 'register', { role: 'admin', username: 'hack', password: 'Abcdef@123' });
  await step('đăng ký sai', 'POST', 'register', { role: 'customer', username: 'A', email: 'x', phone: '1', password: '123', confirm: '1' });
  await step('đăng ký bot', 'POST', 'register', { role: 'customer', website: 'spam.com' });
  await step('đăng ký khách', 'POST', 'register', { role: 'customer', username: 'minhkhoa', displayName: 'Minh Khoa', email: 'Khoa@Example.com', phone: '090 123 4567', password: 'Khoa@2026x', confirm: 'Khoa@2026x', terms: '1' });
  await step('đăng ký trùng', 'POST', 'register', { role: 'customer', username: 'minhkhoa', displayName: 'Minh Khoa', email: 'khoa@example.com', phone: '0901234567', password: 'Khoa@2026x', confirm: 'Khoa@2026x', terms: '1' });
  await step('đăng ký shipper', 'POST', 'register', { role: 'shipper', username: 'shipmoi', displayName: 'Anh Mới', email: 'shipmoi@example.com', phone: '0907777777', password: 'Ship@2026x', confirm: 'Ship@2026x', terms: 'on', vehicle: 1, capacity: '45', plate: '51a-123.45' });
  await login('shipmoi', 'Ship@2026x');
  await login('nobody', 'whatever1');
  await login('admin', 'sai-mat-khau');
  await step('quên mật khẩu', 'POST', 'password/forgot', { email: 'khoa@example.com' });
  await step('quên mật khẩu (email lạ)', 'POST', 'password/forgot', { email: 'ai@nowhere.vn' });
  await step('đặt lại sai mã', 'POST', 'password/reset', { email: 'khoa@example.com', otp: '000000', password: 'Khoa@2027x', confirm: 'Khoa@2027x' });
  await step('đặt lại mk yếu', 'POST', 'password/reset', { email: 'khoa@example.com', otp: '000000', password: '123', confirm: '123' });
  await step('hộp thư', 'GET', 'mailbox', { email: 'shipmoi@example.com' });

  // ---------- Quản trị viên
  await login('admin', 'admin123');
  await step('admin state', 'GET', 'state');
  await step('admin me', 'GET', 'me');
  await step('admin users', 'GET', 'users', { sort: 'username', dir: 'asc' });   // mặc định sắp theo giờ tạo: hai tài khoản tạo cùng giây làm kết quả phụ thuộc thời gian
  await step('admin users name', 'GET', 'users', { sort: 'name', dir: 'asc', size: 5, page: 2 });
  await step('admin users tìm', 'GET', 'users', { q: 'huong' });
  await step('admin users lọc', 'GET', 'users', { role: 'shipper', status: 'pending' });
  await step('hàng chờ duyệt', 'GET', 'users/queue');
  await step('duyệt shipmoi', 'POST', 'users/status', { username: 'shipmoi', status: 'active' });
  await step('duyệt lại', 'POST', 'users/status', { username: 'shipmoi', status: 'active' });
  await step('từ chối ctv_hung thiếu lý do', 'POST', 'users/status', { username: 'ctv_hung', status: 'disabled' });
  await step('từ chối ctv_hung', 'POST', 'users/status', { username: 'ctv_hung', status: 'disabled', reason: 'Thiếu giấy tờ xe' });
  await step('tự khoá mình', 'POST', 'users/status', { username: 'admin', status: 'locked', reason: 'thử' });
  await step('tạo vai trò điều phối (đã bỏ)', 'POST', 'users/add', { username: 'dp2', role: 'dispatcher', password: 'Dp2@2026xx', displayName: 'Điều phối 2', email: 'dp2@giaohang.vn', phone: '0908888001' });
  await step('tạo admin phụ', 'POST', 'users/add', { username: 'quanly2', role: 'admin', password: 'Ql2@2026xx', displayName: 'Quản lý Hai', email: 'ql2@giaohang.vn', phone: '0908888001' });
  await step('sửa admin phụ', 'POST', 'users/update', { username: 'quanly2', displayName: 'Quản lý Hai (sửa)' });
  await step('xoá admin phụ', 'POST', 'users/remove', { username: 'quanly2' });
  await step('tự xoá', 'POST', 'users/remove', { username: 'admin' });
  await step('mã giảm giá', 'GET', 'promos');
  await step('lưu mã', 'POST', 'promos/save', { code: 'thu50', type: 'amt', value: 5000, minFee: 20000, maxUses: 10, perUser: 1, description: 'Thử' });
  await step('lưu mã sai', 'POST', 'promos/save', { code: 'x', type: 'pct', value: 500 });
  await step('cấu hình', 'GET', 'config');
  await step('cấu hình sai', 'POST', 'config/update', { tiers: 'Đồng:0:0,Bạc:5' });
  await step('cấu hình sai 2', 'POST', 'config/update', { cancelOnRoute: '2' });
  await step('cấu hình ghép đơn sai', 'POST', 'config/update', { offerSeconds: 700 });
  await step('cấu hình ghép đơn sai 2', 'POST', 'config/update', { clockSpeed: 500 });
  await step('cấu hình pha 1: ghép tay, đồng hồ đứng', 'POST', 'config/update', { autoMatch: 0, clockSpeed: 0, offerSeconds: 600 });
  await step('cấu hình', 'POST', 'config/update', { perKm: '4500', tiers: 'Đồng:0:0,Bạc:3:0.03,Vàng:10:0.05,Kim cương:30:0.08' });
  await step('nhật ký', 'GET', 'audit', { action: 'auth' });
  await step('báo cáo admin', 'GET', 'reports/summary');
  await step('thêm shipper', 'POST', 'shipper/add', { name: 'Shipper Phụ', capacity: 15, vehicle: 0 });
  await step('sửa shipper', 'POST', 'shipper/update', { index: 4, name: 'Shipper Phụ 2', capacity: 18, vehicle: 0 });
  await step('xoá shipper', 'POST', 'shipper/remove', { index: 4 });
  await step('admin đường đi', 'GET', 'path', { src: 0, dst: 9, algo: 'astar', vehicle: 0, criterion: 'time', depart: 480 });
  await step('admin phân tích', 'GET', 'analysis', { vehicle: 0 });
  await step('admin k-paths', 'GET', 'kpaths', { src: 0, dst: 9, k: 3 });
  await step('admin bellman', 'GET', 'bellman', { src: 0 });
  await step('admin trace', 'GET', 'trace', { algo: 'dijkstra', src: 0, dst: 9 });
  await step('admin estimate', 'GET', 'estimate', { depot: 0, stops: '3,5,9', return: 1 });
  await step('admin components', 'GET', 'components');
  await step('admin zones', 'GET', 'zones', { depots: '0,7' });
  await step('admin traverse', 'GET', 'traverse', { start: 0, algo: 'bfs' });
  await step('admin search', 'GET', 'search', { q: 'cho' });
  await step('admin timeprofile', 'GET', 'timeprofile', { src: 0, dst: 9, step: 60 });
  await logout();

  // ---------- Khách hàng
  await login('khachvip', 'HuongViet@2026', { remember: '1' });
  await step('khách state', 'GET', 'state');
  await step('khách hồ sơ', 'GET', 'profile');
  await step('khách địa chỉ', 'GET', 'addresses', {}, (b, v) => { v.addr = b.addresses?.[0]?.id; });
  await step('thêm địa chỉ', 'POST', 'addresses/add', { label: 'Công ty', recipient: 'Lê Hương', phone: '0912345678', detail: 'Tầng 5', node: 4, default: '1' }, (b, v) => { v.addr2 = b.created; });
  await step('sửa địa chỉ', 'POST', 'addresses/update', (v) => ({ id: v.addr2, detail: 'Tầng 6' }));
  await step('địa chỉ người khác', 'POST', 'addresses/remove', { id: 1 });
  await step('báo giá khách', 'GET', 'quote', { destination: 4, weight: 3, promo: 'GIAM10' });
  await step('đặt đơn', 'POST', 'order/add', (v) => ({ address: v.addr2, weight: 8, urgent: 1, note: 'Hồ sơ gấp', promo: 'GIAM10' }), (b, v) => { v.o1 = b.created; });
  await step('đặt đơn thiếu', 'POST', 'order/add', { destination: 5 });
  await step('đặt đơn COD', 'POST', 'order/add', { destination: 9, weight: 1.5, recipient: 'Anh Bảo', phone: '0933333333', cod: 150000 }, (b, v) => { v.o2 = b.created; });
  await step('đặt đơn 3', 'POST', 'order/add', { destination: 6, weight: 2, recipient: 'Chị Hà', phone: '0944444444' }, (b, v) => { v.o3 = b.created; });
  await step('xem đơn mình', 'GET', 'order/get', (v) => ({ id: v.o1 }), (b, v) => { v.code1 = b.order?.code; });
  await step('xem đơn 2', 'GET', 'order/get', (v) => ({ id: v.o2 }), (b, v) => { v.code2 = b.order?.code; });
  await step('xem đơn người khác', 'GET', 'order/get', { id: 101 });
  await step('xem đơn không có', 'GET', 'order/get', { id: 99999 });
  await step('hoá đơn', 'GET', 'order/invoice', (v) => ({ id: v.o1 }));
  await step('danh sách đơn', 'GET', 'orders/list', { sort: 'net', dir: 'asc' });
  await step('khách huỷ đơn 3', 'POST', 'order/cancel', (v) => ({ id: v.o3, reason: 'Đổi ý' }));
  await step('khách huỷ lại', 'POST', 'order/cancel', (v) => ({ id: v.o3 }));
  await step('khách vào trang admin', 'GET', 'users');
  await step('khách điều phối', 'GET', 'dispatch');
  await step('khiếu nại đơn người khác', 'POST', 'complaint/add', { order: 101, title: 'Chậm', body: 'Giao chậm quá' });
  await step('khiếu nại', 'POST', 'complaint/add', (v) => ({ order: v.o1, title: 'Hỏi tiến độ', body: 'Bao giờ giao vậy shop?' }), (b, v) => { v.cpl = b.id; });
  await step('khiếu nại của mình', 'GET', 'complaints');
  await step('khiếu nại người khác', 'GET', 'complaints', { id: 1 });
  await step('thông báo', 'GET', 'notifications');
  await step('đọc hết', 'POST', 'notifications/read-all');
  await step('báo cáo khách', 'GET', 'reports/summary');
  await step('sửa hồ sơ', 'POST', 'profile/update', { displayName: 'Lê Thị Hương', phone: '0911000003' });
  await step('phiên', 'GET', 'sessions');
  await logout();

  // ---------- Điều phối viên
  await login('admin', 'admin123');
  await step('qt state', 'GET', 'state');
  await step('qt đơn mới', 'GET', 'orders/list', { status: '6' });
  await step('qt xác nhận', 'POST', 'order/confirm', (v) => ({ id: v.o1 }));
  await step('qt xác nhận lại', 'POST', 'order/confirm', (v) => ({ id: v.o1 }));
  await step('qt xác nhận 2', 'POST', 'order/confirm', (v) => ({ id: v.o2 }));
  await step('qt sửa đơn', 'POST', 'order/update', { id: 108, weight: 4, note: 'Sửa ghi chú' });
  await step('qt tạo đơn', 'POST', 'order/add', { destination: 11, weight: 1, owner: 'anphat', recipient: 'Kho An Phát', phone: '0955555555' }, (b, v) => { v.o4 = b.created; });
  await step('qt từ chối', 'POST', 'order/reject', (v) => ({ id: v.o4, reason: 'Sai địa chỉ' }));
  await step('qt tự khoá', 'POST', 'users/status', { username: 'admin', status: 'locked', reason: 'thử quyền' });
  await step('qt users', 'GET', 'users', { sort: 'username', dir: 'asc' });
  await step('qt xem điều phối', 'GET', 'dispatch', { vehicle: 0, return: 1 });
  await step('qt áp dụng', 'POST', 'dispatch/apply', { plan: 'multi-insertion', vehicle: 0, return: 1 });
  await step('qt áp dụng sai', 'POST', 'dispatch/apply', { plan: 'khong-co' });
  await step('qt state sau', 'GET', 'state');
  await step('qt sửa đơn đang giao', 'POST', 'order/update', (v) => ({ id: v.o1, weight: 4 }));
  await step('qt xoá đơn đang giao', 'POST', 'order/remove', (v) => ({ id: v.o1 }));
  await step('qt chạy đồng hồ', 'POST', 'shift/progress', { t: 30 });
  await step('qt thiết lập', 'GET', 'config');
  await step('qt báo cáo', 'GET', 'reports/summary');
  await step('qt khiếu nại', 'GET', 'complaints', { sort: 'id', dir: 'asc' });
  await step('qt xử lý khiếu nại', 'POST', 'complaint/status', { id: 1, status: 'processing' });
  await step('qt trả lời', 'POST', 'complaint/message', { id: 1, text: 'Bên mình đang kiểm tra ạ' });
  await step('qt giải quyết sai', 'POST', 'complaint/status', { id: 1, status: 'new' });
  await logout();

  // ---------- Shipper
  await login('tuan', 'shipper123');
  await step('shipper state', 'GET', 'state', {}, (b, v) => { v.trips = (b.shift?.trips || []).map((t) => t.id); });
  await step('shipper đơn', 'GET', 'orders/list');
  await step('shipper xem đơn khác', 'GET', 'order/get', { id: 999 });
  await step('shipper huỷ', 'POST', 'order/cancel', (v) => ({ id: v.o1 }));
  await step('shipper nhận chuyến', 'POST', 'trip/accept', (v) => ({ id: v.trips[0] ?? 1 }));
  await step('shipper nhận lại', 'POST', 'trip/accept', (v) => ({ id: v.trips[0] ?? 1 }));
  await step('shipper state 2', 'GET', 'state', {}, (b, v) => { v.mine = (b.orders || []).filter((o) => o.status === 1).map((o) => o.id); });
  await step('shipper giao sai mã', 'POST', 'order/deliver', (v) => ({ id: v.mine[0] ?? 0, code: '0000' }));
  await step('shipper báo thất bại', 'POST', 'shift/fail', (v) => ({ id: v.mine[v.mine.length - 1] ?? 0, reason: 0 }));
  await step('shipper đồng hồ', 'POST', 'shift/progress', { t: 50 });
  await step('shipper đổi xe khi có chuyến', 'POST', 'shipper/vehicle', { vehicle: 0, capacity: 25, plate: '59B1-23456' });
  await step('shipper tạm nghỉ', 'POST', 'shipper/ready', { ready: '0' });
  await step('shipper thống kê', 'GET', 'shipper/stats');
  await step('shipper COD', 'GET', 'cod');
  await step('shipper nộp COD (không có)', 'POST', 'cod/remit', {});
  await step('shipper báo cáo', 'GET', 'reports/summary');
  await logout();

  // ---------- đổi lượt: giao đơn của Anh Cường / Chị Bình nếu có
  for (const [u, p] of [['binh', 'shipper123'], ['cuong', 'shipper123']]) {
    await login(u, p);
    await step(`${u} state`, 'GET', 'state', {}, (b, v) => { v.trips = (b.shift?.trips || []).filter((t) => !t.accepted).map((t) => t.id); });
    await step(`${u} nhận`, 'POST', 'trip/accept', (v) => ({ id: v.trips[0] ?? 0 }));
    await step(`${u} giao đơn 1`, 'POST', 'order/deliver', (v) => ({ id: v.o1, code: v.code1 }));
    await step(`${u} giao đơn COD thiếu tiền`, 'POST', 'order/deliver', (v) => ({ id: v.o2, code: v.code2 }));
    await step(`${u} giao đơn COD`, 'POST', 'order/deliver', (v) => ({ id: v.o2, code: v.code2, cash: 150000 }));
    await step(`${u} COD`, 'GET', 'cod');
    await step(`${u} nộp COD`, 'POST', 'cod/remit', { handed: 140000 });
    await logout();
  }
  await login('admin', 'admin123');
  await step('qt COD', 'GET', 'cod', {}, (b, v) => { v.remits = b.shippers.flatMap((s) => s.remittances.filter((m) => m.state === 'submitted').map((m) => [m.id, s.shipper])); });
  await step('qt đối soát', 'POST', 'cod/confirm', (v) => ({ remit: v.remits[0]?.[0] ?? 0, counted: 150000, note: 'Đếm lại đủ' }));
  await step('qt đối soát lại', 'POST', 'cod/confirm', (v) => ({ remit: v.remits[0]?.[0] ?? 0, counted: 150000 }));
  await step('qt chốt ca', 'POST', 'cod/close', (v) => ({ shipper: v.remits[0]?.[1] ?? 'Anh Tuấn' }));
  await step('qt báo nghỉ', 'POST', 'shift/absent', { index: 1 });
  await step('qt báo nghỉ lại', 'POST', 'shift/absent', { index: 1 });
  await step('qt có mặt', 'POST', 'shift/available', { index: 1 });
  await step('qt đơn thất bại', 'GET', 'orders/list', { status: '3' }, (b, v) => { v.failed = b.orders.map((o) => o.id); });
  await step('qt giao lại', 'POST', 'shift/requeue', (v) => ({ id: v.failed[0] ?? 0 }));
  await step('qt đặt lại ca', 'POST', 'shift/reset');
  await step('qt state cuối', 'GET', 'state');
  await logout();
  await login('khachvip', 'HuongViet@2026');
  await step('khách đánh giá', 'POST', 'order/rate', (v) => ({ id: v.o1, stars: 5, comment: 'Nhanh' }));
  await step('khách đánh giá lại', 'POST', 'order/rate', (v) => ({ id: v.o1, stars: 4 }));
  await step('khách đánh giá đơn chưa giao', 'POST', 'order/rate', { id: 101, stars: 4 });
  await step('khách báo cáo', 'GET', 'reports/summary');
  await step('khách đổi mật khẩu sai', 'POST', 'me/password', { old: 'sai', new: 'Huong@2027x' });
  await step('khách đổi mật khẩu', 'POST', 'me/password', { old: 'HuongViet@2026', new: 'Huong@2027x', confirm: 'Huong@2027x' });
  await logout();
  // ---------- Nghiệp vụ mở rộng: khai giá & bảo hiểm, cân quy đổi, người nhận trả cước, khách tự sửa / giao lại / hoàn,
  //            phân công tay, thu hồi chuyến, ví đối soát, bồi thường, cảnh báo, doanh thu theo ngày
  const tripsOf = (b) => (b.shift?.trips || []).filter((t) => !t.accepted).map((t) => t.id).reverse();
  await login('anphat', 'khach123');
  await step('báo giá khai giá + kích thước', 'GET', 'quote', { destination: 5, weight: 1, value: 3000000, length: 60, width: 40, height: 40, payer: 'receiver', cod: 100000 });
  await step('báo giá thiếu kích thước', 'GET', 'quote', { destination: 5, weight: 1, length: 60 });
  await step('báo giá khai giá âm', 'GET', 'quote', { destination: 5, weight: 1, value: -5 });
  await step('báo giá người trả sai', 'GET', 'quote', { destination: 5, weight: 1, payer: 'ai' });
  await step('đặt đơn khai giá', 'POST', 'order/add', { destination: 5, weight: 1, value: 3000000, length: 60, width: 40, height: 40, payer: 'receiver', cod: 100000, recipient: 'Cô Mai', phone: '0966666666', deadline: 300 }, (b, v) => { v.p1 = b.created; });
  await step('đặt đơn hạn quá dài', 'POST', 'order/add', { destination: 5, weight: 1, recipient: 'Cô Mai', phone: '0966666666', deadline: 2000 });
  await step('đặt đơn người gửi trả', 'POST', 'order/add', { destination: 7, weight: 2, recipient: 'Anh Tư', phone: '0977777777', cod: 200000 }, (b, v) => { v.p2 = b.created; });
  await step('đặt đơn 3', 'POST', 'order/add', { destination: 8, weight: 1, recipient: 'Bà Năm', phone: '0988888888', value: 500000 }, (b, v) => { v.p3 = b.created; });
  await step('đặt đơn 4', 'POST', 'order/add', { destination: 6, weight: 1, recipient: 'Chú Sáu', phone: '0912121212', cod: 50000 }, (b, v) => { v.p4 = b.created; });
  await step('khách sửa đơn mới', 'POST', 'order/edit', (v) => ({ id: v.p3, weight: 2.5, note: 'Dễ vỡ', value: 1500000 }));
  await step('khách sửa đơn sai', 'POST', 'order/edit', (v) => ({ id: v.p3, length: 400, width: 10, height: 10 }));
  await step('khách sửa đơn người khác', 'POST', 'order/edit', { id: 104, weight: 2 });
  await step('khách dùng API nhân viên', 'POST', 'order/update', (v) => ({ id: v.p3, weight: 2 }));
  await step('hoá đơn khai giá', 'GET', 'order/invoice', (v) => ({ id: v.p1 }));
  await step('ví khách', 'GET', 'wallet');
  await step('khách xem ví mọi người', 'GET', 'wallets');
  await logout();
  await login('admin', 'admin123');
  for (const k of ['p1', 'p2', 'p3', 'p4']) await step(`dp xác nhận ${k}`, 'POST', 'order/confirm', (v) => ({ id: v[k] }));
  await step('khách sửa đơn đã xác nhận (dp xem)', 'GET', 'order/get', (v) => ({ id: v.p1 }), (b, v) => { v.collect1 = b.order?.collect; });
  await step('qt phân công thiếu shipper', 'POST', 'dispatch/assign', (v) => ({ orders: `${v.p1},${v.p2}` }));
  await step('qt phân công cho shipper tạm nghỉ', 'POST', 'dispatch/assign', (v) => ({ orders: `${v.p1}`, shipper: 0 }));
  await step('qt phân công đơn không có', 'POST', 'dispatch/assign', { orders: '99999', shipper: 1 });
  await step('qt phân công đơn chưa chờ giao', 'POST', 'dispatch/assign', (v) => ({ orders: `${v.o3}`, shipper: 1 }));
  await step('qt phân công p3', 'POST', 'dispatch/assign', (v) => ({ orders: `${v.p3}`, shipper: 1 }), (b, v) => { v.tripA = tripsOf(b)[0]; });
  await step('qt thu hồi thiếu lý do', 'POST', 'trip/recall', (v) => ({ id: v.tripA ?? 0 }));
  await step('qt thu hồi', 'POST', 'trip/recall', (v) => ({ id: v.tripA ?? 0, reason: 'Shipper không phản hồi' }));
  await step('qt phân công 3 đơn', 'POST', 'dispatch/assign', (v) => ({ orders: `${v.p1},${v.p2},${v.p3}`, shipper: 1, return: 1 }), (b, v) => { v.tripB = tripsOf(b)[0]; });
  await step('qt cảnh báo', 'GET', 'reports/summary');
  await logout();
  await login('binh', 'shipper123');
  await step('binh nhận chuyến', 'POST', 'trip/accept', (v) => ({ id: v.tripB ?? 0 }));
  await step('binh giao thiếu tiền', 'POST', 'order/deliver', (v) => ({ id: v.p1, code: '0000', cash: 100000 }));
  await step('binh báo thất bại p3', 'POST', 'shift/fail', (v) => ({ id: v.p3, reason: 0 }));
  await logout();
  await login('admin', 'admin123');
  await step('qt thu hồi chuyến đã nhận', 'POST', 'trip/recall', (v) => ({ id: v.tripB ?? 0, reason: 'Thử thu hồi' }));
  await step('qt giao thay thiếu tiền', 'POST', 'order/deliver', (v) => ({ id: v.p1, force: 1, note: 'Khách quên mã', cash: 100000 }));
  await step('qt giao thay p1', 'POST', 'order/deliver', (v) => ({ id: v.p1, force: 1, note: 'Khách quên mã', cash: v.collect1 }));
  await step('qt giao thay p2', 'POST', 'order/deliver', (v) => ({ id: v.p2, force: 1, note: 'Khách quên mã', cash: 200000 }));
  await logout();
  await login('binh', 'shipper123');
  await step('binh COD', 'GET', 'cod', {}, (b, v) => { v.held = b.shippers?.[0]?.held; });
  await step('binh nộp COD', 'POST', 'cod/remit', (v) => ({ handed: v.held ?? 0 }));
  await logout();
  await login('anphat', 'khach123');
  await step('ví khách chờ đối soát', 'GET', 'wallet');
  await step('khách giao lại đơn đã giao', 'POST', 'order/redeliver', (v) => ({ id: v.p1 }));
  await step('khách giao lại SĐT sai', 'POST', 'order/redeliver', (v) => ({ id: v.p3, phone: '123' }));
  await step('khách giao lại', 'POST', 'order/redeliver', (v) => ({ id: v.p3, phone: '0988888999', note: 'Giao sau 17h' }));
  await step('khách giao lại đơn người khác', 'POST', 'order/redeliver', { id: 104 });
  await step('khách khiếu nại hư hỏng', 'POST', 'complaint/add', (v) => ({ order: v.p1, title: 'Hàng vỡ', body: 'Hộp bị móp, hàng bên trong vỡ' }), (b, v) => { v.cpA = b.id; });
  await logout();
  await login('admin', 'admin123');
  await step('qt COD đối soát', 'GET', 'cod', {}, (b, v) => { v.rm = b.shippers.flatMap((s) => s.remittances.filter((m) => m.state === 'submitted').map((m) => [m.id, m.expected])); });
  await step('qt xác nhận phiếu', 'POST', 'cod/confirm', (v) => ({ remit: v.rm[0]?.[0] ?? 0, counted: v.rm[0]?.[1] ?? 0 }));
  await step('qt phân công lại p3 + p4', 'POST', 'dispatch/assign', (v) => ({ orders: `${v.p3},${v.p4}`, shipper: 1 }), (b, v) => { v.tripC = tripsOf(b)[0]; });
  await step('qt xem khiếu nại', 'GET', 'complaints', (v) => ({ id: v.cpA }));
  await step('qt bồi thường trễ', 'POST', 'complaint/compensate', (v) => ({ id: v.cpA, kind: 'late', amount: 10000 }));
  await step('qt bồi thường quá trần', 'POST', 'complaint/compensate', (v) => ({ id: v.cpA, kind: 'damaged', amount: 5000000 }));
  await step('qt bồi thường loại sai', 'POST', 'complaint/compensate', (v) => ({ id: v.cpA, kind: 'xyz', amount: 1000 }));
  await step('qt bồi thường', 'POST', 'complaint/compensate', (v) => ({ id: v.cpA, kind: 'damaged', amount: 500000, note: 'Theo giá trị khai' }));
  await step('qt bồi thường lại', 'POST', 'complaint/compensate', (v) => ({ id: v.cpA, kind: 'damaged', amount: 1000 }));
  await step('qt ví khách', 'GET', 'wallet', { customer: 'anphat' });
  await step('qt ví không có', 'GET', 'wallet', { customer: 'admin' });
  await logout();
  await login('binh', 'shipper123');
  await step('binh nhận chuyến p3', 'POST', 'trip/accept', (v) => ({ id: v.tripC ?? 0 }));
  await step('binh thất bại p3 lần 2', 'POST', 'shift/fail', (v) => ({ id: v.p3, reason: 4 }));
  await step('binh thất bại p4', 'POST', 'shift/fail', (v) => ({ id: v.p4, reason: 0 }));
  await logout();
  await login('anphat', 'khach123');
  await step('khách hoàn đơn', 'POST', 'order/return', (v) => ({ id: v.p4 }));
  await step('khách hoàn lại', 'POST', 'order/return', (v) => ({ id: v.p4 }));
  await step('khách ví sau bồi thường', 'GET', 'wallet');
  await step('khách báo cáo ví', 'GET', 'reports/summary');
  await step('khách hoá đơn hoàn', 'GET', 'order/invoice', (v) => ({ id: v.p3 }));
  await logout();
  await login('admin', 'admin123');
  await step('admin danh sách ví', 'GET', 'wallets');
  await step('admin chi quá số dư', 'POST', 'wallet/payout', { customer: 'anphat', amount: 999999999, method: 'cash' });
  await step('admin chuyển khoản thiếu mã', 'POST', 'wallet/payout', { customer: 'anphat', amount: 100000, method: 'bank' });
  await step('admin chi trả', 'POST', 'wallet/payout', { customer: 'anphat', amount: 100000, method: 'bank', ref: 'VCB123456', note: 'Đối soát tuần' });
  await step('admin thu bù khi không nợ', 'POST', 'wallet/payout', { customer: 'anphat', kind: 'collect', amount: 1000, method: 'cash' });
  await step('admin chi cho người không phải khách', 'POST', 'wallet/payout', { customer: 'tuan', amount: 1000, method: 'cash' });
  await step('admin cấu hình bảo hiểm sai', 'POST', 'config/update', { volDivisor: 10 });
  await step('admin cấu hình bảo hiểm', 'POST', 'config/update', { insRate: '0.006', insThreshold: 2000000, volDivisor: 5000, compMultiplier: 3 });
  await step('admin báo cáo ngày', 'GET', 'reports/summary');
  await step('admin chạy đồng hồ', 'POST', 'shift/progress', { t: 400 });
  await step('admin tạo đơn hạn đã qua', 'POST', 'order/add', { destination: 5, weight: 1, deadline: 300 });
  await step('admin nhập đơn có trường mới', 'POST', 'import/orders', { body: '201 5 1 0 -1 gtri=3000000 bh=15000 kt=60x40x40 tra=1 sdt=0901111111 Đơn khai giá\n202 5 1 0 -1 kt=9x9 Sai\n' });
  await step('admin nhập đơn trường mới', 'POST', 'import/orders', { body: '201 5 1 0 -1 gtri=3000000 bh=15000 kt=60x40x40 tra=1 sdt=0901111111 Đơn khai giá\n' });
  await step('admin xem đơn nhập', 'GET', 'orders/list');
  await step('admin hạn mức nợ sai', 'POST', 'config/update', { debtLimit: -5 });
  await step('admin hạn mức nợ 1đ', 'POST', 'config/update', { debtLimit: 1 });
  await step('admin xem cấu hình', 'GET', 'config');
  await logout();
  await login('banhhoa', 'khach123');
  await step('banhhoa ví trước khi đặt', 'GET', 'wallet');
  await step('banhhoa đặt khi hạn mức thấp', 'POST', 'order/add', { destination: 4, weight: 1, deadline: -1 });
  await logout();
  await login('admin', 'admin123');
  await step('admin xem ví banhhoa', 'GET', 'wallet', { customer: 'banhhoa' });
  await step('admin đặt hộ khách nợ', 'POST', 'order/add', { destination: 4, weight: 1, deadline: -1, owner: 'banhhoa' });
  await step('admin tắt hạn mức', 'POST', 'config/update', { debtLimit: 0 });
  await step('admin khôi phục hạn mức', 'POST', 'config/update', { debtLimit: 500000 });
  await logout();

  // ---------- Pha 2: ghép đơn tự động kiểu Grab (đồng hồ ca đứng, lời mời giữ 600 giây)
  const SHIP_USER = { 'Anh Tuấn': ['tuan', 'shipper123'], 'Chị Bình': ['binh', 'shipper123'], 'Anh Cường': ['cuong', 'shipper123'], 'Anh Mới': ['shipmoi', 'Ship@2026x'] };
  const nominee = async (label, key, actions) => {
    await login('admin', 'admin123');
    await step(`${label}: xem lời mời`, 'GET', 'state', {}, (b, v) => {
      const t = (b.shift?.trips || []).find((x) => !x.accepted && x.stops.some((st) => st.order === v[key]));
      v.nom = t ? SHIP_USER[t.name] : null;
      v.trip = t ? t.id : null;
    });
    await logout();
    const [u, pw] = C.vars.nom || [];
    if (!u) {
      bad++;
      console.log(`✗ ${label}: không có lời mời cho đơn ${key}`);
      if (process.env.V) {
        await login('admin', 'admin123');
        const st = await cpp('GET', 'state');
        console.log(JSON.stringify((st.body.orders || []).filter((o) => o.id >= 112).map((o) => [o.id, o.status, o.noShipper, o.tried, o.offeredTo])), JSON.stringify(st.body.shippers), JSON.stringify((st.body.shift.trips || []).map((t) => [t.id, t.name, t.accepted, t.stops.map((x) => x.order)])));
        await logout();
      }
      return;
    }
    await login(u, pw);
    await actions();
    await logout();
  };
  await login('admin', 'admin123');
  await step('p2 đặt lại ca', 'POST', 'shift/reset');
  await step('p2 đơn đang mở', 'GET', 'orders/list', { status: '0,6', size: 100 }, (b, v) => { v.open = b.orders.map((o) => o.id); });
  for (let k = 0; k < 12; k++) await step('p2 dọn đơn', 'POST', 'order/cancel', (v) => ({ id: v.open[k] ?? 1, reason: 'Dọn đơn trước khi thử ghép tự động' }));
  await step('p2 bật ghép tự động', 'POST', 'config/update', { autoMatch: 1, clockSpeed: 0, offerSeconds: 600, matchGiveUp: 10 });
  await step('p2 xem cấu hình', 'GET', 'config');
  await step('p2 state', 'GET', 'state');
  await logout();
  for (const [u, node] of [['tuan', 3], ['binh', 6], ['cuong', 10]]) {
    await login(u, 'shipper123');
    await step(`p2 ${u} sẵn sàng`, 'POST', 'shipper/ready', { ready: '1' });
    await step(`p2 ${u} vị trí sai`, 'POST', 'shipper/location', { node: 9999 });
    await step(`p2 ${u} vị trí`, 'POST', 'shipper/location', { node });
    await step(`p2 ${u} state`, 'GET', 'state');
    await logout();
  }
  await login('anphat', 'khach123');
  await step('p2 đặt đơn q1', 'POST', 'order/add', { destination: 8, weight: 2, recipient: 'Cô Lan', phone: '0911111111', note: 'Gọi trước' }, (b, v) => { v.q1 = b.created; });
  await step('p2 khách xem state', 'GET', 'state');
  await step('p2 khách xem đơn q1', 'GET', 'order/get', (v) => ({ id: v.q1 }), (b, v) => { v.code1 = b.order?.code; });
  await step('p2 khách sửa đơn đã mời', 'POST', 'order/edit', (v) => ({ id: v.q1, weight: 3 }));
  await step('p2 khách tìm lại khi đang mời', 'POST', 'order/retry', (v) => ({ id: v.q1 }));
  await step('p2 khách huỷ thiếu lý do', 'POST', 'order/cancel', (v) => ({ id: v.q1 }));
  await step('p2 khách huỷ lý do dài', 'POST', 'order/cancel', (v) => ({ id: v.q1, reason: 'x'.repeat(160) }));
  await step('p2 khách huỷ q1', 'POST', 'order/cancel', (v) => ({ id: v.q1, reason: 'Đặt nhầm địa chỉ' }));
  await step('p2 đặt đơn q2', 'POST', 'order/add', { destination: 9, weight: 3, recipient: 'Chú Hai', phone: '0922222222', cod: 80000 }, (b, v) => { v.q2 = b.created; });
  await step('p2 đặt đơn q3', 'POST', 'order/add', { destination: 5, weight: 1, recipient: 'Bà Ba', phone: '0933333330', urgent: 1 }, (b, v) => { v.q3 = b.created; });
  await step('p2 đặt đơn quá nặng', 'POST', 'order/add', { destination: 5, weight: 500, recipient: 'Kho', phone: '0933333331' }, (b, v) => { v.q5 = b.created; });
  await step('p2 khách xem danh sách', 'GET', 'orders/list');
  await logout();
  await nominee('p2 q2', 'q2', async () => {
    await step('p2 shipper xem lời mời', 'GET', 'state');
    await step('p2 từ chối thiếu lý do', 'POST', 'trip/decline', (v) => ({ id: v.trip, reason: 'x' }));
    await step('p2 từ chối', 'POST', 'trip/decline', (v) => ({ id: v.trip, reason: 'Đang nghỉ trưa' }));
    await step('p2 từ chối lại', 'POST', 'trip/decline', (v) => ({ id: v.trip, reason: 'Đang nghỉ trưa' }));
  });
  await nominee('p2 q2 lần 2', 'q2', async () => {
    await step('p2 nhận lời mời', 'POST', 'trip/accept', (v) => ({ id: v.trip }));
    await step('p2 nhả thiếu lý do', 'POST', 'order/release', (v) => ({ id: v.q2 }));
    await step('p2 nhả đơn người khác', 'POST', 'order/release', { id: 101, reason: 'Thử' });
    await step('p2 nhả đơn q2', 'POST', 'order/release', (v) => ({ id: v.q2, reason: 'Xe hết xăng' }));
    await step('p2 shipper state sau nhả', 'GET', 'state');
  });
  await nominee('p2 q2 lần 3', 'q2', async () => {
    await step('p2 nhận lần 3', 'POST', 'trip/accept', (v) => ({ id: v.trip }));
  });
  await login('anphat', 'khach123');
  await step('p2 khách xem q2 đã nhận', 'GET', 'order/get', (v) => ({ id: v.q2 }), (b, v) => { v.code2 = b.order?.code; });
  await step('p2 khách xem state đã nhận', 'GET', 'state');
  await step('p2 khách theo dõi', 'GET', 'orders/list', { status: '1,7,0' });
  await logout();
  await nominee('p2 q3', 'q3', async () => {
    await step('p2 q3 nhận', 'POST', 'trip/accept', (v) => ({ id: v.trip }));
    await step('p2 q3 giao sai mã', 'POST', 'order/deliver', (v) => ({ id: v.q3, code: '0000' }));
  });
  await login('admin', 'admin123');
  await step('p2 admin thu hồi chuyến không có', 'POST', 'trip/recall', { id: 9999, reason: 'Thử' });
  await step('p2 admin tìm lại q2 đang giao', 'POST', 'order/retry', (v) => ({ id: v.q2 }));
  await step('p2 admin state', 'GET', 'state');
  await step('p2 admin tìm lại đơn file', 'POST', 'order/retry', { id: 103 });
  await step('p2 admin state 2', 'GET', 'state');
  await logout();
  await login('anphat', 'khach123');
  await step('p2 khách huỷ q2 đã nhận thiếu lý do', 'POST', 'order/cancel', (v) => ({ id: v.q2 }));
  await step('p2 khách huỷ q2 đã nhận', 'POST', 'order/cancel', (v) => ({ id: v.q2, reason: 'Không cần nữa' }));
  await step('p2 khách xem ví', 'GET', 'wallet');
  await logout();
  // hết shipper: tất cả nghỉ -> đơn báo "chưa có shipper", khách tìm lại
  await login('admin', 'admin123');
  await step('p2 đặt hộ đơn q6', 'POST', 'order/add', { destination: 7, weight: 1, owner: 'anphat', recipient: 'Anh Bảy', phone: '0944444440' }, (b, v) => { v.q6 = b.created; });
  await step('p2 nghỉ 0', 'POST', 'shift/absent', { index: 0 });
  await step('p2 nghỉ 1', 'POST', 'shift/absent', { index: 1 });
  await step('p2 nghỉ 2', 'POST', 'shift/absent', { index: 2 });
  await step('p2 state hết shipper', 'GET', 'state');
  await logout();
  await login('anphat', 'khach123');
  await step('p2 khách thấy chưa có shipper', 'GET', 'orders/list');
  await step('p2 khách tìm lại', 'POST', 'order/retry', (v) => ({ id: v.q6 }));
  await step('p2 khách tìm lại đơn đã xong', 'POST', 'order/retry', (v) => ({ id: v.q1 }));
  await step('p2 khách thông báo', 'GET', 'notifications');
  await logout();
  await login('admin', 'admin123');
  await step('p2 shipper 1 có mặt', 'POST', 'shift/available', { index: 1 });
  await step('p2 state có người', 'GET', 'state', {}, (b, v) => { v.recallTrip = (b.shift?.trips || []).find((x) => !x.accepted)?.id; });
  await step('p2 thu hồi lời mời', 'POST', 'trip/recall', (v) => ({ id: v.recallTrip ?? 0, reason: 'Thử thu hồi lời mời' }));
  await step('p2 state sau thu hồi', 'GET', 'state');
  await step('p2 phân công tay q6 khi ghép tự động bật', 'POST', 'dispatch/assign', (v) => ({ orders: `${v.q6}`, shipper: 1 }));
  await logout();
  // hết hạn lời mời: chỉ còn Chị Bình sẵn sàng, offerSeconds = 1
  await login('admin', 'admin123');
  await step('p2 admin huỷ thiếu lý do', 'POST', 'order/cancel', (v) => ({ id: v.q6 }));
  await step('p2 admin huỷ q6', 'POST', 'order/cancel', (v) => ({ id: v.q6, reason: 'Khách yêu cầu' }));
  await step('p2 shipper 0 có mặt', 'POST', 'shift/available', { index: 0 });
  await step('p2 shipper 2 có mặt', 'POST', 'shift/available', { index: 2 });
  for (const k of [0, 2, 3]) await step(`p2 shipper ${k} nghỉ`, 'POST', 'shift/absent', { index: k });
  await step('p2 lời mời 1 giây', 'POST', 'config/update', { offerSeconds: 1 });
  await logout();
  await login('khachvip', 'Huong@2027x');
  await step('p2 vip đặt đơn q4', 'POST', 'order/add', { destination: 10, weight: 1, recipient: 'Chị Tám', phone: '0955555550' }, (b, v) => { v.q4 = b.created; });
  await logout();
  await new Promise((r) => setTimeout(r, 2300));
  await login('admin', 'admin123');
  await step('p2 lời mời hết hạn', 'GET', 'state');
  await step('p2 lịch sử đơn hết hạn', 'GET', 'order/get', (v) => ({ id: v.q4 }));
  await step('p2 lời mời 600 giây', 'POST', 'config/update', { offerSeconds: 600 });
  for (const k of [0, 2, 3]) await step(`p2 shipper ${k} có mặt`, 'POST', 'shift/available', { index: k });
  await logout();
  await login('khachvip', 'Huong@2027x');
  await step('p2 vip tìm lại q4', 'POST', 'order/retry', (v) => ({ id: v.q4 }));
  await step('p2 vip xem q4', 'GET', 'order/get', (v) => ({ id: v.q4 }), (b, v) => { v.code4 = b.order?.code; });
  await logout();
  await nominee('p2 q4', 'q4', async () => {
    await step('p2 q4 nhận', 'POST', 'trip/accept', (v) => ({ id: v.trip }));
    await step('p2 q4 giao', 'POST', 'order/deliver', (v) => ({ id: v.q4, code: v.code4 ?? '0000' }));
    await step('p2 q4 đánh giá khách thiếu sao', 'POST', 'order/rate-customer', (v) => ({ id: v.q4, stars: 9 }));
    await step('p2 q4 đánh giá khách', 'POST', 'order/rate-customer', (v) => ({ id: v.q4, stars: 5, comment: 'Khách dễ tính' }));
    await step('p2 q4 đánh giá khách lại', 'POST', 'order/rate-customer', (v) => ({ id: v.q4, stars: 4 }));
    await step('p2 q4 đánh giá đơn chưa giao', 'POST', 'order/rate-customer', (v) => ({ id: v.q2, stars: 4 }));
    await step('p2 shipper state có điểm khách', 'GET', 'state');
  });
  await login('admin', 'admin123');
  await step('p2 admin state cuối pha', 'GET', 'state');
  await step('p2 admin cấu hình tắt ghép', 'POST', 'config/update', { autoMatch: 0 });
  await step('p2 admin đặt đơn khi tắt', 'POST', 'order/add', { destination: 4, weight: 1, owner: 'anphat', recipient: 'A', phone: '0966666660' });
  await step('p2 admin state tắt ghép', 'GET', 'state');
  await step('p2 admin bật lại ghép', 'POST', 'config/update', { autoMatch: 1 });
  await step('p2 admin state bật lại', 'GET', 'state');
  await logout();

  await login('admin', 'admin123');
  await step('admin nhật ký cuối', 'GET', 'audit', { size: 100 });
  await step('admin báo cáo cuối', 'GET', 'reports/summary');
  await step('admin users cuối', 'GET', 'users', { size: 50, sort: 'username', dir: 'asc' });
  await step('admin hoàn tác', 'POST', 'undo');
  await step('admin nhập đơn', 'POST', 'import/orders', { body: '101 3 2 0 -1 Thử\n102 5 1 1 60 cod=50000 sdt=0901111111 Đơn thử\n' });
  await step('admin nhập đơn lỗi', 'POST', 'import/orders', { body: '101 3 2 0\n' });
  await step('admin state cuối', 'GET', 'state');
  await step('admin chia đơn', 'POST', 'order/split', { id: 101, parts: 2 });
  await step('admin đổi bộ dữ liệu', 'POST', 'dataset', { key: 'oneway' });
  await step('admin hoàn tác', 'POST', 'undo');
} finally {
  srv.kill();
}
console.log(`\n${steps} bước, ${bad} bước khác nhau. Mã HTTP: ${JSON.stringify(statusCount)}`);
// So file dữ liệu được ghi ra
const lsm = globalThis.localStorage._m;
let fileDiffs = 0;
for (const f of ['users.txt', 'promos.txt', 'addresses.txt', 'reviews.txt', 'stats.txt', 'complaints.txt', 'cod_ledger.txt', 'config.txt', 'shippers.txt', 'customer_ledger.txt', 'customer_reviews.txt']) {
  const a = fs.existsSync(`${dataDir}/${f}`) ? fs.readFileSync(`${dataDir}/${f}`, 'utf8') : null;
  const b = lsm.get('dt08.f.' + f) ?? null;
  const strip = (t) => t == null ? null : t.split('\n').map((l) => l.replace(/\b1[67]\d{8}\b/g, 'T').replace(/ [0-9a-f]{16} [0-9a-f]{64}/g, ' SALT HASH').replace(/(\s|^)\d{4}(?=\s|$)/g, '$1CODE')).join('\n');
  if (strip(a) !== strip(b)) {
    fileDiffs++;
    console.log(`file ${f} khác:`);
    const al = (strip(a) || '').split('\n'), bl = (strip(b) || '').split('\n');
    for (let i = 0; i < Math.max(al.length, bl.length); i++) if (al[i] !== bl[i]) { console.log('   C++: ' + al[i] + '\n   JS : ' + bl[i]); }
  }
}
console.log(`file dữ liệu khác nhau: ${fileDiffs}`);
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(bad || fileDiffs ? 1 : 0);
