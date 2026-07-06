# Deploy 5TOT Backend to Google Cloud Run

This runbook is for a 5-day demo/pilot deployment of the ExpressJS + TypeScript backend on Cloud Run.

## Assumptions

- Cloud Run region: `asia-southeast1`.
- Container runtime port: `8080`.
- PostgreSQL is Supabase; run Prisma migrations from a trusted machine or Cloud Build step before traffic cutover.
- Production uploads use Cloudflare R2 (`STORAGE_DRIVER=r2`). Do not use local `uploads/` on Cloud Run.
- Sensitive values go to Secret Manager. Non-sensitive values can use `cloudrun.env.yaml` created from `cloudrun.env.example.yaml`.

## 1. Local checks

```powershell
cd sv5tot-backend
npm ci
npm run build
npm run smoke:cloud-run
docker build -t 5tot-backend:local .
```

## 2. Login and select project

```powershell
$PROJECT_ID = "your-gcp-project-id"
$REGION = "asia-southeast1"
$REPO = "sv5tot"
$SERVICE = "sv5tot-backend"
$IMAGE = "$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/$SERVICE:demo"

gcloud auth login
gcloud config set project $PROJECT_ID
```

## 3. Enable required services

```powershell
gcloud services enable `
  run.googleapis.com `
  artifactregistry.googleapis.com `
  cloudbuild.googleapis.com `
  secretmanager.googleapis.com
```

## 4. Create Artifact Registry repository

```powershell
gcloud artifacts repositories create $REPO `
  --repository-format=docker `
  --location=$REGION `
  --description="5TOT backend container images"
```

If the repo already exists, keep using it.

## 5. Create Secret Manager secrets

Create each secret once:

```powershell
gcloud secrets create DATABASE_URL --replication-policy="automatic"
gcloud secrets create JWT_ACCESS_SECRET --replication-policy="automatic"
gcloud secrets create JWT_REFRESH_SECRET --replication-policy="automatic"
gcloud secrets create R2_ACCESS_KEY_ID --replication-policy="automatic"
gcloud secrets create R2_SECRET_ACCESS_KEY --replication-policy="automatic"
```

Add secret versions:

```powershell
"postgresql://USER:PASSWORD@HOST:5432/postgres?sslmode=require" | gcloud secrets versions add DATABASE_URL --data-file=-
"replace-with-long-random-access-secret" | gcloud secrets versions add JWT_ACCESS_SECRET --data-file=-
"replace-with-long-random-refresh-secret" | gcloud secrets versions add JWT_REFRESH_SECRET --data-file=-
"your-r2-access-key-id" | gcloud secrets versions add R2_ACCESS_KEY_ID --data-file=-
"your-r2-secret-access-key" | gcloud secrets versions add R2_SECRET_ACCESS_KEY --data-file=-
```

Optional real-provider secrets when not in mock mode:

```powershell
gcloud secrets create VNPT_ACCESS_TOKEN --replication-policy="automatic"
gcloud secrets create VNPT_TOKEN_ID --replication-policy="automatic"
gcloud secrets create VNPT_TOKEN_KEY --replication-policy="automatic"
gcloud secrets create SMARTBOT_ACCESS_TOKEN --replication-policy="automatic"
gcloud secrets create SMARTBOT_TOKEN_ID --replication-policy="automatic"
gcloud secrets create SMARTBOT_TOKEN_KEY --replication-policy="automatic"
gcloud secrets create SMARTBOT_WEBHOOK_TOKEN --replication-policy="automatic"
gcloud secrets create GEMINI_API_KEY --replication-policy="automatic"
```

## 6. Prepare non-secret env file

```powershell
Copy-Item cloudrun.env.example.yaml cloudrun.env.yaml
notepad cloudrun.env.yaml
```

Set at least:

- `CORS_ORIGIN` to the production frontend domain. Multiple domains are comma-separated.
- `R2_ENDPOINT` to `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
- `R2_BUCKET` to the R2 bucket name.
- `R2_REGION` to `auto`.
- `R2_PUBLIC_BASE_URL` only if the bucket has a public/custom domain; signed URLs work without it.

Do not put secrets in `cloudrun.env.yaml`.
Do not put `PORT` in `cloudrun.env.yaml`; Cloud Run reserves and injects it automatically.

## 7. Build image with Cloud Build

