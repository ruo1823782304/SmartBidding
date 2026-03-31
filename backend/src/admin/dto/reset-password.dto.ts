import { IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @MinLength(6, { message: '新密码至少6位' })
  newPassword: string;
}
