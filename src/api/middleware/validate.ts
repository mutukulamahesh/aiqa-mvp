import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";

export function validate<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({ error: "Validation error", issues: err.issues });
        return;
      }
      next(err);
    }
  };
}
