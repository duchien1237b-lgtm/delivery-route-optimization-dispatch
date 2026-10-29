// Trang Nhật ký kiểm toán (chỉ quản trị viên): mọi thao tác quan trọng (đăng nhập, đổi trạng thái tài khoản, huỷ / giao đơn,
// đối soát COD, sửa cấu hình...) được ghi lại kèm người làm, vai trò, thời điểm. Lọc theo người, hành động, đối tượng,
// khoảng ngày; xuất CSV (ô bắt đầu bằng = + - @ được chèn dấu ' để Excel không hiểu nhầm là công thức).
import { api, download } from '../api.js';
import { escapeHtml } from '../store.js';
import { $, when, guard, pager, bindPager, debounce, ROLE_LABEL } from '../ui.js';

let ctx, root, data = null, page = 1, seq = 0;
const f = { actor: '', action: '', target: '', from: '', to: '' };
const ACTIONS = ['auth.', 'auth.login', 'auth.login_failed', 'auth.register', 'auth.password_reset', 'user.status', 'user.', 'order.', 'order.cancel', 'order.deliver', 'dispatch.apply', 'trip.', 'cod.', 'complaint.', 'promo.', 'config.update', 'fleet.'];

function params() {
  const toSec = (d, end) => (d ? Math.floor(new Date(`${d}T${end ? '23:59:59' : '00:00:00'}`).getTime() / 1000) : '');
  return { actor: f.actor, action: f.action, target: f.target, from: toSec(f.from), to: toSec(f.to, true) };
}
async function load() {
  const s = ++seq;
  const res = await api.get('audit', { ...params(), page, size: 20 });
  if (s !== seq || !root) return;
  data = res;
  page = res.page.page;
  renderResults();
}
const reload = debounce(() => guard(load), 300);

// Khung trang vẽ một lần (giữ con trỏ trong ô lọc khi gõ); chỉ phần kết quả được vẽ lại
function render() {
  root.innerHTML = `<div class="page-head"><h1>Nhật ký kiểm toán</h1><button class="btn small" id="au-csv">Xuất CSV</button></div>
    <div class="block">
      <form class="audit-filter" id="au-f">
        <label class="field"><span>Người thực hiện</span><input name="actor" value="${escapeHtml(f.actor)}" placeholder="tên đăng nhập"></label>
        <label class="field"><span>Hành động</span><input name="action" list="au-actions" value="${escapeHtml(f.action)}" placeholder="vd: order. hoặc user.status"><datalist id="au-actions">${ACTIONS.map((a) => `<option value="${a}">`).join('')}</datalist></label>
        <label class="field"><span>Đối tượng</span><input name="target" value="${escapeHtml(f.target)}" placeholder="mã đơn, tài khoản…"></label>
        <label class="field"><span>Từ ngày</span><input name="from" type="date" value="${f.from}"></label>
        <label class="field"><span>Đến ngày</span><input name="to" type="date" value="${f.to}"></label>
      </form>
      <div id="au-results" aria-live="polite"></div>
    </div>`;
  const form = $('#au-f', root);
  form.addEventListener('submit', (e) => e.preventDefault());
  for (const el of form.querySelectorAll('input')) el.addEventListener(el.type === 'date' ? 'change' : 'input', () => { f[el.name] = el.value.trim(); page = 1; reload(); });
  $('#au-csv', root).addEventListener('click', () => download('audit/export', params(), 'audit.csv'));
  renderResults();
}
function renderResults() {
  const box = $('#au-results', root);
  if (!box) return;
  box.innerHTML = !data ? '<p class="empty">Đang tải…</p>' : data.entries.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Thời điểm</th><th>Người thực hiện</th><th>Hành động</th><th>Đối tượng</th><th>Chi tiết</th></tr></thead><tbody>
    ${data.entries.map((e) => `<tr><td class="nowrap"><small>${when.full(e.at)}</small></td><td>${escapeHtml(e.actor || 'khách')}<br><small>${escapeHtml(ROLE_LABEL[e.role] || e.role || '')}</small></td>
      <td><code>${escapeHtml(e.action)}</code></td><td>${escapeHtml(e.target)}</td><td><small>${escapeHtml(e.detail)}</small></td></tr>`).join('')}
  </tbody></table></div>${pager(data.page)}` : '<p class="empty">Không có bản ghi nào khớp bộ lọc.</p>';
  bindPager(box, (p) => { page = p; guard(load); });
}

export default {
  id: 'audit',
  title: 'Nhật ký kiểm toán',
  wide: true,
  mount(panel, c) {
    ctx = c;
    root = document.createElement('div');
    panel.append(root);
    data = null;
    render();
    guard(load);
  },
  unmount() { root = null; },
  onState() {},
};
