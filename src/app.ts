import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { corsOptions } from './config/cors';
import { logger } from './config/logger';
import { securityConfig } from './config/security';
import { setupSwagger } from './docs/swagger';
import { errorMiddleware } from './middlewares/error.middleware';
import { notFoundMiddleware } from './middlewares/not-found.middleware';
import { rateLimitMiddleware } from './middlewares/rate-limit.middleware';
import { requestIdMiddleware } from './middlewares/request-id.middleware';
import { aiRouter } from './modules/ai/ai.routes';
import { applicationsRouter } from './modules/applications/applications.routes';
import { auditRouter } from './modules/audit/audit.routes';
import { authRouter } from './modules/auth/auth.routes';
import { cascadeRouter } from './modules/cascade/cascade.routes';
import { collectiveRouter } from './modules/collective/collective.routes';
import { eventRegistryRouter } from './modules/event-registry/event-registry.routes';
import { evidencesRouter } from './modules/evidences/evidences.routes';
import { exportsRouter } from './modules/exports/exports.routes';
import { filesRouter } from './modules/files/files.routes';
import { healthRouter } from './modules/health/health.routes';
import { jobsRouter } from './modules/jobs/jobs.routes';
import { knowledgeBaseRouter } from './modules/knowledge-base/knowledge-base.routes';
import { managerRouter } from './modules/manager/manager.routes';
import { metricsRouter } from './modules/metrics/metrics.routes';
import { notificationsRouter } from './modules/notifications/notifications.routes';
import { precheckRouter } from './modules/precheck/precheck.routes';
import { resolutionRouter } from './modules/resolution/resolution.routes';
import { reviewRouter } from './modules/review/review.routes';
import { smartUxRouter } from './modules/smartux/smartux.routes';
import { meRouter, usersRouter } from './modules/users/users.routes';
import { versionRouter } from './modules/version/version.routes';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors(corsOptions));
  app.use(requestIdMiddleware);
  app.use(express.json({ limit: securityConfig.jsonBodyLimit }));
  app.use(express.urlencoded({ extended: true, limit: securityConfig.urlEncodedLimit }));
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.requestId ?? 'unknown',
    }),
  );
  app.use(rateLimitMiddleware);

  setupSwagger(app);

  app.use('/health', healthRouter);
  app.use('/api/version', versionRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/me', meRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/applications', applicationsRouter);
  app.use('/api', metricsRouter);
  app.use('/api', evidencesRouter);
  app.use('/api', filesRouter);
  app.use('/api/events', eventRegistryRouter);
  app.use('/api/knowledge-base', knowledgeBaseRouter);
  app.use('/api', precheckRouter);
  app.use('/api', cascadeRouter);
  app.use('/api/review', reviewRouter);
  app.use('/api/manager', managerRouter);
  app.use('/api/collective', collectiveRouter);
  app.use('/api/resolution', resolutionRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/jobs', jobsRouter);
  app.use('/api', aiRouter);
  app.use('/api/smartux', smartUxRouter);
  app.use('/api/exports', exportsRouter);

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}
