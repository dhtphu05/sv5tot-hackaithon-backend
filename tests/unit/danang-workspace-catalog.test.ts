import { describe, expect, it } from 'vitest';
import { danangSchoolWorkspaces } from '../../prisma/seeds/danang-workspaces';

describe('Da Nang school workspace catalog', () => {
  it('contains exactly the requested UDN and Direct City schools as active signup choices', () => {
    expect(danangSchoolWorkspaces).toHaveLength(13);
    expect(danangSchoolWorkspaces.map(({ code }) => code)).toEqual([
      'DHBK-DHDN',
      'DHKTE-DHDN',
      'DHSP-DHDN',
      'DHNN-DHDN',
      'DHSPKT-DHDN',
      'VKU-DHDN',
      'TYD-DHDN',
      'DTU-DN',
      'UDA-DN',
      'DAU-DN',
      'TDTT-DN',
      'DUMTP-DN',
      'QNU-DN',
    ]);
    expect(danangSchoolWorkspaces.every((workspace) => workspace.registrationEnabled)).toBe(true);
    expect(danangSchoolWorkspaces.every((workspace) => workspace.isActive)).toBe(true);
  });

  it('places only the seven UDN schools under UDN', () => {
    expect(
      danangSchoolWorkspaces.filter(({ parentCode }) => parentCode === 'UDN').map(({ code }) => code),
    ).toEqual([
      'DHBK-DHDN',
      'DHKTE-DHDN',
      'DHSP-DHDN',
      'DHNN-DHDN',
      'DHSPKT-DHDN',
      'VKU-DHDN',
      'TYD-DHDN',
    ]);
    expect(
      danangSchoolWorkspaces.filter(({ parentCode }) => parentCode === null).map(({ code }) => code),
    ).toEqual(['DTU-DN', 'UDA-DN', 'DAU-DN', 'TDTT-DN', 'DUMTP-DN', 'QNU-DN']);
  });

  it('does not expose fixture workspaces as real schools', () => {
    expect(danangSchoolWorkspaces.map(({ code }) => code)).not.toContain('E2E-NON-AI');
    expect(danangSchoolWorkspaces.map(({ code }) => code)).not.toContain('PILOT-5TOT');
  });
});
