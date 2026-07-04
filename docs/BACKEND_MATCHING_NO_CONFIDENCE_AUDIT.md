# Backend Matching No Confidence Audit

## Scope

This audit covers the current backend surfaces that expose evidence cards, event registry imports, OCR output, warnings, audit logs, and student search. The migration goal is to keep `EventRegistry` as internal storage while changing student-facing contracts to "Matching minh chứng chính thức" and removing confidence-style judging from student responses.

## 1. Student APIs Currently Returning Confidence

- `GET /api/evidences/:id/card`
  - Implemented by `EvidencesService.getCard`.
  - Returns `evidence.confidence`, `card.confidence`, `normalizedFieldsJson`, `sourceEndpoint`, and `aiSummary` to every allowed role. Raw provider responses are hidden from students, but confidence remains visible.
- `GET /api/applications/:applicationId/evidences`
  - Implemented by `EvidencesService.list` and `toEvidenceDto`.
  - Returns `confidence` on evidence and nested card warnings/confidence.
- `GET /api/evidences/:id`
  - Uses the same `toEvidenceDto` and returns confidence to students.
- `POST /api/events/:id/import-as-evidence`
  - Delegates to `decision-imports.service.importEventAsEvidence`.
  - Creates evidence/card with `confidence: 0.96` and returns the raw Prisma evidence object for new imports.
- `POST /api/events/:id/import-to-application`
  - Creates event-import evidence and card with a computed confidence and returns `formatEvidenceDto`, which includes evidence/card confidence.
- OCR worker output
  - `processEvidenceOcrJob` persists confidence in `Evidence` and `EvidenceCard`, returns confidence in job result metadata, and uses confidence for internal indexing/review routing.
- Precheck/review internals
  - Rule and review services read confidence for readiness/review routing. These are internal/officer-facing flows and should not be broken by student DTO changes.

## 2. Event Hub Wording in Response/Docs/Copy

- No exact `Event Hub` or `event hub` string was found in backend source.
- Current student-facing copy still says `Event Registry`, `sự kiện`, and `AI confidence` in places:
  - Event import card warnings mention `Event Registry`.
  - OCR card summary says the card was created with `confidence`.
  - Review summary includes `AI confidence thấp`.
  - Existing docs describe `/api/events/search` and `/api/events/:id/import-as-evidence` as event registry/event import flows.

## 3. Models Using EventRegistry/EventParticipant

- Prisma models:
  - `EventRegistry`
  - `EventParticipant`
  - `EventFile`
  - `Evidence.eventId`
  - `EvidenceCard.matchedEventId`
  - `EvidenceCard.matchedParticipantId`
- Backend modules:
  - `src/modules/event-registry/*`
  - `src/modules/decision-imports/decision-imports.service.ts`
  - `src/modules/evidences/evidence-registry-matcher.ts`
  - `src/modules/jobs/processors/event-roster-indexing.processor.ts`
  - `src/modules/jobs/processors/evidence-ocr.processor.ts`
  - review/rules services read event-import evidence during review.

## 4. Current Student Search API

- `GET /api/events/search`
  - Requires auth and allows student/class representative/officer/manager/committee/admin.
  - For student/class representative, it uses `req.user.studentCode` and rejects a different `studentCode`.
  - Current query filters require `participants.some({ studentCode })`, so events without the student are excluded rather than returned as official-match-not-found.
  - Response is currently an array of event DTOs plus participant and alreadyImported metadata, not a matching envelope.
- `POST /api/events/:id/import-as-evidence`
  - Existing route accepts `applicationId`, optional `participantId`, `evidenceName`, `note`.
  - Student ownership and participant studentCode checks already exist.
- `POST /api/events/:id/import-to-application`
  - Older compatibility route creates evidence/card directly and returns event/participant/evidence.

## 5. EvidenceCard Current Fields

`GET /api/evidences/:id/card` currently returns:

- `evidence`
  - id, applicationId, evidenceName, criterion, sourceType, status, indexingStatus, confidence, uxStatus, timestamps, files, nested card confidence/warnings.
