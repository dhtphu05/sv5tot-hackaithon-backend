-- Add workspace anchors to tenant-owned roots without resetting data.
-- Existing rows are backfilled from their owner/parent where possible, then
-- from the default DHBK-DHDN workspace as a final fallback.

SET statement_timeout = '10min';

DO $$
DECLARE
  default_workspace_id uuid;
BEGIN
  SELECT id INTO default_workspace_id FROM "Workspace" WHERE code = 'DHBK-DHDN';

  IF default_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Default workspace DHBK-DHDN is required before workspace tenant anchor migration';
  END IF;

  ALTER TABLE "Application" ADD COLUMN IF NOT EXISTS "workspaceId" uuid;
  ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "workspaceId" uuid;
  ALTER TABLE "EventRegistry" ADD COLUMN IF NOT EXISTS "workspaceId" uuid;
  ALTER TABLE "DecisionImport" ADD COLUMN IF NOT EXISTS "workspaceId" uuid;
  ALTER TABLE "KnowledgeBaseItem" ADD COLUMN IF NOT EXISTS "workspaceId" uuid;
  ALTER TABLE "CriteriaVersion" ADD COLUMN IF NOT EXISTS "workspaceId" uuid;
  ALTER TABLE "ReviewTask" ADD COLUMN IF NOT EXISTS "workspaceId" uuid;
  ALTER TABLE "ResolutionCase" ADD COLUMN IF NOT EXISTS "workspaceId" uuid;
  ALTER TABLE "IndexingJob" ADD COLUMN IF NOT EXISTS "workspaceId" uuid;
  ALTER TABLE "smartreader_jobs" ADD COLUMN IF NOT EXISTS "workspace_id" uuid;
  ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "workspaceId" uuid;
  ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "workspaceId" uuid;
  ALTER TABLE "CollectiveProfile" ADD COLUMN IF NOT EXISTS "workspaceId" uuid;
  ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "workspaceId" uuid;
  ALTER TABLE "chatbot_actions" ADD COLUMN IF NOT EXISTS "workspaceId" uuid;
  ALTER TABLE "chatbot_handoffs" ADD COLUMN IF NOT EXISTS "workspaceId" uuid;

  UPDATE "Application" a
  SET "workspaceId" = COALESCE(u."workspaceId", default_workspace_id)
  FROM "User" u
  WHERE a."studentId" = u.id AND a."workspaceId" IS NULL;

  UPDATE "CollectiveProfile" cp
  SET "workspaceId" = COALESCE(u."workspaceId", default_workspace_id)
  FROM "User" u
  WHERE cp."representativeId" = u.id AND cp."workspaceId" IS NULL;

  UPDATE "DecisionImport" di
  SET "workspaceId" = COALESCE(u."workspaceId", default_workspace_id)
  FROM "User" u
  WHERE di."createdBy" = u.id AND di."workspaceId" IS NULL;

  UPDATE "DecisionImport"
  SET "workspaceId" = default_workspace_id
  WHERE "workspaceId" IS NULL;

  UPDATE "EventRegistry" er
  SET "workspaceId" = COALESCE(
    (SELECT u."workspaceId" FROM "User" u WHERE u.id = er."createdBy"),
    (SELECT di."workspaceId" FROM "DecisionImport" di WHERE di.id = er."sourceDecisionImportId"),
    default_workspace_id
  )
  WHERE er."workspaceId" IS NULL;

  UPDATE "EventRegistry"
  SET "workspaceId" = default_workspace_id
  WHERE "workspaceId" IS NULL;

  UPDATE "KnowledgeBaseItem" kb
  SET "workspaceId" = COALESCE(u."workspaceId", default_workspace_id)
  FROM "User" u
  WHERE kb."createdBy" = u.id AND kb."workspaceId" IS NULL;

  UPDATE "KnowledgeBaseItem"
  SET "workspaceId" = default_workspace_id
  WHERE "workspaceId" IS NULL;

  UPDATE "CriteriaVersion" cv
  SET "workspaceId" = COALESCE(w.id, default_workspace_id)
  FROM "Workspace" w
  WHERE cv."unitScope" = w.code AND cv."workspaceId" IS NULL;

  UPDATE "CriteriaVersion"
  SET "workspaceId" = default_workspace_id
  WHERE "workspaceId" IS NULL;

  UPDATE "ReviewTask" rt
  SET "workspaceId" = COALESCE(
    (SELECT a."workspaceId" FROM "Application" a WHERE a.id = rt."applicationId"),
    (SELECT cp."workspaceId" FROM "CollectiveProfile" cp WHERE cp.id = rt."collectiveProfileId"),
    default_workspace_id
  )
  WHERE rt."workspaceId" IS NULL;

  UPDATE "ReviewTask"
  SET "workspaceId" = default_workspace_id
  WHERE "workspaceId" IS NULL;

  UPDATE "ResolutionCase" rc
  SET "workspaceId" = COALESCE(a."workspaceId", default_workspace_id)
  FROM "Application" a
  WHERE rc."applicationId" = a.id AND rc."workspaceId" IS NULL;

  UPDATE "ResolutionCase"
  SET "workspaceId" = default_workspace_id
  WHERE "workspaceId" IS NULL;

  UPDATE "File" f
  SET "workspaceId" = COALESCE(
    (SELECT owner."workspaceId" FROM "User" owner WHERE owner.id = f."ownerId"),
    (SELECT uploader."workspaceId" FROM "User" uploader WHERE uploader.id = f."uploadedBy"),
    default_workspace_id
  )
  WHERE f."workspaceId" IS NULL;

  UPDATE "IndexingJob" j
  SET "workspaceId" = COALESCE(
    (
      SELECT COALESCE(ev_app."workspaceId", ev_collective."workspaceId")
      FROM "Evidence" ev
      LEFT JOIN "Application" ev_app ON ev_app.id = ev."applicationId"
      LEFT JOIN "CollectiveProfile" ev_collective ON ev_collective.id = ev."collectiveProfileId"
      WHERE ev.id = j."targetId"
    ),
    (
      SELECT ef_event."workspaceId"
      FROM "EventFile" ef
      JOIN "EventRegistry" ef_event ON ef_event.id = ef."eventId"
      WHERE ef.id = j."targetId"
    ),
    (SELECT di."workspaceId" FROM "DecisionImport" di WHERE di.id = j."targetId"),
    default_workspace_id
  )
  WHERE j."workspaceId" IS NULL;

  UPDATE "smartreader_jobs" sj
  SET "workspace_id" = COALESCE(
    ev_app."workspaceId",
    ev_collective."workspaceId",
    er."workspaceId",
    di."workspaceId",
    f."workspaceId",
    default_workspace_id
  )
  FROM "smartreader_jobs" base
  LEFT JOIN "Evidence" ev ON ev.id = base."evidence_id"
  LEFT JOIN "Application" ev_app ON ev_app.id = ev."applicationId"
  LEFT JOIN "CollectiveProfile" ev_collective ON ev_collective.id = ev."collectiveProfileId"
  LEFT JOIN "EventRegistry" er ON er.id = base."event_id"
  LEFT JOIN "DecisionImport" di ON di.id = base."decision_import_id"
  LEFT JOIN "File" f ON f.id = base."file_id"
  WHERE sj.id = base.id AND sj."workspace_id" IS NULL;

  UPDATE "AuditLog" al
  SET "workspaceId" = COALESCE(a."workspaceId", cp."workspaceId", er."workspaceId", di."workspaceId", actor."workspaceId", default_workspace_id)
  FROM "AuditLog" base
  LEFT JOIN "Application" a ON a.id = base."applicationId"
  LEFT JOIN "CollectiveProfile" cp ON cp.id = base."collectiveProfileId"
  LEFT JOIN "EventRegistry" er ON er.id = base."eventId"
  LEFT JOIN "DecisionImport" di ON di.id = base."decisionImportId"
  LEFT JOIN "User" actor ON actor.id = base."actorId"
  WHERE al.id = base.id AND al."workspaceId" IS NULL;

  UPDATE "Notification" n
  SET "workspaceId" = COALESCE(a."workspaceId", cp."workspaceId", u."workspaceId", default_workspace_id)
  FROM "Notification" base
  LEFT JOIN "Application" a ON a.id = base."applicationId"
  LEFT JOIN "CollectiveProfile" cp ON cp.id = base."collectiveProfileId"
  LEFT JOIN "User" u ON u.id = base."userId"
  WHERE n.id = base.id AND n."workspaceId" IS NULL;

  UPDATE "chat_sessions" cs
  SET "workspaceId" = COALESCE(a."workspaceId", u."workspaceId", default_workspace_id)
  FROM "chat_sessions" base
  LEFT JOIN "Application" a ON a.id = base."applicationId"
  LEFT JOIN "User" u ON u.id = base."userId"
  WHERE cs.id = base.id AND cs."workspaceId" IS NULL;

  UPDATE "chatbot_actions" ca
  SET "workspaceId" = COALESCE(
    (SELECT cs."workspaceId" FROM "chat_sessions" cs WHERE cs.id = ca."sessionId"),
    (SELECT u."workspaceId" FROM "User" u WHERE u.id = ca."userId"),
    default_workspace_id
  )
  WHERE ca."workspaceId" IS NULL;

  UPDATE "chatbot_handoffs" ch
  SET "workspaceId" = COALESCE(
    (SELECT cs."workspaceId" FROM "chat_sessions" cs WHERE cs.id = ch."sessionId"),
    (SELECT u."workspaceId" FROM "User" u WHERE u.id = ch."userId"),
    (SELECT a."workspaceId" FROM "Application" a WHERE a.id = ch."applicationId"),
    default_workspace_id
  )
  WHERE ch."workspaceId" IS NULL;

  ALTER TABLE "Application" ALTER COLUMN "workspaceId" SET NOT NULL;
  ALTER TABLE "EventRegistry" ALTER COLUMN "workspaceId" SET NOT NULL;
  ALTER TABLE "DecisionImport" ALTER COLUMN "workspaceId" SET NOT NULL;
  ALTER TABLE "KnowledgeBaseItem" ALTER COLUMN "workspaceId" SET NOT NULL;
  ALTER TABLE "CriteriaVersion" ALTER COLUMN "workspaceId" SET NOT NULL;
  ALTER TABLE "ReviewTask" ALTER COLUMN "workspaceId" SET NOT NULL;
  ALTER TABLE "ResolutionCase" ALTER COLUMN "workspaceId" SET NOT NULL;
  ALTER TABLE "CollectiveProfile" ALTER COLUMN "workspaceId" SET NOT NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Application_workspaceId_studentId_schoolYear_applicationType_key"
  ON "Application"("workspaceId", "studentId", "schoolYear", "applicationType");
