import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class ModelProviderDto {
  @IsString()
  id!: string;

  @IsString()
  label!: string;

  @IsString()
  vendor!: string;

  @IsString()
  baseUrl!: string;

  @IsString()
  apiKey!: string;

  @IsString()
  model!: string;

  @IsOptional()
  @IsString()
  @IsIn(['openai-chat', 'anthropic-messages', 'chat'])
  wireApi?: 'openai-chat' | 'anthropic-messages' | 'chat';

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class ModelTaskRoutingDto {
  @IsOptional()
  @IsString()
  defaultProviderId?: string;

  @IsOptional()
  @IsString()
  tenderParseProviderId?: string;

  @IsOptional()
  @IsString()
  outlineGenerateProviderId?: string;

  @IsOptional()
  @IsString()
  sectionGenerateProviderId?: string;
}

export class ModelConfigDto {
  @IsOptional()
  @IsString()
  codingPlan?: string;

  @IsOptional()
  @IsString()
  codingPlanUrl?: string;

  @IsOptional()
  @IsString()
  codingPlanApiKey?: string;

  @IsOptional()
  @IsString()
  codingPlanAppId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  supportedModels?: string[];

  @IsOptional()
  @IsString()
  activeProviderId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ModelProviderDto)
  providers?: ModelProviderDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => ModelTaskRoutingDto)
  taskRouting?: ModelTaskRoutingDto;
}
