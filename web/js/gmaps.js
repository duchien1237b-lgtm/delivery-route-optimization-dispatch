// Nền bản đồ Google Maps (tuỳ chọn) cho bản đồ SVG của đồ án.
//
// Toạ độ nút trong dữ liệu đã là vĩ độ / kinh độ thật (WGS-84) và MapView dùng đúng phép chiếu Web Mercator, nên không cần
// ánh xạ toạ độ: Google Maps chỉ làm LỚP NỀN nằm dưới SVG, còn điểm, lộ trình, lớp cấm tải, đơn gấp... vẫn do MapView vẽ.
// Mỗi lần khung nhìn đổi, sync() đặt Google về cùng tâm và cùng mức phóng.
//
// Google Maps là nền MẶC ĐỊNH khi trình duyệt đã có khoá API; đường đi thật và ETA lấy từ Routes API của Google (RouteGeo).
// Khoá API KHÔNG nằm trong repo: người dùng nhập ở nút "Nền bản đồ" (lưu localStorage của trình duyệt). Không có khoá,
// khoá sai, chưa bật Routes API, hết hạn mức hay mất mạng thì tự dùng lại sơ đồ SVG và thuật toán Dijkstra của đồ án.
const KEY_STORE = 'gmaps.key';
const ON_STORE = 'gmaps.on';
const SDK_TIMEOUT = 15000;

const serverKey = () => String((typeof window !== 'undefined' && window.GMAPS_KEY) || '').trim();   // khoá do máy chủ cấp (biến môi trường GOOGLE_MAPS_KEY)
export const savedKey = () => { try { return (localStorage.getItem(KEY_STORE) || '').trim() || serverKey(); } catch { return serverKey(); } };
export const savedOn = () => { try { return localStorage.getItem(ON_STORE) !== '0'; } catch { return true; } };   // mặc định bật
export const savedTraffic = () => { try { return localStorage.getItem('gmaps.traffic') === '1'; } catch { return false; } };
export function saveTraffic(on) { try { localStorage.setItem('gmaps.traffic', on ? '1' : '0'); } catch { /* bỏ qua */ } }
export function saveKey(key) { try { key ? localStorage.setItem(KEY_STORE, key.trim()) : localStorage.removeItem(KEY_STORE); } catch { /* bỏ qua */ } }
export function saveOn(on) { try { localStorage.setItem(ON_STORE, on ? '1' : '0'); } catch { /* bỏ qua */ } }

// Khoá API của Google có dạng "AIza" + 35 ký tự; chỉ kiểm tra hình dạng để bắt lỗi dán nhầm, không gọi mạng.
export const looksLikeKey = (k) => /^[A-Za-z0-9_-]{20,80}$/.test((k || '').trim());

let sdk = null;          // Promise nạp script một lần cho cả phiên
let loadedKey = '';      // khoá đã nạp; Google không cho đổi khoá khi chưa tải lại trang
export const needsReload = (key) => !!loadedKey && loadedKey !== key;
let badKey = false;
let authFailed = null;   // hàm gọi khi Google báo khoá không hợp lệ

