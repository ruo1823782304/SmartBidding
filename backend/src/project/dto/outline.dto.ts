import { IsString, IsOptional, IsArray, IsObject } from 'class-validator';
import type { OutlineGroup } from '../../proposal/proposal-outline.util';

export class OutlineDto {
  @IsOptional()
  @IsString()
  tenderOutline?: string;

  @IsOptional()
  techOutlineSections?: OutlineGroup[];

  @IsOptional()
  bizOutlineSections?: OutlineGroup[];
}
