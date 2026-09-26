import { IDLE_COMMAND, type FlightCommand, type GameCommand } from "../sim/command.ts";

const DEADZONE = 0.35;

/** Drží klávesy podle `KeyboardEvent.code` a Gamepad API. */
export function createInput(target: Window = window, debug = false): { sample: () => GameCommand } {
  const held = new Set<string>();
  let viewEdge = false;
  let confirmEdge = false;
  let pauseEdge = false;
  let mapEdge = false;
  let muteEdge = false;
  let godEdge = false;
  let fuelEdge = false;
  let teleportEdge = false;
  let minuteEdge = false;
  let padWasX = false;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) return;
    if (event.code === "KeyN" && !held.has("KeyN")) viewEdge = true;
    if (event.code === "KeyM" && !held.has("KeyM")) mapEdge = true;
    if (event.code === "KeyS" && !held.has("KeyS")) muteEdge = true;
    if (debug && event.code === "KeyG") godEdge = true;
    if (debug && event.code === "KeyF") fuelEdge = true;
    if (debug && event.code === "KeyT") teleportEdge = true;
    if (debug && event.code === "KeyK") minuteEdge = true;
    if (event.code === "Space") confirmEdge = true;
    if (event.code === "Escape") pauseEdge = true;
    held.add(event.code);
    if (isFlightCode(event.code)) event.preventDefault();
  };
  const onKeyUp = (event: KeyboardEvent) => {
    held.delete(event.code);
  };
  target.addEventListener("keydown", onKeyDown);
  target.addEventListener("keyup", onKeyUp);

  return {
    sample() {
      const pad = readPad();
      const toggleView = viewEdge || (pad.x && !padWasX);
      const confirm = confirmEdge;
      const pause = pauseEdge;
      const toggleMap = mapEdge;
      const toggleMute = muteEdge;
      const god = godEdge;
      const fillFuel = fuelEdge;
      const teleport = teleportEdge;
      const skipMinute = minuteEdge;
      viewEdge = false;
      confirmEdge = false;
      pauseEdge = false;
      mapEdge = false;
      muteEdge = false;
      godEdge = false;
      fuelEdge = false;
      teleportEdge = false;
      minuteEdge = false;
      padWasX = pad.x;
      const flight: FlightCommand = {
        climb: held.has("KeyQ") || held.has("ArrowUp") || pad.climb,
        descend: held.has("KeyA") || held.has("ArrowDown") || pad.descend,
        turnLeft: held.has("KeyO") || held.has("ArrowLeft") || pad.turnLeft,
        turnRight: held.has("KeyP") || held.has("ArrowRight") || pad.turnRight,
        forward: held.has("Space") || pad.forward,
        toggleView,
      };
      return { flight, confirm, pause, toggleMap, toggleMute, god, fillFuel, teleport, skipMinute };
    },
  };
}

function isFlightCode(code: string): boolean {
  return (
    code === "KeyQ" ||
    code === "KeyA" ||
    code === "ArrowUp" ||
    code === "ArrowDown" ||
    code === "KeyO" ||
    code === "KeyP" ||
    code === "ArrowLeft" ||
    code === "ArrowRight" ||
    code === "KeyN" ||
    code === "Space" ||
    code === "Escape" ||
    code === "KeyM" ||
    code === "KeyS" ||
    code === "KeyG" ||
    code === "KeyF" ||
    code === "KeyT" ||
    code === "KeyK"
  );
}

function readPad(): Omit<FlightCommand, "toggleView"> & { x: boolean } {
  const pads = navigator.getGamepads?.();
  const pad = pads ? pads[0] : null;
  if (!pad) return { ...IDLE_COMMAND, x: false };
  const leftX = pad.axes[0] ?? 0;
  const rightY = pad.axes[3] ?? 0;
  const triggerAxis = pad.axes[5] ?? 0;
  return {
    climb: rightY < -DEADZONE || Boolean(pad.buttons[5]?.pressed),
    descend: rightY > DEADZONE || Boolean(pad.buttons[4]?.pressed),
    turnLeft: leftX < -DEADZONE,
    turnRight: leftX > DEADZONE,
    forward: Boolean(pad.buttons[7]?.pressed) || triggerAxis > 0.3,
    x: Boolean(pad.buttons[2]?.pressed),
  };
}
