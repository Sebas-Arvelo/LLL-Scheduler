import { supabaseClientService } from './supabase-client.service';
import type { SavedScheduleData } from './saved-schedule';

export interface SavedScheduleSummary {
  id: string;
  userId: string;
  name: string;
  seasonName?: string;
  rangeStart?: string;
  rangeEnd?: string;
  seed?: number;
  algorithmVersion?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SavedScheduleRecord extends SavedScheduleSummary {
  scheduleData: SavedScheduleData;
}

export interface SaveScheduleCommand {
  userId: string;
  name: string;
  seasonName?: string;
  rangeStart?: string;
  rangeEnd?: string;
  seed?: number;
  algorithmVersion?: string;
  scheduleData: SavedScheduleData;
}

export interface SavedScheduleGateway {
  save(command: SaveScheduleCommand): Promise<SavedScheduleRecord>;
  list(userId: string): Promise<readonly SavedScheduleSummary[]>;
  get(id: string, userId: string): Promise<SavedScheduleRecord>;
  delete(id: string, userId: string): Promise<void>;
}

interface SavedScheduleRow {
  id: string;
  user_id: string;
  name: string;
  season_name: string | null;
  range_start: string | null;
  range_end: string | null;
  seed: number | null;
  algorithm_version: string | null;
  schedule_data?: SavedScheduleData;
  created_at: string;
  updated_at: string;
}

export function sortSavedSchedules<T extends { createdAt: string }>(items: readonly T[]): readonly T[] {
  return [...items].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function summary(row: SavedScheduleRow): SavedScheduleSummary {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    ...(row.season_name ? { seasonName: row.season_name } : {}),
    ...(row.range_start ? { rangeStart: row.range_start } : {}),
    ...(row.range_end ? { rangeEnd: row.range_end } : {}),
    ...(row.seed !== null ? { seed: Number(row.seed) } : {}),
    ...(row.algorithm_version ? { algorithmVersion: row.algorithm_version } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function record(row: SavedScheduleRow): SavedScheduleRecord {
  if (!row.schedule_data) throw new Error('La programación guardada no contiene sus datos.');
  return { ...summary(row), scheduleData: row.schedule_data };
}

export class SavedScheduleService implements SavedScheduleGateway {
  async save(command: SaveScheduleCommand): Promise<SavedScheduleRecord> {
    supabaseClientService.requireConfigured();
    const client = await supabaseClientService.getClient();
    const { data, error } = await client.from('saved_schedules').insert({
      user_id: command.userId,
      name: command.name,
      season_name: command.seasonName ?? null,
      range_start: command.rangeStart ?? null,
      range_end: command.rangeEnd ?? null,
      seed: command.seed ?? null,
      algorithm_version: command.algorithmVersion ?? null,
      schedule_data: command.scheduleData,
    }).select().single<SavedScheduleRow>();
    if (error) throw new Error('No se pudo guardar la programación.');
    return record(data);
  }

  async list(userId: string): Promise<readonly SavedScheduleSummary[]> {
    supabaseClientService.requireConfigured();
    const client = await supabaseClientService.getClient();
    const { data, error } = await client.from('saved_schedules')
      .select('id,user_id,name,season_name,range_start,range_end,seed,algorithm_version,created_at,updated_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw new Error('No se pudieron cargar tus programaciones.');
    return sortSavedSchedules((data as SavedScheduleRow[]).map(summary));
  }

  async get(id: string, userId: string): Promise<SavedScheduleRecord> {
    supabaseClientService.requireConfigured();
    const client = await supabaseClientService.getClient();
    const { data, error } = await client.from('saved_schedules').select()
      .eq('id', id).eq('user_id', userId).single<SavedScheduleRow>();
    if (error) throw new Error('No se pudo abrir la programación.');
    return record(data);
  }

  async delete(id: string, userId: string): Promise<void> {
    supabaseClientService.requireConfigured();
    const client = await supabaseClientService.getClient();
    const { data, error } = await client.from('saved_schedules').delete()
      .eq('id', id).eq('user_id', userId).select('id').maybeSingle();
    if (error || !data) throw new Error('No se pudo eliminar la programación.');
  }
}
