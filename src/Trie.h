// ============================================================================
// Trie.h — Cây tiền tố (Trie) để tìm điểm theo tên, gợi ý khi đang gõ
// (Phần "Core + Tích hợp")
//
// - Tên được chuẩn hoá: chữ thường, BỎ DẤU tiếng Việt ("Chợ Bến Thành" -> "cho ben thanh"),
//   nên gõ không dấu vẫn tìm được.
// - Mỗi TỪ của tên được chèn vào Trie, nên gõ "ben th" sẽ ra "Chợ Bến Thành".
// - Chèn một từ dài L: O(L).  Tìm theo tiền tố p: O(|p| + số kết quả trong nhánh).
// ============================================================================
#pragma once
#include "Graph.h"

#include <map>
#include <string>
#include <vector>

// "Chợ Bến Thành 2" -> "cho ben thanh 2" (giữ chữ, số; ký tự khác thành dấu cách)
std::string normalizeVi(const std::string& utf8);

class Trie {
public:
    Trie() { nodes_.emplace_back(); }
    void insert(const std::string& word, int id);
    // Các id có ít nhất một từ bắt đầu bằng prefix (không trùng lặp, tối đa limit)
    std::vector<int> withPrefix(const std::string& prefix, size_t limit = 1000) const;
    void clear();
    size_t nodeCount() const { return nodes_.size(); }

private:
    struct Node {
        std::map<char, int> next;  // ký tự -> chỉ số nút con
        std::vector<int> ids;      // các id có từ kết thúc tại đây
    };
    std::vector<Node> nodes_;      // nút 0 là gốc
};

// Chỉ mục tên điểm của bản đồ, dựng từ Graph
class PlaceIndex {
public:
    void build(const Graph& g);
    // Tìm theo nhiều từ: mọi từ trong truy vấn phải là tiền tố của một từ trong tên
    // (hoặc trùng mã điểm). Kết quả xếp: khớp từ đầu tên trước, tên ngắn trước.
    std::vector<int> search(const std::string& query, size_t limit = 8) const;

private:
    Trie trie_;
    std::map<int, std::vector<std::string>> words_;  // id -> các từ đã chuẩn hoá
};

// Chỉ mục tìm kiếm không dấu cho văn bản bất kỳ (họ tên, tên đăng nhập, email, SĐT, nhãn địa chỉ, người nhận...).
// Mỗi từ của văn bản được chèn vào Trie (dùng lại lớp Trie ở trên); truy vấn nhiều từ thì MỌI từ phải là
// tiền tố của một từ trong văn bản. Dùng cho tìm kiếm trong các danh sách (tài khoản, khách hàng, đơn, địa chỉ).
class TextIndex {
public:
    void clear();
    void add(int id, const std::string& text);
    // Kết quả theo thứ tự id tăng dần (danh sách đã lọc rồi mới sắp xếp / phân trang). Truy vấn rỗng -> rỗng.
    std::vector<int> search(const std::string& query, size_t limit = 100000) const;
    size_t size() const { return words_.size(); }

private:
    Trie trie_;
    std::map<int, std::vector<std::string>> words_;
};
