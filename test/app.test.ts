import FormData from 'form-data';
import { createReadStream, existsSync, readdirSync } from 'fs';
import { StatusCodes } from 'http-status-codes';
import path from 'path';
import { v4 } from 'uuid';

import {
  FileTaskManager,
  ServiceMethod,
  UploadEmptyFileError,
  UploadFileInvalidParameterError,
} from 'graasp-plugin-file';
import { ItemTaskManager, TaskRunner } from 'graasp-test';
import MockTask from 'graasp-test/src/tasks/task';

import { ItemType } from '../src/constants';
import plugin from '../src/service-api';
import build, { DEFAULT_OPTIONS } from './app';
import {
  FIXTURE_DOT_ZIP_PATH,
  FIXTURE_EMPTY_ITEMS_ZIP_PATH,
  FIXTURE_IMAGE_PATH,
  FIXTURE_LIGHT_COLOR_ZIP_PATH,
  ITEM_FOLDER,
  NON_EXISTING_FILE,
  SUB_ITEMS,
  TMP_FOLDER_PATH,
} from './constants';
import { FIXTURES_DOT_CHILDREN_ITEMS, FIXTURE_DOT_PARENT_ITEM } from './fixtures/07.03.2022';
import { FIXTURES_MOCK_CHILDREN_ITEMS, LIGHT_COLOR_PARENT_ITEM } from './fixtures/lightColor';
import { FIXTURES_MOCK_CHILDREN_EMPTY_ITEMS } from './fixtures/zipWithEmptyItems';
import {
  mockCreateGetChildrenTaskSequence,
  mockCreateGetTaskSequence,
  mockRunSingle,
} from './mocks';

const taskManager = new ItemTaskManager();
const runner = new TaskRunner();

