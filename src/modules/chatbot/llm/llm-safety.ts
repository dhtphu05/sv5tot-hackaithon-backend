import type { SafeChatbotContext } from '../chatbot.types';

export function sanitizeTextForLlm(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/(?:\+?84|0)(?:\d[\s.-]?){8,10}\d/g, '[phone]')
    .replace(/\b(?:mssv|student\s*code|mã\s*sinh\s*viên)\s*[:#-]?\s*[A-Za-z0-9_-]{4,20}\b/gi, '[student_code]')
    .replace(/\b\d{8,12}\b/g, '[numeric_id]')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
}

export function safeContextForLlm(context: SafeChatbotContext): Record<string, string | undefined> {
  return {
    role: context.role,
    contextScope: context.contextScope,
    currentPage: context.currentPage,
    targetLevel: context.targetLevel,
    applicationStatus: context.applicationStatus,
    criterion: context.criterion,
    missingSummary: context.missingSummary,
    deadlineSummary: context.deadlineSummary,
    nextAction: context.nextAction,
    taskSummary: context.taskSummary,
  };
}
