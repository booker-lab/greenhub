const requiredValues = ['K6_STORE_ID', 'K6_PRODUCT_ID'];
const roles = ['consumer', 'seller', 'admin', 'driver'];
const placeholderValues = new Set([
  '',
  'replace-store-id',
  'replace-product-id',
  '<seed-store-id>',
  '<seed-product-id>',
]);

function readEnv(name) {
  return process.env[name]?.trim() ?? '';
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function credentialState(role) {
  const prefix = `K6_${role.toUpperCase()}`;
  const hasEmail = Boolean(readEnv(`${prefix}_EMAIL`));
  const hasPassword = Boolean(readEnv(`${prefix}_PASSWORD`));

  if (hasEmail && hasPassword) {
    return 'present';
  }
  if (!hasEmail && !hasPassword) {
    return 'absent';
  }
  return 'partial';
}

const blockers = [];
const warnings = [];
const apiBaseUrl = readEnv('K6_API_BASE_URL');
const parsedApiUrl = parseUrl(apiBaseUrl);
const profile = readEnv('K6_PROFILE') || 'smoke';
const enableWrites = readEnv('K6_ENABLE_WRITES');
const presentRoles = [];

if (!apiBaseUrl) {
  blockers.push('K6_API_BASE_URL이 없습니다.');
} else if (!parsedApiUrl) {
  blockers.push('K6_API_BASE_URL이 올바른 URL 형식이 아닙니다.');
}

if (profile !== 'probe') {
  blockers.push(`MVP 읽기 전용 probe는 K6_PROFILE=probe로만 실행합니다. 현재 값은 ${profile}입니다.`);
}

if (enableWrites !== 'false') {
  blockers.push('MVP 읽기 전용 probe의 K6_ENABLE_WRITES는 명시적으로 false여야 합니다.');
}

for (const name of requiredValues) {
  if (placeholderValues.has(readEnv(name))) {
    blockers.push(`${name} 미확정입니다.`);
  }
}

for (const role of roles) {
  const state = credentialState(role);
  if (state === 'present') {
    presentRoles.push(role);
  } else if (state === 'partial') {
    blockers.push(`${role} 계정 env가 일부만 설정되었습니다. email/password를 모두 설정하거나 모두 비워야 합니다.`);
  }
}

if (presentRoles.length) {
  warnings.push(`계정 env가 설정된 역할: ${presentRoles.join(', ')}. probe에서는 운영 조회 시나리오를 늘리지 않고 setup 로그인만 수행될 수 있습니다.`);
}
if (parsedApiUrl?.hostname.includes('api-production')) {
  warnings.push('대상 API가 production으로 보입니다. 이번 실행은 baseline이 아니라 MVP 읽기 전용 probe로만 기록해야 합니다.');
}

console.log('MVP production 읽기 전용 probe 사전 점검');
console.log(`- profile: ${profile}`);
console.log(`- writes: ${enableWrites || '(미설정)'}`);
console.log(`- API URL 설정 여부: ${apiBaseUrl ? '설정됨' : '없음'}`);
console.log(`- 계정 env 설정 역할: ${presentRoles.length ? presentRoles.join(', ') : '없음'}`);

if (warnings.length) {
  console.log('\n주의');
  for (const warning of warnings) {
    console.log(`- ${warning}`);
  }
}

if (blockers.length) {
  console.error('\n차단 항목');
  for (const blocker of blockers) {
    console.error(`- ${blocker}`);
  }
  process.exit(1);
}

console.log('\n결과: MVP 읽기 전용 probe 사전 조건을 통과했습니다.');
