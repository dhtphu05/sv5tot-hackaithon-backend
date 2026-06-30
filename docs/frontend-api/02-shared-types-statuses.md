# Kieu du lieu va trang thai dung chung

Frontend phai gui gia tri enum dung lowercase nhu bang duoi.

## Core enums

```ts
type Criterion =
  'ethics' | 'academic' | 'physical' | 'volunteer' | 'integration' | 'priority' | 'collective';

type Level = 'school' | 'university' | 'city' | 'central';

type FinalStatus = 'pending' | 'passed' | 'failed' | 'partially_passed';
```

## Application

```ts
type ApplicationStatus =
  | 'not_started'
  | 'draft'
  | 'prechecked'
  | 'ready_to_submit'
  | 'submitted'
  | 'supplement_required'
  | 'under_review'
  | 'resolution_needed'
  | 'completed'
  | 'rejected';
```

Flow UI:

```text
not_started -> draft -> prechecked/ready_to_submit -> under_review
under_review -> supplement_required -> under_review
under_review -> resolution_needed -> under_review
under_review -> completed/rejected
```

Backend submit hien chuyen truc tiep sang `under_review`; frontend khong nen cho rang
`submitted` luon la state trung gian bat buoc.

## Evidence va indexing

```ts
type EvidenceSourceType = 'metric_input' | 'event_import' | 'manual_upload' | 'collective_import';

type IndexingStatus =
  | 'not_started'
  | 'uploaded'
  | 'pending_indexing'
  | 'ocr_processing'
  | 'extracting'
  | 'checking_registry'
  | 'indexed'
  | 'failed'
  | 'needs_manual_review';

type EvidenceStatus =
  | 'draft'
  | 'pending_indexing'
  | 'indexed'
  | 'needs_supplement'
  | 'under_review'
  | 'accepted'
  | 'rejected'
  | 'resolution_needed';

type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';
```

Dung `job.status` de polling tac vu nen, va `evidence.indexingStatus` de render trang thai
minh chung. Dung polling 1.5-3 giay, dung khi `completed` hoac `failed`.

## Review

```ts
type ReviewTaskStatus =
  'waiting' | 'reviewing' | 'supplement_required' | 'accepted' | 'rejected' | 'resolution_needed';

type ReviewDecision = 'accepted' | 'rejected' | 'supplement_required' | 'resolution_needed';

type ResolutionStatus = 'open' | 'in_review' | 'resolved' | 'rejected';

type KnowledgeDecision = 'accepted' | 'rejected' | 'needs_supplement' | 'reference_only';
```

## Metric va event

```ts
type MetricType =
  'gpa' | 'conduct_score' | 'physical_score' | 'volunteer_days' | 'foreign_language_score';

type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected';
type EventStatus = 'draft' | 'active' | 'archived';
```

Metric constraints:

- `gpa`: scale `4` thi value `0..4`; scale `10` thi value `0..10`.
- `conduct_score`: `0..100`.
- `physical_score`: `0..10`.
- `volunteer_days`, `foreign_language_score`: khong am.

## Collective

```ts
type CollectiveStatus =
  | 'draft'
  | 'prechecked'
  | 'ready_to_submit'
  | 'submitted'
  | 'supplement_required'
  | 'under_review'
  | 'resolution_needed'
  | 'completed'
  | 'rejected';
```

UI nen dung cac gia tri normalize sau cho roster:

- `participationStatus`: `participated`, `not_participated`, `unknown`.
- `violationStatus`: `none`, `violated`, `unknown`.
- `individualSv5tLevel`: `none`, `school`, `university`, `city`, `central`, `unknown`.

Backend nhan string cho ba field roster, nhung cac gia tri tren la contract frontend
khuyen dung de summary va precheck nhat quan.

## Trang thai edit

- Application edit: `draft`, `prechecked`, `ready_to_submit`, `supplement_required`
  (co the bi gioi han theo allowed criteria khi bo sung).
- Collective edit: `draft`, `prechecked`, `ready_to_submit`, `supplement_required`.
- `completed` va `rejected`: read-only.
- Sau moi command thay doi state, frontend phai invalidate/refetch detail thay vi tu
  noi state o client.
