import { Router } from 'express';
import { getVersion } from './version.controller';

export const versionRouter = Router();

versionRouter.get('/', getVersion);
