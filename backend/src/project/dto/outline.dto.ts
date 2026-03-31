import { IsString, IsOptional, IsArray, IsObject } from 'class-validator';

export class OutlineDto {
  @IsOptional()
  @IsString()
  tenderOutline?: string;

  @IsOptional()
  techOutlineSections?: Array<{ group: string; sections: Array<{ name: string; detail?: string }> }>;

  @IsOptional()
  bizOutlineSections?: Array<{ group: string; sections: Array<{ name: string; detail?: string }> }>;
}
