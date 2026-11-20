import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema, type Database } from 'typecho/db';
import {
  buildWordPressMigrationDataset,
  parseWordPressExport,
  type WordPressExport,
  type WordPressMigrationDataset,
} from '../../../scripts/wordpress';

// D1 allows at most 100 bound parameters in each SQL statement.
const MAX_BOUND_PARAMETERS = 100;

function splitIntoChunks<T>(values: T[], size = MAX_BOUND_PARAMETERS - 1): T[][] {
  const chunks: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    chunks.push(values.slice(offset, offset + size));
  }
  return chunks;
}

export interface WordPressDatabaseWriteMetrics {
  rowsWritten: number;
  statementCount: number;
  batchDurationMs: number;
  sqlDurationMs: number;
}

export type WordPressImportContentType = 'post' | 'page' | 'note';

export type WordPressImportDedupeField = 'title' | 'slug' | 'id';

export function buildWordPressImportDedupeKey(
  item: { title: string; slug: string; oldId: number },
  fields: readonly WordPressImportDedupeField[],
  sourceKey: string,
  legacySource = false,
): string {
  return JSON.stringify(fields.map(field => {
    if (field === 'title') return item.title;
    if (field === 'slug') return item.slug;
    return [item.oldId, legacySource ? '*' : sourceKey];
  }));
}

function wordpressMetaType(domain: string): string | null {
  if (domain === 'category') return 'category';
  if (domain === 'post_tag') return 'tag';
  if (domain === 'topic') return 'note_topic';
  return null;
}

function wordpressMetaKey(type: string, slug: string): string {
  return type + '\u0000' + slug.toLocaleLowerCase();
}

/** Add missing taxonomy ancestors without changing the shared migration builder. */
export function addWordPressTermAncestors(
  dataset: WordPressMigrationDataset,
  source: WordPressExport,
  existingMetas: Array<{ mid: number; type: string; slug: string }>,
  maxMetaId: number,
): void {
  const definitions = new Map<string, WordPressExport['terms'][number]>();
  for (const term of source.terms) {
    const type = wordpressMetaType(term.domain);
    if (type) definitions.set(wordpressMetaKey(type, term.slug || term.name), term);
  }
  const metaIds = new Map<string, number>();
  for (const meta of existingMetas) metaIds.set(wordpressMetaKey(meta.type, meta.slug), meta.mid);
  for (const meta of dataset.metas) metaIds.set(wordpressMetaKey(String(meta.type), String(meta.slug)), Number(meta.mid));
  // The shared builder has already allocated IDs for dataset.metas.
  let nextMetaId = maxMetaId + 1 + dataset.metas.length;
  const ensureAncestor = (type: string, slug: string, trail: Set<string>): number => {
    if (!slug) return 0;
    const key = wordpressMetaKey(type, slug);
    if (trail.has(key)) return 0;
    const existing = metaIds.get(key);
    if (existing) return existing;
    const definition = definitions.get(key);
    if (!definition) return 0;
    const mid = nextMetaId++;
    metaIds.set(key, mid);
    const meta: Record<string, string | number | null> = {
      mid, name: definition.name || slug, slug, type,
      description: definition.description || null, count: 0, order: 0, parent: 0,
    };
    dataset.metas.push(meta);
    const nextTrail = new Set(trail);
    nextTrail.add(key);
    if (definition.parentSlug) meta.parent = ensureAncestor(type, definition.parentSlug, nextTrail);
    return mid;
  };
  for (const meta of dataset.metas.slice()) {
    const type = String(meta.type);
    const slug = String(meta.slug);
    const definition = definitions.get(wordpressMetaKey(type, slug));
    if (!definition?.parentSlug) continue;
    meta.parent = ensureAncestor(type, definition.parentSlug, new Set([wordpressMetaKey(type, slug)]));
  }
}

