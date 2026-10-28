import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Head,
  HttpCode,
  HttpException,
  Inject,
  Injectable,
  Param,
  ParseUUIDPipe,
  PayloadTooLargeException,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { Roles } from '../auth/public-api';
import { uuidValue } from '../auth/validation';
import { AcceptanceDto } from './acceptance.dto';
import { AcceptanceService } from './acceptance.service';
import { SIGNATURE_MAX_BYTES } from './signature-png';
const actor = (request: AuthenticatedRequest) => ({
  id: request.user!.id,
  sessionId: request.sessionId,
});
@Injectable()
export class SignatureUploadGuard implements CanActivate {
  constructor(@Inject(AcceptanceService) private readonly service: AcceptanceService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const snapshotId = request.params.snapshotId,
      slotId = request.params.slotId;
    if (typeof snapshotId !== 'string' || typeof slotId !== 'string')
      throw new BadRequestException('Invalid confirmation requirement.');
    uuidValue(snapshotId);
    uuidValue(slotId);
    const length = request.headers['content-length'];
    if (length === undefined || request.headers['transfer-encoding'] !== undefined)
      throw new HttpException('A declared Content-Length is required for signature uploads.', 411);
    if (
      length !== undefined &&
      (typeof length !== 'string' ||
        !/^\d+$/.test(length) ||
        Number(length) > SIGNATURE_MAX_BYTES + 16384)
    )
      throw new PayloadTooLargeException('The signature upload exceeds the request size limit.');
    await this.service.preflight(actor(request), snapshotId, slotId);
    return true;
  }
}
@Controller('orders/:orderId/appointments/:appointmentId/acceptance')
@Roles('ADMIN', 'DISPATCHER')
export class BackofficeAcceptanceController {
  constructor(@Inject(AcceptanceService) private readonly service: AcceptanceService) {}
  @Get() read(
    @Req() request: AuthenticatedRequest,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
  ) {
    return this.service.read(actor(request), { orderId, appointmentId });
  }
  @Post() @HttpCode(200) prepare(
    @Req() request: AuthenticatedRequest,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Body() body: unknown,
  ) {
    return this.service.prepare(
      actor(request),
      { orderId, appointmentId },
      AcceptanceDto.prepare(body),
    );
  }
}
@Controller('crew/assignments/:assignmentId/acceptance')
@Roles('CREW_MEMBER')
export class CrewAcceptanceController {
  constructor(@Inject(AcceptanceService) private readonly service: AcceptanceService) {}
  @Get() read(
    @Req() request: AuthenticatedRequest,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
  ) {
    return this.service.read(actor(request), { assignmentId });
  }
  @Post() @HttpCode(200) prepare(
    @Req() request: AuthenticatedRequest,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() body: unknown,
  ) {
    return this.service.prepare(actor(request), { assignmentId }, AcceptanceDto.prepare(body));
  }
}
@Controller('acceptance/:snapshotId')
@Roles('ADMIN', 'DISPATCHER', 'CREW_MEMBER')
export class AcceptanceActionsController {
  constructor(@Inject(AcceptanceService) private readonly service: AcceptanceService) {}
  @Post('slots/:slotId/sign')
  @HttpCode(200)
  @UseGuards(SignatureUploadGuard)
  @UseInterceptors(FileInterceptor('signature'))
  sign(
    @Req() request: AuthenticatedRequest,
    @Param('snapshotId', ParseUUIDPipe) snapshotId: string,
    @Param('slotId', ParseUUIDPipe) slotId: string,
    @UploadedFile() file: { buffer: Buffer } | undefined,
  ) {
    if (!file || !Buffer.isBuffer(file.buffer))
      throw new BadRequestException('Choose one PNG signature.');
    return this.service.sign(
      actor(request),
      snapshotId,
      slotId,
      AcceptanceDto.signature(request.body as unknown),
      file.buffer,
    );
  }
  @Post('slots/:slotId/absence') @HttpCode(200) absence(
    @Req() request: AuthenticatedRequest,
    @Param('snapshotId', ParseUUIDPipe) snapshotId: string,
    @Param('slotId', ParseUUIDPipe) slotId: string,
    @Body() body: unknown,
  ) {
    return this.service.absence(actor(request), snapshotId, slotId, AcceptanceDto.absence(body));
  }
  @Post('slots/:slotId/review') @HttpCode(200) @Roles('ADMIN', 'DISPATCHER') review(
    @Req() request: AuthenticatedRequest,
    @Param('snapshotId', ParseUUIDPipe) snapshotId: string,
    @Param('slotId', ParseUUIDPipe) slotId: string,
    @Body() body: unknown,
  ) {
    return this.service.review(actor(request), snapshotId, slotId, AcceptanceDto.review(body));
  }
  @Post('invalidate') @HttpCode(200) @Roles('ADMIN', 'DISPATCHER') invalidate(
    @Req() request: AuthenticatedRequest,
    @Param('snapshotId', ParseUUIDPipe) snapshotId: string,
    @Body() body: unknown,
  ) {
    return this.service.invalidate(actor(request), snapshotId, AcceptanceDto.invalidate(body));
  }
  private async image(
    request: AuthenticatedRequest,
    response: Response,
    snapshotId: string,
    signatureId: string,
  ): Promise<void> {
    const png = await this.service.content(actor(request), snapshotId, signatureId);
    response.setHeader('Content-Type', 'image/png');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Accept-Ranges', 'none');
    if (request.headers.range) {
      response.status(416).end();
      return;
    }
    response.setHeader('Content-Disposition', `inline; filename="signature-${signatureId}.png"`);
    response.setHeader('Content-Length', png.length);
    response.status(200).end(request.method === 'HEAD' ? undefined : png);
  }
  @Get('signatures/:signatureId/content') content(
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
    @Param('snapshotId', ParseUUIDPipe) snapshotId: string,
    @Param('signatureId', ParseUUIDPipe) signatureId: string,
  ) {
    return this.image(request, response, snapshotId, signatureId);
  }
  @Head('signatures/:signatureId/content') head(
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
    @Param('snapshotId', ParseUUIDPipe) snapshotId: string,
    @Param('signatureId', ParseUUIDPipe) signatureId: string,
  ) {
    return this.image(request, response, snapshotId, signatureId);
  }
}
