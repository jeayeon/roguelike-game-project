import type { PermanentUpgradeDefinition } from '../types/game';

export const PERMANENT_UPGRADES: PermanentUpgradeDefinition[] = [
  {
    id: 'maxHealth',
    name: '꺼지지 않는 심장',
    description: '모든 다음 회차의 최대 생명이 5 증가합니다.',
    maxLevel: 5,
    baseCost: 18,
    costStep: 12,
    color: 0xdb667a,
  },
  {
    id: 'attackPower',
    name: '단련된 잿날',
    description: '모든 다음 회차의 공격력이 2 증가합니다.',
    maxLevel: 5,
    baseCost: 22,
    costStep: 14,
    color: 0xe47855,
  },
  {
    id: 'moveSpeed',
    name: '바람의 혼',
    description: '모든 다음 회차의 이동속도가 8 증가합니다.',
    maxLevel: 4,
    baseCost: 20,
    costStep: 14,
    color: 0x65bfcf,
  },
  {
    id: 'attackSpeed',
    name: '꺼지지 않는 속공',
    description: '모든 다음 회차의 공격 간격이 4% 감소합니다.',
    maxLevel: 5,
    baseCost: 24,
    costStep: 15,
    color: 0xf0a35b,
  },
  {
    id: 'attackRange',
    name: '영원의 불꽃 자락',
    description: '모든 다음 회차의 공격 범위와 부채꼴 각도가 증가합니다.',
    maxLevel: 4,
    baseCost: 23,
    costStep: 15,
    color: 0xf4c86b,
  },
  {
    id: 'roomRecovery',
    name: '귀환자의 온기',
    description: '모든 다음 회차의 전투방 정리 회복량이 2 증가합니다.',
    maxLevel: 4,
    baseCost: 24,
    costStep: 16,
    color: 0x72bf8e,
  },
  {
    id: 'criticalChance',
    name: '영원한 처형 표식',
    description: '모든 다음 회차의 치명타 확률이 3% 증가합니다.',
    maxLevel: 4,
    baseCost: 26,
    costStep: 17,
    color: 0xd85f91,
  },
  {
    id: 'ashArmor',
    name: '불멸의 재 갑옷',
    description: '모든 다음 회차에 받는 피해가 2% 감소합니다.',
    maxLevel: 4,
    baseCost: 25,
    costStep: 16,
    color: 0x8291aa,
  },
];

export const getPermanentUpgradeCost = (upgrade: PermanentUpgradeDefinition, level: number): number => (
  upgrade.baseCost + upgrade.costStep * level
);
