import { FastifyLoggerInstance } from 'fastify';
import { Item } from 'graasp';
import fs from 'fs';
import path from 'path';
import { mkdir, readFile } from 'fs/promises';
import util from 'util';
import mmm from 'mmmagic';
import mime from 'mime-types';
import archiver, { Archiver } from 'archiver';
import { FILE_ITEM_TYPES, ORIGINAL_FILENAME_TRUNCATE_LIMIT } from 'graasp-plugin-file-item';
import { LocalFileItemExtra, S3FileItemExtra } from 'graasp-plugin-file';
import type {
  DownloadFileFunction,
  Extra,
  GetChildrenFromItemFunction,
  UpdateParentDescriptionFunction,
  UploadFileFunction,
} from '../types';
import { buildSettings, DESCRIPTION_EXTENTION, GRAASP_DOCUMENT_EXTENSION, ItemType, LINK_EXTENSION, TMP_FOLDER_PATH } from '../constants';
import { InvalidArchiveStructureError, InvalidFileItemError } from './errors';

const magic = new mmm.Magic(mmm.MAGIC_MIME_TYPE);
const asyncDetectFile = util.promisify(magic.detectFile.bind(magic));

export const generateItemFromFilename = async (options: {
  filename: string;
  folderPath: string;
  log: FastifyLoggerInstance;
  fileServiceType: string;
  uploadFile: UploadFileFunction;
}): Promise<Partial<Item> | null> => {
  const { filename, uploadFile, fileServiceType, folderPath } = options;

  // ignore hidden files such as .DS_STORE
  if (filename.startsWith('.')) {
    return null;
  }

  const filepath = path.join(folderPath, filename);
  const stats = fs.lstatSync(filepath);

  // folder
  if (stats.isDirectory()) {
    // element has no extension -> folder
    return {
      name: filename,
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
  if (filename.endsWith(LINK_EXTENSION)) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_source, link, linkType] = content.split('\n');

    // get url from content
    const url = link.slice('URL='.length);

    // get if app in content -> url is either a link or an app
    const type = linkType.includes('1') ? ItemType.APP : ItemType.LINK;

    return {
      name: filename.slice(0, -(LINK_EXTENSION.length)),
      type,
      extra: {
        [type]: {
          url,
        },
      },
    };
  }
  // documents
  else if (filename.endsWith(GRAASP_DOCUMENT_EXTENSION)) {
    return {
      // remove .graasp from name
      name: filename.slice(0, -(GRAASP_DOCUMENT_EXTENSION.length)),
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
    const mimetype = await asyncDetectFile(filepath);
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
      settings: buildSettings(mimetype.startsWith('image')),
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

  // string content
  // todo: optimize to avoid reading the file twice in case of upload
  const content = await readFile(filepath, {
    encoding: 'utf8',
    flag: 'r',
  });

  // parent folder description
  if (filename === `${folderName}${DESCRIPTION_EXTENTION}`) {
    console.log(filename)
    await updateParentDescription({ parentId, content });
  }
  // links description
  else if (filename.endsWith(`${LINK_EXTENSION}${DESCRIPTION_EXTENTION}`)) {
    const name = filename.slice(0, -(`${LINK_EXTENSION}${DESCRIPTION_EXTENTION}`.length))
    const item = items.find(({ name: thisName }) => name === thisName);
    if (item) {
      item.description = content;

    } else {
      console.error(`Cannot find item with name ${name}`)
    }
  }
  // documents description
  else if (filename.endsWith(`${GRAASP_DOCUMENT_EXTENSION}${DESCRIPTION_EXTENTION}`)) {
    const name = filename.slice(0, -(`${GRAASP_DOCUMENT_EXTENSION}${DESCRIPTION_EXTENTION}`.length))
    const item = items.find(({ name: thisName }) => name === thisName);
    if (item) {
      item.description = content;

    } else {
      console.error(`Cannot find item with name ${name}`)
    }
  }
  // files and folders description
  else if (filename.endsWith(DESCRIPTION_EXTENTION)) {
    const name = filename.slice(0, -(DESCRIPTION_EXTENTION.length))
    const item = items.find(({ name: thisName }) => name === thisName);
    if (item) {
      item.description = content;

    } else {
      console.error(`Cannot find item with name ${name}`)
    }
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

export const addItemToZip = async (args: {
  item: Item;
  archiveRootPath: string;
  archive: Archiver;
  fileServiceType: string;
  fileStorage: string;
  getChildrenFromItem: GetChildrenFromItemFunction;
  downloadFile: DownloadFileFunction;
}) => {
  const {
    item,
    archiveRootPath,
    archive,
    fileServiceType,
    fileStorage,
    getChildrenFromItem,
    downloadFile,
  } = args;
  // get item and its related data
  const itemExtra = item.extra as Extra;
  let subItems = null;

  switch (item.type) {
    case fileServiceType: {
      let filepath = '';
      let mimetype = '';
      // check for service type and assign filepath, mimetype respectively
      if (fileServiceType === FILE_ITEM_TYPES.S3) {
        const s3Extra = item?.extra as S3FileItemExtra;
        filepath = s3Extra?.s3File?.path;
        mimetype = s3Extra?.s3File?.mimetype;
      } else if (fileServiceType === FILE_ITEM_TYPES.LOCAL) {
        const fileExtra = item.extra as LocalFileItemExtra;
        filepath = fileExtra?.file?.path;
        mimetype = fileExtra?.file?.mimetype;
      } else {
        // throw if service type is neither
        console.error(`fileServiceType invalid: ${fileServiceType}`);
      }

      if (!filepath || !mimetype) {
        throw new InvalidFileItemError(item);
      }

      const fileStream = await downloadFile({
        filepath,
        itemId: item.id,
        mimetype,
        fileStorage,
      });

      // build filename with extension if does not exist
      let ext = path.extname(item.name);
      if (!ext) {
        // only add a dot in case of building file name with mimetype, otherwise there will be two dots in file name
        ext = `.${mime.extension(mimetype)}`;
      }
      const filename = `${path.basename(item.name, ext)}${ext}`;

      // add file in archive
      archive.append(fileStream, {
        name: path.join(archiveRootPath, filename),
      });

      break;
    }
    case ItemType.DOCUMENT:
      archive.append(itemExtra.document?.content, {
        name: path.join(archiveRootPath, `${item.name}${GRAASP_DOCUMENT_EXTENSION}`),
      });
      break;
    case ItemType.LINK:
      archive.append(buildTextContent(itemExtra.embeddedLink?.url, ItemType.LINK), {
        name: path.join(archiveRootPath, `${item.name}${LINK_EXTENSION}`),
      });
      break;
    case ItemType.APP:
      archive.append(buildTextContent(itemExtra.app?.url, ItemType.APP), {
        name: path.join(archiveRootPath, `${item.name}${LINK_EXTENSION}`),
      });
      break;
    case ItemType.FOLDER: {
      // append description
      const folderPath = path.join(archiveRootPath, item.name);
      if (item.description) {
        archive.append(item.description, {
          name: path.join(folderPath, `${item.name}${DESCRIPTION_EXTENTION}`),
        });
      }
      // eslint-disable-next-line no-case-declarations
      subItems = await getChildrenFromItem({ item });
      await Promise.all(
        subItems.map((subItem) =>
          addItemToZip({
            item: subItem,
            archiveRootPath: folderPath,
            archive,
            fileServiceType,
            fileStorage,
            getChildrenFromItem,
            downloadFile,
          }),
        ),
      );
    }
  }
};

export const buildStoragePath = (itemId) => path.join(__dirname, TMP_FOLDER_PATH, itemId);

export const prepareArchiveFromItem = async ({
  item,
  log,
  fileServiceType,
  reply,
  getChildrenFromItem,
  downloadFile,
}) => {
  // init archive
  const archive = archiver.create('zip', { store: true });
  archive.on('warning', function (err) {
    if (err.code === 'ENOENT') {
      log.debug(err);
    } else {
      throw err;
    }
  });
  archive.on('error', function (err) {
    throw err;
  });

  // path to save files temporarly and save archive
  const fileStorage = buildStoragePath(item.id);
  await mkdir(fileStorage, { recursive: true });
  const zipPath = path.join(fileStorage, item.id + '.zip');
  const zipStream = fs.createWriteStream(zipPath);
  archive.pipe(zipStream);

  // path used to index files in archive
  const rootPath = path.dirname('./');

  // create files from items
  try {
    await addItemToZip({
      item,
      archiveRootPath: rootPath,
      archive,
      fileServiceType,
      fileStorage,
      getChildrenFromItem,
      downloadFile,
    });
  } catch (error) {
    throw new Error(`Error during exporting zip: ${error}`);
  }

  // wait for zip to be completely created
  const sendBufferPromise = new Promise((resolve, reject) => {
    zipStream.on('error', reject);

    zipStream.on('close', () => {
      // set reply headers depending zip file and return file
      const buffer = fs.readFileSync(zipPath);
      reply.raw.setHeader('Content-Disposition', `filename="${item.name}.zip"`);
      reply.raw.setHeader('Content-Length', Buffer.byteLength(buffer));
      reply.type('application/zip');
      resolve(buffer);
    });
  });

  archive.finalize();
  return sendBufferPromise;
};
