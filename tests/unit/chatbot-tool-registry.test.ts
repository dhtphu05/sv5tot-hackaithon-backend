import { describe, expect, it } from 'vitest';
import { callChatbotTool, getChatbotTool } from '../../src/modules/chatbot/tools/chatbot-tool.registry';
import { AppError } from '../../src/shared/errors/app-error';
import { ErrorCodes } from '../../src/shared/errors/error-codes';

describe('chatbot tool registry', () => {
  it('rejects unknown tools', () => {
    expect(() => getChatbotTool('unknownTool')).toThrow(AppError);
    try {
      getChatbotTool('unknownTool');
    } catch (error) {
      expect(error).toMatchObject({ code: ErrorCodes.NOT_FOUND });
    }
  });

  it('enforces role permissions before running a tool', async () => {
    await expect(
      callChatbotTool(
        {
          userId: '2e2031e8-bd75-4d93-9b7a-78a8f31f4e22',
          workspaceId: null,
          role: 'student',
          sessionId: 'session-1',
          requestId: 'request-1',
        },
        'getOfficerTasks',
        {},
      ),
    ).rejects.toMatchObject({ code: ErrorCodes.FORBIDDEN });
  });
});
