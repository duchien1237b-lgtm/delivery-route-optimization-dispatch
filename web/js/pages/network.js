// Trang Bản đồ: thêm / sửa / xoá điểm và đoạn đường (Core: class Graph).
import { api } from '../api.js';
import { escapeHtml } from '../store.js';
import { $, fmt, guard, haversineKm, segmented, bindSegmented, showModal, toast, vehicleMaskText, hhmm, getShiftStart, rushLevel, trafficEdgeStyles, TRAFFIC_LEVELS } from '../ui.js';

let ctx, root;
let mode = 'select';        // select | addNode | addEdge
let selection = null;       // {node:id} | {edge:[u,v]} | {newNode:{lat,lon}} | {newEdge:[u,v]}
let edgeStart = null;
let trafficAt = null;       // phút trong ngày đang xem lớp giao thông, null = tắt

const TRAFFIC = [
  { v: '1', label: 'Bình thường' },
  { v: '1.5', label: 'Kẹt ×1,5' },
  { v: '2', label: 'Kẹt ×2' },
  { v: '3', label: 'Kẹt ×3' },
  { v: 'closed', label: 'Đóng' },
];

const HINTS = {
  select: null,
  addNode: 'Bấm chỗ trống để đặt điểm',
  addEdge: 'Bấm điểm đầu',
};

function setMode(m) {
  mode = m;
  selection = null;
  edgeStart = null;
  ctx.map.setPicking(m !== 'select');
  ctx.map.setHint(HINTS[m]);
  syncMap();
  renderEditor();
}

function trafficLegend() {
  return trafficAt == null ? [] : TRAFFIC_LEVELS.slice().reverse().map((t) => ({ type: 'line', color: t.color, label: t.label }));
}

function syncTraffic() {
  const st = ctx.store.state;
  ctx.map.setEdgeStyles(trafficAt == null ? new Map() : trafficEdgeStyles(st, trafficAt));
  ctx.map.setLegend(trafficLegend());
  const lbl = $('#t-label', root);
  if (lbl && trafficAt != null) {
    const lv = rushLevel(st.settings.rush, trafficAt);
    lbl.textContent = `${hhmm(trafficAt)}${!st.settings.rush.enabled ? ', giờ cao điểm đang tắt' : lv >= 0.99 ? ', cao điểm' : lv > 0 ? ', đang đông dần' : ', vắng'}`;
  }
}

function syncMap() {
  const styles = new Map();
  if (edgeStart != null) styles.set(edgeStart, { ring: 'var(--signal)' });
  ctx.map.setNodeStyles(styles);
  if (selection && selection.node != null) ctx.map.setSelection({ node: selection.node });
  else if (selection && selection.edge) ctx.map.setSelection({ edge: selection.edge });
  else if (selection && selection.newEdge) ctx.map.setPaths([{ nodes: selection.newEdge, color: 'var(--signal)', width: 4, dash: '6 6' }], { animate: false });
  else ctx.map.setSelection(null);
  if (!(selection && selection.newEdge)) ctx.map.setPaths([], { animate: false });
}

function edgeOf(u, v) {
  return ctx.store.state.graph.edges.find((e) => (e.u === u && e.v === v) || (!ctx.store.state.graph.directed && e.u === v && e.v === u));
}

function allowedBoxes(mask) {
  return `<div class="row" style="flex-wrap:wrap;gap:14px">
    <label class="check"><input type="checkbox" name="m1" ${mask & 1 ? 'checked' : ''}> Xe máy</label>
    <label class="check"><input type="checkbox" name="m2" ${mask & 2 ? 'checked' : ''}> Ô tô</label>
    <label class="check"><input type="checkbox" name="m4" ${mask & 4 ? 'checked' : ''}> Xe tải</label></div>`;
}
function readMask(form) {
  const m = (form.m1.checked ? 1 : 0) | (form.m2.checked ? 2 : 0) | (form.m4.checked ? 4 : 0);
  return m || 7;
}

