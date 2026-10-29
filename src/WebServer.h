// ============================================================================
// WebServer.h — Backend web viết bằng C++ (dùng thư viện header-only cpp-httplib)
// (Phần "Core + Tích hợp")
//
// - Phục vụ giao diện tĩnh trong thư mục web/ (HTML/CSS/JS).
// - Cung cấp REST API /api/... trả JSON: mọi thuật toán đều chạy ở C++,
//   trình duyệt chỉ hiển thị kết quả.
// Danh sách API: xem README.md, mục "REST API".
// ============================================================================
#pragma once
#include <string>

struct ServerConfig {
    std::string host = "127.0.0.1";
    int port = 8080;
    std::string webDir = "web";
    std::string dataDir = "data";
    bool demo = true;   // chế độ demo: hộp thư giả lập (OTP đặt lại mật khẩu) xem được qua giao diện
};

// Chạy server (chặn tới khi tắt). Trả về mã thoát của chương trình.
int runWebServer(const ServerConfig& cfg);
// Dừng server đang chạy (dùng trong kiểm thử)
void stopWebServerForTests();
