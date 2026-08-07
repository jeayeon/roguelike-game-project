import type { UpgradeDefinition } from '../types/game';

export const UPGRADES: UpgradeDefinition[] = [
  { id: 'attackPower', name: '잿불 칼날', description: '공격력이 10 증가합니다.', maxStacks: 5, color: 0xe36a55 },
  { id: 'attackSpeed', name: '재빠른 손', description: '공격 간격이 6% 감소합니다.', maxStacks: 5, color: 0xf0a35b },
  { id: 'attackRange', name: '넓게 번지는 불꽃', description: '공격 범위와 부채꼴 각도가 10% 증가합니다.', maxStacks: 4, color: 0xf4c86b },
  { id: 'maxHealth', name: '거인의 심장', description: '최대 생명이 5 증가하고 5 회복합니다.', maxStacks: 4, color: 0xdb667a },
  { id: 'moveSpeed', name: '바람의 발걸음', description: '이동속도가 12.5 증가합니다.', maxStacks: 4, color: 0x78c9d4 },
  { id: 'dashCooldown', name: '짧아진 그림자', description: '대시 재사용 대기시간이 0.2초 감소합니다.', maxStacks: 4, color: 0x8d86db },
  { id: 'dashDuration', name: '머무는 잔상', description: '대시와 무적 시간이 0.2초 증가합니다.', maxStacks: 3, color: 0xad82d4 },
  { id: 'roomRecovery', name: '승리의 온기', description: '방 정리 시 생명 회복량이 4 증가합니다.', maxStacks: 4, color: 0x72bf8e },
  { id: 'criticalChance', name: '처형자의 표식', description: '치명타 확률이 10% 증가합니다.', maxStacks: 4, color: 0xd85f91 },
  { id: 'ashArmor', name: '재의 갑옷', description: '받는 피해가 4% 감소합니다.', maxStacks: 4, color: 0x8291aa },
];
