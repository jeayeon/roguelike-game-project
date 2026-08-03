import type { RoomDefinition } from '../types/game';

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
    exits: { up: 3, right: 7 },
  },
  {
    id: 7, name: '망각의 심장', description: '깊은 곳으로 향하는 길을 찾으세요', mapX: 1, mapY: 2, accent: 0x4d476f, type: 'combat',
    enemies: ['stalker', 'stalker', 'stalker', 'stalker', 'brute', 'brute', 'brute', 'archer', 'archer', 'archer'],
    exits: { up: 4, left: 6, right: 8, down: 9 },
  },
  {
    id: 8, name: '파수꾼의 문', description: '마지막 파수꾼들을 정리하세요', mapX: 2, mapY: 2, accent: 0x37606e, type: 'combat',
    enemies: ['stalker', 'stalker', 'stalker', 'brute', 'brute', 'brute', 'brute', 'archer', 'archer', 'archer'],
    exits: { up: 5, left: 7 },
  },
  {
    id: 9, name: '재의 군주 봉인실', description: '재의 군주를 쓰러뜨리세요', mapX: 1, mapY: 3, accent: 0x9a3d49, type: 'boss',
    enemies: ['boss', 'stalker', 'stalker', 'archer', 'archer'],
    exits: { up: 7 },
  },
];
