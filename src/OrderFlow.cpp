#include "OrderFlow.h"

#include "TextUtil.h"

#include <algorithm>
#include <cmath>
#include <sstream>

namespace Flow {

using TextUtil::decodeLine;
using TextUtil::decodeToken;
using TextUtil::encodeLine;
using TextUtil::encodeToken;

namespace {
const unsigned CUS = Auth::B_CUSTOMER, SHP = Auth::B_SHIPPER, STF = Auth::B_ADMIN;

const std::vector<Transition> TABLE = {
    {CREATED, "confirm", PENDING, STF, "Quản trị viên xác nhận đơn (đơn khách đặt được tự xác nhận)"},
    {CREATED, "reject", CANCELLED, STF, "Quản trị viên từ chối đơn"},
    {CREATED, "cancel", CANCELLED, STF | CUS, "Huỷ đơn (miễn phí)"},
    {PENDING, "cancel", CANCELLED, STF | CUS | B_SYSTEM, "Huỷ đơn (miễn phí; hệ thống tự huỷ khi không tìm được shipper)"},
    {PENDING, "dispatch", DISPATCHED, STF | B_SYSTEM, "Hệ thống mời shipper gần nhất nhận đơn (hoặc quản trị viên phân công)"},
    {DISPATCHED, "accept", ASSIGNED, SHP, "Shipper nhận chuyến"},
    {DISPATCHED, "decline", PENDING, SHP, "Shipper từ chối chuyến"},
    {DISPATCHED, "expire", PENDING, B_SYSTEM, "Lời mời hết hạn mà shipper chưa trả lời"},
    {DISPATCHED, "unassign", PENDING, STF | B_SYSTEM, "Thu hồi phân công (shipper nghỉ, đổi tuyến)"},
    {DISPATCHED, "cancel", CANCELLED, STF | CUS, "Huỷ đơn (mất phí)"},
    {ASSIGNED, "deliver", DELIVERED, SHP | STF | B_SYSTEM, "Giao thành công (mã xác nhận 4 số)"},
    {ASSIGNED, "release", PENDING, SHP, "Shipper nhả đơn khi chưa lấy hàng (hệ thống tìm shipper khác)"},
    {ASSIGNED, "fail", -1, SHP | STF, "Giao thất bại (kèm lý do)"},
    {ASSIGNED, "unassign", PENDING, STF | B_SYSTEM, "Thu hồi phân công (shipper nghỉ, đổi tuyến)"},
    {ASSIGNED, "cancel", CANCELLED, STF | CUS, "Huỷ khi shipper chưa lấy hàng (khách tự huỷ, phí thấp) hoặc quản trị viên huỷ giúp khi đang giao (phí cao)"},
    {FAILED, "requeue", PENDING, STF | CUS, "Giao lại (đưa về hàng chờ; khách tự hẹn giao lại được)"},
    {FAILED, "return", RETURNED, STF | CUS, "Hoàn hàng về kho (tính phí hoàn)"},
    {FAILED, "cancel", CANCELLED, STF, "Huỷ đơn sau khi giao thất bại (phí cao)"},
};

std::string actorName(unsigned a) {
    if (a & CUS) return "Khách hàng";
    if (a & SHP) return "Shipper";
    if (a & Auth::B_ADMIN) return "Quản trị viên";
    return "Hệ thống";
}
const char* actionName(const std::string& a) {
    if (a == "confirm") return "xác nhận";
    if (a == "reject") return "từ chối";
    if (a == "cancel") return "huỷ";
    if (a == "dispatch") return "phân công";
    if (a == "accept") return "nhận chuyến";
    if (a == "decline") return "từ chối chuyến";
    if (a == "deliver") return "xác nhận giao";
    if (a == "fail") return "báo giao thất bại";
    if (a == "requeue") return "đưa về hàng chờ";
    if (a == "return") return "hoàn kho";
    if (a == "unassign") return "thu hồi phân công";
    if (a == "release") return "nhả đơn";
    if (a == "expire") return "hết hạn lời mời";
    return "thực hiện";
}
}  // namespace

const std::vector<Transition>& transitions() { return TABLE; }

std::string check(int from, const std::string& action, unsigned actor, int* to) {
    bool seen = false;
    for (const Transition& t : TABLE) {
        if (t.from != from || action != t.action) continue;
        seen = true;
        if (t.actors & actor) {
            if (to) *to = t.to;
            return "";
        }
    }
    std::string st = orderStatusName(from);
    if (!seen) {
        if (from == DELIVERED || from == RETURNED || from == CANCELLED)
            return "Đơn đang ở trạng thái '" + st + "' (đã kết thúc), không thể " + actionName(action);
        return "Không thể " + std::string(actionName(action)) + " khi đơn đang ở trạng thái '" + st + "'";
    }
    if (action == "cancel" && (actor & CUS))
        return "Đơn đang ở trạng thái '" + st + "' nên không huỷ trực tiếp được, hãy gửi khiếu nại hoặc liên hệ quản trị viên";
    return actorName(actor) + " không được " + actionName(action) + " khi đơn đang ở trạng thái '" + st + "'";
}

double cancelRate(int status, const Commerce::Config& cfg) {
    switch (status) {
        case DISPATCHED: return cfg.cancelDispatched;
        case ASSIGNED:
        case FAILED: return cfg.cancelOnRoute;
        default: return 0;
    }
}

long long cancelFee(int status, long long shippingPartNet, const Commerce::Config& cfg) {
    double r = cancelRate(status, cfg);
    if (r <= 0 || shippingPartNet <= 0) return 0;
    return Commerce::ceil500(shippingPartNet * r);
}

std::string newDeliveryCode() { return Auth::randomDigits(4); }

std::string transitionsMermaid() {
    // Mỗi trạng thái có một bí danh ASCII để Mermaid không vướng dấu cách / tiếng Việt
    auto id = [](int st) { return "S" + std::to_string(st); };
    std::ostringstream o;
    o << "stateDiagram-v2\n";
    for (int st = 0; st < ORDER_STATUS_COUNT; ++st) o << "    state \"" << orderStatusName(st) << "\" as " << id(st) << "\n";
    o << "    [*] --> " << id(CREATED) << ": khách tạo đơn\n";
    for (const Transition& t : TABLE) {
        std::string who;
        if (t.actors & CUS) who += "KH/";
        if (t.actors & SHP) who += "SP/";
        if (t.actors & Auth::B_ADMIN) who += "QT/";
        if (t.actors & B_SYSTEM) who += "HT/";
        if (!who.empty()) who.pop_back();
        std::string label = std::string(t.action) + " (" + who + ")";
        if (t.to < 0) {
            o << "    " << id(t.from) << " --> " << id(FAILED) << ": " << label << "\n";
        } else {
            o << "    " << id(t.from) << " --> " << id(t.to) << ": " << label << "\n";
        }
    }
    for (int st : {DELIVERED, RETURNED, CANCELLED}) o << "    " << id(st) << " --> [*]\n";
    return o.str();
}

// ================================= Sổ COD =================================
bool CodLedger::loadText(const std::string& text, std::string& error) {
    std::vector<CodEntry> ents;
    std::vector<Remittance> rems;
    std::vector<ShiftClose> cls;
    int no = 0;
    auto bad = [&](const std::string& why) {
        error = "So COD dong " + std::to_string(no) + ": " + why;
        return false;
    };
    for (const std::string& raw : TextUtil::meaningfulLines(text)) {
        ++no;
        if (raw.size() < 2 || raw[1] != ' ') return bad("dinh dang sai");
        std::vector<std::string> c;
        std::string rest;
        try {
            if (raw[0] == 'E') {
                if (!TextUtil::splitColumns(raw.substr(2), 8, c, rest)) return bad("thieu cot");
                CodEntry e;
                e.id = std::stoi(c[0]);
                e.order = std::stoi(c[1]);
                e.shipper = decodeToken(c[2]);
                e.amount = std::stoll(c[3]);
                e.state = c[4];
                e.collectedAt = std::stoll(c[5]);
                e.remittance = std::stoi(c[6]);
                e.closeId = std::stoi(c[7]);
                ents.push_back(e);
            } else if (raw[0] == 'R') {
                if (!TextUtil::splitColumns(raw.substr(2), 10, c, rest)) return bad("thieu cot");
                Remittance r;
                r.id = std::stoi(c[0]);
                r.shipper = decodeToken(c[1]);
                r.at = std::stoll(c[2]);
                r.expected = std::stoll(c[3]);
                r.handed = std::stoll(c[4]);
                r.state = c[5];
                r.settledAt = std::stoll(c[6]);
                r.counted = std::stoll(c[7]);
                r.confirmedBy = decodeToken(c[8]);
                if (c[9] != "-") {
                    std::stringstream ss(c[9]);
                    std::string item;
                    while (std::getline(ss, item, ',')) r.entries.push_back(std::stoi(item));
                }
                r.note = decodeLine(rest);
                rems.push_back(r);
            } else if (raw[0] == 'K') {
                if (!TextUtil::splitColumns(raw.substr(2), 7, c, rest)) return bad("thieu cot");
                ShiftClose k;
                k.id = std::stoi(c[0]);
                k.shipper = decodeToken(c[1]);
                k.at = std::stoll(c[2]);
                k.orders = std::stoi(c[3]);
                k.collected = std::stoll(c[4]);
                k.counted = std::stoll(c[5]);
                k.by = decodeToken(c[6]);
                cls.push_back(k);
            } else {
                return bad("dong phai bat dau bang E, R hoac K");
            }
        } catch (...) {
            return bad("gia tri khong hop le");
        }
    }
    entries_ = std::move(ents);
    remits_ = std::move(rems);
    closes_ = std::move(cls);
    nextEntry_ = nextRemit_ = nextClose_ = 1;
    for (const auto& e : entries_) nextEntry_ = std::max(nextEntry_, e.id + 1);
    for (const auto& r : remits_) nextRemit_ = std::max(nextRemit_, r.id + 1);
    for (const auto& k : closes_) nextClose_ = std::max(nextClose_, k.id + 1);
    return true;
}

std::string CodLedger::toText() const {
    std::ostringstream o;
    o << "# So COD. E id ma_don shipper so_tien trang_thai(held|remitted|settled) thu_luc(giay) phieu_nop chot_ca\n";
    o << "#      R id shipper luc_nop du_kien khai_nop trang_thai thanh_toan_luc dem_duoc nguoi_xac_nhan danh_sach_but_toan ghi_chu\n";
    o << "#      K id shipper luc_chot so_don da_thu dem_duoc nguoi_chot\n";
    for (const CodEntry& e : entries_)
        o << "E " << e.id << ' ' << e.order << ' ' << encodeToken(e.shipper) << ' ' << e.amount << ' ' << e.state << ' ' << e.collectedAt << ' '
          << e.remittance << ' ' << e.closeId << '\n';
    for (const Remittance& r : remits_) {
        std::string list;
        for (size_t i = 0; i < r.entries.size(); ++i) list += (i ? "," : "") + std::to_string(r.entries[i]);
        o << "R " << r.id << ' ' << encodeToken(r.shipper) << ' ' << r.at << ' ' << r.expected << ' ' << r.handed << ' ' << r.state << ' '
          << r.settledAt << ' ' << r.counted << ' ' << encodeToken(r.confirmedBy) << ' ' << (list.empty() ? "-" : list) << ' ' << encodeLine(r.note) << '\n';
    }
    for (const ShiftClose& k : closes_)
        o << "K " << k.id << ' ' << encodeToken(k.shipper) << ' ' << k.at << ' ' << k.orders << ' ' << k.collected << ' ' << k.counted << ' '
          << encodeToken(k.by) << '\n';
    return o.str();
}

int CodLedger::record(int order, const std::string& shipper, long long amount, int64_t now) {
    if (amount <= 0) return 0;
    for (const CodEntry& e : entries_) if (e.order == order) return 0;
    CodEntry e;
    e.id = nextEntry_++;
    e.order = order;
    e.shipper = shipper;
    e.amount = amount;
    e.collectedAt = now;
    entries_.push_back(e);
    return e.id;
}

std::string CodLedger::remit(const std::string& shipper, long long handed, int64_t now, int& remitId) {
    if (handed < 0 || handed > 100000000000LL) return "Số tiền nộp không hợp lệ";
    Remittance r;
    for (const CodEntry& e : entries_)
        if (e.shipper == shipper && e.state == "held") {
            r.expected += e.amount;
            r.entries.push_back(e.id);
        }
    if (r.entries.empty()) return "Bạn không có khoản thu hộ nào đang giữ để nộp";
    r.id = nextRemit_++;
    r.shipper = shipper;
    r.at = now;
    r.handed = handed;
    for (CodEntry& e : entries_)
        if (std::find(r.entries.begin(), r.entries.end(), e.id) != r.entries.end()) {
            e.state = "remitted";
            e.remittance = r.id;
        }
    remitId = r.id;
    remits_.push_back(r);
    return "";
}

std::string CodLedger::confirm(int remitId, long long counted, const std::string& by, const std::string& note, int64_t now) {
    for (Remittance& r : remits_) {
        if (r.id != remitId) continue;
        if (r.state == "settled") return "Phiếu nộp này đã được đối soát";
        if (counted < 0 || counted > 100000000000LL) return "Số tiền đếm được không hợp lệ";
        if (note.size() > 300) return "Ghi chú tối đa 300 ký tự";
        r.state = "settled";
        r.settledAt = now;
        r.counted = counted;
        r.confirmedBy = by;
        r.note = note;
        for (CodEntry& e : entries_)
            if (e.remittance == r.id) e.state = "settled";
        return "";
    }
    return "Không có phiếu nộp này";
}

std::string CodLedger::close(const std::string& shipper, const std::string& by, int64_t now, int& closeId) {
    for (const CodEntry& e : entries_)
        if (e.shipper == shipper && (e.state == "held" || e.state == "remitted"))
            return "Shipper còn tiền thu hộ chưa nộp hoặc chưa đối soát, chưa chốt ca được";
    ShiftClose k;
    std::vector<int> remitIds;
    for (const CodEntry& e : entries_)
        if (e.shipper == shipper && e.state == "settled" && e.closeId == 0) {
            ++k.orders;
            k.collected += e.amount;
            if (std::find(remitIds.begin(), remitIds.end(), e.remittance) == remitIds.end()) remitIds.push_back(e.remittance);
        }
    if (k.orders == 0) return "Không có khoản thu hộ nào cần chốt ca";
    for (int rid : remitIds)
        for (const Remittance& r : remits_) if (r.id == rid) k.counted += r.counted;
    k.id = nextClose_++;
    k.shipper = shipper;
    k.at = now;
    k.by = by;
    for (CodEntry& e : entries_)
        if (e.shipper == shipper && e.state == "settled" && e.closeId == 0) e.closeId = k.id;
    closeId = k.id;
    closes_.push_back(k);
    return "";
}

long long CodLedger::held(const std::string& shipper) const {
    long long s = 0;
    for (const CodEntry& e : entries_) if (e.shipper == shipper && e.state == "held") s += e.amount;
    return s;
}
long long CodLedger::awaiting(const std::string& shipper) const {
    long long s = 0;
    for (const CodEntry& e : entries_) if (e.shipper == shipper && e.state == "remitted") s += e.amount;
    return s;
}
const Remittance* CodLedger::findRemit(int id) const {
    for (const Remittance& r : remits_) if (r.id == id) return &r;
    return nullptr;
}
void CodLedger::renameShipper(const std::string& oldName, const std::string& newName) {
    for (CodEntry& e : entries_) if (e.shipper == oldName) e.shipper = newName;
    for (Remittance& r : remits_) if (r.shipper == oldName) r.shipper = newName;
    for (ShiftClose& k : closes_) if (k.shipper == oldName) k.shipper = newName;
}

}  // namespace Flow
