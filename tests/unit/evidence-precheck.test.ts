import { Criterion } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { buildEvidencePrecheckResult } from '../../src/modules/evidences/evidence-precheck';
import type { EvidenceDocumentAnalysisResult } from '../../src/modules/ai/evidence-analysis';

const baseAnalysis: EvidenceDocumentAnalysisResult = {
  provider: 'openai',
  providerModel: 'test-model',
  promptVersion: 'evidence-card-v1',
  documentType: 'certificate',
  documentFacts: {
    documentTitle: 'Giấy chứng nhận tình nguyện',
    identity: { studentName: 'Nguyen Van A', studentCode: '102220001', schoolName: null },
    activity: { eventName: 'Mua he xanh', programName: null, location: null, activityDate: null },
    organization: { issuerName: 'Hoi Sinh vien', issuerLevel: 'school' },
    conductEntries: [],
    fitness: { title: null, resultLevel: null, sportName: null },
    language: { certificateType: null, score: null, frameworkLevel: null },
    award: { title: null, rank: null, level: null },
    academic: { gpa: null, gpaScale: null, hasFGrade: null },
  },
  fields: {
    student_name: { value: 'Nguyen Van A', confidence: 0.9, source: 'openai' },
    student_code: { value: '102220001', confidence: 0.9, source: 'openai' },
    class_name: { value: null, confidence: 0, source: 'openai' },
    faculty: { value: null, confidence: 0, source: 'openai' },
    event_name: { value: 'Mua he xanh', confidence: 0.88, source: 'openai' },
    organizer: { value: 'Hoi Sinh vien', confidence: 0.84, source: 'openai' },
    organizer_level: { value: 'school', confidence: 0.7, source: 'openai' },
    issue_date: { value: '2026-07-01', confidence: 0.72, source: 'openai' },
    activity_date: { value: null, confidence: 0, source: 'openai' },
    award_level: { value: null, confidence: 0, source: 'openai' },
    volunteer_days: { value: 3, confidence: 0.8, source: 'openai' },
    certificate_type: { value: 'certificate', confidence: 0.75, source: 'openai' },
    language_score: { value: null, confidence: 0, source: 'openai' },
    gpa: { value: null, confidence: 0, source: 'openai' },
    conduct_score: { value: null, confidence: 0, source: 'openai' },
  },
  suggestedCriteria: [{ criterion: Criterion.volunteer, confidence: 0.78, reason: 'Volunteer certificate' }],
  documentPrecheck: {
    identifiedAs: {
      documentLabel: 'Giấy chứng nhận tình nguyện',
      shortDescription: 'Tài liệu xác nhận hoạt động tình nguyện.',
    },
    completeness: {
      score: 0.9,
      availableFields: ['student_name', 'student_code', 'event_name', 'organizer', 'issue_date'],
      missingImportantFields: [],
    },
    quality: { level: 'clear', issues: [] },
    relevance: [{ criterion: Criterion.volunteer, level: 'strong', explanation: 'Phù hợp tình nguyện.' }],
  },
  warnings: [],
  summary: 'Certificate for Mua he xanh.',
  overallConfidence: 0.86,
  requiresHumanConfirmation: true,
};

