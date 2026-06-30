import { env } from '../../config/env';

export type SmartReaderEvidenceResult = {
  ocrText: string;
  extractedFields: {
    studentName?: string;
    studentCode?: string;
    activityName?: string;
    issuedDate?: string;
    organizer?: string;
    organizerLevel?: string;
    criterionHint?: string | null;
    volunteerDays?: number;
    gpa?: number;
    conductScore?: number;
    languageCertificate?: string;
    certificateType?: string;
  };
  quality: {
    readability: number;
    hasSignatureOrStamp: boolean;
    isBlurred: boolean;
  };
  raw: Record<string, unknown>;
};

export type SmartReaderFileMetadata = {
  originalName: string;
  mimeType: string;
};

export class VnptSmartReaderClient {
  async extractEvidence(file: SmartReaderFileMetadata): Promise<SmartReaderEvidenceResult> {
    if (env.VNPT_MODE !== 'mock') {
      // Live integration will be wired in a later phase with provider credentials and retries.
      return this.mockExtract(file);
    }

    return this.mockExtract(file);
  }

  private mockExtract(file: SmartReaderFileMetadata): SmartReaderEvidenceResult {
    const normalizedName = normalize(file.originalName);
    const isBlurred =
      normalizedName.includes('blur') ||
      normalizedName.includes('mo') ||
      normalizedName.includes('missing');

    const base = {
      studentName: 'Nguyễn Văn Sinh',
      studentCode: '102220001',
      issuedDate: normalizedName.includes('missing') ? undefined : '2025-06-15',
      organizer: normalizedName.includes('missing') ? undefined : 'Đoàn Thanh niên - Hội Sinh viên',
      organizerLevel: 'university',
      certificateType: 'certificate',
    };

    if (
      normalizedName.includes('tinh-nguyen') ||
      normalizedName.includes('volunteer') ||
      normalizedName.includes('mua-he-xanh')
    ) {
      return this.result(file, isBlurred, {
        ...base,
        activityName: 'Mùa hè xanh 2025',
        criterionHint: 'volunteer',
        volunteerDays: 3,
      });
    }

    if (
      normalizedName.includes('bang-diem') ||
      normalizedName.includes('gpa') ||
      normalizedName.includes('hoc-tap')
    ) {
      return this.result(file, isBlurred, {
        ...base,
        activityName: 'Bảng điểm học tập',
        criterionHint: 'academic',
        gpa: 3.45,
      });
    }

    if (normalizedName.includes('ren-luyen') || normalizedName.includes('dao-duc')) {
      return this.result(file, isBlurred, {
        ...base,
        activityName: 'Điểm rèn luyện',
        criterionHint: 'ethics',
        conductScore: 88,
      });
    }

    if (
      normalizedName.includes('the-luc') ||
      normalizedName.includes('sport') ||
      normalizedName.includes('sinh-vien-khoe')
    ) {
      return this.result(file, isBlurred, {
        ...base,
        activityName: 'Sinh viên khỏe',
        criterionHint: 'physical',
      });
    }

    if (
      normalizedName.includes('ielts') ||
      normalizedName.includes('toeic') ||
      normalizedName.includes('ngoai-ngu') ||
      normalizedName.includes('hoi-nhap')
    ) {
      return this.result(file, isBlurred, {
        ...base,
        activityName: 'Chứng chỉ ngoại ngữ',
        criterionHint: 'integration',
        languageCertificate: normalizedName.includes('ielts') ? 'IELTS 5.5' : 'TOEIC 550',
      });
    }

    return this.result(file, isBlurred, {
      ...base,
      activityName: 'Minh chứng chưa phân loại',
      criterionHint: null,
    });
  }

  private result(
    file: SmartReaderFileMetadata,
    isBlurred: boolean,
    extractedFields: SmartReaderEvidenceResult['extractedFields'],
  ): SmartReaderEvidenceResult {
    return {
      ocrText: `Kết quả OCR mô phỏng từ ${file.originalName}. Hoạt động: ${
        extractedFields.activityName ?? 'chưa xác định'
      }.`,
      extractedFields,
      quality: {
        readability: isBlurred ? 0.45 : extractedFields.criterionHint ? 0.9 : 0.62,
        hasSignatureOrStamp: !isBlurred,
        isBlurred,
      },
      raw: {
        provider: 'mock-smartreader',
        fileName: file.originalName,
        mimeType: file.mimeType,
      },
    };
  }
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
