import { IsString, IsOptional } from 'class-validator';

export class ApproveDto {
  @IsOptional()
  @IsString()
  comment?: string;
}
