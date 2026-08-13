import type { ConfigurationSnapshot } from './schedule-api';
import { HttpScheduleApi, mapSeasonConfiguration } from './schedule-api';

function configuration(): ConfigurationSnapshot {
  return {
    season: { id: 'season-1', name: 'Temporada', startDate: '2026-08-01', endDate: '2026-08-21', active: true },
    categories: [{ id: 'sabana', name: 'Sabana', active: true }],
    groups: [{ id: 'sabana-1', name: 'Sabana 1', categoryId: 'sabana', participantCount: 10, active: true }],
    activities: [{ id: 'kayak', name: 'Kayak', maxGroups: 2, active: true }],
    eligibility: [{ activityId: 'kayak', groupCategoryId: 'sabana' }],
    timeBlocks: [{ id: 'block-1', seasonId: 'season-1', name: 'Mañana', order: 1, active: true }],
  };
}

describe('season configuration API mapping', () => {
  it('maps the database DTO to independent domain objects without losing IDs or capacities', () => {
    const dto = configuration();
    const mapped = mapSeasonConfiguration(dto);

    expect(mapped).toEqual(dto);
    expect(mapped).not.toBe(dto);
    expect(mapped.groups[0]).not.toBe(dto.groups[0]);
    expect(mapped.activities[0]?.maxGroups).toBe(2);
    expect(mapped.timeBlocks[0]?.seasonId).toBe(mapped.season.id);
  });

  it('rejects inconsistent references before applying configuration to Angular state', () => {
    const dto = configuration();
    const invalid = { ...dto, groups: [{ ...dto.groups[0]!, categoryId: 'missing' }] };

    expect(() => mapSeasonConfiguration(invalid)).toThrowError(/categoría desconocida/);
  });

  it('requests season configuration through the Angular development /api path', async () => {
    const dto = configuration();
    const fetchSpy = spyOn(globalThis, 'fetch').and.resolveTo(new Response(JSON.stringify(dto), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const mapped = await new HttpScheduleApi().getSeasonConfiguration('season-1');

    expect(fetchSpy).toHaveBeenCalledWith('/api/seasons/season-1/config', undefined);
    expect(mapped).toEqual(dto);
  });
});
