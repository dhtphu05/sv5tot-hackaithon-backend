import type { Criterion, Prisma } from '@prisma/client';
import {
  buildMissingFields,
  type EvidenceMissingField,
} from '../../shared/dto/evidence-student-status';

export function detectEvidenceMissingFields(input: {
  criterion: Criterion | string;
  fields: Prisma.JsonValue | Record<string, unknown> | null | undefined;
  warnings?: Prisma.JsonValue | unknown[] | null;
}): EvidenceMissingField[] {
  return buildMissingFields(input.criterion, input.fields, input.warnings ?? []);
}

export type { EvidenceMissingField };
