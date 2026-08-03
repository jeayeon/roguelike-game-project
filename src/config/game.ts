import type { Direction } from '../types/game';

export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;
export const ATTACK_COOLDOWN = 360;
export const MIN_ENEMY_SPAWN_DISTANCE = 210;

export const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right'];
export const OPPOSITE: Record<Direction, Direction> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};
