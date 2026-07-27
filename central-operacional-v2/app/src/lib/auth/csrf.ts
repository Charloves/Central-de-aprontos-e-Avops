export const GENERIC_MUTATION_FAILURE = 'Nao foi possivel processar a requisicao.';

export type CsrfValidationResult =
  | { ok: true }
  | { ok: false; status: 403; message: typeof GENERIC_MUTATION_FAILURE };

export function validateMutableRequest(input: {
  origin: string | null;
  secFetchSite: string | null;
  appOrigin: string | undefined;
  environment?: string;
}): CsrfValidationResult {
  if (input.secFetchSite === 'cross-site') return forbidden();

  const trustedOrigin = normalizeOrigin(input.appOrigin);
  const requestOrigin = normalizeOrigin(input.origin);
  const isProduction = input.environment === 'production';

  if (!trustedOrigin) {
    return isProduction ? forbidden() : { ok: true };
  }

  if (!requestOrigin) {
    return isProduction ? forbidden() : { ok: true };
  }

  if (requestOrigin !== trustedOrigin) return forbidden();
  return { ok: true };
}

function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function forbidden(): CsrfValidationResult {
  return {
    ok: false,
    status: 403,
    message: GENERIC_MUTATION_FAILURE,
  };
}
