# Điều phối giao hàng (C++17)

Bài toán: một kho, nhiều shipper có tải trọng khác nhau, mỗi đơn hàng có toạ độ và khối lượng.
Chương trình phân đơn cho shipper và sắp thứ tự giao sao cho tổng quãng đường ngắn.
Đây là dạng đơn giản của bài toán **Capacitated VRP**.

## Thuật toán
1. **Cheapest insertion có ràng buộc tải trọng**: sắp đơn theo khối lượng giảm dần, mỗi đơn
   được chèn vào vị trí làm tăng quãng đường ít nhất, trong các shipper còn đủ tải.
2. **2-opt**: cải thiện lộ trình từng shipper bằng cách đảo ngược đoạn khi giảm được quãng đường.
3. Đơn nào không shipper nào nhận nổi sẽ được liệt kê riêng.

Đây là heuristic nên kết quả tốt nhưng không đảm bảo tối ưu tuyệt đối.

## Cấu trúc
| File | Vai trò |
|---|---|
| `types.h` | Các struct dữ liệu |
| `dispatcher.h/.cpp` | Thuật toán phân đơn và tối ưu lộ trình |
| `io.h/.cpp` | Đọc input, ghi output |
| `main.cpp` | Chương trình chính |

## Định dạng input
```
x_kho y_kho
K                     # số shipper
tên capacity          # K dòng
N                     # số đơn hàng
id x y demand         # N dòng
```

## Build và chạy
```bash
make
./dispatch input.txt output.txt
```
