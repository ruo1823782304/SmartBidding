import { IsString } from 'class-validator';

export class SectionContentDto {
  @IsString()
  content: string;
}
