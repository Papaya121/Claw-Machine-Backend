export type AttemptStatus =
  | 'started'
  | 'inputs_closed'
  | 'resolved'
  | 'claimed'
  | 'cancelled';

export type AttemptResult = 'win' | 'lose' | 'void';
export type AttemptOutcomeReason =
  | 'void_risk'
  | 'grab_not_validated'
  | 'chance_roll_failed'
  | 'dropped_after_grab'
  | 'win'
  | 'expired';

export interface AttemptReplayDebug {
  dropAlignment: number;
  stability: number;
  timingQuality: number;
  lockedPhaseMovement: boolean;
  skillScore: number;
}

export interface AttemptResolveDebug {
  outcomeReason: AttemptOutcomeReason;
  chance: number;
  rewardRoll: number;
  keepChance: number | null;
  dropRoll: number | null;
  dropTriggered: boolean;
  localGrabObserved: boolean;
  serverValidatedGrab: boolean;
  replay: AttemptReplayDebug;
}

export type RewardGrantStatus = 'pending' | 'granted' | 'failed';

export interface User {
  id: string;
  telegramUserId: string;
  createdAt: number;
  updatedAt: number;
}

export interface Wallet {
  userId: string;
  tickets: number;
  coins: number;
  version: number;
}

export interface Attempt {
  id: string;
  userId: string;
  status: AttemptStatus;
  configVersion: string;
  seedHash: string;
  outcomeSeed: string;
  seedReveal: string | null;
  startedAt: number;
  resolvedAt: number | null;
  expiresAt: number;
  riskScore: number;
  result: AttemptResult | null;
  rewardId: string | null;
  resolveDebug: AttemptResolveDebug | null;
  machineId: string;
  clientBuild: string;
}

export interface AttemptInput {
  attemptId: string;
  seq: number;
  clientTimeMs: number;
  dirX: number;
  dirY: number;
  receivedAt: number;
}

export interface Reward {
  id: string;
  code: string;
  rarity: number;
  chance: number;
  weight: number;
  isActive: boolean;
  stock: number | null;
}

export interface RewardGrant {
  id: string;
  attemptId: string;
  userId: string;
  rewardId: string;
  status: RewardGrantStatus;
  idempotencyKey: string;
  providerTxId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AuditEvent {
  id: number;
  userId: string | null;
  attemptId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface AntiCheatFlag {
  id: number;
  userId: string;
  attemptId: string;
  flagType: string;
  severity: number;
  details: Record<string, unknown>;
  createdAt: number;
}

export interface AuthUserContext {
  id: string;
  telegramUserId: string;
}
