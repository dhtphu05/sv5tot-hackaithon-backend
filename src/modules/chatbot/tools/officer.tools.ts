import { Criterion, ReviewTaskStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../../infrastructure/database/prisma';
import type { ChatbotToolDefinition, ChatbotToolResult } from './chatbot-tool.types';
import { ChatbotToolPermissionService } from './tool-permission.service';

const permissions = new ChatbotToolPermissionService();

export const officerTools: ChatbotToolDefinition[] = [
  {
    name: 'getOfficerTasks',
    description: 'Summarize officer review queue.',
    mode: 'read',
    requiredRoles: ['officer', 'manager', 'committee', 'admin'],
    inputSchema: z.object({
      status: z.nativeEnum(ReviewTaskStatus).optional(),
      criterion: z.nativeEnum(Criterion).optional(),
    }),
    handler: async (ctx, input) => {
      const parsed = z
        .object({
          status: z.nativeEnum(ReviewTaskStatus).optional(),
          criterion: z.nativeEnum(Criterion).optional(),
        })
        .parse(input);
      const tasks = await prisma.reviewTask.findMany({
        where: {
          ...(ctx.role === 'officer' ? { assignedOfficerId: ctx.userId } : {}),
          ...(parsed.status ? { status: parsed.status } : {}),
          ...(parsed.criterion ? { criterion: parsed.criterion } : {}),
        },
        include: { evidences: true },
        take: 100,
      });
      const dueSoon = tasks.filter((task) => task.dueDate && task.dueDate.getTime() - Date.now() < 3 * 24 * 60 * 60 * 1000).length;
      return {
        type: 'card',
        message: `Có ${tasks.length} task trong phạm vi. Gần quá hạn: ${dueSoon}.`,
        cards: [
          {
            title: 'Review queue',
            text: `Đang chờ xử lý: ${tasks.filter((task) => task.status === 'waiting').length}\nGần quá hạn: ${dueSoon}\nCần kiểm tra thủ công: ${tasks.filter((task) => task.evidences.length > 0).length}`,
          },
        ],
      };
    },
  },
  {
    name: 'getReviewTaskDetail',
    description: 'Get safe review task detail.',
    mode: 'read',
    requiredRoles: ['officer', 'manager', 'committee', 'admin'],
    inputSchema: z.object({ taskId: z.string().uuid() }),
    handler: async (ctx, input) => {
      const parsed = z.object({ taskId: z.string().uuid() }).parse(input);
      await permissions.assertCanAccessReviewTask(ctx, parsed.taskId);
      const task = await prisma.reviewTask.findUnique({
        where: { id: parsed.taskId },
        include: {
          evidences: { include: { evidence: { include: { evidenceCard: true } } } },
        },
      });
      if (!task) return textResult('Không tìm thấy review task.');
      return {
        type: 'card',
        message: `Task ${task.criterion} đang ở trạng thái ${task.status}.`,
        cards: task.evidences.map(({ evidence }) => ({
          title: evidence.evidenceName,
          text: `Trạng thái: ${evidence.status}; đọc file: ${evidence.indexingStatus}`,
        })),
        dataRefs: [{ type: 'review_task', id: task.id }],
      };
    },
  },
  {
    name: 'draftSupplementRequest',
    description: 'Draft supplement request without sending.',
    mode: 'draft',
    requiredRoles: ['officer', 'manager', 'admin'],
    inputSchema: z.object({ taskId: z.string().uuid(), reason: z.string().max(1000).optional() }),
    handler: async (ctx, input) => {
      const parsed = z.object({ taskId: z.string().uuid(), reason: z.string().max(1000).optional() }).parse(input);
      await permissions.assertCanAccessReviewTask(ctx, parsed.taskId);
      return {
        type: 'draft',
        message: [
          'Dự thảo yêu cầu bổ sung:',
          parsed.reason ?? 'Sinh viên vui lòng bổ sung minh chứng còn thiếu hoặc làm rõ thông tin trong file đã nộp.',
          'Cán bộ cần kiểm tra/chỉnh sửa trước khi gửi.',
        ].join('\n'),
        dataRefs: [{ type: 'review_task', id: parsed.taskId }],
      };
    },
  },
  {
    name: 'searchKnowledgeBase',
    description: 'Search safe knowledge base cases.',
    mode: 'read',
    requiredRoles: ['officer', 'manager', 'committee', 'admin'],
    inputSchema: z.object({ query: z.string().trim().min(1).max(200), criterion: z.nativeEnum(Criterion).optional() }),
    handler: async (_ctx, input) => {
      const parsed = z.object({ query: z.string().trim().min(1).max(200), criterion: z.nativeEnum(Criterion).optional() }).parse(input);
      const items = await prisma.knowledgeBaseItem.findMany({
        where: {
          ...(parsed.criterion ? { criterion: parsed.criterion } : {}),
          OR: [
            { evidenceName: { contains: parsed.query, mode: 'insensitive' } },
            { eventName: { contains: parsed.query, mode: 'insensitive' } },
            { reason: { contains: parsed.query, mode: 'insensitive' } },
          ],
        },
        orderBy: { updatedAt: 'desc' },
        take: 5,
      });
      return {
        type: 'cards',
        message: `Tìm thấy ${items.length} case tham khảo.`,
        cards: items.map((item) => ({
          title: item.evidenceName ?? item.eventName ?? item.criterion,
          text: `${item.decision}: ${item.reason ?? 'Không có ghi chú'}`,
        })),
        dataRefs: items.map((item) => ({ type: 'knowledge_base_item', id: item.id })),
      };
    },
  },
  {
    name: 'summarizeEvidenceForReview',
    description: 'Summarize evidence for officer review.',
    mode: 'read',
    requiredRoles: ['officer', 'manager', 'committee', 'admin'],
    inputSchema: z.object({ evidenceId: z.string().uuid() }),
    handler: async (ctx, input) => {
      const parsed = z.object({ evidenceId: z.string().uuid() }).parse(input);
      await permissions.assertCanAccessEvidence(ctx, parsed.evidenceId);
      const evidence = await prisma.evidence.findUnique({
        where: { id: parsed.evidenceId },
        include: { evidenceCard: true },
      });
      if (!evidence) return textResult('Không tìm thấy minh chứng.');
      const warningCount = Array.isArray(evidence.evidenceCard?.warningsJson) ? evidence.evidenceCard?.warningsJson.length : 0;
      return {
        type: 'card',
        message: `Minh chứng ${evidence.evidenceName}: ${warningCount} cảnh báo. Cần cán bộ xác minh trước khi quyết định.`,
        cards: [{ title: evidence.evidenceName, text: `Tiêu chí: ${evidence.criterion}\nGợi ý kiểm tra: dấu xác nhận, thời hạn, thông tin sinh viên, đơn vị tổ chức.` }],
      };
    },
  },
];

function textResult(message: string): ChatbotToolResult {
  return { type: 'text', message };
}
