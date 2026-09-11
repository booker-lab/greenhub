// Repository-owned API E2E bootstrap env contract.
//
// Loaded via E2E Jest `setupFiles`, before any test module (including
// AppModule) is imported. Guarantees full-boot E2E results are independent of
// the developer shell and gitignored `apps/api/.env` load-bearing values.
//
// Mechanism (verified in `@nestjs/config@4.0.3` `dist/config.module.js`):
// - With `ignoreEnvFile: false`, final config is `{ ...dotenvFile, ...process.env }`,
//   so a pre-existing `process.env` key wins over `.env`.
// - `assignVariablesToProcess` only fills keys NOT already in `process.env`.
// Therefore this setup PINS deterministic values (not just `delete`).
// `delete` alone would let `.env` resupply the key via the above semantics.
//
// Contract:
// - Pins a non-production runtime (`NODE_ENV=test` plus empty Railway/Vercel
//   markers) so host pollution can never select production validation.
// - Pins an explicit non-operational synthetic Firebase identity for full-boot.
//   Never uses the operational project `green-e4fe3`.
// - Pins credential / emulator / local-runtime keys to empty so personal
//   `FIREBASE_SERVICE_ACCOUNT_JSON` / `GOOGLE_APPLICATION_CREDENTIALS` or
//   emulator hosts cannot change red/green. Never reads or prints secrets.
// - Disables scheduler via the existing `GREENHUB_SCHEDULES_ENABLED=false`
//   contract so full-AppModule boot has no persistent timers.
// - Pins the existing outbound-deny policy for PortOne/ALIGO defense-in-depth.
// - Pins `GREENHUB_API_UNIT_TEST=false` to keep E2E distinct from unit's
//   `ignoreEnvFile` path. E2E preserves env-file semantics but deterministically.
// - Production validation (`validateRuntimeConfig`,
//   `resolveFirebaseAdminSettings`) is unchanged and remains fail-closed.
process.env.GREENHUB_API_UNIT_TEST = 'false';
process.env.NODE_ENV = 'test';
process.env.RAILWAY_ENVIRONMENT_NAME = '';
process.env.VERCEL_ENV = '';
process.env.FIREBASE_PROJECT_ID = 'greenhub-api-e2e-test';
process.env.FIREBASE_STORAGE_BUCKET = 'greenhub-api-e2e-test.appspot.com';
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '';
process.env.GOOGLE_APPLICATION_CREDENTIALS = '';
process.env.GREENHUB_LOCAL_RUNTIME = '';
process.env.FIRESTORE_EMULATOR_HOST = '';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '';
process.env.GREENHUB_SCHEDULES_ENABLED = 'false';
process.env.GREENHUB_LOCAL_PROVIDER_OUTBOUND_POLICY = 'DENY_ALL_EXTERNAL_PROVIDER_DISPATCH';
