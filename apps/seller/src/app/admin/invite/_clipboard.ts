// 초대 토큰 복사 — 방금 발급한 토큰(lastToken)과 발급 내역 행별 복사가 공유하는 SSOT.
// React·Mantine 의존 없는 순수 로직으로 두고, 브라우저 API는 deps로 주입해 테스트한다.

/** 복사 결과: 표준 클립보드 API 성공 / 레거시(execCommand) 폴백 성공 / 둘 다 실패. */
export type CopyTextResult = 'clipboard' | 'legacy' | 'failed';

export interface ClipboardDeps {
  /** `navigator.clipboard.writeText` — 비보안 컨텍스트(HTTP)에서는 없다. */
  writeText?: (text: string) => Promise<void>;
  /** textarea + `document.execCommand('copy')` 폴백. 성공 여부를 반환한다. */
  legacyCopy?: (text: string) => boolean;
}

/**
 * 표준 클립보드 API를 먼저 시도하고, 없거나 거부되면(권한 거부·비보안 컨텍스트)
 * execCommand 폴백을 시도한다. 둘 다 실패하면 'failed' — 호출자가 사용자에게 알리고
 * 토큰을 직접 선택·복사할 수 있게 해야 한다. 예외를 밖으로 던지지 않는다.
 */
export async function copyText(
  text: string,
  deps: ClipboardDeps = browserClipboardDeps(),
): Promise<CopyTextResult> {
  if (deps.writeText) {
    try {
      await deps.writeText(text);
      return 'clipboard';
    } catch {
      // 권한 거부 등 — 레거시 폴백으로 넘어간다.
    }
  }
  if (deps.legacyCopy) {
    try {
      if (deps.legacyCopy(text)) return 'legacy';
    } catch {
      // execCommand 미지원 — 실패로 처리한다.
    }
  }
  return 'failed';
}

/** 실제 브라우저 환경의 deps. SSR·테스트(node)처럼 API가 없으면 해당 항목을 비워 둔다. */
export function browserClipboardDeps(): ClipboardDeps {
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  return {
    writeText: clipboard?.writeText ? (text) => clipboard.writeText(text) : undefined,
    legacyCopy: typeof document !== 'undefined' ? legacyCopy : undefined,
  };
}

function legacyCopy(text: string): boolean {
  const previousFocus = document.activeElement as HTMLElement | null;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  try {
    textarea.select();
    return document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
    previousFocus?.focus?.();
  }
}
