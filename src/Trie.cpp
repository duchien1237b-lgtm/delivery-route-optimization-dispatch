#include "Trie.h"

#include <algorithm>
#include <set>
#include <sstream>
#include <unordered_map>
namespace {
std::vector<char32_t> decodeUtf8(const std::string& s) {
    std::vector<char32_t> out;
    for (size_t i = 0; i < s.size();) {
        unsigned char c = s[i];
        char32_t cp;
        int len;
        if (c < 0x80) { cp = c; len = 1; }
        else if ((c >> 5) == 0x6) { cp = c & 0x1F; len = 2; }
        else if ((c >> 4) == 0xE) { cp = c & 0x0F; len = 3; }
        else if ((c >> 3) == 0x1E) { cp = c & 0x07; len = 4; }
        else { ++i; continue; }  // byte lỗi: bỏ qua
        if (i + len > s.size()) break;
        for (int k = 1; k < len; ++k) cp = (cp << 6) | (static_cast<unsigned char>(s[i + k]) & 0x3F);
        out.push_back(cp);
        i += len;
    }
    return out;
}
const std::unordered_map<char32_t, char>& accentTable() {
    static std::unordered_map<char32_t, char> table;
    if (table.empty()) {
        const std::pair<const char*, char> groups[] = {
            {"àáảãạăằắẳẵặâầấẩẫậÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬ", 'a'},
            {"èéẻẽẹêềếểễệÈÉẺẼẸÊỀẾỂỄỆ", 'e'},
            {"ìíỉĩịÌÍỈĨỊ", 'i'},
            {"òóỏõọôồốổỗộơờớởỡợÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢ", 'o'},
            {"ùúủũụưừứửữựÙÚỦŨỤƯỪỨỬỮỰ", 'u'},
            {"ỳýỷỹỵỲÝỶỸỴ", 'y'},
            {"đĐ", 'd'},
        };
        for (const auto& [chars, base] : groups)
            for (char32_t cp : decodeUtf8(chars)) table[cp] = base;
    }
    return table;
}

std::vector<std::string> splitWords(const std::string& s) {
    std::vector<std::string> w;
    std::istringstream ss(s);
    std::string x;
    while (ss >> x) w.push_back(x);
    return w;
}

}  // namespace

std::string normalizeVi(const std::string& utf8) {
    const auto& table = accentTable();
    std::string out;
    for (char32_t cp : decodeUtf8(utf8)) {
        char c;
        if (cp < 0x80) {
            c = static_cast<char>(cp);
            if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
            if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'))) c = ' ';
        } else {
            auto it = table.find(cp);
            c = it == table.end() ? ' ' : it->second;
        }
        if (c == ' ' && (out.empty() || out.back() == ' ')) continue;  // gộp khoảng trắng
        out += c;
    }
    while (!out.empty() && out.back() == ' ') out.pop_back();
    return out;
}

// ---------------------------------------------------------------- Trie
void Trie::insert(const std::string& word, int id) {
    int cur = 0;
    for (char c : word) {
        auto it = nodes_[cur].next.find(c);
        if (it == nodes_[cur].next.end()) {
            int idx = static_cast<int>(nodes_.size());
            nodes_[cur].next[c] = idx;   // gán trước khi emplace_back (vector có thể cấp phát lại)
            nodes_.emplace_back();
            cur = idx;
        } else {
            cur = it->second;
        }
    }
    auto& ids = nodes_[cur].ids;
    if (std::find(ids.begin(), ids.end(), id) == ids.end()) ids.push_back(id);
}

std::vector<int> Trie::withPrefix(const std::string& prefix, size_t limit) const {
    int cur = 0;
    for (char c : prefix) {
        auto it = nodes_[cur].next.find(c);
        if (it == nodes_[cur].next.end()) return {};
        cur = it->second;
    }
    // Duyệt DFS toàn bộ nhánh con bằng ngăn xếp
    std::vector<int> result;
    std::set<int> seen;
    std::vector<int> stack{cur};
    while (!stack.empty() && result.size() < limit) {
        int u = stack.back();
        stack.pop_back();
        for (int id : nodes_[u].ids)
            if (seen.insert(id).second) result.push_back(id);
        for (auto it = nodes_[u].next.rbegin(); it != nodes_[u].next.rend(); ++it) stack.push_back(it->second);
    }
    return result;
}

void Trie::clear() {
    nodes_.clear();
    nodes_.emplace_back();
}

// ---------------------------------------------------------------- PlaceIndex
void PlaceIndex::build(const Graph& g) {
    trie_.clear();
    words_.clear();
    for (int id : g.nodeIds()) {
        std::vector<std::string> w = splitWords(normalizeVi(g.getNode(id).name));
        for (const std::string& x : w) trie_.insert(x, id);
        trie_.insert(std::to_string(id), id);  // tìm được theo mã điểm
        words_[id] = std::move(w);
    }
}

std::vector<int> PlaceIndex::search(const std::string& query, size_t limit) const {
    std::vector<std::string> q = splitWords(normalizeVi(query));
    if (q.empty()) return {};
    std::vector<int> cand = trie_.withPrefix(q[0], 100000);
    struct Hit { int id; int rank; size_t len; };
    std::vector<Hit> hits;
    for (int id : cand) {
        auto it = words_.find(id);
        if (it == words_.end()) continue;
        const auto& w = it->second;
        bool idMatch = q.size() == 1 && std::to_string(id) == q[0];
        bool ok = true;
        for (const std::string& part : q) {
            bool found = std::any_of(w.begin(), w.end(), [&](const std::string& x) { return x.compare(0, part.size(), part) == 0; });
            if (!found) { ok = false; break; }
        }
        if (!ok && !idMatch) continue;
        // Xếp hạng: trùng mã điểm > từ đầu tiên khớp > khớp ở giữa
        int rank = idMatch ? 0 : (!w.empty() && w[0].compare(0, q[0].size(), q[0]) == 0 ? 1 : 2);
        size_t len = 0;
        for (const auto& x : w) len += x.size();
        hits.push_back({id, rank, len});
    }
    std::sort(hits.begin(), hits.end(), [](const Hit& a, const Hit& b) {
        if (a.rank != b.rank) return a.rank < b.rank;
        if (a.len != b.len) return a.len < b.len;
        return a.id < b.id;
    });
    std::vector<int> out;
    for (size_t i = 0; i < hits.size() && i < limit; ++i) out.push_back(hits[i].id);
    return out;
}

// ---------------------------------------------------------------- TextIndex
void TextIndex::clear() {
    trie_.clear();
    words_.clear();
}

void TextIndex::add(int id, const std::string& text) {
    std::vector<std::string> w = splitWords(normalizeVi(text));
    for (const std::string& x : w) trie_.insert(x, id);
    auto& dst = words_[id];
    dst.insert(dst.end(), w.begin(), w.end());
}

std::vector<int> TextIndex::search(const std::string& query, size_t limit) const {
    std::vector<std::string> q = splitWords(normalizeVi(query));
    if (q.empty()) return {};
    std::vector<int> cand = trie_.withPrefix(q[0], 1000000);
    std::vector<int> out;
    for (int id : cand) {
        auto it = words_.find(id);
        if (it == words_.end()) continue;
        bool ok = true;
        for (const std::string& part : q) {
            bool found = std::any_of(it->second.begin(), it->second.end(),
                                     [&](const std::string& x) { return x.compare(0, part.size(), part) == 0; });
            if (!found) { ok = false; break; }
        }
        if (ok) out.push_back(id);
    }
    std::sort(out.begin(), out.end());
    if (out.size() > limit) out.resize(limit);
    return out;
}
