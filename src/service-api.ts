import { FastifyPluginAsync } from 'fastify';
import extract from 'extract-zip';
import fs from 'fs';
import { readFile } from 'fs/promises';
import { mkdir } from 'fs/promises';
import { v4 } from 'uuid';
import mime from 'mime-types';
import path from 'path';
import {
  FileTaskManager,
  GraaspLocalFileItemOptions,
  GraaspS3FileItemOptions,
  ServiceMethod,
} from 'graasp-plugin-file';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import fastifyMultipart from 'fastify-multipart';
import { Item } from 'graasp';
import { TMP_FOLDER_PATH } from './constants';
import { zipImport } from './schema';
import {
  buildFilePathFromPrefix,
  ORIGINAL_FILENAME_TRUNCATE_LIMIT,
  FILE_ITEM_TYPES,
} from 'graasp-plugin-file-item';

export interface GraaspImportZipPluginOptions {
  pathPrefix: string;
  serviceMethod: ServiceMethod;
  serviceOptions: { s3: GraaspS3FileItemOptions; local: GraaspLocalFileItemOptions };
}

const DEFAULT_MAX_FILE_SIZE = 1024 * 1024 * 250; // 250MB

enum ITEM_TYPES {
  LINK = 'embeddedLink',
  APP = 'app',
  DOCUMENT = 'document',
  FOLDER = 'folder',
}

const plugin: FastifyPluginAsync<GraaspImportZipPluginOptions> = async (fastify, options) => {
  const {
    items: { taskManager: iTM },
    taskRunner: runner,
  } = fastify;

  const { serviceMethod, serviceOptions, pathPrefix } = options;

  const SERVICE_ITEM_TYPE =
    serviceMethod === ServiceMethod.S3 ? FILE_ITEM_TYPES.S3 : FILE_ITEM_TYPES.LOCAL;

  const fTM = new FileTaskManager(serviceOptions, serviceMethod);

  fastify.register(fastifyMultipart, {
    limits: {
      // fieldNameSize: 0,             // Max field name size in bytes (Default: 100 bytes).
      // fieldSize: 1000000,           // Max field value size in bytes (Default: 1MB).
      fields: 0, // Max number of non-file fields (Default: Infinity).
      fileSize: DEFAULT_MAX_FILE_SIZE, // For multipart forms, the max file size (Default: Infinity).
      files: 1, // Max number of file fields (Default: Infinity).
      // headerPairs: 2000             // Max number of header key=>value pairs (Default: 2000 - same as node's http).
    },
  });

  const createItemsFromFolderContent = async (member, folderPath, parentId, log) => {
    const filenames = fs.readdirSync(folderPath);
    const folderName = path.basename(folderPath);

    const items = [];

    for (const filename of filenames) {

      // what if has dot in name?
      const name = filename.split('.')[0];

      // ignore hidden files such as .DS_STORE
      if (!name) {
        continue;
      }

      const filepath = path.join(folderPath, filename);
      const stats = fs.lstatSync(filepath);

      // folder
      if (stats.isDirectory()) {
        // element has no extension -> folder
        items.push({
          name,
          type: ITEM_TYPES.FOLDER,
        });
      }
      // files
      else {
        // string content
        // todo: optimize to avoid reading the file twice in case of upload
        const content = await readFile(filepath, {
          encoding: 'utf8',
          flag: 'r',
        });

        // parent folder description
        if (filename === `${folderName}.description.html`) {
          await runner.runSingleSequence(
            iTM.createUpdateTaskSequence(member, parentId, { description: content }),
          );
        }
        // links
        else if (filename.endsWith('.url')) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const [_source, link, linkType] = content.split('\n');

          // get url from content
          const url = link.slice('URL='.length);

          // get if app in content -> url is either a link or an app
          const type = linkType.includes('1') ? ITEM_TYPES.APP : ITEM_TYPES.LINK;

          items.push({
            name,
            type,
            extra: {
              [type]: {
                url,
              },
            },
          });
        }
        // links description
        else if (filename.endsWith('.url.description.html')) {
          const item = items.find(({ name: thisName }) => name === thisName);
          item.description = content;
        }
        // documents
        else if (filename.endsWith('.graasp')) {
          items.push({
            name,
            type: ITEM_TYPES.DOCUMENT,
            extra: {
              [ITEM_TYPES.DOCUMENT]: {
                // not sure
                content: content,
              },
            },
          });
        }
        // files description
        else if (filename.endsWith('.description.html')) {
          const item = items.find(({ name: thisName }) => name === thisName);
          item.description = content;
        }
        // normal files
        else {
          const mimetype = mime.lookup(filename);
          const { size } = stats;
          const buffer = await readFile(filepath);

          // upload file
          log.debug(`upload ${filepath}`);
          const uploadFilePath = buildFilePathFromPrefix(pathPrefix);
          const uploadTask = fTM.createUploadFileTask(member, {
            file: buffer,
            // the filepath does not use
            filepath: uploadFilePath,
            mimetype,
          });
          await runner.runSingle(uploadTask);

          // create file item
          const name = filename.substring(0, ORIGINAL_FILENAME_TRUNCATE_LIMIT);
          items.push({
            name,
            type: SERVICE_ITEM_TYPE,
            extra: {
              [SERVICE_ITEM_TYPE]: {
                name: filename,
                path: uploadFilePath,
                size,
                mimetype,
              },
            },
          });
        }
      }
    }

    // create the items
    const tasks = items.map((item) => iTM.createCreateTaskSequence(member, item, parentId));
    const newItems = (await runner.runMultipleSequences(tasks)) as Item[];

    // recursively create children in folders
    // TODO: await
    for (const { type, name, id } of newItems) {
      if (type === ITEM_TYPES.FOLDER) {
        await createItemsFromFolderContent(member, path.join(folderPath, name), id, log);
      }
    }

    return newItems;
  };

  const checkHasZipStructure = async (contentPath: string) => {
    // content has only one root
    const children = fs.readdirSync(contentPath);
    if (children.length !== 1) {
      throw new Error('Zip structure is invalid');
    }

    return true;
  };

  fastify.post<{ Querystring: { parentId?: string } }>(
    '/zip-import',
    { schema: zipImport },
    async (request) => {
      const {
        member,
        log,
        query: { parentId },
      } = request;

      log.debug('Import zip content');

      const zipFile = await request.file();
      // TODO: throw if file is not a zip
      if (zipFile.mimetype !== 'application/zip') {
        throw new Error('File is not a zip archive');
      }

      const tmpId = v4();
      const targetFolder = path.join(TMP_FOLDER_PATH, tmpId);
      await mkdir(targetFolder, { recursive: true });
      const zipPath = path.join(targetFolder, `${tmpId}.zip`);
      const contentFolder = path.join(__dirname, targetFolder, 'content');

      // save graasp zip
      await pipeline(Readable.from(await zipFile.toBuffer()), fs.createWriteStream(zipPath));

      try {
        await extract(zipPath, { dir: contentFolder });

        // check zip has graasp structure <- might delete this to accept any zip
        await checkHasZipStructure(contentFolder);

        const items = await createItemsFromFolderContent(member, contentFolder, parentId, log);

        // delete zip and content
        fs.rmSync(targetFolder, { recursive: true });

        return items;
      } catch (err) {
        log.error('err: ', err);
        // handle any errors
      }
    },
  );
};

export default plugin;
