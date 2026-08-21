import type { ActivityCycleSnapshot } from '../cycles';
import type { LocalDate } from '../identifiers';
import type {
  ScheduleBlockResult,
  ScheduleBlockUnassigned,
  ScheduleGenerationInput,
  ScheduleGenerationResult,
  ScheduleSlot,
} from '../schedule-generation';
import type { Assignment, SchedulingDiagnosticIssue } from '../scheduling';
import { validateSeason, validateTimeBlock } from '../validation';
import { scheduleBlock } from './block-scheduler';
import {
  activeCycleSnapshots,
  applyAssignmentsToProjectedCycles,
  ensureProjectedCyclesForSlot,
  initializeProjectedCycles,
  type ProjectedAssignmentEffect,
} from './projected-cycles';
import { calculateScheduleMetrics } from './schedule-metrics';

export const SCHEDULE_GENERATOR_VERSION = 'multi-block-sessions-v2';
const DEFAULT_SEED = 0;

function isLocalDate(value: string): value is LocalDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3])
  );
}

function buildSlots(input: ScheduleGenerationInput): readonly ScheduleSlot[] {
  const dates = [...new Set(input.dates)].sort();
  const blocks = [...input.timeBlocks].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id),
  );
  return dates.flatMap((date) =>
    blocks.map((block) => ({ date, timeBlockId: block.id, timeBlockOrder: block.order })),
  );
}

function validateGenerationInput(input: ScheduleGenerationInput): readonly SchedulingDiagnosticIssue[] {
  const issues: SchedulingDiagnosticIssue[] = [];
  const seasonIssues = validateSeason(input.season);
  const timeBlockIssues = input.timeBlocks.flatMap((block) => validateTimeBlock(block));
  const invalidDates = input.dates.filter(
    (date) => !isLocalDate(date) || date < input.season.startDate || date > input.season.endDate,
  );
  const wrongSeasonBlocks = input.timeBlocks.filter((block) => block.seasonId !== input.season.id);
  const duplicateBlockIds = input.timeBlocks
    .map((block) => block.id)
    .filter((id, index, all) => all.indexOf(id) !== index);
  const duplicateBlockOrders = input.timeBlocks
    .map((block) => block.order)
    .filter((order, index, all) => all.indexOf(order) !== index);
  const requestedDates = new Set(input.dates);
  const activityIds = new Set(input.activities.map((activity) => activity.id));
  const blockIds = new Set(input.timeBlocks.map((block) => block.id));
  const invalidActivityStartBlocks = (input.hardConstraints.activityStartBlocks ?? []).filter(
    (entry) => !requestedDates.has(entry.date) || !activityIds.has(entry.activityId) || !blockIds.has(entry.timeBlockId),
  );
  const activityStartKeys = (input.hardConstraints.activityStartBlocks ?? []).map(
    (entry) => `${entry.date}\u0000${entry.activityId}`,
  );
  const duplicateActivityStarts = activityStartKeys.filter((key, index, all) => all.indexOf(key) !== index);
  const lockedDailyActivityKeys = input.lockedAssignments
    .filter((assignment) => requestedDates.has(assignment.date))
    .map((assignment) => `${assignment.date}\u0000${assignment.groupId}\u0000${assignment.activityId}`);
  const duplicateLockedDailyActivities = lockedDailyActivityKeys.filter(
    (key, index, all) => all.indexOf(key) !== index,
  );
  if (
    seasonIssues.length > 0 ||
    timeBlockIssues.length > 0 ||
    invalidDates.length > 0 ||
    wrongSeasonBlocks.length > 0 ||
    duplicateBlockIds.length > 0 ||
    duplicateBlockOrders.length > 0 ||
    invalidActivityStartBlocks.length > 0 ||
    duplicateActivityStarts.length > 0 ||
    duplicateLockedDailyActivities.length > 0 ||
    new Set(input.dates).size !== input.dates.length
  ) {
    issues.push({
      code: 'INVALID_SCHEDULING_INPUT',
      message: 'Multi-block generation input is invalid.',
      context: {
        seasonIssues,
        timeBlockIssues,
        invalidDates,
        wrongSeasonBlockIds: wrongSeasonBlocks.map((block) => block.id),
        duplicateBlockIds: [...new Set(duplicateBlockIds)],
        duplicateBlockOrders: [...new Set(duplicateBlockOrders)],
        invalidActivityStartBlocks,
        duplicateActivityStarts: [...new Set(duplicateActivityStarts)],
        duplicateDates: input.dates.filter((date, index, all) => all.indexOf(date) !== index),
        duplicateLockedDailyActivities: [...new Set(duplicateLockedDailyActivities)],
      },
    });
  }
  return issues;
}

