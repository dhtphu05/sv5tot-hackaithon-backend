import type { Express } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from './openapi';

export function setupSwagger(app: Express): void {
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));
}
