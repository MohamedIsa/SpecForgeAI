import type { Pool } from "pg";
import type { StorageService } from "./storage";
import { extractText } from "./parser";
import { extractBacklog, type ExtractionResult } from "./ai";
import type OpenAI from "openai";
import { randomUUID } from "crypto";

export interface UploadInput {
  fileBase64: string;
  fileName: string;
  targetTechStack?: string;
}

export interface UploadStatus {
  uploadId: string;
  status: "pending" | "processing" | "completed" | "failed";
  validationReport: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date | null;
}

export class ExtractionPipeline {
  constructor(
    private readonly pool: Pool,
    private readonly storage: StorageService,
    private readonly aiClient: OpenAI,
  ) {}

  async initiate(input: UploadInput): Promise<string> {
    const uploadId = randomUUID().replace(/-/g, "").slice(0, 16);

    await this.insertUpload(uploadId, input.fileName, "pending");

    this.runPipeline(uploadId, input).catch((err) => {
      console.error(`Processing failed for upload ${uploadId}:`, err);
    });

    return uploadId;
  }

  async getStatus(uploadId: string): Promise<UploadStatus> {
    return ExtractionPipeline.getStatus(this.pool, uploadId);
  }

  static async getStatus(pool: Pool, uploadId: string): Promise<UploadStatus> {
    const result = await pool.query(
      `SELECT id, file_name, file_path, status, validation_report, created_at, updated_at
       FROM brd_uploads
       WHERE id = $1`,
      [uploadId],
    );

    if (result.rows.length === 0) {
      throw new Error(`Upload not found: ${uploadId}`);
    }

    const row = result.rows[0] as Record<string, unknown>;

    return {
      uploadId: String(row["id"] ?? ""),
      status: String(row["status"] ?? "pending") as UploadStatus["status"],
      validationReport: (row["validation_report"] ?? null) as Record<string, unknown> | null,
      createdAt: new Date(String(row["created_at"] ?? Date.now())),
      updatedAt: row["updated_at"] != null
        ? new Date(String(row["updated_at"]))
        : null,
    };
  }

  private async runPipeline(
    uploadId: string,
    input: UploadInput,
  ): Promise<void> {
    await this.updateUploadStatus(uploadId, "processing");

    try {
      const buffer = Buffer.from(input.fileBase64, "base64");

      if (buffer.length === 0) {
        throw new Error("Decoded file buffer is empty.");
      }

      const filePath = await this.storage.uploadFile(
        uploadId,
        buffer,
        "application/octet-stream",
      );

      await this.updateUploadFilePath(uploadId, filePath);

      const brdText = await extractText(buffer, input.fileName);

      const result = await extractBacklog(this.aiClient, {
        brdText,
        targetTechStack: input.targetTechStack,
      });

      await this.storeExtractionResult(result);

      await this.updateUploadStatus(uploadId, "completed", result.validationReport as unknown as Record<string, unknown>);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error";

      await this.updateUploadStatus(
        uploadId,
        "failed",
        { error: message },
      );
    }
  }

  private async insertUpload(
    uploadId: string,
    fileName: string,
    status: string,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO brd_uploads (id, file_name, status) VALUES ($1, $2, $3)`,
      [uploadId, fileName, status],
    );
  }

  private async updateUploadFilePath(
    uploadId: string,
    filePath: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE brd_uploads SET file_path = $1, updated_at = NOW() WHERE id = $2`,
      [filePath, uploadId],
    );
  }

  private async updateUploadStatus(
    uploadId: string,
    status: string,
    validationReport: Record<string, unknown> | null = null,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE brd_uploads
       SET status = $1,
           validation_report = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [
        status,
        validationReport != null ? JSON.stringify(validationReport) : null,
        uploadId,
      ],
    );
  }

  private async storeExtractionResult(
    result: ExtractionResult,
  ): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      for (const epic of result.epics) {
        await client.query(
          `INSERT INTO epics (id, title, description)
           VALUES ($1, $2, $3)
           ON CONFLICT (id) DO UPDATE SET title = $2, description = $3`,
          [epic.id, epic.title, epic.description],
        );

        for (const ticket of epic.tickets) {
          await client.query(
            `INSERT INTO tickets (id, epic_id, title, type, priority, story_points, status, dependencies, description, acceptance_criteria, ai_dev_prompt)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT (id) DO UPDATE
               SET title = $3, type = $4, priority = $5, story_points = $6,
                   status = $7, dependencies = $8, description = $9,
                   acceptance_criteria = $10, ai_dev_prompt = $11`,
            [
              ticket.id,
              epic.id,
              ticket.title,
              ticket.type,
              ticket.priority,
              ticket.storyPoints,
              ticket.status,
              JSON.stringify(ticket.dependencies),
              ticket.description,
              JSON.stringify(ticket.acceptanceCriteria),
              ticket.aiDevPrompt,
            ],
          );
        }
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");

      throw err;
    } finally {
      client.release();
    }
  }
}