describe('Import Zip', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    jest.spyOn(runner, 'runSingle').mockImplementation(async () => true);
    jest.spyOn(runner, 'runSingleSequence').mockImplementation(async () => true);
  });

  describe('/zip-import', () => {
    it('Successfully import zip light color', async () => {
      jest.spyOn(runner, 'runMultipleSequences').mockImplementation(async (tasks) => {
        // first level
        if (tasks.length === 3) {
          return FIXTURES_MOCK_CHILDREN_ITEMS;
        }
        // parent level
        if (tasks.length === 1) {
          return [LIGHT_COLOR_PARENT_ITEM];
        }
        return [];
      });

      const app = await build({
        plugin,
        taskManager,
        runner,
      });

      const createItemTask = jest
        .spyOn(taskManager, 'createCreateTaskSequence')
        .mockReturnValue([new MockTask(true)]);
      jest.spyOn(taskManager, 'createUpdateTaskSequence').mockReturnValue([new MockTask(true)]);

      const form = new FormData();
      const filepath = path.resolve(__dirname, FIXTURE_LIGHT_COLOR_ZIP_PATH);
      form.append('file', createReadStream(filepath));

      const res = await app.inject({
        method: 'POST',
        url: '/zip-import',
        payload: form,
        headers: form.getHeaders(),
      });

      expect(res.statusCode).toBe(StatusCodes.OK);
      // file is deleted
      try {
        if (existsSync(TMP_FOLDER_PATH)) {
          // file is deleted
          const files = readdirSync(TMP_FOLDER_PATH);
          expect(files.length).toBeFalsy();
        }
      } catch (err) {
        // don't check if folder doesn't exist
      }

      // recursively handle zip content
      expect(createItemTask).toHaveBeenCalledTimes(1 + FIXTURES_MOCK_CHILDREN_ITEMS.length);
    });

    it('Successfully import zip with dot in name', async () => {
      jest.spyOn(runner, 'runMultipleSequences').mockImplementation(async (tasks) => {
        // first level
        if (tasks.length === 3) {
          return FIXTURES_DOT_CHILDREN_ITEMS;
        }
        // parent level
        if (tasks.length === 1) {
          return [FIXTURE_DOT_PARENT_ITEM];
        }
        return [];
      });

      const app = await build({
        plugin,
        taskManager,
        runner,
      });

      const createItemTask = jest
        .spyOn(taskManager, 'createCreateTaskSequence')
        .mockReturnValue([new MockTask(true)]);
      jest.spyOn(taskManager, 'createUpdateTaskSequence').mockReturnValue([new MockTask(true)]);

      const form = new FormData();
      const filepath = path.resolve(__dirname, FIXTURE_DOT_ZIP_PATH);
      form.append('file', createReadStream(filepath));

      const res = await app.inject({
        method: 'POST',
        url: '/zip-import',
        payload: form,
        headers: form.getHeaders(),
      });

      expect(res.statusCode).toBe(StatusCodes.OK);
      // file is deleted
      try {
        if (existsSync(TMP_FOLDER_PATH)) {
          // file is deleted
          const files = readdirSync(TMP_FOLDER_PATH);
          expect(files.length).toBeFalsy();
        }
      } catch (err) {
        // don't check if folder doesn't exist
      }

      // recursively handle zip content
      expect(createItemTask).toHaveBeenCalledTimes(1 + FIXTURES_DOT_CHILDREN_ITEMS.length);
      expect(res.json()[0].name).toEqual(FIXTURE_DOT_PARENT_ITEM.name);
    });

    it('Successfully import zip in parent', async () => {
      jest.spyOn(runner, 'runMultipleSequences').mockImplementation(async (tasks) => {
        // first level
        if (tasks.length === 3) {
          return FIXTURES_MOCK_CHILDREN_ITEMS;
        }
        // parent level
        if (tasks.length === 1) {
          return [LIGHT_COLOR_PARENT_ITEM];
        }
        return [];
      });

      const app = await build({
        plugin,
        taskManager,
        runner,
      });

      const id = v4();
      const createItemTask = jest
        .spyOn(taskManager, 'createCreateTaskSequence')
        .mockImplementation((_member, item, parentId) => {
          // check first create task set parent to given parent id
          if (item.name === LIGHT_COLOR_PARENT_ITEM.name) {
            expect(parentId).toEqual(id);
          }
          return [new MockTask(true)];
        });
      jest.spyOn(taskManager, 'createUpdateTaskSequence').mockReturnValue([new MockTask(true)]);

      const form = new FormData();
      const filepath = path.resolve(__dirname, FIXTURE_LIGHT_COLOR_ZIP_PATH);
      form.append('file', createReadStream(filepath));
      form.append('file', createReadStream(filepath));

      const res = await app.inject({
        method: 'POST',
        url: `/zip-import?parentId=${id}`,
        payload: form,
        headers: form.getHeaders(),
      });

      expect(res.statusCode).toBe(StatusCodes.OK);

      try {
        if (existsSync(TMP_FOLDER_PATH)) {
          // file is deleted
          const files = readdirSync(TMP_FOLDER_PATH);
          expect(files.length).toBeFalsy();
        }
      } catch (err) {
        // don't check if folder doesn't exist
      }

      // recursively handle zip content
      expect(createItemTask).toHaveBeenCalledTimes(1 + FIXTURES_MOCK_CHILDREN_ITEMS.length);
    });

    it('Throw if file is not a zip archive', async () => {
      const app = await build({
        plugin,
        taskManager,
        runner,
      });

      const form = new FormData();
      const filepath = path.resolve(__dirname, FIXTURE_IMAGE_PATH);
      form.append('file', createReadStream(filepath));
      form.append('file', createReadStream(filepath));

      const res = await app.inject({
        method: 'POST',
        url: '/zip-import',
        payload: form,
        headers: form.getHeaders(),
      });

      expect(res.statusCode).toBe(StatusCodes.OK);
    });

    it('Ignore empty files in archive', async () => {
      // throw on upload file
      const uploadFile = jest
        .spyOn(runner, 'runSingle')
        .mockRejectedValue(new UploadEmptyFileError());

      jest.spyOn(taskManager, 'createCreateTaskSequence').mockReturnValue([new MockTask(true)]);
      jest.spyOn(taskManager, 'createUpdateTaskSequence').mockReturnValue([new MockTask(true)]);

      jest.spyOn(runner, 'runMultipleSequences').mockImplementation(async (tasks) => {
        // first level
        if (tasks.length === 2) {
          return FIXTURES_MOCK_CHILDREN_EMPTY_ITEMS;
        }
        return [];
      });

      const app = await build({
        plugin,
        taskManager,
        runner,
      });

      const form = new FormData();
      const filepath = path.resolve(__dirname, FIXTURE_EMPTY_ITEMS_ZIP_PATH);
      form.append('file', createReadStream(filepath));

      const res = await app.inject({
        method: 'POST',
        url: '/zip-import',
        payload: form,
        headers: form.getHeaders(),
      });
      expect(uploadFile).toHaveBeenCalled();
      expect(res.statusCode).toBe(StatusCodes.OK);
    });

    it('Throw on if one file fails to upload', async () => {
      // throw on upload file
      const error = new UploadFileInvalidParameterError();
      const uploadFile = jest.spyOn(runner, 'runSingle').mockRejectedValue(error);

      jest.spyOn(taskManager, 'createCreateTaskSequence').mockReturnValue([new MockTask(true)]);
      jest.spyOn(taskManager, 'createUpdateTaskSequence').mockReturnValue([new MockTask(true)]);

      jest.spyOn(runner, 'runMultipleSequences').mockImplementation(async (tasks) => {
        // first level
        if (tasks.length === 2) {
          return FIXTURES_MOCK_CHILDREN_EMPTY_ITEMS;
        }
        return [];
      });

      const app = await build({
        plugin,
        taskManager,
        runner,
      });

      const form = new FormData();
      const filepath = path.resolve(__dirname, FIXTURE_EMPTY_ITEMS_ZIP_PATH);
      form.append('file', createReadStream(filepath));

      const res = await app.inject({
        method: 'POST',
        url: '/zip-import',
        payload: form,
        headers: form.getHeaders(),
      });
      expect(uploadFile).toHaveBeenCalled();
      expect(res.statusCode).toBe(error.statusCode);
    });
  });
});

