import {
  createOptimizedPicture,
  readBlockConfig,
} from '../../scripts/aem.js';

const DEFAULT_LIMIT = 6;
const DEFAULT_VARIANT = 'standard';

function getConfigValue(config, ...keys) {
  return keys.find((key) => key in config) ? config[keys.find((key) => key in config)] : undefined;
}

function readDatasetConfig(block) {
  const datasetConfig = {};
  Object.entries(block.dataset || {}).forEach(([key, value]) => {
    if (!value) return;
    datasetConfig[key] = value;
    datasetConfig[key.toLowerCase()] = value;
    datasetConfig[key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)] = value;
  });
  return datasetConfig;
}

function parseResourcePath(resource) {
  if (!resource || typeof resource !== 'string') return '';
  if (resource.startsWith('urn:')) {
    const idx = resource.indexOf(':/');
    if (idx >= 0) return resource.slice(idx + 1);
  }
  return resource.startsWith('/') ? resource : '';
}

async function readResourceConfig(block) {
  const resourcePath = parseResourcePath(block.dataset.aueResource);
  if (!resourcePath) return {};

  try {
    const response = await fetch(`${resourcePath}.json`);
    if (!response.ok) return {};
    const data = await response.json();
    if (!data || typeof data !== 'object') return {};

    return Object.entries(data).reduce((acc, [key, value]) => {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        acc[key] = String(value);
        acc[key.toLowerCase()] = String(value);
      }
      return acc;
    }, {});
  } catch {
    return {};
  }
}

function parseBoolean(value, fallback = true) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return fallback;

  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'sim'].includes(normalized)) return true;
  if (['false', '0', 'no', 'nao'].includes(normalized)) return false;
  return fallback;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function getVariant(block, config) {
  const supported = ['standard', 'compact', 'featured'];
  const classVariant = supported.find((variant) => block.classList.contains(variant));
  const variantValue = getConfigValue(config, 'variant');
  const configVariant = typeof variantValue === 'string' ? variantValue.toLowerCase().trim() : '';
  const variant = classVariant || configVariant || DEFAULT_VARIANT;
  return supported.includes(variant) ? variant : DEFAULT_VARIANT;
}

function extractArticles(payload) {
  if (!payload || typeof payload !== 'object') return [];

  const queue = [payload];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') continue;

    if (Array.isArray(current.items) && current.items.length && typeof current.items[0] === 'object') {
      return current.items;
    }

    const values = Object.values(current);
    values.forEach((value) => {
      if (value && typeof value === 'object') queue.push(value);
    });
  }

  return [];
}

function normalizeArticle(item) {
  if (!item || typeof item !== 'object') return null;

  const title = item.title || item.headline;
  const slug = item.slug || item.path;
  if (!title || !slug) return null;

  const excerpt = (typeof item.excerpt === 'string' ? item.excerpt : item.excerpt?.plaintext)
    || item.description
    || item.summary
    || '';
  const image = item.image?._path
    || item.image
    || item.heroImage?._path
    || item.heroImage
    || item.thumbnail?._path
    || item.thumbnail
    || '';
  const imageAlt = item.imageAlt || title;
  const publishDate = item.publishDate || item.date || item.publishedAt || '';

  return {
    title,
    slug,
    excerpt,
    image,
    imageAlt,
    publishDate,
  };
}

function buildRequestUrl(config) {
  const queryUrl = getConfigValue(config, 'queryurl', 'query-url', 'queryUrl');
  if (queryUrl) return queryUrl;

  const endpoint = getConfigValue(config, 'endpoint');
  if (!endpoint) return null;

  const persistedQuery = getConfigValue(config, 'persistedquery', 'persisted-query', 'persistedQuery');
  const limit = parsePositiveInt(getConfigValue(config, 'limit'), DEFAULT_LIMIT);

  const url = new URL(endpoint, window.location.origin);
  if (persistedQuery) url.searchParams.set('persistedQuery', persistedQuery);
  url.searchParams.set('limit', limit.toString());
  return url.toString();
}

