import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadProfessorEvents } from './activity-events.ts';

test('professor activity ratios include a quiet team beyond the server row cap', async () => {
  // Given 1,001 rows, with the quiet team's event outside the first response.
  const rows = Array.from({ length: 1001 }, (_, index) => ({ id: String(index), team_id: index === 1000 ? 'quiet' : 'busy', user_id: 'member', category: 'document', created_at: '2026-11-01T00:00:00Z' }));
  const query = { select: () => query, in: () => query, lte: () => query, order: () => query,
    range: async (from, to) => ({ data: rows.slice(from, Math.min(to + 1, from + 1000)), error: null }) };
  // When loading the professor's history through a server capped at 1,000 rows.
  const result = await loadProfessorEvents({ from: () => query }, ['busy', 'quiet']);
  // Then neither the older team nor its activity disappears from the denominator.
  assert.equal(result.data.length, 1001);
  assert.equal(result.data.filter(event => event.team_id === 'quiet').length, 1);
});
