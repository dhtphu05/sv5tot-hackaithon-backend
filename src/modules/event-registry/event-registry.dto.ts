import { IndexingStatus } from '@prisma/client';
import type {
  Criterion,
  EventRegistry,
  EventStatus,
  File,
  Level,
  Prisma,
} from '@prisma/client';

type StaffEventFile = {
  id: string;
  indexingStatus?: IndexingStatus;
  file: Pick<File, 'id' | 'originalName' | 'mimeType' | 'fileSize'>;
};

type StaffEventDecisionDocument = {
  documentNo: string | null;
} | null;

type StaffEventDecisionImport = {
  id: string;
  sourceFile?: Pick<File, 'id' | 'originalName' | 'mimeType' | 'fileSize'> | null;
} | null;

export type StaffEventWorkspaceSource = EventRegistry & {
  eventFiles?: StaffEventFile[];
  sampleCertificateFile?: Pick<File, 'id' | 'originalName' | 'mimeType' | 'fileSize'> | null;
  sourceDecisionImport?: StaffEventDecisionImport;
  decisionDocument?: StaffEventDecisionDocument;
};

export type StaffEventWorkspaceDto = {
  event: {
    id: string;
    name: string;
    organizer: string | null;
    organizerLevel: Level;
    criterion: Criterion;
    status: EventStatus;
    rosterIndexed: boolean;
    participantCount: number;
    convertedValue: number | null;
    convertedUnit: string | null;
    updatedAt: Date;
  };
  files: Array<{
    id: string;
    originalName: string;
    mimeType: string;
    size: number;
    role: 'roster' | 'decision_source' | 'sample_certificate';
  }>;
  source: {
    decisionImportId: string | null;
    decisionNumber: string | null;
  };
  indexSummary: {
    status: IndexingStatus | 'not_started';
    validRows: number | null;
    warningRows: number | null;
    errorRows: number | null;
  };
};

export function toStaffEventWorkspaceDto(
  event: StaffEventWorkspaceSource,
  latestRosterPreview: Prisma.JsonValue | null | undefined,
): StaffEventWorkspaceDto {
  const latestEventFile = event.eventFiles?.[0] ?? null;
  const files = new Map<string, StaffEventWorkspaceDto['files'][number]>();

  for (const eventFile of event.eventFiles ?? []) {
    addFile(files, eventFile.file, 'roster');
  }
  if (event.sourceDecisionImport?.sourceFile) {
    addFile(files, event.sourceDecisionImport.sourceFile, 'decision_source');
  }
  if (event.sampleCertificateFile) {
    addFile(files, event.sampleCertificateFile, 'sample_certificate');
  }

  return {
    event: {
      id: event.id,
      name: event.eventName,
      organizer: event.organizer ?? null,
      organizerLevel: event.organizerLevel,
      criterion: event.criterion,
      status: event.status,
      rosterIndexed: event.rosterIndexed,
      participantCount: event.participantCount,
      convertedValue: event.convertedValue,
      convertedUnit: event.convertedUnit,
      updatedAt: event.updatedAt,
    },
    files: [...files.values()],
    source: {
      decisionImportId: event.sourceDecisionImportId,
      decisionNumber: event.officialDocumentNo ?? event.decisionDocument?.documentNo ?? null,
    },
    indexSummary: buildIndexSummary(
      latestEventFile?.indexingStatus ?? (event.rosterIndexed ? IndexingStatus.indexed : 'not_started'),
      latestRosterPreview,
      event.participantCount,
      event.rosterIndexed,
    ),
  };
}

function addFile(
  files: Map<string, StaffEventWorkspaceDto['files'][number]>,
  file: Pick<File, 'id' | 'originalName' | 'mimeType' | 'fileSize'>,
  role: StaffEventWorkspaceDto['files'][number]['role'],
) {
  if (files.has(file.id)) return;
  files.set(file.id, {
    id: file.id,
    originalName: file.originalName,
    mimeType: file.mimeType,
    size: file.fileSize,
    role,
  });
}

function buildIndexSummary(
  status: StaffEventWorkspaceDto['indexSummary']['status'],
  latestRosterPreview: Prisma.JsonValue | null | undefined,
  participantCount: number,
  rosterIndexed: boolean,
): StaffEventWorkspaceDto['indexSummary'] {
  const preview = asRecord(latestRosterPreview);
  const quality = asRecord(preview?.quality);
  const rowCount = numberValue(quality?.rowCount);
  const missingRows = numberValue(quality?.missingStudentCodeRows) ?? 0;
  const duplicateRows = Array.isArray(quality?.duplicateStudentCodes)
    ? quality.duplicateStudentCodes.length
    : 0;

  if (rowCount !== null) {
    const warnings = duplicateRows;
    const errors = missingRows;
    return {
      status,
      validRows: Math.max(0, rowCount - warnings - errors),
      warningRows: warnings,
      errorRows: errors,
    };
  }

  if (rosterIndexed) {
    return {
      status,
      validRows: participantCount,
      warningRows: 0,
      errorRows: 0,
    };
  }

  return {
    status,
    validRows: null,
    warningRows: null,
    errorRows: null,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
