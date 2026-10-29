var MOTORBIKE = 0;
var CAR = 1;
var ANY_VEHICLE = 3;
var MASK_MOTO = 1;
var MASK_CAR = 2;
var MASK_TRUCK = 4;
var MASK_ALL = 7;
var COST_PER_KM_K = 5;
var DEFAULT_PEAK = 1.5;
function vehicleName(v) {
  return ["Xe máy", "Ô tô", "Xe tải"][v] || "Mọi loại xe";
}
function vehicleMask(v) {
  return [MASK_MOTO, MASK_CAR, MASK_TRUCK][v] || MASK_ALL;
}
function vehicleMaxSpeed(v) {
  return [40, 60, 50][v] || 1e9;
}
function vehicleFromInt(v) {
  v = Number(v);
  return v >= 0 && v <= 2 ? v : ANY_VEHICLE;
}
var DISTANCE = 0;
var TIME = 1;
var COST = 2;
function criterionName(c) {
  return ["Quãng đường (km)", "Thời gian (phút)", "Chi phí (nghìn đồng)"][c];
}
function criterionFromString(s) {
  if (s === "time" || s === "1")
    return TIME;
  if (s === "cost" || s === "2")
    return COST;
  return DISTANCE;
}
var vehicleAllowed = (e, v) => !e.closed && (e.allowed & vehicleMask(v)) !== 0;
var travelMinutes = (e, v) => Math.max(e.time, e.distance / vehicleMaxSpeed(v) * 60) * e.jam;

class RushProfile {
  constructor() {
    this.enabled = true;
    this.windows = [{ start: 7 * 60, end: 8 * 60 + 30 }, { start: 17 * 60, end: 18 * 60 + 30 }];
    this.ramp = 60;
    this.sensitivity = [0.5, 1, 1];
  }
  level(minuteOfDay) {
    if (!this.enabled)
      return 0;
    let t = minuteOfDay % 1440;
    if (t < 0)
      t += 1440;
    let best = 0;
    for (const w of this.windows)
      for (const shift of [-1440, 0, 1440]) {
        const s = w.start + shift, e = w.end + shift;
        let lv = 0;
        if (t >= s && t <= e)
          lv = 1;
        else if (this.ramp > 0 && t >= s - this.ramp && t < s)
          lv = (t - (s - this.ramp)) / this.ramp;
        else if (this.ramp > 0 && t > e && t <= e + this.ramp)
          lv = 1 - (t - e) / this.ramp;
        best = Math.max(best, lv);
      }
    return best;
  }
  multiplier(e, v, minuteOfDay) {
    const lv = this.level(minuteOfDay);
    if (lv <= 0 || e.peak <= 1)
      return 1;
    const sens = v >= 0 && v <= 2 ? this.sensitivity[v] : 1;
    return 1 + lv * (e.peak - 1) * sens;
  }
}
var travelMinutesAt = (e, v, minuteOfDay, rush) => {
  const t = travelMinutes(e, v);
  return rush ? t * rush.multiplier(e, v, minuteOfDay) : t;
};
var edgeCostK = (e) => e.distance * COST_PER_KM_K + e.cost;
function edgeWeight(e, c, v) {
  if (c === DISTANCE)
    return e.distance;
  if (c === TIME)
    return travelMinutes(e, v);
  return edgeCostK(e);
}