```powershell
gcloud builds submit --tag $IMAGE .
```

## 8. Deploy Cloud Run

```powershell
gcloud run deploy $SERVICE `
  --image $IMAGE `
  --region $REGION `
  --platform managed `
  --memory 1Gi `
  --cpu 1 `
  --min-instances 0 `
  --max-instances 2 `
  --timeout 300 `
  --concurrency 80 `
  --allow-unauthenticated `
  --env-vars-file cloudrun.env.yaml `
  --update-secrets DATABASE_URL=DATABASE_URL:latest,JWT_ACCESS_SECRET=JWT_ACCESS_SECRET:latest,JWT_REFRESH_SECRET=JWT_REFRESH_SECRET:latest,R2_ACCESS_KEY_ID=R2_ACCESS_KEY_ID:latest,R2_SECRET_ACCESS_KEY=R2_SECRET_ACCESS_KEY:latest
```

If the frontend is not public or API access should be restricted, remove `--allow-unauthenticated` and put API access behind an authenticated gateway.

To add optional provider secrets later:

```powershell
gcloud run services update $SERVICE `
  --region $REGION `
  --update-secrets VNPT_ACCESS_TOKEN=VNPT_ACCESS_TOKEN:latest,VNPT_TOKEN_ID=VNPT_TOKEN_ID:latest,VNPT_TOKEN_KEY=VNPT_TOKEN_KEY:latest,SMARTBOT_ACCESS_TOKEN=SMARTBOT_ACCESS_TOKEN:latest,SMARTBOT_TOKEN_ID=SMARTBOT_TOKEN_ID:latest,SMARTBOT_TOKEN_KEY=SMARTBOT_TOKEN_KEY:latest,SMARTBOT_WEBHOOK_TOKEN=SMARTBOT_WEBHOOK_TOKEN:latest,GEMINI_API_KEY=GEMINI_API_KEY:latest
```

## 9. Run production migrations

Run migrations against Supabase before routing real demo traffic:

```powershell
$env:DATABASE_URL = "postgresql://USER:PASSWORD@HOST:5432/postgres?sslmode=require"
npx prisma migrate deploy
```

Equivalent package script:

```powershell
npm run migrate:deploy
```

Do not use `prisma migrate dev` in production.

## 10. Smoke test deployed service

```powershell
$SERVICE_URL = gcloud run services describe $SERVICE --region $REGION --format="value(status.url)"
Invoke-RestMethod "$SERVICE_URL/health"
Invoke-RestMethod "$SERVICE_URL/api/version"
```

Expected:

- `/health` returns HTTP 200 with `status: ok`.
- `/api/version` returns the backend version and `environment: production`.
- Browser/frontend calls pass CORS only from domains configured in `CORS_ORIGIN`.

## Required deploy env vars

- `NODE_ENV=production`
- `DATABASE_URL` secret
- `JWT_ACCESS_SECRET` secret
- `JWT_REFRESH_SECRET` secret
- `CORS_ORIGIN`
- `STORAGE_DRIVER=r2`
- `R2_ENDPOINT`
- `R2_REGION=auto`
- `R2_BUCKET` or `R2_BUCKET_NAME`
- `R2_ACCESS_KEY_ID` secret
- `R2_SECRET_ACCESS_KEY` secret
- `MAX_FILE_SIZE_MB`

Optional depending on enabled features:

- VNPT real mode: `VNPT_ENABLED=true`, `VNPT_ACCESS_TOKEN`, `VNPT_TOKEN_ID`, `VNPT_TOKEN_KEY`.
- SmartBot real/live mode: `SMARTBOT_MODE=real|live`, `SMARTBOT_ACCESS_TOKEN`, `SMARTBOT_TOKEN_ID`, `SMARTBOT_TOKEN_KEY`, `SMARTBOT_WEBHOOK_TOKEN`.
- Gemini: `GEMINI_ENABLED=true`, `GEMINI_API_KEY`.
- SMTP mail: `MAIL_ENABLED=true`, `MAIL_PROVIDER=smtp`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`.

## Rollback

```powershell
gcloud run revisions list --service $SERVICE --region $REGION
gcloud run services update-traffic $SERVICE `
  --region $REGION `
  --to-revisions PREVIOUS_REVISION=100
```

Keep database migrations backward-compatible during the pilot so traffic can roll back to the previous image.
