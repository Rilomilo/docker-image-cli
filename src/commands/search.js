'use strict';

const chalk = require('chalk');
const ora = require('ora');
const { RegistryClient } = require('../registry');
const { formatPulls, truncate, printTable, handleError } = require('../utils');

async function search(query, options) {
  const limit = Math.min(parseInt(options.limit, 10) || 25, 100);
  const client = new RegistryClient();
  const spinner = ora(`Searching Docker Hub for "${query}"…`).start();

  try {
    const data = await client.searchHub(query, limit);
    spinner.stop();

    if (!data.results || data.results.length === 0) {
      console.log(chalk.yellow('No results found.'));
      return;
    }

    console.log(`\nFound ${chalk.bold(data.count)} results (showing ${data.results.length}):\n`);

    const headers = ['NAME', 'DESCRIPTION', 'STARS', 'PULLS', 'OFFICIAL'];
    const colWidths = [35, 50, 7, 10, 8];

    printTable(headers, colWidths, data.results.map(r => [
      r.repo_name || '',
      truncate(r.short_description || '', 50),
      String(r.star_count || 0),
      formatPulls(r.pull_count),
      r.is_official ? chalk.green('[OK]') : '',
    ]));

    console.log();
  } catch (err) {
    spinner.stop();
    handleError(err);
  }
}

module.exports = search;
