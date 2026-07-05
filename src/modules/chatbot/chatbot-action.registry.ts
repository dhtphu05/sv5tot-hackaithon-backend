import { Role } from '@prisma/client';
import type { ChatbotContextScope } from './chatbot.types';

export type ChatbotTool = {
  name: string;
  kind: 'read' | 'mutation';
  roles: Role[];
  requiresConfirmation: boolean;
  implemented: boolean;
};

export const chatbotToolRegistry: ChatbotTool[] = [
  readTool('getCurrentApplication', Role.student, Role.class_representative),
  readTool('getGapAnalysis', Role.student, Role.class_representative),
  readTool('getChecklist', Role.student, Role.class_representative),
  readTool('getDeadline', Role.student, Role.class_representative),
  readTool('getEvidenceCard', Role.student, Role.officer, Role.manager, Role.committee, Role.admin),
  readTool('searchMatchingHub', Role.student, Role.officer, Role.manager, Role.admin),
  readTool('getOfficerTasks', Role.officer),
  readTool('getReviewTaskDetail', Role.officer, Role.manager, Role.committee, Role.admin),
  readTool('searchKnowledgeBase', Role.officer, Role.manager, Role.committee, Role.admin),
  readTool('draftSupplementRequest', Role.officer, Role.manager, Role.admin),
  readTool('getManagerDashboard', Role.manager, Role.admin),
  readTool('getOfficerWorkload', Role.manager, Role.admin),
  readTool('getBottlenecks', Role.manager, Role.admin),
  readTool('getResolutionCases', Role.committee, Role.manager, Role.admin),
  readTool('getResolutionCaseDetail', Role.committee, Role.manager, Role.admin),
  readTool('searchSimilarResolutionCases', Role.committee, Role.manager, Role.admin),
  readTool('draftCommitteeDecision', Role.committee, Role.admin),
  mutationTool('importEventEvidence', Role.student),
  mutationTool('createSupplementRequest', Role.officer, Role.manager, Role.admin),
  mutationTool('escalateToResolution', Role.officer, Role.manager, Role.admin),
  mutationTool('reassignReviewTask', Role.manager, Role.admin),
  mutationTool('exportApplicationList', Role.manager, Role.admin),
  mutationTool('createCommitteeDecision', Role.committee, Role.admin),
  mutationTool('createKnowledgeBaseItemFromCase', Role.committee, Role.admin),
];

export function listAvailableReadTools(role: Role, _scope: ChatbotContextScope): string[] {
  return chatbotToolRegistry
    .filter((tool) => tool.kind === 'read' && tool.roles.includes(role))
    .map((tool) => tool.name);
}

function readTool(name: string, ...roles: Role[]): ChatbotTool {
  return { name, kind: 'read', roles, requiresConfirmation: false, implemented: true };
}

function mutationTool(name: string, ...roles: Role[]): ChatbotTool {
  return { name, kind: 'mutation', roles, requiresConfirmation: true, implemented: false };
}
