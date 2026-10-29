// ============================================================================
// FileIO.h — Đọc/ghi bản đồ (map.txt) và danh sách đơn hàng (orders.txt)
//
// Mọi hàm trả về true nếu thành công; nếu lỗi trả về false và ghi lý do
// (kèm số dòng) vào tham số `error`. Khi load thất bại, dữ liệu đích
// (Graph / vector đơn hàng) được GIỮ NGUYÊN như trước khi gọi.
//
// ---------------------------- Định dạng map.txt -----------------------------
//   # dòng chú thích (từ dấu # đến hết dòng đều bị bỏ qua)
//   DIRECTED 0                      <- 0: vô hướng, 1: có hướng (tuỳ chọn, mặc định 0)
//   NODES <n>
//   <id> <x> <y> <tên có thể có dấu cách>     (n dòng)
//   EDGES <m>
//   <u> <v> <km> <phút> <phụ phí> [loại xe [hệ số cao điểm]]   (m dòng)
//   - km, phút phải >= 0; phụ phí (nghìn đồng) được phép âm (= trợ giá).
//   - loại xe (tuỳ chọn, mặc định 7): cộng các bit 1 = xe máy, 2 = ô tô,
//     4 = xe tải. Ví dụ 3 = cấm xe tải, 6 = cấm xe máy.
//   - hệ số cao điểm (tuỳ chọn, mặc định 1.5, từ 1 đến 5): lúc đông nhất ô tô đi
//     đoạn này mất gấp bao nhiêu lần. Muốn ghi cột này thì phải ghi cả cột loại xe.
//   - Không cho phép cạnh trùng hoặc cạnh từ một nút về chính nó.
//   - Đồ thị vô hướng: mỗi cạnh chỉ ghi MỘT lần.
//
// --------------------------- Định dạng orders.txt ---------------------------
//   # id  nút_đích  kg  gấp(0/1)  hạn(phút, -1 = không có)  [khoá=giá_trị ...]  ghi chú
//   101 3 2.5 1 45 Tai lieu gap
//   Khoá tuỳ chọn: cod sdt nhan kh (nghiệp vụ cơ bản) và ma ck tv gia ngay tao xn (khuyến mãi, mã xác nhận)
//   gtri bh kt tra (khai giá, phí bảo hiểm, kích thước DxRxC cm, người nhận trả cước),
//   tt sh eta gx lan ly huy bc gt cu dc hoan xong (trạng thái vận hành, chỉ có trong data/orders_live.txt).
// ============================================================================
#pragma once
#include "Graph.h"
#include <string>
#include <vector>

// Bản ghi đơn hàng thô đọc từ file. Phần Dispatcher chuyển sang struct Order
// của mình (Order có thể kế thừa hoặc có constructor nhận OrderRecord).
struct OrderRecord {
    int id = -1;
    int destination = -1;  // id nút khách hàng trên bản đồ
    double weight = 0.0;   // kg, > 0
    bool urgent = false;   // đơn gấp -> ưu tiên trong hàng đợi
    int deadline = -1;     // phút tính từ đầu ca; -1 = không có hạn
    std::string note;      // ghi chú, có thể rỗng
    // Thông tin nghiệp vụ (tuỳ chọn, ghi dạng khoá=giá_trị trước ghi chú):
    long long cod = 0;     // cod=150000   tiền thu hộ (VND), 0 = không thu hộ
    std::string phone;     // sdt=0901234567 số điện thoại người nhận
    std::string recipient; // nhan=Nguyen_Van_A  tên người nhận ('_' thay cho dấu cách)
    std::string owner;     // kh=ten_dang_nhap  tài khoản khách hàng đặt đơn (rỗng: do quản trị viên tạo)
    // Trường mở rộng (tuỳ chọn, file cũ không có vẫn đọc được):
    std::string promo;               // ma=GIAM10      mã giảm giá đã áp dụng
    long long promoDiscount = 0;     // ck=5000        số tiền mã giảm giá (VND)
    long long loyaltyDiscount = 0;   // tv=2000        giảm theo hạng khách thân thiết (VND)
    long long gross = 0;             // gia=36000      cước gốc đã báo giá (VND, 0 = chưa chốt, tính theo biểu phí hiện hành)
    long long createdAt = 0;         // ngay=1761600000 thời điểm tạo đơn (giây)
    std::string createdBy;           // tao=ten_dang_nhap người tạo đơn
    std::string deliveryCode;        // xn=4821        mã xác nhận giao 4 số
    // Trạng thái vận hành (chỉ ghi khi lưu bản làm việc data/orders_live.txt):
    int status = 0;                  // tt=2           OrderStatus (xem Dispatcher.h)
    std::string shipperName;         // sh=Anh_Tuấn    shipper được giao
    double eta = -1, deliveredAt = -1;   // eta=, gx=   phút từ đầu ca
    int attempts = 0;                // lan=1          số lần giao thất bại
    int failReason = -1;             // ly=0           lý do thất bại gần nhất
    long long cancelFee = 0;         // huy=6000       phí huỷ đã thu (VND)
    std::string proofNote;           // bc=Gui_bao_ve  ghi chú / ảnh bằng chứng khi giao
    long long deliveredReal = 0;     // gt=1761600000  thời điểm thực tế giao xong (giây)
    bool codRecorded = false;        // cu=1           đã ghi nhận tiền thu hộ vào sổ COD
    int address = 0;                 // dc=3           mã địa chỉ trong sổ địa chỉ
    // Khai giá & bảo hiểm, kích thước, người trả cước (tuỳ chọn):
    long long declaredValue = 0;     // gtri=2000000   giá trị hàng khai báo (VND)
    long long insuranceFee = 0;      // bh=10000       phí bảo hiểm đã chốt (VND)
    int dimL = 0, dimW = 0, dimH = 0;   // kt=40x30x20  kích thước (cm) để tính cân quy đổi
    bool receiverPays = false;       // tra=1          người nhận trả cước
    long long returnFee = 0;         // hoan=9000      phí hoàn hàng đã tính (chỉ trong orders_live.txt)
    long long closedAt = 0;          // xong=1761600000 lúc hoàn kho / huỷ (giây, chỉ trong orders_live.txt)
};
const long long MAX_COD = 50000000;   // thu hộ tối đa 50 triệu đồng / đơn
bool validPhone(const std::string& s);  // 10 chữ số, bắt đầu bằng 0

namespace FileIO {

bool loadMap(const std::string& path, Graph& g, std::string& error);
bool saveMap(const std::string& path, const Graph& g, std::string& error);
// Bản làm việc với chuỗi (web upload/download dùng)
bool loadMapText(const std::string& text, Graph& g, std::string& error);
std::string mapToText(const Graph& g);

// Nếu truyền g != nullptr: kiểm tra thêm nút đích có tồn tại trên bản đồ.
bool loadOrders(const std::string& path, std::vector<OrderRecord>& orders,
                std::string& error, const Graph* g = nullptr);
bool saveOrders(const std::string& path, const std::vector<OrderRecord>& orders,
                std::string& error);
bool loadOrdersText(const std::string& text, std::vector<OrderRecord>& orders,
                    std::string& error, const Graph* g = nullptr);
std::string ordersToText(const std::vector<OrderRecord>& orders);

}  // namespace FileIO
