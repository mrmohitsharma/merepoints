import { Body, Controller, Get, Headers, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AdminCtx, AdminOnly, AuthUser, CurrentAdmin, CurrentUser, Public } from '../common/auth';
import { parse } from '../common/util';
import { MAX_UPLOAD_BYTES, UPLOAD_TYPES, UploadsService } from './uploads.service';

const Slot = z.object({
  purpose: z.enum(['product', 'ad', 'logo', 'bill']),
  contentType: z.enum(Object.keys(UPLOAD_TYPES) as [string, ...string[]]),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
});

@Controller()
export class UploadsController {
  constructor(private uploads: UploadsService) {}

  /** Shop owners/staff and customers: ask for a slot, then PUT the photo to uploadUrl. */
  @Post('uploads')
  slot(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    const b = parse(Slot, body);
    return this.uploads.createSlot(`u${u.id}`, b.purpose as any, b.contentType, b.size);
  }

  @AdminOnly() @Post('admin/uploads')
  adminSlot(@CurrentAdmin() a: AdminCtx, @Body() body: unknown) {
    const b = parse(Slot, body);
    return this.uploads.createSlot(`a${a.id}`, b.purpose as any, b.contentType, b.size);
  }

  /** Local development storage (S3 replaces both of these in production). */
  @Public() @Put('uploads/local/:key')
  putLocal(@Param('key') key: string, @Query() q: any, @Req() req: Request & { rawBody?: Buffer }, @Headers('content-type') ct?: string) {
    return this.uploads.saveLocal(decodeURIComponent(key), q, req.rawBody ?? (Buffer.isBuffer(req.body) ? req.body : undefined), ct);
  }

  @Public() @Get('files/*')
  file(@Req() req: Request, @Res() res: Response) {
    const key = req.path.replace(/^.*?\/files\//, '');
    const f = this.uploads.readLocal(decodeURIComponent(key));
    res.setHeader('Content-Type', f.type);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(f.body);
  }
}
