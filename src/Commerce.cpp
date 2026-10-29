#include "Commerce.h"

#include "TextUtil.h"

#include <algorithm>
#include <cmath>
#include <set>
#include <sstream>

extern bool validPhone(const std::string& s);

namespace Commerce {

using TextUtil::decodeLine;
using TextUtil::decodeToken;
using TextUtil::encodeLine;
using TextUtil::encodeToken;

namespace {
size_t utf8Len(const std::string& s) {
    return std::count_if(s.begin(), s.end(), [](char c) { return (static_cast<unsigned char>(c) & 0xC0) != 0x80; });
}
bool hasControl(const std::string& s) {
    return std::any_of(s.begin(), s.end(), [](unsigned char c) { return c < 0x20 || c == 0x7f; });
}
std::string vnd(long long v) {
    std::string s = std::to_string(v < 0 ? -v : v), out;
    for (size_t i = 0; i < s.size(); ++i) {
        if (i && (s.size() - i) % 3 == 0) out += '.';
        out += s[i];
    }
    return (v < 0 ? "-" : "") + out + " đ";
}
std::string num(double v) {
    std::ostringstream o;
    o.precision(10);
    o << v;
    return o.str();
}
}  // namespace

long long floor500(double v) { return static_cast<long long>(std::floor(v / 500.0 + 1e-9)) * 500; }
long long ceil500(double v) { return static_cast<long long>(std::ceil(v / 500.0 - 1e-9)) * 500; }

// =================================== Cấu hình ===================================
Config::Config() {
    tiers = {{"Đồng", 0, 0.0}, {"Bạc", 5, 0.03}, {"Vàng", 15, 0.05}, {"Kim cương", 30, 0.08}};
}

Config& config() {
    static Config c;
    return c;
}

const Tier& tierFor(int done) {
    const auto& t = config().tiers;
    const Tier* best = &t.front();
    for (const Tier& x : t) if (done >= x.minDone) best = &x;
    return *best;
}
const Tier* nextTier(int done) {
    for (const Tier& x : config().tiers) if (x.minDone > done) return &x;
    return nullptr;
}

std::string Config::check() const {
    if (tiers.empty() || tiers.size() > 8) return "Cần từ 1 đến 8 hạng thân thiết";
    if (tiers.front().minDone != 0) return "Hạng thấp nhất phải bắt đầu từ 0 đơn";
    for (size_t i = 0; i < tiers.size(); ++i) {
        const Tier& t = tiers[i];
        if (t.name.empty() || utf8Len(t.name) > 20 || hasControl(t.name)) return "Tên hạng thân thiết dài 1–20 ký tự";
        if (!(t.pct >= 0 && t.pct <= 0.5)) return "Mức giảm của hạng phải từ 0% đến 50%";
        if (i && t.minDone <= tiers[i - 1].minDone) return "Số đơn tối thiểu của các hạng phải tăng dần";
        if (t.minDone < 0 || t.minDone > 100000) return "Số đơn tối thiểu của hạng không hợp lệ";
    }
    if (!(cancelDispatched >= 0 && cancelDispatched <= 1)) return "Phí huỷ khi đã phân công phải từ 0% đến 100%";
    if (!(cancelOnRoute >= 0 && cancelOnRoute <= 1)) return "Phí huỷ khi đang giao phải từ 0% đến 100%";
    if (!(shipperShare >= 0 && shipperShare <= 1)) return "Phần cước của shipper phải từ 0% đến 100%";
    if (maxOpenOrders < 1 || maxOpenOrders > 200) return "Số đơn chờ tối đa phải từ 1 đến 200";
    if (!(insRate >= 0 && insRate <= 0.1)) return "Phí bảo hiểm phải từ 0% đến 10% giá trị khai";
    if (insThreshold < 0 || insThreshold > 100000000) return "Ngưỡng miễn phí bảo hiểm phải từ 0 đến 100.000.000 đ";
    if (volDivisor < 1000 || volDivisor > 10000) return "Hệ số quy đổi khối lượng phải từ 1000 đến 10000";
    if (!(compMultiplier >= 0 && compMultiplier <= 20)) return "Hệ số bồi thường khi không khai giá phải từ 0 đến 20";
    if (debtLimit < 0 || debtLimit > 100000000) return "Hạn mức nợ phí phải từ 0 đến 100.000.000 đ (0 = không chặn)";
    if (offerSeconds < 1 || offerSeconds > 600) return "Hạn trả lời lời mời phải từ 1 đến 600 giây";
    if (matchGiveUp < 0 || matchGiveUp > 240) return "Thời gian chờ shipper trước khi tự huỷ đơn phải từ 0 đến 240 phút (0 = không tự huỷ)";
    if (!(clockSpeed >= 0 && clockSpeed <= 120)) return "Tốc độ giờ ca phải từ 0 đến 120 phút ca mỗi phút thật (0 = tắt)";
    return Pricing::checkTariff(Pricing::tariff());
}

std::string Config::toText() const {
    const Pricing::Tariff& t = Pricing::tariff();
    std::ostringstream o;
    o << "# Cau hinh he thong: moi dong 'khoa gia_tri'. Sua bang trang Cau hinh (quan tri vien).\n";
    o << "tariff.firstKm " << num(t.firstKm) << "\ntariff.firstFee " << num(t.firstFee) << "\ntariff.perKm " << num(t.perKm)
      << "\ntariff.freeKg " << num(t.freeKg) << "\ntariff.perKg " << num(t.perKg) << "\ntariff.urgent " << num(t.urgent)
      << "\ntariff.codRate " << num(t.codRate) << "\ntariff.codMin " << num(t.codMin) << "\ntariff.returnRate " << num(t.returnRate) << "\n";
    for (const Tier& x : tiers) o << "tier " << encodeToken(x.name) << ' ' << x.minDone << ' ' << num(x.pct) << "\n";
    o << "cancel.dispatched " << num(cancelDispatched) << "\ncancel.onRoute " << num(cancelOnRoute) << "\nshipperShare " << num(shipperShare)
      << "\nscoreAware " << (scoreAware ? 1 : 0) << "\nmaxOpenOrders " << maxOpenOrders << "\nautoDeliver " << (autoDeliver ? 1 : 0) << "\n";
    o << "ins.rate " << num(insRate) << "\nins.threshold " << insThreshold << "\nvol.divisor " << volDivisor << "\ncomp.multiplier " << num(compMultiplier)
      << "\ndebt.limit " << debtLimit << "\n";
    o << "match.auto " << (autoMatch ? 1 : 0) << "\nmatch.offerSeconds " << offerSeconds << "\nmatch.giveUp " << matchGiveUp
      << "\nclock.speed " << num(clockSpeed) << "\n";
    return o.str();
}

bool Config::loadText(const std::string& text, std::string& error) {
    Config next;
    Pricing::Tariff t;
    std::vector<Tier> tiers2;
    for (const std::string& raw : TextUtil::meaningfulLines(text)) {
        std::istringstream ss(raw);
        std::string key, a, b, c;
        ss >> key >> a;
        try {
            if (key == "tariff.firstKm") t.firstKm = std::stod(a);
            else if (key == "tariff.firstFee") t.firstFee = std::stod(a);
            else if (key == "tariff.perKm") t.perKm = std::stod(a);
            else if (key == "tariff.freeKg") t.freeKg = std::stod(a);
            else if (key == "tariff.perKg") t.perKg = std::stod(a);
            else if (key == "tariff.urgent") t.urgent = std::stod(a);
            else if (key == "tariff.codRate") t.codRate = std::stod(a);
            else if (key == "tariff.codMin") t.codMin = std::stod(a);
            else if (key == "tariff.returnRate") t.returnRate = std::stod(a);
            else if (key == "tier") {
                ss >> b >> c;
                tiers2.push_back({decodeToken(a), std::stoi(b), std::stod(c)});
            } else if (key == "cancel.dispatched") next.cancelDispatched = std::stod(a);
            else if (key == "cancel.onRoute") next.cancelOnRoute = std::stod(a);
            else if (key == "shipperShare") next.shipperShare = std::stod(a);
            else if (key == "scoreAware") next.scoreAware = a == "1";
            else if (key == "maxOpenOrders") next.maxOpenOrders = std::stoi(a);
            else if (key == "autoDeliver") next.autoDeliver = a == "1";
            else if (key == "ins.rate") next.insRate = std::stod(a);
            else if (key == "ins.threshold") next.insThreshold = std::stoll(a);
            else if (key == "vol.divisor") next.volDivisor = std::stoi(a);
            else if (key == "comp.multiplier") next.compMultiplier = std::stod(a);
            else if (key == "debt.limit") next.debtLimit = std::stoll(a);
            else if (key == "match.auto") next.autoMatch = a != "0";
            else if (key == "match.offerSeconds") next.offerSeconds = std::stoi(a);
            else if (key == "match.giveUp") next.matchGiveUp = std::stoi(a);
            else if (key == "clock.speed") next.clockSpeed = std::stod(a);
        } catch (...) {
            error = "Dong cau hinh khong hop le: " + raw;
            return false;
        }
    }
    if (!tiers2.empty()) next.tiers = tiers2;
    Pricing::Tariff saved = Pricing::tariff();
    Pricing::tariff() = t;
    std::string e = next.check();
    if (!e.empty()) {
        Pricing::tariff() = saved;
        error = e;
        return false;
    }
    *this = next;
    return true;
}

// ================================= Mã giảm giá ==================================
std::string normalizeCode(const std::string& code) {
    std::string s = TextUtil::trim(code);
    for (char& c : s) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
    return s;
}

std::string checkPromo(const Promo& p) {
    if (p.code.size() < 3 || p.code.size() > 16) return "Mã giảm giá dài 3–16 ký tự";
    for (char c : p.code)
        if (!((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9'))) return "Mã giảm giá chỉ gồm chữ in hoa và chữ số";
    if (p.type != "pct" && p.type != "amt") return "Loại mã phải là phần trăm hoặc số tiền";
    if (p.type == "pct" && (p.value < 1 || p.value > 100)) return "Mức giảm phần trăm phải từ 1 đến 100";
    if (p.type == "amt" && (p.value < 500 || p.value > 10000000 || p.value % 500 != 0))
        return "Số tiền giảm phải từ 500 đến 10.000.000 đ và là bội số của 500 đ";
    if (p.maxDiscount < 0 || p.maxDiscount > 10000000) return "Trần giảm giá không hợp lệ";
    if (p.minFee < 0 || p.minFee > 10000000) return "Đơn tối thiểu không hợp lệ";
    if (p.maxUses < 0 || p.maxUses > 1000000) return "Giới hạn lượt dùng không hợp lệ";
    if (p.perUser < 0 || p.perUser > 1000) return "Giới hạn lượt dùng mỗi khách không hợp lệ";
    if (p.expires < 0) return "Hạn dùng không hợp lệ";
    if (utf8Len(p.description) > 100 || hasControl(p.description)) return "Mô tả tối đa 100 ký tự";
    return "";
}

bool PromoStore::loadText(const std::string& text, std::string& error) {
    std::vector<Promo> out;
    int no = 0;
    for (const std::string& raw : TextUtil::meaningfulLines(text)) {
        ++no;
        std::vector<std::string> c;
        std::string rest;
        if (!TextUtil::splitColumns(raw, 10, c, rest)) {
            error = "Ma giam gia dong " + std::to_string(no) + ": thieu cot";
            return false;
        }
        Promo p;
        try {
            p.code = c[0];
            p.type = c[1];
            p.value = std::stoll(c[2]);
            p.maxDiscount = std::stoll(c[3]);
            p.minFee = std::stoll(c[4]);
            p.maxUses = std::stoi(c[5]);
            p.used = std::stoi(c[6]);
            p.perUser = std::stoi(c[7]);
            p.expires = std::stoll(c[8]);
            p.active = c[9] != "0";
        } catch (...) {
            error = "Ma giam gia dong " + std::to_string(no) + ": gia tri khong hop le";
            return false;
        }
        p.description = decodeLine(rest);
        std::string e = checkPromo(p);
        if (!e.empty()) {
            error = "Ma giam gia dong " + std::to_string(no) + ": " + e;
            return false;
        }
        for (const Promo& x : out)
            if (x.code == p.code) {
                error = "Ma giam gia dong " + std::to_string(no) + ": trung ma " + p.code;
                return false;
            }
        out.push_back(p);
    }
    promos_ = std::move(out);
    return true;
}

std::string PromoStore::toText() const {
    std::ostringstream o;
    o << "# Ma giam gia: ma loai(pct|amt) gia_tri tran_giam don_toi_thieu tong_luot da_dung luot_moi_khach het_han(giay,0=khong) bat(1/0) mo_ta\n";
    for (const Promo& p : promos_)
        o << p.code << ' ' << p.type << ' ' << p.value << ' ' << p.maxDiscount << ' ' << p.minFee << ' ' << p.maxUses << ' ' << p.used << ' '
          << p.perUser << ' ' << p.expires << ' ' << (p.active ? 1 : 0) << ' ' << encodeLine(p.description) << '\n';
    return o.str();
}

const Promo* PromoStore::find(const std::string& code) const {
    std::string c = normalizeCode(code);
    for (const Promo& p : promos_) if (p.code == c) return &p;
    return nullptr;
}

std::string PromoStore::upsert(const Promo& p0) {
    Promo p = p0;
    p.code = normalizeCode(p.code);
    std::string e = checkPromo(p);
    if (!e.empty()) return e;
    for (Promo& x : promos_)
        if (x.code == p.code) {
            p.used = x.used;   // số lượt đã dùng không sửa tay
            x = p;
            return "";
        }
    if (promos_.size() >= 200) return "Tối đa 200 mã giảm giá";
    p.used = 0;
    promos_.push_back(p);
    return "";
}

std::string PromoStore::remove(const std::string& code) {
    std::string c = normalizeCode(code);
    for (size_t i = 0; i < promos_.size(); ++i)
        if (promos_[i].code == c) {
            promos_.erase(promos_.begin() + i);
            return "";
        }
    return "Không có mã " + c;
}

void PromoStore::consume(const std::string& code) {
    std::string c = normalizeCode(code);
    for (Promo& p : promos_) if (p.code == c) ++p.used;
}
void PromoStore::giveBack(const std::string& code) {
    std::string c = normalizeCode(code);
    for (Promo& p : promos_) if (p.code == c && p.used > 0) --p.used;
}

std::string PromoStore::validate(const std::string& code, long long gross, int64_t now, int usedByUser) const {
    const Promo* p = find(code);
    if (!p) return "Mã giảm giá không tồn tại";
    if (!p->active) return "Mã giảm giá đang tạm ngưng";
    if (p->expires > 0 && p->expires <= now) return "Mã giảm giá đã hết hạn";
    if (p->maxUses > 0 && p->used >= p->maxUses) return "Mã giảm giá đã hết lượt dùng";
    if (gross < p->minFee) return "Mã chỉ áp dụng cho đơn có cước từ " + vnd(p->minFee);
    if (p->perUser > 0 && usedByUser >= p->perUser) return "Bạn đã dùng mã này rồi";
    return "";
}

// ==================================== Báo giá ====================================
long long shippingPart(const Pricing::Fee& fee) {
    if (!fee.valid) return 0;
    return std::max<long long>(0, floor500(fee.total - fee.cod));
}

Quote computeQuote(const Pricing::Fee& fee, const std::string& tier, double loyaltyPct, const std::string& promoCode,
                   const PromoStore& promos, int64_t now, int usedByUser) {
    Quote q;
    q.fee = fee;
    q.tier = tier;
    q.tierPct = loyaltyPct > 0 ? loyaltyPct : 0;
    if (!fee.valid) return q;
    q.gross = static_cast<long long>(fee.total);
    long long base = shippingPart(fee);
    if (loyaltyPct > 0) q.loyaltyDiscount = std::min(base, floor500(base * loyaltyPct));
    std::string code = normalizeCode(promoCode);
    if (!code.empty()) {
        std::string err = promos.validate(code, q.gross, now, usedByUser);
        if (!err.empty()) {
            q.promoError = err;
        } else {
            const Promo* p = promos.find(code);
            long long room = base - q.loyaltyDiscount;
            long long d = p->type == "pct" ? floor500(room * static_cast<double>(p->value) / 100.0) : p->value;
            if (p->type == "pct" && p->maxDiscount > 0) d = std::min(d, p->maxDiscount);
            q.promoDiscount = std::max<long long>(0, std::min(d, room));
            q.promo = p->code;
        }
    }
    q.net = q.gross - q.loyaltyDiscount - q.promoDiscount;
    return q;
}

// ================================== Sổ địa chỉ ===================================
std::string AddressBook::checkFields(const Address& a) {
    size_t l = utf8Len(a.label), r = utf8Len(a.recipient);
    if (l < 1 || l > 30 || hasControl(a.label)) return "Tên gợi nhớ của địa chỉ dài 1–30 ký tự";
    if (r < 2 || r > 60 || hasControl(a.recipient)) return "Tên người nhận dài 2–60 ký tự";
    if (!validPhone(a.phone)) return "Số điện thoại phải gồm 10 chữ số, bắt đầu bằng 0";
    if (utf8Len(a.detail) > 80 || hasControl(a.detail)) return "Địa chỉ chi tiết tối đa 80 ký tự";
    return "";
}

bool AddressBook::loadText(const std::string& text, std::string& error) {
    std::vector<Address> out;
    int maxId = 0;
    int no = 0;
    for (const std::string& raw : TextUtil::meaningfulLines(text)) {
        ++no;
        std::vector<std::string> c;
        std::string rest;
        if (!TextUtil::splitColumns(raw, 7, c, rest)) {
            error = "Dia chi dong " + std::to_string(no) + ": thieu cot";
            return false;
        }
        Address a;
        try {
            a.id = std::stoi(c[0]);
            a.owner = decodeToken(c[1]);
            a.node = std::stoi(c[2]);
            a.isDefault = c[3] == "1";
            a.phone = decodeToken(c[4]);
            a.label = decodeToken(c[5]);
            a.recipient = decodeToken(c[6]);
        } catch (...) {
            error = "Dia chi dong " + std::to_string(no) + ": gia tri khong hop le";
            return false;
        }
        a.detail = decodeLine(rest);
        maxId = std::max(maxId, a.id);
        out.push_back(a);
    }
    items_ = std::move(out);
    next_ = maxId + 1;
    return true;
}

std::string AddressBook::toText() const {
    std::ostringstream o;
    o << "# So dia chi: id khach_hang nut_ban_do mac_dinh(1/0) sdt nhan_goi_nho nguoi_nhan dia_chi_chi_tiet\n";
    for (const Address& a : items_)
        o << a.id << ' ' << encodeToken(a.owner) << ' ' << a.node << ' ' << (a.isDefault ? 1 : 0) << ' ' << encodeToken(a.phone) << ' '
          << encodeToken(a.label) << ' ' << encodeToken(a.recipient) << ' ' << encodeLine(a.detail) << '\n';
    return o.str();
}

std::vector<const Address*> AddressBook::of(const std::string& owner) const {
    std::vector<const Address*> v;
    for (const Address& a : items_) if (a.owner == owner) v.push_back(&a);
    return v;
}

const Address* AddressBook::find(int id) const {
    for (const Address& a : items_) if (a.id == id) return &a;
    return nullptr;
}

std::string AddressBook::add(const Address& a0, int& newId) {
    Address a = a0;
    a.phone = a.phone;
    std::string e = checkFields(a);
    if (!e.empty()) return e;
    if (of(a.owner).size() >= MAX_ADDRESSES) return "Sổ địa chỉ đã đầy (tối đa " + std::to_string(MAX_ADDRESSES) + " địa chỉ)";
    a.id = next_++;
    bool first = of(a.owner).empty();
    if (first) a.isDefault = true;
    if (a.isDefault) for (Address& x : items_) if (x.owner == a.owner) x.isDefault = false;
    items_.push_back(a);
    newId = a.id;
    return "";
}

std::string AddressBook::update(int id, const std::string& owner, const Address& a) {
    for (Address& x : items_) {
        if (x.id != id) continue;
        if (x.owner != owner) return "Không có địa chỉ này";
        Address n = a;
        n.id = id;
        n.owner = owner;
        n.isDefault = x.isDefault;
        std::string e = checkFields(n);
        if (!e.empty()) return e;
        x = n;
        return "";
    }
    return "Không có địa chỉ này";
}

std::string AddressBook::remove(int id, const std::string& owner) {
    for (size_t i = 0; i < items_.size(); ++i) {
        if (items_[i].id != id) continue;
        if (items_[i].owner != owner) return "Không có địa chỉ này";
        bool wasDefault = items_[i].isDefault;
        items_.erase(items_.begin() + i);
        if (wasDefault)
            for (Address& x : items_) if (x.owner == owner) { x.isDefault = true; break; }
        return "";
    }
    return "Không có địa chỉ này";
}

std::string AddressBook::setDefault(int id, const std::string& owner) {
    const Address* t = find(id);
    if (!t || t->owner != owner) return "Không có địa chỉ này";
    for (Address& x : items_) if (x.owner == owner) x.isDefault = x.id == id;
    return "";
}

void AddressBook::removeOwner(const std::string& owner) {
    items_.erase(std::remove_if(items_.begin(), items_.end(), [&](const Address& a) { return a.owner == owner; }), items_.end());
}

// ============================== Đánh giá & điểm shipper ==============================
bool ReviewStore::loadText(const std::string& text, std::string& error) {
    std::vector<Review> out;
    int no = 0;
    for (const std::string& raw : TextUtil::meaningfulLines(text)) {
        ++no;
        std::vector<std::string> c;
        std::string rest;
        if (!TextUtil::splitColumns(raw, 5, c, rest)) {
            error = "Danh gia dong " + std::to_string(no) + ": thieu cot";
            return false;
        }
        Review r;
        try {
            r.order = std::stoi(c[0]);
            r.customer = decodeToken(c[1]);
            r.shipper = decodeToken(c[2]);
            r.stars = std::stoi(c[3]);
            r.at = std::stoll(c[4]);
        } catch (...) {
            error = "Danh gia dong " + std::to_string(no) + ": gia tri khong hop le";
            return false;
        }
        r.comment = decodeLine(rest);
        out.push_back(r);
    }
    items_ = std::move(out);
    return true;
}

std::string ReviewStore::toText() const {
    std::ostringstream o;
    o << "# Danh gia shipper: ma_don khach_hang shipper so_sao thoi_diem(giay) nhan_xet\n";
    for (const Review& r : items_)
        o << r.order << ' ' << encodeToken(r.customer) << ' ' << encodeToken(r.shipper) << ' ' << r.stars << ' ' << r.at << ' ' << encodeLine(r.comment) << '\n';
    return o.str();
}

std::string ReviewStore::add(const Review& r) {
    if (r.stars < 1 || r.stars > 5) return "Số sao phải từ 1 đến 5";
    if (utf8Len(r.comment) > 200 || hasControl(r.comment)) return "Nhận xét tối đa 200 ký tự";
    if (ofOrder(r.order)) return "Đơn này đã được đánh giá";
    items_.push_back(r);
    return "";
}

const Review* ReviewStore::ofOrder(int order) const {
    for (const Review& r : items_) if (r.order == order) return &r;
    return nullptr;
}

std::vector<const Review*> ReviewStore::ofShipper(const std::string& shipper) const {
    std::vector<const Review*> v;
    for (const Review& r : items_) if (r.shipper == shipper) v.push_back(&r);
    return v;
}

double ReviewStore::average(const std::string& shipper, int* count) const {
    int n = 0;
    double sum = 0;
    for (const Review& r : items_) if (r.shipper == shipper) { ++n; sum += r.stars; }
    if (count) *count = n;
    return n ? sum / n : 0;
}

double ReviewStore::averageOfCustomer(const std::string& customer, int* count) const {
    int n = 0;
    double sum = 0;
    for (const Review& r : items_) if (r.customer == customer) { ++n; sum += r.stars; }
    if (count) *count = n;
    return n ? sum / n : 0;
}

bool StatsStore::loadText(const std::string& text, std::string& error) {
    std::map<std::string, ShipperStat> out;
    int no = 0;
    for (const std::string& raw : TextUtil::meaningfulLines(text)) {
        ++no;
        std::vector<std::string> c;
        std::string rest;
        if (!TextUtil::splitColumns(raw, 7, c, rest)) {
            error = "Thong ke shipper dong " + std::to_string(no) + ": thieu cot";
            return false;
        }
        ShipperStat s;
        try {
            s.delivered = std::stoi(c[1]);
            s.onTime = std::stoi(c[2]);
            s.failed = std::stoi(c[3]);
            s.accepted = std::stoi(c[4]);
            s.declines = std::stoi(c[5]);
            s.income = std::stoll(c[6]);
        } catch (...) {
            error = "Thong ke shipper dong " + std::to_string(no) + ": gia tri khong hop le";
            return false;
        }
        out[decodeToken(c[0])] = s;
    }
    stats_ = std::move(out);
    return true;
}

std::string StatsStore::toText() const {
    std::ostringstream o;
    o << "# Thong ke shipper: ten giao_xong dung_han that_bai nhan_chuyen tu_choi thu_nhap\n";
    for (const auto& kv : stats_)
        o << encodeToken(kv.first) << ' ' << kv.second.delivered << ' ' << kv.second.onTime << ' ' << kv.second.failed << ' ' << kv.second.accepted
          << ' ' << kv.second.declines << ' ' << kv.second.income << '\n';
    return o.str();
}

ShipperStat StatsStore::get(const std::string& shipper) const {
    auto it = stats_.find(shipper);
    return it == stats_.end() ? ShipperStat() : it->second;
}

void StatsStore::rename(const std::string& oldName, const std::string& newName) {
    auto it = stats_.find(oldName);
    if (it == stats_.end() || oldName == newName) return;
    stats_[newName] = it->second;
    stats_.erase(oldName);
}

double performanceScore(const ShipperStat& s, double avgStars, int ratingCount) {
    double onTime = s.delivered ? static_cast<double>(s.onTime) / s.delivered : 1.0;
    double rating = ratingCount > 0 ? avgStars : 4.0;
    int offered = s.accepted + s.declines;
    double declineRate = offered ? static_cast<double>(s.declines) / offered : 0.0;
    double score = 100.0 * (0.5 * onTime + 0.3 * (rating / 5.0) + 0.2 * (1.0 - std::min(1.0, declineRate * 2.0)));
    return std::round(score * 10.0) / 10.0;
}

}  // namespace Commerce
