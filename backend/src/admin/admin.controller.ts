import { Body, Controller, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UserStatusDto } from './dto/user-status.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('管理员')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  async getUsers() {
    return this.adminService.getUsers();
  }

  @Post('users')
  async createUser(@Body() dto: CreateUserDto) {
    return this.adminService.createUser(dto);
  }

  @Put('users/:username')
  async updateUser(@Param('username') username: string, @Body() dto: UpdateUserDto) {
    return this.adminService.updateUser(username, dto);
  }

  @Post('users/:username/reset-password')
  async resetPassword(@Param('username') username: string, @Body() dto: ResetPasswordDto) {
    return this.adminService.resetPassword(username, dto);
  }

  @Patch('users/:username/status')
  async setUserStatus(@Param('username') username: string, @Body() dto: UserStatusDto) {
    return this.adminService.setUserStatus(username, dto);
  }
}
