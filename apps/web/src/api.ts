import type {
  AdvanceRequest,
  AiStatus,
  ApiErrorBody,
  ApiIssue,
  AuthResponse,
  AwardXpRequest,
  CampaignDetail,
  CampaignSummary,
  CharacterView,
  CloseGameRequest,
  CreateCampaignRequest,
  CreateCharacterRequest,
  DamageRequest,
  DamageResponse,
  GameDetail,
  GameEvent,
  GameRollRequest,
  GameState,
  GameSummary,
  GenerateNpcRequest,
  JoinCampaignRequest,
  LoginRequest,
  MeResponse,
  NoteRequest,
  NpcDraft,
  NpcRequest,
  NpcView,
  OpenGameRequest,
  RecoverRequest,
  RegisterRequest,
  RevealRequest,
  RollRequest,
  RollResponse,
  ScreenState,
  SpeechRequest,
  TalkChunk,
  TalkRequest,
  UpdateCampaignRequest,
  UpdateCharacterRequest,
  UpdateNpcRequest,
} from '@dungeon-copilot/shared';

/** Error de la API con el mensaje en español que manda el servidor y, si los hay, los campos que fallan. */
export class ApiError extends Error {
  readonly status: number;
  readonly issues: ApiIssue[];

  constructor(status: number, body: Partial<ApiErrorBody> | null) {
    super(body?.error ?? `El servidor respondió con un error (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.issues = body?.issues ?? [];
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? null : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, { error: 'No hay conexión con el servidor' });
  }
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, data as ApiErrorBody | null);
  return data as T;
}

/**
 * Habla con un PNJ. La respuesta llega a trozos: `onText` recibe el texto acumulado según lo
 * escribe la IA, y al final se devuelve la respuesta entera ya limpia. Con `signal` se para.
 */
async function talk(
  npcId: string,
  body: TalkRequest,
  options: { signal: AbortSignal; onText: (text: string) => void },
): Promise<string> {
  const cut = () => new ApiError(0, { error: 'Se cortó la respuesta de la IA' });
  let response: Response;
  try {
    response = await fetch(`/api/npcs/${npcId}/talk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal.aborted) throw error;
    throw new ApiError(0, { error: 'No hay conexión con el servidor' });
  }
  if (!response.ok || !response.body) {
    const data: unknown = await response.json().catch(() => null);
    throw new ApiError(response.status, data as ApiErrorBody | null);
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let text = '';
  for (;;) {
    let chunk: Awaited<ReturnType<typeof reader.read>>;
    try {
      chunk = await reader.read();
    } catch (error) {
      if (options.signal.aborted) throw error;
      throw cut();
    }
    if (chunk.done) throw cut();
    buffer += chunk.value;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const message = JSON.parse(line) as TalkChunk;
      if (message.type === 'done') return message.text;
      if (message.type === 'error') throw new ApiError(502, { error: message.error });
      text += message.text;
      options.onText(text);
    }
  }
}

const get = <T>(url: string) => request<T>('GET', url);
const post = <T>(url: string, body?: unknown) => request<T>('POST', url, body);
const patch = <T>(url: string, body: unknown) => request<T>('PATCH', url, body);
const del = (url: string) => request<void>('DELETE', url);

type CampaignResponse = { campaign: CampaignDetail };
type CharacterResponse = { character: CharacterView };
type EventResponse = { event: GameEvent };
type NpcResponse = { npc: NpcView };

