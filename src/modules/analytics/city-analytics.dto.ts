import type {
  Criterion,
  FinalStatus,
  ApplicationStatus,
} from '@prisma/client';

export type CityCriterionSummary = {
  criterion: Criterion;
  totalTasks: number;
  pending: number;
  inReview: number;
  supplementRequired: number;
  resolutionNeeded: number;
  pass: number;
  fail: number;
};

export type CityApplicationListItem = {
  id: string;
  schoolYear: string;
  status: ApplicationStatus;
  submittedAt: string | null;
  reviewProgress: { reviewed: number; expected: 5; anomalous: boolean };
  finalStatus: FinalStatus;
  supplementRequired: boolean;
  resolutionBlocked: boolean;
  student: { fullName: string; studentCode: string | null };
  school: { workspaceId: string; code: string; name: string };
};
