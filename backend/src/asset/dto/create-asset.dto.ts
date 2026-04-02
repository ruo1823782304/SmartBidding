import { IsString, IsOptional, IsArray } from 'class-validator';

export class CreateAssetDto {
  @IsString()
  category: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  subtype?: string;

  @IsOptional()
  @IsString()
  sourceMode?: string;

  @IsOptional()
  @IsString()
  metadata?: string;
}
