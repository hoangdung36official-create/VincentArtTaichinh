# VINCENT ART TÀI CHÍNH — Tiến độ

## Android PWA (20/10/2026)
- Đã thêm manifest, biểu tượng 192/512/maskable, Service Worker và hướng dẫn/nút cài trên Chrome Android; cập nhật danh sách tệp tĩnh và MIME phía backend.
- Service Worker chỉ cache JS/CSS giao diện và không chặn các request tài chính; các giao dịch vẫn cần kết nối máy chủ.
- Kiểm thử PWA cô lập: HTTP/MIME, kích thước icon, manifest, trình duyệt Chromium mobile, đăng ký service worker và không cache API; kết quả chi tiết xem lần chạy `tests/pwa.test.js` mới nhất.
- Đã khởi động lại máy chủ preview tại cổng 31279 và xác minh URL HTTPS công khai trả HTTP 200 cho trang chủ, manifest, Service Worker và các icon. Vẫn cần thử thao tác cài đặt thực tế trên Android; đây chưa phải bản deploy production.

## Đã triển khai và có bằng chứng kiểm thử (19/10/2026)
- Backend Node.js và SQLite (WAL, foreign keys), xác thực phiên, phân quyền server-side theo tòa.
- Quản lý tòa/phòng, kỳ thu; hóa đơn và lịch sử phiên bản; thu tiền nhiều lần, chống trùng tham chiếu, đảo giao dịch; dashboard và audit log.
- Trợ lý tiếng Việt theo quy tắc: xem trước và xác nhận sửa điện/nước, số người, giá điện nhiều tòa; tìm/xem hóa đơn. Các thao tác sửa hóa đơn có log và phiên bản.
- Import CSV/XLSX nhiều sheet đúng kỳ với preview, cảnh báo sai lệch, chống ghi đè; xuất báo cáo đối soát và nhật ký thanh toán dạng CSV.
- Đối soát toàn tòa, công nợ, thống kê người thu theo tòa/phương thức; khóa/mở kỳ có quyền và lưu lý do; giao diện quản lý tài khoản theo tòa.
- In/lưu thông báo tiền thuê dưới dạng PDF thông qua hộp thoại in của trình duyệt.
- Kiểm thử độc lập cho backup và restore SQLite vào thư mục mới; kiểm thử trên Chromium và responsive các viewport 320, 375, 390, 721, 768, 820, 1024, 1440.
- **Full suite gần nhất: 69/69 PASS, 0 fail, 0 skipped.** Không chạy lại khi chưa có thay đổi mã nguồn hoặc tình huống mới cần xác minh.

## Kiểm toán tiếp nối sau mất kết nối
- Đã xác minh SHA-256 của hai bản snapshot trước; manifest mới nhất: **30 file, 20 không đổi, 10 thay đổi, 0 thiếu**. Những file thay đổi là `public/app.js`, `public/style.css`, `public/ui-pages.js`, `src/finance.js`, `src/import-xlsx.js`, `src/server.js`, `tests/browser.test.js`, `tests/finance.test.js`, `tests/integration.test.js`, `tests/xlsx.test.js`.
- Thư mục dự án hiện tại **không có `.git`**; chưa xác minh độc lập được branch/commit/worktree và số liệu phiên trước `26 file, +2.071/-64 dòng`. Không khởi tạo Git, reset, stash, commit hoặc ghi đè checkpoint.
- Kiểm tra tĩnh luồng dữ liệu tới `innerHTML`: tên nhà/phòng, email, ghi chú và tên sheet được escape; ID từ khóa chính INTEGER và số đếm từ kết quả truy vấn/mảng. **Chưa xác nhận lỗ hổng XSS có thể khai thác; chưa có kiểm thử tấn công động chuyên biệt.**
- Chưa xác minh production database, backup, process/server đang phục vụ, HTTPS và môi trường deploy. Database mặc định `data/vincent.sqlite` không xuất hiện tại thời điểm rà soát này (có thể dùng `VINCENT_DATA_DIR` khác).
- Đã tạo checkpoint mã nguồn trước đồng bộ tài liệu: `.artifacts/source-20261019-pre-docsync-audit.zip` (chứa 40 entry mã nguồn/tài liệu, không chứa database).

## Còn thiếu hoặc chưa xác minh — NOT PRODUCTION READY
- OCR ảnh/camera, LLM bên ngoài, Google Sheets API; tính năng AI hiện chỉ xử lý các mẫu câu và mapping dữ liệu theo quy tắc.
- PostgreSQL/migrations hoặc chiến lược vận hành SQLite được phê duyệt; quy trình backup production theo lịch, restore drill thực tế, audit retention.
- Quản lý hợp đồng, tenants và giá dịch vụ theo hiệu lực; hoàn tiền/chuyển thu dư, phân bổ công nợ liên kỳ.
- Backend xuất PDF/PNG/ZIP hàng loạt, chứng từ thu chuẩn hóa, hóa đơn điện tử theo quy định.
- Kiểm thử tải, đánh giá XSS/CSRF dưới cấu hình reverse proxy thực tế (đặc biệt Host/Origin), kiểm thử bảo mật chuyên sâu, giám sát và khôi phục sự cố.
- Build/artifact phát hành, cấu hình HTTPS/TLS, database triển khai, CI/CD và đường dẫn preview HTTPS. `npm run build` hiện chỉ chạy `check` và `test`.

## Việc tiếp theo
1. Rà soát và xác nhận các rủi ro còn mở bằng kiểm thử cô lập, ưu tiên các điều kiện triển khai (Host/Origin, cookie Secure, quy trình backup và phục hồi).
2. Hoàn thiện các luồng nghiệp vụ còn thiếu theo mức ưu tiên (AI OCR, xuất chứng từ, hợp đồng/giá theo hiệu lực, hoàn/điều chuyển tiền dư).
3. Chuẩn bị hạ tầng preview HTTPS tách biệt dữ liệu thực, kiểm thử E2E trên môi trường đó rồi mới xét production.
