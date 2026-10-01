import { Criterion, Role } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  cityDemoMultiSpecializedOfficer,
  cityDemoOfficerUsers,
} from '../../prisma/seeds/demo-city-officers';

describe('City demo officer seed accounts', () => {
  it('provides exactly one City Officer account for each official criterion', () => {
    expect(cityDemoOfficerUsers).toHaveLength(5);
    expect(cityDemoOfficerUsers.every((user) => user.role === Role.city_officer)).toBe(true);
    expect(cityDemoOfficerUsers.map((user) => user.email)).toEqual([
      'sv5tot_hoctap@gmail.com',
      'sv5tot_daoduc@gmail.com',
      'sv5tot_theluc@gmail.com',
      'sv5tot_tinhnguyen@gmail.com',
      'sv5tot_hoinhap@gmail.com',
    ]);
    expect(cityDemoOfficerUsers.map((user) => user.specialization)).toEqual([
      Criterion.academic,
      Criterion.ethics,
      Criterion.physical,
      Criterion.volunteer,
      Criterion.integration,
    ]);
    expect(new Set(cityDemoOfficerUsers.map((user) => user.specialization)).size).toBe(5);
  });

  it('keeps the multi-specialized City Officer account and its existing criteria', () => {
    expect(cityDemoMultiSpecializedOfficer).toEqual({
      email: 'sv5tot_canbo@gmail.com',
      role: Role.city_officer,
      fullName: 'Cán bộ đa tiêu chí SV5T',
      specializations: [Criterion.academic, Criterion.ethics, Criterion.volunteer],
    });
  });
});
