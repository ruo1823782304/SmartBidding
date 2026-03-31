import { IsString, IsOptional } from 'class-validator';

export class ParseTenderDto {
  @IsString()
  projectId: string;

  @IsOptional()
  @IsString()
  fileId?: string;
}
