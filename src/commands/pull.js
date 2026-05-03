'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { pipeline } = require('stream');
const { promisify } = require('util');
const chalk = require('chalk');
const ora = require('ora');
const tar = require('tar-stream');
const { parseImageRef, RegistryClient, MANIFEST_LIST_TYPES } = require('../registry');
const { formatBytes, selectPlatform, handleError } = require('../utils');

const pipelineAsync = promisify(pipeline);

// ── tar helpers ───────────────────────────────────────────────────────────────

function packEntry(pack, header, content) {
  return new Promise((resolve, reject) => {
    pack.entry(header, content, err => (err ? reject(err) : resolve()));
  });
}

function packStream(pack, header, readable) {
  return new Promise((resolve, reject) => {
    const entry = pack.entry(header, err => (err ? reject(err) : resolve()));
    readable.on('error', reject);
    readable.pipe(entry);
  });
}

// ── concurrent progress display ───────────────────────────────────────────────

const BAR_WIDTH = 16;

function renderBar(pct) {
  const filled = Math.round(Math.min(100, pct) / 100 * BAR_WIDTH);
  return chalk.cyan('█'.repeat(filled)) + chalk.gray('░'.repeat(BAR_WIDTH - filled));
}

class LayerProgress {
  constructor(layers) {
    this.layers = layers;
    // status: 'waiting' | 'downloading' | 'done'
    this.states = layers.map(() => ({ status: 'waiting', downloaded: 0, total: 0, uncompressed: 0 }));
    this.isTTY = !!process.stdout.isTTY;
    this._linesDrawn = 0;
    this._timer = null;
  }

  start(i) {
    this.states[i].status = 'downloading';
    this._schedule();
  }

  update(i, downloaded, total) {
    const s = this.states[i];
    s.status = 'downloading';
    s.downloaded = downloaded;
    if (total > s.total) s.total = total;
    this._schedule();
  }

  done(i, uncompressed) {
    const s = this.states[i];
    s.status = 'done';
    s.uncompressed = uncompressed;
    if (!this.isTTY) {
      const sd = this.layers[i].digest.slice(7, 19);
      const n = this.layers.length;
      console.log(`  ${chalk.green('✔')} Layer ${String(i + 1).padStart(2)}/${n}  sha256:${sd}…  ${formatBytes(s.total)} → ${formatBytes(uncompressed)}`);
    } else {
      this._schedule();
    }
  }

  _schedule() {
    if (!this.isTTY || this._timer) return;
    // Debounce renders to ~16fps so rapid concurrent updates don't thrash the terminal
    this._timer = setTimeout(() => {
      this._timer = null;
      this._draw();
    }, 60);
  }

  _draw() {
    const n = this.layers.length;

    if (this._linesDrawn > 0) {
      // Move cursor up to overwrite previous block
      process.stdout.write(`\x1b[${this._linesDrawn}A`);
    }

    for (let i = 0; i < n; i++) {
      const s = this.states[i];
      const sd = this.layers[i].digest.slice(7, 19);
      const idx = `${String(i + 1).padStart(2)}/${n}`;
      let line;

      if (s.status === 'done') {
        const sizes = s.total > 0
          ? `${formatBytes(s.total)} compressed → ${formatBytes(s.uncompressed)} uncompressed`
          : formatBytes(s.uncompressed);
        line = `  ${chalk.green('✔')} Layer ${idx}  sha256:${sd}…  ${sizes}`;
      } else if (s.status === 'downloading' && s.total > 0) {
        const pct = Math.min(100, Math.round(s.downloaded / s.total * 100));
        const bar = renderBar(pct);
        line = `  ${chalk.yellow('⬇')} Layer ${idx}  sha256:${sd}…  [${bar}] ${String(pct).padStart(3)}%  ${formatBytes(s.downloaded)} / ${formatBytes(s.total)}`;
      } else if (s.status === 'downloading') {
        line = `  ${chalk.yellow('⬇')} Layer ${idx}  sha256:${sd}…  ${formatBytes(s.downloaded)}`;
      } else {
        line = chalk.gray(`    Layer ${idx}  sha256:${sd}…  waiting`);
      }

      process.stdout.write('\x1b[2K' + line + '\n');
    }

    this._linesDrawn = n;
  }

  /** Final render — called after all downloads finish. */
  flush() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    if (this.isTTY) {
      this._draw();
      this._linesDrawn = 0; // prevent future renders from clobbering this output
    }
  }
}

// ── download ──────────────────────────────────────────────────────────────────

async function downloadLayer(client, parsed, layer, token, credentials, tmpPath, onProgress) {
  const { stream, size: httpSize } = await client.getBlobStream(parsed, layer.digest, token, credentials);

  let downloaded = 0;
  stream.on('data', chunk => {
    downloaded += chunk.length;
    if (onProgress) onProgress(downloaded, httpSize || layer.size || 0);
  });

  const gunzip = zlib.createGunzip();
  const out = fs.createWriteStream(tmpPath);
  await pipelineAsync(stream, gunzip, out);

  return fs.statSync(tmpPath).size;
}

/**
 * Download all layers concurrently, up to `concurrency` at a time.
 * Returns an array of uncompressed sizes in layer order.
 */
