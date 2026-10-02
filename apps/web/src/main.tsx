import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router';
import { Layout, RequireAuth } from './components/Layout';
import { PageMessage } from './components/ui';
import { NewNpcDrawer, NpcDrawer, NpcRedirect, CampaignNpcs } from './pages/CampaignNpcs';
import { CampaignCharacters, CampaignChronicle, CampaignPage } from './pages/CampaignPage';
import { CampaignTable } from './pages/CampaignTable';
import { CampaignsPage } from './pages/CampaignsPage';
import { CharacterPage } from './pages/CharacterPage';
import { GamePage } from './pages/GamePage';
import { LoginPage } from './pages/LoginPage';
import { NewCharacterPage } from './pages/NewCharacterPage';
import { RollerPage } from './pages/RollerPage';
import { ScreenPage } from './pages/ScreenPage';
import { createQueryClient } from './queries';
import { applyTheme, savedTheme } from './theme';
import '@fontsource/alegreya/400.css';
import '@fontsource/alegreya/400-italic.css';
import '@fontsource/alegreya/700.css';
import '@fontsource/alegreya/800.css';
import '@fontsource/alegreya-sans/400.css';
import '@fontsource/alegreya-sans/400-italic.css';
import '@fontsource/alegreya-sans/500.css';
import '@fontsource/alegreya-sans/700.css';
import '@fontsource/alegreya-sans-sc/500.css';
import '@fontsource/alegreya-sans-sc/700.css';
import './styles/index.css';

const queryClient = createQueryClient();
// El tema elegido en este navegador, antes de pintar nada.
applyTheme(savedTheme());

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
              <Route path="campanas/:campaignId" element={<CampaignPage />}>
                <Route index element={<CampaignChronicle />} />
                <Route path="personajes" element={<CampaignCharacters />} />
                <Route path="pnj" element={<CampaignNpcs />}>
                  <Route path="nuevo" element={<NewNpcDrawer />} />
                  <Route path=":npcId" element={<NpcDrawer />} />
                </Route>
                <Route path="mesa" element={<CampaignTable />} />
              </Route>
              <Route path="campanas/:campaignId/personajes/nuevo" element={<NewCharacterPage />} />
              <Route path="personajes/:characterId" element={<CharacterPage />} />
              <Route path="pnj/:npcId" element={<NpcRedirect />} />
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
