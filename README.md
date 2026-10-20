# VINCENT ART TÀI CHÍNH

## Triển khai Render từ GitHub

Repository chứa `render.yaml` cho dịch vụ Node.js tại Singapore. Blueprint sử dụng **gói Starter có tính phí** và **Persistent Disk 1 GB** gắn tại `/var/data`, nơi SQLite lưu dữ liệu. Không chọn gói Free hoặc bỏ disk: khi máy chủ được thay thế dữ liệu tài chính có thể bị mất. Chỉ chạy **một instance** dùng SQLite; chưa hỗ trợ nhiều instance ghi đồng thời hoặc đồng bộ đa vùng.

1. Mở Render Dashboard → **New → Blueprint**, kết nối GitHub và chọn repository `VincentArtTaichinh` (nhánh `main`). Kiểm tra chi phí trước khi xác nhận tạo dịch vụ.
2. Nhập `ADMIN_EMAIL` và `ADMIN_PASSWORD` mạnh (tối thiểu 12 ký tự) dưới dạng biến môi trường bí mật. Chúng chỉ tạo tài khoản quản trị khi cơ sở dữ liệu chưa có người dùng. Giữ `NODE_ENV=production`, `HOST=0.0.0.0`, `VINCENT_DATA_DIR=/var/data`.
3. Nếu sử dụng AI, tạo **API key mới** tại Google AI Studio rồi đặt vào `AI_API_KEY` trong môi trường Render. API key từng được gửi qua hội thoại cần xoay vòng trước khi phục vụ công khai. Không đưa key, `.env` hoặc tệp `.sqlite` lên GitHub.
4. Kiểm tra `https://<ten-dich-vu>.onrender.com/healthz` trả `{"ok":true}`, đăng nhập, thử quy trình trên dữ liệu kiểm thử độc lập và kiểm tra SQLite lưu nguyên sau restart.
5. Cấu hình sao lưu database từ persistent disk sang nơi lưu trữ bên ngoài Render theo lịch, kiểm thử khả năng phục hồi và phân quyền tài khoản trước khi sử dụng với dữ liệu vận hành. Bộ công cụ `npm run backup` và `npm run restore` được cung cấp để thực hiện sao lưu/phục hồi có kiểm soát; không khôi phục đè database đang hoạt động.

Render build dùng `npm run check` để kiểm tra cú pháp trên máy chủ. Chạy `npm run build` tại môi trường phát triển/CI để chạy đầy đủ bộ kiểm thử trước khi đưa phiên bản mới lên production. Cấu hình deploy sẵn sàng để tạo **dịch vụ thử nghiệm**; độ sẵn sàng production còn phụ thuộc kiểm thử trên Render và phương án sao lưu/khôi phục dữ liệu thực tế.

Ứng dụng nội bộ đang phát triển cho quản lý tòa nhà, phòng, kỳ thu, hóa đơn, thanh toán và công nợ. Dùng SQLite thật (`data/vincent.sqlite` mặc định, hoặc thư mục `VINCENT_DATA_DIR`), không tự tạo dữ liệu mẫu. **Chưa được xác minh đủ điều kiện triển khai production.**

## Chạy trên máy

Yêu cầu Node.js 24+. Trong PowerShell:

```powershell
$env:ADMIN_EMAIL='admin@example.com'
$env:ADMIN_PASSWORD='MatKhauManhTren12KyTu!'
npm start
```

Mở `http://localhost:3000`, đăng nhập bằng thông tin đã đặt. Biến `ADMIN_PASSWORD` chỉ dùng để khởi tạo tài khoản quản trị lần đầu. Hãy chọn mật khẩu bí mật thực sự trước khi đưa vào sử dụng.

```powershell
npm run check
npm test
npm run build
```

`npm run build` hiện thực hiện kiểm tra cú pháp và chạy bộ test; dự án Node.js thuần chưa có bước đóng gói bundle triển khai riêng. Không dùng kết quả lệnh này làm bằng chứng đã triển khai HTTPS.

Biến tùy chọn: `HOST` (mặc định `127.0.0.1`), `PORT` (mặc định `3000`), `VINCENT_DATA_DIR` (thư mục chứa SQLite). Khi thực sự chạy sau HTTPS/reverse proxy, cần xác minh `NODE_ENV=production` hoặc `COOKIE_SECURE=1` để bật `Secure` cho cookie phiên. Tài khoản admin chỉ được tạo lúc database chưa có user; không tự đặt lại mật khẩu của admin hiện hữu.

## Luồng sử dụng

Tạo tòa nhà → chọn tòa → tạo phòng → chọn tháng → tạo hóa đơn nhập điện nước → ghi nhận thanh toán → xem công nợ trên Dashboard. Có thể sửa chỉ số điện hóa đơn bằng thao tác “Sửa” có lý do; phiên bản cũ được giữ lại. Các khoản thanh toán không bị thay đổi khi sửa hóa đơn.