function edgeFields(e) {
  return `
    <div class="row">
      <label class="field"><span>Quãng đường (km)</span><input type="number" name="km" step="0.1" min="0" value="${e.km}" required></label>
      <label class="field"><span>Thời gian (phút)</span><input type="number" name="time" step="0.1" min="0" value="${e.time}" required></label>
    </div>
    <div class="row">
      <label class="field"><span>Phụ phí (nghìn đ, âm = trợ giá)</span><input type="number" name="cost" step="1" value="${e.cost}"></label>
      <label class="field" title="Lúc đông nhất, ô tô đi đoạn này mất gấp bao nhiêu lần. 1 = không kẹt."><span>Hệ số cao điểm</span><input type="number" name="peak" step="0.1" min="1" max="5" value="${e.peak ?? 1.5}"></label>
    </div>
    <div class="field"><span>Loại xe được đi</span>${allowedBoxes(e.allowed)}</div>`;
}

function renderEditor() {
  const box = $('#editor', root);
  if (!box) return;
  const state = ctx.store.state;
  const name = (id) => escapeHtml(ctx.store.name(id));

  if (selection && selection.newNode) {
    const { lat, lon } = selection.newNode;
    box.innerHTML = `<div class="block"><h2>Điểm mới</h2>
      <form id="f-node-new">
        <label class="field"><span>Tên điểm</span><input type="text" name="name" required placeholder="Chung cư Sunrise"></label>
        <div class="row"><label class="field"><span>Vĩ độ</span><input type="number" step="0.0001" name="x" value="${lat.toFixed(4)}"></label>
        <label class="field"><span>Kinh độ</span><input type="number" step="0.0001" name="y" value="${lon.toFixed(4)}"></label></div>
        <div class="actions"><button class="btn primary">Thêm điểm</button><button type="button" class="btn ghost" data-cancel>Huỷ</button></div>
      </form></div>`;
    const f = $('#f-node-new', box);
    f.name.focus();
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      guard(async () => {
        const res = await ctx.store.mutate('node/add', { name: f.name.value.trim(), x: f.x.value, y: f.y.value });
        toast(`Đã thêm điểm #${res.created}`);
        selection = { node: res.created };
        mode = 'select'; ctx.map.setPicking(false); ctx.map.setHint(HINTS.select);
        refreshModeSeg();
        syncMap(); renderEditor();
      }, e.submitter);
    });
  } else if (selection && selection.newEdge) {
    const [u, v] = selection.newEdge;
    const a = ctx.store.nodesById.get(u), b = ctx.store.nodesById.get(v);
    const km = Math.round(haversineKm(a, b) * 1.35 * 10) / 10;
    box.innerHTML = `<div class="block"><h2>${name(u)} ${state.graph.directed ? '→' : '↔'} ${name(v)}</h2><p class="sub">Đoạn đường mới. Km gợi ý theo đường chim bay.</p>
      <form id="f-edge-new">${edgeFields({ km, time: Math.round((km / 40) * 600) / 10, cost: 0, allowed: 7, peak: 1.5 })}
      <div class="actions"><button class="btn primary">Nối đường</button><button type="button" class="btn ghost" data-cancel>Huỷ</button></div></form></div>`;
    const f = $('#f-edge-new', box);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      guard(async () => {
        await ctx.store.mutate('edge/add', { u, v, km: f.km.value, time: f.time.value, cost: f.cost.value || 0, allowed: readMask(f), peak: f.peak.value || 1.5 });
        toast('Đã nối đường');
        selection = null; edgeStart = null;
        syncMap(); renderEditor();
      }, e.submitter);
    });
  } else if (selection && selection.node != null && ctx.store.nodesById.has(selection.node)) {
    const n = ctx.store.nodesById.get(selection.node);
    const edges = state.graph.edges.filter((e) => e.u === n.id || e.v === n.id);
    box.innerHTML = `<div class="block"><div class="split"><h2>${escapeHtml(n.name)}</h2><span class="muted">#${n.id}${n.id === state.depot ? ', kho' : ''}</span></div>
      <form id="f-node">
        <label class="field"><span>Tên điểm</span><input type="text" name="name" value="${escapeHtml(n.name)}" required></label>
        <div class="row"><label class="field"><span>Vĩ độ</span><input type="number" step="0.0001" name="x" value="${n.x}"></label>
        <label class="field"><span>Kinh độ</span><input type="number" step="0.0001" name="y" value="${n.y}"></label></div>
        <div class="actions"><button class="btn primary">Lưu</button>
          ${n.id === state.depot ? '' : '<button type="button" class="btn" id="b-depot">Đặt làm kho</button>'}
          <button type="button" class="btn danger" id="b-del">Xoá điểm</button></div>
      </form>
      <h3 style="font-size:12px;font-weight:500;color:var(--muted);margin:16px 0 2px">Nối với</h3>
      ${edges.length ? `<table class="data"><tbody>${edges.map((e) => `<tr class="clickable" data-e="${e.u}-${e.v}"><td>${name(e.u === n.id ? e.v : e.u)}${state.graph.directed ? (e.u === n.id ? ' <span class="muted">(đi)</span>' : ' <span class="muted">(đến)</span>') : ''}</td><td class="num">${fmt.km(e.km)}</td><td class="num">${fmt.num(e.time)} phút</td></tr>`).join('')}</tbody></table>` : '<p class="empty">Chưa nối với điểm nào.</p>'}
    </div>`;
    const f = $('#f-node', box);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      guard(() => ctx.store.mutate('node/update', { id: n.id, name: f.name.value.trim(), x: f.x.value, y: f.y.value }).then(() => toast('Đã lưu điểm')), e.submitter);
    });
    $('#b-depot', box)?.addEventListener('click', () => guard(() => ctx.store.mutate('depot', { id: n.id }).then(() => toast(`Kho chuyển về ${n.name}`))));
    $('#b-del', box).addEventListener('click', () => {
      if (!confirm(`Xoá điểm “${n.name}” cùng mọi đoạn đường và đơn hàng gắn với nó?`)) return;
      guard(async () => {
        const res = await ctx.store.mutate('node/remove', { id: n.id });
        toast(res.removedOrders ? `Đã xoá điểm và ${res.removedOrders} đơn hàng liên quan` : 'Đã xoá điểm');
        selection = null; syncMap(); renderEditor();
      });
    });
    box.querySelectorAll('[data-e]').forEach((tr) => tr.addEventListener('click', () => {
      selection = { edge: tr.dataset.e.split('-').map(Number) }; syncMap(); renderEditor();
    }));
  } else if (selection && selection.edge && edgeOf(...selection.edge)) {
    const e = edgeOf(...selection.edge);
    const tState = e.closed ? 'closed' : e.jam > 1 ? String(e.jam) : '1';
    box.innerHTML = `<div class="block"><h2>${name(e.u)} ${state.graph.directed ? '→' : '↔'} ${name(e.v)}</h2>
      <p class="sub">Chi phí ${fmt.k(e.costK)} (km × 5k + phụ phí). ${vehicleMaskText(e.allowed)}.</p>
      <div class="field"><span>Giao thông</span>${segmented('traffic', TRAFFIC, tState)}</div>
      <form id="f-edge">${edgeFields(e)}
      <div class="actions"><button class="btn primary">Lưu</button><button type="button" class="btn danger" id="b-del">Xoá đoạn</button></div></form></div>`;
    bindSegmented(box, (n, v) => guard(async () => {
      await ctx.store.mutate('traffic', { u: e.u, v: e.v, jam: v === 'closed' ? e.jam : v, closed: v === 'closed' ? 1 : 0 });
      toast(v === 'closed' ? 'Đã đóng đoạn đường' : v === '1' ? 'Đoạn đường đã thông' : `Đã báo kẹt xe, thời gian ×${v}`);
    }));
    const f = $('#f-edge', box);
    f.addEventListener('submit', (ev) => {
      ev.preventDefault();
      guard(() => ctx.store.mutate('edge/update', { u: e.u, v: e.v, km: f.km.value, time: f.time.value, cost: f.cost.value || 0, allowed: readMask(f), peak: f.peak.value || 1.5 }).then(() => toast('Đã lưu đoạn đường')), ev.submitter);
    });
    $('#b-del', box).addEventListener('click', () => guard(async () => {
      await ctx.store.mutate('edge/remove', { u: e.u, v: e.v });
      toast('Đã xoá đoạn đường');
      selection = null; syncMap(); renderEditor();
    }));
  } else {
    box.innerHTML = mode === 'select' ? '<p class="empty">Chọn một điểm hoặc đoạn đường trên bản đồ.</p>' : '';
  }
  box.querySelector('[data-cancel]')?.addEventListener('click', () => { selection = null; edgeStart = null; syncMap(); renderEditor(); });
}

