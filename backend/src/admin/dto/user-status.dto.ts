import { IsIn } from 'class-validator';

export class UserStatusDto {
  @IsIn(['启用', '禁用'])
  status: '启用' | '禁用';
}
