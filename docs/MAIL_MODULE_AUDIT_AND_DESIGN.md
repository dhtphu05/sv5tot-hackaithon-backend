# Audit va de xuat thiet ke module gui mail cho sinh vien

Ngay audit: 2026-07-05

Pham vi: audit backend `sv5tot-hackaithon-backend` va cac diem lien quan tren frontend `namtot` de xac dinh thanh phan co the tai su dung cho module gui mail sinh vien.

## A. Tong quan hien trang

### Kien truc hien tai

Backend dang dung Express + TypeScript + Prisma, to chuc theo module/layer kha ro:

- `routes`: khai bao endpoint va middleware.
- `controller`: doc request, goi service, tra response.
- `service`: xu ly nghiep vu.
- `repository`: truy van database cho mot so module.
- `validation`: Zod schema.
- `dto`: map response.

Module hien co lien quan den mail:

- `applications`: luu ho so, nop ho so, mo bo sung, timeline.
- `evidences`: minh chung, file upload, OCR/indexing job.
- `precheck`: AI tien kiem va missing items.
- `review`: task xet duyet, quyet dinh, yeu cau bo sung, deadline.
- `manager`: dashboard, tong hop, chot ket qua.
- `resolution`: hoi dong xu ly case can doi soat.
- `notifications`: thong bao noi bo trong app.
- `audit`: audit log bat bien.
- `jobs`: queue DB-backed cho OCR/import.

He thong da co `src/infrastructure/mail/mail.service.ts`, nhung hien chi la placeholder:

```ts
export class MailService {
  async send(): Promise<never> {
    throw new AppError(501, ErrorCodes.NOT_IMPLEMENTED, 'Mail service is not implemented');
  }
}
```

Ket luan: khong nen tao module notification/email song song neu chi can gui mail. Nen mo rong `MailService` va them outbox/delivery layer rieng.

### Thanh phan co the tai su dung

- `User.email`: bat buoc va unique.
- `Notification`: da co type, title, message, userId, applicationId, collectiveProfileId.
- `AuditLog`: co the ghi them su kien `EMAIL_QUEUED`, `EMAIL_SENT`, `EMAIL_FAILED`.
- `Application`, `ReviewTask`, `ResolutionCase`: da chua du lieu trigger mail.
- `ReviewTask.dueDate`: co the dung cho mail nhac deadline.
- `JobsService` va `/api/jobs/worker/tick`: co pattern worker tick, nhung hien dang chuyen cho indexing/OCR.
- `env.ts`: da co pattern validate env bang Zod.
- `rate-limit.middleware.ts`: da co rate limit API chung.

### User va du lieu sinh vien

Model `User` dang co:

- `fullName`
- `email @unique`
- `passwordHash`
- `phone`
- `role`
- `studentCode @unique`
- `className`
- `faculty`
- `avatarUrl`
- `isActive`
- `lastLoginAt`
- timestamps

Email la bat buoc va unique vi field `email String @unique`. Chua thay `emailVerifiedAt`, `emailVerified`, token verify email, hay flow verify.

Role hien co:

- `student`
- `class_representative`
- `officer`
- `manager`
- `committee`
- `admin`

Du lieu ca nhan hoa mail hien du:

- Ho ten: `fullName`
- Ma sinh vien: `studentCode`
- Lop: `className`
- Khoa: `faculty`
- Nam hoc: `Application.schoolYear`
- Cap dang ky: `Application.targetLevel`
- Cap ket qua: `Application.finalLevel`

### Ho so va trang thai xet duyet

Model chinh:

- `Application`
- `ApplicationDraftSnapshot`
- `ApplicationMetric`
- `Evidence`
- `PrecheckResult`
- `CascadeReview`
- `ReviewTask`
- `ResolutionCase`

`ApplicationStatus` hien co:

- `not_started`
- `draft`
- `prechecked`
- `ready_to_submit`
- `submitted`
- `supplement_required`
- `under_review`
- `resolution_needed`
- `completed`
- `rejected`

Luu y: trong service submit hien set trang thai sang `under_review`, khong thay dung `submitted` nhu mot trang thai trung gian thuc te.

Trang thai can map voi mail:

- Ho so da nop: `ApplicationsService.submit()` chuyen sang `under_review`.
- Ho so thieu minh chung/tien kiem co missing: `PrecheckResult.missingItemsJson`, `Application.status = prechecked`.
- Can bo sung: `Application.status = supplement_required`, `ReviewTask.status = supplement_required`.
- Dang xet duyet: `Application.status = under_review`.
- Da duyet: `Application.status = completed`, `FinalStatus.passed`.
- Bi tu choi: `Application.status = rejected`, `FinalStatus.failed`.
- Dat cap thap hon: `FinalStatus.partially_passed` hoac `finalLevel` thap hon `targetLevel`.

