import { Criterion, Role } from '@prisma/client';
import { z } from 'zod';

const pilotCriteria = [
  Criterion.ethics,
  Criterion.academic,
  Criterion.physical,
  Criterion.volunteer,
  Criterion.integration,
] as const;

const schoolSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .transform((value) => value.toUpperCase()),
    name: z.string().trim().min(1).max(255),
    shortName: z.string().trim().min(1).max(100).optional(),
    parentCode: z.enum(['UDN', 'DANANG_CITY']),
  })
  .strict();

const staffSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .transform((value) => value.toLowerCase()),
    fullName: z.string().trim().min(1).max(255),
    role: z.enum([
      Role.admin,
      Role.data_uploader,
      Role.city_officer,
      Role.city_manager,
      Role.city_committee,
    ]),
    workspaceCode: z
      .string()
      .trim()
      .transform((value) => value.toUpperCase())
      .optional(),
    specializations: z.array(z.enum(pilotCriteria)).min(1).optional(),
  })
  .strict();

const seasonDatesSchema = z
  .object({
    submissionOpensAt: z.string().datetime({ offset: true }),
    submissionClosesAt: z.string().datetime({ offset: true }),
    reviewDeadlineAt: z.string().datetime({ offset: true }).nullable().optional(),
    supplementDeadlineAt: z.string().datetime({ offset: true }).nullable().optional(),
    finalizationDeadlineAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();

const operationalRoles = [
  Role.admin,
  Role.data_uploader,
  Role.city_officer,
  Role.city_manager,
  Role.city_committee,
] as const;

export type PilotSchoolConfig = z.infer<typeof schoolSchema>;
export type PilotStaffConfig = z.infer<typeof staffSchema>;
export type PilotBootstrapConfig = {
  password: string | null;
  schoolYear: string;
  seasonDates: z.infer<typeof seasonDatesSchema>;
  schools: PilotSchoolConfig[];
  staff: PilotStaffConfig[];
};

export function parsePilotBootstrapConfig(
  source: NodeJS.ProcessEnv,
  options: { requireConfirmation?: boolean; requirePassword?: boolean } = {},
): PilotBootstrapConfig {
  const requireConfirmation = options.requireConfirmation ?? true;
  const requirePassword = options.requirePassword ?? true;
  if (requireConfirmation && source.PILOT_BOOTSTRAP_CONFIRM !== 'true') {
    throw new Error('Set PILOT_BOOTSTRAP_CONFIRM=true to confirm pilot bootstrap.');
  }

  const password = source.PILOT_BOOTSTRAP_PASSWORD ?? null;
  if (requirePassword && (!password || password.length < 8 || password.length > 128)) {
    throw new Error('PILOT_BOOTSTRAP_PASSWORD must contain 8 to 128 characters.');
  }

  const schoolYear = z
    .string()
    .regex(/^\d{4}-\d{4}$/)
    .refine((value) => Number(value.slice(5)) === Number(value.slice(0, 4)) + 1)
    .safeParse(source.PILOT_SCHOOL_YEAR);
  if (!schoolYear.success) throw new Error('PILOT_SCHOOL_YEAR must use YYYY-YYYY format.');

  const schools = parseJsonArray(source.PILOT_SCHOOLS_JSON, schoolSchema, 'PILOT_SCHOOLS_JSON');
  const staff = parseJsonArray(source.PILOT_STAFF_JSON, staffSchema, 'PILOT_STAFF_JSON');
  validateRoster(schools, staff);

  if (!source.PILOT_SEASON_DATES_JSON) throw new Error('PILOT_SEASON_DATES_JSON is required.');
  const parsedDates = parseJson(source.PILOT_SEASON_DATES_JSON, 'PILOT_SEASON_DATES_JSON');
  const dateResult = seasonDatesSchema.safeParse(parsedDates);
  if (!dateResult.success)
    throw new Error(
      'PILOT_SEASON_DATES_JSON must include valid submission opening and closing dates.',
    );
  const seasonDates = dateResult.data;
  if (
    new Date(seasonDates.submissionOpensAt).getTime() >=
    new Date(seasonDates.submissionClosesAt).getTime()
  ) {
    throw new Error('Pilot submission closing date must be after its opening date.');
  }

  return { password, schoolYear: schoolYear.data, seasonDates, schools, staff };
}

export function assertDisposablePilotDatabaseUrl(value: string | undefined): URL {
  if (!value)
    throw new Error('PILOT_DATABASE_URL is required; DATABASE_URL is not used by pilot commands.');

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('PILOT_DATABASE_URL must be a PostgreSQL URL.');
  }

  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, '')).toLowerCase();
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !localHosts.has(url.hostname) ||
    !databaseName.includes('pilot')
  ) {
    throw new Error(
      'Pilot commands only accept a local disposable PostgreSQL database whose name contains "pilot".',
    );
  }
  return url;
}

