#!/usr/bin/env bash
# Minh hoạ phân quyền & máy trạng thái bằng curl: 401 (chưa đăng nhập), 403 (sai vai trò / IDOR / thiếu CSRF),
# 409 (chuyển trạng thái đơn không hợp lệ), 429 (khoá tạm sau nhiều lần sai mật khẩu).
# Chạy server trên bản sao dữ liệu rồi:  tools/demo_curl.sh [http://127.0.0.1:8080]
set -u
BASE="${1:-http://127.0.0.1:8080}"
TMP="$(mktemp -d)"
trap 'rm -r -- "$TMP"' EXIT

show() {  # show "mô tả" status_file body_file
  printf '%-62s -> HTTP %s\n' "$1" "$(cat "$2")"
  printf '    %s\n' "$(head -c 220 "$3")"
}
req() {  # req "mô tả" cookie_jar csrf METHOD path [data...]
  local desc="$1" jar="$2" csrf="$3" method="$4" path="$5"; shift 5
  local args=(-s -o "$TMP/body" -w '%{http_code}' -X "$method")
  [ -n "$jar" ] && args+=(-b "$jar" -c "$jar")
  [ -n "$csrf" ] && args+=(-H "X-CSRF-Token: $csrf")
  for d in "$@"; do args+=(--data-urlencode "$d"); done
  curl "${args[@]}" "$BASE$path" > "$TMP/status"
  show "$desc" "$TMP/status" "$TMP/body"
}
login() {  # login user pass jar -> in ra csrf
  curl -s -c "$3" -X POST --data-urlencode "username=$1" --data-urlencode "password=$2" "$BASE/api/login" \
    | sed -n 's/.*"csrf":"\([0-9a-f]*\)".*/\1/p'
}

echo "== 401: chưa đăng nhập"
req "GET /api/orders/list (không cookie)" "" "" GET /api/orders/list
req "POST /api/order/add (không cookie)" "" "" POST /api/order/add destination=3

echo "== 403: đăng nhập rồi nhưng không có quyền"
C1="$TMP/anphat"; T1=$(login anphat khach123 "$C1")
C2="$TMP/khachvip"; T2=$(login khachvip 'HuongViet@2026' "$C2")
CS="$TMP/tuan"; TS=$(login tuan shipper123 "$CS")
CA="$TMP/admin"; TA=$(login admin admin123 "$CA")
req "Khách xem danh sách tài khoản GET /api/users" "$C1" "$T1" GET /api/users
req "Shipper đổi biểu phí POST /api/config/update" "$CS" "$TS" POST /api/config/update base=1
req "Shipper xem nhật ký kiểm toán GET /api/audit" "$CS" "$TS" GET /api/audit
req "Khách tự nhận lời mời của shipper POST /api/trip/accept" "$C1" "$T1" POST /api/trip/accept id=1
OTHER=$(curl -s -b "$C1" "$BASE/api/orders/list?size=1" | sed 's/.*"orders":\[//' | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
req "IDOR: khachvip mở đơn #$OTHER của anphat" "$C2" "$T2" GET "/api/order/get?id=$OTHER"
req "Thiếu X-CSRF-Token khi POST /api/profile/update" "$C1" "" POST /api/profile/update displayName=Hacker
curl -s -o "$TMP/body" -w '%{http_code}' -b "$C1" -H "X-CSRF-Token: $T1" -H "Origin: http://evil.example" \
  -X POST --data-urlencode "displayName=Hacker" "$BASE/api/profile/update" > "$TMP/status"
show "Origin lạ (CSRF từ trang khác)" "$TMP/status" "$TMP/body"
req "Tự đăng ký vai trò admin" "" "" POST /api/register role=admin username=hacker1 displayName=Hacker \
  email=h@example.com phone=0901111222 password=Hacker2026 confirm=Hacker2026 terms=1
req "Tự đăng ký vai trò điều phối viên (vai trò đã bỏ)" "" "" POST /api/register role=dispatcher username=hacker2 displayName=Hacker \
  email=h2@example.com phone=0901111223 password=Hacker2026 confirm=Hacker2026 terms=1

echo "== 409: ghép đơn kiểu Grab, máy trạng thái từ chối thao tác không hợp lệ"
for u in tuan binh cuong; do
  J="$TMP/s_$u"; TK=$(login "$u" shipper123 "$J"); curl -s -o /dev/null -b "$J" -H "X-CSRF-Token: $TK" -X POST --data-urlencode ready=1 "$BASE/api/shipper/ready"
done
NEW=$(curl -s -b "$C1" -H "X-CSRF-Token: $T1" -X POST --data-urlencode destination=3 --data-urlencode weight=1 \
  --data-urlencode recipient="Chị Hoa" --data-urlencode phone=0909000111 "$BASE/api/order/add" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)
echo "    (khách anphat vừa tạo đơn #$NEW: hệ thống tự mời shipper gần kho nhất, không cần ai xác nhận)"
NEAR=$(curl -s -b "$CA" "$BASE/api/order/get?id=$NEW" | sed -n 's/.*"offeredTo":"\([^"]*\)".*/\1/p' | head -1)
case "$NEAR" in *Tuấn*) NU=tuan; OU=binh;; *Bình*) NU=binh; OU=cuong;; *) NU=cuong; OU=tuan;; esac
echo "    (người được mời: $NEAR -> tài khoản $NU; $OU là người không được mời)"
CN="$TMP/s_$NU"; TN=$(login "$NU" shipper123 "$CN"); CO="$TMP/s_$OU"; TO=$(login "$OU" shipper123 "$CO")
TRIP=$(curl -s -b "$CA" "$BASE/api/order/get?id=$NEW" | sed -n 's/.*"trip":{"id":\([0-9]*\).*/\1/p' | head -1)
req "Giao đơn #$NEW khi chưa có ai nhận (Đã mời -> Đã giao)" "$CN" "$TN" POST /api/order/deliver "id=$NEW" code=0000
req "Shipper $OU không được mời mà nhận chuyến #$TRIP" "$CO" "$TO" POST /api/trip/accept "id=$TRIP"
req "Shipper $NU nhận lời mời (chuyến #$TRIP)" "$CN" "$TN" POST /api/trip/accept "id=$TRIP"
req "Nhận lại chuyến #$TRIP lần 2" "$CN" "$TN" POST /api/trip/accept "id=$TRIP"
req "Khách huỷ đơn #$NEW đã có shipper nhận mà không ghi lý do" "$C1" "$T1" POST /api/order/cancel "id=$NEW"
req "Khách huỷ đơn #$NEW kèm lý do (phí huỷ nếu shipper đã lấy hàng)" "$C1" "$T1" POST /api/order/cancel "id=$NEW" "reason=Đặt nhầm địa chỉ"
req "Huỷ lại đơn #$NEW đã huỷ" "$C1" "$T1" POST /api/order/cancel "id=$NEW" "reason=Thử lại"

echo "== 429: sai mật khẩu nhiều lần thì bị khoá tạm (thông báo chung, không lộ tài khoản có tồn tại)"
for i in 1 2 3 4 5 6; do
  req "Đăng nhập sai lần $i (banhhoa)" "" "" POST /api/login username=banhhoa password=sai-mat-khau
done
req "Đăng nhập tài khoản không tồn tại" "" "" POST /api/login username=khong_ton_tai password=abc
