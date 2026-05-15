import { Controller, Get, Module } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@abarrotes/shared';
import { CurrentUser } from '../../common/decorators';

@ApiTags('auth')
@Controller('auth')
class AuthController {
  /** Devuelve el usuario resuelto del JWT (rol, sucursales). */
  @Get('me')
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }
}

@Module({ controllers: [AuthController] })
export class AuthModule {}