export function selectWordPressImportItems(
  source: WordPressExport,
  selectedTypes: readonly WordPressImportContentType[],
): WordPressExport {
  const selectedTypeSet = new Set(selectedTypes);
  const selectedItems = source.items.filter(item => selectedTypeSet.has(item.postType as WordPressImportContentType));
  const selectedContentIds = new Set(selectedItems.map(item => item.oldId));
  const referencedAttachmentIds = new Set<number>();

  for (const item of selectedItems) {
    for (const meta of item.postMeta) {
      if (meta.key !== '_thumbnail_id' && meta.key !== 'images' && meta.key !== 'attachment') continue;
      for (const rawId of meta.value.match(/\d+/g) || []) {
        const id = Number(rawId);
        if (Number.isSafeInteger(id) && id > 0) referencedAttachmentIds.add(id);
      }
    }
  }

  // Keep referenced attachments and recursively retain their WXR child attachments.
  // This also includes attachments whose direct parent is selected content.
  const includedAttachmentIds = new Set(referencedAttachmentIds);
  let addedAttachment = true;
  while (addedAttachment) {
    addedAttachment = false;
    for (const item of source.items) {
      if (item.postType !== 'attachment' || includedAttachmentIds.has(item.oldId)) continue;
      if (selectedContentIds.has(item.parentId) || includedAttachmentIds.has(item.parentId)) {
        includedAttachmentIds.add(item.oldId);
        addedAttachment = true;
      }
    }
  }
  const selectedItemsWithAttachments = source.items.filter(item =>
    selectedTypeSet.has(item.postType as WordPressImportContentType)
    || (item.postType === 'attachment' && includedAttachmentIds.has(item.oldId)),
  );

  return { ...source, items: selectedItemsWithAttachments };
}

export interface WordPressImportReport {
  siteTitle: string;
  totalItems: number;
  alreadyImported: number;
  imported: Record<string, number>;
  skipped: Record<string, number>;
  databaseWrite?: WordPressDatabaseWriteMetrics;
  preview: boolean;
}

/** Read the per-statement D1 metadata returned by Drizzle's D1 batch adapter. */
export function summarizeD1BatchResults(
  results: unknown[],
  statementCount: number,
  batchDurationMs: number,
): WordPressDatabaseWriteMetrics {
  let rowsWritten = 0;
  let sqlDurationMs = 0;

  for (const result of results) {
    if (!result || typeof result !== 'object') continue;
    const meta = (result as { meta?: { rows_written?: unknown; duration?: unknown } }).meta;
    if (!meta) continue;
    if (typeof meta.rows_written === 'number' && Number.isFinite(meta.rows_written)) {
      rowsWritten += meta.rows_written;
    }
    if (typeof meta.duration === 'number' && Number.isFinite(meta.duration)) {
      sqlDurationMs += meta.duration;
    }
  }

  return {
    rowsWritten,
    statementCount,
    batchDurationMs,
    sqlDurationMs,
  };
}

export function normalizeWordPressSource(siteUrl: string): string {
  const value = siteUrl.trim();
  if (!value) {
    throw new Error('WXR 文件缺少 WordPress 站点地址，无法安全识别重复内容');
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }
    url.hostname = url.hostname.toLowerCase();
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new Error('WXR 文件中的 WordPress 站点地址无效，无法安全识别重复内容');
  }
}