Diem cap nhat trang thai quan trong:

- `ApplicationsService.submit()`
- `ApplicationsService.reopenSupplement()`
- `ReviewService.decideTask()`
- `ReviewService.requestSupplement()`
- `ResolutionService.resolveCase()`
- `ManagerService.aggregateApplication()`
- `ManagerService.finalizeApplication()`
- `ManagerService.reopenFinal()`

### Minh chung va yeu cau bo sung

Minh chung duoc luu theo `Evidence`:

- `applicationId`
- `criterion`
- `sourceType`
- `status`
- `indexingStatus`
- `confidence`
- `assignedOfficerId`

File minh chung:

- `File`
- `EvidenceFile`

Ket qua AI/OCR tien xu ly minh chung:

- `EvidenceCard.ocrText`
- `ocrLinesJson`
- `ocrParagraphsJson`
- `ocrTablesJson`
- `extractedFieldsJson`
- `normalizedFieldsJson`
- `warningsJson`
- `matchedEventId`
- `matchedKnowledgeItemIds`
- `confidence`
- `aiSummary`
- `rawAiResponse`
- `rawResponseJson`

Ket qua tien kiem ho so:

- `PrecheckResult.resultJson`
- `PrecheckResult.readinessScore`
- `PrecheckResult.missingItemsJson`
- `PrecheckResult.nextBestAction`

Yeu cau bo sung:

- `ReviewTask.supplementRequestJson`
- `ReviewTask.dueDate`
- `ReviewTask.status = supplement_required`
- `Evidence.status = needs_supplement`
- `Application.status = supplement_required`

Deadline bo sung hien duoc set trong `ReviewService.requestSupplement()` neu input co `deadline`.

### Audit log

Da co `AuditLog` va `AuditService`.

Audit hien ghi nhieu action:

- bat dau ho so
- autosave draft
- nop ho so
- tao/upload/xoa minh chung
- OCR/indexing job
- precheck completed
- review task created/assigned/decided
- supplement requested
- resolution case
- aggregate/finalize/reopen final result

Co the ghi them su kien gui email. Tuy nhien audit log khong nen dong vai tro queue hay source of truth cho delivery status.

Thong tin nen luu khi gui mail:

- `recipientUserId`
- `recipientEmail`
- `emailType` hoac `templateKey`
- `relatedApplicationId`
- `reviewTaskId`
- `resolutionCaseId`
- `notificationId`
- `status`: queued/sending/sent/failed/skipped
- `provider`
- `providerMessageId`
- `errorMessage`
- `attempts`
- `nextAttemptAt`
- `sentAt`
- `createdById`
- `systemGenerated`
- `idempotencyKey`

## B. Gap analysis

### Thieu de trien khai email module

- Chua co mail provider adapter that.
- Chua co SMTP/provider env config.
- Chua co email template renderer.
- Chua co database table de tracking delivery.
- Chua co retry policy cho email.
- Chua co idempotency/chong gui trung.
- Chua co worker/scheduler rieng cho email.
- Chua co admin API de xem/gui lai email that bai.
- Chua co email verification cho user.
- Chua co preference/unsubscribe cho cac loai mail khong bat buoc.

### Rui ro neu trien khai ngay bang cach gui truc tiep

- Request nop ho so/chot ket qua bi cham do phu thuoc SMTP/provider.
- Loi provider co the lam fail nghiep vu chinh.
- Retry HTTP co the gui trung email.
- Khong co bang delivery nen kho dieu tra email da gui/chua gui.
- Khong co retry/backoff nen email that bai bi mat.
- Mail co the lo thong tin nhay cam neu render truc tiep tu OCR/minh chung.
- Khong co verified email nen co the gui ket qua ho so den email nhap sai.

## C. De xuat kien truc

### Service/module can them

Khong tao notification module moi. De xuat mo rong theo cac thanh phan:

- `infrastructure/mail/mail.service.ts`: adapter gui mail.
- `modules/mail/email-template.service.ts`: render subject/html/text.
- `modules/mail/email-outbox.service.ts`: enqueue delivery co idempotency.
- `modules/mail/email-worker.service.ts`: xu ly queue gui mail va retry.
- `modules/mail/email.repository.ts`: truy van bang delivery.

Neu muon giu it module hon, co the dat `email-outbox.service.ts` trong `modules/notifications`, nhung khuyen nghi tach `mail` vi email la kenh delivery rieng.

### Database schema de xuat

