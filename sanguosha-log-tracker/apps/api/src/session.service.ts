import { Injectable, NotFoundException } from "@nestjs/common"
import {
  applyEvent,
  createInitialTrackerState,
  demoDeckProfile,
  undoLastEvent,
  type ParsedLogEvent,
  type TrackerState
} from "@slt/shared"

interface SessionRecord {
  id: string
  state: TrackerState
}

@Injectable()
export class SessionService {
  private readonly sessions = new Map<string, SessionRecord>()

  createSession(): SessionRecord {
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const session: SessionRecord = {
      id: sessionId,
      state: createInitialTrackerState(demoDeckProfile)
    }

    this.sessions.set(sessionId, session)
    return session
  }

  getSession(id: string): SessionRecord {
    const session = this.sessions.get(id)
    if (!session) {
      throw new NotFoundException(`Session ${id} not found`)
    }

    return session
  }

  applyEvent(id: string, event: ParsedLogEvent): TrackerState {
    const session = this.getSession(id)
    session.state = applyEvent(session.state, event)
    return session.state
  }

  undo(id: string): TrackerState {
    const session = this.getSession(id)
    session.state = undoLastEvent(session.state)
    return session.state
  }

  reset(id: string): TrackerState {
    const session = this.getSession(id)
    session.state = createInitialTrackerState(session.state.deckProfile)
    return session.state
  }
}
