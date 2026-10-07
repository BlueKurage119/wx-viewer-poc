import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileIdentity } from '../src/database/pairSafety.js';

const chunkBytes = 64 * 1024;
test('fileIdentityは空・chunk境界・複数chunkを固定上限でSHA256しmetadataを維持する', () => {
  const directory = fs.mkdtempSync(join(tmpdir(), 'wx-file-hash-'));
  const originalRead = fs.readSync;
  const originalWholeRead = fs.readFileSync;
  const originalClose = fs.closeSync;
  let closed = 0;
  const requested: number[] = [];
  try {
    fs.closeSync = (fd) => {
      closed += 1;
      originalClose(fd);
    };
    Object.defineProperty(fs, 'readSync', {
      value: (...args: unknown[]) => {
        assert.ok(Buffer.isBuffer(args[1]));
        requested.push(args[3] as number);
        assert.ok((args[3] as number) <= chunkBytes);
        return Reflect.apply(originalRead, fs, args);
      },
    });
    Object.defineProperty(fs, 'readFileSync', {
      value: () => {
        throw new Error('全読禁止');
      },
    });
    syncBuiltinESMExports();
    for (const size of [0, 1, chunkBytes - 1, chunkBytes, chunkBytes + 1, chunkBytes * 3 + 17]) {
      const path = join(directory, `hash-${size}`);
      const body = Buffer.alloc(size);
      for (let i = 0; i < size; i += 1) body[i] = i % 251;
      fs.writeFileSync(path, body);
      const before = fs.statSync(path);
      const closedBefore = closed;
      const identity = fileIdentity(path)!;
      assert.equal(closed, closedBefore + 1);
      assert.equal(identity.hash, createHash('sha256').update(body).digest('hex'));
      if (size === 0)
        assert.equal(
          identity.hash,
          'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        );
      assert.deepEqual(
        [identity.path, identity.size, identity.dev, identity.ino, identity.mtimeMs],
        [path, before.size, before.dev, before.ino, before.mtimeMs],
      );
      assert.equal(fs.statSync(path).mtimeMs, before.mtimeMs);
    }
    assert.ok(requested.length > 6);

    assert.equal(fileIdentity(join(directory, 'missing')), null);
    const source = join(directory, 'hash-1');
    const alias = join(directory, 'alias');
    fs.linkSync(source, alias);
    assert.throws(() => fileIdentity(alias), /単一リンク/);
  } finally {
    fs.readSync = originalRead;
    fs.readFileSync = originalWholeRead;
    fs.closeSync = originalClose;
    syncBuiltinESMExports();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('fileIdentityは途中read失敗でもfdをcloseし元例外を返す', () => {
  const directory = fs.mkdtempSync(join(tmpdir(), 'wx-file-hash-failure-'));
  const path = join(directory, 'fixture');
  fs.writeFileSync(path, Buffer.alloc(chunkBytes + 1));
  const originalRead = fs.readSync;
  const originalClose = fs.closeSync;
  const failure = new Error('fixture read');
  let calls = 0;
  let closed = 0;
  try {
    Object.defineProperty(fs, 'readSync', {
      value: (...args: unknown[]) => {
        if (++calls === 2) throw failure;
        return Reflect.apply(originalRead, fs, args);
      },
    });
    fs.closeSync = (fd) => {
      closed += 1;
      originalClose(fd);
    };
    syncBuiltinESMExports();
    assert.throws(
      () => fileIdentity(path),
      (error) => error === failure,
    );
    assert.equal(closed, 1);
    fs.readSync = originalRead;
    fs.closeSync = originalClose;
    syncBuiltinESMExports();
    assert.equal(
      fileIdentity(path)?.hash,
      createHash('sha256')
        .update(Buffer.alloc(chunkBytes + 1))
        .digest('hex'),
    );
  } finally {
    fs.readSync = originalRead;
    fs.closeSync = originalClose;
    syncBuiltinESMExports();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