function getCardLink(basePath, slug) {
  const normalizedBase = typeof basePath === 'string' && basePath.trim()
    ? basePath.trim().replace(/\/$/, '')
    : '/noticias';
  const normalizedSlug = String(slug).replace(/^\//, '');
  return `${normalizedBase}/${normalizedSlug}`;
}

function formatDate(dateValue, locale) {
  if (!dateValue) return '';
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat(locale || 'pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function trimExcerpt(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}...`;
}

function renderArticleCard(article, options) {
  const li = document.createElement('li');
  li.className = 'news-list-card';

  const articleEl = document.createElement('article');
  articleEl.className = 'news-list-card-inner';

  if (options.showImage && article.image) {
    const picture = createOptimizedPicture(article.image, article.imageAlt, false, [{ width: '1200' }, { width: '600' }]);
    const pictureWrapper = document.createElement('a');
    pictureWrapper.className = 'news-list-card-image';
    pictureWrapper.href = getCardLink(options.detailBasePath, article.slug);
    pictureWrapper.append(picture);
    articleEl.append(pictureWrapper);
  }

  const content = document.createElement('div');
  content.className = 'news-list-card-content';

  const date = formatDate(article.publishDate, options.locale);
  if (date) {
    const dateEl = document.createElement('p');
    dateEl.className = 'news-list-card-date';
    dateEl.textContent = date;
    content.append(dateEl);
  }

  const title = document.createElement('h3');
  title.className = 'news-list-card-title';
  const titleLink = document.createElement('a');
  titleLink.href = getCardLink(options.detailBasePath, article.slug);
  titleLink.textContent = article.title;
  title.append(titleLink);
  content.append(title);

  if (options.showExcerpt && article.excerpt) {
    const excerpt = document.createElement('p');
    excerpt.className = 'news-list-card-excerpt';
    excerpt.textContent = trimExcerpt(article.excerpt, options.excerptLength);
    content.append(excerpt);
  }

  const readMore = document.createElement('a');
  readMore.className = 'news-list-card-link';
  readMore.href = getCardLink(options.detailBasePath, article.slug);
  readMore.textContent = options.ctaLabel;
  content.append(readMore);

  articleEl.append(content);
  li.append(articleEl);
  return li;
}

function renderEmptyState(block, message = 'Nenhuma noticia encontrada.') {
  block.textContent = message;
}

export default async function decorate(block) {
  let config = {
    ...readBlockConfig(block),
    ...readDatasetConfig(block),
  };

  if (!buildRequestUrl(config)) {
    config = {
      ...config,
      ...(await readResourceConfig(block)),
    };
  }

  const variant = getVariant(block, config);
  block.classList.add(`news-list-${variant}`);

  const requestUrl = buildRequestUrl(config);
  if (!requestUrl) {
    renderEmptyState(block, 'Configure `queryUrl` (ou `endpoint`) para carregar noticias.');
    return;
  }

  const options = {
    showImage: parseBoolean(getConfigValue(config, 'showimage', 'show-image', 'showImage'), true),
    showExcerpt: parseBoolean(getConfigValue(config, 'showexcerpt', 'show-excerpt', 'showExcerpt'), true),
    excerptLength: parsePositiveInt(getConfigValue(config, 'excerptlength', 'excerpt-length', 'excerptLength'), 120),
    detailBasePath: getConfigValue(config, 'detailbasepath', 'detail-base-path', 'detailBasePath') || '/noticias',
    ctaLabel: getConfigValue(config, 'ctalabel', 'cta-label', 'ctaLabel') || 'Ler mais',
    locale: getConfigValue(config, 'locale') || 'pt-BR',
    limit: parsePositiveInt(getConfigValue(config, 'limit'), DEFAULT_LIMIT),
  };

  let payload;
  try {
    const response = await fetch(requestUrl);
    if (!response.ok) {
      renderEmptyState(block, 'Nao foi possivel carregar noticias agora.');
      return;
    }

    payload = await response.json();
  } catch {
    renderEmptyState(block, 'Nao foi possivel carregar noticias agora.');
    return;
  }

  const articles = extractArticles(payload)
    .map(normalizeArticle)
    .filter((article) => article)
    .slice(0, options.limit);

  if (!articles.length) {
    renderEmptyState(block);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'news-list-items';
  articles.forEach((article) => {
    list.append(renderArticleCard(article, options));
  });

  block.replaceChildren(list);
}
