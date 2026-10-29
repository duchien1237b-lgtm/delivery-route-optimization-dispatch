// ============================================================================
// MinHeap.h — Cấu trúc Min-Heap TỰ CÀI ĐẶT (không dùng std::priority_queue)
// (Phần "Đường đi ngắn nhất")
//
// 1) MinHeap<T, Less>  : heap nhị phân tổng quát trên mảng.
//       push / pop / top : O(log n),   size / empty : O(1)
//    Dùng cho Dijkstra "lazy" và hàng đợi ưu tiên đơn gấp của Dispatcher.
//
// 2) IndexedMinHeap    : heap có chỉ mục, hỗ trợ decreaseKey O(log n).
//    Mỗi phần tử là một chỉ số 0..n-1 kèm khoá double. Mảng pos_[] cho biết
//    phần tử đang nằm ở ô nào của heap -> giảm khoá rồi "nổi lên" ngay tại chỗ.
//    Heap không bao giờ chứa quá n phần tử (khác bản lazy có thể tới E phần tử).
//
// Quy ước mảng: nút i có con trái 2i+1, con phải 2i+2, cha (i-1)/2.
// ============================================================================
#pragma once
#include <functional>
#include <stdexcept>
#include <utility>
#include <vector>

template <class T, class Less = std::less<T>>
class MinHeap {
public:
    explicit MinHeap(Less less = Less()) : less_(less) {}

    bool empty() const { return a_.empty(); }
    size_t size() const { return a_.size(); }
    void clear() { a_.clear(); }
    void reserve(size_t n) { a_.reserve(n); }

    const T& top() const {
        if (a_.empty()) throw std::out_of_range("MinHeap rong");
        return a_[0];
    }

    void push(const T& x) {
        a_.push_back(x);
        siftUp(a_.size() - 1);
    }

    T pop() {
        if (a_.empty()) throw std::out_of_range("MinHeap rong");
        T result = a_[0];
        a_[0] = a_.back();
        a_.pop_back();
        if (!a_.empty()) siftDown(0);
        return result;
    }

private:
    std::vector<T> a_;
    Less less_;

    void siftUp(size_t i) {
        while (i > 0) {
            size_t p = (i - 1) / 2;
            if (!less_(a_[i], a_[p])) break;
            std::swap(a_[i], a_[p]);
            i = p;
        }
    }

    void siftDown(size_t i) {
        const size_t n = a_.size();
        while (true) {
            size_t l = 2 * i + 1, r = l + 1, m = i;
            if (l < n && less_(a_[l], a_[m])) m = l;
            if (r < n && less_(a_[r], a_[m])) m = r;
            if (m == i) break;
            std::swap(a_[i], a_[m]);
            i = m;
        }
    }
};

// ----------------------------------------------------------------------------
class IndexedMinHeap {
public:
    explicit IndexedMinHeap(int capacity)
        : pos_(capacity, -1), key_(capacity, 0.0) {
        heap_.reserve(capacity);
    }

    bool empty() const { return heap_.empty(); }
    int size() const { return static_cast<int>(heap_.size()); }
    bool contains(int id) const { return pos_[id] != -1; }
    double keyOf(int id) const { return key_[id]; }
    long long swaps() const { return swaps_; }  // thống kê cho benchmark

    // Nội dung heap theo đúng thứ tự mảng: (id, khoá). Dùng cho trang Mô phỏng.
    std::vector<std::pair<int, double>> snapshot() const {
        std::vector<std::pair<int, double>> s;
        s.reserve(heap_.size());
        for (int id : heap_) s.push_back({id, key_[id]});
        return s;
    }

    // Thêm phần tử mới, hoặc giảm khoá nếu đã có và khoá mới nhỏ hơn.
    void pushOrDecrease(int id, double key) {
        if (contains(id)) {
            if (key < key_[id]) decreaseKey(id, key);
            return;
        }
        key_[id] = key;
        pos_[id] = static_cast<int>(heap_.size());
        heap_.push_back(id);
        siftUp(pos_[id]);
    }

    void decreaseKey(int id, double key) {
        if (!contains(id)) throw std::out_of_range("decreaseKey: phan tu khong co trong heap");
        key_[id] = key;
        siftUp(pos_[id]);
    }

    // Lấy phần tử có khoá nhỏ nhất: trả về (id, key)
    std::pair<int, double> popMin() {
        if (heap_.empty()) throw std::out_of_range("IndexedMinHeap rong");
        int id = heap_[0];
        double k = key_[id];
        swapAt(0, static_cast<int>(heap_.size()) - 1);
        heap_.pop_back();
        pos_[id] = -1;
        if (!heap_.empty()) siftDown(0);
        return {id, k};
    }

private:
    std::vector<int> heap_;   // heap_[i] = id phần tử ở ô i
    std::vector<int> pos_;    // pos_[id] = ô của id trong heap, -1 nếu không có
    std::vector<double> key_; // khoá của từng id
    long long swaps_ = 0;

    void swapAt(int i, int j) {
        std::swap(heap_[i], heap_[j]);
        pos_[heap_[i]] = i;
        pos_[heap_[j]] = j;
        ++swaps_;
    }

    void siftUp(int i) {
        while (i > 0) {
            int p = (i - 1) / 2;
            if (key_[heap_[i]] >= key_[heap_[p]]) break;
            swapAt(i, p);
            i = p;
        }
    }

    void siftDown(int i) {
        const int n = static_cast<int>(heap_.size());
        while (true) {
            int l = 2 * i + 1, r = l + 1, m = i;
            if (l < n && key_[heap_[l]] < key_[heap_[m]]) m = l;
            if (r < n && key_[heap_[r]] < key_[heap_[m]]) m = r;
            if (m == i) break;
            swapAt(i, m);
            i = m;
        }
    }
};
