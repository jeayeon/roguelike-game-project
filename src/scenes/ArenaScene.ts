import Phaser from 'phaser';
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
import { UPGRADES } from '../data/upgrades';
import type {
  Direction,
  Enemy,
  EnemyKind,
  EnemyProjectile,
  PermanentUpgradeDefinition,
  PermanentUpgradeId,
  RoomType,
  RoomDefinition,
  UpgradeDefinition,
  UpgradeId,
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
  boss: { fill: 0xd94b5b, stroke: 0xff8792, text: '#ff8792', label: '보스방' },
};

const ATTACK_ORIGIN_OFFSET = 18;

export class ArenaScene extends Phaser.Scene {
  private rooms: RoomDefinition[] = [];
  private player!: Phaser.Physics.Arcade.Image;
  private enemies!: Phaser.Physics.Arcade.Group;
  private enemyProjectiles!: Phaser.Physics.Arcade.Group;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private attackKey!: Phaser.Input.Keyboard.Key;
  private hp = 50;
  private maxHp = 50;
  private attackDamage = 34;
  private attackCooldown = ATTACK_COOLDOWN;
  private attackRange = 74;
  private attackArcAngle = 0.92;
  private moveSpeed = 260;
  private dashSpeed = 620;
  private dashCooldown = 1100;
  private dashDuration = 240;
  private roomRecovery = 0;
  private lastCombatRecovery?: { base: number; bonus: number; total: number; restored: number };
  private criticalChance = 0;
  private damageReduction = 0;
  private kills = 0;
  private ashes = 0;
  private roomIndex = 0;
  private lastAttackAt = -1000;
  private lastDashAt = -2000;
  private invulnerableUntil = 0;
  private transitionLockUntil = 0;
  private roomCleared = false;
  private transitioning = false;
  private runFinished = false;
  private gameStarted = false;
  private awaitingUpgrade = false;
  private awaitingSpecial = false;
  private awaitingPermanentUpgrade = false;
  private acquiredUpgrades = new Map<UpgradeId, number>();
  private permanentUpgradeLevels = new Map<PermanentUpgradeId, number>();
  private permanentUpgradeChoices: PermanentUpgradeDefinition[] = [];
  private upgradeChoices: UpgradeDefinition[] = [];
  private upgradeOverlay?: Phaser.GameObjects.Container;
  private specialOverlay?: Phaser.GameObjects.Container;
  private specialChoices: SpecialChoice[] = [];
  private specialFeedbackText?: Phaser.GameObjects.Text;
  private restartOverlay?: Phaser.GameObjects.Container;
  private permanentOverlay?: Phaser.GameObjects.Container;
  private permanentPurchaseMessage = '';
  private startOverlay?: Phaser.GameObjects.Container;
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
  private arenaGraphics!: Phaser.GameObjects.Graphics;
  private miniMapGraphics!: Phaser.GameObjects.Graphics;
  private bossHudGraphics!: Phaser.GameObjects.Graphics;
  private bossHealthText!: Phaser.GameObjects.Text;
  private bossWarningCircle!: Phaser.GameObjects.Arc;
  private bossWarningText!: Phaser.GameObjects.Text;
  private bossTelegraphGraphics!: Phaser.GameObjects.Graphics;
  private bossPhaseText!: Phaser.GameObjects.Text;
  private bossTelegraphActive = false;
  private debugInvincible = false;
  private exitPortals!: Record<Direction, Phaser.GameObjects.Arc>;
  private exitLabels!: Record<Direction, Phaser.GameObjects.Text>;

  constructor() {
    super('arena');
  }

  preload(): void {
    const characterAssetPath = `${import.meta.env.BASE_URL}assets/characters`;
    this.load.image('player', `${characterAssetPath}/player.png`);
    this.load.image('stalker', `${characterAssetPath}/stalker.png`);
    this.load.image('brute', `${characterAssetPath}/brute.png`);
    this.load.image('archer', `${characterAssetPath}/archer.png`);
    this.load.image('boss', `${characterAssetPath}/boss.png`);
  }

