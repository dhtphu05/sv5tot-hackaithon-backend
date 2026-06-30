import { env } from '../../config/env';
import { AppError } from '../errors/app-error';
import { ErrorCodes } from '../errors/error-codes';

const schoolYearPattern = /^\d{4}-\d{4}$/;

export function getDefaultSchoolYear(): string {
  return env.DEFAULT_SCHOOL_YEAR;
}

export function normalizeSchoolYear(input?: string): string {
  const schoolYear = input ?? getDefaultSchoolYear();
  assertValidSchoolYear(schoolYear);
  return schoolYear;
}

export function assertValidSchoolYear(schoolYear: string): void {
  if (!schoolYearPattern.test(schoolYear)) {
    throw new AppError(
      400,
      ErrorCodes.INVALID_SCHOOL_YEAR,
      'School year must use YYYY-YYYY format',
    );
  }

  const [startYear, endYear] = schoolYear.split('-').map(Number);
  if (endYear !== startYear + 1) {
    throw new AppError(400, ErrorCodes.INVALID_SCHOOL_YEAR, 'School year end must equal start + 1');
  }
}