export const api = {
  me: () => get<MeResponse>('/api/auth/me'),
  register: (body: RegisterRequest) => post<AuthResponse>('/api/auth/register', body),
  login: (body: LoginRequest) => post<AuthResponse>('/api/auth/login', body),
  logout: () => post<void>('/api/auth/logout'),

  campaigns: () => get<{ campaigns: CampaignSummary[] }>('/api/campaigns').then((r) => r.campaigns),
  createCampaign: (body: CreateCampaignRequest) =>
    post<CampaignResponse>('/api/campaigns', body).then((r) => r.campaign),
  joinCampaign: (body: JoinCampaignRequest) =>
    post<{ campaign: CampaignSummary }>('/api/campaigns/join', body).then((r) => r.campaign),
  campaign: (id: string) => get<CampaignResponse>(`/api/campaigns/${id}`).then((r) => r.campaign),
  updateCampaign: (id: string, body: UpdateCampaignRequest) =>
    patch<CampaignResponse>(`/api/campaigns/${id}`, body).then((r) => r.campaign),
  deleteCampaign: (id: string) => del(`/api/campaigns/${id}`),
  regenerateInviteCode: (id: string) =>
    post<{ inviteCode: string }>(`/api/campaigns/${id}/invite-code`).then((r) => r.inviteCode),
  removeMember: (campaignId: string, userId: string) =>
    del(`/api/campaigns/${campaignId}/members/${userId}`),
  regenerateScreenToken: (id: string) =>
    post<{ screenToken: string }>(`/api/campaigns/${id}/screen-token`).then((r) => r.screenToken),

  characters: (campaignId: string) =>
    get<{ characters: CharacterView[] }>(`/api/campaigns/${campaignId}/characters`).then(
      (r) => r.characters,
    ),
  createCharacter: (campaignId: string, body: CreateCharacterRequest) =>
    post<CharacterResponse>(`/api/campaigns/${campaignId}/characters`, body).then(
      (r) => r.character,
    ),
  character: (id: string) =>
    get<CharacterResponse>(`/api/characters/${id}`).then((r) => r.character),
  updateCharacter: (id: string, body: UpdateCharacterRequest) =>
    patch<CharacterResponse>(`/api/characters/${id}`, body).then((r) => r.character),
  deleteCharacter: (id: string) => del(`/api/characters/${id}`),
  damage: (id: string, body: DamageRequest) =>
    post<DamageResponse>(`/api/characters/${id}/damage`, body),
  recover: (id: string, body: RecoverRequest) =>
    post<CharacterResponse>(`/api/characters/${id}/recover`, body).then((r) => r.character),
  awardXp: (id: string, body: AwardXpRequest) =>
    post<CharacterResponse>(`/api/characters/${id}/xp`, body).then((r) => r.character),
  advance: (id: string, body: AdvanceRequest) =>
    post<CharacterResponse>(`/api/characters/${id}/advances`, body).then((r) => r.character),

  games: (campaignId: string) =>
    get<{ games: GameSummary[] }>(`/api/campaigns/${campaignId}/games`).then((r) => r.games),
  openGame: (campaignId: string, body: OpenGameRequest) =>
    post<{ game: GameDetail }>(`/api/campaigns/${campaignId}/games`, body).then((r) => r.game),
  game: (id: string) => get<GameState>(`/api/games/${id}`),
  closeGame: (id: string, body: CloseGameRequest) =>
    post<{ game: GameDetail; event: GameEvent }>(`/api/games/${id}/close`, body),
  reveal: (id: string, body: RevealRequest) =>
    post<EventResponse>(`/api/games/${id}/reveals`, body).then((r) => r.event),
  note: (id: string, body: NoteRequest) =>
    post<EventResponse>(`/api/games/${id}/notes`, body).then((r) => r.event),
  gameRoll: (id: string, body: GameRollRequest) =>
    post<EventResponse>(`/api/games/${id}/rolls`, body).then((r) => r.event),
  speech: (id: string, body: SpeechRequest) =>
    post<EventResponse>(`/api/games/${id}/speeches`, body).then((r) => r.event),
  screen: (token: string) => get<ScreenState>(`/api/screens/${token}`),

  ai: () => get<AiStatus>('/api/ai'),
  npcs: (campaignId: string) =>
    get<{ npcs: NpcView[] }>(`/api/campaigns/${campaignId}/npcs`).then((r) => r.npcs),
  createNpc: (campaignId: string, body: NpcRequest) =>
    post<NpcResponse>(`/api/campaigns/${campaignId}/npcs`, body).then((r) => r.npc),
  generateNpc: (campaignId: string, body: GenerateNpcRequest) =>
    post<{ npc: NpcDraft }>(`/api/campaigns/${campaignId}/npcs/generate`, body).then((r) => r.npc),
  npc: (id: string) => get<NpcResponse>(`/api/npcs/${id}`).then((r) => r.npc),
  updateNpc: (id: string, body: UpdateNpcRequest) =>
    patch<NpcResponse>(`/api/npcs/${id}`, body).then((r) => r.npc),
  deleteNpc: (id: string) => del(`/api/npcs/${id}`),
  talk,

  roll: (body: RollRequest) => post<RollResponse>('/api/rolls', body),
};
