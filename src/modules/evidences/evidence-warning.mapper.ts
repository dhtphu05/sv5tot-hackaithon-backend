import {
  mapWarning,
  mapWarnings,
  type EvidenceWarning,
} from '../../shared/dto/evidence-student-status';

export function mapEvidenceWarning(input: unknown): EvidenceWarning {
  return mapWarning(input);
}

export function mapEvidenceWarnings(input: unknown): EvidenceWarning[] {
  return mapWarnings(input);
}

export type { EvidenceWarning };
