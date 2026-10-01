import { Criterion, Role } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { cityDemoOfficerUsers } from '../../prisma/seeds/demo-city-officers';

describe('City demo officer seed accounts', () => {
  it('provides exactly one City Officer account for each official criterion', () => {
    expect(cityDemoOfficerUsers).toHaveLength(5);
    expect(cityDemoOfficerUsers.every((user) => user.role === Role.city_officer)).toBe(true);
    expect(cityDemoOfficerUsers.map((user) => user.email)).toEqual([
      'hoctap_sv5tot@gmail.com',
      'daoduc_sv5tot@gmail.com',
      'theluc_sv5tot@gmail.com',
      'tinhnguyen_sv5tot@gmail.com',
      'hoinhap_sv5tot@gmail.com',
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
});
