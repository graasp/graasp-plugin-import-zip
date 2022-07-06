import fs, { ReadStream } from 'fs';

import { FastifyPluginAsync } from 'fastify';

import { Item } from 'graasp';
import { FileTaskManager } from 'graasp-plugin-file';
import graaspPublicPlugin from 'graasp-plugin-public';

import { zipExport } from './schemas/schema';
import { DownloadFileFunction, GetChildrenFromItemFunction, GraaspPluginZipOptions } from './types';
import { buildStoragePath, prepareArchiveFromItem } from './utils/utils';

const plugin: FastifyPluginAsync<GraaspPluginZipOptions> = async (fastify, options) => {
  const {
    items: { taskManager: iTM },
    taskRunner: runner,
    public: {
      items: { taskManager: publicTaskManager },
      graaspActor,
    },
    h5p: { taskManager: h5pTM },
  } = fastify;

  if (!graaspPublicPlugin) {
    throw new Error('Public plugin is not correctly defined');
  }

  const { serviceMethod, serviceOptions } = options;

  const fTM = new FileTaskManager(serviceOptions, serviceMethod);

  // download item as zip
  fastify.route<{ Params: { itemId: string } }>({
    method: 'GET',
    url: '/zip-export/:itemId',
    schema: zipExport,
    handler: async ({ params: { itemId }, log }, reply) => {
      const member = graaspActor;
      // get item info
      const getItemTask = publicTaskManager.createGetPublicItemTask(member, { itemId });
      const item = (await runner.runSingle(getItemTask)) as Item;

      // no need to verify public attribute, as it is verified when getting the parent item
      const getChildrenFromItem: GetChildrenFromItemFunction = async ({ item }) =>
        runner.runSingle(iTM.createGetChildrenTask(member, { item }));

      const downloadFile: DownloadFileFunction = async ({ taskFactory }) => {
        const task = taskFactory(member);
        // if file not found, an error will be thrown by this line
        const fileStream = (await runner.runSingle(task)) as ReadStream;
        return fileStream;
      };

      return prepareArchiveFromItem({
        item,
        log,
        reply,
        fileTaskManagers: { file: fTM, h5p: h5pTM },
        fileServiceType: serviceMethod,
        getChildrenFromItem,
        downloadFile,
      });
    },
    onResponse: async ({ params, log }) => {
      // delete tmp files after endpoint responded
      const itemId = (params as { itemId: string })?.itemId as string;
      const fileStorage = buildStoragePath(itemId);
      if (fs.existsSync(fileStorage)) {
        fs.rmSync(fileStorage, { recursive: true });
      } else {
        log?.error(`${fileStorage} was not found, and was not deleted`);
      }
    },
  });
};

export default plugin;
