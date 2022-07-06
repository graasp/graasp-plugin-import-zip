import { ReadStream } from 'fs';

import { FastifyInstance } from 'fastify';

import { Actor, Item, Task } from 'graasp';
import {
  GraaspLocalFileItemOptions,
  GraaspS3FileItemOptions,
  ServiceMethod,
} from 'graasp-plugin-file';

/**
 * Workaround to get Typescript to know about the fastify instance augmentation
 * Cannot use types directly from graasp-plugin-h5p, otherwise we get a cyclic
 * redundancy, so we type it here directly instead. TODO find better way?
 */
declare module 'fastify' {
  interface FastifyInstance {
    h5p?: {
      taskManager: {
        createDownloadH5PFileTask(item: Item, destinationPath: string, member: Actor);
      };
    };
  }
}
export type H5PTaskManager = FastifyInstance['h5p']['taskManager'];

export interface GraaspPluginZipOptions {
  pathPrefix: string;
  serviceMethod: ServiceMethod;
  serviceOptions: { s3: GraaspS3FileItemOptions; local: GraaspLocalFileItemOptions };
}

export type UploadFileFunction = ({ filepath, mimetype }) => Promise<string>;
export type UpdateParentDescriptionFunction = ({ parentId, content }) => Promise<void>;

export type Extra = {
  s3File?: {
    name: string;
    path: string;
    size: number;
    mimetype;
  };
  document?: {
    content: string;
  };
  embeddedLink?: {
    url: string;
    icons: string[];
    thumbnails;
  };
  app?: {
    url: string;
    settings;
  };
};

export type GetChildrenFromItemFunction = ({ item }: { item: Item }) => Promise<Item[]>;

export type DownloadFileFunction = (args: {
  taskFactory: (member: Actor) => Task<Actor, ReadStream>;
}) => Promise<ReadStream>;
