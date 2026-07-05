import { officialResultCaveat } from './chatbot.guardrails';
import type { ChatbotAction, NormalizedSmartbotMessage, SafeChatbotContext } from './chatbot.types';

export type SchoolDemoToolResult = {
  type: 'action_cards';
  title: string;
  message: string;
  subtitle?: string;
  cards: NormalizedSmartbotMessage[];
  actions: ChatbotAction[];
  handoffRequired?: boolean;
};

export function getSchoolDemoGapAnalysis(_ctx: SafeChatbotContext): SchoolDemoToolResult {
  return {
    type: 'action_cards',
    title: 'Hồ sơ cấp Trường còn thiếu',
    message: [
      'Mình đã kiểm tra hồ sơ cấp Trường của bạn. Hiện có 2 điểm cần xử lý trước khi nộp hoàn chỉnh.',
      officialResultCaveat,
    ].join('\n'),
    subtitle: 'Mình đã kiểm tra hồ sơ cấp Trường của bạn. Hiện có 2 điểm cần xử lý.',
    cards: [
      {
        type: 'gap_item',
        title: 'Tình nguyện tốt',
        status: 'Cần bổ sung',
        description:
          'Đang ghi nhận 1/2 ngày tình nguyện. Với nhánh xét theo số ngày, tiêu chí cấp Trường cần ít nhất 2 ngày tình nguyện hoặc minh chứng tương đương.',
      },
      {
        type: 'gap_item',
        title: 'Thể lực tốt',
        status: 'Chưa có minh chứng',
        description:
          'Hồ sơ chưa có minh chứng thể lực phù hợp như điểm môn thể dục loại Khá trở lên, hoạt động thể thao hoặc xác nhận rèn luyện thể thao định kỳ.',
      },
    ],
    actions: [
      navigate('Tìm minh chứng tình nguyện', '/app/event-library', { criterion: 'volunteer' }),
      navigate('Upload minh chứng thể lực', '/app/evidence', { criterion: 'physical', action: 'upload' }),
      execute('Hỏi cán bộ phụ trách', 'createSchoolDemoHandoff', true),
    ],
  };
}

export function getSchoolDemoEvidenceSummary(_ctx: SafeChatbotContext): SchoolDemoToolResult {
  return {
    type: 'action_cards',
    title: 'Minh chứng hiện có trong hồ sơ cấp Trường',
    message: [
      'Mình đã kiểm tra dữ liệu hồ sơ cấp Trường. Hiện hồ sơ đã có một số minh chứng, nhưng vẫn còn điểm cần bổ sung.',
      officialResultCaveat,
    ].join('\n'),
    subtitle:
      'Mình đã kiểm tra dữ liệu hồ sơ cấp Trường. Hiện hồ sơ đã có một số minh chứng, nhưng vẫn còn điểm cần bổ sung.',
    cards: [
      {
        type: 'gap_item',
        title: 'Hiến máu nhân đạo đợt 1',
        status: 'Đã ghi nhận',
        description: 'Tiêu chí: Tình nguyện tốt. Giá trị quy đổi: 1 ngày tình nguyện.',
      },
      {
        type: 'gap_item',
        title: 'Bảng điểm học tập',
        status: 'Có dữ liệu',
        description: 'Tiêu chí: Học tập tốt. Dữ liệu dùng để đối chiếu GPA cấp Trường.',
      },
      {
        type: 'gap_item',
        title: 'Điểm rèn luyện',
        status: 'Có dữ liệu',
        description: 'Tiêu chí: Đạo đức tốt. Dữ liệu dùng để đối chiếu điểm rèn luyện cấp Trường.',
      },
      {
        type: 'gap_item',
        title: 'Thể lực tốt',
        status: 'Chưa có minh chứng',
        description: 'Hồ sơ cấp Trường chưa ghi nhận minh chứng phù hợp cho tiêu chí Thể lực tốt.',
      },
      {
        type: 'gap_item',
        title: 'Tình nguyện tốt',
        status: 'Cần kiểm tra thêm nếu xét theo số ngày',
        description: 'Đang ghi nhận 1/2 ngày tình nguyện; cần đối chiếu thêm nếu xét theo nhánh số ngày.',
      },
    ],
    actions: [
      navigate('Upload minh chứng thể lực', '/app/evidence', { criterion: 'physical', action: 'upload' }),
      navigate('Tìm minh chứng tình nguyện', '/app/event-library', { criterion: 'volunteer' }),
      postback('Xem hồ sơ còn thiếu gì', 'fivetot://action/get_missing_items'),
    ],
  };
}