function loadSdk(key) {
  if (window.google && window.google.maps && window.google.maps.importLibrary) return Promise.resolve();
  if (sdk) return sdk;
  loadedKey = key;
  sdk = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Hết thời gian chờ Google Maps')), SDK_TIMEOUT);
    window.__gmReady = () => { clearTimeout(timer); resolve(); };
    window.gm_authFailure = () => { badKey = true; if (authFailed) authFailed(new Error('Google từ chối khoá API (sai khoá, chưa bật Maps JavaScript API hoặc bị giới hạn domain)')); };
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&language=vi&region=VN&callback=__gmReady`;
    s.async = true;
    s.onerror = () => { clearTimeout(timer); reject(new Error('Không tải được Google Maps (mất mạng hoặc bị chặn)')); };
    document.head.append(s);
  }).catch((e) => { sdk = null; loadedKey = ''; document.querySelectorAll('script[src*="maps.googleapis.com/maps/api/js"]').forEach((n) => n.remove()); throw e; });
  return sdk;
}

// Kiểu tối gọn cho Google Maps (bản đồ raster không dùng được mapId nên đặt kiểu bằng JSON)
const DARK = [
  { elementType: 'geometry', stylers: [{ color: '#1a1f24' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9aa5ad' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#14181c' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2b333a' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3a444c' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f1c26' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];
const LIGHT = [{ featureType: 'poi', stylers: [{ visibility: 'off' }] }, { featureType: 'transit', stylers: [{ visibility: 'off' }] }];

const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
};

export class GoogleBase {
  constructor(stage, mapView) {
    this.stage = stage;
    this.mv = mapView;
    this.el = null;
    this.map = null;
    this.size = '';
    this.onError = () => {};
    this.onNotice = () => {};
    this.geo = null;
    this._mo = new MutationObserver(() => this._style());
  }

  get active() { return !!this.map; }

  // Bật nền Google. Ném lỗi (tiếng Việt) nếu không dùng được; khi đó MapView vẫn ở chế độ sơ đồ.
  async enable(key) {
    if (this.active) return;
    if (badKey) throw new Error('Google đã từ chối khoá API trong phiên này, hãy sửa khoá rồi tải lại trang');
    authFailed = (e) => { this.disable(); this.onError(e); };
    await loadSdk(key);
    const { Map } = await window.google.maps.importLibrary('maps');
    // Giữ thứ tự lớp: nền Google < canvas vẽ nhanh < SVG
    const el = document.createElement('div');
    el.className = 'gm-base';
    el.setAttribute('aria-hidden', 'true');
    this.stage.insertBefore(el, this.stage.firstChild);
    this.el = el;
    this.map = new Map(el, {
      center: { lat: 10.7769, lng: 106.7009 }, zoom: 12,
      disableDefaultUI: true, gestureHandling: 'none', keyboardShortcuts: false, clickableIcons: false,
      styles: isDark() ? DARK : LIGHT, backgroundColor: isDark() ? '#1a1f24' : '#eceff0',
    });
    this._mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    this.stage.classList.add('gmap-on');
    this.mv.base = this;
    this.geo = new RouteGeo({ onUpdate: () => { this.mv.render(); document.dispatchEvent(new CustomEvent('geo:update')); }, onFatal: (m) => this.onNotice(m) });
    this.geo.traffic = savedTraffic();
    this.mv.geo = this.geo;
    this.mv.render();
  }

  disable() {
    if (!this.active && !this.el) return;
    this._mo.disconnect();
    this.map = null;
    this.size = '';
    if (this.el) this.el.remove();
    this.el = null;
    this.stage.classList.remove('gmap-on');
    if (this.mv.base === this) { this.mv.base = null; this.mv.geo = null; }
    this.geo = null;
    document.dispatchEvent(new CustomEvent('geo:update'));
    this.mv.render();
  }

  _style() { if (this.map) this.map.setOptions({ styles: isDark() ? DARK : LIGHT, backgroundColor: isDark() ? '#1a1f24' : '#eceff0' }); }

  // Đặt Google về đúng khung nhìn của MapView. Mercator của MapView: màn hình = độ · scale, nên 1 độ = scale px;
  // Google ở mức zoom z có 256·2^z px cho 360 độ. Google chỉ nhận mức zoom nguyên (bản raster), phần lẻ được bù bằng
  // CSS scale trên khung chứa rộng gấp đôi (luôn phủ kín màn hình).
  sync(w, h) {
    const v = this.mv.view;
    if (!this.map || !v || !(v.scale > 0)) return;
    const c = this.mv.unproject(w / 2, h / 2);
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) return;
    const z = Math.log2((v.scale * 360) / 256);
    const zi = Math.min(21, Math.max(0, Math.floor(z)));
    const s = Math.pow(2, z - zi);
    const size = `${Math.round(w)}x${Math.round(h)}`;
    if (size !== this.size) {
      this.size = size;
      Object.assign(this.el.style, { width: `${w * 2}px`, height: `${h * 2}px`, left: `${-w / 2}px`, top: `${-h / 2}px` });
    }
    this.el.style.transform = `scale(${s})`;
    const cam = { center: { lat: c.lat, lng: c.lon }, zoom: zi };
    if (this.map.moveCamera) this.map.moveCamera(cam); else this.map.setOptions(cam);
  }
}

// ---------------------------------------------------------------- Tìm đường trên Google (Routes API)
// Chuyển một danh sách toạ độ [[lat, lon], ...] thành đường đi thật trên phố. Dùng Route.computeRoutes của thư viện "routes"
// (Maps JavaScript API; cần bật thêm Routes API cho khoá). Kết quả chỉ để HIỂN THỊ và so sánh; thuật toán Dijkstra và các số
// liệu của máy chủ không đổi. Mọi lỗi (chưa bật API, hết hạn mức, mất mạng) đều quay về đường thẳng theo đồ thị.
const MAX_CALLS = 400;        // trần số lần gọi Google trong một lần mở trang (chặn vòng lặp tốn tiền)
const MAX_INTER = 25;         // Google nhận tối đa 25 điểm trung gian cho mỗi yêu cầu
const MAX_POINTS = 150;       // lộ trình dài hơn thì vẽ đường thẳng, không hỏi Google
const FATAL = /PERMISSION_DENIED|REQUEST_DENIED|not enabled|has not been used|API key|not authorized|OVER_QUERY_LIMIT|RESOURCE_EXHAUSTED|QUOTA|\b40[13]\b|\b429\b/i;

export const modeOf = (vehicle) => (/xe máy/i.test(vehicle || '') ? 'TWO_WHEELER' : 'DRIVING');
const coordOf = (p) => (typeof p.lat === 'function' ? [p.lat(), p.lng()] : [p.lat, p.lng]);
const ll = (c) => ({ lat: c[0], lng: c[1] });
const d2 = (a, b) => { const dx = a[0] - b[0], dy = (a[1] - b[1]) * 0.98; return dx * dx + dy * dy; };

export class RouteGeo {
  label = 'Google Maps';
  constructor({ onUpdate, onFatal } = {}) {
    this.onUpdate = onUpdate || (() => {});
    this.onFatal = onFatal || (() => {});
    this.cache = new Map();      // khoá -> {pts, idx, meters, seconds, mode}
    this.bad = new Map();        // khoá -> thời điểm thất bại (thử lại sau 60 giây)
    this.pending = new Set();
    this.queue = [];
    this.active = 0;
    this.calls = 0;
    this.errors = 0;
    this.fatal = '';
    this.traffic = false;
    this._raf = 0;
  }

  stats() { return { calls: this.calls, cached: this.cache.size, errors: this.errors, fatal: this.fatal }; }
  _save() { /* Google: không lưu kết quả xuống máy (điều khoản của Google) */ }
  setTraffic(on) { if (this.traffic === on) return; this.traffic = on; this.cache.clear(); this.bad.clear(); this._notify(); }
  reset() { this.fatal = ''; this.bad.clear(); this._notify(); }
  _notify() { if (this._raf) return; this._raf = requestAnimationFrame(() => { this._raf = 0; this.onUpdate(); }); }
  _key(coords, mode) { return `${mode}${this.traffic ? 'T' : ''}|${coords.map((c) => `${c[0].toFixed(5)},${c[1].toFixed(5)}`).join(';')}`; }

  // Đã có đường thật chưa? Trả về entry hoặc null
  peek(coords, vehicle) { return this.cache.get(this._key(coords, modeOf(vehicle))) || null; }

  // Xin Google đường thật đi theo đúng thứ tự các điểm (không chờ kết quả)
  want(coords, vehicle) {
    if (this.fatal || coords.length < 2 || coords.length > MAX_POINTS) return;
    const mode = modeOf(vehicle), key = this._key(coords, mode);
    if (this.cache.has(key) || this.pending.has(key)) return;
    const t = this.bad.get(key);
    if (t && Date.now() - t < 60000) return;
    this.pending.add(key);
    this.queue.push({ key, coords, mode });
    this._pump();
  }

  _pump() {
    while (this.active < (this.maxActive || 3) && this.queue.length) {
      const job = this.queue.shift();
      this.active++;
      this._follow(job).then((entry) => { if (entry) { this.cache.set(job.key, entry); this._save(job.key, entry); } else this.bad.set(job.key, Date.now()); })
        .catch(() => this.bad.set(job.key, Date.now()))
        .finally(() => { this.pending.delete(job.key); this.active--; this._notify(); this._pump(); });
    }
  }

  // Một yêu cầu tới Routes API; thất bại với xe máy thì thử lại bằng ô tô (nhiều vùng chưa hỗ trợ two-wheeler)
  async _compute(coords, mode, { alternatives = false } = {}) {
    if (this.fatal) throw new Error(this.fatal);
    if (this.calls >= MAX_CALLS) { this.fatal = `Đã dùng ${MAX_CALLS} lượt hỏi Google trong lần mở trang này (trần chống tốn phí), các tuyến sau vẽ theo đồ thị. Tải lại trang để tiếp tục.`; this.onFatal(this.fatal); throw new Error(this.fatal); }
    const { Route } = await window.google.maps.importLibrary('routes');
    const req = { origin: ll(coords[0]), destination: ll(coords[coords.length - 1]), travelMode: mode, fields: ['path', 'distanceMeters', 'durationMillis'] };
    if (coords.length > 2) req.intermediates = coords.slice(1, -1).map(ll);
    else if (alternatives) req.computeAlternativeRoutes = true;   // Google không cho gợi ý tuyến khác khi có điểm trung gian
    if (this.traffic && mode === 'DRIVING') { req.routingPreference = 'TRAFFIC_AWARE'; req.departureTime = new Date(Date.now() + 60000); }
    this.calls++;
    try {
      const { routes } = await Route.computeRoutes(req);
      if (!routes || !routes.length) throw new Error('ZERO_RESULTS');
      return routes.map((r) => ({ pts: (r.path || []).map(coordOf), meters: r.distanceMeters || 0, seconds: (r.durationMillis || 0) / 1000 })).filter((r) => r.pts.length > 1);
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (mode === 'TWO_WHEELER' && !FATAL.test(msg)) return this._compute(coords, 'DRIVING', { alternatives });
      this.errors++;
      if (FATAL.test(msg)) {
        this.fatal = /not enabled|has not been used|PERMISSION_DENIED|REQUEST_DENIED|API key|not authorized|40[13]/i.test(msg)
          ? 'Khoá chưa bật Routes API (hoặc bị giới hạn API): bật “Routes API” trong Google Cloud, hiện đang vẽ theo thuật toán của đồ án'
          : 'Google báo hết hạn mức: đang vẽ theo thuật toán của đồ án';
        this.onFatal(this.fatal);
      }
      throw e;
    }
  }

  // Đường thật qua toàn bộ các điểm theo thứ tự; chia nhỏ khi nhiều hơn 27 điểm. idx[i] = vị trí điểm thứ i trên đường vẽ
  async _follow({ coords, mode }) {
    const parts = [];
    for (let a = 0; a < coords.length - 1; a += MAX_INTER + 1) {
      const b = Math.min(a + MAX_INTER + 1, coords.length - 1);
      const [r] = await this._compute(coords.slice(a, b + 1), mode);
      parts.push(r);
    }
    const pts = [];
    let meters = 0, seconds = 0;
    for (const r of parts) { pts.push(...(pts.length ? r.pts.slice(1) : r.pts)); meters += r.meters; seconds += r.seconds; }
    // Gắn từng điểm của đồ thị với vị trí gần nhất (đi tiến dần) trên đường Google vẽ
    const idx = [0];
    let from = 0;
    for (let i = 1; i < coords.length - 1; i++) {
      let best = from, bd = Infinity;
      for (let j = from; j < pts.length; j++) { const d = d2(pts[j], coords[i]); if (d < bd) { bd = d; best = j; } }
      idx.push(best); from = best;
    }
    idx.push(pts.length - 1);
    return { pts, idx, meters, seconds, mode };
  }

  // Tìm đường từ A tới B do chính Google chọn (không ép đi qua điểm nào), kèm các tuyến thay thế
  async best(from, to, vehicle) {
    const mode = modeOf(vehicle), key = `best|${this._key([from, to], mode)}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const routes = await this._compute([from, to], mode, { alternatives: true });
    this.cache.set(key, routes);
    return routes;
  }
}

