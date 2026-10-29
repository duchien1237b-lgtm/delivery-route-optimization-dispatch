// Bản JavaScript của src/TextUtil.h và src/Commerce.{h,cpp}: mã hoá cột trong file .txt, cấu hình, mã giảm giá,
// hạng thân thiết, báo giá (= hoá đơn), sổ địa chỉ, đánh giá và điểm hiệu suất shipper.
var dec = new TextDecoder;
// ------------------------------------------------------------- TextUtil
function encodeToken(s) {
  if (!s)
    return "-";
  let out = "";
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c <= 32 || ch === "%" || c === 127 || s.length === 1 && ch === "-")
      out += "%" + c.toString(16).toUpperCase().padStart(2, "0");
    else
      out += ch;
  }
  return out;
}
// Giải mã theo byte như bản C++ (%XX có thể là một byte của ký tự UTF-8 nhiều byte)
function decodeToken(s) {
  if (s === "-")
    return "";
  if (!s.includes("%"))
    return s;
  const b = enc.encode(s);
  const out = [];
  const hex = (c) => c >= 48 && c <= 57 || c >= 65 && c <= 70 || c >= 97 && c <= 102;
  for (let i = 0;i < b.length; i++) {
    if (b[i] === 37 && i + 2 < b.length && hex(b[i + 1]) && hex(b[i + 2])) {
      out.push(parseInt(String.fromCharCode(b[i + 1], b[i + 2]), 16));
      i += 2;
    } else
      out.push(b[i]);
  }
  return dec.decode(new Uint8Array(out));
}
var encodeLine = (s) => s.replace(/\r/g, "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
function decodeLine(s) {
  let out = "";
  for (let i = 0;i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) {
      ++i;
      out += s[i] === "n" ? "\n" : s[i];
    } else
      out += s[i];
  }
  return out;
}
function meaningfulLines(text) {
  const out = [];
  String(text).split("\n").forEach((line, k) => {
    if (k === 0 && line.startsWith("﻿"))
      line = line.slice(1);
    if (line.endsWith("\r"))
      line = line.slice(0, -1);
    const t = trimWs(line);
    if (!t || t[0] === "#")
      return;
    out.push(line);
  });
  return out;
}
// n cột đầu (cách nhau bằng khoảng trắng) và phần còn lại; null nếu thiếu cột
function splitColumns(line, n) {
  const cols = [];
  let i = 0;
  const ws = (c) => c === " " || c === "\t" || c === "\n" || c === "\v" || c === "\f" || c === "\r";
  for (let k = 0;k < n; k++) {
    while (i < line.length && ws(line[i]))
      i++;
    if (i >= line.length)
      return null;
    const st = i;
    while (i < line.length && !ws(line[i]))
      i++;
    cols.push(line.slice(st, i));
  }
  return { cols, rest: trimWs(line.slice(i)) };
}
var hasControl = (s) => /[\x00-\x1f\x7f]/.test(s);
function vnd(v) {
  const s = String(Math.abs(v));
  let out = "";
  for (let i = 0;i < s.length; i++) {
    if (i && (s.length - i) % 3 === 0)
      out += ".";
    out += s[i];
  }
  return (v < 0 ? "-" : "") + out + " đ";
}
var floor500 = (v) => Math.floor(v / 500 + 0.000000001) * 500;
var ceil500 = (v) => Math.ceil(v / 500 - 0.000000001) * 500;
// ------------------------------------------------------------- Cấu hình
var defaultTiers = () => [{ name: "Đồng", minDone: 0, pct: 0 }, { name: "Bạc", minDone: 5, pct: 0.03 }, { name: "Vàng", minDone: 15, pct: 0.05 }, { name: "Kim cương", minDone: 30, pct: 0.08 }];

