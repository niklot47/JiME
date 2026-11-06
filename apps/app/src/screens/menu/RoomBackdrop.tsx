// The theme's 3D map room as a page's background, like the original's new-game pages (the map table behind them, out
// of focus) or, chosen in the settings, the title screen's background (sharp). One room for all the pages: only its
// blur changes (a CSS filter, eased), so moving between pages does not load the scene again.
import { useMemo } from "react";
import { CampaignMap3D } from "./CampaignMap3D.tsx";
import type { MapView } from "./CampaignMap2D.tsx";

const MENU_BG_KEY = "jime.menu.bg";
export type MenuBg = "theme" | "map";
/** the title screen's background: the theme's own (picture, parallax, scene) or the map room */
export const menuBg = (): MenuBg => { try { return localStorage.getItem(MENU_BG_KEY) === "map" ? "map" : "theme"; } catch { return "theme"; } };
export const setMenuBg = (k: MenuBg) => { try { localStorage.setItem(MENU_BG_KEY, k); } catch { /* private mode */ } };

export function RoomBackdrop({ scene, blurred }: { scene: string; blurred: boolean }) {
  // no campaign: the room's own map, no names over it, nothing marked
  const view = useMemo<MapView>(() => ({ image: undefined, at: () => [0.5, 0.5], labels: [], zoom: 1, sceneTexture: true }), []);
  return (
    <div className={`pm-room${blurred ? " blurred" : ""}`} aria-hidden="true">
      {/* the title screen: the map a little to the right, clear of the logo and the buttons */}
      <CampaignMap3D scene={scene} view={view} trail={[]} focus={null} zoomed={false} still shift={blurred ? 0 : 0.17} />
    </div>
  );
}
