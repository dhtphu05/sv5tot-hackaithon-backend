import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Prisma, Role } from '@prisma/client';
import type { Request, Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { env } from '../../config/env';
import { prisma } from '../../infrastructure/database/prisma';
import { auditActions } from '../../shared/constants/application';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import { sendSuccess } from '../../shared/responses/api-response';
import { getSmartReaderAdapter } from './smartreader.adapter';
import type {
  AdministrativeDocResult,
  SmartReaderAsyncResult,
  SmartReaderOcrResult,
  SmartReaderUploadResult,
} from './smartreader.types';
import { smartReaderDebugQuerySchema, smartReaderFileInputSchema } from './smartreader.validation';

const adapter = getSmartReaderAdapter();
const auditService = new AuditService();

export async function uploadTest(req: Request, res: Response): Promise<void> {
  const input = await resolveInputFile(req);
  try {
    await auditSmartReader(req, auditActions.SMARTREADER_FILE_UPLOAD_STARTED, {
      fileName: input.originalName,
    });
    const upload = await adapter.uploadFile(input);
    await auditSmartReader(req, auditActions.SMARTREADER_FILE_UPLOADED, {
      hash: upload.hash,
      fileType: upload.fileType,
    });

    sendSuccess(res, summarizeUpload(upload, shouldIncludeRaw(req) ? upload.raw : undefined), {
      requestId: req.requestId,
    });
  } finally {
    await input.cleanup();
  }
}

export async function ocrTest(req: Request, res: Response): Promise<void> {
  const source = await resolveSmartReaderSource(req);
  try {
    await auditSmartReader(req, auditActions.SMARTREADER_OCR_STARTED, {
      hash: source.upload.hash,
      fileType: source.upload.fileType,
      endpoint: 'advanced',
    });
    const result = await adapter.ocrAdvanced({
      fileHash: source.upload.hash,
      fileType: source.upload.fileType,
      details: true,
      exporter: 'json',
    });
    await auditSmartReader(req, auditActions.SMARTREADER_OCR_COMPLETED, {
      hash: source.upload.hash,
      fileType: source.upload.fileType,
      tableCount: result.tables.length,
      numOfPages: result.numOfPages,
    });

    sendSuccess(res, summarizeOcr(source.upload, result, shouldIncludeRaw(req)), {
      requestId: req.requestId,
    });
  } catch (error) {
    await auditSmartReader(req, auditActions.SMARTREADER_OCR_FAILED, {
      error: error instanceof Error ? error.message : error,
    });
    throw error;
  } finally {
    await source.cleanup();
  }
}

export async function adminDocTest(req: Request, res: Response): Promise<void> {
  const source = await resolveSmartReaderSource(req);
  try {
    const result = await adapter.extractAdministrativeDocument({
      fileHash: source.upload.hash,
      fileType: source.upload.fileType,
      details: true,
    });
    await auditSmartReader(req, auditActions.SMARTREADER_ADMIN_DOC_EXTRACTED, {
      hash: source.upload.hash,
      fileType: source.upload.fileType,
      fields: Object.keys(result.fields),
    });

    sendSuccess(res, summarizeAdminDoc(source.upload, result, shouldIncludeRaw(req)), {
      requestId: req.requestId,
    });
  } finally {
    await source.cleanup();
  }
}

export async function asyncTest(req: Request, res: Response): Promise<void> {
  const source = await resolveSmartReaderSource(req);
  try {
    const started = await adapter.startAdvancedAsync({
      fileHash: source.upload.hash,
      fileType: source.upload.fileType,
      details: true,
      exporter: 'json',
    });
    await auditSmartReader(req, auditActions.SMARTREADER_OCR_POLLING, {
      hash: source.upload.hash,
      fileType: source.upload.fileType,
      sessionId: started.sessionId,
    });

    sendSuccess(
      res,
      {
        hash: source.upload.hash,
        fileType: source.upload.fileType,
        status: 'processing',
        warnings: started.warnings,
        warningMessages: started.warningMessages,
        sampleText: '',
        tableCount: 0,
        numOfPages: undefined,
        sessionId: started.sessionId,
        ...(shouldIncludeRaw(req) ? { raw: started.raw } : {}),
      },
      { requestId: req.requestId },
    );
  } finally {
    await source.cleanup();
  }
}

async function resolveSmartReaderSource(req: Request): Promise<{
  upload: SmartReaderUploadResult;
  cleanup: () => Promise<void>;
}> {
  const body = smartReaderFileInputSchema.parse(req.body);
  const fileHash = body.fileHash ?? body.hash;

  if (fileHash && body.fileType) {
    return {
      upload: {
        hash: fileHash,
        fileType: body.fileType,
        raw: { source: 'direct_hash' },
      },
      cleanup: async () => undefined,
    };
  }

  if (body.fileId) {
    const file = await prisma.file.findUnique({ where: { id: body.fileId } });
    if (!file) {
      throw new AppError(404, ErrorCodes.FILE_NOT_FOUND, 'File not found');
    }

    if (file.vnptHash && file.vnptFileType) {
      return {
        upload: {
          hash: file.vnptHash,
          fileType: file.vnptFileType,
          fileName: file.originalName,
          raw: { source: 'file_vnpt_metadata' },
        },
        cleanup: async () => undefined,
      };
    }

    if (file.storageType !== 'local') {
      throw new AppError(
        400,
        ErrorCodes.VALIDATION_ERROR,
        'fileId without VNPT metadata is only supported for local storage files',
      );
    }

    const upload = await adapter.uploadFile({
      filePath: path.resolve(env.UPLOAD_DIR, file.filePath),
      originalName: file.originalName,
      title: body.title ?? file.originalName,
      description: body.description,
    });
    await prisma.file.update({
      where: { id: file.id },
      data: {
        vnptHash: upload.hash,
        vnptFileType: upload.fileType,
        vnptUploadedAt: new Date(),
        vnptUploadRawJson: env.VNPT_SAVE_RAW_RESPONSE
          ? (upload.raw as Prisma.InputJsonValue)
          : undefined,
      },
    });

    return { upload, cleanup: async () => undefined };
  }

  const input = await resolveInputFile(req);
  const upload = await adapter.uploadFile(input);
  return {
    upload,
    cleanup: input.cleanup,
  };
}

async function resolveInputFile(req: Request): Promise<{
  filePath: string;
  originalName?: string;
  title?: string;
  description?: string;
  cleanup: () => Promise<void>;
}> {
  const body = smartReaderFileInputSchema.parse(req.body);

  if (req.file) {
    const tempDirectory = path.resolve(process.cwd(), 'tmp/smartreader-internal');
    await fs.mkdir(tempDirectory, { recursive: true });
    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = path.join(tempDirectory, `${req.requestId ?? Date.now()}-${safeName}`);
    await fs.writeFile(filePath, req.file.buffer);
    return {
      filePath,
      originalName: req.file.originalname,
      title: body.title,
      description: body.description,
      cleanup: async () => {
        await fs.unlink(filePath).catch(() => undefined);
      },
    };
  }

  if (!body.filePath) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'file or filePath is required');
  }

  return {
    filePath: body.filePath,
    originalName: path.basename(body.filePath),
    title: body.title,
    description: body.description,
    cleanup: async () => undefined,
  };
}

