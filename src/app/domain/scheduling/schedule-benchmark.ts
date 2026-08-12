import type { ScheduleGenerationInput, ScheduleGenerationResult } from '../schedule-generation';
import { generateSchedule } from './generate-schedule';
import { createRealisticScheduleInput } from './testing/realistic-schedule.fixture';

export interface ScheduleBenchmarkScenario {
  name: string;
  input: ScheduleGenerationInput;
}

export interface ScheduleBenchmarkMeasurement {
  name: string;
  groupCount: number;
  activityCount: number;
  blockCount: number;
  iterations: number;
  totalMilliseconds: number;
  averageGenerationMilliseconds: number;
  averageMillisecondsPerBlock: number;
  maximumGenerationMilliseconds: number;
  averageBranchAndBoundNodes: number;
  averageBranchAndBoundBranches: number;
  assignments: number;
  unassigned: number;
}

export interface ScheduleBenchmarkReport {
  measuredAt: string;
  scenarios: readonly ScheduleBenchmarkMeasurement[];
}

export function realisticBenchmarkScenarios(): readonly ScheduleBenchmarkScenario[] {
  return [
    { name: 'A: 36 groups / 18 activities', input: createRealisticScheduleInput('standard') },
    {
      name: 'B: participant capacities',
      input: createRealisticScheduleInput('participant-capacities'),
    },
    { name: 'C: scarce group capacities', input: createRealisticScheduleInput('scarce') },
    {
      name: 'D: 3 days / 4 blocks',
      input: createRealisticScheduleInput('standard', { dayCount: 3, blockCount: 4 }),
    },
  ];
}

function branchMetrics(result: ScheduleGenerationResult): { nodes: number; branches: number } {
  return result.blocks.reduce(
    (total, block) => ({
      nodes: total.nodes + (block.result.diagnostics.metrics?.branchAndBoundNodes ?? 0),
      branches: total.branches + (block.result.diagnostics.metrics?.branchAndBoundBranches ?? 0),
    }),
    { nodes: 0, branches: 0 },
  );
}

export function runScheduleBenchmark(
  iterations = 3,
  scenarios: readonly ScheduleBenchmarkScenario[] = realisticBenchmarkScenarios(),
): ScheduleBenchmarkReport {
  const safeIterations = Math.max(1, Math.floor(iterations));
  const measurements = scenarios.map<ScheduleBenchmarkMeasurement>((scenario) => {
    generateSchedule(scenario.input);
    const durations: number[] = [];
    let latestResult = generateSchedule(scenario.input);
    let totalNodes = 0;
    let totalBranches = 0;

    for (let iteration = 0; iteration < safeIterations; iteration += 1) {
      const startedAt = performance.now();
      latestResult = generateSchedule(scenario.input);
      durations.push(performance.now() - startedAt);
      const branch = branchMetrics(latestResult);
      totalNodes += branch.nodes;
      totalBranches += branch.branches;
    }

    const totalMilliseconds = durations.reduce((sum, duration) => sum + duration, 0);
    const blockCount = scenario.input.dates.length * scenario.input.timeBlocks.length;
    return {
      name: scenario.name,
      groupCount: scenario.input.groups.length,
      activityCount: scenario.input.activities.length,
      blockCount,
      iterations: safeIterations,
      totalMilliseconds,
      averageGenerationMilliseconds: totalMilliseconds / safeIterations,
      averageMillisecondsPerBlock: totalMilliseconds / safeIterations / Math.max(1, blockCount),
      maximumGenerationMilliseconds: Math.max(...durations),
      averageBranchAndBoundNodes: totalNodes / safeIterations,
      averageBranchAndBoundBranches: totalBranches / safeIterations,
      assignments: latestResult.assignments.length,
      unassigned: latestResult.metrics.global.unassignedCells,
    };
  });

  return { measuredAt: new Date().toISOString(), scenarios: measurements };
}