- `card`
  - id, ocrText, ocrLinesJson, ocrParagraphsJson, ocrTablesJson, extractedFieldsJson, normalizedFieldsJson, warningsJson, matchedEventId, matchedParticipantId, matchedKnowledgeItemIds, confidence, sourceEndpoint, smartreaderJobId, aiSummary, rawAiResponse/rawResponseJson for privileged roles, timestamps.
- `job`
  - latest OCR job state and resultJson.
- `uxStatus`, `auditSummary`.

## 6. Current Warnings

- OCR confidence scorer emits uppercase technical codes such as `MISSING_STUDENT_INFO`, `MISSING_EVENT_NAME`, `MISSING_DATE`, `MISSING_ORGANIZER`, `LOW_CONFIDENCE`.
- Registry matcher emits string warning `not_matched_registry`.
- Event import warnings use event-specific technical codes such as `EVENT_REGISTRY_IMPORT_REQUIRES_REVIEW`, `EVENT_MISSING_DATE`, `EVENT_MISSING_CONVERTED_VALUE`.
- Current warning messages include confidence and Event Registry wording in some flows.

## 7. Current Audit Actions

Relevant existing actions include:

- `EVIDENCE_CREATED`
- `FILE_UPLOADED`
- `OCR_JOB_CREATED`
- `SMARTREADER_OCR_STARTED`
- `SMARTREADER_OCR_COMPLETED`
- `SMARTREADER_OCR_FAILED`
- `EVIDENCE_CARD_GENERATED`
- `EVIDENCE_NEEDS_MANUAL_REVIEW`
- `EVENT_PARTICIPANT_CHECKED`
- `EVENT_EVIDENCE_IMPORTED_BY_STUDENT`
- `EVENT_IMPORT_EVIDENCE_CREATED`
- `EVENT_IMPORT_EVIDENCE_CARD_CREATED`

Audit storage supports metadata, evidenceId, eventId, requestId, IP, and user agent. The OCR pipeline redacts SmartReader secrets before logging.

## 8. Backward Compatibility Needed For Current FE

- Keep existing paths:
  - `GET /api/events/search`
  - `POST /api/events/:id/import-as-evidence`
  - `POST /api/events/:id/import-to-application`
  - `GET /api/evidences/:id/card`
  - `GET /api/applications/:applicationId/evidences`
  - `GET /api/evidences/:id`
- Keep internal DB fields and confidence persistence for routing/debug/review.
- Add `studentStatus`, `matchingStatus`, `readableSummary`, and `missingFields` without requiring immediate FE migration.
- Hide confidence by default only for student/class representative responses.
- Allow privileged roles to keep technical confidence/debug data.

## 9. Migration Plan

1. Add shared backend DTO/mappers for `EvidenceStudentStatus`, warning labels, readable summaries, and missing fields.
2. Refactor `/api/events/search` semantics to official matching and add `/api/evidence-matching/search` alias.
3. Refactor import-as-evidence to produce official matching card fields, clear student status, no OCR job, and sanitized response.
4. Refactor `EvidencesService` response shaping so students do not receive confidence, raw AI-style summaries, raw normalized fields, or confidence-oriented wording.
5. Keep stored confidence and review/rule behavior unchanged for officer/admin workflows.
6. Update docs to clarify EventRegistry is internal storage.
7. Add focused unit tests for DTO shaping and matching service behavior; run Prisma/build/tests.

## 10. Do Not Change To Avoid Breaking Review Flow

- Do not drop or rename `EventRegistry`, `EventParticipant`, `Evidence.confidence`, or `EvidenceCard.confidence`.
- Do not remove OCR confidence scoring from internal routing.
- Do not change review task state machine, rule evaluator thresholds, or application ownership checks.
- Do not enqueue OCR for event-import evidence.
- Do not log raw OCR text, raw VNPT response, auth headers, or tokens in audit metadata.
- Do not let students supply arbitrary `studentCode` for matching/import.