function renderTable() {
  const box = $('#node-table', root);
  if (!box) return;
  const st = ctx.store.state;
  const LIMIT = 200;
  const shown = st.graph.nodes.length > LIMIT ? st.graph.nodes.slice(0, LIMIT) : st.graph.nodes;
  const more = st.graph.nodes.length - shown.length;
  box.innerHTML = st.graph.nodes.length
    ? `${more > 0 ? `<p class="muted" style="font-size:12.5px;margin-bottom:6px">${LIMIT}/${st.graph.nodes.length} điểm</p>` : ''}<table class="data"><thead><tr><th>Mã</th><th>Tên</th><th class="num">Đường nối</th></tr></thead><tbody>${shown.map((n) => `<tr class="clickable ${selection && selection.node === n.id ? 'active' : ''}" data-n="${n.id}"><td>${n.id}</td><td>${escapeHtml(n.name)}${n.id === st.depot ? ' <span class="chip blue">Kho</span>' : ''}</td><td class="num">${n.degree}</td></tr>`).join('')}</tbody></table>`
    : '<p class="empty">Bản đồ trống.</p>';
  box.querySelectorAll('[data-n]').forEach((tr) => tr.addEventListener('click', () => {
    if (mode !== 'select') setMode('select');
    selection = { node: Number(tr.dataset.n) }; syncMap(); renderEditor(); renderTable();
  }));
}

