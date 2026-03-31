import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { UserService } from './user.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@Controller('user')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('me')
  async me(@CurrentUser() user: JwtPayload) {
    return this.userService.me(user.username);
  }

  @Put('profile')
  async updateProfile(@CurrentUser() user: JwtPayload, @Body() dto: UpdateProfileDto) {
    return this.userService.updateProfile(user, dto);
  }
}
