import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseConnection } from '../database/index.js';
import { sanitizeErrorMessage } from './httpGet.js';
import { validateTileRelativePath } from '../repositories/snapshot.js';
import type { RadarProduct } from '../repositories/types.js';

export interface FetchBinaryResult {
  readonly ok: boolean;
  readonly status: number | null;
  readonly buffer: Buffer | null;
  readonly responseBytes: number | null;
  readonly errorKind: 'http_status' | 'timeout' | 'network' | null;
  readonly errorMessage: string | null;
  readonly durationMs: number;
}

export interface FetchBinaryOptions {
  readonly fetchFn?: typeof fetch;
  readonly timeoutMs?: number;
  readonly accept?: string;
}

export async function fetchPngBinary(
  url: string,
  options?: FetchBinaryOptions,
): Promise<FetchBinaryResult> {
  const fetchFn = options?.fetchFn ?? fetch;
  const timeoutMs = options?.timeoutMs ?? 10_000;
  const accept = options?.accept ?? 'image/png';

  const startTime = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
  }, timeoutMs);
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = AbortSignal.any([timeoutSignal, controller.signal]);

  try {
    const res = await fetchFn(url, {
      method: 'GET',
      headers: {
        Accept: accept,
        'User-Agent': 'wx-viewer-poc/0.1.0',
      },
      signal: combinedSignal,
    });

    const durationMs = Date.now() - startTime;

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        buffer: null,
        responseBytes: null,
        errorKind: 'http_status',
        errorMessage: sanitizeErrorMessage(`HTTP ${res.status} ${res.statusText}`),
        durationMs,
      };
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const responseBytes = buffer.byteLength;

    return {
      ok: true,
      status: res.status,
      buffer,
      responseBytes,
      errorKind: null,
      errorMessage: null,
      durationMs,
    };
  } catch (error: unknown) {
    const durationMs = Date.now() - startTime;
    const err = error as { name?: string; message?: string; code?: string };
    const isTimeout =
      err?.name === 'TimeoutError' ||
      err?.name === 'AbortError' ||
      err?.code === 'UND_ERR_CONNECT_TIMEOUT';

    return {
      ok: false,
      status: null,
      buffer: null,
      responseBytes: null,
      errorKind: isTimeout ? 'timeout' : 'network',
      errorMessage: sanitizeErrorMessage(err?.message ?? String(error)),
      durationMs,
    };
  } finally {
    clearTimeout(timer);
  }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface PngValidationResult {
  readonly ok: boolean;
  readonly errorKind: 'invalid_png' | null;
  readonly reason: string | null;
}

export function validatePngBuffer(buffer: Buffer): PngValidationResult {
  if (buffer.length < 8) {
    return {
      ok: false,
      errorKind: 'invalid_png',
      reason: 'Buffer too small to contain PNG signature',
    };
  }
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return {
      ok: false,
      errorKind: 'invalid_png',
      reason: 'Invalid PNG signature',
    };
  }

  let offset = 8;
  let hasIhdr = false;
  let hasIdat = false;
  let hasIend = false;

  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32BE(offset);
    const chunkType = buffer.toString('ascii', offset + 4, offset + 8);
    offset += 8;

    if (offset + chunkLength + 4 > buffer.length) {
      return {
        ok: false,
        errorKind: 'invalid_png',
        reason: `Chunk ${chunkType} overflows buffer length`,
      };
    }

    if (!hasIhdr) {
      if (chunkType !== 'IHDR') {
        return {
          ok: false,
          errorKind: 'invalid_png',
          reason: 'First chunk must be IHDR',
        };
      }
      if (chunkLength !== 13) {
        return {
          ok: false,
          errorKind: 'invalid_png',
          reason: `IHDR length must be 13, got ${chunkLength}`,
        };
      }
      const width = buffer.readUInt32BE(offset);
      const height = buffer.readUInt32BE(offset + 4);
      if (width <= 0 || height <= 0) {
        return {
          ok: false,
          errorKind: 'invalid_png',
          reason: `Invalid dimensions in IHDR: ${width}x${height}`,
        };
      }
      hasIhdr = true;
    } else {
      if (chunkType === 'IDAT') {
        hasIdat = true;
      } else if (chunkType === 'IEND') {
        hasIend = true;
        offset += chunkLength + 4;
        break;
      }
    }

    offset += chunkLength + 4;
  }

  if (!hasIhdr) {
    return { ok: false, errorKind: 'invalid_png', reason: 'Missing IHDR chunk' };
  }
  if (!hasIdat) {
    return { ok: false, errorKind: 'invalid_png', reason: 'Missing IDAT chunk' };
  }
  if (!hasIend) {
    return { ok: false, errorKind: 'invalid_png', reason: 'Missing IEND chunk' };
  }

  return { ok: true, errorKind: null, reason: null };
}

export class NowcastTileStore {
  readonly cacheRoot: string;

