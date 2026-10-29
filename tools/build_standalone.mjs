// Dựng bản MỘT FILE (dieu-phoi-giao-hang.html) từ mã nguồn:
//   web/index.html + web/css/style.css   -> giao diện (dùng chung với bản C++)
//   web/js/**                            -> mã giao diện (dùng chung với bản C++)
//   standalone/engine/*.js               -> bản JavaScript của toàn bộ logic C++ (thuật toán, tài khoản, nghiệp vụ)
//   standalone/api.js                    -> thay web/js/api.js: gọi thẳng engine thay vì fetch tới server
//   data/*.txt                           -> dữ liệu mẫu nhúng vào file (trừ my_*, out_*, orders_live: dữ liệu làm việc)
//
// Cách dùng:  cd standalone && npm install && cd .. && node tools/build_standalone.mjs [đường_dẫn_ra]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'standalone', 'package.json'));
const esbuild = require('esbuild');
const out = path.resolve(process.argv[2] || path.join(root, 'dieu-phoi-giao-hang.html'));

const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const stage = fs.mkdtempSync(path.join(root, 'build-standalone-'));
try {
  // 1. engine: ghép các mảnh theo thứ tự tên file, thêm dữ liệu mẫu
  const dataFiles = fs.readdirSync(path.join(root, 'data')).filter((f) => f.endsWith('.txt') && !/^(my_|out_|orders_live)/.test(f)).sort();
  const data = Object.fromEntries(dataFiles.map((f) => [f, read('data', f)]));
  const frags = fs.readdirSync(path.join(root, 'standalone', 'engine')).filter((f) => f.endsWith('.js')).sort();
  let engine = frags.map((f) => `// ---- standalone/engine/${f}\n${read('standalone', 'engine', f)}`).join('\n');
  engine = `var DATA = ${JSON.stringify(data)};\n${engine}\nexport { handle, exportText };\n`;
  fs.writeFileSync(path.join(stage, 'engine_all.js'), engine);

  // 2. giao diện: sao web/js, thay api.js
  fs.cpSync(path.join(root, 'web', 'js'), path.join(stage, 'js'), { recursive: true });
  fs.copyFileSync(path.join(root, 'standalone', 'api.js'), path.join(stage, 'js', 'api.js'));
  fs.writeFileSync(path.join(stage, 'js', 'engine_all.js'), engine);

  const res = await esbuild.build({
    entryPoints: [path.join(stage, 'js', 'app.js')], bundle: true, format: 'iife', write: false,
    charset: 'utf8', target: 'es2020', logLevel: 'warning',
  });
  const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

  // 3. HTML
  let html = read('web', 'index.html');
  const css = read('web', 'css', 'style.css');
  html = html.replace('<link rel="stylesheet" href="css/style.css">', () => `<style>\n${css}\n</style>`);
  html = html.replace('<script type="module" src="js/app.js"></script>', () => `<script>\n${js}\n</script>`);
  html = html.replace('content="Tìm đường, dự toán chi phí và điều phối đơn hàng cho shipper trên bản đồ thành phố."',
    'content="Tìm đường, dự toán chi phí và điều phối đơn hàng cho shipper trên bản đồ thành phố. Bản một file HTML, chạy ngay trong trình duyệt."');
  const banner = `<!--
  Hệ thống Tìm đường & Điều phối Giao hàng — Đề tài 08 (Cấu trúc dữ liệu & Giải thuật)
  Bản MỘT FILE: mở thẳng file này bằng trình duyệt, không cần cài đặt, không cần server.
  Toàn bộ thuật toán (Dijkstra 3 phiên bản, A*, Dijkstra theo giờ cao điểm, Bellman-Ford, Yen,
  BFS/DFS, Kosaraju, Tarjan (cầu, khớp), Kruskal + DSU, Prim, Floyd–Warshall, TSP Held-Karp,
  Nearest Neighbor, 2-opt, Cheapest Insertion, tìm kiếm cục bộ theo hạn giao, mô phỏng từng bước,
  Trie, Min-Heap, Undo/Redo 2 ngăn xếp...) cùng toàn bộ nghiệp vụ tài khoản, vai trò và đơn hàng
  được viết lại bằng JavaScript từ bản C++ và cho cùng kết quả. Dữ liệu người dùng lưu bằng localStorage.
  Tệp này được SINH TỰ ĐỘNG bởi tools/build_standalone.mjs — đừng sửa tay.
-->
`;
  html = html.replace('<!doctype html>\n', () => `<!doctype html>\n${banner}`);
  fs.writeFileSync(out, html);
  console.log(`Đã tạo ${path.relative(process.cwd(), out)} (${(html.length / 1024).toFixed(0)} KB)`);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
