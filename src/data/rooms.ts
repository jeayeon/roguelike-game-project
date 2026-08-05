import type { EnemyKind, RoomDefinition, RoomType } from '../types/game';

const GRID_SIZE = 4;

type CombatTemplate = Pick<RoomDefinition, 'name' | 'description' | 'accent'> & { enemies: EnemyKind[] };

const COMBAT_TEMPLATES: CombatTemplate[] = [
  { name: '잿빛 입구', description: '갈림길을 확보하세요', accent: 0x6f344f, enemies: ['stalker', 'stalker', 'stalker', 'stalker', 'stalker', 'stalker'] },
  { name: '속삭임의 회랑', description: '양쪽 전열을 무너뜨리세요', accent: 0x684263, enemies: ['stalker', 'stalker', 'stalker', 'stalker', 'brute', 'brute', 'archer', 'archer'] },
  { name: '북동 회랑', description: '좁은 길의 적들을 정리하세요', accent: 0x53607a, enemies: ['stalker', 'stalker', 'stalker', 'stalker', 'brute', 'archer', 'archer'] },
  { name: '서리 감시로', description: '사수의 시야를 뚫고 진입하세요', accent: 0x44657c, enemies: ['stalker', 'stalker', 'stalker', 'archer', 'archer', 'archer', 'archer'] },
  { name: '피의 정원', description: '빠른 추적자 무리를 베어내세요', accent: 0x7d3544, enemies: ['stalker', 'stalker', 'stalker', 'stalker', 'stalker', 'stalker', 'archer'] },
  { name: '갈림길 제단', description: '네 방향의 중심을 장악하세요', accent: 0x5c3e73, enemies: ['stalker', 'stalker', 'stalker', 'stalker', 'brute', 'brute', 'archer', 'archer'] },
  { name: '침묵의 감옥', description: '사수의 탄막 사이로 파고드세요', accent: 0x315f68, enemies: ['stalker', 'stalker', 'stalker', 'brute', 'brute', 'archer', 'archer', 'archer'] },
  { name: '깨진 성벽', description: '몰려드는 수호자들을 돌파하세요', accent: 0x5b536b, enemies: ['stalker', 'stalker', 'stalker', 'brute', 'brute', 'brute', 'archer', 'archer'] },
  { name: '무너진 교차로', description: '사방에서 몰려드는 적을 막으세요', accent: 0x625173, enemies: ['stalker', 'stalker', 'stalker', 'stalker', 'brute', 'brute', 'archer', 'archer', 'archer'] },
  { name: '망각의 심장', description: '깊은 곳으로 향하는 길을 찾으세요', accent: 0x4d476f, enemies: ['stalker', 'stalker', 'stalker', 'stalker', 'brute', 'brute', 'brute', 'archer', 'archer'] },
  { name: '파수꾼의 문', description: '심층 파수꾼들을 정리하세요', accent: 0x37606e, enemies: ['stalker', 'stalker', 'stalker', 'brute', 'brute', 'brute', 'archer', 'archer', 'archer'] },
  { name: '검은 용광로', description: '뜨거운 전열을 끊어내세요', accent: 0x71434a, enemies: ['stalker', 'stalker', 'stalker', 'brute', 'brute', 'brute', 'brute', 'archer', 'archer'] },
  { name: '그을린 회랑', description: '심층으로 이어지는 길을 확보하세요', accent: 0x5d465f, enemies: ['stalker', 'stalker', 'stalker', 'stalker', 'brute', 'brute', 'brute', 'archer', 'archer'] },
  { name: '심층 제단', description: '깊은 곳을 지키는 무리를 처치하세요', accent: 0x664356, enemies: ['stalker', 'stalker', 'stalker', 'stalker', 'brute', 'brute', 'brute', 'archer', 'archer', 'archer'] },
  { name: '붉은 감시로', description: '봉인실 주변의 감시자를 처치하세요', accent: 0x68404e, enemies: ['stalker', 'stalker', 'stalker', 'brute', 'brute', 'brute', 'brute', 'archer', 'archer'] },
  { name: '심연의 핵 앞뜰', description: '출구를 지키는 수문장에게 향하는 길을 여세요', accent: 0x7b3d49, enemies: ['stalker', 'stalker', 'stalker', 'stalker', 'brute', 'brute', 'brute', 'brute', 'archer', 'archer'] },
];

const createExits = (id: number): RoomDefinition['exits'] => {
  const x = id % GRID_SIZE;
  const y = Math.floor(id / GRID_SIZE);
  return {
    ...(y > 0 ? { up: id - GRID_SIZE } : {}),
    ...(y < GRID_SIZE - 1 ? { down: id + GRID_SIZE } : {}),
    ...(x > 0 ? { left: id - 1 } : {}),
    ...(x < GRID_SIZE - 1 ? { right: id + 1 } : {}),
  };
};

export const ROOMS: RoomDefinition[] = COMBAT_TEMPLATES.map((template, id) => ({
  id,
  ...template,
  mapX: id % GRID_SIZE,
  mapY: Math.floor(id / GRID_SIZE),
  type: 'combat',
  exits: createExits(id),
}));

const SPECIAL_ROOM_CONTENT: Record<Exclude<RoomType, 'combat'>, CombatTemplate> = {
  healing: { name: '고요한 샘', description: '상처를 회복할 방법을 선택하세요', accent: 0x3f7c6b, enemies: [] },
  shop: { name: '잿빛 시장', description: '전투에서 모은 재로 힘을 거래하세요', accent: 0xb88935, enemies: [] },
  boss: {
    name: '심연의 핵', description: '화로의 수문장을 쓰러뜨리고 탈출구를 여세요', accent: 0x9a3d49,
    enemies: ['boss', 'stalker', 'stalker', 'archer', 'archer'],
  },
};

const shuffle = <T>(values: T[], random: () => number): T[] => {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
};

export const createRandomRoomLayout = (random: () => number = Math.random): RoomDefinition[] => {
  const bossCandidates = ROOMS.filter((room) => room.mapX + room.mapY >= 4).map((room) => room.id);
  const bossId = shuffle(bossCandidates, random)[0];
  const specialCandidates = shuffle(ROOMS.map((room) => room.id).filter((id) => id !== 0 && id !== bossId), random);
  const healingId = specialCandidates[0];
  const shopId = specialCandidates[1];

  return ROOMS.map((baseRoom) => {
    const type: RoomType = baseRoom.id === bossId
      ? 'boss'
      : baseRoom.id === healingId
        ? 'healing'
        : baseRoom.id === shopId
          ? 'shop'
          : 'combat';
    const content = type === 'combat' ? baseRoom : SPECIAL_ROOM_CONTENT[type];
    return { ...baseRoom, ...content, type, enemies: [...content.enemies], exits: { ...baseRoom.exits } };
  });
};