Đã có trong mã nguồn hiện tại: import **CSV và XLSX nhiều sheet** theo tòa và kỳ đã chọn với bước preview/đối soát trước khi ghi; nhật ký thu và đảo giao dịch; báo cáo theo người thu (tòa × nhân viên, tiền mặt/chuyển khoản); đối soát từng phòng; khóa/mở kỳ có quyền và lý do; tạo tài khoản có phân quyền theo tòa; xuất **CSV** của nhật ký và đối soát; audit log. Các nghiệp vụ chính có kiểm thử tích hợp; phạm vi còn thiếu được ghi trong `TASKS.md`.

Các nút **Xem / In** tạo thông báo thu tiền nội bộ để trình duyệt in hoặc lưu PDF. Chức năng này chưa tương đương xuất PDF, PNG, ZIP hóa đơn hàng loạt bằng backend và không tạo hóa đơn điện tử hợp lệ về thuế.

## Trợ lý chat

Sau khi đăng nhập, bấm **✦ Trợ lý AI**. Hiện hỗ trợ mẫu câu:

- `Sửa giá điện toàn bộ phòng nhà A1,A2 lên 4.000đ/kwh`
- `Sửa số người ở phòng A2.504 thành 3`
- `Số nước mới của A4.301 là 50 tháng 10/2026`
- `Lấy hóa đơn A4.301 tháng 10/2026`

Trợ lý đưa ra đề xuất trước khi cập nhật. Người dùng phải bấm **Xác nhận thay đổi** để ghi dữ liệu vào database. Sau khi sửa nước, có nút **Xem / In hóa đơn vừa sửa**. Giá điện mới áp dụng cho hóa đơn tạo sau khi đổi; các hóa đơn cũ không bị thay đổi. Trợ lý hiện là bộ hiểu lệnh tiếng Việt theo mẫu xác định, **chưa tích hợp dịch vụ LLM bên ngoài**.

## Backup và giới hạn hiện tại

## Cài ứng dụng trên Android (PWA)

Mở **đường dẫn HTTPS** của VINCENT ART bằng **Chrome trên Android**. Nhấn **Cài ứng dụng** trong giao diện, sau đó chọn **Cài đặt** khi Chrome hỏi. Nếu lời nhắc tự động không xuất hiện, nhấn menu **⋮** của Chrome và chọn **Cài đặt ứng dụng** hoặc **Thêm vào màn hình chính**. Sau khi cài, mở bằng biểu tượng **VA** như ứng dụng thông thường. Trên iPhone, mở bằng Safari → Chia sẻ → Thêm vào Màn hình chính.

Máy chủ phải cung cấp `/manifest.webmanifest`, `/sw.js` và các ảnh `/icons/` qua cùng hostname HTTPS. Trên điện thoại, URL `http://<IP-LAN>:3000` không đáp ứng điều kiện secure context cho Service Worker; `localhost` chỉ được chấp nhận khi chạy trực tiếp trên chính thiết bị. Khi đổi hostname Quick Tunnel, phải cài đặt lại từ URL mới. Nếu đang mở tab từ trước khi cập nhật, hãy tải lại trang một lần.

Service Worker chỉ cache tài nguyên giao diện tĩnh; `/api/*`, session, dữ liệu hóa đơn và thao tác thu tiền luôn đi tới máy chủ. **Ứng dụng cần mạng để đăng nhập và thực hiện nghiệp vụ tài chính**. Đây là PWA; không tạo APK để cài đặt ngoài trình duyệt.

Có script `npm run backup` tạo bản sao SQLite và kiểm tra toàn vẹn, cùng `npm run restore -- <backup.sqlite> <thu-muc-moi>` để phục hồi vào **thư mục mới chưa tồn tại**. Đã kiểm thử cơ chế này với database cô lập; chưa xác minh backup và phục hồi cho dữ liệu production. Cần xác định đúng `VINCENT_DATA_DIR` và có kế hoạch lưu bản sao ngoài máy trước khi đưa vào sử dụng.

Trợ lý chat hiện nhận lệnh theo quy tắc, **chưa kết nối LLM bên ngoài**. Import XLSX/CSV có đối chiếu theo quy tắc; **chưa có OCR/chụp ảnh quét hóa đơn, Google Sheets API hay AI nhận diện nội dung tùy ý**. Chưa có quy trình hoàn tiền/chuyển thu dư sang kỳ sau, backend export PDF/PNG/ZIP, quản lý hợp đồng/khách thuê đầy đủ, và chưa xác minh vận hành HTTPS, backup production, giám sát, khôi phục khi triển khai.

Kết quả kiểm thử được bàn giao ngày 19/10/2026: **69/69 test PASS** (bao gồm kiểm thử trình duyệt và responsive). Đây là bằng chứng kiểm thử trong môi trường phát triển, không bảo đảm toàn bộ chức năng theo master prompt đã hoàn thành. Xem `TASKS.md` cho tình trạng từng nhóm và các điều kiện cần đạt trước production.