function renderIncidents() {
  const box = $('#incidents', root);
  if (!box) return;
  const st = ctx.store.state;
  const list = st.graph.edges.filter((e) => e.closed || e.jam > 1);
  const name = (id) => escapeHtml(ctx.store.name(id));
  box.innerHTML = list.length
    ? `<table class="data"><tbody>${list.map((e) => `<tr class="clickable" data-e="${e.u}-${e.v}"><td>${name(e.u)} ${st.graph.directed ? '→' : '–'} ${name(e.v)}</td><td class="num">${e.closed ? '<span class="chip late">Đóng</span>' : `<span class="chip urgent">Kẹt ×${fmt.num(e.jam)}</span>`}</td></tr>`).join('')}</tbody></table>
`
    : '<p class="empty">Không có sự cố.</p>';
  box.querySelectorAll('[data-e]').forEach((tr) => tr.addEventListener('click', () => {
    if (mode !== 'select') setMode('select');
    refreshModeSeg();
    selection = { edge: tr.dataset.e.split('-').map(Number) }; syncMap(); renderEditor();
  }));
  $('#b-clear-traffic', root).hidden = !list.length;
}

function refreshModeSeg() {
  root.querySelectorAll('.seg[data-seg="mode"] button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === mode)));
}

export default {
  id: 'network',
  title: 'Bản đồ',
  mount(panel, c) {
    ctx = c;
    root = document.createElement('div');
    root.innerHTML = `
      <div class="page-head"><h1>Bản đồ</h1><button class="btn small ghost" id="b-print" title="Danh sách kề của đồ thị">Xem danh sách kề</button></div>
      ${segmented('mode', [{ v: 'select', label: 'Chọn' }, { v: 'addNode', label: 'Thêm điểm' }, { v: 'addEdge', label: 'Nối đường' }], mode)}
      <div id="editor" style="margin-top:14px"></div>
      <div class="block"><div class="split"><h2>Giao thông theo giờ</h2><label class="check"><input type="checkbox" id="t-on"> Hiện</label></div>
        <div id="t-body" hidden><input type="range" id="t-slider" min="0" max="1425" step="15" aria-label="Giờ trong ngày"><p class="muted" id="t-label" style="font-size:12.5px;margin-top:2px"></p></div></div>
      <div class="block"><div class="split"><h2>Sự cố giao thông</h2><button class="btn small ghost" id="b-clear-traffic" hidden>Xoá hết</button></div><div id="incidents"></div></div>
      <div class="block"><h2>Các điểm</h2><div id="node-table"></div></div>
      <div class="block"><h2>Bản đồ mới</h2>
        <div class="actions"><button class="btn" data-new="0">Hai chiều</button><button class="btn" data-new="1">Một chiều (có hướng)</button></div></div>`;
    panel.append(root);
    bindSegmented(root, (name, v) => setMode(v));
    root.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () => {
      if (!confirm('Xoá toàn bộ bản đồ và đơn hàng hiện tại?')) return;
      guard(() => ctx.store.mutate('graph/new', { directed: b.dataset.new }).then(() => { setMode('addNode'); toast('Đã tạo bản đồ trống'); }));
    }));
    const tOn = $('#t-on', root), tSlider = $('#t-slider', root);
    tOn.checked = trafficAt != null;
    $('#t-body', root).hidden = trafficAt == null;
    tSlider.value = trafficAt ?? getShiftStart();
    tOn.addEventListener('change', () => {
      trafficAt = tOn.checked ? Number(tSlider.value) : null;
      $('#t-body', root).hidden = !tOn.checked;
      syncTraffic();
    });
    tSlider.addEventListener('input', () => { trafficAt = Number(tSlider.value); syncTraffic(); });
    $('#b-clear-traffic', root).addEventListener('click', (ev) => guard(async () => {
      await ctx.store.mutate('traffic/clear');
      toast('Đã xoá mọi sự cố');
    }, ev.currentTarget));
    $('#b-print', root).addEventListener('click', () => guard(async () => {
      const res = await api.get('print');
      showModal('Danh sách kề của đồ thị', `<div class="mono-text">${escapeHtml(res.text)}</div>`);
    }));

    ctx.onMap('nodeclick', (id) => {
      if (mode === 'addEdge') {
        if (edgeStart == null || edgeStart === id) { edgeStart = id; selection = null; ctx.map.setHint('Bấm điểm cuối'); }
        else { selection = { newEdge: [edgeStart, id] }; ctx.map.setHint(HINTS.addEdge); edgeStart = null; }
      } else {
        if (mode === 'addNode') setMode('select');
        refreshModeSeg();
        selection = { node: id };
      }
      syncMap(); renderEditor(); renderTable();
    });
    ctx.onMap('edgeclick', (u, v) => {
      if (mode !== 'select') return;
      selection = { edge: [u, v] }; syncMap(); renderEditor(); renderTable();
    });
    ctx.onMap('mapclick', (pos) => {
      if (mode === 'addNode') selection = { newNode: pos };
      else if (mode === 'select') selection = null;
      syncMap(); renderEditor(); renderTable();
    });

    ctx.map.setPicking(mode !== 'select');
    ctx.map.setHint(HINTS[mode]);
    syncMap(); renderEditor(); renderTable(); renderIncidents(); syncTraffic();
  },
  unmount() { root = null; ctx.map.setEdgeStyles(new Map()); },
  onState() {
    if (selection && selection.node != null && !ctx.store.nodesById.has(selection.node)) selection = null;
    syncMap(); renderEditor(); renderTable(); renderIncidents(); syncTraffic();
  },
};
