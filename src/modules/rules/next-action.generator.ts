import { Criterion, Level } from '@prisma/client';
import type { CriterionResult, MissingItem } from './rules.types';

export function generateNextBestAction(input: {
  criteriaResults: CriterionResult[];
  targetLevel: Level;
  missingItems: MissingItem[];
  warnings: string[];
  readyToSubmit?: boolean;
}): string {
  if (input.readyToSubmit) {
    return 'Hồ sơ đã đủ dữ liệu cơ bản để nộp xét duyệt. Kết quả cuối cùng vẫn cần cán bộ xác nhận.';
  }

  const missingCodes = new Set(input.missingItems.map((item) => item.code));
  if (missingCodes.has('MISSING_GPA')) {
    return 'Bạn cần nhập điểm trung bình học tập hoặc tải lên bảng điểm để hệ thống tiền kiểm tiêu chí học tập.';
  }
  if (missingCodes.has('MISSING_CONDUCT_SCORE')) {
    return 'Bạn cần bổ sung điểm rèn luyện hoặc minh chứng xác nhận để kiểm tra tiêu chí đạo đức.';
  }
  if (missingCodes.has('MISSING_VOLUNTEER_DAYS')) {
    return input.targetLevel === Level.city
      ? 'Hồ sơ hiện chưa đủ dữ liệu tình nguyện cho cấp Thành phố; bạn có thể bổ sung thêm minh chứng hoặc cân nhắc xét cấp phù hợp hơn.'
      : 'Bạn cần bổ sung minh chứng tình nguyện có số ngày tham gia hoặc import từ Kho sự kiện hợp lệ.';
  }
  if (input.warnings.includes('LOW_CONFIDENCE')) {
    return 'Minh chứng đã được đọc nhưng độ tin cậy thấp, bạn nên tải ảnh/PDF rõ hơn hoặc chờ cán bộ kiểm tra.';
  }

  const humanReview = input.criteriaResults.find((item) => item.status === 'human_review_required');
  if (humanReview) {
    return `Tiêu chí ${toVietnameseCriterion(humanReview.criterion)} có dữ liệu nhưng cần cán bộ xác nhận trước khi kết luận.`;
  }

  return 'Bạn cần bổ sung các dữ liệu còn thiếu để hệ thống có thể tiền kiểm hồ sơ rõ hơn.';
}

function toVietnameseCriterion(criterion: Criterion): string {
  if (criterion === Criterion.ethics) return 'đạo đức';
  if (criterion === Criterion.academic) return 'học tập';
  if (criterion === Criterion.physical) return 'thể lực';
  if (criterion === Criterion.volunteer) return 'tình nguyện';
  if (criterion === Criterion.integration) return 'hội nhập';
  return 'ưu tiên';
}
