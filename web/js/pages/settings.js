// Trang Biểu phí & mã giảm giá: biểu phí giao hàng, hạng thành viên, phí huỷ, quy tắc vận hành và ghép đơn tự động
// (chỉ quản trị viên) và quản lý mã giảm giá. Mọi thay đổi được ghi nhật ký kiểm toán và lưu vào data/config.txt, data/promos.txt.
import { api } from '../api.js';
import { escapeHtml } from '../store.js';
import { $, money, when, guard, guardForm, toast, confirmBox } from '../ui.js';

let ctx, root, cfg = null, promos = null, editPromo = null;
let tab = 'fee';   // mục đang xem: mỗi mục là một nhóm cấu hình nhỏ thay vì một biểu mẫu dài
const TABS = [['fee', 'Biểu phí'], ['ins', 'Bảo hiểm'], ['ops', 'Huỷ & vận hành'], ['match', 'Ghép đơn'], ['tier', 'Hạng thành viên'], ['promo', 'Mã giảm giá']];
const isAdmin = () => ctx.store.state.me.role === 'admin';
const pct = (v) => Math.round(v * 1000) / 10;

async function load() {
  const [c, p] = await Promise.all([api.get('config'), api.get('promos')]);
  cfg = c;
  promos = p.promos;
  if (root) render();
}

function num(name, label, value, { step = 1, min = 0, suffix = '', hint = '' } = {}) {
  return `<label class="field"><span>${label}</span><div class="input-suffix"><input name="${name}" type="number" step="${step}" min="${min}" value="${value}" ${isAdmin() ? '' : 'disabled'}>${suffix ? `<em>${suffix}</em>` : ''}</div>${hint ? `<small class="hint">${hint}</small>` : ''}</label>`;
}