async function buildDataset(
  db: Database,
  source: WordPressExport,
  authorId: number,
  selectedTypes: readonly WordPressImportContentType[],
  dedupeFields: readonly WordPressImportDedupeField[],
) {
  const selectedSource = selectWordPressImportItems(source, selectedTypes);
  const sourceKey = normalizeWordPressSource(source.siteUrl);
  const termDefinitions = new Map<string, WordPressExport['terms'][number]>();
  for (const term of source.terms) {
    const type = wordpressMetaType(term.domain);
    if (type) termDefinitions.set(wordpressMetaKey(type, term.slug || term.name), term);
  }
  const requiredMetaKeys = new Set<string>();
  for (const item of selectedSource.items) {
    if (item.postType !== 'post' && item.postType !== 'note') continue;
    for (const category of item.categories) {
      const type = wordpressMetaType(category.domain);
      if (!type || (type === 'note_topic' && item.postType !== 'note')) continue;
      let slug = category.slug || category.name;
      const visited = new Set<string>();
      while (slug) {
        const key = wordpressMetaKey(type, slug);
        if (visited.has(key)) break;
        visited.add(key);
        requiredMetaKeys.add(key);
        slug = termDefinitions.get(key)?.parentSlug || '';
      }
    }
  }
  const requiredMetaSlugs = [...new Set([...requiredMetaKeys].map(key => key.split('\u0000')[1]))];
  const selectedWordPressIds = [...new Set(selectedSource.items.map(item => item.oldId))];
  const [maxContent, maxComment, maxMeta, contentRows, metaRows, postMarkerRows] = await Promise.all([
    db.select({ value: sql<number>`coalesce(max(${schema.contents.cid}), 0)` }).from(schema.contents),
    db.select({ value: sql<number>`coalesce(max(${schema.comments.coid}), 0)` }).from(schema.comments),
    db.select({ value: sql<number>`coalesce(max(${schema.metas.mid}), 0)` }).from(schema.metas),
    db.select({ cid: schema.contents.cid, type: schema.contents.type, title: schema.contents.title, slug: schema.contents.slug }).from(schema.contents),
    requiredMetaSlugs.length
      ? Promise.all(splitIntoChunks(requiredMetaSlugs).map(slugs =>
        db.select({ mid: schema.metas.mid, type: schema.metas.type, slug: schema.metas.slug })
          .from(schema.metas).where(inArray(schema.metas.slug, slugs)),
      )).then(rows => rows.flat())
      : Promise.resolve([]),
    selectedWordPressIds.length
      ? Promise.all(splitIntoChunks(selectedWordPressIds).map(ids =>
        db.select({ cid: schema.fields.cid, name: schema.fields.name, id: schema.fields.int_value, source: schema.fields.str_value })
          .from(schema.fields).where(and(eq(schema.fields.name, 'wordpress_post_id'), inArray(schema.fields.int_value, ids))),
      )).then(rows => rows.flat())
      : Promise.resolve([]),
  ]);
  const importedCids = [...new Set(postMarkerRows.map(row => Number(row.cid)).filter(Number.isSafeInteger))];
  const sourceMarkerRows = importedCids.length
    ? (await Promise.all(splitIntoChunks(importedCids).map(cids =>
      db.select({ cid: schema.fields.cid, name: schema.fields.name, id: schema.fields.int_value, source: schema.fields.str_value })
        .from(schema.fields).where(and(eq(schema.fields.name, 'wordpress_source'), inArray(schema.fields.cid, cids))),
    ))).flat()
    : [];
  const markerRows = [...postMarkerRows, ...sourceMarkerRows];
  const relevantMetaRows = metaRows.filter(row => row.slug && requiredMetaKeys.has(wordpressMetaKey(String(row.type), row.slug)));
  const sourceByContentId = new Map<number, string>();
  const wordpressIdByContentId = new Map<number, number>();
  for (const row of markerRows) {
    const cid = Number(row.cid);
    if (row.name === 'wordpress_source') sourceByContentId.set(cid, String(row.source || ''));
    if (row.name === 'wordpress_post_id') wordpressIdByContentId.set(cid, Number(row.id));
  }

  // Build composite keys once so analysis/import stay efficient on large databases.
  // Legacy ID markers without a source remain compatible with any source URL.
  const existingDedupeKeys = new Set<string>();
  const existingAttachmentIdKeys = new Set<string>();
  for (const row of contentRows) {
    const cid = Number(row.cid);
    const existing = {
      title: String(row.title || ''),
      slug: String(row.slug || ''),
      oldId: wordpressIdByContentId.get(cid) || 0,
    };
    const existingSource = sourceByContentId.get(cid) || '';
    if (row.type === 'attachment') {
      existingAttachmentIdKeys.add(buildWordPressImportDedupeKey(existing, ['id'], existingSource));
      if (!existingSource && existing.oldId) {
        existingAttachmentIdKeys.add(buildWordPressImportDedupeKey(existing, ['id'], '', true));
      }
      continue;
    }
    existingDedupeKeys.add(buildWordPressImportDedupeKey(existing, dedupeFields, existingSource));
    if (!existingSource && existing.oldId) {
      existingDedupeKeys.add(buildWordPressImportDedupeKey(existing, dedupeFields, '', true));
    }
  }

  const pendingItems = selectedSource.items.filter(item => {
    if (item.postType === 'attachment') {
      const idKey = buildWordPressImportDedupeKey(item, ['id'], sourceKey);
      const legacyIdKey = buildWordPressImportDedupeKey(item, ['id'], '', true);
      return !existingAttachmentIdKeys.has(idKey) && !existingAttachmentIdKeys.has(legacyIdKey);
    }
    const key = buildWordPressImportDedupeKey(item, dedupeFields, sourceKey);
    const legacyKey = buildWordPressImportDedupeKey(item, dedupeFields, '', true);
    return !existingDedupeKeys.has(key) && !existingDedupeKeys.has(legacyKey);
  });
  const alreadyImported = selectedSource.items.length - pendingItems.length;
  const pendingSource: WordPressExport = { ...selectedSource, items: pendingItems };

  const dataset = buildWordPressMigrationDataset(pendingSource, {
    maxContentId: Number(maxContent[0]?.value || 0),
    maxCommentId: Number(maxComment[0]?.value || 0),
    maxMetaId: Number(maxMeta[0]?.value || 0),
    contentSlugs: contentRows.map(row => row.slug || '').filter(Boolean),
    metas: relevantMetaRows.map(row => ({
      mid: row.mid,
      type: row.type,
      slug: row.slug!,
    })),
  }, {
    authorId,
    includeAttachments: true,
    siteUrl: '',
    rewriteMedia: false,
  });

  addWordPressTermAncestors(dataset, pendingSource, relevantMetaRows.map(row => ({
    mid: Number(row.mid), type: String(row.type), slug: String(row.slug),
  })), Number(maxMeta[0]?.value || 0));

  // The shared migration builder predates Typecho's native "waiting" state
  // and treats unknown WordPress statuses as publish. Correct each imported
  // post/page from the original WXR status before any database write.
  const sourceItemById = new Map(source.items.map(item => [item.oldId, item]));
  const importedIdByContentId = new Map<number, number>();
  for (const field of dataset.fields) {
    if (field.name === 'wordpress_post_id') {
      importedIdByContentId.set(Number(field.cid), Number(field.int_value));
    }
  }
  for (const content of dataset.contents) {
    const item = sourceItemById.get(importedIdByContentId.get(Number(content.cid)) || 0);
    if (!item) continue;
    const mapped = mapWordPressContentStatus(item.postType, item.status);
    if (mapped) {
      content.type = mapped.type;
      content.status = mapped.status;
    }
    dataset.fields.push({
      cid: Number(content.cid),
      name: 'wordpress:post_type',
      type: 'str',
      str_value: item.postType,
      int_value: 0,
      float_value: 0,
    });
    dataset.fields.push({
      cid: Number(content.cid),
      name: 'wordpress:post_status',
      type: 'str',
      str_value: item.status,
      int_value: 0,
      float_value: 0,
    });
  }

  // Mark each imported content row with its source site. This keeps IDs from
  // unrelated WordPress installations from colliding during later imports.
  for (const marker of dataset.fields.filter(row => row.name === 'wordpress_post_id')) {
    dataset.fields.push({
      cid: Number(marker.cid),
      name: 'wordpress_source',
      type: 'str',
      str_value: sourceKey,
      int_value: 0,
      float_value: 0,
    });
  }

  // WordPress user IDs are not Typecho user IDs. Preserve commenter identity
  // in the author/name fields, but do not falsely associate them with importer.
  for (const comment of dataset.comments) comment.authorId = 0;

  return { dataset, alreadyImported };
}

