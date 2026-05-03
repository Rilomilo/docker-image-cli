'use strict';

const axios = require('axios');

const DOCKER_REGISTRY = 'https://registry-1.docker.io';
const DOCKER_AUTH_URL = 'https://auth.docker.io';
const HUB_API_URL = 'https://hub.docker.com';

const ACCEPT_MANIFEST = [
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.oci.image.index.v1+json',
].join(', ');

const MANIFEST_LIST_TYPES = new Set([
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.index.v1+json',
]);

/**
 * Parse an image reference like:
 *   ubuntu, ubuntu:22.04, user/repo:tag, ghcr.io/user/repo:tag, repo@sha256:...
 */
function parseImageRef(imageRef) {
  let rest = imageRef;
  let registry = null;
  let tag = 'latest';
  let digest = null;

  // Extract digest (@sha256:...)
  const atIdx = rest.lastIndexOf('@');
  if (atIdx > -1) {
    digest = rest.slice(atIdx + 1);
    rest = rest.slice(0, atIdx);
  }

  // Check for custom registry (first segment contains '.' or ':' or is 'localhost')
  const firstSlash = rest.indexOf('/');
  if (firstSlash > 0) {
    const segment = rest.slice(0, firstSlash);
    if (segment === 'localhost' || segment.includes('.') || segment.includes(':')) {
      registry = segment;
      rest = rest.slice(firstSlash + 1);
    }
  }

  // Extract tag (last colon after last slash)
  if (!digest) {
    const lastSlash = rest.lastIndexOf('/');
    const lastColon = rest.lastIndexOf(':');
    if (lastColon > lastSlash) {
      tag = rest.slice(lastColon + 1);
      rest = rest.slice(0, lastColon);
    }
  }

  let name = rest;
  const isDockerHub = !registry;

  // Official Docker Hub images live under library/
  if (isDockerHub && !name.includes('/')) {
    name = `library/${name}`;
  }

  const registryUrl = registry ? `https://${registry}` : DOCKER_REGISTRY;

  return {
    registry: registry || 'docker.io',
    registryUrl,
    isDockerHub,
    name,        // e.g. "library/ubuntu" or "user/repo"
    tag,
    digest,
    ref: digest || tag,
    displayName: imageRef,
  };
}

class RegistryClient {
  constructor() {
    this.tokenCache = new Map();
    this.http = axios.create({ timeout: 60000 });
  }

  async getToken(parsed, credentials = null) {
    if (!parsed.isDockerHub) return null;

    const cacheKey = parsed.name;
    if (this.tokenCache.has(cacheKey)) return this.tokenCache.get(cacheKey);

    const params = {
      service: 'registry.docker.io',
      scope: `repository:${parsed.name}:pull`,
    };

    const config = credentials ? { auth: credentials } : {};
    const res = await this.http.get(`${DOCKER_AUTH_URL}/token`, { params, ...config });
    const token = res.data.token || res.data.access_token;
    this.tokenCache.set(cacheKey, token);
    return token;
  }

  _authHeader(token, credentials) {
    if (token) return { Authorization: `Bearer ${token}` };
    if (credentials) {
      const b64 = Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64');
      return { Authorization: `Basic ${b64}` };
    }
    return {};
  }

  async getManifest(parsed, ref, token, credentials) {
    const url = `${parsed.registryUrl}/v2/${parsed.name}/manifests/${ref}`;
    const res = await this.http.get(url, {
      headers: {
        ...this._authHeader(token, credentials),
        Accept: ACCEPT_MANIFEST,
      },
    });
    return {
      data: res.data,
      contentType: (res.headers['content-type'] || '').split(';')[0].trim(),
      digest: res.headers['docker-content-digest'] || '',
    };
  }

  async getTags(parsed, token, credentials) {
    const url = `${parsed.registryUrl}/v2/${parsed.name}/tags/list`;
    const res = await this.http.get(url, {
      headers: this._authHeader(token, credentials),
    });
    return res.data.tags || [];
  }

  async getBlobJSON(parsed, digest, token, credentials) {
    const url = `${parsed.registryUrl}/v2/${parsed.name}/blobs/${digest}`;
    const res = await this.http.get(url, {
      headers: this._authHeader(token, credentials),
    });
    return res.data;
  }

  async getBlobStream(parsed, digest, token, credentials) {
    const url = `${parsed.registryUrl}/v2/${parsed.name}/blobs/${digest}`;
    const res = await this.http.get(url, {
      headers: this._authHeader(token, credentials),
      responseType: 'stream',
    });
    const size = parseInt(res.headers['content-length'] || '0', 10);
    return { stream: res.data, size };
  }

  async searchHub(query, limit) {
    const res = await this.http.get(`${HUB_API_URL}/v2/search/repositories/`, {
      params: { query, page_size: limit, page: 1 },
    });
    return res.data;
  }

  async getHubTags(name, limit) {
    const parts = name.split('/');
    const namespace = parts[0];
    const repo = parts.slice(1).join('/');
    const res = await this.http.get(
      `${HUB_API_URL}/v2/repositories/${namespace}/${repo}/tags`,
      { params: { page_size: limit, ordering: '-last_updated' } }
    );
    return res.data;
  }
}

module.exports = { parseImageRef, RegistryClient, MANIFEST_LIST_TYPES };
