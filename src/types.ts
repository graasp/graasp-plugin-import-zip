import { ReadStream } from 'fs';

import {
  Actor,
  FileItemType,
  Item,
  LocalFileConfiguration,
  S3FileConfiguration,
  Task,
} from '@graasp/sdk';

export interface GraaspPluginZipOptions {
  pathPrefix: string;
  fileItemType: FileItemType;
  fileConfigurations: { s3: S3FileConfiguration; local: LocalFileConfiguration };
}

export type UploadFileFunction = ({ filepath, mimetype }) => Promise<string>;
export type UpdateParentDescriptionFunction = ({ parentId, content }) => Promise<void>;

export type GetChildrenFromItemFunction = ({ item }: { item: Item }) => Promise<Item[]>;

export type DownloadFileFunction = (args: {
  taskFactory: (member: Actor) => Task<Actor, ReadStream>;
}) => Promise<ReadStream>;
