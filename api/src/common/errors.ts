import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { ZodError } from 'zod';

/** Business error with a stable code the apps can switch on and translate. */
export class AppError extends HttpException {
  constructor(status: number, public readonly code: string, message: string, public readonly details?: unknown) {
    super({ code, message, details }, status);
  }
}

export const E = {
  bad: (code: string, msg: string, details?: unknown) => new AppError(400, code, msg, details),
  unauth: (msg = 'Login required') => new AppError(401, 'UNAUTHENTICATED', msg),
  forbidden: (code: string, msg: string) => new AppError(403, code, msg),
  notFound: (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found`),
  conflict: (code: string, msg: string, details?: unknown) => new AppError(409, code, msg, details),
  tooMany: (msg: string) => new AppError(429, 'RATE_LIMITED', msg),
};

/** Maps Postgres constraint errors that can legitimately reach the API to clean 409s. */
const PG_CONSTRAINT_MAP: Record<string, [string, string, number?]> = {
  customers_profession_fk: ['BAD_WORK_TYPE', 'Pick a work type from the list', 400],
  bills_unique_invoice: ['DUPLICATE_INVOICE', 'This invoice number already got points at your shop'],
  redemptions_one_open: ['REDEMPTION_OPEN', 'This customer already has a redemption in progress at your shop'],
  offers_no_overlap: ['OFFER_OVERLAP', 'Another offer already runs in these dates. Only one offer at a time.'],
  ledger_one_reversal: ['ALREADY_REVERSED', 'This entry was already reversed'],
  shop_members_pkey: ['ALREADY_MEMBER', 'This person is already on your staff list'],
};

@Catch()
export class AllErrorsFilter implements ExceptionFilter {
  catch(err: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    if (err instanceof HttpException) {
      const body: any = err.getResponse();
      return res.status(err.getStatus()).json(typeof body === 'string' ? { code: 'ERROR', message: body } : body);
    }
    if (err instanceof ZodError) {
      // Rules written for people (custom checks, e.g. slab ranges) are shown as they are.
      const human = err.issues.find((i) => i.code === 'custom' || (i.message && !/^(Expected|Required|Invalid|Number must|String must|Array must)/.test(i.message)));
      return res.status(400).json({ code: 'VALIDATION', message: human?.message ?? 'Some fields are not valid', details: err.flatten() });
    }
    const mapped = err?.constraint && PG_CONSTRAINT_MAP[err.constraint];
    if (mapped) return res.status(mapped[2] ?? 409).json({ code: mapped[0], message: mapped[1] });
    if (err?.code === '23514') return res.status(400).json({ code: 'CHECK_FAILED', message: err.constraint ?? 'Value not allowed' });
    console.error(err);
    return res.status(500).json({ code: 'INTERNAL', message: 'Something went wrong' });
  }
}
