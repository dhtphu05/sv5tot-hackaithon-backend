-- Preserve existing roles and workspaces while adding the City hierarchy.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'data_uploader';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'city_officer';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'city_manager';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'city_committee';

CREATE TYPE "WorkspaceType" AS ENUM ('CITY', 'UNIVERSITY_SYSTEM', 'SCHOOL');

ALTER TABLE "Workspace"
  ADD COLUMN "type" "WorkspaceType" NOT NULL DEFAULT 'SCHOOL',
  ADD COLUMN "parentWorkspaceId" UUID;

CREATE INDEX "Workspace_type_isActive_idx" ON "Workspace"("type", "isActive");
CREATE INDEX "Workspace_parentWorkspaceId_idx" ON "Workspace"("parentWorkspaceId");

ALTER TABLE "Workspace"
  ADD CONSTRAINT "Workspace_parentWorkspaceId_fkey"
  FOREIGN KEY ("parentWorkspaceId") REFERENCES "Workspace"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
