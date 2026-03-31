import { IsIn } from 'class-validator';

export class UpdateStatusDto {
  @IsIn(['pending', 'ongoing', 'review', 'done'])
  status: 'pending' | 'ongoing' | 'review' | 'done';
}
