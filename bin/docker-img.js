#!/usr/bin/env node
'use strict';

const { program } = require('commander');
const { version } = require('../package.json');

program
  .name('docker-img')
  .description('Search, inspect, and download Docker images from any registry.')
  .version(version);

// ── search ────────────────────────────────────────────────────────────────────
program
  .command('search <query>')
  .description('Search Docker Hub for images')
  .option('-n, --limit <number>', 'Max results to show', '25')
  .action(require('../src/commands/search'));

// ── tags ─────────────────────────────────────────────────────────────────────
program
  .command('tags <image>')
  .description('List available tags for an image  (e.g. ubuntu, nginx:latest)')
  .option('-u, --username <user>', 'Registry username (for private images)')
  .option('-p, --password <pass>', 'Registry password')
  .action(require('../src/commands/tags'));

// ── inspect ───────────────────────────────────────────────────────────────────
program
  .command('inspect <image>')
  .description('Show image metadata, config, layers, and build history')
  .option('--platform <os/arch>', 'Platform to inspect for multi-arch images', 'linux/amd64')
  .option('-u, --username <user>', 'Registry username')
  .option('-p, --password <pass>', 'Registry password')
  .action(require('../src/commands/inspect'));

// ── pull ──────────────────────────────────────────────────────────────────────
program
  .command('pull <image>')
  .description('Download a Docker image as a tar file (compatible with docker load)')
  .option('-o, --output <file>', 'Output file path (default: <image>_<tag>.tar)')
  .option('--platform <os/arch>', 'Target platform', 'linux/amd64')
  .option('-c, --concurrency <n>', 'Max parallel layer downloads (default: all layers at once)')
  .option('-u, --username <user>', 'Registry username')
  .option('-p, --password <pass>', 'Registry password')
  .action(require('../src/commands/pull'));

program.parse();