```prisma
enum EmailDeliveryStatus {
  queued
  sending
  sent
  failed
  skipped
}

model EmailDelivery {
  id                String              @id @default(uuid()) @db.Uuid
  recipientUserId   String?             @db.Uuid
  recipientEmail    String
  templateKey       String
  subject           String
  status            EmailDeliveryStatus @default(queued)
  provider          String?
  providerMessageId String?
  applicationId     String?             @db.Uuid
  reviewTaskId      String?             @db.Uuid
  resolutionCaseId  String?             @db.Uuid
  notificationId    String?             @db.Uuid
  payloadJson       Json?
  idempotencyKey    String              @unique
  attempts          Int                 @default(0)
  maxAttempts       Int                 @default(3)
  nextAttemptAt     DateTime?
  errorMessage      String?
  sentAt            DateTime?
  createdById       String?             @db.Uuid
  systemGenerated   Boolean             @default(true)
  createdAt         DateTime            @default(now())
  updatedAt         DateTime            @updatedAt

  @@index([status, nextAttemptAt])
  @@index([recipientUserId])
  @@index([applicationId])
  @@index([templateKey])
}
```

Neu khong muon them enum moi, co the dung `String status`, nhung enum giup validation ro hon.

### Env/config de xuat

Them vao `.env.example` va `env.ts`:

```env
MAIL_PROVIDER=mock
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
MAIL_FROM_NAME=5TOT
MAIL_FROM_ADDRESS=no-reply@example.edu.vn
APP_BASE_URL=http://localhost:5173
MAIL_MAX_ATTEMPTS=3
MAIL_RETRY_BASE_SECONDS=60
MAIL_ENABLED=false
```

Provider ban dau:

- `mock`: test/dev, chi log va danh dau sent/skipped.
- `smtp`: production.

### Event trigger de xuat

| Event nghiep vu | Diem trigger | Template |
| --- | --- | --- |
| Nop ho so | `ApplicationsService.submit()` | `application_submitted` |
| Nop lai sau bo sung | `ApplicationsService.submit()` khi `isSupplementResubmit` | `application_resubmitted` |
| Can bo sung | `ReviewService.requestSupplement()` va decision `supplement_required` | `supplement_required` |
| Mo lai bo sung boi manager | `ApplicationsService.reopenSupplement()` | `supplement_required` |
| Resolution yeu cau bo sung | `ResolutionService.resolveCase()` | `supplement_required` hoac `resolution_updated` |
| Cap nhat review | `ReviewService.decideTask()` | `review_status_updated` |
| Chot ket qua | `ManagerService.finalizeApplication()` neu `notifyStudent=true` | `final_result_available` |
| Nhac deadline | Worker quet `ReviewTask.dueDate` | `supplement_deadline_reminder` |

### Email template de xuat

1. `application_submitted`
   - Subject: `[5TOT] Ho so da duoc nop`
   - Noi dung: xac nhan da nop, nam hoc, cap dang ky, link xem ho so.

2. `application_resubmitted`
   - Subject: `[5TOT] Ho so bo sung da duoc nop lai`
   - Noi dung: xac nhan he thong da nhan bo sung.

3. `supplement_required`
   - Subject: `[5TOT] Can bo sung minh chung`
   - Noi dung: tieu chi, deadline neu co, tom tat yeu cau, link vao he thong.

4. `supplement_deadline_reminder`
   - Subject: `[5TOT] Sap het han bo sung minh chung`
   - Noi dung: deadline, so ngay con lai, link bo sung.

5. `review_status_updated`
   - Subject: `[5TOT] Ho so co cap nhat xet duyet`
   - Noi dung: tieu chi va trang thai moi o muc tom tat.

6. `final_result_available`
   - Subject: `[5TOT] Ho so da co ket qua`
   - Noi dung: dat/chua dat/dat cap thap hon, final level neu co, link xem chi tiet.

## D. Luong gui mail de xuat

### 1. Xac nhan nop ho so

1. Sinh vien goi `POST /api/applications/:id/submit`.
2. `ApplicationsService.submit()` validate va update application sang `under_review`.
3. Tao review tasks va notification noi bo.
4. Enqueue `EmailDelivery` trong cung transaction:
   - `templateKey = application_submitted` hoac `application_resubmitted`
   - `recipientUserId = application.studentId`
   - `recipientEmail = application.student.email`
   - `applicationId = application.id`
   - `idempotencyKey = application_submitted:{applicationId}:{currentDraftVersion}`
5. Worker gui mail sau transaction.
6. Ghi audit `EMAIL_QUEUED`, sau khi gui thanh cong ghi `EMAIL_SENT`.

### 2. Nhac deadline

1. Worker chay dinh ky, quet `ReviewTask` co:
   - `status = supplement_required`
   - `dueDate` sap den han
   - application chua completed/rejected
