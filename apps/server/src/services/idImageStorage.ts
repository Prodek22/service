import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';

const DEFAULT_STORAGE_RELATIVE_DIR = path.join('storage', 'uploads', 'id-cards');
export const ID_IMAGE_PUBLIC_BASE_PATH = '/api/uploads/id-cards';
const PRIMARY_STORAGE_DIR = path.resolve(__dirname, '..', '..', DEFAULT_STORAGE_RELATIVE_DIR);

type IdImageSource = {
  url: string;
  name?: string;
  contentType?: string | null;
};

const IMAGE_CONTENT_TYPE_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif'
};

const HTTP_URL_RE = /^https?:\/\//i;

const safeDecodeURIComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const normalizeExt = (ext?: string | null): string | null => {
  if (!ext) {
    return null;
  }

  const normalized = ext.replace(/^\./, '').trim().toLowerCase();
  return normalized || null;
};

const getFileExtFromName = (name?: string): string | null => {
  if (!name) {
    return null;
  }

  const ext = path.extname(name);
  return normalizeExt(ext);
};

const getFileExtFromUrl = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    return getFileExtFromName(parsed.pathname);
  } catch {
    return getFileExtFromName(url);
  }
};

const getFileExtFromContentType = (contentType?: string | null): string | null => {
  if (!contentType) {
    return null;
  }

  const normalized = contentType.toLowerCase().split(';')[0].trim();
  return IMAGE_CONTENT_TYPE_TO_EXT[normalized] ?? null;
};

const buildFileName = (source: IdImageSource, responseContentType?: string | null): string => {
  const ext =
    getFileExtFromName(source.name) ??
    getFileExtFromUrl(source.url) ??
    getFileExtFromContentType(source.contentType) ??
    getFileExtFromContentType(responseContentType) ??
    'bin';

  return `${Date.now()}-${randomUUID()}.${ext}`;
};

const uniquePaths = (items: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items) {
    const normalized = path.resolve(item);
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
};

export const getIdImageStorageDir = (): string => PRIMARY_STORAGE_DIR;

export const getIdImageStaticDirs = (): string[] => {
  const cwd = process.cwd();
  return uniquePaths([
    PRIMARY_STORAGE_DIR,
    path.resolve(cwd, DEFAULT_STORAGE_RELATIVE_DIR),
    path.resolve(cwd, 'apps', 'server', DEFAULT_STORAGE_RELATIVE_DIR)
  ]);
};

const ensureStorageDir = async (): Promise<string> => {
  const target = getIdImageStorageDir();
  await fs.mkdir(target, { recursive: true });
  return target;
};

const parseLocalStoredPath = (value: string): string | null => {
  if (!value) {
    return null;
  }

  if (value.startsWith(`${ID_IMAGE_PUBLIC_BASE_PATH}/`)) {
    return value;
  }

  try {
    const parsed = new URL(value);
    if (parsed.pathname.startsWith(`${ID_IMAGE_PUBLIC_BASE_PATH}/`)) {
      return parsed.pathname;
    }
  } catch {
    return null;
  }

  return null;
};

export const isLocalIdImageUrl = (value?: string | null): boolean => {
  if (!value) {
    return false;
  }

  return parseLocalStoredPath(value) !== null;
};

export const resolveLocalIdImageAbsolutePath = (value: string): string | null => {
  const publicPath = parseLocalStoredPath(value);
  if (!publicPath) {
    return null;
  }

  const encodedFilename = publicPath.slice(`${ID_IMAGE_PUBLIC_BASE_PATH}/`.length);
  if (!encodedFilename) {
    return null;
  }

  const filename = safeDecodeURIComponent(encodedFilename);
  const safeFilename = path.basename(filename);
  if (!safeFilename || safeFilename !== filename) {
    return null;
  }

  const allDirs = getIdImageStaticDirs();
  for (const dir of allDirs) {
    const candidate = path.join(dir, safeFilename);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return path.join(getIdImageStorageDir(), safeFilename);
};

export const deleteLocalIdImage = async (value?: string | null): Promise<boolean> => {
  if (!value) {
    return false;
  }

  const publicPath = parseLocalStoredPath(value);
  if (!publicPath) {
    return false;
  }

  const encodedFilename = publicPath.slice(`${ID_IMAGE_PUBLIC_BASE_PATH}/`.length);
  if (!encodedFilename) {
    return false;
  }

  const filename = safeDecodeURIComponent(encodedFilename);
  const safeFilename = path.basename(filename);
  if (!safeFilename || safeFilename !== filename) {
    return false;
  }

  let removed = false;
  for (const dir of getIdImageStaticDirs()) {
    const absolutePath = path.join(dir, safeFilename);
    try {
      await fs.unlink(absolutePath);
      removed = true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return removed;
};

export const saveIdImageLocally = async (source: IdImageSource): Promise<string> => {
  if (!source.url) {
    throw new Error('ID image URL is missing');
  }

  if (isLocalIdImageUrl(source.url)) {
    return source.url;
  }

  if (!HTTP_URL_RE.test(source.url)) {
    return source.url;
  }

  const response = await fetch(source.url, {
    method: 'GET',
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000)
  });

  if (!response.ok) {
    throw new Error(`Unable to download image: HTTP ${response.status}`);
  }

  const body = Buffer.from(await response.arrayBuffer());
  if (!body.length) {
    throw new Error('Downloaded image is empty');
  }

  const targetDir = await ensureStorageDir();
  const fileName = buildFileName(source, response.headers.get('content-type'));
  const absolutePath = path.join(targetDir, fileName);

  await fs.writeFile(absolutePath, body);

  return `${ID_IMAGE_PUBLIC_BASE_PATH}/${encodeURIComponent(fileName)}`;
};

export const purgeLocalIdImageStorage = async (): Promise<void> => {
  const allDirs = getIdImageStaticDirs();
  for (const targetDir of allDirs) {
    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.mkdir(targetDir, { recursive: true });
  }
};
