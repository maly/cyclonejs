/** Příkazy za jeden simulační krok. Nejsou to klávesy. */

export interface FlightCommand {
  climb: boolean;
  descend: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  forward: boolean;
  toggleView: boolean;
}

export const IDLE_COMMAND: FlightCommand = {
  climb: false,
  descend: false,
  turnLeft: false,
  turnRight: false,
  forward: false,
  toggleView: false,
};

/** Let plus hrany kláves, které řídí obrazovky a pauzu. */
export interface GameCommand {
  flight: FlightCommand;
  /** Mezerník. Na úvodu start, na konci návrat na úvod. Ve hře je zároveň zrychlení. */
  confirm: boolean;
  /** Escape. Během hry pozastaví a znovu spustí. */
  pause: boolean;
  /** Klávesa M. Mapa běží mimo simulaci. */
  toggleMap: boolean;
  /** Klávesa S. Zvuk běží mimo simulaci. */
  toggleMute: boolean;
  /** Jen s ?debug. */
  god: boolean;
  fillFuel: boolean;
  teleport: boolean;
  skipMinute: boolean;
  /** Klávesa R. Na úvodu přepne rozmístění, na konci spustí stejný seed. */
  toggleLayout: boolean;
  /** Jen s ?debug. Další seed a nové rozmístění bez obnovení stránky. */
  reseed: boolean;
}

export const IDLE_GAME: GameCommand = {
  flight: IDLE_COMMAND,
  confirm: false,
  pause: false,
  toggleMap: false,
  toggleMute: false,
  god: false,
  fillFuel: false,
  teleport: false,
  skipMinute: false,
  toggleLayout: false,
  reseed: false,
};

/** Zrychlení ve světových osách X a Z. Cyklon ho později naplní, teď je nulové. */
export interface ExternalForce {
  x: number;
  z: number;
}

export const ZERO_FORCE: ExternalForce = { x: 0, z: 0 };
