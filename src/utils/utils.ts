import { FastifyLoggerInstance } from 'fastify';
import { Item } from 'graasp';
import fs from 'fs';
import path from 'path';
import { readFile } from 'fs/promises';
import mime from 'mime-types';
import { DESCRIPTION_EXTENTION, ItemType } from '../constants';
import { ORIGINAL_FILENAME_TRUNCATE_LIMIT } from 'graasp-plugin-file-item';
import type { Extra, UpdateParentDescriptionFunction, UploadFileFunction } from '../types';
import { InvalidArchiveStructureError } from './errors';

export const generateItemFromFilename = async (options: {
  filename: string;
  folderPath: string;
  log: FastifyLoggerInstance;
  fileServiceType: string;
  uploadFile: UploadFileFunction;
}): Promise<Partial<Item> | null> => {
  const { filename, uploadFile, fileServiceType, folderPath } = options;
  // bug: what if has dot in name?
  const name = filename.split('.')[0];

  // ignore hidden files such as .DS_STORE
  if (!name) {
    return null;
  }

  const filepath = path.join(folderPath, filename);
  const stats = fs.lstatSync(filepath);

  // folder
  if (stats.isDirectory()) {
    // element has no extension -> folder
    return {
      name,
      type: ItemType.FOLDER,
    };
  }

  // string content
  // todo: optimize to avoid reading the file twice in case of upload
  const content = await readFile(filepath, {
    encoding: 'utf8',
    flag: 'r',
  });

  // links and apps
  if (filename.endsWith('.url')) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_source, link, linkType] = content.split('\n');

    // get url from content
    const url = link.slice('URL='.length);

    // get if app in content -> url is either a link or an app
    const type = linkType.includes('1') ? ItemType.APP : ItemType.LINK;

    return {
      name,
      type,
      extra: {
        [type]: {
          url,
        },
      },
    };
  }
  // documents
  else if (filename.endsWith('.graasp')) {
    return {
      name,
      type: ItemType.DOCUMENT,
      extra: {
        [ItemType.DOCUMENT]: {
          // not sure
          content: content,
        },
      },
    };
  }
  // normal files
  else {
    const mimetype = mime.lookup(filename);
    const { size } = stats;

    // upload file
    const uploadFilePath = await uploadFile({ mimetype, filepath });

    // create file item
    return {
      name: filename.substring(0, ORIGINAL_FILENAME_TRUNCATE_LIMIT),
      type: fileServiceType,
      extra: {
        [fileServiceType]: {
          name: filename,
          path: uploadFilePath,
          size,
          mimetype,
        },
      },
    };
  }
};

export const handleItemDescription = async (options: {
  filename: string;
  filepath: string;
  folderName: string;
  parentId: string;
  items: Partial<Item>[];
  updateParentDescription: UpdateParentDescriptionFunction;
}): Promise<void> => {
  const { filename, items, filepath, parentId, folderName, updateParentDescription } = options;

  const name = filename.split('.')[0];

  // string content
  // todo: optimize to avoid reading the file twice in case of upload
  const content = await readFile(filepath, {
    encoding: 'utf8',
    flag: 'r',
  });

  // parent folder description
  if (filename === `${folderName}${DESCRIPTION_EXTENTION}`) {
    await updateParentDescription({ parentId, content });
  }
  // links description
  else if (filename.endsWith(`.url${DESCRIPTION_EXTENTION}`)) {
    const item = items.find(({ name: thisName }) => name === thisName);
    item.description = content;
  }
  // files description
  else if (filename.endsWith(DESCRIPTION_EXTENTION)) {
    const item = items.find(({ name: thisName }) => name === thisName.split('.')[0]);
    item.description = content;
  } else {
    console.error(`${filepath} is not handled`);
  }
};

export const checkHasZipStructure = async (contentPath: string): Promise<boolean> => {
  // content has only one root
  const children = fs.readdirSync(contentPath);
  if (children.length !== 1) {
    throw new InvalidArchiveStructureError();
  }

  return true;
};

// build the file content in case of Link/App
export const buildTextContent = (url: string, type: ItemType): string => {
  if (type === ItemType.LINK) {
    return `[InternetShortcut]\n${url}\n`;
  }
  return `[InternetShortcut]\n${url}\nAppURL=1\n`;
};

export const addItemToZip = async (item: Item, dirPath, archive, member, fileServiceType, iTM, runner) => {
  // get item and its related data
  const itemExtra = item.extra as Extra;

  switch (item.type) {
    case fileServiceType:
      // TODO: add uploaded files into zip
      break;
    case ItemType.DOCUMENT:
      archive.append(itemExtra.document?.content, {
        name: path.join(dirPath, `${item.name}.graasp`),
      });
      break;
    case ItemType.LINK:
      archive.append(buildTextContent(itemExtra.embeddedLink?.url, ItemType.LINK), {
        name: path.join(dirPath, `${item.name}.url`),
      });
      break;
    case ItemType.APP:
      archive.append(buildTextContent(itemExtra.app?.url, ItemType.APP), {
        name: path.join(dirPath, `${item.name}.url`),
      });
      break;
    case ItemType.FOLDER:
      // append description
      dirPath = path.join(dirPath, item.name);
      if (item.description) {
        archive.append(item.description, {
          name: path.join(dirPath, `${item.name}.description.html`),
        });
      }
      // eslint-disable-next-line no-case-declarations
      const subItems = await runner.runSingleSequence(
        iTM.createGetChildrenTaskSequence(member, item.id, true)
      );
      console.log(subItems);
      (subItems as Item[]).forEach((subItem) => {
        addItemToZip(subItem, dirPath, archive, member, fileServiceType, iTM, runner);
      });
  }
};

// TODO: download file from S3
// const extraFile = item.extra?.s3File as ExtraFile;
// const filePath = `${extraFile.path}/${extraFile.name}`;
// const downloadTask = fTM.createDownloadFileTask(member, {
//   reply,
//   itemId: item.id,
//   filepath: extraFile.path,
//   mimetype: extraFile.mimetype,
// });
// const file = await runner.runSingle(downloadTask);
// console.log('received file', file);
// archive.append(fs.createReadStream(file as PathLike), { name: `${extraFile.name}` });
