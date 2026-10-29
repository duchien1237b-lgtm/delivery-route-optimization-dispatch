// Gọi REST API của backend C++. Mọi thuật toán chạy ở server, trình duyệt chỉ hiển thị.
// Phiên đăng nhập giữ bằng cookie HttpOnly (trình duyệt tự gửi kèm, JavaScript không đọc được).
// Mọi yêu cầu POST gửi kèm mã chống CSRF (X-CSRF-Token) mà server cấp trong /api/me và /api/login.

let csrf = '';
export function setCsrf(token) { csrf = token || ''; }

async function handle(res) {
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Server trả về dữ liệu không đọc được (HTTP ${res.status})`);
  }
  if (!res.ok || data.ok === false) {
    const err = new Error(data.error || `Lỗi HTTP ${res.status}`);
    err.status = res.status;
    err.fields = data.fields || null;            // lỗi theo từng ô nhập (HTTP 400)
    err.retryAfter = Number(res.headers.get('Retry-After')) || 0;
    // Phiên hết hạn / chưa đăng nhập: báo cho app hiện màn đăng nhập
    if (res.status === 401 && data.auth) { err.auth = true; window.dispatchEvent(new CustomEvent('auth-required')); }
    throw err;
  }
  return data;
}

function query(params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const api = {
  async get(path, params) {
    return handle(await fetch(`/api/${path}${query(params)}`));
  },
  async post(path, params = {}) {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) body.set(k, v);
    return handle(await fetch(`/api/${path}`, { method: 'POST', body, headers: { 'X-CSRF-Token': csrf } }));
  },
  async postText(path, text) {
    return handle(await fetch(`/api/${path}`, {
      method: 'POST', body: text, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-CSRF-Token': csrf },
    }));
  },
};

// Tải một tệp từ server về máy (map / orders / shippers, nhật ký kiểm toán CSV)
export function download(path, params, filename) {
  const a = document.createElement('a');
  a.href = `/api/${path}${query(params)}`;
  a.download = filename || path.split('/').pop();
  document.body.appendChild(a);
  a.click();
  a.remove();
}
export function downloadText(kind) { download(`export/${kind}`, null, `${kind}.txt`); }
