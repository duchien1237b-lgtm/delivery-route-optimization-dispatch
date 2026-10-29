#!/usr/bin/env python3
"""Sinh bộ dữ liệu "Đô thị mô phỏng" (data/map_city.txt, data/orders_city.txt).

Lưới 40 × 50 giao lộ trong khung TP.HCM, có:
  - trục chính (mỗi 6 hàng / 7 cột) nhanh hơn đường nhánh,
  - vành đai ngoài cùng: nhanh, cấm xe máy, ít kẹt,
  - sông chạy dọc phía đông, chỉ qua được ở 5 cây cầu (thu phí, kẹt nặng giờ cao điểm),
  - đường nhánh trong bán kính 3 km quanh trung tâm cấm xe tải,
  - khoảng 12% đường nhánh bị bỏ (hẻm cụt) nhưng bản đồ vẫn liên thông.
Chạy lại script cho cùng kết quả (seed cố định):  python3 tools/gen_city.py
"""
import math
import os
import random

ROWS, COLS = 40, 50
LAT0, LAT1 = 10.70, 10.86
LON0, LON1 = 106.60, 106.80
CENTER = (10.776, 106.700)
rng = random.Random(2026)

ROW_ART = ["Điện Biên Phủ", "Nguyễn Thị Minh Khai", "Võ Văn Kiệt", "Trường Chinh", "Phạm Văn Đồng", "Ba Tháng Hai",
           "Nguyễn Văn Linh"]
COL_ART = ["Cách Mạng Tháng Tám", "Hai Bà Trưng", "Nam Kỳ Khởi Nghĩa", "Lý Thường Kiệt", "Nguyễn Văn Trỗi",
           "Xô Viết Nghệ Tĩnh", "Lê Văn Sỹ", "Phan Đăng Lưu"]


