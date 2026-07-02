# Kế hoạch phát triển Backend Evidence & Review (Người 2)

Tài liệu này xác định phạm vi, hiện trạng audit, kế hoạch tích hợp song song và lộ trình hiện thực hóa các chức năng của **Người 2** trong Sprint hiện tại (MVP non-AI).

---

## 1. Phạm vi trách nhiệm & Nghiệp vụ (Người 2)

Người 2 chịu trách nhiệm phát triển các chức năng sau:
- **Evidences**: Quản lý hồ sơ minh chứng, xử lý metadata file lưu trữ.
- **Files/Storage**: Quản lý metadata file và tích hợp local/R2 storage.
- **Event Registry**: Quản lý kho sự kiện cấp trường/thành phố để học sinh tự đối chiếu và import minh chứng trực tiếp.
- **Knowledge Base**: Tra cứu metadata tiền lệ xét duyệt hỗ trợ cán bộ ra quyết định.
- **Review Tasks**: Quản lý các task xét duyệt theo tiêu chí của Officer.
- **Manager Dashboard/Workload**: Xem tổng hợp tiến độ xét duyệt và quản lý khối lượng công việc của Officer.
- **Resolution Hub**: Giải quyết tranh chấp/đối sánh cơ bản cấp Hội đồng.
- **Notifications**: Gửi thông báo đến học sinh và cán bộ liên quan đến quy trình xét chọn.
- **Audit Logs**: Ghi log các hoạt động trong phạm vi quản lý của Người 2.
- **Exports**: Xuất dữ liệu tổng hợp dạng CSV/JSON phục vụ báo cáo.

---

## 2. Kết quả Audit hệ thống hiện tại

### 2.1. Phân loại API theo Đối tượng sử dụng
Các endpoint của Người 2 được phân chia rõ ràng:

#### Dành cho Student (FE Student):
- `GET /api/applications/:id/evidences` - Xem danh sách minh chứng của hồ sơ hiện tại.
- `POST /api/applications/:id/evidences` - Tạo mới minh chứng (Zod schema đang bị ép cứng `manual_upload`, cần sửa).
- `POST /api/evidences/:id/files` - Upload file đính kèm cho minh chứng dạng `manual_upload`.
- `GET /api/evidences/:id/card` - Xem chi tiết card minh chứng đã trích xuất.
- `PATCH /api/evidences/:id` - Cập nhật thông tin minh chứng.
- `DELETE /api/evidences/:id` - Xóa minh chứng.
- `GET /api/events` - Tra cứu danh sách sự kiện từ Event Registry để học sinh đăng ký / tìm kiếm.
- `POST /api/events/:id/check-participant` - Kiểm tra xem học sinh có trong danh sách tham gia sự kiện không.
- `POST /api/events/:id/import` - Nhập sự kiện từ Event Registry thành minh chứng của Application.
- `GET /api/notifications` - Xem thông báo cá nhân.
- `PATCH /api/notifications/:id/read` - Đánh dấu đã đọc thông báo.

#### Dành cho Officer / Manager / Committee / Admin (FE Officer):
- `GET /api/review/tasks` - Danh sách công việc cần xét duyệt (lọc theo chuyên trách và khoa).
- `GET /api/review/tasks/:id` - Xem chi tiết công việc xét duyệt (bao gồm minh chứng đi kèm).
- `POST /api/review/tasks/:id/decision` - Quyết định duyệt/từ chối/yêu cầu bổ sung tiêu chí.
- `POST /api/review/tasks/:id/request-supplement` - Yêu cầu học sinh bổ sung tài liệu.
- `POST /api/review/tasks/:id/escalate-resolution` - Chuyển tiếp hồ sơ lên Resolution Hub (Hội đồng).
- `POST /api/review/applications/:id/ensure-tasks` - **[CẦN THÊM MỚI]** Đảm bảo / Backfill các review task cho hồ sơ nếu Người 1 submit không tạo đủ task.
- `GET /api/manager/applications` - Xem tổng hợp toàn bộ danh sách hồ sơ.
- `GET /api/manager/workloads` - Thống kê workload và phân bổ công việc của các Officer.
- `POST /api/manager/tasks/:id/assign` - Phân công task review cho Officer.
- `GET /api/manager/applications/:id/aggregation` - Xem tổng hợp kết quả tất cả các tiêu chí của một hồ sơ.
- `POST /api/manager/applications/:id/finalize` - Chốt kết quả xét chọn cuối cùng cho hồ sơ.
- `POST /api/manager/applications/:id/reopen` - Mở lại hồ sơ đã chốt để xét lại.
- `GET /api/resolution/cases` - Xem danh sách các trường hợp tranh chấp tại Resolution Hub.
- `GET /api/resolution/cases/:id` - Xem chi tiết ca tranh chấp.
- `POST /api/resolution/cases/:id/decision` - Hội đồng quyết định kết quả tranh chấp.
- `POST /api/resolution/cases/:id/reopen` - Mở lại ca tranh chấp đã đóng.
- `GET /api/audit/logs` - Xem nhật ký hệ thống (Hiện tại đang ném lỗi `NOT_IMPLEMENTED`).
- `POST /api/exports/review-results` - Xuất file kết quả xét duyệt dưới dạng JSON hoặc CSV.
- `GET /api/exports/:fileId/download` - Tải file CSV đã xuất.