class Config {
  constructor() {
    this.tiers = defaultTiers();
    this.cancelDispatched = 0.2;
    this.cancelOnRoute = 0.5;
    this.shipperShare = 0.7;
    this.scoreAware = false;
    this.maxOpenOrders = 20;
    this.autoDeliver = false;
    this.insRate = 0.005;
    this.insThreshold = 1000000;
    this.volDivisor = 6000;
    this.compMultiplier = 4;
    this.debtLimit = 500000;
    this.autoMatch = true;
    this.offerSeconds = 45;
    this.matchGiveUp = 10;
    this.clockSpeed = 0;
  }
  check() {
    const tiers = this.tiers;
    if (!tiers.length || tiers.length > 8)
      return "Cần từ 1 đến 8 hạng thân thiết";
    if (tiers[0].minDone !== 0)
      return "Hạng thấp nhất phải bắt đầu từ 0 đơn";
    for (let i = 0;i < tiers.length; i++) {
      const t = tiers[i];
      if (!t.name || ulen(t.name) > 20 || hasControl(t.name))
        return "Tên hạng thân thiết dài 1–20 ký tự";
      if (!(t.pct >= 0 && t.pct <= 0.5))
        return "Mức giảm của hạng phải từ 0% đến 50%";
      if (i && t.minDone <= tiers[i - 1].minDone)
        return "Số đơn tối thiểu của các hạng phải tăng dần";
      if (t.minDone < 0 || t.minDone > 1e5)
        return "Số đơn tối thiểu của hạng không hợp lệ";
    }
    if (!(this.cancelDispatched >= 0 && this.cancelDispatched <= 1))
      return "Phí huỷ khi đã phân công phải từ 0% đến 100%";
    if (!(this.cancelOnRoute >= 0 && this.cancelOnRoute <= 1))
      return "Phí huỷ khi đang giao phải từ 0% đến 100%";
    if (!(this.shipperShare >= 0 && this.shipperShare <= 1))
      return "Phần cước của shipper phải từ 0% đến 100%";
    if (this.maxOpenOrders < 1 || this.maxOpenOrders > 200)
      return "Số đơn chờ tối đa phải từ 1 đến 200";
    if (!(this.insRate >= 0 && this.insRate <= 0.1))
      return "Phí bảo hiểm phải từ 0% đến 10% giá trị khai";
    if (this.insThreshold < 0 || this.insThreshold > 1e8)
      return "Ngưỡng miễn phí bảo hiểm phải từ 0 đến 100.000.000 đ";
    if (this.volDivisor < 1000 || this.volDivisor > 1e4)
      return "Hệ số quy đổi khối lượng phải từ 1000 đến 10000";
    if (!(this.compMultiplier >= 0 && this.compMultiplier <= 20))
      return "Hệ số bồi thường khi không khai giá phải từ 0 đến 20";
    if (this.debtLimit < 0 || this.debtLimit > 1e8)
      return "Hạn mức nợ phí phải từ 0 đến 100.000.000 đ (0 = không chặn)";
    if (this.offerSeconds < 1 || this.offerSeconds > 600)
      return "Hạn trả lời lời mời phải từ 1 đến 600 giây";
    if (this.matchGiveUp < 0 || this.matchGiveUp > 240)
      return "Thời gian chờ shipper trước khi tự huỷ đơn phải từ 0 đến 240 phút (0 = không tự huỷ)";
    if (!(this.clockSpeed >= 0 && this.clockSpeed <= 120))
      return "Tốc độ giờ ca phải từ 0 đến 120 phút ca mỗi phút thật (0 = tắt)";
    return checkTariff(TARIFF);
  }
  toText() {
    const t = TARIFF, n = (v) => gfmt(v, 10);
    let o = "# Cau hinh he thong: moi dong 'khoa gia_tri'. Sua bang trang Cau hinh (quan tri vien).\n";
    o += `tariff.firstKm ${n(t.firstKm)}\ntariff.firstFee ${n(t.firstFee)}\ntariff.perKm ${n(t.perKm)}\ntariff.freeKg ${n(t.freeKg)}\ntariff.perKg ${n(t.perKg)}\ntariff.urgent ${n(t.urgent)}\ntariff.codRate ${n(t.codRate)}\ntariff.codMin ${n(t.codMin)}\ntariff.returnRate ${n(t.returnRate)}\n`;
    for (const x of this.tiers)
      o += `tier ${encodeToken(x.name)} ${x.minDone} ${n(x.pct)}\n`;
    o += `cancel.dispatched ${n(this.cancelDispatched)}\ncancel.onRoute ${n(this.cancelOnRoute)}\nshipperShare ${n(this.shipperShare)}\nscoreAware ${this.scoreAware ? 1 : 0}\nmaxOpenOrders ${this.maxOpenOrders}\nautoDeliver ${this.autoDeliver ? 1 : 0}\n`;
    o += `ins.rate ${n(this.insRate)}\nins.threshold ${this.insThreshold}\nvol.divisor ${this.volDivisor}\ncomp.multiplier ${n(this.compMultiplier)}\ndebt.limit ${this.debtLimit}\n`;
    o += `match.auto ${this.autoMatch ? 1 : 0}\nmatch.offerSeconds ${this.offerSeconds}\nmatch.giveUp ${this.matchGiveUp}\nclock.speed ${n(this.clockSpeed)}\n`;
    return o;
  }
  // Nạp cả biểu phí vào TARIFF. Ném Error nếu sai (cấu hình và biểu phí giữ nguyên).
  loadText(text) {
    const next = new Config;
    const t = { firstKm: KM_MO_DAU, firstFee: PHI_MO_DAU, perKm: GIA_KM_TIEP, freeKg: KG_MIEN_PHI, perKg: PHI_MOI_KG, urgent: HOA_TOC, codRate: PHI_COD, codMin: PHI_COD_TOI_THIEU, returnRate: TI_LE_PHI_HOAN };
    const tiers2 = [];
    const keys = { "tariff.firstKm": "firstKm", "tariff.firstFee": "firstFee", "tariff.perKm": "perKm", "tariff.freeKg": "freeKg", "tariff.perKg": "perKg", "tariff.urgent": "urgent", "tariff.codRate": "codRate", "tariff.codMin": "codMin", "tariff.returnRate": "returnRate" };
    for (const raw of meaningfulLines(text)) {
      const tk = raw.split(/[ \t\n\v\f\r]+/).filter(Boolean);
      const [key, a = "", b = "", c = ""] = tk;
      try {
        if (keys[key])
          t[keys[key]] = cppStod(a);
        else if (key === "tier")
          tiers2.push({ name: decodeToken(a), minDone: cppStoll(b), pct: cppStod(c) });
        else if (key === "cancel.dispatched")
          next.cancelDispatched = cppStod(a);
        else if (key === "cancel.onRoute")
          next.cancelOnRoute = cppStod(a);
        else if (key === "shipperShare")
          next.shipperShare = cppStod(a);
        else if (key === "scoreAware")
          next.scoreAware = a === "1";
        else if (key === "maxOpenOrders")
          next.maxOpenOrders = cppStoll(a);
        else if (key === "autoDeliver")
          next.autoDeliver = a === "1";
        else if (key === "ins.rate")
          next.insRate = cppStod(a);
        else if (key === "ins.threshold")
          next.insThreshold = cppStoll(a);
        else if (key === "vol.divisor")
          next.volDivisor = cppStoll(a);
        else if (key === "comp.multiplier")
          next.compMultiplier = cppStod(a);
        else if (key === "debt.limit")
          next.debtLimit = cppStoll(a);
        else if (key === "match.auto")
          next.autoMatch = a !== "0";
        else if (key === "match.offerSeconds")
          next.offerSeconds = cppStoll(a);
        else if (key === "match.giveUp")
          next.matchGiveUp = cppStoll(a);
        else if (key === "clock.speed")
          next.clockSpeed = cppStod(a);
      } catch {
        throw new Error("Dong cau hinh khong hop le: " + raw);
      }
    }
    if (tiers2.length)
      next.tiers = tiers2;
    const saved = { ...TARIFF };
    Object.assign(TARIFF, t);
    const e = next.check();
    if (e) {
      Object.assign(TARIFF, saved);
      throw new Error(e);
    }
    Object.assign(this, next);
  }
}
var CONFIG = new Config;
function tierFor(done) {
  const t = CONFIG.tiers;
  let best = t[0];
  for (const x of t)
    if (done >= x.minDone)
      best = x;
  return best;
}
var nextTier = (done) => CONFIG.tiers.find((x) => x.minDone > done) || null;
// ------------------------------------------------------------- Mã giảm giá
var normalizeCode = (code) => trimWs(String(code)).replace(/[a-z]/g, (c) => c.toUpperCase());
var newPromo = () => ({ code: "", type: "pct", value: 0, maxDiscount: 0, minFee: 0, maxUses: 0, used: 0, perUser: 1, expires: 0, active: true, description: "" });
function checkPromo(p) {
  if (blen(p.code) < 3 || blen(p.code) > 16)
    return "Mã giảm giá dài 3–16 ký tự";
  if (!/^[A-Z0-9]*$/.test(p.code))
    return "Mã giảm giá chỉ gồm chữ in hoa và chữ số";
  if (p.type !== "pct" && p.type !== "amt")
    return "Loại mã phải là phần trăm hoặc số tiền";
  if (p.type === "pct" && (p.value < 1 || p.value > 100))
    return "Mức giảm phần trăm phải từ 1 đến 100";
  if (p.type === "amt" && (p.value < 500 || p.value > 1e7 || p.value % 500 !== 0))
    return "Số tiền giảm phải từ 500 đến 10.000.000 đ và là bội số của 500 đ";
  if (p.maxDiscount < 0 || p.maxDiscount > 1e7)
    return "Trần giảm giá không hợp lệ";
  if (p.minFee < 0 || p.minFee > 1e7)
    return "Đơn tối thiểu không hợp lệ";
  if (p.maxUses < 0 || p.maxUses > 1e6)
    return "Giới hạn lượt dùng không hợp lệ";
  if (p.perUser < 0 || p.perUser > 1000)
    return "Giới hạn lượt dùng mỗi khách không hợp lệ";
  if (p.expires < 0)
    return "Hạn dùng không hợp lệ";
  if (ulen(p.description) > 100 || hasControl(p.description))
    return "Mô tả tối đa 100 ký tự";
  return "";
}

