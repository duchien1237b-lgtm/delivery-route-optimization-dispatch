# Hệ thống Tìm đường & Điều phối Giao hàng (Shipper)

[![ci](../../actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)
![C++17](https://img.shields.io/badge/C%2B%2B-17-blue) ![license](https://img.shields.io/badge/license-MIT-green)

## Bắt đầu nhanh

```bash
git clone https://github.com/<tai-khoan>/delivery-route-optimization-dispatch.git
cd delivery-route-optimization-dispatch
make            # cần g++ hỗ trợ C++17
make run        # mở http://localhost:8080 (dữ liệu chạy thử ở .run-data/, không đụng vào data/)
make test       # 8 bộ kiểm thử, kết quả: TẤT CẢ ... ĐỀU ĐẠT
```

Không muốn biên dịch? Mở thẳng **`dieu-phoi-giao-hang.html`** bằng trình duyệt (bản một file, cùng thuật toán, dữ liệu lưu trong trình duyệt).

Tài khoản dùng thử: `admin` / `admin123` (quản trị viên), `tuan` / `shipper123` (shipper), `anphat` / `khach123` (khách hàng). Bảng đầy đủ ở [Cài đặt và chạy](#cài-đặt-và-chạy). Để xem ghép đơn kiểu Grab, mở 2 cửa sổ ẩn danh: một khách đặt đơn, một shipper `tuan` bấm *Nhận đơn*.

> Bài tập lớn môn **Cấu trúc dữ liệu & Giải thuật**, **Đề tài 08**: *Hệ thống Tìm đường & Điều phối Giao hàng Tối ưu*.
> Cấu trúc dữ liệu chính: **đồ thị có trọng số** (danh sách kề), **Min-Heap tự cài**, **ngăn xếp** (hoàn tác), **cây Trie** (tìm kiếm). Thuật toán: **Dijkstra** (3 phiên bản), **A\***, **BFS/DFS**, **Bellman-Ford**, **Yen (K tuyến ngắn nhất)**, **TSP bitmask**, **tìm kiếm cục bộ** (relocate, 2-opt) cho điều phối, **Dijkstra phụ thuộc thời gian** (giờ cao điểm).

Ứng dụng web chạy trên máy cá nhân: **backend viết hoàn toàn bằng C++17** (mọi thuật toán chạy ở C++), giao diện HTML/CSS/JavaScript thuần do chính chương trình C++ phục vụ. Không cần cài Node.js, Python hay cơ sở dữ liệu.

Phiên bản này nâng phần tài khoản lên như một **website giao hàng thật**: đăng ký / đăng nhập / quên mật khẩu bằng mã OTP, **3 vai trò + khách vãng lai** với ma trận quyền kiểm tra ở mọi API, đơn hàng theo **máy trạng thái** (sai thì HTTP 409), mã giao hàng 4 số, sổ COD, mã giảm giá, hạng thân thiết, khiếu nại, thông báo và nhật ký kiểm toán. Các thuật toán cốt lõi giữ nguyên, 6 bộ kiểm thử cũ vẫn đạt (xem [Thay đổi so với bản gốc](#thay-đổi-so-với-bản-gốc)). Có thêm **bản một file** `dieu-phoi-giao-hang.html` mở thẳng bằng trình duyệt, không cần server (xem [Bản một file HTML](#bản-một-file-html)).

**Vòng 4: bỏ vai trò điều phối viên, ghép đơn tự động kiểu Grab.** Khách đặt đơn xong, hệ thống tự tìm **shipper gần kho nhất** (Dijkstra theo thời gian, đúng loại xe, có tính giờ cao điểm) và gửi **lời mời nhận đơn có đồng hồ đếm ngược** (mặc định 45 giây). Shipper bấm **Nhận đơn** thì mới đi giao; bấm *Bỏ qua* hoặc để hết giờ thì lời mời chuyển cho shipper gần kế tiếp; hết người thì khách được báo và có nút *Tìm lại shipper*. Khách thấy shipper chạy trên bản đồ, thẻ tài xế (tên, xe, biển số, điểm), huỷ đơn kèm lý do, đánh giá shipper; shipper đánh giá lại khách. Quyền của điều phối viên cũ chuyển sang quản trị viên. Chi tiết ở mục [Ghép đơn tự động kiểu Grab](#ghép-đơn-tự-động-kiểu-grab) và [Giả định](#giả-định) (35–54).

![Theo dõi ca giao: shipper di chuyển trên bản đồ](docs/screenshots/tracking.png)

---

## Mục lục

- [Tính năng](#tính-năng)
- [Ảnh chụp màn hình](#ảnh-chụp-màn-hình)
- [Cài đặt và chạy](#cài-đặt-và-chạy)
- [Cấu trúc thư mục](#cấu-trúc-thư-mục)
- [Kiến trúc](#kiến-trúc)
- [Tài khoản và bảo mật](#tài-khoản-và-bảo-mật)
- [Ma trận phân quyền](#ma-trận-phân-quyền)
- [Ghép đơn tự động kiểu Grab](#ghép-đơn-tự-động-kiểu-grab)
- [Vòng đời đơn hàng](#vòng-đời-đơn-hàng)
- [Thuật toán và độ phức tạp](#thuật-toán-và-độ-phức-tạp)
- [Định dạng file dữ liệu](#định-dạng-file-dữ-liệu)
- [Kịch bản demo khi bảo vệ](#kịch-bản-demo-khi-bảo-vệ)
- [Kịch bản demo theo vai trò](#kịch-bản-demo-theo-vai-trò)
- [REST API](#rest-api)
- [Kiểm thử](#kiểm-thử)
- [Bản một file HTML](#bản-một-file-html)
- [Thay đổi so với bản gốc](#thay-đổi-so-với-bản-gốc)
- [Phân công](#phân-công)
- [Đưa lên GitHub](#đưa-lên-github)
- [Giả định](#giả-định)

---

## Tính năng

| Trang | Chức năng | Module C++ |
|---|---|---|
| **Bản đồ** | Thêm / sửa / xoá **điểm** và **đoạn đường** ngay trên bản đồ (bấm để đặt điểm, bấm 2 điểm để nối đường), đặt kho, in danh sách kề, tạo bản đồ mới (vô hướng / có hướng). **Báo kẹt xe** (×1,5 / ×2 / ×3) hoặc **đóng đường**, mọi thuật toán tự tránh. **Hoàn tác / làm lại** mọi thay đổi (Ctrl+Z, Ctrl+Y) | `Graph`, `History` |
| **Tìm đường** | Chọn điểm đi, đến, **loại xe** (xe máy / ô tô / xe tải), **tiêu chí** (ngắn nhất / nhanh nhất / rẻ nhất). Chạy cùng lúc **6 thuật toán** (3 bản Dijkstra, **A\***, Bellman-Ford, BFS) và so sánh kết quả, **số đỉnh phải xét**, thời gian; xem lại **thứ tự chốt đỉnh** của Dijkstra; gợi ý **3 tuyến thay thế** (thuật toán Yen); dự toán cước; chọn **giờ đi** để tính giờ cao điểm, kèm biểu đồ thời gian đi theo giờ trong ngày | `ShortestPath`, `MinHeap`, `BellmanFord`, `Traversal`, `Estimator` |
| **Mô phỏng** | Chạy **từng bước** Dijkstra (Min-Heap tự cài), A\*, BFS, DFS, Bellman-Ford do C++ ghi lại: **mã giả** sáng dòng đang chạy, **cây Min-Heap và mảng heap** sau mỗi thao tác (hoặc hàng đợi / ngăn xếp), bảng dist – prev, bản đồ tô đỉnh đã chốt / đang chờ / cạnh vừa xét. Chạy, tạm dừng, lùi, kéo thanh bước, phím ← → | `Trace`, `MinHeap` |
| **Duyệt mạng** | BFS, DFS đệ quy, DFS dùng stack (thứ tự thăm và cây duyệt); thành phần liên thông, liên thông mạnh (Kosaraju); **vùng giao hàng** trong k chặng; **chia vùng cho nhiều kho** (BFS đa nguồn) | `Traversal` |
| **Chi phí** | **Bellman-Ford** với cạnh âm (tuyến được trợ giá), **phát hiện và tô đỏ chu trình âm**, so sánh từng điểm với Dijkstra để thấy Dijkstra sai ở đâu; **dự toán** chi phí và thời gian tuyến nhiều điểm | `BellmanFord`, `Estimator` |
| **Điều phối** | Quản lý **đơn hàng** (khối lượng, hạn giao theo giờ, đơn gấp, lọc theo trạng thái) và **shipper** (tải trọng, loại xe), đặt **giờ bắt đầu ca**. Chạy **9 phương án**, trong đó có **Theo hạn giao + tìm kiếm cục bộ** (relocate giữa các shipper và 2-opt, ít đơn trễ nhất rồi ít km nhất, khởi đầu từ 5 lời giải), và so sánh quãng đường, số đơn trễ hạn, số đơn chưa giao, thời gian chạy; vẽ lộ trình từng shipper; **áp dụng** phương án để tạo chuyến giao | `Dispatcher`, `MinHeap`, `Operations` |
| **Theo dõi** | **Mô phỏng ca giao** theo đồng hồ (nhanh ×60 / ×300 / ×900, kéo thanh thời gian): shipper di chuyển trên bản đồ, đơn tự chuyển *Đã giao* khi tới nơi, đánh dấu trễ hạn; **báo giao thất bại kèm lý do**, đưa đơn về hàng chờ để điều phối lại giữa ca; **nhật ký ca** (áp dụng phương án, giao, thất bại, hoàn kho, huỷ, shipper nghỉ, đổi tuyến) chạy theo đồng hồ; **in phiếu giao hàng** cho từng shipper | `Operations` |
| **Nghiệp vụ giao hàng** | Mỗi đơn có **người nhận, số điện thoại, tiền thu hộ (COD)**; kiểm tra số điện thoại (10 số, bắt đầu bằng 0), COD 0–50 triệu và bắt buộc có số điện thoại. **Biểu phí** tính theo quãng đường ngắn nhất từ kho (Dijkstra): 15.000 đ cho 2 km đầu + 4.000 đ/km, +2.500 đ/kg vượt 3 kg, đơn gấp +30%, phí thu hộ 0,8% (tối thiểu 5.000 đ), làm tròn lên 500 đ; **báo giá ngay khi nhập đơn**. **6 lý do thất bại** (vắng nhà, sai địa chỉ, từ chối nhận, hàng hư hỏng, hẹn giao lại, khác): *từ chối nhận* và *hàng hư hỏng* hoàn kho ngay, đơn hoàn thu 50% cước. **Shipper đang chạy chuyến trước** thì chuyến mới chỉ xuất phát khi người đó về tới kho (điều phối giữa ca tính đúng giờ tới). **Tài chính ca**: doanh thu, chi phí vận hành, lợi nhuận (hiện tại và dự kiến cuối ca), COD đã thu / đang trên xe / chưa giao; **đối soát COD** từng shipper (tiền phải nộp, đang giữ, lãi gộp) | `Pricing`, `Operations`, `Dispatcher`, `FileIO` |
| **Tình huống đặc biệt** | **Khách huỷ đơn** (khi đang chờ hoặc đang giao, đơn bị bỏ khỏi chuyến). **Giao thất bại 2 lần thì hoàn hàng về kho**, không đưa lại hàng chờ nữa. **Shipper nghỉ đột xuất** giữa ca: chuyến dừng ở điểm kế tiếp, đơn chưa giao quay về hàng chờ, người đó không được điều phối tới khi có mặt lại. **Đóng đường / kẹt xe giữa ca**: chuyến nào có đoạn phía trước bị đóng tự tìm đường khác (Dijkstra theo thời gian, giữ thứ tự giao), chuyến còn lại cập nhật giờ tới; đơn không còn đường thì trả về hàng chờ. **Đơn nặng hơn mọi xe**: nút chia thành nhiều kiện vừa xe lớn nhất. Áp dụng phương án có đơn trễ trong khi có phương án khác không trễ thì hỏi lại | `Operations`, `WebServer` |
| **Phân tích** (mở rộng) | **Đoạn đường / giao lộ trọng yếu**: thuật toán **Tarjan** tìm cầu và khớp bằng một lần DFS (gốc ở kho), cho biết đóng chỗ đó thì bao nhiêu điểm và đơn mất đường; nút **thử đóng đoạn này** để xem ảnh hưởng. **Mạng đường tối thiểu**: **Kruskal** (sắp xếp + DSU) so với **Prim** (Min-Heap tự cài), vẽ cây khung lên bản đồ. **Gợi ý vị trí kho**: **Floyd–Warshall** tính khoảng cách mọi cặp điểm, xếp hạng điểm theo tổng km tới các đơn (1-median) và tìm **tâm đồ thị** (1-center); đặt làm kho bằng một nút bấm | `Analysis` |
| **Tài khoản** | **Đăng ký** khách hàng (dùng được ngay) và shipper (khai loại xe, tải trọng, biển số; chờ duyệt). Quản trị viên không tự đăng ký được. Kiểm tra dữ liệu ở cả trình duyệt và server (báo lỗi từng ô), email / SĐT không được trùng, chống spam bằng giới hạn 20 lần đăng ký / giờ mỗi IP và ô bẫy (honeypot). **Đăng nhập** bằng tên đăng nhập, email hoặc SĐT; *ghi nhớ đăng nhập* 30 ngày; hiện / ẩn mật khẩu; thông báo lỗi chung chung (không lộ tài khoản có tồn tại hay không); **khoá luỹ tiến** (sai 5 lần khoá 60 giây, lần khoá sau gấp đôi, tối đa 15 phút); đăng nhập xong vào thẳng trang của vai trò. **Quên mật khẩu**: mã OTP 6 số, hết hạn sau 10 phút, dùng một lần, chỉ lưu bản băm, gửi vào **hộp thư giả lập** (xem ngay trên giao diện). **Hồ sơ**: sửa tên / email / SĐT, đổi mật khẩu, xem **các thiết bị đang đăng nhập** và đăng xuất từng thiết bị. Khách có **sổ địa chỉ** (địa chỉ mặc định dùng khi tạo đơn); shipper bật / tắt **sẵn sàng nhận đơn**, chọn **vị trí đang đứng** và sửa thông tin xe | `Auth`, `Commerce`, `WebServer` |
| **Phân quyền 3 vai trò + khách vãng lai** | **Quản trị viên**, **Shipper**, **Khách hàng** và **Khách** (chưa đăng nhập: trang giới thiệu, báo giá thử, tra cứu đơn bằng mã đơn + SĐT). Mọi API đi qua **một bảng quy tắc** (`canAccess`); server không khởi động nếu có API thiếu quy tắc. Lọc dữ liệu theo người dùng (**chống IDOR**): khách chỉ thấy đơn, hoá đơn, khiếu nại của mình; shipper chỉ thấy chuyến và sổ COD của mình. Cookie phiên HttpOnly + SameSite=Strict, mã **CSRF** theo phiên kèm kiểm tra Origin, mọi chuỗi đưa lên giao diện đều được escape (chống **XSS**), lỗi nội bộ chỉ trả thông báo chung, tiêu đề bảo mật CSP / X-Frame-Options / nosniff. Xem [Ma trận phân quyền](#ma-trận-phân-quyền) | `Auth`, `WebServer` |
| **Vòng đời tài khoản & kiểm toán** | *Chờ duyệt → Hoạt động ⇄ Bị khoá*, *Vô hiệu hoá*; khoá, vô hiệu hoá hay từ chối hồ sơ đều phải ghi lý do; tài khoản bị khoá bị đăng xuất khỏi mọi thiết bị và nhận email báo. **Hàng chờ duyệt shipper** xếp bằng **Min-Heap** (đăng ký sớm duyệt trước). **Nhật ký kiểm toán**: ai, lúc nào, làm gì, trên đối tượng nào; lọc theo người, hành động, khoảng ngày; **xuất CSV** (chặn chèn công thức khi mở bằng Excel) | `Auth`, `Support` |
| **Đơn hàng thương mại** | **Máy trạng thái**: Mới → Chờ giao → Đã phân công → Đang giao → Đã giao, hoặc Thất bại → Giao lại / Hoàn kho, và Huỷ; chuyển sai bị từ chối bằng **HTTP 409** kèm lý do. Shipper **nhận hoặc từ chối chuyến**; giao xong phải nhập **mã 4 số** do người nhận đọc (sai 6 lần thì khoá 10 phút) và đúng số tiền thu hộ. **Báo giá = hoá đơn**: cước theo biểu phí, trừ giảm giá theo **hạng thân thiết** (Đồng / Bạc / Vàng / Kim cương) và **mã giảm giá** (phần trăm có trần hoặc số tiền; hạn dùng, tổng lượt, lượt mỗi khách, đơn tối thiểu); các khoản được lưu lúc đặt nên hoá đơn luôn khớp báo giá. **Phí huỷ**: miễn phí khi chưa phân công, 20% khi đã phân công, 50% khi đang giao. Mỗi khách tối đa 20 đơn chưa hoàn tất. Khách **đánh giá shipper** 1–5 sao sau khi nhận hàng | `OrderFlow`, `Commerce`, `Operations` |
| **Ghép đơn tự động kiểu Grab** | Đơn mới tự được mời cho **shipper gần kho nhất** (Dijkstra theo thời gian, đúng loại xe, có giờ cao điểm), **đếm ngược 45 giây**, *Nhận đơn* thì mới đi giao; *Bỏ qua* / hết giờ → người gần kế tiếp; hết người → báo khách, *Tìm lại shipper*, quá 10 phút tự huỷ. Khách thấy thẻ tài xế, đường shipper chạy tới kho trên bản đồ, huỷ có lý do, đánh giá hai chiều; shipper bật / tắt sẵn sàng, chọn vị trí, nhả đơn, xem thu nhập. Xem [Ghép đơn tự động kiểu Grab](#ghép-đơn-tự-động-kiểu-grab) | `WebOrders`, `ShortestPath`, `Dispatcher` |
| **Sổ COD** | Giao xong đơn thu hộ thì có bút toán *Đang giữ* → shipper **nộp tiền** (phiếu nộp) → quản trị viên **xác nhận số tiền đếm được**, chênh lệch được ghi lại → **chốt ca** của shipper | `OrderFlow` |
| **Khai giá, bảo hiểm, cân quy đổi, người trả cước** | Khách khai **giá trị hàng**: trên 1.000.000 đ thu **phí bảo hiểm 0,5%** giá trị (làm tròn lên 500 đ), dưới mức đó miễn phí. Nhập **dài × rộng × cao** (cm) thì cước tính theo **cân quy đổi** = D×R×C ÷ 6.000 (lấy số lớn hơn giữa cân thật và cân quy đổi), điều phối vẫn dùng cân thật để xếp tải. Chọn **người nhận trả cước**: shipper thu của người nhận *thu hộ + cước*, nhập sai số tiền bị từ chối. **Phí hoàn hàng** (50% cước vận chuyển) được tính và ghi vào đơn khi đơn về kho. Báo giá, hoá đơn, phiếu in đều hiện đủ các khoản | `Billing`, `Commerce`, `WebOrders` |
| **Khách tự phục vụ** | **Tự sửa đơn** khi chưa có shipper nhận (cước, bảo hiểm, mã giảm giá tính lại; hệ thống mời lại shipper từ đầu), **đặt lại** đơn cũ bằng một nút, đơn giao thất bại thì **hẹn giao lại** (đổi SĐT người nhận, lời nhắn cho shipper) hoặc **yêu cầu hoàn hàng** (báo trước phí hoàn). Hạn giao phải ở tương lai so với đồng hồ ca và trong 24 giờ | `WebOrders`, `OrderFlow` |
| **Ví đối soát khách hàng** | Sổ tiền giữa công ty và từng khách: cộng **tiền thu hộ** đã giao (chỉ rút được khi khoản COD đó đã được đối soát), **bồi thường**, khách **nộp bù**; trừ **cước người gửi trả**, **phí huỷ**, **phí hoàn**, các lần **chi trả**. Khách xem sao kê, số dư, số có thể rút; **quản trị viên** xem số dư mọi khách, chi trả (chuyển khoản bắt buộc mã giao dịch) hoặc ghi nhận nộp bù, không chi quá số có thể rút (`customer_ledger.txt`). Sao kê có **số dư luỹ kế từng dòng**, lọc *tiền vào / tiền ra / chờ đối soát*, lọc **theo khoảng ngày**, phân trang và **xuất CSV** (mở bằng Excel); nhân viên tìm khách không dấu và lọc *còn tiền / đang nợ / chờ đối soát*. **Hạn mức nợ phí**: khách nợ quá mức cấu hình (mặc định 500.000 đ) thì không tự đặt đơn mới (HTTP 409, báo rõ số nợ) cho tới khi nộp bù; nhân viên vẫn tạo đơn hộ được | `Billing`, `WebOrders` |
| **Bồi thường khiếu nại** | Nhân viên bồi thường vào ví khách ngay trong phiếu khiếu nại, **mỗi phiếu một lần**, có **trần** theo loại: trễ hạn ≤ cước (chỉ khi đơn thật sự giao trễ), hư hỏng / thất lạc ≤ giá trị khai (không khai giá thì ≤ 4 × cước, chỉ khi hàng đã rời kho). Khách nhận thông báo, phiếu ghi rõ số tiền | `Billing`, `Support` |
| **Điều phối tay & thu hồi chuyến (quản trị viên)** | Trang *Đơn hàng* → *Chờ giao*: tích chọn nhiều đơn rồi **phân công cho một shipper** (thứ tự giao vẫn do thuật toán *Theo hạn giao* xếp, đơn quá tải trọng hoặc xe không tới được thì ở lại hàng chờ). Shipper không phản hồi thì quản trị viên **thu hồi chuyến / lời mời** chưa nhận kèm lý do: đơn về *Chờ giao*, không tính là shipper từ chối, shipper nhận thông báo | `WebOrders`, `Operations` |
| **Cảnh báo vận hành & doanh thu theo ngày** | Trang *Thống kê* của nhân viên có bảng **Cần xử lý**: đơn đang giao dự kiến trễ, đơn thất bại chờ quyết định, đơn mới chờ xác nhận quá 30 phút, đơn nặng hơn mọi xe, đơn hoả tốc chờ điều phối, chuyến chờ shipper nhận, phiếu nộp COD chờ đối soát, khiếu nại mở quá 24 giờ, khách đang nợ phí; bấm để mở đúng trang. Quản trị viên có thêm **doanh thu 14 ngày** (giờ Việt Nam), phí bảo hiểm, phí hoàn | `WebOrders` |
| **Điểm shipper** | Điểm 0–100 = 50% tỉ lệ đúng hạn + 30% điểm sao + 20% × (1 − 2 × tỉ lệ từ chối chuyến); thu nhập = 70% cước vận chuyển. Điều phối có thể bật *ưu tiên shipper điểm cao*; shipper tắt *sẵn sàng* hoặc báo nghỉ thì không được phân chuyến | `Commerce`, `WebServer` |
| **Khiếu nại & thông báo** | Khách gửi khiếu nại gắn với một đơn, hai bên trao đổi trong phiếu, quản trị viên chuyển *Mới → Đang xử lý → Đã giải quyết*. **Chuông thông báo** trong app: đơn đổi trạng thái, có chuyến mới, hồ sơ được duyệt, khiếu nại được trả lời... | `Support` |
| **Danh sách & báo cáo theo vai trò** | Danh sách tài khoản, đơn, khiếu nại, nhật ký: **tìm không dấu** (chỉ mục Trie `TextIndex`), lọc, sắp xếp ổn định, phân trang. Trang **Thống kê** hiện số liệu riêng của từng vai trò | `Trie`, `WebServer` |
| **Cấu hình** | Quản trị viên sửa biểu phí, các hạng thân thiết, tỉ lệ phí huỷ, phần cước của shipper, số đơn mở tối đa, ưu tiên shipper điểm cao, chế độ mô phỏng, **phí bảo hiểm và mức miễn phí, hệ số cân quy đổi, trần bồi thường hàng không khai giá, hạn mức nợ phí của khách** (`data/config.txt`), **ghép đơn tự động** (bật / tắt, hạn trả lời lời mời, thời gian chờ trước khi tự huỷ, tốc độ giờ ca) | `Commerce`, `Pricing` |
| **Báo cáo** | Tỉ lệ đúng hạn, phân bố trạng thái đơn, **tài chính ca**, **đối soát thu hộ theo shipper**, **thống kê lý do thất bại**, quãng đường / chi phí / số đơn theo shipper, **lịch sử điều phối**, bảng chi tiết đơn có lọc (người nhận, COD, cước), **xuất CSV** đủ cột nghiệp vụ (mở bằng Excel) | `Operations`, `Pricing` |
| **Hiệu năng** | Benchmark 3 phiên bản Dijkstra trên đồ thị ngẫu nhiên tới hàng chục nghìn đỉnh, biểu đồ và bảng số liệu; **Dijkstra so với A\*** trên 100 cặp điểm của bản đồ đang mở | `ShortestPath` |
| **Tệp** | Nhập / tải `map.txt`, `orders.txt`, `shippers.txt`; lưu bản đồ đang sửa lên server | `FileIO` |
| **Giờ cao điểm** | 7:00–8:30 và 17:00–18:30 (tăng / giảm dần trong 60 phút). Mỗi đoạn đường có **hệ số cao điểm** riêng (đường trung tâm ×2–2,5, vành đai ×1,5, cao tốc ×1,2); xe máy chỉ chịu một nửa mức kẹt. **Dijkstra phụ thuộc thời gian** nên tuyến nhanh nhất lúc 7:30 có thể khác lúc 10:00; dự toán và điều phối tính giờ tới từng điểm theo giờ thực tế xe đi qua. Bật / tắt ở trang Tìm đường hoặc Điều phối. Trang Bản đồ có **lớp giao thông theo giờ** (kéo thanh giờ, đường đổi màu theo mức kẹt); trang Theo dõi tô đoạn kẹt theo đồng hồ ca | `Graph` (`RushProfile`), `ShortestPath`, `BellmanFord`, `Estimator`, `Dispatcher` |
| **Tổng quan** | Hàng đơn chờ giao xếp theo thứ tự ưu tiên (gấp, hạn sớm), đội shipper, tiến độ ca đang chạy, cảnh báo bản đồ rời rạc / có cạnh âm | `Dispatcher` |
| **Ô tìm kiếm & góc trên** | **Tìm địa điểm** theo tên, gõ không dấu vẫn ra (cây **Trie**), hoàn tác / làm lại, giao diện **sáng / tối / theo máy**; ảnh đại diện đội shipper (chấm xanh khi đang giao) | `Trie`, `History` |
| **Dữ liệu lớn** | Bộ **Đô thị mô phỏng**: 2.000 giao lộ, 3.493 đoạn đường, sông chỉ qua được ở 5 cây cầu, vành đai cấm xe máy, trung tâm cấm xe tải, 24 đơn hàng (sinh bằng `tools/gen_city.py`). Bản đồ tự chuyển sang vẽ bằng canvas | `FileIO` |
| **Giao diện kiểu app giao hàng** | Bản đồ phủ kín màn hình; ô tìm kiếm, thẻ nội dung, thanh chuyển trang ở đáy và nút bản đồ đều nổi bo tròn; ghim kho / điểm đến như app bản đồ, tuyến xanh có viền, shipper hiện bằng ảnh đại diện chạy trên bản đồ. Trên điện thoại, khung nội dung kéo lên / xuống được (3 nấc). Bản đồ: phóng to / căn khung có chuyển động mượt, lăn chuột hoặc bàn rê phóng theo vị trí con trỏ, **nháy đúp** để phóng to (Shift + nháy đúp thu nhỏ), kéo nhanh rồi thả thì bản đồ trôi tiếp. Tự tắt chuyển động nếu máy bật chế độ giảm chuyển động | |
| **Phím tắt** | `/` tìm, `1`–`9`, `0` chuyển trang, `F` vừa khung, `A` xem mọi điểm, `K` hiện km, `+` `−` phóng to, `Ctrl+Z` / `Ctrl+Y`, `?` xem danh sách | |

Ngoài web còn có **menu dòng lệnh** (`delivery --console`) với đủ chức năng chính.


**Mô hình đường và xe:**
- Mỗi đoạn đường có 3 trọng số: **km**, **phút** (ở tốc độ giới hạn), **phụ phí** (nghìn đồng, có thể **âm** = trợ giá), và danh sách **loại xe được phép đi**.
- Tốc độ thực tế = min(tốc độ giới hạn của đường, tốc độ tối đa của xe): xe máy 40, ô tô 60, xe tải 50 km/h.
- **Giờ cao điểm**: thời gian đi cạnh lúc t = thời gian thường × (1 + mức(t) × (hệ số cao điểm − 1) × độ nhạy xe), mức(t) từ 0 (vắng) tới 1 (đông nhất), độ nhạy xe máy 0,5, ô tô và xe tải 1. Thời gian đi thay đổi đủ chậm theo giờ xuất phát nên mạng thoả **FIFO** (đi sớm không bao giờ tới muộn hơn), nhờ vậy Dijkstra với nhãn = số phút đã đi vẫn cho kết quả đúng.
- Chi phí một cạnh = km × 5.000 đ + phụ phí.

## Ảnh chụp màn hình

| **So sánh phương án điều phối** | **Báo cáo ca giao** |
|---|---|
| ![](docs/screenshots/dispatch.png) | ![](docs/screenshots/reports.png) |
| **Tìm đường cho xe tải (vòng tránh đường cấm)** | **Tuyến thay thế (thuật toán Yen)** |
| ![](docs/screenshots/route.png) | ![](docs/screenshots/alternatives.png) |
| **Bellman-Ford: Dijkstra sai do cạnh âm** | **Chia vùng giao cho 2 kho (BFS đa nguồn)** |
| ![](docs/screenshots/bellman.png) | ![](docs/screenshots/explore.png) |
| **Benchmark 3 phiên bản Dijkstra** | **Tổng quan** |
| ![](docs/screenshots/bench.png) | ![](docs/screenshots/overview.png) |
| **Giờ cao điểm: 7:30 đi vòng tránh trung tâm, biểu đồ theo giờ đi** | |
| ![](docs/screenshots/rush.png) | |
| **Mô phỏng Dijkstra: mã giả, cây Min-Heap, bảng dist** | **A\* trên đô thị 2.000 điểm** |
| ![](docs/screenshots/lab.png) | ![](docs/screenshots/lab-astar.png) |
| **Lớp giao thông lúc 7:30** | **Điều phối 24 đơn trên đô thị lớn** |
| ![](docs/screenshots/traffic.png) | ![](docs/screenshots/city-dispatch.png) |
| **Tarjan: đoạn đường trọng yếu (đóng là 6 đơn mất đường)** | **Gợi ý vị trí kho (Floyd–Warshall)** |
| ![](docs/screenshots/analysis-critical.png) | ![](docs/screenshots/analysis-depot.png) |
| **Đóng đường giữa ca: chuyến tự tìm đường khác, shipper nghỉ đột xuất** | **Mạng đường tối thiểu (Kruskal / Prim) trên đô thị lớn** |
| ![](docs/screenshots/incident-reroute.png) | ![](docs/screenshots/analysis-mst.png) |
| **Nhập đơn có người nhận, COD, báo giá cước ngay** | **Báo giao thất bại: chọn lý do** |
| ![](docs/screenshots/business-order.png) | ![](docs/screenshots/business-fail.png) |
| **Nhật ký ca theo đồng hồ** | **Tài chính ca, đối soát COD, lý do thất bại** |
| ![](docs/screenshots/business-log.png) | ![](docs/screenshots/business-finance.png) |

**Tài khoản, phân quyền và nghiệp vụ thương mại** (chụp tự động bằng Playwright qua giao diện thật, đủ 35 ảnh trong `docs/screenshots/01-…35-*.png`). Từ vòng 4 các ảnh 09–52 chụp bằng tài khoản **quản trị viên** ở **chế độ thủ công** (tắt ghép tự động); luồng Grab mặc định nằm ở ảnh 53–67 bên dưới:

| **Khách vãng lai: trang giới thiệu, báo giá thử** | **Đăng ký: báo lỗi từng ô ở cả trình duyệt và server** |
|---|---|
| ![](docs/screenshots/01-guest-landing.png) | ![](docs/screenshots/03-register-validation.png) |
| **Đăng ký shipper (loại xe, tải trọng, biển số)** | **Shipper chờ duyệt đăng nhập: thông báo rõ ràng** |
| ![](docs/screenshots/06-register-shipper.png) | ![](docs/screenshots/07-login-pending-shipper.png) |
| **Đăng nhập: tên / email / SĐT, ghi nhớ, tài khoản dùng thử** | **Khách tạo đơn: COD, mã giảm giá, báo giá = hoá đơn** |
| ![](docs/screenshots/08-login.png) | ![](docs/screenshots/09-customer-create-order.png) |
| **Quản trị viên (chế độ thủ công): hàng đơn mới chờ xác nhận** | **Quản trị viên: so sánh phương án, áp dụng** |
| ![](docs/screenshots/11-admin-queue.png) | ![](docs/screenshots/12-admin-plan.png) |
| **Shipper: chuyến chờ nhận (chế độ thủ công)** | **Shipper: nhập sai mã giao 4 số bị từ chối** |
| ![](docs/screenshots/13-shipper-offer.png) | ![](docs/screenshots/14-shipper-deliver-wrong-code.png) |
| **Shipper: sổ COD, nộp tiền** | **Quản trị viên: đối soát COD, ghi chênh lệch** |
| ![](docs/screenshots/15-shipper-cod.png) | ![](docs/screenshots/17-admin-cod-reconcile.png) |
| **Khách: chi tiết đơn, dòng thời gian, hoá đơn** | **Quản trị viên trả lời khiếu nại** |
| ![](docs/screenshots/18-customer-order-detail.png) | ![](docs/screenshots/19-admin-complaint.png) |
| **Chuông thông báo** | **Hồ sơ, thiết bị đang đăng nhập, sổ địa chỉ** |
| ![](docs/screenshots/20-customer-notifications.png) | ![](docs/screenshots/21-customer-profile.png) |
| **Khách vãng lai tra cứu đơn (mã đơn + SĐT)** | **Quên mật khẩu: mã OTP trong hộp thư giả lập** |
| ![](docs/screenshots/23-guest-track.png) | ![](docs/screenshots/25-reset-mailbox.png) |
| **Quản trị viên: tài khoản, hàng chờ duyệt shipper** | **Quản trị viên: nhật ký kiểm toán, xuất CSV** |
| ![](docs/screenshots/28-admin-accounts.png) | ![](docs/screenshots/29-admin-audit.png) |
| **Quản trị viên: cấu hình biểu phí, hạng, mã giảm giá** | **Thống kê theo vai trò** |
| ![](docs/screenshots/30-admin-settings.png) | ![](docs/screenshots/31-admin-summary.png) |
| **Giao diện tối (quản trị viên)** | **Điện thoại (khách hàng)** |
| ![](docs/screenshots/33-dark-admin-queue.png) | ![](docs/screenshots/35-mobile-customer.png) |

**Vòng 4: ghép đơn tự động kiểu Grab** (15 ảnh `53`–`67`, chụp tự động qua giao diện thật với hai khách và ba shipper chạy cùng lúc):

| **Khách đặt đơn: không còn bước chờ xác nhận** | **Khách thấy "đang tìm shipper gần bạn nhất" (không biết ai đang được mời)** |
|---|---|
| ![](docs/screenshots/53-grab-khach-form-dat-don.png) | ![](docs/screenshots/54-grab-khach-dang-tim-shipper.png) |
| **Shipper gần nhất nhận lời mời: đếm ngược, quãng đường, thu nhập, điểm khách** | **Shipper bỏ qua: lý do có sẵn lựa chọn nhanh, lời mời chuyển cho người kế** |
| ![](docs/screenshots/55-grab-shipper-loi-moi-dem-nguoc.png) | ![](docs/screenshots/56-grab-shipper-bo-qua-hoi-ly-do.png) |
| **Người kế tiếp đã nhận đơn** | **Khách thấy thẻ tài xế, mã nhận hàng, shipper chạy tới kho trên bản đồ** |
| ![](docs/screenshots/57-grab-shipper-da-nhan-don.png) | ![](docs/screenshots/58-grab-khach-the-tai-xe.png) |
| **Giao bằng mã 4 số do khách đọc** | **Shipper đánh giá khách (đánh giá hai chiều)** |
| ![](docs/screenshots/59-grab-shipper-nhap-ma-giao.png) | ![](docs/screenshots/60-grab-shipper-danh-gia-khach.png) |
| **Khách đánh giá shipper trong chi tiết đơn** | **Hết shipper: khách được báo, có nút *Tìm lại shipper*** |
| ![](docs/screenshots/61-grab-khach-chi-tiet-danh-gia.png) | ![](docs/screenshots/62-grab-khach-chua-co-shipper.png) |
| **Huỷ đơn có lý do (miễn phí khi chưa ai nhận)** | **Quản trị viên: cấu hình ghép đơn tự động** |
| ![](docs/screenshots/63-grab-khach-huy-co-ly-do.png) | ![](docs/screenshots/64-grab-admin-cai-dat-ghep-don.png) |
| **Quản trị viên: đội shipper (sẵn sàng / đang giao, vị trí)** | **Quản trị viên: hàng chờ, ai đang được mời** |
| ![](docs/screenshots/65-grab-admin-dieu-phoi.png) | ![](docs/screenshots/66-grab-admin-hang-cho.png) |

**Nghiệp vụ mở rộng** (bản 3; 15 ảnh `docs/screenshots/36-…50-*.png`, chụp tự động qua giao diện thật):

| **Khách khai giá, kích thước kiện, người nhận trả cước** | **Đơn có nút sửa / hẹn giao lại / hoàn hàng / đặt lại** |
|---|---|
| ![](docs/screenshots/36-customer-declared-value.png) | ![](docs/screenshots/37-customer-orders-actions.png) |
| **Quản trị viên phân công tay nhiều đơn cho một shipper** | **Chuyến chờ shipper nhận: nút Thu hồi** |
| ![](docs/screenshots/38-admin-manual-assign.png) | ![](docs/screenshots/39-admin-recall-trip.png) |
| **Shipper: số tiền phải thu gồm cước người nhận trả** | **Khách hẹn giao lại đơn thất bại** |
| ![](docs/screenshots/40-shipper-collect.png) | ![](docs/screenshots/42-customer-redeliver.png) |
| **Bồi thường khiếu nại có trần theo giá trị khai** | **Ví đối soát của khách (quản trị viên chi trả)** |
| ![](docs/screenshots/44-admin-compensate.png) | ![](docs/screenshots/48-admin-wallet-after.png) |
| **Bảng Cần xử lý của quản trị viên** | **Doanh thu 14 ngày, phí bảo hiểm, phí hoàn** |
| ![](docs/screenshots/46-admin-alerts.png) | ![](docs/screenshots/49-admin-summary-daily.png) |

**Vòng hoàn thiện** (2 ảnh `51`, `52`; mọi ảnh 01–50 đã chụp lại với thanh chuyển trang có mục **Ví**):

| **Sao kê lọc theo ngày, số dư luỹ kế, xuất CSV** | **Hạn mức nợ phí của khách trong cấu hình** |
|---|---|
| ![](docs/screenshots/51-admin-statement-filter.png) | ![](docs/screenshots/52-admin-settings-debt-limit.png) |
| **Khách đang nợ: ví báo hạn mức** | **Điện thoại: thanh đáy chia đều 6 mục** |
| ![](docs/screenshots/43-customer-wallet.png) | ![](docs/screenshots/35-mobile-customer.png) |

### Giao diện v6: gọn hơn, rõ thứ tự ưu tiên

| Trước | Sau |
|---|---|
| ![Trước](docs/screenshots/68-ui-truoc-tong-quan.png) | ![Sau](docs/screenshots/69-ui-sau-tong-quan.png) |

- **Cột trái chia mục thu gọn được** (accordion): *Cảnh báo*, *Hàng chờ giao*, *Đội shipper*. Trạng thái mở / đóng được nhớ lại, không tự bật lại khi dữ liệu cập nhật. Hàng chờ chỉ hiện 5 đơn đầu, kèm liên kết "Xem thêm".
- **Thẻ thống kê** có biểu tượng trong ô màu, con số lớn; thứ cần chú ý đổi sang màu đỏ kèm cờ ("3 gấp", "không có ai"). Thẻ *Ca đang chạy* nền xanh đậm cố định ở cả chế độ sáng và tối.
- **Thanh chuyển trang** gọn: chỉ biểu tượng, trang đang mở bung ra kèm tên, các nhóm (vận hành | bản đồ & thuật toán | báo cáo | tiền & hỗ trợ) cách nhau bằng vạch mảnh, rê chuột hiện tên. Nút bản đồ và thước tỉ lệ nằm trên thanh, không còn bị che.
- **Bản đồ:** đường dày và rõ hơn; **đường cấm xe tải vẽ gạch rời** (phân biệt được cả khi không nhìn màu); điểm có đơn gấp có **vòng vàng nhấp nháy**; chú giải là một viên thuốc mảnh ngang. Có tôn trọng `prefers-reduced-motion`.
- Chỉ đổi CSS và giao diện (`web/css/style.css`, `web/js/app.js`, `web/js/pages/overview.js`), không đụng thuật toán hay API. Giao diện dùng CSS thuần với biến màu ở `:root`, không dùng Tailwind.

### Giao diện v7: kính mờ + SaaS sạch (phân tích UX và design system)

![Tổng quan v7](docs/screenshots/73-ui2-tong-quan-bento.png)

**Phân tích UX của bản trước (v6) và cách v7 xử lý**

| Điểm yếu | Hậu quả với người điều phối | Cách giải quyết trong v7 |
|---|---|---|
| Ô tìm chỉ tìm *địa điểm*; mã đơn, shipper phải đi qua từng trang | Mất 3 đến 4 cú bấm để mở một đơn gấp | **Tìm toàn cục Ctrl+K / ⌘K**: gộp đơn (theo mã, tên người nhận, SĐT), shipper, địa điểm và trang, có nhóm và điều hướng bằng phím |
| Bốn thẻ thống kê chỉ cho *con số hiện tại*, không có xu hướng | Không biết hôm nay tốt hay xấu hơn hôm qua | **Bento** có sparkline 14 ngày và **% so với hôm qua** cho doanh thu, đơn giao, COD |
| Tiến độ ca nằm trong một dòng chữ | Phải đọc mới biết ca đang tới đâu | **Thẻ ca** có thanh tiến trình động, % hoàn thành, doanh thu, COD, đơn đang trên đường |
| Hàng chờ chỉ có chip giờ; "gấp" và "quá hạn" khó phân biệt | Đơn trễ bị chìm giữa các đơn khác | Thẻ nhỏ có huy hiệu **Quá hạn / Gấp / Thường**, viền màu theo mức độ, nút nhanh *Điều phối ngay* và *Xem chi tiết* (hiện khi rê chuột hoặc focus bàn phím, luôn hiện trên màn cảm ứng) |
| Chuông thông báo là một danh sách phẳng | Lỗi khẩn lẫn với thông báo thường | **Trung tâm thông báo** có tab *Khẩn / Thành công / Thông tin* kèm số đếm, vạch màu theo mức độ |
| Trạng thái ca và kết nối nằm rải rác | Không biết hệ thống còn sống không | Hàng chip dưới ô tìm: *Ca đang chạy*, *n chờ*, *n giao*, *sự cố*, chấm trạng thái hệ thống (đỏ nhấp nháy khi mất kết nối) |
| Bản đồ không cho tắt bớt thông tin | Rối khi chỉ cần xem một lớp | **Thanh công cụ nổi** bật / tắt lớp *Lộ trình shipper*, *Đường cấm tải*, *Vùng nội thành* (nhớ lựa chọn) |
| Thanh dưới phẳng, khó đoán trang | Phải đọc nhãn | **Dock nổi kiểu macOS**: biểu tượng phóng to khi rê chuột, lân cận phóng nhẹ, chú thích tên nổi lên, trang hiện tại bung ra kèm tên |

**Design system (biến CSS ở `:root` trong `web/css/style.css`, có sẵn bản tối)**

| Nhóm | Token | Giá trị (sáng / tối) | Dùng cho |
|---|---|---|---|
| Màu chính | `--brand` / `--brand-deep` / `--brand-soft` | `#00a862` / `#00824c` / `#e1f5eb` (tối: `#2bd18a`, `#4fe0a0`, `#13352a`) | Hành động chính, trạng thái tốt |
| Phụ trợ | `--emerald` / `--emerald-deep` | `#10b981` / `#047857` | Tiến độ, chỉ số tăng |
| Đường / thông tin | `--road` / `--road-soft` | `#1a6fe0` / `#e8f0fd` | Lộ trình, đơn đang giao |
| Cảnh báo gấp | `--signal` (`--amber`) / `--signal-soft` | `#f5a400` / `#fff2d4` | Đơn gấp, chờ |
| Lỗi / khẩn | `--stop` (`--rose`) / `--stop-soft` | `#e3372b` / `#fdeceb` | Quá hạn, mất kết nối |
| Nền | `--canvas` / `--surface` / `--surface-2` | `#f1f3f4` / `#fff` / `#f3f5f6` (tối: `#0e1215`, `#161b20`, `#1f262c`) | Lớp nền, thẻ |
| Kính | `--glass`, `--glass-strong`, `--glass-blur` | nền 74% / 88% độ đặc + `blur(18px) saturate(1.7)` + viền sáng 1px | Thanh trên, thẻ bên trái, dock, nút bản đồ |
| Bo góc | `--r-sheet` / `--r-card` / `--r-ctl` | 24px / 16px / 12px (thẻ bento 18px, huy hiệu 999px) | Khung, thẻ, ô nhập |
| Bóng đổ | `--shadow-card` / `--shadow-float` / `--shadow-pop` | `0 1px 2px` + `0 6px 20px -8px` / `0 10px 30px -8px` / `0 18px 44px -10px` (mờ 16 đến 30%) | Thẻ nổi, lớp phủ, menu |
| Chữ | `--font` | Be Vietnam Pro 400/500/600/700, con số `tabular-nums` | Tiêu đề 15 đến 30px đậm 700 đến 800, nhãn 11 đến 12px đậm 600 |
| Chuyển động | `--ease`, `--spring` | `cubic-bezier(.2,.8,.2,1)`, `(.34,1.4,.64,1)` | Hover nổi 2 đến 3px, bấm lún `scale(.97)`; tắt khi `prefers-reduced-motion` |

Kính mờ chỉ bật khi trình duyệt hỗ trợ `backdrop-filter` (có `@supports`), các menu thả xuống dùng nền đặc vì lọc mờ không lồng nhau được. Phần thu gọn dùng `<details>`; phím tắt mới: **Ctrl+K / ⌘K** (tìm toàn cục), `/` (tìm nhanh).

| Tìm toàn cục | Trung tâm thông báo | Lớp bản đồ: vùng nội thành |
|---|---|---|
| ![](docs/screenshots/75-ui2-tim-kiem-ctrl-k.png) | ![](docs/screenshots/77-ui2-trung-tam-thong-bao.png) | ![](docs/screenshots/78-ui2-lop-ban-do-noi-thanh.png) |

| Hàng chờ dạng thẻ nhỏ | Dock nổi | Chế độ tối |
|---|---|---|
| ![](docs/screenshots/74-ui2-hang-cho-the-nho.png) | ![](docs/screenshots/79-ui2-dock-noi.png) | ![](docs/screenshots/80-ui2-che-do-toi.png) |

### Giao diện v8: bớt rối ở các trang dày thông tin

Rà lại mọi trang của cả ba vai trò theo số điều khiển và số trường nhìn thấy cùng lúc, rồi gỡ rối năm trang dày nhất. **Không bỏ tính năng nào**: thứ phụ được xếp vào tab, ô thu gọn hoặc menu ⋯, thứ chính vẫn nằm ở trên cùng. Chỉ đổi giao diện (`web/`), thuật toán và API giữ nguyên.

| Trang | Trước | Sau |
|---|---|---|
| **Cài đặt** (quản trị) | Một cuộn dài: 6 nhóm tham số, hạng thành viên và bảng mã giảm giá đặt cạnh nhau (khoảng 40 ô nhập cùng lúc) | 6 tab: *Biểu phí, Bảo hiểm, Huỷ & vận hành, Ghép đơn, Hạng thành viên, Mã giảm giá*; mỗi lần chỉ thấy một nhóm, nút *Lưu cấu hình* luôn nằm dưới nhóm đang xem và vẫn lưu cả bộ cấu hình |
| **Tài khoản** | Mỗi dòng 5 đến 7 nút (Duyệt, Từ chối, Khoá, Vô hiệu hoá, Xoá, Sửa, Đăng nhập…), hàng chờ duyệt luôn chiếm chỗ, 6 nút lọc trạng thái | Mỗi dòng chỉ hiện việc chính (*Duyệt / Từ chối* hoặc *Sửa*), thao tác nặng (*Khoá, Vô hiệu hoá, Xoá*) nằm trong menu ⋯; trạng thái lọc bằng một ô chọn có số đếm; hàng chờ duyệt chỉ hiện khi có người chờ; bỏ cột "Đăng nhập" (thông tin chuyển xuống dưới tên đăng nhập) |
| **Báo cáo** | Bốn bảng liên tiếp (theo shipper, đối soát COD, lý do thất bại, lịch sử) và bảng đơn 11 cột | Một khối có 4 tab; bảng đơn mặc định 8 cột, nút *Hiện thêm cột* mở thêm *Shipper / Dự kiến / Giao lúc*; chữ biểu phí thu vào mục "Biểu phí đang áp dụng" |
| **Điều phối** | Form thêm đơn luôn mở, 5 ô chọn ca nằm trên cùng, trước cả danh sách đơn | Nút *Điều phối* kèm một dòng tóm tắt ca; kho, giờ bắt đầu, loại xe, quay về kho, giờ cao điểm gom vào mục *Tuỳ chọn ca*; *Thêm đơn* thu gọn (tự mở khi sửa đơn hoặc bấm điểm trên bản đồ) |
| **Hồ sơ** (shipper, khách) | Thông tin cá nhân, đổi mật khẩu, xe, thống kê, hạng, thiết bị xếp liền thành một cột dài | Mỗi nhóm là một mục thu gọn, *Đổi mật khẩu* và *Thiết bị đang đăng nhập* đóng sẵn, trạng thái mở / đóng được nhớ khi dữ liệu cập nhật |

![Cài đặt](docs/screenshots/82-gon-cai-dat.png)

![Tài khoản](docs/screenshots/83-gon-tai-khoan.png)

![Báo cáo](docs/screenshots/84-gon-bao-cao.png)

![Điều phối](docs/screenshots/85-gon-dieu-phoi.png)

![Hồ sơ](docs/screenshots/86-gon-ho-so.png)

## Cài đặt và chạy

Yêu cầu: trình biên dịch **C++17** (g++ ≥ 8, clang ≥ 7, hoặc Visual Studio 2019 trở lên). Không cần thư viện ngoài: `cpp-httplib` (một file header) đã có sẵn trong `third_party/`.

### Cách 1: Make (Linux, macOS, Windows + MSYS2)

```bash
make            # biên dịch -> file chạy ./delivery (Windows: delivery.exe)
make run        # chạy web server
make test       # chạy toàn bộ kiểm thử
```

### Cách 2: CMake (mọi hệ điều hành, kể cả Visual Studio)

```bash
cmake -S . -B build
cmake --build build --config Release
./build/delivery            # Windows: build\Release\delivery.exe
cd build && ctest           # chạy kiểm thử
```

Với **Visual Studio**: *File → Open → Folder* rồi chọn thư mục dự án, VS tự nhận `CMakeLists.txt`. Chọn target `delivery.exe` và bấm Run.

### Cách 3: Biên dịch tay một dòng

```bash
# Linux / macOS
g++ -std=c++17 -O2 -Isrc -Ithird_party src/*.cpp -o delivery -pthread

# Windows (MinGW-w64 / MSYS2)
g++ -std=c++17 -O2 -Isrc -Ithird_party -D_WIN32_WINNT=0x0A00 src/*.cpp -o delivery.exe -lws2_32
```

> **Windows:** cần MinGW-w64 bản mới (khuyên dùng [MSYS2](https://www.msys2.org/): `pacman -S mingw-w64-ucrt-x86_64-gcc make`). Bản MinGW cũ đi kèm Dev-C++ / Code::Blocks thường không hỗ trợ C++17 và thread.

### Chạy

```bash
./delivery                    # mở http://localhost:8080 trên trình duyệt
./delivery --port 9000        # đổi cổng nếu 8080 đang bận
./delivery --host 0.0.0.0     # cho máy khác cùng mạng LAN truy cập
./delivery --console          # menu dòng lệnh, không cần trình duyệt
./delivery --no-demo          # tắt chế độ demo: không có hộp thư giả lập (mã OTP chỉ in ra nhật ký server)
```

Mở trình duyệt sẽ thấy **trang giới thiệu cho khách vãng lai** (báo giá thử, tra cứu đơn) và nút **Đăng nhập / Đăng ký**. Tài khoản dùng thử (bấm thẳng vào nút ở màn đăng nhập cũng được):

| Vai trò | Tên đăng nhập | Mật khẩu | Vào thẳng trang |
|---|---|---|---|
| Quản trị viên | `admin` | `admin123` | Tổng quan (mọi chức năng: đơn, đội xe, ghép đơn, COD, khiếu nại, Tài khoản, Nhật ký, Cấu hình) |
| Shipper | `tuan`, `binh`, `cuong` | `shipper123` | Chuyến của tôi |
| Shipper chờ duyệt | `ctv_hung` | `Hung@2026` | Không đăng nhập được tới khi được duyệt (thông báo rõ lý do) |
| Khách hàng | `anphat`, `banhhoa` | `khach123` | Đơn của tôi (hạng Bạc / Đồng) |
| Khách hàng thân thiết | `khachvip` | `HuongViet@2026` | Đơn của tôi (hạng Kim cương, giảm 8% cước) |
| Khách hàng (chủ cửa hàng) | `cuahangmai` | `Mai@2026` | Đơn của tôi (khách thứ ba để thử nhiều khách đặt đơn cùng lúc) |

Mã giảm giá mẫu: `GIAM10` (giảm 10%, tối đa 20.000 đ), `FREESHIP20` (giảm 20.000 đ cho đơn từ 50.000 đ), `CHAOBAN` (đã hết hạn) và `HETLUOT` (đã hết lượt) để thử báo lỗi.

Các tài khoản mẫu cũ giữ mật khẩu cũ để tương thích; mật khẩu **đặt mới** phải theo chính sách mạnh hơn (xem [Tài khoản và bảo mật](#tài-khoản-và-bảo-mật)). Nếu thiếu `data/users.txt`, chương trình tự tạo tài khoản `admin` / `Admin@12345`. Nên đổi mật khẩu (menu tài khoản ở góc trên phải → *Đổi mật khẩu*) khi dùng thật.

Chương trình tự tìm thư mục `web/` và `data/`, nên có thể chạy từ thư mục gốc hoặc từ `build/`. Nếu cần, chỉ định bằng `--web <thư mục>` và `--data <thư mục>`.

## Cấu trúc thư mục

```
.
├── src/
│   ├── Graph.h / .cpp          # Đồ thị danh sách kề, loại xe, tiêu chí tối ưu
│   ├── Traversal.h / .cpp      # BFS, DFS, liên thông, Kosaraju, vùng giao hàng
│   ├── FileIO.h / .cpp         # Đọc/ghi map.txt, orders.txt (file và chuỗi)
│   ├── MinHeap.h               # MinHeap<T> và IndexedMinHeap (decreaseKey) tự cài
│   ├── ShortestPath.h / .cpp   # Dijkstra 3 phiên bản, A*, Yen, getPath, benchmark
│   ├── BellmanFord.h / .cpp    # Bellman-Ford, tìm chu trình âm
│   ├── Estimator.h / .cpp      # Dự toán chi phí và thời gian tuyến
│   ├── Dispatcher.h / .cpp     # Điều phối: hàng đợi ưu tiên, NN, 2-opt, TSP, CVRP
│   ├── Operations.h / .cpp     # Vận hành ca giao: chuyến, trạng thái đơn, lịch sử, tình huống đặc biệt, tính lại tuyến
│   ├── Analysis.h / .cpp       # Mở rộng: Tarjan (cầu, khớp), Kruskal + DSU, Prim, Floyd–Warshall, vị trí kho
│   ├── Pricing.h / .cpp        # Nghiệp vụ: biểu phí giao hàng (chỉnh được), doanh thu – chi phí – lợi nhuận ca, đối soát COD
│   ├── Auth.h / .cpp           # Tài khoản: SHA-256 tự cài, băm có muối, vòng đời tài khoản, phiên + CSRF, khoá luỹ tiến,
│   │                           #   giới hạn tần suất, mã OTP đặt lại mật khẩu, bảng quyền 3 vai trò + khách (canAccess)
│   ├── Commerce.h / .cpp       # Cấu hình, mã giảm giá, hạng thân thiết, báo giá = hoá đơn, sổ địa chỉ, đánh giá, điểm shipper
│   ├── OrderFlow.h / .cpp      # Máy trạng thái đơn hàng (409 khi chuyển sai), phí huỷ, mã giao 4 số, sổ COD
│   ├── Support.h / .cpp        # Thông báo trong app, nhật ký kiểm toán (CSV), hộp thư giả lập, khiếu nại
│   ├── Billing.h / .cpp        # Khai giá & bảo hiểm, cân quy đổi, trần bồi thường, sổ giao dịch và sao kê ví đối soát của khách
│   ├── TextUtil.h              # Tiện ích chuỗi UTF-8 (cắt đúng ký tự, đếm ký tự)
│   ├── History.h               # Hoàn tác / làm lại bằng hai ngăn xếp
│   ├── Trie.h / .cpp           # Cây tiền tố tìm điểm theo tên (bỏ dấu tiếng Việt); TextIndex tìm trong danh sách
│   ├── Trace.h / .cpp          # Ghi từng bước Dijkstra / A* / BFS / DFS / Bellman-Ford cho trang Mô phỏng
│   ├── Json.h                  # Bộ dựng JSON tối giản cho API
│   ├── WebServer.h / .cpp      # REST API + phục vụ giao diện web, xác thực / phân quyền mọi request, ghi file nguyên tử
│   ├── WebAccount.inc          # API tài khoản: đăng ký, đăng nhập, mật khẩu, hồ sơ, thiết bị, sổ địa chỉ, quản lý tài khoản
│   ├── WebOrders.inc           # API đơn hàng: tạo / huỷ / giao, ghép đơn tự động (matchPending), điều phối, COD, mã giảm giá, khiếu nại, thông báo, báo cáo
│   └── main.cpp                # Chọn chế độ web / console, menu chính
├── web/                        # Giao diện (HTML/CSS/JS thuần, không cần build)
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── app.js              # Điều hướng theo vai trò, thanh trên, chuông thông báo, công cụ bản đồ
│       ├── auth.js             # Trang khách vãng lai, đăng nhập, đăng ký, quên / đặt lại mật khẩu, hộp thư giả lập
│       ├── orders.js           # Chi tiết đơn, dòng thời gian, hoá đơn, đánh giá
│       ├── api.js, store.js, ui.js, print.js (in phiếu giao)
│       ├── mapview.js          # Bản đồ SVG + canvas: kéo, phóng to, lớp phủ
│       └── pages/              # overview, network, route, explore, lab, cost, dispatch, tracking, reports, bench, analysis,
│                               #   queue, myorders, myjob, accounts, cod, complaints, summary, settings, audit, profile, wallet
├── data/
│   ├── map.txt                 # Nội thành TP.HCM (vô hướng), 14 điểm, 17 đường
│   ├── orders.txt              # 8 đơn hàng cho map.txt
│   ├── map_oneway.txt          # Quận 1: đường một chiều + cạnh âm (có hướng)
│   ├── orders_oneway.txt
│   ├── map_negcycle.txt        # Dữ liệu lỗi có chu trình âm
│   ├── map_city.txt            # Đô thị mô phỏng: 2.000 giao lộ, 3.493 đoạn đường
│   ├── orders_city.txt         # 24 đơn cho map_city.txt
│   ├── shippers.txt            # 3 shipper mẫu
│   ├── users.txt               # 9 tài khoản mẫu (3 vai trò, 1 shipper chờ duyệt; vitri= là chỗ shipper đứng), chỉ lưu bản băm mật khẩu
│   ├── config.txt, promos.txt  # Biểu phí, hạng thân thiết, quy tắc huỷ; mã giảm giá
│   ├── addresses.txt, stats.txt           # Sổ địa chỉ của khách; thống kê shipper
│   └── audit.txt, notifications.txt, complaints.txt   # Nhật ký kiểm toán, thông báo, khiếu nại mẫu
│       (chương trình tự tạo thêm: orders_live.txt, reviews.txt, customer_reviews.txt, cod_ledger.txt, my_map.txt, my_orders.txt)
├── tests/
│   ├── test_traversal_fileio.cpp   # 41 kiểm tra: duyệt đồ thị, đọc/ghi file, bắt lỗi file
│   ├── test_algorithms.cpp         # 382 kiểm tra: heap, Dijkstra, Bellman-Ford, dự toán, điều phối
│   ├── test_extensions.cpp         # 3.693 kiểm tra: Tarjan, MST, Floyd–Warshall, tình huống đặc biệt trong ca
│   ├── test_features.cpp           # 1.664 kiểm tra: kẹt xe, hoàn tác, Trie, Yen, ca giao, giờ cao điểm, A*, mô phỏng, theo hạn giao
│   ├── test_auth.cpp               # 206 kiểm tra: SHA-256 theo vector chuẩn, băm mật khẩu, users.txt, tài khoản, phiên, khoá, phân quyền
│   ├── test_business.cpp           # 108 kiểm tra: trường COD / người nhận trong file, biểu phí, lý do thất bại, shipper bận, tài chính ca, nhật ký
│   ├── test_commerce.cpp           # 944 kiểm tra (mới): mật khẩu, khoá luỹ tiến, OTP, vòng đời tài khoản, máy trạng thái đơn, COD, mã giảm giá...
│   └── test_web.cpp                # 974 kiểm tra (mới): chạy server thật, gọi HTTP: đăng ký / đăng nhập, ma trận quyền 4 chủ thể × mọi API, ghép đơn tự động, IDOR, CSRF...
├── standalone/                 # Mã nguồn bản một file: engine/*.js (bản JavaScript của backend C++), api.js thay cho web/js/api.js
├── dieu-phoi-giao-hang.html    # Bản một file đã build (mở thẳng bằng trình duyệt)
├── tools/
│   ├── gen_city.py             # Sinh bộ dữ liệu Đô thị mô phỏng
│   ├── make_demo_data.cpp      # Sinh dữ liệu mẫu cho phần tài khoản (đã chạy sẵn, kết quả nằm trong data/)
│   ├── demo_curl.sh            # Minh hoạ 401 / 403 / 409 / 429 bằng curl (kết quả: docs/curl-demo.txt)
│   ├── build_standalone.mjs    # Build dieu-phoi-giao-hang.html từ web/ + standalone/ + data/
│   └── diff_standalone.mjs     # So khớp bản một file với server C++ (make diff-standalone)
├── third_party/httplib.h       # cpp-httplib v0.18.3 (MIT)
├── docs/curl-demo.txt          # Kết quả chạy tools/demo_curl.sh
├── docs/screenshots/           # Ảnh chụp; standalone/ là ảnh của bản một file
├── CMakeLists.txt
├── Makefile
└── README.md
```

## Kiến trúc

```mermaid
flowchart LR
    B[Trình duyệt<br/>HTML/CSS/JS] -- "fetch /api/... (JSON)<br/>+ cookie phiên + CSRF" --> AU[Auth<br/>phiên, CSRF, canAccess]
    AU --> W[WebServer.cpp<br/>+ WebAccount.inc, WebOrders.inc]
    W --> CM[Commerce<br/>giá, mã giảm, hạng]
    W --> OF[OrderFlow<br/>máy trạng thái, COD]
    W --> SU[Support<br/>thông báo, kiểm toán]
    W --> G[Graph]
    W --> T[Traversal]
    W --> SP[ShortestPath<br/>+ MinHeap]
    W --> BF[BellmanFord]
    W --> E[Estimator]
    W --> D[Dispatcher]
    W --> F[FileIO]
    W --> O[Operations<br/>ca giao]
    W --> H[History<br/>2 ngăn xếp]
    W --> TR[Trie<br/>tìm điểm]
    O --> D
    E --> BF
    D --> SP
    D --> MH[MinHeap<br/>hàng đợi ưu tiên]
    F --> DATA[(data/*.txt)]
```

- Trình duyệt **không chạy thuật toán nào**: mỗi thao tác gửi request tới backend C++, nhận JSON và vẽ kết quả.
- Mỗi request đi qua bước **xác thực + phân quyền** trước khi vào handler: xác định tài khoản từ mã phiên, kiểm tra trạng thái tài khoản, đối chiếu bảng quyền theo vai trò (`Auth::canAccess`), kiểm tra Origin và mã CSRF với request thay đổi dữ liệu; handler lại lọc dữ liệu theo người dùng (đơn của khách, chuyến của shipper) và trả 403 nếu xin dữ liệu của người khác.
- Trạng thái (bản đồ, đơn, shipper, ca giao, lịch sử hoàn tác, tài khoản, phiên) nằm trong bộ nhớ server, có `std::mutex` bảo vệ. Sau mỗi request, phần dữ liệu đã đổi được ghi ra **file riêng** trong `data/` theo kiểu **nguyên tử** (ghi file tạm rồi đổi tên): `users.txt`, `promos.txt`, `addresses.txt`, `reviews.txt`, `stats.txt`, `notifications.txt`, `audit.txt`, `complaints.txt`, `cod_ledger.txt`, `config.txt`, `shippers.txt` và `orders_live.txt` (đơn của bộ TP.HCM kèm trạng thái). Nút **Lưu** vẫn ghi `data/my_map.txt` và `data/my_orders.txt` như cũ. Tình trạng kẹt xe / đóng đường, chuyến đang chạy và đồng hồ ca chỉ giữ trong bộ nhớ.
- Sửa bản đồ làm lộ trình đã giao không còn đúng (xoá điểm, xoá/sửa đường, đổi kho, hoàn tác...) thì ca giao đang chạy được huỷ, đơn chưa xong về *Chờ giao* (đơn đã giao / đã huỷ / hoàn kho giữ nguyên). Báo kẹt xe giữa ca thì chuyến đang chạy giữ nguyên, chỉ tuyến tính sau đó bị ảnh hưởng.
- Các module thuật toán được đóng thành thư viện `delivery_core`, không phụ thuộc web, nên dùng lại được cho menu console và cho test. Phần thương mại (`Auth`, `Commerce`, `OrderFlow`, `Support`) cũng không phụ thuộc web và có bộ test đơn vị riêng.

## Tài khoản và bảo mật

**Vòng đời tài khoản**

```mermaid
stateDiagram-v2
    state "Chờ duyệt" as P
    state "Hoạt động" as A
    state "Bị khoá" as L
    state "Vô hiệu hoá" as D
    [*] --> A: khách hàng tự đăng ký / quản trị viên tạo
    [*] --> P: shipper tự đăng ký
    P --> A: duyệt (QT), thêm vào đội xe
    P --> D: từ chối (QT, bắt buộc lý do)
    A --> L: khoá (QT, bắt buộc lý do)
    A --> D: vô hiệu hoá (QT, bắt buộc lý do)
    L --> A: mở khoá
    L --> D: vô hiệu hoá
    D --> A: kích hoạt lại
```

QT = quản trị viên (vai trò điều phối viên đã bỏ ở vòng 4). Không ai tự đổi trạng thái của chính mình; tài khoản rời trạng thái *Hoạt động* bị đăng xuất khỏi mọi thiết bị; mọi lần đổi đều ghi nhật ký kiểm toán và gửi email (hộp thư giả lập). Đăng nhập vào tài khoản *Chờ duyệt* / *Bị khoá* / *Vô hiệu hoá* nhận thông báo rõ ràng (kèm lý do) **chỉ khi mật khẩu đúng**, nên không dùng được để dò tài khoản.

**Các lớp bảo vệ**

| Nội dung | Cách làm |
|---|---|
| Lưu mật khẩu | Không lưu mật khẩu gốc. Mỗi tài khoản có muối ngẫu nhiên 64 bit; băm = **SHA-256 tự cài** (FIPS 180-4) lặp 10.000 vòng: `h = sha256(salt + ":" + mật_khẩu)`, rồi `h = sha256(h + salt)`. So sánh băm trong thời gian hằng. *Ghi chú:* đây là cách băm giữ lại từ đồ án để minh hoạ cấu trúc dữ liệu / thuật toán; **hệ thống thật nên dùng bcrypt, scrypt hoặc Argon2** (cố ý chậm và tốn bộ nhớ, chống dò bằng GPU tốt hơn nhiều). |
| Chính sách mật khẩu | Mật khẩu đặt mới (đăng ký, đổi, đặt lại): ≥ 8 ký tự, có chữ hoa, chữ thường, chữ số, không nằm trong danh sách mật khẩu phổ biến, không chứa tên đăng nhập. |
| Dò mật khẩu | Sai 5 lần liên tiếp → khoá 60 giây; mỗi lần bị khoá tiếp theo gấp đôi (120, 240, 480 giây, tối đa 15 phút); thông báo lỗi chung "Thông tin đăng nhập không đúng" (không nói sai tên hay sai mật khẩu; tài khoản không tồn tại vẫn tốn thời gian băm như thường). Một giờ không sai lần nào thì mức khoá trở về ban đầu. Giới hạn theo IP: 60 lần đăng nhập / 5 phút, 20 lần đăng ký / giờ, 5 lần xin mã OTP / 15 phút (3 lần cho một email). Trả **HTTP 429** kèm `Retry-After`. |
| Đặt lại mật khẩu | Mã OTP 6 số, hết hạn sau 10 phút, dùng một lần, nhập sai 5 lần thì mã không dùng được nữa; chỉ lưu bản băm có muối của mã. Xin mã cho email không tồn tại vẫn trả cùng một câu trả lời. Đặt lại xong thì mọi thiết bị bị đăng xuất. |
| Phiên đăng nhập | Mã phiên 128 bit ngẫu nhiên, cookie `dt08_session` **HttpOnly; SameSite=Strict**; hết hạn sau 12 giờ không dùng, hoặc 30 ngày nếu chọn *Ghi nhớ đăng nhập*. Đăng nhập thì cấp mã phiên mới (chống cố định phiên). Người dùng xem được danh sách thiết bị và đăng xuất từng thiết bị. |
| CSRF | Mỗi phiên có mã CSRF riêng; mọi request POST của người đăng nhập bằng cookie phải gửi header `X-CSRF-Token` đúng (trừ đăng nhập, đăng ký, quên / đặt lại mật khẩu). Request dùng `Authorization: Bearer` (script, curl) không cần mã vì trình duyệt không tự gửi header này. Mọi POST có header `Origin` thì Origin phải trùng `Host`. Sai → 403. |
| Phân quyền | Một bảng quy tắc duy nhất (vai trò × phương thức × đường dẫn) dùng cho cả kiểm tra lúc chạy (`canAccess`), bảng dưới đây và bộ test ma trận (4 chủ thể × mọi API). Server từ chối khởi động nếu có API chưa có quy tắc. |
| IDOR | Handler luôn kiểm tra chủ sở hữu: khách chỉ xem / huỷ / đánh giá / khiếu nại đơn của mình, shipper chỉ xác nhận giao đơn trong chuyến của mình, sổ COD của shipper chỉ có phần của họ. |
| XSS | Giao diện escape mọi chuỗi người dùng nhập trước khi đưa vào HTML; server đặt `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`. |
| Lộ lỗi | Lỗi không lường trước chỉ trả "Có lỗi xảy ra phía máy chủ, vui lòng thử lại sau" (HTTP 500), chi tiết chỉ in ở nhật ký server. |
| Kiểm toán | Đăng nhập, đăng ký, đổi trạng thái / vai trò / mật khẩu tài khoản, mọi thao tác trên đơn, COD, mã giảm giá, cấu hình... đều ghi vào `audit.txt` (chỉ ghi thêm). Xuất CSV có chặn chèn công thức (ô bắt đầu bằng `= + - @` được thêm dấu `'`). |

## Ma trận phân quyền

Bảng sinh tự động từ bảng quy tắc trong `src/Auth.cpp` (`Auth::matrixMarkdown()`), đúng với những gì server kiểm tra. *Khách* = chưa đăng nhập. Ngoài quyền theo vai trò, handler còn lọc theo chủ sở hữu (xem IDOR ở trên). Thiếu đăng nhập → **401**, sai vai trò → **403**.

| Chức năng | API | Khách | Khách hàng | Shipper | Quản trị |
|---|---|:-:|:-:|:-:|:-:|
| **Tài khoản & phiên** | | | | | |
| Đăng nhập (tên đăng nhập, email hoặc SĐT) | `POST /api/login` | ✓ | ✓ | ✓ | ✓ |
| Đăng xuất | `POST /api/logout` | ✓ | ✓ | ✓ | ✓ |
| Xem tài khoản đang đăng nhập | `GET /api/me` | ✓ | ✓ | ✓ | ✓ |
| Đăng ký khách hàng / shipper | `POST /api/register` | ✓ | ✓ | ✓ | ✓ |
| Yêu cầu mã đặt lại mật khẩu | `POST /api/password/forgot` | ✓ | ✓ | ✓ | ✓ |
| Đặt lại mật khẩu bằng mã OTP | `POST /api/password/reset` | ✓ | ✓ | ✓ | ✓ |
| Hộp thư giả lập (chỉ khi bật chế độ demo) | `GET /api/mailbox` | ✓ | ✓ | ✓ | ✓ |
| Đổi mật khẩu | `POST /api/me/password` | – | ✓ | ✓ | ✓ |
| **Hồ sơ** | | | | | |
| Xem hồ sơ cá nhân | `GET /api/profile` | – | ✓ | ✓ | ✓ |
| Sửa tên, email, SĐT | `POST /api/profile/update` | – | ✓ | ✓ | ✓ |
| Xem các thiết bị đang đăng nhập | `GET /api/sessions` | – | ✓ | ✓ | ✓ |
| Đăng xuất một thiết bị | `POST /api/sessions/revoke` | – | ✓ | ✓ | ✓ |
| Đăng xuất mọi thiết bị khác | `POST /api/sessions/revoke-others` | – | ✓ | ✓ | ✓ |
| Xem sổ địa chỉ | `GET /api/addresses` | – | ✓ | – | – |
| Thêm địa chỉ | `POST /api/addresses/add` | – | ✓ | – | – |
| Sửa địa chỉ | `POST /api/addresses/update` | – | ✓ | – | – |
| Xoá địa chỉ | `POST /api/addresses/remove` | – | ✓ | – | – |
| Đặt địa chỉ mặc định | `POST /api/addresses/default` | – | ✓ | – | – |
| Bật / tắt sẵn sàng nhận chuyến | `POST /api/shipper/ready` | – | – | ✓ | – |
| Cập nhật thông tin xe | `POST /api/shipper/vehicle` | – | – | ✓ | – |
| Cập nhật vị trí đang đứng (để hệ thống chọn shipper gần nhất) | `POST /api/shipper/location` | – | – | ✓ | – |
| Thống kê shipper (đúng hạn, đánh giá, thu nhập) | `GET /api/shipper/stats` | – | – | ✓ | ✓ |
| **Quản lý tài khoản** | | | | | |
| Danh sách tài khoản (tìm kiếm, lọc, phân trang) | `GET /api/users` | – | – | – | ✓ |
| Hàng chờ duyệt shipper (Min-Heap) | `GET /api/users/queue` | – | – | – | ✓ |
| Tạo tài khoản | `POST /api/users/add` | – | – | – | ✓ |
| Sửa tài khoản, vai trò, đặt lại mật khẩu | `POST /api/users/update` | – | – | – | ✓ |
| Xoá tài khoản | `POST /api/users/remove` | – | – | – | ✓ |
| Duyệt / từ chối / khoá / mở khoá tài khoản | `POST /api/users/status` | – | – | – | ✓ |
| **Bản đồ & dữ liệu** | | | | | |
| Trạng thái hệ thống (đã lọc theo vai trò) | `GET /api/state` | – | ✓ | ✓ | ✓ |
| Mở bộ dữ liệu | `POST /api/dataset` | – | – | – | ✓ |
| Tạo bản đồ mới | `POST /api/graph/new` | – | – | – | ✓ |
| Đổi kho | `POST /api/depot` | – | – | – | ✓ |
| Hoàn tác (Undo) | `POST /api/undo` | – | – | – | ✓ |
| Làm lại (Redo) | `POST /api/redo` | – | – | – | ✓ |
| Báo kẹt xe / đóng đường | `POST /api/traffic` | – | – | – | ✓ |
| Xoá mọi sự cố giao thông | `POST /api/traffic/clear` | – | – | – | ✓ |
| Tìm địa điểm (Trie) | `GET /api/search` | – | ✓ | ✓ | ✓ |
| Giờ bắt đầu ca, bật / tắt giờ cao điểm | `POST /api/settings` | – | – | – | ✓ |
| In bản đồ dạng văn bản | `GET /api/print` | – | – | – | ✓ |
| Thêm điểm | `POST /api/node/add` | – | – | – | ✓ |
| Sửa điểm | `POST /api/node/update` | – | – | – | ✓ |
| Xoá điểm | `POST /api/node/remove` | – | – | – | ✓ |
| Thêm đường | `POST /api/edge/add` | – | – | – | ✓ |
| Sửa đường | `POST /api/edge/update` | – | – | – | ✓ |
| Xoá đường | `POST /api/edge/remove` | – | – | – | ✓ |
| Tải map.txt | `GET /api/export/map` | – | – | – | ✓ |
| Tải orders.txt | `GET /api/export/orders` | – | – | – | ✓ |
| Tải shippers.txt | `GET /api/export/shippers` | – | – | – | ✓ |
| Nhập map.txt | `POST /api/import/map` | – | – | – | ✓ |
| Nhập orders.txt | `POST /api/import/orders` | – | – | – | ✓ |
| Nhập shippers.txt | `POST /api/import/shippers` | – | – | – | ✓ |
| Lưu bản đồ và đơn hàng | `POST /api/save` | – | – | – | ✓ |
| Đo hiệu năng thuật toán | `GET /api/benchmark` | – | – | – | ✓ |
| Đo hiệu năng A* và Dijkstra | `GET /api/benchmark/p2p` | – | – | – | ✓ |
| **Tìm đường (chỉ đọc)** | | | | | |
| Đường đi ngắn nhất (Dijkstra, A*, Bellman-Ford, BFS) | `GET /api/path` | – | ✓ | ✓ | ✓ |
| K tuyến ngắn nhất (Yen) | `GET /api/kpaths` | – | ✓ | ✓ | ✓ |
| Dự toán chuyến nhiều điểm | `GET /api/estimate` | – | ✓ | ✓ | ✓ |
| Thời gian đi theo giờ xuất phát | `GET /api/timeprofile` | – | ✓ | ✓ | ✓ |
| Mô phỏng thuật toán từng bước | `GET /api/trace` | – | ✓ | ✓ | ✓ |
| Duyệt đồ thị BFS / DFS | `GET /api/traverse` | – | ✓ | ✓ | ✓ |
| Thành phần liên thông | `GET /api/components` | – | ✓ | ✓ | ✓ |
| Vùng giao hàng quanh kho | `GET /api/zone` | – | ✓ | ✓ | ✓ |
| Chia vùng nhiều kho | `GET /api/zones` | – | ✓ | ✓ | ✓ |
| Bellman-Ford | `GET /api/bellman` | – | ✓ | ✓ | ✓ |
| Phân tích mạng (cầu, khớp, MST, vị trí kho) | `GET /api/analysis` | – | ✓ | ✓ | ✓ |
| Báo giá cước (Dijkstra) — khách vãng lai dùng thử được | `GET /api/quote` | ✓ | ✓ | ✓ | ✓ |
| Thông tin công khai: điểm giao, biểu phí | `GET /api/public/info` | ✓ | ✓ | ✓ | ✓ |
| Tra cứu đơn bằng mã đơn + SĐT người nhận | `GET /api/track` | ✓ | ✓ | ✓ | ✓ |
| **Đơn hàng** | | | | | |
| Tạo đơn | `POST /api/order/add` | – | ✓ | – | ✓ |
| Tạo đơn mẫu ngẫu nhiên | `POST /api/orders/random` | – | – | – | ✓ |
| Sửa đơn (khi chưa phân công) | `POST /api/order/update` | – | – | – | ✓ |
| Khách tự sửa đơn của mình khi còn ở trạng thái Mới | `POST /api/order/edit` | – | ✓ | – | – |
| Khách hẹn giao lại đơn thất bại (đổi được SĐT / ghi chú) | `POST /api/order/redeliver` | – | ✓ | – | – |
| Khách yêu cầu hoàn đơn thất bại về kho (tính phí hoàn) | `POST /api/order/return` | – | ✓ | – | – |
| Xoá đơn | `POST /api/order/remove` | – | – | – | ✓ |
| Chia đơn nặng thành nhiều kiện | `POST /api/order/split` | – | – | – | ✓ |
| Xác nhận đơn mới (Mới → Chờ giao) | `POST /api/order/confirm` | – | – | – | ✓ |
| Từ chối đơn mới (kèm lý do) | `POST /api/order/reject` | – | – | – | ✓ |
| Huỷ đơn (theo quy tắc và phí huỷ) | `POST /api/order/cancel` | – | ✓ | – | ✓ |
| Xác nhận đã giao bằng mã 4 số | `POST /api/order/deliver` | – | – | ✓ | ✓ |
| Đánh giá shipper (1–5 sao) | `POST /api/order/rate` | – | ✓ | – | – |
| Shipper đánh giá khách hàng (1–5 sao) | `POST /api/order/rate-customer` | – | – | ✓ | – |
| Tìm lại shipper cho đơn chưa có ai nhận | `POST /api/order/retry` | – | ✓ | – | ✓ |
| Shipper nhả đơn đã nhận khi chưa lấy hàng (kèm lý do) | `POST /api/order/release` | – | – | ✓ | – |
| Danh sách đơn (tìm kiếm, lọc, sắp xếp, phân trang) | `GET /api/orders/list` | – | ✓ | ✓ | ✓ |
| Chi tiết đơn | `GET /api/order/get` | – | ✓ | ✓ | ✓ |
| Hoá đơn của đơn | `GET /api/order/invoice` | – | ✓ | – | ✓ |
| Danh sách mã giảm giá | `GET /api/promos` | – | – | – | ✓ |
| Thêm / sửa mã giảm giá | `POST /api/promos/save` | – | – | – | ✓ |
| Xoá mã giảm giá | `POST /api/promos/remove` | – | – | – | ✓ |
| **Điều phối** | | | | | |
| Chạy các phương án điều phối (phân công tay) | `GET /api/dispatch` | – | – | – | ✓ |
| Áp dụng phương án | `POST /api/dispatch/apply` | – | – | – | ✓ |
| Chạy đồng hồ ca (mô phỏng; shipper chỉ dùng được khi bật chế độ mô phỏng) | `POST /api/shift/progress` | – | – | ✓ | ✓ |
| Báo giao thất bại | `POST /api/shift/fail` | – | – | ✓ | ✓ |
| Huỷ đơn (tên cũ của order/cancel) | `POST /api/shift/cancel` | – | ✓ | – | ✓ |
| Shipper nghỉ đột xuất | `POST /api/shift/absent` | – | – | – | ✓ |
| Shipper có mặt trở lại | `POST /api/shift/available` | – | – | – | ✓ |
| Tính lại tuyến khi giao thông đổi | `POST /api/shift/reroute` | – | – | – | ✓ |
| Đưa đơn thất bại về hàng chờ (giao lại) | `POST /api/shift/requeue` | – | – | – | ✓ |
| Hoàn kho đơn thất bại (tính phí hoàn) | `POST /api/shift/return` | – | – | – | ✓ |
| Huỷ ca đang chạy | `POST /api/shift/reset` | – | – | – | ✓ |
| Shipper nhận lời mời / chuyến | `POST /api/trip/accept` | – | – | ✓ | – |
| Shipper từ chối chuyến (kèm lý do) | `POST /api/trip/decline` | – | – | ✓ | – |
| Thu hồi chuyến shipper chưa nhận (đơn về hàng chờ) | `POST /api/trip/recall` | – | – | – | ✓ |
| Phân công tay các đơn đã chọn cho một shipper | `POST /api/dispatch/assign` | – | – | – | ✓ |
| Thêm shipper vào đội xe | `POST /api/shipper/add` | – | – | – | ✓ |
| Sửa shipper | `POST /api/shipper/update` | – | – | – | ✓ |
| Xoá shipper khỏi đội xe | `POST /api/shipper/remove` | – | – | – | ✓ |
| **Sổ COD** | | | | | |
| Xem sổ COD (shipper chỉ thấy của mình) | `GET /api/cod` | – | – | ✓ | ✓ |
| Shipper nộp tiền thu hộ | `POST /api/cod/remit` | – | – | ✓ | – |
| Xác nhận đã nhận tiền, ghi chênh lệch | `POST /api/cod/confirm` | – | – | – | ✓ |
| Chốt ca của shipper | `POST /api/cod/close` | – | – | – | ✓ |
| Ví / sao kê đối soát của khách (khách chỉ xem của mình) | `GET /api/wallet` | – | ✓ | – | ✓ |
| Số dư đối soát của mọi khách hàng | `GET /api/wallets` | – | – | – | ✓ |
| Chi trả tiền cho khách / ghi nhận khách nộp bù | `POST /api/wallet/payout` | – | – | – | ✓ |
| **Khiếu nại & thông báo** | | | | | |
| Danh sách khiếu nại (khách chỉ thấy của mình) | `GET /api/complaints` | – | ✓ | – | ✓ |
| Gửi khiếu nại gắn với đơn | `POST /api/complaint/add` | – | ✓ | – | – |
| Trao đổi trong khiếu nại | `POST /api/complaint/message` | – | ✓ | – | ✓ |
| Chuyển trạng thái khiếu nại | `POST /api/complaint/status` | – | – | – | ✓ |
| Bồi thường cho khách (theo giá trị khai, có trần) | `POST /api/complaint/compensate` | – | – | – | ✓ |
| Thông báo của tôi | `GET /api/notifications` | – | ✓ | ✓ | ✓ |
| Đánh dấu đã đọc | `POST /api/notifications/read` | – | ✓ | ✓ | ✓ |
| Đánh dấu đã đọc tất cả | `POST /api/notifications/read-all` | – | ✓ | ✓ | ✓ |
| **Cấu hình & báo cáo** | | | | | |
| Xem biểu phí, hạng thân thiết, quy tắc | `GET /api/config` | – | – | – | ✓ |
| Sửa biểu phí, hạng thân thiết, quy tắc | `POST /api/config/update` | – | – | – | ✓ |
| Nhật ký kiểm toán | `GET /api/audit` | – | – | – | ✓ |
| Xuất nhật ký kiểm toán CSV | `GET /api/audit/export` | – | – | – | ✓ |
| Báo cáo theo vai trò | `GET /api/reports/summary` | – | ✓ | ✓ | ✓ |

## Ghép đơn tự động kiểu Grab

Từ vòng 4 **không còn vai trò điều phối viên**. Khách đặt đơn xong, hệ thống tự gửi **lời mời nhận đơn** cho shipper gần kho nhất; shipper **nhận** thì mới đi giao. Cách vận hành bám theo app gọi xe / giao hàng (Grab):

```mermaid
sequenceDiagram
    participant K as Khách
    participant H as Hệ thống (matchPending)
    participant A as Shipper gần nhất
    participant B as Shipper gần kế tiếp
    K->>H: Đặt đơn (order/add)
    H->>H: Dijkstra theo thời gian: shipper nào tới kho sớm nhất?
    H->>A: Lời mời + đếm ngược 45 giây
    alt A bấm Nhận đơn
        A->>H: trip/accept
        H->>K: Thẻ tài xế, mã nhận hàng, vị trí shipper chạy trên bản đồ
    else A bấm Bỏ qua hoặc hết giờ
        H->>B: Lời mời mới (không mời lại A)
    end
    Note over H,K: Hết người: khách được báo, có nút "Tìm lại shipper"; quá 10 phút thì đơn tự huỷ
```

| Tính năng của Grab | Cách làm ở đây |
|---|---|
| Đặt xong là tự tìm tài xế gần nhất | `matchPending()` chạy ngay khi có đơn mới, khi shipper bật *sẵn sàng*, khi shipper vừa rảnh. "Gần nhất" = **thời gian di chuyển ngắn nhất từ chỗ shipper đang đứng tới kho** (Dijkstra theo thời gian, đúng loại xe, có tính giờ cao điểm), không phải khoảng cách đường chim bay |
| Tài xế có vài chục giây để nhận | `match.offerSeconds` (mặc định 45 giây, 1–600), thẻ *Đơn mới gần bạn* có **thanh đếm ngược**, 10 giây cuối đổi sang màu đỏ |
| Tài xế bỏ qua hoặc hết giờ thì mời người kế | Mỗi đơn nhớ danh sách shipper đã được mời (`tried`), không mời lại; xếp theo thời gian tới kho, rồi quãng đường, rồi điểm tin cậy (bật *ưu tiên shipper điểm cao* thì điểm đứng trước) |
| Hết tài xế thì báo khách | Đơn chuyển *Chưa có shipper*, khách bấm **Tìm lại shipper** hoặc huỷ miễn phí; không ai nhận sau `match.giveUp` phút (mặc định 10) thì hệ thống tự huỷ đơn và báo khách |
| Tài xế bật / tắt "Sẵn sàng nhận đơn" | `POST /api/shipper/ready`; tắt khi đang giữ lời mời thì lời mời được gỡ và đơn sang người kế |
| Vị trí tài xế | Shipper chọn điểm đang đứng (`POST /api/shipper/location`); sau khi giao xong thì vị trí là điểm giao cuối; khi đang có đơn, vị trí chạy theo hành trình |
| Khách theo dõi tài xế trực tiếp | Bản đồ vẽ **đường shipper chạy tới kho (nét đứt)** rồi tuyến giao, xe di chuyển theo đồng hồ ca; thanh trạng thái *Đang tới kho lấy hàng* → *Đang giao* |
| Thẻ tài xế | Tên, loại xe, biển số, điểm đánh giá, nút gọi; chỉ hiện **sau khi shipper nhận**: khách không biết ai đang được mời |
| Huỷ chuyến có lý do và phí | Khách huỷ **miễn phí** khi chưa ai nhận; sau khi shipper nhận mà chưa lấy hàng: phí 20% cước, bắt buộc lý do; **khách không huỷ được sau khi shipper đã lấy hàng**. Shipper **nhả đơn** (`order/release`) trước khi lấy hàng, bắt buộc lý do, đơn quay lại tìm người khác |
| Đánh giá hai chiều | Khách đánh giá shipper (`order/rate`), shipper đánh giá khách (`order/rate-customer`, lưu `customer_reviews.txt`); lời mời hiện điểm của khách |
| Hiển thị thu nhập | Thẻ lời mời và thẻ chuyến ghi thu nhập dự kiến của shipper (70% cước vận chuyển) |
| Quản trị thay điều phối viên | Quản trị viên thấy ai đang được mời kèm đếm ngược, **Thu hồi lời mời**, **Tìm shipper ngay**, phân công tay, đặt hạn trả lời / thời gian chờ / tốc độ giờ ca trong *Cấu hình* |

**Cái gì không đổi.** Các thuật toán cốt lõi (Dijkstra, A\*, Bellman-Ford, Yen, TSP, cheapest insertion + 2-opt, theo hạn giao + tìm kiếm cục bộ) và 6 bộ test cũ giữ nguyên. Ghép đơn **dùng lại** chúng: tìm shipper gần nhất dùng `ShortestPath` với tiêu chí thời gian của đúng loại xe; lộ trình của chuyến vẫn do phương án *Theo hạn giao* của `Dispatcher` lập (mỗi lời mời một đơn, xuất phát từ kho, không quay về), chỉ khác là giờ xuất phát = giờ hiện tại của ca + thời gian shipper chạy tới kho.

**Đồng hồ ca chạy thật.** `clock.speed` (mặc định 6) phút ca trôi qua mỗi phút thật; lời mời hết hạn và đơn tự huỷ được xử lý ngay trong mỗi request (không có luồng nền). Giao diện hỏi server mỗi 3 giây (`GET /api/me` trả `rev`, chỉ tải lại state khi `rev` đổi) và tự nội suy đồng hồ giữa hai lần hỏi nên xe chạy mượt. Đặt `clock.speed 0` để đứng yên (dùng khi demo từng bước hoặc chạy test).

**Chế độ thủ công.** Tắt *Ghép đơn tự động* trong *Cấu hình* (`match.auto 0`) thì quay về luồng cũ: khách đặt đơn → *Mới*, quản trị viên *xác nhận*, rồi điều phối hoặc phân công tay. Toàn bộ luồng cũ vẫn chạy và vẫn được kiểm thử (ảnh 09–52 chụp ở chế độ này).

**Cấu hình** (`data/config.txt`): `match.auto` (1/0), `match.offerSeconds` (1–600), `match.giveUp` (0–240 phút, 0 = không tự huỷ), `clock.speed` (0–120).

**Dữ liệu mẫu.** Ba shipper `tuan`, `binh`, `cuong` đứng ở ba điểm khác nhau (khoá `vitri=` trong `users.txt`) nên mỗi đơn có một người "gần nhất" rõ ràng. Khách mẫu mới `cuahangmai` / `Mai@2026` thay cho tài khoản điều phối viên cũ.

## Vòng đời đơn hàng

Bảng chuyển trạng thái nằm trong `src/OrderFlow.cpp`; sơ đồ dưới đây sinh từ chính bảng đó (`Flow::transitionsMermaid()`). Mọi chuyển trạng thái không có trong bảng (hoặc vai trò không được phép) bị từ chối bằng **HTTP 409** kèm lý do. KH = khách hàng, SP = shipper, QT = quản trị viên, HT = hệ thống (ghép đơn tự động, hết hạn lời mời, tự huỷ).

```mermaid
stateDiagram-v2
    state "Chờ giao" as S0
    state "Đang giao" as S1
    state "Đã giao" as S2
    state "Thất bại" as S3
    state "Đã huỷ" as S4
    state "Hoàn kho" as S5
    state "Mới" as S6
    state "Đã phân công" as S7
    [*] --> S6: khách tạo đơn
    S6 --> S0: confirm (QT)
    S6 --> S4: reject (QT)
    S6 --> S4: cancel (KH/QT)
    S0 --> S4: cancel (KH/QT/HT)
    S0 --> S7: dispatch (QT/HT)
    S7 --> S1: accept (SP)
    S7 --> S0: decline (SP)
    S7 --> S0: expire (HT)
    S7 --> S0: unassign (QT/HT)
    S7 --> S4: cancel (KH/QT)
    S1 --> S2: deliver (SP/QT/HT)
    S1 --> S0: release (SP)
    S1 --> S3: fail (SP/QT)
    S1 --> S0: unassign (QT/HT)
    S1 --> S4: cancel (KH/QT)
    S3 --> S0: requeue (KH/QT)
    S3 --> S5: return (KH/QT)
    S3 --> S4: cancel (QT)
    S2 --> [*]
    S5 --> [*]
    S4 --> [*]
```

- **Chờ giao** (khi bật ghép tự động, khách thấy *Đang tìm shipper*): đơn vừa đặt, hệ thống đang tìm shipper. *Mới* chỉ còn ở **chế độ thủ công** (tắt ghép tự động): khách đặt, quản trị viên *xác nhận*; đơn do quản trị viên tạo vào thẳng *Chờ giao*.
- **Đã phân công** = **lời mời đang chờ shipper trả lời** (`dispatch (HT)`): shipper **nhận** (→ *Đang giao*), **bỏ qua** kèm lý do (→ *Chờ giao*, hệ thống mời người kế, tính vào tỉ lệ từ chối) hoặc **hết giờ** (`expire`). Quản trị viên có thể *thu hồi* (`unassign`). Khi bật *chế độ mô phỏng* trong Cấu hình, đơn vào thẳng *Đang giao* và đồng hồ ca tự giao như bản gốc.
- **Đang giao**: shipper đã nhận, đang chạy tới kho lấy hàng rồi đi giao. Trước khi lấy hàng shipper có thể **nhả đơn** (`release`, bắt buộc lý do, đơn về *Chờ giao* để mời người khác).
- **Đã giao**: shipper nhập **mã 4 số** mà khách thấy trong đơn của mình (và đúng số tiền thu hộ nếu có). Quản trị viên có thể *giao thay* khi khách không đọc được mã, bắt buộc ghi lý do.
- **Phí huỷ** tính trên phần cước vận chuyển sau giảm giá: *Chờ giao* / lời mời chưa ai nhận **miễn phí**, shipper đã nhận nhưng chưa lấy hàng **20%**, *Đang giao* sau khi lấy hàng / *Thất bại* **50%** (chỉ quản trị viên huỷ được ở hai trạng thái này; khách không huỷ được sau khi shipper đã lấy hàng). Huỷ khi đã có shipper bắt buộc ghi lý do. Huỷ trước khi shipper nhận thì trả lại lượt dùng mã giảm giá.
- **Báo giá = hoá đơn**: `cước gốc` (biểu phí, quãng đường Dijkstra từ kho) − `giảm theo hạng` − `mã giảm giá` (mỗi khoản làm tròn xuống 500 đ) + `phí thu hộ`. Ba con số được lưu vào đơn lúc đặt (`gia=`, `tv=`, `ck=`), nên đổi biểu phí sau đó không làm sai hoá đơn cũ.
- **Tổng phải trả** = cước sau giảm giá + **phí bảo hiểm** (`bh=`, khi khai giá trên mức miễn phí). Người gửi trả thì trừ vào ví đối soát khi đơn giao xong; **người nhận trả** (`tra=1`) thì shipper thu *thu hộ + tổng cước* lúc giao, số này vào sổ COD như tiền thu hộ.
- **Thất bại → Giao lại / Hoàn kho**: khách tự chọn được (trang *Đơn của tôi*), nhân viên cũng làm được. Hoàn kho (khách chọn, nhân viên chọn, hay hệ thống tự hoàn sau lần thất bại thứ 2 hoặc lý do *từ chối nhận* / *hàng hư hỏng*) đều ghi **phí hoàn** = 50% cước vận chuyển (không gồm phí thu hộ) vào đơn (`hoan=`); đơn hoàn chỉ chịu phí hoàn, không chịu cước và bảo hiểm.
- **Thu hồi chuyến**: lời mời / chuyến *Đã phân công* mà shipper chưa nhận thì quản trị viên thu hồi được (đơn → *Chờ giao*, kèm lý do, không tính là shipper từ chối); chuyến đã nhận thì không (409).

## Thuật toán và độ phức tạp

V = số điểm, E = số đoạn đường, n = số đơn hàng.

| Thuật toán | File | Độ phức tạp | Ghi chú |
|---|---|---|---|
| BFS, DFS (đệ quy và stack) | `Traversal` | O(V + E) | DFS dùng stack an toàn với đồ thị rất lớn |
| Liên thông, liên thông mạnh Kosaraju | `Traversal` | O(V + E) | |
| Vùng giao k chặng, chia vùng BFS đa nguồn | `Traversal` | O(V + E) | |
| Dijkstra mảng | `ShortestPath` | O(V²) | Quét mảng tìm đỉnh gần nhất |
| Dijkstra `std::priority_queue` | `ShortestPath` | O((V + E) log E) | Xoá lười (lazy deletion) |
| Dijkstra **Min-Heap tự cài** | `ShortestPath`, `MinHeap` | O((V + E) log V) | `IndexedMinHeap` có **decreaseKey**, heap ≤ V phần tử |
| Bellman-Ford + phát hiện chu trình âm | `BellmanFord` | O(V · E) | Dừng sớm khi một vòng không đổi |
| Dự toán tuyến nhiều điểm | `Estimator` | O(k · V · E) | k = số điểm giao |
| Ma trận khoảng cách cho điều phối | `Dispatcher` | O(n · (V + E) log V) | Dijkstra từ mỗi điểm, riêng từng loại xe |
| Nearest Neighbor | `Dispatcher` | O(n²) | Tham lam |
| 2-opt | `Dispatcher` | O(n³) mỗi vòng | Tính lại cả tuyến nên đúng với đường một chiều |
| **TSP bitmask** (Held-Karp) | `Dispatcher` | O(2ⁿ · n²) | Lời giải **tối ưu**, giới hạn n ≤ 15 |
| Cheapest insertion có tải trọng | `Dispatcher` | O(n² · K) | K = số shipper |
| Hàng đợi ưu tiên đơn gấp | `Dispatcher`, `MinHeap` | O(n log n) | Gấp trước → hạn sớm → mã đơn |
| **K tuyến ngắn nhất** (Yen) | `ShortestPath` | O(K · V · (V + E) log V) | Tuyến thay thế không lặp điểm; ứng viên lấy từ Min-Heap |
| **A\*** | `ShortestPath` | O((V + E) log V), thường xét ít đỉnh hơn nhiều | h = α × đường chim bay, α = min(w / chim bay) trên mọi cạnh nên heuristic **nhất quán** với mọi tiêu chí và dữ liệu |
| Theo hạn giao + tìm kiếm cục bộ | `Dispatcher` | O(lặp · n² · K · L) | Relocate (chuyển đơn giữa / trong tuyến) + 2-opt, mục tiêu (số đơn trễ, km); L = độ dài lộ trình |
| **Dijkstra phụ thuộc thời gian** (giờ cao điểm) | `ShortestPath` | như Dijkstra | Trọng số cạnh tính lúc xe tới cạnh: departAt + dist[u]; đúng nhờ tính FIFO |
| Thời gian đi theo giờ trong ngày | `WebServer` | O(144 · (V + E) log V) | Chạy Dijkstra theo giờ mỗi 10 phút |
| Kẹt xe / đóng đường | `Graph` | O(1) mỗi cạnh | Thời gian × hệ số kẹt; cạnh đóng bị bỏ qua khi duyệt |
| **Hoàn tác / làm lại** | `History` | O(1) mỗi thao tác | Hai ngăn xếp (`std::deque`), giới hạn 30 bước |
| **Trie** tìm điểm | `Trie` | Chèn O(L), tìm O(\|p\| + kết quả) | Chèn từng từ của tên đã bỏ dấu; mọi từ của truy vấn phải là tiền tố |
| **Hàng chờ duyệt shipper** | `MinHeap` (trong `WebServer`) | O(k log k) | Khoá = thời điểm đăng ký, ai đăng ký trước được duyệt trước |
| **Tìm không dấu trong danh sách** (`TextIndex`) | `Trie` | Dựng O(tổng độ dài), tìm O(\|q\| + kết quả) | Dùng lại cây Trie cho tên, tên đăng nhập, email, SĐT, người nhận, ghi chú |
| Bảng phiên, tra tài khoản | `Auth` | O(1) trung bình | Bảng băm `std::unordered_map`: mã phiên → phiên, tên đăng nhập → vị trí tài khoản |
| Sắp xếp danh sách + phân trang | `WebServer` | O(n log n) | `std::stable_sort` (cùng khoá giữ thứ tự cũ), so tên theo dạng bỏ dấu |
| Máy trạng thái đơn | `OrderFlow` | O(số chuyển) mỗi lần kiểm tra | Bảng (trạng thái, hành động) → (trạng thái sau, vai trò được phép) |
| SHA-256 tự cài | `Auth` | O(độ dài) mỗi lần băm | FIPS 180-4, 64 vòng nén mỗi khối 512 bit |
| Mô phỏng ca giao | `Operations` | O(số điểm giao) mỗi lần cập nhật | Giờ tới từng nút tính sẵn khi dựng lộ trình |
| Tính lại tuyến khi đóng đường giữa ca | `Operations` | O(m · (V + E) log V) mỗi chuyến | m = số điểm còn phải giao; Dijkstra theo thời gian cho từng chặng, giữ thứ tự giao |
| **Tarjan**: cầu và khớp | `Analysis` | O(V + E) | Một lần DFS (stack tự quản lý), so `low` với `disc`; gốc ở kho nên đếm được số đơn bị cắt |
| **Kruskal** | `Analysis` | O(E log E) | Sắp xếp cạnh + Disjoint Set Union (nén đường, hợp theo hạng) |
| **Prim** | `Analysis`, `MinHeap` | O(E log V) | Cùng `IndexedMinHeap` với Dijkstra; đồ thị rời thì ra rừng khung |
| **Floyd–Warshall** + vị trí kho | `Analysis` | O(V³) | V ≤ 400; đồ thị lớn hơn dùng Dijkstra trên đồ thị đảo chiều từ từng điểm giao |

**8 phương án điều phối được so sánh:**

| Nhóm | Phương án |
|---|---|
| Một xe, bỏ qua tải trọng (TSP) | Nearest Neighbor · Ưu tiên đơn gấp (Min-Heap + NN) · NN + 2-opt · **TSP bitmask (tối ưu)** |
| Nhiều shipper, có tải trọng (CVRP) | NN tuần tự · Hàng đợi ưu tiên + shipper gần nhất · Cheapest Insertion + 2-opt · Cheapest Insertion + TSP từng xe |

Mỗi phương án báo: tổng km, thời điểm xong việc, tổng chi phí, **số đơn trễ hạn** (giờ tới so với hạn giao), đơn không có đường, đơn quá tải, thời gian chạy (µs).

## Định dạng file dữ liệu

Dòng bắt đầu bằng `#` là chú thích. Đọc được file có BOM và xuống dòng kiểu Windows (CRLF). Khi file sai, chương trình báo **số dòng** và lý do, dữ liệu cũ giữ nguyên.

**`map.txt`**

```
DIRECTED 0                     # 0 = hai chiều, 1 = có hướng (tuỳ chọn)
NODES 3
# id  vi_do  kinh_do  ten
0 10.8040 106.7120 Kho Bình Thạnh
1 10.7725 106.6980 Chợ Bến Thành
2 10.7798 106.6990 Nhà thờ Đức Bà
EDGES 2
# u  v  km  phut  phu_phi(nghin d)  [loai_xe [he_so_cao_diem]]
0 2 4.1 6.1 0 7 2.2            # mọi loại xe, giờ cao điểm ô tô chậm ×2,2
2 1 1.1 2.2 0 3                # 3 = xe máy + ô tô (cấm xe tải), cao điểm mặc định ×1,5
```

Cột loại xe (tuỳ chọn, mặc định 7) là tổng các bit: 1 = xe máy, 2 = ô tô, 4 = xe tải. Cột hệ số cao điểm (tuỳ chọn, 1–5, mặc định 1,5) chỉ ghi được khi đã có cột loại xe; file cũ không có hai cột này vẫn đọc bình thường.

**`orders.txt`**

```
# id  nut_dich  kg  gap(0/1)  han(phut tu dau ca, -1 = khong co)  [cod=VND] [sdt=SO] [nhan=Ten_Nguoi_Nhan]  ghi_chu
101 1 2.5 1 45 sdt=0909101101 nhan=Cong_ty_An_Phat Tài liệu hợp đồng
103 10 8 0 120 cod=4500000 sdt=0909103103 nhan=Anh_Khoa Linh kiện điện tử
102 9 1.2 0 -1 Hành lý để quên
```

Các trường nghiệp vụ `cod=`, `sdt=`, `nhan=`, `kh=` đều tuỳ chọn, đứng ngay sau cột hạn giao; trong tên người nhận dấu `_` thay cho khoảng trắng; `kh=` là tài khoản khách hàng đã đặt đơn (khách chỉ thấy đơn có `kh=` của mình). File cũ không có các trường này vẫn đọc bình thường.

Phiên bản mới thêm các khoá **tuỳ chọn** (file cũ vẫn đọc được, file mới có thể chỉ dùng một phần):

| Khoá | Ý nghĩa | Khoá | Ý nghĩa |
|---|---|---|---|
| `ma=` | Mã giảm giá đã dùng | `tt=` | Trạng thái (0 Chờ giao, 1 Đang giao, 2 Đã giao, 3 Thất bại, 4 Đã huỷ, 5 Hoàn kho, 6 Mới, 7 Đã phân công) |
| `ck=` | Số tiền giảm nhờ mã (đ) | `sh=` | Tên shipper đang giữ đơn |
| `tv=` | Số tiền giảm theo hạng thân thiết (đ) | `eta=`, `gx=` | Phút dự kiến tới / phút giao xong (tính từ đầu ca) |
| `gia=` | Cước gốc lúc đặt (đ) | `lan=`, `ly=` | Số lần giao thất bại, mã lý do thất bại |
| `ngay=` | Thời điểm đặt (giây Unix) | `huy=` | Phí huỷ đã tính (đ) |
| `tao=` | Tài khoản đã tạo đơn | `bc=` | Ghi chú khi giao / lý do huỷ |
| `xn=` | Mã giao hàng 4 số | `gt=`, `cu=`, `dc=` | Giờ giao thật (giây Unix), đã vào sổ COD (1/0), mã địa chỉ trong sổ địa chỉ |
| `gtri=` | Giá trị hàng khai báo (đ) | `bh=` | Phí bảo hiểm đã tính lúc đặt / sửa (đ) |
| `kt=` | Kích thước kiện `DxRxC` (cm, mỗi cạnh 1–300) | `tra=1` | Người nhận trả cước |
| `hoan=` | Phí hoàn hàng đã tính (đ) | `xong=` | Thời điểm đơn kết thúc bằng huỷ / hoàn kho (giây Unix, dùng cho sao kê) |

`data/orders.txt` gốc không đổi. Các khoá vận hành (`tt=` trở đi) chỉ xuất hiện trong `data/orders_live.txt`, file làm việc mà server ghi lại sau mỗi thay đổi đơn của bộ TP.HCM. Khi ghi, ghi chú nào bắt đầu bằng một khoá ở trên (`cod=`, `kh=`, `ma=`...) được thêm dấu `-` phía trước để đọc lại không bị nhầm.

**`shippers.txt`**

```
# tai_trong(kg)  loai_xe(0 xe may, 1 o to, 2 xe tai)  ten
20 0 Anh Tuấn
60 2 Anh Cường
```

**`users.txt`** (do trang *Tài khoản* ghi, không cần sửa tay)

```
# ten_dang_nhap  vai_tro(admin/shipper/customer)  salt  bam  lien_ket(ten shipper, '-' neu khong)  [khoa=gia_tri ...]  ten_hien_thi
admin admin 5d030c1880fa807f 57120db6…5f7b - email=admin@giaohang.vn sdt=0900000001 Quản_trị_viên
tuan shipper 9d6993851258230c f4218714…0297 Anh_Tuấn email=tuan@giaohang.vn sdt=0911000001 xe=0 tai=20 bien=59A1-111.11 vitri=11 Anh_Tuấn
ctv_hung shipper b2d82fc617a11629 055d4c30…a055 - status=pending email=hung@example.com sdt=0913000001 tao=1792948351 xe=0 tai=18 bien=59B2-222.22 Anh_Hùng
```

`bam` = SHA-256 lặp 10.000 lần: `h = sha256(salt + ":" + mat_khau)`, rồi `h = sha256(h + salt)`. Tài khoản shipper gắn với shipper trong `shippers.txt` qua tên (đổi tên shipper ở trang Điều phối thì liên kết tự đổi theo). Vai trò `dispatcher` đã bỏ ở vòng 4 (dòng cũ vẫn đọc được, tài khoản bị khoá). Khoá mới `vitri=` là điểm bản đồ nơi shipper đang đứng. Các khoá tuỳ chọn mới (dòng của bản gốc không có vẫn đọc được, mặc định là tài khoản đang hoạt động): `status` (active / pending / locked / disabled), `ly_do` (lý do khoá / từ chối), `email`, `sdt`, `tao` / `dn` (thời điểm tạo / đăng nhập gần nhất, giây Unix), `xe` / `tai` / `bien` (loại xe, tải trọng, biển số của shipper), `sansang` (shipper sẵn sàng nhận chuyến, 1/0), `done` / `chi` (số đơn đã giao và tổng chi tiêu của khách, dùng để xếp hạng thân thiết).

**Các file dữ liệu mới** (mỗi loại một file riêng trong `data/`, ghi nguyên tử bằng file tạm + đổi tên; thiếu file thì bắt đầu từ rỗng, file lỗi được đổi tên thành `.bad` và bắt đầu lại từ rỗng). Chữ có dấu cách trong các cột ở giữa được mã hoá kiểu URL (`%20`); cột cuối cùng là văn bản tự do.

| File | Mỗi dòng |
|---|---|
| `config.txt` | `khoa gia_tri`: `tariff.firstKm`, `tariff.firstFee`, `tariff.perKm`, `tariff.freeKg`, `tariff.perKg`, `tariff.urgent`, `tariff.codRate`, `tariff.codMin`, `tariff.returnRate` (biểu phí, mặc định bằng biểu phí gốc), `tier <ten> <so_don_toi_thieu> <ti_le_giam>` (mỗi hạng một dòng), `cancel.dispatched`, `cancel.onRoute` (tỉ lệ phí huỷ), `shipperShare`, `scoreAware`, `maxOpenOrders`, `autoDeliver`, `ins.rate` (phí bảo hiểm, mặc định 0,005), `ins.threshold` (miễn phí bảo hiểm tới, mặc định 1.000.000 đ), `vol.divisor` (hệ số cân quy đổi, mặc định 6.000), `comp.multiplier` (trần bồi thường hàng không khai giá = hệ số × cước, mặc định 4), `debt.limit` (hạn mức nợ phí của khách, mặc định 500.000 đ, 0 = không chặn). File cũ thiếu 5 khoá này dùng giá trị mặc định |
| `promos.txt` | `ma loai(pct\|amt) gia_tri tran_giam don_toi_thieu tong_luot da_dung luot_moi_khach het_han(giay,0=khong) bat(1/0) mo_ta` |
| `addresses.txt` | `id khach_hang nut_ban_do mac_dinh(1/0) sdt nhan_goi_nho nguoi_nhan dia_chi_chi_tiet` |
| `reviews.txt` | `ma_don khach_hang shipper so_sao thoi_diem(giay) nhan_xet` |
| `customer_reviews.txt` | `ma_don khach_hang shipper so_sao thoi_diem(giay) nhan_xet`: shipper đánh giá khách (cùng định dạng `reviews.txt`) |
| `stats.txt` | `ten_shipper giao_xong dung_han that_bai nhan_chuyen tu_choi thu_nhap` |
| `notifications.txt` | `id nguoi_nhan thoi_diem(giay) da_doc(1/0) loai ma_don noi_dung` |
| `audit.txt` | `id thoi_diem(giay) nguoi_lam vai_tro hanh_dong doi_tuong chi_tiet` |
| `complaints.txt` | `C id khach ma_don trang_thai tao cap_nhat nguoi_xu_ly tieu_de` (phiếu) và `M id thoi_diem tac_gia vai_tro noi_dung` (tin nhắn trong phiếu) |
| `cod_ledger.txt` | `E id ma_don shipper so_tien trang_thai(held\|remitted\|settled) thu_luc phieu_nop chot_ca` (bút toán), `R id shipper luc_nop du_kien khai_nop trang_thai thanh_toan_luc dem_duoc nguoi_xac_nhan danh_sach_but_toan ghi_chu` (phiếu nộp), `K id shipper luc_chot so_don da_thu dem_duoc nguoi_chot` (chốt ca) |
| `customer_ledger.txt` | `T id loai(payout\|collect\|comp) khach so_tien luc(giay) nguoi_ghi ma_don ma_khieu_nai kenh(bank\|cash\|wallet) tham_chieu ghi_chu`: giao dịch tay của ví đối soát (chi trả, khách nộp bù, bồi thường). Các dòng thu hộ / cước / phí trong sao kê **không** lưu ở đây mà tính lại từ đơn và sổ COD mỗi lần xem, nên không thể lệch nhau |
| `orders_live.txt` | Cùng định dạng `orders.txt`, có thêm các khoá vận hành ở trên |

## Kịch bản demo khi bảo vệ

Ba bộ dữ liệu mẫu được dựng sẵn để minh hoạ từng thuật toán:

1. **Nội thành TP.HCM** (`map.txt`)
   - *Tìm đường* từ Kho Bình Thạnh tới Chợ Bến Thành: xe máy đi thẳng 5,2 km; chọn **xe tải** thì phải vòng qua Chợ Lớn (28,8 km) vì nội đô cấm xe tải. Cao tốc tới Khu Công nghệ cao cấm xe máy.
   - *Duyệt mạng*: 2 thành phần liên thông, cụm **Cần Giờ** tách rời, nên đơn 107 bị báo “không có đường”.
   - *Điều phối* (nhóm Một xe máy, tắt giờ cao điểm): **TSP bitmask** cho quãng đường ngắn nhất (70,8 km) nhưng **trễ 3 đơn**, còn “Ưu tiên đơn gấp” đi xa hơn mà chỉ trễ 1 đơn. Đây là ví dụ cho thấy quãng đường ngắn nhất chưa chắc là phương án tốt nhất. Bật giờ cao điểm (ca 08:00) thì các phương án đều chạy lâu hơn và trễ thêm.
2. **Quận 1: đường một chiều** (`map_oneway.txt`, có hướng)
   - Có tuyến được trợ giá nên chi phí cạnh âm. Trang *Chi phí* chạy Bellman-Ford từ kho: tới **Ga Sài Gòn**, Dijkstra cho 37,5k (**sai**), Bellman-Ford cho 34,5k (đúng, đi vòng qua Chợ Lớn để hưởng trợ giá). Lý do: Dijkstra đã “chốt” Ga Sài Gòn trước khi gặp cạnh âm.
3. **Dữ liệu lỗi: chu trình âm** (`map_negcycle.txt`)
   - Bellman-Ford phát hiện vòng *Hub Quận 5 → Chợ Lớn → Chợ Bến Thành → Hub Quận 5* có tổng chi phí âm và tô đỏ trên bản đồ.
4. **Vận hành một ca giao** (bộ dữ liệu TP.HCM):
   - *Điều phối* → chọn “Cheapest Insertion + TSP từng xe” → **Áp dụng**. Trang *Theo dõi* mở ra với 2 chuyến.
   - Bấm **Chạy**, tốc độ ×900: hai shipper chạy trên bản đồ, đơn chuyển *Đã giao* khi tới nơi. Bấm **Thất bại** ở một đơn, rồi **Giao lại** và quay lại *Điều phối*: lần này chỉ còn đơn đó, xe xuất phát từ giờ hiện tại của ca.
   - *Báo cáo*: tỉ lệ đúng hạn, km theo shipper, lịch sử điều phối, **Xuất CSV**; *In phiếu giao* ra phiếu A4 có cột ký nhận.
5. **Sự cố giao thông và tuyến thay thế**: ở *Bản đồ* chọn đoạn Kho Bình Thạnh – Nhà thờ Đức Bà, báo **Kẹt ×3**; chọn đoạn Chợ Bến Thành – Nhà thờ Đức Bà, bấm **Đóng**. Sang *Tìm đường* Kho → Chợ Lớn: tuyến tự đi vòng qua Ga Sài Gòn, kèm 3 tuyến thay thế (Yen). Bấm ↶ (Ctrl+Z) để hoàn tác từng sự cố.
6. **Giờ cao điểm**: *Tìm đường* Kho Bình Thạnh → Đầm Sen, ô tô, tiêu chí *Nhanh nhất*. Giờ đi 10:00: qua trung tâm (Nhà thờ Đức Bà, Chợ Bến Thành, Chợ Lớn), 24 phút. Đổi giờ đi 07:30: tuyến **tự đổi sang vòng qua Bến xe Miền Đông, sân bay**, 37 phút (nếu vẫn đi qua trung tâm thì mất 48 phút). Biểu đồ *Theo giờ đi* cho thấy hai “bướu” cao điểm sáng và chiều; bấm vào biểu đồ để đổi giờ. Ở *Điều phối*, đặt ca 07:00: mỗi tuyến hiện số phút *kẹt cao điểm* và giờ tới từng điểm lùi lại.
7. **Tìm kiếm**: gõ “ben thanh” (không dấu) ở ô tìm kiếm → ra *Chợ Bến Thành*, bản đồ đưa điểm vào giữa.
8. **Mô phỏng thuật toán**: trang *Mô phỏng*, Dijkstra từ Kho Bình Thạnh tới Đầm Sen, bấm ▶ từng bước: mã giả sáng dòng đang chạy, cây Min-Heap đổi sau mỗi lần pushOrDecrease / popMin, gốc heap luôn là đỉnh được chốt tiếp theo. Đổi sang A\*: ít bước hơn. Đổi sang bộ *Chu trình âm* rồi chạy Bellman-Ford: bước cuối báo chu trình âm.
9. **Đồ thị lớn**: mở *Đô thị mô phỏng (2.000 điểm)*. *Hiệu năng* → *Đo 100 cặp điểm*: A\* chỉ xét khoảng 1/4 số đỉnh so với Dijkstra, kết quả giống hệt. *Bản đồ* → bật *Giao thông theo giờ*, kéo tới 7:30: trung tâm đỏ, vành đai vẫn thông. *Điều phối* 24 đơn: phương án *Theo hạn giao* giao nhiều đơn nhất và không trễ.
10. **Hiệu năng**: ở 8.000 đỉnh, Dijkstra Min-Heap nhanh hơn bản mảng hàng chục đến hơn trăm lần (tuỳ máy), cả 3 bản cho cùng kết quả.
11. **Tình huống đặc biệt trong ca** (TP.HCM, ca 08:00): áp dụng phương án *Theo hạn giao*, chạy tới khoảng 08:20.
    - Ở *Bản đồ* đóng đoạn **Chợ Bến Thành – Chợ Lớn**: thông báo “2 chuyến đổi sang đường khác”, trang *Theo dõi* hiện lộ trình mới đi vòng qua Đầm Sen và giờ về chậm thêm. Bấm *Tính lại tuyến* bất cứ lúc nào để cập nhật theo giao thông hiện tại.
    - Bấm **Báo nghỉ** ở chuyến của Chị Bình: chuyến dừng ở điểm kế tiếp, đơn chưa giao quay về hàng chờ. Sang *Điều phối*: các phương án chỉ dùng người còn lại.
    - Bấm **Thất bại** một đơn, *Giao lại*, điều phối lại rồi **Thất bại** lần nữa: đơn chuyển *Hoàn kho*. Bấm **Huỷ** một đơn khác: *Khách huỷ*, bỏ khỏi chuyến.
    - Sửa đơn 105 thành 130 kg: danh sách đơn báo *Nặng hơn mọi xe*, bấm **Chia kiện** thành 3 kiện ≈ 43 kg.
12. **Phân tích mạng** (trang *Phân tích*): bộ TP.HCM không có đoạn trọng yếu trong cụm chính (đóng một đoạn bất kỳ vẫn còn đường vòng). Bộ *Quận 1 một chiều*: đoạn **Kho – Ngã tư Hai Bà Trưng** là cầu, đóng thì cả 6 đơn mất đường (bấm *Thử đóng đoạn này*, Ctrl+Z để hoàn tác). *Mạng tối thiểu*: Kruskal và Prim cùng ra 61,5 km / 94,4 km. *Vị trí kho*: Chợ Lớn tốt hơn kho hiện tại (trung bình ~10 km thay vì 11,1 km mỗi đơn).

13. **Nghiệp vụ giao hàng** (TP.HCM, ca 08:00):
    - *Điều phối* → *Thêm đơn*: chọn điểm giao, nhập người nhận, số điện thoại, COD 300.000 đ; ô *Cước giao* báo giá ngay (di chuột để xem từng khoản). Bỏ trống số điện thoại thì không lưu được đơn COD.
    - Áp dụng phương án, ở *Theo dõi* bấm **Thất bại** một đơn → chọn *Khách từ chối nhận*: đơn hoàn kho ngay; chọn *Khách vắng nhà*: còn 1 lần giao lại. *Nhật ký ca* ghi lại từng sự kiện theo giờ.
    - Giữa ca thêm đơn mới rồi điều phối: shipper đang chạy thì tuyến mới ghi “Xuất phát hh:mm” lúc người đó về tới kho.
    - *Báo cáo*: doanh thu, chi phí, lợi nhuận dự kiến; **đối soát COD** cho biết mỗi shipper phải nộp bao nhiêu; thống kê lý do thất bại; xuất CSV có người nhận, số điện thoại, COD, cước, lý do.

14. **Tài khoản, phân quyền, đơn hàng thương mại**: xem [Kịch bản demo theo vai trò](#kịch-bản-demo-theo-vai-trò) ngay dưới đây.

> Lưu ý với kịch bản 4, 11, 13 (vận hành ca bằng tài khoản `admin`): ở phiên bản mới, áp dụng phương án đưa đơn sang *Đã phân công* và chờ shipper nhận chuyến; đồng hồ ca không tự giao đơn. Muốn chạy như bản gốc (đồng hồ tự giao, không cần mã), vào *Cấu hình* bật **Chế độ mô phỏng**. Ghép đơn tự động áp dụng cho đơn do khách đặt; đơn nạp từ file (101–108) giữ nguyên để điều phối bằng thuật toán.

## Kịch bản demo theo vai trò

Chạy server trên **bản sao** thư mục dữ liệu để giữ dữ liệu mẫu sạch: `cp -r data /tmp/demo && ./delivery --data /tmp/demo`, rồi mở `http://localhost:8080`. Mỗi bước dưới đây có ảnh tương ứng trong `docs/screenshots/` (số ảnh ghi trong ngoặc).

1. **Khách vãng lai** (chưa đăng nhập): trang giới thiệu có **Báo giá thử** (chọn điểm giao, khối lượng, hoả tốc: cước tính bằng Dijkstra từ kho) và **Tra cứu đơn** bằng mã đơn + SĐT người nhận (01, 02, 23). Gõ thẳng `#dispatch` trên thanh địa chỉ: vẫn ở trang giới thiệu.
2. **Đăng ký khách hàng**: bấm *Đăng ký*, nhập sai (tên 2 ký tự, email sai, SĐT 3 số, mật khẩu yếu) → báo lỗi từng ô (03). Nhập đúng → tài khoản dùng được ngay (04, 05). Đăng ký lại cùng email → "Email này đã được sử dụng".
3. **Đăng ký shipper**: chọn *Shipper*, khai loại xe, tải trọng, biển số (06). Đăng nhập ngay → "Tài khoản của bạn đang chờ duyệt" (07). `ctv_hung` / `Hung@2026` là một hồ sơ chờ duyệt có sẵn.
4. **Khách hàng** `khachvip` / `HuongViet@2026` (hạng Kim cương), bật *Ghi nhớ đăng nhập* (08): *Tạo đơn* tới Khu Công nghệ cao, COD 350.000 đ, mã `GIAM10` → báo giá hiện cước gốc, giảm theo hạng, giảm theo mã, tổng (09). Thử mã `CHAOBAN` (hết hạn) và `HETLUOT` (hết lượt) để thấy thông báo lỗi. Đặt xong, đơn chuyển ngay sang **Đang tìm shipper gần nhất** (54); ở chế độ thủ công thì đơn ở trạng thái **Mới** (10).
5. **Ghép đơn tự động (thay cho điều phối viên)**: ở trình duyệt khác đăng nhập `tuan`, `binh`, `cuong` / `shipper123` (mặc định cả ba đã *sẵn sàng*). Hệ thống mời shipper **gần kho nhất** trước; trang *Chuyến của tôi* của người đó hiện thẻ **Đơn mới gần bạn** có thanh đếm ngược 45 giây, quãng đường tới kho và tới điểm giao, thu nhập, điểm của khách (55). Quản trị viên `admin` mở *Đơn hàng* thấy đơn đang *Đã mời shipper* kèm tên người được mời. Muốn thử luồng thủ công cũ: *Cấu hình* → tắt **Ghép đơn tự động**, khi đó đơn ở *Mới* → quản trị viên *Xác nhận* (11) → *Điều phối* → *Áp dụng* (12). Thử xác nhận lại cùng đơn → 409.
6. **Shipper**: bấm **Bỏ qua** (kèm lý do, 56) hoặc để hết giờ → lời mời chuyển sang shipper gần kế tiếp, người đã bỏ qua không được mời lại. Người kế bấm **Nhận đơn** (57): khách thấy ngay **thẻ tài xế** (tên, xe, biển số, điểm) và **mã nhận hàng 4 số**, bản đồ vẽ đường shipper chạy tới kho (nét đứt) rồi tuyến giao (58). Shipper bấm *Đã giao*, nhập sai mã → bị từ chối (14); nhập đúng mã (59) và đúng 350.000 đ → **Đã giao**, rồi **Đánh giá khách** 1–5 sao (60); khách đánh giá shipper trong chi tiết đơn (61). Trước khi lấy hàng shipper có nút **Nhả đơn** (kèm lý do). Tắt *Sẵn sàng nhận đơn* thì không nhận lời mời nữa; chọn lại **vị trí đang đứng** để đổi người "gần nhất".
7. **Sổ COD**: shipper vào *Sổ COD* → *Nộp tiền* (15); quản trị viên vào *Sổ COD* → *Xác nhận*, nhập số tiền đếm được (nhập thiếu để thấy chênh lệch) → *Chốt ca* (16, 17).
8. **Khách sau khi nhận hàng**: mở đơn → dòng thời gian, **hoá đơn** khớp báo giá, **đánh giá 5 sao** (18, 22). *Khiếu nại* → gửi phiếu gắn với đơn; quản trị viên chuyển *Đang xử lý* và trả lời (19); khách thấy **chuông thông báo** (20). *Hồ sơ*: sửa thông tin, xem thiết bị đang đăng nhập, sổ địa chỉ (21). **Huỷ đơn**: bắt buộc chọn / nhập lý do (63); chưa ai nhận thì miễn phí, shipper đã nhận mà chưa lấy hàng thì phí 20%, shipper đã lấy hàng thì khách không huỷ được.
9. **Quên mật khẩu**: màn đăng nhập → *Quên mật khẩu?* → nhập email (24) → mở **hộp thư giả lập** lấy mã 6 số (25) → đặt mật khẩu mới (26). Dùng lại mã cũ → bị từ chối, phải xin mã mới.
10. **Quản trị viên** `admin` / `admin123` (27): *Tài khoản* → **hàng chờ duyệt** (Min-Heap, đăng ký sớm trước) → *Duyệt* `ctv_hung` (tự thêm vào đội xe) hoặc *Từ chối* kèm lý do; khoá một khách (bắt buộc lý do) rồi thử đăng nhập bằng khách đó (28). *Nhật ký* → lọc theo người / hành động, **Xuất CSV** (29). *Cấu hình*: biểu phí, hạng thân thiết, mã giảm giá, phí huỷ (30). *Thống kê* (31, 32).
11. **Khoá luỹ tiến**: nhập sai mật khẩu 5 lần → "thử lại sau 60 giây"; hết khoá, sai tiếp 5 lần → 120 giây.
12. **Kiểm tra quyền bằng curl** (server phải chạy trên bản sao dữ liệu): `tools/demo_curl.sh http://127.0.0.1:8080` in ra các trường hợp **401** (chưa đăng nhập), **403** (sai vai trò, xem đơn của người khác, thiếu CSRF, Origin lạ, tự đăng ký admin), **409** (chuyển trạng thái sai) và **429** (khoá đăng nhập). Kết quả mẫu: [`docs/curl-demo.txt`](docs/curl-demo.txt).
13. **Giao diện**: nút ◐ đổi sáng / tối (33); thu nhỏ cửa sổ để xem bản điện thoại (34, 35).
14. **Nghiệp vụ mở rộng** (36–50, chế độ thủ công): khách `khachvip` tạo đơn khai giá 3.000.000 đ, kiện 60×50×40 cm, *Người nhận trả* → báo giá có bảo hiểm 15.000 đ và cân tính cước 20 kg (36); bấm **Sửa đơn** đổi khai giá thành 5.000.000 đ → bảo hiểm 25.000 đ (37). Quản trị viên xác nhận, vào *Đơn hàng* → *Chờ giao*, tích chọn đơn, chọn shipper → **Phân công** (38); vào *Theo dõi* → **Thu hồi** chuyến chưa nhận (39), rồi phân công lại. Shipper nhận chuyến: thẻ điểm giao ghi *Thu của người nhận* gồm cước (40), nhập thiếu tiền bị từ chối (41). Báo một đơn thất bại → khách bấm **Hẹn giao lại** và để lời nhắn (42), hoặc **Hoàn hàng** (báo trước phí hoàn). Khách gửi khiếu nại hàng móp → quản trị viên **Bồi thường** loại *Hàng hư hỏng* (tối đa bằng giá trị khai) (44) → khách thấy tiền trong **Ví** (43). Quản trị viên vào **Ví** → chọn khách → **Chi trả** bằng chuyển khoản có mã giao dịch (47, 48). *Thống kê* của quản trị viên có bảng **Cần xử lý** (46) và **doanh thu 14 ngày** (49); *Cấu hình* có mục bảo hiểm & bồi thường (50).
15. **Kiểm tra quyền và ghép đơn bằng curl**: `tools/demo_curl.sh` còn chạy một vòng ghép đơn thật: khách đặt đơn → hệ thống mời shipper gần nhất → shipper không được mời nhận thì **403** → người được mời nhận → nhận lần hai **409** → khách huỷ không lý do **400** → huỷ có lý do **200**. Kết quả mẫu: [`docs/curl-demo.txt`](docs/curl-demo.txt).

## REST API

Mọi API trả JSON. Tham số POST gửi dạng form (`application/x-www-form-urlencoded`), riêng `import/*` gửi nội dung file trong body. Quyền của từng API: xem [Ma trận phân quyền](#ma-trận-phân-quyền).

**Mã lỗi:** khi lỗi, API trả `{"ok": false, "error": "..."}` (lỗi nhập liệu có thêm `"fields": {"ô": "lỗi"}`) với mã HTTP:

| Mã | Khi nào |
|---|---|
| 400 | Dữ liệu không hợp lệ (kèm `fields` để giao diện tô đỏ từng ô) |
| 401 | Chưa đăng nhập hoặc phiên hết hạn (`"auth": true`), hoặc sai thông tin đăng nhập |
| 403 | Đăng nhập rồi nhưng vai trò không có quyền, xin dữ liệu của người khác (IDOR), thiếu / sai mã CSRF, Origin lạ, tài khoản chờ duyệt / bị khoá |
| 404 | Không có API hoặc không có đối tượng |
| 409 | Xung đột trạng thái: chuyển trạng thái đơn sai, chuyến đã nhận, khoá tài khoản đang bị khoá... |
| 429 | Quá nhiều lần (đăng nhập sai, đăng ký, xin mã OTP, nhập sai mã giao hàng), kèm header `Retry-After` |
| 500 | Lỗi không lường trước, chỉ trả thông báo chung |

**Đăng nhập:** `POST /api/login` đặt cookie HttpOnly `dt08_session` và trả mã CSRF trong `user.csrf`; trình duyệt gửi lại mã này ở header `X-CSRF-Token` với mọi POST. Script / curl gửi thêm `bearer=1` để nhận `token`, rồi dùng header `Authorization: Bearer <token>` (không cần CSRF).

**API của phần tài khoản và thương mại** (mới, hoặc có từ bản gốc nhưng đổi tham số):

| Phương thức | Đường dẫn | Tham số | Chức năng |
|---|---|---|---|
| POST | `/api/login` | `identifier` (tên đăng nhập, email hoặc SĐT; tên cũ `username` vẫn dùng được), `password`, `remember` (1 = ghi nhớ 30 ngày), `bearer` (1 = trả `token`) | Đăng nhập (tên đăng nhập, email hoặc SĐT) |
| POST | `/api/logout` |  | Đăng xuất |
| GET | `/api/me` |  | Xem tài khoản đang đăng nhập; trả thêm `rev` (số tăng mỗi khi dữ liệu đổi) để giao diện hỏi 3 giây một lần và chỉ tải lại state khi `rev` đổi |
| POST | `/api/register` | `role` (customer / shipper), `username`, `displayName`, `email`, `phone`, `password`, `confirm`, `terms`; shipper thêm `vehicle`, `capacity`, `plate`; `website` là ô bẫy, phải để trống | Đăng ký khách hàng / shipper |
| POST | `/api/password/forgot` | `email` | Yêu cầu mã đặt lại mật khẩu |
| POST | `/api/password/reset` | `email`, `otp`, `password`, `confirm` | Đặt lại mật khẩu bằng mã OTP |
| GET | `/api/mailbox` | `email` | Hộp thư giả lập (chỉ khi bật chế độ demo) |
| POST | `/api/me/password` | `old`, `new`, `confirm` | Đổi mật khẩu |
| GET | `/api/profile` |  | Xem hồ sơ cá nhân |
| POST | `/api/profile/update` | `displayName`, `email`, `phone` | Sửa tên, email, SĐT |
| GET | `/api/sessions` |  | Xem các thiết bị đang đăng nhập |
| POST | `/api/sessions/revoke` | `sid` | Đăng xuất một thiết bị |
| POST | `/api/sessions/revoke-others` |  | Đăng xuất mọi thiết bị khác |
| GET | `/api/addresses` |  | Xem sổ địa chỉ |
| POST | `/api/addresses/add` | `default`, `label`, `recipient`, `phone`, `detail`, `node` | Thêm địa chỉ |
| POST | `/api/addresses/update` | `id`, `default`, `label`, `recipient`, `phone`, `detail`, `node` | Sửa địa chỉ |
| POST | `/api/addresses/remove` | `id` | Xoá địa chỉ |
| POST | `/api/addresses/default` | `id` | Đặt địa chỉ mặc định |
| POST | `/api/shipper/ready` | `ready` | Bật / tắt sẵn sàng nhận đơn (tắt khi đang giữ lời mời thì lời mời được gỡ) |
| POST | `/api/shipper/location` | `node` | Shipper chọn điểm đang đứng (căn cứ chọn người gần kho nhất); 409 khi đang có đơn |
| POST | `/api/shipper/vehicle` | `vehicle`, `capacity`, `plate` | Cập nhật thông tin xe |
| GET | `/api/shipper/stats` | `name` | Thống kê shipper (đúng hạn, đánh giá, thu nhập) |
| GET | `/api/users` | `role`, `status`, `q`, `sort`, `dir`, `size`, `page` | Danh sách tài khoản (tìm kiếm, lọc, phân trang) |
| GET | `/api/users/queue` |  | Hàng chờ duyệt shipper (Min-Heap) |
| POST | `/api/users/add` | `username`, `password`, `displayName`, `email`, `phone`, `link`, `role` | Tạo tài khoản |
| POST | `/api/users/update` | `username`, `role`, `link`, `displayName`, `email`, `phone`, `password` | Sửa tài khoản, vai trò, đặt lại mật khẩu |
| POST | `/api/users/remove` | `username` | Xoá tài khoản |
| POST | `/api/users/status` | `username`, `status`, `reason` | Duyệt / từ chối / khoá / mở khoá tài khoản |
| GET | `/api/public/info` |  | Thông tin công khai: điểm giao, biểu phí |
| GET | `/api/quote` | `destination`, `weight`, `urgent`, `cod`, `promo`, `value` (giá trị khai báo, đ), `length`, `width`, `height` (cm), `payer` (sender / receiver) | Báo giá cước (Dijkstra) — khách vãng lai dùng thử được; trả thêm `insurance`, `total`, `chargedWeight`, `volWeight`, `collect` |
| GET | `/api/track` | `code`, `phone` | Tra cứu đơn bằng mã đơn + SĐT người nhận |
| POST | `/api/order/add` | `id`, `address`, `owner`, `promo`, `destination`, `weight`, `urgent`, `deadline`, `note`, `cod`, `phone`, `recipient`, `value` (giá trị khai báo, đ), `length`, `width`, `height` (cm), `payer` (sender / receiver) | Tạo đơn. Khách đang nợ phí quá hạn mức → **409** |
| POST | `/api/order/update` | `id`, `owner`, `destination`, `weight`, `urgent`, `deadline`, `note`, `cod`, `phone`, `recipient`, `value` (giá trị khai báo, đ), `length`, `width`, `height` (cm), `payer` (sender / receiver) | Sửa đơn (khi chưa phân công) |
| POST | `/api/order/edit` | như `order/update` (trừ `owner`) | Khách tự sửa đơn của mình khi còn *Mới*; cước, bảo hiểm tính lại |
| POST | `/api/order/redeliver` | `id`, `phone`, `note` (tuỳ chọn) | Khách hẹn giao lại đơn *Thất bại* (đổi được SĐT người nhận / lời nhắn) |
| POST | `/api/order/return` | `id` | Khách yêu cầu hoàn đơn *Thất bại* về kho, tính phí hoàn
| POST | `/api/order/confirm` | `id` | Xác nhận đơn mới (Mới → Chờ giao) |
| POST | `/api/order/reject` | `id`, `reason` | Từ chối đơn mới (kèm lý do) |
| POST | `/api/order/cancel` | `id`, `reason` | Huỷ đơn (theo quy tắc và phí huỷ) |
| POST | `/api/order/deliver` | `id`, `note`, `force`, `code`, `cash` | Xác nhận đã giao bằng mã 4 số |
| POST | `/api/order/rate` | `id`, `stars`, `comment` | Đánh giá shipper (1–5 sao) |
| POST | `/api/order/rate-customer` | `id`, `stars`, `comment` | Shipper đánh giá khách sau khi giao (1–5 sao, mỗi đơn một lần) |
| POST | `/api/order/retry` | `id` | Tìm lại shipper cho đơn *Chờ giao* chưa có ai nhận (xoá danh sách đã mời); khách và quản trị viên |
| POST | `/api/order/release` | `id`, `reason` | Shipper nhả đơn đã nhận khi chưa lấy hàng, đơn về *Chờ giao* để mời người khác |
| GET | `/api/orders/list` | `status`, `owner`, `urgent`, `from`, `to`, `q`, `sort`, `dir`, `size`, `page` | Danh sách đơn (tìm kiếm, lọc, sắp xếp, phân trang) |
| GET | `/api/order/get` | `id` | Chi tiết đơn |
| GET | `/api/order/invoice` | `id` | Hoá đơn của đơn |
| GET | `/api/promos` |  | Danh sách mã giảm giá |
| POST | `/api/promos/save` | `code`, `type`, `value`, `maxDiscount`, `minFee`, `maxUses`, `perUser`, `expires`, `active`, `description` | Thêm / sửa mã giảm giá |
| POST | `/api/promos/remove` | `code` | Xoá mã giảm giá |
| GET | `/api/dispatch` | `return`, `vehicle` | Chạy các phương án điều phối |
| POST | `/api/dispatch/apply` | `plan`, `return`, `vehicle` | Áp dụng phương án |
| POST | `/api/trip/accept` | `id` | Shipper nhận lời mời / chuyến (chỉ người được mời, 403 với người khác; nhận lần hai 409) |
| POST | `/api/trip/decline` | `id`, `reason` | Shipper bỏ qua lời mời / từ chối chuyến (kèm lý do), hệ thống mời người kế |
| POST | `/api/trip/recall` | `id`, `reason` | Quản trị viên thu hồi chuyến / lời mời shipper chưa nhận, đơn về *Chờ giao* |
| POST | `/api/dispatch/assign` | `orders` (danh sách mã, cách nhau dấu phẩy), `shipper` (chỉ số), `return` (1 = quay về kho) | Phân công tay các đơn *Chờ giao* đã chọn cho một shipper; thứ tự giao vẫn do thuật toán *Theo hạn giao* xếp, đơn quá tải trọng ở lại hàng chờ |
| POST | `/api/shift/return` | `id` | Hoàn kho đơn thất bại (tính phí hoàn) |
| GET | `/api/cod` | `shipper` | Xem sổ COD (shipper chỉ thấy của mình) |
| POST | `/api/cod/remit` | `handed`, `shipper` | Shipper nộp tiền thu hộ |
| POST | `/api/cod/confirm` | `remit`, `counted`, `note`, `shipper` | Xác nhận đã nhận tiền, ghi chênh lệch |
| POST | `/api/cod/close` | `shipper` | Chốt ca của shipper |
| GET | `/api/complaints` | `id`, `status`, `q`, `sort`, `dir`, `size`, `page` | Danh sách khiếu nại (khách chỉ thấy của mình) |
| POST | `/api/complaint/add` | `order`, `title`, `body` | Gửi khiếu nại gắn với đơn |
| POST | `/api/complaint/message` | `id`, `text` | Trao đổi trong khiếu nại |
| POST | `/api/complaint/status` | `id`, `status` | Chuyển trạng thái khiếu nại |
| POST | `/api/complaint/compensate` | `id`, `kind` (late / damaged / lost / other), `amount`, `note` | Bồi thường vào ví đối soát của khách (mỗi phiếu một lần, có trần) |
| GET | `/api/wallet` | `customer` (nhân viên xem của khách bất kỳ) | Ví / sao kê đối soát: `balance`, `available`, `pending`, `debtLimit`, `lines` |
| GET | `/api/wallets` |  | Số dư đối soát của mọi khách, tổng phải trả / khách nợ |
| POST | `/api/wallet/payout` | `customer`, `kind` (payout / collect), `amount`, `method` (bank / cash), `ref` (mã chuyển khoản), `note` | Chi trả cho khách hoặc ghi nhận khách nộp bù (chỉ quản trị viên) |
| GET | `/api/notifications` | `unread`, `limit` | Thông báo của tôi |
| POST | `/api/notifications/read` | `id` | Đánh dấu đã đọc |
| POST | `/api/notifications/read-all` |  | Đánh dấu đã đọc tất cả |
| GET | `/api/config` |  | Xem biểu phí, hạng thân thiết, quy tắc |
| POST | `/api/config/update` | `firstKm`, `firstFee`, `perKm`, `freeKg`, `perKg`, `urgent`, `codRate`, `codMin`, `returnRate`, `cancelDispatched`, `cancelOnRoute`, `shipperShare`, `maxOpenOrders`, `insRate`, `insThreshold`, `volDivisor`, `compMultiplier`, `debtLimit` (0–100.000.000 đ, 0 = không chặn), `scoreAware`, `autoDeliver`, `autoMatch`, `offerSeconds` (1–600), `matchGiveUp` (0–240), `clockSpeed` (0–120), `tiers` | Sửa biểu phí, hạng thân thiết, quy tắc, ghép đơn tự động |
| GET | `/api/audit` | `actor`, `action`, `target`, `from`, `to`, `size`, `page` | Nhật ký kiểm toán |
| GET | `/api/audit/export` | `actor`, `action`, `target`, `from`, `to` | Xuất nhật ký kiểm toán CSV |
| GET | `/api/reports/summary` |  | Báo cáo theo vai trò: khách có thêm `wallet`; nhân viên có `alerts` (việc cần xử lý); quản trị viên có `daily` (doanh thu 14 ngày), `insurance`, `returnFees` |

**API của bản gốc** (vẫn giữ nguyên tham số; quyền đổi theo ma trận ở trên):

| Phương thức | Đường dẫn | Tham số | Chức năng |
|---|---|---|---|
| GET | `/api/state` | | Toàn bộ trạng thái: bản đồ, đơn (kèm cước), shipper, kho, ca, nhật ký, `finance` (doanh thu, chi phí, COD, đối soát, biểu phí) |
| POST | `/api/dataset` | `key` = hcm / oneway / negcycle / saved | Mở bộ dữ liệu |
| POST | `/api/graph/new` | `directed` | Tạo bản đồ trống |
| POST | `/api/node/add` · `update` · `remove` | `id`, `name`, `x`, `y` | Thêm / sửa / xoá điểm |
| POST | `/api/edge/add` · `update` · `remove` | `u`, `v`, `km`, `time`, `cost`, `allowed` | Thêm / sửa / xoá đoạn đường |
| POST | `/api/depot` | `id` | Đặt kho |
| GET | `/api/print` | | Danh sách kề dạng văn bản |
| GET | `/api/traverse` | `start`, `algo` = bfs / dfs / dfsi | Thứ tự duyệt và cây duyệt |
| GET | `/api/components` | | Liên thông, liên thông mạnh, điểm kho không tới được |
| GET | `/api/zone` | `depot`, `hops` | Vùng giao trong k chặng |
| GET | `/api/zones` | `depots` = 0,7 | Chia vùng nhiều kho |
| GET | `/api/path` | `src`, `dst`, `algo` = heap / stl / array / bellman / bfs, `criterion` = distance / time / cost, `vehicle` = 0..3, `depart` (phút trong ngày, tuỳ chọn) | Đường đi và bảng so sánh 5 thuật toán; có `depart` thì tính giờ cao điểm |
| GET | `/api/trace` | `algo` = dijkstra / astar / bfs / dfs / bellman, `src`, `dst`, `criterion`, `vehicle` | Các bước chạy (tối đa 4.000) cho trang Mô phỏng |
| GET | `/api/benchmark/p2p` | `pairs`, `criterion` | Dijkstra (dừng sớm) so với A* trên bản đồ hiện tại |
| GET | `/api/timeprofile` | `src`, `dst`, `vehicle`, `step` (phút) | Thời gian đi nhanh nhất theo giờ xuất phát trong ngày |
| GET | `/api/bellman` | `src`, `criterion`, `vehicle` | Bellman-Ford, chu trình âm, so sánh với Dijkstra |
| GET | `/api/estimate` | `depot`, `stops` = 1,7,8, `vehicle`, `return`, `depart` | Dự toán tuyến nhiều điểm |
| POST | `/api/order/add` · `update` · `remove` | `id`, `destination`, `weight`, `urgent`, `deadline`, `note`, `recipient`, `phone`, `cod` | Quản lý đơn |
| GET | `/api/quote` | `destination`, `weight`, `urgent`, `cod` | Báo giá cước giao một đơn (chi tiết từng khoản) |
| POST | `/api/shipper/add` · `update` · `remove` | `index`, `name`, `capacity`, `vehicle` | Quản lý shipper |
| GET | `/api/dispatch` | `vehicle`, `return` | Chạy và so sánh 8 phương án |
| GET | `/api/benchmark` | `sizes` = 100,1000, `degree`, `repeats` | Đo 3 bản Dijkstra |
| GET | `/api/export/map` · `orders` · `shippers` | | Tải file văn bản |
| POST | `/api/import/map` · `orders` · `shippers` | nội dung file trong body | Nhập file |
| POST | `/api/orders/random` | `count` | Tạo đơn mẫu ngẫu nhiên tại các điểm kho tới được |
| POST | `/api/save` | | Lưu vào `data/my_map.txt`, `data/my_orders.txt` |
| POST | `/api/undo` · `/api/redo` | | Hoàn tác / làm lại thay đổi bản đồ |
| POST | `/api/traffic` | `u`, `v`, `jam` = 1..10, `closed` = 0/1 | Báo kẹt xe / đóng / thông đường |
| POST | `/api/traffic/clear` | | Xoá mọi sự cố giao thông |
| GET | `/api/search` | `q`, `limit` | Tìm điểm theo tên (Trie, không dấu) |
| GET | `/api/kpaths` | `src`, `dst`, `k` = 1..6, `criterion`, `vehicle`, `depart` | K tuyến ngắn nhất (Yen) |
| POST | `/api/settings` | `shiftStart` (phút từ 0:00), `rush` = 0 / 1 | Giờ bắt đầu ca, bật / tắt giờ cao điểm |
| POST | `/api/dispatch/apply` | `plan` (mã phương án), `vehicle`, `return` | Áp dụng phương án: tạo chuyến giao |
| POST | `/api/shift/progress` | `t` (phút từ đầu ca) | Đồng hồ ca chạy tới t; chỉ ở chế độ mô phỏng thì đơn tới nơi tự thành *Đã giao* (bình thường shipper xác nhận bằng mã) |
| POST | `/api/shift/fail` | `id`, `reason` = 0..5 (vắng nhà, sai địa chỉ, từ chối, hư hỏng, hẹn lại, khác) | Báo giao thất bại; từ chối / hư hỏng hoặc lần thứ 2 thì hoàn kho |
| POST | `/api/shift/requeue` | `id`, `phone`, `note` (tuỳ chọn) | Đưa đơn thất bại về hàng chờ |
| POST | `/api/shift/reset` | | Đặt lại ca: xoá chuyến, mọi đơn về chờ giao |
| POST | `/api/shift/cancel` | `id`, `reason` | Tên cũ của `order/cancel` (giữ để tương thích) |
| POST | `/api/shift/absent` · `available` | `index` | Shipper nghỉ đột xuất / có mặt lại |
| POST | `/api/shift/reroute` | | Tính lại tuyến các chuyến theo giao thông hiện tại (tự chạy khi báo kẹt / đóng đường giữa ca) |
| POST | `/api/order/split` | `id`, `parts` (tuỳ chọn) | Chia đơn nặng hơn mọi xe thành nhiều kiện |
| GET | `/api/analysis` | `vehicle` | Cầu và khớp (Tarjan), cây khung nhỏ nhất (Kruskal, Prim), xếp hạng vị trí kho (Floyd–Warshall) |

Ví dụ:

```bash
TOKEN=$(curl -s -X POST localhost:8080/api/login -d identifier=admin -d password=admin123 -d bearer=1 | sed 's/.*"token":"\([0-9a-f]*\)".*/\1/')
curl -H "Authorization: Bearer $TOKEN" "http://localhost:8080/api/path?src=0&dst=1&vehicle=2"
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:8080/api/dispatch/apply     # 401: chưa đăng nhập
```

Đầy đủ các trường hợp 401 / 403 / 409 / 429: `tools/demo_curl.sh` (kết quả mẫu ở [`docs/curl-demo.txt`](docs/curl-demo.txt)).

## Kiểm thử

```bash
make test               # 8 bộ test C++ (hoặc: cd build && ctest)
make diff-standalone    # so khớp bản một file với server C++ (cần Node.js)
```

Kết quả hiện tại: **cả 8 bộ đều đạt** (41 + 382 + 1.664 + 3.693 + 108 + 206 + 1.079 + 974 kiểm tra). Sáu bộ cũ giữ nguyên, chỉ sửa **một dòng** trong `test_auth.cpp`: số tài khoản mẫu trong `data/users.txt` từ 6 thành 9 (thêm khách chủ cửa hàng, shipper chờ duyệt, khách thân thiết; 6 tài khoản cũ giữ nguyên mật khẩu). `test_auth` có 206 kiểm tra thay vì 200 vì vòng lặp ghi rồi đọc lại `users.txt` kiểm tra 2 điều cho mỗi tài khoản (3 tài khoản mới → thêm 6 kiểm tra).

- `tests/test_traversal_fileio.cpp` (41 kiểm tra): BFS/DFS, đường ít chặng, liên thông, Kosaraju, vùng giao, đọc/ghi lại file (round-trip), bắt 9 loại lỗi file, CRLF + BOM.
- `tests/test_features.cpp` (1.664 kiểm tra): kẹt xe làm tăng thời gian, đóng đường thì tuyến đi vòng, hai ngăn xếp hoàn tác (giới hạn bước, thao tác mới xoá ngăn làm lại), chuẩn hoá tiếng Việt không dấu, Trie và tìm theo nhiều từ, Yen trên ví dụ kinh điển (5, 7, 8) và trên bản đồ thật, mốc thời gian dọc lộ trình, áp dụng / giao / thất bại / đưa về hàng chờ / điều phối lại giữa ca / đặt lại ca; giờ cao điểm: mức đông theo giờ, Dijkstra theo giờ trùng Dijkstra thường lúc vắng, đổi tuyến lúc 7:30, 3 bản Dijkstra và Bellman-Ford cùng kết quả theo giờ, tính FIFO, Yen theo giờ, dự toán và điều phối chậm hơn khi ca bắt đầu 7:00; A\* cho cùng khoảng cách với Dijkstra trên 2 bản đồ × 3 tiêu chí × 4 loại xe và xét ít đỉnh hơn; mô phỏng từng bước cho kết quả trùng thuật toán gốc, mỗi lần lấy ra đúng khoá nhỏ nhất của heap, BFS/DFS cùng thứ tự với `Traversal`, phát hiện chu trình âm; phương án theo hạn giao không kém phương án nào (số đơn giao, số trễ, km) và mỗi đơn xuất hiện đúng một lần.
- `tests/test_extensions.cpp` (3.693 kiểm tra): Tarjan so với cách vét cạn "bỏ thử từng cạnh / từng điểm rồi đếm thành phần" trên ví dụ tự dựng, 2 bản đồ thật và 6 đồ thị ngẫu nhiên, đồ thị 2.000 điểm không tràn stack; Kruskal = Prim trên 3 bản đồ và 20 đồ thị ngẫu nhiên, số cạnh = V − số cây, không tạo chu trình; Floyd–Warshall trùng Dijkstra ở mọi cặp điểm × 3 loại xe; vị trí kho gợi ý không tệ hơn kho hiện tại, tổng km khớp Dijkstra; huỷ đơn, thất bại 2 lần thì hoàn kho, shipper nghỉ (đơn về hàng chờ, chuyến dừng ở đỉnh kế tiếp), đóng đường giữa ca thì lộ trình mới không đi qua đoạn đóng và giờ tới khớp từng điểm, kẹt xe chỉ làm muộn giờ tới, điểm bị cô lập thì đơn trả về hàng chờ.
- `tests/test_auth.cpp` (200 kiểm tra): SHA-256 đúng các vector chuẩn FIPS (chuỗi rỗng, "abc", 448 bit, một triệu ký tự 'a') và các độ dài sát biên khối; băm mật khẩu đúng định nghĩa, khác muối thì khác băm; đọc `users.txt` mẫu và đăng nhập đúng / sai, ghi rồi đọc lại, bắt lỗi file (vai trò, băm, trùng tên, BOM / CRLF); thêm / sửa / xoá tài khoản, kiểm tra tên đăng nhập và độ mạnh mật khẩu, không xoá / hạ quyền quản trị viên cuối cùng, đổi mật khẩu thì đổi muối, đổi tên shipper thì liên kết đi theo; phiên hết hạn khi không dùng và được gia hạn khi dùng, đăng xuất mọi phiên của một tài khoản; khoá sau 5 lần sai và hết khoá thì đếm lại; bảng phân quyền 3 vai trò trên 21 API chỉ dành cho quản trị viên; trường `kh=` trong `orders.txt`.
- `tests/test_business.cpp` (108 kiểm tra): đọc / ghi lại trường `cod=`, `sdt=`, `nhan=` (kể cả ghi chú trùng dạng khoá, file định dạng cũ), bắt lỗi COD âm / quá 50 triệu / số điện thoại sai; biểu phí từng khoản và làm tròn 500 đ, quãng đường tính phí bỏ qua sự cố tạm thời; lý do thất bại (từ chối / hư hỏng hoàn kho ngay, hoàn kho không đưa lại hàng chờ); shipper đang chạy chuyến trước thì chuyến mới xuất phát lúc về kho, không chuyến nào của cùng một người chồng giờ; doanh thu – chi phí – lợi nhuận và đối soát COD khớp cộng tay; nhật ký ca; đổi tuyến khi shipper đang giao đơn thứ hai ở cùng một điểm.
- `tests/test_algorithms.cpp` (382 kiểm tra): Min-Heap so với sắp xếp, 3 bản Dijkstra cho cùng kết quả theo cả 3 tiêu chí, đường cấm xe tải, Bellman-Ford trùng Dijkstra khi trọng số không âm, ca Dijkstra sai do cạnh âm, phát hiện chu trình âm, công thức dự toán, TSP ≤ 2-opt ≤ NN, không shipper nào vượt tải, lộ trình là đường đi liên tục trên bản đồ.
- `tests/test_commerce.cpp` (1.079 kiểm tra, mới): chính sách mật khẩu, khoá luỹ tiến, giới hạn tần suất, mã OTP (hết hạn, dùng một lần, giới hạn số lần thử), vòng đời tài khoản, bảng quyền 4 vai trò, **máy trạng thái đơn với mọi cặp trạng thái × hành động × vai trò**, phí huỷ, báo giá / mã giảm giá / hạng thân thiết, sổ COD, khiếu nại, thông báo, nhật ký kiểm toán (CSV chống chèn công thức), tìm kiếm không dấu (`TextIndex`), đọc / ghi lại `orders.txt` với các cột mới (file cũ vẫn đọc được); **bản 3**: cân quy đổi, phí bảo hiểm và mức miễn phí, kiểm tra kích thước, trần bồi thường, sổ giao dịch khách (đọc / ghi lại, bắt lỗi), sao kê (thu hộ chờ đối soát không rút được, người nhận trả thì không trừ cước, phí huỷ / hoàn, chi trả / nộp bù / bồi thường), round-trip các khoá `gtri=`, `bh=`, `kt=`, `tra=`, `hoan=`, `xong=`; **vòng 4**: file cũ còn vai trò `dispatcher` thì tài khoản bị khoá kèm lý do, khoá `vitri=` (vị trí shipper), cấu hình ghép đơn (lưu / đọc lại, miền giá trị), điểm trung bình khách do shipper chấm, `ShiftManager` (lời mời im lặng, nhận muộn thì lùi giờ, nhả đơn trước khi lấy hàng, vị trí chờ, dọn chuyến rỗng).
- `tests/test_web.cpp` (974 kiểm tra, mới): khởi động server thật trên bản sao `data/` và gọi HTTP như trình duyệt: đăng ký (hợp lệ, trùng, sai định dạng, spam, honeypot), duyệt shipper, đăng nhập 3 kiểu, khoá luỹ tiến, quên / đặt lại mật khẩu, **ma trận quyền 4 chủ thể × mọi API (570 ô)**, IDOR, máy trạng thái (409), mã giao hàng, COD, mã giảm giá, phí huỷ, khiếu nại, thông báo, kiểm toán, CSRF / Origin, tiêu đề bảo mật, mỗi loại dữ liệu ghi ra file riêng; **bản 3**: báo giá có bảo hiểm / cân quy đổi, khách sửa đơn (chỉ khi *Mới*, không sửa đơn người khác), hạn giao đã qua bị từ chối, người nhận trả thì shipper phải thu đúng *thu hộ + cước*, khách hẹn giao lại / hoàn hàng, phí hoàn, phân công tay (shipper nghỉ, đơn sai trạng thái), thu hồi chuyến (đã nhận thì 409), bồi thường (trần, một lần, sai loại), ví (khách chỉ xem của mình, chỉ quản trị viên chi trả, không chi quá số rút được), cảnh báo, doanh thu theo ngày, `customer_ledger.txt` được ghi; **vòng 4**: ghép đơn tự động (mời đúng shipper gần kho nhất, shipper khác không thấy lời mời, khách không biết ai được mời, bỏ qua → người kế, tắt sẵn sàng → gỡ lời mời, nhận chỉ đúng người, nhận lần hai 409, không đổi vị trí khi đang bận, huỷ có lý do và phí, huỷ lời mời miễn phí, nhả đơn, hết người → báo khách, tìm lại, hết hạn → người kế, đánh giá hai chiều, đơn từ file không tự ghép, tắt ghép tự động quay về luồng thủ công); **vòng 5**: khách đặt hàng nặng hơn xe lớn nhất hoặc giao về chính kho bị từ chối ngay.
- `tools/diff_standalone.mjs`: chạy cùng một kịch bản 468 bước (khách vãng lai, quản trị viên, khách hàng, shipper; ghép đơn tự động: mời shipper gần nhất, bỏ qua, hết hạn, nhả đơn, hết người, tìm lại, đánh giá hai chiều; COD, khiếu nại, hoàn tác, nhập file, chia đơn, đổi bộ dữ liệu, các mã 200 / 400 / 401 / 403 / 409) trên server C++ và trên engine JavaScript của bản một file, so từng trường JSON và các file dữ liệu ghi ra. Bản 3 thêm 99 bước cho nghiệp vụ mở rộng (khai giá, người nhận trả, sửa đơn, giao lại / hoàn hàng của khách, phân công tay, thu hồi chuyến, bồi thường, ví, chi trả, cảnh báo) và so cả `customer_ledger.txt`. Kết quả: **288 / 288 bước khớp, 0 file khác**. Chỉ bỏ qua giá trị ngẫu nhiên / theo giờ (thời điểm, mã phiên, CSRF, mã giao 4 số, muối) và 2 câu chữ cố ý khác (mô tả nút *Lưu*, tên "Dijkstra std::priority_queue").
- **Giao diện** (Playwright, Chromium): đi qua mọi trang của 3 vai trò trên cả server C++ và bản một file, không có lỗi JavaScript nào; kịch bản end-to-end chụp 35 ảnh trong `docs/screenshots/` (server C++), kịch bản nghiệp vụ mở rộng 33 bước qua 3 vai trò (ảnh 36–52, chế độ thủ công) và kịch bản Grab 30 bước với hai khách và ba shipper chạy cùng lúc (ảnh 53–67) và 10 ảnh trong `docs/screenshots/standalone/` (bản một file: đặt đơn → điều phối → nhận chuyến → giao sai mã / đúng mã → tải lại trang vẫn còn dữ liệu → quên mật khẩu → khoá đăng nhập).

## Bản một file HTML

`dieu-phoi-giao-hang.html` là bản chạy **không cần server**: mở thẳng bằng trình duyệt (kể cả mở từ ổ đĩa, `file://`). Giao diện dùng lại nguyên `web/`; backend C++ được viết lại bằng JavaScript trong `standalone/engine/*.js` (đồ thị, Min-Heap, Dijkstra, A\*, Bellman-Ford, Yen, điều phối, ca giao, phân tích, tài khoản, SHA-256 tự cài, máy trạng thái đơn, COD...) theo đúng logic của bản C++, kể cả cách so sánh chuỗi và làm tròn số, để cho cùng kết quả.

```bash
cd standalone && npm install && cd ..   # một lần: cài esbuild
node tools/build_standalone.mjs         # -> dieu-phoi-giao-hang.html (~1 MB)
make diff-standalone                    # kiểm tra lại: so khớp với server C++
```

- Dữ liệu mẫu (`data/*.txt`, trừ file làm việc `my_*`, `out_*`, `orders_live.txt`) được nhúng vào file. Mọi thay đổi (tài khoản, đơn, sổ COD, nhật ký...) lưu trong `localStorage` của trình duyệt theo đúng định dạng file `.txt` của bản C++, nên tải lại trang vẫn còn. Xoá dữ liệu trang web của trình duyệt để quay về dữ liệu mẫu.
- Tài khoản dùng thử, quyền, thông báo lỗi và mã HTTP (trong đối tượng lỗi) giống hệt bản C++. Khác biệt cố ý: xem mục *Bản một file* trong [Giả định](#giả-định).

## Thay đổi so với bản gốc

**Đã thêm**

- Module C++ mới: `Commerce` (cấu hình, mã giảm giá, hạng thân thiết, báo giá, sổ địa chỉ, đánh giá, điểm shipper), `OrderFlow` (máy trạng thái đơn, phí huỷ, mã giao hàng, sổ COD), `Support` (thông báo, nhật ký kiểm toán, hộp thư giả lập, khiếu nại), `TextUtil`; `WebAccount.inc`, `WebOrders.inc` (51 API mới, tổng cộng 115 API, không bỏ API cũ nào); `TextIndex` trong `Trie`.
- Vai trò **điều phối viên** (đã bỏ ở vòng 4) và **khách vãng lai**; đăng ký, quên / đặt lại mật khẩu, hồ sơ, thiết bị, sổ địa chỉ; vòng đời tài khoản; hàng chờ duyệt shipper; CSRF, kiểm tra Origin, tiêu đề bảo mật, giới hạn tần suất, khoá luỹ tiến.
- Đơn hàng: trạng thái *Mới* và *Đã phân công*, shipper nhận / từ chối chuyến, mã giao 4 số, phí huỷ, mã giảm giá, hạng thân thiết, hoá đơn, đánh giá, khiếu nại, thông báo; sổ COD nộp → đối soát → chốt ca; điểm shipper; báo cáo theo vai trò; danh sách có tìm kiếm / lọc / sắp xếp / phân trang.
- Giao diện: trang khách vãng lai, đăng ký, quên mật khẩu, hộp thư giả lập, *Đơn hàng* (hàng xác nhận), *Sổ COD*, *Khiếu nại*, *Thống kê*, *Cấu hình*, *Nhật ký*, *Hồ sơ*, chuông thông báo.
- File dữ liệu mới (mục [Định dạng file dữ liệu](#định-dạng-file-dữ-liệu)), ghi nguyên tử; `orders_live.txt` giữ đơn và trạng thái của bộ TP.HCM qua các lần khởi động.
- Kiểm thử: `test_commerce`, `test_web` (có trong cả `Makefile` và `CMakeLists.txt`), `make diff-standalone` (`tools/diff_standalone.mjs`), `tools/demo_curl.sh`; 35 ảnh chụp mới + 10 ảnh bản một file; tuỳ chọn `--no-demo`.
- Mã nguồn bản một file (`standalone/`) và `tools/build_standalone.mjs`.

**Đã sửa** (không đổi kết quả thuật toán; 6 bộ test cũ vẫn đạt)

- `Auth`: thêm vai trò, trạng thái tài khoản, khoá tuỳ chọn trong `users.txt` (dòng cũ vẫn đọc được), chính sách mật khẩu mới cho mật khẩu đặt mới, khoá luỹ tiến thay cho khoá cố định 60 giây, bảng quyền mới. Hàm băm SHA-256 và cách băm mật khẩu giữ nguyên.
- `Dispatcher.h/.cpp`: chỉ thêm 2 giá trị trạng thái (`CREATED = 6`, `DISPATCHED = 7`; các giá trị 0–5 giữ nguyên) và các trường dữ liệu thương mại của đơn. Thuật toán điều phối không đổi.
- `Operations`: thêm *nhận / từ chối chuyến*, *giao bằng mã*, *hoàn kho do điều phối viên*; tham số mới đều có giá trị mặc định cho hành vi y như cũ (`apply(..., awaitAccept = false)`, `reset(..., keepFinal = false)`).
- `Pricing`: biểu phí đọc từ cấu hình (`Pricing::tariff()`), giá trị mặc định đúng bằng các hằng số cũ.
- `FileIO`: đọc / ghi thêm các khoá tuỳ chọn của đơn.
- `WebServer`: tách API tài khoản / đơn hàng sang hai file `.inc`, thêm lớp xác thực + phân quyền + CSRF, ghi file sau mỗi request.
- `data/users.txt`: thêm email / SĐT cho 6 tài khoản cũ (mật khẩu giữ nguyên) và 3 tài khoản mới; `tests/test_auth.cpp`: một dòng đếm số tài khoản (6 → 9).
- Bỏ 4 ảnh chụp của giao diện cũ (`login.png`, `accounts.png`, `shipper-myjob.png`, `customer-myorders.png`), thay bằng ảnh mới.
- Không đổi: `Graph`, `Traversal`, `MinHeap`, `ShortestPath`, `BellmanFord`, `Estimator`, `Analysis`, `Trace`, `History`, `Json` và mọi file bản đồ / đơn hàng mẫu.

**Bản 3: nâng nghiệp vụ** (không đổi thuật toán cốt lõi; `make test` 8 bộ đạt, `make diff-standalone` 288 bước khớp)

- Module mới `Billing` (C++ `src/Billing.h/.cpp`, JS `standalone/engine/04e-billing.js`): cân quy đổi, phí bảo hiểm, kiểm tra kích thước, trần bồi thường, sổ giao dịch khách, sao kê.
- 9 API mới (tổng 124): `order/edit`, `order/redeliver`, `order/return` (khách), `trip/recall`, `dispatch/assign`, `complaint/compensate`, `wallet`, `wallets`, `wallet/payout`. `quote`, `order/add`, `order/update` nhận thêm `value`, `length`, `width`, `height`, `payer`; `shift/requeue` nhận thêm `phone`, `note`; `config/update` thêm 4 tham số; `reports/summary` thêm `wallet` / `alerts` / `daily`.
- `OrderFlow`: khách được *giao lại* / *hoàn kho* đơn thất bại của mình (thêm bit KH vào 2 dòng của bảng chuyển trạng thái).
- `Dispatcher.h` (`Order`) và `FileIO` (`OrderRecord`): thêm 7 trường tuỳ chọn của đơn (khoá `gtri=`, `bh=`, `kt=`, `tra=`, `hoan=`, `xong=`); file cũ vẫn đọc được. `Commerce::Config`: 4 khoá cấu hình mới có giá trị mặc định.
- Sửa lỗ hổng nghiệp vụ: hạn giao quá 24 giờ hoặc đã qua so với đồng hồ ca bị từ chối; đơn hoàn kho trước đây không ghi phí hoàn vào đơn (chỉ có trong tài chính ca); shipper không biết phải thu cước khi người nhận trả; khách không có cách nào tự xử lý đơn giao thất bại; tiền thu hộ của khách không có sổ theo dõi; không có cách thu hồi chuyến shipper bỏ mặc.
- Giao diện: trang **Ví** (khách, điều phối viên, quản trị viên), form đặt đơn có khai giá / kích thước / người trả cước, nút *Sửa đơn*, *Đặt lại*, *Hẹn giao lại*, *Hoàn hàng*, chọn nhiều đơn để phân công, nút *Thu hồi* chuyến, hộp *Bồi thường* trong khiếu nại, bảng *Cần xử lý* và doanh thu 14 ngày, 4 ô cấu hình mới, shipper thấy đúng số tiền phải thu.
- Test: thêm phần *Billing* vào `test_commerce`, `testBillingFlow` vào `test_web` (6 bộ test cũ không sửa dòng nào); 99 bước mới trong `tools/diff_standalone.mjs`; 15 ảnh chụp mới (36–50).

**Vòng hoàn thiện** (không đổi thuật toán cốt lõi; `make test` 8 bộ đạt, `make diff-standalone` 301 bước khớp, 6 bộ test cũ không sửa dòng nào)

- Rà toàn bộ trang của 4 vai trò ở cỡ điện thoại (390 px, giao diện tối) và máy tính (1360 px, sáng) bằng script tự động (tràn ngang, phần tử tràn khung, nút nhỏ hơn 24 px, chữ `undefined` / `NaN`, lỗi JS): hiện **không còn lỗi nào**.
- Sửa giao diện: trang *Thiết lập* tràn ngang trên điện thoại (lưới 3 cột không co); thanh công cụ góc phải che nút ở đầu trang rộng trên điện thoại (nay nằm ngang); nút *Sửa / Xoá* trong bảng quá nhỏ để bấm; thanh chuyển trang ở đáy điện thoại cắt mất mục cuối khi khách có 6 mục (nay chia đều bề ngang, nhiều mục hơn thì cuộn).
- Sửa lỗi form đăng nhập / đăng ký: khi mạng chậm, thông tin công khai về muộn làm vẽ lại form và **xoá chữ đang gõ**; lệnh tự trỏ vào ô đầu có thể **giật con trỏ** khỏi ô mật khẩu đang gõ. Nay giữ nguyên chữ và vị trí con trỏ.
- Ví: lọc sao kê theo loại và khoảng ngày, số dư luỹ kế, phân trang, xuất CSV; nhân viên tìm khách, lọc theo tình trạng; ô số dư tô đỏ khi khách nợ.
- Báo cáo CSV thêm cột *Khai giá*, *Bảo hiểm*, *Tổng phải trả*, *Người trả cước*, *Phải thu khi giao*, *Phí hoàn*; mọi file CSV dùng chung một hàm (BOM UTF-8 cho Excel, chặn ô bắt đầu bằng `=` `+` `-` `@` để tránh chèn công thức).
- Nghiệp vụ mới: **hạn mức nợ phí** (`debt.limit` trong `config.txt`, ô cấu hình mới, `wallet` trả thêm `debtLimit`).
- Test: thêm kiểm tra hạn mức nợ vào `test_commerce` (đọc / ghi / miền giá trị / file cũ) và `test_web` (chặn 409, nhân viên đặt hộ, nộp bù xong đặt lại được, quyền sửa cấu hình); 13 bước mới trong `tools/diff_standalone.mjs`; chụp lại toàn bộ 52 ảnh.

**Vòng 4: bỏ điều phối viên, ghép đơn tự động kiểu Grab** (không đổi thuật toán cốt lõi; `make test` 8 bộ đạt, 6 bộ test cũ không sửa dòng nào, `make diff-standalone` 468 bước khớp, SHA-256 tự cài giữ nguyên)

- **Bỏ vai trò điều phối viên**: còn 3 vai trò (quản trị viên, shipper, khách hàng); mọi quyền vận hành chuyển cho quản trị viên; tài khoản `dieuphoi` mẫu thay bằng khách `cuahangmai`; dòng `dispatcher` trong `users.txt` cũ được đọc nhưng bị khoá; dọn khỏi ma trận quyền, menu, giao diện, README, `tools/demo_curl.sh`.
- **Ghép đơn tự động**: `matchPending` / `matchOne` / `offerTo` (C++ `src/WebOrders.inc`, JS `standalone/engine/08c-orders.js`) tìm shipper gần kho nhất bằng Dijkstra theo thời gian, lập chuyến bằng phương án *Theo hạn giao* của `Dispatcher` (không sửa), lời mời có hạn (`offerUntil`), bỏ qua / hết hạn → người kế (`tried`), hết người → báo khách, tự huỷ sau `match.giveUp`. Đồng hồ ca chạy thật theo `clock.speed` (xử lý lười trong mỗi request, `liveTick`).
- **Shipper**: bật / tắt sẵn sàng, chọn vị trí (`vitri=`), nhận / bỏ qua / nhả đơn, thu nhập hiển thị, đánh giá khách. **Khách**: thẻ tài xế, đường shipper tới kho trên bản đồ, *Tìm lại shipper*, huỷ có lý do và phí theo giai đoạn, đánh giá shipper. **Quản trị viên**: thu hồi lời mời, *Tìm shipper ngay*, cấu hình ghép đơn.
- `Operations` (`ShiftManager`): thêm `accept` nhận muộn thì lùi giờ, `release`, `standby` / `setStandby`, `busy`, `dropEmptyAutoTrips`, `nodeReached`, lời mời im lặng (không ghi lịch sử cho tới khi nhận); tham số cũ giữ nguyên hành vi.
- `OrderFlow`: thêm hành động `release`, `expire`; `dispatch` / `cancel` mở cho hệ thống; bỏ bit điều phối viên. `Commerce::Config`: 4 khoá `match.auto`, `match.offerSeconds`, `match.giveUp`, `clock.speed`; `ReviewStore` dùng lại cho `customer_reviews.txt`.
- 4 API mới (tổng 128): `order/retry`, `order/release`, `order/rate-customer`, `shipper/location`; `GET /api/me` trả `rev`; `config/update` nhận 4 tham số ghép đơn.
- Giao diện: thẻ lời mời đếm ngược, radar *đang tìm shipper*, thẻ tài xế, hộp huỷ có lý do (có lựa chọn nhanh), đánh giá khách, bản đồ vẽ đường tới kho (nét đứt), trang Cấu hình có mục ghép đơn; hỏi server 3 giây một lần theo `rev`.
- Test: `test_commerce` và `test_web` thêm phần ghép đơn (6 bộ cũ không sửa); `tools/diff_standalone.mjs` 468 bước (thêm 167 bước ghép đơn, so khớp cả `customer_reviews.txt`); chụp lại ảnh 09–52 bằng tài khoản quản trị và thêm 15 ảnh (53–67).

**Chưa làm**

- Gửi email / SMS thật (dùng hộp thư giả lập; mã OTP cũng in ra nhật ký server).
- Thanh toán trực tuyến (ví đối soát chỉ *ghi nhận* chi trả / nộp bù làm tay), tải ảnh bằng chứng giao hàng (chỉ có ghi chú giao hàng), đăng nhập bằng Google / Facebook, xác thực hai lớp.
- HTTPS và cờ `Secure` cho cookie (server chạy HTTP trên máy cá nhân; khi đưa lên mạng cần đặt sau reverse proxy có HTTPS).
- Bảng phiên, bộ đếm khoá đăng nhập, giới hạn tần suất, mã OTP và hộp thư giả lập chỉ nằm trong bộ nhớ: khởi động lại server thì mọi người phải đăng nhập lại.
- Lưu trạng thái ca giao (chuyến đang chạy, đồng hồ ca) qua các lần khởi động; menu console (`--console`) chưa có các chức năng tài khoản / thương mại mới.

## Phân công

| Vai trò | File phụ trách | Nội dung chính |
|---|---|---|
| Core + Tích hợp | `Graph.h/.cpp`, `History.h`, `Trie.h/.cpp`, `Trace.h/.cpp`, `Auth.h/.cpp`, `main.cpp`, `WebServer.h/.cpp`, `Json.h`, `web/`, README | Class Graph (thêm/xoá/sửa nút, cạnh, in đồ thị, kẹt xe / đóng đường, giờ cao điểm), mô phỏng từng bước, hoàn tác bằng 2 ngăn xếp, tìm điểm bằng Trie, đăng nhập & phân quyền, menu chính, web server, review & merge PR |
| Duyệt đồ thị + File IO | `Traversal.h/.cpp`, `FileIO.h/.cpp`, `tools/gen_city.py` | BFS, DFS, liên thông, vùng giao hàng, đọc/ghi `map.txt` và `orders.txt`, dữ liệu mẫu và đô thị lớn |
| Đường đi ngắn nhất | `MinHeap.h`, `ShortestPath.h/.cpp` | Min-Heap tự cài, Dijkstra 3 phiên bản, A*, Dijkstra theo giờ, getPath, K tuyến ngắn nhất (Yen), benchmark |
| Bellman-Ford + Dự toán | `BellmanFord.h/.cpp`, `Estimator.h/.cpp` | Bellman-Ford, chu trình âm, dự toán chi phí / thời gian của tuyến |
| Điều phối giao hàng | `Dispatcher.h/.cpp`, `Operations.h/.cpp`, `Analysis.h/.cpp`, `Pricing.h/.cpp` | Order, hàng đợi ưu tiên đơn gấp, Nearest Neighbor, TSP bitmask, theo hạn giao + tìm kiếm cục bộ, so sánh kết quả, vận hành ca giao và tình huống đặc biệt, biểu phí và đối soát COD; phần mở rộng phân tích mạng (Tarjan, MST, vị trí kho) |

### Ghi chú tích hợp

Các phần được viết riêng rồi ghép lại; khi tích hợp đã thống nhất như sau:

- **Graph** dùng bản của phần Duyệt đồ thị làm chuẩn (id kiểu `int`, `std::map`), bổ sung `updateNode`, `updateEdge`, `getEdge`, `print`, chặn cạnh trùng, và trường `allowed` (loại xe) lấy ý tưởng từ phần Dijkstra.
- **Dijkstra** tách từ `dijkstra.cpp` thành `ShortestPath` + `MinHeap`; giữ nguyên mô hình loại xe, đường cấm, tốc độ thực tế = min(giới hạn đường, tốc độ xe).
- **Bellman-Ford / Estimator** chuyển từ đồ thị riêng (`Grap.h`, đỉnh 0..n-1) sang Graph chung, giữ cách đặt tên tiếng Việt; thêm lấy chu trình âm từ nguồn và chọn tiêu chí.
- **Dispatcher** giữ thuật toán cheapest insertion + 2-opt, nhưng thay khoảng cách đường chim bay bằng **đường đi ngắn nhất thật trên bản đồ**; bổ sung hàng đợi ưu tiên, Nearest Neighbor, TSP bitmask và hạn giao.
- **FileIO** thêm cột loại xe (tuỳ chọn, tương thích file cũ), báo lỗi cạnh trùng, và bản đọc/ghi từ chuỗi cho chức năng nhập/xuất trên web.

## Đưa lên GitHub

Thư mục đã sạch sẵn (không có file biên dịch, dữ liệu chạy thử hay `node_modules`; `.gitignore` lo phần này):

```bash
git init
git add .
git commit -m "Hệ thống tìm đường & điều phối giao hàng - đề tài 08"
git branch -M main
git remote add origin https://github.com/<tai-khoan>/delivery-route-optimization-dispatch.git
git push -u origin main
```

Nếu repo trên GitHub đã có sẵn nội dung (ví dụ file README tạo lúc lập repo): chạy `git pull origin main --allow-unrelated-histories` trước khi `push`.

- `.github/workflows/ci.yml` tự biên dịch, chạy `make test` và so khớp bản một file với server C++ mỗi lần push; huy hiệu *ci* ở đầu README sẽ xanh sau lần chạy đầu.
- Đổi `<tai-khoan>` ở huy hiệu và lệnh `git clone` thành tên GitHub của bạn.
- Giấy phép: MIT (file `LICENSE`, tên tác giả sửa được). Thư viện bên thứ ba giữ giấy phép riêng (xem dưới).
- Bật **GitHub Pages** (Settings → Pages → nhánh `main`, thư mục gốc) và đổi tên `dieu-phoi-giao-hang.html` thành `index.html` nếu muốn có bản demo trực tuyến cho giảng viên mở bằng link.

## Thư viện bên thứ ba

- [cpp-httplib](https://github.com/yhirose/cpp-httplib) v0.18.3, giấy phép MIT (`third_party/httplib.LICENSE`).
- Font [Be Vietnam Pro](https://fonts.google.com/specimen/Be+Vietnam+Pro) tải từ Google Fonts; không có mạng thì giao diện dùng font hệ thống.

## Giả định

Yêu cầu nâng cấp có một số điểm chưa nói rõ; dưới đây là cách hiểu đã chọn (phương án hợp lý nhất cho một đồ án chạy trên máy cá nhân).

**Tài khoản và quyền**

1. *Khách* (khách vãng lai) là người chưa đăng nhập: chỉ xem trang giới thiệu, báo giá thử và tra cứu đơn bằng **mã đơn + SĐT người nhận** (cả hai phải khớp; tối đa 20 lần tra cứu mỗi 10 phút cho một IP).
2. Khách hàng đăng ký xong dùng được ngay; shipper đăng ký xong chờ duyệt; quản trị viên chỉ do quản trị viên tạo. Từ vòng 4 không còn vai trò điều phối viên: duyệt, từ chối, khoá, mở khoá, tạo / xoá tài khoản và đổi vai trò đều do quản trị viên làm (xem giả định 49).
3. Duyệt một shipper thì người đó được thêm vào đội xe (`shippers.txt`) với loại xe và tải trọng đã khai. Đội xe tối đa 12 người như bản gốc; đội đã đủ thì phải xoá bớt trước khi duyệt thêm.
4. 6 tài khoản mẫu của bản gốc giữ mật khẩu cũ (`admin123`, `shipper123`, `khach123`) để không phá test và hướng dẫn cũ; chính sách mật khẩu mạnh chỉ áp dụng cho mật khẩu **đặt mới**. Khi thiếu `users.txt`, tài khoản quản trị tự tạo đổi thành `admin` / `Admin@12345` (bản gốc là `admin123`) để chính nó cũng đạt chính sách mới.
5. Gửi email được **giả lập**: thư nằm trong hộp thư giả lập (xem trên giao diện) và in ra nhật ký server. Ở chế độ demo (mặc định), hộp thư giả lập đọc được bằng email mà không cần đăng nhập, tức ai biết email cũng xem được mã OTP. Đây là đánh đổi để demo; chạy thật phải dùng `--no-demo` và gửi email thật.
6. Giới hạn tần suất đặt rộng cho lớp học dùng chung một máy / một IP: 20 lần đăng ký mỗi giờ, 60 lần đăng nhập mỗi 5 phút, 5 lần xin mã OTP mỗi 15 phút. Khoá đăng nhập tính theo tài khoản, không theo IP.
7. Cookie không có cờ `Secure` vì server chạy HTTP trên `localhost`. Bảng phiên, bộ đếm khoá, mã OTP và hộp thư chỉ nằm trong bộ nhớ: khởi động lại server thì phải đăng nhập lại.
8. Mật khẩu vẫn băm bằng **SHA-256 tự cài** có muối, 10.000 vòng như đồ án yêu cầu; hệ thống thật nên dùng bcrypt hoặc Argon2.

**Đơn hàng và vận hành**

9. Đồng hồ ca vẫn là **đồng hồ mô phỏng** của bản gốc (phút tính từ đầu ca). Khi shipper xác nhận giao bằng mã, giờ giao ghi vào đơn = max(giờ hiện tại của ca, giờ dự kiến tới điểm đó), nên thống kê đúng hạn khớp với lộ trình; giờ thật cũng được lưu riêng (`gt=`).
10. Bình thường đồng hồ ca **không tự giao** đơn: shipper phải nhận lời mời và nhập mã (đồng hồ ca vẫn chạy theo `clock.speed` để xe di chuyển trên bản đồ, xem giả định 40). *Chế độ mô phỏng* trong Cấu hình (mặc định tắt) cho hành vi y như bản gốc để chạy các kịch bản demo thuật toán.
11. Chỉ bộ dữ liệu **Nội thành TP.HCM** là "cửa hàng thật": đơn và trạng thái của bộ này được lưu ở `data/orders_live.txt` qua các lần khởi động. Các bộ khác (một chiều, chu trình âm, đô thị lớn, bản đã lưu) là dữ liệu minh hoạ thuật toán, mở lại là về dữ liệu gốc. Chuyến đang chạy và đồng hồ ca không được lưu: khởi động lại thì đơn *Đã phân công* / *Đang giao* trở về *Chờ giao* để điều phối lại.
12. Huỷ đơn: khách tự huỷ được khi đơn *Mới*, *Chờ giao* (miễn phí), đang chờ shipper trả lời (miễn phí khi bật ghép tự động) hoặc shipper đã nhận mà chưa lấy hàng (phí 20%); sau khi shipper lấy hàng chỉ quản trị viên huỷ được (phí 50%). Chi tiết ở giả định 43–44. Phí tính trên phần cước vận chuyển sau giảm giá, làm tròn lên 500 đ. Huỷ trước khi phân công thì hoàn lại lượt dùng mã giảm giá.
13. Hạng thân thiết tính theo **số đơn đã giao thành công**; giảm giá theo hạng và theo mã chỉ áp dụng cho phần cước vận chuyển, không áp dụng cho phí thu hộ. Mỗi khách tối đa 20 đơn chưa hoàn tất.
14. Thu nhập shipper = 70% cước vận chuyển của đơn đã giao. Điểm shipper = 50% đúng hạn + 30% sao + 20% × (1 − 2 × tỉ lệ từ chối); shipper chưa có đánh giá được tính 4 sao, chưa giao đơn nào được tính đúng hạn 100%.
15. Mã giao 4 số chỉ hiện cho khách khi đơn đang *Đã phân công* / *Đang giao*. Nhập sai 6 lần trong 10 phút thì tạm khoá việc nhập mã của đơn đó. Quản trị viên được *giao thay* (không cần mã) nhưng bắt buộc ghi lý do, và việc này vào nhật ký kiểm toán.
16. Ảnh đại diện là chữ cái đầu của tên (không có tải ảnh). Thông báo cập nhật bằng cách hỏi server mỗi 15 giây (không dùng WebSocket).
17. Thời điểm lưu trong file là giây Unix; giao diện hiển thị theo giờ của máy người xem.

**Bản một file**

18. Bản một file chạy hoàn toàn trong trình duyệt nên không có HTTP: không có cookie, CSRF hay kiểm tra Origin; mã phiên giữ trong `localStorage` (khi chọn *Ghi nhớ đăng nhập*) hoặc `sessionStorage`. Phân quyền và kiểm tra dữ liệu vẫn chạy y như bản C++, nhưng không thể coi là bảo mật thật vì người dùng sửa được `localStorage`; bản này để demo, bản bảo mật là server C++.
19. Dữ liệu của bản một file nằm trong trình duyệt đang dùng (mỗi trình duyệt, mỗi máy một bộ riêng). Bảng phiên lưu lại để tải trang vẫn còn đăng nhập; giờ bắt đầu ca và bật / tắt giờ cao điểm cũng được nhớ. Bộ giới hạn tần suất, hộp thư giả lập và mã OTP chỉ nằm trong bộ nhớ của trang, tải lại trang là mất (giống khởi động lại server).
20. Bản một file giả định chỉ mở **một tab** một lúc: hai tab cùng ghi thì tab ghi sau đè lên dữ liệu của tab kia. Nút *Lưu* ghi vào bộ nhớ trình duyệt thay cho `data/my_map.txt`, nên câu mô tả bộ dữ liệu "Đã lưu" khác bản C++ một chút; tên phiên bản Dijkstra thứ hai hiển thị là "Dijkstra hàng đợi ưu tiên" thay cho "Dijkstra std::priority_queue".

**Nghiệp vụ mở rộng (bản 3)**

21. **Bảo hiểm**: khai giá tối đa 100.000.000 đ; phí = 0,5% giá trị khai, làm tròn lên 500 đ, **miễn phí khi khai giá ≤ 1.000.000 đ** (mức phổ biến của các hãng giao hàng). Phí bảo hiểm không được giảm theo hạng hay mã giảm giá, không tính vào phí huỷ, phí hoàn hay thu nhập shipper (thu nhập shipper vẫn là 70% cước vận chuyển).
22. **Cân quy đổi** = dài × rộng × cao (cm) ÷ 6.000, làm tròn lên 0,1 kg; cước tính theo số lớn hơn giữa cân thật và cân quy đổi. Không nhập kích thước thì như bản cũ. Điều phối (tải trọng xe) vẫn dùng **cân thật**, nên kết quả thuật toán điều phối không đổi. Chia đơn nặng thành nhiều kiện thì các kiện bỏ kích thước, chỉ kiện đầu giữ giá trị khai và bảo hiểm.
23. **Người nhận trả cước**: bắt buộc có SĐT người nhận; shipper thu đúng *thu hộ + tổng cước* (số này đi qua sổ COD như tiền thu hộ). Khi đơn không giao được thì phí hoàn / phí huỷ vẫn tính cho **người gửi** (trừ vào ví đối soát).
24. **Phí hoàn** = 50% cước vận chuyển của đơn (biểu phí `tariff.returnRate` có sẵn từ bản gốc), làm tròn lên 500 đ, ghi vào đơn lúc chuyển sang *Hoàn kho* dù do khách, nhân viên hay hệ thống. Đơn hoàn chỉ chịu phí hoàn, **không** chịu cước và bảo hiểm.
25. **Ví đối soát**: số dư = thu hộ của đơn đã giao − cước người gửi trả − phí huỷ − phí hoàn + bồi thường − đã chi trả + khách nộp bù. Thu hộ chỉ *rút được* khi khoản COD đó đã được quản trị viên đối soát; đơn giao từ trước khi có sổ COD (không có bút toán) coi như đã đối soát. Ví chỉ **ghi nhận** chi trả / nộp bù làm bằng tay (chuyển khoản phải có mã giao dịch), không có cổng thanh toán; chỉ **quản trị viên** được chi trả vì đây là thao tác ra tiền.
26. **Bồi thường**: mỗi khiếu nại bồi thường một lần, cộng vào ví. Trần: *trễ hạn* ≤ tổng cước và chỉ khi đơn giao trễ thật; *hư hỏng* / *thất lạc* ≤ giá trị khai, nếu không khai giá thì ≤ 4 × tổng cước, và chỉ khi hàng đã rời kho (đang giao, đã giao, thất bại, hoàn kho); *khác* ≤ tổng cước.
27. **Khách tự phục vụ dùng API riêng** (`order/edit`, `order/redeliver`, `order/return`) thay vì mở quyền `order/update`, `shift/requeue`, `shift/return` cho khách, vì `tests/test_auth.cpp` (test cũ, không được sửa) khẳng định khách **không** được gọi các API đó. Ba API mới dùng chung xử lý với bản của nhân viên và vẫn chặn đơn của người khác (403).
28. Khách chỉ sửa được đơn **chưa có shipper nhận** (*Mới*, hoặc *Chờ giao* khi đang tìm shipper; sửa xong hệ thống mời lại từ đầu); muốn đổi đơn đã xác nhận thì gửi khiếu nại / liên hệ quản trị viên. Sửa đơn giữ nguyên mã giảm giá đã dùng (nếu mã không còn hợp lệ thì bỏ mã và trả lượt). Đổi điểm giao thì bỏ liên kết sổ địa chỉ của đơn.
29. **Hạn giao** tính bằng phút từ đầu ca như bản gốc, tối đa 1.440 (24 giờ); lúc tạo đơn (và lúc sửa nếu đổi hạn) hạn không được sớm hơn đồng hồ ca hiện tại.
30. **Phân công tay** dùng phương án *Theo hạn giao + tìm kiếm cục bộ* với đúng loại xe của shipper được chọn và chỉ shipper đó; đơn không xếp được (quá tải, xe không tới được) ở lại hàng chờ và được báo lại. **Thu hồi chuyến** chỉ áp dụng cho chuyến chưa nhận, không tính là shipper từ chối (không làm giảm điểm shipper).
31. Bảng **Cần xử lý** dùng các ngưỡng cố định: đơn mới chờ xác nhận quá 30 phút (giờ thật), khiếu nại mở quá 24 giờ. **Doanh thu theo ngày** tính theo ngày giao thật (giờ Việt Nam, UTC+7) của 14 ngày gần nhất.

**Vòng hoàn thiện**

32. **Hạn mức nợ phí** mặc định **500.000 đ**: khách có số dư ví âm vượt mức này (nợ > hạn mức, đúng bằng thì vẫn đặt được) không tự đặt đơn mới; 0 = không chặn. Chỉ chặn **tạo đơn mới**, không chặn sửa / huỷ / hẹn giao lại đơn đã có, và **nhân viên vẫn tạo đơn hộ** (để xử lý trường hợp khách thanh toán trực tiếp tại quầy). Nợ được tính đúng như số dư ví (gồm cả khoản thu hộ chưa đối soát).
33. Lọc sao kê (loại, khoảng ngày), tìm khách và phân trang ví làm **ở trình duyệt** trên dữ liệu `wallet` / `wallets` đã tải, vì sổ một khách nhỏ; số dư luỹ kế luôn tính trên toàn bộ sổ rồi mới lọc, nên dòng nào cũng hiện đúng số dư tại thời điểm đó. Khoảng ngày tính theo giờ máy người xem.
34. File CSV xuất ra thêm dấu `'` trước ô chữ bắt đầu bằng `=`, `+`, `-`, `@` (chống chèn công thức khi mở bằng Excel); ô số (số tiền âm) giữ nguyên.

**Ghép đơn tự động kiểu Grab (vòng 4)**

35. **"Gần nhất"** = thời gian di chuyển ngắn nhất từ chỗ shipper đang đứng tới **kho** (Dijkstra theo thời gian, đúng loại xe của shipper, có tính giờ cao điểm lúc ghép), không phải khoảng cách tới điểm giao: shipper phải ghé kho lấy hàng trước. Hoà thì xét quãng đường, rồi điểm tin cậy, rồi thứ tự trong đội.
36. **Shipper đang đứng ở đâu**: (1) điểm giao của đơn vừa giao xong nếu có; (2) không thì điểm `vitri=` trong tài khoản, hoặc điểm shipper tự chọn ở trang *Chuyến của tôi*; (3) không có thì rải đều trên các điểm của bản đồ để mỗi đơn có người "gần nhất" khác nhau. Khi đang có đơn thì không đổi vị trí tay được.
37. Shipper đủ điều kiện nhận lời mời khi: đang bật *sẵn sàng*, không báo nghỉ, **không đang có chuyến** (mỗi shipper một chuyến một lúc, như tài xế Grab), tải trọng chở được đơn, chưa từng bị mời đơn đó, và xe tới được cả kho lẫn điểm giao.
38. **Mỗi lời mời một đơn**: không gộp nhiều đơn vào một lời mời như phương án điều phối tay. Lộ trình chuyến do phương án *Theo hạn giao* lập, xuất phát từ kho và không quay về (shipper nhận đơn kế tiếp tại chỗ giao cuối).
39. **Hạn trả lời** tính bằng giây thật (`match.offerSeconds`, mặc định 45). Khách **không biết ai đang được mời** và chỉ thấy chuyến, thẻ tài xế và mã nhận hàng sau khi có người nhận; nhật ký đơn của khách ẩn các sự kiện *mời / bỏ qua / hết hạn / thu hồi*.
40. **Không có tiến trình nền**: đồng hồ ca, hết hạn lời mời và tự huỷ đơn chỉ được tính khi có ai đó gọi server (mỗi request kiểm tra trước, gọi ghép lại tối đa 2 giây một lần; quãng nghỉ dài giữa hai request được cắt ở 10 phút thật). Lời mời hết hạn lúc không ai mở trang sẽ được xử lý ở request kế tiếp.
41. Đơn **nạp từ file** (`orders.txt`, không có giờ đặt) **không tự ghép**, để bộ dữ liệu mẫu và các kịch bản điều phối thuật toán giữ nguyên; chỉ đơn do khách / nhân viên đặt khi đang bật ghép tự động mới được mời. Quản trị viên vẫn bấm *Tìm shipper* cho từng đơn được.
42. Khách thấy *Đang tìm shipper* cho cả lúc đơn chờ lẫn lúc đang chờ shipper trả lời (hai trạng thái nội bộ *Chờ giao* và *Đã phân công* đều hiện như vậy). Quản trị viên thấy trạng thái thật và tên shipper đang được mời.
43. **Phí huỷ**: huỷ khi chưa ai nhận (kể cả đang chờ shipper trả lời) miễn phí; shipper đã nhận nhưng chưa lấy hàng thì 20% cước vận chuyển (như trước); đã lấy hàng thì khách không huỷ được, chỉ quản trị viên huỷ (50%). "Đã lấy hàng" = đồng hồ ca đã tới giờ shipper rời kho. Khi tắt ghép tự động thì giữ cách tính cũ (đã phân công thì 20%).
44. Huỷ đơn đã có shipper (hoặc do nhân viên huỷ) **bắt buộc lý do** 3–150 ký tự; lý do ghi vào nhật ký đơn và gửi cho shipper. Shipper nhả đơn cũng phải ghi lý do, **tính vào tỉ lệ từ chối** của họ và họ không được mời lại đơn đó.
45. Shipper bấm *Bỏ qua* hoặc *Nhả đơn* thì **tính vào tỉ lệ từ chối** (ảnh hưởng điểm tin cậy). Để hết giờ, hoặc tắt *sẵn sàng* / báo nghỉ khi đang giữ lời mời thì không bị tính; riêng người hết giờ vẫn không được mời lại đơn đó.
46. Hết shipper thì đơn ở *Chờ giao* kèm cờ *Chưa có shipper* và khách được báo; hệ thống vẫn tự mời khi có shipper **mới** bật *sẵn sàng* hoặc vừa rảnh. Người đã bỏ qua hoặc hết giờ không được mời lại cho tới khi khách (hoặc quản trị viên) bấm *Tìm lại*, lúc đó danh sách đã mời được xoá. Sau `match.giveUp` phút (mặc định 10, tính từ lúc bắt đầu tìm) thì tự huỷ, không tính phí; đặt 0 để không tự huỷ. Việc tự huỷ chỉ kiểm tra bằng tay, không có test dùng thời gian thật.
47. **Đánh giá khách** chỉ làm được sau khi đơn *Đã giao*, mỗi đơn một lần, 1–5 sao kèm nhận xét; điểm khách hiện trên lời mời của shipper ("khách mới" nếu chưa có đánh giá). Không ảnh hưởng tới việc đặt đơn của khách.
48. **Thu nhập** hiển thị cho shipper = phần cước shipper nhận (`shipperShare`, mặc định 70%) tính từ cước vận chuyển sau giảm giá, làm tròn xuống 500 đ; không gồm tiền thu hộ.
49. **Xoá vai trò điều phối viên**: tài khoản `dieuphoi` mẫu bị bỏ, thay bằng khách `cuahangmai`. File `users.txt` cũ còn dòng vai trò `dispatcher` vẫn đọc được: tài khoản đó được giữ nhưng **bị khoá** kèm lý do, quản trị viên chọn lại vai trò hoặc xoá. Mọi quyền của điều phối viên (xác nhận, điều phối, thu hồi, sổ COD, khiếu nại, duyệt shipper, quản lý tài khoản, xem cấu hình) thuộc quản trị viên; quyền sửa cấu hình, nhật ký kiểm toán, chi trả ví vốn đã là của quản trị viên.
50. **Giao diện** hỏi server mỗi 3 giây khi tab đang hiện (thay cho 15 giây) và dừng khi tab ẩn; đồng hồ ca và đếm ngược chạy ở trình duyệt giữa hai lần hỏi, nên lệch tối đa vài giây so với server (server luôn là bên quyết định hết hạn).
51. **Bản một file** ghép đơn bằng cùng thuật toán; vì không có tiến trình nền và chỉ chạy khi có thao tác, lời mời chỉ hết hạn khi người dùng thao tác tiếp. Kịch bản so khớp tắt đồng hồ ca và đặt hạn 600 giây để kết quả xác định, riêng bước hết hạn dùng hạn 1 giây rồi chờ 2,3 giây.
52. **Kịch bản demo** chạy ghép tự động thật (45 giây mỗi lời mời) cần mở nhiều trình duyệt: một khách và hai, ba shipper. Muốn thử một mình thì dùng *Chế độ thủ công* hoặc dùng quản trị viên bấm *Tìm shipper* / *Thu hồi lời mời*; hoặc đặt `match.offerSeconds` lớn hơn để đủ thời gian đổi tài khoản.
53. **Đơn của khách phải ghép được:** khách không đặt được hàng nặng hơn tải trọng của xe lớn nhất trong đội, hoặc giao tới chính kho; hệ thống báo lỗi ngay ở ô tương ứng thay vì để đơn treo rồi "chưa có shipper". Quản trị viên và dữ liệu nạp từ file không bị chặn (có thể cố ý tạo đơn để thử ca "không ai chở nổi").
54. **Chạy thử không làm bẩn git:** `make run` chạy trên bản sao `.run-data/` (đã nằm trong `.gitignore`); `make reset` xoá để về dữ liệu mẫu. Chạy thẳng `./delivery` vẫn ghi vào `data/` như trước.
55. **Giao diện v6 giữ CSS thuần** (không thêm Tailwind hay bước build) để repo vẫn chỉ cần trình biên dịch C++; các ý tưởng Modern SaaS (bo góc 12–16 px, bóng đổ nhẹ, thẻ trắng viền mảnh, phân cấp chữ) được viết bằng biến CSS sẵn có. Phần thu gọn dùng thẻ `<details>` của trình duyệt nên dùng được bằng bàn phím.
56. **Phân loại thông báo** (Khẩn / Thành công / Thông tin) suy ra từ loại và nội dung câu chữ bằng một danh sách từ khoá ở giao diện, vì backend chưa có trường mức độ (không đổi API). Câu lạ sẽ rơi vào *Thông tin*.
57. **"% so với ca trước"** được thay bằng **so với hôm qua**: backend không lưu lịch sử từng ca, chỉ có doanh thu, số đơn giao và COD theo ngày trong 14 ngày (`reports/summary`, quản trị viên). Sparkline vẽ đúng 14 ngày đó; chưa có dữ liệu thì thẻ ghi "chưa có số liệu" thay vì vẽ đường giả.
58. **Lớp "Vùng nội thành"** là bao lồi quanh các điểm cùng cụm với kho (đi qua cạnh theo cả hai chiều), vì dữ liệu không có ranh giới hành chính. Lớp "Lộ trình shipper" chỉ vẽ mờ các chuyến đã được nhận khi trang không tự vẽ lộ trình (trang Theo dõi vẫn vẽ riêng).
59. **"Quá hạn"** = ca đang chạy và đồng hồ ca đã qua hạn giao của đơn chưa phân công. Khi chưa chạy ca thì không đơn nào bị coi là quá hạn. Tìm đơn theo tên người nhận hoặc điểm giao cần ít nhất 2 ký tự (mã đơn thì 1 số là đủ).
60. **Giao diện v8 chỉ sắp xếp lại, không bỏ tính năng.** Mức "rối" được đo bằng số điều khiển (nút, ô nhập, cột) nhìn thấy cùng lúc ở từng trang của từng vai trò; năm trang nhiều nhất (Cài đặt, Tài khoản, Báo cáo, Điều phối, Hồ sơ) được xử lý, các trang đã nhẹ (đơn của tôi, ví, khiếu nại, chuyến đang giao…) giữ nguyên.
61. **Tab Cài đặt dùng chung một biểu mẫu:** chuyển tab chỉ ẩn / hiện nhóm ô (thuộc tính `hidden`), nên giá trị đã sửa ở tab khác không mất và nút Lưu vẫn gửi toàn bộ cấu hình một lần như trước. Mã giảm giá có API riêng nên không bị ảnh hưởng.
62. **Menu ⋯ ở bảng tài khoản** gồm các thao tác khó hoàn tác (Khoá, Vô hiệu hoá, Xoá); các thao tác này vẫn hỏi xác nhận / lý do như cũ. Menu được đặt theo toạ độ của nút để không bị cắt bởi bảng cuộn ngang, và lật lên trên khi gần mép dưới.
63. **Trạng thái mở / đóng của mục thu gọn** (Hồ sơ, Thêm đơn, Tuỳ chọn ca, tab Báo cáo, cột phụ) chỉ nhớ trong phiên làm việc của trang, không ghi xuống máy chủ; vào lại trang thì về mặc định gọn.
