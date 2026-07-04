import type { SafeUser } from '../../shared/utils/pick-safe-user';

export type LoginResponseDto = {
  user: SafeUser;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  accessTokenExpiresAt: string;
};

export type RefreshResponseDto = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  accessTokenExpiresAt: string;
};
