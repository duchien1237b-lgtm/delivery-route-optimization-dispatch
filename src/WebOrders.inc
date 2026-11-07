// ============================================================================
// WebOrders.inc — API đơn hàng, báo giá, điều phối, chuyến giao, sổ COD, khiếu nại, thông báo, cấu hình, báo cáo.
// File này được #include vào WebServer.cpp (trong namespace ẩn danh), sau WebAccount.inc.
//
// Quy ước mã lỗi: 400 dữ liệu sai · 401 chưa đăng nhập · 403 sai vai trò hoặc đơn của người khác (IDOR)
//                 · 409 chuyển trạng thái không hợp lệ (xem Flow::check trong OrderFlow.h) · 429 gửi quá nhanh.
// ============================================================================

int matchPending();                                           // ghép đơn tự động (bên dưới)
void withdrawOffers(int shipperIdx, const std::string& why);   // gỡ lời mời chưa trả lời của một shipper (bên dưới)

std::string money(long long v) {   // 1234567 -> "1.234.567đ"
    std::string s = std::to_string(v < 0 ? -v : v), out;
    for (size_t i = 0; i < s.size(); ++i) {
        if (i && (s.size() - i) % 3 == 0) out += '.';
        out += s[i];
    }
    return (v < 0 ? "-" : "") + out + "đ";
}

std::string shipperNameOf(int idx) {
    return idx >= 0 && idx < static_cast<int>(S.shippers.size()) ? S.shippers[idx].name : std::string();
}
// Tên đăng nhập của tài khoản shipper gắn với một shipper trong đội xe
std::string accountOfShipper(const std::string& shipperName) {
    for (const Auth::Account& a : S.accounts.all())
        if (a.role == Auth::SHIPPER && a.link == shipperName) return a.username;
    return "";
}

Pricing::Fee feeFor(const Order& o) {
    std::vector<Order> one{o};
    double km = Pricing::feeDistances(S.graph, S.depot, one)[0];
    return Pricing::shippingFee(km, chargedWeightOf(o), o.urgent, o.cod);
}

// Số lần khách đã dùng mã (không tính đơn exceptId — khi sửa đơn)
int promoUsedBy(const std::string& user, const std::string& code, int exceptId = -1) {
    int n = 0;
    for (const Order& o : S.orders)
        if (o.owner == user && o.promo == code && o.id != exceptId) ++n;
    return n;
}

// Báo giá = hoá đơn: cùng một hàm tính cho báo giá, tạo đơn, sửa đơn và hoá đơn
Commerce::Quote quoteFor(const Order& o, const std::string& owner, const std::string& promoCode, int exceptId = -1) {
    Pricing::Fee fee = feeFor(o);
    std::string tier;
    double pct = -1;
    const Auth::Account* a = owner.empty() ? nullptr : S.accounts.find(owner);
    if (a && a->role == Auth::CUSTOMER) {
        const Commerce::Tier& t = Commerce::tierFor(a->done);
        tier = t.name;
        pct = t.pct;
    }
    int used = a ? promoUsedBy(owner, promoCode, exceptId) : 0;
    Commerce::Quote q = Commerce::computeQuote(fee, tier, pct, promoCode, S.promos, nowSeconds(), used);
    const Commerce::Config& cfg = Commerce::config();
    q.insurance = Billing::insuranceFee(o.declaredValue, cfg.insRate, cfg.insThreshold);
    q.total = q.net + q.insurance;
    q.chargedWeight = chargedWeightOf(o);
    q.volWeight = Billing::volumetricWeight(o.dimL, o.dimW, o.dimH, cfg.volDivisor);
    return q;
}

Json quoteJson(const Commerce::Quote& q) {
    return Json::object()
        .set("fee", feeJson(q.fee))
        .set("gross", static_cast<double>(q.gross))
        .set("loyaltyDiscount", static_cast<double>(q.loyaltyDiscount))
        .set("promoDiscount", static_cast<double>(q.promoDiscount))
        .set("net", static_cast<double>(q.net))
        .set("tier", q.tier)
        .set("tierPct", q.tierPct)
        .set("promo", q.promo)
        .set("promoError", q.promoError)
        .set("insurance", static_cast<double>(q.insurance))
        .set("total", static_cast<double>(q.total))
        .set("chargedWeight", q.chargedWeight)
        .set("volWeight", q.volWeight);
}

// Phí huỷ = tỉ lệ x phần cước vận chuyển còn phải trả (sau khi trừ giảm giá)
long long cancelFeeOf(const Order& o) {
    Pricing::Fee f = feeFor(o);
    long long part = f.valid ? Commerce::shippingPart(f) : 0;
    long long net = std::max(0LL, part - o.loyaltyDiscount - o.promoDiscount);
    return Flow::cancelFee(cancelFeeStatus(o), net, Commerce::config());
}

// Trả lại lượt dùng mã khi đơn bị huỷ / từ chối trước khi xuất phát
void releasePromo(Order& o) {
    if (o.promo.empty()) return;
    S.promos.giveBack(o.promo);
    mark(D_PROMOS);
    o.promo.clear();
    o.promoDiscount = 0;
}

void systemAudit(const std::string& action, const std::string& target, const std::string& detail = "") {
    S.audit.add("hệ thống", "system", action, target, detail, nowSeconds());
    mark(D_AUDIT);
}

void logOrder(const char* type, const Order& o, const std::string& detail = "") {
    S.shift.log(S.shift.clock(), type, o.id, o.shipper, detail);
}

// ------------------------------------------------------------ Đọc và kiểm tra trường của đơn
// Khai giá, kích thước (dài / rộng / cao cm), người trả cước — dùng chung cho tạo, sửa đơn và báo giá
void readBillingFields(const httplib::Request& r, Order& o) {
    double value = num(r, "value", static_cast<double>(o.declaredValue));
    if (value < 0 || value > Billing::MAX_DECLARED || std::floor(value) != value)
        throw Invalid("Giá trị hàng khai báo phải là số nguyên từ 0 đến 100.000.000 đ", {{"value", "Từ 0 đến 100.000.000 đ"}});
    o.declaredValue = static_cast<long long>(value);
    if (has(r, "length") || has(r, "width") || has(r, "height")) {
        auto dim = [&](const char* k) {
            double v = str(r, k).empty() ? 0 : num(r, k);
            if (v < 0 || v > Billing::MAX_DIM || std::floor(v) != v)
                throw Invalid("Kích thước mỗi cạnh là số nguyên từ 1 đến 300 cm", {{k, "Từ 1 đến 300 cm"}});
            return static_cast<int>(v);
        };
        int l = dim("length"), w = dim("width"), h = dim("height");
        std::string e = Billing::checkDims(l, w, h);
        if (!e.empty()) throw Invalid(e, {{"length", e}});
        o.dimL = l; o.dimW = w; o.dimH = h;
    }
    if (has(r, "payer")) {
        std::string payer = str(r, "payer");
        if (payer != "sender" && payer != "receiver") throw Invalid("Người trả cước là người gửi hoặc người nhận", {{"payer", "Chọn người trả cước"}});
        o.receiverPays = payer == "receiver";
    }
}

Order readOrderFields(const httplib::Request& r, Order o) {
    std::map<std::string, std::string> errors;
    if (has(r, "destination") && !str(r, "destination").empty()) o.destination = integer(r, "destination");
    if (!S.graph.hasNode(o.destination)) throw Invalid("Hãy chọn điểm giao trên bản đồ", {{"destination", "Hãy chọn điểm giao"}});
    o.weight = num(r, "weight", o.weight);
    if (!(o.weight > 0) || o.weight > 5000) throw Invalid("Khối lượng phải từ 0 đến 5000 kg", {{"weight", "Khối lượng phải lớn hơn 0 và tối đa 5000 kg"}});
    o.urgent = integer(r, "urgent", o.urgent ? 1 : 0) == 1;
    if (has(r, "deadline")) o.deadline = str(r, "deadline").empty() ? -1 : integer(r, "deadline");
    if (o.deadline < -1) throw Invalid("Hạn giao phải >= 0 phút, hoặc để trống nếu không có hạn", {{"deadline", "Hạn giao không hợp lệ"}});
    if (o.deadline > 1440) throw Invalid("Hạn giao tính trong ca, tối đa 1440 phút (24 giờ)", {{"deadline", "Tối đa 1440 phút"}});
    o.note = trimmed(str(r, "note", o.note));
    for (char& c : o.note)
        if (c == '#' || c == '\n' || c == '\r') c = '-';
    if (o.note.size() > 200) throw Invalid("Ghi chú tối đa 200 ký tự", {{"note", "Ghi chú tối đa 200 ký tự"}});
    double cod = num(r, "cod", static_cast<double>(o.cod));
    if (cod < 0 || cod > MAX_COD || std::floor(cod) != cod) throw Invalid("Tiền thu hộ phải là số nguyên từ 0 đến 50.000.000 đ", {{"cod", "Từ 0 đến 50.000.000 đ"}});
    o.cod = static_cast<long long>(cod);
    o.phone = Auth::normalizePhone(str(r, "phone", o.phone));
    if (!o.phone.empty() && !validPhone(o.phone)) throw Invalid("Số điện thoại phải bắt đầu bằng số 0 và gồm 10–11 chữ số", {{"phone", "Bắt đầu bằng 0, 10–11 chữ số"}});
    o.recipient = trimmed(str(r, "recipient", o.recipient));
    for (char& c : o.recipient)
        if (c == '#' || c == '\n' || c == '\r' || c == '_') c = ' ';
    size_t chars = std::count_if(o.recipient.begin(), o.recipient.end(), [](char c) { return (static_cast<unsigned char>(c) & 0xC0) != 0x80; });
    if (chars > 60) throw Invalid("Tên người nhận quá dài (tối đa 60 ký tự)", {{"recipient", "Tối đa 60 ký tự"}});
    if (o.cod > 0 && o.phone.empty()) throw Invalid("Đơn thu hộ cần số điện thoại người nhận để xác nhận khi giao", {{"phone", "Bắt buộc với đơn thu hộ"}});
    readBillingFields(r, o);
    if (has(r, "category")) {
        std::string cat = trimmed(str(r, "category"));
        if (!cat.empty() && !Commerce::validCategory(cat)) throw Invalid("Loại hàng không hợp lệ", {{"category", "Chọn loại hàng"}});
        o.category = cat;
    }
    if (o.receiverPays && o.phone.empty()) throw Invalid("Người nhận trả cước thì cần số điện thoại người nhận", {{"phone", "Bắt buộc khi người nhận trả cước"}});
    return o;
}

int nextOrderId() {
    int maxId = 100;
    for (const Order& o : S.orders) maxId = std::max(maxId, o.id);
    return maxId + 1;
}

bool isOpenStatus(int st) { return st == CREATED || st == PENDING || st == DISPATCHED || st == ASSIGNED || st == ARRIVED || st == FAILED; }

// Hạn giao là phút tính từ đầu ca: không nhận hạn đã qua so với đồng hồ ca hiện tại
void checkDeadlineAhead(const Order& o) {
    if (o.deadline >= 0 && o.deadline < S.shift.clock())
        throw Invalid("Hạn giao (phút " + std::to_string(o.deadline) + ") đã qua: đồng hồ ca đang ở phút " + std::to_string(static_cast<int>(S.shift.clock())),
                      {{"deadline", "Hạn giao đã qua"}});
}

// ------------------------------------------------------------ Tạo / sửa / xoá đơn
Billing::Statement statementOf(const std::string& customer, const std::vector<Pricing::Fee>& fees);

// Khách nợ phí (số dư ví đối soát âm) quá hạn mức thì phải thanh toán trước khi đặt đơn mới
void checkDebtLimit(const std::string& customer) {
    long long limit = Commerce::config().debtLimit;
    if (limit <= 0) return;
    long long debt = -statementOf(customer, orderFees()).balance;
    if (debt > limit)
        throw Conflict("Bạn đang nợ " + money(debt) + " cước / phí chưa thanh toán (hạn mức " + money(limit) +
                       "). Hãy chuyển khoản hoặc nộp tiền tại kho, kế toán ghi nhận xong là đặt đơn được ngay.");
}

// Khách đặt đơn: điểm giao không được là kho, và hàng không được nặng hơn xe lớn nhất của đội (nếu không sẽ không bao giờ ghép được).
static void checkCustomerLoad(const Order& o) {
    if (o.destination == S.depot)
        throw Invalid("Điểm giao không được trùng với kho", {{"destination", "Điểm giao không được là kho"}});
    double cap = 0;
    for (const auto& sh : S.shippers) cap = std::max(cap, static_cast<double>(sh.capacity));
    if (cap > 0 && o.weight > cap)
        throw Invalid("Hàng nặng quá: xe lớn nhất của đội chở được tối đa " + std::to_string(static_cast<long long>(cap)) + " kg", {{"weight", "Tối đa " + std::to_string(static_cast<long long>(cap)) + " kg"}});
}

Json createOrder(const httplib::Request& r) {
    Order o;
    o.id = isCustomer() ? nextOrderId() : integer(r, "id", nextOrderId());
    for (const Order& x : S.orders)
        if (x.id == o.id) throw BadRequest("Mã đơn " + std::to_string(o.id) + " đã tồn tại");
    if (isCustomer() && integer(r, "address", 0) > 0) {   // chọn từ sổ địa chỉ: điền sẵn điểm giao và người nhận
        const Commerce::Address& ad = ownAddress(integer(r, "address"));
        o.destination = ad.node;
        o.recipient = ad.recipient;
        o.phone = ad.phone;
        o.address = ad.id;
    }
    o = readOrderFields(r, o);
    checkDeadlineAhead(o);
    const Commerce::Config& cfg = Commerce::config();
    if (isCustomer()) {
        if (o.recipient.size() < 2) throw Invalid("Hãy nhập tên người nhận", {{"recipient", "Hãy nhập tên người nhận"}});
        if (o.phone.empty()) throw Invalid("Hãy nhập số điện thoại người nhận", {{"phone", "Hãy nhập số điện thoại người nhận"}});
        o.owner = S.me.username;
        // Loại hàng + cam kết không gửi hàng cấm (như GrabExpress). Ứng dụng cũ không gửi loại hàng: coi là "Khác".
        if (has(r, "category") && !flag(r, "pledge"))
            throw Invalid("Hãy xác nhận hàng gửi không thuộc danh mục cấm vận chuyển", {{"pledge", "Bắt buộc xác nhận"}});
        if (o.category.empty()) o.category = "khac";
        int open = 0;
        for (const Order& x : S.orders) open += x.owner == o.owner && isOpenStatus(x.status);
        if (open >= cfg.maxOpenOrders)
            throw BadRequest("Bạn đang có " + std::to_string(open) + " đơn chưa hoàn tất (tối đa " + std::to_string(cfg.maxOpenOrders) + "). Hãy đợi các đơn này xong rồi đặt thêm.");
        checkDebtLimit(o.owner);
        if (!S.graph.hasNode(S.depot)) throw BadRequest("Hệ thống chưa có kho");
        checkCustomerLoad(o);
        for (int u : Traversal::unreachableFrom(S.graph, S.depot))
            if (u == o.destination) throw Invalid("Kho chưa có đường tới " + nodeName(o.destination) + ", chưa nhận đơn tới điểm này", {{"destination", "Chưa có đường tới điểm này"}});
        // Ghép tự động bật: đơn khách đặt được tự xác nhận và hệ thống đi tìm shipper ngay. Tắt: quản trị viên xác nhận rồi phân công tay như trước.
        o.status = cfg.autoMatch ? PENDING : CREATED;
    } else {
        if (has(r, "owner") && !str(r, "owner").empty()) {
            o.owner = lowerCopy(str(r, "owner"));
            const Auth::Account* a = S.accounts.find(o.owner);
            if (!a || a->role != Auth::CUSTOMER) throw BadRequest("Không có tài khoản khách hàng '" + o.owner + "'");
        }
        o.status = PENDING;   // nhân viên tạo đơn thì coi như đã xác nhận
    }
    o.createdAt = nowSeconds();
    if (o.status == PENDING) o.searchSince = o.createdAt;
    o.createdBy = S.me.username;
    o.deliveryCode = Flow::newDeliveryCode();
    std::string code = Commerce::normalizeCode(str(r, "promo"));
    Commerce::Quote q = quoteFor(o, o.owner, code);
    if (!code.empty() && !q.promoError.empty()) throw Invalid(q.promoError, {{"promo", q.promoError}});
    if (isCustomer() && !q.fee.valid) throw BadRequest("Không tính được cước tới điểm này");
    o.gross = q.fee.valid ? q.gross : 0;
    o.loyaltyDiscount = q.loyaltyDiscount;
    o.promoDiscount = q.promoDiscount;
    o.promo = q.promo;
    o.insuranceFee = q.insurance;
    if (!o.promo.empty()) {
        S.promos.consume(o.promo);
        mark(D_PROMOS);
    }
    S.orders.push_back(o);
    mark(D_ORDERS);
    logOrder("created", o, S.me.username);
    audit("order.create", std::to_string(o.id), "tới " + nodeName(o.destination) + ", " + money(q.total));
    if (isCustomer() && !cfg.autoMatch) notifyStaff("order", o.id, "Đơn mới #" + std::to_string(o.id) + " của " + S.me.displayName + " đang chờ xác nhận");
    int newId = o.id;
    matchPending();
    const Order& cur = *findOrderById(newId);   // sau khi ghép: có thể đã được mời cho một shipper
    return stateJson().set("created", newId).set("order", Json::object().set("id", newId).set("status", cur.status).set("net", static_cast<double>(q.net)).set("total", static_cast<double>(q.total)))
        .set("message", isCustomer() ? "Đã tạo đơn " + std::to_string(newId) + (cfg.autoMatch ? ", đơn đang chờ shipper nhận" : ", đang chờ quản trị viên xác nhận") : "Đã tạo đơn " + std::to_string(newId));
}

// Nhân viên sửa đơn Mới / Chờ giao; khách tự sửa đơn của mình khi còn ở trạng thái Mới (chưa được xác nhận)
Json updateOrder(const httplib::Request& r) {
    int id = integer(r, "id");
    Order& o = orderForActor(id);
    if (isCustomer() && o.status != CREATED && o.status != PENDING)
        throw Conflict("Đơn " + std::to_string(id) + " đã có shipper nhận nên không tự sửa được nữa. Hãy huỷ đơn (kèm lý do) rồi đặt lại, hoặc gửi khiếu nại / liên hệ quản trị viên nếu cần đổi thông tin.");
    if (o.status != CREATED && o.status != PENDING)
        throw Conflict("Chỉ sửa được đơn ở trạng thái 'Mới' hoặc 'Chờ giao', đơn " + std::to_string(id) + " đang ở '" + orderStatusName(o.status) + "'");
    Order edited = readOrderFields(r, o);
    if (edited.deadline != o.deadline) checkDeadlineAhead(edited);
    if (isCustomer()) {
        if (edited.recipient.size() < 2) throw Invalid("Hãy nhập tên người nhận", {{"recipient", "Hãy nhập tên người nhận"}});
        if (edited.phone.empty()) throw Invalid("Hãy nhập số điện thoại người nhận", {{"phone", "Hãy nhập số điện thoại người nhận"}});
        if (edited.destination != o.destination || edited.weight != o.weight) checkCustomerLoad(edited);
        if (edited.destination != o.destination)
            for (int u : Traversal::unreachableFrom(S.graph, S.depot))
                if (u == edited.destination) throw Invalid("Kho chưa có đường tới " + nodeName(edited.destination), {{"destination", "Chưa có đường tới điểm này"}});
        if (edited.destination != o.destination) edited.address = 0;
        if (edited.category.empty()) edited.category = o.category.empty() ? "khac" : o.category;
        if (edited.category != o.category && !flag(r, "pledge"))
            throw Invalid("Đổi loại hàng thì hãy xác nhận lại hàng không thuộc danh mục cấm", {{"pledge", "Bắt buộc xác nhận"}});
    }
    if (has(r, "owner") && isAdmin()) {
        edited.owner = lowerCopy(str(r, "owner"));
        if (!edited.owner.empty()) {
            const Auth::Account* a = S.accounts.find(edited.owner);
            if (!a || a->role != Auth::CUSTOMER) throw BadRequest("Không có tài khoản khách hàng '" + edited.owner + "'");
        }
    }
    // Giá phải khớp đơn đã sửa: tính lại với mã giảm giá cũ (nếu mã không còn hợp lệ thì bỏ mã)
    std::string oldPromo = o.promo;
    Commerce::Quote q = quoteFor(edited, edited.owner, oldPromo, id);
    edited.gross = q.fee.valid ? q.gross : 0;
    edited.loyaltyDiscount = q.loyaltyDiscount;
    edited.promoDiscount = q.promoDiscount;
    edited.promo = q.promo;
    edited.insuranceFee = q.insurance;
    if (!oldPromo.empty() && q.promo.empty()) {
        S.promos.giveBack(oldPromo);
        mark(D_PROMOS);
    }
    o = edited;
    o.tried.clear();   // tải trọng / điểm giao có thể đổi: cho mọi shipper cơ hội nhận lại
    o.noShipperAt = 0;
    mark(D_ORDERS);
    audit("order.update", std::to_string(id), money(q.total) + (q.promoError.empty() ? "" : ", " + q.promoError));
    if (isCustomer()) notifyStaff("order", id, "Khách " + S.me.displayName + " vừa sửa đơn #" + std::to_string(id));
    else if (!o.owner.empty()) notify(o.owner, "order", id, "Đơn #" + std::to_string(id) + " vừa được quản trị viên chỉnh sửa");
    matchPending();
    return stateJson().set("message", "Đã cập nhật đơn " + std::to_string(id) + (q.promoError.empty() ? "" : ". Mã giảm giá đã bị bỏ: " + q.promoError));
}