CREATE INDEX IF NOT EXISTS "Application_workspaceId_status_targetLevel_idx"
  ON "Application"("workspaceId", "status", "targetLevel");
CREATE INDEX IF NOT EXISTS "Application_workspaceId_studentId_schoolYear_idx"
  ON "Application"("workspaceId", "studentId", "schoolYear");

CREATE INDEX IF NOT EXISTS "File_workspaceId_idx" ON "File"("workspaceId");

CREATE INDEX IF NOT EXISTS "EventRegistry_workspaceId_status_idx" ON "EventRegistry"("workspaceId", "status");
CREATE INDEX IF NOT EXISTS "EventRegistry_workspaceId_criterion_idx" ON "EventRegistry"("workspaceId", "criterion");

CREATE INDEX IF NOT EXISTS "DecisionImport_workspaceId_status_idx" ON "DecisionImport"("workspaceId", "status");

CREATE INDEX IF NOT EXISTS "KnowledgeBaseItem_workspaceId_criterion_level_idx"
  ON "KnowledgeBaseItem"("workspaceId", "criterion", "level");

CREATE UNIQUE INDEX IF NOT EXISTS "CriteriaVersion_workspaceId_schoolYear_level_versionName_key"
  ON "CriteriaVersion"("workspaceId", "schoolYear", "level", "versionName");
