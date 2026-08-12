import type { LocalDate, SeasonId } from './identifiers';

export interface Season {
  id: SeasonId;
  name: string;
  startDate: LocalDate;
  endDate: LocalDate;
  active: boolean;
}
