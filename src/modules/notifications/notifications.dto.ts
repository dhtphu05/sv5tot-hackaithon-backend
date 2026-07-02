export interface NotificationSummary {
  id: string;
  userId: string;
  applicationId: string | null;
  collectiveProfileId: string | null;
  evidenceId?: string | null;
  reviewTaskId?: string | null;
  resolutionCaseId?: string | null;
  metadata?: unknown;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export function toNotificationSummary(notification: any): NotificationSummary {
  return {
    id: notification.id,
    userId: notification.userId,
    applicationId: notification.applicationId,
    collectiveProfileId: notification.collectiveProfileId,
    evidenceId: notification.evidenceId ?? null,
    reviewTaskId: notification.reviewTaskId ?? null,
    resolutionCaseId: notification.resolutionCaseId ?? null,
    metadata: notification.metadata ?? null,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    isRead: !!notification.readAt,
    readAt: notification.readAt ? notification.readAt.toISOString() : null,
    createdAt: notification.createdAt.toISOString(),
  };
}
