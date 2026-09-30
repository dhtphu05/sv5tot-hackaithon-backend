import { describe, expect, it } from 'vitest';
import {
  assertDisposablePilotDatabaseUrl,
  parsePilotBootstrapConfig,
} from '../../scripts/pilot-bootstrap-config';

const env = {
  PILOT_BOOTSTRAP_CONFIRM: 'true',
  PILOT_BOOTSTRAP_PASSWORD: 'Temporary-Only-123',
  PILOT_SCHOOL_YEAR: '2026-2027',
  PILOT_SEASON_DATES_JSON: JSON.stringify({
    submissionOpensAt: '2026-10-01T00:00:00+07:00',
    submissionClosesAt: '2026-12-01T23:59:59+07:00',
  }),
  PILOT_SCHOOLS_JSON: JSON.stringify([
    { code: 'DHBK-DHDN', name: 'Trường Đại học Bách khoa', parentCode: 'UDN' },
    { code: 'DIRECT-PILOT', name: 'Trường trực thuộc Thành phố', parentCode: 'DANANG_CITY' },
  ]),
  PILOT_STAFF_JSON: JSON.stringify([
    { email: 'admin@example.invalid', fullName: 'Pilot Admin', role: 'admin' },
    {
      email: 'manager@example.invalid',
      fullName: 'Pilot Manager',
      role: 'city_manager',
      workspaceCode: 'DANANG_CITY',
    },
    {
      email: 'committee@example.invalid',
      fullName: 'Pilot Committee',
      role: 'city_committee',
      workspaceCode: 'DANANG_CITY',
    },
    {
      email: 'uploader@example.invalid',
      fullName: 'Pilot Uploader',
      role: 'data_uploader',
      workspaceCode: 'UDN',
    },
    ...['ethics', 'academic', 'physical', 'volunteer', 'integration'].map((specialization) => ({
      email: `${specialization}@example.invalid`,
      fullName: `Pilot ${specialization}`,
      role: 'city_officer',
      workspaceCode: 'DANANG_CITY',
      specializations: [specialization],
    })),
  ]),
};

describe('pilot bootstrap configuration', () => {
  it('accepts a confirmed operational roster with exact five City specializations', () => {
    const config = parsePilotBootstrapConfig(env);

    expect(config.schoolYear).toBe('2026-2027');
    expect(config.schools.map((school) => school.parentCode)).toEqual(['UDN', 'DANANG_CITY']);
    const staff = JSON.parse(env.PILOT_STAFF_JSON) as Array<Record<string, unknown>>;
    staff[0]!.role = 'student';
    expect(() =>
      parsePilotBootstrapConfig({ ...env, PILOT_STAFF_JSON: JSON.stringify(staff) }),
    ).toThrow();
  });

  it('rejects an unconfirmed bootstrap and a pilot roster missing one City specialization', () => {
    expect(() => parsePilotBootstrapConfig({ ...env, PILOT_BOOTSTRAP_CONFIRM: 'false' })).toThrow();
    const staff = JSON.parse(env.PILOT_STAFF_JSON) as Array<Record<string, unknown>>;
    expect(() =>
      parsePilotBootstrapConfig({
        ...env,
        PILOT_STAFF_JSON: JSON.stringify(
          staff.filter((member) => member.email !== 'integration@example.invalid'),
        ),
      }),
    ).toThrow();
  });

  it('rejects a non-consecutive season and specializations on non-officer City staff', () => {
    expect(() => parsePilotBootstrapConfig({ ...env, PILOT_SCHOOL_YEAR: '2025-2027' })).toThrow();
    const staff = JSON.parse(env.PILOT_STAFF_JSON) as Array<Record<string, unknown>>;
    const manager = staff.find((member) => member.role === 'city_manager')!;
    manager.specializations = ['ethics'];
    expect(() =>
      parsePilotBootstrapConfig({ ...env, PILOT_STAFF_JSON: JSON.stringify(staff) }),
    ).toThrow();
  });

  it('rejects public or remote database URLs for pilot bootstrap', () => {
    expect(() =>
      assertDisposablePilotDatabaseUrl('postgresql://user:pass@db.example.com/pilot'),
    ).toThrow();
    expect(() =>
      assertDisposablePilotDatabaseUrl('postgresql://user:pass@localhost:5432/sv5tot_pilot_test'),
    ).not.toThrow();
  });
});
