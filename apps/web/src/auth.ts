export interface Session {
  readonly displayName: string;
  token(): Promise<string>;
  signOut(): Promise<void>;
}

const config = {
  apiKey: import.meta.env['VITE_FIREBASE_API_KEY'] as string | undefined,
  authDomain: import.meta.env['VITE_FIREBASE_AUTH_DOMAIN'] as string | undefined,
  projectId: import.meta.env['VITE_FIREBASE_PROJECT_ID'] as string | undefined,
  appId: import.meta.env['VITE_FIREBASE_APP_ID'] as string | undefined,
};

export const firebaseConfigured = Boolean(config.apiKey && config.authDomain && config.projectId);

interface FirebaseUser {
  uid: string;
  displayName: string | null;
  email: string | null;
  getIdToken(forceRefresh?: boolean): Promise<string>;
}

export async function signInWithGoogle(): Promise<Session> {
  const appSpec = 'firebase/app';
  const authSpec = 'firebase/auth';
  const app = (await import(/* @vite-ignore */ appSpec)) as {
    initializeApp(cfg: unknown): unknown;
    getApps(): unknown[];
    getApp(): unknown;
  };
  const auth = (await import(/* @vite-ignore */ authSpec)) as {
    getAuth(app?: unknown): unknown;
    GoogleAuthProvider: new () => unknown;
    signInWithPopup(a: unknown, p: unknown): Promise<{ user: FirebaseUser }>;
    signOut(a: unknown): Promise<void>;
  };
  const instance = app.getApps().length ? app.getApp() : app.initializeApp(config);
  const a = auth.getAuth(instance);
  const { user } = await auth.signInWithPopup(a, new auth.GoogleAuthProvider());
  return {
    displayName: user.displayName ?? user.email?.split('@')[0] ?? 'プレイヤー',
    token: () => user.getIdToken(),
    signOut: () => auth.signOut(a),
  };
}

export function localSession(name: string): Session {
  const key = 'mixednuts.localUid';
  let uid = localStorage.getItem(key);
  if (!uid) {
    uid = `local-${crypto.randomUUID()}`;
    localStorage.setItem(key, uid);
  }
  const clean = (name.trim() || 'ゲスト').slice(0, 16).replace(/[|:]/g, '');
  localStorage.setItem('mixednuts.name', clean);
  return {
    displayName: clean,
    token: async () => `${uid}|${clean}`,
    signOut: async () => localStorage.removeItem(key),
  };
}
