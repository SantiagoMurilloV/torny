import { Outlet } from 'react-router';
import { InstallPrompt } from './InstallPrompt';
// NotificationPrompt removed from global layout — each tournament page
// now mounts it with its own tournamentId so spectators only subscribe
// to the specific tournament they're viewing (mig 039).

/**
 * Layout — public-facing shell for spectator routes.
 */
export function Layout() {
  return (
    <div className="min-h-screen bg-background">
      <Outlet />
      <InstallPrompt />
    </div>
  );
}
