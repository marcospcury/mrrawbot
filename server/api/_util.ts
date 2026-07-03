import type { NextFunction, Request, Response } from "express"
import type { ZodType } from "zod"

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw new HttpError(400, `Invalid request: ${issue?.path.join(".")} ${issue?.message}`)
  }
  return result.data
}

export function required<T>(value: T | undefined, message: string): T {
  if (value === undefined || value === null) throw new HttpError(404, message)
  return value
}
