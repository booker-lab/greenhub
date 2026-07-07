const requiredSeeds = ['K6_STORE_ID', 'K6_PRODUCT_ID', 'K6_ORDER_ID'];
const roles = ['consumer', 'seller', 'admin', 'driver'];
const placeholderValues = new Set([
  '',
  'replace-store-id',
  'replace-product-id',
  'replace-order-id',
  '<seed-store-id>',
  '<seed-product-id>',
  '<seed-order-id>',
]);

function readEnv(name) {
  return process.env[name]?.trim() ?? '';
}

function isMissingValue(name) {
  return placeholderValues.has(readEnv(name));
}

function credentialState(role) {
  const prefix = `K6_${role.toUpperCase()}`;
  const hasEmail = Boolean(readEnv(`${prefix}_EMAIL`));
  const hasPassword = Boolean(readEnv(`${prefix}_PASSWORD`));

  if (hasEmail && hasPassword) {
    return 'included';
  }
  if (!hasEmail && !hasPassword) {
    return 'excluded';
  }
  return 'partial';
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

const blockers = [];
const warnings = [];
const includedRoles = [];
const excludedRoles = [];

const apiBaseUrl = readEnv('K6_API_BASE_URL');
const parsedApiUrl = parseUrl(apiBaseUrl);
const profile = readEnv('K6_PROFILE') || 'smoke';
const enableWrites = readEnv('K6_ENABLE_WRITES');

if (!apiBaseUrl) {
  blockers.push('K6_API_BASE_URL이 없습니다.');
} else if (!parsedApiUrl) {
  blockers.push('K6_API_BASE_URL이 올바른 URL 형식이 아닙니다.');
} else if (parsedApiUrl.hostname.includes('api-production')) {
  blockers.push('baseline 대상이 production API로 보입니다. staging 또는 preview API URL을 사용해야 합니다.');
}

if (profile !== 'baseline') {
  blockers.push(`K6_PROFILE은 baseline이어야 합니다. 현재 값은 ${profile}입니다.`);
}

if (enableWrites !== 'false') {
  blockers.push('첫 baseline의 K6_ENABLE_WRITES는 명시적으로 false여야 합니다.');
}

for (const name of requiredSeeds) {
  if (isMissingValue(name)) {
    blockers.push(`${name} 미확정입니다.`);
  }
}

for (const role of roles) {
  const state = credentialState(role);
  if (state === 'included') {
    includedRoles.push(role);
  } else if (state === 'excluded') {
    excludedRoles.push(role);
  } else {
    blockers.push(`${role} 계정 env가 일부만 설정되었습니다. email/password를 모두 설정하거나 모두 비워야 합니다.`);
  }
}

if (!includedRoles.includes('seller')) {
  warnings.push('seller_ops는 이번 baseline에서 제외됩니다.');
}
if (!includedRoles.includes('admin')) {
  warnings.push('admin_ops는 이번 baseline에서 제외됩니다.');
}
if (!includedRoles.includes('driver')) {
  warnings.push('driver_ops는 이번 baseline에서 제외됩니다.');
}
if (!includedRoles.includes('consumer')) {
  warnings.push('consumer 계정 없이 checkout은 읽기 전용으로만 실행됩니다.');
}

console.log('읽기 전용 baseline 사전 점검');
console.log(`- profile: ${profile}`);
console.log(`- writes: ${enableWrites || '(미설정)'}`);
console.log(`- API URL 설정 여부: ${apiBaseUrl ? '설정됨' : '없음'}`);
console.log(`- 포함 역할: ${includedRoles.length ? includedRoles.join(', ') : '없음'}`);
console.log(`- 제외 역할: ${excludedRoles.length ? excludedRoles.join(', ') : '없음'}`);

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

console.log('\n결과: baseline 실행 전 필수 조건을 통과했습니다.');
