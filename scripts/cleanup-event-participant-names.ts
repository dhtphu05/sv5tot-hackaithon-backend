import { prisma } from '../src/infrastructure/database/prisma';
import { stripTrailingClassSuffixFromName } from '../src/modules/event-registry/event-participant-matching';

const apply = process.argv.includes('--apply');

async function main() {
  const participants = await prisma.eventParticipant.findMany({
    select: {
      id: true,
      eventId: true,
      studentCode: true,
      studentName: true,
      className: true,
    },
    orderBy: [{ eventId: 'asc' }, { indexedRow: 'asc' }, { id: 'asc' }],
  });

  const changes = participants
    .map((participant) => {
      const cleanedName = stripTrailingClassSuffixFromName(participant.studentName);
      return {
        ...participant,
        cleanedName,
      };
    })
    .filter((participant) => participant.cleanedName && participant.cleanedName !== participant.studentName);

  console.log(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        scanned: participants.length,
        changed: changes.length,
        samples: changes.slice(0, 20).map((participant) => ({
          id: participant.id,
          eventId: participant.eventId,
          studentCode: participant.studentCode,
          className: participant.className,
          before: participant.studentName,
          after: participant.cleanedName,
        })),
      },
      null,
      2,
    ),
  );

  if (!apply || changes.length === 0) return;

  const batchSize = 100;
  for (let index = 0; index < changes.length; index += batchSize) {
    const batch = changes.slice(index, index + batchSize);
    await prisma.$transaction(
      batch.map((participant) =>
        prisma.eventParticipant.update({
          where: { id: participant.id },
          data: { studentName: participant.cleanedName },
        }),
      ),
    );
    console.log(`updated ${Math.min(index + batch.length, changes.length)}/${changes.length}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
