import { IndexingStatus, JobStatus, SmartReaderJobStatus, type EvidenceStatus } from '@prisma/client';

export type EvidenceUxStep =
  | 'queued'
  | 'uploading_to_smartreader'
  | 'ocr_processing'
  | 'extracting_fields'
  | 'matching_registry'
  | 'indexed'
  | 'needs_manual_review'
  | 'failed';

export type EvidenceUxStatus = {
  step: EvidenceUxStep;
  label: string;
  message: string;
  nextAction: 'wait' | 'wait_for_ocr' | 'view_card' | 'fix_file' | 'request_support' | 'manual_review';
  severity: 'info' | 'success' | 'warning' | 'error';
  progressPercent: number | null;
  badges: Array<{ label: string; status: 'done' | 'active' | 'pending' | 'failed' }>;
};

export function mapEvidenceUxStatus(input: {
  indexingStatus?: IndexingStatus | string | null;
  evidenceStatus?: EvidenceStatus | string | null;
  jobStatus?: JobStatus | string | null;
  smartReaderStatus?: SmartReaderJobStatus | string | null;
  hasCard?: boolean;
  confidence?: number | null;
  errorCode?: string | null;
}): EvidenceUxStatus {
  const step = resolveStep(input);
  const copy = copyByStep[step];
  return {
    step,
    ...copy,
    progressPercent: progressByStep[step],
    badges: buildBadges(step),
  };
}

function resolveStep(input: {
  indexingStatus?: IndexingStatus | string | null;
  jobStatus?: JobStatus | string | null;
  smartReaderStatus?: SmartReaderJobStatus | string | null;
  hasCard?: boolean;
  confidence?: number | null;
  errorCode?: string | null;
}): EvidenceUxStep {
  if (input.jobStatus === JobStatus.failed || input.indexingStatus === IndexingStatus.failed || input.errorCode) {
    return 'failed';
  }
  if (input.indexingStatus === IndexingStatus.needs_manual_review || (input.confidence ?? 1) < 0.6) {
    return 'needs_manual_review';
  }
  if (input.indexingStatus === IndexingStatus.indexed || input.hasCard) return 'indexed';
  if (input.indexingStatus === IndexingStatus.checking_registry) return 'matching_registry';
  if (input.indexingStatus === IndexingStatus.extracting) return 'extracting_fields';
  if (
    input.smartReaderStatus === SmartReaderJobStatus.uploading ||
    input.smartReaderStatus === SmartReaderJobStatus.queued
  ) {
    return 'uploading_to_smartreader';
  }
  if (
    input.indexingStatus === IndexingStatus.ocr_processing ||
    input.jobStatus === JobStatus.processing ||
    input.smartReaderStatus === SmartReaderJobStatus.processing ||
    input.smartReaderStatus === SmartReaderJobStatus.polling
  ) {
    return 'ocr_processing';
  }
  return 'queued';
}

const copyByStep: Record<
  EvidenceUxStep,
  Pick<EvidenceUxStatus, 'label' | 'message' | 'nextAction' | 'severity'>
> = {
  queued: {
    label: 'Đã nhận minh chứng',
    message: 'File đã được lưu, hệ thống sẽ bắt đầu số hoá.',
    nextAction: 'wait_for_ocr',
    severity: 'info',
  },
  uploading_to_smartreader: {
    label: 'Đang gửi đến SmartReader',
    message: 'Hệ thống đang gửi file đến VNPT SmartReader để lấy mã xử lý.',
    nextAction: 'wait',
    severity: 'info',
  },
  ocr_processing: {
    label: 'Đang số hoá minh chứng',
    message: 'SmartReader đang đọc nội dung trong file. Bạn có thể rời trang và quay lại sau.',
    nextAction: 'wait',
    severity: 'info',
  },
  extracting_fields: {
    label: 'Đang tạo Evidence Card',
    message: 'Hệ thống đang rút trích thông tin quan trọng như tên hoạt động, ngày, đơn vị tổ chức.',
    nextAction: 'wait',
    severity: 'info',
  },
  matching_registry: {
    label: 'Đang đối chiếu kho minh chứng',
    message: 'Hệ thống đang kiểm tra minh chứng với các danh sách/sự kiện đã xác nhận.',
    nextAction: 'wait',
    severity: 'info',
  },
  indexed: {
    label: 'Đã số hoá xong',
    message: 'Minh chứng đã sẵn sàng để cán bộ xét duyệt.',
    nextAction: 'view_card',
    severity: 'success',
  },
  needs_manual_review: {
    label: 'Cần cán bộ kiểm tra',
    message: 'Hệ thống đã đọc được minh chứng nhưng còn điểm chưa chắc chắn.',
    nextAction: 'manual_review',
    severity: 'warning',
  },
  failed: {
    label: 'Số hoá chưa thành công',
    message: 'Hệ thống chưa đọc được file này. Vui lòng thử lại hoặc tải file rõ hơn.',
    nextAction: 'fix_file',
    severity: 'error',
  },
};

const progressByStep: Record<EvidenceUxStep, number | null> = {
  queued: 5,
  uploading_to_smartreader: 20,
  ocr_processing: 45,
  extracting_fields: 70,
  matching_registry: 85,
  indexed: 100,
  needs_manual_review: 100,
  failed: null,
};

function buildBadges(step: EvidenceUxStep): EvidenceUxStatus['badges'] {
  const order: EvidenceUxStep[] = [
    'queued',
    'uploading_to_smartreader',
    'ocr_processing',
    'extracting_fields',
    'indexed',
  ];
  const labels: Record<EvidenceUxStep, string> = {
    queued: 'Đã nhận file',
    uploading_to_smartreader: 'Đã gửi SmartReader',
    ocr_processing: 'Đã số hoá',
    extracting_fields: 'Đã tạo Evidence Card',
    matching_registry: 'Đã đối chiếu',
    indexed: 'Sẵn sàng xét duyệt',
    needs_manual_review: 'Cần kiểm tra',
    failed: 'Thất bại',
  };

  if (step === 'failed') {
    return order.map((item, index) => ({
      label: labels[item],
      status: index === 0 ? 'done' : 'failed',
    }));
  }

  const activeIndex = step === 'needs_manual_review' ? order.length - 1 : order.indexOf(step);
  return order.map((item, index) => ({
    label: labels[item],
    status: index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'pending',
  }));
}