/**
 * Map WordPress post statuses to Typecho's native content types/statuses.
 * Unknown and trashed content is kept as a draft, never published by default.
 */
export function mapWordPressContentStatus(
  postType: string,
  sourceStatus: string,
): { type: string; status: string } | null {
  if (postType !== 'post' && postType !== 'page') return null;
  const type = postType;
  switch (sourceStatus.trim().toLowerCase()) {
    case 'publish':
      return { type, status: 'publish' };
    case 'pending':
      return { type, status: 'waiting' };
    case 'private':
      return { type, status: 'private' };
    case 'future':
      return { type, status: 'hidden' };
    case 'draft':
    case 'auto-draft':
    case 'trash':
    default:
      return { type: `${type}_draft`, status: 'draft' };
  }
}

function skippedCounts(dataset: WordPressMigrationDataset, alreadyImported: number) {
  return {
    ...dataset.skipped,
    ...(alreadyImported ? { alreadyImported } : {}),
  };
}

function insertStatements(db: Database, table: unknown, rows: Record<string, unknown>[]) {
  const writer = db as any;
  const statements: unknown[] = [];
  if (rows.length === 0) return statements;

  // Count the union of supplied columns so every multi-row INSERT stays
  // within D1's per-statement bound-parameter limit.
  const columnCount = new Set(rows.flatMap(row => Object.keys(row))).size;
  const chunkSize = Math.max(1, Math.floor(MAX_BOUND_PARAMETERS / columnCount));

  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    statements.push(writer.insert(table).values(rows.slice(offset, offset + chunkSize)));
  }
  return statements;
}

