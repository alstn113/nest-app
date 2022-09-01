import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const GetCurrentUserId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): number | null => {
    const req = context.switchToHttp().getRequest();
    return req.user?.id;
  },
);
