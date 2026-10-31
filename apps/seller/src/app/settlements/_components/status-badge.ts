// ① 외형 유지(UI 교체 P4): Mantine Badge variant="light" color → @greenhub/ui Badge 변형(어드민 정산과 같은 대응).
export const LIGHT_BADGE: Record<string, 'warning' | 'light' | 'secondary' | 'destructive'> = {
  yellow: 'warning',
  brand: 'light',
  gray: 'secondary',
  red: 'destructive',
};