function parseJsonArray<T extends z.ZodTypeAny>(
  source: string | undefined,
  schema: T,
  field: string,
): z.infer<T>[] {
  if (!source) throw new Error(`${field} is required.`);
  const parsed = parseJson(source, field);
  const result = z.array(schema).min(1).safeParse(parsed);
  if (!result.success) throw new Error(`${field} must be a non-empty JSON array of valid entries.`);
  return result.data as z.infer<T>[];
}

function parseJson(source: string, field: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new Error(`${field} must contain valid JSON.`);
  }
}

function validateRoster(schools: PilotSchoolConfig[], staff: PilotStaffConfig[]) {
  const reservedCodes = new Set(['DANANG_CITY', 'UDN']);
  const schoolCodes = new Set<string>();
  for (const school of schools) {
    if (reservedCodes.has(school.code))
      throw new Error(`Reserved pilot workspace code: ${school.code}.`);
    if (schoolCodes.has(school.code)) {
      throw new Error(`Duplicate pilot school code: ${school.code}.`);
    }
    schoolCodes.add(school.code);
  }

  if (new Set(staff.map((member) => member.email)).size !== staff.length) {
    throw new Error('PILOT_STAFF_JSON contains duplicate email addresses.');
  }
  for (const role of operationalRoles) {
    if (!staff.some((member) => member.role === role)) {
      throw new Error(`PILOT_STAFF_JSON must include at least one ${role} account.`);
    }
  }

  const citySpecializations = new Set<string>();
  for (const member of staff) {
    if (member.role === Role.admin) {
      if (member.workspaceCode || member.specializations)
        throw new Error('Admin accounts must be global and have no specializations.');
      continue;
    }
    if (
      member.role === Role.city_manager ||
      member.role === Role.city_committee ||
      member.role === Role.city_officer
    ) {
      if (member.workspaceCode !== 'DANANG_CITY')
        throw new Error(`${member.role} accounts must belong to DANANG_CITY.`);
      if (member.role !== Role.city_officer && member.specializations)
        throw new Error('Only city_officer accounts may have specializations.');
    } else if (member.role === Role.data_uploader) {
      if (
        !member.workspaceCode ||
        !['UDN', ...schools.map((school) => school.code)].includes(member.workspaceCode)
      ) {
        throw new Error('data_uploader accounts must belong to UDN or a configured pilot school.');
      }
      if (member.specializations)
        throw new Error('Only city_officer accounts may have specializations.');
    }
    if (member.role === Role.city_officer) {
      if (!member.specializations?.length)
        throw new Error('Every city_officer must have at least one specialization.');
      for (const specialization of member.specializations) citySpecializations.add(specialization);
    }
  }

  if (
    citySpecializations.size !== pilotCriteria.length ||
    pilotCriteria.some((criterion) => !citySpecializations.has(criterion))
  ) {
    throw new Error('City officer specializations must cover exactly the five canonical criteria.');
  }
}
