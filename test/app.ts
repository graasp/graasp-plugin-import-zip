import fastify, { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { TaskRunner, ItemTaskManager } from 'graasp-test';
import schemas from '../src/schemas/common';
import { ServiceMethod } from 'graasp-plugin-file';
import { GraaspPluginZipOptions } from '../src/types';
import { PublicItemTaskManager } from 'graasp-plugin-public';

type props = {
  taskManager: ItemTaskManager;
  runner: TaskRunner;
  options?: GraaspPluginZipOptions;
  plugin: FastifyPluginAsync<GraaspPluginZipOptions>;
  publicItemTaskManager?: PublicItemTaskManager;
};

export const DEFAULT_OPTIONS = {
  pathPrefix: 'pathPrefix',
  serviceMethod: ServiceMethod.LOCAL,
  serviceOptions: {
    s3: {
      s3Region: 's3Region',
      s3Bucket: 's3Bucket',
      s3AccessKeyId: 's3AccessKeyId',
      s3SecretAccessKey: 's3SecretAccessKey',
    },
    local: {
      storageRootPath: 'storageRootPath',
    },
  },
};

const build = async ({
  plugin,
  taskManager,
  publicItemTaskManager,
  runner,
}: props): Promise<FastifyInstance> => {
  const app = fastify();
  app.addSchema(schemas);
  app.decorate('taskRunner', runner);
  app.decorate('items', {
    taskManager,
  });
  app.decorate('public', {
    items: {
      taskManager: publicItemTaskManager,
    },
  });

  await app.register(plugin, DEFAULT_OPTIONS);

  return app;
};
export default build;