function configForm() {
  const t = cfg.tariff;
  return `<form id="s-cfg" class="block" novalidate>
    <section class="cfg-sec" data-sec="fee" ${tab === 'fee' ? '' : 'hidden'}>
    <h2>Biểu phí giao hàng</h2>
    <div class="grid-3">
      ${num('firstKm', 'Số km mở đầu', t.firstKm, { step: 0.5, suffix: 'km' })}
      ${num('firstFee', 'Cước mở đầu', t.firstFee, { step: 500, suffix: 'đ' })}
      ${num('perKm', 'Mỗi km tiếp theo', t.perKm, { step: 500, suffix: 'đ' })}
      ${num('freeKg', 'Miễn phí khối lượng tới', t.freeKg, { step: 0.5, suffix: 'kg' })}
      ${num('perKg', 'Mỗi kg vượt', t.perKg, { step: 500, suffix: 'đ' })}
      ${num('urgent', 'Phụ thu hoả tốc', pct(t.urgent), { step: 1, suffix: '%' })}
      ${num('codRate', 'Phí thu hộ', pct(t.codRate), { step: 0.1, suffix: '%' })}
      ${num('codMin', 'Phí thu hộ tối thiểu', t.codMin, { step: 500, suffix: 'đ' })}
      ${num('returnRate', 'Phí hoàn hàng', pct(t.returnRate), { step: 1, suffix: '%' })}
    </div>
    </section>
    <section class="cfg-sec" data-sec="ins" ${tab === 'ins' ? '' : 'hidden'}>
    <h2>Khai giá, bảo hiểm &amp; bồi thường</h2>
    <div class="grid-3">
      ${num('insRate', 'Phí bảo hiểm', pct(cfg.insRate), { step: 0.1, suffix: '% giá trị', hint: 'Tính trên giá trị hàng khai báo' })}
      ${num('insThreshold', 'Miễn phí bảo hiểm tới', cfg.insThreshold, { step: 100000, suffix: 'đ' })}
      ${num('volDivisor', 'Hệ số cân quy đổi', cfg.volDivisor, { step: 500, min: 1000, hint: 'kg quy đổi = dài × rộng × cao (cm) ÷ hệ số' })}
      ${num('compMultiplier', 'Bồi thường hàng không khai giá', cfg.compMultiplier, { step: 0.5, suffix: '× cước', hint: 'Trần khi hư hỏng / thất lạc mà khách không khai giá' })}
      ${num('debtLimit', 'Hạn mức nợ phí của khách', cfg.debtLimit ?? 500000, { step: 50000, suffix: 'đ', hint: 'Nợ quá mức này thì không đặt đơn mới; 0 = không chặn' })}
    </div>
    </section>
    <section class="cfg-sec" data-sec="ops" ${tab === 'ops' ? '' : 'hidden'}>
    <h2>Huỷ đơn &amp; vận hành</h2>
    <div class="grid-3">
      ${num('cancelDispatched', 'Phí huỷ khi đã phân công', pct(cfg.cancelDispatched), { suffix: '% cước', hint: 'Chưa có shipper nhận (đang tìm / đang mời): miễn phí' })}
      ${num('cancelOnRoute', 'Phí huỷ khi đang giao', pct(cfg.cancelOnRoute), { suffix: '% cước' })}
      ${num('shipperShare', 'Phần cước của shipper', pct(cfg.shipperShare), { suffix: '%' })}
      ${num('maxOpenOrders', 'Số đơn chưa xong tối đa mỗi khách', cfg.maxOpenOrders, { min: 1 })}
    </div>
    <label class="check"><input type="checkbox" name="scoreAware" ${cfg.scoreAware ? 'checked' : ''} ${isAdmin() ? '' : 'disabled'}> Điều phối ưu tiên shipper có điểm tin cậy cao (đúng hạn, đánh giá, ít từ chối)</label>
    <label class="check"><input type="checkbox" name="autoDeliver" ${cfg.autoDeliver ? 'checked' : ''} ${isAdmin() ? '' : 'disabled'}> Chế độ mô phỏng: đồng hồ ca tự giao đơn, shipper không cần nhận chuyến / nhập mã</label>
    </section>
    <section class="cfg-sec" data-sec="match" ${tab === 'match' ? '' : 'hidden'}>
    <h2>Ghép đơn tự động (kiểu Grab)</h2>
    <label class="check"><input type="checkbox" name="autoMatch" ${cfg.autoMatch ? 'checked' : ''} ${isAdmin() ? '' : 'disabled'}> Đơn mới tự gửi lời mời cho shipper gần nhất; shipper nhận thì mới đi giao (tắt = quản trị viên xác nhận và phân công tay)</label>
    <div class="grid-3">
      ${num('offerSeconds', 'Hạn trả lời lời mời', cfg.offerSeconds ?? 45, { min: 1, suffix: 'giây', hint: 'Hết hạn mà chưa nhận thì mời shipper gần tiếp theo (1–600)' })}
      ${num('matchGiveUp', 'Tự huỷ khi không có shipper sau', cfg.matchGiveUp ?? 10, { min: 0, suffix: 'phút', hint: '0 = không tự huỷ; tối đa 240' })}
      ${num('clockSpeed', 'Tốc độ giờ ca', cfg.clockSpeed ?? 6, { step: 0.5, min: 0, suffix: '×', hint: 'Số phút ca trôi qua mỗi phút thật; 0 = đứng yên, tối đa 120' })}
    </div>
    </section>
    <section class="cfg-sec" data-sec="tier" ${tab === 'tier' ? '' : 'hidden'}>
    <h2>Hạng thành viên</h2>
    <table class="data tiers-edit"><thead><tr><th>Tên hạng</th><th class="num">Từ số đơn đã giao</th><th class="num">Giảm cước</th>${isAdmin() ? '<th></th>' : ''}</tr></thead><tbody>
      ${cfg.tiers.map((t, i) => tierRow(t, i)).join('')}
    </tbody></table>
    ${isAdmin() ? '<div class="actions"><button type="button" class="btn small ghost" id="s-tier-add">Thêm hạng</button></div>' : ''}
    </section>
    ${isAdmin() ? '<div class="cfg-save"><button class="btn primary">Lưu cấu hình</button><small class="muted">Lưu áp dụng cho mọi mục ở trên.</small></div>' : '<p class="muted small">Chỉ quản trị viên được sửa cấu hình.</p>'}
  </form>`;
}
function tierRow(t, i) {
  const dis = isAdmin() ? '' : 'disabled';
  return `<tr data-tier="${i}"><td><input name="tname" value="${escapeHtml(t.name)}" maxlength="20" ${dis}></td><td class="num"><input name="tmin" type="number" min="0" value="${t.minDone}" ${dis}></td>
    <td class="num"><div class="input-suffix"><input name="tpct" type="number" min="0" max="50" step="0.5" value="${pct(t.pct)}" ${dis}><em>%</em></div></td>${isAdmin() ? `<td><button type="button" class="btn small ghost danger" data-tier-del="${i}" ${i === 0 ? 'disabled' : ''}>Xoá</button></td>` : ''}</tr>`;
}

