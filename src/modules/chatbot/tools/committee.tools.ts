import { ResolutionStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../../infrastructure/database/prisma';
import type { ChatbotToolDefinition } from './chatbot-tool.types';

export const committeeTools: ChatbotToolDefinition[] = [
  {
    name: 'getResolutionCases',
    description: 'Get grouped resolution cases.',
    mode: 'read',
    requiredRoles: ['committee', 'manager', 'admin'],
    inputSchema: z.object({ status: z.nativeEnum(ResolutionStatus).optional() }),
    handler: async (_ctx, input) => {
      const ctx = _ctx;
      const parsed = z.object({ status: z.nativeEnum(ResolutionStatus).optional() }).parse(input);
      const grouped = await prisma.resolutionCase.groupBy({
        by: ['status'],
        where: { ...workspaceFilter(ctx), ...(parsed.status ? { status: parsed.status } : {}) },
        _count: { id: true },
      });
      return {
        type: 'cards',
        message: `Có ${grouped.reduce((sum, item) => sum + item._count.id, 0)} resolution case.`,
        cards: grouped.map((item) => ({ title: item.status, text: `${item._count.id} case` })),
      };
    },
  },
  {
    name: 'getResolutionCaseDetail',
    description: 'Get safe resolution case detail.',
    mode: 'read',
    requiredRoles: ['committee', 'manager', 'admin'],
    inputSchema: z.object({ caseId: z.string().uuid() }),
    handler: async (ctx, input) => {
      const parsed = z.object({ caseId: z.string().uuid() }).parse(input);
      const item = await prisma.resolutionCase.findFirst({
        where: { id: parsed.caseId, ...workspaceFilter(ctx) },
        include: { evidence: { include: { evidenceCard: true } } },
      });
      if (!item) return { type: 'text', message: 'Không tìm thấy resolution case.' };
      return {
        type: 'card',
        message: `Case đang ở trạng thái ${item.status}. Smartbot không đề xuất quyết định tự động.`,
        cards: [{ title: item.reason, text: `Evidence: ${item.evidence?.evidenceName ?? 'Không gắn minh chứng cụ thể'}` }],
        dataRefs: [{ type: 'resolution_case', id: item.id }],
      };
    },
  },
  {
    name: 'draftCommitteeDecision',
    description: 'Draft committee decision explanation only.',
    mode: 'draft',
    requiredRoles: ['committee', 'admin'],
    inputSchema: z.object({
      caseId: z.string().uuid(),
      decisionType: z.enum(['request_more_info', 'accept', 'reject']).optional(),
    }),
    handler: async (_ctx, input) => {
      const parsed = z.object({
        caseId: z.string().uuid(),
        decisionType: z.enum(['request_more_info', 'accept', 'reject']).optional(),
      }).parse(input);
      return {
        type: 'draft',
        message: `Dự thảo lý do quyết định (${parsed.decisionType ?? 'request_more_info'}): Hội đồng cần đối chiếu minh chứng, quy định hiện hành và tiền lệ trước khi lưu quyết định. Nội dung này chưa được ghi vào hệ thống.`,
        dataRefs: [{ type: 'resolution_case', id: parsed.caseId }],
      };
    },
  },
];

function workspaceFilter(ctx: { role: string; workspaceId?: string | null }) {
  return ctx.role === 'admin' ? {} : { workspaceId: ctx.workspaceId ?? '__missing_workspace__' };
}