export const fmtRoute = (e) => `${(e.meters / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} km · ${Math.max(1, Math.round(e.seconds / 60))} phút`;

// ---------------------------------------------------------------- Liên kết "Mở trong Google Maps"
const pt = (n) => `${Number(n.x).toFixed(6)},${Number(n.y).toFixed(6)}`;

// Chỉ đường từ điểm đầu (bỏ trống thì Google dùng vị trí hiện tại của điện thoại) qua các điểm trung gian tới điểm cuối.
// Google nhận tối đa 9 điểm trung gian; xe máy dùng chế độ two-wheeler, còn lại driving.
export function directionsUrl(nodes, { vehicle = '', fromHere = false } = {}) {
  const list = (nodes || []).filter((n) => n && Number.isFinite(n.x) && Number.isFinite(n.y));
  if (!list.length) return '';
  const p = new URLSearchParams({ api: '1', travelmode: /xe máy/i.test(vehicle) ? 'two-wheeler' : 'driving' });
  const dest = list[list.length - 1];
  p.set('destination', pt(dest));
  let rest = list.slice(0, -1);
  if (!fromHere && rest.length) { p.set('origin', pt(rest[0])); rest = rest.slice(1); }
  if (rest.length) p.set('waypoints', rest.slice(0, 9).map(pt).join('|'));
  return `https://www.google.com/maps/dir/?${p.toString().replace(/%2C/g, ',').replace(/%7C/g, '|')}`;
}