describe('Export Zip', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const getFileTask = new MockTask(null);
    mockRunSingle({ runner, task: getFileTask });
    jest.spyOn(runner, 'runSingleSequence').mockImplementation(async (tasks) => tasks[0].result);
  });

  it('Successfully export zip', async () => {
    const app = await build({
      plugin,
      taskManager,
      runner,
    });

    const parentItem = ITEM_FOLDER;
    const subItems = SUB_ITEMS;

    mockCreateGetTaskSequence({
      itemTaskManager: taskManager,
      parentItem,
      subItems,
    });
    const createGetChildrenTask = mockCreateGetChildrenTaskSequence({
      itemTaskManager: taskManager,
      parentItem,
      subItems,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/zip-export/${ITEM_FOLDER.id}`,
      headers: new FormData().getHeaders(),
    });
    expect(res.statusCode).toBe(StatusCodes.OK);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toBe(`filename="${ITEM_FOLDER.name}.zip"`);
    expect(res.rawPayload).toBeTruthy();
    expect(res.headers['content-length']).not.toBe('0');

    // recursively handle zip content
    expect(createGetChildrenTask).toHaveBeenCalledTimes(
      1 + SUB_ITEMS.filter((item) => item.type === ItemType.FOLDER).length,
    );
  });

  it('Throw if file not found', async () => {
    const app = await build({
      plugin,
      taskManager,
      runner,
    });

    jest
      .spyOn(taskManager, 'createGetTaskSequence')
      .mockImplementation(() => [new MockTask(NON_EXISTING_FILE)]);
    const fileTaskManager = new FileTaskManager(
      DEFAULT_OPTIONS.serviceOptions,
      ServiceMethod.LOCAL,
    );

    jest.spyOn(fileTaskManager, 'createDownloadFileTask').mockImplementation(() => {
      throw Error('file not found');
    });

    const res = await app.inject({
      method: 'GET',
      url: `/zip-export/${NON_EXISTING_FILE.id}`,
      headers: new FormData().getHeaders(),
    });
    expect(res.statusCode).toBe(StatusCodes.INTERNAL_SERVER_ERROR);
  });
});
