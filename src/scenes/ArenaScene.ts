import Phaser from 'phaser';
import { AdaptiveMusic } from '../audio/AdaptiveMusic';
import {
  ATTACK_COOLDOWN,
  DIRECTIONS,
  GAME_HEIGHT,
  GAME_WIDTH,
  MIN_ENEMY_SPAWN_DISTANCE,
  OPPOSITE,
} from '../config/game';
import { createRandomRoomLayout } from '../data/rooms';
import { getPermanentUpgradeCost, PERMANENT_UPGRADES } from '../data/permanentUpgrades';
import {
  clearRogueliteProgress,
  DEFAULT_SETTINGS,
  hasStoredRogueliteProgress,
  loadRogueliteProgress,
  saveRogueliteProgress,
  type GameSettings,
} from '../data/persistence';
import { UPGRADES } from '../data/upgrades';
import type {
  Direction,
  Difficulty,
  Enemy,
  EnemyKind,
  EnemyProjectile,
  PermanentUpgradeDefinition,
  PermanentUpgradeId,
  RoomType,
  RoomDefinition,
  UpgradeDefinition,
  UpgradeId,
  WeaponType,
} from '../types/game';

type SpecialChoice = {
  label: string;
  description: string;
  cost: number;
  action: () => string;
};

const EXIT_LABELS: Record<Direction, string> = {
  up: '↑ 북쪽', down: '↓ 남쪽', left: '← 서쪽', right: '동쪽 →',
};

const ROOM_PORTAL_STYLE: Record<RoomType, { fill: number; stroke: number; text: string; label: string }> = {
  combat: { fill: 0x5fc7d8, stroke: 0xbef4ff, text: '#bef4ff', label: '전투방' },
  healing: { fill: 0x42c77a, stroke: 0x9af0b8, text: '#9af0b8', label: '회복방' },
  shop: { fill: 0xe0ac3f, stroke: 0xffdd76, text: '#ffdd76', label: '상점방' },
  midboss: { fill: 0x8b5bd1, stroke: 0xd4b0ff, text: '#d4b0ff', label: '중간 보스방' },
  boss: { fill: 0xd94b5b, stroke: 0xff8792, text: '#ff8792', label: '보스방' },
};

const ATTACK_ORIGIN_OFFSET = 18;
const BOSS_WALL_VOLLEY_INTERVAL = 3200;
const BOSS_WALL_TELEGRAPH_DURATION = 900;
const BOSS_CORNER_DASH_SPEED = 560;
const BOSS_CORNER_DASH_WINDUP = 500;
const BOSS_CORNER_DASH_DURATION = 420;
const BOSS_CORNER_DASH_COOLDOWN = 2800;
const MIDBOSS_ATTACK_RANGE = 225;
const MIDBOSS_ATTACK_WINDUP = 750;
const MIDBOSS_ATTACK_COOLDOWN = 1300;
const SPEAR_ATTACK_HALF_WIDTH = 11;
const SHOW_DAMAGE_NUMBERS = true;
const DIFFICULTY_ORDER: Difficulty[] = ['easy', 'normal', 'hard'];
const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: '이지', normal: '노말', hard: '하드',
};
const DIFFICULTY_DESCRIPTIONS: Record<Difficulty, string> = {
  easy: '보스 2단계 · 벽 불덩이 없음',
  normal: '현재 기본 난이도',
  hard: '모든 전투방 벽 불덩이 강화',
};
const BOSS_HEALTH_BY_DIFFICULTY: Record<Difficulty, number> = {
  easy: 2000, normal: 3000, hard: 4000,
};
const UPGRADE_REROLL_COST = 8;
type WeaponDefinition = {
  name: string;
  description: string;
  attackDamage: number;
  attackCooldown: number;
  attackRange: number;
  attackArcAngle: number;
  attackDuration: number;
  walkTexture: string;
  attackAnimation: string;
  walkAnimation: string;
  displaySize: number;
  bodyRadius: number;
  bodyOffset: number;
  color: number;
};
const WEAPON_ORDER: WeaponType[] = ['sword', 'spear', 'axe'];
const WEAPONS: Record<WeaponType, WeaponDefinition> = {
  sword: {
    name: '잿불의 검', description: '균형 잡힌 부채꼴 공격',
    attackDamage: 34, attackCooldown: ATTACK_COOLDOWN, attackRange: 74, attackArcAngle: 0.92,
    attackDuration: 260, walkTexture: 'player', attackAnimation: 'player-attack', walkAnimation: 'player-walk',
    displaySize: 72, bodyRadius: 70, bodyOffset: 58, color: 0xf7c86a,
  },
  spear: {
    name: '균열의 창', description: '가장 긴 직선형 관통 범위',
    attackDamage: 44, attackCooldown: ATTACK_COOLDOWN, attackRange: 138, attackArcAngle: 0.16,
    attackDuration: 250, walkTexture: 'playerSpear', attackAnimation: 'player-spear-attack', walkAnimation: 'player-spear-walk',
    displaySize: 105, bodyRadius: 49, bodyOffset: 79, color: 0x8ee7f2,
  },
  axe: {
    name: '심연의 도끼', description: '넓고 강하지만 느린 부채꼴 공격',
    attackDamage: 50, attackCooldown: ATTACK_COOLDOWN * 1.7, attackRange: 111, attackArcAngle: 1.08,
    attackDuration: 520, walkTexture: 'playerAxe', attackAnimation: 'player-axe-attack', walkAnimation: 'player-axe-walk',
    displaySize: 105, bodyRadius: 49, bodyOffset: 79, color: 0xff9a63,
  },
};
const BASE_STATS = {
  maxHp: 50,
  moveSpeed: 260,
  dashCooldown: 1000,
  dashDuration: 400,
} as const;

//Scan을 상속
export class ArenaScene extends Phaser.Scene {
  private rooms: RoomDefinition[] = [];
  private player!: Phaser.Physics.Arcade.Sprite;
  private enemies!: Phaser.Physics.Arcade.Group;
  private enemyProjectiles!: Phaser.Physics.Arcade.Group;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private attackKey!: Phaser.Input.Keyboard.Key;
  private weapon: WeaponType = 'sword';
  private hp = 50;
  private maxHp = 50;
  private attackDamage = 34;
  private attackCooldown = ATTACK_COOLDOWN;
  private attackRange = 74;
  private attackArcAngle = 0.92;
  private moveSpeed = 260;
  private dashSpeed = 620;
  private dashCooldown = 1000;
  private dashDuration = BASE_STATS.dashDuration;
  private roomRecovery = 0;
  private lastCombatRecovery?: { base: number; bonus: number; total: number; restored: number };
  private criticalChance = 0;
  private damageReduction = 0;
  private kills = 0;
  private ashes = 0;
  private roomIndex = 0;
  private lastAttackAt = -1000;
  private playerAttackingUntil = 0;
  private currentAttackFacing = 0;
  private lastDashAt = -2000;
  private invulnerableUntil = 0;
  private playerKnockbackUntil = 0;
  private transitionLockUntil = 0;
  private roomCleared = false;
  private transitioning = false;
  private runFinished = false;
  private gameStarted = false;
  private hasSavedProgress = false;
  private difficulty: Difficulty = 'easy';
  private highestUnlockedDifficulty: Difficulty = 'easy';
  private newlyUnlockedDifficulty?: Difficulty;
  private skipNextPersistence = false;
  private countdownActive = false;
  private countdownValue = 0;
  private gamePaused = false;
  private settings: GameSettings = { ...DEFAULT_SETTINGS };
  private awaitingUpgrade = false;
  private awaitingSpecial = false;
  private awaitingPermanentUpgrade = false;
  private awaitingWeaponSelection = false;
  private awaitingMidBossReward = false;
  private acquiredUpgrades = new Map<UpgradeId, number>();
  private midBossBonusUpgrades = new Map<UpgradeId, number>();
  private permanentUpgradeLevels = new Map<PermanentUpgradeId, number>();
  private permanentUpgradeChoices: PermanentUpgradeDefinition[] = [];
  private upgradeChoices: UpgradeDefinition[] = [];
  private rerolledUpgradeRooms = new Set<number>();
  private shopUpgradeChoicesByRoom = new Map<number, UpgradeId[]>();
  private upgradeRerollMessage = '';
  private midBossRewardMessage = '';
  private upgradeOverlay?: Phaser.GameObjects.Container;
  private specialOverlay?: Phaser.GameObjects.Container;
  private specialChoices: SpecialChoice[] = [];
  private specialFeedbackText?: Phaser.GameObjects.Text;
  private midBossRewardOverlay?: Phaser.GameObjects.Container;
  private restartOverlay?: Phaser.GameObjects.Container;
  private permanentOverlay?: Phaser.GameObjects.Container;
  private weaponOverlay?: Phaser.GameObjects.Container;
  private weaponSelectionCallback?: () => void;
  private permanentPurchaseMessage = '';
  private startOverlay?: Phaser.GameObjects.Container;
  private pauseOverlay?: Phaser.GameObjects.Container;
  private settingsOverlay?: Phaser.GameObjects.Container;
  private statsOverlay?: Phaser.GameObjects.Container;
  private settingsReturnTo: 'start' | 'pause' = 'start';
  private countdownText?: Phaser.GameObjects.Text;
  private music = new AdaptiveMusic();
  private clearedRooms = new Set<number>();
  private usedSpecialRooms = new Set<number>();
  private visitedRooms = new Set<number>();
  private revealedRooms = new Set<number>();
  private hpText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private roomText!: Phaser.GameObjects.Text;
  private buildText!: Phaser.GameObjects.Text;
  private bannerText!: Phaser.GameObjects.Text;
  private attackArc!: Phaser.GameObjects.Graphics;
  private attackSlash!: Phaser.GameObjects.Rectangle;
  private attackArcHideTimer?: Phaser.Time.TimerEvent;
  private arenaGraphics!: Phaser.GameObjects.Graphics;
  private miniMapGraphics!: Phaser.GameObjects.Graphics;
  private bossHudGraphics!: Phaser.GameObjects.Graphics;
  private bossHealthText!: Phaser.GameObjects.Text;
  private bossWarningCircle!: Phaser.GameObjects.Arc;
  private bossWarningText!: Phaser.GameObjects.Text;
  private bossTelegraphGraphics!: Phaser.GameObjects.Graphics;
  private bossCornerDashWarningGraphics!: Phaser.GameObjects.Graphics;
  private bossWallTelegraphGraphics!: Phaser.GameObjects.Graphics;
  private bossWallWarningText!: Phaser.GameObjects.Text;
  private midBossTelegraphGraphics!: Phaser.GameObjects.Graphics;
  private midBossSwingGraphics!: Phaser.GameObjects.Graphics;
  private midBossSwingTween?: Phaser.Tweens.Tween;
  private midBossWarningText!: Phaser.GameObjects.Text;
  private bossPhaseText!: Phaser.GameObjects.Text;
  private bossTelegraphActive = false;
  private nextBossWallVolleyAt = Number.POSITIVE_INFINITY;
  private bossWallVolleyFlipped = false;
  private pendingBossWallVolley = false;
  private pendingBossWallVolleyFlipped = false;
  private hitStopTimer?: number;
  private debugInvincible = false;
  private exitPortals!: Record<Direction, Phaser.GameObjects.Arc>;
  private exitLabels!: Record<Direction, Phaser.GameObjects.Text>;
  private readonly flushPersistentProgress = (): void => {
    if (!this.skipNextPersistence) this.persistProgress();
  };
  private readonly flushProgressWhenHidden = (): void => {
    if (document.visibilityState === 'hidden' && !this.skipNextPersistence) this.persistProgress();
  };
  private readonly preventContextMenu = (event: MouseEvent): void => event.preventDefault();

  constructor() {
    super('arena');
  }

  preload(): void {
    const characterAssetPath = `${import.meta.env.BASE_URL}assets/characters`;
    const walkAssetPath = `${characterAssetPath}/walk`;
    ['player', 'stalker', 'brute', 'archer', 'boss'].forEach((key) => {
      this.load.spritesheet(key, `${walkAssetPath}/${key}-walk.png`, { frameWidth: 256, frameHeight: 256 });
    });
    this.load.spritesheet('midboss', `${walkAssetPath}/midboss-walk.png`, { frameWidth: 256, frameHeight: 256 });
    this.load.spritesheet('midbossAttack', `${characterAssetPath}/midboss-attack.png`, { frameWidth: 256, frameHeight: 256 });
    this.load.spritesheet('playerAttack', `${characterAssetPath}/player-attack.png`, { frameWidth: 256, frameHeight: 256 });
    this.load.spritesheet('playerSpear', `${walkAssetPath}/player-spear-walk.png`, { frameWidth: 256, frameHeight: 256 });
    this.load.spritesheet('playerSpearAttack', `${characterAssetPath}/player-spear-attack.png`, { frameWidth: 256, frameHeight: 256 });
    this.load.spritesheet('playerAxe', `${walkAssetPath}/player-axe-walk.png`, { frameWidth: 256, frameHeight: 256 });
    this.load.spritesheet('playerAxeAttack', `${characterAssetPath}/player-axe-attack-fixed.png`, { frameWidth: 384, frameHeight: 256 });
    const projectileAssetPath = `${import.meta.env.BASE_URL}assets/projectiles`;
    this.load.spritesheet('iceArrow', `${projectileAssetPath}/ice-arrow.png`, { frameWidth: 256, frameHeight: 256 });
    this.load.spritesheet('fireball', `${projectileAssetPath}/fireball.png`, { frameWidth: 256, frameHeight: 256 });
  }

