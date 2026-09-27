import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router';
import { Layout, RequireAuth } from './components/Layout';
import { PageMessage } from './components/ui';
import { CampaignPage } from './pages/CampaignPage';
import { CampaignsPage } from './pages/CampaignsPage';
import { CharacterPage } from './pages/CharacterPage';
import { GamePage } from './pages/GamePage';
import { LoginPage } from './pages/LoginPage';
import { NewCharacterPage } from './pages/NewCharacterPage';
import { NewNpcPage } from './pages/NewNpcPage';
import { NpcPage } from './pages/NpcPage';
import { RollerPage } from './pages/RollerPage';
import { ScreenPage } from './pages/ScreenPage';
import { createQueryClient } from './queries';
import './styles.css';

const queryClient = createQueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          {/* La pantalla de la mesa va sin cabecera ni sesión: es para una tele. */}
          <Route path="pantalla/:token" element={<ScreenPage />} />
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/campanas" replace />} />
            <Route path="entrar" element={<LoginPage />} />
            <Route path="tirador" element={<RollerPage />} />
            <Route element={<RequireAuth />}>
              <Route path="campanas" element={<CampaignsPage />} />
              <Route path="campanas/:campaignId" element={<CampaignPage />} />
              <Route path="campanas/:campaignId/personajes/nuevo" element={<NewCharacterPage />} />
              <Route path="personajes/:characterId" element={<CharacterPage />} />
              <Route path="campanas/:campaignId/pnj/nuevo" element={<NewNpcPage />} />
              <Route path="pnj/:npcId" element={<NpcPage />} />
              <Route path="partidas/:gameId" element={<GamePage />} />
            </Route>
            <Route
              path="*"
              element={
                <PageMessage title="Esta página no existe">
                  <Link to="/campanas">Volver a tus campañas</Link>
                </PageMessage>
              }
            />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
