import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { Roles } from '../auth/public-api';
import { EvidenceDto } from './evidence.dto';
import { EvidenceService } from './evidence.service';
function actor(request: AuthenticatedRequest) {
  return { id: request.user!.id, sessionId: request.sessionId };
}
@Controller('crew/assignments/:id')
@Roles('CREW_MEMBER')
export class CrewEvidenceController {
  constructor(@Inject(EvidenceService) private readonly evidence: EvidenceService) {}
  @Get('evidence') read(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.evidence.read(actor(request), { assignmentId: id });
  }
  @Post('notes') @HttpCode(200) note(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.evidence.createNote(
      actor(request),
      { assignmentId: id },
      EvidenceDto.note(body, true),
    );
  }
  @Post('issues') @HttpCode(200) issue(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.evidence.createIssue(
      actor(request),
      { assignmentId: id },
      EvidenceDto.issue(body, true),
    );
  }
  @Post('issues/:issueId/notes') @HttpCode(200) issueNote(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('issueId', ParseUUIDPipe) issueId: string,
    @Body() body: unknown,
  ) {
    return this.evidence.issueNote(
      actor(request),
      { assignmentId: id },
      issueId,
      EvidenceDto.issueNote(body),
    );
  }
}
@Controller('orders/:orderId')
@Roles('ADMIN', 'DISPATCHER')
export class OrderEvidenceController {
  constructor(@Inject(EvidenceService) private readonly evidence: EvidenceService) {}
  @Get('evidence') read(
    @Req() request: AuthenticatedRequest,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.evidence.read(actor(request), { orderId });
  }
  @Post('notes') @HttpCode(200) note(
    @Req() request: AuthenticatedRequest,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() body: unknown,
  ) {
    return this.evidence.createNote(actor(request), { orderId }, EvidenceDto.note(body));
  }
  @Post('issues') @HttpCode(200) issue(
    @Req() request: AuthenticatedRequest,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() body: unknown,
  ) {
    return this.evidence.createIssue(actor(request), { orderId }, EvidenceDto.issue(body));
  }
  @Post('issues/:issueId/notes') @HttpCode(200) issueNote(
    @Req() request: AuthenticatedRequest,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('issueId', ParseUUIDPipe) issueId: string,
    @Body() body: unknown,
  ) {
    return this.evidence.issueNote(
      actor(request),
      { orderId },
      issueId,
      EvidenceDto.issueNote(body),
    );
  }
  @Post('issues/:issueId/resolve') @HttpCode(200) resolve(
    @Req() request: AuthenticatedRequest,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('issueId', ParseUUIDPipe) issueId: string,
    @Body() body: unknown,
  ) {
    return this.evidence.command(
      actor(request),
      orderId,
      issueId,
      'RESOLVE',
      EvidenceDto.command(body),
    );
  }
  @Post('issues/:issueId/reopen') @HttpCode(200) reopen(
    @Req() request: AuthenticatedRequest,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('issueId', ParseUUIDPipe) issueId: string,
    @Body() body: unknown,
  ) {
    return this.evidence.command(
      actor(request),
      orderId,
      issueId,
      'REOPEN',
      EvidenceDto.command(body),
    );
  }
}
@Controller('issues')
@Roles('ADMIN', 'DISPATCHER')
export class IssuesController {
  constructor(@Inject(EvidenceService) private readonly evidence: EvidenceService) {}
  @Get() list(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.evidence.listIssues(actor(request), EvidenceDto.query(query));
  }
}
