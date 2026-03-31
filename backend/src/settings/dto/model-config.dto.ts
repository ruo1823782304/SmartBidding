import { IsString, IsOptional } from 'class-validator';

export class ModelConfigDto {
  @IsOptional()
  @IsString()
  codingPlan?: string;

  @IsOptional()
  @IsString()
  selectedModel?: string;

  @IsOptional()
  @IsString()
  openaiKey?: string;

  @IsOptional()
  @IsString()
  qwenKey?: string;

  @IsOptional()
  @IsString()
  deepseekKey?: string;

  @IsOptional()
  @IsString()
  baichuanKey?: string;
}
