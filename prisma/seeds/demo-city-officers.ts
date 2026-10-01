import { Criterion, Role } from '@prisma/client';

export const cityDemoOfficerUsers = [
  {
    email: 'sv5tot_hoctap@gmail.com',
    role: Role.city_officer,
    fullName: 'Cán bộ Học tập SV5T',
    specialization: Criterion.academic,
  },
  {
    email: 'sv5tot_daoduc@gmail.com',
    role: Role.city_officer,
    fullName: 'Cán bộ Đạo đức SV5T',
    specialization: Criterion.ethics,
  },
  {
    email: 'sv5tot_theluc@gmail.com',
    role: Role.city_officer,
    fullName: 'Cán bộ Thể lực SV5T',
    specialization: Criterion.physical,
  },
  {
    email: 'sv5tot_tinhnguyen@gmail.com',
    role: Role.city_officer,
    fullName: 'Cán bộ Tình nguyện SV5T',
    specialization: Criterion.volunteer,
  },
  {
    email: 'sv5tot_hoinhap@gmail.com',
    role: Role.city_officer,
    fullName: 'Cán bộ Hội nhập SV5T',
    specialization: Criterion.integration,
  },
] as const;

export const cityDemoMultiSpecializedOfficer = {
  email: 'sv5tot_canbo@gmail.com',
  role: Role.city_officer,
  fullName: 'Cán bộ đa tiêu chí SV5T',
  specializations: [Criterion.academic, Criterion.ethics, Criterion.volunteer],
};
