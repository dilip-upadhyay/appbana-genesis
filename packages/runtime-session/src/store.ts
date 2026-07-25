// In-memory `SessionStore`. Phase 1 default; will be complemented by a
// Postgres driver in a later WS-1.4 task.

import type {
  Session,
  SessionListFilter,
  SessionStore,
} from "./types.js";

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, Session>();

  put(session: Session): Promise<void> {
    this.sessions.set(session.sessionId, session);
    return Promise.resolve();
  }

  get(sessionId: string): Promise<Session | undefined> {
    return Promise.resolve(this.sessions.get(sessionId));
  }

  list(filter?: SessionListFilter): Promise<readonly Session[]> {
    const all = [...this.sessions.values()];
    const filtered = all.filter((s) => matches(s, filter));
    filtered.sort(compareSessions);
    return Promise.resolve(filtered);
  }
}

function matches(session: Session, filter: SessionListFilter | undefined): boolean {
  if (!filter) {
    return true;
  }
  if (filter.appId !== undefined && session.appId !== filter.appId) {
    return false;
  }
  if (filter.tenantId !== undefined && session.tenantId !== filter.tenantId) {
    return false;
  }
  if (
    filter.principalId !== undefined &&
    session.principal.principalId !== filter.principalId
  ) {
    return false;
  }
  if (filter.status !== undefined && session.status !== filter.status) {
    return false;
  }
  return true;
}

function compareSessions(a: Session, b: Session): number {
  const t = a.startedAt.localeCompare(b.startedAt);
  if (t !== 0) {
    return t;
  }
  return a.sessionId.localeCompare(b.sessionId);
}
