import {
  Criterion,
  EventStatus,
  KnowledgeDecision,
  Level,
  Role,
} from '@prisma/client';
import { prisma } from '../src/infrastructure/database/prisma';

const schoolYear = '2025-2026';
const demoStudentCode = process.env.PERSON2_DEMO_STUDENT_CODE ?? '102220001';
const otherStudentCode = process.env.PERSON2_DEMO_OTHER_STUDENT_CODE ?? '109990001';

async function main() {
  const creator = await prisma.user.findFirst({
    where: { role: { in: [Role.manager, Role.admin, Role.committee, Role.officer] }, isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!creator) {
    throw new Error('No active manager/admin/committee/officer user found. Run the main seed first.');
  }
  const workspace =
    (creator.workspaceId ? await prisma.workspace.findUnique({ where: { id: creator.workspaceId } }) : null) ??
    (await prisma.workspace.findUniqueOrThrow({ where: { code: 'DHBK-DHDN' } }));

  const existingEvent = await prisma.eventRegistry.findFirst({
    where: {
      workspaceId: workspace.id,
      eventName: 'Mùa hè xanh 2025',
      organizer: 'Đoàn Trường Đại học Bách khoa - ĐHĐN',
      startDate: new Date('2025-07-01T00:00:00.000Z'),
    },
  });
  const event = existingEvent
    ? await prisma.eventRegistry.update({
        where: { id: existingEvent.id },
        data: {
          criterion: Criterion.volunteer,
          organizerLevel: Level.school,
          endDate: new Date('2025-07-30T00:00:00.000Z'),
          convertedValue: 10,
          convertedUnit: 'days',
          status: EventStatus.active,
          rosterIndexed: true,
        },
      })
    : await prisma.eventRegistry.create({
        data: {
      workspaceId: workspace.id,
      eventName: 'Mùa hè xanh 2025',
      organizer: 'Đoàn Trường Đại học Bách khoa - ĐHĐN',
      organizerLevel: Level.school,
      criterion: Criterion.volunteer,
      startDate: new Date('2025-07-01T00:00:00.000Z'),
      endDate: new Date('2025-07-30T00:00:00.000Z'),
      convertedValue: 10,
      convertedUnit: 'days',
      status: EventStatus.active,
      rosterIndexed: true,
      participantCount: 0,
      createdBy: creator.id,
        },
      });

  const participants = [
    {
      studentCode: demoStudentCode,
      studentName: 'Nguyễn Văn Sinh',
      className: '22T_DT1',
      faculty: 'Khoa Công nghệ Thông tin',
      participationStatus: 'confirmed',
      convertedValue: 10,
    },
    {
      studentCode: otherStudentCode,
      studentName: 'Sinh viên Không Khớp',
      className: '22T_DT2',
      faculty: 'Khoa Công nghệ Thông tin',
      participationStatus: 'confirmed',
      convertedValue: 8,
    },
  ];

  for (const participant of participants) {
    await prisma.eventParticipant.upsert({
      where: {
        eventId_studentCode: {
          eventId: event.id,
          studentCode: participant.studentCode,
        },
      },
      update: participant,
      create: {
        eventId: event.id,
        ...participant,
      },
    });
  }

  await prisma.eventRegistry.update({
    where: { id: event.id },
    data: {
      participantCount: await prisma.eventParticipant.count({ where: { eventId: event.id } }),
      rosterIndexed: true,
      status: EventStatus.active,
    },
  });

  await upsertKnowledgeBaseItem({
    evidenceName: 'Mùa hè xanh 2025 - event import',
    eventName: 'Mùa hè xanh 2025',
    criterion: Criterion.volunteer,
    level: Level.school,
    decision: KnowledgeDecision.accepted,
    reason: 'Minh chứng event_import được chấp nhận khi sinh viên có trong danh sách tham gia đã xác nhận.',
    createdBy: creator.id,
    workspaceId: workspace.id,
    requiredFieldsJson: { sourceType: 'event_import', schoolYear },
    commonErrorsJson: [],
  });

  await upsertKnowledgeBaseItem({
    evidenceName: 'Minh chứng tình nguyện upload thủ công thiếu xác nhận',
    eventName: null,
    criterion: Criterion.volunteer,
    level: Level.school,
    decision: KnowledgeDecision.rejected,
    reason: 'manual_upload bị từ chối nếu giấy chứng nhận thiếu đơn vị xác nhận hoặc dấu/chữ ký hợp lệ.',
    createdBy: creator.id,
    workspaceId: workspace.id,
    requiredFieldsJson: { sourceType: 'manual_upload', required: ['organizer_confirmation'] },
    commonErrorsJson: ['missing_organizer_confirmation'],
  });

  console.log(
    JSON.stringify(
      {
        eventId: event.id,
        demoStudentCode,
        otherStudentCode,
        participantCount: participants.length,
      },
      null,
      2,
    ),
  );
}

async function upsertKnowledgeBaseItem(input: {
  evidenceName: string;
  eventName: string | null;
  criterion: Criterion;
  level: Level;
  decision: KnowledgeDecision;
  reason: string;
  createdBy: string;
  workspaceId: string;
  requiredFieldsJson: unknown;
  commonErrorsJson: unknown;
}) {
  const existing = await prisma.knowledgeBaseItem.findFirst({
    where: {
      evidenceName: input.evidenceName,
      workspaceId: input.workspaceId,
      criterion: input.criterion,
      decision: input.decision,
    },
  });

  if (existing) {
    return prisma.knowledgeBaseItem.update({
      where: { id: existing.id },
      data: {
        eventName: input.eventName,
        level: input.level,
        reason: input.reason,
        requiredFieldsJson: input.requiredFieldsJson as any,
        commonErrorsJson: input.commonErrorsJson as any,
      },
    });
  }

  return prisma.knowledgeBaseItem.create({
    data: {
      evidenceName: input.evidenceName,
      workspaceId: input.workspaceId,
      eventName: input.eventName,
      criterion: input.criterion,
      level: input.level,
      decision: input.decision,
      reason: input.reason,
      requiredFieldsJson: input.requiredFieldsJson as any,
      commonErrorsJson: input.commonErrorsJson as any,
      createdBy: input.createdBy,
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