export const placeUrl = (n) => `https://www.google.com/maps/search/?api=1&query=${pt(n)}`;

// ---------------------------------------------------------------- OpenStreetMap (miễn phí, không cần khoá, không cần thẻ)
// Nền: ảnh bản đồ (tile) của OpenStreetMap đặt dưới SVG, cùng phép chiếu Web Mercator nên không cần quy đổi toạ độ.
// Đường thật: máy chủ OSRM công cộng (router.project-osrm.org, chỉ có ô tô). Dùng cho học tập / lưu lượng nhỏ; ghi công "© OpenStreetMap".
const OSM_TILE = 'https://tile.openstreetmap.org';
const OSRM = 'https://router.project-osrm.org/route/v1/driving';

export class OsmBase {
  constructor(stage, mapView) {
    this.stage = stage;
    this.mv = mapView;
    this.el = null;
    this.attr = null;
    this.tiles = new Map(); this.tileErrors = 0; this.tileLoaded = false;
    this.size = '';
    this.active = false;
    this.geo = null;
    this.onError = () => {};
    this.onNotice = () => {};
    this._mo = new MutationObserver(() => this._style());
  }

  async enable() {
    if (this.active) return;
    const el = document.createElement('div');
    el.className = 'gm-base osm-base';
    el.setAttribute('aria-hidden', 'true');
    this.stage.insertBefore(el, this.stage.firstChild);
    this.el = el;
    const a = document.createElement('div');
    a.className = 'osm-attr';
    a.innerHTML = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';
    this.stage.append(a);
    this.attr = a;
    this._style();
    this._mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    this.active = true;
    this.stage.classList.add('gmap-on');
    this.mv.base = this;
    this.geo = new OsmGeo({ onUpdate: () => { this.mv.render(); document.dispatchEvent(new CustomEvent('geo:update')); }, onFatal: (m) => this.onNotice(m) });
    this.mv.geo = this.geo;
    this.mv.render();
  }