Json removeOrder(const httplib::Request& r) {
    int id = integer(r, "id");
    auto it = std::find_if(S.orders.begin(), S.orders.end(), [id](const Order& o) { return o.id == id; });
    if (it == S.orders.end()) throw BadRequest("Không có đơn " + std::to_string(id));
    if (it->status == ASSIGNED || it->status == DISPATCHED || it->status == ARRIVED)
        throw Conflict("Đơn " + std::to_string(id) + " đang trong chuyến giao. Huỷ hoặc thu hồi phân công trước rồi mới xoá.");
    if (it->status == CREATED || it->status == PENDING) releasePromo(*it);
    S.orders.erase(it);
    mark(D_ORDERS);
    audit("order.remove", std::to_string(id));
    return stateJson();
}

// ------------------------------------------------------------ Máy trạng thái: xác nhận, từ chối, huỷ
Order& staffOrder(int id) {
    Order* o = findOrderById(id);
    if (!o) throw BadRequest("Không có đơn " + std::to_string(id));
    return *o;
}

Json confirmOrder(const httplib::Request& r) {
    Order& o = staffOrder(integer(r, "id"));
    int to = 0;
    std::string why = Flow::check(o.status, "confirm", actorBit(), &to);
    if (!why.empty()) throw Conflict(why);
    o.status = to;
    mark(D_ORDERS);
    logOrder("confirmed", o, S.me.username);
    audit("order.confirm", std::to_string(o.id));
    o.searchSince = nowSeconds(); o.opened = false;
    notify(o.owner, "order", o.id, "Đơn #" + std::to_string(o.id) + " đã được xác nhận, hệ thống đang tìm shipper");
    matchPending();
    return stateJson().set("message", "Đã xác nhận đơn " + std::to_string(o.id));
}

Json rejectOrder(const httplib::Request& r) {
    Order& o = staffOrder(integer(r, "id"));
    std::string reason = trimmed(str(r, "reason"));
    if (reason.size() < 3) throw Invalid("Hãy nhập lý do từ chối", {{"reason", "Hãy nhập lý do (ít nhất 3 ký tự)"}});
    int to = 0;
    std::string why = Flow::check(o.status, "reject", actorBit(), &to);
    if (!why.empty()) throw Conflict(why);
    o.status = to;
    o.proofNote = "Từ chối: " + TextUtil::utf8Prefix(reason, 150);
    o.closedAt = nowSeconds();
    releasePromo(o);
    mark(D_ORDERS);
    logOrder("rejected", o, reason);
    audit("order.reject", std::to_string(o.id), reason);
    notify(o.owner, "order", o.id, "Đơn #" + std::to_string(o.id) + " bị từ chối: " + reason);
    return stateJson().set("message", "Đã từ chối đơn " + std::to_string(o.id));
}

Json cancelOrder(const httplib::Request& r) {
    int id = integer(r, "id");
    Order& o = orderForActor(id);   // khách chỉ huỷ được đơn của mình (403 nếu đơn người khác)
    if (isShipper()) throw Forbidden("Shipper không huỷ đơn");
    int to = 0;
    std::string why = Flow::check(o.status, "cancel", actorBit(), &to);
    if (!why.empty()) throw Conflict(why);
    if (isCustomer() && o.status == ASSIGNED && pickedUp(o))
        throw Conflict("Shipper đã lấy hàng và đang trên đường giao nên không huỷ trực tiếp được. Hãy gửi khiếu nại hoặc liên hệ quản trị viên.");
    std::string reason = trimmed(str(r, "reason"));
    if (reason.size() > 150) throw Invalid("Lý do huỷ tối đa 150 ký tự", {{"reason", "Tối đa 150 ký tự"}});
    // Đơn đã có shipper nhận (hoặc quản trị viên huỷ giúp) thì bắt buộc nêu lý do, để shipper và hệ thống biết vì sao
    bool hasCarrier = o.status == DISPATCHED || o.status == ASSIGNED || o.status == FAILED;
    if ((isStaff() || hasCarrier) && reason.size() < 3) throw Invalid("Hãy chọn hoặc nhập lý do huỷ", {{"reason", "Hãy nhập lý do (ít nhất 3 ký tự)"}});
    long long fee = cancelFeeOf(o);
    int prev = o.status;
    std::string carrierAcct = o.shipper >= 0 ? accountOfShipper(shipperNameOf(o.shipper)) : "";
    if (!S.shift.cancel(id, S.orders)) throw Conflict("Không huỷ được đơn ở trạng thái '" + std::string(orderStatusName(o.status)) + "'");
    S.shift.dropEmptyPendingTrips();
    S.shift.dropEmptyAutoTrips();
    o.cancelFee = fee;
    o.closedAt = nowSeconds();
    o.proofNote = (isStaff() ? "Huỷ bởi quản trị viên: " : "Khách huỷ: ") + TextUtil::utf8Prefix(reason, 150);
    if (!reason.empty()) logOrder("reason", o, (isStaff() ? "Quản trị viên: " : "Khách: ") + reason);
    if (prev == CREATED || prev == PENDING) releasePromo(o);
    mark(D_ORDERS);
    audit("order.cancel", std::to_string(id), std::string(orderStatusName(prev)) + (fee ? ", phí huỷ " + money(fee) : "") + (reason.empty() ? "" : ": " + reason));
    std::string msg = "Đơn #" + std::to_string(id) + " đã huỷ" + (fee ? ", phí huỷ " + money(fee) : ", không mất phí");
    if (isStaff()) notify(o.owner, "order", id, msg + (reason.empty() ? "" : ". Lý do: " + reason));
    else notifyStaff("order", id, "Khách " + S.me.displayName + " đã huỷ đơn #" + std::to_string(id) + (fee ? " (phí huỷ " + money(fee) + ")" : ""));
    notify(carrierAcct, "trip", id, "Đơn #" + std::to_string(id) + " đã bị huỷ" + (reason.empty() ? "" : " (lý do: " + reason + ")") + ", bỏ khỏi chuyến của bạn");
    matchPending();   // shipper vừa được nhả ra có thể nhận đơn khác
    return stateJson().set("message", msg).set("cancelFee", static_cast<double>(fee));
}

// ------------------------------------------------------------ Giao hàng: mã xác nhận, COD, thống kê
// Gọi đúng một lần khi đơn chuyển sang Đã giao (do shipper xác nhận hoặc do đồng hồ mô phỏng)
void onDelivered(Order& o) {
    const Commerce::Config& cfg = Commerce::config();
    if (o.deliveredReal == 0) o.deliveredReal = nowSeconds();
    Pricing::Fee fee = feeFor(o);
    long long total = orderTotal(o, fee);
    long long collect = orderCollect(o, fee);
    std::string ship = shipperNameOf(o.shipper);
    if (collect > 0 && !o.codRecorded) {   // shipper giữ tiền thu hộ (+ cước nếu người nhận trả) cho tới khi nộp
        S.cod.record(o.id, ship, collect, nowSeconds());
        o.codRecorded = true;
        mark(D_COD);
    }
    if (!ship.empty()) {
        Commerce::ShipperStat& st = S.stats.at(ship);
        ++st.delivered;
        if (o.deadline < 0 || o.deliveredAt <= o.deadline + 1e-9) ++st.onTime;
        long long part = fee.valid ? Commerce::shippingPart(fee) : 0;
        long long shipping = std::max(0LL, part - o.loyaltyDiscount - o.promoDiscount);
        st.income += Commerce::floor500(shipping * cfg.shipperShare);
        mark(D_STATS);
    }
    if (const Auth::Account* a = o.owner.empty() ? nullptr : S.accounts.find(o.owner)) {
        std::string before = Commerce::tierFor(a->done).name;
        S.accounts.addDelivered(o.owner, total);
        mark(D_USERS);
        std::string after = Commerce::tierFor(S.accounts.find(o.owner)->done).name;
        notify(o.owner, "order", o.id, "Đơn #" + std::to_string(o.id) + " đã giao thành công. Hãy đánh giá shipper nhé!");
        if (before != after) notify(o.owner, "account", 0, "Chúc mừng! Bạn đã lên hạng " + after + " và được giảm cước nhiều hơn.");
    }
    mark(D_ORDERS);
}

// Hoàn tất đơn khi người nhận xác nhận "Đã nhận hàng" (hoặc hệ thống tự hoàn tất / quản trị viên xác nhận thay).
// `by`: khach | nguoi_nhan | tu_dong | tên quản trị viên (lưu vào đơn để tra lại ai đã xác nhận).
bool completeReceipt(Order& o, const std::string& by, const std::string& note = "") {
    double at = std::max(S.shift.clock(), o.eta);
    S.shift.advance(at);
    if (!S.shift.deliver(o.id, S.orders, at)) return false;
    o.deliveredReal = nowSeconds();
    o.receivedBy = by;
    if (!note.empty()) o.proofNote = note;
    onDelivered(o);
    matchPending();
    return true;
}

// Bước 1: shipper tới nơi và bấm "Đã giao tới" (thu đủ tiền mặt nếu đơn có COD / người nhận trả cước).
// Đơn chuyển sang "Chờ xác nhận"; người nhận phải bấm "Đã nhận hàng" thì đơn mới hoàn tất.
Json arriveOrder(const httplib::Request& r) {
    int id = integer(r, "id");
    Order& o = orderForActor(id);   // shipper chỉ báo đơn trong chuyến của mình
    if (isShipper() && o.shipper != myShipperIndex()) throw Forbidden("Đơn " + std::to_string(id) + " không nằm trong chuyến của bạn");
    int to = 0;
    std::string why = Flow::check(o.status, "arrive", actorBit(), &to);
    if (!why.empty()) throw Conflict(why);
    std::string note = trimmed(str(r, "note"));
    if (note.size() > 150) throw Invalid("Ghi chú tối đa 150 ký tự", {{"note", "Ghi chú tối đa 150 ký tự"}});
    long long collect = orderCollect(o, feeFor(o));
    if (collect > 0) {   // đơn thu hộ / người nhận trả cước: shipper phải xác nhận đã thu đủ tiền mặt
        double cash = num(r, "cash", -1);
        if (cash != static_cast<double>(collect))
            throw Invalid("Hãy thu của người nhận đúng " + money(collect) + (o.receiverPays ? " (gồm cước do người nhận trả)" : ""),
                          {{"cash", "Cần thu đủ " + money(collect)}});
    }
    double at = std::max(S.shift.clock(), o.eta);
    S.shift.advance(at);
    if (!S.shift.arrive(id, S.orders, at)) throw Conflict("Không báo giao tới được đơn ở trạng thái '" + std::string(orderStatusName(o.status)) + "'");
    o.arrivedReal = nowSeconds();
    if (!note.empty()) o.proofNote = note;
    if (collect > 0 && !o.codRecorded) {   // tiền mặt đã nằm trong tay shipper: ghi sổ COD ngay (chờ nộp), không đợi người nhận bấm xác nhận
        S.cod.record(o.id, shipperNameOf(o.shipper), collect, nowSeconds());
        o.codRecorded = true;
        mark(D_COD);
    }
    if (o.shipper >= 0) S.missStreak[shipperNameOf(o.shipper)] = 0;
    logOrder("arrived", o, collect ? "thu " + money(collect) : "");
    audit("order.arrive", std::to_string(id), collect ? "thu " + money(collect) : "");
    const int wait = Commerce::config().autoConfirmMinutes;
    notify(o.owner, "order", id, "Shipper " + shipperNameOf(o.shipper) + " đã giao tới đơn #" + std::to_string(id) + ". Nếu bạn / người nhận đã nhận được hàng, hãy bấm “Đã nhận hàng” để hoàn tất" +
                                     (wait > 0 ? " (đơn tự hoàn tất sau " + std::to_string(wait) + " phút nếu không có phản hồi)." : "."));
    mark(D_ORDERS);
    matchPending();   // shipper đã rảnh trong lúc chờ người nhận xác nhận
    return stateJson().set("message", "Đã báo giao tới đơn " + std::to_string(id) + (collect ? ", ghi nhận đã thu " + money(collect) : "") +
                                          ". Đơn hoàn tất khi người nhận xác nhận “Đã nhận hàng”.");
}

// Bước 2: người nhận (khách đặt đơn) bấm "Đã nhận hàng". Quản trị viên xác nhận thay phải ghi lý do.
Json receiveOrder(const httplib::Request& r) {
    int id = integer(r, "id");
    Order& o = orderForActor(id);   // khách chỉ xác nhận đơn của mình
    std::string why = Flow::check(o.status, "receive", actorBit());
    if (!why.empty()) throw Conflict(why);
    std::string note = trimmed(str(r, "note"));
    if (note.size() > 150) throw Invalid("Ghi chú tối đa 150 ký tự", {{"note", "Ghi chú tối đa 150 ký tự"}});
    if (isStaff() && note.size() < 3) throw Invalid("Xác nhận thay cần ghi rõ lý do", {{"note", "Ghi lý do xác nhận thay"}});
    const std::string by = isStaff() ? "qt:" + S.me.username : "khach";
    if (!completeReceipt(o, by, isStaff() ? "Quản trị viên xác nhận thay: " + note : "")) throw Conflict("Không xác nhận được đơn ở trạng thái '" + std::string(orderStatusName(o.status)) + "'");
    logOrder("received", o, isStaff() ? S.me.username + ": " + note : S.me.username);
    audit(isStaff() ? "order.receive_force" : "order.receive", std::to_string(id), isStaff() ? note : "");
    notify(accountOfShipper(shipperNameOf(o.shipper)), "order", id, "Đơn #" + std::to_string(id) + " đã được người nhận xác nhận. Cảm ơn bạn!");
    return stateJson().set("message", "Đã xác nhận nhận hàng đơn " + std::to_string(id));
}

// Người nhận báo "Chưa nhận được hàng": đơn quay lại Đang giao để shipper liên hệ / giao lại. Mỗi đơn báo tối đa 2 lần.
const int MAX_DISPUTES = 2;
Json disputeOrder(const httplib::Request& r) {
    int id = integer(r, "id");
    Order& o = orderForActor(id);
    std::string why = Flow::check(o.status, "dispute", actorBit());
    if (!why.empty()) throw Conflict(why);
    if (o.disputes >= MAX_DISPUTES) throw Conflict("Đơn này đã được báo chưa nhận " + std::to_string(MAX_DISPUTES) + " lần. Hãy gửi khiếu nại để quản trị viên xử lý.");
    std::string reason = trimmed(str(r, "reason"));
    if (reason.size() > 150) throw Invalid("Lý do tối đa 150 ký tự", {{"reason", "Tối đa 150 ký tự"}});
    if (!S.shift.reopenDelivery(id, S.orders)) throw Conflict("Không thể báo chưa nhận hàng khi đơn ở trạng thái '" + std::string(orderStatusName(o.status)) + "'");
    ++o.disputes;
    o.arrivedReal = 0;
    logOrder("disputed", o, reason.empty() ? S.me.username : reason);
    audit("order.dispute", std::to_string(id), reason);
    notify(accountOfShipper(shipperNameOf(o.shipper)), "order", id, "Người nhận báo CHƯA nhận được đơn #" + std::to_string(id) + (reason.empty() ? "" : " (" + reason + ")") + ". Hãy liên hệ người nhận rồi bấm “Đã giao tới” lại.");
    notifyStaff("order", id, "Người nhận báo chưa nhận được đơn #" + std::to_string(id) + " dù shipper " + shipperNameOf(o.shipper) + " đã bấm giao tới" +
                                (o.codRecorded ? " (đơn đã ghi thu tiền mặt, hãy kiểm tra)" : "") + (reason.empty() ? "" : ": " + reason));
    mark(D_ORDERS);
    return stateJson().set("message", "Đã báo chưa nhận được hàng. Shipper sẽ liên hệ bạn.");
}

// Quản trị viên xác nhận giao thay khi người nhận / shipper không thao tác được (bắt buộc ghi lý do)
Json deliverOrder(const httplib::Request& r) {
    int id = integer(r, "id");
    Order& o = orderForActor(id);
    std::string why = Flow::check(o.status, "deliver", actorBit());
    if (!why.empty()) throw Conflict(why);
    std::string note = trimmed(str(r, "note"));
    if (note.size() > 150) throw Invalid("Ghi chú tối đa 150 ký tự", {{"note", "Ghi chú tối đa 150 ký tự"}});
    if (note.size() < 3) throw Invalid("Giao thay cần ghi rõ lý do", {{"note", "Ghi lý do giao thay"}});
    long long collect = orderCollect(o, feeFor(o));
    if (collect > 0 && o.status == ASSIGNED) {
        double cash = num(r, "cash", -1);
        if (cash != static_cast<double>(collect))
            throw Invalid("Hãy xác nhận đã thu đúng " + money(collect), {{"cash", "Cần thu đủ " + money(collect)}});
    }
    if (!completeReceipt(o, "qt:" + S.me.username, "Quản trị viên giao thay: " + note)) throw Conflict("Không xác nhận giao được đơn ở trạng thái '" + std::string(orderStatusName(o.status)) + "'");
    logOrder("received", o, S.me.username + ": " + note);
    audit("order.deliver_force", std::to_string(id), note);
    return stateJson().set("message", "Đã xác nhận giao thay đơn " + std::to_string(id));
}

// Người nhận không có tài khoản: xác nhận / báo chưa nhận ngay trên trang tra cứu (mã đơn + SĐT người nhận)
Json trackConfirm(const httplib::Request& r) {
    int64_t now = nowSeconds();
    if (!S.limiter.allow("trackc:" + S.ip, now, 12, 600))
        throw TooMany("Bạn thao tác quá nhiều lần, hãy thử lại sau ít phút", S.limiter.retryAfter("trackc:" + S.ip, now, 600));
    const std::string notFound = "Không tìm thấy đơn phù hợp. Hãy kiểm tra lại mã đơn và số điện thoại người nhận.";
    std::string code = trimmed(str(r, "code"));
    std::string phone = Auth::normalizePhone(str(r, "phone"));
    std::string act = str(r, "action", "receive");
    if (code.empty() || code.size() > 9 || phone.empty() || !std::all_of(code.begin(), code.end(), [](char c) { return std::isdigit(static_cast<unsigned char>(c)); }))
        throw BadRequest(notFound);
    Order* o = findOrderById(std::stoi(code));
    if (!o || o->phone.empty() || o->phone != phone) throw BadRequest(notFound);
    if (act != "receive" && act != "dispute") throw BadRequest("Hành động không hợp lệ");
    std::string why = Flow::check(o->status, act, Auth::B_CUSTOMER);
    if (!why.empty()) throw Conflict(why);
    if (act == "receive") {
        if (!completeReceipt(*o, "nguoi_nhan")) throw Conflict("Không xác nhận được đơn ở trạng thái '" + std::string(orderStatusName(o->status)) + "'");
        logOrder("received", *o, "người nhận (tra cứu công khai)");
        systemAudit("order.receive_public", std::to_string(o->id), "người nhận xác nhận qua trang tra cứu");
        notify(accountOfShipper(shipperNameOf(o->shipper)), "order", o->id, "Đơn #" + std::to_string(o->id) + " đã được người nhận xác nhận. Cảm ơn bạn!");
        return Json::object().set("ok", true).set("message", "Cảm ơn bạn! Đơn #" + std::to_string(o->id) + " đã hoàn tất.");
    }
    if (o->disputes >= MAX_DISPUTES) throw Conflict("Đơn này đã được báo chưa nhận " + std::to_string(MAX_DISPUTES) + " lần. Hãy liên hệ người gửi hoặc quản trị viên.");
    if (!S.shift.reopenDelivery(o->id, S.orders)) throw Conflict("Không thể báo chưa nhận hàng lúc này");
    ++o->disputes;
    o->arrivedReal = 0;
    logOrder("disputed", *o, "người nhận (tra cứu công khai)");
    systemAudit("order.dispute_public", std::to_string(o->id), "người nhận báo chưa nhận được hàng");
    notify(accountOfShipper(shipperNameOf(o->shipper)), "order", o->id, "Người nhận báo CHƯA nhận được đơn #" + std::to_string(o->id) + ". Hãy liên hệ người nhận rồi bấm “Đã giao tới” lại.");
    notify(o->owner, "order", o->id, "Người nhận báo chưa nhận được đơn #" + std::to_string(o->id) + ", shipper sẽ liên hệ lại.");
    notifyStaff("order", o->id, "Người nhận báo chưa nhận được đơn #" + std::to_string(o->id) + " dù shipper đã bấm giao tới");
    mark(D_ORDERS);
    return Json::object().set("ok", true).set("message", "Đã ghi nhận chưa nhận được hàng. Shipper sẽ liên hệ bạn.");
}

