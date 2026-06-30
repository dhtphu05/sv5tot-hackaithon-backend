import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';

type ValidationSchema = {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
};

export function validate(schema: ValidationSchema) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (schema.body) {
      req.body = schema.body.parse(req.body);
    }

    if (schema.query) {
      req.query = schema.query.parse(req.query);
    }

    if (schema.params) {
      req.params = schema.params.parse(req.params);
    }

    next();
  };
}