class PromoStore {
  constructor() {
    this.promos = [];
  }
  loadText(text) {
    const out = [];
    let no = 0;
    for (const raw of meaningfulLines(text)) {
      ++no;
      const sp = splitColumns(raw, 10);
      if (!sp)
        throw new Error(`Ma giam gia dong ${no}: thieu cot`);
      const c = sp.cols;
      const p = newPromo();
      try {
        p.code = c[0];
        p.type = c[1];
        p.value = cppStoll(c[2]);
        p.maxDiscount = cppStoll(c[3]);
        p.minFee = cppStoll(c[4]);
        p.maxUses = cppStoll(c[5]);
        p.used = cppStoll(c[6]);
        p.perUser = cppStoll(c[7]);
        p.expires = cppStoll(c[8]);
        p.active = c[9] !== "0";
      } catch {
        throw new Error(`Ma giam gia dong ${no}: gia tri khong hop le`);
      }
      p.description = decodeLine(sp.rest);
      const e = checkPromo(p);
      if (e)
        throw new Error(`Ma giam gia dong ${no}: ${e}`);
      if (out.some((x) => x.code === p.code))
        throw new Error(`Ma giam gia dong ${no}: trung ma ${p.code}`);
      out.push(p);
    }
    this.promos = out;
  }
  toText() {
    let o = "# Ma giam gia: ma loai(pct|amt) gia_tri tran_giam don_toi_thieu tong_luot da_dung luot_moi_khach het_han(giay,0=khong) bat(1/0) mo_ta\n";
    for (const p of this.promos)
      o += `${p.code} ${p.type} ${p.value} ${p.maxDiscount} ${p.minFee} ${p.maxUses} ${p.used} ${p.perUser} ${p.expires} ${p.active ? 1 : 0} ${encodeLine(p.description)}\n`;
    return o;
  }
  all() {
    return this.promos;
  }
  find(code) {
    const c = normalizeCode(code);
    return this.promos.find((p) => p.code === c) || null;
  }
  upsert(p0) {
    const p = { ...p0, code: normalizeCode(p0.code) };
    const e = checkPromo(p);
    if (e)
      return e;
    const i = this.promos.findIndex((x) => x.code === p.code);
    if (i >= 0) {
      p.used = this.promos[i].used;
      this.promos[i] = p;
      return "";
    }
    if (this.promos.length >= 200)
      return "Tối đa 200 mã giảm giá";
    p.used = 0;
    this.promos.push(p);
    return "";
  }
  remove(code) {
    const c = normalizeCode(code);
    const i = this.promos.findIndex((p) => p.code === c);
    if (i < 0)
      return "Không có mã " + c;
    this.promos.splice(i, 1);
    return "";
  }
  consume(code) {
    const c = normalizeCode(code);
    for (const p of this.promos)
      if (p.code === c)
        ++p.used;
  }
  giveBack(code) {
    const c = normalizeCode(code);
    for (const p of this.promos)
      if (p.code === c && p.used > 0)
        --p.used;
  }
  validate(code, gross, now, usedByUser) {
    const p = this.find(code);
    if (!p)
      return "Mã giảm giá không tồn tại";
    if (!p.active)
      return "Mã giảm giá đang tạm ngưng";
    if (p.expires > 0 && p.expires <= now)
      return "Mã giảm giá đã hết hạn";
    if (p.maxUses > 0 && p.used >= p.maxUses)
      return "Mã giảm giá đã hết lượt dùng";
    if (gross < p.minFee)
      return "Mã chỉ áp dụng cho đơn có cước từ " + vnd(p.minFee);
    if (p.perUser > 0 && usedByUser >= p.perUser)
      return "Bạn đã dùng mã này rồi";
    return "";
  }
}
// ------------------------------------------------------------- Báo giá
var shippingPart = (fee) => fee.valid ? Math.max(0, floor500(fee.total - fee.cod)) : 0;
function computeQuote(fee, tier, loyaltyPct, promoCode, promos, now, usedByUser) {
  const q = { fee, gross: 0, loyaltyDiscount: 0, promoDiscount: 0, net: 0, tier, tierPct: loyaltyPct > 0 ? loyaltyPct : 0, promo: "", promoError: "" };
  if (!fee.valid)
    return q;
  q.gross = Math.trunc(fee.total);
  const base = shippingPart(fee);
  if (loyaltyPct > 0)
    q.loyaltyDiscount = Math.min(base, floor500(base * loyaltyPct));
  const code = normalizeCode(promoCode);
  if (code) {
    const err = promos.validate(code, q.gross, now, usedByUser);
    if (err)
      q.promoError = err;
    else {
      const p = promos.find(code);
      const room = base - q.loyaltyDiscount;
      let d = p.type === "pct" ? floor500(room * p.value / 100) : p.value;
      if (p.type === "pct" && p.maxDiscount > 0)
        d = Math.min(d, p.maxDiscount);
      q.promoDiscount = Math.max(0, Math.min(d, room));
      q.promo = p.code;
    }
  }
  q.net = q.gross - q.loyaltyDiscount - q.promoDiscount;
  return q;
}
// ------------------------------------------------------------- Sổ địa chỉ
var MAX_ADDRESSES = 10;
function checkAddressFields(a) {
  const l = ulen(a.label), r = ulen(a.recipient);
  if (l < 1 || l > 30 || hasControl(a.label))
    return "Tên gợi nhớ của địa chỉ dài 1–30 ký tự";
  if (r < 2 || r > 60 || hasControl(a.recipient))
    return "Tên người nhận dài 2–60 ký tự";
  if (!validPhone(a.phone))
    return "Số điện thoại phải gồm 10 chữ số, bắt đầu bằng 0";
  if (ulen(a.detail) > 80 || hasControl(a.detail))
    return "Địa chỉ chi tiết tối đa 80 ký tự";
  return "";
}

