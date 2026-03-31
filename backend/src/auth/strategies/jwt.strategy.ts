import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from '../../common/decorators/current-user.decorator';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'default-secret-change-me',
    });
  }

  async validate(payload: { sub: string; username: string; role: string }): Promise<JwtPayload> {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== 'enabled') {
      throw new UnauthorizedException('用户已禁用或不存在');
    }
    return { sub: user.id, username: user.username, role: user.role };
  }
}