describe('buildEvidencePrecheckResult', () => {
  it('creates a confirmation-ready document precheck without official approval language', () => {
    const result = buildEvidencePrecheckResult({
      evidenceId: 'evidence-1',
      revision: 2,
      generatedAt: new Date('2026-07-21T12:00:00Z'),
      analysis: baseAnalysis,
      matchedProfile: { fullName: 'Nguyen Van A', studentCode: '102220001' },
    });

    expect(result.status).toBe('ready_for_confirmation');
    expect(result.recommendedAction).toBe('confirm_card');
    expect(result.confirmationRequired).toBe(true);
    expect(result.overallScore).toBeGreaterThan(70);
    expect(result.availableFacts.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toMatch(/approved|passed|đã duyệt|đạt tiêu chí/i);
  });

  it('flags missing date and organizer fields as friendly warnings', () => {
    const analysis = {
      ...baseAnalysis,
      fields: {
        ...baseAnalysis.fields,
        organizer: { value: null, confidence: 0, source: 'openai' as const },
        organizer_level: { value: null, confidence: 0, source: 'openai' as const },
        issue_date: { value: null, confidence: 0, source: 'openai' as const },
      },
      documentFacts: {
        ...baseAnalysis.documentFacts,
        activity: { eventName: 'Mua he xanh', programName: null, location: null, activityDate: null },
        organization: { issuerName: null, issuerLevel: null },
      },
    };

    const result = buildEvidencePrecheckResult({
      evidenceId: 'evidence-1',
      revision: 1,
      generatedAt: new Date('2026-07-21T12:00:00Z'),
      analysis,
    });

    expect(result.status).toBe('needs_attention');
    expect(result.recommendedAction).toBe('correct_card');
    expect(result.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(['missing_organizer', 'missing_issue_date']),
    );
    expect(result.warnings.map((warning) => warning.code)).not.toContain('missing_organizer_level');
  });

  it('asks for replacement when the file is not readable enough', () => {
    const result = buildEvidencePrecheckResult({
      evidenceId: 'evidence-1',
      revision: 1,
      generatedAt: new Date('2026-07-21T12:00:00Z'),
      analysis: {
        ...baseAnalysis,
        documentFacts: {
          documentTitle: null,
          identity: { studentName: null, studentCode: null, schoolName: null },
          activity: { eventName: null, programName: null, location: null, activityDate: null },
          organization: { issuerName: null, issuerLevel: null },
          conductEntries: [],
          fitness: { title: null, resultLevel: null, sportName: null },
          language: { certificateType: null, score: null, frameworkLevel: null },
          award: { title: null, rank: null, level: null },
          academic: { gpa: null, gpaScale: null, hasFGrade: null },
        },
        fields: Object.fromEntries(
          Object.entries(baseAnalysis.fields).map(([key, field]) => [
            key,
            { ...field, value: null, confidence: null },
          ]),
        ) as EvidenceDocumentAnalysisResult['fields'],
        documentPrecheck: {
          ...baseAnalysis.documentPrecheck,
          identifiedAs: {
            documentLabel: '',
            shortDescription: '',
          },
          quality: { level: 'poor', issues: ['blurred'] },
        },
      },
    });

    expect(result.status).toBe('file_not_readable');
    expect(result.recommendedAction).toBe('replace_file');
  });

  it('does not require event fields for conduct-result documents', () => {
    const result = buildEvidencePrecheckResult({
      evidenceId: 'evidence-1',
      revision: 1,
      generatedAt: new Date('2026-07-21T12:00:00Z'),
      analysis: {
        ...baseAnalysis,
        documentType: 'conduct_result',
        documentFacts: {
          ...baseAnalysis.documentFacts,
          documentTitle: 'Kết quả rèn luyện',
          conductEntries: [
            { semester: '2', schoolYear: '2024-2025', score: 91, classification: 'Xuất sắc' },
          ],
        },
        fields: {
          ...baseAnalysis.fields,
          event_name: { value: null, confidence: 0, source: 'openai' },
          organizer: { value: 'Trường Đại học Bách khoa - Đại học Đà Nẵng', confidence: 0.8, source: 'openai' },
          organizer_level: { value: 'university', confidence: 0.6, source: 'openai' },
          volunteer_days: { value: null, confidence: 0, source: 'openai' },
          conduct_score: { value: 91, confidence: 0.9, source: 'openai' },
        },
        documentPrecheck: {
          ...baseAnalysis.documentPrecheck,
          identifiedAs: {
            documentLabel: 'Kết quả rèn luyện',
            shortDescription: 'Bảng kết quả rèn luyện theo học kỳ.',
          },
          completeness: {
            score: 0.9,
            availableFields: ['student_name', 'student_code', 'conduct_score', 'organizer'],
            missingImportantFields: [],
          },
          relevance: [{ criterion: Criterion.ethics, level: 'strong', explanation: 'Phù hợp tiêu chí đạo đức.' }],
        },
      },
      matchedProfile: { fullName: 'Nguyen Van A', studentCode: '102220001' },
    });

    expect(result.warnings.map((warning) => warning.code)).not.toContain('missing_event_name');
    expect(result.status).toBe('ready_for_confirmation');
    expect(result.availableFacts.some((fact) => fact.key === 'conduct_entry_1')).toBe(true);
  });

  it('does not classify a readable Student Healthy certificate as unreadable when issuer level is missing', () => {
    const result = buildEvidencePrecheckResult({
      evidenceId: 'evidence-healthy',
      revision: 1,
      generatedAt: new Date('2026-07-21T12:00:00Z'),
      analysis: {
        ...baseAnalysis,
        documentType: 'student_healthy_certificate',
        documentFacts: {
          ...baseAnalysis.documentFacts,
          documentTitle: 'Chứng nhận Sinh viên khỏe',
          identity: { studentName: 'Nguyen Van A', studentCode: null, schoolName: 'Trường Đại học Bách khoa' },
          activity: {
            eventName: 'Sinh viên khỏe',
            programName: 'Unitour',
            location: 'Đà Nẵng',
            activityDate: '2026-06-15',
          },
          organization: { issuerName: 'Hội Sinh viên', issuerLevel: null },
          fitness: { title: 'Sinh viên khỏe', resultLevel: 'Đạt', sportName: null },
        },
        fields: {
          ...baseAnalysis.fields,
          student_code: { value: null, confidence: null, source: 'openai' },
          event_name: { value: 'Sinh viên khỏe', confidence: null, source: 'openai' },
          organizer: { value: 'Hội Sinh viên', confidence: 0.82, source: 'openai' },
          organizer_level: { value: null, confidence: null, source: 'openai' },
          issue_date: { value: null, confidence: null, source: 'openai' },
          activity_date: { value: '2026-06-15', confidence: 0.76, source: 'openai' },
          volunteer_days: { value: null, confidence: null, source: 'openai' },
          certificate_type: { value: null, confidence: null, source: 'openai' },
        },
        suggestedCriteria: [{ criterion: Criterion.physical, confidence: 0.88, reason: 'Student Healthy certificate' }],
        documentPrecheck: {
          ...baseAnalysis.documentPrecheck,
          identifiedAs: {
            documentLabel: 'Chứng nhận Sinh viên khỏe',
            shortDescription: 'Tài liệu xác nhận danh hiệu Sinh viên khỏe.',
          },
          completeness: {
            score: 0.78,
            availableFields: ['student_name', 'event_name', 'organizer', 'activity_date'],
            missingImportantFields: ['student_code', 'organizer_level', 'certificate_type'],
          },
          quality: { level: 'clear', issues: [] },
          relevance: [{ criterion: Criterion.physical, level: 'strong', explanation: 'Phù hợp tiêu chí Thể lực tốt.' }],
        },
      },
      matchedProfile: { fullName: 'Nguyen Van A', studentCode: '102220001' },
    });

    expect(result.status).toBe('ready_for_confirmation');
    expect(result.recommendedAction).toBe('confirm_card');
    expect(result.completeness.missingImportantFields).not.toContain('organizer_level');
    expect(result.completeness.missingImportantFields).not.toContain('student_code');
    expect(result.availableFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'activity_program_name', displayValue: 'Unitour' }),
        expect.objectContaining({ key: 'activity_location', displayValue: 'Đà Nẵng' }),
      ]),
    );
  });

  it('downgrades poor quality to needs check when extracted facts prove the document is readable', () => {
    const result = buildEvidencePrecheckResult({
      evidenceId: 'evidence-healthy',
      revision: 1,
      generatedAt: new Date('2026-07-21T12:00:00Z'),
      analysis: {
        ...baseAnalysis,
        documentType: 'student_healthy_certificate',
        documentFacts: {
          ...baseAnalysis.documentFacts,
          documentTitle: 'Chứng nhận Sinh viên khỏe',
          identity: { studentName: 'Nguyen Van A', studentCode: null, schoolName: null },
          activity: { eventName: 'Sinh viên khỏe', programName: 'Unitour', location: null, activityDate: '2026-06-15' },
          organization: { issuerName: 'Hội Sinh viên', issuerLevel: null },
          fitness: { title: 'Sinh viên khỏe', resultLevel: 'Đạt', sportName: null },
        },
        fields: {
          ...baseAnalysis.fields,
          event_name: { value: 'Sinh viên khỏe', confidence: 0.8, source: 'openai' },
          organizer: { value: 'Hội Sinh viên', confidence: 0.76, source: 'openai' },
          organizer_level: { value: null, confidence: null, source: 'openai' },
          activity_date: { value: '2026-06-15', confidence: 0.7, source: 'openai' },
        },
        documentPrecheck: {
          ...baseAnalysis.documentPrecheck,
          identifiedAs: {
            documentLabel: 'Chứng nhận Sinh viên khỏe',
            shortDescription: 'Tài liệu xác nhận danh hiệu Sinh viên khỏe.',
          },
          quality: { level: 'poor', issues: ['low_resolution'] },
          relevance: [{ criterion: Criterion.physical, level: 'strong', explanation: 'Phù hợp tiêu chí Thể lực tốt.' }],
        },
      },
    });

    expect(result.status).toBe('needs_attention');
    expect(result.quality.level).toBe('needs_check');
    expect(result.recommendedAction).toBe('correct_card');
    expect(result.warnings.map((warning) => warning.code)).not.toContain('file_quality_poor');
  });

  it('does not turn soft event/name conflict warnings into a blocking student mismatch', () => {
    const result = buildEvidencePrecheckResult({
      evidenceId: 'evidence-1',
      revision: 1,
      generatedAt: new Date('2026-07-21T12:00:00Z'),
      analysis: baseAnalysis,
      matchedProfile: { fullName: 'Nguyen Van A', studentCode: '102220001' },
      warningCodes: ['event_name_mismatch_with_user_input', 'ocr_student_name_conflict'],
    });

    expect(result.identityCheck.status).toBe('matched');
    expect(result.status).toBe('ready_for_confirmation');
    expect(result.warnings.map((warning) => warning.code)).not.toContain('possible_student_mismatch');
  });
});
