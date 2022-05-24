import extract from 'extract-zip';
import fs, { ReadStream, createReadStream } from 'fs';
import { mkdir } from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';
import { v4 } from 'uuid';

import fastifyMultipart from '@fastify/multipart';
import { FastifyPluginAsync } from 'fastify';

import { Item } from 'graasp';
import { FileTaskManager } from 'graasp-plugin-file';
import { buildFilePathFromPrefix } from 'graasp-plugin-file-item';

import {
  DEFAULT_MAX_FILE_SIZE,
  DESCRIPTION_EXTENTION,
  ItemType,
  TMP_FOLDER_PATH,
  ZIP_FILE_MIME_TYPES,
} from './constants';
import { zipExport, zipImport } from './schemas/schema';
import {
  DownloadFileFunction,
  GetChildrenFromItemFunction,
  GraaspPluginZipOptions,
  UpdateParentDescriptionFunction,
  UploadFileFunction,
} from './types';
import { FileIsInvalidArchiveError } from './utils/errors';
import {
  generateItemFromFilename,
  handleItemDescription,
  prepareArchiveFromItem,
} from './utils/utils';

const plugin: FastifyPluginAsync<GraaspPluginZipOptions> = async (fastify, options) => {
  const {
    items: { taskManager: iTM },
    taskRunner: runner,
  } = fastify;

  const { serviceMethod, serviceOptions, pathPrefix } = options;

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

  const createItemsFromFolderContent = async ({
    folderPath,
    parentId,
    log,
    uploadFile,
    updateParentDescription,
    member,
  }): Promise<Item[]> => {
    const filenames = fs.readdirSync(folderPath);
    const folderName = path.basename(folderPath);

    const items = [];

    for (const filename of filenames) {
      const filepath = path.join(folderPath, filename);

      // update items' descriptions
      if (filename.endsWith(DESCRIPTION_EXTENTION)) {
        await handleItemDescription({
          filename,
          filepath,
          folderName,
          parentId,
          items,
          updateParentDescription,
        });
      }
      // add new item
      else {
        const item = await generateItemFromFilename({
          fileServiceType: serviceMethod,
          uploadFile,
          filename,
          folderPath,
          log,
        });
        item && items.push(item);
      }
    }

    // create the items
    const tasks = items.map((item) => iTM.createCreateTaskSequence(member, item, parentId));
    const newItems = (await runner.runMultipleSequences(tasks)) as Item[];

    // recursively create children in folders
    for (const { type, name, id } of newItems) {
      if (type === ItemType.FOLDER) {
        await createItemsFromFolderContent({
          uploadFile,
          member,
          folderPath: path.join(folderPath, name),
          parentId: id,
          log,
          updateParentDescription,
        });
      }
    }
    return newItems;
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

      // throw if file is not a zip
      if (!ZIP_FILE_MIME_TYPES.includes(zipFile.mimetype)) {
        throw new FileIsInvalidArchiveError(zipFile.mimetype);
      }

      const uploadFile: UploadFileFunction = async ({ filepath, mimetype }) => {
        log.debug(`upload ${filepath}`);

        const uploadFilePath = buildFilePathFromPrefix(pathPrefix);
        const uploadTask = fTM.createUploadFileTask(member, {
          file: createReadStream(filepath),
          filepath: uploadFilePath,
          mimetype,
          size: fs.statSync(filepath).size,
        });
        await runner.runSingle(uploadTask);
        return uploadFilePath;
      };

      const updateParentDescription: UpdateParentDescriptionFunction = async ({
        parentId,
        content,
      }) => {
        await runner.runSingleSequence(
          iTM.createUpdateTaskSequence(member, parentId, { description: content }),
        );
      };

      // read and prepare folder for zip and content
      const tmpId = v4();
      const targetFolder = path.join(__dirname, TMP_FOLDER_PATH, tmpId);
      await mkdir(targetFolder, { recursive: true });
      const zipPath = path.join(targetFolder, `${tmpId}.zip`);
      const contentFolder = path.join(targetFolder, 'content');

      // save graasp zip
      await pipeline(zipFile.file, fs.createWriteStream(zipPath));

      await extract(zipPath, { dir: contentFolder });

      const items = await createItemsFromFolderContent({
        member,
        updateParentDescription,
        uploadFile,
        folderPath: contentFolder,
        parentId,
        log,
      });

      // delete zip and content
      fs.rmSync(targetFolder, { recursive: true });

      return items;
    },
  );

  // download item as zip
  fastify.route<{ Params: { itemId: string } }>({
    method: 'GET',
    url: '/zip-export/:itemId',
    schema: zipExport,
    handler: async ({ member, params: { itemId }, log }, reply) => {
      // get item info
      const getItemTasks = iTM.createGetTaskSequence(member, itemId);
      const item = (await runner.runSingleSequence(getItemTasks)) as Item;

      const getChildrenFromItem: GetChildrenFromItemFunction = async ({ item }) => {
        const items = await runner.runSingleSequence(
          iTM.createGetChildrenTaskSequence(member, item.id, true),
        );
        return items as Item[];
      };

      const downloadFile: DownloadFileFunction = async ({
        filepath,
        itemId,
        mimetype,
        fileStorage,
      }) => {
        const task = fTM.createDownloadFileTask(member, {
          filepath,
          itemId,
          mimetype,
          fileStorage,
        });

        // if file not found, an error will be thrown by this line
        const fileStream = (await runner.runSingle(task)) as ReadStream;
        return fileStream;
      };

      return prepareArchiveFromItem({
        item,
        log,
        reply,
        fileServiceType: serviceMethod,
        getChildrenFromItem,
        downloadFile,
      });
    },
    onResponse: async ({ params, log }) => {
      // delete tmp files after endpoint responded
      const itemId = (params as { itemId: string })?.itemId as string;
      const fileStorage = path.join(__dirname, TMP_FOLDER_PATH, itemId);
      if (fs.existsSync(fileStorage)) {
        fs.rmSync(fileStorage, { recursive: true });
      } else {
        log?.error(`${fileStorage} was not found, and was not deleted`);
      }
    },
  });
};

export default plugin;