// Người nhận không phản hồi quá autoConfirmMinutes phút kể từ lúc shipper giao tới thì đơn tự hoàn tất (shipper không bị treo tiền)
void autoCompleteArrived() {
    const int wait = Commerce::config().autoConfirmMinutes;
    if (wait <= 0) return;
    const int64_t now = nowSeconds();
    std::vector<int> due;
    for (const Order& o : S.orders)
        if (o.status == ARRIVED && o.arrivedReal > 0 && now - o.arrivedReal >= static_cast<int64_t>(wait) * 60) due.push_back(o.id);
    for (int id : due) {
        Order* o = findOrderById(id);
        if (!o || o->status != ARRIVED) continue;
        if (!completeReceipt(*o, "tu_dong", "Tự hoàn tất: người nhận không phản hồi sau " + std::to_string(wait) + " phút")) continue;
        logOrder("auto_received", *o, std::to_string(wait) + " phút");
        systemAudit("order.autoreceive", std::to_string(id), "người nhận không phản hồi sau " + std::to_string(wait) + " phút");
        notify(o->owner, "order", id, "Đơn #" + std::to_string(id) + " đã tự hoàn tất vì không có phản hồi sau " + std::to_string(wait) + " phút kể từ lúc shipper giao tới. Nếu chưa nhận được hàng, hãy gửi khiếu nại.");
    }
}

// Phí hoàn hàng (cùng công thức với Pricing::summarize): tỉ lệ hoàn × phần cước không gồm phí thu hộ, làm tròn lên 500 đ
void chargeReturn(Order& o) {
    Pricing::Fee f = feeFor(o);
    o.returnFee = f.valid ? Commerce::ceil500((f.total - f.cod) * Pricing::tariff().returnRate) : 0;
    o.closedAt = nowSeconds();
}

Json failOrder(const httplib::Request& r) {
    int id = integer(r, "id");
    int reason = integer(r, "reason", FAIL_ABSENT);
    if (reason < 0 || reason >= FAIL_REASON_COUNT) throw BadRequest("Lý do thất bại không hợp lệ");
    Order& o = orderForActor(id);
    if (isShipper() && o.shipper != myShipperIndex()) throw Forbidden("Đơn " + std::to_string(id) + " không nằm trong chuyến của bạn");
    std::string why = Flow::check(o.status, "fail", actorBit());
    if (!why.empty()) throw Conflict(why);
    int ship = o.shipper;
    int st = S.shift.fail(id, S.orders, reason);
    if (st < 0) throw Conflict("Chỉ báo thất bại được với đơn đang giao");
    if (st == RETURNED) chargeReturn(o);
    if (ship >= 0) {
        ++S.stats.at(shipperNameOf(ship)).failed;
        mark(D_STATS);
    }
    mark(D_ORDERS);
    audit("order.fail", std::to_string(id), failReasonName(reason));
    std::string text = st == RETURNED ? (failReasonReturns(reason) ? ": " + std::string(failReasonName(reason)) + ", hoàn hàng về kho"
                                                                    : " thất bại lần thứ " + std::to_string(MAX_ATTEMPTS) + ": chuyển sang hoàn hàng về kho")
                                      : " giao thất bại: " + std::string(failReasonName(reason));
    notify(o.owner, "order", id, "Đơn #" + std::to_string(id) + text);
    if (st == FAILED) notifyStaff("order", id, "Đơn #" + std::to_string(id) + " giao thất bại, cần quyết định giao lại hay hoàn kho");
    matchPending();
    return stateJson().set("message", "Đơn " + std::to_string(id) + text);
}

// Giao lại: nhân viên, hoặc chính khách hàng (hẹn giao lại, có thể sửa SĐT / ghi chú cho lần giao sau)
Json requeueOrder(const httplib::Request& r) {
    Order& o = orderForActor(integer(r, "id"));
    std::string why = Flow::check(o.status, "requeue", actorBit());
    if (!why.empty()) throw Conflict(why);
    std::string phone = Auth::normalizePhone(str(r, "phone"));
    if (!phone.empty() && !validPhone(phone)) throw Invalid("Số điện thoại phải bắt đầu bằng số 0 và gồm 10–11 chữ số", {{"phone", "Bắt đầu bằng 0, 10–11 chữ số"}});
    std::string note = trimmed(str(r, "note"));
    for (char& c : note)
        if (c == '#' || c == '\n' || c == '\r') c = '-';
    if (note.size() > 200) throw Invalid("Ghi chú tối đa 200 ký tự", {{"note", "Ghi chú tối đa 200 ký tự"}});
    if (!S.shift.requeue(o.id, S.orders)) throw Conflict("Chỉ đơn giao thất bại mới đưa lại hàng chờ được");
    if (!phone.empty()) o.phone = phone;
    if (!note.empty()) o.note = note;
    S.shift.dropEmptyAutoTrips();
    o.tried.clear();   // lần giao lại: ai cũng được mời
    o.noShipperAt = 0;
    o.searchSince = nowSeconds(); o.opened = false;
    mark(D_ORDERS);
    audit("order.requeue", std::to_string(o.id), phone.empty() ? "" : "SĐT mới " + phone);
    if (isCustomer() && !Commerce::config().autoMatch) notifyStaff("order", o.id, "Khách " + S.me.displayName + " yêu cầu giao lại đơn #" + std::to_string(o.id));
    else if (!isCustomer()) notify(o.owner, "order", o.id, "Đơn #" + std::to_string(o.id) + " sẽ được giao lại");
    matchPending();
    return stateJson().set("message", isCustomer() ? "Đã yêu cầu giao lại đơn " + std::to_string(o.id) + ", hệ thống đang tìm shipper"
                                                  : "Đã đưa đơn " + std::to_string(o.id) + " về hàng chờ");
}

Json returnOrder(const httplib::Request& r) {
    Order& o = orderForActor(integer(r, "id"));
    std::string why = Flow::check(o.status, "return", actorBit());
    if (!why.empty()) throw Conflict(why);
    if (!S.shift.returnToDepot(o.id, S.orders)) throw Conflict("Chỉ đơn giao thất bại mới hoàn kho được");
    chargeReturn(o);
    mark(D_ORDERS);
    audit("order.return", std::to_string(o.id), "phí hoàn " + money(o.returnFee));
    std::string msg = "Đơn #" + std::to_string(o.id) + " được hoàn về kho, phí hoàn " + money(o.returnFee);
    S.shift.dropEmptyAutoTrips();
    if (isCustomer()) notifyStaff("order", o.id, "Khách " + S.me.displayName + " yêu cầu hoàn đơn #" + std::to_string(o.id) + " về kho");
    else notify(o.owner, "order", o.id, msg);
    return stateJson().set("message", isCustomer() ? msg : "Đã chuyển đơn " + std::to_string(o.id) + " sang hoàn kho");
}

Json rateOrder(const httplib::Request& r) {
    Order& o = orderForActor(integer(r, "id"));
    if (o.status != DELIVERED) throw Conflict("Chỉ đánh giá được đơn đã giao");
    int stars = integer(r, "stars", 0);
    if (stars < 1 || stars > 5) throw Invalid("Hãy chọn từ 1 đến 5 sao", {{"stars", "Chọn từ 1 đến 5 sao"}});
    Commerce::Review rv;
    rv.order = o.id;
    rv.customer = S.me.username;
    rv.shipper = shipperNameOf(o.shipper);
    rv.stars = stars;
    rv.comment = trimmed(str(r, "comment"));
    rv.at = nowSeconds();
    if (S.reviews.ofOrder(o.id)) throw Conflict("Đơn này đã được đánh giá");
    std::string e = S.reviews.add(rv);
    if (!e.empty()) throw BadRequest(e);
    mark(D_REVIEWS);
    audit("order.rate", std::to_string(o.id), std::to_string(stars) + " sao");
    notify(accountOfShipper(rv.shipper), "order", o.id, "Đơn #" + std::to_string(o.id) + " được đánh giá " + std::to_string(stars) + " sao");
    return Json::object().set("ok", true).set("message", "Cảm ơn bạn đã đánh giá");
}

// ------------------------------------------------------------ Danh sách, chi tiết, hoá đơn, tra cứu công khai
Json timelineJson(const Order& o) {
    Json arr = Json::array();
    if (o.createdAt > 0)
        arr.push(Json::object().set("type", "created").set("at", static_cast<double>(o.createdAt)).set("t", Json())
                     .set("who", o.createdBy).set("detail", ""));
    // Khách không thấy việc hệ thống mời / bị từ chối / bỏ lỡ từng shipper (như app Grab chỉ báo "đang tìm tài xế")
    static const std::set<std::string> hiddenFromCustomer = {"offered", "declined", "expired", "offer_withdrawn", "recalled", "released", "assigned", "opened"};
    for (const ShiftEvent& e : S.shift.events())
        if (e.order == o.id && !(o.createdAt > 0 && e.type == "created") && !(isCustomer() && hiddenFromCustomer.count(e.type)))  // "Đặt đơn" đã có mốc giờ thật ở trên
            arr.push(Json::object().set("type", e.type).set("at", Json()).set("t", e.t)
                         .set("who", e.shipper >= 0 ? Json(shipperNameOf(e.shipper)) : Json()).set("detail", e.detail));
    return arr;
}

Json invoiceJson(const Order& o) {
    Pricing::Fee fee = feeFor(o);
    long long gross = o.gross > 0 ? o.gross : (fee.valid ? static_cast<long long>(fee.total) : 0);
    Json lines = Json::array();
    if (fee.valid && static_cast<long long>(fee.total) == gross) {
        auto line = [&](const char* label, double v) { if (v != 0) lines.push(Json::object().set("label", label).set("amount", v)); };
        line("Cước mở đầu", fee.base);
        line("Cước theo quãng đường", fee.distance);
        line("Phụ phí khối lượng", fee.weight);
        line("Phụ thu hoả tốc", fee.urgent);
        line("Phí thu hộ", fee.cod);
        double sum = fee.base + fee.distance + fee.weight + fee.urgent + fee.cod;
        if (std::abs(sum - fee.total) > 0.5) lines.push(Json::object().set("label", "Làm tròn").set("amount", fee.total - sum));
    } else {
        lines.push(Json::object().set("label", "Cước vận chuyển (đã chốt khi đặt đơn)").set("amount", static_cast<double>(gross)));
    }
    long long net = std::max(0LL, gross - o.loyaltyDiscount - o.promoDiscount);
    long long total = net + o.insuranceFee;
    long long payable = o.status == CANCELLED ? o.cancelFee : o.status == RETURNED ? o.returnFee : total;
    return Json::object()
        .set("order", o.id).set("status", orderStatusName(o.status)).set("recipient", o.recipient)
        .set("destination", nodeName(o.destination)).set("km", fee.valid ? fee.km : 0.0)
        .set("weight", o.weight).set("chargedWeight", chargedWeightOf(o)).set("dims", Billing::dimsText(o.dimL, o.dimW, o.dimH))
        .set("lines", lines).set("gross", static_cast<double>(gross))
        .set("loyaltyDiscount", static_cast<double>(o.loyaltyDiscount)).set("promo", o.promo)
        .set("promoDiscount", static_cast<double>(o.promoDiscount)).set("net", static_cast<double>(net))
        .set("value", static_cast<double>(o.declaredValue)).set("insurance", static_cast<double>(o.insuranceFee))
        .set("total", static_cast<double>(total))
        .set("payer", o.receiverPays ? "receiver" : "sender")
        .set("collect", static_cast<double>(o.cod + (o.receiverPays ? total : 0)))
        .set("cancelFee", static_cast<double>(o.cancelFee)).set("returnFee", static_cast<double>(o.returnFee)).set("cod", static_cast<double>(o.cod))
        .set("payable", static_cast<double>(payable))
        .set("createdAt", static_cast<double>(o.createdAt));
}

Json orderDetailJson(const httplib::Request&, const Order& o, size_t index) {
    Pricing::Fee fee = feeFor(o);
    std::set<int> unreachable = unreachableSet();
    std::map<int, std::string> carrier = carrierMap();
    Json j = orderRow(o, index, fee, unreachable, carrier);
    const Trip* trip = S.shift.tripOfOrder(o.id);
    if (trip && !(isCustomer() && !trip->accepted)) j.set("trip", Json::object().set("id", trip->id).set("accepted", trip->accepted).set("shipper", trip->shipperName));
    if (const Commerce::Review* rv = S.reviews.ofOrder(o.id))
        j.set("review", Json::object().set("stars", rv->stars).set("comment", rv->comment));
    // Khách xem được tên và SĐT shipper khi đơn đang trên đường
    if (isCustomer() && (o.status == ASSIGNED || o.status == ARRIVED) && o.shipper >= 0) {
        const Auth::Account* a = S.accounts.find(accountOfShipper(shipperNameOf(o.shipper)));
        j.set("carrierPhone", a ? a->phone : std::string());
    }
    return Json::object().set("ok", true).set("order", j).set("timeline", timelineJson(o)).set("invoice", invoiceJson(o));
}

Json ordersListJson(const httplib::Request& r) {
    const View view = currentView();
    std::vector<Pricing::Fee> fees = orderFees();
    std::vector<size_t> rows;
    std::map<int, int> byStatus;
    for (size_t i = 0; i < S.orders.size(); ++i) {
        const Order& o = S.orders[i];
        if (!view.all && !view.orders.count(o.id)) continue;
        rows.push_back(i);
        ++byStatus[o.status];
    }
    std::string st = trimmed(str(r, "status"));
    if (!st.empty()) {
        std::set<int> want;
        for (int v : intList(st)) want.insert(v);
        rows.erase(std::remove_if(rows.begin(), rows.end(), [&](size_t i) { return !want.count(S.orders[i].status); }), rows.end());
    }
    if (isStaff() && !trimmed(str(r, "owner")).empty()) {
        std::string ow = lowerCopy(trimmed(str(r, "owner")));
        rows.erase(std::remove_if(rows.begin(), rows.end(), [&](size_t i) { return S.orders[i].owner != ow; }), rows.end());
    }
    if (has(r, "urgent") && !str(r, "urgent").empty()) {
        bool u = integer(r, "urgent") == 1;
        rows.erase(std::remove_if(rows.begin(), rows.end(), [&](size_t i) { return S.orders[i].urgent != u; }), rows.end());
    }
    double from = num(r, "from", 0), to = num(r, "to", 0);
    if (from > 0) rows.erase(std::remove_if(rows.begin(), rows.end(), [&](size_t i) { return S.orders[i].createdAt < from; }), rows.end());
    if (to > 0) rows.erase(std::remove_if(rows.begin(), rows.end(), [&](size_t i) { return S.orders[i].createdAt > to; }), rows.end());
    std::string q = trimmed(str(r, "q"));
    if (!q.empty()) {
        TextIndex idx;   // tìm không dấu bằng Trie: mã đơn, người nhận, SĐT, ghi chú, điểm giao, khách hàng
        for (size_t i : rows) {
            const Order& o = S.orders[i];
            idx.add(static_cast<int>(i), std::to_string(o.id) + " " + o.recipient + " " + o.phone + " " + o.note + " " + nodeName(o.destination) +
                                             (isShipper() ? "" : " " + o.owner + " " + ownerDisplay(o.owner)));
        }
        std::set<int> hit;
        for (int i : idx.search(q)) hit.insert(i);
        rows.erase(std::remove_if(rows.begin(), rows.end(), [&](size_t i) { return !hit.count(static_cast<int>(i)); }), rows.end());
    }
    std::string key = sortKey(r, {"id", "created", "status", "net", "deadline", "destination"}, "id");
    bool desc = sortDesc(r, true);
    std::stable_sort(rows.begin(), rows.end(), [&](size_t a, size_t b) {
        const Order &x = S.orders[a], &y = S.orders[b];
        double c = 0;
        if (key == "id") c = x.id - y.id;
        else if (key == "created") c = static_cast<double>(x.createdAt - y.createdAt);
        else if (key == "status") c = x.status - y.status;
        else if (key == "net") c = static_cast<double>(orderNet(x, fees[a]) - orderNet(y, fees[b]));
        else if (key == "deadline") c = (x.deadline < 0 ? 1e9 : x.deadline) - (y.deadline < 0 ? 1e9 : y.deadline);
        else c = normalizeVi(nodeName(x.destination)).compare(normalizeVi(nodeName(y.destination)));
        if (c == 0) return desc ? x.id > y.id : x.id < y.id;
        return desc ? c > 0 : c < 0;
    });
    PageInfo p = paginate(r, rows.size());
    std::set<int> unreachable = unreachableSet();
    std::map<int, std::string> carrier = carrierMap();
    Json arr = Json::array();
    for (size_t k = p.begin; k < p.end; ++k) arr.push(orderRow(S.orders[rows[k]], rows[k], fees[rows[k]], unreachable, carrier));
    Json bs = Json::object();
    for (const auto& kv : byStatus) bs.set(std::to_string(kv.first), kv.second);
    return Json::object().set("ok", true).set("orders", arr).set("page", pageJson(p)).set("byStatus", bs);
}

// Tra cứu công khai: mã đơn + SĐT người nhận. Mọi trường hợp không khớp đều trả về cùng một thông báo.
Json trackOrder(const httplib::Request& r) {
    int64_t now = nowSeconds();
    if (!S.limiter.allow("track:" + S.ip, now, 20, 600))
        throw TooMany("Bạn tra cứu quá nhiều lần, hãy thử lại sau ít phút", S.limiter.retryAfter("track:" + S.ip, now, 600));
    const std::string notFound = "Không tìm thấy đơn phù hợp. Hãy kiểm tra lại mã đơn và số điện thoại người nhận.";
    std::string code = trimmed(str(r, "code"));
    std::string phone = Auth::normalizePhone(str(r, "phone"));
    if (code.empty() || code.size() > 9 || phone.empty() || !std::all_of(code.begin(), code.end(), [](char c) { return std::isdigit(static_cast<unsigned char>(c)); }))
        throw BadRequest(notFound);
    const Order* o = findOrderById(std::stoi(code));
    if (!o || o->phone.empty() || o->phone != phone) throw BadRequest(notFound);
    std::map<int, std::string> carrier = carrierMap();
    Json steps = Json::array();
    steps.push(Json::object().set("type", "created").set("at", static_cast<double>(o->createdAt)));
    for (const ShiftEvent& e : S.shift.events())
        if (e.order == o->id && e.type != "created") steps.push(Json::object().set("type", e.type).set("t", e.t));
    // Chỉ lộ tên shipper khi họ đã nhận đơn (đang chờ trả lời lời mời thì người ngoài không biết ai được mời, giả định 39)
    std::string ship = carrier.count(o->id) && o->status != DISPATCHED ? carrier[o->id] : "";
    std::string first = ship.empty() ? "" : ship.substr(ship.rfind(' ') == std::string::npos ? 0 : ship.rfind(' ') + 1);
    Json ord = Json::object().set("id", o->id).set("status", o->status).set("statusName", orderStatusName(o->status))
                   .set("destination", nodeName(o->destination)).set("urgent", o->urgent)
                   .set("carrier", first.empty() ? Json() : Json(first)).set("cod", static_cast<double>(o->cod))
                   .set("collect", static_cast<double>(orderCollect(*o, feeFor(*o))))
                   .set("deliveredReal", static_cast<double>(o->deliveredReal))
                   .set("arrivedReal", static_cast<double>(o->arrivedReal))
                   .set("disputes", o->disputes);
    // Người nhận (đúng SĐT trên đơn) xác nhận "Đã nhận hàng" / báo chưa nhận ngay tại đây khi shipper đã bấm "Đã giao tới"
    {
        const int wait = Commerce::config().autoConfirmMinutes;
        ord.set("canConfirm", o->status == ARRIVED);
        ord.set("canDispute", o->status == ARRIVED && o->disputes < MAX_DISPUTES);
        ord.set("autoConfirmAt", o->status == ARRIVED && o->arrivedReal > 0 && wait > 0 ? Json(static_cast<double>(o->arrivedReal + static_cast<int64_t>(wait) * 60)) : Json());
    }
    return Json::object().set("ok", true).set("order", ord).set("steps", steps);
}

