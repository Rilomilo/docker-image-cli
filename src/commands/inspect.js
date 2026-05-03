'use strict';

const chalk = require('chalk');
const ora = require('ora');
const { parseImageRef, RegistryClient, MANIFEST_LIST_TYPES } = require('../registry');
const { formatBytes, selectPlatform, handleError } = require('../utils');

async function inspect(imageRef, options) {
  const parsed = parseImageRef(imageRef);
  const platform = options.platform || 'linux/amd64';
  const credentials = options.username
    ? { username: options.username, password: options.password }
    : null;

  const client = new RegistryClient();
  const spinner = ora(`Fetching manifest for ${chalk.bold(imageRef)}…`).start();

  try {
    const token = await client.getToken(parsed, credentials);
    let manifest = await client.getManifest(parsed, parsed.ref, token, credentials);
    let manifestDigest = manifest.digest;

    // Handle manifest list / OCI index → select platform
    if (MANIFEST_LIST_TYPES.has(manifest.contentType)) {
      const entry = selectPlatform(manifest.data.manifests, platform);
      if (!entry) {
        spinner.stop();
        const available = (manifest.data.manifests || [])
          .map(m => `${m.platform.os}/${m.platform.architecture}`)
          .join(', ');
        console.error(chalk.red(`Platform "${platform}" not found. Available: ${available}`));
        process.exit(1);
      }
      spinner.text = `Found manifest list, fetching ${platform} manifest…`;
      manifest = await client.getManifest(parsed, entry.digest, token, credentials);
      manifestDigest = entry.digest;
    }

    spinner.text = `Fetching image config…`;
    const cfg = await client.getBlobJSON(parsed, manifest.data.config.digest, token, credentials);
    spinner.stop();

    const m = manifest.data;
    const layers = m.layers || [];
    const totalSize = layers.reduce((s, l) => s + (l.size || 0), 0);

    // ── Header ──────────────────────────────────────────────────────────────
    console.log('');
    console.log(chalk.bold.cyan('Image:       ') + imageRef);
    console.log(chalk.bold.cyan('Digest:      ') + (manifestDigest || '-'));
    console.log(chalk.bold.cyan('Platform:    ') + `${cfg.os || '-'}/${cfg.architecture || '-'}`
      + (cfg.variant ? `/${cfg.variant}` : ''));
    console.log(chalk.bold.cyan('Created:     ') + (cfg.created
      ? new Date(cfg.created).toLocaleString() : '-'));
    if (cfg.author) {
      console.log(chalk.bold.cyan('Author:      ') + cfg.author);
    }
    if (cfg.os_version) {
      console.log(chalk.bold.cyan('OS Version:  ') + cfg.os_version);
    }

    // ── Config ───────────────────────────────────────────────────────────────
    const c = cfg.config || {};
    console.log('');
    console.log(chalk.bold('Config:'));

    if (c.Entrypoint && c.Entrypoint.length) {
      console.log(`  ${chalk.bold('Entrypoint:')} ${JSON.stringify(c.Entrypoint)}`);
    }
    if (c.Cmd && c.Cmd.length) {
      console.log(`  ${chalk.bold('Cmd:')}        ${JSON.stringify(c.Cmd)}`);
    }
    if (c.WorkingDir) {
      console.log(`  ${chalk.bold('WorkingDir:')} ${c.WorkingDir}`);
    }
    if (c.User) {
      console.log(`  ${chalk.bold('User:')}       ${c.User}`);
    }

    if (c.Env && c.Env.length) {
      console.log(`  ${chalk.bold('Env:')}`);
      for (const e of c.Env) {
        console.log(`    ${e}`);
      }
    }

    if (c.ExposedPorts && Object.keys(c.ExposedPorts).length) {
      console.log(`  ${chalk.bold('Ports:')}      ${Object.keys(c.ExposedPorts).join(', ')}`);
    }

    if (c.Volumes && Object.keys(c.Volumes).length) {
      console.log(`  ${chalk.bold('Volumes:')}    ${Object.keys(c.Volumes).join(', ')}`);
    }

    if (c.Labels && Object.keys(c.Labels).length) {
      console.log(`  ${chalk.bold('Labels:')}`);
      for (const [k, v] of Object.entries(c.Labels)) {
        console.log(`    ${k} = ${v}`);
      }
    }

    // ── Layers ───────────────────────────────────────────────────────────────
    console.log('');
    console.log(chalk.bold(`Layers: (${layers.length} total, ${formatBytes(totalSize)} compressed)`));
    layers.forEach((l, i) => {
      const digest = l.digest || '';
      const shortDigest = digest.startsWith('sha256:') ? digest.slice(7, 19) + '…' : digest;
      console.log(`  ${String(i + 1).padStart(2)}. sha256:${shortDigest}  ${formatBytes(l.size)}`);
    });

    // ── History ──────────────────────────────────────────────────────────────
    if (cfg.history && cfg.history.length) {
      console.log('');
      console.log(chalk.bold('Build History:'));
      const history = cfg.history.filter(h => !h.empty_layer);
      history.slice(0, 15).forEach((h, i) => {
        const cmd = (h.created_by || '').replace(/\/bin\/sh -c #\(nop\)\s+/, '[meta] ')
          .replace(/\/bin\/sh -c /, 'RUN ').trim();
        const short = cmd.length > 90 ? cmd.slice(0, 87) + '…' : cmd;
        console.log(`  ${String(i + 1).padStart(2)}. ${short}`);
      });
      if (history.length > 15) {
        console.log(chalk.gray(`      … and ${history.length - 15} more steps`));
      }
    }

    console.log('');
  } catch (err) {
    spinner.stop();
    handleError(err);
  }
}

module.exports = inspect;
