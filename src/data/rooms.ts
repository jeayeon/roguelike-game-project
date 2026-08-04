import type { EnemyKind, RoomDefinition, RoomType } from '../types/game';

export const ROOMS: RoomDefinition[] = [
  {
    id: 0, name: '잿빛 입구', description: '갈림길을 확보하세요', mapX: 0, mapY: 0, accent: 0x6f344f, type: 'combat',
    enemies: ['stalker', 'stalker', 'stalker', 'stalker', 'stalker', 'stalker'],
    exits: { right: 1, down: 3 },
  },
  {
    id: 1, name: '속삭임의 회랑', description: '양쪽 전열을 무너뜨리세요', mapX: 1, mapY: 0, accent: 0x684263, type: 'combat',
    enemies: ['stalker', 'stalker', 'stalker', 'stalker', 'brute', 'brute', 'archer', 'archer'],
    exits: { left: 0, right: 2, down: 4 },
  },
  {
    id: 2, name: '고요한 샘', description: '상처를 회복할 방법을 선택하세요', mapX: 2, mapY: 0, accent: 0x3f7c6b, type: 'healing',
    enemies: [],
    exits: { left: 1, down: 5 },
  },
  {
    id: 3, name: '피의 정원', description: '빠른 추격자 무리를 베어내세요', mapX: 0, mapY: 1, accent: 0x7d3544, type: 'combat',
    enemies: ['stalker', 'stalker', 'stalker', 'stalker', 'stalker', 'stalker', 'archer'],
    exits: { up: 0, right: 4, down: 6 },
  },
  {
    id: 4, name: '갈림길 제단', description: '네 방향의 중심을 장악하세요', mapX: 1, mapY: 1, accent: 0x5c3e73, type: 'combat',
    enemies: ['stalker', 'stalker', 'stalker', 'stalker', 'brute', 'brute', 'archer', 'archer', 'archer'],
    exits: { up: 1, left: 3, right: 5, down: 7 },
  },
  {
    id: 5, name: '침묵의 감옥', description: '사수의 탄막 사이로 파고드세요', mapX: 2, mapY: 1, accent: 0x315f68, type: 'combat',
    enemies: ['stalker', 'stalker', 'stalker', 'brute', 'brute', 'archer', 'archer', 'archer', 'archer'],
    exits: { up: 2, left: 4, down: 8 },
  },
  {
    id: 6, name: '잿빛 시장', description: '전투에서 모은 재로 힘을 거래하세요', mapX: 0, mapY: 2, accent: 0x426b82, type: 'shop',
    enemies: [],
    exits: { up: 3, right: 7, down: 10 },
  },
  {
    id: 7, name: '망각의 심장', description: '깊은 곳으로 향하는 길을 찾으세요', mapX: 1, mapY: 2, accent: 0x4d476f, type: 'combat',
    enemies: ['stalker', 'stalker', 'stalker', 'stalker', 'brute', 'brute', 'brute', 'archer', 'archer', 'archer'],
    exits: { up: 4, left: 6, right: 8, down: 9 },
  },
  {
    id: 8, name: '파수꾼의 문', description: '마지막 파수꾼들을 정리하세요', mapX: 2, mapY: 2, accent: 0x37606e, type: 'combat',
    enemies: ['stalker', 'stalker', 'stalker', 'brute', 'brute', 'brute', 'brute', 'archer', 'archer', 'archer'],
    exits: { up: 5, left: 7, down: 11 },
  },
  {
    id: 9, name: '재의 군주 봉인실', description: '재의 군주를 쓰러뜨리세요', mapX: 1, mapY: 3, accent: 0x9a3d49, type: 'boss',
    enemies: ['boss', 'stalker', 'stalker', 'archer', 'archer'],
    exits: { up: 7, left: 10, right: 11 },
  },
  {
    id: 10, name: '그을린 회랑', description: '심층으로 이어지는 길을 확보하세요', mapX: 0, mapY: 3, accent: 0x5d465f, type: 'combat',
    enemies: ['stalker', 'stalker', 'stalker', 'stalker', 'brute', 'brute', 'brute', 'archer', 'archer', 'archer'],
    exits: { up: 6, right: 9 },
  },
  {
    id: 11, name: '붉은 감시로', description: '봉인실 주변의 감시자들을 처치하세요', mapX: 2, mapY: 3, accent: 0x68404e, type: 'combat',
    enemies: ['stalker', 'stalker', 'stalker', 'brute', 'brute', 'brute', 'brute', 'archer', 'archer', 'archer'],
    exits: { up: 8, left: 9 },
  },
];

const SPECIAL_ROOM_CONTENT: Record<Exclude<RoomType, 'combat'>, Pick<RoomDefinition, 'name' | 'description' | 'accent' | 'enemies'>> = {
  healing: {
    name: '고요한 샘', description: '상처를 회복할 방법을 선택하세요', accent: 0x3f7c6b, enemies: [],
  },
  shop: {
    name: '잿빛 시장', description: '전투에서 모은 재로 힘을 거래하세요', accent: 0xb88935, enemies: [],
  },
  boss: {
    name: '재의 군주 봉인실', description: '재의 군주를 쓰러뜨리세요', accent: 0x9a3d49,
    enemies: ['boss', 'stalker', 'stalker', 'archer', 'archer'],
  },
};

const COMBAT_FALLBACKS: Partial<Record<number, Pick<RoomDefinition, 'name' | 'description' | 'accent'> & { enemies: EnemyKind[] }>> = {
  2: {
    name: '북동 회랑', description: '좁은 길의 적들을 정리하세요', accent: 0x53607a,
    enemies: ['stalker', 'stalker', 'stalker', 'stalker', 'brute', 'brute', 'archer', 'archer'],
  },
  6: {
    name: '무너진 교차로', description: '사방에서 몰려드는 적을 막으세요', accent: 0x625173,
    enemies: ['stalker', 'stalker', 'stalker', 'stalker', 'brute', 'brute', 'archer', 'archer', 'archer'],
  },
  9: {
    name: '심층 제단', description: '깊은 곳을 지키는 무리를 처치하세요', accent: 0x664356,
    enemies: ['stalker', 'stalker', 'stalker', 'stalker', 'brute', 'brute', 'brute', 'archer', 'archer', 'archer'],
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
  // 보스는 시작방 바로 옆에 나오지 않도록 최소 세 칸 이상 떨어진 후보에서 선택합니다.
  const bossId = shuffle([7, 8, 9, 10, 11], random)[0];
  const specialCandidates = shuffle(
    ROOMS.map((room) => room.id).filter((id) => id !== 0 && id !== bossId),
    random,
  );
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
    const content = type === 'combat'
      ? COMBAT_FALLBACKS[baseRoom.id] ?? baseRoom
      : SPECIAL_ROOM_CONTENT[type];
    return {
      ...baseRoom,
      ...content,
      type,
      enemies: [...content.enemies],
      exits: { ...baseRoom.exits },
    };
  });
};
