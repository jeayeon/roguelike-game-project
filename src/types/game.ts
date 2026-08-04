import type Phaser from 'phaser';

export type Direction = 'up' | 'down' | 'left' | 'right';
export type EnemyKind = 'stalker' | 'brute' | 'archer' | 'boss';
export type RoomType = 'combat' | 'healing' | 'shop' | 'boss';

export type Enemy = Phaser.Physics.Arcade.Image & {
  hp: number;
  maxHp: number;
  speed: number;
  lastHitAt: number;
  nextActionAt: number;
  attackPending?: boolean;
  bossPhase?: 1 | 2 | 3;
  strafeDirection: number;
  kind: EnemyKind;
  hitRadius: number;
};

export type PermanentUpgradeId = Exclude<UpgradeId, 'dashCooldown' | 'dashDuration'>;

export type PermanentUpgradeDefinition = {
  id: PermanentUpgradeId;
  name: string;
  description: string;
  maxLevel: number;
  baseCost: number;
  costStep: number;
  color: number;
};

export type EnemyProjectile = Phaser.Physics.Arcade.Image & {
  damage: number;
};

export type RoomDefinition = {
  id: number;
  name: string;
  description: string;
  mapX: number;
  mapY: number;
  accent: number;
  type: RoomType;
  enemies: EnemyKind[];
  exits: Partial<Record<Direction, number>>;
};

export type UpgradeId =
  | 'attackPower'
  | 'attackSpeed'
  | 'attackRange'
  | 'maxHealth'
  | 'moveSpeed'
  | 'dashCooldown'
  | 'dashDuration'
  | 'roomRecovery'
  | 'criticalChance'
  | 'ashArmor';

export type UpgradeDefinition = {
  id: UpgradeId;
  name: string;
  description: string;
  maxStacks: number;
  color: number;
};
