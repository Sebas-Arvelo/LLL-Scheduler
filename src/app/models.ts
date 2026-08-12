export interface SeasonOption {
  id: string;
  label: string;
  days: number;
}

export interface CampGroupConfig {
  key: string;
  label: string;
  count: number;
}

export interface CampGroup {
  id: string;
  name: string;
  category: string;
}

export interface CampActivity {
  id: string;
  name: string;
  category: string;
  description: string;
  capacity: number;
  enabled: boolean;
}

export interface Assignment {
  group: CampGroup;
  activity: CampActivity;
}

export interface DailyPlan {
  day: number;
  assignments: Assignment[];
}