  constructor(cacheRoot: string) {
    if (!path.isAbsolute(cacheRoot)) {
      throw new Error(`cacheRoot must be an absolute path: ${cacheRoot}`);
    }
    this.cacheRoot = path.normalize(cacheRoot);
    if (!fs.existsSync(this.cacheRoot)) {
      fs.mkdirSync(this.cacheRoot, { recursive: true });
    }
  }

  resolvePath(relativePath: string): string {
    validateTileRelativePath(relativePath);
    const fullPath = path.resolve(this.cacheRoot, relativePath);
    const normalizedRoot = path.normalize(this.cacheRoot);
    if (!fullPath.startsWith(normalizedRoot + path.sep) && fullPath !== normalizedRoot) {
      throw new Error(`Directory traversal detected: ${relativePath}`);
    }
    return fullPath;
  }

  async saveTile(
    relativePath: string,
    buffer: Buffer,
  ): Promise<{ byteSize: number; contentHash: string; fullPath: string }> {
    const pngValidation = validatePngBuffer(buffer);
    if (!pngValidation.ok) {
      throw new Error(`Invalid PNG: ${pngValidation.reason}`);
    }

    const contentHash = crypto.createHash('sha256').update(buffer).digest('hex');
    const byteSize = buffer.byteLength;
    const fullPath = this.resolvePath(relativePath);

    const dir = path.dirname(fullPath);
    await fs.promises.mkdir(dir, { recursive: true });

    const tmpPath = `${fullPath}.tmp.${crypto.randomUUID()}`;
    try {
      await fs.promises.writeFile(tmpPath, buffer);
      await fs.promises.rename(tmpPath, fullPath);
      return { byteSize, contentHash, fullPath };
    } catch (err) {
      await fs.promises.unlink(tmpPath).catch(() => {});
      throw err;
    }
  }

  async verifyTile(
    relativePath: string,
    expectedByteSize: number,
    expectedHash: string,
  ): Promise<{ valid: boolean; buffer: Buffer | null }> {
    try {
      const fullPath = this.resolvePath(relativePath);
      const stat = await fs.promises.stat(fullPath);
      if (stat.size !== expectedByteSize) {
        return { valid: false, buffer: null };
      }

      const buf = await fs.promises.readFile(fullPath);
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      if (hash !== expectedHash) {
        return { valid: false, buffer: null };
      }

      const validation = validatePngBuffer(buf);
      if (!validation.ok) {
        return { valid: false, buffer: null };
      }

      return { valid: true, buffer: buf };
    } catch {
      return { valid: false, buffer: null };
    }
  }

  async deleteTile(relativePath: string): Promise<boolean> {
    try {
      const fullPath = this.resolvePath(relativePath);
      await fs.promises.unlink(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async cleanProductUnreferencedTiles(
    connection: DatabaseConnection,
    product: RadarProduct,
  ): Promise<void> {
    const rows = connection
      .prepare(
        `
        SELECT rt.file_path FROM radar_tile rt
        JOIN radar_frame rf ON rt.frame_id = rf.id
        JOIN radar_snapshot rs ON rf.snapshot_id = rs.id
        WHERE rs.product = ?
      `,
      )
      .all(product) as { file_path: string }[];

    const validPaths = new Set<string>();
    for (const r of rows) {
      try {
        validPaths.add(this.resolvePath(r.file_path));
      } catch {
        // 無効なパスは無視
      }
    }

    const productDir = path.join(this.cacheRoot, 'radar', product);
    if (!fs.existsSync(productDir)) {
      return;
    }

    await this.scanAndClean(productDir, validPaths);
  }

  async cleanOrphanAndTempFiles(connection: DatabaseConnection): Promise<void> {
    const rows = connection.prepare('SELECT file_path FROM radar_tile').all() as {
      file_path: string;
    }[];

    const validPaths = new Set<string>();
    for (const r of rows) {
      try {
        validPaths.add(this.resolvePath(r.file_path));
      } catch {
        // 無効なパスは無視
      }
    }

    const radarDir = path.join(this.cacheRoot, 'radar');
    if (!fs.existsSync(radarDir)) {
      return;
    }

    await this.scanAndClean(radarDir, validPaths);
  }

  private async scanAndClean(dir: string, validPaths: Set<string>): Promise<void> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.scanAndClean(entryPath, validPaths);
        // 空ディレクトリのクリーンアップ
        const remaining = await fs.promises.readdir(entryPath);
        if (remaining.length === 0) {
          await fs.promises.rmdir(entryPath).catch(() => {});
        }
      } else if (entry.isFile()) {
        if (entry.name.includes('.tmp.')) {
          await fs.promises.unlink(entryPath).catch(() => {});
        } else if (entry.name.endsWith('.png') && !validPaths.has(entryPath)) {
          await fs.promises.unlink(entryPath).catch(() => {});
        }
      }
    }
  }
}
