import type { EvidenceStatus, IndexingStatus, JobStatus } from '@prisma/client';

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
  smartReaderStatus?: string | null;
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
  smartReaderStatus?: string | null;
  hasCard?: boolean;
  confidence?: number | null;
  errorCode?: string | null;
}): EvidenceUxStep {
  const jobStatus = String(input.jobStatus ?? '');
  const indexingStatus = String(input.indexingStatus ?? '');
  const smartReaderStatus = String(input.smartReaderStatus ?? '');

  if (jobStatus === 'failed' || indexingStatus === 'failed' || input.errorCode) {
    return 'failed';
  }
  if (indexingStatus === 'needs_manual_review' || (input.confidence ?? 1) < 0.6) {
    return 'needs_manual_review';
  }
  if (indexingStatus === 'indexed' || input.hasCard) return 'indexed';
  if (indexingStatus === 'checking_registry') return 'matching_registry';
  if (indexingStatus === 'extracting') return 'extracting_fields';
  if (smartReaderStatus === 'uploading' || smartReaderStatus === 'queued') {
    return 'uploading_to_smartreader';
  }
  if (
    indexingStatus === 'ocr_processing' ||
    jobStatus === 'processing' ||
    smartReaderStatus === 'processing' ||
    smartReaderStatus === 'polling'
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
    message: 'File đã được lưu, hệ thống sẽ bắt đầu đọc dữ liệu.',
    nextAction: 'wait_for_ocr',
    severity: 'info',
  },
  uploading_to_smartreader: {
    label: 'Đang gửi file để xử lý',
    message: 'Hệ thống đang gửi file để lấy mã xử lý.',
    nextAction: 'wait',
    severity: 'info',
  },
  ocr_processing: {
    label: 'Đang đọc minh chứng',
    message: 'Hệ thống đang đọc nội dung trong file. Bạn có thể rời trang và quay lại sau.',
    nextAction: 'wait',
    severity: 'info',
  },
  extracting_fields: {
    label: 'Đang trích xuất thông tin',
    message: 'Hệ thống đang rút trích thông tin quan trọng như tên hoạt động, ngày, đơn vị tổ chức.',
    nextAction: 'wait',
    severity: 'info',
  },
  matching_registry: {
    label: 'Đang đối chiếu sự kiện đã xác nhận',
    message: 'Hệ thống đang kiểm tra minh chứng với các danh sách hoặc sự kiện đã xác nhận.',
    nextAction: 'wait',
    severity: 'info',
  },
  indexed: {
    label: 'Đã đọc xong',
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
    label: 'Chưa đọc được file',
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
    uploading_to_smartreader: 'Đã gửi xử lý',
    ocr_processing: 'Đã đọc file',
    extracting_fields: 'Đã trích xuất',
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
