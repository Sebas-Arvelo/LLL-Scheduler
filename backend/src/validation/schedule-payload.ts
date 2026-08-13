import type {
  ConfigurationSnapshot,
  CreateScheduleAssignment,
  CreateScheduleRequest,
  CreateScheduleUnassigned,
} from '../contracts';
import { UNASSIGNED_REASON_CODES } from '../contracts';
import { BadRequestError, ConflictError } from '../errors';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, path: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestError(`${path} must be an object.`);
  }
  return value as UnknownRecord;
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new BadRequestError(`${path} must be an array.`);
  return value;
}

function identifier(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new BadRequestError(`${path} must be a non-empty identifier of at most 128 characters.`);
  }
  return value;
}

function text(value: unknown, path: string, required = true): string | undefined {
  if (value === undefined || value === null || value === '') {
    if (required) throw new BadRequestError(`${path} is required.`);
    return undefined;
  }
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 500) {
    throw new BadRequestError(`${path} must be a non-empty string of at most 500 characters.`);
  }
  return value.trim();
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new BadRequestError(`${path} must be a boolean.`);
  return value;
}

function integer(value: unknown, path: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new BadRequestError(`${path} must be an integer between ${minimum} and ${maximum}.`);
  }
  return Number(value);
}

function localDate(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new BadRequestError(`${path} must use YYYY-MM-DD.`);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new BadRequestError(`${path} must use YYYY-MM-DD.`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.toISOString().slice(0, 10) !== value) throw new BadRequestError(`${path} must be a valid date.`);
  return value;
}

function localTime(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new BadRequestError(`${path} must use HH:mm.`);
  }
  return value;
}

function requireUnique(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) throw new ConflictError(`${path} must not contain duplicate identifiers.`);
}

function parseSnapshot(value: unknown): ConfigurationSnapshot {
  const snapshot = record(value, 'configurationSnapshot');
  const seasonRecord = record(snapshot['season'], 'configurationSnapshot.season');
  const season = {
    id: identifier(seasonRecord['id'], 'configurationSnapshot.season.id'),
    name: text(seasonRecord['name'], 'configurationSnapshot.season.name')!,
    startDate: localDate(seasonRecord['startDate'], 'configurationSnapshot.season.startDate'),
    endDate: localDate(seasonRecord['endDate'], 'configurationSnapshot.season.endDate'),
    active: boolean(seasonRecord['active'], 'configurationSnapshot.season.active'),
  };
  if (season.endDate < season.startDate) throw new BadRequestError('Snapshot season date range is invalid.');

  const categories = array(snapshot['categories'], 'configurationSnapshot.categories').map((value, index) => {
    const item = record(value, `configurationSnapshot.categories[${index}]`);
    return {
      id: identifier(item['id'], `configurationSnapshot.categories[${index}].id`),
      name: text(item['name'], `configurationSnapshot.categories[${index}].name`)!,
      active: boolean(item['active'], `configurationSnapshot.categories[${index}].active`),
    };
  });
  requireUnique(categories.map((category) => category.id), 'configurationSnapshot.categories');
  const categoryIds = new Set(categories.map((category) => category.id));

  const groups = array(snapshot['groups'], 'configurationSnapshot.groups').map((value, index) => {
    const item = record(value, `configurationSnapshot.groups[${index}]`);
    const categoryId = identifier(item['categoryId'], `configurationSnapshot.groups[${index}].categoryId`);
    if (!categoryIds.has(categoryId)) throw new BadRequestError(`Group ${index} references an unknown category.`);
    return {
      id: identifier(item['id'], `configurationSnapshot.groups[${index}].id`),
      name: text(item['name'], `configurationSnapshot.groups[${index}].name`)!,
      categoryId,
      active: boolean(item['active'], `configurationSnapshot.groups[${index}].active`),
      ...(item['participantCount'] !== undefined
        ? { participantCount: integer(item['participantCount'], `configurationSnapshot.groups[${index}].participantCount`, 0) }
        : {}),
    };
  });
  requireUnique(groups.map((group) => group.id), 'configurationSnapshot.groups');

  const activities = array(snapshot['activities'], 'configurationSnapshot.activities').map((value, index) => {
    const item = record(value, `configurationSnapshot.activities[${index}]`);
    return {
      id: identifier(item['id'], `configurationSnapshot.activities[${index}].id`),
      name: text(item['name'], `configurationSnapshot.activities[${index}].name`)!,
      active: boolean(item['active'], `configurationSnapshot.activities[${index}].active`),
      maxGroups: integer(item['maxGroups'], `configurationSnapshot.activities[${index}].maxGroups`, 1),
      ...(item['maxParticipants'] !== undefined
        ? { maxParticipants: integer(item['maxParticipants'], `configurationSnapshot.activities[${index}].maxParticipants`, 1) }
        : {}),
      ...(text(item['displayCategory'], `configurationSnapshot.activities[${index}].displayCategory`, false)
        ? { displayCategory: text(item['displayCategory'], `configurationSnapshot.activities[${index}].displayCategory`, false) }
        : {}),
      ...(text(item['description'], `configurationSnapshot.activities[${index}].description`, false)
        ? { description: text(item['description'], `configurationSnapshot.activities[${index}].description`, false) }
        : {}),
    };
  });
  requireUnique(activities.map((activity) => activity.id), 'configurationSnapshot.activities');
  const activityIds = new Set(activities.map((activity) => activity.id));

  const eligibility = array(snapshot['eligibility'], 'configurationSnapshot.eligibility').map((value, index) => {
    const item = record(value, `configurationSnapshot.eligibility[${index}]`);
    const activityId = identifier(item['activityId'], `configurationSnapshot.eligibility[${index}].activityId`);
    const groupCategoryId = identifier(
      item['groupCategoryId'],
      `configurationSnapshot.eligibility[${index}].groupCategoryId`,
    );
    if (!activityIds.has(activityId) || !categoryIds.has(groupCategoryId)) {
      throw new BadRequestError(`Eligibility ${index} contains an unknown reference.`);
    }
    return { activityId, groupCategoryId };
  });
  requireUnique(
    eligibility.map((entry) => `${entry.activityId}\u0000${entry.groupCategoryId}`),
    'configurationSnapshot.eligibility',
  );

  const timeBlocks = array(snapshot['timeBlocks'], 'configurationSnapshot.timeBlocks').map((value, index) => {
    const item = record(value, `configurationSnapshot.timeBlocks[${index}]`);
    const block = {
      id: identifier(item['id'], `configurationSnapshot.timeBlocks[${index}].id`),
      seasonId: identifier(item['seasonId'], `configurationSnapshot.timeBlocks[${index}].seasonId`),
      name: text(item['name'], `configurationSnapshot.timeBlocks[${index}].name`)!,
      order: integer(item['order'], `configurationSnapshot.timeBlocks[${index}].order`, 0),
      active: boolean(item['active'], `configurationSnapshot.timeBlocks[${index}].active`),
      ...(localTime(item['startTime'], `configurationSnapshot.timeBlocks[${index}].startTime`)
        ? { startTime: localTime(item['startTime'], `configurationSnapshot.timeBlocks[${index}].startTime`) }
        : {}),
      ...(localTime(item['endTime'], `configurationSnapshot.timeBlocks[${index}].endTime`)
        ? { endTime: localTime(item['endTime'], `configurationSnapshot.timeBlocks[${index}].endTime`) }
        : {}),
    };
    if (block.seasonId !== season.id) throw new BadRequestError(`Time block ${index} belongs to another season.`);
    if (block.startTime && block.endTime && block.endTime <= block.startTime) {
      throw new BadRequestError(`Time block ${index} has an invalid time range.`);
    }
    return block;
  });
  requireUnique(timeBlocks.map((block) => block.id), 'configurationSnapshot.timeBlocks');

  return { season, categories, groups, activities, eligibility, timeBlocks };
}

