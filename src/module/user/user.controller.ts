import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GetCurrentUserId } from 'src/common/decorators/get-current-user-id.decorator';
import { Public } from 'src/common/decorators/public.decorator';
import { UserResponseDto } from './dto/user-response';
import { UserService } from './user.service';
import { Request } from 'express';

@Controller('/user')
@ApiTags('/user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  /** 
    TODO: null은 여기서 처리할게 아니라 client에서 처리해야함
    다 지우고 return req.user만 있으면 될 듯
    client에서 try catch해서 error면 null 반환이 맞는 듯. 
  */
  @Public()
  @Get('/me')
  async getCurrentUser(
    @GetCurrentUserId() userId: string,
    req: Request,
  ): Promise<UserResponseDto> {
    console.log(req.userId);
    if (userId === undefined) return null;
    return await this.userService.findUserById(userId);
  }
}
