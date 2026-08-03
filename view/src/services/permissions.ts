import type { TabId, UserLevel } from '../types';

export const canAccessTab = (level: UserLevel | null, tab: TabId): boolean => {
  if (!level) return tab === 'run' || tab === 'help';
  if (level === 'admin') return true;
  if (level === 'tech') return tab !== 'user';
  return tab === 'run';
};
