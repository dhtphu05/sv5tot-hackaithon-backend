import { Criterion, Role } from '@prisma/client';

export const cityDemoOfficerUsers = [
  {
    email: 'hoctap_sv5tot@gmail.com',
    role: Role.city_officer,
    fullName: 'Cán bộ Học tập SV5T',
    specialization: Criterion.academic,
  },
  {
    email: 'daoduc_sv5tot@gmail.com',
    role: Role.city_officer,
    fullName: 'Cán bộ Đạo đức SV5T',
    specialization: Criterion.ethics,
  },
  {
    email: 'theluc_sv5tot@gmail.com',
    role: Role.city_officer,
    fullName: 'Cán bộ Thể lực SV5T',
    specialization: Criterion.physical,
  },
  {
    email: 'tinhnguyen_sv5tot@gmail.com',
    role: Role.city_officer,
    fullName: 'Cán bộ Tình nguyện SV5T',
    specialization: Criterion.volunteer,
  },
  {
    email: 'hoinhap_sv5tot@gmail.com',
    role: Role.city_officer,
    fullName: 'Cán bộ Hội nhập SV5T',
    specialization: Criterion.integration,
  },
] as const;
