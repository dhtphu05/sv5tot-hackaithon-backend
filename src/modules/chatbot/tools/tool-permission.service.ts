import { Role } from '@prisma/client';
import { prisma } from '../../../infrastructure/database/prisma';
import { AppError } from '../../../shared/errors/app-error';
import { ErrorCodes } from '../../../shared/errors/error-codes';
import type { ChatbotToolContext } from './chatbot-tool.types';

export class ChatbotToolPermissionService {
  async assertCanAccessApplication(ctx: ChatbotToolContext, applicationId: string): Promise<void> {
    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      select: { studentId: true, workspaceId: true },
    });
    if (!application) {
      throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
    }
    if (ctx.role === Role.student && application.studentId !== ctx.userId) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Cannot access another student application');
    }
    if (ctx.role !== Role.admin && application.workspaceId !== ctx.workspaceId) {
      throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
    }
  }

  async assertCanAccessEvidence(ctx: ChatbotToolContext, evidenceId: string): Promise<void> {
    const evidence = await prisma.evidence.findUnique({
      where: { id: evidenceId },
      select: { application: { select: { id: true, studentId: true, workspaceId: true } } },
    });
    if (!evidence) throw new AppError(404, ErrorCodes.EVIDENCE_NOT_FOUND, 'Evidence not found');
    if (ctx.role === Role.student && evidence.application?.studentId !== ctx.userId) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Cannot access another student evidence');
    }
    if (ctx.role !== Role.admin && evidence.application?.workspaceId !== ctx.workspaceId) {
      throw new AppError(404, ErrorCodes.EVIDENCE_NOT_FOUND, 'Evidence not found');
    }
  }

  async assertCanAccessReviewTask(ctx: ChatbotToolContext, taskId: string): Promise<void> {
    const task = await prisma.reviewTask.findUnique({
      where: { id: taskId },
      select: { assignedOfficerId: true, workspaceId: true },
    });
    if (!task) throw new AppError(404, ErrorCodes.REVIEW_TASK_NOT_FOUND, 'Review task not found');
    if (ctx.role === Role.officer && task.assignedOfficerId && task.assignedOfficerId !== ctx.userId) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Cannot access unrelated review task');
    }
    if (ctx.role !== Role.admin && task.workspaceId !== ctx.workspaceId) {
      throw new AppError(404, ErrorCodes.REVIEW_TASK_NOT_FOUND, 'Review task not found');
    }
  }
}