class AddressBook {
  constructor() {
    this.items = [];
    this.next = 1;
  }
  loadText(text) {
    const out = [];
    let maxId = 0, no = 0;
    for (const raw of meaningfulLines(text)) {
      ++no;
      const sp = splitColumns(raw, 7);
      if (!sp)
        throw new Error(`Dia chi dong ${no}: thieu cot`);
      const c = sp.cols;
      let a;
      try {
        a = { id: cppStoll(c[0]), owner: decodeToken(c[1]), node: cppStoll(c[2]), isDefault: c[3] === "1", phone: decodeToken(c[4]), label: decodeToken(c[5]), recipient: decodeToken(c[6]), detail: "" };
      } catch {
        throw new Error(`Dia chi dong ${no}: gia tri khong hop le`);
      }
      a.detail = decodeLine(sp.rest);
      maxId = Math.max(maxId, a.id);
      out.push(a);
    }
    this.items = out;
    this.next = maxId + 1;
  }
  toText() {
    let o = "# So dia chi: id khach_hang nut_ban_do mac_dinh(1/0) sdt nhan_goi_nho nguoi_nhan dia_chi_chi_tiet\n";
    for (const a of this.items)
      o += `${a.id} ${encodeToken(a.owner)} ${a.node} ${a.isDefault ? 1 : 0} ${encodeToken(a.phone)} ${encodeToken(a.label)} ${encodeToken(a.recipient)} ${encodeLine(a.detail)}\n`;
    return o;
  }
  of(owner) {
    return this.items.filter((a) => a.owner === owner);
  }
  find(id) {
    return this.items.find((a) => a.id === id) || null;
  }
  // Trả về { error, id }
  add(a0) {
    const a = { ...a0 };
    const e = checkAddressFields(a);
    if (e)
      return { error: e, id: 0 };
    if (this.of(a.owner).length >= MAX_ADDRESSES)
      return { error: `Sổ địa chỉ đã đầy (tối đa ${MAX_ADDRESSES} địa chỉ)`, id: 0 };
    a.id = this.next++;
    if (!this.of(a.owner).length)
      a.isDefault = true;
    if (a.isDefault)
      for (const x of this.items)
        if (x.owner === a.owner)
          x.isDefault = false;
    this.items.push(a);
    return { error: "", id: a.id };
  }
  update(id, owner, a) {
    const i = this.items.findIndex((x) => x.id === id);
    if (i < 0 || this.items[i].owner !== owner)
      return "Không có địa chỉ này";
    const n = { ...a, id, owner, isDefault: this.items[i].isDefault };
    const e = checkAddressFields(n);
    if (e)
      return e;
    this.items[i] = n;
    return "";
  }
  remove(id, owner) {
    const i = this.items.findIndex((x) => x.id === id);
    if (i < 0 || this.items[i].owner !== owner)
      return "Không có địa chỉ này";
    const wasDefault = this.items[i].isDefault;
    this.items.splice(i, 1);
    if (wasDefault) {
      const x = this.items.find((y) => y.owner === owner);
      if (x)
        x.isDefault = true;
    }
    return "";
  }
  setDefault(id, owner) {
    const t = this.find(id);
    if (!t || t.owner !== owner)
      return "Không có địa chỉ này";
    for (const x of this.items)
      if (x.owner === owner)
        x.isDefault = x.id === id;
    return "";
  }
  removeOwner(owner) {
    this.items = this.items.filter((a) => a.owner !== owner);
  }
}
// ------------------------------------------------------------- Đánh giá & điểm shipper