Json publicInfo() {
    Json nodes = Json::array();
    std::set<int> bad = unreachableSet();
    for (int id : S.graph.nodeIds())
        if (id != S.depot && !bad.count(id)) nodes.push(Json::object().set("id", id).set("name", nodeName(id)));
    int delivered = 0;
    for (const Order& o : S.orders) delivered += o.status == DELIVERED;
    Json tiers = Json::array();
    for (const Commerce::Tier& t : Commerce::config().tiers) tiers.push(Json::object().set("name", t.name).set("minDone", t.minDone).set("pct", t.pct));
    return Json::object().set("ok", true).set("nodes", nodes).set("depot", nodeName(S.depot)).set("tariff", tariffJson())
        .set("tiers", tiers).set("delivered", delivered).set("shippers", static_cast<int>(S.shippers.size()))
        .set("demo", S.demo);
}

Json quoteHandler(const httplib::Request& r) {
    int64_t now = nowSeconds();
    if (!S.authed && !S.limiter.allow("quote:" + S.ip, now, 60, 60)) throw TooMany("Bạn báo giá quá nhanh, hãy thử lại sau ít giây", 10);
    Order o;
    o.destination = requireNode(r, "destination");
    o.weight = num(r, "weight", 1);
    if (!(o.weight > 0) || o.weight > 5000) throw BadRequest("Khối lượng phải lớn hơn 0 và tối đa 5000 kg");
    o.urgent = integer(r, "urgent", 0) == 1;
    double cod = num(r, "cod", 0);
    if (cod < 0 || cod > MAX_COD) throw BadRequest("Tiền thu hộ phải từ 0 đến 50.000.000 đ");
    o.cod = static_cast<long long>(cod);
    readBillingFields(r, o);
    std::string code = S.authed ? Commerce::normalizeCode(str(r, "promo")) : "";   // mã giảm giá dành cho khách đã đăng nhập
    Commerce::Quote q = quoteFor(o, isCustomer() ? S.me.username : "", code);
    Json out = quoteJson(q);
    out.set("ok", true).set("collect", static_cast<double>(o.cod + (o.receiverPays ? q.total : 0)));
    if (!S.authed && !str(r, "promo").empty()) out.set("promoError", "Hãy đăng nhập để dùng mã giảm giá");
    return out;
}

// ------------------------------------------------------------ Mã giảm giá
Json promosJson() {
    Json arr = Json::array();
    int64_t now = nowSeconds();
    for (const Commerce::Promo& p : S.promos.all())
        arr.push(Json::object().set("code", p.code).set("type", p.type).set("value", static_cast<double>(p.value))
                     .set("maxDiscount", static_cast<double>(p.maxDiscount)).set("minFee", static_cast<double>(p.minFee))
                     .set("maxUses", p.maxUses).set("used", p.used).set("perUser", p.perUser)
                     .set("expires", static_cast<double>(p.expires)).set("expired", p.expires > 0 && p.expires < now)
                     .set("active", p.active).set("description", p.description));
    return Json::object().set("ok", true).set("promos", arr);
}

Json savePromo(const httplib::Request& r) {
    Commerce::Promo p;
    p.code = Commerce::normalizeCode(str(r, "code"));
    p.type = lowerCopy(str(r, "type", "pct"));
    p.value = static_cast<long long>(num(r, "value"));
    p.maxDiscount = static_cast<long long>(num(r, "maxDiscount", 0));
    p.minFee = static_cast<long long>(num(r, "minFee", 0));
    p.maxUses = integer(r, "maxUses", 0);
    p.perUser = integer(r, "perUser", 1);
    p.expires = static_cast<int64_t>(num(r, "expires", 0));
    p.active = !has(r, "active") || flag(r, "active");
    p.description = trimmed(str(r, "description"));
    if (const Commerce::Promo* old = S.promos.find(p.code)) p.used = old->used;
    std::string e = Commerce::checkPromo(p);
    if (!e.empty()) throw Invalid(e, {{"code", e}});
    e = S.promos.upsert(p);
    if (!e.empty()) throw BadRequest(e);
    mark(D_PROMOS);
    audit("promo.save", p.code, p.type + " " + std::to_string(p.value));
    return promosJson().set("message", "Đã lưu mã " + p.code);
}

// ------------------------------------------------------------ Điều phối và ca giao
struct Pending {
    std::vector<Order> orders;
    std::vector<int> idx;
};
Pending pendingOrders() {
    Pending p;
    int created = 0;
    for (size_t i = 0; i < S.orders.size(); ++i) {
        if (S.orders[i].status == PENDING) {
            p.orders.push_back(S.orders[i]);
            p.idx.push_back(static_cast<int>(i));
        }
        created += S.orders[i].status == CREATED;
    }
    if (p.orders.empty())
        throw BadRequest(created ? "Chưa có đơn nào chờ giao: còn " + std::to_string(created) + " đơn mới cần xác nhận trước."
                         : S.orders.empty() ? "Chưa có đơn hàng nào" : "Mọi đơn đều đã được phân công. Không còn đơn chờ giao.");
    return p;
}

// Shipper nghỉ đột xuất hoặc tắt "sẵn sàng" không được điều phối: chỉ đưa người sẵn sàng vào Dispatcher,
// rồi đổi chỉ số shipper trong kết quả về chỉ số gốc. Nếu bật tính điểm, shipper điểm cao được xét trước.
// only >= 0: chỉ xét một shipper (phân công tay hoặc ghép tự động).
// startAfter >= 0: shipper chỉ có thể xuất phát từ kho vào phút này (ghép tự động: giờ hiện tại + thời gian chạy tới kho).
DispatchReport runDispatch(const Pending& pend, Vehicle v, bool back, int only = -1, double startAfter = -1) {
    std::vector<int> map;
    for (size_t i = 0; i < S.shippers.size(); ++i)
        if (!S.shift.isAbsent(static_cast<int>(i)) && shipperReady(static_cast<int>(i)) && (only < 0 || only == static_cast<int>(i)))
            map.push_back(static_cast<int>(i));
    if (Commerce::config().scoreAware)
        std::stable_sort(map.begin(), map.end(), [](int a, int b) { return shipperScore(S.shippers[a].name) > shipperScore(S.shippers[b].name); });
    std::vector<Shipper> avail;
    for (int i : map) avail.push_back(S.shippers[i]);
    Dispatcher d(S.graph, S.depot, pend.orders, avail, back);
    d.setStartTime(S.shift.clock());
    std::vector<double> free;
    for (int i : map) free.push_back(startAfter >= 0 ? startAfter : S.shift.freeAt(i));
    d.setShipperFreeAt(free);
    d.setRush(rushPtr(), S.shiftStart);
    DispatchReport rep = d.compareAll(v);
    for (auto* group : {&rep.multi, &rep.single})
        for (Plan& p : *group)
            for (Route& rt : p.routes)
                if (rt.shipper >= 0) rt.shipper = map[rt.shipper];
    return rep;
}

Json dispatchPreview(const httplib::Request& r) {
    if (!S.graph.hasNode(S.depot)) throw BadRequest("Chưa chọn kho");
    Vehicle v = vehicleFromInt(integer(r, "vehicle", 0));
    if (v == ANY_VEHICLE) v = MOTORBIKE;
    bool back = integer(r, "return", 1) == 1;
    Pending pend = pendingOrders();
    DispatchReport rep = runDispatch(pend, v, back);
    if (!rep.error.empty()) throw BadRequest(rep.error);
    Json single = Json::array(), multi = Json::array();
    for (const Plan& p : rep.single) single.push(planJson(p, pend.orders, S.shippers));
    for (const Plan& p : rep.multi) multi.push(planJson(p, pend.orders, S.shippers));
    Json prio = Json::array();
    for (int i : rep.priorityOrder) prio.push(pend.orders[i].id);
    return Json::object()
        .set("clock", S.shift.clock())
        .set("pending", static_cast<int>(pend.orders.size()))
        .set("ok", true)
        .set("depot", S.depot)
        .set("vehicle", vehicleName(v))
        .set("returnToDepot", back)
        .set("scoreAware", Commerce::config().scoreAware)
        .set("priorityOrder", prio)
        .set("matrixMicros", rep.matrixMicros)
        .set("single", single)
        .set("multi", multi);
}

// Tạo chuyến theo phương án, ghi nhật ký và báo cho khách / shipper. Trả về số đơn được phân công.
int applyPlan(const Plan& plan, const Pending& pend) {
    size_t tripsBefore = S.shift.trips().size();
    bool await = !Commerce::config().autoDeliver;
    int n = S.shift.apply(plan, pend.idx, S.orders, S.shippers, await);
    if (n == 0) return 0;
    for (int i : pend.idx) {
        const Order& o = S.orders[i];
        if (o.status != DISPATCHED && o.status != ASSIGNED) continue;
        logOrder("assigned", o, shipperNameOf(o.shipper));
        notify(o.owner, "order", o.id, "Đơn #" + std::to_string(o.id) + " đã được phân công cho " + shipperNameOf(o.shipper));
    }
    for (size_t t = tripsBefore; t < S.shift.trips().size(); ++t) {
        const Trip& trip = S.shift.trips()[t];
        notify(accountOfShipper(trip.shipperName), "trip", 0,
               "Bạn có chuyến mới #" + std::to_string(trip.id) + " gồm " + std::to_string(trip.stops.size()) + " đơn" + (trip.accepted ? "" : ", hãy mở và nhận chuyến"));
    }
    mark(D_ORDERS);
    return n;
}

// Áp dụng một phương án: tạo chuyến cho từng shipper. Đơn sang "Đã phân công" và chờ shipper nhận chuyến
// (chế độ mô phỏng thì vào thẳng "Đang giao").
Json dispatchApply(const httplib::Request& r) {
    if (!S.graph.hasNode(S.depot)) throw BadRequest("Chưa chọn kho");
    std::string key = str(r, "plan");
    Vehicle v = vehicleFromInt(integer(r, "vehicle", 0));
    if (v == ANY_VEHICLE) v = MOTORBIKE;
    bool back = integer(r, "return", 1) == 1;
    Pending pend = pendingOrders();
    DispatchReport rep = runDispatch(pend, v, back);
    if (!rep.error.empty()) throw BadRequest(rep.error);
    const Plan* chosen = nullptr;
    for (const auto* group : {&rep.multi, &rep.single})
        for (const Plan& p : *group)
            if (p.key == key) chosen = &p;
    if (!chosen) throw BadRequest("Không có phương án '" + key + "'");
    if (chosen->skipped) throw Conflict("Phương án này không chạy được: " + chosen->note);
    int n = applyPlan(*chosen, pend);
    if (n == 0) throw BadRequest("Phương án không giao được đơn nào");
    audit("dispatch.apply", chosen->key, std::to_string(n) + " đơn");
    return stateJson().set("message", "Đã áp dụng “" + chosen->name + "”: " + std::to_string(n) + " đơn được phân công");
}

// Phân công tay: quản trị viên chọn các đơn Chờ giao và một shipper. Thứ tự giao do phương án "deadline"
// (chèn rẻ nhất có xét hạn giao + 2-opt) của Dispatcher tính cho riêng shipper đó, theo loại xe của shipper.
Json dispatchAssign(const httplib::Request& r) {
    if (!S.graph.hasNode(S.depot)) throw BadRequest("Chưa chọn kho");
    int si = integer(r, "shipper", -1);
    if (si < 0 || si >= static_cast<int>(S.shippers.size())) throw Invalid("Hãy chọn shipper", {{"shipper", "Hãy chọn shipper"}});
    const std::string name = S.shippers[si].name;
    if (S.shift.isAbsent(si)) throw Conflict(name + " đang nghỉ đột xuất, không phân công được");
    if (!shipperReady(si)) throw Conflict(name + " đang tắt \"sẵn sàng nhận chuyến\" hoặc tài khoản bị khoá");
    Pending pend;
    std::set<int> seen;
    for (int id : intList(str(r, "orders"))) {
        if (!seen.insert(id).second) continue;
        Order* o = findOrderById(id);
        if (!o) throw BadRequest("Không có đơn " + std::to_string(id));
        if (o->status != PENDING) throw Conflict("Đơn " + std::to_string(id) + " đang ở '" + orderStatusName(o->status) + "', chỉ phân công được đơn Chờ giao");
        pend.orders.push_back(*o);
        pend.idx.push_back(static_cast<int>(o - &S.orders[0]));
    }
    if (pend.orders.empty()) throw Invalid("Hãy chọn ít nhất một đơn", {{"orders", "Chọn đơn cần phân công"}});
    bool back = integer(r, "return", 1) == 1;
    DispatchReport rep = runDispatch(pend, S.shippers[si].vehicle, back, si);
    if (!rep.error.empty()) throw BadRequest(rep.error);
    const Plan* chosen = nullptr;
    for (const Plan& p : rep.multi)
        if (p.key == "deadline") chosen = &p;
    if (!chosen || chosen->skipped) throw Conflict("Không lập được chuyến cho " + name + (chosen ? ": " + chosen->note : ""));
    int n = applyPlan(*chosen, pend);
    if (n == 0) throw Conflict("Không đơn nào hợp với " + name + " (quá tải trọng, xe không tới được điểm giao hoặc hết giờ)");
    int left = static_cast<int>(pend.orders.size()) - n;
    audit("dispatch.assign", name, std::to_string(n) + " đơn");
    return stateJson().set("assigned", n).set("left", left)
        .set("message", "Đã phân công " + std::to_string(n) + " đơn cho " + name + (left ? ". " + std::to_string(left) + " đơn không xếp được (quá tải trọng / xe không tới được), vẫn ở hàng chờ" : ""));
}

// ------------------------------------------------------------ Đơn chờ nhận: ai bấm nhận trước thì giao đơn đó
// Khi khách đặt đơn (hoặc đơn quay về hàng chờ), đơn hiện trên bảng "Đơn chờ nhận" của MỌI shipper đang sẵn sàng
// (trừ shipper bị khách chặn). Shipper nào bấm "Nhận đơn" trước thì được giao: server xử lý từng yêu cầu một (khoá mutex)
// nên chỉ một người nhận được, người bấm sau nhận lỗi 409 "đơn đã có shipper khác nhận". Mỗi shipper chỉ giữ một chuyến
// tại một thời điểm. Lộ trình của chuyến vẫn do phương án "deadline" của Dispatcher lập (xuất phát từ kho, không quay về).
bool alreadyTried(const Order& o, int si) { return std::find(o.tried.begin(), o.tried.end(), si) != o.tried.end(); }
void markTried(Order& o, int si) {
    if (si >= 0 && !alreadyTried(o, si)) o.tried.push_back(si);
}
// Khách đã chặn shipper này (không bao giờ ghép lại)
bool blockedFor(const Order& o, int si) { return !o.owner.empty() && S.prefs.isBlocked(o.owner, shipperNameOf(si)); }
// Shipper đang giữ quá nhiều tiền mặt thu hộ: không mời đơn phải thu tiền cho tới khi nộp bớt (hạn mức ví tiền mặt kiểu Grab)
bool codOverLimit(const Order& o, int si) {
    const long long limit = Commerce::config().codHoldLimit;
    if (limit <= 0) return false;
    const long long collect = orderCollect(o, feeFor(o));
    return collect > 0 && S.cod.held(shipperNameOf(si)) + collect > limit;
}

struct Approach {
    bool ok = false;
    std::vector<int> path;
    std::vector<double> times;   // phút (từ đầu ca) tới từng nút; nút đầu = giờ hiện tại của ca
    double minutes = 0, km = 0;
};

// Đường nhanh nhất từ nơi shipper đứng tới kho
Approach approachOf(int from, Vehicle v) {
    Approach a;
    if (from < 0 || !S.graph.hasNode(from) || !S.graph.hasNode(S.depot)) return a;
    const double clock = S.shift.clock();
    if (from == S.depot) {
        a.ok = true;
        a.path = {S.depot};
        a.times = {clock};
        return a;
    }
    const RushProfile* rush = rushPtr();
    ShortestPath::Options opt;
    opt.criterion = Criterion::TIME;
    opt.vehicle = v;
    opt.target = S.depot;
    opt.rush = rush;
    opt.departAt = rush ? S.shiftStart + clock : -1;
    auto tree = ShortestPath::dijkstra(S.graph, from, ShortestPath::Version::MIN_HEAP, opt);
    a.path = ShortestPath::getPath(tree, S.depot);
    if (a.path.empty()) return a;
    a.times.push_back(clock);
    double tm = 0;
    for (size_t i = 1; i < a.path.size(); ++i) {
        const Edge* e = S.graph.getEdge(a.path[i - 1], a.path[i]);
        tm += travelMinutesAt(*e, v, S.shiftStart + clock + tm, rush);
        a.km += e->distance;
        a.times.push_back(clock + tm);
    }
    a.minutes = tm;
    a.ok = true;
    return a;
}

struct Candidate {
    int shipper = -1;
    Approach ap;
    double score = 0;
    bool favorite = false;   // shipper khách yêu thích: được mời trước
};

// Shipper này có nhận được đơn không? Rỗng = được; ngược lại là lý do (hiện trên nút Nhận đơn / trong lỗi 409).
// busyCheck = false: bỏ qua việc shipper đang bận (dùng khi chỉ xét "còn ai có thể nhận đơn này không").
std::string claimBlock(const Order& o, int si, bool busyCheck = true) {
    if (S.shift.isAbsent(si)) return "Bạn đang được ghi nhận nghỉ đột xuất";
    if (!shipperReady(si)) return "Bạn đang tạm nghỉ. Hãy bật “Sẵn sàng” để nhận đơn";
    if (alreadyTried(o, si)) return "Bạn đã nhả đơn này";
    if (codOverLimit(o, si)) return "Bạn đang giữ quá nhiều tiền mặt thu hộ. Hãy nộp bớt rồi nhận đơn thu tiền";
    if (o.weight > S.shippers[si].capacity) return "Đơn nặng hơn tải trọng xe của bạn (" + std::to_string(static_cast<int>(S.shippers[si].capacity)) + " kg)";
    if (busyCheck && S.shift.busy(si, S.orders)) return "Hãy giao xong đơn đang cầm trước khi nhận đơn mới";
    return "";
}

// Đơn đang mở cho shipper nhận?
bool openForClaim(const Order& o) {
    return Commerce::config().autoMatch && S.graph.hasNode(S.depot) && o.status == PENDING && (o.createdAt > 0 || o.searchSince > 0);
}

// Còn shipper nào (kể cả đang bận) có thể nhận đơn này không?
bool anyoneLeft(const Order& o) {
    for (size_t i = 0; i < S.shippers.size(); ++i) {
        const int si = static_cast<int>(i);
        if (blockedFor(o, si)) continue;
        if (claimBlock(o, si, false).empty()) return true;
    }
    return false;
}

// Lập chuyến một đơn cho shipper `c.shipper` (đã nhận đơn nên chuyến vào thẳng "Đang giao" ở bước sau). false nếu xe của họ không giao nổi đơn.
bool buildClaimTrip(Order& o, const Candidate& c) {
    Pending pend;
    pend.orders.push_back(o);
    pend.idx.push_back(static_cast<int>(&o - &S.orders[0]));
    const double clock = S.shift.clock();
    DispatchReport rep = runDispatch(pend, S.shippers[c.shipper].vehicle, false, c.shipper, clock + c.ap.minutes);
    if (!rep.error.empty()) return false;
    const Plan* chosen = nullptr;
    for (const Plan& p : rep.multi)
        if (p.key == "deadline") chosen = &p;
    if (!chosen || chosen->skipped) return false;
    bool any = false;
    for (const Route& r : chosen->routes) any = any || !r.orders.empty();
    if (!any) return false;
    if (S.shift.apply(*chosen, pend.idx, S.orders, S.shippers, true, true) == 0) return false;
    Trip* t = S.shift.findTripMutable(S.shift.trips().back().id);
    t->offerUntil = 0;
    t->offerClock = clock;
    t->fromNode = c.ap.path.front();
    t->approach = c.ap.path;
    t->approachTimes = c.ap.times;
    t->note = "Nhận từ bảng đơn chờ (" + std::to_string(static_cast<int>(std::lround(c.ap.minutes))) + " phút tới kho)";
    o.noShipperAt = 0;
    mark(D_ORDERS);
    return true;
}

void notifyNoShipper(Order& o) {
    if (o.noShipperAt > 0) return;
    o.noShipperAt = nowSeconds();
    S.shift.log(S.shift.clock(), "no_shipper", o.id, -1, "");
    notify(o.owner, "order", o.id, "Chưa có shipper nhận đơn #" + std::to_string(o.id) + ". Bạn có thể bấm “Tìm lại” hoặc huỷ đơn.");
    mark(D_ORDERS);
}

