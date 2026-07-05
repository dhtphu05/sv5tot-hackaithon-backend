# Huong dan chay he thong SV5TOT cho BTC

Repo backend chua script cai dat. Repo frontend can clone cung thu muc cha voi repo backend.

## Cach sap xep thu muc

Tao mot thu muc cha, sau do clone 2 repo vao cung cap:

```text
sv5tot-demo/
  sv5tot-backend/
  namtot/
```

Vi du:

```bash
mkdir sv5tot-demo
cd sv5tot-demo
git clone <LINK_REPO_BACKEND> sv5tot-backend
git clone <LINK_REPO_FRONTEND> namtot
```

## Yeu cau

- Node.js 20 tro len.
- PostgreSQL local dang chay.
- Mac dinh script dung `postgres/postgres` va database `sv5tot`.

Neu PostgreSQL dung thong tin khac, sua `DATABASE_URL` trong `sv5tot-backend/.env` sau khi script tao file env.

## Cai dat mot lenh

Chay trong repo backend:

```bash
cd sv5tot-backend
bash scripts/install-btc.sh
```

Script se:

- cai `pnpm` neu may chua co;
- tao `.env` demo/local cho backend va frontend neu chua co;
- cai dependencies cho backend va frontend;
- chay Prisma generate/db push;
- seed du lieu demo.

Script khong ghi de file `.env` da co.

## Chay he thong

Mo 2 terminal rieng.

Terminal backend:

```bash
cd sv5tot-backend
pnpm dev
```

Terminal frontend:

```bash
cd namtot
pnpm dev
```

Mo frontend:

```text
http://localhost:5173
```

API docs:

```text
http://localhost:8080/api/docs
```

## Tai khoan demo

Mat khau mac dinh: `Password@123`

- `admin@dut.udn.vn`
- `manager@dut.udn.vn`
- `student@dut.udn.vn`
