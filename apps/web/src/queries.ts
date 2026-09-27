import type { CharacterView, MeResponse } from '@dungeon-copilot/shared';
import { QueryCache, QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from './api';

export const keys = {
  me: ['me'] as const,
  campaigns: ['campaigns'] as const,
  campaign: (id: string) => ['campaigns', id] as const,
  characters: (campaignId: string) => ['campaigns', campaignId, 'characters'] as const,
  character: (id: string) => ['characters', id] as const,
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
