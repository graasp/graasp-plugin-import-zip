import { FastifyPluginAsync } from 'fastify';
import fs, { ReadStream } from 'fs';
import path from 'path';
import { Item } from 'graasp';
import { FileTaskManager, ServiceMethod } from 'graasp-plugin-file';
import graaspPublicPlugin from 'graasp-plugin-public';
import { FILE_ITEM_TYPES } from 'graasp-plugin-file-item';
import { TMP_FOLDER_PATH } from './constants';
import { zipExport } from './schemas/schema';
import { prepareArchiveFromItem } from './utils/utils';
import { DownloadFileFunction, GetChildrenFromItemFunction, GraaspPluginZipOptions } from './types';

const plugin: FastifyPluginAsync<GraaspPluginZipOptions> = async (fastify, options) => {
  const {
    items: { taskManager: iTM },
    taskRunner: runner,
    public: {
      items: { taskManager: publicTaskManager },
    },
  } = fastify;

  if (!graaspPublicPlugin) {
    throw new Error('Public plugin is not correctly defined');
  }

  const { serviceMethod, serviceOptions } = options;

  const SERVICE_ITEM_TYPE =
    serviceMethod === ServiceMethod.S3 ? FILE_ITEM_TYPES.S3 : FILE_ITEM_TYPES.LOCAL;

  const fTM = new FileTaskManager(serviceOptions, serviceMethod);

  // download item as zip
  fastify.route<{ Params: { itemId: string } }>({
    method: 'GET',
    url: '/zip-export/:itemId',
    schema: zipExport,
    handler: async ({ member, params: { itemId }, log }, reply) => {
      // get item info
      const getItemTask = publicTaskManager.createGetPublicItemTask(member, { itemId });
      const item = (await runner.runSingle(getItemTask)) as Item;

      // no need to verify public attribute, as it is verified when getting the parent item
      const getChildrenFromItem: GetChildrenFromItemFunction = async ({ itemId }) =>
        runner.runSingle(iTM.createGetChildrenTask(member, { itemId }));

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
