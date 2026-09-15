/**
 * ============================================================================
 *  IDENTITY
 * ============================================================================
 *
 * The only place a `playerId` is allowed to come from is a `TokenVerifier`.
 * Nothing in a client message ever becomes an identity, which is the whole
 * point: before this existed, anyone could claim to be anyone by typing a
 * different id into the join message.
 *
 * If you add a field like `playerId` or `uid` to an inbound message and use
 * it, you have undone this file.
 */

export interface AuthedUser {
  readonly uid: string;
  readonly name: string;
}

export interface TokenVerifier {
  /** Returns the user, or null if the token is missing, forged or expired. */
  verify(token: string): Promise<AuthedUser | null>;
}

/**
 * Firebase ID token verification.
 *
 * Credentials come from one of two places:
 *
 *   FIREBASE_SERVICE_ACCOUNT  the service account JSON itself, as a string.
 *                             Use this on hosts where you set environment
 *                             variables but cannot drop a file on disk —
 *                             Railway, Fly, Render and friends.
 *   otherwise                 application default credentials, i.e.
 *                             GOOGLE_APPLICATION_CREDENTIALS pointing at a
 *                             file, or a service account attached to the host.
 *
 * The import is lazy so the rest of the server, and the whole test suite, runs
 * without the dependency present.
 *
 * `verifyIdToken(token, true)` checks the signature, the audience, the issuer
 * AND whether the session has been revoked. Do not drop the second argument:
 * without it a stolen token keeps working after the user signs out everywhere.
 *
 * A Firebase ID token lives about an hour. Clients must refresh and re-send
 * it; `RoomManager` keeps the session alive on the existing socket, so the
 * refresh is invisible to the player.
 */
export function createFirebaseVerifier(): TokenVerifier {
  interface AdminAuth {
    verifyIdToken(token: string, checkRevoked?: boolean): Promise<Record<string, unknown>>;
  }
  let ready: Promise<AdminAuth> | null = null;

  const auth = async (): Promise<AdminAuth> => {
    if (!ready) {
      ready = (async () => {
        const appSpec = 'firebase-admin/app';
        const authSpec = 'firebase-admin/auth';
        const app = (await import(appSpec)) as {
          getApps(): unknown[];
          initializeApp(opts?: unknown): unknown;
          applicationDefault(): unknown;
          cert(serviceAccount: Record<string, unknown>): unknown;
        };
        const mod = (await import(authSpec)) as { getAuth(): AdminAuth };
        if (app.getApps().length === 0) {
          const inline = process.env['FIREBASE_SERVICE_ACCOUNT'];
          app.initializeApp({
            credential: inline
              ? app.cert(JSON.parse(inline) as Record<string, unknown>)
              : app.applicationDefault(),
          });
        }
        return mod.getAuth();
      })();
    }
    return ready;
  };

  return {
    async verify(token) {
      try {
        const decoded = await (await auth()).verifyIdToken(token, true);
        const uid = decoded['uid'];
        if (typeof uid !== 'string' || uid.length === 0) return null;
        const email = typeof decoded['email'] === 'string' ? decoded['email'] : '';
        const name =
          (typeof decoded['name'] === 'string' && decoded['name']) ||
          email.split('@')[0] ||
          'プレイヤー';
        return { uid, name: name.slice(0, 16) };
      } catch {
        // Never distinguish "expired" from "forged" to the client. Both are
        // just "sign in again", and the difference is useful only to an
        // attacker probing for valid tokens.
        return null;
      }
    },
  };
}

/**
 * LOCAL DEVELOPMENT ONLY. Treats the token as the uid, so anyone can be
 * anyone — exactly the hole Firebase Auth exists to close.
 *
 * `createVerifier` refuses to hand this back when NODE_ENV is production.
 */
export function createDevVerifier(): TokenVerifier {
  return {
    async verify(token) {
      const [uid, name] = token.split('|');
      if (!uid) return null;
      return { uid, name: (name || uid).slice(0, 16) };
    },
  };
}

/**
 * AUTH_MODE has no default, deliberately.
 *
 * An earlier version fell back to the dev verifier unless NODE_ENV said
 * production — which means forgetting one environment variable on a host
 * would have put an unauthenticated server on the public internet, silently.
 * Insecure has to be something you type on purpose.
 */
export function createVerifier(mode: string | undefined): TokenVerifier {
  if (mode === 'firebase') return createFirebaseVerifier();
  if (mode === 'dev') {
    console.warn('[auth] AUTH_MODE=dev — identities are NOT verified. Local use only.');
    return createDevVerifier();
  }
  throw new Error(
    'AUTH_MODE must be set to "firebase" (verified sign-in) or "dev" (local only, no verification)',
  );
}
