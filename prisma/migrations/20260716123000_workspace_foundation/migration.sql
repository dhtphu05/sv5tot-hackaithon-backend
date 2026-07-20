CREATE TABLE "Workspace" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "shortName" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "registrationEnabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Workspace_code_key" ON "Workspace"("code");
CREATE INDEX "Workspace_isActive_registrationEnabled_idx"
ON "Workspace"("isActive", "registrationEnabled");

INSERT INTO "Workspace" ("code", "name", "shortName", "isActive", "registrationEnabled")
VALUES (
  'DHBK-DHDN',
  'Trường Đại học Bách khoa - Đại học Đà Nẵng',
  'DHBK',
  true,
  true
)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "shortName" = EXCLUDED."shortName",
  "isActive" = EXCLUDED."isActive",
  "registrationEnabled" = EXCLUDED."registrationEnabled",
  "updatedAt" = CURRENT_TIMESTAMP;

ALTER TABLE "User"
ADD COLUMN "workspaceId" UUID;

UPDATE "User"
SET "workspaceId" = (SELECT "id" FROM "Workspace" WHERE "code" = 'DHBK-DHDN')
WHERE "workspaceId" IS NULL
  AND "role" <> 'admin';

DROP INDEX IF EXISTS "User_studentCode_key";

CREATE UNIQUE INDEX "User_workspaceId_studentCode_key"
ON "User"("workspaceId", "studentCode");

CREATE INDEX "User_workspaceId_role_isActive_idx"
ON "User"("workspaceId", "role", "isActive");

ALTER TABLE "User"
ADD CONSTRAINT "User_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