function emptyResult(
  input: ScheduleGenerationInput,
  seed: number,
  errors: readonly SchedulingDiagnosticIssue[],
): ScheduleGenerationResult {
  const projectedCycles = initializeProjectedCycles(input.groups, input.initialCycleSnapshots);
  return {
    status: 'invalid_input',
    assignments: [],
    unassigned: [],
    projectedCycles,
    blocks: [],
    metrics: calculateScheduleMetrics(input.groups, input.activities, 0, [], 0, []),
    diagnostics: {
      engineVersion: SCHEDULE_GENERATOR_VERSION,
      seed,
      blockCount: 0,
      generatedBlockCount: 0,
      branchAndBoundNodes: 0,
      branchAndBoundBranches: 0,
      warnings: [],
      errors,
    },
  };
}

function slotSeed(seed: number, index: number): number {
  return (seed + Math.imul(index + 1, 0x9e3779b1)) >>> 0;
}

function blocksAreConsecutive(current: ScheduleGenerationInput['timeBlocks'][number], next: ScheduleGenerationInput['timeBlocks'][number]): boolean {
  if (current.endTime && next.startTime) return current.endTime === next.startTime;
  const currentName = /^([MT])(\d+)$/i.exec(current.name.trim());
  const nextName = /^([MT])(\d+)$/i.exec(next.name.trim());
  return !!currentName && !!nextName && currentName[1].toUpperCase() === nextName[1].toUpperCase() &&
    Number(nextName[2]) === Number(currentName[2]) + 1;
}

function sessionSlots(
  input: ScheduleGenerationInput,
  slots: readonly ScheduleSlot[],
  startIndex: number,
  duration: number,
): readonly ScheduleSlot[] | undefined {
  const selected = slots.slice(startIndex, startIndex + duration);
  if (selected.length !== duration || selected.some((slot) => slot.date !== slots[startIndex].date)) return undefined;
  for (let index = 1; index < selected.length; index += 1) {
    const previousBlock = input.timeBlocks.find((block) => block.id === selected[index - 1].timeBlockId)!;
    const currentBlock = input.timeBlocks.find((block) => block.id === selected[index].timeBlockId)!;
    if (!blocksAreConsecutive(previousBlock, currentBlock)) return undefined;
  }
  return selected;
}

function sessionId(assignment: Assignment): string {
  return `session:${assignment.date}:${assignment.groupId}:${assignment.activityId}:${assignment.timeBlockId}`;
}

