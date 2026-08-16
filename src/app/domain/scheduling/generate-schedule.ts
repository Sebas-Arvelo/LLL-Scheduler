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

export const SCHEDULE_GENERATOR_VERSION = 'multi-block-projection-v1';
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
    const lockedAssignments = input.lockedAssignments.filter(
      (assignment) => assignment.date === slot.date && assignment.timeBlockId === slot.timeBlockId,
    );
    const result = scheduleBlock({
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
      lockedAssignments,
      hardConstraints: input.hardConstraints,
      preferences: input.preferences,
      seed: slotSeed(seed, index),
    });
    blocks.push({ slot, result });
    warnings.push(...result.diagnostics.warnings);
    errors.push(...result.diagnostics.errors);
    if (result.unassigned.length > 0) unassigned.push({ slot, groups: result.unassigned });
    assignments.push(...result.assignments);
    if (result.status === 'invalid_input') {
      invalidInput = true;
      break;
    }

    const update = applyAssignmentsToProjectedCycles(projectedCycles, result.assignments, slot);
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
