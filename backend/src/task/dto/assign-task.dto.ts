import { IsString, IsOptional, IsArray } from 'class-validator';

export class AssignTaskDto {
  @IsString()
  username: string;

  @IsOptional()
  @IsString()
  roleName?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sectionKeys?: string[];
}
