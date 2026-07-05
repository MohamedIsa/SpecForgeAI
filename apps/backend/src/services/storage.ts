import { writeFile, readFile, mkdir } from "fs/promises";
import { join, dirname, resolve } from "path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";

export interface StorageService {
  uploadFile(key: string, buffer: Buffer, mimeType: string): Promise<string>;
  getFile(key: string): Promise<Buffer>;
}

export class LocalStorageService implements StorageService {
  private readonly uploadDir: string;
  private readonly resolvedDir: string;

  constructor(uploadDir?: string) {
    this.uploadDir = uploadDir ?? join(process.cwd(), "uploads");
    this.resolvedDir = resolve(this.uploadDir);
  }

  async uploadFile(
    key: string,
    buffer: Buffer,
    _mimeType: string,
  ): Promise<string> {
    const filePath = this.safeResolve(key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, buffer);

    return filePath;
  }

  async getFile(key: string): Promise<Buffer> {
    const filePath = this.safeResolve(key);

    return readFile(filePath);
  }

  private safeResolve(key: string): string {
    const resolved = resolve(this.uploadDir, key);

    if (!resolved.startsWith(this.resolvedDir + "/") && resolved !== this.resolvedDir) {
      throw new Error(
        `Path traversal detected: key "${key}" escapes upload directory.`,
      );
    }

    return resolved;
  }
}

export class S3StorageService implements StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(client?: S3Client, bucket?: string) {
    this.bucket = bucket ?? process.env["S3_BUCKET"] ?? "";
    this.client =
      client ??
      new S3Client({
        region: process.env["S3_REGION"] ?? "us-east-1",
        credentials: {
          accessKeyId: process.env["AWS_ACCESS_KEY_ID"] ?? "",
          secretAccessKey: process.env["AWS_SECRET_ACCESS_KEY"] ?? "",
        },
      });
  }

  async uploadFile(
    key: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      }),
    );

    return `s3://${this.bucket}/${key}`;
  }

  async getFile(key: string): Promise<Buffer> {
    const response: GetObjectCommandOutput = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );

    if (response.Body == null) {
      throw new Error(`File not found in S3: ${key}`);
    }

    const chunks: Uint8Array[] = [];

    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }

    return Buffer.concat(chunks);
  }
}

export function createStorageService(): StorageService {
  const provider = process.env["STORAGE_PROVIDER"] ?? "local";

  if (provider === "s3") {
    const bucket = process.env["S3_BUCKET"];

    if (bucket == null || bucket === "") {
      throw new Error(
        "S3_BUCKET environment variable is required when STORAGE_PROVIDER=s3.",
      );
    }

    return new S3StorageService();
  }

  const uploadDir = process.env["UPLOAD_DIR"];

  return new LocalStorageService(
    uploadDir != null && uploadDir !== "" ? uploadDir : undefined,
  );
}
