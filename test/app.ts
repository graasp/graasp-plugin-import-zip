import fastify, { FastifyInstance } from 'fastify';
import plugin from '../src/service-api';
import { TaskRunner, ItemTaskManager } from 'graasp-test';
import schemas from '../src/schemas/common';
import { ServiceMethod } from 'graasp-plugin-file';
import { GraaspImportZipPluginOptions } from '../src/types';

type props = {
  taskManager: ItemTaskManager;
  runner: TaskRunner;
  options?: GraaspImportZipPluginOptions;
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

const build = async ({ taskManager, runner }: props): Promise<FastifyInstance> => {
  const app = fastify();
  app.addSchema(schemas);
  app.decorate('taskRunner', runner);
  app.decorate('items', {
    taskManager,
  });

  await app.register(plugin, DEFAULT_OPTIONS);

  return app;
};
export default build;
