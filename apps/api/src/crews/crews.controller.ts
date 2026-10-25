import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import type {
  AuthUser,
  CrewListResponse,
  CrewResponse,
  MemberCandidatesResponse,
} from '@furniture-delivery/contracts';
import { CurrentUser, Roles } from '../auth/public-api';
import { CrewDto } from './crews.dto';
import { CrewsService } from './crews.service';

@Controller('crews')
export class CrewsController {
  constructor(@Inject(CrewsService) private readonly crews: CrewsService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser): Promise<CrewListResponse> {
    return { crews: await this.crews.list(user) };
  }

  @Get('member-candidates')
  @Roles('ADMIN', 'DISPATCHER')
  async candidates(): Promise<MemberCandidatesResponse> {
    return { users: await this.crews.candidates() };
  }

  @Get(':id')
  async detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<CrewResponse> {
    return { crew: await this.crews.detail(id, user) };
  }

  @Post()
  @Roles('ADMIN', 'DISPATCHER')
  async create(@Body() body: unknown, @CurrentUser() user: AuthUser): Promise<CrewResponse> {
    const id = await this.crews.create(CrewDto.create(body));
    return { crew: await this.crews.detail(id, user) };
  }

  @Patch(':id')
  @Roles('ADMIN', 'DISPATCHER')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ): Promise<CrewResponse> {
    await this.crews.update(id, CrewDto.update(body));
    return { crew: await this.crews.detail(id, user) };
  }

  @Post(':id/members')
  @Roles('ADMIN', 'DISPATCHER')
  async addMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ): Promise<CrewResponse> {
    await this.crews.addMember(id, CrewDto.addMember(body).userId);
    return { crew: await this.crews.detail(id, user) };
  }

  @Patch(':id/members/:membershipId')
  @Roles('ADMIN', 'DISPATCHER')
  async membership(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ): Promise<CrewResponse> {
    await this.crews.updateMembership(id, membershipId, CrewDto.membership(body).active);
    return { crew: await this.crews.detail(id, user) };
  }

  @Post(':id/contacts')
  @Roles('ADMIN', 'DISPATCHER')
  async createContact(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ): Promise<CrewResponse> {
    await this.crews.createContact(id, CrewDto.createContact(body));
    return { crew: await this.crews.detail(id, user) };
  }

  @Patch(':id/contacts/:contactId')
  @Roles('ADMIN', 'DISPATCHER')
  async updateContact(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ): Promise<CrewResponse> {
    await this.crews.updateContact(id, contactId, CrewDto.updateContact(body));
    return { crew: await this.crews.detail(id, user) };
  }
}
