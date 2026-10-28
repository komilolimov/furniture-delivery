import {
  BadRequestException,
  Controller,
  Get,
  Head,
  HttpCode,
  Inject,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../auth/public-api';
import type { AuthenticatedRequest } from '../auth/auth.types';
import type { EvidenceScope } from './evidence-access';
import { AttachmentsService } from './attachments.service';
import { AttachmentsDto } from './attachments.dto';
import { PrivateStorage } from './private-storage';
import type { StagedUpload } from './private-storage';
const actor = (r: AuthenticatedRequest) => ({ id: r.user!.id, sessionId: r.sessionId });
function scope(r: AuthenticatedRequest): EvidenceScope {
  const id = r.params.assignmentId ?? r.params.orderId;
  if (
    typeof id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  )
    throw new BadRequestException('Invalid parent ID.');
  return r.params.assignmentId
    ? { assignmentId: String(r.params.assignmentId) }
    : { orderId: String(r.params.orderId) };
}
@Injectable()
export class UploadAccessGuard implements CanActivate {
  constructor(
    @Inject(AttachmentsService) private readonly service: AttachmentsService,
    @Inject(PrivateStorage) private readonly storage: PrivateStorage,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const r = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const s = scope(r);
    await this.service.preflight(actor(r), s);
    await this.storage.initialize();
    return true;
  }
}
async function upload(
  service: AttachmentsService,
  storage: PrivateStorage,
  r: AuthenticatedRequest,
  file: StagedUpload | undefined,
) {
  if (!file) throw new BadRequestException('Choose one file.');
  try {
    return await service.upload(
      actor(r),
      scope(r),
      AttachmentsDto.upload(r.body as unknown, !!r.params.assignmentId),
      file,
    );
  } finally {
    await storage.cleanup(file.path, 'staging');
  }
}
async function content(
  service: AttachmentsService,
  r: AuthenticatedRequest,
  response: Response,
  id: string,
  thumbnail: boolean,
): Promise<void> {
  const result = await service.content(actor(r), scope(r), id, thumbnail);
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Accept-Ranges', 'none');
  if (r.headers.range) {
    await result.content.handle.close();
    response.status(416).end();
    return;
  }
  response.setHeader('Content-Type', result.file.contentType);
  response.setHeader('Content-Length', result.content.size);
  const extension = result.file.kind === 'PDF' ? 'pdf' : 'webp';
  const disposition = result.file.kind === 'PDF' ? 'attachment' : 'inline';
  response.setHeader(
    'Content-Disposition',
    `${disposition}; filename="attachment-${result.file.id}.${extension}"`,
  );
  if (result.file.kind === 'PDF')
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  if (r.method === 'HEAD') {
    await result.content.handle.close();
    response.status(200).end();
    return;
  }
  const stream = result.content.handle.createReadStream();
  stream.on('error', () => response.destroy());
  response.on('close', () => stream.destroy());
  stream.pipe(response);
}
@Controller('crew/assignments/:assignmentId/attachments')
@Roles('CREW_MEMBER')
export class CrewAttachmentsController {
  constructor(
    @Inject(AttachmentsService) private readonly service: AttachmentsService,
    @Inject(PrivateStorage) private readonly storage: PrivateStorage,
  ) {}
  @Post()
  @HttpCode(200)
  @UseGuards(UploadAccessGuard)
  @UseInterceptors(FileInterceptor('file'))
  upload(@Req() r: AuthenticatedRequest, @UploadedFile() file: StagedUpload | undefined) {
    return upload(this.service, this.storage, r, file);
  }
  @Head(':id/content') head(
    @Req() r: AuthenticatedRequest,
    @Res() response: Response,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return content(this.service, r, response, id, false);
  }
  @Get(':id/content') content(
    @Req() r: AuthenticatedRequest,
    @Res() response: Response,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return content(this.service, r, response, id, false);
  }
  @Head(':id/thumbnail') thumbnailHead(
    @Req() r: AuthenticatedRequest,
    @Res() response: Response,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return content(this.service, r, response, id, true);
  }
  @Get(':id/thumbnail') thumbnail(
    @Req() r: AuthenticatedRequest,
    @Res() response: Response,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return content(this.service, r, response, id, true);
  }
}
@Controller('orders/:orderId/attachments')
@Roles('ADMIN', 'DISPATCHER')
export class OrderAttachmentsController {
  constructor(
    @Inject(AttachmentsService) private readonly service: AttachmentsService,
    @Inject(PrivateStorage) private readonly storage: PrivateStorage,
  ) {}
  @Post()
  @HttpCode(200)
  @UseGuards(UploadAccessGuard)
  @UseInterceptors(FileInterceptor('file'))
  upload(@Req() r: AuthenticatedRequest, @UploadedFile() file: StagedUpload | undefined) {
    return upload(this.service, this.storage, r, file);
  }
  @Post(':id/withdraw') @HttpCode(200) withdraw(
    @Req() r: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.withdraw(
      actor(r),
      scope(r),
      id,
      AttachmentsDto.withdraw(r.body as unknown),
    );
  }
  @Head(':id/content') head(
    @Req() r: AuthenticatedRequest,
    @Res() response: Response,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return content(this.service, r, response, id, false);
  }
  @Get(':id/content') content(
    @Req() r: AuthenticatedRequest,
    @Res() response: Response,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return content(this.service, r, response, id, false);
  }
  @Head(':id/thumbnail') thumbnailHead(
    @Req() r: AuthenticatedRequest,
    @Res() response: Response,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return content(this.service, r, response, id, true);
  }
  @Get(':id/thumbnail') thumbnail(
    @Req() r: AuthenticatedRequest,
    @Res() response: Response,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return content(this.service, r, response, id, true);
  }
}