class ReviewStore {
  constructor() {
    this.items = [];
  }
  loadText(text) {
    const out = [];
    let no = 0;
    for (const raw of meaningfulLines(text)) {
      ++no;
      const sp = splitColumns(raw, 5);
      if (!sp)
        throw new Error(`Danh gia dong ${no}: thieu cot`);
      const c = sp.cols;
      let r;
      try {
        r = { order: cppStoll(c[0]), customer: decodeToken(c[1]), shipper: decodeToken(c[2]), stars: cppStoll(c[3]), at: cppStoll(c[4]), comment: "" };
      } catch {
        throw new Error(`Danh gia dong ${no}: gia tri khong hop le`);
      }
      r.comment = decodeLine(sp.rest);
      out.push(r);
    }
    this.items = out;
  }
  toText() {
    let o = "# Danh gia shipper: ma_don khach_hang shipper so_sao thoi_diem(giay) nhan_xet\n";
    for (const r of this.items)
      o += `${r.order} ${encodeToken(r.customer)} ${encodeToken(r.shipper)} ${r.stars} ${r.at} ${encodeLine(r.comment)}\n`;
    return o;
  }
  add(r) {
    if (r.stars < 1 || r.stars > 5)
      return "Số sao phải từ 1 đến 5";
    if (ulen(r.comment) > 200 || hasControl(r.comment))
      return "Nhận xét tối đa 200 ký tự";
    if (this.ofOrder(r.order))
      return "Đơn này đã được đánh giá";
    this.items.push(r);
    return "";
  }
  ofOrder(order) {
    return this.items.find((r) => r.order === order) || null;
  }
  ofShipper(shipper) {
    return this.items.filter((r) => r.shipper === shipper);
  }
  // { avg, count }
  average(shipper) {
    let n = 0, sum = 0;
    for (const r of this.items)
      if (r.shipper === shipper) {
        ++n;
        sum += r.stars;
      }
    return { avg: n ? sum / n : 0, count: n };
  }
  // Đánh giá hai chiều: shipper đánh giá khách (lưu ở file riêng, customer = người được đánh giá)
  averageOfCustomer(customer) {
    let n = 0, sum = 0;
    for (const r of this.items)
      if (r.customer === customer) {
        ++n;
        sum += r.stars;
      }
    return { avg: n ? sum / n : 0, count: n };
  }
  all() {
    return this.items;
  }
}
var newStat = () => ({ delivered: 0, onTime: 0, failed: 0, accepted: 0, declines: 0, income: 0 });

