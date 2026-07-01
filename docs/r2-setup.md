# Cloudflare R2 Storage Setup Guide

This guide describes how to configure and verify Cloudflare R2 storage integration in the 5TOT backend.

## Environment Configurations

Add the following variables to your [`.env`](file:///d:/02_PROJECTS/5TOT/sv5tot-hackaithon-backend/.env) file:

```env
# Switch storage driver to r2
STORAGE_DRIVER=r2

# Max file size allowed for upload in megabytes
MAX_FILE_SIZE_MB=20

# Cloudflare R2 Configurations
R2_BUCKET_NAME=your-bucket-name
R2_ACCOUNT_ID=your-cloudflare-account-id
R2_ACCESS_KEY_ID=your-r2-api-access-key-id
R2_SECRET_ACCESS_KEY=your-r2-api-secret-access-key

# R2 Endpoint URL: https://<account_id>.r2.cloudflarestorage.com
R2_ENDPOINT=https://your-cloudflare-account-id.r2.cloudflarestorage.com
```

> [!NOTE]
> The bucket must remain **private**. Do not configure a public custom domain or make the bucket public. Access will be routed securely using short-lived signed URLs generated dynamically by the backend.

---

## How to Test

### 1. Run build and start backend
Ensure you run and compile the backend to verify the schema validations:
```bash
pnpm run build
pnpm run dev
```
If any required R2 variable is missing when `STORAGE_DRIVER=r2`, the server will fail to start and throw a validation schema error.

### 2. Uploading Evidence Files
- Access the frontend dashboard and navigate to the evidence upload section.
- Upload a file (`image/jpeg`, `image/png`, or `application/pdf`).
- Verify the uploaded file details in the database:
  - Check the `File` table: `storageType` should be `'r2'`, `filePath` should be in the format: `evidence/{schoolYear}/{applicationId}/{evidenceId}/{timestamp}-{safeOriginalName}`.

### 3. Retrieving Files
- Query the API for the signed read URL:
  `GET /api/files/:id/signed-url`
- Use the returned presigned URL to view the file in the browser. The link will expire automatically after 5 minutes.
