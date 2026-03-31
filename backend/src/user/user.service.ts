import { Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtPayload } from '../common/decorators/current-user.decorator';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async me(username: string) {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user) throw new NotFoundException('用户不存在');
    return {
      user: {
        username: user.username,
        name: user.name ?? '',
        role: user.role,
        contact: user.contact ?? undefined,
      },
    };
  }

  async updateProfile(current: JwtPayload, dto: UpdateProfileDto) {
    const data: { name?: string; contact?: string; password?: string } = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.contact !== undefined) data.contact = dto.contact;
    if (dto.newPassword) {
      data.password = await bcrypt.hash(dto.newPassword, 10);
    }
    const user = await this.prisma.user.update({
      where: { username: current.username },
      data,
    });
    return {
      success: true,
      user: {
        username: user.username,
        name: user.name ?? '',
        role: user.role,
        contact: user.contact ?? undefined,
      },
    };
  }
}
