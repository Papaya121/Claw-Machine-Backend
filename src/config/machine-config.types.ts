export interface MachineConfig {
  version: string;
  inputWindowMs: number;
  dtMs: number;
  movement: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    maxSpeed: number;
    acceleration: number;
    damping: number;
  };
  dropTarget: {
    x: number;
    y: number;
  };
  timing: {
    expectedPressMs: number;
    closeWindowMs: number;
  };
  economy: {
    baseWinChance: number;
    minChance: number;
    maxChance: number;
    skillScale: number;
    riskScale: number;
    voidRiskThreshold: number;
    dropAfterGrabChance: number;
    grabValidationMinAlignment: number;
    grabValidationMinSkill: number;
  };
}