  create(): void {
    this.resetRunState();
    this.createTextures();
    this.cameras.main.setBackgroundColor('#120f19');

    this.arenaGraphics = this.add.graphics();
    this.miniMapGraphics = this.add.graphics().setDepth(21);
    this.drawArena(this.rooms[0].accent);

    this.player = this.physics.add.image(170, GAME_HEIGHT / 2, 'player');
    this.player.setDisplaySize(72, 72).setCircle(70, 58, 58)
      .setCollideWorldBounds(true).setDepth(6).setVisible(false);
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
    this.input.keyboard!.on('keydown-R', () => {
      if (this.awaitingPermanentUpgrade) this.startContinuedRun();
      else if (this.hp <= 0) this.continueFromBeginning();
      else if (this.runFinished) this.scene.restart();
    });
    this.input.keyboard!.on('keydown', (event: KeyboardEvent) => {
      if (!this.gameStarted && event.key === 'Enter') {
        this.beginGame();
        return;
      }
      const choiceIndex = Number(event.key) - 1;
      if (this.awaitingPermanentUpgrade) {
        if (choiceIndex >= 0 && choiceIndex < this.permanentUpgradeChoices.length) this.purchasePermanentUpgrade(choiceIndex);
        else if (event.key === 'Enter' || event.key === 'Escape' || event.key === '4') this.startContinuedRun();
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
      '이동 WASD/방향키  ·  공격 마우스 클릭/J  ·  대시 SPACE  ·  방 정리 후 방향문 선택', {
        fontSize: '17px', color: '#b7abbf',
      }).setOrigin(0.5, 1).setDepth(22);
    this.add.text(GAME_WIDTH - 35, 72, '탐색 지도', {
      fontSize: '15px', color: '#b7abbf', fontStyle: 'bold',
    }).setOrigin(1, 0).setDepth(22);

    this.time.addEvent({ delay: 500, loop: true, callback: () => this.publishAccessibleStatus() });
    this.showStartScreen();
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('debugAutoStart') === '1') {
      this.beginGame();
    }
  }

  private showStartScreen(): void {
    const children: Phaser.GameObjects.GameObject[] = [];
    children.push(this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0b0810, 0.97).setInteractive());
    children.push(this.add.text(GAME_WIDTH / 2, 145, '재의 귀환', {
      fontSize: '58px', color: '#f7c86a', fontStyle: 'bold',
      stroke: '#512239', strokeThickness: 8, padding: { x: 12, y: 10 },
    }).setOrigin(0.5));
    children.push(this.add.text(GAME_WIDTH / 2, 220, '갈림길을 탐색하고 재의 군주를 쓰러뜨리세요', {
      fontSize: '22px', color: '#d9c8dc', padding: { x: 6, y: 5 },
    }).setOrigin(0.5));
    children.push(this.add.text(GAME_WIDTH / 2, 315,
      '이동  WASD / 방향키\n공격  마우스 왼쪽 버튼 / J\n대시  SPACE\n방을 정리하고 방향문을 선택해 보스를 찾으세요', {
        fontSize: '20px', color: '#bcaec3', align: 'center', lineSpacing: 12,
        backgroundColor: '#17131de6', padding: { x: 28, y: 20 },
      }).setOrigin(0.5));
    const startButton = this.add.rectangle(GAME_WIDTH / 2, 505, 330, 74, 0x6f344f, 1)
      .setStrokeStyle(4, 0xf7c86a, 1).setInteractive({ useHandCursor: true });
    startButton.on('pointerover', () => startButton.setFillStyle(0x8a405f, 1));
    startButton.on('pointerout', () => startButton.setFillStyle(0x6f344f, 1));
    startButton.on('pointerdown', () => this.beginGame());
    children.push(startButton);
    children.push(this.add.text(GAME_WIDTH / 2, 505, '게임 시작', {
      fontSize: '28px', color: '#fff2ce', fontStyle: 'bold', padding: { x: 8, y: 6 },
    }).setOrigin(0.5));
    children.push(this.add.text(GAME_WIDTH / 2, 565, '버튼 클릭 또는 ENTER', {
      fontSize: '16px', color: '#91869a', padding: { x: 4, y: 3 },
    }).setOrigin(0.5));
    this.startOverlay = this.add.container(0, 0, children).setDepth(200);
    this.publishAccessibleStatus();
  }