// Báo đơn mới cho các shipper có thể nhận (mỗi lần đơn mở ra báo một lần). Không còn shipper nào nhận được thì báo khách.
// Trả về số đơn vừa được báo.
int matchPending() {
    if (!Commerce::config().autoMatch || !S.graph.hasNode(S.depot)) return 0;
    std::vector<int> ids;
    for (const Order& o : S.orders)
        if (openForClaim(o)) ids.push_back(o.id);   // đơn nhập từ file (chưa có giờ đặt) chờ quản trị viên phân công hoặc bấm “Tìm shipper”
    if (ids.empty()) return 0;
    std::stable_sort(ids.begin(), ids.end(), [](int a, int b) { return higherPriority(*findOrderById(a), *findOrderById(b)); });
    int n = 0;
    for (int id : ids) {
        Order* o = findOrderById(id);
        if (!o || o->status != PENDING) continue;
        if (!anyoneLeft(*o)) {
            notifyNoShipper(*o);
            continue;
        }
        if (o->opened) continue;
        o->opened = true;
        o->noShipperAt = 0;
        S.shift.log(S.shift.clock(), "opened", o->id, -1, "");
        for (size_t i = 0; i < S.shippers.size(); ++i) {
            const int si = static_cast<int>(i);
            if (blockedFor(*o, si) || !claimBlock(*o, si, false).empty()) continue;
            notify(accountOfShipper(S.shippers[i].name), "trip", o->id,
                   "Có đơn mới #" + std::to_string(o->id) + (o->category.empty() ? std::string() : " (" + std::string(Commerce::categoryName(o->category)) + ")") + (o->urgent ? " HOẢ TỐC" : "") +
                       " giao tới " + nodeName(o->destination) + ". Mở “Đơn chờ nhận” và bấm Nhận đơn: ai nhận trước thì giao.");
        }
        ++n;
    }
    return n;
}

// Gỡ lời mời chưa trả lời của một shipper (họ tắt "sẵn sàng" hoặc nghỉ đột xuất): đơn về hàng chờ, không tính là từ chối
void withdrawOffers(int si, const std::string& why) {
    std::vector<int> ids;
    for (const Trip& t : S.shift.trips())
        if (t.shipper == si && !t.accepted) ids.push_back(t.id);
    for (int tid : ids) {
        const Trip* t = S.shift.findTrip(tid);
        std::vector<int> orders;
        for (const TripStop& st : t->stops) orders.push_back(st.orderId);
        S.shift.decline(tid, S.orders, why);
        for (int oid : orders)
            if (Order* o = findOrderById(oid)) {
                o->searchSince = nowSeconds(); o->opened = false;
                logOrder("offer_withdrawn", *o, why);
            }
    }
    if (!ids.empty()) mark(D_ORDERS);
}

// Nhả đơn đã nhận liên tiếp quá missLimit lần (không giao xong đơn nào giữa các lần) thì shipper tự chuyển sang Tạm nghỉ:
// khách không phải chờ những shipper nhận rồi lại bỏ. Giao tới nơi một đơn hoặc tự bật lại "Sẵn sàng" thì đếm lại từ 0.
void noteMiss(int si) {
    const std::string name = shipperNameOf(si);
    if (name.empty()) return;
    const int limit = Commerce::config().missLimit;
    int n = ++S.missStreak[name];
    if (limit <= 0 || n < limit) return;
    S.missStreak[name] = 0;
    const std::string acc = accountOfShipper(name);
    const Auth::Account* a = acc.empty() ? nullptr : S.accounts.find(acc);
    if (!a || !a->ready) return;
    S.accounts.setReady(acc, false);
    mark(D_USERS);
    if (S.authed && S.me.username == acc) S.me = *S.accounts.find(acc);
    withdrawOffers(si, "Shipper tự chuyển sang tạm nghỉ");
    systemAudit("shipper.autopause", acc, std::to_string(limit) + " lần nhả đơn liên tiếp");
    notify(acc, "account", 0, "Bạn đã nhả đơn " + std::to_string(limit) +
                                  " lần liên tiếp nên được chuyển sang Tạm nghỉ để đơn tới khách nhanh hơn. Bật lại “Sẵn sàng” khi bạn muốn nhận đơn.");
}

// Chờ quá lâu mà không ai nhận: hệ thống tự huỷ đơn (miễn phí) và báo khách
void giveUpOrder(Order& o) {
    int to = 0;
    if (!Flow::check(o.status, "cancel", Flow::B_SYSTEM, &to).empty()) return;
    if (!S.shift.cancel(o.id, S.orders)) return;
    o.closedAt = nowSeconds();
    o.proofNote = "Hệ thống huỷ: không tìm được shipper";
    releasePromo(o);
    logOrder("gave_up", o, "");
    systemAudit("order.giveup", std::to_string(o.id), "không tìm được shipper");
    notify(o.owner, "order", o.id, "Đơn #" + std::to_string(o.id) + " đã tự huỷ vì không tìm được shipper (không mất phí). Bạn có thể đặt lại sau.");
    mark(D_ORDERS);
}

// Đồng hồ ca chạy tới phút t. Chế độ mô phỏng giao hàng thì đơn tới hạn tự giao.
int runClockTo(double t) {
    if (!Commerce::config().autoDeliver) {
        S.shift.advance(t);
        return 0;
    }
    std::vector<int> before;
    for (const Order& o : S.orders)
        if (o.status == ASSIGNED) before.push_back(o.id);
    int n = S.shift.progress(t, S.orders);
    for (int id : before) {
        Order* o = findOrderById(id);
        if (o && o->status == DELIVERED) onDelivered(*o);
    }
    if (n) matchPending();   // shipper vừa giao xong đã rảnh: có thể nhận đơn đang chờ
    return n;
}

// Chạy mỗi yêu cầu (trong wrap): đồng hồ ca nhích theo giờ thật, đơn chờ xác nhận quá hạn tự hoàn tất, đơn chờ quá lâu, báo đơn mới (tối đa 1 lần / 2 giây)
void liveTick() {
    const int64_t now = nowSeconds();
    const Commerce::Config& cfg = Commerce::config();
    if (S.lastTick == 0) S.lastTick = now;
    const int64_t dt = std::min<int64_t>(std::max<int64_t>(0, now - S.lastTick), 600);
    S.lastTick = now;
    if (cfg.clockSpeed > 0 && dt > 0 && S.shift.active()) runClockTo(S.shift.clock() + dt * cfg.clockSpeed / 60.0);
    autoCompleteArrived();   // người nhận không phản hồi quá hạn: đơn tự hoàn tất
    if (cfg.matchGiveUp > 0) {
        std::vector<int> stale;
        for (const Order& o : S.orders)
            if (o.status == PENDING && o.searchSince > 0 && now - o.searchSince >= static_cast<int64_t>(cfg.matchGiveUp) * 60) stale.push_back(o.id);
        for (int id : stale)
            if (Order* o = findOrderById(id)) giveUpOrder(*o);
    }
    if (now - S.lastMatch >= 2) {
        S.lastMatch = now;
        matchPending();
    }
}

// Khách bấm “Tìm lại”: xoá danh sách shipper đã nhả đơn, báo lại cho mọi shipper
Json retryOrder(const httplib::Request& r) {
    Order& o = orderForActor(integer(r, "id"));
    if (o.status != PENDING) throw Conflict("Chỉ tìm lại được shipper cho đơn đang ở 'Chờ giao' (đơn " + std::to_string(o.id) + " đang ở '" + orderStatusName(o.status) + "')");
    o.tried.clear();
    o.noShipperAt = 0;
    o.searchSince = nowSeconds(); o.opened = false;
    logOrder("retry", o, S.me.username);
    mark(D_ORDERS);
    audit("order.retry", std::to_string(o.id));
    int offers = matchPending();
    const Order& cur = *findOrderById(o.id);
    (void)cur;
    return stateJson().set("message", offers ? "Đã báo đơn " + std::to_string(o.id) + " cho các shipper đang sẵn sàng: ai nhận trước sẽ giao"
                                             : "Chưa có shipper nào nhận được, đơn " + std::to_string(o.id) + " vẫn nằm trên bảng đơn chờ nhận");
}

// Shipper nhả đơn đã nhận khi chưa lấy hàng (như tài xế Grab huỷ chuyến): đơn quay lại bảng đơn chờ nhận cho shipper khác
Json releaseOrder(const httplib::Request& r) {
    int id = integer(r, "id");
    Order& o = orderForActor(id);
    if (o.shipper != myShipperIndex()) throw Forbidden("Đơn " + std::to_string(id) + " không nằm trong chuyến của bạn");
    std::string why = Flow::check(o.status, "release", actorBit());
    if (!why.empty()) throw Conflict(why);
    if (pickedUp(o)) throw Conflict("Bạn đã lấy hàng nên không nhả đơn được nữa. Hãy giao hoặc báo giao thất bại.");
    std::string reason = trimmed(str(r, "reason"));
    if (reason.size() < 3) throw Invalid("Hãy nhập lý do nhả đơn", {{"reason", "Hãy nhập lý do (ít nhất 3 ký tự)"}});
    if (reason.size() > 150) throw Invalid("Lý do tối đa 150 ký tự", {{"reason", "Tối đa 150 ký tự"}});
    int ship = o.shipper;
    if (!S.shift.release(id, S.orders)) throw Conflict("Không nhả được đơn này");
    S.shift.dropEmptyAutoTrips();
    markTried(o, ship);
    o.noShipperAt = 0;
    o.searchSince = nowSeconds(); o.opened = false;
    ++S.stats.at(S.me.link).declines;
    noteMiss(ship);
    mark(D_STATS | D_ORDERS);
    logOrder("released", o, reason);
    audit("order.release", std::to_string(id), reason);
    notify(o.owner, "order", id, "Shipper " + S.me.link + " không thể giao đơn #" + std::to_string(id) + ", đơn đã được mở lại cho các shipper khác nhận");
    notifyStaff("order", id, S.me.link + " nhả đơn #" + std::to_string(id) + ": " + reason);
    matchPending();
    return stateJson().set("message", "Đã nhả đơn " + std::to_string(id) + ", đơn quay lại bảng đơn chờ nhận cho shipper khác");
}

// Quản trị viên thu hồi chuyến / lời mời shipper chưa nhận (shipper không phản hồi): đơn về Chờ giao, không tính là shipper từ chối
Json recallTrip(const httplib::Request& r) {
    int id = integer(r, "id");
    const Trip* t = S.shift.findTrip(id);
    if (!t) throw BadRequest("Không có chuyến " + std::to_string(id) + " (có thể lời mời đã hết hạn hoặc đã được thu hồi)");
    if (t->accepted) throw Conflict("Shipper đã nhận chuyến " + std::to_string(id) + ". Hãy báo shipper nghỉ đột xuất hoặc huỷ từng đơn nếu cần.");
    std::string reason = trimmed(str(r, "reason"));
    if (reason.size() < 3) throw Invalid("Hãy nhập lý do thu hồi", {{"reason", "Hãy nhập lý do (ít nhất 3 ký tự)"}});
    std::string ship = t->shipperName;
    std::vector<int> ids;
    for (const TripStop& st : t->stops) ids.push_back(st.orderId);
    int n = S.shift.decline(id, S.orders, "Thu hồi: " + TextUtil::utf8Prefix(reason, 150));
    if (n < 0) throw Conflict("Không thu hồi được chuyến " + std::to_string(id));
    mark(D_ORDERS);
    for (int oid : ids)
        if (Order* o = findOrderById(oid)) {
            o->searchSince = nowSeconds(); o->opened = false;
            logOrder("recalled", *o, reason);
        }
    audit("trip.recall", std::to_string(id), ship + ": " + reason);
    notify(accountOfShipper(ship), "trip", 0, "Chuyến #" + std::to_string(id) + " đã được quản trị viên thu hồi: " + reason);
    matchPending();
    return stateJson().set("message", "Đã thu hồi chuyến " + std::to_string(id) + " của " + ship + ": " + std::to_string(n) + " đơn trở về hàng chờ");
}

// Nhận chuyến (chuyến do quản trị viên phân công tay, hoặc chuyến vừa lập khi shipper bấm Nhận đơn)
Json acceptTripId(int id, bool claimed) {
    const Trip* t = S.shift.findTrip(id);
    if (!t) throw BadRequest("Không có chuyến " + std::to_string(id) + " (chuyến có thể đã bị thu hồi)");
    if (t->shipper != myShipperIndex()) throw Forbidden("Chuyến này không phải của bạn");
    std::vector<int> ids;
    for (const TripStop& s : t->stops) ids.push_back(s.orderId);
    const bool autoTrip = t->fromNode >= 0;
    int n = S.shift.accept(id, S.orders);
    if (n < 0) throw Conflict("Chuyến này đã được nhận rồi");
    ++S.stats.at(S.me.link).accepted;
    mark(D_STATS | D_ORDERS);
    for (int oid : ids)
        if (Order* o = findOrderById(oid)) {
            logOrder(claimed ? "claimed" : "accepted", *o, S.me.link);
            o->noShipperAt = 0;
            notify(o->owner, "order", oid, autoTrip ? S.me.link + " đã nhận đơn #" + std::to_string(oid) + " và đang tới kho lấy hàng"
                                                    : "Đơn #" + std::to_string(oid) + " đang được " + S.me.link + " giao tới bạn");
        }
    audit(claimed ? "order.claim" : "trip.accept", std::to_string(claimed && !ids.empty() ? ids.front() : id), std::to_string(n) + " đơn");
    return stateJson().set("message", "Đã nhận chuyến " + std::to_string(id) + " (" + std::to_string(n) + " đơn)");
}
Json acceptTrip(const httplib::Request& r) { return acceptTripId(integer(r, "id"), false); }

// Một đơn trên bảng "Đơn chờ nhận" của shipper đang đăng nhập
Json openOrderRow(const Order& o, int si, const Approach& ap) {
    const Pricing::Fee fee = feeFor(o);
    const std::string block = claimBlock(o, si);
    const int64_t since = o.searchSince > 0 ? o.searchSince : o.createdAt;
    return Json::object()
        .set("id", o.id)
        .set("category", o.category).set("categoryName", Commerce::categoryName(o.category))
        .set("weight", o.weight)
        .set("urgent", o.urgent)
        .set("deadline", o.deadline)
        .set("destination", o.destination)
        .set("destinationName", nodeName(o.destination))
        .set("cod", static_cast<double>(o.cod))
        .set("collect", static_cast<double>(orderCollect(o, fee)))
        .set("earn", static_cast<double>(shipperEarning(o, fee)))
        .set("waitSeconds", static_cast<double>(since > 0 ? std::max<int64_t>(0, nowSeconds() - since) : 0))
        .set("approachMinutes", ap.ok ? Json(ap.minutes) : Json())
        .set("favorite", !o.owner.empty() && S.prefs.isFavorite(o.owner, shipperNameOf(si)))
        .set("canClaim", block.empty() && ap.ok)
        .set("blockReason", block.empty() && !ap.ok ? Json("Không có đường từ chỗ bạn đang đứng tới kho") : block.empty() ? Json() : Json(block));
}

// GET /api/orders/open — bảng đơn chờ nhận của shipper: đơn gấp / hạn sớm trước, đơn của khách yêu thích bạn lên đầu
Json openOrdersJson(const httplib::Request&) {
    const int si = myShipperIndex();
    if (si < 0) throw Forbidden("Chỉ shipper mới xem được bảng đơn chờ nhận");
    Json arr = Json::array();
    const bool on = Commerce::config().autoMatch;
    if (on) {
        std::vector<const Order*> list;
        for (const Order& o : S.orders)
            if (openForClaim(o) && !blockedFor(o, si)) list.push_back(&o);
        std::stable_sort(list.begin(), list.end(), [si](const Order* a, const Order* b) {
            const bool fa = !a->owner.empty() && S.prefs.isFavorite(a->owner, shipperNameOf(si));
            const bool fb = !b->owner.empty() && S.prefs.isFavorite(b->owner, shipperNameOf(si));
            if (fa != fb) return fa;
            return higherPriority(*a, *b);
        });
        const Approach ap = approachOf(shipperNode(si), S.shippers[si].vehicle);   // cùng một điểm đứng cho mọi đơn: tính một lần
        for (const Order* o : list) arr.push(openOrderRow(*o, si, ap));
    }
    return Json::object().set("ok", true).set("enabled", on).set("orders", arr)
        .set("ready", shipperReady(si) && !S.shift.isAbsent(si)).set("busy", S.shift.busy(si, S.orders));
}

// POST /api/order/claim — shipper bấm Nhận đơn. Server xử lý từng yêu cầu một nên chỉ một shipper nhận được đơn;
// người bấm sau nhận lỗi 409 kèm lý do (đã có người nhận, khách vừa huỷ, ...).
Json claimOrder(const httplib::Request& r) {
    const int si = myShipperIndex();
    if (si < 0) throw Forbidden("Chỉ shipper mới nhận được đơn");
    const int id = integer(r, "id");
    Order* o = findOrderById(id);
    if (!o) throw Conflict("Đơn " + std::to_string(id) + " không còn tồn tại");
    if (o->status != PENDING) {
        if (o->status == ASSIGNED || o->status == DISPATCHED || o->status == ARRIVED || o->status == DELIVERED || o->status == FAILED || o->status == RETURNED)
            throw Conflict(o->shipper == si ? "Bạn đã nhận đơn " + std::to_string(id) + " rồi"
                                            : "Rất tiếc, đơn " + std::to_string(id) + " vừa được shipper khác nhận trước bạn");
        if (o->status == CANCELLED) throw Conflict("Đơn " + std::to_string(id) + " đã bị huỷ");
        throw Conflict("Đơn " + std::to_string(id) + " chưa mở để nhận (đang ở '" + orderStatusName(o->status) + "')");
    }
    if (!Commerce::config().autoMatch) throw Conflict("Quản trị viên đang phân công đơn thủ công, chưa mở nhận đơn tự do");
    if (!openForClaim(*o)) throw Conflict("Đơn " + std::to_string(id) + " chưa mở để nhận");
    if (blockedFor(*o, si)) throw Conflict("Đơn " + std::to_string(id) + " không dành cho bạn");
    std::string why = claimBlock(*o, si);
    if (!why.empty()) throw Conflict(why);
    Candidate c;
    c.shipper = si;
    c.ap = approachOf(shipperNode(si), S.shippers[si].vehicle);
    if (!c.ap.ok) throw Conflict("Không có đường từ chỗ bạn đang đứng tới kho lấy hàng");
    if (!buildClaimTrip(*o, c)) throw Conflict("Xe của bạn không giao được đơn " + std::to_string(id) + " (không tới được điểm giao hoặc quá tải)");
    const int tripId = S.shift.trips().back().id;
    Json res = acceptTripId(tripId, true);
    res.set("message", "Bạn đã nhận đơn " + std::to_string(id) + ". Hãy tới kho lấy hàng rồi giao tới " + nodeName(S.orders[static_cast<size_t>(o - &S.orders[0])].destination));
    return res;
}

Json declineTrip(const httplib::Request& r) {
    int id = integer(r, "id");
    const Trip* t = S.shift.findTrip(id);
    if (!t) throw BadRequest("Không có chuyến " + std::to_string(id) + " (lời mời có thể đã hết hạn hoặc bị thu hồi)");
    if (t->shipper != myShipperIndex()) throw Forbidden("Chuyến này không phải của bạn");
    std::string reason = trimmed(str(r, "reason"));
    if (reason.size() < 3) throw Invalid("Hãy nhập lý do từ chối", {{"reason", "Hãy nhập lý do (ít nhất 3 ký tự)"}});
    std::vector<int> ids;
    for (const TripStop& s : t->stops) ids.push_back(s.orderId);
    const bool autoOffer = t->fromNode >= 0;
    int n = S.shift.decline(id, S.orders, TextUtil::utf8Prefix(reason, 150));
    if (n < 0) throw Conflict("Chuyến đã được nhận, không từ chối được nữa");
    ++S.stats.at(S.me.link).declines;
    mark(D_STATS | D_ORDERS);
    const int me = myShipperIndex();
    for (int oid : ids)
        if (Order* o = findOrderById(oid)) {
            markTried(*o, me);   // đơn này không mời lại shipper đã từ chối
            o->searchSince = nowSeconds(); o->opened = false;
            logOrder("declined", *o, reason);
        }
    if (!Commerce::config().autoMatch) notifyStaff("trip", 0, S.me.link + " từ chối chuyến " + std::to_string(id) + ": " + reason + ". " + std::to_string(n) + " đơn trở lại hàng chờ.");
    audit("trip.decline", std::to_string(id), reason);
    if (autoOffer) noteMiss(me);
    matchPending();
    return stateJson().set("message", "Đã từ chối chuyến " + std::to_string(id));
}

