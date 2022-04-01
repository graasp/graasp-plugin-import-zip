import { FastifyPluginAsync } from 'fastify';
import extract from 'extract-zip';
import fs, { ReadStream } from 'fs';
import { mkdir } from 'fs/promises';
import { v4 } from 'uuid';
import path from 'path';
import { FileTaskManager, ServiceMethod } from 'graasp-plugin-file';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { readFile } from 'fs/promises';
import fastifyMultipart from 'fastify-multipart';
import { Item } from 'graasp';
import { DESCRIPTION_EXTENTION, ItemType, TMP_FOLDER_PATH, DEFAULT_MAX_FILE_SIZE } from './constants';
import { zipExport, zipImport } from './schemas/schema';
import { buildFilePathFromPrefix, FILE_ITEM_TYPES } from 'graasp-plugin-file-item';
import {
  checkHasZipStructure,
  generateItemFromFilename,
  handleItemDescription,
  prepareArchiveFromItem,
} from './utils/utils';
import {
  DownloadFileFunction,
  GetChildrenFromItemFunction,
  GraaspPluginZipOptions,
  UpdateParentDescriptionFunction,
  UploadFileFunction,
} from './types';
import { FileIsInvalidArchiveError } from './utils/errors';


const plugin: FastifyPluginAsync<GraaspPluginZipOptions> = async (fastify, options) => {
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
          fileServiceType: SERVICE_ITEM_TYPE,
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
      if (zipFile.mimetype !== 'application/zip') {
        throw new FileIsInvalidArchiveError();
      }

      const uploadFile: UploadFileFunction = async ({ filepath, mimetype }) => {
        log.debug(`upload ${filepath}`);

        const buffer = await readFile(filepath);
        const uploadFilePath = buildFilePathFromPrefix(pathPrefix);
        const uploadTask = fTM.createUploadFileTask(member, {
          file: buffer,
          filepath: uploadFilePath,
          mimetype,
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
      await pipeline(Readable.from(await zipFile.toBuffer()), fs.createWriteStream(zipPath));

      await extract(zipPath, { dir: contentFolder });

      // check zip has graasp structure <- might delete this to accept any zip
      await checkHasZipStructure(contentFolder);

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
        fileServiceType: SERVICE_ITEM_TYPE,
        getChildrenFromItem,
        downloadFile,
      });
    },
    onResponse: async (request) => {
      // delete tmp files after endpoint responded
      const itemId = (request?.params as { itemId: string })?.itemId as string;
      const fileStorage = path.join(__dirname, TMP_FOLDER_PATH, itemId);
      fs.rmSync(fileStorage, { recursive: true });
    },
  });
};

export default plugin;
