import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import { pickSafeUser } from '../../shared/utils/pick-safe-user';
import { UsersRepository } from './users.repository';
import type { ListUsersQuery, UpdateMeInput } from './users.validation';

export class UsersService {
  constructor(private readonly usersRepository = new UsersRepository()) {}

  async getMe(userId: string) {
    const user = await this.usersRepository.findById(userId);

    if (!user) {
      throw new AppError(404, ErrorCodes.NOT_FOUND, 'User not found');
    }

    return {
      ...pickSafeUser(user),
      officerSpecializations: user.officerSpecializations ?? [],
    };
  }

  async updateMe(userId: string, input: UpdateMeInput) {
    const user = await this.usersRepository.updateById(userId, input);
    return pickSafeUser(user);
  }

  async listUsers(query: ListUsersQuery) {
    const result = await this.usersRepository.list(query);
    const totalPages = Math.ceil(result.total / query.limit);

    return {
      users: result.users.map(pickSafeUser),
      pagination: {
        page: query.page,
        limit: query.limit,
        total: result.total,
        totalPages,
      },
    };
  }
}
