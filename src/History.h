// ============================================================================
// History.h — Hoàn tác / Làm lại (Undo / Redo) bằng HAI NGĂN XẾP
// (Phần "Core + Tích hợp")
//
//   Trước mỗi thao tác sửa bản đồ: record(trạng thái hiện tại)
//        -> đẩy vào ngăn Undo, xoá sạch ngăn Redo.
//   Hoàn tác: lấy đỉnh Undo làm trạng thái mới, đẩy trạng thái hiện tại vào Redo.
//   Làm lại : lấy đỉnh Redo làm trạng thái mới, đẩy trạng thái hiện tại vào Undo.
//
// Giới hạn số bước (capacity) để không tốn bộ nhớ: khi đầy thì bỏ bước cũ nhất
// (vì vậy dùng std::deque làm ngăn xếp: đẩy/lấy ở cuối, bỏ phần tử ở đầu).
// Mọi thao tác O(1) (không tính chi phí sao chép T).
// ============================================================================
#pragma once
#include <deque>
#include <string>
#include <utility>

template <class T>
class UndoRedo {
public:
    explicit UndoRedo(size_t capacity = 30) : cap_(capacity) {}

    // Ghi lại trạng thái TRƯỚC khi thay đổi, kèm tên thao tác ("Thêm điểm"...)
    void record(T before, const std::string& label) {
        undo_.push_back({std::move(before), label});
        if (undo_.size() > cap_) undo_.pop_front();
        redo_.clear();
    }

    // current: trạng thái đang dùng; được thay bằng trạng thái cũ. false nếu không còn gì để hoàn tác.
    bool undo(T& current, std::string* label = nullptr) {
        if (undo_.empty()) return false;
        Entry e = std::move(undo_.back());
        undo_.pop_back();
        if (label) *label = e.label;
        redo_.push_back({std::move(current), e.label});
        current = std::move(e.state);
        return true;
    }

    bool redo(T& current, std::string* label = nullptr) {
        if (redo_.empty()) return false;
        Entry e = std::move(redo_.back());
        redo_.pop_back();
        if (label) *label = e.label;
        undo_.push_back({std::move(current), e.label});
        current = std::move(e.state);
        return true;
    }

    bool canUndo() const { return !undo_.empty(); }
    bool canRedo() const { return !redo_.empty(); }
    std::string undoLabel() const { return undo_.empty() ? "" : undo_.back().label; }
    std::string redoLabel() const { return redo_.empty() ? "" : redo_.back().label; }
    size_t undoSize() const { return undo_.size(); }
    size_t redoSize() const { return redo_.size(); }
    void clear() { undo_.clear(); redo_.clear(); }

private:
    struct Entry {
        T state;
        std::string label;
    };
    size_t cap_;
    std::deque<Entry> undo_, redo_;
};
