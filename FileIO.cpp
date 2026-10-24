#include "FileIO.h"

#include <fstream>
#include <iomanip>
#include <set>
#include <sstream>

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

// Đọc toàn bộ file thành các dòng có nghĩa. false nếu không mở được file.
bool readLines(const std::string& path, std::vector<Line>& out, std::string& error) {
    std::ifstream in(path);
    if (!in) {
        error = "Khong mo duoc file: " + path;
        return false;
    }
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

}  // namespace

// ================================ map.txt ===================================

bool loadMap(const std::string& path, Graph& g, std::string& error) {
    std::vector<Line> lines;
    if (!readLines(path, lines, error)) return false;

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
        std::string extra;
        if (!(ss >> u >> v >> dist >> time >> cost) || (ss >> extra)) {
            error = at(l) + "canh phai co dang '<u> <v> <km> <phut> <chi phi>'";
            return false;
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
        tmp.addEdge(u, v, dist, time, cost);
    }

    if (i < lines.size()) {
        error = at(lines[i]) + "du lieu thua sau phan EDGES (kiem tra lai so luong canh)";
        return false;
    }

    g = std::move(tmp);
    return true;
}

bool saveMap(const std::string& path, const Graph& g, std::string& error) {
    std::ofstream out(path);
    if (!out) {
        error = "Khong ghi duoc file: " + path;
        return false;
    }
    out << std::setprecision(10);

    // Gom cạnh; với đồ thị vô hướng mỗi cạnh chỉ ghi 1 lần (u < v, hoặc khuyên u == v)
    struct Row { int u, v; double d, t, c; };
    std::vector<Row> rows;
    for (int u : g.nodeIds())
        for (const Edge& e : g.neighbors(u))
            if (g.isDirected() || u <= e.to) rows.push_back({u, e.to, e.distance, e.time, e.cost});

    out << "# Ban do giao hang\n";
    out << "DIRECTED " << (g.isDirected() ? 1 : 0) << "\n\n";
    out << "NODES " << g.nodeCount() << "\n";
    out << "# id  x  y  ten\n";
    for (int id : g.nodeIds()) {
        const Node& nd = g.getNode(id);
        out << nd.id << ' ' << nd.x << ' ' << nd.y << ' ' << nd.name << '\n';
    }
    out << "\nEDGES " << rows.size() << "\n";
    out << "# u  v  km  phut  chi_phi\n";
    for (const Row& r : rows)
        out << r.u << ' ' << r.v << ' ' << r.d << ' ' << r.t << ' ' << r.c << '\n';

    if (!out) {
        error = "Loi khi ghi file: " + path;
        return false;
    }
    return true;
}

// =============================== orders.txt =================================

bool loadOrders(const std::string& path, std::vector<OrderRecord>& orders,
                std::string& error, const Graph* g) {
    std::vector<Line> lines;
    if (!readLines(path, lines, error)) return false;

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
        std::getline(ss, o.note);
        o.note = trim(o.note);

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

bool saveOrders(const std::string& path, const std::vector<OrderRecord>& orders,
                std::string& error) {
    std::ofstream out(path);
    if (!out) {
        error = "Khong ghi duoc file: " + path;
        return false;
    }
    out << std::setprecision(10);
    out << "# Danh sach don hang\n";
    out << "# id  nut_dich  kg  gap(0/1)  han(phut, -1 = khong)  ghi_chu\n";
    for (const OrderRecord& o : orders) {
        out << o.id << ' ' << o.destination << ' ' << o.weight << ' '
            << (o.urgent ? 1 : 0) << ' ' << o.deadline;
        // '#' trong ghi chú sẽ bị hiểu là chú thích khi đọc lại -> thay bằng '-'
        std::string note = o.note;
        for (char& c : note) if (c == '#' || c == '\n' || c == '\r') c = '-';
        if (!note.empty()) out << ' ' << note;
        out << '\n';
    }
    if (!out) {
        error = "Loi khi ghi file: " + path;
        return false;
    }
    return true;
}

}  // namespace FileIO
