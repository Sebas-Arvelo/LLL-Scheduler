import type { SeasonId, TimeBlockId } from './identifiers';

export interface TimeBlock {
  id: TimeBlockId;
  seasonId: SeasonId;
  name: string;
  order: number;
  startTime?: string;
  endTime?: string;
  active: boolean;
}