2. Tao reminder theo cac moc, vi du T-3 ngay, T-1 ngay, qua han.
3. Dung idempotency:
   - `supplement_reminder:{reviewTaskId}:{dueDate}:{window}`
4. Gui mail voi link vao trang bo sung minh chung.
5. Khong dua chi tiet file/OCR vao email.

### 3. Yeu cau bo sung minh chung

1. Can bo goi `POST /api/review/tasks/:id/request-supplement` hoac submit decision `supplement_required`.
2. `ReviewService` update:
   - `ReviewTask.status = supplement_required`
   - `ReviewTask.supplementRequestJson`
   - `ReviewTask.dueDate`
   - `Application.status = supplement_required`
   - `Evidence.status = needs_supplement`
3. Tao notification noi bo.
4. Enqueue email `supplement_required`.
5. Payload mail chi nen gom:
   - ten sinh vien
   - tieu chi
   - deadline
   - yeu cau bo sung dang tom tat
   - link dang nhap/xem chi tiet

### 4. Cap nhat trang thai

1. Can bo quyet dinh task qua `ReviewService.decideTask()`.
2. Neu decision la accepted/rejected/resolution_needed, tao notification noi bo.
3. Enqueue email `review_status_updated` cho sinh vien neu policy bat.
4. Voi resolution, `ResolutionService.resolveCase()` co the enqueue `resolution_updated` hoac `supplement_required` tuy decision.
5. Can co chong spam: khong gui email cho moi thay doi nho neu khong can thiet; nen uu tien cac moc co tac dong den sinh vien.

### 5. Thong bao ket qua

1. Quan ly/hoi dong goi `POST /api/manager/applications/:id/finalize`.
2. `ManagerService.finalizeApplication()` update:
   - `Application.status = completed` hoac `rejected`
   - `finalStatus`
   - `finalLevel`
   - `finalNote`
   - `finalizedAt`
3. Neu `input.notifyStudent = true`, hien da tao notification `result_available`.
4. Enqueue email `final_result_available`.
5. Idempotency:
   - `final_result:{applicationId}:{finalizedAt}` hoac `final_result:{applicationId}:{finalStatus}:{finalLevel}:{updatedAt}`
6. Mail chi thong bao tom tat va link xem chi tiet.

## E. Checklist trien khai

### P0 - Nen tang

- Them env config cho mail vao `.env.example` va `src/config/env.ts`.
- Them dependency SMTP phu hop, vi du `nodemailer`.
- Implement `MailService.send()` voi provider `mock` va `smtp`.
- Them Prisma schema `EmailDelivery` va migration.
- Implement `EmailOutboxService.enqueue()` co idempotency.
- Implement `EmailTemplateService` cho subject/html/text.

### P1 - Trigger nghiep vu quan trong

- Gan enqueue mail vao `ApplicationsService.submit()`.
- Gan enqueue mail vao `ReviewService.requestSupplement()`.
- Gan enqueue mail vao `ManagerService.finalizeApplication()` khi `notifyStudent=true`.
- Ghi audit `EMAIL_QUEUED`.

### P2 - Worker va retry

- Implement `EmailWorkerService.runTick()`.
- Them route noi bo `POST /api/mail/worker/tick` hoac script `scripts/mail-worker-tick.ts`.
- Retry exponential backoff:
  - lan 1: sau 1 phut
  - lan 2: sau 5 phut
  - lan 3: sau 15 phut
- Luu `providerMessageId`, `sentAt`, `errorMessage`.
- Ghi audit `EMAIL_SENT` va `EMAIL_FAILED`.

### P3 - Nhac deadline va admin tooling

- Them worker quet deadline bo sung.
- Them idempotency cho reminder windows.
- Them API admin/manager de list email deliveries theo application/user/status.
- Them action retry delivery that bai.

### P4 - Bao mat va polish

- Khong dua OCR text, raw evidence, file URL private, thong tin nhay cam vao email.
- Tat mail trong dev/test mac dinh bang `MAIL_ENABLED=false`.
- Them redact password/SMTP secret trong logger neu can.
- Can nhac them `emailVerifiedAt` truoc khi gui email ket qua that.
- Them unit test cho template va idempotency.
- Them integration test cho submit/supplement/finalize tao delivery outbox.

## Ket luan

He thong hien da co du nguon du lieu, notification noi bo, audit log va cac diem trigger nghiep vu. Phan thieu chinh la delivery layer cho email: provider config, template, outbox table, worker retry va idempotency. Thiet ke phu hop nhat la mo rong `MailService` hien co va them `EmailDelivery` outbox, khong tao notification module moi thay the module `notifications` hien tai.
