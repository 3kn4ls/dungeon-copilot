import type { RollRequest, RollResponse } from '@dungeon-copilot/shared';

export async function requestRoll(request: RollRequest): Promise<RollResponse> {
  const response = await fetch('/api/rolls', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error(`El servidor rechazó la tirada (${response.status})`);
  }
  return (await response.json()) as RollResponse;
}
