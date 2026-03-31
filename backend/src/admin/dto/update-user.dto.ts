import { IsString, IsOptional, IsIn } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  superior?: string;

  @IsOptional()
  @IsIn(['启用', '禁用'])
  status?: '启用' | '禁用';
}
