import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UserStatusDto } from './dto/user-status.dto';

const MAX_USERS = 20;

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getUsers() {
    const list = await this.prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        username: true,
        name: true,
        role: true,
        status: true,
        superior: true,
        createdAt: true,
      },
    });
    const total = list.length;
    return {
      list: list.map((u) => ({
        ...u,
        createdAt: u.createdAt?.toISOString?.(),
      })),
      total,
    };
  }

  async createUser(dto: CreateUserDto) {
    const total = await this.prisma.user.count();
    if (total >= MAX_USERS) {
      throw new BadRequestException(`用户总数不能超过 ${MAX_USERS} 人`);
    }
    const exists = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (exists) throw new ConflictException('用户名已存在');
    const password = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        password,
        name: dto.name,
        role: dto.role,
        superior: dto.superior,
      },
      select: { username: true, name: true, role: true, status: true, superior: true, createdAt: true },
    });
    return { success: true, user: { ...user, createdAt: (user as { createdAt: Date }).createdAt?.toISOString?.() } };
  }

  async updateUser(username: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user) throw new BadRequestException('用户不存在');
    const adminCount = await this.prisma.user.count({ where: { role: '管理员', status: '启用' } });
    if (user.role === '管理员' && adminCount <= 1) {
      if (dto.role && dto.role !== '管理员') throw new BadRequestException('至少保留一名管理员');
      if (dto.status === '禁用') throw new BadRequestException('至少保留一名启用的管理员');
    }
    await this.prisma.user.update({
      where: { username },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.role !== undefined && { role: dto.role }),
        ...(dto.superior !== undefined && { superior: dto.superior }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });
    return { success: true };
  }

  async resetPassword(username: string, dto: ResetPasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user) throw new BadRequestException('用户不存在');
    const password = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({ where: { username }, data: { password } });
    return { success: true };
  }

  async setUserStatus(username: string, dto: UserStatusDto) {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user) throw new BadRequestException('用户不存在');
    const adminCount = await this.prisma.user.count({ where: { role: '管理员', status: '启用' } });
    if (user.role === '管理员' && adminCount <= 1 && dto.status === '禁用') {
      throw new BadRequestException('至少保留一名启用的管理员');
    }
    await this.prisma.user.update({ where: { username }, data: { status: dto.status } });
    return { success: true };
  }
}
