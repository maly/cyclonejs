/** Konstanty letu. Pozdější etapy je můžou přepsat, cyklon čte stejné místo. */

export const SIM_STEP = 1 / 60;
export const MAX_FRAME_SECONDS = 0.25;

export const MAX_SPEED = 6;
export const TURN_RATE = (120 * Math.PI) / 180;
export const CLIMB_MAX = 3;
export const DESCEND_MAX = 4;
/** Po uvolnění stoupání i klesání dozní zhruba za tuto dobu. */
export const VERTICAL_DAMP = 0.7;
export const VERTICAL_ACCEL = DESCEND_MAX / VERTICAL_DAMP;
export const CEILING = 12;
export const THRUST_ACCEL = 3;
export const DRAG = 2.4;

export const HELI_RADIUS = 0.8;
/** Dosednutí pod těmito rychlostmi je přistání, nad nimi havárie. */
export const LAND_SPEED = 1;
export const LAND_VERTICAL = 1.5;
/** Pod touto výškou nad terénem se svislá rychlost v HUD obarví. */
export const LAND_HINT_HEIGHT = 3;

export const CRASH_RESPAWN = 2;

/** Střed bílé plochy 4×3, její severozápadní roh je buňka [270, 309]. */
export const SPAWN_X = 271.5;
export const SPAWN_Z = 310.5;
export const BASE_CELL_X = 270;
export const BASE_CELL_Z = 309;

/**
 * Nádrž 100. Ve vzduchu 0,2/s a při tahu dalších 0,15/s.
 * Plný plyn vydrží 100/0,35 ≈ 286 s, tedy asi 1 700 buněk. Visení asi 500 s.
 */
export const FUEL_MAX = 100;
export const FUEL_BURN = 0.2;
export const FUEL_THRUST = 0.15;
export const FUEL_REFUEL = 20;
export const FUEL_WARN = 0.2;
/** Nucené klesání s prázdnou nádrží, úrovně za sekundu. */
export const FUEL_SINK = 1;

export const WINCH_RANGE = 0.5;
export const WINCH_HEIGHT = 2;
/** Výška úchopu bedny nad zemí. Víko, ne spodní hrana. */
export const CRATE_GRAB = 0.44;
/** Výška úchopu člověka nad zemí. Hlava, ne nohy. */
export const PERSON_GRAB = 0.78;
export const WINCH_SPEED = 0.5;
export const WINCH_TIME = 1.5;
/** Za jak dlouho se lano vysune na plnou délku WINCH_HEIGHT. */
export const WINCH_EXTEND = 0.55;

export const SCORE_CRATE = 500;
export const SCORE_PERSON = 100;
export const SCORE_SECOND = 10;

export const START_LIVES = 3;
/** Dobová recenze v Crash počítala na misi zhruba čtvrt hodiny. */
export const ROUND_SECONDS = 15 * 60;
export const GAME_SEED = 1;

export const CYCLONE_SPEED = 1.5;
export const CYCLONE_TURN = (20 * Math.PI) / 180;
export const CYCLONE_MARGIN = 30;
export const CYCLONE_SPAWN_CLEAR = 220;
/** Horní hranice vzdálenosti startu od základny. Dolní je CYCLONE_SPAWN_CLEAR. */
export const CYCLONE_SPAWN_FAR = 340;
/** Vítr je cítit přes zhruba třetinu mapy. w = max(0, 1 − d / CYCLONE_WIND). */
export const CYCLONE_WIND = 200;
/** Pravý konec ukazatele. w ≥ 0,8 je d ≤ 40. */
export const CYCLONE_DANGER = 0.8;
export const CYCLONE_DANGER_RADIUS = CYCLONE_WIND * (1 - CYCLONE_DANGER);
export const CYCLONE_INNER = 8;
/** Ustálený snos ve buňkách za sekundu je CYCLONE_DRIFT · w². */
export const CYCLONE_DRIFT = 3;
/** Podíl směru snosu, který míří do středu. Zbytek je tečna proti směru hodin. */
export const CYCLONE_INWARD = 0.2;
export const CYCLONE_YAW = (60 * Math.PI) / 180;
/** Útlum snosu, aby vítr po opuštění bouře ustal. */
export const CYCLONE_DRAG = 1.6;

export const PLANE_SPEED = 20;
export const PLANE_WARN = 2;
export const PLANE_SPREAD = (30 * Math.PI) / 180;
export const PLANE_HIT = 1.2;
export const PLANE_WATER = 3;
export const PLANE_INTERVAL_MIN = 15;
export const PLANE_INTERVAL_MAX = 40;

export const CAMERA_DISTANCE = 22;
export const CAMERA_SWITCH = 0.4;
export const CAMERA_LAG = 3.2;
/** Polovina výšky ortografického záběru, v buňkách. O polovinu výš než původních 9. */
export const CAMERA_HALF = 13.5;
/** Násobek výřezu kolečkem myši. 0,7 je bližší záběr. */
export const CAMERA_ZOOM_MIN = 0.7;
export const CAMERA_ZOOM_MAX = 1.5;
/** Strana čtvercové minimapy, v buňkách. */
export const MINIMAP_CELLS = 160;
