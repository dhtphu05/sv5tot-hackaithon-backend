import { Role } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import type { ChatbotContextScope, ChatbotPageContext, SafeChatbotContext } from './chatbot.types';

export async function buildSafeChatbotContext(input: {
  user: AuthenticatedUser;
  applicationId?: string;
  contextScope?: ChatbotContextScope;
  pageContext?: ChatbotPageContext;
}): Promise<SafeChatbotContext> {
  const contextScope = input.contextScope ?? scopeForRole(input.user.role);
  const application = input.applicationId
    ? await prisma.application.findUnique({
        where: { id: input.applicationId },
        select: {
          id: true,
          studentId: true,
          targetLevel: true,
          status: true,
          precheckResults: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { missingItemsJson: true, nextBestAction: true },
          },
        },
      })
    : await findCurrentStudentApplication(input.user);

  if (input.applicationId && !application) {
    throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
  }

  if (application && input.user.role === Role.student && application.studentId !== input.user.id) {
    throw new AppError(403, ErrorCodes.APPLICATION_OWNER_REQUIRED, 'You can only use your own application context');
  }

  const taskSummary = input.pageContext?.taskId
    ? await buildTaskSummary(input.user, input.pageContext.taskId)
    : undefined;

  return {
    role: input.user.role,
    contextScope,
    currentPage: input.pageContext?.page ?? 'dashboard',
    targetLevel: application?.targetLevel ?? 'school',
    applicationStatus: application?.status ?? 'prechecked',
    criterion: input.pageContext?.criterion,
    missingSummary:
      summarizeMissing(application?.precheckResults[0]?.missingItemsJson) ??
      'Thiếu minh chứng Thể lực tốt; Tình nguyện mới ghi nhận 1/2 ngày',
    deadlineSummary: 'Hạn nộp/bổ sung: 30/10',
    nextAction:
      application?.precheckResults[0]?.nextBestAction ??
      'Tìm minh chứng tình nguyện hoặc upload minh chứng thể lực',
    taskSummary,
  };
}

export function toSmartbotButtonVariables(context: SafeChatbotContext) {
  const smartbotRole = context.contextScope === 'student_helpdesk' ? Role.student : context.role;
  return [
    { variableName: 'role', value: smartbotRole },
    { variableName: 'context_scope', value: context.contextScope },
    ...(context.currentPage ? [{ variableName: 'current_page', value: context.currentPage }] : []),
    ...(context.targetLevel ? [{ variableName: 'target_level', value: context.targetLevel }] : []),
    ...(context.applicationStatus
      ? [{ variableName: 'application_status', value: context.applicationStatus }]
      : []),
    ...(context.criterion ? [{ variableName: 'criterion', value: context.criterion }] : []),
    ...(context.missingSummary
      ? [{ variableName: 'missing_summary', value: context.missingSummary }]
      : []),
    ...(context.deadlineSummary
      ? [{ variableName: 'deadline_summary', value: context.deadlineSummary }]
      : []),
    ...(context.nextAction ? [{ variableName: 'next_action', value: context.nextAction }] : []),
    ...(context.taskSummary ? [{ variableName: 'task_summary', value: context.taskSummary }] : []),
  ];
}

export function buildSmartbotPrompts(context: SafeChatbotContext) {
  return {
    system_prompt:
      'You are a contextual 5TOT workflow copilot. Help users understand criteria, evidence, deadlines, and workflow actions. Never decide official pass/fail or update final results.',
    advance_prompt: [
      `Role: ${context.role}`,
      `Scope: ${context.contextScope}`,
      context.currentPage ? `Current page: ${context.currentPage}` : '',
      context.applicationStatus ? `Application status: ${context.applicationStatus}` : '',
      context.targetLevel ? `Target level: ${context.targetLevel}` : '',
      context.criterion ? `Criterion: ${context.criterion}` : '',
      context.missingSummary ? `Missing summary: ${context.missingSummary}` : '',
      context.deadlineSummary ? `Deadline summary: ${context.deadlineSummary}` : '',
      context.nextAction ? `Next action: ${context.nextAction}` : '',
      'Use only safe contextual variables. Do not ask for or reveal passwords, email, phone, raw student code, raw OCR text, or file URLs.',
      'Every answer about official results must say: Hệ thống chỉ hỗ trợ tiền kiểm và giải thích. Kết quả chính thức do cán bộ/Hội đồng xác nhận.',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

async function findCurrentStudentApplication(user: AuthenticatedUser) {
  if (user.role !== Role.student) return null;
  return prisma.application.findFirst({
    where: { studentId: user.id },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      studentId: true,
      targetLevel: true,
      status: true,
      precheckResults: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { missingItemsJson: true, nextBestAction: true },
      },
    },
  });
}

async function buildTaskSummary(user: AuthenticatedUser, taskId: string): Promise<string | undefined> {
  const task = await prisma.reviewTask.findUnique({
    where: { id: taskId },
    select: {
      criterion: true,
      status: true,
      assignedOfficerId: true,
      application: { select: { student: { select: { faculty: true } } } },
    },
  });
  if (!task) return undefined;
  if (user.role === Role.officer && task.assignedOfficerId && task.assignedOfficerId !== user.id) {
    return undefined;
  }
  return `criterion=${task.criterion}; status=${task.status}`;
}

function summarizeMissing(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return `${Math.min(value.length, 5)} mục cần kiểm tra/bổ sung`;
}

function scopeForRole(role: Role): ChatbotContextScope {
  if (role === Role.officer) return 'reviewer_copilot';
  if (role === Role.manager) return 'manager_assistant';
  if (role === Role.committee || role === Role.admin) return 'committee_assistant';
  return 'student_helpdesk';
}
