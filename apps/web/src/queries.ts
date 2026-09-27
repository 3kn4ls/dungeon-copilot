import type { CharacterView, GameEvent, GameState, MeResponse } from '@dungeon-copilot/shared';
import { QueryCache, QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from './api';

export const keys = {
  me: ['me'] as const,
  campaigns: ['campaigns'] as const,
  campaign: (id: string) => ['campaigns', id] as const,
  characters: (campaignId: string) => ['campaigns', campaignId, 'characters'] as const,
  character: (id: string) => ['characters', id] as const,
  games: (campaignId: string) => ['campaigns', campaignId, 'games'] as const,
  game: (id: string) => ['games', id] as const,
  screen: (token: string) => ['screens', token] as const,
};

export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      // Si la sesión caduca a mitad de uso, se olvida el usuario y la web lleva a /entrar.
      onError: (error) => {
        if (error instanceof ApiError && error.status === 401) {
          client.setQueryData<MeResponse>(keys.me, (me) => me && { ...me, user: null });
        }
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        // Los errores de la petición (403, 404...) no se arreglan reintentando.
        retry: (count, error) =>
          count < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
      },
    },
  });
  return client;
}

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: api.me, staleTime: Infinity });

export const useCampaigns = () => useQuery({ queryKey: keys.campaigns, queryFn: api.campaigns });

// Con un id vacío (aún no se sabe cuál) no se pide nada.
export const useCampaign = (id: string) =>
  useQuery({ queryKey: keys.campaign(id), queryFn: () => api.campaign(id), enabled: id !== '' });

export const useCharacters = (campaignId: string) =>
  useQuery({
    queryKey: keys.characters(campaignId),
    queryFn: () => api.characters(campaignId),
    enabled: campaignId !== '',
  });

export const useCharacter = (id: string) =>
  useQuery({ queryKey: keys.character(id), queryFn: () => api.character(id), enabled: id !== '' });

/** Guarda la ficha que devuelve el servidor y marca como viejas las listas donde aparece. */
export function useStoreCharacter() {
  const queryClient = useQueryClient();
  return (character: CharacterView) => {
    queryClient.setQueryData(keys.character(character.id), character);
    void queryClient.invalidateQueries({ queryKey: keys.characters(character.campaignId) });
    void queryClient.invalidateQueries({ queryKey: keys.campaigns, exact: true });
  };
}

/**
 * Mientras no haya partida en juego, la lista se vuelve a pedir cada poco: así los jugadores
 * que esperan en la campaña ven aparecer la partida en cuanto el máster la abre.
 */
export const useGames = (campaignId: string) =>
  useQuery({
    queryKey: keys.games(campaignId),
    queryFn: () => api.games(campaignId),
    enabled: campaignId !== '',
    refetchInterval: (query) =>
      query.state.data?.some((game) => game.status === 'open') ? false : 10_000,
  });

export const useGame = (id: string) =>
  useQuery({ queryKey: keys.game(id), queryFn: () => api.game(id), enabled: id !== '' });

/** Añade un evento a la partida guardada, sin repetirlo si ya llegó por el directo. */
export function mergeGameEvent(state: GameState, event: GameEvent): GameState {
  if (event.gameId !== state.game.id || state.events.some((known) => known.id === event.id)) {
    return state;
  }
  const events = [...state.events, event].sort((a, b) => a.id - b.id);
  const game =
    event.kind === 'closed'
      ? { ...state.game, status: 'closed' as const, closedAt: event.createdAt }
      : state.game;
  return { game, events };
}

/** Guarda un evento que acaba de llegar, por el directo o como respuesta a una acción. */
export function useStoreGameEvent(gameId: string) {
  const queryClient = useQueryClient();
  return (event: GameEvent) => {
    queryClient.setQueryData<GameState>(keys.game(gameId), (state) =>
      state ? mergeGameEvent(state, event) : state,
    );
  };
}
