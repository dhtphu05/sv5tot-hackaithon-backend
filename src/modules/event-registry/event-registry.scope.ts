import { EventStatus, Role, WorkspaceType } from '@prisma/client';
import type { AuthenticatedUser } from '../../shared/types/auth';

export function canStudentAccessCityEvent(
  user: AuthenticatedUser,
  event: { status: EventStatus; workspace?: { type: WorkspaceType; isActive: boolean } | null },
): boolean {
  return (
    (user.role === Role.student || user.role === Role.class_representative) &&
    event.status === EventStatus.active &&
    event.workspace?.type === WorkspaceType.CITY &&
    event.workspace.isActive
  );
}
