import { Criterion } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../../infrastructure/database/prisma';
import type { ChatbotToolDefinition, ChatbotToolResult } from './chatbot-tool.types';
import { ChatbotToolPermissionService } from './tool-permission.service';

const permissions = new ChatbotToolPermissionService();
const appInput = z.object({ applicationId: z.string().uuid().optional() });
const appRequiredInput = z.object({ applicationId: z.string().uuid().optional() });

export const studentTools: ChatbotToolDefinition[] = [
  {
    name: 'getCurrentApplication',
    description: 'Get safe current application status for the student.',
    mode: 'read',
    requiredRoles: ['student', 'officer', 'manager', 'committee', 'admin'],
    inputSchema: appInput,
    handler: async (ctx, input) => {
      const parsed = appInput.parse(input);
      const app = await findApplication(ctx.userId, parsed.applicationId ?? ctx.applicationId);
      if (!app) return textResult('Chưa tìm thấy hồ sơ đang hoạt động.');
      await permissions.assertCanAccessApplication(ctx, app.id);
      return {
        type: 'card',
        message: `Hồ sơ đang ở trạng thái ${app.status}, aim ${app.targetLevel}, năm học ${app.schoolYear}.`,
        cards: [{ title: 'Trạng thái hồ sơ', text: `Trạng thái: ${app.status}\nAim: ${app.targetLevel}` }],
        actions: [{ label: 'Mở hồ sơ', type: 'navigation', route: '/app/drafts' }],
        dataRefs: [{ type: 'application', id: app.id }],
        safeMetadata: { application_status: app.status, target_level: app.targetLevel },
      };
    },
  },
  {
    name: 'getGapAnalysis',
    description: 'Get latest safe gap analysis from precheck/cascade.',
    mode: 'read',
    requiredRoles: ['student', 'officer', 'manager', 'committee', 'admin'],
    inputSchema: appRequiredInput,
    handler: async (ctx, input) => {
      const parsed = appRequiredInput.parse(input);
      const app = await findApplication(ctx.userId, parsed.applicationId ?? ctx.applicationId);
      if (!app) return textResult('Chưa tìm thấy hồ sơ để phân tích.');
      await permissions.assertCanAccessApplication(ctx, app.id);
      const [precheck, cascade] = await Promise.all([
        prisma.precheckResult.findFirst({
          where: { applicationId: app.id },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.cascadeReview.findFirst({
          where: { applicationId: app.id },
          orderBy: { createdAt: 'desc' },
        }),
      ]);
      const missing = Array.isArray(precheck?.missingItemsJson) ? precheck.missingItemsJson.length : 0;
      return {
        type: 'cards',
        message:
          missing > 0
            ? `Tiền kiểm ghi nhận ${missing} mục cần kiểm tra hoặc bổ sung.`
            : 'Chưa có gap rõ ràng từ tiền kiểm gần nhất. Kết quả chính thức do cán bộ/Hội đồng xác nhận.',
        cards: [
          { title: 'Gap Analysis', text: `Mục cần bổ sung/kiểm tra: ${missing}` },
          ...(cascade ? [{ title: 'Cascade', text: 'Có bản cascade review gần nhất để tham khảo.' }] : []),
        ],
        actions: [
          { label: 'Mở tiền kiểm', type: 'navigation', route: '/app/ai-precheck' },
          { label: 'Upload minh chứng', type: 'navigation', route: '/app/evidence' },
          { label: 'Mở Matching Hub', type: 'navigation', route: '/app/event-library' },
        ],
        dataRefs: [{ type: 'application', id: app.id }],
      };
    },
  },
  {
    name: 'getChecklist',
    description: 'Get five-criteria checklist without official pass/fail wording.',
    mode: 'read',
    requiredRoles: ['student', 'officer', 'manager', 'committee', 'admin'],
    inputSchema: appRequiredInput,
    handler: async (ctx, input) => {
      const parsed = appRequiredInput.parse(input);
      const app = await findApplication(ctx.userId, parsed.applicationId ?? ctx.applicationId);
      if (!app) return textResult('Chưa tìm thấy hồ sơ để kiểm tra checklist.');
      await permissions.assertCanAccessApplication(ctx, app.id);
      const evidences = await prisma.evidence.groupBy({
        by: ['criterion'],
        where: { applicationId: app.id },
        _count: { criterion: true },
      });
      const existing = new Set(evidences.map((item) => item.criterion));
      const criteria = [
        Criterion.ethics,
        Criterion.academic,
        Criterion.physical,
        Criterion.volunteer,
        Criterion.integration,
      ];
      return {
        type: 'cards',
        message: 'Checklist chỉ hiển thị trạng thái dữ liệu, không chốt đạt/chưa đạt.',
        cards: criteria.map((criterion) => ({
          title: criterion,
          text: existing.has(criterion) ? 'có dữ liệu' : 'còn thiếu',
        })),
      };
    },
  },
  {
    name: 'getDeadline',
    description: 'Get safe deadline summary.',
    mode: 'read',
    requiredRoles: ['student', 'officer', 'manager', 'committee', 'admin'],
    inputSchema: appRequiredInput,
    handler: async (ctx, input) => {
      const parsed = appRequiredInput.parse(input);
      const app = await findApplication(ctx.userId, parsed.applicationId ?? ctx.applicationId);
      if (!app) return textResult('Chưa tìm thấy hồ sơ để kiểm tra hạn.');
      await permissions.assertCanAccessApplication(ctx, app.id);
      const notification = await prisma.notification.findFirst({
        where: { applicationId: app.id, type: { in: ['deadline', 'supplement_required'] } },
        orderBy: { createdAt: 'desc' },
      });
      return textResult(
        notification?.message ?? 'Chưa có hạn bổ sung cụ thể trong hệ thống. Vui lòng theo dõi thông báo mới nhất.',
      );
    },
  },
  {
    name: 'getEvidenceCardSummary',
    description: 'Get evidence card summary without raw OCR text.',
    mode: 'read',
    requiredRoles: ['student', 'officer', 'manager', 'committee', 'admin'],
    inputSchema: z.object({ evidenceId: z.string().uuid() }),
    handler: async (ctx, input) => {
      const parsed = z.object({ evidenceId: z.string().uuid() }).parse(input);
      await permissions.assertCanAccessEvidence(ctx, parsed.evidenceId);
      const evidence = await prisma.evidence.findUnique({
        where: { id: parsed.evidenceId },
        include: { evidenceCard: true },
      });
      if (!evidence) return textResult('Không tìm thấy minh chứng.');
      const warnings = Array.isArray(evidence.evidenceCard?.warningsJson)
        ? evidence.evidenceCard?.warningsJson.length
        : 0;
      return {
        type: 'card',
        message: `${evidence.evidenceName}: ${evidence.indexingStatus}, ${warnings} cảnh báo cần xem.`,
        cards: [{ title: evidence.evidenceName, text: `Tiêu chí: ${evidence.criterion}\nTrạng thái đọc: ${evidence.indexingStatus}` }],
        dataRefs: [{ type: 'evidence', id: evidence.id }],
      };
    },
  },
  {
    name: 'searchMatchingHub',
    description: 'Search safe Event Registry cards.',
    mode: 'read',
    requiredRoles: ['student', 'officer', 'manager', 'committee', 'admin'],
    inputSchema: z.object({
      query: z.string().trim().max(200).optional(),
      criterion: z.nativeEnum(Criterion).optional(),
      applicationId: z.string().uuid().optional(),
    }),
    handler: async (_ctx, input) => {
      const parsed = z
        .object({
          query: z.string().trim().max(200).optional(),
          criterion: z.nativeEnum(Criterion).optional(),
          applicationId: z.string().uuid().optional(),
        })
        .parse(input);
      const events = await prisma.eventRegistry.findMany({
        where: {
          ...(parsed.criterion ? { criterion: parsed.criterion } : {}),
          ...(parsed.query ? { eventName: { contains: parsed.query, mode: 'insensitive' } } : {}),
        },
        orderBy: { updatedAt: 'desc' },
        take: 5,
      });
      return {
        type: 'cards',
        message: events.length ? `Tìm thấy ${events.length} sự kiện phù hợp.` : 'Chưa tìm thấy sự kiện phù hợp.',
        cards: events.map((event) => ({
          title: event.eventName,
          text: `${event.criterion} - ${event.organizer} - ${event.convertedValue ?? ''} ${event.convertedUnit ?? ''}`.trim(),
        })),
        actions: [{ label: 'Mở Event Library', type: 'navigation', route: '/app/event-library' }],
        dataRefs: events.map((event) => ({ type: 'event', id: event.id })),
      };
    },
  },
];

async function findApplication(userId: string, applicationId?: string) {
  if (applicationId) {
    return prisma.application.findUnique({ where: { id: applicationId } });
  }
  return prisma.application.findFirst({ where: { studentId: userId }, orderBy: { updatedAt: 'desc' } });
}

function textResult(message: string): ChatbotToolResult {
  return { type: 'text', message };
}
