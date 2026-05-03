'use strict';

const chalk = require('chalk');
const ora = require('ora');
const { parseImageRef, RegistryClient } = require('../registry');
const { formatBytes, printTable, handleError } = require('../utils');

async function tags(imageRef, options) {
  const parsed = parseImageRef(imageRef);
  const client = new RegistryClient();
  const credentials = options.username
    ? { username: options.username, password: options.password }
    : null;
  const spinner = ora(`Fetching tags for ${chalk.bold(imageRef)}…`).start();

  try {
    // Try Docker Hub API first (richer metadata)
    if (parsed.isDockerHub) {
      let hubData;
      try {
        hubData = await client.getHubTags(parsed.name, 100);
      } catch (_) {
        // ignored — fall through to registry API
      }

      if (hubData && hubData.results) {
        spinner.stop();
        const total = hubData.count || hubData.results.length;
        console.log(`\nTags for ${chalk.bold(imageRef)} (${total} total):\n`);

        const headers = ['TAG', 'COMPRESSED SIZE', 'LAST UPDATED'];
        const colWidths = [35, 17, 22];
        printTable(headers, colWidths, hubData.results.map(t => [
          t.name || '',
          t.full_size ? formatBytes(t.full_size) : '-',
          t.last_updated ? new Date(t.last_updated).toLocaleString() : '-',
        ]));

        if (total > hubData.results.length) {
          console.log(chalk.gray(`\n... and ${total - hubData.results.length} more. ` +
            `Visit https://hub.docker.com/r/${parsed.name}/tags for full list.`));
        }
        console.log();
        return;
      }
    }

    // Fallback: registry API (works for any registry)
    const token = await client.getToken(parsed, credentials);
    const tagList = await client.getTags(parsed, token, credentials);
    spinner.stop();

    console.log(`\nTags for ${chalk.bold(imageRef)} (${tagList.length} total):\n`);
    for (const t of tagList) {
      console.log(`  ${t}`);
    }
    console.log();
  } catch (err) {
    spinner.stop();
    handleError(err);
  }
}

module.exports = tags;
