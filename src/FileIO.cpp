#include "FileIO.h"

#include "Billing.h"

#include <fstream>
#include <iomanip>
#include <stdexcept>
#include <set>
#include <sstream>

bool validPhone(const std::string& s) {
    return s.size() == 10 && s[0] == '0' && s.find_first_not_of("0123456789") == std::string::npos;
}

namespace FileIO {

namespace {

// Bỏ khoảng trắng 2 đầu (kể cả '\r' của file tạo trên Windows)
std::string trim(const std::string& s) {
    const char* ws = " \t\r\n";
    size_t b = s.find_first_not_of(ws);
    if (b == std::string::npos) return "";
    size_t e = s.find_last_not_of(ws);
    return s.substr(b, e - b + 1);
}

// Một dòng "có nghĩa" của file: đã bỏ chú thích, đã trim, kèm số dòng gốc
struct Line {
    int number;
    std::string text;
};

// Đọc toàn bộ luồng thành các dòng có nghĩa.
void readLinesFrom(std::istream& in, std::vector<Line>& out) {
    std::string raw;
    int no = 0;
    while (std::getline(in, raw)) {
        ++no;
        if (no == 1 && raw.size() >= 3 && raw.compare(0, 3, "\xEF\xBB\xBF") == 0)
            raw.erase(0, 3);  // bỏ BOM UTF-8 (Notepad hay thêm)
        size_t hash = raw.find('#');
        if (hash != std::string::npos) raw.erase(hash);
        std::string t = trim(raw);
        if (!t.empty()) out.push_back({no, t});
    }
}

// Đọc toàn bộ file thành các dòng có nghĩa. false nếu không mở được file.
bool readLines(const std::string& path, std::vector<Line>& out, std::string& error) {
    std::ifstream in(path);
    if (!in) {
        error = "Khong mo duoc file: " + path;
        return false;
    }
    readLinesFrom(in, out);
    return true;
}

std::string at(const Line& l) { return "Dong " + std::to_string(l.number) + ": "; }

// Đọc header dạng "KEYWORD <số>"
bool readHeader(const Line& l, const std::string& keyword, int& value, std::string& error) {
    std::istringstream ss(l.text);
    std::string kw;
    std::string extra;
    if (!(ss >> kw) || kw != keyword || !(ss >> value) || (ss >> extra) || value < 0) {
        error = at(l) + "can '" + keyword + " <so khong am>', gap: \"" + l.text + "\"";
        return false;
    }
    return true;
}

// ================================ map.txt ===================================

bool parseMap(const std::vector<Line>& lines, Graph& g, std::string& error) {
    size_t i = 0;
    auto eof = [&](const std::string& expect) {
        error = "Het file som: dang cho " + expect;
        return false;
    };

    // --- DIRECTED (tuỳ chọn) ---
    bool directed = false;
    if (i < lines.size() && lines[i].text.rfind("DIRECTED", 0) == 0) {
        int d;
        if (!readHeader(lines[i], "DIRECTED", d, error)) return false;
        if (d != 0 && d != 1) {
            error = at(lines[i]) + "DIRECTED chi nhan 0 hoac 1";
            return false;
        }
        directed = (d == 1);
        ++i;
    }
    Graph tmp(directed);  // dựng đồ thị tạm, chỉ gán vào g khi mọi thứ hợp lệ

    // --- NODES ---
    if (i >= lines.size()) return eof("NODES <n>");
    int n;
    if (!readHeader(lines[i++], "NODES", n, error)) return false;
    for (int k = 0; k < n; ++k) {
        if (i >= lines.size()) return eof("nut thu " + std::to_string(k + 1) + "/" + std::to_string(n));
        const Line& l = lines[i++];
        std::istringstream ss(l.text);
        int id;
        double x, y;
        if (!(ss >> id >> x >> y)) {
            error = at(l) + "nut phai co dang '<id> <x> <y> <ten>'";
            return false;
        }
        std::string name;
        std::getline(ss, name);
        name = trim(name);
        if (name.empty()) {
            error = at(l) + "nut " + std::to_string(id) + " thieu ten";
            return false;
        }
        if (!tmp.addNode(id, name, x, y)) {
            error = at(l) + "trung id nut " + std::to_string(id);
            return false;
        }
    }

    // --- EDGES ---
    if (i >= lines.size()) return eof("EDGES <m>");
    int m;
    if (!readHeader(lines[i++], "EDGES", m, error)) return false;
    for (int k = 0; k < m; ++k) {
        if (i >= lines.size()) return eof("canh thu " + std::to_string(k + 1) + "/" + std::to_string(m));
        const Line& l = lines[i++];
        std::istringstream ss(l.text);
        int u, v;
        double dist, time, cost;
        int allowed = MASK_ALL;  // cột thứ 6 (tuỳ chọn): loại xe được phép (1 xe máy, 2 ô tô, 4 xe tải)
        double peak = DEFAULT_PEAK;  // cột thứ 7 (tuỳ chọn): hệ số giờ cao điểm
        std::string extra;
        if (!(ss >> u >> v >> dist >> time >> cost)) {
            error = at(l) + "canh phai co dang '<u> <v> <km> <phut> <chi phi> [loai_xe [cao_diem]]'";
            return false;
        }
        if (ss >> extra) {
            std::istringstream ms(extra);
            std::string tail;
            if (!(ms >> allowed) || (ms >> tail) || allowed < 1 || allowed > 7) {
                error = at(l) + "cot loai xe phai la so 1..7 (1 xe may, 2 o to, 4 xe tai, cong lai)";
                return false;
            }
            if (ss >> extra) {
                std::istringstream ps(extra);
                if (!(ps >> peak) || (ps >> tail) || peak < 1 || peak > 5 || (ss >> extra)) {
                    error = at(l) + "he so cao diem phai la so tu 1 den 5";
                    return false;
                }
            }
        }
        if (dist < 0 || time < 0) {
            error = at(l) + "km va phut khong duoc am";
            return false;
        }
        if (!tmp.hasNode(u) || !tmp.hasNode(v)) {
            error = at(l) + "canh " + std::to_string(u) + "-" + std::to_string(v) +
                    " tham chieu nut khong ton tai";
            return false;
        }
        if (u == v) {
            error = at(l) + "khong cho phep canh tu nut " + std::to_string(u) + " ve chinh no";
            return false;
        }
        if (!tmp.addEdge(u, v, dist, time, cost, allowed, peak)) {
            error = at(l) + "canh " + std::to_string(u) + "-" + std::to_string(v) + " bi trung";
            return false;
        }
    }

    if (i < lines.size()) {
        error = at(lines[i]) + "du lieu thua sau phan EDGES (kiem tra lai so luong canh)";
        return false;
    }

    g = std::move(tmp);
    return true;
}

void writeMap(std::ostream& out, const Graph& g) {
    out << std::setprecision(10);

    // Gom cạnh; với đồ thị vô hướng mỗi cạnh chỉ ghi 1 lần (u < v, hoặc khuyên u == v)
    struct Row { int u, v; double d, t, c; int allowed; double peak; };
    std::vector<Row> rows;
    for (int u : g.nodeIds())
        for (const Edge& e : g.neighbors(u))
            if (g.isDirected() || u <= e.to)
                rows.push_back({u, e.to, e.distance, e.time, e.cost, e.allowed, e.peak});

    out << "# Ban do giao hang\n";
    out << "DIRECTED " << (g.isDirected() ? 1 : 0) << "\n\n";
    out << "NODES " << g.nodeCount() << "\n";
    out << "# id  x  y  ten\n";
    for (int id : g.nodeIds()) {
        const Node& nd = g.getNode(id);
        out << nd.id << ' ' << nd.x << ' ' << nd.y << ' ' << nd.name << '\n';
    }
    out << "\nEDGES " << rows.size() << "\n";
    out << "# u  v  km  phut  phu_phi(nghin d)  [loai_xe: 1 xe may + 2 o to + 4 xe tai  [he_so_cao_diem]]\n";
    for (const Row& r : rows) {
        out << r.u << ' ' << r.v << ' ' << r.d << ' ' << r.t << ' ' << r.c;
        if (r.peak != DEFAULT_PEAK) out << ' ' << r.allowed << ' ' << r.peak;
        else if (r.allowed != MASK_ALL) out << ' ' << r.allowed;
        out << '\n';
    }
}

}  // namespace

bool loadMap(const std::string& path, Graph& g, std::string& error) {
    std::vector<Line> lines;
    if (!readLines(path, lines, error)) return false;
    return parseMap(lines, g, error);
}

bool loadMapText(const std::string& text, Graph& g, std::string& error) {
    std::istringstream in(text);
    std::vector<Line> lines;
    readLinesFrom(in, lines);
    return parseMap(lines, g, error);
}

std::string mapToText(const Graph& g) {
    std::ostringstream out;
    writeMap(out, g);
    return out.str();
}

bool saveMap(const std::string& path, const Graph& g, std::string& error) {
    std::ofstream out(path);
    if (!out) {
        error = "Khong ghi duoc file: " + path;
        return false;
    }
    writeMap(out, g);
    if (!out) {
        error = "Loi khi ghi file: " + path;
        return false;
    }
    return true;
}

// =============================== orders.txt =================================

namespace {
bool parseOrders(const std::vector<Line>& lines, std::vector<OrderRecord>& orders,
                 std::string& error, const Graph* g) {
    std::vector<OrderRecord> result;
    std::set<int> seen;
    for (const Line& l : lines) {
        std::istringstream ss(l.text);
        OrderRecord o;
        int urgent;
        if (!(ss >> o.id >> o.destination >> o.weight >> urgent >> o.deadline)) {
            error = at(l) + "don phai co dang '<id> <nut_dich> <kg> <gap 0/1> <han_phut|-1> [ghi chu]'";
            return false;
        }
        // Các trường nghiệp vụ khoá=giá_trị (tuỳ chọn), phần còn lại là ghi chú
        std::string rest;
        std::getline(ss, rest);
        rest = trim(rest);
        auto unscore = [](std::string v) { for (char& c : v) if (c == '_') c = ' '; return v; };
        while (!rest.empty()) {
            size_t sp = rest.find(' ');
            std::string tok = rest.substr(0, sp);
            size_t eq = tok.find('=');
            std::string key = eq == std::string::npos ? "" : tok.substr(0, eq);
            std::string val = eq == std::string::npos ? "" : tok.substr(eq + 1);
            auto number = [&](long long& out, long long maxv) {
                bool digits = !val.empty() && val.size() <= 18 && val.find_first_not_of("0123456789") == std::string::npos;
                if (!digits || std::stoll(val) > maxv) {
                    error = at(l) + key + "= phai la so nguyen khong am (toi da " + std::to_string(maxv) + ")";
                    return false;
                }
                out = std::stoll(val);
                return true;
            };
            long long n = 0;
            if (key == "cod") {
                if (val.size() > 9 || !number(n, MAX_COD)) {
                    error = at(l) + "cod= phai la so tien VND tu 0 den 50.000.000";
                    return false;
                }
                o.cod = n;
            } else if (key == "sdt") {
                o.phone = val;
                if (!validPhone(o.phone)) {
                    error = at(l) + "sdt= phai gom 10 chu so, bat dau bang 0";
                    return false;
                }
            } else if (key == "kh") {
                o.owner = val;
                if (o.owner.empty()) {
                    error = at(l) + "kh= khong duoc de trong";
                    return false;
                }
            } else if (key == "nhan") {
                o.recipient = unscore(val);
                if (o.recipient.empty()) {
                    error = at(l) + "nhan= khong duoc de trong";
                    return false;
                }
            } else if (key == "ma") {
                o.promo = val;
                if (o.promo.empty()) { error = at(l) + "ma= khong duoc de trong"; return false; }
            } else if (key == "ck") {
                if (!number(n, 1000000000)) return false;
                o.promoDiscount = n;
            } else if (key == "tv") {
                if (!number(n, 1000000000)) return false;
                o.loyaltyDiscount = n;
            } else if (key == "gia") {
                if (!number(n, 1000000000)) return false;
                o.gross = n;
            } else if (key == "ngay") {
                if (!number(n, 9999999999LL)) return false;
                o.createdAt = n;
            } else if (key == "tao") {
                o.createdBy = val;
            } else if (key == "xn") {
                if (val.size() != 4 || val.find_first_not_of("0123456789") != std::string::npos) {
                    error = at(l) + "xn= phai la ma 4 chu so";
                    return false;
                }
                o.deliveryCode = val;
            } else if (key == "tt") {
                if (!number(n, 7)) return false;
                o.status = static_cast<int>(n);
            } else if (key == "sh") {
                o.shipperName = unscore(val);
            } else if (key == "eta" || key == "gx") {
                try {
                    size_t used = 0;
                    double d = std::stod(val, &used);
                    if (used != val.size()) throw std::invalid_argument("x");
                    (key == "eta" ? o.eta : o.deliveredAt) = d;
                } catch (...) {
                    error = at(l) + key + "= phai la so";
                    return false;
                }
            } else if (key == "lan") {
                if (!number(n, 100)) return false;
                o.attempts = static_cast<int>(n);
            } else if (key == "ly") {
                if (!number(n, 100)) return false;
                o.failReason = static_cast<int>(n);
            } else if (key == "huy") {
                if (!number(n, 1000000000)) return false;
                o.cancelFee = n;
            } else if (key == "bc") {
                o.proofNote = unscore(val);
            } else if (key == "gt") {
                if (!number(n, 9999999999LL)) return false;
                o.deliveredReal = n;
            } else if (key == "cu") {
                o.codRecorded = val == "1";
            } else if (key == "dc") {
                if (!number(n, 1000000)) return false;
                o.address = static_cast<int>(n);
            } else if (key == "gtri") {
                if (!number(n, Billing::MAX_DECLARED)) return false;
                o.declaredValue = n;
            } else if (key == "bh") {
                if (!number(n, 1000000000)) return false;
                o.insuranceFee = n;
            } else if (key == "kt") {
                if (!Billing::parseDims(val, o.dimL, o.dimW, o.dimH)) {
                    error = at(l) + "kt= phai co dang DAIxRONGxCAO (cm, moi canh 1-300), vd kt=40x30x20";
                    return false;
                }
            } else if (key == "tra") {
                o.receiverPays = val == "1";
            } else if (key == "hoan") {
                if (!number(n, 1000000000)) return false;
                o.returnFee = n;
            } else if (key == "xong") {
                if (!number(n, 9999999999LL)) return false;
                o.closedAt = n;
            } else {
                break;
            }
            rest = sp == std::string::npos ? "" : trim(rest.substr(sp + 1));
        }
        o.note = rest;

        if (urgent != 0 && urgent != 1) {
            error = at(l) + "cot 'gap' chi nhan 0 hoac 1";
            return false;
        }
        o.urgent = (urgent == 1);
        if (o.weight <= 0) {
            error = at(l) + "khoi luong phai > 0";
            return false;
        }
        if (o.deadline < -1) {
            error = at(l) + "han giao phai >= 0 hoac -1 (khong co han)";
            return false;
        }
        if (!seen.insert(o.id).second) {
            error = at(l) + "trung ma don " + std::to_string(o.id);
            return false;
        }
        if (g && !g->hasNode(o.destination)) {
            error = at(l) + "don " + std::to_string(o.id) + " giao toi nut " +
                    std::to_string(o.destination) + " khong co tren ban do";
            return false;
        }
        result.push_back(o);
    }

    orders = std::move(result);
    return true;
}

void writeOrders(std::ostream& out, const std::vector<OrderRecord>& orders) {
    // (ghi chú bắt đầu bằng "cod=", "sdt=", "nhan=" sẽ bị hiểu nhầm là trường nghiệp vụ: chèn dấu '-' phía trước)
    out << std::setprecision(10);
    out << "# Danh sach don hang\n";
    out << "# id  nut_dich  kg  gap(0/1)  han(phut, -1 = khong)  [khoa=gia_tri ...]  ghi_chu\n";
    auto score = [](std::string v) { for (char& c : v) if (c == ' ' || c == '#' || c == '\n' || c == '\r' || c == '\t') c = '_'; return v; };
    for (const OrderRecord& o : orders) {
        out << o.id << ' ' << o.destination << ' ' << o.weight << ' '
            << (o.urgent ? 1 : 0) << ' ' << o.deadline;
        if (o.cod > 0) out << " cod=" << o.cod;
        if (!o.phone.empty()) out << " sdt=" << o.phone;
        if (!o.recipient.empty()) out << " nhan=" << score(o.recipient);
        if (!o.owner.empty()) out << " kh=" << o.owner;
        if (!o.promo.empty()) out << " ma=" << score(o.promo);
        if (o.promoDiscount) out << " ck=" << o.promoDiscount;
        if (o.loyaltyDiscount) out << " tv=" << o.loyaltyDiscount;
        if (o.gross) out << " gia=" << o.gross;
        if (o.createdAt) out << " ngay=" << o.createdAt;
        if (!o.createdBy.empty()) out << " tao=" << score(o.createdBy);
        if (!o.deliveryCode.empty()) out << " xn=" << o.deliveryCode;
        if (o.status) out << " tt=" << o.status;
        if (!o.shipperName.empty()) out << " sh=" << score(o.shipperName);
        if (o.eta >= 0) out << " eta=" << o.eta;
        if (o.deliveredAt >= 0) out << " gx=" << o.deliveredAt;
        if (o.attempts) out << " lan=" << o.attempts;
        if (o.failReason >= 0) out << " ly=" << o.failReason;
        if (o.cancelFee) out << " huy=" << o.cancelFee;
        if (!o.proofNote.empty()) out << " bc=" << score(o.proofNote);
        if (o.deliveredReal) out << " gt=" << o.deliveredReal;
        if (o.codRecorded) out << " cu=1";
        if (o.address) out << " dc=" << o.address;
        if (o.declaredValue) out << " gtri=" << o.declaredValue;
        if (o.insuranceFee) out << " bh=" << o.insuranceFee;
        if (o.dimL > 0) out << " kt=" << Billing::dimsText(o.dimL, o.dimW, o.dimH);
        if (o.receiverPays) out << " tra=1";
        if (o.returnFee) out << " hoan=" << o.returnFee;
        if (o.closedAt) out << " xong=" << o.closedAt;
        // '#' trong ghi chú sẽ bị hiểu là chú thích khi đọc lại -> thay bằng '-'
        std::string note = o.note;
        for (char& c : note) if (c == '#' || c == '\n' || c == '\r') c = '-';
        {
            // ghi chú bắt đầu bằng một khoá nghiệp vụ ("kh=...") sẽ bị đọc nhầm thành trường -> thêm '-' phía trước
            static const std::set<std::string> keys = {"cod", "sdt", "nhan", "kh", "ma", "ck", "tv", "gia", "ngay", "tao", "xn",
                                                       "tt", "sh", "eta", "gx", "lan", "ly", "huy", "bc", "gt", "cu", "dc",
                                                       "gtri", "bh", "kt", "tra", "hoan", "xong"};
            size_t eq = note.find('=');
            size_t sp = note.find(' ');
            if (eq != std::string::npos && (sp == std::string::npos || eq < sp) && keys.count(note.substr(0, eq))) note = "-" + note;
        }
        if (!note.empty()) out << ' ' << note;
        out << '\n';
    }
}
}  // namespace

bool loadOrders(const std::string& path, std::vector<OrderRecord>& orders,
                std::string& error, const Graph* g) {
    std::vector<Line> lines;
    if (!readLines(path, lines, error)) return false;
    return parseOrders(lines, orders, error, g);
}

bool loadOrdersText(const std::string& text, std::vector<OrderRecord>& orders,
                    std::string& error, const Graph* g) {
    std::istringstream in(text);
    std::vector<Line> lines;
    readLinesFrom(in, lines);
    return parseOrders(lines, orders, error, g);
}

std::string ordersToText(const std::vector<OrderRecord>& orders) {
    std::ostringstream out;
    writeOrders(out, orders);
    return out.str();
}

bool saveOrders(const std::string& path, const std::vector<OrderRecord>& orders,
                std::string& error) {
    std::ofstream out(path);
    if (!out) {
        error = "Khong ghi duoc file: " + path;
        return false;
    }
    writeOrders(out, orders);
    if (!out) {
        error = "Loi khi ghi file: " + path;
        return false;
    }
    return true;
}

}  // namespace FileIO
