import { DEMO_ACTIVITIES } from '../activity-catalog';
import { DEMO_ACTIVITY_ELIGIBILITY, DEMO_GROUP_CATEGORIES } from '../demo-fixtures';
import {
  Activity,
  ActivityCycleSnapshot,
  Assignment,
  GroupCategory,
  SchedulingResult,
  validateActivity,
  validateActivityEligibility,
  validateCampGroup,
  validateGroupCategory,
  validateSeason,
  validateTimeBlock,
} from './index';

describe('scheduling domain contracts', () => {
  it('represents group and participant capacity independently', () => {
    const activity: Activity = {
      id: 'kayak',
      name: 'Kayak',
      active: true,
      maxGroups: 2,
      maxParticipants: 24,
    };

    expect(activity.maxGroups).toBe(2);
    expect(activity.maxParticipants).toBe(24);
    expect(validateActivity(activity)).toEqual([]);
  });

  it('keeps group categories separate from activity display categories', () => {
    const groupCategory: GroupCategory = { id: 'sabana', name: 'Sabana', active: true };
    const activity: Activity = {
      id: 'kayak',
      name: 'Kayak',
      active: true,
      maxGroups: 2,
      displayCategory: 'Acuática',
    };

    expect(groupCategory.id).toBe('sabana');
    expect(activity.displayCategory).toBe('Acuática');
    expect(activity).not.toEqual(jasmine.objectContaining({ categoryId: 'sabana' }));
  });

  it('captures pending, completed and exempted requirements in a cycle snapshot', () => {
    const snapshot: ActivityCycleSnapshot = {
      cycle: {
        id: 'cycle-1',
        groupId: 'sabana-1',
        cycleNumber: 1,
        status: 'active',
        startedAt: '2026-07-01T12:00:00.000Z',
      },
      requirements: [
        { cycleId: 'cycle-1', activityId: 'kayak', status: 'pending' },
        { cycleId: 'cycle-1', activityId: 'piscina', status: 'completed' },
        { cycleId: 'cycle-1', activityId: 'caballos', status: 'exempted' },
      ],
    };

    expect(snapshot.requirements.map((requirement) => requirement.status)).toEqual([
      'pending',
      'completed',
      'exempted',
    ]);
  });

  it('reports an unassigned group without creating an invalid assignment', () => {
    const assignments: Assignment[] = [];
    const result: SchedulingResult = {
      status: 'success',
      assignments,
      unassigned: [
        {
          groupId: 'sabana-1',
          reasonCode: 'CAPACITY_EXHAUSTED',
          message: 'All eligible activities reached their capacity for this block.',
        },
      ],
      diagnostics: {
        algorithmVersion: 'contract-only',
        warnings: [],
        errors: [],
      },
    };

    expect(result.assignments).toEqual([]);
    expect(result.unassigned[0].reasonCode).toBe('CAPACITY_EXHAUSTED');
  });

  it('keeps every current demo fixture valid', () => {
    const activityIssues = DEMO_ACTIVITIES.flatMap((activity) => validateActivity(activity));
    const categoryIssues = DEMO_GROUP_CATEGORIES.flatMap((category) => validateGroupCategory(category));
    const eligibilityIssues = DEMO_ACTIVITY_ELIGIBILITY.flatMap((eligibility) =>
      validateActivityEligibility(eligibility, DEMO_ACTIVITIES, DEMO_GROUP_CATEGORIES),
    );

    expect([...activityIssues, ...categoryIssues, ...eligibilityIssues]).toEqual([]);
  });

  it('rejects invalid activity capacity values', () => {
    const issues = validateActivity({
      id: 'invalid',
      name: 'Invalid activity',
      active: true,
      maxGroups: 0,
      maxParticipants: -1,
    });

    expect(issues.map((issue) => issue.code)).toEqual([
      'INVALID_MIN_GROUPS',
      'INVALID_MAX_GROUPS',
      'INVALID_MAX_PARTICIPANTS',
    ]);
  });

  it('rejects an activity minimum greater than its maximum', () => {
    const issues = validateActivity({
      id: 'invalid-range',
      name: 'Invalid range',
      active: true,
      minGroups: 3,
      maxGroups: 2,
    });

    expect(issues.map((issue) => issue.code)).toEqual(['INVALID_MIN_GROUPS']);
  });

  it('validates participant counts, block order and season date ranges', () => {
    const groupIssues = validateCampGroup({
      id: 'sabana-1',
      name: 'Sabana 1',
      categoryId: 'sabana',
      active: true,
      participantCount: -1,
    });
    const blockIssues = validateTimeBlock({
      id: 'block-1',
      seasonId: 'season-1',
      name: 'Block 1',
      order: -1,
      active: true,
    });
    const seasonIssues = validateSeason({
      id: 'season-1',
      name: 'Season 1',
      startDate: '2026-08-10',
      endDate: '2026-08-01',
      active: true,
    });

    expect(groupIssues[0].code).toBe('INVALID_PARTICIPANT_COUNT');
    expect(blockIssues[0].code).toBe('INVALID_TIME_BLOCK_ORDER');
    expect(seasonIssues[0].code).toBe('INVALID_DATE_RANGE');
  });
});