def hav(a, b):
    r = math.pi / 180
    dlat, dlon = (b[0] - a[0]) * r, (b[1] - a[1]) * r
    h = math.sin(dlat / 2) ** 2 + math.cos(a[0] * r) * math.cos(b[0] * r) * math.sin(dlon / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def row_name(r):
    if r in (0, ROWS - 1):
        return "Vành đai " + ("Bắc" if r else "Nam")
    if r % 6 == 3:
        return ROW_ART[(r // 6) % len(ROW_ART)]
    return f"Đường số {r + 1}"


def col_name(c):
    if c in (0, COLS - 1):
        return "Vành đai " + ("Đông" if c else "Tây")
    if c % 7 == 3:
        return COL_ART[(c // 7) % len(COL_ART)]
    return f"Đường D{c + 1}"


def is_ring(r, c):
    return r in (0, ROWS - 1) or c in (0, COLS - 1)


# ---------------------------------------------------------------- Giao lộ
pos = {}
for r in range(ROWS):
    for c in range(COLS):
        jr = 0 if is_ring(r, c) else rng.uniform(-0.25, 0.25)
        jc = 0 if is_ring(r, c) else rng.uniform(-0.25, 0.25)
        lat = LAT0 + (r + jr) / (ROWS - 1) * (LAT1 - LAT0)
        lon = LON0 + (c + jc) / (COLS - 1) * (LON1 - LON0)
        pos[(r, c)] = (round(lat, 5), round(lon, 5))

# Sông: đường cong phía đông, cột của sông thay đổi theo hàng
def river_col(r):
    return 37.5 + 3.0 * math.sin(r / ROWS * math.pi * 1.6)

BRIDGES = {5, 13, 20, 27, 34}

# ---------------------------------------------------------------- Đoạn đường
edges = {}
def add(a, b):
    (r1, c1), (r2, c2) = a, b
    if r1 == r2:   # đoạn ngang: thuộc đường của hàng r1
        cross = (c1 < river_col(r1) <= c2) or (c2 < river_col(r1) <= c1)
        if cross and r1 not in BRIDGES and not is_ring(r1, c1):
            return
        art = r1 % 6 == 3
        ring = r1 in (0, ROWS - 1)
    else:          # đoạn dọc: thuộc đường của cột c1; sông uốn nên có thể cắt chéo
        cross = (c1 < river_col(r1)) != (c1 < river_col(r2))
        if cross and not is_ring(r1, c1):
            return
        art = c1 % 7 == 3
        ring = c1 in (0, COLS - 1)
    pa, pb = pos[a], pos[b]
    km = hav(pa, pb) * 1.15
    mid = ((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2)
    central = hav(mid, CENTER) < 4.0
    if ring:
        speed, peak, mask = 60, 1.3, 6          # vành đai: cấm xe máy
    elif cross:
        speed, peak, mask = 35, 2.5, 7          # cầu
    elif art:
        speed, peak, mask = 40, 2.3 if central else 1.7, 7
    else:
        speed, peak, mask = 25, 1.9 if central else 1.4, 3 if hav(mid, CENTER) < 3.0 else 7
    cost = 5 if cross else 0
    edges[(a, b)] = (round(km, 3), round(km / speed * 60, 2), cost, mask, peak, art or ring or cross)

for r in range(ROWS):
    for c in range(COLS):
        if c + 1 < COLS:
            add((r, c), (r, c + 1))
        if r + 1 < ROWS:
            add((r, c), (r + 1, c))

# Bỏ ngẫu nhiên ~12% đường nhánh nhưng giữ liên thông
def connected(es):
    adj = {k: [] for k in pos}
    for a, b in es:
        adj[a].append(b)
        adj[b].append(a)
    seen, stack = {(0, 0)}, [(0, 0)]
    while stack:
        u = stack.pop()
        for v in adj[u]:
            if v not in seen:
                seen.add(v)
                stack.append(v)
    return len(seen) == len(pos)

locals_ = [k for k, v in edges.items() if not v[5]]
rng.shuffle(locals_)
for k in locals_[: int(len(locals_) * 0.12)]:
    keep = edges.pop(k)
    if not connected(edges):
        edges[k] = keep

# ---------------------------------------------------------------- Đánh số: kho ở trung tâm là id 0
center_rc = min(pos, key=lambda k: hav(pos[k], CENTER) + (0 if k[0] % 6 == 3 and k[1] % 7 == 3 else 1))
order = sorted(pos, key=lambda k: (k != center_rc, k))
ids = {k: i for i, k in enumerate(order)}

def node_name(k):
    r, c = k
    base = f"{row_name(r)} - {col_name(c)}"
    return "Kho trung tâm (" + base + ")" if k == center_rc else base

here = os.path.dirname(os.path.abspath(__file__))
data = os.path.join(here, "..", "data")
with open(os.path.join(data, "map_city.txt"), "w", encoding="utf-8") as f:
    f.write("# Do thi mo phong: luoi 40 x 50 giao lo, song phia dong qua 5 cay cau, vanh dai cam xe may,\n")
    f.write("# trung tam cam xe tai. Sinh bang tools/gen_city.py (seed co dinh).\n")
    f.write("DIRECTED 0\n\n")
    f.write(f"NODES {len(order)}\n")
    for k in order:
        lat, lon = pos[k]
        f.write(f"{ids[k]} {lat} {lon} {node_name(k)}\n")
    f.write(f"\nEDGES {len(edges)}\n")
    f.write("# u  v  km  phut  phu_phi  loai_xe  he_so_cao_diem\n")
    for (a, b), (km, t, cost, mask, peak, _) in sorted(edges.items(), key=lambda kv: (ids[kv[0][0]], ids[kv[0][1]])):
        f.write(f"{ids[a]} {ids[b]} {km} {t} {cost} {mask} {peak}\n")

# ---------------------------------------------------------------- Đơn hàng
notes = ["Tài liệu", "Đồ ăn", "Quần áo", "Điện thoại", "Sách", "Thuốc", "Hoa tươi", "Linh kiện", "Mỹ phẩm", "Đồ gia dụng"]
targets = rng.sample([k for k in order if k != center_rc], 24)
with open(os.path.join(data, "orders_city.txt"), "w", encoding="utf-8") as f:
    f.write("# Don hang cho Do thi mo phong\n# id  nut_dich  kg  gap(0/1)  han(phut, -1 = khong)  ghi_chu\n")
    for i, k in enumerate(targets):
        urgent = rng.random() < 0.3
        deadline = rng.randrange(60, 181, 10) if urgent else (rng.randrange(90, 301, 10) if rng.random() < 0.35 else -1)
        w = round(rng.uniform(0.5, 9), 1)
        f.write(f"{201 + i} {ids[k]} {w} {int(urgent)} {deadline} {notes[i % len(notes)]}\n")
print(f"{len(order)} giao lo, {len(edges)} doan duong, kho: {node_name(center_rc)}")
