import type { EvidenceAnalysisProvider, EvidenceDocumentAnalysisInput } from './evidence-analysis.types';
import { validateEvidenceAnalysisOutput } from './evidence-analysis.schema';

export class MockEvidenceAnalysisAdapter implements EvidenceAnalysisProvider {
  readonly provider = 'mock' as const;

  async analyze(input: EvidenceDocumentAnalysisInput) {
    return validateEvidenceAnalysisOutput(
      {
        documentType: 'certificate',
        documentFacts: {
          documentTitle: input.evidenceName,
          identity: {
            studentName: input.studentContext?.fullName ?? null,
            studentCode: input.studentContext?.studentCode ?? null,
            schoolName: null,
          },
          activity: {
            eventName: input.evidenceName,
            programName: null,
            location: null,
            activityDate: null,
          },
          organization: { issuerName: null, issuerLevel: null },
          conductEntries: [],
          fitness: { title: null, resultLevel: null, sportName: null },
          language: { certificateType: null, score: null, frameworkLevel: null },
          award: { title: null, rank: null, level: null },
          academic: { gpa: null, gpaScale: null, hasFGrade: null },
        },
        fields: {
          student_name: { value: input.studentContext?.fullName ?? null, confidence: input.studentContext?.fullName ? 0.8 : 0, source: 'mock' },
          student_code: { value: input.studentContext?.studentCode ?? null, confidence: input.studentContext?.studentCode ? 0.8 : 0, source: 'mock' },
          class_name: { value: null, confidence: 0, source: 'mock' },
          faculty: { value: null, confidence: 0, source: 'mock' },
          event_name: { value: input.evidenceName, confidence: 0.75, source: 'mock' },
          organizer: { value: null, confidence: 0, source: 'mock' },
          organizer_level: { value: 'unknown', confidence: 0.2, source: 'mock' },
          issue_date: { value: null, confidence: 0, source: 'mock' },
          activity_date: { value: null, confidence: 0, source: 'mock' },
          award_level: { value: null, confidence: 0, source: 'mock' },
          volunteer_days: { value: null, confidence: 0, source: 'mock' },
          certificate_type: { value: 'certificate', confidence: 0.6, source: 'mock' },
          language_score: { value: null, confidence: 0, source: 'mock' },
          gpa: { value: null, confidence: 0, source: 'mock' },
          conduct_score: { value: null, confidence: 0, source: 'mock' },
        },
        suggestedCriteria: [{ criterion: input.selectedCriterion, confidence: 0.5, reason: 'Deterministic mock follows selected criterion.' }],
        documentPrecheck: {
          identifiedAs: {
            documentLabel: 'Minh chứng mẫu',
            shortDescription: `Minh chứng mẫu cho "${input.evidenceName}".`,
          },
          completeness: {
            score: 0.55,
            availableFields: ['student_name', 'student_code', 'event_name', 'certificate_type'],
            missingImportantFields: ['issue_date', 'organizer'],
          },
          quality: { level: 'needs_check', issues: [] },
          relevance: [
            {
              criterion: input.selectedCriterion,
              level: 'possible',
              explanation: 'Kết quả mock giữ theo tiêu chí sinh viên đã chọn.',
            },
          ],
        },
        warnings: [{ code: 'mock_analysis', severity: 'info', message: 'Mock evidence analysis result.' }],
        summary: `Mock analysis result for "${input.evidenceName}".`,
        overallConfidence: 0.65,
        requiresHumanConfirmation: true,
      },
      'mock',
      'mock',
      'evidence-card-v1',
    );
  }
}