export function generateSchedule(input: ScheduleGenerationInput): ScheduleGenerationResult {
  const seed = Number.isFinite(input.seed) ? Math.trunc(input.seed!) >>> 0 : DEFAULT_SEED;
  const validationIssues = validateGenerationInput(input);
  if (validationIssues.length > 0) return emptyResult(input, seed, validationIssues);

  const slots = buildSlots(input);
  const requestedSlotKeys = new Set(slots.map((slot) => `${slot.date}\u0000${slot.timeBlockId}`));
  const warnings: SchedulingDiagnosticIssue[] = [];
  const errors: SchedulingDiagnosticIssue[] = [];
  for (const assignment of input.lockedAssignments) {
    if (!requestedSlotKeys.has(`${assignment.date}\u0000${assignment.timeBlockId}`)) {
      warnings.push({
        code: 'LOCKED_ASSIGNMENT_OUTSIDE_GENERATION',
        message: 'Locked assignment is outside the requested dates and blocks.',
        context: { groupId: assignment.groupId, date: assignment.date, timeBlockId: assignment.timeBlockId },
      });
    }
  }

  let projectedCycles = initializeProjectedCycles(input.groups, input.initialCycleSnapshots);
  const assignments: Assignment[] = [];
  const effects: ProjectedAssignmentEffect[] = [];
  const blocks: ScheduleBlockResult[] = [];
  const unassigned: ScheduleBlockUnassigned[] = [];
  const continuationsBySlot = new Map<string, Assignment[]>();
  let invalidInput = false;

  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    const timeBlock = input.timeBlocks.find((block) => block.id === slot.timeBlockId)!;
    projectedCycles = ensureProjectedCyclesForSlot(
      projectedCycles,
      input.groups,
      input.activities,
      input.activityEligibility,
      slot,
    );
    const lockedAssignments = [
      ...input.lockedAssignments.filter(
      (assignment) => assignment.date === slot.date && assignment.timeBlockId === slot.timeBlockId,
      ),
      ...(continuationsBySlot.get(`${slot.date}\u0000${slot.timeBlockId}`) ?? []),
    ];
    const forbiddenActivityStarts = input.groups.flatMap((group) =>
      input.activities.flatMap((activity) => {
        const requiredStart = input.hardConstraints.activityStartBlocks?.find(
          (entry) => entry.activityId === activity.id && entry.date === slot.date,
        );
        if (requiredStart && requiredStart.timeBlockId !== slot.timeBlockId) {
          return [{ groupId: group.id, activityId: activity.id }];
        }
        const duration = activity.durationBlocks ?? 1;
        if (duration <= 1) return [];
        const requiredSlots = sessionSlots(input, slots, index, duration);
        const blocked = !requiredSlots || requiredSlots.some((requiredSlot) =>
          input.hardConstraints.activityAvailability.some((entry) =>
            entry.activityId === activity.id && entry.date === requiredSlot.date &&
            entry.timeBlockId === requiredSlot.timeBlockId && !entry.available,
          ) || input.hardConstraints.groupUnavailability.some((entry) =>
            entry.groupId === group.id && entry.date === requiredSlot.date && entry.timeBlockId === requiredSlot.timeBlockId,
          ),
        );
        return blocked ? [{ groupId: group.id, activityId: activity.id }] : [];
      }),
    );
    const rawResult = scheduleBlock({
      date: slot.date,
      timeBlock,
      groups: input.groups,
      activities: input.activities,
      groupCategories: input.groupCategories,
      activityEligibility: input.activityEligibility,
      cycleSnapshots: activeCycleSnapshots(projectedCycles),
      history: input.history,
      projectedAssignments: assignments,
      sameDayAssignments: [...assignments, ...input.lockedAssignments],
      forbiddenActivityStarts,
      lockedAssignments,
      hardConstraints: input.hardConstraints,
      preferences: input.preferences,
      seed: slotSeed(seed, index),
    });
    const blockAssignments = rawResult.assignments.map<Assignment>((assignment) => {
      if (assignment.sessionId) return assignment;
      const activity = input.activities.find((candidate) => candidate.id === assignment.activityId);
      const duration = activity?.durationBlocks ?? 1;
      if (duration <= 1 || assignment.locked) return assignment;
      const requiredSlots = sessionSlots(input, slots, index, duration);
      if (!requiredSlots) return assignment;
      const id = sessionId(assignment);
      for (let sessionIndex = 1; sessionIndex < requiredSlots.length; sessionIndex += 1) {
        const continuationSlot = requiredSlots[sessionIndex];
        const key = `${continuationSlot.date}\u0000${continuationSlot.timeBlockId}`;
        const continuations = continuationsBySlot.get(key) ?? [];
        continuations.push({
          ...assignment,
          timeBlockId: continuationSlot.timeBlockId,
          sessionId: id,
          sessionBlockIndex: sessionIndex,
          sessionBlockCount: duration,
          locked: true,
        });
        continuationsBySlot.set(key, continuations);
      }
      return { ...assignment, sessionId: id, sessionBlockIndex: 0, sessionBlockCount: duration };
    });
    const result = { ...rawResult, assignments: blockAssignments };
    blocks.push({ slot, result });
    warnings.push(...result.diagnostics.warnings);
    errors.push(...result.diagnostics.errors);
    if (result.unassigned.length > 0) unassigned.push({ slot, groups: result.unassigned });
    assignments.push(...result.assignments);
    if (result.status === 'invalid_input') {
      invalidInput = true;
      break;
    }

    const completedSessions = result.assignments.filter(
      (assignment) => assignment.sessionBlockCount === undefined ||
        assignment.sessionBlockIndex === assignment.sessionBlockCount - 1,
    );
    const update = applyAssignmentsToProjectedCycles(projectedCycles, completedSessions, slot);
    projectedCycles = update.states;
    effects.push(...update.effects);
  }

  const unassignedCellCount = unassigned.reduce((sum, block) => sum + block.groups.length, 0);
  const branchAndBoundNodes = blocks.reduce(
    (sum, block) => sum + (block.result.diagnostics.metrics?.branchAndBoundNodes ?? 0),
    0,
  );
  const branchAndBoundBranches = blocks.reduce(
    (sum, block) => sum + (block.result.diagnostics.metrics?.branchAndBoundBranches ?? 0),
    0,
  );
  return {
    status: invalidInput ? 'invalid_input' : unassignedCellCount > 0 ? 'partial' : 'success',
    assignments,
    unassigned,
    projectedCycles,
    blocks,
    metrics: calculateScheduleMetrics(
      input.groups,
      input.activities,
      blocks.length,
      assignments,
      unassignedCellCount,
      effects,
    ),
    diagnostics: {
      engineVersion: SCHEDULE_GENERATOR_VERSION,
      seed,
      blockCount: slots.length,
      generatedBlockCount: blocks.length,
      branchAndBoundNodes,
      branchAndBoundBranches,
      warnings,
      errors,
    },
  };
}
