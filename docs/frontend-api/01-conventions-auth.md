# Quy uoc API va xac thuc

## Base URL

```env
VITE_API_BASE_URL=http://localhost:8080
```

Moi URL trong docs la path tinh tu base URL. Swagger UI o `/api/docs`.

## Headers

JSON request:

```http
Content-Type: application/json
Authorization: Bearer <accessToken>
```

Upload:

```http
Authorization: Bearer <accessToken>
Content-Type: multipart/form-data; boundary=...
```

Khong tu set `Content-Type` khi dung `FormData`; browser phai tu gan boundary.

## Response envelope

Success:

```ts
export interface ApiResponse<T> {
  success: true;
  data: T;
  error: null;
  meta: {
    requestId?: string;
    pagination?: Pagination;
    [key: string]: unknown;
  };
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
```

Error:

```ts
export interface ApiFailure {
  success: false;
  data: null;
  error: {
    code: string;
    message: string;
    details?: unknown;
    stack?: string; // chi co the co o non-production
  };
  meta: { requestId?: string };
}
```

Collection nam trong `data`, pagination nam trong `meta.pagination`.

## Auth endpoints

| Method  | URL                 | Auth                      | Body                                |
| ------- | ------------------- | ------------------------- | ----------------------------------- |
| `POST`  | `/api/auth/login`   | Public                    | `{ email, password }`               |
| `POST`  | `/api/auth/refresh` | Public                    | `{ refreshToken }`                  |
| `POST`  | `/api/auth/logout`  | Bearer                    | `{ refreshToken? }`                 |
| `GET`   | `/api/me`           | Bearer                    | -                                   |
| `PATCH` | `/api/me`           | Bearer                    | `{ fullName?, phone?, avatarUrl? }` |
| `GET`   | `/api/users`        | manager, committee, admin | Query filter                        |

Login:

```json
{
  "email": "student@dut.udn.vn",
  "password": "Password@123"
}
```

`data` cua login:

```ts
interface LoginData {
  user: SafeUser;
  accessToken: string;
  refreshToken: string;
}
```

Refresh token duoc rotate. Sau khi refresh thanh cong, frontend phai thay ca access
token va refresh token cu. Khong tiep tuc su dung refresh token cu.

Logout khong truyen refresh token se revoke tat ca refresh token cua user hien tai.

## Safe user

```ts
type Role = 'student' | 'class_representative' | 'officer' | 'manager' | 'committee' | 'admin';

interface SafeUser {
  id: string;
  email: string;
  role: Role;
  fullName: string;
  studentCode: string | null;
  className: string | null;
  faculty: string | null;
  phone: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

## Refresh strategy

1. Request nhan `401`.
2. Neu request do chinh la login/refresh thi khong retry.
3. Chi mot refresh request duoc chay; cac request khac doi cung promise.
4. Luu token moi.
5. Retry request ban dau dung mot lan.
6. Neu refresh that bai, xoa session va redirect login.

Khong refresh khi nhan `403`: user da xac thuc nhung khong co quyen.

## HTTP va error handling

- `400`: payload/query sai, file sai hoac state nghiep vu khong hop le.
- `401`: thieu/sai/het han token.
- `403`: sai role, user inactive hoac khong so huu resource.
- `404`: resource khong ton tai.
- `409`: trung resource hoac state conflict.
- `429`: rate limited.
- `500`: loi server.
- `501 NOT_IMPLEMENTED`: route placeholder, khong dua vao flow production.

Validation error co `error.code = "VALIDATION_ERROR"` va `error.details` theo Zod.
Frontend nen map field error neu co, fallback sang `error.message`.

## Pagination va query

- Mac dinh: `page=1`, `limit=20`.
- `limit` toi da `100`.
- Khong gui query rong (`q=`), vi nhieu schema yeu cau chuoi toi thieu mot ky tu.
- Date-time gui ISO 8601, vi du `2026-07-01T08:00:00.000Z`.
- School year dung `YYYY-YYYY`, vi du `2025-2026`.

## Upload

Field file bat buoc co ten `file`. MIME duoc phep:

- `image/jpeg`, `image/png`, `image/webp`
- `application/pdf`
- XLSX, XLS
- `text/csv`

Kich thuoc mac dinh toi da lay tu `MAX_FILE_SIZE_MB` (mau env la 20 MB).

## Public utility

| Method | URL            | Mo ta                               |
| ------ | -------------- | ----------------------------------- |
| `GET`  | `/health`      | Health check                        |
| `GET`  | `/api/version` | Ten, version va environment cua API |
| `GET`  | `/api/docs`    | Swagger UI                          |
