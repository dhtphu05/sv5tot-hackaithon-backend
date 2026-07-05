# Backend Official Matching Policy

## 1. Why Official Matching Replaces Event Hub Wording

Student-facing APIs should describe the workflow as "Matching minh chứng chính thức" or "đối chiếu danh sách đã xác nhận". Students do not need to understand the internal event registry model or any Event Hub concept. The product question is simply whether the student is present in an official confirmed list for an activity.

## 2. Student APIs Do Not Show Confidence

Student and class representative responses must not expose `confidence`, `confidencePercent`, `validityScore`, or AI-style judging fields. Confidence may remain in the database for internal routing and privileged debug/review workflows.

Privileged officer/manager/committee/admin responses may expose technical confidence as `internalConfidence` where needed.

## 3. SmartReader Is Read-Only

SmartReader reads uploaded files and extracts useful fields into:

- `readableSummary`
- `missingFields`
- `warnings`
- `studentStatus`

SmartReader does not decide whether the evidence is valid, does not say the student passes, and does not make final eligibility conclusions. Cán bộ/Hội đồng remains the final reviewer.

## 4. Matching by Activity Name and MSSV

Official matching uses:

- authenticated `req.user.studentCode` for student/class representative users
- optional `studentCode` only for officer/manager/admin workflows
- activity name normalization
- criterion
- organizer
- official document number
- confirmed participants in `EventParticipant`

If an activity is found but the student is not in the official list, the API returns `official_match_not_found`. This is not a rejection; the student can still upload evidence for human verification.

## 5. Status DTO

Student-facing status uses `EvidenceStudentStatus`:

- `official_match_found`
- `official_match_not_found`
- `similar_name_found`
- `evidence_read`
- `needs_more_info`
- `needs_human_verification`
- `unreadable_file`
- `recorded_waiting_review`

Each status includes a label, message, next action, severity, and source.

## 6. Import-As-Evidence Contract

Supported routes:

- `POST /api/events/:id/import-as-evidence`
- `POST /api/events/:id/import-to-application`
- `POST /api/evidence-matching/:eventId/import`

Import requires:

- application ownership for students
- application editability
- participant belongs to the event
- participant studentCode equals the target studentCode
- participant is confirmed
- duplicate application + event import is prevented

Import creates evidence/card immediately from official matching data and does not enqueue OCR.

## 7. EvidenceCard Student Response

`GET /api/evidences/:id/card` returns student-facing fields:

- `evidence.studentStatus`
- `card.readableSummary`
- `card.matchingStatus`
- `card.missingFields`
- `card.studentStatus`
- `card.warnings`
- optional short `ocrTextPreview`
- `auditSummary`

Student responses do not include raw OCR provider payloads, raw normalized fields, AI summaries, or confidence.

## 8. Officer/Admin Debug Difference

Privileged roles can receive technical fields for review/debug:

- `internalConfidence`
- full OCR text/lines/paragraphs/tables
- extracted/normalized fields
- source endpoint
- SmartReader job id
- raw redacted provider response when stored

These fields are technical review data, not student-facing product copy.

## 9. Audit Policy

Audit metadata should include compact operational fields:

- `studentCode`
- `criterion`
- `query`
- `eventId`
- `participantId`
- `evidenceId`
- `sourceType`
- `statusCode`
- `missingFieldCount`
- `warningCount`

Do not audit full raw OCR text, raw VNPT response, tokens, auth headers, or student-facing confidence percentages.

## 10. Backward Compatibility

Existing frontend paths remain available. The old event route `/api/events/search` now returns matching semantics and is equivalent to `/api/evidence-matching/search`. Existing review/rule flows can continue using stored confidence internally.