export function searchSchoolDemoMatchingHub(_ctx: SafeChatbotContext): SchoolDemoToolResult {
  return {
    type: 'action_cards',
    title: 'Minh chứng tìm thấy trong Matching Hub',
    message: [
      'Đã tìm thấy minh chứng phù hợp với tiêu chí Tình nguyện tốt cấp Trường.',
      officialResultCaveat,
    ].join('\n'),
    subtitle: 'Đã tìm thấy minh chứng phù hợp với tiêu chí Tình nguyện tốt cấp Trường.',
    cards: [
      {
        type: 'matching_event',
        title: 'Mùa hè xanh 2025',
        status: 'Đã tìm thấy trong Matching Hub',
        description: 'Có thể dùng làm minh chứng tình nguyện cấp Trường nếu cán bộ xác nhận.',
      },
      {
        type: 'matching_event',
        title: 'Hiến máu nhân đạo đợt 1',
        status: 'Đã tìm thấy trong Matching Hub',
        description: 'Giá trị quy đổi: 1 ngày tình nguyện.',
      },
    ],
    actions: [
      execute('Thêm vào hồ sơ', 'addSchoolDemoEvidence', true),
      navigate('Xem Matching Hub', '/app/event-library', { criterion: 'volunteer' }),
      navigate('Upload thêm minh chứng', '/app/evidence', { criterion: 'volunteer', action: 'upload' }),
    ],
  };
}

export function getPostUploadEvidenceSummary(_ctx: SafeChatbotContext): SchoolDemoToolResult {
  return {
    type: 'action_cards',
    title: 'Tóm tắt minh chứng vừa upload',
    message: [
      'Hệ thống đã đọc được thông tin từ minh chứng: tên hoạt động, tiêu chí, thời gian hoặc số ngày và đơn vị xác nhận.',
      'Minh chứng đã được ghi nhận và sẽ được cán bộ xác nhận khi xét duyệt.',
      officialResultCaveat,
    ].join('\n'),
    subtitle: 'Minh chứng đã được ghi nhận và chờ cán bộ xác minh.',
    cards: [
      {
        type: 'evidence_summary',
        title: 'Thông tin đã đọc được',
        status: 'Đã đọc được minh chứng',
        description:
          'Tên hoạt động; Tiêu chí; Thời gian hoặc số ngày; Đơn vị xác nhận. Nếu thiếu thông tin, bạn có thể upload bổ sung hoặc ghi chú cho cán bộ.',
      },
    ],
    actions: [
      execute('Nộp minh chứng này', 'submitSchoolDemoEvidence', true),
      navigate('Upload file khác', '/app/evidence', { action: 'upload' }),
      postback('Thêm ghi chú', 'fivetot://action/add_evidence_note'),
    ],
  };
}