function shouldIncludeRaw(req: Request): boolean {
  const query = smartReaderDebugQuerySchema.parse(req.query);
  return query.debug === 'true' && req.user?.role === Role.admin;
}

function summarizeUpload(upload: SmartReaderUploadResult, raw?: unknown) {
  return {
    hash: upload.hash,
    fileType: upload.fileType,
    status: 'uploaded',
    warnings: [],
    warningMessages: [],
    sampleText: '',
    tableCount: 0,
    numOfPages: undefined,
    ...(raw ? { raw } : {}),
  };
}

function summarizeOcr(
  upload: SmartReaderUploadResult,
  result: SmartReaderOcrResult | SmartReaderAsyncResult,
  includeRaw: boolean,
) {
  return {
    hash: upload.hash,
    fileType: upload.fileType,
    status: 'completed',
    warnings: result.warnings,
    warningMessages: result.warningMessages,
    sampleText: result.text.slice(0, 1000),
    tableCount: result.tables.length,
    numOfPages: result.numOfPages,
    ...('sessionId' in result ? { sessionId: result.sessionId } : {}),
    ...(includeRaw ? { raw: result.raw } : {}),
  };
}

function summarizeAdminDoc(
  upload: SmartReaderUploadResult,
  result: AdministrativeDocResult,
  includeRaw: boolean,
) {
  return {
    hash: upload.hash,
    fileType: upload.fileType,
    status: 'completed',
    warnings: result.warnings,
    warningMessages: result.warningMessages,
    sampleText: result.text.slice(0, 1000),
    tableCount: 0,
    numOfPages: undefined,
    fields: result.fields,
    ...(includeRaw ? { raw: result.raw } : {}),
  };
}

async function auditSmartReader(
  req: Request,
  action: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await auditService.log({
    actorId: req.user?.id,
    actorRole: req.user?.role,
    action,
    entityType: 'smartreader',
    metadata,
    requestId: req.requestId,
    ipAddress: req.ip,
    userAgent: req.header('user-agent'),
  });
}
