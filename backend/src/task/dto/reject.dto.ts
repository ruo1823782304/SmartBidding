import { IsString } from 'class-validator';

export class RejectDto {
  @IsString()
  reason: string;
}
