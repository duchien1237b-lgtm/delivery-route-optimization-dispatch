// Giao diện chọn nền bản đồ: nút quả cầu mở một bảng nhỏ (Google Maps / Sơ đồ dự phòng + ô khoá API + tuỳ chọn giao thông).
// Google Maps là mặc định khi đã có khoá; chưa có khoá thì dùng sơ đồ và thuật toán đồ án.
import { GoogleBase, OsmBase, savedKey, saveKey, savedTraffic, saveTraffic, looksLikeKey, needsReload } from './gmaps.js';

export function initBaseMap({ map, stage, toast }) {
  const btn = document.querySelector('#gm-btn'), pop = document.querySelector('#gm-pop');
  const keyIn = pop.querySelector('#gm-key'), status = pop.querySelector('#gm-status');
  const google = new GoogleBase(stage, map), osm = new OsmBase(stage, map);
  const BASE_STORE = 'map.base';   // 'osm' | 'google' | 'schematic'; mặc định OpenStreetMap, hoặc Google nếu đã có khoá
  const savedBase = () => { try { return localStorage.getItem(BASE_STORE) || ''; } catch { return ''; } };
  const setBase = (v) => { try { localStorage.setItem(BASE_STORE, v); } catch { /* bỏ qua */ } };
  let busy = false;
  const current = () => (google.active ? 'google' : osm.active ? 'osm' : 'schematic');
  const geoNow = () => (google.active ? google.geo : osm.active ? osm.geo : null);

  const say = (text, bad = false) => { status.textContent = text || ''; status.classList.toggle('bad', !!bad); };
  const paint = () => {
    const cur = current(), on = cur !== 'schematic';
    btn.setAttribute('aria-pressed', String(on));
    for (const b of pop.querySelectorAll('[data-base]')) b.setAttribute('aria-checked', String(b.dataset.base === cur));
    pop.querySelector('#gm-clear').hidden = !savedKey();
    btn.classList.remove('needs-key');
    const tr = pop.querySelector('#gm-traffic'); if (tr) tr.checked = savedTraffic();
    const g = geoNow(), st = g && g.stats();
    pop.querySelector('#gm-stats').textContent = st ? `Đã hỏi ${g.label} ${st.calls} lượt tìm đường, đang nhớ ${st.cached} tuyến.` : '';
  };
  document.addEventListener('geo:update', () => { if (!pop.hidden) paint(); });
  // Báo lỗi bản đồ nền một lần mỗi phiên (màu cảnh báo, không phải lỗi đỏ): bản đồ sơ đồ của đồ án vẫn dùng bình thường
  const told = new Set();
  for (const b of [google, osm]) b.onNotice = (m) => {
    let seen = false;
    try { seen = sessionStorage.getItem('map.notice') === m; sessionStorage.setItem('map.notice', m); } catch { /* bỏ qua */ }
    if (!told.has(m) && !seen) toast(m, 'warn');
    told.add(m); paint(); say(m, true);
  };
  // Google lỗi (khoá sai, chưa bật billing...) thì tự chuyển sang OpenStreetMap thay vì về sơ đồ trắng
  google.onError = (e) => { setBase('osm'); osm.enable().then(() => { paint(); say(`Google Maps không dùng được (${e.message}). Đã chuyển sang OpenStreetMap.`, true); }); toast(`Google Maps không dùng được: ${e.message}. Đã chuyển sang OpenStreetMap.`, 'error'); };

  async function useGoogle({ quiet = false } = {}) {
    const key = (keyIn.value || savedKey()).trim();
    if (!key) { say('Dán khoá API vào ô trên rồi bấm Lưu.', true); keyIn.focus(); paint(); return; }
    if (!looksLikeKey(key)) { say('Khoá có vẻ chưa đúng (khoá Google thường bắt đầu bằng AIza và dài khoảng 39 ký tự).', true); keyIn.focus(); return; }
    if (needsReload(key)) { saveKey(key); setBase('google'); location.reload(); return; }
    if (busy) return;
    busy = true; say('Đang tải Google Maps…');
    try {
      saveKey(key);
      osm.disable();
      await google.enable(key);
      setBase('google'); keyIn.value = '';
      say('Đang dùng Google Maps: nền bản đồ và đường đi thật. Điểm giao, đường cấm tải, đơn gấp do hệ thống vẽ phía trên.');
    } catch (e) {
      setBase('osm'); await osm.enable();
      say(`${e.message}. Đã chuyển sang OpenStreetMap.`, true);
      if (quiet) toast(`Không bật được Google Maps (${e.message}), đang dùng OpenStreetMap.`);
    } finally { busy = false; paint(); }
  }

  async function useOsm() { google.disable(); await osm.enable(); setBase('osm'); say('Đang dùng OpenStreetMap: nền bản đồ thật và đường đi thật (OSRM), miễn phí.'); paint(); }
  function useSchematic() { google.disable(); osm.disable(); setBase('schematic'); say('Đang dùng sơ đồ.'); paint(); }

  const open = (on) => {
    pop.hidden = !on; btn.setAttribute('aria-expanded', String(on));
    if (on) { paint(); (savedKey() ? pop.querySelector('[data-base]') : keyIn).focus(); }
  };
  btn.addEventListener('click', () => open(pop.hidden));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { open(false); btn.focus(); } });
  document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) open(false); });
  pop.querySelector('#gm-seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-base]');
    if (!b) return;
    if (b.dataset.base === 'google') useGoogle(); else if (b.dataset.base === 'osm') useOsm(); else useSchematic();
  });
  pop.querySelector('#gm-save').addEventListener('click', () => useGoogle());
  keyIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); useGoogle(); } });
  pop.querySelector('#gm-clear').addEventListener('click', () => { useSchematic(); saveKey(''); keyIn.value = ''; say('Đã xoá khoá khỏi trình duyệt này.'); paint(); });

  pop.querySelector('#gm-traffic').addEventListener('change', (e) => { saveTraffic(e.target.checked); if (google.geo) google.geo.setTraffic(e.target.checked); });
  paint();
  const pick = savedBase() || (savedKey() ? 'google' : 'osm');
  if (pick === 'google' && savedKey()) useGoogle({ quiet: true });
  else if (pick === 'schematic') paint();
  else useOsm();
  return google;
}
