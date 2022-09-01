import { Controller, Get, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { UserService } from './user.service';

@Controller('/user')
@ApiTags('/user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('/me')
  getCurrentUser(@Req() req: Request) {
    return this.userService.getCurrentUser(req);
  }
}
