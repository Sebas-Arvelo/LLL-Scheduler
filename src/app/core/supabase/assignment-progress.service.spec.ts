import { mapAssignmentProgress, mapRealCycles } from './assignment-progress.service';

describe('Supabase real execution mapping', () => {
  it('maps persisted assignment progress without confusing planned with completed', () => {
    const mapped = mapAssignmentProgress({
      id: 'p1', user_id: 'u1', saved_schedule_id: 's1', group_id: 'g1', activity_id: 'a1',
      date: '2026-08-15', time_block_id: 'b1', status: 'planned', cycle_id: null,
      session_id: null, session_block_index: null, session_block_count: null,
      completed_at: null, created_at: '2026-08-15T10:00:00Z', updated_at: '2026-08-15T10:00:00Z',
    });
    expect(mapped.status).toBe('planned');
    expect(mapped.completedAt).toBeUndefined();
  });

  it('combines cycles and their immutable requirement snapshots', () => {
    const cycles = mapRealCycles([
      { id: 'c1', user_id: 'u1', group_id: 'g1', cycle_number: 1, status: 'active', started_at: '2026-08-15T10:00:00Z', completed_at: null },
    ], [
      { id: 'r2', cycle_id: 'c1', activity_id: 'kayak', status: 'completed' },
      { id: 'r1', cycle_id: 'c1', activity_id: 'arqueria', status: 'pending' },
    ]);
    expect(cycles[0].requirements.map((item) => item.activityId)).toEqual(['arqueria', 'kayak']);
    expect(cycles[0].requirements[1].status).toBe('completed');
  });

  it('maps the persisted identity of a multi-block session', () => {
    const mapped = mapAssignmentProgress({
      id: 'p1', user_id: 'u1', saved_schedule_id: 's1', group_id: 'g1', activity_id: 'boats',
      date: '2026-08-15', time_block_id: 'M2', status: 'completed', cycle_id: 'c1',
      session_id: 'session-1', session_block_index: 1, session_block_count: 2,
      completed_at: '2026-08-15T11:40:00Z', created_at: '2026-08-15T10:00:00Z',
      updated_at: '2026-08-15T11:40:00Z',
    });
    expect(mapped).toEqual(jasmine.objectContaining({
      sessionId: 'session-1', sessionBlockIndex: 1, sessionBlockCount: 2,
    }));
  });
});