  private beginGame(): void {
    if (this.gameStarted) return;
    this.gameStarted = true;
    this.startOverlay?.destroy(true);
    this.startOverlay = undefined;
    this.player.setVisible(true);

    const debugParams = new URLSearchParams(window.location.search);
    const debugWindow = window as Window & { __debugDeathTriggered?: boolean; __debugRunSeeded?: boolean };
    const debugRunSeeded = Boolean(debugWindow.__debugRunSeeded);
    const requestedRoom = Number(debugParams.get('debugRoom'));
    const hasRequestedRoom = debugParams.has('debugRoom');
    const requestedRoomType = debugParams.get('debugRoomType') as RoomType | null;
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
    if (!this.gameStarted || this.hp <= 0 || this.runFinished) return;
    if (this.awaitingUpgrade || this.awaitingSpecial) {
      this.player.setVelocity(0);
      return;
    }

    const direction = new Phaser.Math.Vector2(
      Number(this.cursors.right.isDown || this.wasd.right.isDown) - Number(this.cursors.left.isDown || this.wasd.left.isDown),
      Number(this.cursors.down.isDown || this.wasd.down.isDown) - Number(this.cursors.up.isDown || this.wasd.up.isDown),
    ).normalize();
    const dashing = time < this.invulnerableUntil && time - this.lastDashAt < 210;
    const speed = dashing ? this.dashSpeed : this.moveSpeed;
    this.player.setVelocity(direction.x * speed, direction.y * speed);

    if (Phaser.Input.Keyboard.JustDown(this.cursors.space) && time - this.lastDashAt >= this.dashCooldown) {
      this.lastDashAt = time;
      this.invulnerableUntil = time + this.dashDuration;
      this.player.setTint(0x9de8ff);
      this.time.delayedCall(this.dashDuration, () => this.player.active && this.player.clearTint());
    }

    const pointer = this.input.activePointer;
    // 전신 캐릭터 이미지는 조준 각도로 회전시키지 않고 좌우 방향만 전환한다.
    this.player.setRotation(0).setFlipX(pointer.worldX < this.player.x);
    this.updateEnemies(time);
    this.updateBossHud();
    this.removeOutOfBoundsProjectiles();

    if ((pointer.isDown || this.attackKey.isDown) && time - this.lastAttackAt >= this.attackCooldown) {
      this.attack();
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

    this.visitedRooms.add(index);
    this.revealedRooms.add(index);
    const roomLabel: Record<RoomType, string> = {
      combat: `방 ${index + 1}/${this.rooms.length}`, healing: '회복방', shop: '상점방', boss: '보스방',
    };
    this.roomText.setText(`${roomLabel[room.type]}  ·  ${room.name}`);

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
    this.player.setPosition(x, y).setVelocity(0).clearTint();
  }

  private spawnRoomEnemies(kinds: EnemyKind[]): void {
    const availablePositions: Array<[number, number]> = [
      [360, 130], [520, 150], [700, 130], [880, 150], [1080, 180],
      [360, 280], [560, 290], [760, 275], [960, 300], [1110, 360],
      [350, 440], [540, 470], [740, 455], [930, 475], [1080, 535],
      [460, 580], [680, 570], [870, 565],
    ];
    kinds.forEach((kind, index) => {
      const minimumDistance = kind === 'boss' ? 260 : MIN_ENEMY_SPAWN_DISTANCE;
      let position: [number, number];
      if (kind === 'boss') {
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
      const displaySize: Record<EnemyKind, number> = { stalker: 62, brute: 81, archer: 66, boss: 113 };
      enemy.setDisplaySize(displaySize[kind], displaySize[kind]);
      enemy.kind = kind;
      enemy.attackPending = false;
      enemy.bossPhase = kind === 'boss' ? 1 : undefined;
      enemy.lastHitAt = -1000;
      enemy.nextActionAt = this.time.now + 650 + index * 140;
      enemy.strafeDirection = index % 2 === 0 ? 1 : -1;

      if (kind === 'stalker') {
        enemy.maxHp = 52; enemy.speed = 118; enemy.hitRadius = 17; enemy.setCircle(72, 56, 56);
      } else if (kind === 'brute') {
        enemy.maxHp = 112; enemy.speed = 72; enemy.hitRadius = 25; enemy.setCircle(78, 50, 50);
      } else if (kind === 'archer') {
        enemy.maxHp = 68; enemy.speed = 88; enemy.hitRadius = 19; enemy.setCircle(73, 55, 55);
      } else {
        enemy.maxHp = 800; enemy.speed = 76; enemy.hitRadius = 35; enemy.setCircle(78, 50, 50);
      }
      enemy.hp = enemy.maxHp;
      enemy.setCollideWorldBounds(true).setBounce(0.15).setDepth(kind === 'boss' ? 5 : 4);
    });
  }

  private updateEnemies(time: number): void {
    this.enemies.getChildren().forEach((child) => {
      const enemy = child as Enemy;
      if (!enemy.active) return;
      const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, this.player.x, this.player.y);
      const distance = Phaser.Math.Distance.Between(enemy.x, enemy.y, this.player.x, this.player.y);

      if (enemy.kind === 'archer') {
        this.moveRangedEnemy(enemy, angle, distance);
        if (time >= enemy.nextActionAt && distance < 490) {
          enemy.nextActionAt = time + 1500;
          this.fireEnemyProjectile(enemy, angle, 10, 285);
        }
      } else if (enemy.kind === 'boss') {
        this.moveRangedEnemy(enemy, angle, distance, 285);
        if (enemy.attackPending) this.bossWarningCircle.setPosition(enemy.x, enemy.y);
        if (time >= enemy.nextActionAt && distance < 560 && !enemy.attackPending) this.queueBossAttack(enemy, time);
      } else {
        this.physics.velocityFromRotation(angle, enemy.speed, enemy.body!.velocity);
      }
    });
  }

  private getActiveBoss(): Enemy | undefined {
    return this.enemies.getChildren().find((child) => {
      const enemy = child as Enemy;
      return enemy.active && enemy.kind === 'boss';
    }) as Enemy | undefined;
  }

  private getBossPhase(boss: Enemy): 1 | 2 | 3 {
    const healthRatio = boss.hp / boss.maxHp;
    if (healthRatio > 0.65) return 1;
    if (healthRatio > 0.3) return 2;
    return 3;
  }

  private queueBossAttack(boss: Enemy, time: number): void {
    const phase = this.getBossPhase(boss);
    const patterns = {
      1: { name: '삼연 화염', warning: '3방향 탄막', windup: 520, interval: 1550 },
      2: { name: '부채꼴 폭발', warning: '5방향 탄막', windup: 450, interval: 1300 },
      3: { name: '재의 고리', warning: '전방위 탄막', windup: 360, interval: 1050 },
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
    boss.bossPhase = phase;
    boss.attackPending = false;
    boss.nextActionAt = this.time.now + 1100;
    boss.setVelocity(0).setTint(phase === 3 ? 0xff9a64 : 0xff6f81);
    this.clearBossTelegraph();
    const detail = phase === 2 ? '부채꼴 탄막 강화' : '최종 각성 · 전방위 탄막';
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
    this.time.delayedCall(380, () => boss.active && boss.clearTint());
  }

  private updateBossHud(): void {
    const boss = this.getActiveBoss();
    this.bossHudGraphics.clear();
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
    this.bossHealthText.setText(`재의 군주  ${Math.max(0, Math.ceil(boss.hp))} / ${boss.maxHp}  ·  ${phase}단계`).setVisible(true);
  }

  private clearBossTelegraph(): void {
    this.bossTelegraphActive = false;
    this.bossTelegraphGraphics.clear();
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
    const projectile = this.enemyProjectiles.create(enemy.x, enemy.y, 'enemyProjectile') as EnemyProjectile;
    projectile.damage = damage;
    projectile.setCircle(7, 2, 2).setDepth(6);
    if (enemy.kind === 'boss') projectile.setScale(1.35).setTint(0xff8e9b);
    this.physics.velocityFromRotation(angle, speed, projectile.body!.velocity);
    enemy.setTint(0xc5fbff);
    this.time.delayedCall(90, () => enemy.active && enemy.clearTint());
    this.time.delayedCall(3200, () => projectile.active && projectile.destroy());
  }

  private removeOutOfBoundsProjectiles(): void {
    this.enemyProjectiles.getChildren().forEach((child) => {
      const projectile = child as EnemyProjectile;
      if (projectile.x < 30 || projectile.x > GAME_WIDTH - 30 || projectile.y < 50 || projectile.y > GAME_HEIGHT - 50) {
        projectile.destroy();
      }
    });
  }

  private attack(): void {
    const now = this.time.now;
    if (now - this.lastAttackAt < this.attackCooldown || this.hp <= 0 || this.transitioning || this.awaitingUpgrade || this.awaitingSpecial) return;
    this.lastAttackAt = now;
    const pointer = this.input.activePointer;
    const facing = Phaser.Math.Angle.Between(this.player.x, this.player.y, pointer.worldX, pointer.worldY);
    const attackOrigin = this.getAttackOrigin(facing);
    this.showAttackVisual(facing);
    this.enemies.getChildren().forEach((child) => {
      const enemy = child as Enemy;
      if (!enemy.active || now - enemy.lastHitAt < 220) return;
      const distance = Phaser.Math.Distance.Between(attackOrigin.x, attackOrigin.y, enemy.x, enemy.y);
      const enemyAngle = Phaser.Math.Angle.Between(attackOrigin.x, attackOrigin.y, enemy.x, enemy.y);
      const delta = Math.abs(Phaser.Math.Angle.Wrap(enemyAngle - facing));
      const angularAllowance = distance <= enemy.hitRadius
        ? Math.PI
        : Math.asin(Math.min(1, enemy.hitRadius / distance));
      const touchesAttackRange = distance - enemy.hitRadius <= this.attackRange;
      const touchesAttackAngle = delta <= this.attackArcAngle + angularAllowance;
      if (touchesAttackRange && touchesAttackAngle) {
        enemy.lastHitAt = now;
        const critical = Math.random() < this.criticalChance;
        const damage = critical ? this.attackDamage * 2 : this.attackDamage;
        enemy.hp -= damage;
        if (enemy.kind === 'boss') {
          const nextPhase = this.getBossPhase(enemy);
          if (nextPhase > (enemy.bossPhase ?? 1)) this.handleBossPhaseTransition(enemy, nextPhase as 2 | 3);
          this.updateBossHud();
        }
        enemy.setTint(critical ? 0xffd76b : 0xffffff);
        this.time.delayedCall(70, () => enemy.active && enemy.clearTint());
        const force = enemy.kind === 'boss' ? 80 : 250;
        const knockback = new Phaser.Math.Vector2(enemy.x - this.player.x, enemy.y - this.player.y).normalize().scale(force);
        enemy.setVelocity(knockback.x, knockback.y);
        if (enemy.hp <= 0) {
          if (enemy.kind === 'boss') this.clearBossTelegraph();
          const ashReward: Record<EnemyKind, number> = { stalker: 2, brute: 4, archer: 3, boss: 33 };
          this.ashes += ashReward[enemy.kind];
          enemy.destroy();
          this.kills += 1;
          this.updateHud();
        }
      }
    });
  }

  private showAttackVisual(facing: number, duration = 260): void {
    const attackOrigin = this.getAttackOrigin(facing);
    this.drawAttackArc(facing);
    this.attackSlash
      .setPosition(attackOrigin.x, attackOrigin.y)
      .setDisplaySize(Math.max(50, this.attackRange - 12), 6)
      .setRotation(facing - this.attackArcAngle)
      .setAlpha(1)
      .setVisible(true);
    this.tweens.killTweensOf(this.attackSlash);
    this.tweens.add({
      targets: this.attackSlash,
      rotation: facing + this.attackArcAngle,
      alpha: 0.18,
      duration,
      ease: 'Sine.Out',
      onComplete: () => this.attackSlash.setVisible(false),
    });
    this.time.delayedCall(Math.round(duration * 0.85), () => this.attackArc.setVisible(false).clear());
  }

  private drawAttackArc(facing: number): void {
    const innerRadius = 14;
    const attackOrigin = this.getAttackOrigin(facing);
    this.attackArc.clear().setPosition(attackOrigin.x, attackOrigin.y).setVisible(true);
    this.attackArc.fillStyle(0xf7c86a, 0.2).lineStyle(3, 0xffd27a, 0.82);
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
    const damage = enemy.kind === 'boss' ? 28 : enemy.kind === 'brute' ? 20 : 12;
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
    this.player.setTint(0xff6b78);
    this.cameras.main.shake(100, 0.007);
    this.time.delayedCall(120, () => this.player.active && this.player.clearTint());
    this.updateHud();
    if (this.hp === 0) {
      this.clearBossTelegraph();
      this.player.setVelocity(0).setTint(0x4b4350);
      this.enemies.setVelocityX(0); this.enemies.setVelocityY(0);
      this.enemyProjectiles.setVelocityX(0); this.enemyProjectiles.setVelocityY(0);
      this.bannerText.setText('귀환 실패').setAlpha(1);
      this.showDeathChoices();
    }
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
    newGameButton.on('pointerdown', () => this.scene.restart());
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
    children.push(this.add.text(GAME_WIDTH / 2, 72, `귀환자의 화로 · 보유 재 ${this.ashes}`, {
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
    const nextLevel = level + 1;
    this.permanentUpgradeLevels.set(upgrade.id, nextLevel);
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
    this.maxHp = 50;
    this.attackDamage = 34;
    this.attackCooldown = ATTACK_COOLDOWN;
    this.attackRange = 74;
    this.attackArcAngle = 0.92;
    this.moveSpeed = 260;
    this.dashSpeed = 620;
    this.dashCooldown = 1100;
    this.dashDuration = 240;
    this.roomRecovery = 0;
    this.lastCombatRecovery = undefined;
    this.criticalChance = 0;
    this.damageReduction = 0;
    this.acquiredUpgrades.clear();
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
    this.invulnerableUntil = this.time.now + 1000;
    this.transitionLockUntil = 0;
    this.roomCleared = false;
    this.transitioning = false;
    this.runFinished = false;
    this.awaitingUpgrade = false;
    this.awaitingSpecial = false;
    this.upgradeChoices = [];
    this.specialChoices = [];
    this.upgradeOverlay?.destroy(true);
    this.specialOverlay?.destroy(true);
    this.upgradeOverlay = undefined;
    this.specialOverlay = undefined;
    this.specialFeedbackText = undefined;
    this.clearedRooms = new Set<number>();
    this.usedSpecialRooms = new Set<number>();
    this.visitedRooms = new Set<number>();
    this.revealedRooms = new Set<number>([0]);
    this.rooms = createRandomRoomLayout();
    this.bannerText.setVisible(true);
    this.startRoom(0);
    this.updateBuildText();
    this.updateHud();
  }

  private completeCurrentRoom(): void {
    const room = this.rooms[this.roomIndex];
    this.clearedRooms.add(room.id);
    this.roomCleared = true;
    this.enemyProjectiles.clear(true, true);
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
    this.updateHud();
    if (room.type === 'boss') {
      this.transitioning = true;
      this.hideBossHud();
      this.bannerText.setText('재의 군주 격파').setAlpha(1);
      this.time.delayedCall(850, () => this.finishRun());
      return;
    }
    this.showUpgradeSelection();
  }

  private showUpgradeSelection(): void {
    this.awaitingUpgrade = true;
    this.player.setVelocity(0);
    this.bannerText.setVisible(false);
    const eligible = UPGRADES.filter((upgrade) => (
      (this.acquiredUpgrades.get(upgrade.id) ?? 0) < upgrade.maxStacks
    ));
    this.upgradeChoices = Phaser.Utils.Array.Shuffle([...eligible]).slice(0, 3);

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
    children.push(this.add.text(GAME_WIDTH / 2, 185, '클릭하거나 숫자 1 · 2 · 3을 누르세요', {
      fontSize: '17px', color: '#b9adbF',
    }).setOrigin(0.5));

    const cardXs = [350, 640, 930];
    this.upgradeChoices.forEach((upgrade, index) => {
      const currentLevel = this.acquiredUpgrades.get(upgrade.id) ?? 0;
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
      children.push(this.add.text(cardXs[index], 475, `현재 Lv.${currentLevel}  →  Lv.${currentLevel + 1}`, {
        fontSize: '15px', color: '#a99caf',
      }).setOrigin(0.5));
    });

    this.upgradeOverlay = this.add.container(0, 0, children).setDepth(100);
    this.publishAccessibleStatus();
  }

  private showSpecialRoom(type: 'healing' | 'shop'): void {
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
          label: '생명의 제물', cost: 0,
          description: '최대 생명을 10 잃고 생명을 모두 회복합니다.',
          action: () => {
            this.maxHp = Math.max(20, this.maxHp - 10);
            this.hp = this.maxHp;
            return '최대 생명 10 감소 · 완전 회복';
          },
        },
      ];
    } else {
      const eligible = Phaser.Utils.Array.Shuffle(UPGRADES.filter((upgrade) => (
        (this.acquiredUpgrades.get(upgrade.id) ?? 0) < upgrade.maxStacks
      ))).slice(0, 2);
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
          description: `${shopUpgrade.description}\n즉시 Lv.${(this.acquiredUpgrades.get(shopUpgrade.id) ?? 0) + 1} 획득`,
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
      const leaveButton = this.add.rectangle(GAME_WIDTH / 2, 535, 360, 54, 0x302837, 0.98)
        .setStrokeStyle(2, 0x9c8ba8, 1)
        .setInteractive({ useHandCursor: true });
      leaveButton.on('pointerover', () => leaveButton.setFillStyle(0x44384d, 1));
      leaveButton.on('pointerout', () => leaveButton.setFillStyle(0x302837, 0.98));
      leaveButton.on('pointerdown', () => this.leaveShop());
      children.push(leaveButton);
      children.push(this.add.text(GAME_WIDTH / 2, 535, '거래하지 않고 나가기  ·  ESC / 4', {
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
    this.specialFeedbackText = this.add.text(GAME_WIDTH / 2, type === 'shop' ? 585 : 625, '', {
      fontSize: '18px', color: '#ff8f98', fontStyle: 'bold',
    }).setOrigin(0.5);
    children.push(this.specialFeedbackText);
    this.specialOverlay = this.add.container(0, 0, children).setDepth(100);
    this.publishAccessibleStatus();
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
    const nextLevel = this.grantUpgrade(upgrade);
    this.awaitingUpgrade = false;
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

  private applyUpgrade(id: UpgradeId): void {
    if (id === 'attackPower') this.attackDamage += 4;
    if (id === 'attackSpeed') this.attackCooldown = Math.max(170, Math.round(this.attackCooldown * 0.94));
    if (id === 'attackRange') {
      this.attackRange += 6;
      this.attackArcAngle += 0.04;
    }
    if (id === 'maxHealth') {
      this.maxHp += 5;
      this.hp = Math.min(this.maxHp, this.hp + 5);
    }
    if (id === 'moveSpeed') this.moveSpeed += 12.5;
    if (id === 'dashCooldown') this.dashCooldown = Math.max(500, this.dashCooldown - 100);
    if (id === 'dashDuration') this.dashDuration += 50;
    if (id === 'roomRecovery') this.roomRecovery += 4;
    if (id === 'criticalChance') this.criticalChance = Math.min(0.5, this.criticalChance + 0.05);
    if (id === 'ashArmor') this.damageReduction = Math.min(0.4, this.damageReduction + 0.04);
  }

  private updateBuildText(): void {
    const entries = [...this.acquiredUpgrades.entries()];
    const permanentEntries = [...this.permanentUpgradeLevels.entries()];
    if (entries.length === 0 && permanentEntries.length === 0) {
      this.buildText.setText('현재 강화\n없음');
      return;
    }
    const permanentVisible = permanentEntries.map(([id, level]) => {
      const definition = PERMANENT_UPGRADES.find((upgrade) => upgrade.id === id);
      return `영구 · ${definition?.name ?? id} Lv.${level}`;
    });
    const remainingSlots = Math.max(0, 6 - permanentVisible.length);
    const visible = entries.slice(0, remainingSlots).map(([id, level]) => {
      const definition = UPGRADES.find((upgrade) => upgrade.id === id);
      return `${definition?.name ?? id} Lv.${level}`;
    });
    const rest = entries.length > remainingSlots ? `외 ${entries.length - remainingSlots}종` : '';
    this.buildText.setText(['현재 강화', ...permanentVisible, ...visible, rest].filter(Boolean).join('\n'));
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
    this.bannerText.setText(`던전 돌파 성공\n탐색 ${this.visitedRooms.size}/${this.rooms.length} · R 키로 다시 도전`).setAlpha(1);
    this.roomText.setText('재의 군주 처치 완료');
    this.updateHud();
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
      let color = 0x29242f;
      if (this.revealedRooms.has(room.id)) {
        color = room.type === 'boss' ? 0xd95763 : room.type === 'healing' ? 0x64bd91 : room.type === 'shop' ? 0xe0ac3f : 0x766b82;
      }
      if (this.clearedRooms.has(room.id)) color = 0x58a6a6;
      if (room.id === this.roomIndex) color = 0xf7c86a;
      this.miniMapGraphics.fillStyle(color, 1).fillCircle(x, y, room.type === 'boss' && this.revealedRooms.has(room.id) ? 9 : 7);
      if (room.id === this.roomIndex) {
        this.miniMapGraphics.lineStyle(2, 0xfff1c7, 1).strokeCircle(x, y, 11);
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
    const upgrades = [...this.acquiredUpgrades.entries()].map(([id, level]) => ({ id, level }));
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
    status.textContent = JSON.stringify({
      gameStarted: this.gameStarted,
      hp: this.hp,
      room: this.roomIndex,
      roomName: this.rooms[this.roomIndex].name,
      roomType: this.rooms[this.roomIndex].type,
      bossRoom: this.rooms[this.roomIndex].type === 'boss',
      roomLayout: this.rooms.map((room) => ({ id: room.id, type: room.type })),
      bossHp: boss ? Math.max(0, Math.ceil(boss.hp)) : null,
      bossMaxHp: boss?.maxHp ?? null,
      bossPhase: boss ? this.getBossPhase(boss) : null,
      bossTelegraphActive: this.bossTelegraphActive,
      ashes: this.ashes,
      visitedRooms: this.visitedRooms.size,
      clearedRooms: this.clearedRooms.size,
      enemies: this.enemies?.countActive(true) ?? 0,
      nearestEnemyDistance,
      enemiesOutOfBounds,
      awaitingUpgrade: this.awaitingUpgrade,
      awaitingSpecial: this.awaitingSpecial,
      awaitingPermanentUpgrade: this.awaitingPermanentUpgrade,
      specialRoomUsed: this.usedSpecialRooms.has(this.roomIndex),
      specialChoices: this.specialChoices.map((choice) => ({ label: choice.label, cost: choice.cost })),
      offeredUpgrades: this.upgradeChoices.map((upgrade) => upgrade.id),
      offeredPermanentUpgrades: this.permanentUpgradeChoices.map((upgrade) => upgrade.id),
      upgrades,
      permanentUpgrades,
      combatStats: {
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
      deathChoices: this.hp <= 0 && !this.awaitingPermanentUpgrade
        ? ['continue_to_permanent_upgrades', 'new_game_reset_all']
        : [],
    });
  }

  private resetRunState(): void {
    this.rooms = createRandomRoomLayout();
    this.hp = 50; this.maxHp = 50; this.kills = 0; this.ashes = 0; this.roomIndex = 0;
    this.attackDamage = 34; this.attackCooldown = ATTACK_COOLDOWN; this.attackRange = 74; this.attackArcAngle = 0.92;
    this.moveSpeed = 260; this.dashSpeed = 620; this.dashCooldown = 1100; this.dashDuration = 240;
    this.roomRecovery = 0; this.lastCombatRecovery = undefined; this.criticalChance = 0; this.damageReduction = 0;
    this.lastAttackAt = -1000; this.lastDashAt = -2000; this.invulnerableUntil = 0;
    this.transitionLockUntil = 0; this.roomCleared = false; this.transitioning = false; this.runFinished = false; this.gameStarted = false;
    this.awaitingUpgrade = false; this.awaitingSpecial = false; this.awaitingPermanentUpgrade = false;
    this.acquiredUpgrades = new Map<UpgradeId, number>(); this.permanentUpgradeLevels = new Map<PermanentUpgradeId, number>();
    this.upgradeChoices = []; this.permanentUpgradeChoices = [];
    this.upgradeOverlay = undefined; this.specialOverlay = undefined; this.specialChoices = []; this.specialFeedbackText = undefined;
    this.restartOverlay = undefined; this.permanentOverlay = undefined; this.permanentPurchaseMessage = '';
    this.startOverlay = undefined; this.bossTelegraphActive = false;
    this.debugInvincible = false;
    this.clearedRooms = new Set<number>();
    this.usedSpecialRooms = new Set<number>();
    this.visitedRooms = new Set<number>();
    this.revealedRooms = new Set<number>([0]);
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

  private createTextures(): void {
    if (this.textures.exists('enemyProjectile')) return;
    const graphics = this.make.graphics({ x: 0, y: 0 });
    graphics.fillStyle(0x9cebf4).fillCircle(9, 9, 7);
    graphics.lineStyle(2, 0xe4fdff).strokeCircle(9, 9, 7);
    graphics.generateTexture('enemyProjectile', 18, 18).destroy();
  }
}
