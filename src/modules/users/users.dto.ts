import type { SafeUser } from '../../shared/utils/pick-safe-user';

export type UserListDto = {
  users: SafeUser[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};
