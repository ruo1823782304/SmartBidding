import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (!user || user.status !== 'enabled') {
      throw new UnauthorizedException('用户名或密码错误');
    }

    const ok = await bcrypt.compare(dto.password, user.password);
    if (!ok) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    const expiresIn = dto.remember ? '30d' : '7d';
    const token = this.jwt.sign(
      { sub: user.id, username: user.username, role: user.role },
      { expiresIn },
    );

    const userInfo = {
      username: user.username,
      name: user.name ?? '',
      role: user.role,
      contact: user.contact ?? undefined,
    };

    return { token, user: userInfo };
  }
}
