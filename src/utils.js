'use strict';

const chalk = require('chalk');
const prettyBytes = require('pretty-bytes');

function formatBytes(n) {
  return prettyBytes(n || 0);
}

function formatPulls(n) {
  if (!n) return '0';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

function truncate(str, max) {
  if (!str) return '';
  return str.length <= max ? str : str.slice(0, max - 3) + '...';
}

function printTable(headers, colWidths, rows) {
  const headerLine = headers.map((h, i) => chalk.bold(h.padEnd(colWidths[i]))).join('  ');
  const divider = colWidths.map(w => '-'.repeat(w)).join('  ');
  console.log(headerLine);
  console.log(divider);
  for (const row of rows) {
    console.log(row.map((cell, i) => String(cell ?? '').padEnd(colWidths[i])).join('  '));
  }
}

function selectPlatform(manifests, platformStr) {
  const [os, arch, variant] = platformStr.split('/');
  // exact match first
  let entry = manifests.find(m => {
    const p = m.platform || {};
    return p.os === os && p.architecture === arch && (!variant || p.variant === variant);
  });
  // fallback: ignore variant
  if (!entry && variant) {
    entry = manifests.find(m => {
      const p = m.platform || {};
      return p.os === os && p.architecture === arch;
    });
  }
  return entry || null;
}

function handleError(err) {
  if (err.response) {
    const { status, data } = err.response;
    if (status === 401) {
      console.error(chalk.red('Authentication failed. For private images use -u/--username and -p/--password.'));
    } else if (status === 404) {
      console.error(chalk.red('Image not found. Check the name and tag.'));
    } else {
      const msg = (data && data.errors) ? JSON.stringify(data.errors) : status;
      console.error(chalk.red(`Registry error: ${msg}`));
    }
  } else {
    console.error(chalk.red(`Error: ${err.message}`));
  }
  process.exit(1);
}

module.exports = { formatBytes, formatPulls, truncate, printTable, selectPlatform, handleError };
