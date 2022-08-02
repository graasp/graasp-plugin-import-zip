import { ReadStream } from 'fs';

import { FileItemType, Item, LocalFileConfiguration, S3FileConfiguration } from '@graasp/sdk';

export interface GraaspPluginZipOptions {
  pathPrefix: string;
  fileItemType: FileItemType;
  fileConfigurations: { s3: S3FileConfiguration; local: LocalFileConfiguration };
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
  filepath: string;
  itemId: string;
  mimetype: string;
  fileStorage: string;
}) => Promise<ReadStream>;
