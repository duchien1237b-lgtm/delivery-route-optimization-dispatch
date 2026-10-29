// Bản JavaScript của src/Support.{h,cpp}: thông báo trong app, nhật ký kiểm toán (xuất CSV), hộp thư giả lập, khiếu nại.
// Cắt chuỗi còn tối đa maxBytes byte UTF-8, không cắt đôi ký tự (TextUtil::utf8Prefix)
function utf8Prefix(s, maxBytes) {
  const b = enc.encode(s);
  if (b.length <= maxBytes)
    return s;
  let n = maxBytes;
  while (n > 0 && (b[n] & 192) === 128)
    --n;
  return dec.decode(b.subarray(0, n));
}
var badChars = (s) => /[\x00-\x09\x0b-\x1f\x7f]/.test(s);
function utcText(t) {
  const d = new Date(t * 1000);
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}
// ------------------------------------------------------------------ Thông báo
var MAX_PER_USER = 100;

class NotificationStore {
  constructor() {
    this.items = [];
    this.next = 1;
  }
  loadText(text) {
    const out = [];
    let maxId = 0, no = 0;
    for (const raw of meaningfulLines(text)) {
      ++no;
      const sp = splitColumns(raw, 6);
      if (!sp)
        throw new Error(`Thong bao dong ${no}: thieu cot`);
      const c = sp.cols;
      let n;
      try {
        n = { id: cppStoll(c[0]), user: decodeToken(c[1]), at: cppStoll(c[2]), read: c[3] === "1", kind: c[4], order: cppStoll(c[5]), text: "" };
      } catch {
        throw new Error(`Thong bao dong ${no}: gia tri khong hop le`);
      }
      n.text = decodeLine(sp.rest);
      maxId = Math.max(maxId, n.id);
      out.push(n);
    }
    this.items = out;
    this.next = maxId + 1;
  }
  toText() {
    let o = "# Thong bao: id nguoi_nhan thoi_diem(giay) da_doc(1/0) loai ma_don noi_dung\n";
    for (const n of this.items)
      o += `${n.id} ${encodeToken(n.user)} ${n.at} ${n.read ? 1 : 0} ${n.kind} ${n.order} ${encodeLine(n.text)}\n`;
    return o;
  }
  add(user, kind, order, text, now) {
    const n = { id: this.next++, user, at: now, read: false, kind, order, text: utf8Prefix(text, 300) };
    this.items.push(n);
    if (this.items.filter((x) => x.user === user).length > MAX_PER_USER)
      this.items.splice(this.items.findIndex((x) => x.user === user), 1);
    return n.id;
  }
  of(user, unreadOnly = false) {
    const v = [];
    for (let i = this.items.length - 1;i >= 0; i--) {
      const n = this.items[i];
      if (n.user === user && (!unreadOnly || !n.read))
        v.push(n);
    }
    return v;
  }
  unread(user) {
    return this.items.filter((n) => n.user === user && !n.read).length;
  }
  markRead(user, id) {
    const n = this.items.find((x) => x.id === id && x.user === user);
    if (!n)
      return false;
    n.read = true;
    return true;
  }
  markAllRead(user) {
    let c = 0;
    for (const n of this.items)
      if (n.user === user && !n.read) {
        n.read = true;
        ++c;
      }
    return c;
  }
}
// ------------------------------------------------------------ Nhật ký kiểm toán
var MAX_AUDIT = 5000;

