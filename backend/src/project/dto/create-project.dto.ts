import { IsString, IsOptional } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  owner?: string;

  @IsOptional()
  @IsString()
  deadline?: string;

  @IsOptional()
  @IsString()
  type?: string;
}
