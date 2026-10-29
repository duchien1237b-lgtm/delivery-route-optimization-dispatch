// Bản JavaScript của src/Auth.{h,cpp}: vai trò, vòng đời tài khoản, SHA-256 tự cài, phiên, chống dò mật khẩu,
// giới hạn tần suất, mã OTP đặt lại mật khẩu và bảng phân quyền API (cùng nội dung với bản C++).
var ADMIN = 0;
var SHIPPER = 1;
var CUSTOMER = 2;
var KEYS = ["admin", "shipper", "customer"];
var NAMES = ["Quản trị viên", "Shipper", "Khách hàng"];
var roleKey = (r) => KEYS[r] ?? "customer";
var roleName = (r) => NAMES[r] ?? "Khách hàng";
var roleFromKey = (s) => {
  const i = KEYS.indexOf(s);
  return i < 0 ? null : i;
};
// Trạng thái tài khoản (Auth::Status). Đặt tên ACC_* vì PENDING đã là trạng thái đơn hàng.
var ACC_ACTIVE = 0;
var ACC_PENDING = 1;
var ACC_LOCKED = 2;
var ACC_DISABLED = 3;
var STATUS_KEYS = ["active", "pending", "locked", "disabled"];
var STATUS_NAMES = ["Hoạt động", "Chờ duyệt", "Bị khoá", "Vô hiệu hoá"];
var statusKey = (s) => STATUS_KEYS[s] ?? "active";
var statusName = (s) => STATUS_NAMES[s] ?? "Hoạt động";
var statusFromKey = (s) => {
  const i = STATUS_KEYS.indexOf(s);
  return i < 0 ? null : i;
};
function statusTransitionAllowed(from, to) {
  switch (from) {
    case ACC_PENDING: return to === ACC_ACTIVE || to === ACC_DISABLED;
    case ACC_ACTIVE: return to === ACC_LOCKED || to === ACC_DISABLED;
    case ACC_LOCKED: return to === ACC_ACTIVE || to === ACC_DISABLED;
    case ACC_DISABLED: return to === ACC_ACTIVE;
  }
  return false;
}
var HASH_ROUNDS = 1e4;
var SESSION_MINUTES = 12 * 60;
var REMEMBER_DAYS = 30;
var LOCK_AFTER = 5;
var LOCK_SECONDS = 60;
var MAX_LOCK_SECONDS = 15 * 60;
var MIN_PASSWORD = 6;
var MIN_PASSWORD_STRONG = 8;
var RESET_MINUTES = 10;
var RESET_MAX_TRIES = 5;
var K = new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var enc = new TextEncoder;
var W = new Uint32Array(64);
function sha256(text) {
  const data = typeof text === "string" ? enc.encode(text) : text;
  const len = data.length;
  const total = Math.ceil((len + 9) / 64) * 64;
  const msg = new Uint8Array(total);
  msg.set(data);
  msg[len] = 128;
  const bits = len * 8;
  const dv = new DataView(msg.buffer);
  dv.setUint32(total - 8, Math.floor(bits / 4294967296));
  dv.setUint32(total - 4, bits >>> 0);
  let h0 = 1779033703, h1 = 3144134277, h2 = 1013904242, h3 = 2773480762, h4 = 1359893119, h5 = 2600822924, h6 = 528734635, h7 = 1541459225;
  for (let off = 0;off < total; off += 64) {
    for (let i = 0;i < 16; i++)
      W[i] = dv.getUint32(off + i * 4);
    for (let i = 16;i < 64; i++) {
      const a = W[i - 15], b = W[i - 2];
      const s0 = (a >>> 7 | a << 25) ^ (a >>> 18 | a << 14) ^ a >>> 3;
      const s1 = (b >>> 17 | b << 15) ^ (b >>> 19 | b << 13) ^ b >>> 10;
      W[i] = W[i - 16] + s0 + W[i - 7] + s1 | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0;i < 64; i++) {
      const S1 = (e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7);
      const ch = e & f ^ ~e & g;
      const t1 = h + S1 + ch + K[i] + W[i] | 0;
      const S0 = (a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10);
      const maj = a & b ^ a & c ^ b & c;
      const t2 = S0 + maj | 0;
      h = g;
      g = f;
      f = e;
      e = d + t1 | 0;
      d = c;
      c = b;
      b = a;
      a = t1 + t2 | 0;
    }
    h0 = h0 + a | 0;
    h1 = h1 + b | 0;
    h2 = h2 + c | 0;
    h3 = h3 + d | 0;
    h4 = h4 + e | 0;
    h5 = h5 + f | 0;
    h6 = h6 + g | 0;
    h7 = h7 + h | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
}
function hashPassword(salt, password) {
  let h = sha256(salt + ":" + password);
  for (let i = 1;i < HASH_ROUNDS; i++)
    h = sha256(h + salt);
  return h;
}
function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(a);
  return [...a].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function randomDigits(n) {
  let s = "";
  const a = new Uint32Array(1);
  while (s.length < n) {
    globalThis.crypto.getRandomValues(a);
    if (a[0] >= 4294967290)
      continue;
    s += String(a[0] % 10);
  }
  return s;
}
function sameText(a, b) {
  if (a.length !== b.length)
    return false;
  let diff = 0;
  for (let i = 0;i < a.length; i++)
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
// Độ dài theo byte UTF-8 (C++ dùng std::string::size()) và theo ký tự (utf8Length)
var blen = (s) => enc.encode(s).length;
var ulen = (s) => [...s].length;
var asciiLower = (s) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
var trimWs = (s) => s.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
var toField = (s) => s ? s.replace(/[ \t#\n\r]/g, "_") : "-";
var fromField = (s) => s === "-" ? "" : s.replace(/_/g, " ");
// std::stoll / std::stoi / std::stod: bỏ khoảng trắng đầu, đọc phần số hợp lệ dài nhất, không có số thì lỗi
function cppStoll(s) {
  const m = /^[ \t\n\r\f\v]*([+-]?\d+)/.exec(s);
  if (!m)
    throw new Error("stoll");
  return Number(m[1]);
}
function cppStod(s) {
  const m = /^[ \t\n\r\f\v]*([+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)/.exec(s);
  if (!m)
    throw new Error("stod");
  return Number(m[1]);
}
// In số thực như std::ostream mặc định (precision 6, %g)
function gfmt(x, p = 6) {
  if (!Number.isFinite(x))
    return x > 0 ? "inf" : x < 0 ? "-inf" : "nan";
  if (x === 0)
    return Object.is(x, -0) ? "-0" : "0";
  const e = Number(x.toExponential(p - 1).split("e")[1]);
  if (e < -4 || e >= p) {
    let [m, ex] = x.toExponential(p - 1).split("e");
    if (m.includes("."))
      m = m.replace(/0+$/, "").replace(/\.$/, "");
    const n = Number(ex);
    return `${m}e${n < 0 ? "-" : "+"}${String(Math.abs(n)).padStart(2, "0")}`;
  }
  let s = x.toFixed(Math.max(0, p - 1 - e));
  if (s.includes("."))
    s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s;
}
function usernameFormat(u) {
  if (blen(u) < 3 || blen(u) > 20)
    return "Tên đăng nhập dài 3–20 ký tự";
  if (!/^[a-z0-9_.]*$/.test(u))
    return "Tên đăng nhập chỉ gồm chữ thường không dấu, số, '_' và '.'";
  return "";
}
function checkUsername(u) {
  const e = usernameFormat(u);
  if (e)
    return e;
  if (validPhone(u))
    return "Tên đăng nhập không được giống số điện thoại";
  return "";
}
function checkPassword(p) {
  if (blen(p) < MIN_PASSWORD)
    return `Mật khẩu cần ít nhất ${MIN_PASSWORD} ký tự`;
  if (blen(p) > 128)
    return "Mật khẩu quá dài";
  if (!/[a-zA-Z]/.test(p) || !/[0-9]/.test(p))
    return "Mật khẩu cần có cả chữ và số";
  return "";
}
var COMMON_PASSWORDS = new Set([
  "password", "password1", "password12", "password123", "passw0rd", "p@ssw0rd", "qwerty123", "qwerty1234", "qwertyuiop1",
  "abc12345", "abcd1234", "abc123456", "abcdefg1", "admin123", "admin1234", "admin12345", "administrator1", "welcome1",
  "welcome123", "letmein123", "iloveyou1", "iloveyou123", "monkey123", "dragon123", "football1", "baseball1",
  "12345678a", "123456789a", "1234567890a", "a12345678", "a123456789", "aa123456", "aa12345678", "matkhau123",
  "matkhau1234", "dieuphoi123", "shipper123", "khach123", "khachhang123", "giaohang123", "vietnam123", "hanoi12345",
  "saigon12345", "hcm123456", "test1234", "test12345", "user1234", "login123", "master123", "changeme1", "changeme123",
  "zaq12wsx", "1q2w3e4r", "1qaz2wsx", "q1w2e3r4", "asdf1234", "asdfghjkl1", "zxcvbnm123", "trustno1", "sunshine1"
]);
var isCommonPassword = (p) => COMMON_PASSWORDS.has(asciiLower(p));
function checkPasswordStrong(p, username = "") {
  if (blen(p) < MIN_PASSWORD_STRONG)
    return `Mật khẩu cần ít nhất ${MIN_PASSWORD_STRONG} ký tự`;
  if (blen(p) > 128)
    return "Mật khẩu quá dài (tối đa 128 ký tự)";
  let up = false, lo = false, dg = false;
  for (const ch of p) {
    const c = ch.charCodeAt(0);
    if (ch >= "A" && ch <= "Z")
      up = true;
    else if (ch >= "a" && ch <= "z")
      lo = true;
    else if (ch >= "0" && ch <= "9")
      dg = true;
    else if (c < 32 || c === 127)
      return "Mật khẩu chứa ký tự không hợp lệ";
  }
  if (!up || !lo || !dg)
    return "Mật khẩu cần có chữ hoa, chữ thường và chữ số";
  if (isCommonPassword(p))
    return "Mật khẩu này quá phổ biến, hãy chọn mật khẩu khác";
  if (username && asciiLower(p).includes(asciiLower(username)) && blen(username) >= 3)
    return "Mật khẩu không được chứa tên đăng nhập";
  return "";
}
var normalizeEmail = (e) => asciiLower(trimWs(e));
var normalizePhone = (p) => p.replace(/[ .-]/g, "");
function checkEmail(e) {
  if (!e || blen(e) > 80)
    return "Email không hợp lệ (tối đa 80 ký tự)";
  const bad = "Email không hợp lệ";
  const at = e.indexOf("@");
  if (at <= 0 || at !== e.lastIndexOf("@") || blen(e.slice(0, at)) > 64)
    return bad;
  if (!/^[A-Za-z0-9._%+-]+$/.test(e.slice(0, at)))
    return bad;
  if (e[0] === "." || e[at - 1] === "." || e.includes(".."))
    return bad;
  const dom = e.slice(at + 1);
  const dot = dom.lastIndexOf(".");
  if (!dom || dot <= 0 || dot + 3 > dom.length)
    return bad;
  if (!/^[A-Za-z0-9.-]+$/.test(dom))
    return bad;
  if (dom[0] === "-" || dom[0] === "." || dom[dom.length - 1] === "." || dom.includes(".."))
    return bad;
  if (!/^[A-Za-z]+$/.test(dom.slice(dot + 1)))
    return bad;
  return "";
}
var checkPhone = (p) => validPhone(p) ? "" : "Số điện thoại phải gồm 10 chữ số, bắt đầu bằng 0";
function checkDisplayName(n) {
  const len = ulen(n);
  if (len < 2)
    return "Họ tên / tên doanh nghiệp cần ít nhất 2 ký tự";
  if (len > 40)
    return "Họ tên / tên doanh nghiệp tối đa 40 ký tự";
  if (/[\x00-\x1f\x7f<>=#_]/.test(n))
    return "Họ tên / tên doanh nghiệp không được chứa các ký tự < > = # _ hoặc ký tự điều khiển";
  if (trimWs(n) !== n)
    return "Họ tên / tên doanh nghiệp không được bắt đầu hoặc kết thúc bằng khoảng trắng";
  return "";
}
function checkPlate(p) {
  if (blen(p) < 4 || blen(p) > 12)
    return "Biển số xe dài 4–12 ký tự (ví dụ 59A1-123.45)";
  if (!/^[A-Z0-9.-]*$/.test(p))
    return "Biển số xe chỉ gồm chữ in hoa, số, '-' và '.'";
  return "";
}
var ACCOUNT_KEYS = new Set(["status", "ly_do", "email", "sdt", "tao", "dn", "xe", "tai", "bien", "sansang", "vitri", "done", "chi"]);
var newAccountRecord = () => ({ username: "", role: CUSTOMER, salt: "", hash: "", link: "", displayName: "", status: ACC_ACTIVE, statusReason: "", email: "", phone: "", createdAt: 0, lastLogin: 0, vehicle: -1, capacity: 0, plate: "", ready: true, home: -1, done: 0, spent: 0 });

class AccountStore {
  constructor() {
    this.accounts = [];
    this.index = new Map;
  }
  reindex() {
    this.index = new Map(this.accounts.map((a, i) => [a.username, i]));
  }
  // Ném Error (thông báo giống bản C++) nếu file sai
  loadText(text) {
    const out = [], seen = new Set;
    String(text).replace(/^﻿/, "").split("\n").forEach((raw, k) => {
      const line = raw.replace(/\r$/, "");
      const no = k + 1;
      const first = line.search(/[^ \t]/);
      if (first < 0 || line[first] === "#")
        return;
      const m = line.match(/^\s*(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)(.*)$/);
      if (!m)
        throw new Error(`Dong ${no}: can '<ten> <vai_tro> <salt> <bam> <lien_ket> [khoa=gia_tri] <ten_hien_thi>'`);
      const a = newAccountRecord();
      a.username = m[1];
      a.salt = m[3];
      a.hash = m[4];
      let rest = trimWs(m[6]);
      while (rest) {
        const sp = rest.indexOf(" ");
        const tok = sp < 0 ? rest : rest.slice(0, sp);
        const eq = tok.indexOf("=");
        if (eq < 0 || !ACCOUNT_KEYS.has(tok.slice(0, eq)))
          break;
        const key = tok.slice(0, eq), val = tok.slice(eq + 1);
        try {
          if (key === "status") {
            const st = statusFromKey(val);
            if (st == null)
              throw new Error("status");
            a.status = st;
          } else if (key === "ly_do")
            a.statusReason = fromField(val);
          else if (key === "email")
            a.email = val;
          else if (key === "sdt")
            a.phone = val;
          else if (key === "tao")
            a.createdAt = cppStoll(val);
          else if (key === "dn")
            a.lastLogin = cppStoll(val);
          else if (key === "xe")
            a.vehicle = cppStoll(val);
          else if (key === "tai")
            a.capacity = cppStod(val);
          else if (key === "bien")
            a.plate = val;
          else if (key === "sansang")
            a.ready = val !== "0";
          else if (key === "vitri")
            a.home = cppStoll(val);
          else if (key === "done")
            a.done = cppStoll(val);
          else if (key === "chi")
            a.spent = cppStoll(val);
        } catch {
          throw new Error(`Dong ${no}: gia tri '${tok}' khong hop le`);
        }
        rest = sp < 0 ? "" : trimWs(rest.slice(sp + 1));
      }
      const name = rest.replace(/^[ \t]+/, "");
      if (m[2] === "dispatcher") {
        a.role = ADMIN;
        a.status = ACC_LOCKED;
        if (!a.statusReason)
          a.statusReason = "Vai trò điều phối viên đã bị bỏ, quản trị viên cần chọn lại vai trò";
      } else {
        const role = roleFromKey(m[2]);
        if (role == null)
          throw new Error(`Dong ${no}: vai tro '${m[2]}' khong hop le (admin / shipper / customer)`);
        a.role = role;
      }
      if (usernameFormat(a.username))
        throw new Error(`Dong ${no}: ten dang nhap '${a.username}' khong hop le`);
      if (!/^[0-9a-f]{64}$/.test(a.hash))
        throw new Error(`Dong ${no}: ma bam phai la 64 ky tu hex`);
      if (seen.has(a.username))
        throw new Error(`Dong ${no}: trung ten dang nhap ${a.username}`);
      seen.add(a.username);
      a.link = fromField(m[5]);
      a.displayName = fromField(name) || a.username;
      a.email = normalizeEmail(a.email);
      out.push(a);
    });
    this.accounts = out;
    this.reindex();
  }
  toText() {
    let s = `# Tai khoan dang nhap (mat khau chi luu ban bam SHA-256 co muoi, ${HASH_ROUNDS} vong)\n`;
    s += "# ten_dang_nhap  vai_tro(admin/shipper/customer)  salt  bam  lien_ket(ten shipper, '-' neu khong)  [khoa=gia_tri ...]  ten_hien_thi\n";
    s += "# khoa tuy chon: status ly_do email sdt tao(giay) dn(giay) xe tai bien sansang vitri done chi\n";
    for (const a of this.accounts) {
      s += `${a.username} ${roleKey(a.role)} ${a.salt} ${a.hash} ${toField(a.link)}`;
      if (a.status !== ACC_ACTIVE)
        s += ` status=${statusKey(a.status)}`;
      if (a.statusReason)
        s += ` ly_do=${toField(a.statusReason)}`;
      if (a.email)
        s += ` email=${a.email}`;
      if (a.phone)
        s += ` sdt=${a.phone}`;
      if (a.createdAt)
        s += ` tao=${a.createdAt}`;
      if (a.lastLogin)
        s += ` dn=${a.lastLogin}`;
      if (a.vehicle >= 0)
        s += ` xe=${a.vehicle}`;
      if (a.capacity > 0)
        s += ` tai=${gfmt(a.capacity)}`;
      if (a.plate)
        s += ` bien=${a.plate}`;
      if (!a.ready)
        s += " sansang=0";
      if (a.home >= 0)
        s += ` vitri=${a.home}`;
      if (a.done)
        s += ` done=${a.done}`;
      if (a.spent)
        s += ` chi=${a.spent}`;
      s += ` ${toField(a.displayName).replace(/=/g, "-")}\n`;
    }
    return s;
  }
  all() {
    return this.accounts;
  }
  find(u) {
    const i = this.index.get(u);
    return i === undefined ? null : this.accounts[i];
  }
  findByEmail(email) {
    const e = normalizeEmail(email);
    if (!e)
      return null;
    return this.accounts.find((a) => a.email === e) || null;
  }
  findByPhone(phone) {
    const p = normalizePhone(phone);
    if (!p)
      return null;
    return this.accounts.find((a) => a.phone === p) || null;
  }
  resolve(identifier) {
    const id = asciiLower(trimWs(identifier));
    if (!id)
      return null;
    const a = this.find(id);
    if (a)
      return a;
    return id.includes("@") ? this.findByEmail(id) : this.findByPhone(id);
  }
  emailTaken(email, exceptUser = "") {
    const a = this.findByEmail(email);
    return !!a && a.username !== exceptUser;
  }
  phoneTaken(phone, exceptUser = "") {
    const a = this.findByPhone(phone);
    return !!a && a.username !== exceptUser;
  }
  adminCount() {
    return this.accounts.filter((a) => a.role === ADMIN).length;
  }
  count(r) {
    return this.accounts.filter((a) => a.role === r).length;
  }
  add(username, role, password, link, displayName) {
    let e = checkUsername(username);
    if (e)
      return e;
    if (this.find(username))
      return `Tên đăng nhập '${username}' đã có`;
    e = checkPassword(password);
    if (e)
      return e;
    if (role === SHIPPER && !link)
      return "Tài khoản shipper phải gắn với một shipper trong đội xe";
    if (ulen(displayName) > 40)
      return "Tên hiển thị tối đa 40 ký tự";
    const a = newAccountRecord();
    Object.assign(a, { username, role, salt: randomHex(8), link: role === SHIPPER ? link : "", displayName: displayName || username });
    a.hash = hashPassword(a.salt, password);
    this.accounts.push(a);
    this.reindex();
    return "";
  }
  // n: { username, password, displayName, email, phone, link, role, status, vehicle, capacity, plate, createdAt }
  create(n) {
    let e = checkUsername(n.username);
    if (e)
      return e;
    if (this.find(n.username))
      return `Tên đăng nhập '${n.username}' đã có`;
    e = checkPassword(n.password);
    if (e)
      return e;
    e = checkDisplayName(n.displayName);
    if (e)
      return e;
    const email = normalizeEmail(n.email || ""), phone = normalizePhone(n.phone || "");
    if (email) {
      e = checkEmail(email);
      if (e)
        return e;
      if (this.emailTaken(email))
        return "Email này đã được dùng cho tài khoản khác";
    }
    if (phone) {
      e = checkPhone(phone);
      if (e)
        return e;
      if (this.phoneTaken(phone))
        return "Số điện thoại này đã được dùng cho tài khoản khác";
    }
    const status = n.status ?? ACC_ACTIVE;
    if (n.role === SHIPPER && status === ACC_ACTIVE && !n.link)
      return "Tài khoản shipper phải gắn với một shipper trong đội xe";
    const a = newAccountRecord();
    const shipper = n.role === SHIPPER;
    Object.assign(a, {
      username: n.username, role: n.role, salt: randomHex(8), link: shipper ? n.link || "" : "", displayName: n.displayName, status,
      email, phone, createdAt: n.createdAt || 0, vehicle: shipper ? n.vehicle ?? -1 : -1, capacity: shipper ? n.capacity || 0 : 0, plate: shipper ? n.plate || "" : ""
    });
    a.hash = hashPassword(a.salt, n.password);
    this.accounts.push(a);
    this.reindex();
    return "";
  }
  update(username, role, link, displayName) {
    const a = this.find(username);
    if (!a)
      return `Không có tài khoản '${username}'`;
    if (a.role === ADMIN && role !== ADMIN && this.adminCount() === 1)
      return "Phải còn ít nhất một quản trị viên";
    if (role === SHIPPER && !link && a.status === ACC_ACTIVE)
      return "Tài khoản shipper phải gắn với một shipper trong đội xe";
    if (ulen(displayName) > 40)
      return "Tên hiển thị tối đa 40 ký tự";
    a.role = role;
    a.link = role === SHIPPER ? link : "";
    a.displayName = displayName || username;
    return "";
  }
  updateProfile(username, displayName, email0, phone0) {
    const a = this.find(username);
    if (!a)
      return `Không có tài khoản '${username}'`;
    let e = checkDisplayName(displayName);
    if (e)
      return e;
    const email = normalizeEmail(email0), phone = normalizePhone(phone0);
    if (email) {
      e = checkEmail(email);
      if (e)
        return e;
      if (this.emailTaken(email, username))
        return "Email này đã được dùng cho tài khoản khác";
    }
    if (phone) {
      e = checkPhone(phone);
      if (e)
        return e;
      if (this.phoneTaken(phone, username))
        return "Số điện thoại này đã được dùng cho tài khoản khác";
    }
    a.displayName = displayName;
    a.email = email;
    a.phone = phone;
    return "";
  }
  setShipperInfo(username, vehicle, capacity, plate) {
    const a = this.find(username);
    if (!a || a.role !== SHIPPER)
      return `Không có tài khoản shipper '${username}'`;
    if (vehicle < 0 || vehicle > 2)
      return "Loại xe không hợp lệ";
    if (!(capacity > 0) || capacity > 5000)
      return "Tải trọng phải từ 0 đến 5000 kg";
    const e = checkPlate(plate);
    if (e)
      return e;
    a.vehicle = vehicle;
    a.capacity = capacity;
    a.plate = plate;
    return "";
  }
  setStatus(username, st, reason) {
    const a = this.find(username);
    if (!a)
      return `Không có tài khoản '${username}'`;
    if (a.status === st)
      return "Tài khoản đã ở trạng thái " + statusName(st);
    if (!statusTransitionAllowed(a.status, st))
      return `Không thể chuyển từ '${statusName(a.status)}' sang '${statusName(st)}'`;
    if ((st === ACC_LOCKED || st === ACC_DISABLED) && !trimWs(reason))
      return "Cần nhập lý do khi khoá / vô hiệu hoá / từ chối tài khoản";
    if (ulen(reason) > 120)
      return "Lý do tối đa 120 ký tự";
    if (a.role === ADMIN && st !== ACC_ACTIVE && st !== ACC_PENDING) {
      const active = this.accounts.filter((x) => x.role === ADMIN && x.status === ACC_ACTIVE).length;
      if (active <= 1)
        return "Phải còn ít nhất một quản trị viên đang hoạt động";
    }
    a.status = st;
    a.statusReason = st === ACC_LOCKED || st === ACC_DISABLED ? trimWs(reason) : "";
    return "";
  }
  setPassword(username, password) {
    const a = this.find(username);
    if (!a)
      return `Không có tài khoản '${username}'`;
    const e = checkPassword(password);
    if (e)
      return e;
    a.salt = randomHex(8);
    a.hash = hashPassword(a.salt, password);
    return "";
  }
  setLink(username, link) {
    const a = this.find(username);
    if (!a)
      return `Không có tài khoản '${username}'`;
    a.link = link;
    return "";
  }
  setReady(username, ready) {
    const a = this.find(username);
    if (a)
      a.ready = ready;
  }
  setHome(username, node) {
    const a = this.find(username);
    if (a)
      a.home = node;
  }
  touchLogin(username, now) {
    const a = this.find(username);
    if (a)
      a.lastLogin = now;
  }
  addDelivered(username, fee) {
    const a = this.find(username);
    if (a) {
      a.done += 1;
      a.spent += fee;
    }
  }
  remove(username) {
    const i = this.index.get(username);
    if (i === undefined)
      return `Không có tài khoản '${username}'`;
    if (this.accounts[i].role === ADMIN && this.adminCount() === 1)
      return "Không xoá được quản trị viên cuối cùng";
    this.accounts.splice(i, 1);
    this.reindex();
    return "";
  }
  verify(username, password) {
    const a = this.find(username);
    if (!a) {
      hashPassword("00000000", password);
      return false;
    }
    return sameText(hashPassword(a.salt, password), a.hash);
  }
  renameLink(oldName, newName) {
    for (const a of this.accounts)
      if (a.role === SHIPPER && a.link === oldName)
        a.link = newName;
  }
}

class SessionStore {
  constructor() {
    this.sessions = new Map;
  }
  static ttl(meta) {
    return meta.remember ? REMEMBER_DAYS * 86400 : SESSION_MINUTES * 60;
  }
  static sidOf(token) {
    return sha256("sid:" + token).slice(0, 12);
  }
  create(username, now, meta = {}) {
    for (const [k, v] of this.sessions)
      if (v.expires <= now)
        this.sessions.delete(k);
    const token = randomHex(16);
    const m = { remember: !!meta.remember, device: meta.device || "", ip: meta.ip || "" };
    this.sessions.set(token, { username, csrf: randomHex(16), expires: now + SessionStore.ttl(m), created: now, lastSeen: now, meta: m });
    return token;
  }
  resolve(token, now) {
    const s = this.sessions.get(token);
    if (!s)
      return "";
    if (s.expires <= now) {
      this.sessions.delete(token);
      return "";
    }
    s.expires = now + SessionStore.ttl(s.meta);
    s.lastSeen = now;
    return s.username;
  }
  csrf(token) {
    return this.sessions.get(token)?.csrf || "";
  }
  remove(token) {
    this.sessions.delete(token);
  }
  revokeUser(username) {
    for (const [k, v] of this.sessions)
      if (v.username === username)
        this.sessions.delete(k);
  }
  revokeOthers(username, keepToken) {
    let n = 0;
    for (const [k, v] of this.sessions)
      if (v.username === username && k !== keepToken) {
        this.sessions.delete(k);
        n++;
      }
    return n;
  }
  revokeSid(username, sid) {
    for (const [k, v] of this.sessions)
      if (v.username === username && SessionStore.sidOf(k) === sid) {
        this.sessions.delete(k);
        return true;
      }
    return false;
  }
  list(username, currentToken) {
    const out = [];
    for (const [k, v] of this.sessions)
      if (v.username === username)
        out.push({ sid: SessionStore.sidOf(k), device: v.meta.device, ip: v.meta.ip, created: v.created, lastSeen: v.lastSeen, remember: v.meta.remember, current: k === currentToken });
    out.sort((a, b) => a.current !== b.current ? (a.current ? -1 : 1) : a.lastSeen !== b.lastSeen ? b.lastSeen - a.lastSeen : a.sid < b.sid ? -1 : a.sid > b.sid ? 1 : 0);
    return out;
  }
  renameUser(oldName, newName) {
    for (const v of this.sessions.values())
      if (v.username === oldName)
        v.username = newName;
  }
}

class LoginGuard {
  constructor() {
    this.entries = new Map;
  }
  lockedFor(u, now) {
    const e = this.entries.get(u);
    return !e || e.until <= now ? 0 : e.until - now;
  }
  failed(u, now) {
    let e = this.entries.get(u) || { fails: 0, until: 0, level: 0, last: 0 };
    if (e.last && now - e.last > 3600)
      e = { fails: 0, until: 0, level: 0, last: 0 };
    if (e.until && e.until <= now) {
      e.fails = 0;
      e.until = 0;
    }
    e.last = now;
    if (++e.fails >= LOCK_AFTER) {
      const secs = LOCK_SECONDS * 2 ** Math.min(e.level, 4);
      e.until = now + Math.min(secs, MAX_LOCK_SECONDS);
      ++e.level;
    }
    this.entries.set(u, e);
  }
  succeeded(u) {
    this.entries.delete(u);
  }
  failures(u) {
    return this.entries.get(u)?.fails || 0;
  }
}

class RateLimiter {
  constructor() {
    this.hits = new Map;
  }
  allow(key, now, limit, windowSeconds) {
    const v = (this.hits.get(key) || []).filter((t) => t > now - windowSeconds);
    this.hits.set(key, v);
    if (v.length >= limit)
      return false;
    v.push(now);
    if (this.hits.size > 5000)
      for (const [k, h] of this.hits)
        if ((!h.length || h[h.length - 1] <= now - 7200) && k !== key)
          this.hits.delete(k);
    return true;
  }
  used(key, now, windowSeconds) {
    return (this.hits.get(key) || []).filter((t) => t > now - windowSeconds).length;
  }
  retryAfter(key, now, windowSeconds) {
    let oldest = 0;
    for (const t of this.hits.get(key) || [])
      if (t > now - windowSeconds && (oldest === 0 || t < oldest))
        oldest = t;
    return oldest ? oldest + windowSeconds - now : 0;
  }
}
var RESET_OK = 0, RESET_BAD = 1, RESET_EXPIRED = 2, RESET_USED = 3, RESET_TOO_MANY = 4, RESET_NONE = 5;

class ResetStore {
  constructor() {
    this.entries = new Map;
  }
  issue(username, now) {
    const otp = randomDigits(6);
    const salt = randomHex(8);
    this.entries.set(username, { salt, hash: hashPassword(salt, otp), expires: now + RESET_MINUTES * 60, tries: 0, used: false });
    return otp;
  }
  verify(username, otp, now) {
    const e = this.entries.get(username);
    if (!e) {
      hashPassword("00000000", otp);
      return RESET_NONE;
    }
    if (e.used)
      return RESET_USED;
    if (e.expires <= now)
      return RESET_EXPIRED;
    if (e.tries >= RESET_MAX_TRIES)
      return RESET_TOO_MANY;
    ++e.tries;
    if (!sameText(hashPassword(e.salt, otp), e.hash))
      return RESET_BAD;
    e.used = true;
    return RESET_OK;
  }
  invalidate(username) {
    this.entries.delete(username);
  }
  pending(username, now) {
    const e = this.entries.get(username);
    return !!e && !e.used && e.expires > now;
  }
}
// ============================== Bảng phân quyền API (giống hệt Auth.cpp) ==============================
var B_ADMIN = 1, B_SHIPPER = 2, B_CUSTOMER = 4, B_GUEST = 16;
var B_STAFF = B_ADMIN;
var B_USERS = B_ADMIN | B_SHIPPER | B_CUSTOMER;
var RULES = (() => {
  const ALL5 = B_USERS | B_GUEST, A = B_ADMIN, S = B_SHIPPER, C = B_CUSTOMER, ST = B_STAFF, U = B_USERS;
  const g1 = "Tài khoản & phiên", g2 = "Hồ sơ", g3 = "Quản lý tài khoản", g4 = "Bản đồ & dữ liệu", g5 = "Tìm đường (chỉ đọc)";
  const g6 = "Đơn hàng", g7 = "Điều phối", g8 = "Sổ COD", g9 = "Khiếu nại & thông báo", g10 = "Cấu hình & báo cáo";
  return [
    ["POST", "login", ALL5, g1, "Đăng nhập (tên đăng nhập, email hoặc SĐT)"],
    ["POST", "logout", ALL5, g1, "Đăng xuất"],
    ["GET", "me", ALL5, g1, "Xem tài khoản đang đăng nhập"],
    ["POST", "register", ALL5, g1, "Đăng ký khách hàng / shipper"],
    ["POST", "password/forgot", ALL5, g1, "Yêu cầu mã đặt lại mật khẩu"],
    ["POST", "password/reset", ALL5, g1, "Đặt lại mật khẩu bằng mã OTP"],
    ["GET", "mailbox", ALL5, g1, "Hộp thư giả lập (chỉ khi bật chế độ demo)"],
    ["POST", "me/password", U, g1, "Đổi mật khẩu"],
    ["GET", "profile", U, g2, "Xem hồ sơ cá nhân"],
    ["POST", "profile/update", U, g2, "Sửa tên, email, SĐT"],
    ["GET", "sessions", U, g2, "Xem các thiết bị đang đăng nhập"],
    ["POST", "sessions/revoke", U, g2, "Đăng xuất một thiết bị"],
    ["POST", "sessions/revoke-others", U, g2, "Đăng xuất mọi thiết bị khác"],
    ["GET", "addresses", C, g2, "Xem sổ địa chỉ"],
    ["POST", "addresses/add", C, g2, "Thêm địa chỉ"],
    ["POST", "addresses/update", C, g2, "Sửa địa chỉ"],
    ["POST", "addresses/remove", C, g2, "Xoá địa chỉ"],
    ["POST", "addresses/default", C, g2, "Đặt địa chỉ mặc định"],
    ["POST", "shipper/ready", S, g2, "Bật / tắt sẵn sàng nhận chuyến"],
    ["POST", "shipper/vehicle", S, g2, "Cập nhật thông tin xe"],
    ["POST", "shipper/location", S, g2, "Cập nhật vị trí đang đứng (để hệ thống chọn shipper gần nhất)"],
    ["GET", "shipper/stats", S | ST, g2, "Thống kê shipper (đúng hạn, đánh giá, thu nhập)"],
    ["GET", "users", ST, g3, "Danh sách tài khoản (tìm kiếm, lọc, phân trang)"],
    ["GET", "users/queue", ST, g3, "Hàng chờ duyệt shipper (Min-Heap)"],
    ["POST", "users/add", A, g3, "Tạo tài khoản"],
    ["POST", "users/update", A, g3, "Sửa tài khoản, vai trò, đặt lại mật khẩu"],
    ["POST", "users/remove", A, g3, "Xoá tài khoản"],
    ["POST", "users/status", ST, g3, "Duyệt / từ chối / khoá / mở khoá tài khoản"],
    ["GET", "state", U, g4, "Trạng thái hệ thống (đã lọc theo vai trò)"],
    ["POST", "dataset", A, g4, "Mở bộ dữ liệu"],
    ["POST", "graph/new", A, g4, "Tạo bản đồ mới"],
    ["POST", "depot", A, g4, "Đổi kho"],
    ["POST", "undo", A, g4, "Hoàn tác (Undo)"],
    ["POST", "redo", A, g4, "Làm lại (Redo)"],
    ["POST", "traffic", ST, g4, "Báo kẹt xe / đóng đường"],
    ["POST", "traffic/clear", ST, g4, "Xoá mọi sự cố giao thông"],
    ["GET", "search", U, g4, "Tìm địa điểm (Trie)"],
    ["POST", "settings", ST, g4, "Giờ bắt đầu ca, bật / tắt giờ cao điểm"],
    ["GET", "print", A, g4, "In bản đồ dạng văn bản"],
    ["POST", "node/add", A, g4, "Thêm điểm"],
    ["POST", "node/update", A, g4, "Sửa điểm"],
    ["POST", "node/remove", A, g4, "Xoá điểm"],
    ["POST", "edge/add", A, g4, "Thêm đường"],
    ["POST", "edge/update", A, g4, "Sửa đường"],
    ["POST", "edge/remove", A, g4, "Xoá đường"],
    ["GET", "export/map", A, g4, "Tải map.txt"],
    ["GET", "export/orders", ST, g4, "Tải orders.txt"],
    ["GET", "export/shippers", ST, g4, "Tải shippers.txt"],
    ["POST", "import/map", A, g4, "Nhập map.txt"],
    ["POST", "import/orders", A, g4, "Nhập orders.txt"],
    ["POST", "import/shippers", A, g4, "Nhập shippers.txt"],
    ["POST", "save", A, g4, "Lưu bản đồ và đơn hàng"],
    ["GET", "benchmark", A, g4, "Đo hiệu năng thuật toán"],
    ["GET", "benchmark/p2p", A, g4, "Đo hiệu năng A* và Dijkstra"],
    ["GET", "path", U, g5, "Đường đi ngắn nhất (Dijkstra, A*, Bellman-Ford, BFS)"],
    ["GET", "kpaths", U, g5, "K tuyến ngắn nhất (Yen)"],
    ["GET", "estimate", U, g5, "Dự toán chuyến nhiều điểm"],
    ["GET", "timeprofile", U, g5, "Thời gian đi theo giờ xuất phát"],
    ["GET", "trace", U, g5, "Mô phỏng thuật toán từng bước"],
    ["GET", "traverse", U, g5, "Duyệt đồ thị BFS / DFS"],
    ["GET", "components", U, g5, "Thành phần liên thông"],
    ["GET", "zone", U, g5, "Vùng giao hàng quanh kho"],
    ["GET", "zones", U, g5, "Chia vùng nhiều kho"],
    ["GET", "bellman", U, g5, "Bellman-Ford"],
    ["GET", "analysis", U, g5, "Phân tích mạng (cầu, khớp, MST, vị trí kho)"],
    ["GET", "quote", ALL5, g5, "Báo giá cước (Dijkstra) — khách vãng lai dùng thử được"],
    ["GET", "public/info", ALL5, g5, "Thông tin công khai: điểm giao, biểu phí"],
    ["GET", "track", ALL5, g5, "Tra cứu đơn bằng mã đơn + SĐT người nhận"],
    ["POST", "order/add", A | C, g6, "Tạo đơn"],
    ["POST", "orders/random", A, g6, "Tạo đơn mẫu ngẫu nhiên"],
    ["POST", "order/update", ST, g6, "Sửa đơn (khi chưa phân công)"],
    ["POST", "order/edit", C, g6, "Khách tự sửa đơn của mình khi còn ở trạng thái Mới"],
    ["POST", "order/redeliver", C, g6, "Khách hẹn giao lại đơn thất bại (đổi được SĐT / ghi chú)"],
    ["POST", "order/return", C, g6, "Khách yêu cầu hoàn đơn thất bại về kho (tính phí hoàn)"],
    ["POST", "order/remove", A, g6, "Xoá đơn"],
    ["POST", "order/split", ST, g6, "Chia đơn nặng thành nhiều kiện"],
    ["POST", "order/confirm", ST, g6, "Xác nhận đơn mới (Mới → Chờ giao)"],
    ["POST", "order/reject", ST, g6, "Từ chối đơn mới (kèm lý do)"],
    ["POST", "order/cancel", C | ST, g6, "Huỷ đơn (theo quy tắc và phí huỷ)"],
    ["POST", "order/deliver", S | ST, g6, "Xác nhận đã giao bằng mã 4 số"],
    ["POST", "order/rate", C, g6, "Đánh giá shipper (1–5 sao)"],
    ["POST", "order/rate-customer", S, g6, "Shipper đánh giá khách hàng (1–5 sao)"],
    ["POST", "order/retry", C | ST, g6, "Tìm lại shipper cho đơn chưa có ai nhận"],
    ["POST", "order/release", S, g6, "Shipper nhả đơn đã nhận khi chưa lấy hàng (kèm lý do)"],
    ["GET", "orders/list", U, g6, "Danh sách đơn (tìm kiếm, lọc, sắp xếp, phân trang)"],
    ["GET", "order/get", U, g6, "Chi tiết đơn"],
    ["GET", "order/invoice", C | ST, g6, "Hoá đơn của đơn"],
    ["GET", "promos", ST, g6, "Danh sách mã giảm giá"],
    ["POST", "promos/save", A, g6, "Thêm / sửa mã giảm giá"],
    ["POST", "promos/remove", A, g6, "Xoá mã giảm giá"],
    ["GET", "dispatch", ST, g7, "Chạy các phương án điều phối (phân công tay)"],
    ["POST", "dispatch/apply", ST, g7, "Áp dụng phương án"],
    ["POST", "shift/progress", ST | S, g7, "Chạy đồng hồ ca (mô phỏng; shipper chỉ dùng được khi bật chế độ mô phỏng)"],
    ["POST", "shift/fail", ST | S, g7, "Báo giao thất bại"],
    ["POST", "shift/cancel", C | ST, g7, "Huỷ đơn (tên cũ của order/cancel)"],
    ["POST", "shift/absent", ST, g7, "Shipper nghỉ đột xuất"],
    ["POST", "shift/available", ST, g7, "Shipper có mặt trở lại"],
    ["POST", "shift/reroute", ST, g7, "Tính lại tuyến khi giao thông đổi"],
    ["POST", "shift/requeue", ST, g7, "Đưa đơn thất bại về hàng chờ (giao lại)"],
    ["POST", "shift/return", ST, g7, "Hoàn kho đơn thất bại (tính phí hoàn)"],
    ["POST", "shift/reset", A, g7, "Huỷ ca đang chạy"],
    ["POST", "trip/accept", S, g7, "Shipper nhận lời mời / chuyến"],
    ["POST", "trip/decline", S, g7, "Shipper từ chối chuyến (kèm lý do)"],
    ["POST", "trip/recall", ST, g7, "Thu hồi chuyến shipper chưa nhận (đơn về hàng chờ)"],
    ["POST", "dispatch/assign", ST, g7, "Phân công tay các đơn đã chọn cho một shipper"],
    ["POST", "shipper/add", ST, g7, "Thêm shipper vào đội xe"],
    ["POST", "shipper/update", ST, g7, "Sửa shipper"],
    ["POST", "shipper/remove", A, g7, "Xoá shipper khỏi đội xe"],
    ["GET", "cod", S | ST, g8, "Xem sổ COD (shipper chỉ thấy của mình)"],
    ["POST", "cod/remit", S, g8, "Shipper nộp tiền thu hộ"],
    ["POST", "cod/confirm", ST, g8, "Xác nhận đã nhận tiền, ghi chênh lệch"],
    ["POST", "cod/close", ST, g8, "Chốt ca của shipper"],
    ["GET", "wallet", C | ST, g8, "Ví / sao kê đối soát của khách (khách chỉ xem của mình)"],
    ["GET", "wallets", ST, g8, "Số dư đối soát của mọi khách hàng"],
    ["POST", "wallet/payout", A, g8, "Chi trả tiền cho khách / ghi nhận khách nộp bù"],
    ["GET", "complaints", C | ST, g9, "Danh sách khiếu nại (khách chỉ thấy của mình)"],
    ["POST", "complaint/add", C, g9, "Gửi khiếu nại gắn với đơn"],
    ["POST", "complaint/message", C | ST, g9, "Trao đổi trong khiếu nại"],
    ["POST", "complaint/status", ST, g9, "Chuyển trạng thái khiếu nại"],
    ["POST", "complaint/compensate", ST, g9, "Bồi thường cho khách (theo giá trị khai, có trần)"],
    ["GET", "notifications", U, g9, "Thông báo của tôi"],
    ["POST", "notifications/read", U, g9, "Đánh dấu đã đọc"],
    ["POST", "notifications/read-all", U, g9, "Đánh dấu đã đọc tất cả"],
    ["GET", "config", ST, g10, "Xem biểu phí, hạng thân thiết, quy tắc"],
    ["POST", "config/update", A, g10, "Sửa biểu phí, hạng thân thiết, quy tắc"],
    ["GET", "audit", A, g10, "Nhật ký kiểm toán"],
    ["GET", "audit/export", A, g10, "Xuất nhật ký kiểm toán CSV"],
    ["GET", "reports/summary", U, g10, "Báo cáo theo vai trò"]
  ].map(([method, path, roles, group, what]) => ({ method, path, roles, group, what }));
})();
var RULE_INDEX = new Map(RULES.map((r) => [r.method + " " + r.path, r]));
var findRule = (method, path) => RULE_INDEX.get(method + " " + path) || null;
var roleBit = (r) => r === ADMIN ? B_ADMIN : r === SHIPPER ? B_SHIPPER : B_CUSTOMER;
function isPublic(method, path) {
  const r = findRule(method, path);
  return !!r && (r.roles & B_GUEST) !== 0;
}
function canAccess(role, method, path) {
  const r = findRule(method, path);
  return !!r && (r.roles & roleBit(role)) !== 0;
}
