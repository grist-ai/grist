export type FirebasePublicConfig = {
  apiKey: string
  authDomain: string
  projectId: string
  appId: string
}

export type FirebaseUser = {
  uid: string
  email?: string
}

export function firebasePublicConfig(): FirebasePublicConfig | undefined {
  const apiKey = process.env.FIREBASE_API_KEY?.trim()
  const authDomain = process.env.FIREBASE_AUTH_DOMAIN?.trim()
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim()
  const appId = process.env.FIREBASE_APP_ID?.trim()
  if (!apiKey || !authDomain || !projectId || !appId) return
  return { apiKey, authDomain, projectId, appId }
}

export async function verifyFirebaseIdToken(
  idToken: string,
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response> = globalThis.fetch,
): Promise<FirebaseUser | undefined> {
  const config = firebasePublicConfig()
  if (!config || !idToken.trim()) return
  const response = await fetchImpl(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(config.apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    },
  )
  if (!response.ok) return
  const data = (await response.json()) as { users?: { localId?: string; email?: string }[] }
  const user = data.users?.[0]
  if (!user?.localId) return
  return { uid: user.localId, email: user.email }
}