export function validateCreateScheduleRequest(value: unknown): CreateScheduleRequest {
  const body = record(value, 'body');
  const seasonId = identifier(body['seasonId'], 'seasonId');
  const rangeStart = localDate(body['rangeStart'], 'rangeStart');
  const rangeEnd = localDate(body['rangeEnd'], 'rangeEnd');
  if (rangeEnd < rangeStart) throw new BadRequestError('rangeEnd must not be before rangeStart.');
  const snapshot = parseSnapshot(body['configurationSnapshot']);
  if (snapshot.season.id !== seasonId) throw new BadRequestError('seasonId must match the configuration snapshot.');
  if (rangeStart < snapshot.season.startDate || rangeEnd > snapshot.season.endDate) {
    throw new BadRequestError('Schedule range must be within the snapshot season.');
  }

  const groupById = new Map(snapshot.groups.map((group) => [group.id, group]));
  const activityById = new Map(snapshot.activities.map((activity) => [activity.id, activity]));
  const blockById = new Map(snapshot.timeBlocks.map((block) => [block.id, block]));
  const eligible = new Set(snapshot.eligibility.map((entry) => `${entry.activityId}\u0000${entry.groupCategoryId}`));

  const assignments = array(body['assignments'], 'assignments').map<CreateScheduleAssignment>((value, index) => {
    const item = record(value, `assignments[${index}]`);
    const groupId = identifier(item['groupId'], `assignments[${index}].groupId`);
    const activityId = identifier(item['activityId'], `assignments[${index}].activityId`);
    const timeBlockId = identifier(item['timeBlockId'], `assignments[${index}].timeBlockId`);
    const date = localDate(item['date'], `assignments[${index}].date`);
    const group = groupById.get(groupId);
    const activity = activityById.get(activityId);
    const block = blockById.get(timeBlockId);
    if (!group || !activity || !block) {
      throw new BadRequestError(`Assignment ${index} contains an unknown reference.`);
    }
    if (!group.active || !activity.active || !block.active) {
      throw new BadRequestError(`Assignment ${index} references an inactive entity.`);
    }
    if (activity.maxParticipants !== undefined && group.participantCount === undefined) {
      throw new BadRequestError(`Assignment ${index} requires the group participant count.`);
    }
    if (!eligible.has(`${activityId}\u0000${group.categoryId}`)) {
      throw new BadRequestError(`Assignment ${index} is not eligible for its group category.`);
    }
    if (date < rangeStart || date > rangeEnd) throw new BadRequestError(`Assignment ${index} is outside the range.`);
    if (item['status'] !== 'planned') throw new BadRequestError(`assignments[${index}].status must be planned.`);
    if (item['source'] !== 'automatic' && item['source'] !== 'manual' && item['source'] !== 'imported') {
      throw new BadRequestError(`assignments[${index}].source is invalid.`);
    }
    return {
      groupId,
      activityId,
      date,
      timeBlockId,
      ...(item['cycleId'] !== undefined ? { cycleId: identifier(item['cycleId'], `assignments[${index}].cycleId`) } : {}),
      source: item['source'],
      status: 'planned',
      locked: boolean(item['locked'], `assignments[${index}].locked`),
    };
  });

  const unassigned = array(body['unassigned'], 'unassigned').map<CreateScheduleUnassigned>((value, index) => {
    const item = record(value, `unassigned[${index}]`);
    const groupId = identifier(item['groupId'], `unassigned[${index}].groupId`);
    const timeBlockId = identifier(item['timeBlockId'], `unassigned[${index}].timeBlockId`);
    const date = localDate(item['date'], `unassigned[${index}].date`);
    if (!groupById.has(groupId) || !blockById.has(timeBlockId)) {
      throw new BadRequestError(`Unassigned ${index} contains an unknown reference.`);
    }
    if (date < rangeStart || date > rangeEnd) throw new BadRequestError(`Unassigned ${index} is outside the range.`);
    if (!UNASSIGNED_REASON_CODES.includes(item['reasonCode'] as never)) {
      throw new BadRequestError(`unassigned[${index}].reasonCode is invalid.`);
    }
    const context = item['context'] === undefined ? undefined : record(item['context'], `unassigned[${index}].context`);
    return {
      groupId,
      date,
      timeBlockId,
      reasonCode: item['reasonCode'] as CreateScheduleUnassigned['reasonCode'],
      ...(context ? { context } : {}),
    };
  });

  const assignmentKeys = assignments.map((assignment) => `${assignment.groupId}\u0000${assignment.date}\u0000${assignment.timeBlockId}`);
  const duplicateAssignment = assignmentKeys.find((key, index) => assignmentKeys.indexOf(key) !== index);
  if (duplicateAssignment) throw new ConflictError('A group can have only one assignment per schedule slot.');
  const unassignedKeys = unassigned.map((entry) => `${entry.groupId}\u0000${entry.date}\u0000${entry.timeBlockId}`);
  if (new Set(unassignedKeys).size !== unassignedKeys.length) {
    throw new ConflictError('A group can be unassigned only once per schedule slot.');
  }
  if (unassignedKeys.some((key) => assignmentKeys.includes(key))) {
    throw new ConflictError('A group cannot be both assigned and unassigned in the same schedule slot.');
  }

  const capacityByActivitySlot = new Map<string, { groups: number; participants: number }>();
  for (const assignment of assignments) {
    const key = `${assignment.activityId}\u0000${assignment.date}\u0000${assignment.timeBlockId}`;
    const usage = capacityByActivitySlot.get(key) ?? { groups: 0, participants: 0 };
    usage.groups += 1;
    usage.participants += groupById.get(assignment.groupId)?.participantCount ?? 0;
    capacityByActivitySlot.set(key, usage);
    const activity = activityById.get(assignment.activityId)!;
    if (usage.groups > activity.maxGroups ||
        (activity.maxParticipants !== undefined && usage.participants > activity.maxParticipants)) {
      throw new ConflictError(`Assignments exceed the configured capacity for activity ${assignment.activityId}.`);
    }
  }

  return {
    seasonId,
    ...(text(body['name'], 'name', false) ? { name: text(body['name'], 'name', false) } : {}),
    rangeStart,
    rangeEnd,
    seed: integer(body['seed'], 'seed', 0, 4_294_967_295),
    algorithmVersion: text(body['algorithmVersion'], 'algorithmVersion')!,
    configurationSnapshot: snapshot,
    assignments,
    unassigned,
  };
}

export function validateIdentifierParameter(value: string, name: string): string {
  return identifier(value, name);
}

export function validateUuidParameter(value: string, name: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new BadRequestError(`${name} must be a UUID.`);
  }
  return value;
}
