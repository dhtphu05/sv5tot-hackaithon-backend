import { DecisionImportStatus, JobStatus, SmartReaderJobStatus } from '@prisma/client';

export type DecisionImportUxStatus = {
  state:
    | 'draft'
    | 'ready_to_start'
    | 'queued'
    | 'processing'
    | 'preview_ready'
    | 'confirmed'
    | 'failed'
    | 'cancelled';
  label: string;
  retryable: boolean;
};

export function mapDecisionImportUxStatus(input: {
  status: DecisionImportStatus;
  metadataJobStatus?: JobStatus | null;
  rosterJobStatus?: JobStatus | null;
  smartReaderStatus?: SmartReaderJobStatus | null;
  previewRowCount?: number;
}): DecisionImportUxStatus {
  if (input.status === DecisionImportStatus.cancelled) {
    return { state: 'cancelled', label: 'Đã hủy', retryable: false };
  }
  if (input.status === DecisionImportStatus.confirmed) {
    return { state: 'confirmed', label: 'Đã xác nhận vào Event Registry', retryable: false };
  }
  if (input.status === DecisionImportStatus.failed) {
    return { state: 'failed', label: 'Xử lý thất bại', retryable: true };
  }
  if (input.status === DecisionImportStatus.preview_ready || (input.previewRowCount ?? 0) > 0) {
    return { state: 'preview_ready', label: 'Sẵn sàng kiểm tra preview', retryable: false };
  }
  if (input.status === DecisionImportStatus.uploaded) {
    return { state: 'ready_to_start', label: 'Đã upload, chờ bắt đầu OCR', retryable: false };
  }
  if (
    input.status === DecisionImportStatus.extracting_metadata &&
    (input.metadataJobStatus === JobStatus.queued || input.rosterJobStatus === JobStatus.queued) &&
    !input.smartReaderStatus
  ) {
    return { state: 'queued', label: 'Đã xếp hàng, chờ worker xử lý OCR', retryable: false };
  }
  if (
    input.status === DecisionImportStatus.extracting_metadata ||
    input.status === DecisionImportStatus.ocr_processing ||
    input.status === DecisionImportStatus.parsing_roster ||
    input.metadataJobStatus === JobStatus.processing ||
    input.rosterJobStatus === JobStatus.processing ||
    input.smartReaderStatus === SmartReaderJobStatus.processing ||
    input.smartReaderStatus === SmartReaderJobStatus.polling
  ) {
    return { state: 'processing', label: 'Đang xử lý OCR thật qua VNPT', retryable: false };
  }
  return { state: 'draft', label: 'Bản nháp', retryable: false };
}