Json shiftProgress(const httplib::Request& r) {
    double t = num(r, "t");
    if (t < 0) throw BadRequest("Thời điểm không hợp lệ");
    if (isShipper() && !Commerce::config().autoDeliver)
        throw Forbidden("Đồng hồ ca do quản trị viên quản lý; shipper hãy xác nhận từng đơn bằng mã giao hàng");
    if (!Commerce::config().autoDeliver) {
        // Chạy thật: đồng hồ chỉ nhích tới, shipper phải xác nhận từng đơn bằng mã
        runClockTo(t);
        return stateJson().set("delivered", 0).set("message", "Đồng hồ ca chạy tới phút " + std::to_string(static_cast<int>(t)) + ". Shipper cần xác nhận từng đơn bằng mã giao hàng.");
    }
    return stateJson().set("delivered", runClockTo(t));
}

Json shiftAbsent(const httplib::Request& r) {
    int i = integer(r, "index");
    if (i < 0 || i >= static_cast<int>(S.shippers.size())) throw BadRequest("Không có shipper này");
    if (S.shift.isAbsent(i)) throw Conflict(S.shippers[i].name + " đã được báo nghỉ");
    std::set<int> carried;
    for (const Order& o : S.orders)
        if (o.shipper == i && (o.status == ASSIGNED || o.status == DISPATCHED)) carried.insert(o.id);
    int n = S.shift.shipperAbsent(i, S.shippers[i].name, S.orders);
    S.shift.dropEmptyPendingTrips();
    for (int id : carried)
        if (Order* o = findOrderById(id); o && o->status == PENDING) {   // đơn quay về hàng chờ: tìm shipper khác, không mời lại người vừa nghỉ
            markTried(*o, i);
            o->noShipperAt = 0;
            o->searchSince = nowSeconds(); o->opened = false;
            notify(o->owner, "order", id, "Shipper phụ trách đơn #" + std::to_string(id) + " nghỉ đột xuất, hệ thống đang tìm shipper khác cho bạn");
        }
    mark(D_ORDERS);
    audit("shipper.absent", S.shippers[i].name, std::to_string(n) + " đơn trả về hàng chờ");
    notify(accountOfShipper(S.shippers[i].name), "trip", 0, "Bạn được ghi nhận nghỉ đột xuất, các đơn chưa giao đã trả về hàng chờ");
    int offers = matchPending();
    std::string msg = S.shippers[i].name + " nghỉ đột xuất";
    msg += n ? ": " + std::to_string(n) + " đơn chưa giao quay về hàng chờ" +
               (Commerce::config().autoMatch ? (offers ? ", hệ thống đã mời " + std::to_string(offers) + " đơn cho shipper khác" : ", hệ thống sẽ ghép cho shipper khác khi có người rảnh")
                                             : ", hãy điều phối lại cho người còn lại")
             : "";
    return stateJson().set("message", msg).set("returned", n);
}

// ------------------------------------------------------------ Sổ COD
Json codJson(const httplib::Request& r) {
    std::string only = isShipper() ? S.me.link : trimmed(str(r, "shipper"));
    std::set<std::string> names;
    for (const Shipper& s : S.shippers)
        if (only.empty() || s.name == only) names.insert(s.name);
    for (const Flow::CodEntry& e : S.cod.entries())
        if (only.empty() || e.shipper == only) names.insert(e.shipper);
    Json rows = Json::array();
    long long totalHeld = 0, totalAwait = 0;
    for (const std::string& name : names) {
        Json entries = Json::array(), rems = Json::array(), closes = Json::array();
        for (const Flow::CodEntry& e : S.cod.entries())
            if (e.shipper == name)
                entries.push(Json::object().set("id", e.id).set("order", e.order).set("amount", static_cast<double>(e.amount))
                                 .set("state", e.state).set("at", static_cast<double>(e.collectedAt)).set("remittance", e.remittance));
        for (const Flow::Remittance& m : S.cod.remittances())
            if (m.shipper == name)
                rems.push(Json::object().set("id", m.id).set("at", static_cast<double>(m.at)).set("expected", static_cast<double>(m.expected))
                              .set("handed", static_cast<double>(m.handed)).set("state", m.state).set("counted", static_cast<double>(m.counted))
                              .set("diff", static_cast<double>(m.diff())).set("note", m.note).set("confirmedBy", m.confirmedBy)
                              .set("settledAt", static_cast<double>(m.settledAt)).set("orders", static_cast<int>(m.entries.size())));
        for (const Flow::ShiftClose& c : S.cod.closes())
            if (c.shipper == name)
                closes.push(Json::object().set("id", c.id).set("at", static_cast<double>(c.at)).set("orders", c.orders)
                                .set("collected", static_cast<double>(c.collected)).set("counted", static_cast<double>(c.counted))
                                .set("diff", static_cast<double>(c.diff())).set("by", c.by));
        long long held = S.cod.held(name), await = S.cod.awaiting(name);
        totalHeld += held;
        totalAwait += await;
        rows.push(Json::object().set("shipper", name).set("held", static_cast<double>(held)).set("awaiting", static_cast<double>(await))
                      .set("entries", entries).set("remittances", rems).set("closes", closes));
    }
    return Json::object().set("ok", true).set("shippers", rows).set("held", static_cast<double>(totalHeld))
        .set("awaiting", static_cast<double>(totalAwait));
}

// ------------------------------------------------------------ Ví / sao kê đối soát của khách hàng
// Tiền thu hộ của đơn đã giao là "đang chờ" cho tới khi phiếu nộp COD chứa đơn đó được quản trị viên đối soát.
// Đơn giao xong mà không có bút toán COD (dữ liệu cũ) coi như đã đối soát.
Json complaintJson(const Support::Complaint& c, bool withMessages);

Billing::Statement statementOf(const std::string& customer, const std::vector<Pricing::Fee>& fees) {
    std::map<int, bool> settled;
    for (const Flow::CodEntry& e : S.cod.entries()) settled[e.order] = e.state == "settled";
    std::vector<Billing::OrderFacts> facts;
    for (size_t i = 0; i < S.orders.size(); ++i) {
        const Order& o = S.orders[i];
        if (o.owner != customer) continue;
        Billing::OrderFacts f;
        f.id = o.id;
        f.status = o.status;
        f.cod = o.cod;
        f.total = orderTotal(o, fees[i]);
        f.returnFee = o.returnFee;
        f.cancelFee = o.cancelFee;
        f.receiverPays = o.receiverPays;
        f.at = o.status == DELIVERED && o.deliveredReal ? o.deliveredReal : o.closedAt ? o.closedAt : o.createdAt;
        f.codSettled = !settled.count(o.id) || settled[o.id];
        facts.push_back(f);
    }
    return Billing::statement(facts, S.ledger.of(customer));
}

Json statementSummary(const Billing::Statement& st) {
    return Json::object().set("balance", static_cast<double>(st.balance)).set("pending", static_cast<double>(st.pending))
        .set("available", static_cast<double>(st.available)).set("codTotal", static_cast<double>(st.codTotal))
        .set("fees", static_cast<double>(st.fees)).set("comps", static_cast<double>(st.comps))
        .set("paidOut", static_cast<double>(st.paidOut)).set("collected", static_cast<double>(st.collected)).set("tips", static_cast<double>(st.tips));
}

Json walletJson(const std::string& customer) {
    Billing::Statement st = statementOf(customer, orderFees());
    Json lines = Json::array();
    for (const Billing::Line& l : st.lines)
        lines.push(Json::object().set("at", static_cast<double>(l.at)).set("kind", l.kind).set("order", l.order)
                       .set("amount", static_cast<double>(l.amount)).set("pending", l.pending).set("text", l.text)
                       .set("ref", l.ref).set("tx", l.tx));
    return statementSummary(st).set("ok", true).set("customer", customer).set("name", ownerDisplay(customer))
        .set("debtLimit", static_cast<double>(Commerce::config().debtLimit)).set("lines", lines);
}

const Auth::Account& customerAccount(const std::string& user) {
    const Auth::Account* a = S.accounts.find(user);
    if (!a || a->role != Auth::CUSTOMER) throw BadRequest("Không có tài khoản khách hàng '" + user + "'");
    return *a;
}

Json walletsJson() {
    std::vector<Pricing::Fee> fees = orderFees();
    Json rows = Json::array();
    long long owed = 0, debt = 0, pending = 0;
    for (const Auth::Account& a : S.accounts.all()) {
        if (a.role != Auth::CUSTOMER) continue;
        Billing::Statement st = statementOf(a.username, fees);
        if (st.lines.empty()) continue;
        rows.push(statementSummary(st).set("customer", a.username).set("name", a.displayName).set("lines", static_cast<int>(st.lines.size())));
        if (st.available > 0) owed += st.available;
        if (st.balance < 0) debt -= st.balance;
        pending += st.pending;
    }
    return Json::object().set("ok", true).set("customers", rows).set("owed", static_cast<double>(owed))
        .set("debt", static_cast<double>(debt)).set("pending", static_cast<double>(pending));
}

// Chi trả cho khách (không vượt quá số "có thể rút") hoặc ghi nhận khách nộp bù khi số dư âm
Json walletPayout(const httplib::Request& r) {
    std::string cust = lowerCopy(trimmed(str(r, "customer")));
    customerAccount(cust);
    std::string kind = str(r, "kind", "payout");
    if (kind != "payout" && kind != "collect") throw BadRequest("Loại giao dịch là payout (chi trả) hoặc collect (thu bù)");
    double amount = num(r, "amount", 0);
    if (!(amount > 0) || std::floor(amount) != amount || amount > 1000000000) throw Invalid("Số tiền phải là số nguyên lớn hơn 0", {{"amount", "Số tiền không hợp lệ"}});
    Billing::Statement st = statementOf(cust, orderFees());
    long long amt = static_cast<long long>(amount);
    if (kind == "payout" && amt > st.available)
        throw Conflict(st.available > 0 ? "Chỉ chi trả được tối đa " + money(st.available) + " (phần tiền thu hộ đã đối soát)"
                                        : "Khách chưa có tiền có thể rút (số dư khả dụng " + money(st.available) + ")");
    if (kind == "collect" && st.balance >= 0) throw Conflict("Khách không nợ: số dư hiện là " + money(st.balance));
    if (kind == "collect" && amt > -st.balance) throw Conflict("Khách chỉ nợ " + money(-st.balance));
    Billing::Tx tx;
    tx.kind = kind;
    tx.customer = cust;
    tx.amount = amt;
    tx.at = nowSeconds();
    tx.by = S.me.username;
    tx.method = str(r, "method", "bank");
    tx.ref = trimmed(str(r, "ref"));
    tx.note = trimmed(str(r, "note"));
    int id = 0;
    std::string e = S.ledger.add(tx, id);
    if (!e.empty()) throw Invalid(e, {{tx.ref.size() < 3 && tx.method == "bank" ? "ref" : "note", e}});
    mark(D_LEDGER);
    std::string what = kind == "payout" ? "Đã chi trả " + money(amt) + " cho " + ownerDisplay(cust) : "Đã ghi nhận " + ownerDisplay(cust) + " nộp bù " + money(amt);
    audit("wallet." + kind, cust, money(amt) + " " + tx.method + (tx.ref.empty() ? "" : " " + tx.ref));
    notify(cust, "wallet", 0, kind == "payout" ? "Bạn vừa được chi trả " + money(amt) + (tx.method == "bank" ? " (chuyển khoản " + tx.ref + ")" : " (tiền mặt)")
                                               : "Đã nhận khoản nộp bù " + money(amt) + ". Cảm ơn bạn!");
    return walletJson(cust).set("message", what);
}

// Bồi thường khiếu nại vào ví đối soát. Mỗi khiếu nại bồi thường một lần, có trần theo loại (Billing::compensationCap).
long long compensationCapOf(const Order& o, const std::string& kind) {
    return Billing::compensationCap(kind, o.declaredValue, orderTotal(o, feeFor(o)), Commerce::config().compMultiplier);
}
std::string compensationBlock(const Order& o, const std::string& kind) {
    if (kind == "late") {
        if (o.status != DELIVERED || o.deadline < 0 || o.deliveredAt <= o.deadline + 1e-9) return "Đơn không giao trễ hạn nên không bồi thường trễ hạn";
    } else if (kind == "damaged" || kind == "lost") {
        if (o.status != ASSIGNED && o.status != ARRIVED && o.status != DELIVERED && o.status != FAILED && o.status != RETURNED)
            return "Hàng chưa rời kho (đơn đang '" + std::string(orderStatusName(o.status)) + "') nên chưa thể hư hỏng / thất lạc";
    } else if (kind != "other") {
        return "Loại bồi thường không hợp lệ";
    }
    return "";
}
Json compensate(const httplib::Request& r) {
    int id = integer(r, "id");
    const Support::Complaint* c = S.complaints.find(id);
    if (!c) throw BadRequest("Không có khiếu nại " + std::to_string(id));
    if (S.ledger.ofComplaint(id)) throw Conflict("Khiếu nại #" + std::to_string(id) + " đã được bồi thường");
    Order* o = findOrderById(c->order);
    if (!o) throw Conflict("Đơn #" + std::to_string(c->order) + " của khiếu nại không còn trong hệ thống");
    if (o->owner != c->owner) throw Conflict("Đơn #" + std::to_string(o->id) + " không còn thuộc khách gửi khiếu nại");
    std::string kind = str(r, "kind");
    std::string block = compensationBlock(*o, kind);
    if (!block.empty()) throw Invalid(block, {{"kind", block}});
    long long cap = compensationCapOf(*o, kind);
    double amount = num(r, "amount", 0);
    if (!(amount > 0) || std::floor(amount) != amount) throw Invalid("Số tiền bồi thường phải là số nguyên lớn hơn 0", {{"amount", "Số tiền không hợp lệ"}});
    if (amount > cap) throw Invalid("Bồi thường " + std::string(Billing::compensationKindName(kind)) + " tối đa " + money(cap), {{"amount", "Tối đa " + money(cap)}});
    std::string note = trimmed(str(r, "note"));
    Billing::Tx tx;
    tx.kind = "comp";
    tx.customer = c->owner;
    tx.amount = static_cast<long long>(amount);
    tx.at = nowSeconds();
    tx.by = S.me.username;
    tx.order = o->id;
    tx.complaint = id;
    tx.note = std::string(Billing::compensationKindName(kind)) + (note.empty() ? "" : ": " + note);
    int txId = 0;
    std::string e = S.ledger.add(tx, txId);
    if (!e.empty()) throw Invalid(e, {{"note", e}});
    mark(D_LEDGER);
    if (S.complaints.addMessage(id, S.me.username, Auth::roleKey(S.me.role), "Đã bồi thường " + money(tx.amount) + " vào ví đối soát (" + tx.note + ")", tx.at).empty())
        mark(D_COMPL);
    audit("complaint.compensate", std::to_string(id), money(tx.amount) + " " + kind + ", đơn " + std::to_string(o->id));
    notify(c->owner, "wallet", o->id, "Khiếu nại #" + std::to_string(id) + ": bạn được bồi thường " + money(tx.amount) + " vào ví đối soát");
    return Json::object().set("ok", true).set("complaint", complaintJson(*S.complaints.find(id), true))
        .set("message", "Đã bồi thường " + money(tx.amount) + " cho khiếu nại #" + std::to_string(id));
}

// ------------------------------------------------------------ Khiếu nại
Json complaintJson(const Support::Complaint& c, bool withMessages) {
    Json j = Json::object().set("id", c.id).set("owner", c.owner).set("ownerName", ownerDisplay(c.owner)).set("order", c.order)
                 .set("title", c.title).set("status", c.status).set("statusName", Support::complaintStatusName(c.status))
                 .set("created", static_cast<double>(c.created)).set("updated", static_cast<double>(c.updated))
                 .set("assignee", c.assignee).set("messageCount", static_cast<int>(c.msgs.size()));
    const Billing::Tx* comp = S.ledger.ofComplaint(c.id);
    j.set("compensation", comp ? Json::object().set("amount", static_cast<double>(comp->amount)).set("note", comp->note)
                                     .set("by", comp->by).set("at", static_cast<double>(comp->at))
                               : Json());
    if (withMessages && isStaff() && !comp) {   // trần bồi thường theo từng loại, để giao diện gợi ý
        if (const Order* o = findOrderById(c.order)) {
            Json caps = Json::object();
            for (const char* k : {"late", "damaged", "lost", "other"})
                caps.set(k, compensationBlock(*o, k).empty() ? Json(static_cast<double>(compensationCapOf(*o, k))) : Json());
            j.set("compCaps", caps).set("orderValue", static_cast<double>(o->declaredValue));
        }
    }
    if (withMessages) {
        Json ms = Json::array();
        for (const Support::ComplaintMsg& m : c.msgs)
            ms.push(Json::object().set("at", static_cast<double>(m.at)).set("author", m.author).set("authorName", ownerDisplay(m.author))
                        .set("role", m.role).set("text", m.text));
        j.set("messages", ms);
    }
    return j;
}
const Support::Complaint& complaintForActor(int id) {
    const Support::Complaint* c = S.complaints.find(id);
    if (!c && !isCustomer()) throw BadRequest("Không có khiếu nại " + std::to_string(id));
    if (!c || (isCustomer() && c->owner != S.me.username)) throw Forbidden("Khiếu nại này không phải của bạn");
    return *c;
}
Json complaintsListJson(const httplib::Request& r) {
    std::vector<const Support::Complaint*> rows;
    for (const Support::Complaint& c : S.complaints.all())
        if (isStaff() || c.owner == S.me.username) rows.push_back(&c);
    std::map<std::string, int> byStatus;
    for (const auto* c : rows) ++byStatus[c->status];
    std::string st = lowerCopy(trimmed(str(r, "status")));
    if (!st.empty()) rows.erase(std::remove_if(rows.begin(), rows.end(), [&](const Support::Complaint* c) { return c->status != st; }), rows.end());
    std::string q = trimmed(str(r, "q"));
    if (!q.empty()) {
        TextIndex idx;
        for (size_t i = 0; i < rows.size(); ++i)
            idx.add(static_cast<int>(i), std::to_string(rows[i]->id) + " " + std::to_string(rows[i]->order) + " " + rows[i]->title + " " + rows[i]->owner + " " + ownerDisplay(rows[i]->owner));
        std::set<int> hit;
        for (int i : idx.search(q)) hit.insert(i);
        std::vector<const Support::Complaint*> kept;
        for (size_t i = 0; i < rows.size(); ++i)
            if (hit.count(static_cast<int>(i))) kept.push_back(rows[i]);
        rows = kept;
    }
    std::string key = sortKey(r, {"updated", "created", "status", "id"}, "updated");
    bool desc = sortDesc(r, true);
    std::stable_sort(rows.begin(), rows.end(), [&](const Support::Complaint* a, const Support::Complaint* b) {
        int64_t c = key == "created" ? a->created - b->created : key == "status" ? a->status.compare(b->status) : key == "id" ? a->id - b->id : a->updated - b->updated;
        return desc ? c > 0 : c < 0;
    });
    PageInfo p = paginate(r, rows.size());
    Json arr = Json::array();
    for (size_t i = p.begin; i < p.end; ++i) arr.push(complaintJson(*rows[i], false));
    Json bs = Json::object();
    for (const auto& kv : byStatus) bs.set(kv.first, kv.second);
    return Json::object().set("ok", true).set("complaints", arr).set("page", pageJson(p)).set("byStatus", bs);
}

// ------------------------------------------------------------ Thông báo
Json notificationsJson(const httplib::Request& r) {
    bool unreadOnly = flag(r, "unread");
    Json arr = Json::array();
    int n = 0, limit = std::clamp(integer(r, "limit", 30), 1, 100);
    for (const Support::Notification* x : S.notes.of(S.me.username, unreadOnly)) {
        if (++n > limit) break;
        arr.push(Json::object().set("id", x->id).set("at", static_cast<double>(x->at)).set("read", x->read).set("kind", x->kind)
                     .set("order", x->order).set("text", x->text));
    }
    return Json::object().set("ok", true).set("notifications", arr).set("unread", S.notes.unread(S.me.username));
}