  disable() {
    if (!this.active) return;
    this._mo.disconnect();
    this.active = false;
    this.tiles.clear();
    this.size = '';
    if (this.el) this.el.remove();
    if (this.attr) this.attr.remove();
    this.el = this.attr = null;
    this.stage.classList.remove('gmap-on');
    if (this.mv.base === this) { this.mv.base = null; this.mv.geo = null; }
    this.geo = null;
    document.dispatchEvent(new CustomEvent('geo:update'));
    this.mv.render();
  }

  _style() { if (this.el) this.el.classList.toggle('dark', isDark()); }

  sync(w, h) {
    const v = this.mv.view;
    if (!this.active || !v || !(v.scale > 0)) return;
    const c = this.mv.unproject(w / 2, h / 2);
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) return;
    const z = Math.log2((v.scale * 360) / 256);
    const zi = Math.min(19, Math.max(0, Math.floor(z)));
    const s = Math.pow(2, z - zi);
    const n = Math.pow(2, zi);
    const sin = Math.sin((Math.max(-85.05, Math.min(85.05, c.lat)) * Math.PI) / 180);
    const cx = ((c.lon + 180) / 360) * 256 * n;
    const cy = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * 256 * n;
    const size = `${Math.round(w)}x${Math.round(h)}`;
    if (size !== this.size) {
      this.size = size;
      Object.assign(this.el.style, { width: `${w * 2}px`, height: `${h * 2}px`, left: `${-w / 2}px`, top: `${-h / 2}px` });
    }
    this.el.style.transform = `scale(${s})`;
    const hw = w / (2 * s) + 2, hh = h / (2 * s) + 2;
    const x0 = Math.floor((cx - hw) / 256), x1 = Math.floor((cx + hw) / 256);
    const y0 = Math.max(0, Math.floor((cy - hh) / 256)), y1 = Math.min(n - 1, Math.floor((cy + hh) / 256));
    const want = new Set();
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const key = `${zi}/${tx}/${ty}`;
        want.add(key);
        let img = this.tiles.get(key);
        if (!img) {
          img = document.createElement('img');
          img.alt = ''; img.draggable = false; img.decoding = 'async'; img.referrerPolicy = 'strict-origin-when-cross-origin';
          img.src = `${OSM_TILE}/${zi}/${((tx % n) + n) % n}/${ty}.png`;
          img.style.cssText = 'position:absolute;width:256px;height:256px;max-width:none;user-select:none';
          // Ô bản đồ lỗi (mất mạng, bị chặn) thì ẩn đi thay vì hiện biểu tượng ảnh hỏng; lỗi liên tục thì báo một lần
          img.onerror = () => {
            img.style.visibility = 'hidden';
            if (++this.tileErrors === 12 && !this.tileLoaded && this.onNotice) this.onNotice('Không tải được bản đồ OpenStreetMap (mất mạng hoặc bị chặn): vẫn dùng được sơ đồ của đồ án.');
          };
          img.onload = () => { this.tileLoaded = true; };
          this.el.append(img);
          this.tiles.set(key, img);
        }
        img.style.left = `${w + tx * 256 - cx}px`;
        img.style.top = `${h + ty * 256 - cy}px`;
      }
    }
    for (const [key, img] of this.tiles) if (!want.has(key)) { img.remove(); this.tiles.delete(key); }
  }
}

