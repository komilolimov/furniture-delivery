import { Body, Controller, Get, Header, Inject, Param, Patch, Post } from '@nestjs/common';
import type { AuthResponse, UsersResponse } from '@furniture-delivery/contracts';
import { Roles } from '../auth/public-api';
import { uuidValue } from '../auth/validation';
import { parseCreateUser, parseUpdateUser } from './users.dto';
import { UsersService } from './users.service';

@Controller('users')
@Roles('ADMIN')
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(): Promise<UsersResponse> {
    return { users: await this.users.list() };
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  async find(@Param('id') id: string): Promise<AuthResponse> {
    return { user: await this.users.find(uuidValue(id)) };
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  async create(@Body() body: unknown): Promise<AuthResponse> {
    return { user: await this.users.create(parseCreateUser(body)) };
  }

  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  async update(@Param('id') id: string, @Body() body: unknown): Promise<AuthResponse> {
    return { user: await this.users.update(uuidValue(id), parseUpdateUser(body)) };
  }
}