---

### 2.2. Điểm Lệch Contract và Bugs đã Phát hiện
1. **Zod Schema tạo Evidence bị giới hạn**:
   - File `src/modules/evidences/evidences.validation.ts` dòng 15: `sourceType: z.literal(EvidenceSourceType.manual_upload)` chỉ chấp nhận `manual_upload`.
   - FE mong muốn gửi cả `metric_input`, `event_import`, `collective_import`.
   - **Cách sửa**: Chuyển thành `z.nativeEnum(EvidenceSourceType)`.
2. **Hardcode `sourceType` khi tạo**:
   - File `src/modules/evidences/evidences.service.ts` dòng 68: `sourceType: EvidenceSourceType.manual_upload` đang bị gán cứng.
   - **Cách sửa**: Lấy giá trị trực tiếp từ request body (`input.sourceType`).
3. **Phụ thuộc AI/OCR trong Upload**:
   - File `src/modules/evidences/evidences.service.ts` khi upload file đính kèm sẽ chuyển trạng thái sang `pending_indexing` và đẩy vào `indexingJob` loại `evidence_ocr`.
   - **Cách bypass non-AI**: Cập nhật trạng thái trực tiếp thành `indexed` và `indexingStatus: indexed` ngay khi lưu file metadata thành công, không chặn hay đợi chạy OCR thật.
4. **Phân quyền tại Resolution Hub**:
   - File `src/modules/resolution/resolution.routes.ts` đang giới hạn các chức năng quyết định/mở lại chỉ cho `Role.committee` và `Role.admin`.
   - Nghiệp vụ quy định Manager cũng được quyền xử lý tranh chấp.
   - **Cách sửa**: Thêm `Role.manager` vào `requireRole` cho các route quyết định tranh chấp.
5. **Thiếu API Backfill Review Task**:
   - Trong trường hợp submit ở module Người 1 gặp lỗi hoặc không tạo đủ task review (trả về `reviewTasks: []`), Manager/Officer cần API để tự động backfill (ensure) các task xét duyệt theo tiêu chí phù hợp.
   - **Cách sửa**: Implement `ensureReviewTasksForApplication` trong `ReviewService` và expose endpoint `POST /api/review/applications/:id/ensure-tasks`.
6. **Lệch Enum ResolutionStatus & NotificationType**:
   - Contract FE yêu cầu `ResolutionStatus` có thêm các trạng thái `analyzing`, `committee_review`, `closed`. Trong khi DB gốc chỉ có `open`, `in_review`, `resolved`, `rejected`.
   - Contract FE yêu cầu `NotificationType` có thêm các loại `supplement_requested`, `resolution_updated`, `application_updated`, `export_ready`.
   - **Cách sửa**: Cập nhật `prisma/schema.prisma` và chạy script SQL để cập nhật Postgres types tương thích ngược (đã thực hiện cập nhật `ResolutionStatus` thành công ở DB).

---

### 2.3. Giải pháp non-AI (MVP)
Sprint này loại bỏ hoàn toàn xử lý AI thực tế (chatbot, OCR thật, SmartReader live, LLM...). 
- **Upload File**: Chỉ nhận file, lưu vào đĩa cục bộ (hoặc R2), ghi nhận đường dẫn, chuyển đổi trạng thái minh chứng sang `indexed` để Officer duyệt thủ công.
- **Evidence Card**: Trả về dữ liệu trích xuất trống hoặc mock cơ bản (`warnings: []`), không gọi module AI.
- **Đối chiếu Sự kiện**: Thực hiện đối soán chính xác theo mã sinh viên (`studentCode`) và mã sự kiện (`eventId`) trong bảng `EventParticipant`, loại bỏ đối chiếu ngữ nghĩa (semantic search/vector).

---

## 3. Kế hoạch Phát triển song song & Hạn chế Conflict

