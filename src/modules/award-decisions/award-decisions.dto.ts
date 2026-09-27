import type { AwardDecisionRecord } from './award-decisions.repository';

export function toAwardDecisionDto(record: AwardDecisionRecord) {
  const fileDto = (file: AwardDecisionRecord['decisionFile']) =>
    file
      ? {
          id: file.id,
          originalName: file.originalName,
          mimeType: file.mimeType,
          fileSize: file.fileSize,
          createdAt: file.createdAt,
        }
      : null;

  return {
    id: record.id,
    issuerWorkspace: record.issuerWorkspace,
    awardLevel: record.awardLevel,
    schoolYear: record.schoolYear,
    decisionNumber: record.decisionNumber,
    decisionDate: record.decisionDate,
    status: record.status,
    decisionFile: fileDto(record.decisionFile),
    rosterFile: fileDto(record.rosterFile),
    sourceImportId: record.sourceImportId,
    recipientCount: record._count.recipients,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
