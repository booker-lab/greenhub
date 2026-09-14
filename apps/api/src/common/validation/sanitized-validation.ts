import { BadRequestException, type ValidationPipeOptions } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

// PILOT-AUTH-SANITIZED-VALIDATION-OBSERVABILITY-AND-EXACT-REVERIFY-34A.
//
// Validation failure -> sanitized diagnostic projection (OBSERVABILITY ONLY).
//
// Observable data is ONLY:
//   - property / path name
//   - constraint key / name
//
// Structurally excluded (never read, never emitted):
//   - error.value, error.target, error.contexts
//   - email / password values, request body, Authorization, cookies,
//     tokens, secrets, provider credentials, arbitrary rejected input strings.
//
// The projection below intentionally reads ONLY:
//   - error.property (string)
//   - error.constraints keys (not values/messages)
//   - error.children (recursive, same restriction)
// It never accesses `.value`, `.target`, or any other ValidationError field.
// Constraint VALUES (human-readable messages such as "email must be an
// email") are preserved in the existing `message` contract via
// flattenValidationMessages() but are NOT part of the sanitized projection;
// only constraint KEYS (e.g. "isEmail", "isString", "whitelistValidation")
// enter `validation.fields`.

export interface SanitizedValidationField {
  property: string;
  constraints: string[];
}

const MAX_PROJECTION_DEPTH = 10;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Project ValidationError[] to deterministic sanitized fields.
 * Reads only property / constraint keys / children. Never values.
 */
export function projectValidationFields(errors: unknown): SanitizedValidationField[] {
  const out: SanitizedValidationField[] = [];
  if (!Array.isArray(errors)) return out;

  const visit = (node: unknown, parentPath: string | null, depth: number): void => {
    if (depth > MAX_PROJECTION_DEPTH) return;
    if (!isRecord(node)) return;
    const rawProperty: unknown = node.property;
    if (typeof rawProperty !== 'string' || rawProperty.length === 0) return;
    const currentPath = parentPath ? `${parentPath}.${rawProperty}` : rawProperty;

    const rawConstraints: unknown = node.constraints;
    if (isRecord(rawConstraints)) {
      const keys = Object.keys(rawConstraints)
        .filter((key) => typeof key === 'string' && key.length > 0)
        .sort();
      if (keys.length > 0) {
        out.push({ property: currentPath, constraints: keys });
      }
    }

    const rawChildren: unknown = node.children;
    if (Array.isArray(rawChildren)) {
      for (const child of rawChildren) {
        visit(child, currentPath, depth + 1);
      }
    }
  };

  for (const error of errors) {
    visit(error, null, 0);
  }

  out.sort((a, b) => (a.property < b.property ? -1 : a.property > b.property ? 1 : 0));

  // Merge duplicate property paths deterministically (unique sorted keys).
  const merged: SanitizedValidationField[] = [];
  for (const field of out) {
    const last = merged[merged.length - 1];
    if (last && last.property === field.property) {
      const combined = new Set<string>([...last.constraints, ...field.constraints]);
      last.constraints = [...combined].sort();
    } else {
      merged.push({ property: field.property, constraints: [...field.constraints] });
    }
  }
  return merged;
}

// ---- Default-message preservation (Nest ValidationPipe parity) ----
// Replicates ValidationPipe.flattenValidationErrors /
// mapChildrenToValidationErrors / prependConstraintsWithParentProp so the
// existing `message`/`error`/`statusCode` contract is byte-identical and
// only the additive `validation` key is new.

function prependConstraintsWithParentProp(
  parentPath: string,
  error: ValidationError,
): ValidationError {
  const constraints: Record<string, string> = {};
  const source = (error.constraints ?? {}) as Record<string, string>;
  for (const key of Object.keys(source)) {
    constraints[key] = `${parentPath}.${source[key]}`;
  }
  return { ...error, constraints };
}

function mapChildrenToValidationErrors(
  error: ValidationError,
  parentPath?: string,
): ValidationError[] {
  if (!(error.children && error.children.length)) {
    return [error];
  }
  const nextParent = parentPath ? `${parentPath}.${error.property}` : error.property;
  const validationErrors: ValidationError[] = [];
  for (const item of error.children ?? []) {
    if (item.children && item.children.length) {
      validationErrors.push(...mapChildrenToValidationErrors(item, nextParent));
    }
    validationErrors.push(prependConstraintsWithParentProp(nextParent, item));
  }
  return validationErrors;
}

export function flattenValidationMessages(errors: ValidationError[]): string[] {
  const messages: string[] = [];
  for (const error of errors) {
    for (const item of mapChildrenToValidationErrors(error)) {
      if (!item.constraints) continue;
      for (const message of Object.values(item.constraints)) {
        if (typeof message === 'string') messages.push(message);
      }
    }
  }
  return messages;
}

/**
 * Exception factory for the global ValidationPipe.
 * Preserves 400 status + existing message/error/statusCode contract and
 * additively attaches sanitized `validation.fields` (property + constraint
 * keys only). Acceptance/rejection semantics are unchanged: whitelist and
 * forbidNonWhitelisted remain true and no DTO contract is altered here.
 */
export function sanitizedValidationExceptionFactory(errors: ValidationError[]): unknown {
  const fields = projectValidationFields(errors);
  const messages = flattenValidationMessages(errors);
  return new BadRequestException({
    statusCode: 400,
    message: messages,
    error: 'Bad Request',
    validation: { fields },
  });
}

/**
 * Canonical global ValidationPipe options for this task.
 * Acceptance contract is exactly whitelist + forbidNonWhitelisted;
 * only the exceptionFactory gains the sanitized additive projection.
 */
export function sanitizedValidationPipeOptions(): ValidationPipeOptions {
  return {
    whitelist: true,
    forbidNonWhitelisted: true,
    exceptionFactory: sanitizedValidationExceptionFactory,
  };
}