class AuditLog {
  constructor() {
    this.items = [];
    this.next = 1;
  }
  loadText(text) {
    const out = [];
    let maxId = 0, no = 0;
    for (const raw of meaningfulLines(text)) {
      ++no;
      const sp = splitColumns(raw, 6);
      if (!sp)
        throw new Error(`Nhat ky dong ${no}: thieu cot`);
      const c = sp.cols;
      const e = { id: 0, at: 0, actor: "", role: "", action: "", target: "", detail: "" };
      try {
        e.id = cppStoll(c[0]);
        e.at = cppStoll(c[1]);
      } catch {
        throw new Error(`Nhat ky dong ${no}: gia tri khong hop le`);
      }
      e.actor = decodeToken(c[2]);
      e.role = c[3];
      e.action = c[4];
      e.target = decodeToken(c[5]);
      e.detail = decodeLine(sp.rest);
      maxId = Math.max(maxId, e.id);
      out.push(e);
    }
    this.items = out;
    this.next = maxId + 1;
  }
  toText() {
    let o = "# Nhat ky kiem toan: id thoi_diem(giay) nguoi_lam vai_tro hanh_dong doi_tuong chi_tiet\n";
    for (const e of this.items)
      o += `${e.id} ${e.at} ${encodeToken(e.actor)} ${e.role || "-"} ${e.action} ${encodeToken(e.target)} ${encodeLine(e.detail)}\n`;
    return o;
  }
  add(actor, role, action, target, detail, now) {
    this.items.push({ id: this.next++, at: now, actor: actor || "(khach)", role: role || "guest", action, target, detail: utf8Prefix(detail, 300) });
    if (this.items.length > MAX_AUDIT)
      this.items.splice(0, this.items.length - MAX_AUDIT);
  }
  all() {
    return this.items;
  }
  filter(actor, action, target, from, to) {
    const v = [];
    for (let i = this.items.length - 1;i >= 0; i--) {
      const e = this.items[i];
      if (actor && e.actor !== actor)
        continue;
      if (action && !e.action.startsWith(action))
        continue;
      if (target && e.target !== target)
        continue;
      if (from > 0 && e.at < from)
        continue;
      if (to > 0 && e.at > to)
        continue;
      v.push(e);
    }
    return v;
  }
  static csv(rows) {
    const cell = (s) => {
      if (s && "=+-@".includes(s[0]))
        s = "'" + s;
      return '"' + s.replace(/"/g, '""').replace(/[\n\r]/g, " ") + '"';
    };
    let o = "﻿id,thoi_diem_utc,nguoi_lam,vai_tro,hanh_dong,doi_tuong,chi_tiet\n";
    for (const e of rows)
      o += `${e.id},${cell(utcText(e.at))},${cell(e.actor)},${cell(e.role)},${cell(e.action)},${cell(e.target)},${cell(e.detail)}\n`;
    return o;
  }
}
// ------------------------------------------------------------ Hộp thư giả lập

class Mailbox {
  constructor() {
    this.items = [];
  }
  add(to, subject, body, now) {
    this.items.push({ at: now, to, subject, body });
    if (this.items.length > 200)
      this.items.shift();
  }
  to(address) {
    const v = [];
    for (let i = this.items.length - 1;i >= 0; i--)
      if (!address || this.items[i].to === address)
        v.push(this.items[i]);
    return v;
  }
  all() {
    return this.items;
  }
}
// ----------------------------------------------------------------- Khiếu nại
var complaintStatusName = (s) => s === "processing" ? "Đang xử lý" : s === "resolved" ? "Đã giải quyết" : "Mới";

class ComplaintStore {
  constructor() {
    this.items = [];
    this.next = 1;
  }
  loadText(text) {
    const out = [];
    let maxId = 0, no = 0;
    for (const raw of meaningfulLines(text)) {
      ++no;
      if (raw.length < 2 || raw[1] !== " ")
        throw new Error(`Khieu nai dong ${no}: dinh dang sai`);
      if (raw[0] === "C") {
        const sp = splitColumns(raw.slice(2), 7);
        if (!sp)
          throw new Error(`Khieu nai dong ${no}: thieu cot`);
        const c = sp.cols;
        let x;
        try {
          x = { id: cppStoll(c[0]), owner: decodeToken(c[1]), order: cppStoll(c[2]), status: c[3], created: cppStoll(c[4]), updated: cppStoll(c[5]), assignee: "", title: "", msgs: [] };
        } catch {
          throw new Error(`Khieu nai dong ${no}: gia tri khong hop le`);
        }
        x.assignee = decodeToken(c[6]);
        x.title = decodeLine(sp.rest);
        maxId = Math.max(maxId, x.id);
        out.push(x);
      } else if (raw[0] === "M") {
        const sp = splitColumns(raw.slice(2), 4);
        if (!sp)
          throw new Error(`Khieu nai dong ${no}: thieu cot`);
        const c = sp.cols;
        let cid, at;
        try {
          cid = cppStoll(c[0]);
          at = cppStoll(c[1]);
        } catch {
          throw new Error(`Khieu nai dong ${no}: gia tri khong hop le`);
        }
        const x = out.find((y) => y.id === cid);
        if (!x)
          throw new Error(`Khieu nai dong ${no}: phieu ${cid} khong ton tai`);
        x.msgs.push({ at, author: decodeToken(c[2]), role: c[3], text: decodeLine(sp.rest) });
      } else
        throw new Error(`Khieu nai dong ${no}: dong phai bat dau bang C hoac M`);
    }
    this.items = out;
    this.next = maxId + 1;
  }
  toText() {
    let o = "# Khieu nai: 'C id khach ma_don trang_thai tao cap_nhat nguoi_xu_ly tieu_de' va 'M id thoi_diem tac_gia vai_tro noi_dung'\n";
    for (const x of this.items) {
      o += `C ${x.id} ${encodeToken(x.owner)} ${x.order} ${x.status} ${x.created} ${x.updated} ${encodeToken(x.assignee)} ${encodeLine(x.title)}\n`;
      for (const m of x.msgs)
        o += `M ${x.id} ${m.at} ${encodeToken(m.author)} ${m.role} ${encodeLine(m.text)}\n`;
    }
    return o;
  }
  // Trả về { error, id }
  create(owner, order, title, body, now) {
    const t = trimWs(title), b = trimWs(body);
    if (ulen(t) < 3 || ulen(t) > 80 || badChars(t) || t.includes("\n"))
      return { error: "Tiêu đề khiếu nại dài 3–80 ký tự", id: 0 };
    if (ulen(b) < 5 || ulen(b) > 500 || badChars(b))
      return { error: "Nội dung khiếu nại dài 5–500 ký tự", id: 0 };
    const open = this.items.filter((x) => x.owner === owner && x.order === order && x.status !== "resolved").length;
    if (open >= 3)
      return { error: "Đơn này đã có 3 khiếu nại chưa giải quyết, hãy trao đổi thêm trong các phiếu đang mở", id: 0 };
    const c = { id: this.next++, owner, order, title: t, status: "new", created: now, updated: now, assignee: "", msgs: [{ at: now, author: owner, role: "customer", text: b }] };
    this.items.push(c);
    return { error: "", id: c.id };
  }
  addMessage(id, author, role, text, now) {
    const x = this.items.find((y) => y.id === id);
    if (!x)
      return "Không có khiếu nại này";
    const t = trimWs(text);
    if (ulen(t) < 1 || ulen(t) > 500 || badChars(t))
      return "Tin nhắn dài 1–500 ký tự";
    if (x.status === "resolved" && role === "customer")
      return "Phiếu đã được giải quyết. Hãy tạo phiếu mới nếu cần thêm hỗ trợ";
    if (x.msgs.length >= 200)
      return "Phiếu có quá nhiều tin nhắn";
    x.msgs.push({ at: now, author, role, text: t });
    x.updated = now;
    return "";
  }
  setStatus(id, status, by, now) {
    const x = this.items.find((y) => y.id === id);
    if (!x)
      return "Không có khiếu nại này";
    const ok = x.status === "new" && status === "processing" || x.status === "processing" && status === "resolved" || x.status === "resolved" && status === "processing";
    if (status !== "new" && status !== "processing" && status !== "resolved")
      return "Trạng thái không hợp lệ";
    if (!ok)
      return `Không thể chuyển khiếu nại từ '${complaintStatusName(x.status)}' sang '${complaintStatusName(status)}'`;
    x.status = status;
    x.updated = now;
    if (status === "processing" && !x.assignee)
      x.assignee = by;
    return "";
  }
  find(id) {
    return this.items.find((x) => x.id === id) || null;
  }
  all() {
    return this.items;
  }
}
