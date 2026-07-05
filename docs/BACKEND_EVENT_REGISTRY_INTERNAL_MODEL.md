# Backend EventRegistry Internal Model

`EventRegistry`, `EventParticipant`, and `EventFile` remain the backend storage models for official activity lists and confirmed participant rosters.

Student-facing APIs should not describe this storage as an Event Hub. The product language is:

- Matching minh chứng chính thức
- Tìm trong danh sách đã xác nhận
- Đối chiếu theo tên hoạt động
- Đã tìm thấy trong danh sách chính thức
- Chưa tìm thấy trong danh sách chính thức

## Why Keep EventRegistry

The existing schema already stores the official activity record, organizer, criterion, official document metadata, roster indexing state, and confirmed participants. Keeping it avoids risky migrations and preserves officer review flows.

## API Boundary

External student-facing routes expose matching DTOs:

- `GET /api/evidence-matching/search`
- `GET /api/events/search`
- `POST /api/evidence-matching/:eventId/import`
- `POST /api/events/:id/import-as-evidence`

These APIs return `studentStatus`, `matchingStatus`, `readableSummary`, `missingFields`, and `warnings`.

## Frontend Responsibility

The frontend does not need to know about `EventRegistry` or `EventParticipant`. It should render official matching labels/actions from the DTOs and offer upload fallback when `official_match_not_found` is returned.

## Internal Responsibility

Backend services may still use EventRegistry internally for:

- roster imports
- participant lookup by MSSV
- duplicate event-import detection
- evidence creation from confirmed official lists
- officer/admin debug and audit flows
