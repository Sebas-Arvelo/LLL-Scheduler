import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';

import { ApiError, BadRequestError, NotFoundError } from './errors';
import type { ConfigRepository } from './repositories/config-repository';
import type { ScheduleRepository } from './repositories/schedule-repository';
import {
  validateCreateScheduleRequest,
  validateIdentifierParameter,
  validateUuidParameter,
} from './validation/schedule-payload';

export interface AppDependencies {
  configRepository: ConfigRepository;
  scheduleRepository: ScheduleRepository;
  databaseHealth: () => Promise<boolean>;
  corsOrigin: string;
  production: boolean;
}

interface DatabaseError extends Error {
  code?: string;
}

export function createApp(dependencies: AppDependencies) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: dependencies.corsOrigin, methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', async (_request, response) => {
    const database = await dependencies.databaseHealth().catch(() => false);
    response.json({ api: 'ok', database: database ? 'ok' : 'unavailable' });
  });

  app.get('/api/seasons/:id/config', async (request, response) => {
    const seasonId = validateIdentifierParameter(request.params['id'] ?? '', 'season id');
    const configuration = await dependencies.configRepository.getSeasonConfiguration(seasonId);
    if (!configuration) throw new NotFoundError('Season configuration was not found.');
    response.json(configuration);
  });

  app.post('/api/schedules', async (request, response) => {
    const payload = validateCreateScheduleRequest(request.body);
    const stored = await dependencies.scheduleRepository.create(payload);
    response.status(201).json(stored);
  });

  app.get('/api/schedules/:id', async (request, response) => {
    const id = validateUuidParameter(request.params['id'] ?? '', 'schedule id');
    const schedule = await dependencies.scheduleRepository.getById(id);
    if (!schedule) throw new NotFoundError('Schedule was not found.');
    response.json(schedule);
  });

  app.get('/api/seasons/:seasonId/schedules', async (request, response) => {
    const seasonId = validateIdentifierParameter(request.params['seasonId'] ?? '', 'season id');
    response.json(await dependencies.scheduleRepository.listBySeason(seasonId));
  });

  app.use((_request, _response, next) => next(new NotFoundError('Endpoint was not found.')));

  const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    if (error instanceof ApiError) {
      response.status(error.status).json({
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      });
      return;
    }
    if (error instanceof SyntaxError) {
      const badRequest = new BadRequestError('Request body is not valid JSON.');
      response.status(badRequest.status).json({ code: badRequest.code, message: badRequest.message });
      return;
    }
    const databaseError = error as DatabaseError;
    if (databaseError.code === '23505') {
      response.status(409).json({ code: 'CONFLICT', message: 'A database uniqueness constraint was violated.' });
      return;
    }
    if (databaseError.code === '23503' || databaseError.code === '23514') {
      response.status(400).json({ code: 'BAD_REQUEST', message: 'The payload violates a database constraint.' });
      return;
    }
    if (!dependencies.production) console.error(error);
    response.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  };
  app.use(errorHandler);
  return app;
}
