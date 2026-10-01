#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_PARENT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -f "$SCRIPT_PARENT/package.json" ] && [ -d "$SCRIPT_PARENT/prisma" ]; then
  BACKEND_DIR="$SCRIPT_PARENT"
  ROOT_DIR="$(cd "$BACKEND_DIR/.." && pwd)"
  FRONTEND_DIR="$ROOT_DIR/namtot"
elif [ -d "$SCRIPT_PARENT/sv5tot-backend" ] && [ -d "$SCRIPT_PARENT/namtot" ]; then
  ROOT_DIR="$SCRIPT_PARENT"
  BACKEND_DIR="$ROOT_DIR/sv5tot-backend"
  FRONTEND_DIR="$ROOT_DIR/namtot"
else
  printf '\nLoi: Khong tim thay layout du an.\n' >&2
  printf 'Hay tao thu muc cha, clone backend va frontend cung cap:\n' >&2
  printf '  sv5tot-demo/\n' >&2
  printf '    sv5tot-backend/\n' >&2
  printf '    namtot/\n' >&2
  exit 1
fi

log() {
  printf '\n==> %s\n' "$1"
}

fail() {
  printf '\nLoi: %s\n' "$1" >&2
  exit 1
}

ensure_node() {
  command -v node >/dev/null 2>&1 || fail "Chua cai Node.js. Vui long cai Node.js 20+ roi chay lai."

  node -e '
    const major = Number(process.versions.node.split(".")[0]);
    if (major < 20) {
      process.exit(1);
    }
  ' || fail "Node.js hien tai qua cu. Vui long cai Node.js 20+ roi chay lai."
}

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    return
  fi

  log "Chua co pnpm, dang cai pnpm"
  if command -v corepack >/dev/null 2>&1; then
    corepack enable
    corepack prepare pnpm@latest --activate
  elif command -v npm >/dev/null 2>&1; then
    npm install --global pnpm
  else
    fail "Khong tim thay corepack hoac npm de cai pnpm."
  fi
}

ensure_backend_env() {
  if [ -f "$BACKEND_DIR/.env" ]; then
    log "Giu nguyen sv5tot-backend/.env dang co"
    return
  fi

  log "Tao sv5tot-backend/.env cho che do demo/local"
  cat > "$BACKEND_DIR/.env" <<'ENV'
NODE_ENV=development
PORT=8080
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sv5tot
DEFAULT_SCHOOL_YEAR=2026-2027

JWT_SECRET=dev_btc_change_me
JWT_EXPIRES_IN=15m
JWT_ACCESS_SECRET=dev_btc_access_change_me
JWT_REFRESH_SECRET=dev_btc_refresh_change_me
JWT_ACCESS_EXPIRES_IN=120m
JWT_REFRESH_EXPIRES_IN=30d
BCRYPT_SALT_ROUNDS=12
SEED_DEFAULT_PASSWORD=Password@123

CORS_ORIGIN=http://localhost:5173,http://localhost:3000
STORAGE_DRIVER=local
LOCAL_UPLOAD_DIR=uploads
UPLOAD_DIR=uploads
MAX_FILE_SIZE_MB=20

EVIDENCE_ANALYSIS_PROVIDER=openai
OPENAI_API_KEY=replace_with_openai_api_key
OPENAI_EVIDENCE_MODEL=gpt-6-luna
OPENAI_AWARD_ROSTER_MODEL=gpt-6-luna
OPENAI_DECISION_MODEL=gpt-6-luna
OPENAI_EVENT_ROSTER_MODEL=gpt-6-luna
OPENAI_ASSISTANT_MODEL=gpt-6-luna
OPENAI_STUDENT_ASSISTANT_MODEL=gpt-6-luna

JOB_WORKER_ENABLED=true
JOB_WORKER_INTERVAL_MS=5000
INTERNAL_WORKER_TOKEN=
SMARTBOT_MODE=mock
SMARTBOT_INPUT_CHANNEL=livechat
SMARTBOT_WEBHOOK_TOKEN=

LOG_LEVEL=info
ENV
}

ensure_frontend_env() {
  if [ ! -d "$FRONTEND_DIR" ]; then
    fail "Khong tim thay repo frontend tai $FRONTEND_DIR. Hay clone frontend cung thu muc cha voi backend."
  fi

  if [ -f "$FRONTEND_DIR/.env" ]; then
    log "Giu nguyen namtot/.env dang co"
    return
  fi

  log "Tao namtot/.env"
  printf 'VITE_API_BASE_URL=http://localhost:8080\n' > "$FRONTEND_DIR/.env"
}

