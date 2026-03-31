import { IsString, IsOptional, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  username: string;

  @IsString()
  @MinLength(6, { message: '密码至少6位' })
  password: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsString()
  role: string;

  @IsOptional()
  @IsString()
  superior?: string;
}