async function writeDataset(
  db: Database,
  dataset: WordPressMigrationDataset,
): Promise<WordPressDatabaseWriteMetrics> {
  const writer = db as any;
  const statements = [
    ...insertStatements(db, schema.metas, dataset.metas),
    ...insertStatements(db, schema.contents, dataset.contents),
    ...insertStatements(db, schema.fields, dataset.fields),
    ...insertStatements(db, schema.relationships, dataset.relationships),
    ...insertStatements(db, schema.comments, dataset.comments),
    ...dataset.affectedMetaIds.map(mid => writer.update(schema.metas)
      .set({ count: sql`(SELECT COUNT(*) FROM ${schema.relationships} WHERE ${schema.relationships.mid} = ${mid})` })
      .where(eq(schema.metas.mid, mid))),
  ];

  // D1 batch executes the ordered statements transactionally. A failed write
  // cannot leave an incomplete set of imported content and relationships.
  const startedAt = Date.now();
  const results = statements.length ? await writer.batch(statements) : [];
  return summarizeD1BatchResults(results, statements.length, Date.now() - startedAt);
}

export async function previewWordPressImport(
  db: Database,
  xml: string,
  authorId: number,
  selectedTypes: readonly WordPressImportContentType[] = ['post', 'page', 'note'],
  dedupeFields: readonly WordPressImportDedupeField[] = ['title', 'slug'],
): Promise<WordPressImportReport> {
  const source = parseWordPressExport(xml);
  const selectedSource = selectWordPressImportItems(source, selectedTypes);
  const { dataset, alreadyImported } = await buildDataset(db, source, authorId, selectedTypes, dedupeFields);
  return {
    siteTitle: source.siteTitle,
    totalItems: selectedSource.items.length,
    alreadyImported,
    imported: dataset.imported,
    skipped: skippedCounts(dataset, alreadyImported),
    preview: true,
  };
}

export async function importWordPressExport(
  db: Database,
  xml: string,
  authorId: number,
  selectedTypes: readonly WordPressImportContentType[] = ['post', 'page', 'note'],
  dedupeFields: readonly WordPressImportDedupeField[] = ['title', 'slug'],
): Promise<WordPressImportReport> {
  const source = parseWordPressExport(xml);
  const selectedSource = selectWordPressImportItems(source, selectedTypes);
  const { dataset, alreadyImported } = await buildDataset(db, source, authorId, selectedTypes, dedupeFields);
  const databaseWrite = dataset.contents.length
    ? await writeDataset(db, dataset)
    : undefined;

  return {
    siteTitle: source.siteTitle,
    totalItems: selectedSource.items.length,
    alreadyImported,
    imported: dataset.imported,
    skipped: skippedCounts(dataset, alreadyImported),
    ...(databaseWrite ? { databaseWrite } : {}),
    preview: false,
  };
}
