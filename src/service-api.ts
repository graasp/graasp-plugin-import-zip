import { FastifyPluginAsync } from 'fastify';
import extract from 'extract-zip';
import fs from 'fs';
import { mkdir } from 'fs/promises';
import { v4 } from 'uuid';
import path from 'path';
import { FileTaskManager, ServiceMethod } from 'graasp-plugin-file';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { readFile } from 'fs/promises';
import fastifyMultipart from 'fastify-multipart';
import { Item } from 'graasp';
import { DESCRIPTION_EXTENTION, ItemType, TMP_FOLDER_PATH } from './constants';
import { zipImport } from './schemas/schema';
import { buildFilePathFromPrefix, FILE_ITEM_TYPES } from 'graasp-plugin-file-item';
import { checkHasZipStructure, generateItemFromFilename, handleItemDescription } from './utils/utils';
import {
  GraaspImportZipPluginOptions,
  UpdateParentDescriptionFunction,
  UploadFileFunction,
} from './types';
import { FileIsNotAValidArchiveError } from './utils/errors';

const DEFAULT_MAX_FILE_SIZE = 1024 * 1024 * 250; // 250MB

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

  const createItemsFromFolderContent = async ({
    folderPath,
    parentId,
    log,
    uploadFile,
    updateParentDescription,
    member,
  }) => {
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
        throw new FileIsNotAValidArchiveError();
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

      try {
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
      } catch (err) {
        log.error('err: ', err);
        // handle any errors
      }
    },
  );
};

export default plugin;