// ------------------------------------------------------------ Cấu hình
Json updateConfig(const httplib::Request& r) {
    Commerce::Config cfg = Commerce::config();
    Pricing::Tariff t = Pricing::tariff();
    auto setNum = [&](const char* k, double& v) { if (has(r, k) && !str(r, k).empty()) v = num(r, k); };
    setNum("firstKm", t.firstKm); setNum("firstFee", t.firstFee); setNum("perKm", t.perKm); setNum("freeKg", t.freeKg);
    setNum("perKg", t.perKg); setNum("urgent", t.urgent); setNum("codRate", t.codRate); setNum("codMin", t.codMin);
    setNum("returnRate", t.returnRate);
    setNum("cancelDispatched", cfg.cancelDispatched); setNum("cancelOnRoute", cfg.cancelOnRoute); setNum("shipperShare", cfg.shipperShare);
    if (has(r, "maxOpenOrders")) cfg.maxOpenOrders = integer(r, "maxOpenOrders");
    setNum("insRate", cfg.insRate); setNum("compMultiplier", cfg.compMultiplier);
    if (has(r, "insThreshold") && !str(r, "insThreshold").empty()) cfg.insThreshold = static_cast<long long>(num(r, "insThreshold"));
    if (has(r, "volDivisor") && !str(r, "volDivisor").empty()) cfg.volDivisor = integer(r, "volDivisor");
    if (has(r, "debtLimit") && !str(r, "debtLimit").empty()) cfg.debtLimit = static_cast<long long>(num(r, "debtLimit"));
    if (has(r, "scoreAware")) cfg.scoreAware = flag(r, "scoreAware");
    if (has(r, "autoDeliver")) cfg.autoDeliver = flag(r, "autoDeliver");
    if (has(r, "autoMatch")) cfg.autoMatch = flag(r, "autoMatch");
    if (has(r, "offerSeconds")) cfg.offerSeconds = integer(r, "offerSeconds");
    if (has(r, "matchGiveUp")) cfg.matchGiveUp = integer(r, "matchGiveUp");
    if (has(r, "clockSpeed")) cfg.clockSpeed = num(r, "clockSpeed");
    if (has(r, "missLimit") && !str(r, "missLimit").empty()) cfg.missLimit = integer(r, "missLimit");
    if (has(r, "codHoldLimit") && !str(r, "codHoldLimit").empty()) cfg.codHoldLimit = static_cast<long long>(num(r, "codHoldLimit"));
    if (has(r, "tipMax") && !str(r, "tipMax").empty()) cfg.tipMax = static_cast<long long>(num(r, "tipMax"));
    if (has(r, "autoConfirmMinutes") && !str(r, "autoConfirmMinutes").empty()) cfg.autoConfirmMinutes = integer(r, "autoConfirmMinutes");
    if (has(r, "tiers")) {   // "Đồng:0:0,Bạc:5:0.03,..." (tên:số đơn tối thiểu:phần trăm giảm dạng thập phân)
        std::vector<Commerce::Tier> tiers;
        std::stringstream ss(str(r, "tiers"));
        std::string item;
        while (std::getline(ss, item, ',')) {
            std::stringstream is(item);
            std::string name, a, b;
            if (!std::getline(is, name, ':') || !std::getline(is, a, ':') || !std::getline(is, b, ':')) throw BadRequest("Hạng thân thiết phải có dạng tên:số đơn:phần trăm");
            Commerce::Tier x;
            x.name = trimmed(name);
            try { x.minDone = std::stoi(a); x.pct = std::stod(b); } catch (...) { throw BadRequest("Số liệu hạng thân thiết không hợp lệ"); }
            tiers.push_back(x);
        }
        cfg.tiers = tiers;
    }
    std::string e = Pricing::checkTariff(t);
    if (e.empty()) e = cfg.check();
    if (!e.empty()) throw BadRequest(e);
    Commerce::config() = cfg;
    Pricing::tariff() = t;
    mark(D_CONFIG);
    audit("config.update", "config", "biểu phí / hạng / quy tắc");
    matchPending();   // vừa bật ghép tự động: các đơn đang chờ được mời ngay
    return configJson().set("ok", true).set("message", "Đã lưu cấu hình");
}

// ------------------------------------------------------------ Báo cáo theo vai trò
// Việc cần xử lý của nhân viên: mỗi mục có mức độ (danger / warn / info), số lượng, mã đơn ví dụ và trang cần mở
Json alertsJson(const std::vector<Pricing::Fee>& fees) {
    int64_t now = nowSeconds();
    Json arr = Json::array();
    auto add = [&](const char* level, const char* kind, const std::string& text, const std::vector<int>& ids, const char* view) {
        if (ids.empty()) return;
        Json sample = Json::array();
        for (size_t i = 0; i < ids.size() && i < 5 && std::string(kind) != "debt"; ++i) sample.push(ids[i]);
        arr.push(Json::object().set("level", level).set("kind", kind).set("count", static_cast<int>(ids.size()))
                     .set("text", text).set("ids", sample).set("view", view));
    };
    double cap = 0;
    for (size_t i = 0; i < S.shippers.size(); ++i)
        if (!S.shift.isAbsent(static_cast<int>(i))) cap = std::max(cap, S.shippers[i].capacity);
    std::vector<int> lateRisk, stale, failed, urgent, heavy, awaiting, disputed;
    for (const Order& o : S.orders) {
        if (o.status == ASSIGNED && o.deadline >= 0 && o.eta > o.deadline + 1e-9) lateRisk.push_back(o.id);
        if (o.status == CREATED && o.createdAt > 0 && now - o.createdAt > 30 * 60) stale.push_back(o.id);
        if (o.status == FAILED) failed.push_back(o.id);
        if (o.status == ARRIVED) awaiting.push_back(o.id);
        if (o.status == ASSIGNED && o.disputes > 0) disputed.push_back(o.id);
        if (o.status == PENDING && o.urgent) urgent.push_back(o.id);
        if (o.status == PENDING && cap > 0 && o.weight > cap + 1e-9) heavy.push_back(o.id);
    }
    std::vector<int> waitingTrips;
    for (const Trip& t : S.shift.trips())
        if (!t.accepted) waitingTrips.push_back(t.id);
    std::vector<int> remits, oldComplaints, debtors;
    for (const Flow::Remittance& m : S.cod.remittances())
        if (m.state == "submitted") remits.push_back(m.id);
    for (const Support::Complaint& c : S.complaints.all())
        if (c.status != "resolved" && now - c.created > 24 * 3600) oldComplaints.push_back(c.id);
    int idx = 0;
    for (const Auth::Account& a : S.accounts.all()) {
        if (a.role != Auth::CUSTOMER) continue;
        ++idx;
        if (statementOf(a.username, fees).balance < 0) debtors.push_back(idx);
    }
    add("danger", "late", "đơn đang giao dự kiến trễ hạn", lateRisk, "tracking");
    add("warn", "failed", "đơn giao thất bại chờ quyết định giao lại / hoàn kho", failed, "queue");
    add("warn", "stale", "đơn mới chờ xác nhận quá 30 phút", stale, "queue");
    add("warn", "heavy", "đơn nặng hơn mọi xe đang có mặt, cần chia kiện", heavy, "queue");
    add("warn", "disputed", "đơn người nhận báo chưa nhận được hàng dù shipper đã giao tới", disputed, "tracking");
    add("info", "awaiting", "đơn shipper đã giao tới, chờ người nhận xác nhận", awaiting, "tracking");
    add("info", "urgent", "đơn hoả tốc đang chờ shipper nhận", urgent, "dispatch");
    add("info", "trips", "chuyến chờ shipper nhận", waitingTrips, "tracking");
    add("info", "remit", "phiếu nộp COD chờ đối soát", remits, "cod");
    add("warn", "complaints", "khiếu nại mở quá 24 giờ", oldComplaints, "complaints");
    add("info", "debt", "khách hàng đang nợ phí (số dư âm)", debtors, "wallet");
    return arr;
}

// Doanh thu 14 ngày gần nhất theo ngày giao xong (giờ Việt Nam, UTC+7)
Json dailyJson(const std::vector<Pricing::Fee>& fees) {
    const int64_t DAY = 86400, TZ = 7 * 3600;
    int64_t today = (nowSeconds() + TZ) / DAY;
    std::map<int64_t, std::array<long long, 3>> by;   // ngày -> {số đơn, doanh thu, thu hộ}
    for (size_t i = 0; i < S.orders.size(); ++i) {
        const Order& o = S.orders[i];
        if (o.status != DELIVERED || o.deliveredReal <= 0) continue;
        int64_t d = (o.deliveredReal + TZ) / DAY;
        if (d <= today - 14 || d > today) continue;
        auto& v = by[d];
        v[0] += 1;
        v[1] += orderTotal(o, fees[i]);
        v[2] += o.cod;
    }
    Json arr = Json::array();
    for (int64_t d = today - 13; d <= today; ++d) {
        std::array<long long, 3> v = by.count(d) ? by[d] : std::array<long long, 3>{0, 0, 0};
        arr.push(Json::object().set("day", static_cast<double>(d * DAY - TZ)).set("delivered", static_cast<int>(v[0]))
                     .set("revenue", static_cast<double>(v[1])).set("cod", static_cast<double>(v[2])));
    }
    return arr;
}

Json reportJson() {
    std::vector<Pricing::Fee> fees = orderFees();
    Json j = Json::object().set("ok", true).set("role", Auth::roleKey(S.me.role));
    std::map<int, int> byStatus;
    long long revenue = 0, discounts = 0, cancelFees = 0, codTotal = 0, insurance = 0, returnFees = 0;
    int late = 0, deliveredCount = 0;
    for (size_t i = 0; i < S.orders.size(); ++i) {
        const Order& o = S.orders[i];
        if (isCustomer() && o.owner != S.me.username) continue;
        if (isShipper() && !shipperSees(o, myShipperIndex())) continue;
        ++byStatus[o.status];
        if (o.status == DELIVERED) {
            ++deliveredCount;
            revenue += orderTotal(o, fees[i]);
            insurance += o.insuranceFee;
            discounts += o.loyaltyDiscount + o.promoDiscount;
            codTotal += o.cod;
            if (o.deadline >= 0 && o.deliveredAt > o.deadline + 1e-9) ++late;
        }
        cancelFees += o.cancelFee;
        returnFees += o.returnFee;
    }
    Json bs = Json::object();
    for (const auto& kv : byStatus) bs.set(orderStatusName(kv.first), kv.second);
    j.set("byStatus", bs).set("delivered", deliveredCount).set("late", late)
        .set("onTimeRate", deliveredCount ? 100.0 * (deliveredCount - late) / deliveredCount : 100.0);
    if (isCustomer()) {
        j.set("spent", static_cast<double>(revenue)).set("saved", static_cast<double>(discounts)).set("tier", tierJson(S.me.done))
            .set("orders", static_cast<int>(std::count_if(S.orders.begin(), S.orders.end(), [](const Order& o) { return o.owner == S.me.username; })))
            .set("wallet", statementSummary(statementOf(S.me.username, fees)));
    } else if (isShipper()) {
        j.set("stats", shipperStatsJson(S.me.link));
    } else {
        int open = 0;
        for (const auto& kv : byStatus) open += isOpenStatus(kv.first) ? kv.second : 0;
        j.set("open", open).set("codHeld", static_cast<double>(S.cod.held("")))
            .set("complaintsOpen", static_cast<int>(std::count_if(S.complaints.all().begin(), S.complaints.all().end(), [](const Support::Complaint& c) { return c.status != "resolved"; })));
        long long held = 0, awaiting = 0;
        for (const Shipper& s : S.shippers) { held += S.cod.held(s.name); awaiting += S.cod.awaiting(s.name); }
        j.set("codHeld", static_cast<double>(held)).set("codAwaiting", static_cast<double>(awaiting));
        Json ships = Json::array();
        for (const Shipper& s : S.shippers) {
            Commerce::ShipperStat st = S.stats.get(s.name);
            ships.push(Json::object().set("name", s.name).set("delivered", st.delivered).set("failed", st.failed).set("declines", st.declines)
                           .set("score", shipperScore(s.name)).set("income", static_cast<double>(st.income)).set("ready", shipperReady(static_cast<int>(&s - &S.shippers[0]))));
        }
        j.set("shippers", ships).set("alerts", alertsJson(fees));
        if (isAdmin()) {
            j.set("revenue", static_cast<double>(revenue)).set("discounts", static_cast<double>(discounts))
                .set("cancelFees", static_cast<double>(cancelFees)).set("codTotal", static_cast<double>(codTotal))
                .set("insurance", static_cast<double>(insurance)).set("returnFees", static_cast<double>(returnFees))
                .set("daily", dailyJson(fees));
            Json roles = Json::object(), stat = Json::object();
            std::map<std::string, int> rc, sc;
            for (const Auth::Account& a : S.accounts.all()) { ++rc[Auth::roleKey(a.role)]; ++sc[Auth::statusKey(a.status)]; }
            for (const auto& kv : rc) roles.set(kv.first, kv.second);
            for (const auto& kv : sc) stat.set(kv.first, kv.second);
            j.set("users", Json::object().set("byRole", roles).set("byStatus", stat));
            std::vector<std::pair<long long, std::string>> top;
            for (const Auth::Account& a : S.accounts.all())
                if (a.role == Auth::CUSTOMER && a.done > 0) top.push_back({a.spent, a.displayName});
            std::sort(top.rbegin(), top.rend());
            Json tops = Json::array();
            for (size_t i = 0; i < top.size() && i < 5; ++i) tops.push(Json::object().set("name", top[i].second).set("spent", static_cast<double>(top[i].first)));
            j.set("topCustomers", tops);
            Json promos = Json::array();
            for (const Commerce::Promo& p : S.promos.all()) promos.push(Json::object().set("code", p.code).set("used", p.used).set("maxUses", p.maxUses));
            j.set("promos", promos);
        }
    }
    return j;
}

// ------------------------------------------------------------ Nghiệp vụ kiểu Grab: tiền tip, trò chuyện, shipper yêu thích / bị chặn
// Tiền tip: khách tặng shipper sau khi đơn giao thành công (một lần mỗi đơn, trong 7 ngày). Shipper nhận 100%, khoản tip trừ vào
// ví đối soát của khách (như cước người gửi trả); số dư âm sau khi tip không được vượt hạn mức nợ phí.
Json tipOrder(const httplib::Request& r) {
    Order& o = orderForActor(integer(r, "id"));
    if (o.owner != S.me.username) throw Forbidden("Đơn " + std::to_string(o.id) + " không thuộc quyền xem của bạn");
    const Commerce::Config& cfg = Commerce::config();
    if (cfg.tipMax <= 0) throw Conflict("Tính năng tip đang tắt");
    if (o.status != DELIVERED) throw Conflict("Chỉ tip được cho đơn đã giao thành công");
    const std::string ship = shipperNameOf(o.shipper);
    if (ship.empty()) throw Conflict("Đơn này không có shipper để nhận tip");
    if (S.ledger.tipOf(o.id)) throw Conflict("Bạn đã tip cho đơn này rồi");
    const int64_t now = nowSeconds();
    if (o.deliveredReal > 0 && now - o.deliveredReal > TIP_WINDOW) throw Conflict("Chỉ tip được trong 7 ngày sau khi giao");
    double amount = num(r, "amount", 0);
    if (std::floor(amount) != amount || amount < 1000 || amount > static_cast<double>(cfg.tipMax) || static_cast<long long>(amount) % 1000 != 0)
        throw Invalid("Tiền tip từ 1.000 đ đến " + money(cfg.tipMax) + ", bội số 1.000 đ", {{"amount", "Từ 1.000 đ đến " + money(cfg.tipMax)}});
    const long long tip = static_cast<long long>(amount);
    if (cfg.debtLimit > 0) {
        long long after = statementOf(o.owner, orderFees()).balance - tip;
        if (-after > cfg.debtLimit)
            throw Conflict("Ví của bạn không đủ để tip " + money(tip) + ": số dư sau khi tip là " + money(after) + ", vượt hạn mức nợ " + money(cfg.debtLimit) + ".");
    }
    std::string note = trimmed(str(r, "note"));
    if (note.size() > 300) throw Invalid("Lời nhắn tối đa 100 ký tự", {{"note", "Tối đa 100 ký tự"}});
    Billing::Tx tx;
    tx.kind = "tip";
    tx.customer = o.owner;
    tx.amount = tip;
    tx.at = now;
    tx.by = S.me.username;
    tx.order = o.id;
    tx.ref = ship;
    tx.note = note;
    int txId = 0;
    std::string e = S.ledger.add(tx, txId);
    if (!e.empty()) throw BadRequest(e);
    mark(D_LEDGER | D_ORDERS);
    audit("order.tip", std::to_string(o.id), money(tip) + " cho " + ship);
    notify(accountOfShipper(ship), "order", o.id, "Khách " + S.me.displayName + " tip " + money(tip) + " cho đơn #" + std::to_string(o.id) +
                                                      (tx.note.empty() ? "" : ": “" + tx.note + "”"));
    return stateJson().set("message", "Đã tip " + money(tip) + " cho " + ship + ". Cảm ơn bạn!");
}

// Trò chuyện trong đơn: khách (chủ đơn), shipper đang giữ đơn và quản trị viên (tổng đài) cùng xem. Gửi được khi đơn đang giao
// hoặc giao thất bại chờ xử lý; đơn kết thúc thì chỉ còn đọc. Chống spam 20 tin / phút mỗi người.
Order& chatOrder(int id) {
    Order& o = orderForActor(id);
    if (isShipper() && o.shipper != myShipperIndex()) throw Forbidden("Đơn " + std::to_string(id) + " không do bạn giao");
    if (isCustomer() && o.owner != S.me.username) throw Forbidden("Đơn " + std::to_string(id) + " không thuộc quyền xem của bạn");
    return o;
}

Json chatJson(const Order& o) {
    Json arr = Json::array();
    for (const Commerce::ChatMessage* m : S.chat.of(o.id)) {
        std::string who;
        if (m->role == 'A') who = "Tổng đài";
        else if (m->role == 'S') {
            const Auth::Account* a = S.accounts.find(m->from);
            who = a ? (a->link.empty() ? a->displayName : a->link) : "Shipper";
        } else who = ownerDisplay(m->from);
        arr.push(Json::object().set("id", m->id).set("at", static_cast<double>(m->at)).set("role", std::string(1, m->role))
                     .set("who", who).set("mine", m->from == S.me.username).set("text", m->text));
    }
    Json quick = Json::array();
    if (isCustomer())
        for (const char* q : {"Bạn tới chưa ạ?", "Mình đang xuống ngay", "Gọi mình khi tới nhé", "Để hàng ở bảo vệ giúp mình", "Cảm ơn bạn!"}) quick.push(q);
    else if (isShipper())
        for (const char* q : {"Mình đã lấy hàng, đang tới", "Mình tới rồi, bạn ra nhận giúp", "Đường kẹt, mình tới trễ vài phút", "Mình không gọi được bạn", "Cảm ơn bạn!"}) quick.push(q);
    return Json::object().set("ok", true).set("order", o.id).set("open", chatOpen(o)).set("messages", arr).set("quick", quick)
        .set("shipper", o.shipper >= 0 ? Json(shipperNameOf(o.shipper)) : Json()).set("customer", o.owner.empty() ? Json() : Json(ownerDisplay(o.owner)));
}

Json chatSend(const httplib::Request& r) {
    Order& o = chatOrder(integer(r, "id"));
    if (!chatOpen(o)) {
        if (o.owner.empty()) throw Conflict("Đơn do quản trị viên tạo, không có tài khoản khách để nhắn tin");
        throw Conflict(o.status == DELIVERED || o.status == RETURNED || o.status == CANCELLED
                           ? "Đơn đã kết thúc, cuộc trò chuyện chỉ còn để xem"
                           : "Chỉ nhắn tin được khi shipper đã nhận đơn");
    }
    const int64_t now = nowSeconds();
    if (!S.limiter.allow("chat:" + S.me.username, now, 20, 60))
        throw TooMany("Bạn gửi tin quá nhanh, hãy đợi một chút", S.limiter.retryAfter("chat:" + S.me.username, now, 60));
    Commerce::ChatMessage m;
    m.order = o.id;
    m.at = now;
    m.from = S.me.username;
    m.role = isCustomer() ? 'C' : isShipper() ? 'S' : 'A';
    m.text = str(r, "text");
    int mid = 0;
    std::string e = S.chat.add(m, mid);
    if (!e.empty()) throw Invalid(e, {{"text", e}});
    mark(D_CHAT);
    const std::string shipAcc = accountOfShipper(shipperNameOf(o.shipper));
    const std::string preview = TextUtil::utf8Prefix(S.chat.of(o.id).back()->text, 60);
    if (m.role != 'C') notify(o.owner, "chat", o.id, (m.role == 'S' ? S.me.link : std::string("Tổng đài")) + " nhắn về đơn #" + std::to_string(o.id) + ": " + preview);
    if (m.role != 'S') notify(shipAcc, "chat", o.id, (m.role == 'C' ? S.me.displayName : std::string("Tổng đài")) + " nhắn về đơn #" + std::to_string(o.id) + ": " + preview);
    return chatJson(o).set("message", "Đã gửi");
}