install_dependencies() {
  log "Cai dependencies backend"
  (cd "$BACKEND_DIR" && pnpm install)

  log "Cai dependencies frontend"
  (cd "$FRONTEND_DIR" && pnpm install)
}

setup_database() {
  log "Kiem tra PostgreSQL"
  database_url="$(
    node -e 'const fs = require("fs"); const content = fs.readFileSync(process.argv[1], "utf8"); const line = content.split(/\r?\n/).find((item) => item.trim().startsWith("DATABASE_URL=")); let value = line ? line.slice(line.indexOf("=") + 1).trim() : ""; const first = value.charCodeAt(0); const last = value.charCodeAt(value.length - 1); if ((first === 34 && last === 34) || (first === 39 && last === 39)) value = value.slice(1, -1); process.stdout.write(value);' "$BACKEND_DIR/.env"
  )"
  [ -n "$database_url" ] || fail "Khong tim thay DATABASE_URL trong sv5tot-backend/.env."

  if ! command -v psql >/dev/null 2>&1; then
    printf 'Khong tim thay lenh psql. Neu PostgreSQL da chay, ban van co the bo qua canh bao nay.\n'
  elif ! psql "$database_url" -tAc "SELECT 1" >/dev/null 2>&1; then
    maintenance_url="$(
      node -e 'const databaseUrl = new URL(process.argv[1]); databaseUrl.pathname = "/postgres"; process.stdout.write(databaseUrl.toString());' "$database_url"
    )"
    database_name="$(
      node -e 'const databaseUrl = new URL(process.argv[1]); process.stdout.write(databaseUrl.pathname.replace(/^\//, ""));' "$database_url"
    )"
    create_database_sql="$(
      node -e 'const databaseName = process.argv[1].replace(/"/g, "\"\""); process.stdout.write("CREATE DATABASE \"" + databaseName + "\"");' "$database_name"
    )"

    if psql "$maintenance_url" -tAc "SELECT 1" >/dev/null 2>&1; then
      psql "$maintenance_url" -v ON_ERROR_STOP=1 -c "$create_database_sql" >/dev/null 2>&1 || true
    fi

    if ! psql "$database_url" -tAc "SELECT 1" >/dev/null 2>&1; then
      printf 'Khong ket noi duoc PostgreSQL theo DATABASE_URL hien tai.\n'
      printf 'DATABASE_URL=%s\n' "$database_url"
      printf 'Hay tao database %s hoac sua sv5tot-backend/.env roi chay lai script.\n' "$database_name"
    fi
  else
    printf 'PostgreSQL san sang theo DATABASE_URL trong sv5tot-backend/.env.\n'
  fi

  if command -v psql >/dev/null 2>&1 && ! psql "$database_url" -tAc "SELECT 1" >/dev/null 2>&1; then
    printf 'Hay tao database theo DATABASE_URL trong sv5tot-backend/.env roi chay lai script.\n'
    exit 1
  fi

  log "Dong bo schema Prisma va seed du lieu demo"
  (cd "$BACKEND_DIR" && pnpm prisma generate && pnpm prisma db push && pnpm seed)
}

print_next_steps() {
  cat <<TEXT

Hoan tat cai dat.

Mo 2 terminal rieng va chay:

  Terminal 1:
    cd "$BACKEND_DIR"
    pnpm dev

  Terminal 2:
    cd "$FRONTEND_DIR"
    pnpm dev

Sau do mo frontend tai URL Vite in ra, thuong la:
  http://localhost:5173

Tai khoan demo:
  admin@dut.udn.vn / Password@123
  manager@dut.udn.vn / Password@123
  student@dut.udn.vn / Password@123

API backend:
  http://localhost:8080/health
  http://localhost:8080/api/docs

Thay OPENAI_API_KEY trong sv5tot-backend/.env truoc khi su dung OCR hoac tro ly.
TEXT
}

main() {
  log "Bat dau cai dat SV5TOT cho BTC"
  [ -d "$BACKEND_DIR" ] || fail "Khong tim thay thu muc backend."
  [ -d "$FRONTEND_DIR" ] || fail "Khong tim thay thu muc frontend: $FRONTEND_DIR"

  ensure_node
  ensure_pnpm
  ensure_backend_env
  ensure_frontend_env
  install_dependencies
  setup_database
  print_next_steps
}

main "$@"