function promoForm(p) {
  const d = p && p.expires ? new Date(p.expires * 1000).toISOString().slice(0, 10) : '';
  return `<form id="s-promo" class="block inset" novalidate><h2>${p ? `Sửa mã ${escapeHtml(p.code)}` : 'Thêm mã giảm giá'}</h2>
    <div class="grid-3">
      <label class="field"><span>Mã</span><input name="code" value="${p ? escapeHtml(p.code) : ''}" ${p ? 'readonly' : ''} maxlength="16" autocapitalize="characters" placeholder="GIAM10"></label>
      <label class="field"><span>Loại</span><select name="type"><option value="pct" ${!p || p.type === 'pct' ? 'selected' : ''}>Phần trăm cước</option><option value="amt" ${p && p.type === 'amt' ? 'selected' : ''}>Số tiền cố định</option></select></label>
      <label class="field"><span>Mức giảm</span><input name="value" type="number" min="1" value="${p ? p.value : 10}"><small class="hint">% hoặc đồng (bội số 500)</small></label>
      <label class="field"><span>Giảm tối đa (đ, 0 = không giới hạn)</span><input name="maxDiscount" type="number" min="0" step="500" value="${p ? p.maxDiscount : 0}"></label>
      <label class="field"><span>Cước tối thiểu (đ)</span><input name="minFee" type="number" min="0" step="500" value="${p ? p.minFee : 0}"></label>
      <label class="field"><span>Hết hạn (để trống = không hạn)</span><input name="expires" type="date" value="${d}"></label>
      <label class="field"><span>Tổng lượt dùng (0 = không giới hạn)</span><input name="maxUses" type="number" min="0" value="${p ? p.maxUses : 100}"></label>
      <label class="field"><span>Lượt mỗi khách (0 = không giới hạn)</span><input name="perUser" type="number" min="0" value="${p ? p.perUser : 1}"></label>
      <label class="check" style="align-self:end"><input type="checkbox" name="active" ${!p || p.active ? 'checked' : ''}> Đang bật</label>
    </div>
    <label class="field"><span>Mô tả</span><input name="description" maxlength="100" value="${p ? escapeHtml(p.description) : ''}"></label>
    <div class="actions"><button class="btn primary">Lưu mã</button><button type="button" class="btn ghost" id="s-promo-close">Đóng</button></div></form>`;
}

function promoState(p) {
  if (!p.active) return '<span class="chip muted">Tắt</span>';
  if (p.expired) return '<span class="chip late">Hết hạn</span>';
  if (p.maxUses && p.used >= p.maxUses) return '<span class="chip warn">Hết lượt</span>';
  return '<span class="chip ok">Đang dùng được</span>';
}

