// Trạng thái dùng chung: bản đồ, đơn hàng, shipper, kho. Mỗi lần server trả về
// state mới thì báo cho các trang và bản đồ vẽ lại.
import { api, setCsrf } from './api.js';

const listeners = new Set();

export const store = {
  state: null,
  nodesById: new Map(),

  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  set(state) {
    if (!state || !state.graph) return;
    state._rx = Date.now();   // lúc nhận state: để ước lượng giờ ca đang chạy (liveClock)
    this.state = state;
    if (state.me && state.me.csrf) setCsrf(state.me.csrf);
    this.nodesById = new Map(state.graph.nodes.map((n) => [n.id, n]));
    for (const fn of listeners) fn(state);
  },

  async refresh() { this.set(await api.get('state')); },

  // Gọi API làm thay đổi dữ liệu (server trả về state đầy đủ)
  async mutate(path, params) {
    const res = await api.post(path, params);
    this.set(res);
    return res;
  },

  name(id) {
    const n = this.nodesById.get(Number(id));
    return n ? n.name : `#${id}`;
  },

  nodeOptions(selected, { includeEmpty = false, emptyLabel = 'Chọn điểm' } = {}) {
    const nodes = this.state ? this.state.graph.nodes : [];
    let html = includeEmpty ? `<option value="">${emptyLabel}</option>` : '';
    for (const n of nodes) {
      html += `<option value="${n.id}" ${Number(selected) === n.id ? 'selected' : ''}>${n.id}. ${escapeHtml(n.name)}</option>`;
    }
    return html;
  },
};

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
