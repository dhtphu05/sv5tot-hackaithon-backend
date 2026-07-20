import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();

type Check = {
  name: string;
  count: number;
};

async function main() {
  const checks: Check[] = [
    {
      name: 'non_admin_users_missing_workspace',
      count: await prisma.user.count({
        where: { role: { not: Role.admin }, workspaceId: null },
      }),
    },
    {
      name: 'files_missing_workspace',
      count: await prisma.file.count({ where: { workspaceId: null } }),
    },
    {
      name: 'indexing_jobs_missing_workspace',
      count: await prisma.indexingJob.count({ where: { workspaceId: null } }),
    },
    {
      name: 'smartreader_jobs_missing_workspace',
      count: await prisma.smartReaderJob.count({ where: { workspaceId: null } }),
    },
    {
      name: 'audit_logs_missing_workspace',
      count: await prisma.auditLog.count({ where: { workspaceId: null } }),
    },
    {
      name: 'notifications_missing_workspace',
      count: await prisma.notification.count({ where: { workspaceId: null } }),
    },
    {
      name: 'chat_sessions_missing_workspace',
      count: await prisma.chatSession.count({ where: { workspaceId: null } }),
    },
    {
      name: 'chatbot_actions_missing_workspace',
      count: await prisma.chatbotAction.count({ where: { workspaceId: null } }),
    },
    {
      name: 'chatbot_handoffs_missing_workspace',
      count: await prisma.chatbotHandoff.count({ where: { workspaceId: null } }),
    },
    {
      name: 'applications_student_workspace_mismatch',
      count: await rawCount(`
        SELECT COUNT(*)::int AS count
        FROM "Application" a
        JOIN "User" u ON u.id = a."studentId"
        WHERE a."workspaceId" <> u."workspaceId"
      `),
    },
    {
      name: 'collective_representative_workspace_mismatch',
      count: await rawCount(`
        SELECT COUNT(*)::int AS count
        FROM "CollectiveProfile" c
        JOIN "User" u ON u.id = c."representativeId"
        WHERE c."workspaceId" <> u."workspaceId"
      `),
    },
    {
      name: 'review_task_parent_workspace_mismatch',
      count: await rawCount(`
        SELECT COUNT(*)::int AS count
        FROM "ReviewTask" rt
        LEFT JOIN "Application" a ON a.id = rt."applicationId"
        LEFT JOIN "CollectiveProfile" c ON c.id = rt."collectiveProfileId"
        WHERE rt."workspaceId" <> COALESCE(a."workspaceId", c."workspaceId")
      `),
    },
    {
      name: 'resolution_case_parent_workspace_mismatch',
      count: await rawCount(`
        SELECT COUNT(*)::int AS count
        FROM "ResolutionCase" rc
        JOIN "Application" a ON a.id = rc."applicationId"
        WHERE rc."workspaceId" <> a."workspaceId"
      `),
    },
    {
      name: 'event_registry_decision_import_workspace_mismatch',
      count: await rawCount(`
        SELECT COUNT(*)::int AS count
        FROM "EventRegistry" er
        JOIN "DecisionImport" di ON di.id = er."sourceDecisionImportId"
        WHERE er."workspaceId" <> di."workspaceId"
      `),
    },
    {
      name: 'criteria_versions_missing_workspace',
      count: await rawCount(`
        SELECT COUNT(*)::int AS count
        FROM "CriteriaVersion"
        WHERE "workspaceId" IS NULL
      `),
    },
    {
      name: 'knowledge_base_missing_workspace',
      count: await rawCount(`
        SELECT COUNT(*)::int AS count
        FROM "KnowledgeBaseItem"
        WHERE "workspaceId" IS NULL
      `),
    },
    {
      name: 'evidence_file_parent_workspace_mismatch',
      count: await rawCount(`
        SELECT COUNT(*)::int AS count
        FROM "EvidenceFile" ef
        JOIN "File" f ON f.id = ef."fileId"
        JOIN "Evidence" e ON e.id = ef."evidenceId"
        LEFT JOIN "Application" a ON a.id = e."applicationId"
        LEFT JOIN "CollectiveProfile" c ON c.id = e."collectiveProfileId"
        WHERE f."workspaceId" <> COALESCE(a."workspaceId", c."workspaceId")
      `),
    },
    {
      name: 'decision_import_file_workspace_mismatch',
      count: await rawCount(`
        SELECT COUNT(*)::int AS count
        FROM "DecisionImport" di
        JOIN "File" f ON f.id = di."sourceFileId"
        WHERE f."workspaceId" <> di."workspaceId"
      `),
    },
    {
      name: 'event_file_workspace_mismatch',
      count: await rawCount(`
        SELECT COUNT(*)::int AS count
        FROM "EventFile" ef
        JOIN "EventRegistry" er ON er.id = ef."eventId"
        JOIN "File" f ON f.id = ef."fileId"
        WHERE f."workspaceId" <> er."workspaceId"
      `),
    },
    {
      name: 'indexing_job_evidence_workspace_mismatch',
      count: await rawCount(`
        SELECT COUNT(*)::int AS count
        FROM "IndexingJob" j
        JOIN "Evidence" e ON e.id = j."targetId"
        LEFT JOIN "Application" a ON a.id = e."applicationId"
        LEFT JOIN "CollectiveProfile" c ON c.id = e."collectiveProfileId"
        WHERE j."jobType" = 'evidence_ocr'
          AND j."workspaceId" <> COALESCE(a."workspaceId", c."workspaceId")
      `),
    },
    {
      name: 'indexing_job_decision_import_workspace_mismatch',
      count: await rawCount(`
        SELECT COUNT(*)::int AS count
        FROM "IndexingJob" j
        JOIN "DecisionImport" di ON di.id = j."targetId"
        WHERE j."jobType" IN ('decision_metadata', 'decision_roster_ocr')
          AND j."workspaceId" <> di."workspaceId"
      `),
    },
    {
      name: 'smartreader_job_parent_workspace_mismatch',
      count: await rawCount(`
        SELECT COUNT(*)::int AS count
        FROM "smartreader_jobs" sj
        LEFT JOIN "Evidence" e ON e.id = sj."evidence_id"
        LEFT JOIN "Application" a ON a.id = e."applicationId"
        LEFT JOIN "CollectiveProfile" c ON c.id = e."collectiveProfileId"
        LEFT JOIN "DecisionImport" di ON di.id = sj."decision_import_id"
        WHERE sj."workspace_id" <> COALESCE(a."workspaceId", c."workspaceId", di."workspaceId")
      `),
    },
  ];

  const failed = checks.filter((check) => check.count > 0);
  for (const check of checks) {
    console.log(`${check.name}: ${check.count}`);
  }
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

async function rawCount(query: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: number | bigint }>>(query);
  const count = rows[0]?.count ?? 0;
  return typeof count === 'bigint' ? Number(count) : count;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
