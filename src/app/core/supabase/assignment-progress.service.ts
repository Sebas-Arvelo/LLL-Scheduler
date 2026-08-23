import type {
  AssignmentProgress,
  AssignmentProgressStatus,
  RealActivityCycle,
  RealCycleRequirement,
  RealExecutionState,
} from '../../execution/real-execution';
import { supabaseClientService } from './supabase-client.service';

export interface AssignmentProgressGateway {
  initialize(savedScheduleId: string, userId: string, groupIds: readonly string[]): Promise<RealExecutionState>;
  load(savedScheduleId: string, userId: string, groupIds: readonly string[]): Promise<RealExecutionState>;
  setStatus(progressId: string, status: AssignmentProgressStatus, userId: string): Promise<void>;
  setRequirementStatus(requirementId: string, status: 'pending' | 'exempted', userId: string): Promise<void>;
  deleteDay(savedScheduleId: string, date: string, userId: string): Promise<void>;
}

interface AssignmentProgressRow {
  id: string;
  user_id: string;
  saved_schedule_id: string;
  group_id: string;
  activity_id: string;
  date: string;
  time_block_id: string;
  session_id: string | null;
  session_block_index: number | null;
  session_block_count: number | null;
  status: AssignmentProgressStatus;
  cycle_id: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ActivityCycleRow {
  id: string;
  user_id: string;
  group_id: string;
  cycle_number: number;
  status: 'active' | 'completed';
  started_at: string;
  completed_at: string | null;
}

interface CycleRequirementRow {
  id: string;
  cycle_id: string;
  activity_id: string;
  status: 'pending' | 'completed' | 'exempted';
}

export function mapAssignmentProgress(row: AssignmentProgressRow): AssignmentProgress {
  return {
    id: row.id,
    userId: row.user_id,
    savedScheduleId: row.saved_schedule_id,
    groupId: row.group_id,
    activityId: row.activity_id,
    date: row.date,
    timeBlockId: row.time_block_id,
    ...(row.session_id ? { sessionId: row.session_id } : {}),
    ...(row.session_block_index !== null ? { sessionBlockIndex: Number(row.session_block_index) } : {}),
    ...(row.session_block_count !== null ? { sessionBlockCount: Number(row.session_block_count) } : {}),
    status: row.status,
    ...(row.cycle_id ? { cycleId: row.cycle_id } : {}),
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapRealCycles(
  rows: readonly ActivityCycleRow[],
  requirementRows: readonly CycleRequirementRow[],
): readonly RealActivityCycle[] {
  const requirementsByCycle = new Map<string, RealCycleRequirement[]>();
  for (const row of requirementRows) {
    const requirements = requirementsByCycle.get(row.cycle_id) ?? [];
    requirements.push({ id: row.id, cycleId: row.cycle_id, activityId: row.activity_id, status: row.status });
    requirementsByCycle.set(row.cycle_id, requirements);
  }
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    groupId: row.group_id,
    cycleNumber: Number(row.cycle_number),
    status: row.status,
    startedAt: row.started_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    requirements: (requirementsByCycle.get(row.id) ?? []).sort((left, right) => left.activityId.localeCompare(right.activityId)),
  }));
}

export class AssignmentProgressService implements AssignmentProgressGateway {
  async initialize(savedScheduleId: string, userId: string, groupIds: readonly string[]): Promise<RealExecutionState> {
    supabaseClientService.requireConfigured();
    const client = await supabaseClientService.getClient();
    const { error } = await client.rpc('initialize_schedule_execution', { p_saved_schedule_id: savedScheduleId });
    if (error) throw new Error('No se pudo inicializar la ejecución de la programación.');
    return this.load(savedScheduleId, userId, groupIds);
  }

  async load(savedScheduleId: string, userId: string, groupIds: readonly string[]): Promise<RealExecutionState> {
    supabaseClientService.requireConfigured();
    const client = await supabaseClientService.getClient();
    const progressQuery = client.from('assignment_progress').select()
      .eq('saved_schedule_id', savedScheduleId).eq('user_id', userId)
      .order('date').order('time_block_id').order('group_id');
    const historyQuery = groupIds.length > 0
      ? client.from('assignment_progress').select().eq('saved_schedule_id', savedScheduleId)
          .eq('user_id', userId).eq('status', 'completed')
          .in('group_id', [...groupIds]).order('completed_at', { ascending: false })
      : undefined;
    const cyclesQuery = groupIds.length > 0
      ? client.from('activity_cycles').select().eq('saved_schedule_id', savedScheduleId)
          .eq('user_id', userId).in('group_id', [...groupIds])
          .order('group_id').order('cycle_number')
      : undefined;
    const [progressResult, historyResult, cyclesResult] = await Promise.all([
      progressQuery,
      historyQuery ?? Promise.resolve({ data: [], error: null }),
      cyclesQuery ?? Promise.resolve({ data: [], error: null }),
    ]);
    if (progressResult.error || historyResult.error || cyclesResult.error) {
      throw new Error('No se pudo cargar el progreso real.');
    }

    const cycleRows = (cyclesResult.data ?? []) as ActivityCycleRow[];
    let requirementRows: CycleRequirementRow[] = [];
    if (cycleRows.length > 0) {
      const { data, error } = await client.from('cycle_requirements').select()
        .in('cycle_id', cycleRows.map((cycle) => cycle.id)).order('activity_id');
      if (error) throw new Error('No se pudieron cargar los ciclos reales.');
      requirementRows = (data ?? []) as CycleRequirementRow[];
    }
    return {
      progress: ((progressResult.data ?? []) as AssignmentProgressRow[]).map(mapAssignmentProgress),
      history: ((historyResult.data ?? []) as AssignmentProgressRow[]).map(mapAssignmentProgress),
      cycles: mapRealCycles(cycleRows, requirementRows),
    };
  }

  async setStatus(progressId: string, status: AssignmentProgressStatus, userId: string): Promise<void> {
    supabaseClientService.requireConfigured();
    const client = await supabaseClientService.getClient();
    const { error } = await client.rpc('set_assignment_progress_status', {
      p_progress_id: progressId,
      p_status: status,
      p_user_id: userId,
    });
    if (error) throw new Error(error.message.includes('later cycle')
      ? 'No se puede reabrir un ciclo anterior porque ya existe un ciclo posterior.'
      : 'No se pudo actualizar el estado de la asignación.');
  }

  async setRequirementStatus(requirementId: string, status: 'pending' | 'exempted', userId: string): Promise<void> {
    supabaseClientService.requireConfigured();
    const client = await supabaseClientService.getClient();
    const { error } = await client.rpc('set_cycle_requirement_status', {
      p_requirement_id: requirementId,
      p_status: status,
      p_user_id: userId,
    });
    if (error) throw new Error('No se pudo actualizar el requisito del ciclo.');
  }

  async deleteDay(savedScheduleId: string, date: string, userId: string): Promise<void> {
    supabaseClientService.requireConfigured();
    const client = await supabaseClientService.getClient();
    const { error } = await client.rpc('delete_schedule_day', {
      p_saved_schedule_id: savedScheduleId,
      p_date: date,
      p_user_id: userId,
    });
    if (error) throw new Error(error.message.includes('later cycle')
      ? 'No se puede eliminar este día porque ya existe un ciclo posterior.'
      : 'No se pudo eliminar el día de la programación.');
  }
}
