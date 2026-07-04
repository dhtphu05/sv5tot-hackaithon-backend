# Backend Evidence Reader

## 1. SmartReader Role

SmartReader is read-only in the evidence upload flow. It uploads the file to VNPT, runs OCR/table extraction, normalizes text, and helps build an Evidence Card. It does not decide pass/fail and does not replace officer review.

## 2. No Confidence Or AI Judging For Students

Student and class representative APIs must not expose:

- `confidence`
- `confidencePercent`
- `validityScore`
- `aiSuggestion`
- raw VNPT response
- AI judging copy

Internal confidence can remain stored for routing and officer/admin debug as `internalConfidence`.

## 3. Evidence Card Student Response

`GET /api/evidences/:id/card` returns:

- `evidence.studentStatus`
- `card.readableSummary`
- `card.matchingStatus`
- `card.missingFields`
- `card.studentStatus`
- `card.warnings`
- optional `card.ocrTextPreview`
- `auditSummary`

Raw OCR provider payloads and internal confidence are not included for students.

## 4. Readable Summary

The backend derives `readableSummary` from extracted/normalized OCR fields:

- studentName
- studentCode
- className
- faculty
- documentType
- eventName
- organizer
- organizerLevel
- issueDate
- activityDate
- volunteerDays
- certificateType
- languageScore
- gpa
- conductScore

## 5. Missing Fields

Missing fields are detected by criterion. Example: volunteer evidence requires event name, organizer, date, and volunteer days or a clear participation signal. Missing fields are returned as field/label/message objects.

## 6. Student Status

Student-facing status uses `EvidenceStudentStatus`:

- `official_match_found`
- `official_match_not_found`
- `similar_name_found`
- `evidence_read`
- `needs_more_info`
- `needs_human_verification`
- `unreadable_file`
- `recorded_waiting_review`

Statuses tell the student what happened and what to do next without exposing scores.

## 7. Official Matching By Name

Manual-upload evidence matching uses extracted event name or evidence name, normalized by lowercasing, removing Vietnamese accents, removing punctuation, and token overlap. Matching checks `EventRegistry` and `EventParticipant` internally, but student DTOs call this official matching, not Event Hub.

## 8. Audit Actions

Evidence reader flow audits:

- `EVIDENCE_CREATED`
- `FILE_UPLOADED`
- `OCR_JOB_CREATED`
- `SMARTREADER_FILE_UPLOAD_STARTED`
- `SMARTREADER_FILE_UPLOADED`
- `SMARTREADER_EVIDENCE_READ`
- `EVIDENCE_MISSING_INFO_DETECTED`
- `EVIDENCE_SENT_TO_HUMAN_VERIFICATION`
- `OFFICIAL_MATCH_FOUND`
- `OFFICIAL_MATCH_NOT_FOUND`
- `EVIDENCE_CARD_GENERATED`
- `SMARTREADER_OCR_FAILED`

Audit metadata should stay compact: evidence/application/file IDs, criterion, source type, status codes, matching status, missing/warning counts, matched IDs, and provider.

## 9. Error Handling

- VNPT upload failure: return a safe user message that the file could not be sent to the digitization service.
- VNPT OCR failure: tell the student the system could not read the file and they can upload a clearer file or wait for officer verification.
- Empty OCR text: mark as `unreadable_file`.
- Never expose tokens, auth headers, raw stacks, or raw provider payloads to clients.

## 10. Manual API Test

1. Login as student.
2. `POST /api/applications/:id/evidences` with `source_type=manual_upload`.
3. `POST /api/evidences/:id/files` with JPEG/PNG/PDF.
4. `POST /api/jobs/worker/tick`.
5. `GET /api/evidences/:id/card`.
6. Verify `readableSummary`, `missingFields`, `studentStatus`, `warnings`, and no student-facing confidence/raw response fields.
