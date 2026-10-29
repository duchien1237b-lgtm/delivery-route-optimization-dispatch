#include "Billing.h"

#include "Dispatcher.h"
#include "TextUtil.h"

#include <algorithm>
#include <cmath>
#include <sstream>

namespace Billing {

using TextUtil::decodeLine;
using TextUtil::decodeToken;
using TextUtil::encodeLine;
using TextUtil::encodeToken;

namespace {
long long ceil500(double v) { return static_cast<long long>(std::ceil(v / 500.0 - 1e-9)) * 500; }
size_t utf8Len(const std::string& s) {
    return std::count_if(s.begin(), s.end(), [](char c) { return (static_cast<unsigned char>(c) & 0xC0) != 0x80; });
}
std::string vnd(long long v) {
    std::string s = std::to_string(v < 0 ? -v : v), out;
    for (size_t i = 0; i < s.size(); ++i) {
        if (i && (s.size() - i) % 3 == 0) out += '.';
        out += s[i];
    }
    return out + "đ";
}
}  // namespace

double volumetricWeight(int l, int w, int h, int divisor) {
    if (l <= 0 || w <= 0 || h <= 0 || divisor <= 0) return 0;
    double kg = static_cast<double>(l) * w * h / divisor;
    return std::ceil(kg * 10 - 1e-9) / 10;
}

double chargedWeight(double weight, int l, int w, int h, int divisor) {
    return std::max(weight, volumetricWeight(l, w, h, divisor));
}

long long insuranceFee(long long declared, double rate, long long threshold) {
    if (declared <= 0 || declared <= threshold) return 0;
    return ceil500(declared * rate);
}

std::string checkDims(int l, int w, int h) {
    if (l == 0 && w == 0 && h == 0) return "";
    if (l <= 0 || w <= 0 || h <= 0) return "Hãy nhập đủ dài, rộng, cao (cm) hoặc để trống cả ba";
    if (l > MAX_DIM || w > MAX_DIM || h > MAX_DIM) return "Mỗi cạnh tối đa " + std::to_string(MAX_DIM) + " cm";
    return "";
}

bool parseDims(const std::string& s, int& l, int& w, int& h) {
    int v[3] = {0, 0, 0};
    size_t pos = 0;
    for (int k = 0; k < 3; ++k) {
        size_t end = k < 2 ? s.find('x', pos) : s.size();
        if (end == std::string::npos) return false;
        std::string part = s.substr(pos, end - pos);
        if (part.empty() || part.size() > 3 || part.find_first_not_of("0123456789") != std::string::npos) return false;
        v[k] = std::stoi(part);
        pos = end + 1;
    }
    if (!checkDims(v[0], v[1], v[2]).empty()) return false;
    l = v[0];
    w = v[1];
    h = v[2];
    return true;
}

std::string dimsText(int l, int w, int h) {
    if (l <= 0 || w <= 0 || h <= 0) return "";
    return std::to_string(l) + "x" + std::to_string(w) + "x" + std::to_string(h);
}

long long compensationCap(const std::string& kind, long long declared, long long orderTotal, double multiplier) {
    if (kind == "damaged" || kind == "lost") return declared > 0 ? declared : static_cast<long long>(std::floor(orderTotal * multiplier));
    return orderTotal;
}

const char* compensationKindName(const std::string& kind) {
    if (kind == "late") return "Giao trễ hạn";
    if (kind == "damaged") return "Hàng hư hỏng";
    if (kind == "lost") return "Thất lạc hàng";
    return "Khác";
}

// ============================================================ Sổ giao dịch
bool CustomerLedger::loadText(const std::string& text, std::string& error) {
    std::vector<Tx> items;
    int maxId = 0, no = 0;
    for (const std::string& raw : TextUtil::meaningfulLines(text)) {
        ++no;
        std::vector<std::string> c;
        std::string rest;
        if (raw.size() < 2 || raw[0] != 'T' || raw[1] != ' ' || !TextUtil::splitColumns(raw.substr(2), 10, c, rest)) {
            error = "So khach hang dong " + std::to_string(no) + ": dinh dang sai";
            return false;
        }
        try {
            Tx t;
            t.id = std::stoi(c[0]);
            t.kind = c[1];
            t.customer = decodeToken(c[2]);
            t.amount = std::stoll(c[3]);
            t.at = std::stoll(c[4]);
            t.by = decodeToken(c[5]);
            t.order = std::stoi(c[6]);
            t.complaint = std::stoi(c[7]);
            t.method = decodeToken(c[8]);
            t.ref = decodeToken(c[9]);
            t.note = decodeLine(rest);
            if ((t.kind != "payout" && t.kind != "collect" && t.kind != "comp") || t.amount <= 0 || t.customer.empty())
                throw std::invalid_argument("x");
            maxId = std::max(maxId, t.id);
            items.push_back(t);
        } catch (...) {
            error = "So khach hang dong " + std::to_string(no) + ": so lieu khong hop le";
            return false;
        }
    }
    items_ = std::move(items);
    next_ = maxId + 1;
    return true;
}

std::string CustomerLedger::toText() const {
    std::ostringstream o;
    o << "# So giao dich khach hang. T id loai(payout|collect|comp) khach so_tien luc(giay) nguoi_ghi ma_don ma_khieu_nai kenh tham_chieu ghi_chu\n";
    for (const Tx& t : items_)
        o << "T " << t.id << ' ' << t.kind << ' ' << encodeToken(t.customer) << ' ' << t.amount << ' ' << t.at << ' ' << encodeToken(t.by) << ' '
          << t.order << ' ' << t.complaint << ' ' << encodeToken(t.method) << ' ' << encodeToken(t.ref) << ' ' << encodeLine(t.note) << '\n';
    return o.str();
}

std::string CustomerLedger::add(Tx tx, int& id) {
    if (tx.kind != "payout" && tx.kind != "collect" && tx.kind != "comp") return "Loại giao dịch không hợp lệ";
    if (tx.amount <= 0 || tx.amount > 1000000000) return "Số tiền phải lớn hơn 0";
    if (tx.customer.empty()) return "Thiếu khách hàng";
    if (tx.kind == "comp") tx.method = "wallet";
    else if (tx.method != "bank" && tx.method != "cash") return "Hãy chọn hình thức: chuyển khoản hoặc tiền mặt";
    if (tx.kind != "comp" && tx.method == "bank" && tx.ref.size() < 3) return "Chuyển khoản cần mã giao dịch ngân hàng";
    if (utf8Len(tx.ref) > 40) return "Mã tham chiếu tối đa 40 ký tự";
    if (utf8Len(tx.note) > 200) return "Ghi chú tối đa 200 ký tự";
    for (char& ch : tx.note)
        if (ch == '\n' || ch == '\r') ch = ' ';
    tx.id = next_++;
    id = tx.id;
    items_.push_back(tx);
    return "";
}

std::vector<const Tx*> CustomerLedger::of(const std::string& customer) const {
    std::vector<const Tx*> out;
    for (const Tx& t : items_)
        if (t.customer == customer) out.push_back(&t);
    return out;
}

const Tx* CustomerLedger::ofComplaint(int complaint) const {
    for (const Tx& t : items_)
        if (t.kind == "comp" && t.complaint == complaint) return &t;
    return nullptr;
}

// ============================================================ Sao kê
Statement statement(const std::vector<OrderFacts>& orders, const std::vector<const Tx*>& txs) {
    Statement s;
    auto add = [&](int64_t at, const char* kind, int order, long long amount, bool pending, const std::string& text) {
        if (amount == 0) return;
        Line l;
        l.at = at;
        l.kind = kind;
        l.order = order;
        l.amount = amount;
        l.pending = pending;
        l.text = text;
        s.lines.push_back(l);
    };
    for (const OrderFacts& o : orders) {
        std::string id = "#" + std::to_string(o.id);
        if (o.status == DELIVERED) {
            add(o.at, "cod", o.id, o.cod, !o.codSettled, "Tiền thu hộ đơn " + id + (o.codSettled ? "" : " (chờ shipper nộp & đối soát)"));
            if (!o.receiverPays) add(o.at, "fee", o.id, -o.total, false, "Cước đơn " + id);
            s.codTotal += o.cod;
            if (!o.receiverPays) s.fees += o.total;
        } else if (o.status == RETURNED) {
            add(o.at, "return", o.id, -o.returnFee, false, "Phí hoàn hàng đơn " + id);
            s.fees += o.returnFee;
        } else if (o.status == CANCELLED) {
            add(o.at, "cancel", o.id, -o.cancelFee, false, "Phí huỷ đơn " + id);
            s.fees += o.cancelFee;
        }
    }
    for (const Tx* t : txs) {
        Line l;
        l.at = t->at;
        l.kind = t->kind;
        l.order = t->order;
        l.ref = t->ref;
        l.tx = t->id;
        if (t->kind == "comp") {
            l.amount = t->amount;
            l.text = "Bồi thường khiếu nại #" + std::to_string(t->complaint) + (t->note.empty() ? "" : ": " + t->note);
            s.comps += t->amount;
        } else if (t->kind == "payout") {
            l.amount = -t->amount;
            l.text = std::string(t->method == "bank" ? "Chuyển khoản" : "Trả tiền mặt") + " cho khách " + vnd(t->amount);
            s.paidOut += t->amount;
        } else {
            l.amount = t->amount;
            l.text = std::string("Khách nộp bù ") + (t->method == "bank" ? "(chuyển khoản)" : "(tiền mặt)");
            s.collected += t->amount;
        }
        if (!t->note.empty() && t->kind != "comp") l.text += ": " + t->note;
        s.lines.push_back(l);
    }
    std::stable_sort(s.lines.begin(), s.lines.end(), [](const Line& a, const Line& b) { return a.at < b.at; });
    for (const Line& l : s.lines) {
        s.balance += l.amount;
        if (l.pending) s.pending += l.amount;
    }
    s.available = s.balance - s.pending;
    return s;
}

}  // namespace Billing
