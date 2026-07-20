import { z } from 'zod';
import { prisma } from '../../../infrastructure/database/prisma';
import type { ChatbotToolDefinition } from './chatbot-tool.types';

export const managerTools: ChatbotToolDefinition[] = [
  {
    name: 'getManagerDashboard',
    description: 'Get manager dashboard safe counts.',
    mode: 'read',
    requiredRoles: ['manager', 'admin'],
    inputSchema: z.object({}),
    handler: async (ctx) => {
      const scope = workspaceFilter(ctx);
      const [applications, pending, supplement, resolution] = await Promise.all([
        prisma.application.groupBy({ by: ['status'], where: scope, _count: { status: true } }),
        prisma.reviewTask.count({ where: { ...scope, status: { in: ['waiting', 'reviewing'] } } }),
        prisma.application.count({ where: { ...scope, status: 'supplement_required' } }),
        prisma.application.count({ where: { ...scope, status: 'resolution_needed' } }),
      ]);
      return {
        type: 'card',
        message: `Đang chờ xét: ${pending}; cần bổ sung: ${supplement}; cần resolution: ${resolution}.`,
        cards: applications.map((item) => ({ title: item.status, text: `${item._count.status} hồ sơ` })),
      };
    },
  },
  {
    name: 'getOfficerWorkload',
    description: 'Get officer workload by criterion.',
    mode: 'read',
    requiredRoles: ['manager', 'admin'],
    inputSchema: z.object({}),
    handler: async (ctx) => {
      const workloads = await prisma.reviewTask.groupBy({
        by: ['criterion', 'assignedOfficerId'],
        where: { ...workspaceFilter(ctx), status: { in: ['waiting', 'reviewing'] } },
        _count: { id: true },
      });
      return {
        type: 'cards',
        message: `Có ${workloads.length} nhóm workload đang mở.`,
        cards: workloads.slice(0, 8).map((item) => ({
          title: item.criterion,
          text: `${item._count.id} task - officer ${item.assignedOfficerId ?? 'chưa phân công'}`,
        })),
      };
    },
  },
  {
    name: 'getBottlenecks',
    description: 'Get bottleneck criteria.',
    mode: 'read',
    requiredRoles: ['manager', 'admin'],
    inputSchema: z.object({}),
    handler: async (ctx) => {
      const grouped = await prisma.reviewTask.groupBy({
        by: ['criterion'],
        where: {
          ...workspaceFilter(ctx),
          status: { in: ['waiting', 'reviewing', 'supplement_required', 'resolution_needed'] },
        },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      });
      return {
        type: 'cards',
        message: grouped[0] ? `Tiêu chí đang nghẽn nhất: ${grouped[0].criterion}.` : 'Chưa thấy bottleneck rõ.',
        cards: grouped.map((item) => ({ title: item.criterion, text: `${item._count.id} task cần xử lý` })),
        actions: [{ label: 'Mở danh sách hồ sơ', type: 'navigation', route: '/app/manager/results' }],
      };
    },
  },
];

function workspaceFilter(ctx: { role: string; workspaceId?: string | null }) {
  return ctx.role === 'admin' ? {} : { workspaceId: ctx.workspaceId ?? '__missing_workspace__' };
}
