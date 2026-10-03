import type {
  AdvanceRequest,
  AiStatus,
  AiTextChunk,
  AnswerInterventionRequest,
  ApiErrorBody,
  ApiIssue,
  AskRollRequest,
  AuthResponse,
  AwardXpRequest,
  CampaignDetail,
  CheckSuggestion,
  CampaignSummary,
  CharacterView,
  CloseGameRequest,
  ComplicationsRequest,
  CreateCampaignRequest,
  CreateCharacterRequest,
  DamageRequest,
  DamageResponse,
  DealDamageRequest,
  EndCombatRequest,
  EnemyDecision,
  EnemyDecisionRequest,
  GameDetail,
  GameEvent,
  GameRollRequest,
  GameState,
  GameSummary,
  GenerateNpcRequest,
  GiveFloorRequest,
  IdeasRequest,
  InterventionRequest,
  JoinCampaignRequest,
  JoinCombatRequest,
  LeaveCombatRequest,
  LoginRequest,
  MapRequest,
  MapView,
  MeResponse,
  NarrationRequest,
  NextTurnRequest,
  NoteRequest,
  NpcDraft,
  NpcRequest,
  NpcView,
  OpenGameRequest,
  PlaceTokenRequest,
  RecapDraftRequest,
  RecapRequest,
  RecoverRequest,
  RegisterRequest,
  RerollRequest,
  RevealCheckRequest,
  RevealDraftRequest,
  RevealRequest,
  RollRequest,
  RollResponse,
  ScreenState,
  SecretLeak,
  SetGameMapRequest,
  SpeechRequest,
  StartCombatRequest,
  StartSceneRequest,
  TacticsRequest,
  TalkRequest,
  UpdateCampaignRequest,
  UpdateCharacterRequest,
  UpdateMapRequest,
  UpdateNpcRequest,
  UseAbilityRequest,
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

async function request<T>(
  method: string,
  url: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? null : JSON.stringify(body),
      signal: signal ?? null,
    });
  } catch (error) {
    // Quien la pidió ya no espera la respuesta: no es un fallo de conexión.
    if (signal?.aborted) throw error;
    throw new ApiError(0, { error: 'No hay conexión con el servidor' });
  }
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, data as ApiErrorBody | null);
  return data as T;
}

export interface AiTextOptions {
  /** Para dejar de esperar la respuesta: la IA deja de escribir. */
  signal: AbortSignal;
  /** Recibe el texto acumulado según lo escribe la IA. */
  onText: (text: string) => void;
}

/**
 * Pide un texto a la IA, que llega a trozos según lo escribe. Al final se devuelve el texto
 * entero ya limpio, que puede no ser exactamente la suma de los trozos.
 */
