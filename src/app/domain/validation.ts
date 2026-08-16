import type { Activity, ActivityEligibility } from './activities';
import type { CampGroup, GroupCategory } from './groups';
import type { LocalDate } from './identifiers';
import type { Season } from './seasons';
import type { ActivityAvailability } from './scheduling';
import type { TimeBlock } from './time-blocks';

export type DomainValidationCode =
  | 'REQUIRED_VALUE'
  | 'INVALID_MIN_GROUPS'
  | 'INVALID_MAX_GROUPS'
  | 'INVALID_MAX_PARTICIPANTS'
  | 'INVALID_PARTICIPANT_COUNT'
  | 'INVALID_TIME_BLOCK_ORDER'
  | 'INVALID_TIME'
  | 'INVALID_DATE'
  | 'INVALID_DATE_RANGE'
  | 'INVALID_CAPACITY_OVERRIDE'
  | 'UNKNOWN_ACTIVITY'
  | 'UNKNOWN_GROUP_CATEGORY';

export interface DomainValidationIssue {
  code: DomainValidationCode;
  path: string;
  message: string;
}

function requiredString(value: string, path: string): DomainValidationIssue[] {
  return value.trim().length > 0
    ? []
    : [{ code: 'REQUIRED_VALUE', path, message: `${path} is required.` }];
}

function isLocalDate(value: LocalDate): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isLocalTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function validateGroupCategory(category: GroupCategory): DomainValidationIssue[] {
  return [...requiredString(category.id, 'id'), ...requiredString(category.name, 'name')];
}

export function validateCampGroup(group: CampGroup): DomainValidationIssue[] {
  const issues = [
    ...requiredString(group.id, 'id'),
    ...requiredString(group.name, 'name'),
    ...requiredString(group.categoryId, 'categoryId'),
  ];

  if (group.participantCount !== undefined && (!Number.isInteger(group.participantCount) || group.participantCount < 0)) {
    issues.push({
      code: 'INVALID_PARTICIPANT_COUNT',
      path: 'participantCount',
      message: 'participantCount must be a non-negative integer.',
    });
  }

  return issues;
}

export function validateActivity(activity: Activity): DomainValidationIssue[] {
  const issues = [...requiredString(activity.id, 'id'), ...requiredString(activity.name, 'name')];
  const minGroups = activity.minGroups ?? 1;

  if (!Number.isInteger(minGroups) || minGroups < 1 || minGroups > activity.maxGroups) {
    issues.push({
      code: 'INVALID_MIN_GROUPS',
      path: 'minGroups',
      message: 'minGroups must be an integer between 1 and maxGroups.',
    });
  }

  if (!Number.isInteger(activity.maxGroups) || activity.maxGroups < 1) {
    issues.push({
      code: 'INVALID_MAX_GROUPS',
      path: 'maxGroups',
      message: 'maxGroups must be an integer greater than or equal to 1.',
    });
  }

  if (activity.maxParticipants !== undefined && (!Number.isInteger(activity.maxParticipants) || activity.maxParticipants < 1)) {
    issues.push({
      code: 'INVALID_MAX_PARTICIPANTS',
      path: 'maxParticipants',
      message: 'maxParticipants must be an integer greater than or equal to 1.',
    });
  }

  return issues;
}

export function validateActivityEligibility(
  eligibility: ActivityEligibility,
  activities: readonly Activity[],
  categories: readonly GroupCategory[],
): DomainValidationIssue[] {
  const issues: DomainValidationIssue[] = [];

  if (!activities.some((activity) => activity.id === eligibility.activityId)) {
    issues.push({
      code: 'UNKNOWN_ACTIVITY',
      path: 'activityId',
      message: 'activityId must reference an existing activity.',
    });
  }
  if (!categories.some((category) => category.id === eligibility.groupCategoryId)) {
    issues.push({
      code: 'UNKNOWN_GROUP_CATEGORY',
      path: 'groupCategoryId',
      message: 'groupCategoryId must reference an existing group category.',
    });
  }

  return issues;
}

export function validateTimeBlock(timeBlock: TimeBlock): DomainValidationIssue[] {
  const issues = [
    ...requiredString(timeBlock.id, 'id'),
    ...requiredString(timeBlock.seasonId, 'seasonId'),
    ...requiredString(timeBlock.name, 'name'),
  ];

  if (!Number.isInteger(timeBlock.order) || timeBlock.order < 0) {
    issues.push({
      code: 'INVALID_TIME_BLOCK_ORDER',
      path: 'order',
      message: 'order must be a non-negative integer.',
    });
  }

  for (const [path, value] of [['startTime', timeBlock.startTime], ['endTime', timeBlock.endTime]] as const) {
    if (value !== undefined && !isLocalTime(value)) {
      issues.push({ code: 'INVALID_TIME', path, message: `${path} must use HH:mm format.` });
    }
  }

  return issues;
}

export function validateActivityAvailability(availability: ActivityAvailability): DomainValidationIssue[] {
  const issues = [
    ...requiredString(availability.activityId, 'activityId'),
    ...requiredString(availability.timeBlockId, 'timeBlockId'),
  ];

  if (!isLocalDate(availability.date)) {
    issues.push({ code: 'INVALID_DATE', path: 'date', message: 'date must be a valid YYYY-MM-DD date.' });
  }
  for (const [path, value] of [
    ['maxGroupsOverride', availability.maxGroupsOverride],
    ['maxParticipantsOverride', availability.maxParticipantsOverride],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
      issues.push({
        code: 'INVALID_CAPACITY_OVERRIDE',
        path,
        message: `${path} must be an integer greater than or equal to 1.`,
      });
    }
  }

  return issues;
}

export function validateSeason(season: Season): DomainValidationIssue[] {
  const issues = [...requiredString(season.id, 'id'), ...requiredString(season.name, 'name')];
  const validStart = isLocalDate(season.startDate);
  const validEnd = isLocalDate(season.endDate);

  if (!validStart) {
    issues.push({ code: 'INVALID_DATE', path: 'startDate', message: 'startDate must be a valid YYYY-MM-DD date.' });
  }
  if (!validEnd) {
    issues.push({ code: 'INVALID_DATE', path: 'endDate', message: 'endDate must be a valid YYYY-MM-DD date.' });
  }
  if (validStart && validEnd && season.startDate > season.endDate) {
    issues.push({
      code: 'INVALID_DATE_RANGE',
      path: 'endDate',
      message: 'endDate must be the same as or later than startDate.',
    });
  }

  return issues;
}