class Graph {
  constructor(directed = false) {
    this.directed = directed;
    this.nodes = new Map;
    this.adj = new Map;
    this._ids = null;
  }
  clone() {
    const g = new Graph(this.directed);
    for (const [id, n] of this.nodes)
      g.nodes.set(id, { ...n });
    for (const [id, l] of this.adj)
      g.adj.set(id, l.map((e) => ({ ...e })));
    return g;
  }
  addNode(id, name, x = 0, y = 0) {
    if (!(id >= 0) || this.nodes.has(id))
      return false;
    this.nodes.set(id, { id, name, x, y });
    this.adj.set(id, []);
    this._ids = null;
    return true;
  }
  updateNode(id, name, x, y) {
    const n = this.nodes.get(id);
    if (!n)
      return false;
    Object.assign(n, { name, x, y });
    return true;
  }
  removeNode(id) {
    if (!this.nodes.has(id))
      return false;
    this.nodes.delete(id);
    this.adj.delete(id);
    for (const [u, list] of this.adj)
      this.adj.set(u, list.filter((e) => e.to !== id));
    this._ids = null;
    return true;
  }
  hasNode(id) {
    return this.nodes.has(id);
  }
  getNode(id) {
    const n = this.nodes.get(id);
    if (!n)
      throw new Error(`Khong co nut ${id}`);
    return n;
  }
  nodeIds() {
    if (!this._ids)
      this._ids = [...this.nodes.keys()].sort((a, b) => a - b);
    return this._ids;
  }
  nodeCount() {
    return this.nodes.size;
  }
  nextNodeId() {
    let id = 0;
    for (const k of this.nodeIds()) {
      if (k !== id)
        break;
      id++;
    }
    return id;
  }
  findEdge(u, v) {
    const l = this.adj.get(u);
    return l ? l.find((e) => e.to === v) || null : null;
  }
  getEdge(u, v) {
    return this.findEdge(u, v);
  }
  hasEdge(u, v) {
    return this.findEdge(u, v) !== null;
  }
  addEdge(u, v, distance, time, cost, allowed = MASK_ALL, peak = DEFAULT_PEAK) {
    if (!this.hasNode(u) || !this.hasNode(v) || u === v)
      return false;
    if (distance < 0 || time < 0 || peak < 1)
      return false;
    if (this.hasEdge(u, v) || !this.directed && this.hasEdge(v, u))
      return false;
    allowed &= MASK_ALL;
    if (!allowed)
      allowed = MASK_ALL;
    this.adj.get(u).push({ to: v, distance, time, cost, allowed, peak, jam: 1, closed: false });
    if (!this.directed)
      this.adj.get(v).push({ to: u, distance, time, cost, allowed, peak, jam: 1, closed: false });
    return true;
  }
  updateEdge(u, v, distance, time, cost, allowed = MASK_ALL, peak = DEFAULT_PEAK) {
    if (distance < 0 || time < 0 || peak < 1)
      return false;
    allowed &= MASK_ALL;
    if (!allowed)
      allowed = MASK_ALL;
    const e = this.findEdge(u, v);
    if (!e)
      return false;
    Object.assign(e, { distance, time, cost, allowed, peak });
    if (!this.directed) {
      const back = this.findEdge(v, u);
      if (back)
        Object.assign(back, { distance, time, cost, allowed, peak });
    }
    return true;
  }
  removeEdge(u, v) {
    if (!this.hasNode(u) || !this.hasNode(v))
      return false;
    const erase = (a, b) => {
      const l = this.adj.get(a);
      const n = l.length;
      this.adj.set(a, l.filter((e) => e.to !== b));
      return this.adj.get(a).length !== n;
    };
    let ok = erase(u, v);
    if (!this.directed)
      ok = erase(v, u) || ok;
    return ok;
  }
  neighbors(id) {
    return this.adj.get(id) || [];
  }
  edgeCount() {
    let t = 0;
    for (const l of this.adj.values())
      t += l.length;
    return this.directed ? t : t / 2;
  }
  hasNegativeCost() {
    for (const l of this.adj.values())
      for (const e of l)
        if (edgeCostK(e) < 0)
          return true;
    return false;
  }
  setTraffic(u, v, jam, closed) {
    if (jam < 1)
      jam = 1;
    const e = this.findEdge(u, v);
    if (!e)
      return false;
    e.jam = jam;
    e.closed = closed;
    if (!this.directed) {
      const b = this.findEdge(v, u);
      if (b) {
        b.jam = jam;
        b.closed = closed;
      }
    }
    return true;
  }
  clearTraffic() {
    for (const l of this.adj.values())
      for (const e of l) {
        e.jam = 1;
        e.closed = false;
      }
  }
  trafficCount() {
    let c = 0;
    for (const l of this.adj.values())
      for (const e of l)
        if (e.closed || e.jam > 1)
          c++;
    return this.directed ? c : c / 2;
  }
  print() {
    const f = (x) => x.toFixed(1);
    let s = `Do thi ${this.directed ? "CO HUONG" : "VO HUONG"}: ${this.nodeCount()} nut, ${this.edgeCount()} canh
`;
    for (const id of this.nodeIds()) {
      s += `  [${id}] ${this.nodes.get(id).name}
`;
      for (const e of this.neighbors(id)) {
        if (!this.directed && e.to < id)
          continue;
        s += `      ${this.directed ? "-> " : "-- "}[${e.to}] ${this.nodes.get(e.to).name}  (${f(e.distance)} km, ${f(e.time)} phut, phu phi ${f(e.cost)}k`;
        if (e.peak !== DEFAULT_PEAK)
          s += `, cao diem x${f(e.peak)}`;
        if (e.closed)
          s += ", DANG DONG";
        else if (e.jam > 1)
          s += `, ket xe x${e.jam}`;
        if (e.allowed !== MASK_ALL) {
          s += ", chi cho:";
          if (e.allowed & MASK_MOTO)
            s += " xe may";
          if (e.allowed & MASK_CAR)
            s += " o to";
          if (e.allowed & MASK_TRUCK)
            s += " xe tai";
        }
        s += `)
`;
      }
    }
    return s;
  }
}
function readLines(text) {
  const out = [];
  String(text).replace(/^﻿/, "").split(/\n/).forEach((raw, i) => {
    const hash = raw.indexOf("#");
    if (hash >= 0)
      raw = raw.slice(0, hash);
    const t = raw.trim();
    if (t)
      out.push({ number: i + 1, text: t });
  });
  return out;
}
var at = (l) => `Dong ${l.number}: `;
var toks = (s) => s.split(/\s+/);
var isNum = (s) => s !== undefined && s !== "" && /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s);
var isInt = (s) => s !== undefined && /^[-+]?\d+$/.test(s);
function readHeader(l, keyword) {
  const t = toks(l.text);
  if (t[0] !== keyword || !isInt(t[1]) || t.length > 2 || Number(t[1]) < 0)
    throw new Error(`${at(l)}can '${keyword} <so khong am>', gap: "${l.text}"`);
  return Number(t[1]);
}
function loadMapText(text) {
  const lines = readLines(text);
  let i = 0;
  const eof = (expect) => {
    throw new Error(`Het file som: dang cho ${expect}`);
  };
  let directed = false;
  if (i < lines.length && lines[i].text.startsWith("DIRECTED")) {
    const d = readHeader(lines[i], "DIRECTED");
    if (d !== 0 && d !== 1)
      throw new Error(`${at(lines[i])}DIRECTED chi nhan 0 hoac 1`);
    directed = d === 1;
    i++;
  }
  const g = new Graph(directed);
  if (i >= lines.length)
    eof("NODES <n>");
  const n = readHeader(lines[i++], "NODES");
  for (let k = 0;k < n; k++) {
    if (i >= lines.length)
      eof(`nut thu ${k + 1}/${n}`);
    const l = lines[i++];
    const m = l.text.match(/^(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/);
    if (!m || !isInt(m[1]) || !isNum(m[2]) || !isNum(m[3]))
      throw new Error(`${at(l)}nut phai co dang '<id> <x> <y> <ten>'`);
    const name = m[4].trim();
    if (!name)
      throw new Error(`${at(l)}nut ${m[1]} thieu ten`);
    if (!g.addNode(Number(m[1]), name, Number(m[2]), Number(m[3])))
      throw new Error(`${at(l)}trung id nut ${m[1]}`);
  }
  if (i >= lines.length)
    eof("EDGES <m>");
  const m = readHeader(lines[i++], "EDGES");
  for (let k = 0;k < m; k++) {
    if (i >= lines.length)
      eof(`canh thu ${k + 1}/${m}`);
    const l = lines[i++];
    const t = toks(l.text);
    if (t.length < 5 || !isInt(t[0]) || !isInt(t[1]) || !isNum(t[2]) || !isNum(t[3]) || !isNum(t[4]))
      throw new Error(`${at(l)}canh phai co dang '<u> <v> <km> <phut> <chi phi> [loai_xe [cao_diem]]'`);
    let allowed = MASK_ALL, peak = DEFAULT_PEAK;
    if (t.length > 5) {
      if (!isInt(t[5]) || Number(t[5]) < 1 || Number(t[5]) > 7)
        throw new Error(`${at(l)}cot loai xe phai la so 1..7 (1 xe may, 2 o to, 4 xe tai, cong lai)`);
      allowed = Number(t[5]);
      if (t.length > 6) {
        if (t.length > 7 || !isNum(t[6]) || Number(t[6]) < 1 || Number(t[6]) > 5)
          throw new Error(`${at(l)}he so cao diem phai la so tu 1 den 5`);
        peak = Number(t[6]);
      }
    }
    const [u, v, dist, time, cost] = t.slice(0, 5).map(Number);
    if (dist < 0 || time < 0)
      throw new Error(`${at(l)}km va phut khong duoc am`);
    if (!g.hasNode(u) || !g.hasNode(v))
      throw new Error(`${at(l)}canh ${u}-${v} tham chieu nut khong ton tai`);
    if (u === v)
      throw new Error(`${at(l)}khong cho phep canh tu nut ${u} ve chinh no`);
    if (!g.addEdge(u, v, dist, time, cost, allowed, peak))
      throw new Error(`${at(l)}canh ${u}-${v} bi trung`);
  }
  if (i < lines.length)
    throw new Error(`${at(lines[i])}du lieu thua sau phan EDGES (kiem tra lai so luong canh)`);
  return g;
}
var fnum = (x) => String(Number(x.toPrecision(10)));
function mapToText(g) {
  const rows = [];
  for (const u of g.nodeIds())
    for (const e of g.neighbors(u))
      if (g.directed || u <= e.to)
        rows.push([u, e.to, e.distance, e.time, e.cost, e.allowed, e.peak]);
  let s = `# Ban do giao hang
DIRECTED ${g.directed ? 1 : 0}

NODES ${g.nodeCount()}
# id  x  y  ten
`;
  for (const id of g.nodeIds()) {
    const n = g.getNode(id);
    s += `${id} ${fnum(n.x)} ${fnum(n.y)} ${n.name}
`;
  }
  s += `
EDGES ${rows.length}
# u  v  km  phut  phu_phi(nghin d)  [loai_xe: 1 xe may + 2 o to + 4 xe tai  [he_so_cao_diem]]
`;
  for (const [u, v, d, t, c, a, p] of rows)
    s += `${u} ${v} ${fnum(d)} ${fnum(t)} ${fnum(c)}${p !== DEFAULT_PEAK ? ` ${a} ${fnum(p)}` : a !== MASK_ALL ? " " + a : ""}
`;
  return s;
}
// Trường tuỳ chọn khoá=giá_trị trong orders.txt (xem src/FileIO.h)
var ORDER_KEYS = new Set(["cod", "sdt", "nhan", "kh", "ma", "ck", "tv", "gia", "ngay", "tao", "xn", "tt", "sh", "eta", "gx", "lan", "ly", "huy", "bc", "gt", "cu", "dc", "gtri", "bh", "kt", "tra", "hoan", "xong"]);
var newOrderRecord = () => ({ id: 0, destination: 0, weight: 0, urgent: false, deadline: -1, note: "", cod: 0, phone: "", recipient: "", owner: "", promo: "", promoDiscount: 0, loyaltyDiscount: 0, gross: 0, createdAt: 0, createdBy: "", deliveryCode: "", status: 0, shipperName: "", eta: -1, deliveredAt: -1, attempts: 0, failReason: -1, cancelFee: 0, proofNote: "", deliveredReal: 0, codRecorded: false, address: 0, declaredValue: 0, insuranceFee: 0, dimL: 0, dimW: 0, dimH: 0, receiverPays: false, returnFee: 0, closedAt: 0 });
function loadOrdersText(text, g = null) {
  const result = [];
  const seen = new Set;
  const unscore = (v) => v.replace(/_/g, " ");
  for (const l of readLines(text)) {
    const m = l.text.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/);
    if (!m || !isInt(m[1]) || !isInt(m[2]) || !isNum(m[3]) || !isInt(m[4]) || !isInt(m[5]))
      throw new Error(`${at(l)}don phai co dang '<id> <nut_dich> <kg> <gap 0/1> <han_phut|-1> [ghi chu]'`);
    const o = newOrderRecord();
    Object.assign(o, { id: Number(m[1]), destination: Number(m[2]), weight: Number(m[3]), urgent: Number(m[4]), deadline: Number(m[5]) });
    let rest = m[6].trim();
    while (rest) {
      const sp = rest.indexOf(" ");
      const tok = sp < 0 ? rest : rest.slice(0, sp);
      const eq = tok.indexOf("=");
      const key = eq < 0 ? "" : tok.slice(0, eq);
      const val = eq < 0 ? "" : tok.slice(eq + 1);
      const number = (maxv) => {
        if (!/^[0-9]{1,18}$/.test(val) || Number(val) > maxv)
          throw new Error(`${at(l)}${key}= phai la so nguyen khong am (toi da ${maxv})`);
        return Number(val);
      };
      if (key === "cod") {
        let n = -1;
        try {
          n = val.length > 9 ? -1 : number(MAX_COD);
        } catch {}
        if (n < 0)
          throw new Error(`${at(l)}cod= phai la so tien VND tu 0 den 50.000.000`);
        o.cod = n;
      } else if (key === "sdt") {
        o.phone = val;
        if (!validPhone(o.phone))
          throw new Error(`${at(l)}sdt= phai gom 10 chu so, bat dau bang 0`);
      } else if (key === "kh") {
        o.owner = val;
        if (!o.owner)
          throw new Error(`${at(l)}kh= khong duoc de trong`);
      } else if (key === "nhan") {
        o.recipient = unscore(val);
        if (!o.recipient)
          throw new Error(`${at(l)}nhan= khong duoc de trong`);
      } else if (key === "ma") {
        o.promo = val;
        if (!o.promo)
          throw new Error(`${at(l)}ma= khong duoc de trong`);
      } else if (key === "ck")
        o.promoDiscount = number(1e9);
      else if (key === "tv")
        o.loyaltyDiscount = number(1e9);
      else if (key === "gia")
        o.gross = number(1e9);
      else if (key === "ngay")
        o.createdAt = number(9999999999);
      else if (key === "tao")
        o.createdBy = val;
      else if (key === "xn") {
        if (!/^[0-9]{4}$/.test(val))
          throw new Error(`${at(l)}xn= phai la ma 4 chu so`);
        o.deliveryCode = val;
      } else if (key === "tt")
        o.status = number(7);
      else if (key === "sh")
        o.shipperName = unscore(val);
      else if (key === "eta" || key === "gx") {
        if (!/^[+-]?((\d+\.?\d*|\.\d+)([eE][+-]?\d+)?|inf(inity)?|nan)$/i.test(val))
          throw new Error(`${at(l)}${key}= phai la so`);
        o[key === "eta" ? "eta" : "deliveredAt"] = Number(/n/i.test(val) && !/^[+-]?inf/i.test(val) ? NaN : val.replace(/inf(inity)?/i, "Infinity"));
      } else if (key === "lan")
        o.attempts = number(100);
      else if (key === "ly")
        o.failReason = number(100);
      else if (key === "huy")
        o.cancelFee = number(1e9);
      else if (key === "bc")
        o.proofNote = unscore(val);
      else if (key === "gt")
        o.deliveredReal = number(9999999999);
      else if (key === "cu")
        o.codRecorded = val === "1";
      else if (key === "dc")
        o.address = number(1e6);
      else if (key === "gtri")
        o.declaredValue = number(MAX_DECLARED);
      else if (key === "bh")
        o.insuranceFee = number(1e9);
      else if (key === "kt") {
        const d = parseDims(val);
        if (!d)
          throw new Error(`${at(l)}kt= phai co dang DAIxRONGxCAO (cm, moi canh 1-300), vd kt=40x30x20`);
        [o.dimL, o.dimW, o.dimH] = d;
      } else if (key === "tra")
        o.receiverPays = val === "1";
      else if (key === "hoan")
        o.returnFee = number(1e9);
      else if (key === "xong")
        o.closedAt = number(9999999999);
      else
        break;
      rest = sp < 0 ? "" : rest.slice(sp + 1).trim();
    }
    o.note = rest;
    if (o.urgent !== 0 && o.urgent !== 1)
      throw new Error(`${at(l)}cot 'gap' chi nhan 0 hoac 1`);
    o.urgent = o.urgent === 1;
    if (o.weight <= 0)
      throw new Error(`${at(l)}khoi luong phai > 0`);
    if (o.deadline < -1)
      throw new Error(`${at(l)}han giao phai >= 0 hoac -1 (khong co han)`);
    if (seen.has(o.id))
      throw new Error(`${at(l)}trung ma don ${o.id}`);
    seen.add(o.id);
    if (g && !g.hasNode(o.destination))
      throw new Error(`${at(l)}don ${o.id} giao toi nut ${o.destination} khong co tren ban do`);
    result.push(o);
  }
  return result;
}
var MAX_COD = 50000000;
var validPhone = (p) => /^0[0-9]{9}$/.test(p);
function ordersToText(orders) {
  let s = `# Danh sach don hang
# id  nut_dich  kg  gap(0/1)  han(phut, -1 = khong)  [khoa=gia_tri ...]  ghi_chu
`;
  const score = (v) => v.replace(/[ #\n\r\t]/g, "_");
  for (const o of orders) {
    let note = String(o.note || "").replace(/[#\n\r]/g, "-");
    const eq = note.indexOf("="), sp = note.indexOf(" ");
    if (eq >= 0 && (sp < 0 || eq < sp) && ORDER_KEYS.has(note.slice(0, eq)))
      note = "-" + note;
    let biz = "";
    if (o.cod > 0)
      biz += ` cod=${o.cod}`;
    if (o.phone)
      biz += ` sdt=${o.phone}`;
    if (o.recipient)
      biz += ` nhan=${score(o.recipient)}`;
    if (o.owner)
      biz += ` kh=${o.owner}`;
    if (o.promo)
      biz += ` ma=${score(o.promo)}`;
    if (o.promoDiscount)
      biz += ` ck=${o.promoDiscount}`;
    if (o.loyaltyDiscount)
      biz += ` tv=${o.loyaltyDiscount}`;
    if (o.gross)
      biz += ` gia=${o.gross}`;
    if (o.createdAt)
      biz += ` ngay=${o.createdAt}`;
    if (o.createdBy)
      biz += ` tao=${score(o.createdBy)}`;
    if (o.deliveryCode)
      biz += ` xn=${o.deliveryCode}`;
    if (o.status)
      biz += ` tt=${o.status}`;
    if (o.shipperName)
      biz += ` sh=${score(o.shipperName)}`;
    if (o.eta >= 0)
      biz += ` eta=${fnum(o.eta)}`;
    if (o.deliveredAt >= 0)
      biz += ` gx=${fnum(o.deliveredAt)}`;
    if (o.attempts)
      biz += ` lan=${o.attempts}`;
    if (o.failReason >= 0)
      biz += ` ly=${o.failReason}`;
    if (o.cancelFee)
      biz += ` huy=${o.cancelFee}`;
    if (o.proofNote)
      biz += ` bc=${score(o.proofNote)}`;
    if (o.deliveredReal)
      biz += ` gt=${o.deliveredReal}`;
    if (o.codRecorded)
      biz += " cu=1";
    if (o.address)
      biz += ` dc=${o.address}`;
    if (o.declaredValue)
      biz += ` gtri=${o.declaredValue}`;
    if (o.insuranceFee)
      biz += ` bh=${o.insuranceFee}`;
    if (o.dimL > 0)
      biz += ` kt=${dimsText(o.dimL, o.dimW, o.dimH)}`;
    if (o.receiverPays)
      biz += " tra=1";
    if (o.returnFee)
      biz += ` hoan=${o.returnFee}`;
    if (o.closedAt)
      biz += ` xong=${o.closedAt}`;
    s += `${o.id} ${o.destination} ${fnum(o.weight)} ${o.urgent ? 1 : 0} ${o.deadline}${biz}${note ? " " + note : ""}
`;
  }
  return s;
}
function loadShippersText(text) {
  const out = [];
  for (const l of readLines(text)) {
    const m = l.text.match(/^(\S+)\s+(\S+)\s*(.*)$/);
    if (!m || !isNum(m[1]) || Number(m[1]) <= 0 || !isInt(m[2]) || Number(m[2]) < 0 || Number(m[2]) > 2)
      throw new Error(`Dong ${l.number}: shipper phai co dang '<tai trong kg > 0> <loai xe 0/1/2> <ten>'`);
    out.push({ name: m[3].trim() || `Shipper ${out.length + 1}`, capacity: Number(m[1]), vehicle: Number(m[2]) });
  }
  return out;
}
function shippersToText(ships) {
  let s = `# Danh sach shipper
# tai_trong(kg)  loai_xe(0 xe may, 1 o to, 2 xe tai)  ten
`;
  for (const sh of ships)
    s += `${fnum(sh.capacity)} ${sh.vehicle} ${sh.name}
`;
  return s;
}
function bfs(g, start) {
  const order = [];
  if (!g.hasNode(start))
    return order;
  const visited = new Set([start]);
  const q = [start];
  for (let h = 0;h < q.length; h++) {
    const u = q[h];
    order.push(u);
    for (const e of g.neighbors(u))
      if (!visited.has(e.to)) {
        visited.add(e.to);
        q.push(e.to);
      }
  }
  return order;
}
function dfs(g, start) {
  const order = [];
  if (!g.hasNode(start))
    return order;
  const visited = new Set;
  const visit = (u) => {
    visited.add(u);
    order.push(u);
    for (const e of g.neighbors(u))
      if (!visited.has(e.to))
        visit(e.to);
  };
  visit(start);
  return order;
}
function dfsIterative(g, start) {
  const order = [];
  if (!g.hasNode(start))
    return order;
  const visited = new Set;
  const st = [start];
  while (st.length) {
    const u = st.pop();
    if (visited.has(u))
      continue;
    visited.add(u);
    order.push(u);
    const nb = g.neighbors(u);
    for (let i = nb.length - 1;i >= 0; i--)
      if (!visited.has(nb[i].to))
        st.push(nb[i].to);
  }
  return order;
}
function bfsPath(g, src, dst) {
  if (!g.hasNode(src) || !g.hasNode(dst))
    return [];
  if (src === dst)
    return [src];
  const parent = new Map([[src, src]]);
  const q = [src];
  for (let h = 0;h < q.length; h++) {
    const u = q[h];
    for (const e of g.neighbors(u)) {
      if (parent.has(e.to))
        continue;
      parent.set(e.to, u);
      if (e.to === dst) {
        const path = [];
        for (let v = dst;v !== src; v = parent.get(v))
          path.push(v);
        path.push(src);
        return path.reverse();
      }
      q.push(e.to);
    }
  }
  return [];
}
function sortComponents(comps) {
  for (const c of comps)
    c.sort((a, b) => a - b);
  comps.sort((a, b) => a[0] - b[0]);
  return comps;
}
function connectedComponents(g) {
  const adj = new Map(g.nodeIds().map((u) => [u, []]));
  for (const u of g.nodeIds())
    for (const e of g.neighbors(u)) {
      adj.get(u).push(e.to);
      adj.get(e.to).push(u);
    }
  const visited = new Set;
  const comps = [];
  for (const s of g.nodeIds()) {
    if (visited.has(s))
      continue;
    const comp = [], q = [s];
    visited.add(s);
    for (let h = 0;h < q.length; h++) {
      const u = q[h];
      comp.push(u);
      for (const v of adj.get(u))
        if (!visited.has(v)) {
          visited.add(v);
          q.push(v);
        }
    }
    comps.push(comp);
  }
  return sortComponents(comps);
}
var isConnected = (g) => connectedComponents(g).length <= 1;
function stronglyConnectedComponents(g) {
  if (!g.directed)
    return connectedComponents(g);
  const visited = new Set, finish = [];
  const fill = (u) => {
    visited.add(u);
    for (const e of g.neighbors(u))
      if (!visited.has(e.to))
        fill(e.to);
    finish.push(u);
  };
  for (const u of g.nodeIds())
    if (!visited.has(u))
      fill(u);
  const rev = new Map(g.nodeIds().map((u) => [u, []]));
  for (const u of g.nodeIds())
    for (const e of g.neighbors(u))
      rev.get(e.to).push(u);
  visited.clear();
  const comps = [];
  const collect = (u, comp) => {
    visited.add(u);
    comp.push(u);
    for (const v of rev.get(u))
      if (!visited.has(v))
        collect(v, comp);
  };
  for (let i = finish.length - 1;i >= 0; i--) {
    if (visited.has(finish[i]))
      continue;
    const comp = [];
    collect(finish[i], comp);
    comps.push(comp);
  }
  return sortComponents(comps);
}
function unreachableFrom(g, depot) {
  if (!g.hasNode(depot))
    return [...g.nodeIds()];
  const reached = new Set(bfs(g, depot));
  return g.nodeIds().filter((u) => !reached.has(u));
}
function deliveryZone(g, depot, maxHops) {
  const dist = new Map;
  if (!g.hasNode(depot) || maxHops < 0)
    return dist;
  dist.set(depot, 0);
  const q = [depot];
  for (let h = 0;h < q.length; h++) {
    const u = q[h];
    if (dist.get(u) === maxHops)
      continue;
    for (const e of g.neighbors(u)) {
      if (dist.has(e.to))
        continue;
      dist.set(e.to, dist.get(u) + 1);
      q.push(e.to);
    }
  }
  return dist;
}
function assignZones(g, depots) {
  const owner = new Map, hops = new Map, q = [];
  for (const d of depots) {
    if (!g.hasNode(d) || owner.has(d))
      continue;
    owner.set(d, d);
    hops.set(d, 0);
    q.push(d);
  }
  for (let h = 0;h < q.length; h++) {
    const u = q[h];
    for (const e of g.neighbors(u)) {
      if (owner.has(e.to))
        continue;
      owner.set(e.to, owner.get(u));
      hops.set(e.to, hops.get(u) + 1);
      q.push(e.to);
    }
  }
  return { owner, hops, unassigned: g.nodeIds().filter((u) => !owner.has(u)) };
}

class MinHeap {
  constructor(less = (a, b) => a < b) {
    this.a = [];
    this.less = less;
  }
  get size() {
    return this.a.length;
  }
  empty() {
    return this.a.length === 0;
  }
  push(x) {
    const a = this.a;
    a.push(x);
    let i = a.length - 1;
    while (i > 0) {
      const p = i - 1 >> 1;
      if (!this.less(a[i], a[p]))
        break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;; ) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l], a[m]))
          m = l;
        if (r < a.length && this.less(a[r], a[m]))
          m = r;
        if (m === i)
          break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

class IndexedMinHeap {
  constructor(n) {
    this.heap = [];
    this.pos = new Int32Array(n).fill(-1);
    this.key = new Float64Array(n);
  }
  empty() {
    return this.heap.length === 0;
  }
  contains(id) {
    return this.pos[id] !== -1;
  }
  snapshot() {
    return this.heap.map((id) => [id, this.key[id]]);
  }
  _swap(i, j) {
    const h = this.heap;
    [h[i], h[j]] = [h[j], h[i]];
    this.pos[h[i]] = i;
    this.pos[h[j]] = j;
  }
  _up(i) {
    while (i > 0) {
      const p = i - 1 >> 1;
      if (this.key[this.heap[i]] >= this.key[this.heap[p]])
        break;
      this._swap(i, p);
      i = p;
    }
  }
  _down(i) {
    const n = this.heap.length;
    for (;; ) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < n && this.key[this.heap[l]] < this.key[this.heap[m]])
        m = l;
      if (r < n && this.key[this.heap[r]] < this.key[this.heap[m]])
        m = r;
      if (m === i)
        break;
      this._swap(i, m);
      i = m;
    }
  }
  pushOrDecrease(id, k) {
    if (this.contains(id)) {
      if (k < this.key[id]) {
        this.key[id] = k;
        this._up(this.pos[id]);
      }
      return;
    }
    this.key[id] = k;
    this.pos[id] = this.heap.length;
    this.heap.push(id);
    this._up(this.pos[id]);
  }
  popMin() {
    const id = this.heap[0], k = this.key[id];
    this._swap(0, this.heap.length - 1);
    this.heap.pop();
    this.pos[id] = -1;
    if (this.heap.length)
      this._down(0);
    return [id, k];
  }
}
