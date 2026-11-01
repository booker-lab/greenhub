'use client';

import { Button } from '@greenhub/ui/components/button';
import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function A2HSButton() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (!prompt) return null;

  const handleInstall = async () => {
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') setPrompt(null);
  };

  // ① 외형 유지(UI 교체 P5): Mantine Button filled brand sm(높이 36·좌우 18)·fullWidth(block, 너비 100%)·
  // radius md(8px)와 같은 값.
  return (
    <Button type="button" className="flex w-full rounded-[8px]" onClick={handleInstall}>
      홈 화면에 추가
    </Button>
  );
}