Để đảm bảo 4 người code song song không xung đột:
- **Không thay đổi cấu trúc database tùy tiện**: Việc bổ sung enum giá trị được chạy qua câu lệnh SQL trực tiếp độc lập.
- **Không refactor các module dùng chung**: Các file trong `src/modules/applications/**` và `src/modules/users/**` của Người 1 sẽ không bị chỉnh sửa sâu.
- **Giao diện tích hợp thông qua Service**: Người 2 viết các logic tự chứa (self-contained) trong module `review` để bổ trợ cho quá trình submit hồ sơ mà không can thiệp trực tiếp vào code submit của Người 1.

---

## 4. Lộ trình Triển khai Đề xuất (Thứ tự các Prompt)

- **Prompt 1 (Hiện tại)**: Audit & Hoàn thiện tài liệu `docs/be-evidence-review-plan.md`. Sửa các lỗi schema/types DB cần thiết.
- **Prompt 2**: Sửa Zod Schema, Service tạo minh chứng (`evidences`) để lưu đúng `sourceType` và bỏ chặn OCR AI.
- **Prompt 3**: Hiện thực hóa API `ensureReviewTasksForApplication` trong module `review` để backfill và tự động giao Officer phụ trách.
- **Prompt 4**: Cập nhật phân quyền Manager trong Resolution Hub, hoàn thiện `AuditService` ghi log.
- **Prompt 5**: Kiểm thử tích hợp toàn bộ các API, chạy `pnpm build` xác thực lỗi build và chạy test suite vitest.

---

## 5. Kế hoạch Kiểm thử Cuối Sprint (Test Plan)

1. **Unit Tests**:
   - Đảm bảo các test case cũ của hệ thống vẫn pass: `npx vitest run`.
   - Viết bổ sung unit test kiểm tra logic phân phối task tự động của `ReviewAssignmentService`.
2. **Integration Tests (API Testing)**:
   - Tạo minh chứng với các loại `sourceType` khác nhau và kiểm tra xem trạng thái khởi tạo có chính xác không.
   - Gọi API submit hoặc backfill task review để kiểm tra việc tạo task và tự động phân công Officer.
   - Thử nghiệm phân quyền truy cập: Student không được gọi API xét duyệt; Officer khoa A không được xem hồ sơ khoa B (trừ Manager).
   - Xuất kết quả báo cáo ra file CSV/JSON và xác nhận định dạng dữ liệu trả về chuẩn.

---

## 6. Final Status trước PR (2026-07-02)

### 6.1. Endpoint đã hoàn thành trong scope Người 2

**Evidence/Event Registry**
- `GET /api/applications/:id/evidences`
- `POST /api/applications/:id/evidences`
- `PATCH /api/evidences/:id`
- `DELETE /api/evidences/:id`
- `POST /api/evidences/:id/files`
- `POST /api/evidences/:id/start-indexing` trả `mode="non_ai_disabled"`.
- `GET /api/evidences/:id/card`
- `GET /api/events`
- `GET /api/events/:id`
- `POST /api/events`
- `POST /api/events/:id/participants/import`
- `POST /api/events/:id/check-participant`
- `POST /api/events/:id/import-to-application`

**Review/Notification**
- `POST /api/review/applications/:applicationId/tasks/ensure`
- `GET /api/review/tasks`
- `GET /api/review/tasks/:id`
- `POST /api/review/tasks/:id/decision`
- `POST /api/review/tasks/:id/request-supplement`
- `POST /api/review/tasks/:id/escalate-resolution`
- `GET /api/notifications`
- `PATCH /api/notifications/:id/read`
- `PATCH /api/notifications/read-all`

**Resolution/Manager/Export**
- `GET /api/resolution/cases`
- `GET /api/resolution/cases/:id`
- `POST /api/resolution/cases/:id/resolve`
- `PATCH /api/resolution/cases/:id/status`
- Alias legacy `POST /api/resolution/cases/:id/decision`
- `GET /api/manager/applications`
- `GET /api/manager/applications/:id/summary`
- `GET /api/manager/workload`
- Alias legacy `GET /api/manager/workloads`
- `PATCH /api/manager/review-tasks/:id/reassign`
- Alias legacy `POST /api/manager/review-tasks/:id/assign`
- `POST /api/manager/applications/:id/aggregate`
- `GET /api/exports/applications.json`
- `GET /api/exports/applications.csv`
- `GET /api/exports/review-tasks.csv`

### 6.2. Endpoint còn TODO / phụ thuộc team khác

- `GET /api/audit/logs` vẫn không thuộc scope polish này; manager summary đã lấy timeline audit latest theo hồ sơ.
- Route submit/current application phụ thuộc module Người 1; curl docs để placeholder nếu chưa merge.
- Notification DB hiện lưu fields theo schema hiện có; helper nhận `metadata`, `evidenceId`, `reviewTaskId`, `resolutionCaseId`, nhưng cần migration riêng nếu FE muốn query sâu các field context này từ list.
- `ResolutionStatus` contract có `analyzing`, `committee_review`, `closed`; DB hiện dùng enum sẵn có và service normalize sang `in_review/resolved`, giữ `workflowStatus` trong `committeeDecision`.