async function aiText(url: string, body: unknown, options: AiTextOptions): Promise<string> {
  const cut = () => new ApiError(0, { error: 'Se cortó la respuesta de la IA' });
  let response: Response;
  try {
    response = await fetch(url, {
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
      const message = JSON.parse(line) as AiTextChunk;
      if (message.type === 'done') return message.text;
      if (message.type === 'error') throw new ApiError(502, { error: message.error });
      text += message.text;
      options.onText(text);
    }
  }
}

const get = <T>(url: string) => request<T>('GET', url);
const post = <T>(url: string, body?: unknown) => request<T>('POST', url, body);
const put = <T>(url: string, body: unknown) => request<T>('PUT', url, body);
const patch = <T>(url: string, body: unknown) => request<T>('PATCH', url, body);
const del = (url: string) => request<void>('DELETE', url);

type CampaignResponse = { campaign: CampaignDetail };
type CharacterResponse = { character: CharacterView };
type EventResponse = { event: GameEvent };
type NpcResponse = { npc: NpcView };
type MapResponse = { map: MapView };

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
  /** La IA mira si lo que va a enseñar el máster desvela lo que oculta algún PNJ. */
  checkReveal: (id: string, body: RevealCheckRequest, signal?: AbortSignal) =>
    request<{ leaks: SecretLeak[] }>('POST', `/api/games/${id}/reveals/check`, body, signal).then(
      (r) => r.leaks,
    ),
  /** La IA convierte las notas del máster en la descripción de una escena, sin enseñarla. */
  draftReveal: (id: string, body: RevealDraftRequest, options: AiTextOptions) =>
    aiText(`/api/games/${id}/reveals/draft`, body, options),
  /** La IA propone complicaciones para una tirada, una por línea, sin enseñarlas. */
  complications: (
    id: string,
    eventId: number,
    body: ComplicationsRequest,
    options: AiTextOptions,
  ) => aiText(`/api/games/${id}/rolls/${eventId}/complications`, body, options),
  /** La IA propone qué puede pasar ahora en la escena, una idea por línea, sin enseñarlas. */
  ideas: (id: string, body: IdeasRequest, options: AiTextOptions) =>
    aiText(`/api/games/${id}/ideas`, body, options),
  note: (id: string, body: NoteRequest) =>
    post<EventResponse>(`/api/games/${id}/notes`, body).then((r) => r.event),
  gameRoll: (id: string, body: GameRollRequest) =>
    post<EventResponse>(`/api/games/${id}/rolls`, body).then((r) => r.event),
  /** Gasta un punto de Suerte del personaje para repetir sus dados; cuenta la tirada nueva. */
  reroll: (id: string, eventId: number, body: RerollRequest) =>
    post<EventResponse>(`/api/games/${id}/rolls/${eventId}/reroll`, body).then((r) => r.event),
  speech: (id: string, body: SpeechRequest) =>
    post<EventResponse>(`/api/games/${id}/speeches`, body).then((r) => r.event),
  /** El máster da la palabra: se la queda, a toda la mesa o a un personaje. */
  giveFloor: (id: string, body: GiveFloorRequest) =>
    post<EventResponse>(`/api/games/${id}/floor`, body).then((r) => r.event),
  /** Un jugador interviene o pide la palabra con su personaje. */
  intervene: (id: string, body: InterventionRequest) =>
    post<EventResponse>(`/api/games/${id}/interventions`, body).then((r) => r.event),
  /** La IA sugiere qué tirada pedir para una intervención. No escribe nada en la partida. */
  checkSuggestion: (id: string, eventId: number, signal?: AbortSignal) =>
    request<{ suggestion: CheckSuggestion }>(
      'POST',
      `/api/games/${id}/interventions/${eventId}/check`,
      undefined,
      signal,
    ).then((r) => r.suggestion),
  answerIntervention: (id: string, eventId: number, body: AnswerInterventionRequest) =>
    post<EventResponse>(`/api/games/${id}/interventions/${eventId}/answer`, body).then(
      (r) => r.event,
    ),
  withdrawIntervention: (id: string, eventId: number) =>
    post<EventResponse>(`/api/games/${id}/interventions/${eventId}/withdraw`).then((r) => r.event),
  /** El máster pide una tirada a un personaje; la hace su jugador. */
  askRoll: (id: string, body: AskRollRequest) =>
    post<EventResponse>(`/api/games/${id}/roll-requests`, body).then((r) => r.event),
  rollRequested: (id: string, eventId: number) =>
    post<EventResponse>(`/api/games/${id}/roll-requests/${eventId}/roll`).then((r) => r.event),
  withdrawRollRequest: (id: string, eventId: number) =>
    post<EventResponse>(`/api/games/${id}/roll-requests/${eventId}/withdraw`).then((r) => r.event),
  /** El máster empieza un combate: el servidor tira la iniciativa de quien pelea. */
  startCombat: (id: string, body: StartCombatRequest) =>
    post<EventResponse>(`/api/games/${id}/combat`, body).then((r) => r.event),
  /** Termina el turno de quien lo tiene y le toca al siguiente. */
  nextTurn: (id: string, body: NextTurnRequest) =>
    post<EventResponse>(`/api/games/${id}/combat/turn`, body).then((r) => r.event),
  joinCombat: (id: string, body: JoinCombatRequest) =>
    post<EventResponse>(`/api/games/${id}/combat/join`, body).then((r) => r.event),
  leaveCombat: (id: string, body: LeaveCombatRequest) =>
    post<EventResponse>(`/api/games/${id}/combat/leave`, body).then((r) => r.event),
  endCombat: (id: string, body: EndCombatRequest) =>
    post<EventResponse>(`/api/games/${id}/combat/end`, body).then((r) => r.event),
  /** El máster aplica un golpe a un personaje o a PNJ del combate. */
  dealDamage: (id: string, body: DealDamageRequest) =>
    post<EventResponse>(`/api/games/${id}/damage`, body).then((r) => r.event),
  /** Un personaje gasta un punto de Suerte para no morir de un golpe mortal. */
  survive: (id: string, eventId: number) =>
    post<EventResponse>(`/api/games/${id}/damage/${eventId}/survive`).then((r) => r.event),
  /** El máster empieza una escena nueva. */
  startScene: (id: string, body: StartSceneRequest) =>
    post<EventResponse>(`/api/games/${id}/scenes`, body).then((r) => r.event),
  /** Un personaje usa una técnica de una vez por escena o por sesión. */
  useAbility: (id: string, body: UseAbilityRequest) =>
    post<EventResponse>(`/api/games/${id}/abilities`, body).then((r) => r.event),
  /** La IA propone cómo contar el golpe de una tirada de combate, sin enseñarlo. */
  narrateBlow: (id: string, eventId: number, body: NarrationRequest, options: AiTextOptions) =>
    aiText(`/api/games/${id}/rolls/${eventId}/narration`, body, options),
  /** La IA sugiere a quién atacan unos PNJ y si siguen, huyen o se rinden. */
  enemyDecision: (id: string, body: EnemyDecisionRequest, signal?: AbortSignal) =>
    request<{ decision: EnemyDecision }>(
      'POST',
      `/api/games/${id}/combat/decision`,
      body,
      signal,
    ).then((r) => r.decision),
  /** La IA propone qué pueden hacer unos PNJ en su turno, sin enseñarlo. */
  tactics: (id: string, body: TacticsRequest, options: AiTextOptions) =>
    aiText(`/api/games/${id}/combat/tactics`, body, options),
  saveRecap: (id: string, body: RecapRequest) =>
    put<{ game: GameDetail }>(`/api/games/${id}/recap`, body).then((r) => r.game),
  /** La IA propone un resumen de la partida, sin guardarlo. */
  draftRecap: (id: string, body: RecapDraftRequest, options: AiTextOptions) =>
    aiText(`/api/games/${id}/recap/draft`, body, options),
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
  /** Lo que responde un PNJ a lo que le dice la mesa. No guarda nada. */
  talk: (npcId: string, body: TalkRequest, options: AiTextOptions) =>
    aiText(`/api/npcs/${npcId}/talk`, body, options),

  maps: (campaignId: string) =>
    get<{ maps: MapView[] }>(`/api/campaigns/${campaignId}/maps`).then((r) => r.maps),
  createMap: (campaignId: string, body: MapRequest) =>
    post<MapResponse>(`/api/campaigns/${campaignId}/maps`, body).then((r) => r.map),
  map: (id: string) => get<MapResponse>(`/api/maps/${id}`).then((r) => r.map),
  updateMap: (id: string, body: UpdateMapRequest) =>
    patch<MapResponse>(`/api/maps/${id}`, body).then((r) => r.map),
  deleteMap: (id: string) => del(`/api/maps/${id}`),
  /** El máster pone un mapa de la campaña en la partida, o lo quita. */
  setGameMap: (id: string, body: SetGameMapRequest) =>
    put<EventResponse>(`/api/games/${id}/map`, body).then((r) => r.event),
  /** Pone, mueve o quita una ficha del mapa en juego. */
  placeToken: (id: string, body: PlaceTokenRequest) =>
    post<EventResponse>(`/api/games/${id}/tokens`, body).then((r) => r.event),

  roll: (body: RollRequest) => post<RollResponse>('/api/rolls', body),
};
