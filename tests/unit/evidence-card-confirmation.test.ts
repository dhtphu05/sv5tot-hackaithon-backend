import { EvidenceSourceType, IndexingStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  buildEffectiveEvidenceCardFields,
  canUseEvidenceCardForPrecheck,
  evidenceCardConfirmationStatuses,
  getTrustedEvidenceCardFields,
  needsEvidenceConfirmation,
  validateEvidenceCardCorrections,
} from '../../src/modules/evidences/evidence-card-confirmation';

describe('evidence card confirmation trust semantics', () => {
  it('keeps pending manual extracted fields out of Precheck trust', () => {
    const evidence = {
      id: 'evidence-1',
      sourceType: EvidenceSourceType.manual_upload,
      indexingStatus: IndexingStatus.indexed,
      evidenceCard: {
        provider: 'openai',
        normalizedFieldsJson: { gpa: 3.8, volunteer_days: 4 },
        confirmationStatus: evidenceCardConfirmationStatuses.pending,
        requiresHumanConfirmation: true,
      },
    };

    expect(needsEvidenceConfirmation(evidence)).toBe(true);
    expect(canUseEvidenceCardForPrecheck(evidence)).toBe(false);
    expect(getTrustedEvidenceCardFields(evidence)).toEqual({});
  });

  it('uses confirmed effective fields for Precheck without overwriting extraction', () => {
    const evidence = {
      id: 'evidence-1',
      sourceType: EvidenceSourceType.manual_upload,
      indexingStatus: IndexingStatus.indexed,
      evidenceCard: {
        provider: 'openai',
        normalizedFieldsJson: { gpa: 2.8, event_name: 'AI value' },
        confirmedFieldsJson: { gpa: 3.4 },
        confirmationStatus: evidenceCardConfirmationStatuses.confirmed,
        requiresHumanConfirmation: false,
      },
    };

    expect(canUseEvidenceCardForPrecheck(evidence)).toBe(true);
    expect(getTrustedEvidenceCardFields(evidence)).toMatchObject({ gpa: 3.4 });
    expect(evidence.evidenceCard.normalizedFieldsJson.gpa).toBe(2.8);
  });

  it('validates only allowlisted correction fields', () => {
    expect(validateEvidenceCardCorrections({ student_code: '  102220001 ', gpa: '3,2' })).toEqual({
      student_code: '102220001',
      gpa: 3.2,
    });
    expect(() => validateEvidenceCardCorrections({ providerModel: 'gpt' })).toThrow();
    expect(() => validateEvidenceCardCorrections({ gpa: 4.5 })).toThrow();
  });

  it('builds extracted, corrected, and effective field details', () => {
    const state = buildEffectiveEvidenceCardFields({
      sourceType: EvidenceSourceType.manual_upload,
      provider: 'openai',
      extractedFields: { event_name: 'AI event' },
      normalizedFields: { event_name: 'AI event' },
      confirmedFields: { event_name: 'Corrected event' },
      fieldConfidence: { event_name: 0.4 },
      warnings: [{ code: 'missing_issue_date', field: 'issue_date' }],
      confirmationStatus: evidenceCardConfirmationStatuses.correctionRequired,
    });

    expect(state.effectiveFields).toMatchObject({ event_name: 'Corrected event' });
    expect(state.fieldDetails[0]).toMatchObject({
      key: 'event_name',
      extractedValue: 'AI event',
      correctedValue: 'Corrected event',
      effectiveValue: 'Corrected event',
      source: 'student_corrected',
    });
  });
});