// Đường thật qua OSRM, cùng giao diện với RouteGeo của Google (peek / want / best / stats).
// Máy chủ OSRM công cộng cho phép khoảng 1 yêu cầu / giây: gửi lần lượt từng yêu cầu, cách nhau ≥ 1,1 giây, gặp 429 thì chờ
// rồi thử lại; đường đã tìm được lưu vào localStorage (tối đa 80 tuyến) để mở lại trang không phải hỏi lại.
const OSRM_STORE = 'osrm.cache.v1', OSRM_KEEP = 80, OSRM_GAP = 1100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export class OsmGeo extends RouteGeo {
  constructor(o) {
    super(o); this.label = 'OpenStreetMap'; this.streak = 0; this.maxActive = 1; this.last = 0;
    try {
      const saved = JSON.parse(localStorage.getItem(OSRM_STORE) || '[]');
      for (const [k, v] of saved) if (v && Array.isArray(v.pts) && Array.isArray(v.idx)) this.cache.set(k, v);
    } catch { /* bộ nhớ trình duyệt bị chặn hoặc hỏng: bỏ qua */ }
  }
  _save(key, entry) {
    try {
      const all = [...this.cache.entries()].filter(([k]) => !k.startsWith('best|')).slice(-OSRM_KEEP);
      localStorage.setItem(OSRM_STORE, JSON.stringify(all));
    } catch { /* đầy bộ nhớ: bỏ qua */ }
  }
  async _compute(coords, mode, { alternatives = false } = {}, attempt = 0) {
    if (this.fatal) throw new Error(this.fatal);
    const wait = this.last + OSRM_GAP - Date.now();
    if (wait > 0) await sleep(wait);
    this.last = Date.now();
    if (this.calls >= MAX_CALLS) { this.fatal = `Đã dùng ${MAX_CALLS} lượt hỏi OSRM trong lần mở trang này, các tuyến sau vẽ theo đồ thị. Tải lại trang để tiếp tục.`; this.onFatal(this.fatal); throw new Error(this.fatal); }
    const path = coords.map((c) => `${c[1].toFixed(6)},${c[0].toFixed(6)}`).join(';');
    const url = `${OSRM}/${path}?overview=full&geometries=geojson&steps=false${alternatives && coords.length === 2 ? '&alternatives=3' : ''}`;
    this.calls++;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12000);
    try {
      const res = await fetch(url, { signal: ctl.signal });
      if (res.status === 429 && attempt < 3) {   // quá nhanh: chờ rồi thử lại, không tính là máy chủ hỏng
        clearTimeout(timer); this.calls--;
        await sleep(2000 * (attempt + 1));
        return this._compute(coords, mode, { alternatives }, attempt + 1);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.code !== 'Ok' || !data.routes || !data.routes.length) throw new Error(data.code || 'ZERO_RESULTS');
      this.streak = 0;
      return data.routes.map((r) => ({ pts: r.geometry.coordinates.map((p) => [p[1], p[0]]), meters: r.distance || 0, seconds: r.duration || 0 })).filter((r) => r.pts.length > 1);
    } catch (e) {
      this.errors++;
      if (++this.streak >= 4) { this.fatal = 'Máy chủ đường đi OSRM không trả lời: đang vẽ theo thuật toán của đồ án'; this.onFatal(this.fatal); }
      throw e;
    } finally { clearTimeout(timer); }
  }
}
