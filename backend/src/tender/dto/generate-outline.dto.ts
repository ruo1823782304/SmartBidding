import { IsString } from 'class-validator';

export class GenerateOutlineDto {
  @IsString()
  projectId: string;
}
