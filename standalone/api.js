// Lớp gọi API cho bản MỘT FILE: thay vì fetch tới server C++, gọi thẳng bộ xử lý JavaScript (engine/).
// Cùng giao diện với web/js/api.js: api.get/post/postText, setCsrf, download, downloadText.
// Lỗi mang status (mã HTTP tương ứng), fields (lỗi từng ô nhập) và retryAfter như bản gọi server.
import { handle, exportText } from './engine_all.js';

// Bản một file không có cookie nên không cần mã CSRF; giữ hàm để giao diện dùng chung
export function setCsrf() {}

function fail(e) {
  const err = new Error(e.message || 'Có lỗi xảy ra');
  err.status = e.status || 500;
  err.fields = e.fields || null;
  err.retryAfter = e.retryAfter || 0;
  if (err.status === 401 && e.auth) {
    err.auth = true;
    window.dispatchEvent(new CustomEvent('auth-required'));
  }
  return err;
}

function call(method, path, params) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(handle(method, path, params));
      } catch (e) {
        reject(fail(e));
      }
    }, 0);
  });
}

function clean(params = {}, dropEmpty = false) {
  const out = {};
  for (const [k, v] of Object.entries(params || {}))
    if (v !== undefined && v !== null && !(dropEmpty && v === '')) out[k] = String(v);
  return out;
}

export const api = {
  get(path, params) { return call('GET', path, clean(params, true)); },
  post(path, params) { return call('POST', path, clean(params)); },
  postText(path, text) { return call('POST', path, { body: text }); },
};

// Tải một tệp (map / orders / shippers, nhật ký kiểm toán CSV): engine kiểm tra quyền rồi trả nội dung
export function download(path, params, filename) {
  let text;
  try {
    text = exportText(path, clean(params, true));
  } catch (e) {
    alert(fail(e).message);
    return;
  }
  const type = path.endsWith('export') && !path.startsWith('export/') ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8';
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename || path.split('/').pop();
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}

export function downloadText(kind) { download(`export/${kind}`, null, `${kind}.txt`); }
