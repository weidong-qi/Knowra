import assert from 'node:assert/strict';

export const storageConfigTests = [
  {
    name: 'createStorageConfig returns local-first defaults',
    async run() {
      const { createStorageConfig } = await import('../src/config/storage.config.ts');
      const config = createStorageConfig({});

      assert.equal(config.mode, 'local-first');
      assert.equal(config.uploadsDir, 'storage/uploads');
      assert.equal(config.exportsDir, 'storage/exports');
      assert.equal(config.tempDir, 'storage/temp');
    }
  }
];
