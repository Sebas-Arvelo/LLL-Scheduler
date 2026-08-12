import type { ActivityId, GroupId } from '../identifiers';

interface FlowEdge {
  to: number;
  reverseIndex: number;
  capacity: number;
  cost: number;
}

interface CandidateEdge {
  groupId: GroupId;
  activityId: ActivityId;
  edge: FlowEdge;
}

export interface MatchingProblem {
  groupIds: readonly GroupId[];
  activityIds: readonly ActivityId[];
  candidatesByGroup: ReadonlyMap<GroupId, readonly ActivityId[]>;
  activityCapacities: ReadonlyMap<ActivityId, number>;
  forbiddenEdges: ReadonlySet<string>;
  edgeCost: (groupId: GroupId, activityId: ActivityId) => number;
}

export interface MatchingSolution {
  matches: ReadonlyMap<GroupId, ActivityId>;
  flow: number;
  cost: number;
}

export function matchingEdgeKey(groupId: GroupId, activityId: ActivityId): string {
  return `${groupId}\u0000${activityId}`;
}

function addEdge(graph: FlowEdge[][], from: number, to: number, capacity: number, cost: number): FlowEdge {
  const forward: FlowEdge = { to, reverseIndex: graph[to].length, capacity, cost };
  const reverse: FlowEdge = { to: from, reverseIndex: graph[from].length, capacity: 0, cost: -cost };
  graph[from].push(forward);
  graph[to].push(reverse);
  return forward;
}

export function solveMinCostMatching(problem: MatchingProblem): MatchingSolution {
  const groupIds = [...problem.groupIds].sort();
  const activityIds = [...problem.activityIds].sort();
  const source = 0;
  const firstGroupNode = 1;
  const firstActivityNode = firstGroupNode + groupIds.length;
  const sink = firstActivityNode + activityIds.length;
  const graph: FlowEdge[][] = Array.from({ length: sink + 1 }, () => []);
  const groupNode = new Map(groupIds.map((id, index) => [id, firstGroupNode + index]));
  const activityNode = new Map(activityIds.map((id, index) => [id, firstActivityNode + index]));
  const candidateEdges: CandidateEdge[] = [];

  for (const groupId of groupIds) {
    addEdge(graph, source, groupNode.get(groupId)!, 1, 0);
    const candidates = [...(problem.candidatesByGroup.get(groupId) ?? [])].sort();
    for (const activityId of candidates) {
      if (problem.forbiddenEdges.has(matchingEdgeKey(groupId, activityId))) {
        continue;
      }
      const node = activityNode.get(activityId);
      if (node === undefined) {
        continue;
      }
      const edge = addEdge(graph, groupNode.get(groupId)!, node, 1, problem.edgeCost(groupId, activityId));
      candidateEdges.push({ groupId, activityId, edge });
    }
  }

  for (const activityId of activityIds) {
    addEdge(graph, activityNode.get(activityId)!, sink, Math.max(0, problem.activityCapacities.get(activityId) ?? 0), 0);
  }

  let flow = 0;
  let cost = 0;

  while (true) {
    const distance = Array(graph.length).fill(Number.POSITIVE_INFINITY) as number[];
    const previousNode = Array(graph.length).fill(-1) as number[];
    const previousEdge = Array(graph.length).fill(-1) as number[];
    const inQueue = Array(graph.length).fill(false) as boolean[];
    const queue: number[] = [source];
    distance[source] = 0;
    inQueue[source] = true;

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const node = queue[cursor];
      inQueue[node] = false;
      for (let edgeIndex = 0; edgeIndex < graph[node].length; edgeIndex += 1) {
        const edge = graph[node][edgeIndex];
        const nextDistance = distance[node] + edge.cost;
        if (edge.capacity <= 0 || nextDistance >= distance[edge.to]) {
          continue;
        }
        distance[edge.to] = nextDistance;
        previousNode[edge.to] = node;
        previousEdge[edge.to] = edgeIndex;
        if (!inQueue[edge.to]) {
          queue.push(edge.to);
          inQueue[edge.to] = true;
        }
      }
    }

    if (!Number.isFinite(distance[sink])) {
      break;
    }

    for (let node = sink; node !== source; node = previousNode[node]) {
      const edge = graph[previousNode[node]][previousEdge[node]];
      edge.capacity -= 1;
      graph[node][edge.reverseIndex].capacity += 1;
    }
    flow += 1;
    cost += distance[sink];
  }

  const matches = new Map<GroupId, ActivityId>();
  for (const candidate of candidateEdges) {
    if (candidate.edge.capacity === 0) {
      matches.set(candidate.groupId, candidate.activityId);
    }
  }

  return { matches, flow, cost };
}
