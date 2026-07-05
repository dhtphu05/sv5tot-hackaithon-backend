import { AppError } from '../../../shared/errors/app-error';
import { ErrorCodes } from '../../../shared/errors/error-codes';
import { committeeTools } from './committee.tools';
import { managerTools } from './manager.tools';
import { officerTools } from './officer.tools';
import { studentTools } from './student.tools';
import type { ChatbotToolContext, ChatbotToolDefinition } from './chatbot-tool.types';

export const chatbotToolDefinitions: ChatbotToolDefinition[] = [
  ...studentTools,
  ...officerTools,
  ...managerTools,
  ...committeeTools,
];

const registry = new Map(chatbotToolDefinitions.map((tool) => [tool.name, tool]));

export function getChatbotTool(name: string): ChatbotToolDefinition {
  const tool = registry.get(name);
  if (!tool) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, 'Unknown chatbot tool');
  }
  return tool;
}

export async function callChatbotTool(ctx: ChatbotToolContext, name: string, input: unknown) {
  const tool = getChatbotTool(name);
  if (!tool.requiredRoles.includes(ctx.role)) {
    throw new AppError(403, ErrorCodes.FORBIDDEN, 'Role cannot call chatbot tool');
  }
  if (tool.mode === 'mutation_requires_confirm') {
    throw new AppError(
      409,
      ErrorCodes.MUTATION_ACTION_NOT_ENABLED,
      'Hành động này cần luồng xác nhận nghiệp vụ riêng và chưa được bật trong MVP.',
    );
  }
  const parsed = tool.inputSchema.parse(input);
  return tool.handler(ctx, parsed);
}
