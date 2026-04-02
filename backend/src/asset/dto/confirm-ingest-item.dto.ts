import { IsOptional, IsString } from 'class-validator';

export class ConfirmIngestItemDto {
  @IsOptional()
  @IsString()
  targetCategory?: string;

  @IsOptional()
  @IsString()
  targetSubtype?: string;

  @IsOptional()
  @IsString()
  title?: string;
}
