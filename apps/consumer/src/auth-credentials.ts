import isEmail from 'validator/lib/isEmail';

// PILOT-AUTH-CALLBACK-EMAIL-ADMISSION-CONVERGENCE-34A.
// Credentials callback admission converged with API LoginDto:
//   API:     email @IsEmail(), password @IsString()
//   callback: email/password non-empty string + email validity gate.
// validator/lib/isEmail with default options is exactly the meaning of
// class-validator isEmail(value) with no options (class-validator
// delegates as `typeof value === 'string' && validator.isEmail(value,
// undefined)`; LoginDto uses @IsEmail() with no options).
// No trim/normalization: the raw value is checked and, when admitted,
// forwarded verbatim. No credential/secret values are logged or embedded
// in errors here; callers must keep that invariant.

export function isAdmittedLoginPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function isAdmittedLoginEmail(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    return isEmail(value);
  } catch {
    return false;
  }
}

export function isAdmittedLoginCredentials(
  credentials: unknown,
): credentials is { email: string; password: string } {
  if (!credentials || typeof credentials !== 'object') return false;
  const record = credentials as Record<string, unknown>;
  return isAdmittedLoginEmail(record.email) && isAdmittedLoginPassword(record.password);
}