function render() {
  if (!cfg) { root.innerHTML = '<div class="page-head"><h1>Biểu phí &amp; mã giảm giá</h1></div><p class="empty">Đang tải…</p>'; return; }
  const edit = editPromo && editPromo !== 'new' ? promos.find((p) => p.code === editPromo) : null;
  root.innerHTML = `<div class="page-head"><h1>Biểu phí &amp; mã giảm giá</h1></div>
    <div class="tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${k === tab}">${l}${k === 'promo' ? `<span class="count">${promos.length}</span>` : ''}</button>`).join('')}</div>
    <div class="settings-one">
      <div ${tab === 'promo' ? 'hidden' : ''}>${configForm()}</div>
      <div ${tab === 'promo' ? '' : 'hidden'}>
        <div class="block"><div class="split"><h2>Mã giảm giá <span class="count">${promos.length}</span></h2>${isAdmin() && !editPromo ? '<button class="btn small primary" id="s-promo-new">Thêm mã</button>' : ''}</div>
          ${editPromo ? promoForm(edit) : ''}
          <div class="table-wrap"><table class="data promo-table"><thead><tr><th>Mã</th><th>Ưu đãi</th><th class="num">Đã dùng</th><th>Hạn</th><th>Trạng thái</th></tr></thead><tbody>
          ${promos.map((p) => `<tr><td><b>${escapeHtml(p.code)}</b><br><small>${escapeHtml(p.description)}</small>${isAdmin() ? `<div class="row-acts"><button class="link" data-pedit="${escapeHtml(p.code)}">Sửa</button><button class="link danger" data-pdel="${escapeHtml(p.code)}">Xoá</button></div>` : ''}</td>
            <td>${p.type === 'pct' ? `${p.value}%${p.maxDiscount ? `, tối đa ${money(p.maxDiscount)}` : ''}` : money(p.value)}${p.minFee ? `<br><small>cước từ ${money(p.minFee)}</small>` : ''}${p.perUser ? `<br><small>${p.perUser} lượt / khách</small>` : ''}</td>
            <td class="num">${p.used}${p.maxUses ? ` / ${p.maxUses}` : ''}</td><td><small>${p.expires ? when.date(p.expires) : 'không hạn'}</small></td><td>${promoState(p)}</td>
</tr>`).join('')}
          </tbody></table></div>
        </div>
      </div>
    </div>`;
  bind();
}

function bind() {
  const f = $('#s-cfg', root);
  for (const b of root.querySelectorAll('.tabs [data-tab]')) b.addEventListener('click', () => { tab = b.dataset.tab; render(); });
  if (isAdmin()) {
    $('#s-tier-add', root).addEventListener('click', () => {
      const tb = f.querySelector('.tiers-edit tbody');
      const last = cfg.tiers[cfg.tiers.length - 1];
      cfg.tiers.push({ name: 'Hạng mới', minDone: (last ? last.minDone : 0) + 10, pct: Math.min(0.5, (last ? last.pct : 0) + 0.01) });
      tb.insertAdjacentHTML('beforeend', tierRow(cfg.tiers[cfg.tiers.length - 1], cfg.tiers.length - 1));
    });
    f.addEventListener('click', (e) => { const b = e.target.closest('[data-tier-del]'); if (b) b.closest('tr').remove(); });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const tiers = [...f.querySelectorAll('tr[data-tier]')].map((tr) => `${tr.querySelector('[name=tname]').value.trim().replace(/[:,]/g, ' ')}:${tr.querySelector('[name=tmin]').value}:${Number(tr.querySelector('[name=tpct]').value) / 100}`).join(',');
      const v = (n) => f[n].value;
      guardForm(f, async () => {
        const res = await api.post('config/update', {
          firstKm: v('firstKm'), firstFee: v('firstFee'), perKm: v('perKm'), freeKg: v('freeKg'), perKg: v('perKg'), urgent: v('urgent') / 100,
          codRate: v('codRate') / 100, codMin: v('codMin'), returnRate: v('returnRate') / 100, cancelDispatched: v('cancelDispatched') / 100,
          cancelOnRoute: v('cancelOnRoute') / 100, shipperShare: v('shipperShare') / 100, maxOpenOrders: v('maxOpenOrders'),
          insRate: v('insRate') / 100, insThreshold: v('insThreshold'), volDivisor: v('volDivisor'), compMultiplier: v('compMultiplier'), debtLimit: v('debtLimit'),
          scoreAware: f.scoreAware.checked ? 1 : 0, autoMatch: f.autoMatch.checked ? 1 : 0,
          offerSeconds: v('offerSeconds'), matchGiveUp: v('matchGiveUp'), clockSpeed: v('clockSpeed'), autoDeliver: f.autoDeliver.checked ? 1 : 0, tiers,
        });
        cfg = res;
        toast(res.message);
        render();
        ctx.store.refresh();
      }, f.querySelector('button.primary'));
    });
  }
  $('#s-promo-new', root)?.addEventListener('click', () => { editPromo = 'new'; render(); });
  for (const b of root.querySelectorAll('[data-pedit]')) b.addEventListener('click', () => { editPromo = b.dataset.pedit; render(); });
  for (const b of root.querySelectorAll('[data-pdel]')) b.addEventListener('click', async () => {
    if (!(await confirmBox(`Xoá mã ${b.dataset.pdel}?`, 'Các đơn đã dùng mã vẫn giữ nguyên mức giảm.', { ok: 'Xoá mã', danger: true }))) return;
    guard(async () => { const res = await api.post('promos/remove', { code: b.dataset.pdel }); promos = res.promos; toast(res.message); render(); });
  });
  const pf = $('#s-promo', root);
  if (pf) {
    $('#s-promo-close', root).addEventListener('click', () => { editPromo = null; render(); });
    pf.addEventListener('submit', (e) => {
      e.preventDefault();
      const exp = pf.expires.value ? Math.floor(new Date(`${pf.expires.value}T23:59:59`).getTime() / 1000) : 0;
      guardForm(pf, async () => {
        const res = await api.post('promos/save', {
          code: pf.code.value.trim().toUpperCase(), type: pf.type.value, value: pf.value.value, maxDiscount: pf.maxDiscount.value || 0, minFee: pf.minFee.value || 0,
          maxUses: pf.maxUses.value || 0, perUser: pf.perUser.value || 0, expires: exp, active: pf.active.checked ? 1 : 0, description: pf.description.value.trim(),
        });
        promos = res.promos;
        editPromo = null;
        toast(res.message);
        render();
      }, pf.querySelector('button.primary'));
    });
  }
}

export default {
  id: 'settings',
  title: 'Biểu phí & mã giảm giá',
  wide: true,
  mount(panel, c) {
    ctx = c;
    root = document.createElement('div');
    panel.append(root);
    cfg = null; promos = null; editPromo = null; tab = 'fee';
    render();
    guard(load);
  },
  unmount() { root = null; },
  onState() {},
};
