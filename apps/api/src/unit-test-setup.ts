// Repository-owned API unit-test env contract.
//
// Loaded via unit Jest `setupFiles`, before any test module (including
// AppModule) is imported. Guarantees unit results are independent of the
// developer's `apps/api/.env` and host shell authority.
//
// Contract:
// - Sets an explicit unit-only marker (`GREENHUB_API_UNIT_TEST=true`).
//   `AppModule` enables `ConfigModule.ignoreEnvFile` only for this marker,
//   so E2E / development / production env-file semantics are unchanged.
// - Pins a deterministic non-production Firebase identity.
// - Removes host authority that could make the runtime look like production
//   or load real credentials into unit tests.
// - Never reads or prints secrets.
process.env.GREENHUB_API_UNIT_TEST = 'true';
process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'greenhub-api-unit-test';
process.env.FIREBASE_STORAGE_BUCKET = 'greenhub-api-unit-test.appspot.com';

delete process.env.GREENHUB_ENVIRONMENT_NAME;
delete process.env.RAILWAY_ENVIRONMENT_NAME;
delete process.env.VERCEL_ENV;
delete process.env.GREENHUB_LOCAL_RUNTIME;
delete process.env.FIRESTORE_EMULATOR_HOST;
delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
// 법무 검토 전 기능 스위치(H1)는 호스트 셸 값과 무관하게 꺼진 상태에서 시작한다.
// 켠 동작은 각 테스트가 ConfigService 값으로 직접 넣는다.
delete process.env.DRIVER_APPLICATION_ENABLED;
delete process.env.CUSTOMER_FAULT_CLOSURE_ENABLED;
