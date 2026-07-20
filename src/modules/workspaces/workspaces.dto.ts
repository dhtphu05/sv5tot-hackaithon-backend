import type { Workspace } from '@prisma/client';

export type WorkspaceSummaryDto = Pick<Workspace, 'id' | 'code' | 'name' | 'shortName'>;

export function toWorkspaceSummaryDto(workspace: WorkspaceSummaryDto): WorkspaceSummaryDto {
  return {
    id: workspace.id,
    code: workspace.code,
    name: workspace.name,
    shortName: workspace.shortName,
  };
}