export function summarizeReviewerEvidence(_ctx: SafeChatbotContext): SchoolDemoToolResult {
  return {
    type: 'action_cards',
    title: 'Tóm tắt minh chứng cho cán bộ',
    message: [
      'Mình đã tóm tắt dữ liệu minh chứng ở mức hỗ trợ nghiệp vụ. Cán bộ cần đọc hồ sơ gốc trước khi ra quyết định.',
      officialResultCaveat,
    ].join('\n'),
    subtitle: 'Tóm tắt nhanh để cán bộ rà soát, không tự động gửi quyết định.',
    cards: [
      {
        type: 'evidence_summary',
        title: 'Minh chứng tình nguyện',
        status: 'Cần cán bộ xác minh',
        description:
          'Có thông tin hoạt động, thời gian tham gia và đơn vị xác nhận. Cần đối chiếu với quy đổi ngày tình nguyện cấp Trường.',
      },
      {
        type: 'evidence_summary',
        title: 'Minh chứng thể lực',
        status: 'Còn thiếu',
        description:
          'Chưa thấy file thể hiện điểm thể dục loại Khá trở lên, Sinh viên khỏe hoặc xác nhận rèn luyện thể thao định kỳ.',
      },
    ],
    actions: [
      postback('Soạn yêu cầu bổ sung', 'Soạn yêu cầu bổ sung'),
      navigate('Chuyển Resolution Hub', '/app/resolution'),
    ],
  };
}

export function draftReviewerSupplementRequest(_ctx: SafeChatbotContext): SchoolDemoToolResult {
  return {
    type: 'action_cards',
    title: 'Dự thảo yêu cầu bổ sung',
    message:
      'Dự thảo đã được chuẩn bị để cán bộ chỉnh sửa và xác nhận trước khi gửi. Hệ thống không tự động gửi yêu cầu này.',
    subtitle: 'Cán bộ cần chỉnh sửa/xác nhận trước khi gửi cho sinh viên.',
    cards: [
      {
        type: 'reviewer_draft',
        title: 'Nội dung dự thảo',
        status: 'Cần cán bộ xác minh',
        description:
          'Sinh viên vui lòng bổ sung minh chứng Thể lực tốt hoặc giấy xác nhận rèn luyện thể thao định kỳ; đồng thời làm rõ minh chứng Tình nguyện tốt nếu xét theo số ngày tham gia.',
      },
    ],
    actions: [
      execute('Dùng dự thảo này', 'useSupplementDraft', true),
      postback('Soạn yêu cầu bổ sung', 'Chỉnh sửa dự thảo yêu cầu bổ sung'),
      navigate('Chuyển Resolution Hub', '/app/resolution'),
    ],
  };
}

export function createSchoolDemoHandoff(_ctx: SafeChatbotContext): SchoolDemoToolResult {
  return {
    type: 'action_cards',
    title: 'Tạo yêu cầu hỗ trợ cán bộ',
    message: [
      'Mình sẽ chuyển trường hợp này thành yêu cầu hỗ trợ để cán bộ phụ trách kiểm tra thêm.',
      officialResultCaveat,
    ].join('\n'),
    handoffRequired: true,
    cards: [
      {
        type: 'handoff',
        title: 'Cần cán bộ xác minh',
        status: 'Đang tạo yêu cầu hỗ trợ',
        description:
          'Một số thông tin trong hồ sơ cần người có thẩm quyền kiểm tra. Bot không chốt kết quả.',
      },
    ],
    actions: [
      navigate('Mở thông báo', '/app/notifications'),
      navigate('Quay lại hồ sơ', '/app'),
    ],
  };
}

function navigate(label: string, route: string, query?: Record<string, string>): ChatbotAction {
  return {
    id: `act_school_nav_${slug(label)}`,
    label,
    type: 'navigate',
    route,
    query,
    requiresConfirmation: false,
  };
}

function execute(label: string, toolName: string, requiresConfirmation: boolean): ChatbotAction {
  return {
    id: `act_school_exec_${slug(label)}`,
    label,
    type: 'execute',
    actionType: 'internal_action',
    toolName,
    payload: `fivetot://action/${toolName}`,
    requiresConfirmation,
  };
}

function postback(label: string, payload: string): ChatbotAction {
  return {
    id: `act_school_postback_${slug(label)}`,
    label,
    type: 'postback',
    actionType: 'internal_action',
    payload,
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
