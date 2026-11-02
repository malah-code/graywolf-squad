import * as crypto from 'node:crypto';

import { withTenantContext } from '../db';

/**
 * Per-Model Confidence Calibration (Task 11.3b, ADR-081, PRD Gap 9, FR-003).
 *
 * Implements empirical confidence adjustment with:
 *  - n >= 30 sample gate per (file_type, model_id, model_version)
 *  - 90-day exponential decay half-life: w_i = 0.5 ^ (ageDays / 90)
 *  - Clamped adjustment delta: [-0.15, +0.15]
 *  - Multi-tenant persistence to PostgreSQL `confidence_calibration` inside `withTenantContext`
 */

export interface CalibrationSample {
  confidenceScore: number; // 0.00 - 1.00
  wasAccepted: boolean;    // true if merged without defect/rework, false if rejected
  ageDays: number;         // age of sample in days for 90-day half-life decay
}

export interface CalibrationResult {
  rawConfidence: number;
  calibratedConfidence: number;
  delta: number;
  sampleCount: number;
  isCalibrated: boolean;
}

export interface ComputeCalibrationOptions {
  minSamples?: number;  // default: 30
  maxDelta?: number;    // default: 0.15
  halfLifeDays?: number; // default: 90
}

export function computeCalibratedConfidence(
  rawConfidence: number,
  samples: CalibrationSample[],
  options?: ComputeCalibrationOptions
): CalibrationResult {
  const minSamples = options?.minSamples ?? 30;
  const maxDelta = options?.maxDelta ?? 0.15;
  const halfLifeDays = options?.halfLifeDays ?? 90;

  if (samples.length < minSamples) {
    return {
      rawConfidence,
      calibratedConfidence: rawConfidence,
      delta: 0,
      sampleCount: samples.length,
      isCalibrated: false,
    };
  }

  let totalWeight = 0;
  let weightedAccepted = 0;
  let weightedReported = 0;

  for (const s of samples) {
    const ageDays = Math.max(0, s.ageDays);
    const weight = Math.pow(0.5, ageDays / halfLifeDays);
    totalWeight += weight;
    weightedAccepted += (s.wasAccepted ? 1 : 0) * weight;
    weightedReported += s.confidenceScore * weight;
  }

  if (totalWeight <= 0) {
    return {
      rawConfidence,
      calibratedConfidence: rawConfidence,
      delta: 0,
      sampleCount: samples.length,
      isCalibrated: false,
    };
  }

  const empiricalRate = weightedAccepted / totalWeight;
  const avgReported = weightedReported / totalWeight;
  const rawDelta = empiricalRate - avgReported;

  // Clamp adjustment to [-maxDelta, +maxDelta]
  const clampedDelta = Math.max(-maxDelta, Math.min(maxDelta, rawDelta));
  const calibrated = Math.max(0, Math.min(1, rawConfidence + clampedDelta));

  return {
    rawConfidence: Number(rawConfidence.toFixed(3)),
    calibratedConfidence: Number(calibrated.toFixed(3)),
    delta: Number(clampedDelta.toFixed(3)),
    sampleCount: samples.length,
    isCalibrated: true,
  };
}

export type CalibrationDbRunner = typeof withTenantContext;

export class ConfidenceCalibrator {
  private readonly dbRunner: CalibrationDbRunner;

  constructor(options?: { dbRunner?: CalibrationDbRunner }) {
    this.dbRunner = options?.dbRunner ?? withTenantContext;
  }

  public async recordCalibrationSample(input: {
    taskId: string;
    workspaceId: string;
    userId?: string;
    modelId: string;
    modelVersion: string;
    filePath: string;
    fileLanguage?: string;
    fileType: string;
    confidenceScore: number;
    wasAccepted: boolean;
    justification?: string;
  }): Promise<{ id: string }> {
    const id = crypto.randomUUID();
    const payload = JSON.stringify({
      wasAccepted: input.wasAccepted,
      justification: input.justification ?? null,
    });

    await this.dbRunner(
      { workspaceId: input.workspaceId },
      async (client) => {
        await client.query(
          `INSERT INTO confidence_calibration
             (id, task_id, workspace_id, user_id, model_id, model_version, file_path, file_language, file_type, confidence_score, justification)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            id,
            input.taskId,
            input.workspaceId,
            input.userId ?? null,
            input.modelId,
            input.modelVersion,
            input.filePath,
            input.fileLanguage ?? null,
            input.fileType,
            Number(input.confidenceScore.toFixed(2)),
            payload,
          ]
        );
      }
    );

    return { id };
  }

  public async calibrateForModelAndFileType(input: {
    workspaceId: string;
    modelId: string;
    modelVersion: string;
    fileType: string;
    rawConfidence: number;
    options?: ComputeCalibrationOptions;
  }): Promise<CalibrationResult> {
    let rows: Array<{ confidence_score: string; justification: string | null; age_days: string }> = [];

    await this.dbRunner(
      { workspaceId: input.workspaceId },
      async (client) => {
        const res = await client.query<{
          confidence_score: string;
          justification: string | null;
          age_days: string;
        }>(
          `SELECT confidence_score,
                  justification,
                  EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400 AS age_days
             FROM confidence_calibration
            WHERE workspace_id = $1
              AND model_id = $2
              AND model_version = $3
              AND file_type = $4
            ORDER BY created_at DESC
            LIMIT 500`,
          [input.workspaceId, input.modelId, input.modelVersion, input.fileType]
        );
        rows = res.rows;
      }
    );

    const samples: CalibrationSample[] = rows.map((r) => {
      let wasAccepted = false;
      if (r.justification) {
        try {
          const parsed = JSON.parse(r.justification) as { wasAccepted?: boolean };
          wasAccepted = Boolean(parsed.wasAccepted);
        } catch {
          wasAccepted = r.justification.includes('accepted');
        }
      }
      return {
        confidenceScore: parseFloat(r.confidence_score),
        wasAccepted,
        ageDays: parseFloat(r.age_days ?? '0'),
      };
    });

    return computeCalibratedConfidence(input.rawConfidence, samples, input.options);
  }
}