class StatsStore {
  constructor() {
    this.stats = new Map;
  }
  loadText(text) {
    const out = new Map;
    let no = 0;
    for (const raw of meaningfulLines(text)) {
      ++no;
      const sp = splitColumns(raw, 7);
      if (!sp)
        throw new Error(`Thong ke shipper dong ${no}: thieu cot`);
      const c = sp.cols;
      let s;
      try {
        s = { delivered: cppStoll(c[1]), onTime: cppStoll(c[2]), failed: cppStoll(c[3]), accepted: cppStoll(c[4]), declines: cppStoll(c[5]), income: cppStoll(c[6]) };
      } catch {
        throw new Error(`Thong ke shipper dong ${no}: gia tri khong hop le`);
      }
      out.set(decodeToken(c[0]), s);
    }
    this.stats = out;
  }
  // std::map: thứ tự theo byte của tên
  sortedKeys() {
    return [...this.stats.keys()].sort(byteCompare);
  }
  toText() {
    let o = "# Thong ke shipper: ten giao_xong dung_han that_bai nhan_chuyen tu_choi thu_nhap\n";
    for (const k of this.sortedKeys()) {
      const s = this.stats.get(k);
      o += `${encodeToken(k)} ${s.delivered} ${s.onTime} ${s.failed} ${s.accepted} ${s.declines} ${s.income}\n`;
    }
    return o;
  }
  get(shipper) {
    return { ...newStat(), ...this.stats.get(shipper) || {} };
  }
  at(shipper) {
    if (!this.stats.has(shipper))
      this.stats.set(shipper, newStat());
    return this.stats.get(shipper);
  }
  rename(oldName, newName) {
    if (!this.stats.has(oldName) || oldName === newName)
      return;
    this.stats.set(newName, this.stats.get(oldName));
    this.stats.delete(oldName);
  }
}
// So sánh chuỗi theo byte UTF-8 (thứ tự của std::string / std::map)
function byteCompare(a, b) {
  if (a === b)
    return 0;
  const x = enc.encode(a), y = enc.encode(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0;i < n; i++)
    if (x[i] !== y[i])
      return x[i] - y[i];
  return x.length - y.length;
}
function performanceScore(s, avgStars, ratingCount) {
  const onTime = s.delivered ? s.onTime / s.delivered : 1;
  const rating = ratingCount > 0 ? avgStars : 4;
  const offered = s.accepted + s.declines;
  const declineRate = offered ? s.declines / offered : 0;
  const score = 100 * (0.5 * onTime + 0.3 * (rating / 5) + 0.2 * (1 - Math.min(1, declineRate * 2)));
  return Math.round(score * 10) / 10;
}
