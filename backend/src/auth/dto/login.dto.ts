import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class LoginDto {
  @IsString()
  username: string;

  @IsString()
  password: string;

  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}
