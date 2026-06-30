# Minh chung, su kien va indexing job

## Minh chung ca nhan

| Method   | URL                                 | Request                                                     |
| -------- | ----------------------------------- | ----------------------------------------------------------- |
| `GET`    | `/api/applications/:id/evidences`   | Query `criterion?, status?, indexingStatus?, page?, limit?` |
| `POST`   | `/api/applications/:id/evidences`   | `{ evidenceName, criterion, sourceType?: "manual_upload" }` |
| `PATCH`  | `/api/evidences/:id`                | `{ evidenceName?, criterion? }`                             |
| `DELETE` | `/api/evidences/:id`                | -                                                           |
| `POST`   | `/api/evidences/:id/files`          | Multipart field `file`                                      |
| `POST`   | `/api/evidences/:id/start-indexing` | `{ force?, runMode?: "sync" \| "async" }`                   |
| `GET`    | `/api/evidences/:id/card`           | -                                                           |
| `GET`    | `/api/files/:id`                    | Metadata file                                               |

Flow upload:

```text
create evidence -> upload file -> start indexing -> poll job -> refetch evidence/card
```

Create:

```json
{
  "evidenceName": "Bang diem hoc ky",
  "criterion": "academic",
  "sourceType": "manual_upload"
}
```

Upload:

```ts
const form = new FormData();
form.append('file', file);
await api.post(`/api/evidences/${evidenceId}/files`, form);
```

`runMode=sync` huu ich cho local/test. UI production nen dung `async`, lay `job.id` tu
response va poll.

Evidence card do he thong doc tu dong chi la thong tin ho tro. UI phai giu thong diep
can can bo/hoi dong xac nhan, dac biet khi confidence thap hoac
`indexingStatus=needs_manual_review`.

## Job

| Method | URL                 | Role                   | Mo ta              |
| ------ | ------------------- | ---------------------- | ------------------ |
| `GET`  | `/api/jobs/:id`     | Owner/reviewer/manager | Lay trang thai job |
| `POST` | `/api/jobs/:id/run` | manager, admin         | Chay job thu cong  |

Polling:

```ts
const terminalJobStatuses = new Set(['completed', 'failed']);
```

Dung polling khi terminal, khi component unmount, hoac sau timeout UX. Neu failed,
hien loi tu job neu response co va cung cap retry indexing bang `force=true`.

## Event registry

| Method  | URL                                     | Role                            | Request                      |
| ------- | --------------------------------------- | ------------------------------- | ---------------------------- |
| `GET`   | `/api/events`                           | Tat ca role da login            | Filter event                 |
| `POST`  | `/api/events`                           | officer, manager, admin         | Tao event                    |
| `GET`   | `/api/events/:id`                       | Tat ca role da login            | Chi tiet                     |
| `PATCH` | `/api/events/:id`                       | officer, manager, admin         | Cap nhat                     |
| `POST`  | `/api/events/:id/roster-files`          | officer, manager, admin         | Multipart `file`             |
| `POST`  | `/api/events/:id/start-indexing`        | officer, manager, admin         | `{ eventFileId?, runMode? }` |
| `GET`   | `/api/events/:id/participants`          | officer/manager/committee/admin | Filter participants          |
| `POST`  | `/api/events/:id/confirm-index`         | officer/manager/admin           | Mapping cot                  |
| `POST`  | `/api/events/:id/check-participant`     | student/class rep               | `{ applicationId }`          |
| `POST`  | `/api/events/:id/import-to-application` | student/class rep               | `{ applicationId }`          |

List filters:

```ts
interface EventFilters {
  q?: string;
  criterion?: Criterion;
  organizerLevel?: Level;
  level?: Level;
  status?: 'draft' | 'active' | 'archived';
  page?: number;
  limit?: number;
}
```

Tao/cap nhat event:

```ts
interface EventInput {
  eventName: string;
  criterion: Criterion;
  organizer: string;
  organizerLevel: Level;
  startDate?: string;
  endDate?: string;
  convertedValue?: number | null;
  convertedUnit?: string;
  eligibleLevels?: Level[];
}
```

Confirm roster:

```json
{
  "eventFileId": "uuid-optional",
  "columnMapping": {
    "studentCode": "MSSV",
    "studentName": "Ho va ten",
    "className": "Lop",
    "faculty": "Khoa",
    "participationStatus": "Trang thai",
    "convertedValue": "So ngay"
  },
  "replaceExisting": true
}
```

`studentCode` la mapping bat buoc. Cac key con lai co the bo.