  create(): void {
    this.resetRunState();
    window.addEventListener('pagehide', this.flushPersistentProgress);
    document.addEventListener('visibilitychange', this.flushProgressWhenHidden);
    document.addEventListener('contextmenu', this.preventContextMenu);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.hitStopTimer !== undefined) window.clearTimeout(this.hitStopTimer);
      if (!this.skipNextPersistence) this.persistProgress();
      window.removeEventListener('pagehide', this.flushPersistentProgress);
      document.removeEventListener('visibilitychange', this.flushProgressWhenHidden);
      document.removeEventListener('contextmenu', this.preventContextMenu);
      this.music.stop();
    });
    this.createAnimations();
    this.cameras.main.setBackgroundColor('#120f19');

    this.arenaGraphics = this.add.graphics();
    this.miniMapGraphics = this.add.graphics().setDepth(21);
    this.drawArena(this.rooms[0].accent);

    this.player = this.physics.add.sprite(170, GAME_HEIGHT / 2, 'player', 0);
    this.player.setDisplaySize(72, 72).setCircle(70, 58, 58)
      .setCollideWorldBounds(true).setDepth(6).setVisible(false);
    this.applyCharacterOutline(this.player, 0xffd17a, 1.4);
    this.enemies = this.physics.add.group();
    this.enemyProjectiles = this.physics.add.group();
    this.physics.add.collider(this.player, this.enemies, this.onPlayerHit, undefined, this);
    this.physics.add.overlap(this.player, this.enemyProjectiles, this.onProjectileHit, undefined, this);

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    }) as typeof this.wasd;
    this.attackKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.J);
    this.input.on('pointerdown', () => this.music.unlock());
    this.input.keyboard!.on('keydown-R', () => {
      if (this.awaitingPermanentUpgrade) this.startContinuedRun();
      else if (this.hp <= 0) this.continueFromBeginning();
      else if (this.runFinished) this.scene.restart();
    });
    this.input.keyboard!.on('keydown', (event: KeyboardEvent) => {
      this.music.unlock();
      if (this.statsOverlay && (event.key === 'Escape' || event.key.toLowerCase() === 'c')) {
        this.closePlayerStats();
        return;
      }
      if (this.settingsOverlay && (event.key === 'Escape' || event.key.toLowerCase() === 'p')) {
        this.closeSettings();
        return;
      }
      if (this.awaitingMidBossReward) {
        if (event.key === 'Enter' || event.key === 'Escape' || event.key === ' ') this.closeMidBossReward();
        return;
      }
      if (event.key.toLowerCase() === 'p' || (event.key === 'Escape' && this.gameStarted && !this.awaitingSpecial && !this.awaitingPermanentUpgrade)) {
        this.togglePause();
        return;
      }
      if (this.settingsOverlay) return;
      if (this.gamePaused) return;
      const choiceIndex = Number(event.key) - 1;
      if (this.awaitingWeaponSelection) {
        if (choiceIndex >= 0 && choiceIndex < WEAPON_ORDER.length) this.selectWeapon(WEAPON_ORDER[choiceIndex]);
        return;
      }
      if (event.key.toLowerCase() === 'c' && this.gameStarted && !this.awaitingUpgrade && !this.awaitingSpecial && !this.awaitingMidBossReward) {
        this.showPlayerStats();
        return;
      }
      if (!this.gameStarted && event.key === 'Enter') {
        this.beginGame();
        return;
      }
      if (this.awaitingPermanentUpgrade) {
        if (choiceIndex >= 0 && choiceIndex < this.permanentUpgradeChoices.length) this.purchasePermanentUpgrade(choiceIndex);
        else if (event.key === 'Enter' || event.key === 'Escape' || event.key === '4') this.startContinuedRun();
        return;
      }
      if (this.awaitingUpgrade && event.key.toLowerCase() === 'r') {
        this.rerollUpgradeChoices();
        return;
      }
      if (this.awaitingSpecial && this.rooms[this.roomIndex].type === 'shop' && event.key.toLowerCase() === 'r') {
        this.rerollShopChoices();
        return;
      }
      if (this.awaitingUpgrade && choiceIndex >= 0 && choiceIndex < this.upgradeChoices.length) this.selectUpgrade(choiceIndex);
      if (this.awaitingSpecial && choiceIndex >= 0 && choiceIndex < this.specialChoices.length) this.selectSpecialChoice(choiceIndex);
      if (this.awaitingSpecial && this.rooms[this.roomIndex].type === 'shop' && (event.key === 'Escape' || event.key === '4')) {
        this.leaveShop();
      }
      if (this.awaitingSpecial && this.rooms[this.roomIndex].type === 'healing' && (event.key === 'Escape' || event.key === '3')) {
        this.leaveHealingRoom();
      }
    });

    this.attackArc = this.add.graphics().setVisible(false).setDepth(5);
    this.attackSlash = this.add.rectangle(this.player.x, this.player.y, 82, 7, 0xfff0b8, 0.95)
      .setStrokeStyle(2, 0xff9f43, 1).setOrigin(0.08, 0.5).setVisible(false).setDepth(8);
    this.bossWarningCircle = this.add.circle(0, 0, 58, 0xff596d, 0.12)
      .setStrokeStyle(5, 0xff8090, 1).setVisible(false).setDepth(7);
    this.bossTelegraphGraphics = this.add.graphics().setDepth(7);
    this.bossCornerDashWarningGraphics = this.add.graphics().setVisible(false).setDepth(8);
    this.bossWallTelegraphGraphics = this.add.graphics().setDepth(7);
    this.midBossTelegraphGraphics = this.add.graphics().setDepth(8);
    this.midBossSwingGraphics = this.add.graphics().setDepth(9);
    this.createExitPortals();

    this.bossHudGraphics = this.add.graphics().setDepth(24);
    this.bossHealthText = this.add.text(GAME_WIDTH / 2, 59, '', {
      fontSize: '15px', color: '#ffd6d9', fontStyle: 'bold', padding: { x: 5, y: 4 },
    }).setOrigin(0.5, 0).setVisible(false).setDepth(25);
    this.bossWarningText = this.add.text(GAME_WIDTH / 2, 105, '', {
      fontSize: '24px', color: '#ff9aa7', fontStyle: 'bold', align: 'center',
      stroke: '#35131b', strokeThickness: 5, padding: { x: 8, y: 7 },
    }).setOrigin(0.5).setVisible(false).setDepth(25);
    this.bossPhaseText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 70, '', {
      fontSize: '42px', color: '#ffbf78', fontStyle: 'bold', align: 'center',
      stroke: '#3b1119', strokeThickness: 8, padding: { x: 12, y: 10 },
    }).setOrigin(0.5).setVisible(false).setDepth(30);
    this.bossWallWarningText = this.add.text(GAME_WIDTH / 2, 165, '', {
      fontSize: '21px', color: '#ffca87', fontStyle: 'bold', align: 'center',
      stroke: '#35131b', strokeThickness: 5, padding: { x: 8, y: 6 },
    }).setOrigin(0.5).setVisible(false).setDepth(25);
    this.midBossWarningText = this.add.text(GAME_WIDTH / 2, 112, '', {
      fontSize: '24px', color: '#d9b6ff', fontStyle: 'bold', align: 'center',
      stroke: '#241437', strokeThickness: 6, padding: { x: 8, y: 6 },
    }).setOrigin(0.5).setVisible(false).setDepth(25);

    this.hpText = this.add.text(18, 14, '', {
      fontSize: '22px', color: '#f7ead3', fontStyle: 'bold', padding: { x: 8, y: 8 },
    }).setScrollFactor(0).setDepth(22);
    this.statusText = this.add.text(GAME_WIDTH - 24, 14, '', {
      fontSize: '18px', color: '#d8b4fe', align: 'right', padding: { x: 6, y: 8 },
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(22);
    this.roomText = this.add.text(GAME_WIDTH / 2, 24, '', {
      fontSize: '20px', color: '#f4d7a5', fontStyle: 'bold', padding: { x: 4, y: 5 },
    }).setOrigin(0.5, 0).setDepth(22);
    this.buildText = this.add.text(58, 88, '현재 강화\n없음', {
      fontSize: '14px', color: '#d2c5d7', lineSpacing: 4,
      backgroundColor: '#17131d99', padding: { x: 10, y: 8 },
      wordWrap: { width: 255 },
    }).setDepth(22);
    this.bannerText = this.add.text(GAME_WIDTH / 2, 112, '', {
      fontSize: '36px', color: '#f7c86a', fontStyle: 'bold', align: 'center',
      stroke: '#3a1d2d', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(22);
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 20,
      '이동 WASD/방향키  ·  공격 마우스 클릭/J  ·  대시 SPACE  ·  상태창 C  ·  일시정지 P/ESC  ·  방 정리 후 방향문 선택', {
        fontSize: '16px', color: '#b7abbf',
      }).setOrigin(0.5, 1).setDepth(22);
    this.add.text(GAME_WIDTH - 35, 72, '탐색 지도', {
      fontSize: '15px', color: '#b7abbf', fontStyle: 'bold',
    }).setOrigin(1, 0).setDepth(22);

    this.updateBuildText();
    this.updateHud();
    this.time.addEvent({ delay: 500, loop: true, callback: () => this.publishAccessibleStatus() });
    this.showStartScreen();
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('debugAutoStart') === '1') {
      this.beginGame();
    }
  }

  private showStartScreen(): void {
    this.startOverlay?.destroy(true);
    const children: Phaser.GameObjects.GameObject[] = [];
    children.push(this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0b0810, 0.97).setInteractive());
    children.push(this.add.text(GAME_WIDTH / 2, 92, '심연의 화로', {
      fontSize: '58px', color: '#f7c86a', fontStyle: 'bold',
      stroke: '#512239', strokeThickness: 8, padding: { x: 12, y: 10 },
    }).setOrigin(0.5));
    children.push(this.add.text(GAME_WIDTH / 2, 155, '심연의 화로를 돌파하고 수문장을 쓰러뜨려 탈출하세요', {
      fontSize: '22px', color: '#d9c8dc', padding: { x: 6, y: 5 },
    }).setOrigin(0.5));
    children.push(this.add.text(GAME_WIDTH / 2, 240,
      '이동  WASD / 방향키\n공격  마우스 왼쪽 버튼 / J\n대시/무적  SPACE\n상태창  C  ·  일시정지/메뉴  P 또는 ESC\n방을 정리하고 방향문을 선택해 보스를 찾으세요', {
        fontSize: '19px', color: '#bcaec3', align: 'center', lineSpacing: 8,
        backgroundColor: '#17131de6', padding: { x: 28, y: 13 },
      }).setOrigin(0.5));
    children.push(this.add.text(GAME_WIDTH / 2, 345, `난이도 선택 · ${DIFFICULTY_LABELS[this.difficulty]}`, {
      fontSize: '19px', color: '#f2d9a1', fontStyle: 'bold',
    }).setOrigin(0.5));
    const difficultyXs = [430, 640, 850];
    DIFFICULTY_ORDER.forEach((difficulty, index) => {
      const unlocked = this.isDifficultyUnlocked(difficulty);
      const selected = difficulty === this.difficulty;
      const button = this.add.rectangle(difficultyXs[index], 390, 185, 58,
        selected ? 0x6f344f : unlocked ? 0x302837 : 0x1d1921, 1)
        .setStrokeStyle(3, selected ? 0xf7c86a : unlocked ? 0x9c8ba8 : 0x514956, 1);
      if (unlocked) {
        button.setInteractive({ useHandCursor: true });
        button.on('pointerdown', () => this.selectDifficulty(difficulty));
      }
      children.push(button);
      children.push(this.add.text(difficultyXs[index], 380, unlocked ? DIFFICULTY_LABELS[difficulty] : `${DIFFICULTY_LABELS[difficulty]} · 잠김`, {
        fontSize: '18px', color: selected ? '#fff2ce' : unlocked ? '#ddd0e3' : '#776d7b', fontStyle: 'bold',
      }).setOrigin(0.5));
      children.push(this.add.text(difficultyXs[index], 405, unlocked ? DIFFICULTY_DESCRIPTIONS[difficulty] : '이전 난이도 클리어 필요', {
        fontSize: '12px', color: unlocked ? '#b9acbf' : '#665e6a',
      }).setOrigin(0.5));
    });
    const permanentLevelTotal = [...this.permanentUpgradeLevels.values()]
      .reduce((total, level) => total + level, 0);
    children.push(this.add.text(GAME_WIDTH / 2, 451,
      `저장된 영구 진행 · 재 ${this.ashes} · 화로 강화 ${permanentLevelTotal}단계`, {
        fontSize: '16px', color: '#91e3bd', fontStyle: 'bold',
        backgroundColor: '#16241fe6', padding: { x: 12, y: 6 },
      }).setOrigin(0.5));
    if (this.hasSavedProgress) {
      const continueButton = this.add.rectangle(465, 518, 300, 64, 0x436b68, 1)
        .setStrokeStyle(4, 0x91e3bd, 1).setInteractive({ useHandCursor: true });
      continueButton.on('pointerover', () => continueButton.setFillStyle(0x568781, 1));
      continueButton.on('pointerout', () => continueButton.setFillStyle(0x436b68, 1));
      continueButton.on('pointerdown', () => this.beginGame());
      const newGameButton = this.add.rectangle(815, 518, 300, 64, 0x6f344f, 1)
        .setStrokeStyle(4, 0xf7c86a, 1).setInteractive({ useHandCursor: true });
      newGameButton.on('pointerover', () => newGameButton.setFillStyle(0x8a405f, 1));
      newGameButton.on('pointerout', () => newGameButton.setFillStyle(0x6f344f, 1));
      newGameButton.on('pointerdown', () => this.beginNewGameFromStart());
      children.push(continueButton, newGameButton);
      children.push(this.add.text(465, 518, '이어서 시작', {
        fontSize: '26px', color: '#e8fff3', fontStyle: 'bold', padding: { x: 8, y: 6 },
      }).setOrigin(0.5));
      children.push(this.add.text(815, 518, '새로 시작', {
        fontSize: '26px', color: '#fff2ce', fontStyle: 'bold', padding: { x: 8, y: 6 },
      }).setOrigin(0.5));
      children.push(this.add.text(GAME_WIDTH / 2, 560, 'ENTER: 이어서 시작  ·  새로 시작: 재·강화·난이도 해금 초기화', {
        fontSize: '16px', color: '#a99ba9', padding: { x: 4, y: 3 },
      }).setOrigin(0.5));
    } else {
      const startButton = this.add.rectangle(GAME_WIDTH / 2, 518, 330, 64, 0x6f344f, 1)
        .setStrokeStyle(4, 0xf7c86a, 1).setInteractive({ useHandCursor: true });
      startButton.on('pointerover', () => startButton.setFillStyle(0x8a405f, 1));
      startButton.on('pointerout', () => startButton.setFillStyle(0x6f344f, 1));
      startButton.on('pointerdown', () => this.beginGame());
      children.push(startButton);
      children.push(this.add.text(GAME_WIDTH / 2, 518, '게임 시작', {
        fontSize: '28px', color: '#fff2ce', fontStyle: 'bold', padding: { x: 8, y: 6 },
      }).setOrigin(0.5));
      children.push(this.add.text(GAME_WIDTH / 2, 560, '버튼 클릭 또는 ENTER', {
        fontSize: '16px', color: '#91869a', padding: { x: 4, y: 3 },
      }).setOrigin(0.5));
    }
    const settingsButton = this.add.rectangle(GAME_WIDTH / 2, 620, 240, 48, 0x302837, 1)
      .setStrokeStyle(2, 0x9c8ba8, 1).setInteractive({ useHandCursor: true });
    settingsButton.on('pointerover', () => settingsButton.setFillStyle(0x44384d, 1));
    settingsButton.on('pointerout', () => settingsButton.setFillStyle(0x302837, 1));
    settingsButton.on('pointerdown', () => this.openSettings('start'));
    children.push(settingsButton);
    children.push(this.add.text(GAME_WIDTH / 2, 620, '설정', {
      fontSize: '19px', color: '#ddd0e3', fontStyle: 'bold', padding: { x: 5, y: 4 },
    }).setOrigin(0.5));
    this.startOverlay = this.add.container(0, 0, children).setDepth(200);
    this.publishAccessibleStatus();
  }

  private isDifficultyUnlocked(difficulty: Difficulty): boolean {
    return DIFFICULTY_ORDER.indexOf(difficulty) <= DIFFICULTY_ORDER.indexOf(this.highestUnlockedDifficulty);
  }

  private selectDifficulty(difficulty: Difficulty): void {
    if (!this.isDifficultyUnlocked(difficulty) || difficulty === this.difficulty) return;
    this.difficulty = difficulty;
    this.music.playEffect('select');
    this.showStartScreen();
  }

  private beginGame(): void {
    if (this.gameStarted || this.countdownActive || this.settingsOverlay || this.awaitingWeaponSelection) return;
    this.startOverlay?.destroy(true);
    this.startOverlay = undefined;
    this.music.start('exploration');
    this.showWeaponSelection(() => this.startRunCountdown(() => this.finishGameStart()));
  }

  private showWeaponSelection(onSelected: () => void): void {
    const debugWeapon = new URLSearchParams(window.location.search).get('debugWeapon') as WeaponType | null;
    if (import.meta.env.DEV && debugWeapon && WEAPON_ORDER.includes(debugWeapon)) {
      this.applyWeaponSelection(debugWeapon);
      onSelected();
      return;
    }
    this.awaitingWeaponSelection = true;
    this.weaponSelectionCallback = onSelected;
    const children: Phaser.GameObjects.GameObject[] = [];
    children.push(this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x09070d, 0.97).setInteractive());
    children.push(this.add.text(GAME_WIDTH / 2, 92, '무기를 선택하세요', {
      fontSize: '42px', color: '#f7c86a', fontStyle: 'bold', stroke: '#3a1d2d', strokeThickness: 7,
      padding: { x: 12, y: 12 },
    }).setOrigin(0.5));
    children.push(this.add.text(GAME_WIDTH / 2, 143, '선택한 무기는 이번 회차의 기본 공격 방식과 능력치를 결정합니다.', {
      fontSize: '18px', color: '#cbbdce', padding: { x: 6, y: 6 },
    }).setOrigin(0.5));
    const cardXs = [350, 640, 930];
    WEAPON_ORDER.forEach((weapon, index) => {
      const definition = WEAPONS[weapon];
      const card = this.add.rectangle(cardXs[index], 360, 250, 360, 0x211a2a, 0.98)
        .setStrokeStyle(4, definition.color, 1).setInteractive({ useHandCursor: true });
      card.on('pointerover', () => card.setFillStyle(0x31243a, 1));
      card.on('pointerout', () => card.setFillStyle(0x211a2a, 0.98));
      card.on('pointerdown', () => this.selectWeapon(weapon));
      children.push(card);
      children.push(this.add.text(cardXs[index], 225, `${index + 1}`, {
        fontSize: '21px', color: '#fff3d4', backgroundColor: '#59405f', padding: { x: 10, y: 5 },
      }).setOrigin(0.5));
      children.push(this.add.text(cardXs[index], 285, definition.name, {
        fontSize: '26px', color: '#f7ead3', fontStyle: 'bold', padding: { x: 8, y: 8 },
      }).setOrigin(0.5));
      children.push(this.add.text(cardXs[index], 330, definition.description, {
        fontSize: '16px', color: '#c9becd', align: 'center', wordWrap: { width: 205 },
        padding: { x: 6, y: 6 },
      }).setOrigin(0.5));
      children.push(this.add.text(cardXs[index], 415,
        `공격력  ${definition.attackDamage}\n공격 간격  ${(definition.attackCooldown / 1000).toFixed(2)}초\n공격 범위  ${definition.attackRange}`, {
          fontSize: '18px', color: '#fff0d2', align: 'left', lineSpacing: 10,
          padding: { x: 8, y: 8 },
        }).setOrigin(0.5));
      const comparison = weapon === 'sword'
        ? '균형형'
        : weapon === 'spear'
          ? '검 대비 피해 약 1.3배 · 동일한 공격 속도'
          : '검 대비 피해 약 1.5배 · 공격 간격 1.7배';
      children.push(this.add.text(cardXs[index], 505, comparison, {
        fontSize: '14px', color: '#91e3bd', align: 'center', wordWrap: { width: 210 },
        padding: { x: 6, y: 6 },
      }).setOrigin(0.5));
    });
    children.push(this.add.text(GAME_WIDTH / 2, 585, '클릭하거나 숫자 1 · 2 · 3을 누르세요', {
      fontSize: '17px', color: '#a99caf', padding: { x: 6, y: 6 },
    }).setOrigin(0.5));
    this.weaponOverlay = this.add.container(0, 0, children).setDepth(205);
    this.publishAccessibleStatus();
  }

  private selectWeapon(weapon: WeaponType): void {
    if (!this.awaitingWeaponSelection) return;
    this.music.playEffect('select');
    this.applyWeaponSelection(weapon);
    this.awaitingWeaponSelection = false;
    this.weaponOverlay?.destroy(true);
    this.weaponOverlay = undefined;
    const onSelected = this.weaponSelectionCallback;
    this.weaponSelectionCallback = undefined;
    this.updateBuildText();
    this.updateHud();
    onSelected?.();
  }

  private applyWeaponSelection(weapon: WeaponType): void {
    this.weapon = weapon;
    this.resetTemporaryUpgrades();
    this.hp = this.maxHp;
    const definition = WEAPONS[weapon];
    this.player?.setTexture(definition.walkTexture, 0)
      .setDisplaySize(definition.displaySize, definition.displaySize)
      .setCircle(definition.bodyRadius, definition.bodyOffset, definition.bodyOffset);
  }

  private beginNewGameFromStart(): void {
    if (this.gameStarted || this.countdownActive || this.settingsOverlay) return;
    clearRogueliteProgress();
    this.hasSavedProgress = false;
    this.ashes = 0;
    this.permanentUpgradeLevels.clear();
    this.highestUnlockedDifficulty = 'easy';
    this.difficulty = 'easy';
    this.resetTemporaryUpgrades();
    this.hp = this.maxHp;
    this.updateBuildText();
    this.updateHud();
    this.beginGame();
  }

  private startRunCountdown(onComplete: () => void): void {
    if (this.countdownActive) return;
    this.countdownActive = true;
    this.countdownValue = 3;
    this.countdownText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, '3', {
      fontSize: '112px', color: '#ffd477', fontStyle: 'bold',
      stroke: '#3a1524', strokeThickness: 12, padding: { x: 18, y: 12 },
    }).setOrigin(0.5).setDepth(210);
    this.time.addEvent({
      delay: 1000,
      repeat: 2,
      callback: () => {
        this.countdownValue -= 1;
        if (this.countdownValue > 0) {
          this.countdownText?.setText(String(this.countdownValue)).setScale(1.18).setAlpha(1);
          this.tweens.add({ targets: this.countdownText, scale: 1, alpha: 0.72, duration: 420 });
          this.publishAccessibleStatus();
          return;
        }
        this.countdownActive = false;
        this.countdownValue = 0;
        this.countdownText?.destroy();
        this.countdownText = undefined;
        onComplete();
      },
    });
    this.publishAccessibleStatus();
  }

  private togglePause(): void {
    if (!this.gameStarted || this.countdownActive || this.hp <= 0 || this.runFinished || this.awaitingPermanentUpgrade) return;
    if (this.gamePaused) this.resumeGame();
    else this.pauseGame();
  }

  private pauseGame(): void {
    if (this.gamePaused) return;
    this.gamePaused = true;
    this.physics.world.pause();
    this.time.paused = true;
    this.tweens.pauseAll();
    this.anims.pauseAll();
    const children: Phaser.GameObjects.GameObject[] = [];
    children.push(this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x09070d, 0.88).setInteractive());
    children.push(this.add.text(GAME_WIDTH / 2, 205, '일시 정지', {
      fontSize: '48px', color: '#f7c86a', fontStyle: 'bold', stroke: '#3a1d2d', strokeThickness: 7,
      padding: { x: 10, y: 8 },
    }).setOrigin(0.5));
    const resumeButton = this.add.rectangle(GAME_WIDTH / 2, 335, 320, 62, 0x436b68, 1)
      .setStrokeStyle(3, 0x91e3bd, 1).setInteractive({ useHandCursor: true });
    resumeButton.on('pointerdown', () => this.resumeGame());
    children.push(resumeButton);
    children.push(this.add.text(GAME_WIDTH / 2, 335, '계속하기', {
      fontSize: '23px', color: '#e8fff3', fontStyle: 'bold', padding: { x: 6, y: 5 },
    }).setOrigin(0.5));
    const settingsButton = this.add.rectangle(GAME_WIDTH / 2, 430, 320, 62, 0x4b3856, 1)
      .setStrokeStyle(3, 0xbca5cb, 1).setInteractive({ useHandCursor: true });
    settingsButton.on('pointerdown', () => this.openSettings('pause'));
    children.push(settingsButton);
    children.push(this.add.text(GAME_WIDTH / 2, 430, '설정', {
      fontSize: '23px', color: '#f0e2f5', fontStyle: 'bold', padding: { x: 6, y: 5 },
    }).setOrigin(0.5));
    children.push(this.add.text(GAME_WIDTH / 2, 505, 'P 또는 ESC로 계속', {
      fontSize: '16px', color: '#a99caf', padding: { x: 4, y: 3 },
    }).setOrigin(0.5));
    this.pauseOverlay = this.add.container(0, 0, children).setDepth(220);
    this.publishAccessibleStatus();
  }

  private resumeGame(): void {
    if (!this.gamePaused) return;
    this.settingsOverlay?.destroy(true);
    this.settingsOverlay = undefined;
    this.pauseOverlay?.destroy(true);
    this.pauseOverlay = undefined;
    this.gamePaused = false;
    this.time.paused = false;
    this.physics.world.resume();
    this.tweens.resumeAll();
    this.anims.resumeAll();
    this.publishAccessibleStatus();
  }

  private openSettings(returnTo: 'start' | 'pause'): void {
    this.settingsReturnTo = returnTo;
    if (returnTo === 'start') this.startOverlay?.setVisible(false);
    else this.pauseOverlay?.setVisible(false);
    this.renderSettings();
  }

  private renderSettings(): void {
    this.settingsOverlay?.destroy(true);
    const children: Phaser.GameObjects.GameObject[] = [];
    children.push(this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x09070d, 0.96).setInteractive());
    children.push(this.add.text(GAME_WIDTH / 2, 170, '설정', {
      fontSize: '44px', color: '#f7c86a', fontStyle: 'bold', padding: { x: 9, y: 7 },
    }).setOrigin(0.5));
    const addVolumeRow = (label: string, y: number, key: 'musicVolume' | 'effectsVolume'): void => {
      const value = this.settings[key];
      const trackLeft = 560;
      const trackWidth = 160;
      children.push(this.add.text(455, y, label, {
        fontSize: '23px', color: '#e8dbe9', fontStyle: 'bold', padding: { x: 5, y: 4 },
      }).setOrigin(1, 0.5));
      const minus = this.add.rectangle(500, y, 54, 48, 0x49394f, 1).setStrokeStyle(2, 0xa893b1, 1).setInteractive({ useHandCursor: true });
      const plus = this.add.rectangle(780, y, 54, 48, 0x49394f, 1).setStrokeStyle(2, 0xa893b1, 1).setInteractive({ useHandCursor: true });
      minus.on('pointerdown', () => this.adjustVolume(key, -0.1));
      plus.on('pointerdown', () => this.adjustVolume(key, 0.1));
      children.push(minus, plus);
      children.push(this.add.text(500, y, '−', { fontSize: '28px', color: '#fff2ce' }).setOrigin(0.5));
      children.push(this.add.text(780, y, '+', { fontSize: '28px', color: '#fff2ce' }).setOrigin(0.5));
      children.push(this.add.rectangle(trackLeft, y, trackWidth, 18, 0x241c2a, 1)
        .setOrigin(0, 0.5).setStrokeStyle(2, 0x66556e, 1));
      if (value > 0) {
        children.push(this.add.rectangle(trackLeft, y, trackWidth * value, 14, 0x79c7c3, 1).setOrigin(0, 0.5));
      }
      children.push(this.add.text(640, y - 35, `${Math.round(value * 100)}%`, {
        fontSize: '17px', color: '#bfe8e1', fontStyle: 'bold', padding: { x: 3, y: 2 },
      }).setOrigin(0.5));
    };
    addVolumeRow('배경음악', 250, 'musicVolume');
    addVolumeRow('효과음', 350, 'effectsVolume');
    children.push(this.add.text(455, 460, 'J 타겟', {
      fontSize: '23px', color: '#e8dbe9', fontStyle: 'bold', padding: { x: 5, y: 4 },
    }).setOrigin(1, 0.5));
    const targetModeButton = this.add.rectangle(640, 460, 280, 52, this.settings.targetMode === 'auto' ? 0x436b68 : 0x49394f, 1)
      .setStrokeStyle(2, this.settings.targetMode === 'auto' ? 0x91e3bd : 0xa893b1, 1)
      .setInteractive({ useHandCursor: true });
    targetModeButton.on('pointerdown', () => this.toggleTargetMode());
    children.push(targetModeButton);
    children.push(this.add.text(640, 460,
      this.settings.targetMode === 'auto' ? '자동 · 가장 가까운 적' : '수동 · 마우스 방향', {
        fontSize: '19px', color: this.settings.targetMode === 'auto' ? '#e8fff3' : '#f0e2f5', fontStyle: 'bold',
      }).setOrigin(0.5));
    children.push(this.add.text(640, 505, '마우스 공격은 설정과 관계없이 커서 방향을 사용합니다.', {
      fontSize: '14px', color: '#a99caf',
    }).setOrigin(0.5));
    const closeButton = this.add.rectangle(GAME_WIDTH / 2, 585, 300, 56, 0x436b68, 1)
      .setStrokeStyle(3, 0x91e3bd, 1).setInteractive({ useHandCursor: true });
    closeButton.on('pointerdown', () => this.closeSettings());
    children.push(closeButton);
    children.push(this.add.text(GAME_WIDTH / 2, 585, '적용하고 돌아가기', {
      fontSize: '21px', color: '#e8fff3', fontStyle: 'bold', padding: { x: 5, y: 4 },
    }).setOrigin(0.5));
    this.settingsOverlay = this.add.container(0, 0, children).setDepth(240);
    this.publishAccessibleStatus();
  }

  private adjustVolume(key: 'musicVolume' | 'effectsVolume', delta: number): void {
    this.settings[key] = Math.round(Phaser.Math.Clamp(this.settings[key] + delta, 0, 1) * 100) / 100;
    this.music.setVolumes(this.settings.musicVolume, this.settings.effectsVolume);
    if (key === 'effectsVolume') this.music.playEffect('select');
    this.persistProgress();
    this.renderSettings();
  }

  private toggleTargetMode(): void {
    this.settings.targetMode = this.settings.targetMode === 'auto' ? 'manual' : 'auto';
    this.music.playEffect('select');
    this.persistProgress();
    this.renderSettings();
  }

  private closeSettings(): void {
    this.settingsOverlay?.destroy(true);
    this.settingsOverlay = undefined;
    if (this.settingsReturnTo === 'start') this.startOverlay?.setVisible(true);
    else this.pauseOverlay?.setVisible(true);
    this.publishAccessibleStatus();
  }

  private showPlayerStats(): void {
    if (this.statsOverlay || this.gamePaused || !this.gameStarted || this.hp <= 0 || this.runFinished) return;
    this.gamePaused = true;
    this.physics.world.pause();
    this.time.paused = true;
    this.tweens.pauseAll();
    this.anims.pauseAll();

    const children: Phaser.GameObjects.GameObject[] = [];
    children.push(this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x09070d, 0.9).setInteractive());
    children.push(this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 820, 570, 0x17131f, 0.98)
      .setStrokeStyle(3, 0x8d6ca8, 1));
    children.push(this.add.text(GAME_WIDTH / 2, 105, '플레이어 상태', {
      fontSize: '38px', color: '#f7c86a', fontStyle: 'bold', stroke: '#3a1d2d', strokeThickness: 6,
      padding: { x: 8, y: 6 },
    }).setOrigin(0.5));
    children.push(this.add.text(GAME_WIDTH / 2, 155,
      `${DIFFICULTY_LABELS[this.difficulty]}  ·  생명 ${this.hp} / ${this.maxHp}  ·  J 타겟 ${this.settings.targetMode === 'auto' ? '자동' : '수동'}`, {
        fontSize: '18px', color: '#91e3bd', fontStyle: 'bold',
      }).setOrigin(0.5));

    const signed = (value: number, digits = 0): string => `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
    const weaponBase = WEAPONS[this.weapon];
    const leftStats = [
      ['현재 무기', weaponBase.name, '회차 기본'],
      ['공격력', `${this.attackDamage}`, signed(this.attackDamage - weaponBase.attackDamage)],
      ['공격 간격', `${(this.attackCooldown / 1000).toFixed(2)}초`, `${((weaponBase.attackCooldown - this.attackCooldown) / 1000).toFixed(2)}초 감소`],
      ['공격 범위', `${Math.round(this.attackRange)}`, signed(this.attackRange - weaponBase.attackRange)],
      [this.weapon === 'spear' ? '직선 폭' : '부채꼴 각도', this.weapon === 'spear' ? '얇음' : `${Math.round(this.attackArcAngle * 2 * 180 / Math.PI)}°`, this.weapon === 'spear' ? '직선 판정' : signed((this.attackArcAngle - weaponBase.attackArcAngle) * 2 * 180 / Math.PI) + '°'],
      ['치명타 확률', `${Math.round(this.criticalChance * 100)}%`, signed(this.criticalChance * 100) + '%'],
    ];
    const rightStats = [
      ['최대 생명', `${this.maxHp}`, signed(this.maxHp - BASE_STATS.maxHp)],
      ['이동속도', `${Math.round(this.moveSpeed)}`, signed(this.moveSpeed - BASE_STATS.moveSpeed)],
      ['대시 대기시간', `${(this.dashCooldown / 1000).toFixed(2)}초`, `${((BASE_STATS.dashCooldown - this.dashCooldown) / 1000).toFixed(2)}초 감소`],
      ['대시·무적 시간', `${(this.dashDuration / 1000).toFixed(2)}초`, signed((this.dashDuration - BASE_STATS.dashDuration) / 1000, 2) + '초'],
      ['방 정리 회복', `${6 + this.roomRecovery}`, signed(this.roomRecovery)],
      ['피해 감소', `${Math.round(this.damageReduction * 100)}%`, signed(this.damageReduction * 100) + '%'],
    ];
    const addStatColumn = (x: number, title: string, values: string[][]): void => {
      children.push(this.add.text(x, 200, title, {
        fontSize: '21px', color: '#d9b6ff', fontStyle: 'bold',
      }).setOrigin(0.5));
      values.forEach(([label, current, increase], index) => {
        const y = 245 + index * 48;
        children.push(this.add.rectangle(x, y, 330, 39, 0x241d2b, 0.96).setStrokeStyle(1, 0x51425e, 0.9));
        children.push(this.add.text(x - 148, y, label, {
          fontSize: '16px', color: '#c9bccd',
        }).setOrigin(0, 0.5));
        children.push(this.add.text(x + 30, y, current, {
          fontSize: '17px', color: '#fff0d2', fontStyle: 'bold',
        }).setOrigin(0.5));
        children.push(this.add.text(x + 148, y, increase, {
          fontSize: '14px', color: '#91e3bd',
        }).setOrigin(1, 0.5));
      });
    };
    addStatColumn(430, '공격 능력', leftStats);
    addStatColumn(850, '생존·기동 능력', rightStats);

    const closeButton = this.add.rectangle(GAME_WIDTH / 2, 625, 260, 50, 0x51324a, 1)
      .setStrokeStyle(2, 0xf1c46b, 1).setInteractive({ useHandCursor: true });
    closeButton.on('pointerdown', () => this.closePlayerStats());
    children.push(closeButton);
    children.push(this.add.text(GAME_WIDTH / 2, 625, 'C / ESC · 돌아가기', {
      fontSize: '18px', color: '#ffe5a5', fontStyle: 'bold',
    }).setOrigin(0.5));
    this.statsOverlay = this.add.container(0, 0, children).setDepth(235);
    this.publishAccessibleStatus();
  }

  private closePlayerStats(): void {
    if (!this.statsOverlay) return;
    this.statsOverlay.destroy(true);
    this.statsOverlay = undefined;
    this.gamePaused = false;
    this.time.paused = false;
    this.physics.world.resume();
    this.tweens.resumeAll();
    this.anims.resumeAll();
    this.publishAccessibleStatus();
  }

  private finishGameStart(): void {
    this.gameStarted = true;
    this.player.setVisible(true);

    const debugParams = new URLSearchParams(window.location.search);
    const debugWindow = window as Window & { __debugDeathTriggered?: boolean; __debugRunSeeded?: boolean };
    const debugRunSeeded = Boolean(debugWindow.__debugRunSeeded);
    const requestedRoom = Number(debugParams.get('debugRoom'));
    const hasRequestedRoom = debugParams.has('debugRoom');
    const requestedRoomType = debugParams.get('debugRoomType') as RoomType | null;
    const requestedDifficulty = debugParams.get('debugDifficulty') as Difficulty | null;
    if (import.meta.env.DEV && !debugRunSeeded && requestedDifficulty && DIFFICULTY_ORDER.includes(requestedDifficulty)) {
      this.difficulty = requestedDifficulty;
    }
    const requestedTypeRoom = requestedRoomType ? this.rooms.findIndex((room) => room.type === requestedRoomType) : -1;
    const initialRoom = import.meta.env.DEV && !debugRunSeeded
      ? hasRequestedRoom && Number.isInteger(requestedRoom) && requestedRoom >= 0 && requestedRoom < this.rooms.length
        ? requestedRoom
        : requestedTypeRoom >= 0
          ? requestedTypeRoom
          : 0
      : 0;
    const debugAshes = Number(debugParams.get('debugAsh'));
    this.debugInvincible = import.meta.env.DEV && debugParams.get('debugInvincible') === '1';
    if (import.meta.env.DEV && !debugRunSeeded && Number.isFinite(debugAshes) && debugAshes > 0) this.ashes = Math.floor(debugAshes);
    this.startRoom(initialRoom);

    const debugBuild = import.meta.env.DEV && !debugRunSeeded && debugParams.get('debugBuild') === '1';
    const debugUpgrade = import.meta.env.DEV && !debugRunSeeded && debugParams.get('debugUpgrade') === '1';
    const debugHp = Number(debugParams.get('debugHp'));
    const debugDeath = import.meta.env.DEV && debugParams.get('debugDeath') === '1' && !debugWindow.__debugDeathTriggered;
    const debugAttackPreview = import.meta.env.DEV && debugParams.get('debugAttackPreview') === '1';
    if (debugBuild) {
      const demoBuild: Array<[UpgradeId, number]> = [
        ['roomRecovery', 2], ['dashDuration', 1], ['maxHealth', 2], ['attackRange', 1], ['attackPower', 1],
      ];
      demoBuild.forEach(([id, level]) => {
        this.acquiredUpgrades.set(id, level);
        for (let stack = 0; stack < level; stack += 1) this.applyUpgrade(id);
      });
      this.updateBuildText();
      this.updateHud();
    }
    if (import.meta.env.DEV && debugParams.has('debugHp') && Number.isFinite(debugHp)) {
      this.hp = Phaser.Math.Clamp(Math.round(debugHp), 1, this.maxHp);
      this.updateHud();
    }
    if (debugUpgrade) {
      this.time.delayedCall(120, () => {
        this.enemies.clear(true, true);
        this.completeCurrentRoom();
      });
    }
    if (debugAttackPreview) {
      this.time.delayedCall(250, () => this.showAttackVisual(0, 1200));
    }
    if (debugDeath) {
      debugWindow.__debugDeathTriggered = true;
      this.time.delayedCall(120, () => this.damagePlayer(999));
    }
    const debugBossPhase = Number(debugParams.get('debugBossPhase'));
    if (import.meta.env.DEV && this.rooms[initialRoom].type === 'boss' && [2, 3].includes(debugBossPhase)) {
      this.time.delayedCall(80, () => {
        const boss = this.getActiveBoss();
        if (!boss) return;
        const phase = debugBossPhase as 2 | 3;
        boss.hp = Math.round(boss.maxHp * (phase === 2 ? 0.55 : 0.25));
        this.handleBossPhaseTransition(boss, phase);
        this.updateBossHud();
        this.publishAccessibleStatus();
      });
    }
    if (import.meta.env.DEV && !debugRunSeeded && (
      debugParams.has('debugRoom') || debugParams.has('debugRoomType') || debugParams.has('debugAsh')
      || debugBuild || debugUpgrade || debugParams.has('debugBossPhase')
    )) debugWindow.__debugRunSeeded = true;
  }

  update(time: number): void {
    if (!this.gameStarted || this.gamePaused || this.hp <= 0 || this.runFinished) return;
    if (this.awaitingUpgrade || this.awaitingSpecial || this.awaitingMidBossReward) {
      this.player.setVelocity(0);
      this.playerAttackingUntil = 0;
      this.player.stop().setTexture(WEAPONS[this.weapon].walkTexture, 0);
      return;
    }

    const direction = new Phaser.Math.Vector2(
      Number(this.cursors.right.isDown || this.wasd.right.isDown) - Number(this.cursors.left.isDown || this.wasd.left.isDown),
      Number(this.cursors.down.isDown || this.wasd.down.isDown) - Number(this.cursors.up.isDown || this.wasd.up.isDown),
    ).normalize();
    const dashStarted = Phaser.Input.Keyboard.JustDown(this.cursors.space) && time - this.lastDashAt >= this.dashCooldown;
    if (dashStarted) {
      this.lastDashAt = time;
      this.invulnerableUntil = time + this.dashDuration;
      this.playerKnockbackUntil = 0;
      this.music.playEffect('dash');
      this.player.setTint(0x9de8ff);
      this.time.delayedCall(this.dashDuration, () => this.player.active && this.player.clearTint());
    }
    const dashing = time < this.invulnerableUntil && time - this.lastDashAt < 210;
    const speed = dashing ? this.dashSpeed : this.moveSpeed;
    if (time >= this.playerKnockbackUntil || dashStarted) this.player.setVelocity(direction.x * speed, direction.y * speed);
    const walking = direction.lengthSq() > 0 && time >= this.playerKnockbackUntil;
    const attacking = time < this.playerAttackingUntil;
    if (!attacking && walking) this.player.play(WEAPONS[this.weapon].walkAnimation, true);
    else if (!attacking) this.player.stop().setTexture(WEAPONS[this.weapon].walkTexture, 0);
    if (attacking) this.updateAttackVisualPosition();

    const pointer = this.input.activePointer;
    // 전신 캐릭터 이미지는 조준 각도로 회전시키지 않고 좌우 방향만 전환한다.
    this.player.setRotation(0).setFlipX(pointer.worldX < this.player.x);
    this.updateEnemies(time);
    this.updateBossWallVolley(time);
    this.updateBossHud();
    this.removeOutOfBoundsProjectiles();

    const pointerAttacking = pointer.leftButtonDown();
    if ((pointerAttacking || this.attackKey.isDown) && time - this.lastAttackAt >= this.attackCooldown) {
      this.attack(pointerAttacking ? 'mouse' : 'keyboard');
    }

    if (this.enemies.countActive(true) === 0 && !this.roomCleared && !this.transitioning && this.rooms[this.roomIndex].type !== 'healing' && this.rooms[this.roomIndex].type !== 'shop') {
      this.completeCurrentRoom();
    }

    if (this.roomCleared && !this.transitioning && time >= this.transitionLockUntil) {
      this.checkExitCollision();
    }
  }

  private startRoom(index: number, enteredFrom?: Direction): void {
    const room = this.rooms[index];
    this.music.setMode(room.type === 'boss' || room.type === 'midboss' ? 'boss' : 'exploration');
    this.roomIndex = index;
    this.roomCleared = this.clearedRooms.has(index) || this.usedSpecialRooms.has(index);
    this.transitioning = false;
    this.transitionLockUntil = this.time.now + 800;
    this.enemies.clear(true, true);
    this.enemyProjectiles.clear(true, true);
    this.hideBossHud();
    this.hideAllExits();
    this.positionPlayerAtEntrance(enteredFrom);
    this.drawArena(room.accent);
    this.nextBossWallVolleyAt = this.roomUsesWallVolley(room) ? this.time.now + 1800 : Number.POSITIVE_INFINITY;
    this.bossWallVolleyFlipped = false;
    this.clearBossWallTelegraph();
    this.clearMidBossTelegraph();

    this.visitedRooms.add(index);
    this.revealedRooms.add(index);
    const roomLabel: Record<RoomType, string> = {
      combat: `방 ${index + 1}/${this.rooms.length}`, healing: '회복방', shop: '상점방',
      midboss: '중간 보스방', boss: '보스방',
    };
    this.roomText.setText(`${DIFFICULTY_LABELS[this.difficulty]}  ·  ${roomLabel[room.type]}  ·  ${room.name}`);

    if (this.roomCleared && room.type !== 'boss') {
      this.bannerText.setText('정화된 방\n이동할 방향을 선택하세요').setAlpha(1);
      this.showAvailableExits(false);
    } else if (room.type === 'healing' || room.type === 'shop') {
      this.bannerText.setText(`${room.name}\n${room.description}`).setAlpha(1);
      this.showSpecialRoom(room.type);
    } else {
      this.spawnRoomEnemies(room.enemies);
      this.bannerText.setText(`${room.name}\n${room.description}`).setAlpha(1);
      this.time.delayedCall(1600, () => {
        if (!this.roomCleared && this.hp > 0) this.bannerText.setText('');
      });
    }
    this.updateHud();
  }

  private positionPlayerAtEntrance(enteredFrom?: Direction): void {
    const positions: Record<Direction, [number, number]> = {
      up: [GAME_WIDTH / 2, 155],
      down: [GAME_WIDTH / 2, GAME_HEIGHT - 155],
      left: [150, GAME_HEIGHT / 2],
      right: [GAME_WIDTH - 150, GAME_HEIGHT / 2],
    };
    const [x, y] = enteredFrom ? positions[enteredFrom] : [170, GAME_HEIGHT / 2];
    this.player.setPosition(x, y).setVelocity(0).clearTint().setAlpha(1).stop().setTexture('player', 0);
    this.playerAttackingUntil = 0;
    this.playerKnockbackUntil = 0;
  }

  private spawnRoomEnemies(kinds: EnemyKind[]): void {
    const availablePositions: Array<[number, number]> = [
      [360, 130], [520, 150], [700, 130], [880, 150], [1080, 180],
      [360, 280], [560, 290], [760, 275], [960, 300], [1110, 360],
      [350, 440], [540, 470], [740, 455], [930, 475], [1080, 535],
      [460, 580], [680, 570], [870, 565],
    ];
    kinds.forEach((kind, index) => {
      const minimumDistance = kind === 'boss' || kind === 'midboss' ? 260 : MIN_ENEMY_SPAWN_DISTANCE;
      let position: [number, number];
      if (kind === 'boss' || kind === 'midboss') {
        position = [850, GAME_HEIGHT / 2];
      } else {
        let positionIndex = availablePositions.findIndex(([candidateX, candidateY]) => (
          Phaser.Math.Distance.Between(this.player.x, this.player.y, candidateX, candidateY) >= minimumDistance
        ));
        if (positionIndex < 0) {
          positionIndex = availablePositions.reduce((farthestIndex, [candidateX, candidateY], candidateIndex) => {
            const farthest = availablePositions[farthestIndex];
            const farthestDistance = Phaser.Math.Distance.Between(this.player.x, this.player.y, farthest[0], farthest[1]);
            const candidateDistance = Phaser.Math.Distance.Between(this.player.x, this.player.y, candidateX, candidateY);
            return candidateDistance > farthestDistance ? candidateIndex : farthestIndex;
          }, 0);
        }
        position = availablePositions.splice(positionIndex, 1)[0];
      }
      const [x, y] = position;
      const enemy = this.enemies.create(x, y, kind) as Enemy;
      const displaySize: Record<EnemyKind, number> = { stalker: 62, brute: 81, archer: 66, midboss: 98, boss: 113 };
      enemy.setDisplaySize(displaySize[kind], displaySize[kind]);
      enemy.kind = kind;
      enemy.attackPending = false;
      enemy.bossPhase = kind === 'boss' ? 1 : undefined;
      enemy.phaseInvulnerableUntil = 0;
      enemy.cornerDashWindupUntil = 0;
      enemy.cornerDashUntil = 0;
      enemy.nextCornerDashAt = 0;
      enemy.lockedAttackAngle = 0;
      enemy.lastHitAt = -1000;
      enemy.nextActionAt = this.time.now + 650 + index * 140;
      enemy.strafeDirection = index % 2 === 0 ? 1 : -1;

      if (kind === 'stalker') {
        enemy.maxHp = 52; enemy.speed = 138; enemy.hitRadius = 17; enemy.setCircle(72, 56, 56);
      } else if (kind === 'brute') {
        enemy.maxHp = 168; enemy.speed = 88; enemy.hitRadius = 25; enemy.setCircle(78, 50, 50);
      } else if (kind === 'archer') {
        enemy.maxHp = 68; enemy.speed = 88; enemy.hitRadius = 19; enemy.setCircle(73, 55, 55);
      } else if (kind === 'midboss') {
        enemy.maxHp = 800; enemy.speed = 205; enemy.hitRadius = 31; enemy.setCircle(78, 50, 50);
      } else {
        enemy.maxHp = BOSS_HEALTH_BY_DIFFICULTY[this.difficulty]; enemy.speed = 76; enemy.hitRadius = 35; enemy.setCircle(78, 50, 50);
      }
      enemy.hp = enemy.maxHp;
      const isMajorEnemy = kind === 'boss' || kind === 'midboss';
      enemy.setCollideWorldBounds(true).setBounce(0.15).setDepth(isMajorEnemy ? 5 : 4);
      this.applyCharacterOutline(enemy, kind === 'boss' ? 0xff704f : kind === 'midboss' ? 0xb783ff : 0x160f1c, isMajorEnemy ? 1.5 : 1.1);
    });
  }

  private updateEnemies(time: number): void {
    this.enemies.getChildren().forEach((child) => {
      const enemy = child as Enemy;
      if (!enemy.active) return;
      const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, this.player.x, this.player.y);
      const distance = Phaser.Math.Distance.Between(enemy.x, enemy.y, this.player.x, this.player.y);

      if (enemy.kind === 'boss' && time < (enemy.phaseInvulnerableUntil ?? 0)) {
        enemy.setVelocity(0).stop().setFrame(0);
        return;
      }

      if (enemy.kind === 'archer') {
        this.moveRangedEnemy(enemy, angle, distance);
        if (time >= enemy.nextActionAt && distance < 490) {
          enemy.nextActionAt = time + 1500;
          this.fireEnemyProjectile(enemy, angle, 10, 285);
        }
      } else if (enemy.kind === 'midboss') {
        if (enemy.attackPending) {
          enemy.setVelocity(0);
        } else if (distance > MIDBOSS_ATTACK_RANGE - 12) {
          this.physics.velocityFromRotation(angle, enemy.speed, enemy.body!.velocity);
        } else if (time >= enemy.nextActionAt) {
          this.queueMidBossAttack(enemy, time, angle);
        } else {
          enemy.setVelocity(0);
        }
      } else if (enemy.kind === 'boss') {
        const escapingCorner = this.moveBossOutOfCorner(enemy, time);
        if (!escapingCorner) {
          this.moveRangedEnemy(enemy, angle, distance, 285);
          if (enemy.attackPending) this.bossWarningCircle.setPosition(enemy.x, enemy.y);
          if (time >= enemy.nextActionAt && distance < 560 && !enemy.attackPending) this.queueBossAttack(enemy, time);
        }
      } else {
        this.physics.velocityFromRotation(angle, enemy.speed, enemy.body!.velocity);
      }
      const moving = enemy.body!.velocity.lengthSq() > 16;
      if (enemy.kind === 'midboss' && enemy.attackPending) {
        if (enemy.anims.currentAnim?.key !== 'midboss-attack') enemy.play('midboss-attack');
      } else if (moving) enemy.play(`${enemy.kind}-walk`, true);
      else enemy.stop().setTexture(enemy.kind).setFrame(0);
      enemy.setFlipX(this.player.x < enemy.x);
    });
  }

  private getActiveBoss(): Enemy | undefined {
    return this.enemies.getChildren().find((child) => {
      const enemy = child as Enemy;
      return enemy.active && enemy.kind === 'boss';
    }) as Enemy | undefined;
  }

  private getActiveMidBoss(): Enemy | undefined {
    return this.enemies.getChildren().find((child) => {
      const enemy = child as Enemy;
      return enemy.active && enemy.kind === 'midboss';
    }) as Enemy | undefined;
  }

  private queueMidBossAttack(midboss: Enemy, time: number, angle: number): void {
    midboss.attackPending = true;
    midboss.lockedAttackAngle = angle;
    midboss.nextActionAt = time + MIDBOSS_ATTACK_WINDUP + MIDBOSS_ATTACK_COOLDOWN;
    midboss.setVelocity(0).setTint(0xc89cff);
    midboss.play('midboss-attack', true);
    this.drawMidBossAttackArc(midboss, angle, 0x9f68e8, 0.24);
    this.midBossWarningText
      .setText('반월 참격 예고 · 대시로 회피하세요')
      .setVisible(true)
      .setAlpha(1);
    this.tweens.killTweensOf(this.midBossTelegraphGraphics);
    this.tweens.add({
      targets: this.midBossTelegraphGraphics,
      alpha: { from: 0.35, to: 1 },
      duration: 150,
      yoyo: true,
      repeat: 2,
    });

    this.time.delayedCall(MIDBOSS_ATTACK_WINDUP, () => {
      if (!midboss.active || !midboss.attackPending || this.hp <= 0 || this.runFinished
        || this.rooms[this.roomIndex].type !== 'midboss') {
        this.clearMidBossTelegraph();
        return;
      }
      const lockedAngle = midboss.lockedAttackAngle ?? angle;
      const playerDistance = Phaser.Math.Distance.Between(midboss.x, midboss.y, this.player.x, this.player.y);
      const playerAngle = Phaser.Math.Angle.Between(midboss.x, midboss.y, this.player.x, this.player.y);
      const angleDelta = Math.abs(Phaser.Math.Angle.Wrap(playerAngle - lockedAngle));
      this.drawMidBossAttackArc(midboss, lockedAngle, 0xe8bdff, 0.62);
      this.playMidBossSwingEffect(midboss, lockedAngle);
      this.cameras.main.shake(120, 0.006);
      if (playerDistance <= MIDBOSS_ATTACK_RANGE + 20 && angleDelta <= Math.PI / 2) this.damagePlayer(26);
      midboss.attackPending = false;
      midboss.clearTint();
      midboss.setTexture('midboss', 0);
      this.time.delayedCall(380, () => this.clearMidBossTelegraph());
    });
  }

  private drawMidBossAttackArc(midboss: Enemy, angle: number, color: number, alpha: number): void {
    this.midBossTelegraphGraphics.clear().setAlpha(1);
    this.midBossTelegraphGraphics.fillStyle(color, alpha).lineStyle(4, color, 0.95);
    this.midBossTelegraphGraphics.beginPath();
    this.midBossTelegraphGraphics.moveTo(midboss.x, midboss.y);
    this.midBossTelegraphGraphics.arc(
      midboss.x,
      midboss.y,
      MIDBOSS_ATTACK_RANGE,
      angle - Math.PI / 2,
      angle + Math.PI / 2,
      false,
    );
    this.midBossTelegraphGraphics.closePath().fillPath().strokePath();
  }

  private playMidBossSwingEffect(midboss: Enemy, angle: number): void {
    this.midBossSwingTween?.stop();
    this.tweens.killTweensOf(this.midBossSwingGraphics);
    this.midBossSwingGraphics.clear().setPosition(midboss.x, midboss.y).setRotation(angle).setAlpha(1);
    this.midBossSwingTween = this.tweens.addCounter({
      from: -Math.PI / 2,
      to: Math.PI / 2,
      duration: 250,
      ease: 'Cubic.easeOut',
      onUpdate: (tween) => {
        const sweepAngle = tween.getValue() ?? -Math.PI / 2;
        const graphics = this.midBossSwingGraphics;
        graphics.clear();
        [0, 1, 2].forEach((trail) => {
          graphics.lineStyle(12 - trail * 3, trail === 0 ? 0xf4d6ff : 0xb96cff, 0.92 - trail * 0.22);
          graphics.beginPath();
          graphics.arc(0, 0, MIDBOSS_ATTACK_RANGE - trail * 10, -Math.PI / 2, sweepAngle, false);
          graphics.strokePath();
        });
        graphics.lineStyle(7, 0xffffff, 0.95);
        graphics.lineBetween(
          Math.cos(sweepAngle) * 54,
          Math.sin(sweepAngle) * 54,
          Math.cos(sweepAngle) * (MIDBOSS_ATTACK_RANGE + 14),
          Math.sin(sweepAngle) * (MIDBOSS_ATTACK_RANGE + 14),
        );
      },
      onComplete: () => {
        this.tweens.add({
          targets: this.midBossSwingGraphics,
          alpha: 0,
          duration: 120,
          onComplete: () => this.midBossSwingGraphics.clear().setAlpha(1),
        });
      },
    });
  }

  private clearMidBossTelegraph(): void {
    if (!this.midBossTelegraphGraphics) return;
    this.tweens.killTweensOf(this.midBossTelegraphGraphics);
    this.midBossSwingTween?.stop();
    this.midBossSwingTween = undefined;
    this.tweens.killTweensOf(this.midBossSwingGraphics);
    this.midBossTelegraphGraphics.clear().setAlpha(1);
    this.midBossSwingGraphics?.clear().setAlpha(1).setPosition(0, 0).setRotation(0);
    this.midBossWarningText?.setVisible(false).setText('').setAlpha(1);
  }

  private moveBossOutOfCorner(boss: Enemy, time: number): boolean {
    if (time < (boss.cornerDashUntil ?? 0)) {
      const centerAngle = Phaser.Math.Angle.Between(boss.x, boss.y, GAME_WIDTH / 2, GAME_HEIGHT / 2);
      this.physics.velocityFromRotation(centerAngle, BOSS_CORNER_DASH_SPEED, boss.body!.velocity);
      return true;
    }

    if ((boss.cornerDashWindupUntil ?? 0) > 0) {
      if (time < (boss.cornerDashWindupUntil ?? 0)) {
        boss.setVelocity(0);
        this.drawBossCornerDashWarning(boss);
        return true;
      }
      boss.cornerDashWindupUntil = 0;
      this.clearBossCornerDashWarning();
      boss.cornerDashUntil = time + BOSS_CORNER_DASH_DURATION;
      boss.nextCornerDashAt = time + BOSS_CORNER_DASH_COOLDOWN;
      this.music.playEffect('dash');
      this.time.delayedCall(BOSS_CORNER_DASH_DURATION, () => boss.active && boss.clearTint());
      const centerAngle = Phaser.Math.Angle.Between(boss.x, boss.y, GAME_WIDTH / 2, GAME_HEIGHT / 2);
      this.physics.velocityFromRotation(centerAngle, BOSS_CORNER_DASH_SPEED, boss.body!.velocity);
      return true;
    }

    if (boss.attackPending || time < (boss.nextCornerDashAt ?? 0)) return false;
    const nearHorizontalEdge = boss.x <= 182 || boss.x >= GAME_WIDTH - 182;
    const nearVerticalEdge = boss.y <= 203 || boss.y >= GAME_HEIGHT - 203;
    if (!nearHorizontalEdge || !nearVerticalEdge) return false;

    boss.cornerDashWindupUntil = time + BOSS_CORNER_DASH_WINDUP;
    boss.setVelocity(0);
    boss.setTint(0xffd27a);
    this.drawBossCornerDashWarning(boss);
    this.tweens.killTweensOf(this.bossCornerDashWarningGraphics);
    this.bossCornerDashWarningGraphics.setAlpha(0.35);
    this.tweens.add({
      targets: this.bossCornerDashWarningGraphics,
      alpha: 1,
      duration: 90,
      yoyo: true,
      repeat: 2,
    });
    return true;
  }

  private drawBossCornerDashWarning(boss: Enemy): void {
    const angle = Phaser.Math.Angle.Between(boss.x, boss.y, GAME_WIDTH / 2, GAME_HEIGHT / 2);
    const endX = boss.x + Math.cos(angle) * 105;
    const endY = boss.y + Math.sin(angle) * 105;
    const arrowSize = 13;
    this.bossCornerDashWarningGraphics.clear().setVisible(true);
    this.bossCornerDashWarningGraphics.fillStyle(0xffc857, 0.15).lineStyle(4, 0xffd778, 0.95);
    this.bossCornerDashWarningGraphics.fillCircle(boss.x, boss.y, 62).strokeCircle(boss.x, boss.y, 62);
    this.bossCornerDashWarningGraphics.lineBetween(
      boss.x + Math.cos(angle) * 48,
      boss.y + Math.sin(angle) * 48,
      endX,
      endY,
    );
    this.bossCornerDashWarningGraphics.fillStyle(0xffe29a, 1).fillTriangle(
      endX,
      endY,
      endX + Math.cos(angle + 2.5) * arrowSize,
      endY + Math.sin(angle + 2.5) * arrowSize,
      endX + Math.cos(angle - 2.5) * arrowSize,
      endY + Math.sin(angle - 2.5) * arrowSize,
    );
  }

  private clearBossCornerDashWarning(): void {
    if (!this.bossCornerDashWarningGraphics) return;
    this.tweens.killTweensOf(this.bossCornerDashWarningGraphics);
    this.bossCornerDashWarningGraphics.clear().setVisible(false).setAlpha(1);
  }

  private getBossPhase(boss: Enemy): 1 | 2 | 3 {
    const healthRatio = boss.hp / boss.maxHp;
    if (healthRatio > 0.65) return 1;
    if (this.difficulty === 'easy') return 2;
    if (healthRatio > 0.3) return 2;
    return 3;
  }

  private queueBossAttack(boss: Enemy, time: number): void {
    const phase = this.getBossPhase(boss);
    const patterns = {
      1: { name: '삼연 화염', warning: '3방향 탄막', windup: 520, interval: 1600 },
      2: { name: '부채꼴 폭발', warning: '5방향 탄막', windup: 450, interval: 1400 },
      3: { name: '재의 고리', warning: '전방위 탄막', windup: 660, interval: 1200 },
    } as const;
    const pattern = patterns[phase];
    const lockedAngle = Phaser.Math.Angle.Between(boss.x, boss.y, this.player.x, this.player.y);
    boss.attackPending = true;
    boss.nextActionAt = time + pattern.interval;
    this.bossTelegraphActive = true;
    this.bossWarningCircle.setPosition(boss.x, boss.y).setScale(0.65).setAlpha(1).setVisible(true);
    this.bossWarningText.setText(`공격 예고 · ${pattern.name}\n${pattern.warning}`).setVisible(true);
    this.drawBossAttackGuide(boss, lockedAngle, phase);
    this.publishAccessibleStatus();
    this.tweens.killTweensOf(this.bossWarningCircle);
    this.tweens.add({
      targets: this.bossWarningCircle,
      scale: { from: 0.65, to: phase === 3 ? 1.55 : 1.15 },
      alpha: { from: 1, to: 0.35 },
      duration: pattern.windup,
    });

    this.time.delayedCall(pattern.windup, () => {
      if (!boss.active || !boss.attackPending || this.hp <= 0 || this.runFinished || this.rooms[this.roomIndex].type !== 'boss') {
        this.clearBossTelegraph();
        return;
      }
      if (phase === 1) {
        [-0.28, 0, 0.28].forEach((offset) => this.fireEnemyProjectile(boss, lockedAngle + offset, 14, 330));
      } else if (phase === 2) {
        [-0.48, -0.24, 0, 0.24, 0.48].forEach((offset) => this.fireEnemyProjectile(boss, lockedAngle + offset, 14, 350));
      } else {
        for (let shot = 0; shot < 10; shot += 1) {
          this.fireEnemyProjectile(boss, lockedAngle + shot * Math.PI * 2 / 10, 16, 370);
        }
      }
      boss.attackPending = false;
      this.cameras.main.shake(phase === 3 ? 130 : 80, phase === 3 ? 0.006 : 0.003);
      this.clearBossTelegraph();
    });
  }

  private drawBossAttackGuide(boss: Enemy, angle: number, phase: 1 | 2 | 3): void {
    const offsets = phase === 1
      ? [-0.28, 0, 0.28]
      : phase === 2
        ? [-0.48, -0.24, 0, 0.24, 0.48]
        : Array.from({ length: 10 }, (_, index) => index * Math.PI * 2 / 10);
    this.bossTelegraphGraphics.clear().lineStyle(4, phase === 3 ? 0xffb06b : 0xff7185, 0.58);
    offsets.forEach((offset) => {
      const guideAngle = angle + offset;
      const length = phase === 3 ? 340 : 560;
      this.bossTelegraphGraphics.lineBetween(
        boss.x,
        boss.y,
        boss.x + Math.cos(guideAngle) * length,
        boss.y + Math.sin(guideAngle) * length,
      );
    });
  }

  private handleBossPhaseTransition(boss: Enemy, phase: 2 | 3): void {
    const transitionStartedAt = this.time.now;
    boss.bossPhase = phase;
    boss.attackPending = false;
    boss.phaseInvulnerableUntil = transitionStartedAt + 1000;
    boss.nextActionAt = transitionStartedAt + 1100;
    this.music.playEffect('bossPhase');
    boss.setVelocity(0).setTint(phase === 3 ? 0xff9a64 : 0xff6f81);
    const knockback = new Phaser.Math.Vector2(this.player.x - boss.x, this.player.y - boss.y);
    if (knockback.lengthSq() === 0) knockback.set(-1, 0);
    knockback.normalize().scale(820);
    this.playerKnockbackUntil = transitionStartedAt + 420;
    this.player.setVelocity(knockback.x, knockback.y);
    this.clearBossTelegraph();
    const detail = phase === 2 ? '1초 무적 · 부채꼴 탄막 강화' : '1초 무적 · 최종 각성 · 전방위 탄막';
    this.bossPhaseText.setText(`${phase}단계 각성\n${detail}`).setVisible(true).setAlpha(1).setScale(0.82);
    this.tweens.killTweensOf(this.bossPhaseText);
    this.tweens.add({
      targets: this.bossPhaseText,
      scale: 1.08,
      alpha: { from: 1, to: 0.2 },
      duration: 1050,
      ease: 'Cubic.easeOut',
      onComplete: () => this.bossPhaseText.setVisible(false).setAlpha(1).setScale(1),
    });
    this.cameras.main.flash(180, phase === 3 ? 255 : 210, 70, 70, false);
    this.cameras.main.shake(260, phase === 3 ? 0.012 : 0.008);
    this.time.delayedCall(1000, () => boss.active && boss.clearTint());
  }

  private updateBossHud(): void {
    const boss = this.getActiveBoss();
    const midboss = this.getActiveMidBoss();
    this.bossHudGraphics.clear();
    if (midboss && this.rooms[this.roomIndex].type === 'midboss' && this.gameStarted) {
      const ratio = Phaser.Math.Clamp(midboss.hp / midboss.maxHp, 0, 1);
      const barX = 410;
      const barY = 66;
      const barWidth = 460;
      this.bossHudGraphics.fillStyle(0x120b12, 0.96).fillRoundedRect(barX - 4, barY - 4, barWidth + 8, 22, 7);
      this.bossHudGraphics.fillStyle(0x9f68e8, 1).fillRoundedRect(barX, barY, barWidth * ratio, 14, 5);
      this.bossHealthText
        .setText(`균열의 파수꾼  ${Math.max(0, Math.ceil(midboss.hp))} / ${midboss.maxHp}`)
        .setColor('#e3c9ff')
        .setVisible(true);
      return;
    }
    if (!boss || this.rooms[this.roomIndex].type !== 'boss' || !this.gameStarted) {
      this.bossHealthText.setVisible(false);
      return;
    }
    const phase = this.getBossPhase(boss);
    const ratio = Phaser.Math.Clamp(boss.hp / boss.maxHp, 0, 1);
    const barX = 350;
    const barY = 66;
    const barWidth = 580;
    this.bossHudGraphics.fillStyle(0x120b12, 0.96).fillRoundedRect(barX - 4, barY - 4, barWidth + 8, 22, 7);
    this.bossHudGraphics.fillStyle(phase === 1 ? 0xcc4f62 : phase === 2 ? 0xe16b4f : 0xf29a3f, 1)
      .fillRoundedRect(barX, barY, barWidth * ratio, 14, 5);
    this.bossHealthText
      .setText(`화로의 수문장  ${Math.max(0, Math.ceil(boss.hp))} / ${boss.maxHp}  ·  ${phase}단계`)
      .setColor('#ffd6d9')
      .setVisible(true);
  }

  private clearBossTelegraph(): void {
    this.bossTelegraphActive = false;
    this.bossTelegraphGraphics.clear();
    this.clearBossCornerDashWarning();
    this.tweens.killTweensOf(this.bossWarningCircle);
    this.bossWarningCircle.setVisible(false).setScale(1).setAlpha(1);
    this.bossWarningText.setVisible(false).setText('');
    this.publishAccessibleStatus();
  }

  private hideBossHud(): void {
    if (!this.bossHudGraphics) return;
    this.bossHudGraphics.clear();
    this.bossHealthText.setVisible(false);
    this.bossPhaseText.setVisible(false);
    this.clearBossTelegraph();
    this.clearBossWallTelegraph();
  }

  private moveRangedEnemy(enemy: Enemy, angle: number, distance: number, preferredDistance = 275): void {
    if (distance > preferredDistance + 55) {
      this.physics.velocityFromRotation(angle, enemy.speed, enemy.body!.velocity);
    } else if (distance < preferredDistance - 55) {
      this.physics.velocityFromRotation(angle + Math.PI, enemy.speed, enemy.body!.velocity);
    } else {
      this.physics.velocityFromRotation(angle + enemy.strafeDirection * Math.PI / 2, enemy.speed * 0.62, enemy.body!.velocity);
    }
  }

  private fireEnemyProjectile(enemy: Enemy, angle: number, damage: number, speed: number): void {
    const isBossProjectile = enemy.kind === 'boss';
    const texture = isBossProjectile ? 'fireball' : 'iceArrow';
    const projectile = this.enemyProjectiles.create(enemy.x, enemy.y, texture, 0) as EnemyProjectile;
    projectile.damage = damage;
    projectile.source = 'enemy';
    projectile.setRotation(angle).setDepth(6);
    if (isBossProjectile) {
      projectile.setDisplaySize(48, 48).setCircle(76, 52, 52).play('fireball-fly');
    } else {
      projectile.setDisplaySize(54, 22).setSize(150, 82).setOffset(53, 87).play('iceArrow-fly');
    }
    this.physics.velocityFromRotation(angle, speed, projectile.body!.velocity);
    enemy.setTint(0xc5fbff);
    this.time.delayedCall(90, () => enemy.active && enemy.clearTint());
    this.time.delayedCall(3200, () => projectile.active && projectile.destroy());
  }

  private updateBossWallVolley(time: number): void {
    const room = this.rooms[this.roomIndex];
    if (!this.roomUsesWallVolley(room) || this.roomCleared || this.pendingBossWallVolley || time < this.nextBossWallVolleyAt) return;
    const boss = this.getActiveBoss();
    if (boss && time < (boss.phaseInvulnerableUntil ?? 0)) return;
    if (this.enemies.countActive(true) === 0) return;
    this.pendingBossWallVolley = true;
    this.pendingBossWallVolleyFlipped = this.bossWallVolleyFlipped;
    this.nextBossWallVolleyAt = Number.POSITIVE_INFINITY;
    this.drawBossWallTelegraph(this.pendingBossWallVolleyFlipped);
    this.time.delayedCall(BOSS_WALL_TELEGRAPH_DURATION, () => {
      if (!this.pendingBossWallVolley || !this.roomUsesWallVolley(this.rooms[this.roomIndex])
        || this.roomCleared || this.hp <= 0 || this.runFinished) {
        this.clearBossWallTelegraph();
        return;
      }
      this.fireBossWallVolley(this.pendingBossWallVolleyFlipped);
      this.bossWallVolleyFlipped = !this.pendingBossWallVolleyFlipped;
      this.nextBossWallVolleyAt = this.time.now + BOSS_WALL_VOLLEY_INTERVAL;
      this.clearBossWallTelegraph();
    });
  }

  private roomUsesWallVolley(room: RoomDefinition): boolean {
    if (this.difficulty === 'easy') return false;
    if (room.type === 'boss') return true;
    return this.difficulty === 'hard' && (room.type === 'combat' || room.type === 'midboss');
  }

  private getBossWallVolleyGeometry(flipped: boolean): {
    horizontalRows: number[];
    verticalColumns: number[];
    horizontalX: number;
    horizontalAngle: number;
    verticalY: number;
    verticalAngle: number;
  } {
    const left = 52;
    const right = GAME_WIDTH - 52;
    const top = 73;
    const bottom = GAME_HEIGHT - 73;
    const hardBossVolley = this.difficulty === 'hard' && this.rooms[this.roomIndex].type === 'boss';
    const horizontalCount = hardBossVolley ? 3 : 2;
    const verticalCount = hardBossVolley ? 5 : 3;
    return {
      horizontalRows: Array.from({ length: horizontalCount }, (_, index) => top + (bottom - top) * (index + 1) / (horizontalCount + 1)),
      verticalColumns: Array.from({ length: verticalCount }, (_, index) => left + (right - left) * (index + 1) / (verticalCount + 1)),
      horizontalX: flipped ? right : left,
      horizontalAngle: flipped ? Math.PI : 0,
      verticalY: flipped ? bottom : top,
      verticalAngle: flipped ? -Math.PI / 2 : Math.PI / 2,
    };
  }

  private drawBossWallTelegraph(flipped: boolean): void {
    const geometry = this.getBossWallVolleyGeometry(flipped);
    const horizontalEndX = flipped ? 60 : GAME_WIDTH - 60;
    const verticalEndY = flipped ? 70 : GAME_HEIGHT - 70;
    this.bossWallTelegraphGraphics.clear();
    this.bossWallTelegraphGraphics.lineStyle(5, 0xff7b54, 0.7);
    geometry.horizontalRows.forEach((y) => {
      this.bossWallTelegraphGraphics.lineBetween(geometry.horizontalX, y, horizontalEndX, y);
      this.bossWallTelegraphGraphics.fillStyle(0xffd071, 0.95).fillCircle(geometry.horizontalX, y, 13);
      const tipX = geometry.horizontalX + Math.cos(geometry.horizontalAngle) * 44;
      this.bossWallTelegraphGraphics.fillTriangle(tipX, y, tipX - Math.cos(geometry.horizontalAngle) * 20 + Math.sin(geometry.horizontalAngle) * 10, y - Math.sin(geometry.horizontalAngle) * 20 - Math.cos(geometry.horizontalAngle) * 10, tipX - Math.cos(geometry.horizontalAngle) * 20 - Math.sin(geometry.horizontalAngle) * 10, y - Math.sin(geometry.horizontalAngle) * 20 + Math.cos(geometry.horizontalAngle) * 10);
    });
    geometry.verticalColumns.forEach((x) => {
      this.bossWallTelegraphGraphics.lineBetween(x, geometry.verticalY, x, verticalEndY);
      this.bossWallTelegraphGraphics.fillStyle(0xffd071, 0.95).fillCircle(x, geometry.verticalY, 13);
      const tipY = geometry.verticalY + Math.sin(geometry.verticalAngle) * 44;
      this.bossWallTelegraphGraphics.fillTriangle(x, tipY, x - 10, tipY - Math.sin(geometry.verticalAngle) * 20, x + 10, tipY - Math.sin(geometry.verticalAngle) * 20);
    });
    const horizontalDirection = flipped ? '오른쪽 → 왼쪽' : '왼쪽 → 오른쪽';
    const verticalDirection = flipped ? '아래 → 위' : '위 → 아래';
    this.bossWallWarningText.setText(`벽 화염 예고 · ${horizontalDirection} / ${verticalDirection}`).setVisible(true).setAlpha(1);
    this.tweens.killTweensOf(this.bossWallTelegraphGraphics);
    this.tweens.add({
      targets: [this.bossWallTelegraphGraphics, this.bossWallWarningText],
      alpha: { from: 0.25, to: 1 }, duration: 150, yoyo: true, repeat: 2,
    });
    this.publishAccessibleStatus();
  }

  private fireBossWallVolley(flipped: boolean): void {
    const geometry = this.getBossWallVolleyGeometry(flipped);
    geometry.horizontalRows.forEach((y) => this.fireWallProjectile(geometry.horizontalX, y, geometry.horizontalAngle));
    geometry.verticalColumns.forEach((x) => this.fireWallProjectile(x, geometry.verticalY, geometry.verticalAngle));
  }

  private clearBossWallTelegraph(): void {
    this.pendingBossWallVolley = false;
    this.bossWallTelegraphGraphics?.clear().setAlpha(1);
    this.bossWallWarningText?.setVisible(false).setText('').setAlpha(1);
    if (this.bossWallTelegraphGraphics) this.tweens.killTweensOf(this.bossWallTelegraphGraphics);
    if (this.bossWallWarningText) this.tweens.killTweensOf(this.bossWallWarningText);
    this.publishAccessibleStatus();
  }

  private fireWallProjectile(x: number, y: number, angle: number): void {
    const projectile = this.enemyProjectiles.create(x, y, 'fireball', 0) as EnemyProjectile;
    projectile.damage = 12;
    projectile.source = 'wall';
    projectile.setRotation(angle).setDepth(6).setDisplaySize(42, 42).setCircle(76, 52, 52).play('fireball-fly');
    this.physics.velocityFromRotation(angle, 275, projectile.body!.velocity);
    this.time.delayedCall(4800, () => projectile.active && projectile.destroy());
  }

  private removeOutOfBoundsProjectiles(): void {
    this.enemyProjectiles.getChildren().forEach((child) => {
      const projectile = child as EnemyProjectile;
      if (projectile.x < 30 || projectile.x > GAME_WIDTH - 30 || projectile.y < 50 || projectile.y > GAME_HEIGHT - 50) {
        projectile.destroy();
      }
    });
  }

  private attack(source: 'mouse' | 'keyboard' = 'mouse'): void {
    const now = this.time.now;
    if (now - this.lastAttackAt < this.attackCooldown || this.hp <= 0 || this.transitioning || this.awaitingUpgrade || this.awaitingSpecial) return;
    this.lastAttackAt = now;
    const weaponDefinition = WEAPONS[this.weapon];
    this.playerAttackingUntil = now + Math.min(weaponDefinition.attackDuration, this.attackCooldown * 0.9);
    this.player.play(weaponDefinition.attackAnimation);
    this.music.playEffect('attack');
    const pointer = this.input.activePointer;
    const automaticTarget = source === 'keyboard' && this.settings.targetMode === 'auto'
      ? this.getNearestEnemy()
      : undefined;
    const facing = automaticTarget
      ? Phaser.Math.Angle.Between(this.player.x, this.player.y, automaticTarget.x, automaticTarget.y)
      : Phaser.Math.Angle.Between(this.player.x, this.player.y, pointer.worldX, pointer.worldY);
    if (automaticTarget) this.player.setFlipX(automaticTarget.x < this.player.x);
    this.currentAttackFacing = facing;
    const attackOrigin = this.getAttackOrigin(facing);
    this.showAttackVisual(facing);
    let hitLanded = false;
    let criticalLanded = false;
    let enemyDefeated = false;
    let heavyTargetHit = false;
    this.enemies.getChildren().forEach((child) => {
      const enemy = child as Enemy;
      if (!enemy.active || now - enemy.lastHitAt < 220) return;
      if (enemy.kind === 'boss' && now < (enemy.phaseInvulnerableUntil ?? 0)) return;
      const distance = Phaser.Math.Distance.Between(attackOrigin.x, attackOrigin.y, enemy.x, enemy.y);
      const enemyAngle = Phaser.Math.Angle.Between(attackOrigin.x, attackOrigin.y, enemy.x, enemy.y);
      const delta = Math.abs(Phaser.Math.Angle.Wrap(enemyAngle - facing));
      const angularAllowance = distance <= enemy.hitRadius
        ? Math.PI
        : Math.asin(Math.min(1, enemy.hitRadius / distance));
      let touchesAttackRange = distance - enemy.hitRadius <= this.attackRange;
      let touchesAttackAngle = delta <= this.attackArcAngle + angularAllowance;
      if (this.weapon === 'spear') {
        const deltaX = enemy.x - attackOrigin.x;
        const deltaY = enemy.y - attackOrigin.y;
        const forwardDistance = deltaX * Math.cos(facing) + deltaY * Math.sin(facing);
        const lateralDistance = Math.abs(-deltaX * Math.sin(facing) + deltaY * Math.cos(facing));
        touchesAttackRange = forwardDistance + enemy.hitRadius >= 0
          && forwardDistance - enemy.hitRadius <= this.attackRange;
        touchesAttackAngle = lateralDistance <= SPEAR_ATTACK_HALF_WIDTH + enemy.hitRadius;
      }
      if (touchesAttackRange && touchesAttackAngle) {
        hitLanded = true;
        enemy.lastHitAt = now;
        const critical = Math.random() < this.criticalChance;
        criticalLanded ||= critical;
        heavyTargetHit ||= enemy.kind === 'brute' || enemy.kind === 'midboss' || enemy.kind === 'boss';
        const damage = critical ? this.attackDamage * 2 : this.attackDamage;
        enemy.hp -= damage;
        this.spawnHitEffect(enemy, enemyAngle, critical);
        if (SHOW_DAMAGE_NUMBERS) this.showDamageNumber(enemy.x, enemy.y, damage, critical);
        let phaseChanged = false;
        if (enemy.kind === 'boss') {
          const nextPhase = this.getBossPhase(enemy);
          if (nextPhase > (enemy.bossPhase ?? 1)) {
            this.handleBossPhaseTransition(enemy, nextPhase as 2 | 3);
            phaseChanged = true;
          }
          this.updateBossHud();
        }
        if (!phaseChanged) this.flashEnemyHit(enemy, critical);
        const force = enemy.kind === 'boss' ? 80 : enemy.kind === 'midboss' ? 140 : enemy.kind === 'brute' ? 250 : 340;
        const knockback = new Phaser.Math.Vector2(enemy.x - this.player.x, enemy.y - this.player.y).normalize().scale(force);
        enemy.setVelocity(knockback.x, knockback.y);
        if (enemy.hp <= 0) {
          enemyDefeated = true;
          this.spawnDeathBurst(enemy);
          const deathEffect = {
            stalker: 'stalkerDeath',
            brute: 'bruteDeath',
            archer: 'archerDeath',
            midboss: 'bruteDeath',
            boss: 'bossDeath',
          } as const;
          this.music.playEffect(deathEffect[enemy.kind]);
          if (enemy.kind === 'boss') this.clearBossTelegraph();
          if (enemy.kind === 'midboss') this.clearMidBossTelegraph();
          const ashReward: Record<EnemyKind, number> = { stalker: 1, brute: 3, archer: 2, midboss: 12, boss: 33 };
          this.ashes += ashReward[enemy.kind];
          this.persistProgress();
          enemy.destroy();
          this.kills += 1;
          this.updateHud();
        } else if (!phaseChanged) {
          this.music.playEffect('enemyHit');
        }
      }
    });
    if (hitLanded) {
      this.applyHitStop(criticalLanded ? 70 : enemyDefeated ? 60 : 40);
      const shakeIntensity = criticalLanded ? 0.005 : heavyTargetHit ? 0.0036 : 0.0022;
      this.cameras.main.shake(criticalLanded || enemyDefeated ? 95 : 60, shakeIntensity);
    }
  }

  private getNearestEnemy(): Enemy | undefined {
    let nearest: Enemy | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;
    this.enemies.getChildren().forEach((child) => {
      const enemy = child as Enemy;
      if (!enemy.active) return;
      const distance = Phaser.Math.Distance.Squared(this.player.x, this.player.y, enemy.x, enemy.y);
      if (distance < nearestDistance) {
        nearest = enemy;
        nearestDistance = distance;
      }
    });
    return nearest;
  }

  private flashEnemyHit(enemy: Enemy, critical: boolean): void {
    this.tweens.killTweensOf(enemy);
    const originalScaleX = enemy.scaleX;
    const originalScaleY = enemy.scaleY;
    enemy
      .setTint(critical ? 0xffe07b : 0xff8f8f)
      .setAlpha(1)
      .setScale(originalScaleX * (critical ? 1.16 : 1.1), originalScaleY * (critical ? 0.82 : 0.9));
    this.tweens.add({
      targets: enemy,
      alpha: 0.32,
      scaleX: originalScaleX,
      scaleY: originalScaleY,
      duration: critical ? 135 : 105,
      ease: 'Back.Out',
      onComplete: () => {
        if (enemy.active) enemy.setAlpha(1).setScale(originalScaleX, originalScaleY).clearTint();
      },
    });
  }

  private applyHitStop(duration: number): void {
    if (this.hitStopTimer !== undefined) window.clearTimeout(this.hitStopTimer);
    this.physics.world.pause();
    this.time.paused = true;
    this.tweens.pauseAll();
    this.anims.pauseAll();
    this.hitStopTimer = window.setTimeout(() => {
      this.hitStopTimer = undefined;
      if (this.gamePaused || !this.scene.isActive()) return;
      this.time.paused = false;
      this.physics.world.resume();
      this.tweens.resumeAll();
      this.anims.resumeAll();
    }, duration);
  }

  private spawnHitEffect(enemy: Enemy, direction: number, critical: boolean): void {
    const heavyTarget = enemy.kind === 'brute' || enemy.kind === 'midboss' || enemy.kind === 'boss';
    const color = critical ? 0xffe079 : enemy.kind === 'midboss' ? 0xc89cff : heavyTarget ? 0xff9a63 : 0xffd7b0;
    const count = critical ? 10 : heavyTarget ? 7 : 6;
    const travel = critical ? 72 : heavyTarget ? 50 : 58;
    for (let index = 0; index < count; index += 1) {
      const spread = Phaser.Math.FloatBetween(-0.72, 0.72);
      const angle = direction + spread;
      const shard = this.add.rectangle(
        enemy.x + Math.cos(angle) * 8,
        enemy.y + Math.sin(angle) * 8,
        Phaser.Math.Between(8, critical ? 20 : 15),
        Phaser.Math.Between(2, 4),
        color,
        0.95,
      ).setRotation(angle).setDepth(24);
      const distance = Phaser.Math.Between(Math.round(travel * 0.55), travel);
      this.tweens.add({
        targets: shard,
        x: shard.x + Math.cos(angle) * distance,
        y: shard.y + Math.sin(angle) * distance,
        alpha: 0,
        scaleX: 0.25,
        duration: Phaser.Math.Between(130, critical ? 260 : 210),
        ease: 'Quad.Out',
        onComplete: () => shard.destroy(),
      });
    }

    const ring = this.add.circle(enemy.x, enemy.y, critical ? 18 : 13, color, 0)
      .setStrokeStyle(critical ? 4 : 3, color, 0.9).setDepth(23);
    this.tweens.add({
      targets: ring,
      scale: critical ? 2.4 : 1.9,
      alpha: 0,
      duration: critical ? 240 : 170,
      ease: 'Quad.Out',
      onComplete: () => ring.destroy(),
    });
  }

  private spawnDeathBurst(enemy: Enemy): void {
    const colorByKind: Record<EnemyKind, number> = {
      stalker: 0xb54d62,
      archer: 0x9ce9ff,
      brute: 0xb99a7a,
      midboss: 0xb783ff,
      boss: 0xff6f47,
    };
    const fragmentCount = enemy.kind === 'boss' ? 22 : enemy.kind === 'midboss' ? 16 : enemy.kind === 'brute' ? 12 : 9;
    const travel = enemy.kind === 'boss' ? 125 : enemy.kind === 'midboss' ? 100 : enemy.kind === 'brute' ? 82 : 72;
    for (let index = 0; index < fragmentCount; index += 1) {
      const angle = (Math.PI * 2 * index) / fragmentCount + Phaser.Math.FloatBetween(-0.24, 0.24);
      const heavy = enemy.kind === 'brute' || enemy.kind === 'midboss' || enemy.kind === 'boss';
      const fragment = this.add.rectangle(
        enemy.x,
        enemy.y,
        Phaser.Math.Between(heavy ? 7 : 4, heavy ? 15 : 10),
        Phaser.Math.Between(heavy ? 6 : 2, heavy ? 12 : 5),
        colorByKind[enemy.kind],
        1,
      ).setRotation(angle).setDepth(25);
      const distance = Phaser.Math.Between(Math.round(travel * 0.5), travel);
      this.tweens.add({
        targets: fragment,
        x: fragment.x + Math.cos(angle) * distance,
        y: fragment.y + Math.sin(angle) * distance + (heavy ? 24 : 12),
        rotation: angle + Phaser.Math.FloatBetween(-2.4, 2.4),
        alpha: 0,
        scale: 0.25,
        duration: Phaser.Math.Between(260, enemy.kind === 'boss' ? 560 : 420),
        ease: 'Quad.Out',
        onComplete: () => fragment.destroy(),
      });
    }
  }

  private showDamageNumber(x: number, y: number, damage: number, critical: boolean): void {
    const damageText = this.add.text(x, y - 34, `${Math.round(damage)}${critical ? '!' : ''}`, {
      fontSize: critical ? '25px' : '18px',
      color: critical ? '#ffe079' : '#fff0dc',
      fontStyle: 'bold',
      stroke: '#321522',
      strokeThickness: critical ? 5 : 4,
      padding: { x: 4, y: 3 },
    }).setOrigin(0.5).setDepth(30);
    this.tweens.add({
      targets: damageText,
      y: y - (critical ? 88 : 72),
      alpha: 0,
      scale: critical ? 1.18 : 0.92,
      duration: critical ? 620 : 480,
      ease: 'Cubic.Out',
      onComplete: () => damageText.destroy(),
    });
  }

  private showAttackVisual(facing: number, duration?: number): void {
    const weaponDefinition = WEAPONS[this.weapon];
    const visualDuration = duration ?? weaponDefinition.attackDuration;
    const attackOrigin = this.getAttackOrigin(facing);
    this.attackArcHideTimer?.remove(false);
    this.attackArcHideTimer = undefined;
    this.drawAttackArc(facing);
    this.tweens.killTweensOf(this.attackSlash);
    if (this.weapon === 'spear') {
      this.attackSlash
        .setPosition(attackOrigin.x, attackOrigin.y)
        .setDisplaySize(this.attackRange + 8, 5)
        .setRotation(facing)
        .setFillStyle(0xd8fbff, 1)
        .setStrokeStyle(2, 0x70dbe8, 1)
        .setAlpha(1)
        .setVisible(true);
      this.tweens.add({
        targets: this.attackSlash,
        alpha: 0,
        duration: visualDuration,
        ease: 'Cubic.Out',
        onComplete: () => this.attackSlash.setVisible(false),
      });
      this.scheduleAttackArcHide(Math.round(visualDuration * 0.9));
      return;
    }
    this.attackSlash
      .setPosition(attackOrigin.x, attackOrigin.y)
      .setDisplaySize(Math.max(50, this.attackRange - 12), 6)
      .setRotation(facing - this.attackArcAngle)
      .setFillStyle(this.weapon === 'axe' ? 0xffc074 : 0xfff0b8, 0.95)
      .setStrokeStyle(2, this.weapon === 'axe' ? 0xff6e3a : 0xff9f43, 1)
      .setAlpha(1)
      .setVisible(true);
    this.tweens.add({
      targets: this.attackSlash,
      rotation: facing + this.attackArcAngle,
      alpha: 0.18,
      duration: visualDuration,
      ease: 'Sine.Out',
      onComplete: () => this.attackSlash.setVisible(false),
    });
    this.scheduleAttackArcHide(Math.round(visualDuration * 0.85));
  }

  private scheduleAttackArcHide(delay: number): void {
    this.attackArcHideTimer = this.time.delayedCall(delay, () => {
      this.attackArc.setVisible(false).clear();
      this.attackArcHideTimer = undefined;
    });
  }

  private updateAttackVisualPosition(): void {
    const attackOrigin = this.getAttackOrigin(this.currentAttackFacing);
    if (this.attackArc.visible) this.attackArc.setPosition(attackOrigin.x, attackOrigin.y);
    if (this.attackSlash.visible) this.attackSlash.setPosition(attackOrigin.x, attackOrigin.y);
  }

  private drawAttackArc(facing: number): void {
    const innerRadius = 14;
    const attackOrigin = this.getAttackOrigin(facing);
    this.attackArc.clear().setPosition(attackOrigin.x, attackOrigin.y).setVisible(true);
    if (this.weapon === 'spear') {
      const halfWidth = SPEAR_ATTACK_HALF_WIDTH;
      const perpendicularX = -Math.sin(facing) * halfWidth;
      const perpendicularY = Math.cos(facing) * halfWidth;
      const endX = Math.cos(facing) * this.attackRange;
      const endY = Math.sin(facing) * this.attackRange;
      this.attackArc.fillStyle(0x8ee7f2, 0.18).lineStyle(3, 0xbef4ff, 0.88);
      this.attackArc.beginPath();
      this.attackArc.moveTo(perpendicularX, perpendicularY);
      this.attackArc.lineTo(endX + perpendicularX, endY + perpendicularY);
      this.attackArc.lineTo(endX - perpendicularX, endY - perpendicularY);
      this.attackArc.lineTo(-perpendicularX, -perpendicularY);
      this.attackArc.closePath().fillPath().strokePath();
      return;
    }
    const fillColor = this.weapon === 'axe' ? 0xff7a45 : 0xf7c86a;
    const strokeColor = this.weapon === 'axe' ? 0xffb067 : 0xffd27a;
    this.attackArc.fillStyle(fillColor, this.weapon === 'axe' ? 0.25 : 0.2).lineStyle(3, strokeColor, 0.82);
    this.attackArc.beginPath();
    this.attackArc.arc(0, 0, this.attackRange, facing - this.attackArcAngle, facing + this.attackArcAngle, false);
    this.attackArc.lineTo(Math.cos(facing + this.attackArcAngle) * innerRadius, Math.sin(facing + this.attackArcAngle) * innerRadius);
    this.attackArc.arc(0, 0, innerRadius, facing + this.attackArcAngle, facing - this.attackArcAngle, true);
    this.attackArc.closePath().fillPath().strokePath();
  }

  private getAttackOrigin(facing: number): Phaser.Math.Vector2 {
    return new Phaser.Math.Vector2(
      this.player.x + Math.cos(facing) * ATTACK_ORIGIN_OFFSET,
      this.player.y + Math.sin(facing) * ATTACK_ORIGIN_OFFSET,
    );
  }

  private onPlayerHit: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback = (_player, enemyObject): void => {
    const enemy = enemyObject as unknown as Enemy;
    const damage = enemy.kind === 'boss' ? 28 : enemy.kind === 'midboss' ? 22 : enemy.kind === 'brute' ? 20 : 12;
    this.damagePlayer(damage);
  };

  private onProjectileHit: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback = (_player, projectileObject): void => {
    const projectile = projectileObject as unknown as EnemyProjectile;
    const damage = projectile.damage;
    projectile.destroy();
    this.damagePlayer(damage);
  };

  private damagePlayer(amount: number): void {
    if (this.debugInvincible) return;
    const now = this.time.now;
    if (now < this.invulnerableUntil || this.hp <= 0 || this.transitioning) return;
    const reducedDamage = Math.max(1, Math.round(amount * (1 - this.damageReduction)));
    this.hp = Math.max(0, this.hp - reducedDamage);
    this.invulnerableUntil = now + 650;
    this.music.playEffect('playerHit');
    this.flashPlayerHit();
    this.cameras.main.shake(100, 0.007);
    this.updateHud();
    if (this.hp === 0) {
      this.clearBossTelegraph();
      this.clearBossWallTelegraph();
      this.player.setVelocity(0).setTint(0x4b4350);
      this.enemies.setVelocityX(0); this.enemies.setVelocityY(0);
      this.enemyProjectiles.setVelocityX(0); this.enemyProjectiles.setVelocityY(0);
      this.bannerText.setText('탈출 실패').setAlpha(1);
      this.showDeathChoices();
    }
  }

  private flashPlayerHit(): void {
    this.tweens.killTweensOf(this.player);
    this.player.setTint(0xff6b78).setAlpha(1);
    this.tweens.add({
      targets: this.player,
      alpha: 0.25,
      duration: 55,
      yoyo: true,
      repeat: 2,
      onComplete: () => {
        if (!this.player.active) return;
        this.player.setAlpha(1);
        if (this.hp > 0) this.player.clearTint();
        else this.player.setTint(0x4b4350);
      },
    });
  }

  private showDeathChoices(): void {
    if (this.restartOverlay) return;
    const continueButton = this.add.rectangle(GAME_WIDTH / 2, 345, 320, 62, 0x436b68, 0.98)
      .setStrokeStyle(3, 0x91e3bd, 1)
      .setInteractive({ useHandCursor: true });
    continueButton.on('pointerover', () => continueButton.setFillStyle(0x568781, 1));
    continueButton.on('pointerout', () => continueButton.setFillStyle(0x436b68, 0.98));
    continueButton.on('pointerdown', () => this.continueFromBeginning());
    const continueLabel = this.add.text(GAME_WIDTH / 2, 345, '이어서 시작', {
      fontSize: '23px', color: '#e8fff3', fontStyle: 'bold', padding: { x: 6, y: 5 },
    }).setOrigin(0.5);
    const continueHint = this.add.text(GAME_WIDTH / 2, 390, '재로 영구 강화 후 첫 방부터 시작 · R 키', {
      fontSize: '15px', color: '#a9d7c2', padding: { x: 4, y: 3 },
    }).setOrigin(0.5);

    const newGameButton = this.add.rectangle(GAME_WIDTH / 2, 455, 320, 62, 0x6f344f, 0.98)
      .setStrokeStyle(3, 0xf7c86a, 1)
      .setInteractive({ useHandCursor: true });
    newGameButton.on('pointerover', () => newGameButton.setFillStyle(0x8a405f, 1));
    newGameButton.on('pointerout', () => newGameButton.setFillStyle(0x6f344f, 0.98));
    newGameButton.on('pointerdown', () => this.startCompletelyNewGame());
    const newGameLabel = this.add.text(GAME_WIDTH / 2, 455, '새 게임 시작', {
      fontSize: '23px', color: '#fff2ce', fontStyle: 'bold', padding: { x: 6, y: 5 },
    }).setOrigin(0.5);
    const newGameHint = this.add.text(GAME_WIDTH / 2, 500, '재와 강화를 포함한 모든 진행 상황 초기화', {
      fontSize: '15px', color: '#c9aeb9', padding: { x: 4, y: 3 },
    }).setOrigin(0.5);
    this.restartOverlay = this.add.container(0, 0, [
      continueButton, continueLabel, continueHint, newGameButton, newGameLabel, newGameHint,
    ]).setDepth(100);
    this.publishAccessibleStatus();
  }

  private continueFromBeginning(): void {
    if (this.hp > 0 || this.awaitingPermanentUpgrade) return;
    this.restartOverlay?.destroy(true);
    this.restartOverlay = undefined;
    this.awaitingPermanentUpgrade = true;
    this.permanentPurchaseMessage = '';
    this.selectPermanentUpgradeChoices();
    this.showPermanentUpgradeScreen();
  }

  private selectPermanentUpgradeChoices(): void {
    const shuffled = Phaser.Utils.Array.Shuffle([...PERMANENT_UPGRADES]);
    const available = shuffled.filter((upgrade) => (
      (this.permanentUpgradeLevels.get(upgrade.id) ?? 0) < upgrade.maxLevel
    ));
    const maxed = shuffled.filter((upgrade) => !available.includes(upgrade));
    this.permanentUpgradeChoices = [...available, ...maxed].slice(0, 3);
  }

  private showPermanentUpgradeScreen(): void {
    if (!this.awaitingPermanentUpgrade) return;
    this.permanentOverlay?.destroy(true);
    const children: Phaser.GameObjects.GameObject[] = [];
    children.push(this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH - 70, GAME_HEIGHT - 60, 0x0d0a12, 0.98)
      .setStrokeStyle(3, 0xd99a55, 0.9));
    children.push(this.add.text(GAME_WIDTH / 2, 72, `잔불의 제단 · 보유 재 ${this.ashes}`, {
      fontSize: '34px', color: '#ffc77c', fontStyle: 'bold', padding: { x: 8, y: 6 },
    }).setOrigin(0.5));
    children.push(this.add.text(GAME_WIDTH / 2, 118, '대시 계열을 제외한 영구 능력 중 무작위 3개 · 다음 회차에도 유지', {
      fontSize: '17px', color: '#d8c3ae', padding: { x: 5, y: 4 },
    }).setOrigin(0.5));

    const cardXs = [350, 640, 930];
    this.permanentUpgradeChoices.forEach((upgrade, index) => {
      const level = this.permanentUpgradeLevels.get(upgrade.id) ?? 0;
      const maxed = level >= upgrade.maxLevel;
      const cost = getPermanentUpgradeCost(upgrade, level);
      const affordable = !maxed && this.ashes >= cost;
      const card = this.add.rectangle(cardXs[index], 335, 255, 310, 0x241b2c, 0.98)
        .setStrokeStyle(4, affordable ? upgrade.color : 0x625766, 1)
        .setInteractive({ useHandCursor: true });
      card.on('pointerdown', () => this.purchasePermanentUpgrade(index));
      children.push(card);
      children.push(this.add.text(cardXs[index], 215, `${index + 1}`, {
        fontSize: '22px', color: '#fff0d4', backgroundColor: '#583c58', padding: { x: 12, y: 7 },
      }).setOrigin(0.5));
      children.push(this.add.text(cardXs[index], 275, upgrade.name, {
        fontSize: '22px', color: '#fff0d4', fontStyle: 'bold', align: 'center',
        wordWrap: { width: 215 }, padding: { x: 5, y: 5 },
      }).setOrigin(0.5));
      children.push(this.add.text(cardXs[index], 360, upgrade.description, {
        fontSize: '16px', color: '#cfc0d3', align: 'center', wordWrap: { width: 205 }, lineSpacing: 5,
        padding: { x: 5, y: 5 },
      }).setOrigin(0.5));
      children.push(this.add.text(cardXs[index], 435, `영구 Lv.${level} / ${upgrade.maxLevel}`, {
        fontSize: '16px', color: '#bcaac4', padding: { x: 4, y: 3 },
      }).setOrigin(0.5));
      children.push(this.add.text(cardXs[index], 475, maxed ? '최대 강화' : `재 ${cost}`, {
        fontSize: '19px', color: maxed ? '#8b818d' : affordable ? '#ffd36f' : '#a77b83', fontStyle: 'bold',
        padding: { x: 4, y: 3 },
      }).setOrigin(0.5));
    });

    if (this.permanentPurchaseMessage) {
      children.push(this.add.text(GAME_WIDTH / 2, 520, this.permanentPurchaseMessage, {
        fontSize: '17px', color: '#ffd08a', padding: { x: 6, y: 4 },
      }).setOrigin(0.5));
    }
    const startButton = this.add.rectangle(GAME_WIDTH / 2, 585, 390, 64, 0x436b68, 1)
      .setStrokeStyle(3, 0x91e3bd, 1).setInteractive({ useHandCursor: true });
    startButton.on('pointerdown', () => this.startContinuedRun());
    children.push(startButton);
    children.push(this.add.text(GAME_WIDTH / 2, 585, '강화 완료 · 다음 회차 시작', {
      fontSize: '22px', color: '#eafff2', fontStyle: 'bold', padding: { x: 6, y: 5 },
    }).setOrigin(0.5));
    children.push(this.add.text(GAME_WIDTH / 2, 635, 'ENTER / R / ESC / 4', {
      fontSize: '15px', color: '#9fc8b5', padding: { x: 4, y: 3 },
    }).setOrigin(0.5));
    this.permanentOverlay = this.add.container(0, 0, children).setDepth(120);
    this.publishAccessibleStatus();
  }

  private purchasePermanentUpgrade(index: number): void {
    if (!this.awaitingPermanentUpgrade) return;
    const upgrade = this.permanentUpgradeChoices[index];
    if (!upgrade) return;
    const level = this.permanentUpgradeLevels.get(upgrade.id) ?? 0;
    if (level >= upgrade.maxLevel) {
      this.permanentPurchaseMessage = `${upgrade.name}은 이미 최대 단계입니다.`;
      this.showPermanentUpgradeScreen();
      return;
    }
    const cost = getPermanentUpgradeCost(upgrade, level);
    if (this.ashes < cost) {
      this.permanentPurchaseMessage = `재가 ${cost - this.ashes} 부족합니다.`;
      this.showPermanentUpgradeScreen();
      return;
    }
    this.ashes -= cost;
    this.music.playEffect('select');
    const nextLevel = level + 1;
    this.permanentUpgradeLevels.set(upgrade.id, nextLevel);
    this.persistProgress();
    this.applyPermanentUpgrade(upgrade.id);
    this.permanentPurchaseMessage = `${upgrade.name} 영구 Lv.${nextLevel} 획득`;
    this.showPermanentUpgradeScreen();
    this.updateBuildText();
    this.updateHud();
  }

  private applyPermanentUpgrade(id: PermanentUpgradeId): void {
    if (id === 'maxHealth') this.maxHp += 5;
    if (id === 'attackPower') this.attackDamage += 2;
    if (id === 'attackSpeed') this.attackCooldown = Math.max(190, Math.round(this.attackCooldown * 0.96));
    if (id === 'attackRange') {
      this.attackRange += 3;
      this.attackArcAngle += 0.02;
    }
    if (id === 'moveSpeed') this.moveSpeed += 8;
    if (id === 'roomRecovery') this.roomRecovery += 2;
    if (id === 'criticalChance') this.criticalChance = Math.min(0.5, this.criticalChance + 0.03);
    if (id === 'ashArmor') this.damageReduction = Math.min(0.4, this.damageReduction + 0.02);
  }

  private resetTemporaryUpgrades(): void {
    const weaponDefinition = WEAPONS[this.weapon];
    this.maxHp = 50;
    this.attackDamage = weaponDefinition.attackDamage;
    this.attackCooldown = weaponDefinition.attackCooldown;
    this.attackRange = weaponDefinition.attackRange;
    this.attackArcAngle = weaponDefinition.attackArcAngle;
    this.moveSpeed = 260;
    this.dashSpeed = 620;
    this.dashCooldown = 1000;
    this.dashDuration = BASE_STATS.dashDuration;
    this.roomRecovery = 0;
    this.lastCombatRecovery = undefined;
    this.criticalChance = 0;
    this.damageReduction = 0;
    this.acquiredUpgrades.clear();
    this.midBossBonusUpgrades.clear();
    this.midBossRewardMessage = '';
    this.permanentUpgradeLevels.forEach((level, id) => {
      for (let stack = 0; stack < level; stack += 1) this.applyPermanentUpgrade(id);
    });
  }

  private startContinuedRun(): void {
    if (!this.awaitingPermanentUpgrade) return;
    this.awaitingPermanentUpgrade = false;
    this.permanentOverlay?.destroy(true);
    this.permanentOverlay = undefined;
    this.permanentPurchaseMessage = '';
    this.permanentUpgradeChoices = [];
    this.resetTemporaryUpgrades();
    this.hp = this.maxHp;
    this.kills = 0;
    this.roomIndex = 0;
    this.lastAttackAt = -1000;
    this.lastDashAt = -2000;
    this.invulnerableUntil = 0;
    this.playerKnockbackUntil = 0;
    this.transitionLockUntil = 0;
    this.roomCleared = false;
    this.transitioning = false;
    this.runFinished = false;
    this.awaitingUpgrade = false;
    this.awaitingMidBossReward = false;
    this.upgradeRerollMessage = '';
    this.awaitingSpecial = false;
    this.upgradeChoices = [];
    this.specialChoices = [];
    this.upgradeOverlay?.destroy(true);
    this.midBossRewardOverlay?.destroy(true);
    this.specialOverlay?.destroy(true);
    this.upgradeOverlay = undefined;
    this.midBossRewardOverlay = undefined;
    this.specialOverlay = undefined;
    this.specialFeedbackText = undefined;
    this.clearedRooms = new Set<number>();
    this.usedSpecialRooms = new Set<number>();
    this.visitedRooms = new Set<number>();
    this.revealedRooms = new Set<number>([0]);
    this.rerolledUpgradeRooms = new Set<number>();
    this.shopUpgradeChoicesByRoom = new Map<number, UpgradeId[]>();
    this.upgradeRerollMessage = '';
    this.rooms = createRandomRoomLayout();
    this.enemies.clear(true, true);
    this.enemyProjectiles.clear(true, true);
    this.hideBossHud();
    this.hideAllExits();
    this.player.setVelocity(0).setVisible(false);
    this.gameStarted = false;
    this.bannerText.setText('다음 회차 준비').setAlpha(1).setVisible(true);
    this.drawArena(this.rooms[0].accent);
    this.updateBuildText();
    this.updateHud();
    this.showWeaponSelection(() => {
      this.startRunCountdown(() => {
        this.gameStarted = true;
        this.player.setVisible(true);
        this.invulnerableUntil = this.time.now + 1000;
        this.startRoom(0);
        this.updateBuildText();
        this.updateHud();
      });
    });
  }

  private startCompletelyNewGame(): void {
    this.skipNextPersistence = true;
    clearRogueliteProgress();
    this.ashes = 0;
    this.permanentUpgradeLevels.clear();
    this.scene.restart();
  }

  private completeCurrentRoom(): void {
    const room = this.rooms[this.roomIndex];
    this.clearedRooms.add(room.id);
    this.roomCleared = true;
    this.enemyProjectiles.clear(true, true);
    this.music.playEffect('roomClear');
    if (room.type === 'combat') {
      const base = 6;
      const bonus = this.roomRecovery;
      const total = base + bonus;
      const previousHp = this.hp;
      this.hp = Math.min(this.maxHp, this.hp + total);
      this.lastCombatRecovery = { base, bonus, total, restored: this.hp - previousHp };
    } else {
      this.lastCombatRecovery = undefined;
    }
    const midBossReward = room.type === 'midboss' ? this.grantMidBossBonusUpgrade() : undefined;
    if (!midBossReward) this.midBossRewardMessage = '';
    this.updateHud();
    if (room.type === 'boss') {
      this.transitioning = true;
      this.hideBossHud();
      this.bannerText.setText('화로의 수문장 격파 · 탈출구 개방').setAlpha(1);
      this.time.delayedCall(850, () => this.finishRun());
      return;
    }
    if (midBossReward) {
      this.showMidBossReward(midBossReward);
      return;
    }
    this.showUpgradeSelection();
  }

  private showMidBossReward(upgrade: UpgradeDefinition): void {
    this.awaitingMidBossReward = true;
    this.player.setVelocity(0);
    this.bannerText.setVisible(false);
    this.midBossRewardOverlay?.destroy(true);
    const children: Phaser.GameObjects.GameObject[] = [];
    children.push(this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x09070d, 0.88).setInteractive());
    children.push(this.add.text(GAME_WIDTH / 2, 115, '중간보스 격파 보상', {
      fontSize: '38px', color: '#d8b5ff', fontStyle: 'bold', stroke: '#28143a', strokeThickness: 7,
      padding: { x: 10, y: 9 },
    }).setOrigin(0.5));
    children.push(this.add.text(GAME_WIDTH / 2, 165, '이번 회차에만 유지되는 추가 강화입니다', {
      fontSize: '18px', color: '#bcaec3', padding: { x: 5, y: 4 },
    }).setOrigin(0.5));

    const card = this.add.rectangle(GAME_WIDTH / 2, 355, 390, 320, 0x211a2a, 0.99)
      .setStrokeStyle(5, upgrade.color, 1);
    children.push(card);
    children.push(this.add.text(GAME_WIDTH / 2, 260, upgrade.name, {
      fontSize: '29px', color: '#f7ead3', fontStyle: 'bold', padding: { x: 8, y: 8 },
    }).setOrigin(0.5));
    children.push(this.add.text(GAME_WIDTH / 2, 345, upgrade.description, {
      fontSize: '19px', color: '#cfc0d4', align: 'center', wordWrap: { width: 320 }, lineSpacing: 6,
      padding: { x: 6, y: 6 },
    }).setOrigin(0.5));
    children.push(this.add.text(GAME_WIDTH / 2, 435,
      `중간보스 보너스 +1\n현재 ${this.formatTemporaryUpgradeLevel(upgrade.id)}`, {
        fontSize: '20px', color: '#d8b5ff', fontStyle: 'bold', align: 'center', lineSpacing: 8,
        padding: { x: 6, y: 6 },
      }).setOrigin(0.5));

    const closeButton = this.add.rectangle(GAME_WIDTH / 2, 565, 350, 58, 0x5c3f70, 1)
      .setStrokeStyle(3, 0xd8b5ff, 1).setInteractive({ useHandCursor: true });
    closeButton.on('pointerover', () => closeButton.setFillStyle(0x76528e, 1));
    closeButton.on('pointerout', () => closeButton.setFillStyle(0x5c3f70, 1));
    closeButton.on('pointerdown', () => this.closeMidBossReward());
    children.push(closeButton);
    children.push(this.add.text(GAME_WIDTH / 2, 565, '확인하고 계속하기  ·  ENTER', {
      fontSize: '21px', color: '#f5eaff', fontStyle: 'bold', padding: { x: 6, y: 5 },
    }).setOrigin(0.5));
    this.midBossRewardOverlay = this.add.container(0, 0, children).setDepth(110);
    this.publishAccessibleStatus();
  }

  private closeMidBossReward(): void {
    if (!this.awaitingMidBossReward) return;
    this.awaitingMidBossReward = false;
    this.midBossRewardOverlay?.destroy(true);
    this.midBossRewardOverlay = undefined;
    this.midBossRewardMessage = '';
    this.music.playEffect('select');
    this.showUpgradeSelection();
  }

  private showUpgradeSelection(): void {
    const openingNewReward = !this.awaitingUpgrade;
    this.awaitingUpgrade = true;
    this.player.setVelocity(0);
    this.bannerText.setVisible(false);
    if (openingNewReward) this.upgradeRerollMessage = '';
    if (this.upgradeChoices.length === 0) this.upgradeChoices = this.rollUpgradeChoices();
    this.upgradeOverlay?.destroy(true);

    const children: Phaser.GameObjects.GameObject[] = [];
    const backdrop = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x09070d, 0.84)
      .setInteractive();
    children.push(backdrop);
    children.push(this.add.text(GAME_WIDTH / 2, 108, '재의 축복을 선택하세요', {
      fontSize: '34px', color: '#f7c86a', fontStyle: 'bold', padding: { x: 10, y: 9 },
    }).setOrigin(0.5));
    if (this.lastCombatRecovery) {
      const recovery = this.lastCombatRecovery;
      children.push(this.add.text(GAME_WIDTH / 2, 153,
        `방 정화 회복 ${recovery.total} (기본 ${recovery.base} + 승리의 온기 ${recovery.bonus}) · 실제 회복 ${recovery.restored}`, {
          fontSize: '16px', color: '#91e3bd', fontStyle: 'bold', padding: { x: 5, y: 4 },
        }).setOrigin(0.5));
    }
    if (this.midBossRewardMessage) {
      children.push(this.add.text(GAME_WIDTH / 2, 153, this.midBossRewardMessage, {
        fontSize: '17px', color: '#d8b5ff', fontStyle: 'bold', padding: { x: 6, y: 5 },
      }).setOrigin(0.5));
    }
    children.push(this.add.text(GAME_WIDTH / 2, 185, '클릭하거나 숫자 1 · 2 · 3을 누르세요', {
      fontSize: '17px', color: '#b9adbF',
    }).setOrigin(0.5));

    const cardXs = [350, 640, 930];
    this.upgradeChoices.forEach((upgrade, index) => {
      const currentLevel = this.getRegularUpgradeLevel(upgrade.id);
      const bonusLevel = this.midBossBonusUpgrades.get(upgrade.id) ?? 0;
      const currentLevelText = bonusLevel > 0 ? `${currentLevel}+${bonusLevel}` : `${currentLevel}`;
      const nextLevelText = bonusLevel > 0 ? `${currentLevel + 1}+${bonusLevel}` : `${currentLevel + 1}`;
      const card = this.add.rectangle(cardXs[index], 365, 250, 300, 0x211a2a, 0.98)
        .setStrokeStyle(4, upgrade.color, 1)
        .setInteractive({ useHandCursor: true });
      card.on('pointerover', () => card.setFillStyle(0x31243a, 1));
      card.on('pointerout', () => card.setFillStyle(0x211a2a, 0.98));
      card.on('pointerdown', () => this.selectUpgrade(index));
      children.push(card);
      children.push(this.add.text(cardXs[index], 250, `${index + 1}`, {
        fontSize: '20px', color: '#fff2ce', fontStyle: 'bold',
        backgroundColor: '#59405f', padding: { x: 9, y: 4 },
      }).setOrigin(0.5));
      children.push(this.add.text(cardXs[index], 315, upgrade.name, {
        fontSize: '24px', color: '#f7ead3', fontStyle: 'bold', align: 'center',
        wordWrap: { width: 210 },
      }).setOrigin(0.5));
      children.push(this.add.text(cardXs[index], 390, upgrade.description, {
        fontSize: '17px', color: '#c9becd', align: 'center',
        wordWrap: { width: 190 }, lineSpacing: 6,
      }).setOrigin(0.5));
      children.push(this.add.text(cardXs[index], 475, `현재 Lv.${currentLevelText}  →  Lv.${nextLevelText}`, {
        fontSize: '15px', color: '#a99caf',
      }).setOrigin(0.5));
    });

    const rerolled = this.rerolledUpgradeRooms.has(this.roomIndex);
    const rerollButton = this.add.rectangle(GAME_WIDTH / 2, 565, 330, 50, rerolled ? 0x302b34 : 0x51405b, 1)
      .setStrokeStyle(2, rerolled ? 0x625968 : 0xd0a4e8, 1);
    if (!rerolled) {
      rerollButton.setInteractive({ useHandCursor: true });
      rerollButton.on('pointerover', () => rerollButton.setFillStyle(0x684e73, 1));
      rerollButton.on('pointerout', () => rerollButton.setFillStyle(0x51405b, 1));
      rerollButton.on('pointerdown', () => this.rerollUpgradeChoices());
    }
    children.push(rerollButton);
    children.push(this.add.text(GAME_WIDTH / 2, 565,
      rerolled ? '이 방의 재추첨을 사용했습니다' : `재 ${UPGRADE_REROLL_COST}로 재추첨  ·  R`, {
        fontSize: '18px', color: rerolled ? '#887e8c' : '#f0d9ff', fontStyle: 'bold',
      }).setOrigin(0.5));
    if (this.upgradeRerollMessage) {
      children.push(this.add.text(GAME_WIDTH / 2, 615, this.upgradeRerollMessage, {
        fontSize: '16px', color: '#ffd08a', fontStyle: 'bold',
      }).setOrigin(0.5));
    }

    this.upgradeOverlay = this.add.container(0, 0, children).setDepth(100);
    this.publishAccessibleStatus();
  }

  private rollUpgradeChoices(excludedIds: UpgradeId[] = []): UpgradeDefinition[] {
    const eligible = UPGRADES.filter((upgrade) => (
      this.getRegularUpgradeLevel(upgrade.id) < upgrade.maxStacks
    ));
    const alternatives = Phaser.Utils.Array.Shuffle(eligible.filter((upgrade) => !excludedIds.includes(upgrade.id)));
    const previous = Phaser.Utils.Array.Shuffle(eligible.filter((upgrade) => excludedIds.includes(upgrade.id)));
    return [...alternatives, ...previous].slice(0, 3);
  }

  private rerollUpgradeChoices(): void {
    if (!this.awaitingUpgrade || this.rerolledUpgradeRooms.has(this.roomIndex)) return;
    if (this.ashes < UPGRADE_REROLL_COST) {
      this.upgradeRerollMessage = `재가 ${UPGRADE_REROLL_COST - this.ashes} 부족합니다.`;
      this.showUpgradeSelection();
      return;
    }
    const previousIds = this.upgradeChoices.map((upgrade) => upgrade.id);
    this.ashes -= UPGRADE_REROLL_COST;
    this.rerolledUpgradeRooms.add(this.roomIndex);
    this.upgradeChoices = this.rollUpgradeChoices(previousIds);
    this.upgradeRerollMessage = `재 ${UPGRADE_REROLL_COST}를 사용해 축복을 다시 불러왔습니다.`;
    this.music.playEffect('select');
    this.persistProgress();
    this.updateHud();
    this.showUpgradeSelection();
  }

  private showSpecialRoom(type: 'healing' | 'shop', excludedShopUpgradeIds: UpgradeId[] = []): void {
    this.awaitingSpecial = true;
    this.player.setVelocity(0);
    this.bannerText.setVisible(false);

    if (type === 'healing') {
      const recovery = Math.ceil(this.maxHp * 0.35);
      this.specialChoices = [
        {
          label: '온전한 휴식', cost: 0,
          description: `최대 생명의 35% (${recovery})를 회복합니다.`,
          action: () => {
            this.hp = Math.min(this.maxHp, this.hp + recovery);
            return `생명 ${recovery} 회복`;
          },
        },
        {
          label: '생명의 성장', cost: 0,
          description: '최대 생명과 현재 생명이 각각 5 증가합니다.',
          action: () => {
            this.maxHp += 5;
            this.hp = Math.min(this.maxHp, this.hp + 5);
            return '최대 생명 +5 · 현재 생명 +5';
          },
        },
      ];
    } else {
      const shopEligible = UPGRADES.filter((upgrade) => (
        this.getRegularUpgradeLevel(upgrade.id) < upgrade.maxStacks
      ));
      const savedIds = excludedShopUpgradeIds.length === 0
        ? this.shopUpgradeChoicesByRoom.get(this.roomIndex) ?? []
        : [];
      const saved = savedIds
        .map((id) => shopEligible.find((upgrade) => upgrade.id === id))
        .filter((upgrade): upgrade is UpgradeDefinition => upgrade !== undefined);
      const excludedIds = excludedShopUpgradeIds.length > 0 ? excludedShopUpgradeIds : savedIds;
      const alternatives = Phaser.Utils.Array.Shuffle(shopEligible.filter((upgrade) => !excludedIds.includes(upgrade.id)));
      const previous = Phaser.Utils.Array.Shuffle(shopEligible.filter((upgrade) => excludedIds.includes(upgrade.id)));
      const eligible = saved.length > 0
        ? [...saved, ...alternatives].slice(0, 2)
        : [...alternatives, ...previous].slice(0, 2);
      this.shopUpgradeChoicesByRoom.set(this.roomIndex, eligible.map((upgrade) => upgrade.id));
      this.specialChoices = [
        {
          label: '응축된 회복약', cost: 18,
          description: '생명을 30 회복합니다.',
          action: () => {
            this.hp = Math.min(this.maxHp, this.hp + 30);
            return '생명 30 회복';
          },
        },
        ...eligible.map((shopUpgrade) => ({
          label: shopUpgrade.name,
          cost: 28,
          description: `${shopUpgrade.description}\n즉시 ${this.formatTemporaryUpgradeLevel(shopUpgrade.id, this.getRegularUpgradeLevel(shopUpgrade.id) + 1)} 획득`,
          action: () => {
            const level = this.grantUpgrade(shopUpgrade);
            return `${shopUpgrade.name} Lv.${level} 획득`;
          },
        })),
      ];
    }

    const children: Phaser.GameObjects.GameObject[] = [];
    children.push(this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x09070d, 0.84).setInteractive());
    children.push(this.add.text(GAME_WIDTH / 2, type === 'shop' ? 90 : 105, type === 'healing' ? '고요한 샘의 축복' : `잿빛 시장 · 보유 재 ${this.ashes}`, {
      fontSize: type === 'shop' ? '30px' : '34px', color: type === 'healing' ? '#91e3bd' : '#8fd9f2', fontStyle: 'bold',
      padding: { x: 8, y: 7 },
    }).setOrigin(0.5));
    children.push(this.add.text(GAME_WIDTH / 2, type === 'shop' ? 132 : 150, type === 'shop'
      ? '구매할 상품을 하나 선택하세요 · 클릭 또는 숫자 1 · 2 · 3'
      : '한 번만 선택할 수 있습니다 · 클릭 또는 숫자 키', {
      fontSize: '17px', color: '#b9adbf', padding: { x: 5, y: 4 },
    }).setOrigin(0.5));

    const gap = this.specialChoices.length === 2 ? 330 : 300;
    const startX = GAME_WIDTH / 2 - gap * (this.specialChoices.length - 1) / 2;
    this.specialChoices.forEach((choice, index) => {
      const affordable = this.ashes >= choice.cost;
      const x = startX + gap * index;
      const cardY = type === 'shop' ? 335 : 365;
      const cardHeight = type === 'shop' ? 285 : 290;
      const cardWidth = type === 'shop' ? 272 : 250;
      const card = this.add.rectangle(x, cardY, cardWidth, cardHeight, affordable ? 0x211a2a : 0x211c22, 0.98)
        .setStrokeStyle(4, affordable ? (type === 'healing' ? 0x72bf8e : 0x6eb8d2) : 0x6e5860, 1)
        .setInteractive({ useHandCursor: true });
      card.on('pointerover', () => affordable && card.setFillStyle(0x31243a, 1));
      card.on('pointerout', () => card.setFillStyle(affordable ? 0x211a2a : 0x211c22, 0.98));
      card.on('pointerdown', () => this.selectSpecialChoice(index));
      children.push(card);
      children.push(this.add.text(x, type === 'shop' ? 225 : 250, `${index + 1}`, {
        fontSize: '20px', color: '#fff2ce', fontStyle: 'bold', backgroundColor: '#59405f', padding: { x: 9, y: 6 },
      }).setOrigin(0.5));
      children.push(this.add.text(x, type === 'shop' ? 290 : 320, choice.label, {
        fontSize: type === 'shop' ? '20px' : '22px', color: affordable ? '#f7ead3' : '#8f7f88', fontStyle: 'bold', align: 'center',
        wordWrap: { width: type === 'shop' ? 232 : 210 }, lineSpacing: 4, padding: { x: 6, y: 7 },
      }).setOrigin(0.5));
      children.push(this.add.text(x, type === 'shop' ? 370 : 400, choice.description, {
        fontSize: '16px', color: affordable ? '#c9becd' : '#796d75', align: 'center',
        wordWrap: { width: type === 'shop' ? 230 : 200 }, lineSpacing: 5, padding: { x: 5, y: 5 },
      }).setOrigin(0.5));
      children.push(this.add.text(x, type === 'shop' ? 450 : 480, choice.cost === 0 ? '무료' : `재 ${choice.cost}${affordable ? '' : ' · 부족'}`, {
        fontSize: '17px', color: affordable ? '#f7c86a' : '#c46a72', fontStyle: 'bold', padding: { x: 4, y: 4 },
      }).setOrigin(0.5));
    });
    if (type === 'shop') {
      const rerolled = this.rerolledUpgradeRooms.has(this.roomIndex);
      const rerollButton = this.add.rectangle(GAME_WIDTH / 2, 515, 360, 42, rerolled ? 0x302b34 : 0x51405b, 0.98)
        .setStrokeStyle(2, rerolled ? 0x625968 : 0xd0a4e8, 1);
      if (!rerolled) {
        rerollButton.setInteractive({ useHandCursor: true });
        rerollButton.on('pointerover', () => rerollButton.setFillStyle(0x684e73, 1));
        rerollButton.on('pointerout', () => rerollButton.setFillStyle(0x51405b, 0.98));
        rerollButton.on('pointerdown', () => this.rerollShopChoices());
      }
      children.push(rerollButton);
      children.push(this.add.text(GAME_WIDTH / 2, 515,
        rerolled ? '이 상점의 재추첨을 사용했습니다' : `재 ${UPGRADE_REROLL_COST}로 상품 재추첨  ·  R`, {
          fontSize: '17px', color: rerolled ? '#887e8c' : '#f0d9ff', fontStyle: 'bold', padding: { x: 5, y: 4 },
        }).setOrigin(0.5));

      const leaveButton = this.add.rectangle(GAME_WIDTH / 2, 570, 360, 46, 0x302837, 0.98)
        .setStrokeStyle(2, 0x9c8ba8, 1)
        .setInteractive({ useHandCursor: true });
      leaveButton.on('pointerover', () => leaveButton.setFillStyle(0x44384d, 1));
      leaveButton.on('pointerout', () => leaveButton.setFillStyle(0x302837, 0.98));
      leaveButton.on('pointerdown', () => this.leaveShop());
      children.push(leaveButton);
      children.push(this.add.text(GAME_WIDTH / 2, 570, '거래하지 않고 나가기  ·  ESC / 4', {
        fontSize: '18px', color: '#ddd0e3', fontStyle: 'bold', padding: { x: 6, y: 5 },
      }).setOrigin(0.5));
    } else {
      const leaveButton = this.add.rectangle(GAME_WIDTH / 2, 570, 360, 54, 0x302837, 0.98)
        .setStrokeStyle(2, 0x9c8ba8, 1)
        .setInteractive({ useHandCursor: true });
      leaveButton.on('pointerover', () => leaveButton.setFillStyle(0x44384d, 1));
      leaveButton.on('pointerout', () => leaveButton.setFillStyle(0x302837, 0.98));
      leaveButton.on('pointerdown', () => this.leaveHealingRoom());
      children.push(leaveButton);
      children.push(this.add.text(GAME_WIDTH / 2, 570, '회복하지 않고 나가기  ·  ESC / 3', {
        fontSize: '18px', color: '#ddd0e3', fontStyle: 'bold', padding: { x: 6, y: 5 },
      }).setOrigin(0.5));
    }
    this.specialFeedbackText = this.add.text(GAME_WIDTH / 2, type === 'shop' ? 615 : 625, '', {
      fontSize: '18px', color: '#ff8f98', fontStyle: 'bold',
    }).setOrigin(0.5);
    children.push(this.specialFeedbackText);
    this.specialOverlay = this.add.container(0, 0, children).setDepth(100);
    this.publishAccessibleStatus();
  }

  private rerollShopChoices(): void {
    if (!this.awaitingSpecial || this.rooms[this.roomIndex].type !== 'shop'
      || this.rerolledUpgradeRooms.has(this.roomIndex)) return;
    if (this.ashes < UPGRADE_REROLL_COST) {
      this.specialFeedbackText?.setText(`재가 ${UPGRADE_REROLL_COST - this.ashes} 부족합니다.`);
      return;
    }
    const previousIds = UPGRADES
      .filter((upgrade) => this.specialChoices.some((choice) => choice.label === upgrade.name))
      .map((upgrade) => upgrade.id);
    this.ashes -= UPGRADE_REROLL_COST;
    this.rerolledUpgradeRooms.add(this.roomIndex);
    this.specialOverlay?.destroy(true);
    this.specialOverlay = undefined;
    this.specialFeedbackText = undefined;
    this.music.playEffect('select');
    this.showSpecialRoom('shop', previousIds);
    (this.specialFeedbackText as Phaser.GameObjects.Text | undefined)
      ?.setText(`재 ${UPGRADE_REROLL_COST}를 사용해 상품을 다시 불러왔습니다.`);
    this.persistProgress();
    this.updateHud();
  }

  private selectSpecialChoice(index: number): void {
    if (!this.awaitingSpecial) return;
    const choice = this.specialChoices[index];
    if (!choice) return;
    if (this.ashes < choice.cost) {
      this.specialFeedbackText?.setText(`재가 ${choice.cost - this.ashes} 부족합니다.`);
      return;
    }
    this.ashes -= choice.cost;
    this.persistProgress();
    this.music.playEffect('select');
    const result = choice.action();
    this.completeSpecialRoom(result);
  }

  private leaveShop(): void {
    if (!this.awaitingSpecial || this.rooms[this.roomIndex].type !== 'shop') return;
    this.roomCleared = true;
    this.awaitingSpecial = false;
    this.specialChoices = [];
    this.specialOverlay?.destroy(true);
    this.specialOverlay = undefined;
    this.specialFeedbackText = undefined;
    this.bannerText.setVisible(true);
    this.showAvailableExits(false);
    const message = '거래하지 않고 이동\n다시 방문하면 상품을 선택할 수 있습니다';
    this.bannerText.setText(message).setAlpha(1);
    this.time.delayedCall(2300, () => {
      if (this.bannerText.text === message) this.bannerText.setText('');
    });
    this.updateHud();
  }

  private leaveHealingRoom(): void {
    if (!this.awaitingSpecial || this.rooms[this.roomIndex].type !== 'healing') return;
    this.roomCleared = true;
    this.awaitingSpecial = false;
    this.specialChoices = [];
    this.specialOverlay?.destroy(true);
    this.specialOverlay = undefined;
    this.specialFeedbackText = undefined;
    this.bannerText.setVisible(true);
    this.showAvailableExits(false);
    const message = '회복하지 않고 이동\n다시 방문하면 회복을 선택할 수 있습니다';
    this.bannerText.setText(message).setAlpha(1);
    this.time.delayedCall(2300, () => {
      if (this.bannerText.text === message) this.bannerText.setText('');
    });
    this.updateHud();
  }

  private completeSpecialRoom(result: string): void {
    this.usedSpecialRooms.add(this.roomIndex);
    this.clearedRooms.add(this.roomIndex);
    this.roomCleared = true;
    this.awaitingSpecial = false;
    this.specialChoices = [];
    this.specialOverlay?.destroy(true);
    this.specialOverlay = undefined;
    this.specialFeedbackText = undefined;
    this.bannerText.setVisible(true);
    this.showAvailableExits(false);
    const message = `${result}\n이동할 방향을 선택하세요`;
    this.bannerText.setText(message).setAlpha(1);
    this.time.delayedCall(2300, () => {
      if (this.bannerText.text === message) this.bannerText.setText('');
    });
    this.updateHud();
  }

  private selectUpgrade(index: number): void {
    if (!this.awaitingUpgrade) return;
    const upgrade = this.upgradeChoices[index];
    if (!upgrade) return;
    this.music.playEffect('select');
    const nextLevel = this.grantUpgrade(upgrade);
    this.awaitingUpgrade = false;
    this.upgradeRerollMessage = '';
    this.upgradeChoices = [];
    this.upgradeOverlay?.destroy(true);
    this.upgradeOverlay = undefined;
    this.bannerText.setVisible(true);
    this.updateBuildText();
    this.showAvailableExits(false);
    const acquiredMessage = `${upgrade.name} Lv.${nextLevel} 획득\n이동할 방향을 선택하세요`;
    this.bannerText.setText(acquiredMessage).setAlpha(1);
    this.time.delayedCall(2300, () => {
      if (this.bannerText.text === acquiredMessage) this.bannerText.setText('');
    });
    this.updateHud();
  }

  private grantUpgrade(upgrade: UpgradeDefinition): number {
    const nextLevel = (this.acquiredUpgrades.get(upgrade.id) ?? 0) + 1;
    this.acquiredUpgrades.set(upgrade.id, nextLevel);
    this.applyUpgrade(upgrade.id);
    this.updateBuildText();
    return nextLevel;
  }

  private grantMidBossBonusUpgrade(): UpgradeDefinition {
    const upgrade = Phaser.Utils.Array.GetRandom(UPGRADES);
    const bonusLevel = (this.midBossBonusUpgrades.get(upgrade.id) ?? 0) + 1;
    const totalLevel = (this.acquiredUpgrades.get(upgrade.id) ?? 0) + 1;
    this.midBossBonusUpgrades.set(upgrade.id, bonusLevel);
    this.acquiredUpgrades.set(upgrade.id, totalLevel);
    this.applyUpgrade(upgrade.id);
    this.midBossRewardMessage = `중간보스 격파 보너스 · ${upgrade.name} +1 (${this.formatTemporaryUpgradeLevel(upgrade.id)})`;
    this.updateBuildText();
    return upgrade;
  }

  private getRegularUpgradeLevel(id: UpgradeId): number {
    return Math.max(0, (this.acquiredUpgrades.get(id) ?? 0) - (this.midBossBonusUpgrades.get(id) ?? 0));
  }

  private formatTemporaryUpgradeLevel(id: UpgradeId, regularLevel = this.getRegularUpgradeLevel(id)): string {
    const bonusLevel = this.midBossBonusUpgrades.get(id) ?? 0;
    return bonusLevel > 0 ? `Lv.${regularLevel}+${bonusLevel}` : `Lv.${regularLevel}`;
  }

  private applyUpgrade(id: UpgradeId): void {
    if (id === 'attackPower') this.attackDamage += 10;
    if (id === 'attackSpeed') this.attackCooldown = Math.max(170, Math.round(this.attackCooldown * 0.94));
    if (id === 'attackRange') {
      this.attackRange = Math.round(this.attackRange * 1.1);
      this.attackArcAngle *= 1.1;
    }
    if (id === 'maxHealth') {
      this.maxHp += 5;
      this.hp = Math.min(this.maxHp, this.hp + 5);
    }
    if (id === 'moveSpeed') this.moveSpeed += 12.5;
    if (id === 'dashCooldown') this.dashCooldown = Math.max(100, this.dashCooldown - 200);
    if (id === 'dashDuration') this.dashDuration += 100;
    if (id === 'roomRecovery') this.roomRecovery += 4;
    if (id === 'criticalChance') this.criticalChance = Math.min(0.5, this.criticalChance + 0.1);
    if (id === 'ashArmor') this.damageReduction = Math.min(0.4, this.damageReduction + 0.04);
  }

  private updateBuildText(): void {
    const entries = [...this.acquiredUpgrades.entries()];
    const permanentEntries = [...this.permanentUpgradeLevels.entries()];
    if (entries.length === 0 && permanentEntries.length === 0) {
      this.buildText.setText(`현재 무기 · ${WEAPONS[this.weapon].name}\n현재 강화\n없음`);
      return;
    }
    const permanentVisible = permanentEntries.map(([id, level]) => {
      const definition = PERMANENT_UPGRADES.find((upgrade) => upgrade.id === id);
      return `영구 · ${definition?.name ?? id} Lv.${level}`;
    });
    const remainingSlots = Math.max(0, 6 - permanentVisible.length);
    const visible = entries.slice(0, remainingSlots).map(([id]) => {
      const definition = UPGRADES.find((upgrade) => upgrade.id === id);
      return `${definition?.name ?? id} ${this.formatTemporaryUpgradeLevel(id)}`;
    });
    const rest = entries.length > remainingSlots ? `외 ${entries.length - remainingSlots}종` : '';
    this.buildText.setText([`현재 무기 · ${WEAPONS[this.weapon].name}`, '현재 강화', ...permanentVisible, ...visible, rest].filter(Boolean).join('\n'));
  }

  private showAvailableExits(announce: boolean): void {
    const room = this.rooms[this.roomIndex];
    this.roomCleared = true;
    Object.entries(room.exits).forEach(([direction, target]) => {
      const typedDirection = direction as Direction;
      this.revealedRooms.add(target);
      const portal = this.exitPortals[typedDirection];
      const destinationStyle = ROOM_PORTAL_STYLE[this.rooms[target].type];
      portal.setFillStyle(destinationStyle.fill, 0.28).setStrokeStyle(4, destinationStyle.stroke, 1);
      portal.setVisible(true).setAlpha(0.35).setScale(0.9);
      this.exitLabels[typedDirection]
        .setText(`${EXIT_LABELS[typedDirection]} · ${destinationStyle.label}`)
        .setColor(destinationStyle.text)
        .setVisible(true);
      this.tweens.add({
        targets: portal,
        alpha: { from: 0.35, to: 1 }, scale: { from: 0.9, to: 1.12 },
        duration: 650, yoyo: true, repeat: -1,
      });
    });
    if (announce) this.bannerText.setText('방 정화 완료\n이동할 방향을 선택하세요').setAlpha(1);
    this.updateHud();
  }

  private checkExitCollision(): void {
    const room = this.rooms[this.roomIndex];
    for (const direction of DIRECTIONS) {
      const target = room.exits[direction];
      if (target === undefined || !this.exitPortals[direction].visible) continue;
      const portal = this.exitPortals[direction];
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, portal.x, portal.y) < 56) {
        this.enterExit(direction, target);
        return;
      }
    }
  }

  private enterExit(direction: Direction, target: number): void {
    this.transitioning = true;
    this.player.setVelocity(0);
    this.hideAllExits();
    this.bannerText.setText('다음 방으로 이동 중...');
    this.time.delayedCall(420, () => this.startRoom(target, OPPOSITE[direction]));
  }

  private finishRun(): void {
    this.runFinished = true;
    this.transitioning = false;
    this.player.setPosition(GAME_WIDTH / 2, GAME_HEIGHT / 2).setVelocity(0);
    this.hideBossHud();
    this.music.setMode('exploration');
    this.bannerText.setVisible(false);
    this.roomText.setText('화로의 수문장 처치 · 탈출 성공');
    const clearedIndex = DIFFICULTY_ORDER.indexOf(this.difficulty);
    const unlockedIndex = DIFFICULTY_ORDER.indexOf(this.highestUnlockedDifficulty);
    if (clearedIndex >= unlockedIndex && clearedIndex < DIFFICULTY_ORDER.length - 1) {
      this.newlyUnlockedDifficulty = DIFFICULTY_ORDER[clearedIndex + 1];
      this.highestUnlockedDifficulty = this.newlyUnlockedDifficulty;
    }
    this.ashes = 0;
    this.permanentUpgradeLevels.clear();
    this.persistProgress();
    this.updateHud();
    this.showEndingCredits();
  }

  private showEndingCredits(): void {
    const depth = 100;
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x08060d, 0.98)
      .setDepth(depth).setInteractive();

    const credits = [
      'ENDING CREDITS',
      '',
      'GAME DESIGN & DEVELOPMENT',
      '개인 참가작',
      '',
      'GAME ENGINE',
      'Phaser · TypeScript · Vite',
      '',
      'AI COLLABORATION',
      'OpenAI Codex',
      '',
      'ART & ANIMATION',
      'AI 생성 원본 에셋 · Phaser 애니메이션',
      '',
      'MUSIC & SOUND',
      'Web Audio 기반 배경음악 및 전투 효과음',
      '',
      'SPECIAL THANKS',
      '심연의 화로를 플레이해 주신 모든 분께',
      '',
      'THANK YOU FOR PLAYING',
    ].join('\n');

    const creditsText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 55, credits, {
      fontSize: '18px', color: '#d8c9dc', align: 'center', lineSpacing: 8,
    }).setOrigin(0.5, 0).setDepth(depth + 1);

    this.tweens.add({
      targets: creditsText,
      y: 20,
      duration: 22000,
      ease: 'Linear',
    });

    this.add.rectangle(GAME_WIDTH / 2, 125, GAME_WIDTH, 250, 0x08060d, 1).setDepth(depth + 2);
    this.add.text(GAME_WIDTH / 2, 52, '심연의 화로', {
      fontSize: '42px', color: '#f7c86a', fontStyle: 'bold',
      stroke: '#512239', strokeThickness: 6, padding: { x: 10, y: 8 },
    }).setOrigin(0.5).setDepth(depth + 3);
    this.add.text(GAME_WIDTH / 2, 113, this.newlyUnlockedDifficulty
      ? `${DIFFICULTY_LABELS[this.newlyUnlockedDifficulty]} 해금 · 재와 화로 강화 초기화`
      : '난이도 클리어 · 재와 화로 강화가 초기화되었습니다.', {
      fontSize: '19px', color: '#cdbbd2',
    }).setOrigin(0.5).setDepth(depth + 3);
    this.add.text(GAME_WIDTH / 2, 164,
      `${DIFFICULTY_LABELS[this.difficulty]} 클리어  ·  탐색 ${this.visitedRooms.size}/${this.rooms.length}  ·  처치 ${this.kills}  ·  보유 재 ${this.ashes}`, {
        fontSize: '18px', color: '#91e3bd', fontStyle: 'bold',
        backgroundColor: '#14251fe6', padding: { x: 18, y: 9 },
      }).setOrigin(0.5).setDepth(depth + 3);

    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT - 34, GAME_WIDTH, 68, 0x08060d, 1).setDepth(depth + 2);
    const retryButton = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT - 38, 250, 44, 0x51324a, 1)
      .setStrokeStyle(2, 0xf1c46b, 1).setInteractive({ useHandCursor: true }).setDepth(depth + 3);
    const retryText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 38, 'R 키 / 클릭 · 다시 도전', {
      fontSize: '17px', color: '#ffe5a5', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(depth + 4);
    retryButton.on('pointerover', () => retryButton.setFillStyle(0x72435e, 1));
    retryButton.on('pointerout', () => retryButton.setFillStyle(0x51324a, 1));
    retryButton.on('pointerdown', () => this.scene.restart());
    retryText.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.scene.restart());
  }

  private createExitPortals(): void {
    const positions: Record<Direction, [number, number, string]> = {
      up: [GAME_WIDTH / 2, 82, EXIT_LABELS.up],
      down: [GAME_WIDTH / 2, GAME_HEIGHT - 82, EXIT_LABELS.down],
      left: [66, GAME_HEIGHT / 2, EXIT_LABELS.left],
      right: [GAME_WIDTH - 66, GAME_HEIGHT / 2, EXIT_LABELS.right],
    };
    this.exitPortals = {} as Record<Direction, Phaser.GameObjects.Arc>;
    this.exitLabels = {} as Record<Direction, Phaser.GameObjects.Text>;
    DIRECTIONS.forEach((direction) => {
      const [x, y, label] = positions[direction];
      this.exitPortals[direction] = this.add.circle(x, y, 27, 0x8ee7f2, 0.2)
        .setStrokeStyle(4, 0xbef4ff, 0.95).setVisible(false).setDepth(3);
      const labelX = direction === 'left' ? x + 54 : direction === 'right' ? x - 54 : x;
      const labelY = direction === 'up' ? y + 45 : direction === 'down' ? y - 45 : y;
      this.exitLabels[direction] = this.add.text(labelX, labelY, label, {
        fontSize: '15px', color: '#bef4ff', fontStyle: 'bold',
      }).setOrigin(0.5).setVisible(false).setDepth(22);
    });
  }

  private hideAllExits(): void {
    if (!this.exitPortals) return;
    DIRECTIONS.forEach((direction) => {
      this.tweens.killTweensOf(this.exitPortals[direction]);
      this.exitPortals[direction].setVisible(false).setScale(1);
      this.exitLabels[direction].setVisible(false);
    });
  }

  private updateHud(): void {
    this.hpText.setText(`생명  ${this.hp} / ${this.maxHp}`);
    const state = this.roomCleared ? '문 개방' : `적 ${this.enemies?.countActive(true) ?? 0}`;
    this.statusText.setText(`재 ${this.ashes}  ·  탐색 ${this.visitedRooms.size}/${this.rooms.length}  ·  ${state}  ·  처치 ${this.kills}`);
    this.drawMiniMap();
    this.publishAccessibleStatus();
  }

  private drawMiniMap(): void {
    if (!this.miniMapGraphics) return;
    const originX = GAME_WIDTH - 132;
    const originY = 106;
    const gap = 34;
    this.miniMapGraphics.clear();

    this.rooms.forEach((room) => {
      if (!this.revealedRooms.has(room.id)) return;
      Object.values(room.exits).forEach((targetId) => {
        const target = this.rooms[targetId];
        if (!this.revealedRooms.has(targetId)) return;
        this.miniMapGraphics.lineStyle(3, 0x4c4354, 0.8);
        this.miniMapGraphics.lineBetween(
          originX + room.mapX * gap, originY + room.mapY * gap,
          originX + target.mapX * gap, originY + target.mapY * gap,
        );
      });
    });

    this.rooms.forEach((room) => {
      const x = originX + room.mapX * gap;
      const y = originY + room.mapY * gap;
      const revealed = this.revealedRooms.has(room.id);
      let color = 0x29242f;
      if (revealed) {
        color = room.type === 'boss' ? 0xd95763
          : room.type === 'midboss' ? 0xa56de2
            : room.type === 'healing' ? 0x4f8ed8
              : room.type === 'shop' ? 0xe0ac3f
                : 0x766b82;
      }
      if (this.clearedRooms.has(room.id) && room.type === 'combat') color = 0x58a6a6;
      if (room.id === this.roomIndex) color = 0xf7c86a;
      const radius = room.type === 'boss' && revealed ? 9
        : room.type === 'midboss' && revealed ? 8
          : room.type === 'healing' && revealed ? 8
            : 7;
      this.miniMapGraphics.fillStyle(color, 1).fillCircle(x, y, radius);
      if (room.type === 'healing' && revealed) {
        this.miniMapGraphics.lineStyle(3, 0x9bd5ff, 1).strokeCircle(x, y, 11);
      }
      if (room.id === this.roomIndex) {
        this.miniMapGraphics.lineStyle(2, 0xfff1c7, 1).strokeCircle(x, y, room.type === 'healing' ? 14 : 11);
      }
    });
  }

  private publishAccessibleStatus(): void {
    const status = document.querySelector<HTMLDivElement>('#game-status');
    if (!status) return;
    const exits = this.roomCleared && !this.awaitingUpgrade && !this.awaitingSpecial ? Object.keys(this.rooms[this.roomIndex].exits) : [];
    const activeEnemies = this.enemies.getChildren().filter((child) => (child as Enemy).active) as Enemy[];
    const nearestEnemyDistance = activeEnemies.length === 0 ? null : Math.round(Math.min(
      ...activeEnemies.map((enemy) => Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.x, enemy.y)),
    ));
    const enemiesOutOfBounds = activeEnemies.filter((enemy) => (
      enemy.x < 42 || enemy.x > GAME_WIDTH - 42 || enemy.y < 63 || enemy.y > GAME_HEIGHT - 63
    )).length;
    const upgrades = [...this.acquiredUpgrades.entries()].map(([id, level]) => ({
      id,
      level,
      regularLevel: this.getRegularUpgradeLevel(id),
      midBossBonusLevel: this.midBossBonusUpgrades.get(id) ?? 0,
    }));
    const permanentUpgrades = PERMANENT_UPGRADES.map((upgrade) => {
      const level = this.permanentUpgradeLevels.get(upgrade.id) ?? 0;
      return {
        id: upgrade.id,
        level,
        maxLevel: upgrade.maxLevel,
        cost: level >= upgrade.maxLevel ? null : getPermanentUpgradeCost(upgrade, level),
      };
    });
    const boss = this.getActiveBoss();
    const midboss = this.getActiveMidBoss();
    const wallGeometry = this.roomUsesWallVolley(this.rooms[this.roomIndex])
      ? this.getBossWallVolleyGeometry(this.bossWallVolleyFlipped)
      : null;
    status.textContent = JSON.stringify({
      gameStarted: this.gameStarted,
      difficulty: this.difficulty,
      highestUnlockedDifficulty: this.highestUnlockedDifficulty,
      countdownActive: this.countdownActive,
      countdown: this.countdownValue,
      musicMode: this.music.currentMode,
      audioState: this.music.audioState,
      lastSoundEffect: this.music.lastEffect,
      playerAnimation: this.player.anims.currentAnim?.key ?? null,
      playerMoving: this.player.body ? this.player.body.velocity.lengthSq() > 16 : false,
      hp: this.hp,
      room: this.roomIndex,
      roomName: this.rooms[this.roomIndex].name,
      roomType: this.rooms[this.roomIndex].type,
      bossRoom: this.rooms[this.roomIndex].type === 'boss',
      roomLayout: this.rooms.map((room) => ({ id: room.id, type: room.type })),
      bossHp: boss ? Math.max(0, Math.ceil(boss.hp)) : null,
      bossMaxHp: boss?.maxHp ?? null,
      bossPhase: boss ? this.getBossPhase(boss) : null,
      bossInvulnerable: boss ? this.time.now < (boss.phaseInvulnerableUntil ?? 0) : false,
      midbossHp: midboss ? Math.max(0, Math.ceil(midboss.hp)) : null,
      midbossMaxHp: midboss?.maxHp ?? null,
      midbossAnimation: midboss?.anims.currentAnim?.key ?? null,
      midbossAttackRange: MIDBOSS_ATTACK_RANGE,
      enemyKinds: activeEnemies.reduce<Partial<Record<EnemyKind, number>>>((counts, enemy) => {
        counts[enemy.kind] = (counts[enemy.kind] ?? 0) + 1;
        return counts;
      }, {}),
      bossTelegraphActive: this.bossTelegraphActive,
      midBossTelegraphActive: this.midBossWarningText?.visible ?? false,
      wallTelegraphActive: this.pendingBossWallVolley,
      wallFireballs: this.enemyProjectiles.getChildren().filter((child) => (
        (child as EnemyProjectile).active && (child as EnemyProjectile).source === 'wall'
      )).length,
      wallVolleyShape: wallGeometry ? {
        horizontal: wallGeometry.horizontalRows.length,
        vertical: wallGeometry.verticalColumns.length,
      } : null,
      ashes: this.ashes,
      paused: this.gamePaused,
      settingsOpen: Boolean(this.settingsOverlay),
      statsOpen: Boolean(this.statsOverlay),
      volumes: this.settings,
      visitedRooms: this.visitedRooms.size,
      clearedRooms: this.clearedRooms.size,
      enemies: this.enemies?.countActive(true) ?? 0,
      nearestEnemyDistance,
      enemiesOutOfBounds,
      awaitingUpgrade: this.awaitingUpgrade,
      awaitingSpecial: this.awaitingSpecial,
      awaitingMidBossReward: this.awaitingMidBossReward,
      awaitingPermanentUpgrade: this.awaitingPermanentUpgrade,
      awaitingWeaponSelection: this.awaitingWeaponSelection,
      weaponChoices: this.awaitingWeaponSelection ? WEAPON_ORDER : [],
      selectedWeapon: this.weapon,
      specialRoomUsed: this.usedSpecialRooms.has(this.roomIndex),
      specialChoices: this.specialChoices.map((choice) => ({ label: choice.label, cost: choice.cost })),
      offeredUpgrades: this.upgradeChoices.map((upgrade) => upgrade.id),
      upgradeReroll: {
        cost: UPGRADE_REROLL_COST,
        usedInCurrentRoom: this.rerolledUpgradeRooms.has(this.roomIndex),
        available: this.awaitingUpgrade && !this.rerolledUpgradeRooms.has(this.roomIndex),
      },
      offeredPermanentUpgrades: this.permanentUpgradeChoices.map((upgrade) => upgrade.id),
      upgrades,
      permanentUpgrades,
      combatStats: {
        weapon: this.weapon,
        attackDamage: this.attackDamage,
        attackCooldown: this.attackCooldown,
        attackRange: this.attackRange,
        maxHp: this.maxHp,
        moveSpeed: this.moveSpeed,
        dashCooldown: this.dashCooldown,
        dashDuration: this.dashDuration,
        roomRecovery: this.roomRecovery,
        combatClearRecovery: 6 + this.roomRecovery,
        criticalChance: this.criticalChance,
        damageReduction: this.damageReduction,
      },
      availableExits: exits,
      lastCombatRecovery: this.lastCombatRecovery ?? null,
      runFinished: this.runFinished,
      restartAvailable: this.hp <= 0 || this.runFinished,
      hasSavedProgress: this.hasSavedProgress,
      startChoices: !this.gameStarted && !this.countdownActive && !this.awaitingWeaponSelection
        ? this.hasSavedProgress ? ['continue_saved_progress', 'new_game_reset_progress'] : ['start_game']
        : [],
      deathChoices: this.hp <= 0 && !this.awaitingPermanentUpgrade
        ? ['continue_to_permanent_upgrades', 'new_game_reset_all']
        : [],
    });
  }

  private resetRunState(): void {
    this.skipNextPersistence = false;
    this.rooms = createRandomRoomLayout();
    this.weapon = 'sword';
    this.hp = 50; this.maxHp = 50; this.kills = 0; this.ashes = 0; this.roomIndex = 0;
    this.attackDamage = WEAPONS.sword.attackDamage; this.attackCooldown = WEAPONS.sword.attackCooldown;
    this.attackRange = WEAPONS.sword.attackRange; this.attackArcAngle = WEAPONS.sword.attackArcAngle;
    this.moveSpeed = 260; this.dashSpeed = 620; this.dashCooldown = 1000; this.dashDuration = BASE_STATS.dashDuration;
    this.roomRecovery = 0; this.lastCombatRecovery = undefined; this.criticalChance = 0; this.damageReduction = 0;
    this.lastAttackAt = -1000; this.playerAttackingUntil = 0; this.currentAttackFacing = 0;
    this.lastDashAt = -2000; this.invulnerableUntil = 0; this.playerKnockbackUntil = 0;
    this.transitionLockUntil = 0; this.roomCleared = false; this.transitioning = false; this.runFinished = false; this.gameStarted = false;
    this.countdownActive = false; this.countdownValue = 0; this.gamePaused = false;
    this.awaitingUpgrade = false; this.awaitingSpecial = false; this.awaitingPermanentUpgrade = false;
    this.awaitingWeaponSelection = false; this.awaitingMidBossReward = false;
    this.acquiredUpgrades = new Map<UpgradeId, number>(); this.midBossBonusUpgrades = new Map<UpgradeId, number>();
    this.permanentUpgradeLevels = new Map<PermanentUpgradeId, number>();
    this.upgradeChoices = []; this.permanentUpgradeChoices = []; this.rerolledUpgradeRooms = new Set<number>();
    this.shopUpgradeChoicesByRoom = new Map<number, UpgradeId[]>(); this.upgradeRerollMessage = ''; this.midBossRewardMessage = '';
    this.upgradeOverlay = undefined; this.specialOverlay = undefined; this.specialChoices = []; this.specialFeedbackText = undefined;
    this.midBossRewardOverlay = undefined;
    this.restartOverlay = undefined; this.permanentOverlay = undefined; this.weaponOverlay = undefined;
    this.weaponSelectionCallback = undefined; this.permanentPurchaseMessage = '';
    this.startOverlay = undefined; this.pauseOverlay = undefined; this.settingsOverlay = undefined; this.statsOverlay = undefined;
    this.bossTelegraphActive = false;
    this.pendingBossWallVolley = false; this.pendingBossWallVolleyFlipped = false;
    this.difficulty = 'easy'; this.highestUnlockedDifficulty = 'easy'; this.newlyUnlockedDifficulty = undefined;
    this.debugInvincible = false;
    this.clearedRooms = new Set<number>();
    this.usedSpecialRooms = new Set<number>();
    this.visitedRooms = new Set<number>();
    this.revealedRooms = new Set<number>([0]);
    this.loadPersistedProgress();
  }

  private loadPersistedProgress(): void {
    this.hasSavedProgress = hasStoredRogueliteProgress();
    const progress = loadRogueliteProgress();
    this.ashes = progress.ashes;
    this.settings = { ...progress.settings };
    this.highestUnlockedDifficulty = progress.highestUnlockedDifficulty;
    this.difficulty = this.highestUnlockedDifficulty;
    this.music.setVolumes(this.settings.musicVolume, this.settings.effectsVolume);
    this.permanentUpgradeLevels.clear();
    PERMANENT_UPGRADES.forEach((upgrade) => {
      const savedLevel = progress.permanentUpgrades[upgrade.id];
      if (typeof savedLevel !== 'number' || !Number.isFinite(savedLevel)) return;
      const level = Phaser.Math.Clamp(Math.floor(savedLevel), 0, upgrade.maxLevel);
      if (level > 0) this.permanentUpgradeLevels.set(upgrade.id, level);
    });
    this.resetTemporaryUpgrades();
    this.hp = this.maxHp;
  }

  private persistProgress(): void {
    const permanentUpgrades: Partial<Record<PermanentUpgradeId, number>> = {};
    this.permanentUpgradeLevels.forEach((level, id) => {
      permanentUpgrades[id] = level;
    });
    saveRogueliteProgress({
      version: 1,
      ashes: this.ashes,
      permanentUpgrades,
      highestUnlockedDifficulty: this.highestUnlockedDifficulty,
      settings: { ...this.settings },
    });
  }

  private applyCharacterOutline(sprite: Phaser.Physics.Arcade.Sprite, color: number, strength: number): void {
    try {
      sprite.filters?.external.addGlow(color, strength, 0, 1, false, 0.12, 5);
    } catch {
      // Canvas 렌더러처럼 필터를 지원하지 않는 환경에서는 원본 스프라이트를 그대로 사용한다.
    }
  }

  private drawArena(accent: number): void {
    this.arenaGraphics.clear();
    this.arenaGraphics.fillStyle(0x1b1623, 1).fillRoundedRect(34, 55, GAME_WIDTH - 68, GAME_HEIGHT - 110, 26);
    this.arenaGraphics.lineStyle(3, accent, 0.95).strokeRoundedRect(34, 55, GAME_WIDTH - 68, GAME_HEIGHT - 110, 26);
    this.arenaGraphics.lineStyle(1, accent, 0.22);
    for (let x = 80; x < GAME_WIDTH; x += 80) this.arenaGraphics.lineBetween(x, 70, x, GAME_HEIGHT - 70);
    for (let y = 90; y < GAME_HEIGHT; y += 80) this.arenaGraphics.lineBetween(50, y, GAME_WIDTH - 50, y);
    this.physics.world.setBounds(42, 63, GAME_WIDTH - 84, GAME_HEIGHT - 126);
  }

  private createAnimations(): void {
    const characterRates: Record<EnemyKind | 'player', number> = {
      player: 10, stalker: 12, brute: 7, archer: 9, midboss: 10, boss: 7,
    };
    Object.entries(characterRates).forEach(([key, frameRate]) => {
      const animationKey = `${key}-walk`;
      if (this.anims.exists(animationKey)) return;
      this.anims.create({
        key: animationKey,
        frames: this.anims.generateFrameNumbers(key, { start: 0, end: 3 }),
        frameRate,
        repeat: -1,
      });
    });
    ([
      ['player-spear-walk', 'playerSpear', 10],
      ['player-axe-walk', 'playerAxe', 8],
    ] as const).forEach(([key, texture, frameRate]) => {
      if (!this.anims.exists(key)) {
        this.anims.create({
          key,
          frames: this.anims.generateFrameNumbers(texture, { start: 0, end: 3 }),
          frameRate,
          repeat: -1,
        });
      }
    });
    if (!this.anims.exists('iceArrow-fly')) {
      this.anims.create({ key: 'iceArrow-fly', frames: this.anims.generateFrameNumbers('iceArrow', { start: 0, end: 3 }), frameRate: 14, repeat: -1 });
    }
    if (!this.anims.exists('fireball-fly')) {
      this.anims.create({ key: 'fireball-fly', frames: this.anims.generateFrameNumbers('fireball', { start: 0, end: 3 }), frameRate: 15, repeat: -1 });
    }
    if (!this.anims.exists('player-attack')) {
      this.anims.create({
        key: 'player-attack',
        frames: this.anims.generateFrameNumbers('playerAttack', { start: 0, end: 3 }),
        frameRate: 16,
        repeat: 0,
      });
    }
    ([
      ['player-spear-attack', 'playerSpearAttack', 16],
      ['player-axe-attack', 'playerAxeAttack', 8],
    ] as const).forEach(([key, texture, frameRate]) => {
      if (!this.anims.exists(key)) {
        this.anims.create({
          key,
          frames: this.anims.generateFrameNumbers(texture, { start: 0, end: 3 }),
          frameRate,
          repeat: 0,
        });
      }
    });
    if (!this.anims.exists('midboss-attack')) {
      this.anims.create({
        key: 'midboss-attack',
        frames: this.anims.generateFrameNumbers('midbossAttack', { start: 0, end: 3 }),
        frameRate: 5,
        repeat: 0,
      });
    }
  }
}
