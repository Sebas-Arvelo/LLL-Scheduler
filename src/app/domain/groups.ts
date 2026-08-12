import type { GroupCategoryId, GroupId } from './identifiers';

export interface GroupCategory {
  id: GroupCategoryId;
  name: string;
  active: boolean;
}

export interface CampGroup {
  id: GroupId;
  name: string;
  categoryId: GroupCategoryId;
  active: boolean;
  participantCount?: number;
}
