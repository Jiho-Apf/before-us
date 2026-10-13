import { useEffect, useSyncExternalStore } from "react";

type ViewingSession = { code: string; acknowledged: boolean };
type ViewEvent = { code: string; introductionId: string; profileVersion: number; at: string };
// Demo-only, tab-memory adapter. Production codes must be issued and mapped by
// an authenticated server; this client map is not an identity/security boundary.
const sessions = new Map<string, ViewingSession>();
const events: ViewEvent[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export function ensureViewingSession(memberId: string) {
  if (!sessions.has(memberId)) {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    const code = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
    sessions.set(memberId, { code, acknowledged: false });
    emit();
  }
  return sessions.get(memberId)!;
}
export function acknowledgeViewing(memberId: string) {
  const session = sessions.get(memberId);
  if (!session || session.acknowledged) return;
  sessions.set(memberId, { ...session, acknowledged: true });
  emit();
}
export function recordProfileView(memberId: string, introductionId: string, profileVersion: number) {
  const session = sessions.get(memberId);
  if (!session?.acknowledged || events.some(event =>
    event.code === session.code && event.introductionId === introductionId && event.profileVersion === profileVersion)) return;
  // One event per permitted profile version, no photo, free text or contact data.
  events.push({ code: session.code, introductionId, profileVersion, at: new Date().toISOString() });
  if (events.length > 100) events.shift();
}
export function useViewingSession(memberId: string) {
  const session = useSyncExternalStore(subscribe, () => sessions.get(memberId) || null, () => null);
  useEffect(() => { ensureViewingSession(memberId); }, [memberId]);
  return session;
}