CREATE INDEX IF NOT EXISTS "CriteriaVersion_workspaceId_level_isActive_idx"
  ON "CriteriaVersion"("workspaceId", "level", "isActive");

CREATE INDEX IF NOT EXISTS "ReviewTask_workspaceId_status_idx" ON "ReviewTask"("workspaceId", "status");
CREATE INDEX IF NOT EXISTS "ReviewTask_workspaceId_assignedOfficerId_status_idx"
  ON "ReviewTask"("workspaceId", "assignedOfficerId", "status");

CREATE INDEX IF NOT EXISTS "ResolutionCase_workspaceId_status_idx" ON "ResolutionCase"("workspaceId", "status");

CREATE INDEX IF NOT EXISTS "IndexingJob_workspaceId_jobType_status_idx"
  ON "IndexingJob"("workspaceId", "jobType", "status");
CREATE INDEX IF NOT EXISTS "smartreader_jobs_workspace_id_job_type_status_idx"
  ON "smartreader_jobs"("workspace_id", "job_type", "status");
CREATE INDEX IF NOT EXISTS "AuditLog_workspaceId_createdAt_idx" ON "AuditLog"("workspaceId", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_workspaceId_createdAt_idx" ON "Notification"("workspaceId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "CollectiveProfile_workspaceId_representativeId_schoolYear_className_key"
  ON "CollectiveProfile"("workspaceId", "representativeId", "schoolYear", "className");
CREATE INDEX IF NOT EXISTS "CollectiveProfile_workspaceId_status_targetLevel_idx"
  ON "CollectiveProfile"("workspaceId", "status", "targetLevel");
CREATE INDEX IF NOT EXISTS "chat_sessions_workspaceId_userId_idx" ON "chat_sessions"("workspaceId", "userId");
CREATE INDEX IF NOT EXISTS "chatbot_actions_workspaceId_userId_status_idx"
  ON "chatbot_actions"("workspaceId", "userId", "status");
CREATE INDEX IF NOT EXISTS "chatbot_handoffs_workspaceId_status_idx" ON "chatbot_handoffs"("workspaceId", "status");

ALTER TABLE "Application" ADD CONSTRAINT "Application_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "File" ADD CONSTRAINT "File_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EventRegistry" ADD CONSTRAINT "EventRegistry_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DecisionImport" ADD CONSTRAINT "DecisionImport_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KnowledgeBaseItem" ADD CONSTRAINT "KnowledgeBaseItem_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CriteriaVersion" ADD CONSTRAINT "CriteriaVersion_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReviewTask" ADD CONSTRAINT "ReviewTask_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResolutionCase" ADD CONSTRAINT "ResolutionCase_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IndexingJob" ADD CONSTRAINT "IndexingJob_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "smartreader_jobs" ADD CONSTRAINT "smartreader_jobs_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CollectiveProfile" ADD CONSTRAINT "CollectiveProfile_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "chatbot_actions" ADD CONSTRAINT "chatbot_actions_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "chatbot_handoffs" ADD CONSTRAINT "chatbot_handoffs_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