### 6.3. Contract FE cần biết

- CSV export trả raw CSV với header download; JSON export trả `ApiResponse` chuẩn.
- Evidence upload non-AI chỉ nhận `image/jpeg`, `image/png`, `application/pdf`.
- Event import route thực tế là `POST /api/events/:id/import-to-application`.
- Ensure review task route thực tế là `POST /api/review/applications/:applicationId/tasks/ensure`.
- Student chỉ thấy notification của chính mình; không có endpoint cá nhân để manager/admin xem notification user khác.
- Student không được list review tasks, resolution cases, export, import participants, hoặc check `studentCode` người khác.
- Committee có quyền resolution/export/aggregate; reassign/workload giữ cho manager/admin.

### 6.4. Known limitations non-AI

- Không gọi OCR/SmartReader/chatbot/LLM trong upload evidence non-AI path.
- Evidence card là dữ liệu rỗng/mock hoặc metadata thủ công; officer/manager vẫn quyết định cuối cùng.
- Event roster indexing là xử lý bảng participant, không phải AI OCR evidence.
- Knowledge base item tạo từ resolution dùng note người dùng nhập, không sinh summary bằng LLM.

### 6.4.1. Những việc không đưa vào PR Người 2

```txt
[ ] Không làm AI precheck.
[ ] Không làm OCR thật.
[ ] Không gọi VNPT SmartReader.
[ ] Không làm chatbot/RAG.
[ ] Không làm SmartUX AI analytics.
[ ] Không sửa frontend.
[ ] Không refactor auth/application/metrics của Người 1.
[ ] Không đổi response contract chung.
[ ] Không đổi enum sang tiếng Việt.
[ ] Không đổi route đã thống nhất nếu không có lý do rất mạnh.
```

### 6.5. Commands đã chạy và kết quả

- `pnpm build`, `pnpm test`, `pnpm lint`: không chạy được vì máy local không có `pnpm`.
- `npm run build`: pass.
- `npm test`: pass, 8 test files / 27 tests.
- `npm run lint`: pass với 18 warnings `no-explicit-any` ở DTO/JSON payload linh hoạt.
- `git diff --check` scoped: đã dọn trailing whitespace trong scope; chỉ còn cảnh báo LF/CRLF nếu Git trên Windows tự chuyển line ending.

### 6.6. Handoff cho Người 3 - Frontend Student Flow

Người 3 có thể nối các API sau:

```txt
GET    /api/applications/:applicationId/evidences
POST   /api/applications/:applicationId/evidences
PATCH  /api/evidences/:id
DELETE /api/evidences/:id
POST   /api/evidences/:id/files
POST   /api/evidences/:id/start-indexing   // compatibility only, non-AI
GET    /api/events
GET    /api/events/:id
POST   /api/events/:id/check-participant
POST   /api/events/:id/import-to-application
GET    /api/notifications
PATCH  /api/notifications/:id/read
```

Lưu ý cho FE Student:

- Không đọc `data.jobId` như bắt buộc. Sprint non-AI trả `jobId: null`.
- Upload xong evidence đã sẵn sàng cho manual review.
- `sourceType` phải gửi đúng, backend không tự đoán.

### 6.7. Handoff cho Người 4 - Frontend Officer/Manager Flow

Người 4 có thể nối các API sau:

```txt
POST  /api/review/applications/:applicationId/tasks/ensure
GET   /api/review/tasks
GET   /api/review/tasks/:id
POST  /api/review/tasks/:id/decision
POST  /api/review/tasks/:id/request-supplement
POST  /api/review/tasks/:id/escalate-resolution
GET   /api/manager/applications
GET   /api/manager/applications/:id/summary
GET   /api/manager/workload
PATCH /api/manager/review-tasks/:id/reassign
GET   /api/resolution/cases
GET   /api/resolution/cases/:id
POST  /api/resolution/cases/:id/resolve
GET   /api/exports/applications.json
GET   /api/exports/applications.csv
```

Lưu ý cho FE Officer/Manager:

- Nếu application submit của Người 1 chưa tự tạo task, gọi `POST /api/review/applications/:applicationId/tasks/ensure` trước khi vào queue/demo.
- Review detail đã trả evidence/metrics/application/student đủ để render mà không cần gọi quá nhiều API phụ.
- Export CSV có thể là raw response, không phải ApiResponse JSON.