// Shipper yêu thích / bị chặn: khách chỉ chọn được shipper đã từng nhận đơn của mình.
// Yêu thích -> được mời trước khi rảnh và đủ điều kiện; chặn -> không bao giờ được ghép cho khách này nữa.
std::vector<std::string> shippersServed(const std::string& customer) {
    std::vector<std::string> out;
    for (const Order& o : S.orders) {
        if (o.owner != customer || o.shipper < 0) continue;
        if (o.status != ASSIGNED && o.status != ARRIVED && o.status != DELIVERED && o.status != FAILED && o.status != RETURNED) continue;
        std::string nm = shipperNameOf(o.shipper);
        if (!nm.empty() && std::find(out.begin(), out.end(), nm) == out.end()) out.push_back(nm);
    }
    return out;
}

Json prefsJson() {
    const std::string me = S.me.username;
    auto row = [&](const std::string& nm) {
        int idx = shipperIndexByName(nm), cnt = 0;
        double avg = S.reviews.average(nm, &cnt);
        return Json::object().set("name", nm).set("inFleet", idx >= 0)
            .set("vehicle", idx >= 0 ? Json(vehicleName(S.shippers[idx].vehicle)) : Json())
            .set("rating", cnt ? Json(avg) : Json()).set("ratings", cnt)
            .set("favorite", S.prefs.isFavorite(me, nm)).set("blocked", S.prefs.isBlocked(me, nm));
    };
    Json fav = Json::array(), blk = Json::array(), served = Json::array();
    for (const std::string& nm : S.prefs.favorites(me)) fav.push(row(nm));
    for (const std::string& nm : S.prefs.blocked(me)) blk.push(row(nm));
    for (const std::string& nm : shippersServed(me)) served.push(row(nm));
    return Json::object().set("ok", true).set("favorites", fav).set("blocked", blk).set("served", served)
        .set("max", static_cast<int>(Commerce::MAX_PREFS));
}

Json applyPref(const httplib::Request& r) {
    const std::string me = S.me.username;
    const std::string name = trimmed(str(r, "shipper"));
    const std::string action = str(r, "action");
    if (name.empty()) throw Invalid("Hãy chọn shipper", {{"shipper", "Chọn shipper"}});
    if (action == "block" || action == "fav") {
        std::vector<std::string> served = shippersServed(me);
        if (std::find(served.begin(), served.end(), name) == served.end())
            throw Forbidden("Bạn chỉ chọn được shipper đã từng nhận đơn của mình");
    }
    std::string e = S.prefs.apply(me, name, action);
    if (!e.empty()) throw Conflict(e);
    mark(D_PREFS);
    audit("customer.shipper_pref", name, action);
    int withdrawn = 0;
    if (action == "block") {   // lời mời đang chờ shipper này trả lời cho đơn của khách: gỡ ngay rồi mời người khác
        const int si = shipperIndexByName(name);
        std::vector<int> trips;
        for (const Trip& t : S.shift.trips()) {
            if (t.shipper != si || t.accepted) continue;
            for (const TripStop& st : t.stops)
                if (const Order* o = findOrderById(st.orderId); o && o->owner == me) { trips.push_back(t.id); break; }
        }
        for (int tid : trips) {
            const Trip* t = S.shift.findTrip(tid);
            std::vector<int> ids;
            for (const TripStop& st : t->stops) ids.push_back(st.orderId);
            S.shift.decline(tid, S.orders, "Khách đã chặn shipper");
            for (int oid : ids)
                if (Order* o = findOrderById(oid)) {
                    markTried(*o, si);
                    o->searchSince = nowSeconds(); o->opened = false;
                    logOrder("offer_withdrawn", *o, "Khách đã chặn shipper");
                    ++withdrawn;
                }
        }
        if (withdrawn) {
            mark(D_ORDERS);
            matchPending();
        }
    }
    static const std::map<std::string, std::string> msg = {{"block", "Đã chặn "}, {"unblock", "Đã bỏ chặn "}, {"fav", "Đã thêm vào yêu thích: "}, {"unfav", "Đã bỏ yêu thích: "}};
    return prefsJson().set("message", msg.at(action) + name + (withdrawn ? ". Lời mời đang chờ của shipper này đã được chuyển cho người khác" : ""));
}

// ------------------------------------------------------------ Đăng ký các tuyến
void registerOrderRoutes(httplib::Server& svr) {
    routePost(svr, "/api/order/add", wrap([](const httplib::Request& r) { return createOrder(r); }));
    // Tạo đơn mẫu ngẫu nhiên tại các điểm kho tới được (tiện khi vừa nhập bản đồ mới). Xoá hết đơn hiện có.
    routePost(svr, "/api/orders/random", wrap([](const httplib::Request& r) {
        if (!S.graph.hasNode(S.depot)) throw BadRequest("Chưa chọn kho");
        int count = std::clamp(integer(r, "count", 8), 1, 15);
        if (S.shift.active()) S.shift.reset(S.orders, true);
        std::vector<int> cand;
        for (int id : Traversal::bfs(S.graph, S.depot))
            if (id != S.depot) cand.push_back(id);
        if (cand.empty()) throw BadRequest("Kho chưa nối với điểm nào");
        static std::mt19937 rng(std::random_device{}());
        std::shuffle(cand.begin(), cand.end(), rng);
        const char* notes[] = {"Tài liệu", "Đồ ăn", "Quần áo", "Điện thoại", "Sách", "Thuốc", "Hoa tươi", "Linh kiện"};
        S.orders.clear();
        for (int i = 0; i < count; ++i) {
            Order o;
            o.id = 101 + i;
            o.destination = cand[i % cand.size()];
            o.weight = std::round(std::uniform_real_distribution<double>(0.5, 12)(rng) * 10) / 10;
            o.urgent = std::uniform_int_distribution<int>(0, 3)(rng) == 0;
            o.deadline = (o.urgent || std::uniform_int_distribution<int>(0, 2)(rng) == 0) ? std::uniform_int_distribution<int>(3, 12)(rng) * 10 : -1;
            o.note = notes[i % 8];
            o.createdAt = nowSeconds();
            o.createdBy = S.me.username;
            S.orders.push_back(o);
        }
        ensureDeliveryCodes();
        mark(D_ORDERS);
        audit("orders.random", "orders", std::to_string(count) + " đơn");
        return stateJson();
    }));
    routePost(svr, "/api/order/update", wrap([](const httplib::Request& r) { return updateOrder(r); }));
    routePost(svr, "/api/order/remove", wrap([](const httplib::Request& r) { return removeOrder(r); }));
    routePost(svr, "/api/order/confirm", wrap([](const httplib::Request& r) { return confirmOrder(r); }));
    routePost(svr, "/api/order/reject", wrap([](const httplib::Request& r) { return rejectOrder(r); }));
    routePost(svr, "/api/order/cancel", wrap([](const httplib::Request& r) { return cancelOrder(r); }));
    routePost(svr, "/api/shift/cancel", wrap([](const httplib::Request& r) { return cancelOrder(r); }));   // tên cũ
    routePost(svr, "/api/order/deliver", wrap([](const httplib::Request& r) { return deliverOrder(r); }));
    routePost(svr, "/api/order/rate", wrap([](const httplib::Request& r) { return rateOrder(r); }));
    routePost(svr, "/api/order/arrive", wrap([](const httplib::Request& r) { return arriveOrder(r); }));
    routePost(svr, "/api/order/receive", wrap([](const httplib::Request& r) { return receiveOrder(r); }));
    routePost(svr, "/api/order/dispute", wrap([](const httplib::Request& r) { return disputeOrder(r); }));
    routePost(svr, "/api/order/claim", wrap([](const httplib::Request& r) { return claimOrder(r); }));
    routeGet(svr, "/api/orders/open", wrap([](const httplib::Request& r) { return openOrdersJson(r); }));
    routePost(svr, "/api/track/confirm", wrap([](const httplib::Request& r) { return trackConfirm(r); }));
    routePost(svr, "/api/order/tip", wrap([](const httplib::Request& r) { return tipOrder(r); }));
    routeGet(svr, "/api/order/chat", wrap([](const httplib::Request& r) { return chatJson(chatOrder(integer(r, "id"))); }));
    routePost(svr, "/api/order/chat/send", wrap([](const httplib::Request& r) { return chatSend(r); }));
    routeGet(svr, "/api/customer/shippers", wrap([](const httplib::Request&) { return prefsJson(); }));
    routePost(svr, "/api/customer/shipper-pref", wrap([](const httplib::Request& r) { return applyPref(r); }));
    routePost(svr, "/api/order/retry", wrap([](const httplib::Request& r) { return retryOrder(r); }));
    routePost(svr, "/api/order/release", wrap([](const httplib::Request& r) { return releaseOrder(r); }));
    routePost(svr, "/api/shift/fail", wrap([](const httplib::Request& r) { return failOrder(r); }));
    routePost(svr, "/api/shift/requeue", wrap([](const httplib::Request& r) { return requeueOrder(r); }));
    routePost(svr, "/api/shift/return", wrap([](const httplib::Request& r) { return returnOrder(r); }));
    // Khách tự phục vụ (cùng xử lý với bản của nhân viên, orderForActor chặn đơn của người khác)
    routePost(svr, "/api/order/edit", wrap([](const httplib::Request& r) { return updateOrder(r); }));
    routePost(svr, "/api/order/redeliver", wrap([](const httplib::Request& r) { return requeueOrder(r); }));
    routePost(svr, "/api/order/return", wrap([](const httplib::Request& r) { return returnOrder(r); }));
    routeGet(svr, "/api/orders/list", wrap([](const httplib::Request& r) { return ordersListJson(r); }));
    routeGet(svr, "/api/order/get", wrap([](const httplib::Request& r) {
        const Order& o = orderForActor(integer(r, "id"));
        return orderDetailJson(r, o, static_cast<size_t>(&o - &S.orders[0]));
    }));
    routeGet(svr, "/api/order/invoice", wrap([](const httplib::Request& r) {
        const Order& o = orderForActor(integer(r, "id"));
        return Json::object().set("ok", true).set("invoice", invoiceJson(o));
    }));
    routeGet(svr, "/api/track", wrap([](const httplib::Request& r) { return trackOrder(r); }));
    routeGet(svr, "/api/public/info", wrap([](const httplib::Request&) { return publicInfo(); }));
    routeGet(svr, "/api/quote", wrap([](const httplib::Request& r) { return quoteHandler(r); }));

    routeGet(svr, "/api/promos", wrap([](const httplib::Request&) { return promosJson(); }));
    routePost(svr, "/api/promos/save", wrap([](const httplib::Request& r) { return savePromo(r); }));
    routePost(svr, "/api/promos/remove", wrap([](const httplib::Request& r) {
        std::string code = Commerce::normalizeCode(str(r, "code"));
        std::string e = S.promos.remove(code);
        if (!e.empty()) throw BadRequest(e);
        mark(D_PROMOS);
        audit("promo.remove", code);
        return promosJson().set("message", "Đã xoá mã " + code);
    }));

    routeGet(svr, "/api/dispatch", wrap([](const httplib::Request& r) { return dispatchPreview(r); }));
    routePost(svr, "/api/dispatch/apply", wrap([](const httplib::Request& r) { return dispatchApply(r); }));
    routePost(svr, "/api/trip/accept", wrap([](const httplib::Request& r) { return acceptTrip(r); }));
    routePost(svr, "/api/trip/decline", wrap([](const httplib::Request& r) { return declineTrip(r); }));
    routePost(svr, "/api/trip/recall", wrap([](const httplib::Request& r) { return recallTrip(r); }));
    routePost(svr, "/api/dispatch/assign", wrap([](const httplib::Request& r) { return dispatchAssign(r); }));
    routePost(svr, "/api/shift/progress", wrap([](const httplib::Request& r) { return shiftProgress(r); }));
    routePost(svr, "/api/shift/absent", wrap([](const httplib::Request& r) { return shiftAbsent(r); }));

    routeGet(svr, "/api/cod", wrap([](const httplib::Request& r) { return codJson(r); }));
    routePost(svr, "/api/cod/remit", wrap([](const httplib::Request& r) {
        double handed = num(r, "handed", static_cast<double>(S.cod.held(S.me.link)));
        if (handed < 0 || std::floor(handed) != handed) throw Invalid("Số tiền nộp phải là số nguyên không âm", {{"handed", "Số tiền không hợp lệ"}});
        int id = 0;
        long long held = S.cod.held(S.me.link);
        std::string e = S.cod.remit(S.me.link, static_cast<long long>(handed), nowSeconds(), id);
        if (!e.empty()) throw Conflict(e);
        mark(D_COD);
        long long diff = static_cast<long long>(handed) - held;
        audit("cod.remit", std::to_string(id), money(static_cast<long long>(handed)) + (diff ? ", chênh " + money(diff) : ""));
        notifyStaff("cod", 0, S.me.link + " nộp thu hộ " + money(static_cast<long long>(handed)) + (diff ? " (chênh lệch " + money(diff) + ")" : "") + ", chờ xác nhận");
        return codJson(r).set("message", "Đã nộp " + money(static_cast<long long>(handed)) + ", chờ quản trị viên xác nhận");
    }));
    routePost(svr, "/api/cod/confirm", wrap([](const httplib::Request& r) {
        int id = integer(r, "remit");
        const Flow::Remittance* m = S.cod.findRemit(id);
        if (!m) throw BadRequest("Không có phiếu nộp " + std::to_string(id));
        double counted = num(r, "counted");
        if (counted < 0 || std::floor(counted) != counted) throw Invalid("Số tiền đếm được phải là số nguyên không âm", {{"counted", "Số tiền không hợp lệ"}});
        std::string note = trimmed(str(r, "note"));
        std::string shipper = m->shipper;
        std::string e = S.cod.confirm(id, static_cast<long long>(counted), S.me.username, note, nowSeconds());
        if (!e.empty()) throw Conflict(e);
        mark(D_COD);
        long long diff = S.cod.findRemit(id)->diff();
        audit("cod.confirm", std::to_string(id), "đếm " + money(static_cast<long long>(counted)) + (diff ? ", chênh " + money(diff) : ", khớp"));
        notify(accountOfShipper(shipper), "cod", 0, "Phiếu nộp #" + std::to_string(id) + " đã đối soát" + (diff ? ", chênh lệch " + money(diff) : ", khớp số tiền"));
        return codJson(r).set("message", diff ? "Đã đối soát, chênh lệch " + money(diff) : "Đã đối soát, khớp số tiền");
    }));
    routePost(svr, "/api/cod/close", wrap([](const httplib::Request& r) {
        std::string name = trimmed(str(r, "shipper"));
        if (shipperIndexByName(name) < 0) throw BadRequest("Chọn một shipper trong đội xe");
        int id = 0;
        std::string e = S.cod.close(name, S.me.username, nowSeconds(), id);
        if (!e.empty()) throw Conflict(e);
        mark(D_COD);
        audit("cod.close", name, "ca #" + std::to_string(id));
        notify(accountOfShipper(name), "cod", 0, "Ca của bạn đã được chốt (#" + std::to_string(id) + ")");
        return codJson(r).set("message", "Đã chốt ca của " + name);
    }));

    routeGet(svr, "/api/complaints", wrap([](const httplib::Request& r) {
        int id = integer(r, "id", 0);
        if (id > 0) return Json::object().set("ok", true).set("complaint", complaintJson(complaintForActor(id), true));
        return complaintsListJson(r);
    }));
    routePost(svr, "/api/complaint/add", wrap([](const httplib::Request& r) {
        Order& o = orderForActor(integer(r, "order"));   // chỉ khiếu nại được đơn của mình
        int id = 0;
        std::string e = S.complaints.create(S.me.username, o.id, trimmed(str(r, "title")), trimmed(str(r, "body")), nowSeconds(), id);
        if (!e.empty()) throw Invalid(e, {{"body", e}});
        mark(D_COMPL);
        audit("complaint.add", std::to_string(id), "đơn " + std::to_string(o.id));
        notifyStaff("complaint", o.id, "Khiếu nại mới #" + std::to_string(id) + " về đơn #" + std::to_string(o.id));
        return Json::object().set("ok", true).set("id", id).set("complaint", complaintJson(*S.complaints.find(id), true)).set("message", "Đã gửi khiếu nại");
    }));
    routePost(svr, "/api/complaint/message", wrap([](const httplib::Request& r) {
        int id = integer(r, "id");
        const Support::Complaint& c = complaintForActor(id);
        std::string owner = c.owner;
        std::string e = S.complaints.addMessage(id, S.me.username, Auth::roleKey(S.me.role), trimmed(str(r, "text")), nowSeconds());
        if (!e.empty()) throw Conflict(e);
        mark(D_COMPL);
        if (isStaff()) notify(owner, "complaint", c.order, "Khiếu nại #" + std::to_string(id) + " có phản hồi mới");
        else notifyStaff("complaint", c.order, "Khách trả lời khiếu nại #" + std::to_string(id));
        return Json::object().set("ok", true).set("complaint", complaintJson(*S.complaints.find(id), true));
    }));
    routePost(svr, "/api/complaint/compensate", wrap([](const httplib::Request& r) { return compensate(r); }));
    routeGet(svr, "/api/wallet", wrap([](const httplib::Request& r) {
        if (isCustomer()) return walletJson(S.me.username);
        std::string cust = lowerCopy(trimmed(str(r, "customer")));
        customerAccount(cust);
        return walletJson(cust);
    }));
    routeGet(svr, "/api/wallets", wrap([](const httplib::Request&) { return walletsJson(); }));
    routePost(svr, "/api/wallet/payout", wrap([](const httplib::Request& r) { return walletPayout(r); }));
    routePost(svr, "/api/complaint/status", wrap([](const httplib::Request& r) {
        int id = integer(r, "id");
        const Support::Complaint* c = S.complaints.find(id);
        if (!c) throw BadRequest("Không có khiếu nại " + std::to_string(id));
        std::string to = lowerCopy(str(r, "status"));
        std::string e = S.complaints.setStatus(id, to, S.me.username, nowSeconds());
        if (!e.empty()) throw Conflict(e);
        mark(D_COMPL);
        audit("complaint.status", std::to_string(id), to);
        notify(c->owner, "complaint", c->order, "Khiếu nại #" + std::to_string(id) + ": " + Support::complaintStatusName(to));
        return Json::object().set("ok", true).set("complaint", complaintJson(*S.complaints.find(id), true));
    }));

    routeGet(svr, "/api/notifications", wrap([](const httplib::Request& r) { return notificationsJson(r); }));
    routePost(svr, "/api/notifications/read", wrap([](const httplib::Request& r) {
        if (!S.notes.markRead(S.me.username, integer(r, "id"))) throw BadRequest("Không có thông báo này");
        mark(D_NOTES);
        return Json::object().set("ok", true).set("unread", S.notes.unread(S.me.username));
    }));
    routePost(svr, "/api/notifications/read-all", wrap([](const httplib::Request&) {
        S.notes.markAllRead(S.me.username);
        mark(D_NOTES);
        return Json::object().set("ok", true).set("unread", 0);
    }));

    routeGet(svr, "/api/config", wrap([](const httplib::Request&) { return configJson().set("ok", true); }));
    routePost(svr, "/api/config/update", wrap([](const httplib::Request& r) { return updateConfig(r); }));

    auto auditRows = [](const httplib::Request& r) {
        return S.audit.filter(trimmed(str(r, "actor")), trimmed(str(r, "action")), trimmed(str(r, "target")),
                              static_cast<int64_t>(num(r, "from", 0)), static_cast<int64_t>(num(r, "to", 0)));
    };
    routeGet(svr, "/api/audit", wrap([auditRows](const httplib::Request& r) {
        auto rows = auditRows(r);
        PageInfo p = paginate(r, rows.size(), 20);
        Json arr = Json::array();
        for (size_t i = p.begin; i < p.end; ++i)
            arr.push(Json::object().set("id", rows[i]->id).set("at", static_cast<double>(rows[i]->at)).set("actor", rows[i]->actor)
                         .set("role", rows[i]->role).set("action", rows[i]->action).set("target", rows[i]->target).set("detail", rows[i]->detail));
        return Json::object().set("ok", true).set("entries", arr).set("page", pageJson(p));
    }));
    routeGet(svr, "/api/audit/export", [auditRows](const httplib::Request& req, httplib::Response& res) {
        std::lock_guard<std::mutex> lock(S.mtx);
        if (!authorize(req, res)) return;
        std::string csv;
        try {
            csv = Support::AuditLog::csv(auditRows(req));   // lọc trước: tham số sai (vd from=abc) -> 400 thay vì lỗi máy chủ
        } catch (const BadRequest& e) {
            res.status = 400;
            res.set_content(Json::object().set("ok", false).set("error", e.what()).dump(), "application/json; charset=utf-8");
            return;
        }
        audit("audit.export", "audit");
        flushDirty();
        res.set_header("Content-Disposition", "attachment; filename=\"audit.csv\"");
        res.set_content(csv, "text/csv; charset=utf-8");
    });
    routeGet(svr, "/api/reports/summary", wrap([](const httplib::Request&) { return reportJson(); }));
}
