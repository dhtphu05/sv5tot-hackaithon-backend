import { Role } from '@prisma/client';
import type { ChatbotAction, ChatbotPageContext, SafeChatbotContext } from './chatbot.types';

export function buildContextualActions(input: {
  text: string;
  context: SafeChatbotContext;
  pageContext?: ChatbotPageContext;
}): ChatbotAction[] {
  const role = input.context.role;
  if (role === Role.officer) return officerActions(input.pageContext);
  if (role === Role.manager) return managerActions();
  if (role === Role.committee || role === Role.admin) return committeeActions();
  return studentActions(input.pageContext);
}

function studentActions(pageContext?: ChatbotPageContext): ChatbotAction[] {
  const criterionQuery = pageContext?.criterion ? { criterion: pageContext.criterion } : undefined;
  if (pageContext?.page === 'evidence') {
    return [
      navigate('Upload minh chứng', '/app/evidence', criterionQuery),
      postback('Xem minh chứng hợp lệ', 'get_valid_evidence_examples'),
      navigate('Chạy tiền kiểm', '/app/ai-precheck'),
    ];
  }
  if (pageContext?.page === 'precheck' || pageContext?.page === 'cascade') {
    return [
      navigate('Xem Cascade Review', '/app/cascade'),
      navigate('Upload bổ sung', '/app/evidence', criterionQuery),
      postback('Hỏi cán bộ phụ trách', 'request_staff_help'),
    ];
  }
  return [
    postback('Xem hồ sơ còn thiếu gì', 'get_missing_items'),
    navigate('Xem Gap Analysis', '/app/ai-precheck'),
    navigate('Upload minh chứng', '/app/evidence'),
    navigate('Tìm trong Matching Hub', '/app/event-library'),
  ];
}

function officerActions(pageContext?: ChatbotPageContext): ChatbotAction[] {
  const reviewQuery = pageContext?.taskId ? { taskId: pageContext.taskId } : undefined;
  return [
    navigate('Mở Evidence Card', '/app/evidence-search', reviewQuery),
    postback('Tóm tắt minh chứng', 'summarize_evidence'),
    postback('Soạn yêu cầu bổ sung', 'draft_supplement_request'),
    postback('Tìm case tương tự', 'search_similar_cases'),
    navigate('Chuyển Resolution Hub', '/app/resolution', reviewQuery),
  ];
}

function managerActions(): ChatbotAction[] {
  return [
    navigate('Mở danh sách hồ sơ', '/app/manager/results'),
    navigate('Xem workload cán bộ', '/app/assignment'),
    navigate('Xem bottleneck', '/app/analytics'),
  ];
}

function committeeActions(): ChatbotAction[] {
  return [
    postback('Tóm tắt case', 'summarize_resolution_case'),
    postback('Tìm tiền lệ', 'search_resolution_precedents'),
    postback('Soạn lý do quyết định', 'draft_committee_decision'),
    postback('Ghi tiền lệ sau khi xác nhận', 'draft_knowledge_base_case'),
  ];
}

function navigate(label: string, route: string, query?: Record<string, string>): ChatbotAction {
  return {
    id: `act_nav_${slug(label)}`,
    label,
    type: 'navigate',
    route,
    query,
    requiresConfirmation: false,
  };
}

function postback(label: string, payload: string): ChatbotAction {
  return {
    id: `act_postback_${payload}`,
    label,
    type: 'postback',
    actionType: 'postback',
    payload: `fivetot://action/${payload}`,
    requiresConfirmation: false,
  };
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}
