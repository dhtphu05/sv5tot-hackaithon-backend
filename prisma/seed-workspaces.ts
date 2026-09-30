import { WorkspaceType, type PrismaClient, type Workspace } from '@prisma/client';

export const CITY_WORKSPACE_CODE = 'DANANG_CITY';
export const UNIVERSITY_SYSTEM_CODE = 'UDN';
export const DEFAULT_SCHOOL_CODE = 'DHBK-DHDN';
export const ECONOMICS_SCHOOL_CODE = 'DHKTE-DHDN';

type WorkspaceRegistryEntry = {
  code: string;
  name: string;
  shortName: string;
  type: WorkspaceType;
  parentCode: string | null;
  isActive: boolean;
  registrationEnabled: boolean;
};

export const WORKSPACE_REGISTRY: WorkspaceRegistryEntry[] = [
  {
    code: CITY_WORKSPACE_CODE,
    name: 'Hội Sinh viên Việt Nam TP. Đà Nẵng',
    shortName: 'Hội Sinh viên Đà Nẵng',
    type: WorkspaceType.CITY,
    parentCode: null,
    isActive: true,
    registrationEnabled: false,
  },
  {
    code: UNIVERSITY_SYSTEM_CODE,
    name: 'Đại học Đà Nẵng',
    shortName: 'ĐHĐN',
    type: WorkspaceType.UNIVERSITY_SYSTEM,
    parentCode: CITY_WORKSPACE_CODE,
    isActive: true,
    registrationEnabled: false,
  },
  {
    code: DEFAULT_SCHOOL_CODE,
    name: 'Trường Đại học Bách khoa - Đại học Đà Nẵng',
    shortName: 'DHBK',
    type: WorkspaceType.SCHOOL,
    parentCode: UNIVERSITY_SYSTEM_CODE,
    isActive: true,
    registrationEnabled: true,
  },
  {
    code: ECONOMICS_SCHOOL_CODE,
    name: 'Trường Đại học Kinh tế - Đại học Đà Nẵng',
    shortName: 'DHKTE',
    type: WorkspaceType.SCHOOL,
    parentCode: UNIVERSITY_SYSTEM_CODE,
    isActive: true,
    registrationEnabled: true,
  },
  {
    code: 'DHSP-DHDN',
    name: 'Trường Đại học Sư phạm - Đại học Đà Nẵng',
    shortName: 'DHSP',
    type: WorkspaceType.SCHOOL,
    parentCode: UNIVERSITY_SYSTEM_CODE,
    isActive: true,
    registrationEnabled: false,
  },
  {
    code: 'DHNN-DHDN',
    name: 'Trường Đại học Ngoại ngữ - Đại học Đà Nẵng',
    shortName: 'DHNN',
    type: WorkspaceType.SCHOOL,
    parentCode: UNIVERSITY_SYSTEM_CODE,
    isActive: true,
    registrationEnabled: false,
  },
  {
    code: 'DHSPKT-DHDN',
    name: 'Trường Đại học Sư phạm Kỹ thuật - Đại học Đà Nẵng',
    shortName: 'DHSPKT',
    type: WorkspaceType.SCHOOL,
    parentCode: UNIVERSITY_SYSTEM_CODE,
    isActive: true,
    registrationEnabled: false,
  },
  {
    code: 'VKU-DHDN',
    name: 'Trường Đại học Công nghệ Thông tin và Truyền thông Việt - Hàn - Đại học Đà Nẵng',
    shortName: 'VKU',
    type: WorkspaceType.SCHOOL,
    parentCode: UNIVERSITY_SYSTEM_CODE,
    isActive: true,
    registrationEnabled: false,
  },
  {
    code: 'TYD-DHDN',
    name: 'Trường Y Dược - Đại học Đà Nẵng',
    shortName: 'TYD',
    type: WorkspaceType.SCHOOL,
    parentCode: UNIVERSITY_SYSTEM_CODE,
    isActive: true,
    registrationEnabled: false,
  },
  {
    code: 'DUT',
    name: 'Đại học Duy Tân',
    shortName: 'Duy Tân',
    type: WorkspaceType.SCHOOL,
    parentCode: null,
    isActive: true,
    registrationEnabled: false,
  },
  {
    code: 'DAU',
    name: 'Trường Đại học Kiến trúc Đà Nẵng',
    shortName: 'DAU',
    type: WorkspaceType.SCHOOL,
    parentCode: null,
    isActive: true,
    registrationEnabled: false,
  },
  {
    code: 'DSU',
    name: 'Trường Đại học Thể dục Thể thao Đà Nẵng',
    shortName: 'DSU',
    type: WorkspaceType.SCHOOL,
    parentCode: null,
    isActive: true,
    registrationEnabled: false,
  },
  {
    code: 'QNU',
    name: 'Trường Đại học Quảng Nam',
    shortName: 'QNU',
    type: WorkspaceType.SCHOOL,
    parentCode: null,
    isActive: true,
    registrationEnabled: false,
  },
  {
    code: 'DNC',
    name: 'Trường Cao đẳng Đà Nẵng',
    shortName: 'DNC',
    type: WorkspaceType.SCHOOL,
    parentCode: null,
    isActive: true,
    registrationEnabled: false,
  },
  {
    code: 'CDYT-DANANG',
    name: 'Trường Cao đẳng Y tế Đà Nẵng',
    shortName: 'CĐYT Đà Nẵng',
    type: WorkspaceType.SCHOOL,
    parentCode: null,
    isActive: true,
    registrationEnabled: false,
  },
];

export async function seedWorkspaceRegistry(db: PrismaClient) {
  const workspaces = new Map<string, Workspace>();
  const hierarchyRepairs: string[] = [];
  const hierarchyRepairsSkipped: string[] = [];

  for (const entry of WORKSPACE_REGISTRY) {
    const parentWorkspaceId = entry.parentCode
      ? requiredWorkspace(workspaces, entry.parentCode).id
      : null;
    const existing = await db.workspace.findUnique({ where: { code: entry.code } });
    let workspace = await db.workspace.upsert({
      where: { code: entry.code },
      update: { name: entry.name, shortName: entry.shortName },
      create: {
        code: entry.code,
        name: entry.name,
        shortName: entry.shortName,
        type: entry.type,
        parentWorkspaceId,
        isActive: entry.isActive,
        registrationEnabled: entry.registrationEnabled,
      },
    });

    if (
      existing &&
      (existing.type !== entry.type || existing.parentWorkspaceId !== parentWorkspaceId)
    ) {
      const applicationCount = await db.application.count({ where: { workspaceId: existing.id } });
      if (applicationCount === 0) {
        workspace = await db.workspace.update({
          where: { id: existing.id },
          data: { type: entry.type, parentWorkspaceId },
        });
        hierarchyRepairs.push(entry.code);
      } else {
        hierarchyRepairsSkipped.push(entry.code);
      }
    }

    workspaces.set(entry.code, workspace);
  }

  return { workspaces, hierarchyRepairs, hierarchyRepairsSkipped };
}

function requiredWorkspace(workspaces: Map<string, Workspace>, code: string) {
  const workspace = workspaces.get(code);
  if (!workspace) throw new Error(`Workspace ${code} must be seeded first`);
  return workspace;
}
