// ============================================================================
// TextUtil.h — Mã hoá văn bản để lưu vào file .txt dạng "mỗi dòng một bản ghi, các cột cách nhau bằng dấu cách"
//
//   encodeToken : một cột không chứa dấu cách (khoảng trắng, '%' và ký tự điều khiển thành %XX; rỗng thành "-")
//   encodeLine  : phần cuối dòng, được phép có dấu cách ('\n' -> "\n", '\\' -> "\\\\")
// Dùng cho các file mới (thông báo, khiếu nại, nhật ký kiểm toán, sổ COD, địa chỉ...). users.txt / orders.txt giữ quy ước
// cũ ('_' thay cho dấu cách) để file cũ vẫn đọc được.
// ============================================================================
#pragma once
#include <cstdint>
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

namespace TextUtil {

inline std::string encodeToken(const std::string& s) {
    if (s.empty()) return "-";
    std::string out;
    for (unsigned char c : s) {
        if (c <= 0x20 || c == '%' || c == 0x7f || (s.size() == 1 && c == '-')) {
            char buf[4];
            std::snprintf(buf, sizeof buf, "%%%02X", c);
            out += buf;
        } else {
            out += static_cast<char>(c);
        }
    }
    return out;
}

inline std::string decodeToken(const std::string& s) {
    if (s == "-") return "";
    std::string out;
    for (size_t i = 0; i < s.size(); ++i) {
        if (s[i] == '%' && i + 2 < s.size() + 0 && std::isxdigit(static_cast<unsigned char>(s[i + 1])) &&
            std::isxdigit(static_cast<unsigned char>(s[i + 2]))) {
            out += static_cast<char>(std::stoi(s.substr(i + 1, 2), nullptr, 16));
            i += 2;
        } else {
            out += s[i];
        }
    }
    return out;
}

inline std::string encodeLine(const std::string& s) {
    std::string out;
    for (char c : s) {
        if (c == '\n') out += "\\n";
        else if (c == '\r') continue;
        else if (c == '\\') out += "\\\\";
        else out += c;
    }
    return out;
}

inline std::string decodeLine(const std::string& s) {
    std::string out;
    for (size_t i = 0; i < s.size(); ++i) {
        if (s[i] == '\\' && i + 1 < s.size()) {
            ++i;
            out += s[i] == 'n' ? '\n' : s[i];
        } else {
            out += s[i];
        }
    }
    return out;
}

// Cắt chuỗi UTF-8 còn tối đa maxBytes byte mà không cắt đôi một ký tự nhiều byte
inline std::string utf8Prefix(const std::string& s, size_t maxBytes) {
    if (s.size() <= maxBytes) return s;
    size_t n = maxBytes;
    while (n > 0 && (static_cast<unsigned char>(s[n]) & 0xC0) == 0x80) --n;
    return s.substr(0, n);
}

inline std::string trim(const std::string& s) {
    size_t b = s.find_first_not_of(" \t\r\n");
    if (b == std::string::npos) return "";
    return s.substr(b, s.find_last_not_of(" \t\r\n") - b + 1);
}

// Đọc từng dòng có nghĩa (bỏ dòng trống, dòng bắt đầu bằng '#', BOM, '\r')
inline std::vector<std::string> meaningfulLines(const std::string& text) {
    std::vector<std::string> out;
    std::istringstream in(text);
    std::string line;
    bool first = true;
    while (std::getline(in, line)) {
        if (first && line.rfind("\xEF\xBB\xBF", 0) == 0) line.erase(0, 3);
        first = false;
        if (!line.empty() && line.back() == '\r') line.pop_back();
        std::string t = trim(line);
        if (t.empty() || t[0] == '#') continue;
        out.push_back(line);
    }
    return out;
}

// Ghi nguyên tử: viết file tạm rồi đổi tên
inline bool writeAtomic(const std::string& path, const std::string& content, std::string& error) {
    std::string tmp = path + ".tmp";
    {
        std::ofstream out(tmp, std::ios::binary);
        if (!out) {
            error = "Khong ghi duoc file: " + tmp;
            return false;
        }
        out << content;
        if (!out) {
            error = "Loi khi ghi file: " + tmp;
            return false;
        }
    }
    std::remove(path.c_str());
    if (std::rename(tmp.c_str(), path.c_str()) != 0) {
        error = "Khong doi ten duoc file: " + tmp;
        return false;
    }
    return true;
}

inline bool readFile(const std::string& path, std::string& out) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return false;
    std::ostringstream ss;
    ss << in.rdbuf();
    out = ss.str();
    return true;
}

// Tách một dòng thành n cột đầu (cách nhau bằng khoảng trắng) và phần còn lại
inline bool splitColumns(const std::string& line, size_t n, std::vector<std::string>& cols, std::string& rest) {
    std::istringstream ss(line);
    cols.clear();
    std::string tok;
    for (size_t i = 0; i < n; ++i) {
        if (!(ss >> tok)) return false;
        cols.push_back(tok);
    }
    std::getline(ss, rest);
    rest = trim(rest);
    return true;
}

}  // namespace TextUtil