async function downloadAll(client, parsed, layers, token, credentials, tmpDir, progress, concurrency) {
  const uncompressedSizes = new Array(layers.length).fill(0);
  let nextIdx = 0;

  async function worker() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const i = nextIdx++;
      if (i >= layers.length) return;

      const layer = layers[i];
      const tmpPath = path.join(tmpDir, `layer${i}.tar`);

      progress.start(i);
      const size = await downloadLayer(
        client, parsed, layer, token, credentials, tmpPath,
        (dl, total) => progress.update(i, dl, total)
      );
      progress.done(i, size);
      uncompressedSizes[i] = size;
    }
  }

  // Launch N workers; each grabs the next available layer from the queue
  const workers = Math.min(concurrency, layers.length);
  await Promise.all(Array.from({ length: workers }, worker));

  return uncompressedSizes;
}

// ── main ──────────────────────────────────────────────────────────────────────

function defaultOutput(name, tag) {
  return `${name.replace(/\//g, '_')}_${tag}.tar`;
}

async function pull(imageRef, options) {
  const parsed = parseImageRef(imageRef);
  const platform = options.platform || 'linux/amd64';
  const concurrency = options.concurrency ? Math.max(1, parseInt(options.concurrency, 10)) : Infinity;
  const credentials = options.username
    ? { username: options.username, password: options.password }
    : null;

  const client = new RegistryClient();
  const spinner = ora(`Resolving ${chalk.bold(imageRef)}…`).start();

  try {
    const token = await client.getToken(parsed, credentials);

    // ── Resolve manifest (handle manifest-list / OCI index) ──────────────────
    let manifest = await client.getManifest(parsed, parsed.ref, token, credentials);

    if (MANIFEST_LIST_TYPES.has(manifest.contentType)) {
      const entry = selectPlatform(manifest.data.manifests, platform);
      if (!entry) {
        spinner.stop();
        const available = (manifest.data.manifests || [])
          .map(m => `${m.platform.os}/${m.platform.architecture}`).join(', ');
        console.error(chalk.red(`Platform "${platform}" not found. Available: ${available}`));
        process.exit(1);
      }
      spinner.text = `Fetching ${platform} manifest…`;
      manifest = await client.getManifest(parsed, entry.digest, token, credentials);
    }

    const m = manifest.data;
    const layers = m.layers || [];
    const configDigest = m.config.digest;

    spinner.text = 'Fetching image config…';
    const configJson = await client.getBlobJSON(parsed, configDigest, token, credentials);

    const outputFile = options.output || defaultOutput(
      parsed.name.replace('library/', ''), parsed.tag
    );
    const outputPath = path.resolve(outputFile);
    const tmpDir = path.join(os.tmpdir(), `docker-pull-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    spinner.stop();

    const totalCompressed = layers.reduce((s, l) => s + (l.size || 0), 0);
    const activeConcurrency = Math.min(concurrency, layers.length);
    console.log(
      `\nPulling ${chalk.bold(imageRef)}  —  ` +
      `${layers.length} layers, ${formatBytes(totalCompressed)} compressed  ` +
      `${chalk.gray(`(${activeConcurrency} concurrent)`)}\n`
    );

    // ── Concurrent download with live progress ───────────────────────────────
    const progress = new LayerProgress(layers);
    const t0 = Date.now();

    const uncompressedSizes = await downloadAll(
      client, parsed, layers, token, credentials, tmpDir, progress, concurrency
    );

    progress.flush();
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(chalk.gray(`\n  All layers downloaded in ${elapsed}s\n`));

    // ── Assemble docker-save tar ─────────────────────────────────────────────
    const assembleSpinner = ora('Assembling image tar…').start();

    const configDigestHex = configDigest.replace('sha256:', '');
    const layerDirs = layers.map(l => l.digest.replace('sha256:', ''));

    const dockerManifest = [{
      Config: `${configDigestHex}.json`,
      RepoTags: [imageRef.includes(':') ? imageRef : `${imageRef}:latest`],
      Layers: layerDirs.map(d => `${d}/layer.tar`),
    }];

    const pack = tar.pack();
    const outStream = fs.createWriteStream(outputPath);
    pack.pipe(outStream);

    await packEntry(pack, { name: 'manifest.json' },
      Buffer.from(JSON.stringify(dockerManifest, null, 2)));
    await packEntry(pack, { name: `${configDigestHex}.json` },
      Buffer.from(JSON.stringify(configJson)));

    for (let i = 0; i < layers.length; i++) {
      const dir = layerDirs[i];
      await packEntry(pack, { name: `${dir}/VERSION` }, Buffer.from('1.0'));
      await packEntry(pack, { name: `${dir}/json` }, Buffer.from(JSON.stringify({ id: dir })));
      await packStream(
        pack,
        { name: `${dir}/layer.tar`, size: uncompressedSizes[i] },
        fs.createReadStream(path.join(tmpDir, `layer${i}.tar`))
      );
    }

    pack.finalize();
    await new Promise((resolve, reject) => {
      outStream.on('finish', resolve);
      outStream.on('error', reject);
    });

    // ── Cleanup temp files ───────────────────────────────────────────────────
    for (let i = 0; i < layers.length; i++) {
      try { fs.unlinkSync(path.join(tmpDir, `layer${i}.tar`)); } catch (_) {}
    }
    try { fs.rmdirSync(tmpDir); } catch (_) {}

    assembleSpinner.stop();

    const { size: outSize } = fs.statSync(outputPath);
    console.log(chalk.green('✔ Done!'));
    console.log(`  File:  ${chalk.bold(outputPath)}`);
    console.log(`  Size:  ${formatBytes(outSize)}`);
    console.log('');
    console.log(chalk.gray(`  Load with: docker load -i "${path.basename(outputPath)}"`));
    console.log('');
  } catch (err) {
    spinner.stop();
    handleError(err);
  }
}

module.exports = pull;
